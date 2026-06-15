import { Router, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { posix as pathPosix } from 'path';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { InputValidator } from '../../security/input-validator';
import auditLogger from '../../security/audit-logger.service';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { DeploymentTarget } from '../../services/platform-config.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import {
  getDeploymentProfile,
  getNextDeploymentProfileVersion,
  listDeploymentProfiles,
  saveDeploymentProfile
} from '../../modules/deployments/deployment-profile.repository';

// SECURITY FIX CVE-2026-014: Add input validation to deployments routes
const inputValidator = new InputValidator();

const router = Router();
router.use(authenticate, requireRole('admin'));

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
}

function nowISO(): string {
  return new Date().toISOString();
}

const SUPPORTED_SERVER_TYPES: DeploymentTarget[] = [
  'nginx',
  'apache',
  'caddy',
  'docker_compose',
  'binary_agent',
  'k8s_daemonset'
];

function renderNginx(profile: any): string {
  return `limit_req_zone $binary_remote_addr zone=api_limit:10m rate=${profile.rateLimit}r/m;

server {
  listen ${profile.port};
  server_name ${profile.serverName};

  location / {
    proxy_pass ${profile.upstream};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /api/ {
    limit_req zone=api_limit burst=20 nodelay;
  }
}`;
}

function renderApache(profile: any): string {
  return `<VirtualHost *:${profile.port}>
  ServerName ${profile.serverName}
  ProxyPreserveHost On
  ProxyPass / ${profile.upstream}/
  ProxyPassReverse / ${profile.upstream}/

  <Location /api/>
    SetEnv RATE_LIMIT ${profile.rateLimit}
  </Location>
</VirtualHost>`;
}

function renderCaddy(profile: any): string {
  return `${profile.serverName}:${profile.port} {
  reverse_proxy ${profile.upstream}

  @api path /api/*
  handle @api {
    header X-AetherGuard-RateLimit "${profile.rateLimit}"
    reverse_proxy ${profile.upstream}
  }

  encode zstd gzip
}`;
}

function renderDockerCompose(profile: any): string {
  return `version: "3.9"
services:
  aetherguard-agent:
    image: ghcr.io/aetherguard/agent:latest
    restart: unless-stopped
    environment:
      AETHERGUARD_SERVER_NAME: ${profile.serverName}
      AETHERGUARD_RATE_LIMIT: "${profile.rateLimit}"
      AETHERGUARD_UPSTREAM: ${profile.upstream}
    ports:
      - "${profile.port}:8080"
`;
}

function renderBinaryAgent(profile: any): string {
  return `#!/usr/bin/env bash
set -euo pipefail

install -d /etc/aetherguard
cat >/etc/aetherguard/agent.env <<'EOF'
AETHERGUARD_SERVER_NAME=${profile.serverName}
AETHERGUARD_RATE_LIMIT=${profile.rateLimit}
AETHERGUARD_UPSTREAM=${profile.upstream}
EOF

cat >/etc/systemd/system/aetherguard-agent.service <<'EOF'
[Unit]
Description=AetherGuard Binary Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/aetherguard/agent.env
ExecStart=/usr/local/bin/aetherguard-agent --listen ${profile.port}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now aetherguard-agent.service
`;
}

function renderK8sDaemonSet(profile: any): string {
  const namespace = profile.namespace || 'aetherguard';
  const apiKey = profile.apiKey || 'REPLACE_WITH_AETHERGUARD_API_KEY';
  return `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespace}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: aetherguard-agent-config
  namespace: ${namespace}
data:
  AETHERGUARD_SERVER_NAME: "${profile.serverName}"
  AETHERGUARD_RATE_LIMIT: "${profile.rateLimit}"
  AETHERGUARD_UPSTREAM: "${profile.upstream}"
---
apiVersion: v1
kind: Secret
metadata:
  name: aetherguard-agent-secret
  namespace: ${namespace}
type: Opaque
stringData:
  AETHERGUARD_API_KEY: "${apiKey}"
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: aetherguard-agent
  namespace: ${namespace}
spec:
  selector:
    matchLabels:
      app: aetherguard-agent
  template:
    metadata:
      labels:
        app: aetherguard-agent
    spec:
      containers:
        - name: agent
          image: ${profile.image || 'ghcr.io/aetherguard/agent:latest'}
          imagePullPolicy: IfNotPresent
          envFrom:
            - configMapRef:
                name: aetherguard-agent-config
            - secretRef:
                name: aetherguard-agent-secret
          ports:
            - containerPort: 8080
`;
}

