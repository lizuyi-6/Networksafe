const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createAuthCookieSession, resolveProjectEnv } = require('./http-cookie-session');

const BASE_URL = process.env.AETHERGUARD_BASE_URL || 'http://localhost:3005';
const rootDir = path.resolve(__dirname, '..', '..');
const EMAIL = resolveProjectEnv(rootDir, 'ADMIN_EMAIL', 'AETHERGUARD_ADMIN_EMAIL', 'dev-admin@aetherguard.local');
const PASSWORD = resolveProjectEnv(rootDir, 'ADMIN_PASSWORD', 'AETHERGUARD_ADMIN_PASSWORD', 'DevAdmin!2026');
const VALIDATION_ROOT = path.resolve(__dirname, '../../artifacts/ops/deployment-bundle-validation');
const DOC_REPORT_PATH = path.resolve(__dirname, '../../docs/reports/deployment-bundle-validation-2026-03-08.md');
const JSON_REPORT_PATH = path.join(VALIDATION_ROOT, 'deployment-bundle-validation.json');

const TARGETS = [
  {
    serverType: 'nginx',
    profile: {
      port: 8080,
      serverName: 'edge.example.test',
      rateLimit: 120,
      upstream: 'http://backend:3005'
    }
  },
  {
    serverType: 'apache',
    profile: {
      port: 8081,
      serverName: 'apache.example.test',
      rateLimit: 130,
      upstream: 'http://backend:3005'
    }
  },
  {
    serverType: 'caddy',
    profile: {
      port: 8082,
      serverName: 'caddy.example.test',
      rateLimit: 140,
      upstream: 'http://backend:3005'
    }
  },
  {
    serverType: 'docker_compose',
    profile: {
      port: 8083,
      serverName: 'compose.example.test',
      rateLimit: 150,
      upstream: 'http://backend:3005'
    }
  },
  {
    serverType: 'binary_agent',
    profile: {
      port: 8084,
      serverName: 'agent.example.test',
      rateLimit: 160,
      upstream: 'http://backend:3005'
    }
  },
  {
    serverType: 'k8s_daemonset',
    profile: {
      port: 8085,
      serverName: 'k8s.example.test',
      rateLimit: 170,
      upstream: 'http://backend:3005',
      namespace: 'aetherguard-smoke',
      image: 'ghcr.io/aetherguard/agent:latest',
      apiKey: 'smoke-k8s-api-key'
    }
  }
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs || 120000
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    throw new Error([
      `${command} ${args.join(' ')}`,
      stdout && `stdout:\n${stdout}`,
      stderr && `stderr:\n${stderr}`
    ].filter(Boolean).join('\n\n'));
  }

  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * attempt);
      }
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

async function requestJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${url} ${JSON.stringify(data)}`);
  }

  return data;
}

async function requestText(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${url} ${text}`);
  }
  return text;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeBundleFiles(targetDir, files, bundleText) {
  ensureDir(targetDir);

  for (const file of files) {
    const filePath = path.join(targetDir, ...String(file.path).split('/'));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, String(file.content || ''), 'utf8');
  }

  const bundlePath = path.join(targetDir, 'bundle.sh');
  fs.writeFileSync(bundlePath, bundleText, 'utf8');
  return bundlePath;
}

function validateScriptSyntax(content, label) {
  run('docker', [
    'run',
    '--rm',
    '-i',
    'ubuntu:24.04',
    'bash',
    '-lc',
    'bash -n -'
  ], {
    input: content
  });

  return {
    label,
    status: 'passed'
  };
}

function validateBundleExtractor(bundleText, requiredFiles) {
  const checks = requiredFiles
    .map((file) => `test -f "/tmp/out/${file.replace(/"/g, '\\"')}"`)
    .join('\n');

  run('docker', [
    'run',
    '--rm',
    '-i',
    'ubuntu:24.04',
    'bash',
    '-lc',
    `
set -euo pipefail
cat >/tmp/bundle.sh
bash -n /tmp/bundle.sh
chmod +x /tmp/bundle.sh
/tmp/bundle.sh /tmp/out >/tmp/bundle.log
${checks}
`
  ], {
    input: bundleText
  });

  return { status: 'passed' };
}

