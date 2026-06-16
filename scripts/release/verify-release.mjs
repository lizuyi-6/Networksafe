import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const workspaceRoot = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = path.join(workspaceRoot, 'artifacts', 'release', timestamp);
const stepsDir = path.join(artifactRoot, 'steps');
const dockerDir = path.join(artifactRoot, 'docker');

fs.mkdirSync(stepsDir, { recursive: true });
fs.mkdirSync(dockerDir, { recursive: true });

const stepResults = [];

const defaultEnv = {
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || 'release-verify-jwt-secret-minimum-32-chars',
  AUDIT_LOG_SECRET: process.env.AUDIT_LOG_SECRET || 'release-verify-audit-secret-minimum-32',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || 'AetherGuardRedisPassword2026!',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@aetherguard.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'AetherGuardAdminPass2026!',
  DEVICE_COMMAND_SECRET: process.env.DEVICE_COMMAND_SECRET || 'AetherGuardReleaseCommandSecret2026!',
  SERIAL_HELPER_SHARED_SECRET: process.env.SERIAL_HELPER_SHARED_SECRET || process.env.DEVICE_COMMAND_SECRET || 'AetherGuardReleaseCommandSecret2026!',
  DEPLOYMENT_BUNDLE_SIGNING_SECRET: process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET || 'AetherGuardReleaseBundleSigningSecret2026!',
  AETHERGUARD_RUNTIME_MODE: process.env.AETHERGUARD_RUNTIME_MODE || 'prod-enterprise',
  DISABLE_SQLITE_FALLBACK: process.env.DISABLE_SQLITE_FALLBACK || 'true',
  ARTIFACT_STORE: process.env.ARTIFACT_STORE || 's3',
  ENABLE_DEV_LOGIN_PRESETS: process.env.ENABLE_DEV_LOGIN_PRESETS || 'false',
  DB_MODE: process.env.DB_MODE || 'postgres',
  PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8080',
};

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeExecutable = process.execPath;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  process.stdout.write(`${message}\n`);
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

async function runStep(name, command, args, options = {}) {
  const {
    cwd = workspaceRoot,
    env = defaultEnv,
    shell = false,
  } = options;

  const logPath = path.join(stepsDir, `${String(stepResults.length + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.log`);
  const header = `# ${name}\n# cwd: ${cwd}\n# command: ${formatCommand(command, args)}\n\n`;
  fs.writeFileSync(logPath, header, 'utf8');

  log(`\n[verify:release] ${name}`);

  const child = spawn(command, args, {
    cwd,
    env,
    shell,
  });

  let output = '';
  const append = (chunk) => {
    const text = chunk.toString();
    output += text;
    fs.appendFileSync(logPath, text, 'utf8');
    process.stdout.write(text);
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  stepResults.push({ name, logPath, exitCode });

  if (exitCode !== 0) {
    throw new Error(`${name} failed. See ${logPath}`);
  }
}

async function writeCommandOutput(fileName, command, args, options = {}) {
  const { cwd = workspaceRoot, env = defaultEnv } = options;
  const outputPath = path.join(dockerDir, fileName);

  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  await new Promise((resolve) => child.on('close', resolve));
  fs.writeFileSync(outputPath, output, 'utf8');
}

async function collectDockerArtifacts() {
  await writeCommandOutput('compose-ps.jsonl', 'docker', ['compose', 'ps', '--format', 'json']);
  for (const service of ['backend', 'frontend', 'fastpath', 'redis', 'postgres', 'minio']) {
    await writeCommandOutput(`${service}.log`, 'docker', ['compose', 'logs', '--no-color', '--tail=300', service]);
  }
}

async function waitForComposeServices(services, timeoutMs = 240000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const lines = [];
    const child = spawn('docker', ['compose', 'ps', '--format', 'json'], {
      cwd: workspaceRoot,
      env: defaultEnv,
      shell: false,
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    await new Promise((resolve) => child.on('close', resolve));

    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        try {
          lines.push(JSON.parse(line));
        } catch {
          // ignore parse errors until next poll
        }
      });

    const byService = new Map(lines.map((entry) => [entry.Service, entry]));
    const allReady = services.every((service) => {
      const entry = byService.get(service);
      if (!entry) return false;
      if (service === 'minio') {
        return entry.State === 'running';
      }
      return entry.State === 'running' && entry.Health === 'healthy';
    });

    if (allReady) {
      return;
    }

    await sleep(5000);
  }

  throw new Error(`Timed out waiting for services: ${services.join(', ')}`);
}

async function checkHttp(url, label) {
  const response = await fetch(url, { redirect: 'manual' });
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}`);
  }
}

async function checkReadiness(url, label) {
  const response = await fetch(url, { redirect: 'manual' });
  const payload = await response.json().catch(() => null);
  const body = payload && typeof payload === 'object' && 'data' in payload
    ? payload.data
    : payload;
  if (!response.ok || body?.status !== 'ready') {
    throw new Error(`${label} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
}