function renderEnvSnippet(profile: any): string {
  return `ALLOWED_ORIGINS=http://${profile.serverName}
RATE_LIMIT_REQUESTS=${profile.rateLimit}
UPSTREAM_TARGET=${profile.upstream}
LISTEN_PORT=${profile.port}`;
}

function getConfigFileName(serverType: DeploymentTarget): string {
  switch (serverType) {
    case 'nginx':
      return 'nginx.conf';
    case 'apache':
      return 'apache.conf';
    case 'caddy':
      return 'Caddyfile';
    case 'docker_compose':
      return 'docker-compose.yml';
    case 'binary_agent':
      return 'bootstrap-agent.sh';
    case 'k8s_daemonset':
      return 'daemonset.yaml';
    default:
      return 'deployment.conf';
  }
}

function renderBinaryAgentUnit(profile: any): string {
  return `[Unit]
Description=AetherGuard Binary Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/aetherguard/agent.env
ExecStart=/usr/local/bin/aetherguard-agent --listen ${profile.port}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

function renderHealthcheck(profile: any): string {
  const upstream = String(profile.upstream || '').replace(/\/$/, '');
  return `#!/usr/bin/env bash
set -euo pipefail

if [ "\${AETHERGUARD_HEALTHCHECK_MODE:-}" = "files" ] || [ -n "\${AETHERGUARD_INSTALL_ROOT:-}" ]; then
  ROOT_DIR="\${AETHERGUARD_INSTALL_ROOT:-/}"
  ROOT_DIR="\${ROOT_DIR%/}"
  [ -n "$ROOT_DIR" ] || ROOT_DIR="/"
  ETC_DIR="\${ROOT_DIR}/etc/aetherguard"
  SYSTEMD_DIR="\${ROOT_DIR}/etc/systemd/system"
  BIN_DIR="\${AETHERGUARD_BIN_DIR:-\${ROOT_DIR}/usr/local/bin}"
  test -f "$ETC_DIR/agent.env"
  test -f "$SYSTEMD_DIR/aetherguard-agent.service"
  if [ "\${AETHERGUARD_REQUIRE_BINARY:-0}" = "1" ]; then
    test -x "$BIN_DIR/aetherguard-agent"
  fi
  echo "AetherGuard bundle files verified"
  exit 0
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:${profile.port}/api/health" >/dev/null 2>&1 && exit 0
  curl -fsS "${upstream}/api/health" >/dev/null 2>&1 && exit 0
fi

echo "AetherGuard health check failed" >&2
exit 1
`;
}

function renderBundleReadme(serverType: DeploymentTarget, deploymentId: string, checksum: string, warnings: string[]): string {
  const warningLines = warnings.length ? warnings.map((warning) => `- ${warning}`).join('\n') : '- No additional warnings.';
  return `# AetherGuard Deployment Bundle

Deployment ID: ${deploymentId}
Target: ${serverType}
Checksum: ${checksum}

Files in this bundle:
- ${getConfigFileName(serverType)}
- .env
- install.sh
- upgrade.sh
- rollback.sh
- healthcheck.sh
- bundle-manifest.json

Warnings:
${warningLines}

Usage:
1. Review the generated configuration and environment values.
2. Run \`./install.sh\` on the target host or admin workstation.
3. Validate with \`./healthcheck.sh\`.
4. Use \`./upgrade.sh\` to apply an in-place refresh of bundle files.
5. Use \`./rollback.sh\` to revert the generated deployment changes.
`;
}