function validateNginx(configText) {
  const hostMatch = String(configText).match(/proxy_pass\s+https?:\/\/([^\/:;\s]+)/);
  const hostArgs = hostMatch && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostMatch[1])
    ? ['--add-host', `${hostMatch[1]}:127.0.0.1`]
    : [];

  run('docker', [
    'run',
    '--rm',
    '-i',
    ...hostArgs,
    'nginx:1.27-alpine',
    'sh',
    '-lc',
    'cat >/etc/nginx/conf.d/aetherguard.conf && nginx -t'
  ], {
    input: configText
  });

  return { status: 'passed', method: 'nginx -t' };
}

function validateApache(configText) {
  run('docker', [
    'run',
    '--rm',
    '-i',
    'httpd:2.4-alpine',
    'sh',
    '-lc',
    `
set -e
cat >/usr/local/apache2/conf/extra/aetherguard.conf
grep -q '^ServerName ' /usr/local/apache2/conf/httpd.conf || echo 'ServerName localhost' >> /usr/local/apache2/conf/httpd.conf
grep -q '^LoadModule proxy_module' /usr/local/apache2/conf/httpd.conf || echo 'LoadModule proxy_module modules/mod_proxy.so' >> /usr/local/apache2/conf/httpd.conf
grep -q '^LoadModule proxy_http_module' /usr/local/apache2/conf/httpd.conf || echo 'LoadModule proxy_http_module modules/mod_proxy_http.so' >> /usr/local/apache2/conf/httpd.conf
printf '\\nInclude conf/extra/aetherguard.conf\\n' >> /usr/local/apache2/conf/httpd.conf
/usr/local/apache2/bin/httpd -t
`
  ], {
    input: configText
  });

  return { status: 'passed', method: 'httpd -t' };
}

function validateCaddy(configText) {
  run('docker', [
    'run',
    '--rm',
    '-i',
    'caddy:2.8-alpine',
    'sh',
    '-lc',
    'cat >/etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile'
  ], {
    input: configText
  });

  return { status: 'passed', method: 'caddy validate' };
}

function validateDockerCompose(targetDir) {
  run('docker', [
    'compose',
    '--env-file',
    path.join(targetDir, '.env'),
    '-f',
    path.join(targetDir, 'docker-compose.yml'),
    'config'
  ]);

  return { status: 'passed', method: 'docker compose config' };
}

function validateK8s(configText) {
  run('docker', [
    'run',
    '--rm',
    '-i',
    'ghcr.io/yannh/kubeconform:latest',
    '-summary',
    '-strict',
    '-ignore-missing-schemas',
    '-'
  ], {
    input: configText
  });

  return { status: 'passed', method: 'kubeconform -summary -strict -ignore-missing-schemas' };
}

function ensureDockerImage(image) {
  try {
    run('docker', ['image', 'inspect', image], { timeoutMs: 30000 });
  } catch {
    run('docker', ['pull', image], { timeoutMs: 600000 });
  }
}

function validateBinaryAgentBundle(bundleText) {
  run('docker', [
    'run',
    '--rm',
    '-i',
    'ubuntu:24.04',
    'bash',
    '-lc',
    `
set -euo pipefail
cat >/tmp/bundle.sh
bash -n /tmp/bundle.sh
chmod +x /tmp/bundle.sh
/tmp/bundle.sh /work >/tmp/bundle.log
cd /work
export AETHERGUARD_INSTALL_ROOT=/tmp/root
export AETHERGUARD_BIN_DIR=/tmp/root/usr/local/bin
export AETHERGUARD_SKIP_SYSTEMCTL=1
export AETHERGUARD_HEALTHCHECK_MODE=files
./install.sh
./healthcheck.sh
./upgrade.sh
./rollback.sh
test ! -f /tmp/root/etc/aetherguard/agent.env
test ! -f /tmp/root/etc/systemd/system/aetherguard-agent.service
`
  ], {
    input: bundleText
  });

  return {
    status: 'passed',
    method: 'containerized install/healthcheck/upgrade/rollback smoke'
  };
}

function targetSpecificValidation(target, targetDir, filesByPath, bundleText) {
  switch (target) {
    case 'nginx':
      return validateNginx(filesByPath['nginx.conf']);
    case 'apache':
      return validateApache(filesByPath['apache.conf']);
    case 'caddy':
      return validateCaddy(filesByPath['Caddyfile']);
    case 'docker_compose':
      return validateDockerCompose(targetDir);
    case 'binary_agent':
      return validateBinaryAgentBundle(bundleText);
    case 'k8s_daemonset':
      return validateK8s(filesByPath['daemonset.yaml']);
    default:
      return { status: 'skipped', method: 'unsupported' };
  }
}