async function runRustChecks() {
  const cargoAvailable = await new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', ['cargo'], {
      cwd: workspaceRoot,
      env: defaultEnv,
      shell: false,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  if (cargoAvailable) {
    await runStep('rust test', 'cargo', ['test'], { cwd: path.join(workspaceRoot, 'rust-fastpath') });
    await runStep('rust clippy', 'cargo', ['clippy', '--', '-D', 'warnings'], { cwd: path.join(workspaceRoot, 'rust-fastpath') });
    return;
  }

  const mountPath = `${workspaceRoot}:/workspace`;
  await runStep(
    'rust test + clippy (docker)',
    'docker',
    [
      'run',
      '--rm',
      '-v',
      mountPath,
      '-w',
      '/workspace/rust-fastpath',
      'rust:1.85-bookworm',
      'bash',
      '-lc',
      'rustup component add clippy >/dev/null && cargo test && cargo clippy -- -D warnings',
    ],
  );
}

async function main() {
  fs.writeFileSync(
    path.join(artifactRoot, 'summary.json'),
    JSON.stringify({ startedAt: new Date().toISOString(), artifactRoot }, null, 2),
    'utf8',
  );

  try {
    await runStep('backend install', npmExecutable, ['ci'], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend lint', npmExecutable, ['run', 'lint'], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend typecheck', npmExecutable, ['run', 'typecheck'], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend enterprise m1 tests', 'npx', [
      'jest',
      'src/__tests__/security/enterprise-permissions.test.ts',
      'src/__tests__/security/deployment-bundle-signing.test.ts',
      'src/__tests__/middleware/helper-auth.middleware.test.ts',
      'src/__tests__/services/deployment-run.service.test.ts',
      '--runInBand',
    ], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend tests', npmExecutable, ['run', 'test:coverage', '--', '--runInBand'], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend route db guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-route-db-access.mjs')]);

    await runStep('frontend install', npmExecutable, ['ci'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend lint', npmExecutable, ['run', 'lint'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend typecheck', npmExecutable, ['run', 'typecheck'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend build', npmExecutable, ['run', 'build'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend direct api guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-no-direct-api-fetch.mjs')]);

    await runStep('e2e install', npmExecutable, ['ci'], { cwd: path.join(workspaceRoot, 'e2e') });

    await runRustChecks();
    await runStep('fastpath docker build', 'docker', ['compose', 'build', 'fastpath']);
    await runStep(
      'docker compose up',
      'docker',
      ['compose', 'up', '-d', '--build', '--force-recreate', 'redis', 'minio', 'minio-init', 'postgres', 'fastpath', 'backend', 'frontend'],
    );

    await waitForComposeServices(['redis', 'postgres', 'minio', 'fastpath', 'backend', 'frontend']);

    await runStep('release e2e', npmExecutable, ['run', 'test:release'], {
      cwd: path.join(workspaceRoot, 'e2e'),
      env: defaultEnv,
    });

    await checkHttp('http://127.0.0.1:3005/api/health/live', 'backend liveness');
    await checkReadiness('http://127.0.0.1:3005/api/health/ready', 'backend readiness');
    await checkHttp('http://127.0.0.1:3005/api/health/dependencies', 'backend dependency health');
    await checkHttp('http://127.0.0.1:8080/', 'frontend home');
    await runStep('fastpath self-check', 'docker', ['compose', 'exec', '-T', 'fastpath', 'aetherguard-fastpath', 'self-check']);
    await collectDockerArtifacts();
    const readinessReport = {
      status: 'engineering-complete',
      runtimeMode: defaultEnv.AETHERGUARD_RUNTIME_MODE,
      productionAuthority: 'ESP32 USB-TTL serial deployer + Linux serial helper',
      websocketAuthority: 'status/OTA/experimental only',
      requiredEvidence: [
        'approval chain',
        'hardware grant',
        'helper execution log',
        'serial event log',
        'bundle checksum',
        'healthcheck result',
        'rollback notes'
      ],
      hilStatus: 'not-validated-in-ci',
      hilRequirement: '1 ESP32 gate, 1 USB-TTL serial path, 1 Linux target host running ENV -> BACKUP -> INSTALL -> REMOVE/ROLLBACK',
      generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(artifactRoot, 'enterprise-readiness-report.json'), JSON.stringify(readinessReport, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(artifactRoot, 'summary.json'),
      JSON.stringify(
        {
          status: 'passed',
          completedAt: new Date().toISOString(),
          artifactRoot,
          readinessReport: path.join(artifactRoot, 'enterprise-readiness-report.json'),
          steps: stepResults,
        },
        null,
        2,
      ),
      'utf8',
    );
    log(`\n[verify:release] passed. Artifacts: ${artifactRoot}`);
  } catch (error) {
    await collectDockerArtifacts().catch(() => undefined);
    fs.writeFileSync(
      path.join(artifactRoot, 'summary.json'),
      JSON.stringify(
        {
          status: 'failed',
          completedAt: new Date().toISOString(),
          artifactRoot,
          steps: stepResults,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
      'utf8',
    );
    log(`\n[verify:release] failed. Artifacts: ${artifactRoot}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