function renderBundleInstallScript(serverType: DeploymentTarget, deploymentId: string): string {
  const base = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ID="${deploymentId}"

`;

  switch (serverType) {
    case 'nginx':
      return `${base}install -d /etc/nginx/conf.d
cp "$SCRIPT_DIR/nginx.conf" "/etc/nginx/conf.d/aetherguard-${deploymentId}.conf"
nginx -t
systemctl reload nginx || nginx -s reload
echo "nginx deployment applied: aetherguard-${deploymentId}.conf"
`;
    case 'apache':
      return `${base}if [ -d /etc/apache2/sites-available ]; then
  cp "$SCRIPT_DIR/apache.conf" "/etc/apache2/sites-available/aetherguard-${deploymentId}.conf"
  a2ensite "aetherguard-${deploymentId}.conf" || true
  apachectl configtest
  systemctl reload apache2 || apachectl graceful
else
  cp "$SCRIPT_DIR/apache.conf" "/etc/httpd/conf.d/aetherguard-${deploymentId}.conf"
  apachectl configtest
  systemctl reload httpd || apachectl graceful
fi
echo "apache deployment applied: aetherguard-${deploymentId}.conf"
`;
    case 'caddy':
      return `${base}install -d /etc/caddy/conf.d
cp "$SCRIPT_DIR/Caddyfile" "/etc/caddy/conf.d/aetherguard-${deploymentId}.caddy"
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || caddy reload --config /etc/caddy/Caddyfile
echo "caddy deployment applied: aetherguard-${deploymentId}.caddy"
`;
    case 'docker_compose':
      return `${base}docker compose --project-name "aetherguard-${deploymentId}" --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/docker-compose.yml" up -d
echo "docker compose deployment applied: aetherguard-${deploymentId}"
`;
    case 'binary_agent':
      return `${base}ROOT_DIR="\${AETHERGUARD_INSTALL_ROOT:-/}"
ROOT_DIR="\${ROOT_DIR%/}"
[ -n "$ROOT_DIR" ] || ROOT_DIR="/"
ETC_DIR="\${ROOT_DIR}/etc/aetherguard"
SYSTEMD_DIR="\${ROOT_DIR}/etc/systemd/system"
BIN_DIR="\${AETHERGUARD_BIN_DIR:-\${ROOT_DIR}/usr/local/bin}"
install -d "$ETC_DIR" "$SYSTEMD_DIR" "$BIN_DIR"
cp "$SCRIPT_DIR/.env" "$ETC_DIR/agent.env"
cp "$SCRIPT_DIR/aetherguard-agent.service" "$SYSTEMD_DIR/aetherguard-agent.service"
if [ -f "$SCRIPT_DIR/bin/aetherguard-agent" ]; then
  install -m 0755 "$SCRIPT_DIR/bin/aetherguard-agent" "$BIN_DIR/aetherguard-agent"
else
  echo "warning: packaged aetherguard-agent binary not found in bundle/bin" >&2
fi
if [ "\${AETHERGUARD_SKIP_SYSTEMCTL:-0}" = "1" ]; then
  echo "Skipping systemctl lifecycle hooks"
else
  systemctl daemon-reload
  systemctl enable --now aetherguard-agent.service
fi
echo "binary agent deployment applied"
`;
    case 'k8s_daemonset':
      return `${base}kubectl apply -f "$SCRIPT_DIR/daemonset.yaml"
echo "k8s daemonset applied"
`;
    default:
      return `${base}echo "No installer available for ${serverType}" >&2
exit 1
`;
  }
}

function renderBundleUpgradeScript(serverType: DeploymentTarget, deploymentId: string): string {
  const base = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ID="${deploymentId}"

`;

  switch (serverType) {
    case 'nginx':
      return `${base}cp "$SCRIPT_DIR/nginx.conf" "/etc/nginx/conf.d/aetherguard-${deploymentId}.conf"
nginx -t
systemctl reload nginx || nginx -s reload
echo "nginx deployment upgraded: aetherguard-${deploymentId}.conf"
`;
    case 'apache':
      return `${base}if [ -d /etc/apache2/sites-available ]; then
  cp "$SCRIPT_DIR/apache.conf" "/etc/apache2/sites-available/aetherguard-${deploymentId}.conf"
  apachectl configtest
  systemctl reload apache2 || apachectl graceful
else
  cp "$SCRIPT_DIR/apache.conf" "/etc/httpd/conf.d/aetherguard-${deploymentId}.conf"
  apachectl configtest
  systemctl reload httpd || apachectl graceful
fi
echo "apache deployment upgraded: aetherguard-${deploymentId}.conf"
`;
    case 'caddy':
      return `${base}cp "$SCRIPT_DIR/Caddyfile" "/etc/caddy/conf.d/aetherguard-${deploymentId}.caddy"
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || caddy reload --config /etc/caddy/Caddyfile
echo "caddy deployment upgraded: aetherguard-${deploymentId}.caddy"
`;
    case 'docker_compose':
      return `${base}docker compose --project-name "aetherguard-${deploymentId}" --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/docker-compose.yml" up -d
echo "docker compose deployment upgraded: aetherguard-${deploymentId}"
`;
    case 'binary_agent':
      return `${base}ROOT_DIR="\${AETHERGUARD_INSTALL_ROOT:-/}"
ROOT_DIR="\${ROOT_DIR%/}"
[ -n "$ROOT_DIR" ] || ROOT_DIR="/"
ETC_DIR="\${ROOT_DIR}/etc/aetherguard"
SYSTEMD_DIR="\${ROOT_DIR}/etc/systemd/system"
BIN_DIR="\${AETHERGUARD_BIN_DIR:-\${ROOT_DIR}/usr/local/bin}"
install -d "$ETC_DIR" "$SYSTEMD_DIR" "$BIN_DIR"
cp "$SCRIPT_DIR/.env" "$ETC_DIR/agent.env"
cp "$SCRIPT_DIR/aetherguard-agent.service" "$SYSTEMD_DIR/aetherguard-agent.service"
if [ -f "$SCRIPT_DIR/bin/aetherguard-agent" ]; then
  install -m 0755 "$SCRIPT_DIR/bin/aetherguard-agent" "$BIN_DIR/aetherguard-agent"
fi
if [ "\${AETHERGUARD_SKIP_SYSTEMCTL:-0}" = "1" ]; then
  echo "Skipping systemctl lifecycle hooks"
else
  systemctl daemon-reload
  systemctl try-restart aetherguard-agent.service || systemctl enable --now aetherguard-agent.service
fi
echo "binary agent deployment upgraded"
`;
    case 'k8s_daemonset':
      return `${base}kubectl apply -f "$SCRIPT_DIR/daemonset.yaml"
echo "k8s daemonset upgraded"
`;
    default:
      return `${base}echo "No upgrade available for ${serverType}" >&2
exit 1
`;
  }
}

