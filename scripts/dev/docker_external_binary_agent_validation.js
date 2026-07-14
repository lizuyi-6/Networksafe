const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractAuthCookieHeader, resolveProjectEnv } = require('./http-cookie-session');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'artifacts', 'ops', 'external-linux-binary-agent-validation');
const outputPath = path.join(rootDir, 'artifacts', 'ops', 'external-linux-binary-agent-validation.json');
const baseUrl = process.env.AETHERGUARD_BASE_URL || 'http://localhost:3005';
const email = resolveProjectEnv(rootDir, 'ADMIN_EMAIL', 'AETHERGUARD_ADMIN_EMAIL', 'dev-admin@aetherguard.local');
const password = resolveProjectEnv(rootDir, 'ADMIN_PASSWORD', 'AETHERGUARD_ADMIN_PASSWORD', 'DevAdmin!2026');
const image = process.env.AETHERGUARD_SYSTEMD_IMAGE || 'jrei/systemd-ubuntu:22.04';
const containerName = `aetherguard-binary-agent-${Date.now()}`;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs || 180000
  });

  return {
    status: result.status ?? -1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? (result.error.message || String(result.error)) : null
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    cookieHeader: extractAuthCookieHeader(response.headers)
  };
}

async function main() {
  ensureDir(outputDir);

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      host: 'docker-systemd-container',
      image,
      baseUrl
    },
    bundle: {},
    steps: {},
    summary: {
      pass: false
    }
  };

  let login;
  let deploymentId = null;

  try {
    login = await requestJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!login.ok || !login.cookieHeader.includes('accessToken=') || !login.cookieHeader.includes('refreshToken=')) {
      throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
    }

    const headers = {
      cookie: login.cookieHeader,
      'content-type': 'application/json'
    };

    const save = await requestJson(`${baseUrl}/api/deployments/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `docker-systemd-binary-agent-${Date.now()}`,
        serverType: 'binary_agent',
        profile: {
          port: 8084,
          serverName: 'agent.example.test',
          rateLimit: 160,
          upstream: 'http://backend:3005'
        }
      })
    });
    const savedPayload = save.data?.data || save.data;
    if (!save.ok || !savedPayload?.deploymentId) {
      throw new Error(`Failed to save deployment: ${JSON.stringify(save.data)}`);
    }

    deploymentId = savedPayload.deploymentId;
    report.bundle.deploymentId = deploymentId;

    const manifest = await requestJson(`${baseUrl}/api/deployments/${deploymentId}/download?format=manifest`, {
      headers: { cookie: login.cookieHeader }
    });
    const manifestPayload = manifest.data?.data || manifest.data;
    if (!manifest.ok || !Array.isArray(manifestPayload?.files)) {
      throw new Error(`Failed to fetch manifest: ${JSON.stringify(manifest.data)}`);
    }
    report.bundle.manifest = manifestPayload;

    const bundle = await fetch(`${baseUrl}/api/deployments/${deploymentId}/download`, {
      headers: { cookie: login.cookieHeader }
    });
    const bundleText = await bundle.text();
    if (!bundle.ok) {
      throw new Error(`Failed to fetch bundle: ${bundle.status} ${bundleText}`);
    }

    const bundleDir = path.join(outputDir, deploymentId);
    ensureDir(bundleDir);
    fs.writeFileSync(path.join(bundleDir, 'bundle.sh'), bundleText, 'utf8');
    for (const file of manifestPayload.files) {
      const filePath = path.join(bundleDir, ...String(file.path).split('/'));
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, String(file.content || ''), 'utf8');
    }

    report.steps.pullImage = run('docker', ['image', 'inspect', image], { timeoutMs: 30000 });
    if (report.steps.pullImage.status !== 0) {
      report.steps.pullImage = run('docker', ['pull', image], { timeoutMs: 600000 });
    }

    report.steps.startContainer = run('docker', [
      'run',
      '-d',
      '--privileged',
      '--cgroupns=host',
      '--name',
      containerName,
      '-v',
      '/sys/fs/cgroup:/sys/fs/cgroup:rw',
      image,
      '/sbin/init'
    ], { timeoutMs: 180000 });

    if (report.steps.startContainer.status !== 0) {
      throw new Error(`Failed to start systemd container: ${report.steps.startContainer.stderr || report.steps.startContainer.stdout}`);
    }

    for (let attempt = 1; attempt <= 15; attempt += 1) {
      report.steps.systemdRunning = run('docker', ['exec', containerName, 'systemctl', 'is-system-running'], { timeoutMs: 30000 });
      const state = report.steps.systemdRunning.stdout;
      if (report.steps.systemdRunning.status === 0 || state === 'degraded') {
        break;
      }
      await sleep(1000);
    }
    report.steps.copyBundle = run('docker', ['cp', bundleDir, `${containerName}:/opt/aetherguard-bundle`], { timeoutMs: 30000 });

    const execStep = (label, script) => {
      report.steps[label] = run('docker', [
        'exec',
        containerName,
        'bash',
        '-lc',
        `cd /opt/aetherguard-bundle && ${script}`
      ], { timeoutMs: 180000 });
      return report.steps[label];
    };

    execStep('install', './install.sh');
    report.steps.serviceStatusAfterInstall = run('docker', [
      'exec',
      containerName,
      'bash',
      '-lc',
      'systemctl status aetherguard-agent.service --no-pager || true'
    ], { timeoutMs: 30000 });
    execStep('healthcheck1', './healthcheck.sh');
    execStep('upgrade', './upgrade.sh');
    execStep('healthcheck2', './healthcheck.sh');
    execStep('rollback', './rollback.sh');
    execStep('healthcheck3', './healthcheck.sh');

    const orderedSteps = [
      'copyBundle',
      'install',
      'healthcheck1',
      'upgrade',
      'healthcheck2',
      'rollback',
      'healthcheck3'
    ];

    const failedStep = orderedSteps.find((step) => report.steps[step]?.status !== 0) || null;
    report.summary.pass = failedStep === null;
    report.summary.failedStep = failedStep;
    report.summary.failureReason = failedStep
      ? (failedStep === 'healthcheck1' && report.steps.serviceStatusAfterInstall?.stdout
          ? report.steps.serviceStatusAfterInstall.stdout
          : (report.steps[failedStep].stderr || report.steps[failedStep].stdout || report.steps[failedStep].error || 'unknown failure'))
      : null;
  } catch (error) {
    report.summary.pass = false;
    report.summary.failedStep = report.summary.failedStep || 'setup';
    report.summary.failureReason = error.message || String(error);
  } finally {
    report.steps.containerLogs = run('docker', ['logs', containerName], { timeoutMs: 30000 });
    report.steps.removeContainer = run('docker', ['rm', '-f', containerName], { timeoutMs: 30000 });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      outputPath,
      deploymentId,
      pass: report.summary.pass,
      failedStep: report.summary.failedStep || null,
      failureReason: report.summary.failureReason || null
    }, null, 2));
  }
}

main().catch((error) => {
  ensureDir(path.dirname(outputPath));
  const failure = {
    generatedAt: new Date().toISOString(),
    summary: {
      pass: false,
      failedStep: 'unhandled',
      failureReason: error.message || String(error)
    }
  };
  fs.writeFileSync(outputPath, JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
