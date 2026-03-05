import { Router, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { InputValidator } from '../../security/input-validator';
import { getDatabase } from '../../config/database';

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

function ensureSchema(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT,
      server_type TEXT NOT NULL,
      name TEXT,
      profile_json TEXT NOT NULL,
      config_text TEXT NOT NULL,
      env_snippet TEXT NOT NULL,
      checksum TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function renderNginx(profile: any): string {
  return `server {
  listen ${profile.port};
  server_name ${profile.serverName};

  location / {
    proxy_pass ${profile.upstream};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  limit_req_zone $binary_remote_addr zone=api_limit:10m rate=${profile.rateLimit}r/m;
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

function renderEnvSnippet(profile: any): string {
  return `ALLOWED_ORIGINS=http://${profile.serverName}
RATE_LIMIT_REQUESTS=${profile.rateLimit}
UPSTREAM_TARGET=${profile.upstream}
LISTEN_PORT=${profile.port}`;
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

  ensureSchema();
  const serverType = req.body?.serverType;
  const profile = req.body?.profile || {};
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: 'backend.invalid_profile', details: validation.errors });
  }
  if (serverType !== 'nginx' && serverType !== 'apache') {
    return res.status(400).json({ success: false, error: 'backend.servertype_must_be_nginx_or_apache' });
  }

  const configText = serverType === 'nginx' ? renderNginx(profile) : renderApache(profile);
  const envSnippet = renderEnvSnippet(profile);
  const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');

  return res.json({
    success: true,
    data: {
      configText,
      envSnippet,
      checksum,
      warnings: []
    }
  });
});

router.post('/save', (req: AuthenticatedRequest, res: Response) => {
  // SECURITY FIX CVE-2026-014: Validate input before processing
  const validationResult = inputValidator.validateRequest(req);
  if (!validationResult.isValid) {
    return res.status(400).json({
      success: false,
      error: 'backend.invalid_input',
      details: validationResult.errors
    });
  }

  ensureSchema();
  const serverType = req.body?.serverType;
  const profile = req.body?.profile || {};
  const configText = req.body?.configText;
  const envSnippet = req.body?.envSnippet;
  const siteId = req.body?.siteId || null;
  const name = req.body?.name || null;

  if (serverType !== 'nginx' && serverType !== 'apache') {
    return res.status(400).json({ success: false, error: 'backend.servertype_must_be_nginx_or_apache' });
  }
  if (!configText || !envSnippet) {
    return res.status(400).json({ success: false, error: 'backend.configtext_and_envsnippet_are_required' });
  }

  const db = getDatabase();
  const tenantId = tenantOf(req);
  const versionRow = db.prepare(`
    SELECT MAX(version) as maxVersion
    FROM deployment_profiles
    WHERE tenant_id = ? AND server_type = ? AND (site_id = ? OR (? IS NULL AND site_id IS NULL))
  `).get(tenantId, serverType, siteId, siteId) as any;
  const version = (Number(versionRow?.maxVersion || 0) || 0) + 1;
  const checksum = createHash('sha256').update(`${configText}\n${envSnippet}`).digest('hex');
  const id = randomUUID();
  const createdAt = nowISO();

  db.prepare(`
    INSERT INTO deployment_profiles
    (id, tenant_id, site_id, server_type, name, profile_json, config_text, env_snippet, checksum, version, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    tenantId,
    siteId,
    serverType,
    name,
    JSON.stringify(profile),
    configText,
    envSnippet,
    checksum,
    version,
    req.user!.userId,
    createdAt
  );

  return res.json({
    success: true,
    data: {
      deploymentId: id,
      version,
      createdAt
    }
  });
});

router.get('/:id/download', (req: AuthenticatedRequest, res: Response) => {
  ensureSchema();
  const format = String(req.query.format || 'bundle');
  const row = getDatabase().prepare(`
    SELECT * FROM deployment_profiles
    WHERE id = ? AND tenant_id = ?
  `).get(req.params.id, tenantOf(req)) as any;
  if (!row) {
    return res.status(404).json({ success: false, error: 'backend.deployment_profile_not_found' });
  }

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

  const bundle = `# Config\n${row.config_text}\n\n# Env Snippet\n${row.env_snippet}\n`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="deployment-${row.id}-bundle.txt"`);
  return res.send(bundle);
});

router.get('/history/list', (req: AuthenticatedRequest, res: Response) => {
  ensureSchema();
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 200);
  const siteId = (req.query.siteId as string) || null;
  const tenantId = tenantOf(req);
  const db = getDatabase();
  let rows: any[];
  if (siteId) {
    rows = db.prepare(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = ? AND site_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, siteId, limit) as any[];
  } else {
    rows = db.prepare(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
  }

  return res.json({ success: true, data: rows });
});

export default router;