function renderBundleRollbackScript(serverType: DeploymentTarget, deploymentId: string): string {
  const base = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ID="${deploymentId}"

`;

  switch (serverType) {
    case 'nginx':
      return `${base}rm -f "/etc/nginx/conf.d/aetherguard-${deploymentId}.conf"
systemctl reload nginx || nginx -s reload
echo "nginx deployment rolled back: aetherguard-${deploymentId}.conf"
`;
    case 'apache':
      return `${base}if [ -d /etc/apache2/sites-available ]; then
  a2dissite "aetherguard-${deploymentId}.conf" || true
  rm -f "/etc/apache2/sites-available/aetherguard-${deploymentId}.conf"
  systemctl reload apache2 || apachectl graceful
else
  rm -f "/etc/httpd/conf.d/aetherguard-${deploymentId}.conf"
  systemctl reload httpd || apachectl graceful
fi
echo "apache deployment rolled back: aetherguard-${deploymentId}.conf"
`;
    case 'caddy':
      return `${base}rm -f "/etc/caddy/conf.d/aetherguard-${deploymentId}.caddy"
systemctl reload caddy || caddy reload --config /etc/caddy/Caddyfile
echo "caddy deployment rolled back: aetherguard-${deploymentId}.caddy"
`;
    case 'docker_compose':
      return `${base}docker compose --project-name "aetherguard-${deploymentId}" --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/docker-compose.yml" down
echo "docker compose deployment rolled back: aetherguard-${deploymentId}"
`;
    case 'binary_agent':
      return `${base}ROOT_DIR="\${AETHERGUARD_INSTALL_ROOT:-/}"
ROOT_DIR="\${ROOT_DIR%/}"
[ -n "$ROOT_DIR" ] || ROOT_DIR="/"
ETC_DIR="\${ROOT_DIR}/etc/aetherguard"
SYSTEMD_DIR="\${ROOT_DIR}/etc/systemd/system"
BIN_DIR="\${AETHERGUARD_BIN_DIR:-\${ROOT_DIR}/usr/local/bin}"
if [ "\${AETHERGUARD_SKIP_SYSTEMCTL:-0}" = "1" ]; then
  echo "Skipping systemctl lifecycle hooks"
else
  systemctl disable --now aetherguard-agent.service || true
fi
rm -f "$SYSTEMD_DIR/aetherguard-agent.service"
rm -f "$ETC_DIR/agent.env"
rm -f "$BIN_DIR/aetherguard-agent"
if [ "\${AETHERGUARD_SKIP_SYSTEMCTL:-0}" != "1" ]; then
  systemctl daemon-reload
fi
echo "binary agent deployment rolled back"
`;
    case 'k8s_daemonset':
      return `${base}kubectl delete -f "$SCRIPT_DIR/daemonset.yaml" --ignore-not-found
echo "k8s daemonset rolled back"
`;
    default:
      return `${base}echo "No rollback available for ${serverType}" >&2
exit 1
`;
  }
}

function buildBundleFiles(serverType: DeploymentTarget, deploymentId: string, profile: any, configText: string, envSnippet: string, checksum: string, warnings: string[]) {
  const files: Array<{ path: string; content: string; executable?: boolean }> = [
    {
      path: 'README.md',
      content: renderBundleReadme(serverType, deploymentId, checksum, warnings)
    },
    {
      path: getConfigFileName(serverType),
      content: configText
    },
    {
      path: '.env',
      content: envSnippet
    },
    {
      path: 'healthcheck.sh',
      content: renderHealthcheck(profile),
      executable: true
    },
    {
      path: 'install.sh',
      content: renderBundleInstallScript(serverType, deploymentId),
      executable: true
    },
    {
      path: 'upgrade.sh',
      content: renderBundleUpgradeScript(serverType, deploymentId),
      executable: true
    },
    {
      path: 'rollback.sh',
      content: renderBundleRollbackScript(serverType, deploymentId),
      executable: true
    }
  ];

  if (serverType === 'binary_agent') {
    files.push({
      path: 'aetherguard-agent.service',
      content: renderBinaryAgentUnit(profile)
    });
  }

  const manifest = {
    version: '1.0',
    deploymentId,
    target: serverType,
    checksum,
    generatedAt: nowISO(),
    profile,
    warnings,
    files: files.map((file) => ({
      path: file.path,
      executable: Boolean(file.executable)
    }))
  };

  files.push({
    path: 'bundle-manifest.json',
    content: JSON.stringify(manifest, null, 2)
  });

  return files;
}

function renderSelfExtractingBundle(deploymentId: string, files: Array<{ path: string; content: string; executable?: boolean }>): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `TARGET_DIR="\${1:-./aetherguard-deployment-${deploymentId}}"`,
    'mkdir -p "$TARGET_DIR"'
  ];

  files.forEach((file, index) => {
    const dir = pathPosix.dirname(file.path);
    if (dir && dir !== '.') {
      lines.push(`mkdir -p "$TARGET_DIR/${dir}"`);
    }
    const marker = `__AETHERGUARD_BUNDLE_${index}__`;
    lines.push(`cat >"$TARGET_DIR/${file.path}" <<'${marker}'`);
    lines.push(file.content);
    lines.push(marker);
    if (file.executable) {
      lines.push(`chmod +x "$TARGET_DIR/${file.path}"`);
    }
  });

  lines.push('printf \'Bundle extracted to %s\\n\' "$TARGET_DIR"');
  return lines.join('\n');
}

function isSupportedServerType(serverType: any): serverType is DeploymentTarget {
  return SUPPORTED_SERVER_TYPES.includes(serverType as DeploymentTarget);
}

function renderDeployment(serverType: DeploymentTarget, profile: any): { configText: string; envSnippet: string; warnings: string[] } {
  switch (serverType) {
    case 'nginx':
      return { configText: renderNginx(profile), envSnippet: renderEnvSnippet(profile), warnings: [] };
    case 'apache':
      return { configText: renderApache(profile), envSnippet: renderEnvSnippet(profile), warnings: [] };
    case 'caddy':
      return { configText: renderCaddy(profile), envSnippet: renderEnvSnippet(profile), warnings: [] };
    case 'docker_compose':
      return {
        configText: renderDockerCompose(profile),
        envSnippet: renderEnvSnippet(profile),
        warnings: ['Review image tags and bind mounts before production rollout.']
      };
    case 'binary_agent':
      return {
        configText: renderBinaryAgent(profile),
        envSnippet: renderEnvSnippet(profile),
        warnings: ['Binary package path must be provided during actual install.']
      };
    case 'k8s_daemonset':
      return {
        configText: renderK8sDaemonSet(profile),
        envSnippet: renderEnvSnippet(profile),
        warnings: ['Review namespace, image pull policy, and secret wiring before apply.']
      };
    default:
      return { configText: renderNginx(profile), envSnippet: renderEnvSnippet(profile), warnings: [] };
  }
}

function validateProfile(profile: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const port = Number(profile?.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) errors.push('Invalid port');
  if (!profile?.serverName || typeof profile.serverName !== 'string') errors.push('Invalid serverName');
  if (!profile?.upstream || typeof profile.upstream !== 'string') errors.push('Invalid upstream');
  const rate = Number(profile?.rateLimit);
  if (!Number.isFinite(rate) || rate < 1 || rate > 100000) errors.push('Invalid rateLimit');
  return { ok: errors.length === 0, errors };
}

router.post('/generate', (req: AuthenticatedRequest, res: Response) => {
  // SECURITY FIX CVE-2026-014: Validate input before processing
  const validationResult = inputValidator.validateRequest(req);
  if (!validationResult.isValid) {
    return res.status(400).json({
      success: false,
      error: 'backend.invalid_input',
      details: validationResult.errors
    });
  }

  const serverType = req.body?.serverType;
  const profile = req.body?.profile || {};
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: 'backend.invalid_profile', details: validation.errors });
  }
  if (!isSupportedServerType(serverType)) {
    return res.status(400).json({ success: false, error: 'backend.unsupported_deployment_target' });
  }

  const rendered = renderDeployment(serverType, profile);
  const configText = rendered.configText;
  const envSnippet = rendered.envSnippet;
  const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');

  return res.json({
    success: true,
    data: {
      configText,
      envSnippet,
      checksum,
      warnings: rendered.warnings
    }
  });
});

router.post('/save', async (req: AuthenticatedRequest, res: Response) => {
  try {
  const serverType = req.body?.serverType;
  const profile = req.body?.profile || {};
  const siteId = req.body?.siteId || null;
  const name = req.body?.name || null;

  if (!isSupportedServerType(serverType)) {
    return res.status(400).json({ success: false, error: 'backend.unsupported_deployment_target' });
  }
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: 'backend.invalid_profile', details: validation.errors });
  }
  const rendered = renderDeployment(serverType, profile);
  const configText = rendered.configText;
  const envSnippet = rendered.envSnippet;

  const tenantId = tenantOf(req);
  const version = await getNextDeploymentProfileVersion(tenantId, serverType, siteId);
  const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');
  const id = randomUUID();
  const createdAt = nowISO();

  await saveDeploymentProfile({
    id,
    tenant_id: tenantId,
    site_id: siteId,
    server_type: serverType,
    name,
    profile_json: JSON.stringify(profile),
    config_text: configText,
    env_snippet: envSnippet,
    checksum,
    version,
    created_by: req.user!.userId,
    created_at: createdAt
  });

  await auditLogger.log({
    tenantId,
    eventType: 'deployment_profile_saved',
    category: 'system',
    severity: 'warning',
    actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: req.ip },
    target: { type: 'site', id: siteId || id },
    action: 'save_deployment_profile',
    details: { deploymentId: id, serverType, version, checksum, name },
    status: 'success'
  });

  return res.json({
    success: true,
    data: {
      deploymentId: id,
      version,
      createdAt
    }
  });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_save_deployment_profile' });
  }
});

router.get('/:id/download', async (req: AuthenticatedRequest, res: Response) => {
  try {
  const format = String(req.query.format || 'bundle');
  const row = await getDeploymentProfile(req.params.id, tenantOf(req));
  if (!row) {
    return res.status(404).json({ success: false, error: 'backend.deployment_profile_not_found' });
  }

  void auditLogger.log({
    tenantId: tenantOf(req),
    eventType: 'deployment_profile_downloaded',
    category: 'system',
    severity: 'info',
    actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: req.ip },
    target: { type: 'site', id: String(row.site_id || row.id) },
    action: 'download_deployment_profile',
    details: { deploymentId: row.id, format },
    status: 'success'
  });

  if (format === 'conf') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}.conf"`);
    return res.send(row.config_text);
  }
  if (format === 'env') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}.env"`);
    return res.send(row.env_snippet);
  }

  const profile = (() => {
    try {
      return JSON.parse(String(row.profile_json || '{}'));
    } catch {
      return {};
    }
  })();
  const rendered = renderDeployment(row.server_type as DeploymentTarget, profile);
  const bundleFiles = buildBundleFiles(
    row.server_type as DeploymentTarget,
    String(row.id),
    profile,
    String(row.config_text || ''),
    String(row.env_snippet || ''),
    String(row.checksum || ''),
    rendered.warnings
  );

  if (format === 'manifest') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}-bundle.json"`);
    return res.send(JSON.stringify({
      deploymentId: row.id,
      serverType: row.server_type,
      checksum: row.checksum,
      version: row.version,
      files: bundleFiles
    }, null, 2));
  }

  const bundle = renderSelfExtractingBundle(String(row.id), bundleFiles);
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}-bundle.sh"`);
  return res.send(bundle);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_download_deployment_profile' });
  }
});