function buildMarkdownReport(report) {
  const lines = [
    '# Deployment Bundle Validation Report',
    '',
    `Generated At: ${report.generatedAt}`,
    `Base URL: ${report.baseUrl}`,
    `Overall Passed: ${report.overallPassed ? 'yes' : 'no'}`,
    '',
    '## Targets'
  ];

  for (const target of report.targets) {
    lines.push('');
    lines.push(`### ${target.serverType}`);
    lines.push(`- Status: ${target.status}`);
    lines.push(`- Deployment ID: ${target.deploymentId}`);
    lines.push(`- Bundle extractor: ${target.bundleExtractor.status}`);
    lines.push(`- Target validation: ${target.targetValidation.status} (${target.targetValidation.method})`);
    lines.push(`- Required files: ${target.requiredFiles.join(', ')}`);
    if (target.errors.length) {
      lines.push(`- Errors: ${target.errors.join(' | ')}`);
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `binary_agent` smoke runs in a disposable Ubuntu container with `AETHERGUARD_SKIP_SYSTEMCTL=1` and an isolated install root, so it validates bundle install/upgrade/rollback logic without claiming a real systemd host rollout.');
  lines.push('- This report validates generated bundles and config syntax. It does not claim real ESP32 hardware flashing or an external Linux host acceptance run.');

  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureDir(VALIDATION_ROOT);
  run('docker', ['version']);
  [
    'ubuntu:24.04',
    'nginx:1.27-alpine',
    'httpd:2.4-alpine',
    'caddy:2.8-alpine',
    'ghcr.io/yannh/kubeconform:latest'
  ].forEach(ensureDockerImage);

  const login = await createAuthCookieSession(BASE_URL, EMAIL, PASSWORD);

  const headers = {
    Cookie: login.cookieHeader,
    'Content-Type': 'application/json'
  };

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    overallPassed: false,
    targets: []
  };

  for (const target of TARGETS) {
    const targetDir = path.join(VALIDATION_ROOT, target.serverType);
    const requiredFiles = [
      '.env',
      'README.md',
      'install.sh',
      'upgrade.sh',
      'rollback.sh',
      'healthcheck.sh',
      'bundle-manifest.json'
    ];
    const result = {
      serverType: target.serverType,
      deploymentId: null,
      requiredFiles,
      bundleExtractor: { status: 'pending' },
      targetValidation: { status: 'pending', method: 'n/a' },
      scriptSyntax: [],
      errors: [],
      status: 'pending'
    };

    try {
      const saved = await requestJson(`${BASE_URL}/api/deployments/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: `bundle-validation-${target.serverType}`,
          serverType: target.serverType,
          profile: target.profile
        })
      });

      result.deploymentId = saved?.data?.deploymentId || null;
      if (!result.deploymentId) {
        throw new Error('Missing deploymentId from save response');
      }

      const manifest = await requestJson(`${BASE_URL}/api/deployments/${result.deploymentId}/download?format=manifest`, {
        headers: {
          Cookie: login.cookieHeader
        }
      });

      const bundleText = await requestText(`${BASE_URL}/api/deployments/${result.deploymentId}/download`, {
        headers: {
          Cookie: login.cookieHeader
        }
      });

      const files = Array.isArray(manifest?.files) ? manifest.files : [];
      const filesByPath = Object.fromEntries(files.map((file) => [String(file.path), String(file.content || '')]));
      writeBundleFiles(targetDir, files, bundleText);

      const missingFiles = requiredFiles.filter((file) => !(file in filesByPath));
      if (missingFiles.length) {
        throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
      }

      result.bundleExtractor = validateBundleExtractor(bundleText, requiredFiles);

      result.scriptSyntax = ['install.sh', 'upgrade.sh', 'rollback.sh', 'healthcheck.sh']
        .map((file) => validateScriptSyntax(filesByPath[file], file));

      result.targetValidation = targetSpecificValidation(target.serverType, targetDir, filesByPath, bundleText);
      result.status = 'passed';
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      result.status = 'failed';
    }

    report.targets.push(result);
  }

  report.overallPassed = report.targets.every((target) => target.status === 'passed');

  fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(DOC_REPORT_PATH, buildMarkdownReport(report), 'utf8');

  process.stdout.write(`${JSON_REPORT_PATH}\n${DOC_REPORT_PATH}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