// --- ESP32 Deploy Bundle APIs (LEGACY) ---
// NOTE: ESP32 serial-deployer dongle hardware was retired 2026-06-13 and archived out of repo.
// Active hardware is the AetherGuard Root-Resistant Gateway Appliance (STM32H5/U5, newline-JSON protocol).
// These routes are retained for backward-compat: they filter by deviceType === 'esp32' / deviceId contains 'esp32'/'dongle'
// at runtime and may still serve historically-registered legacy devices. Do not extend; new flows use the
// Gateway Appliance newline-JSON protocol (see final-defense / device gateways).

/**
 * GET /api/deployments/esp32-status  (LEGACY)
 * Query legacy ESP32 dongle status (bundle cache state).
 * NOTE: AG:REQ serial protocol (USB-TTL) is archived; Gateway Appliance uses newline-delimited JSON.
 * Uses DeviceGateway for any still-connected legacy ESP32 hardware devices via WebSocket.
 */
router.get('/esp32-status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { getDeviceGateway } = await import('../../index');
    const gateway = getDeviceGateway();
    if (!gateway) {
      return res.json({ success: true, connected: false, message: 'backend.device_gateway_unavailable' });
    }

    // Get connected devices from DeviceGateway
    const devices = gateway.getConnectedDevices();
    const esp32Devices = devices.filter((d: any) =>
      d.deviceType === 'esp32' ||
      d.deviceId?.toLowerCase().includes('esp32') ||
      d.deviceId?.toLowerCase().includes('dongle')
    );

    if (esp32Devices.length === 0) {
      return res.json({
        success: true,
        connected: false,
        message: 'backend.no_esp32_connected'
      });
    }

    // Return status of first connected ESP32
    const device = esp32Devices[0];
    return res.json({
      success: true,
      connected: true,
      deviceId: device.deviceId,
      isOnline: device.isOnline,
      bundleState: device.bundleState || 'none',
      bundleSize: device.bundleSize || 0
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.esp32_status_failed' });
  }
});

/**
 * POST /api/deployments/esp32-execute  (LEGACY)
 * Trigger bundle deployment on a connected legacy ESP32 device.
 * Sends AG:REQ:DEPLOY command via DeviceGateway (AG:REQ protocol is archived; Gateway Appliance uses newline-JSON).
 */
router.post('/esp32-execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId } = req.body;

    const { getDeviceGateway } = await import('../../index');
    const gateway = getDeviceGateway();
    if (!gateway) {
      return sendError(res, 503, { code: 'DEVICE_GATEWAY_UNAVAILABLE', message: 'backend.device_gateway_unavailable' });
    }

    // Find target device
    const devices = gateway.getConnectedDevices();
    const targetDevice = deviceId
      ? devices.find((d: any) => d.deviceId === deviceId)
      : devices.find((d: any) =>
          d.deviceType === 'esp32' ||
          d.deviceId?.toLowerCase().includes('esp32') ||
          d.deviceId?.toLowerCase().includes('dongle')
        );

    if (!targetDevice) {
      return sendError(res, 404, { code: 'ESP32_NOT_FOUND', message: 'backend.esp32_not_found' });
    }

    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: targetDevice.deviceId,
      commandType: 'deploy_bundle',
      payload: {},
      actor: {
        tenantId: tenantOf(req),
        userId: req.user?.userId || 'unknown',
        email: req.user?.email,
        ip: req.ip
      }
    });

    if (!result.success && result.status === 'failed') {
      return sendError(res, result.reason === 'hardware_gate_unavailable' ? 503 : 400, {
        code: String(result.reason || 'ESP32_EXECUTE_FAILED').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(),
        message: result.message
      });
    }

    return sendSuccess(res, {
      message: result.message || 'backend.deploy_command_sent',
      deviceId: targetDevice.deviceId,
      status: result.status,
      actionId: result.actionId,
      confirmationSessionId: result.confirmationSessionId || null
    }, {
      legacy: {
        message: result.message || 'backend.deploy_command_sent',
        deviceId: targetDevice.deviceId,
        status: result.status,
        actionId: result.actionId,
        confirmationSessionId: result.confirmationSessionId || null
      }
    });
  } catch (error: any) {
    return sendError(res, 500, { code: 'ESP32_EXECUTE_FAILED', message: error?.message || 'backend.esp32_execute_failed' });
  }
});

/**
 * POST /api/deployments/generate-bundle
 * Generate a deployment bundle as base64 for writing to a legacy ESP32 device (serial transfer).
 * NOTE: ESP32 serial-deployer hardware is archived; Gateway Appliance uses newline-JSON.
 * Returns the full bundle content encoded for serial transfer
 */
router.post('/generate-bundle', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { serverType, profile, deploymentId } = req.body;
    if (!serverType) {
      return res.status(400).json({ success: false, error: 'backend.server_type_required' });
    }

    if (!isSupportedServerType(serverType)) {
      return res.status(400).json({ success: false, error: 'backend.unsupported_deployment_target' });
    }

    const validatedProfile = {
      port: Number(profile?.port) || 8080,
      serverName: String(profile?.serverName || 'localhost'),
      rateLimit: Number(profile?.rateLimit) || 100,
      upstream: String(profile?.upstream || 'http://backend:3005'),
      ...(profile?.namespace ? { namespace: String(profile.namespace) } : {}),
      ...(profile?.image ? { image: String(profile.image) } : {}),
      ...(profile?.apiKey ? { apiKey: String(profile.apiKey) } : {})
    };

    const validation = validateProfile(validatedProfile);
    if (!validation.ok) {
      return res.status(400).json({ success: false, error: 'backend.invalid_profile', details: validation.errors });
    }

    const rendered = renderDeployment(serverType as DeploymentTarget, validatedProfile);
    const configText = rendered.configText;
    const envSnippet = rendered.envSnippet;
    const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');
    const id = deploymentId || randomUUID();

    const bundleFiles = buildBundleFiles(
      serverType as DeploymentTarget,
      id,
      validatedProfile,
      configText,
      envSnippet,
      checksum,
      rendered.warnings
    );

    const bundleContent = renderSelfExtractingBundle(id, bundleFiles);
    const bundleBase64 = Buffer.from(bundleContent).toString('base64');

    return res.json({
      success: true,
      data: {
        bundleBase64,
        bundleSize: bundleContent.length,
        checksum,
        serverType,
        filename: `aetherguard-${serverType}-deploy.sh`
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_generate_bundle' });
  }
});

router.get('/history/list', async (req: AuthenticatedRequest, res: Response) => {
  try {
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 200);
  const siteId = (req.query.siteId as string) || null;
  const tenantId = tenantOf(req);
  const rows = await listDeploymentProfiles(tenantId, siteId, limit);

  return res.json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_load_deployment_history' });
  }
});

export default router;
