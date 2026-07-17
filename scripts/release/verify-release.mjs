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

const releasePostgresPassword =
  process.env.POSTGRES_PASSWORD || 'AetherGuardReleasePostgresPassword2026!';

const defaultEnv = {
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || 'release-verify-jwt-secret-minimum-32-chars',
  AUDIT_LOG_SECRET: process.env.AUDIT_LOG_SECRET || 'release-verify-audit-secret-minimum-32',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || 'AetherGuardRedisPassword2026!',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@aetherguard.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'AetherGuardAdminPass2026!',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'AetherGuardReleaseEncryptionKey2026!A1',
  ENCRYPTION_SALT: process.env.ENCRYPTION_SALT || 'AetherGuardReleaseSalt2026!',
  POSTGRES_PASSWORD: releasePostgresPassword,
  SHADOW_DATABASE_URL:
    process.env.SHADOW_DATABASE_URL ||
    `postgres://aetherguard:${releasePostgresPassword}@postgres:5432/aetherguard`,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY || 'AetherGuardReleaseS3SecretKey2026!',
  DEVICE_API_KEYS: process.env.DEVICE_API_KEYS || 'device_key_release_verify_2026_secure',
  DEVICE_COMMAND_SECRET: process.env.DEVICE_COMMAND_SECRET || 'AetherGuardReleaseDeviceCommandSecret2026!',
  SERIAL_HELPER_SHARED_SECRET: process.env.SERIAL_HELPER_SHARED_SECRET || 'AetherGuardReleaseSerialHelperSecret2026!',
  DEPLOYMENT_BUNDLE_SIGNING_SECRET: process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET || 'AetherGuardReleaseBundleSigningSecret2026!',
  AETHERGUARD_RUNTIME_MODE: process.env.AETHERGUARD_RUNTIME_MODE || 'prod-enterprise',
  // The backend's primary store is SQLite today; Postgres currently backs only the
  // audit shadow store (SHADOW_DATABASE_URL). DB_MODE stays 'postgres' so the
  // Postgres shadow path is still exercised, but the SQLite-primary store must be
  // allowed to boot via SQLITE_FALLBACK_ENABLED=true. Setting this to false would
  // trip the fail-closed guard in database.ts ("SQLite fallback is disabled.
  // Postgres connection is required.") which exists precisely because a true
  // Postgres-primary path is not yet wired.
  SQLITE_FALLBACK_ENABLED: process.env.SQLITE_FALLBACK_ENABLED || 'true',
  ARTIFACT_STORE: process.env.ARTIFACT_STORE || 's3',
  ENABLE_DEV_LOGIN_PRESETS: process.env.ENABLE_DEV_LOGIN_PRESETS || 'false',
  DB_MODE: process.env.DB_MODE || 'postgres',
  // The release e2e suite authenticates via the password login form. In
  // prod-enterprise mode password login is disabled by default, so the break-glass
  // path must be enabled for the e2e browser to reach /dashboard. This only
  // affects the CI verify stack; production operators control this independently.
  ALLOW_BREAK_GLASS_PASSWORD_LOGIN: process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN || 'true',
  // The site-walkthrough e2e toggles demo mode to exercise the demo UI paths.
  // prod-enterprise disables demo features by default; allow them explicitly here.
  ALLOW_DEMO_FEATURES: process.env.ALLOW_DEMO_FEATURES || 'true',
  PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8080',
};

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
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
    await runStep('rust release build', 'cargo', ['build', '--release'], { cwd: path.join(workspaceRoot, 'rust-fastpath') });
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

async function runFirmwareChecks() {
  const firmwareDir = path.join(workspaceRoot, 'firmware', 'controller-stm32h5');
  const binary = path.join(firmwareDir, process.platform === 'win32' ? 'test_controller.exe' : 'test_controller');
  const sources = [
    'test/mock_hal.c',
    'test/test_stubs.c',
    'test/test_controller.c',
    'Core/Src/controller_tasks.c',
    'Core/Src/serial_json.c',
    'Core/Src/interlock_driver.c',
  ];

  try {
    await runStep(
      'firmware host compile',
      'gcc',
      ['-Wall', '-Wextra', '-std=c11', '-g', '-Itest', '-ICore/Inc', '-ICore/Src', '-o', binary, ...sources],
      { cwd: firmwareDir },
    );
    await runStep('firmware host tests', binary, [], { cwd: firmwareDir });
  } finally {
    fs.rmSync(binary, { force: true });
  }
}

async function runSimulatorChecks() {
  const simulatorDir = path.join(workspaceRoot, 'simulator');
  await runStep('simulator install', npmExecutable, ['ci'], { cwd: simulatorDir });
  for (const script of ['sim', 'test:invalid-sig', 'test:counter-rollback', 'test:heartbeat-stale', 'test:estop']) {
    await runStep(`simulator ${script}`, npmExecutable, ['run', script], { cwd: simulatorDir });
  }
}

async function runRescueChecks() {
  const rescueDir = path.join(workspaceRoot, 'rescue');
  await runStep('rescue test', 'cargo', ['test'], { cwd: rescueDir });
  await runStep('rescue clippy', 'cargo', ['clippy', '--all-targets', '--', '-D', 'warnings'], { cwd: rescueDir });
  await runStep('rescue release build', 'cargo', ['build', '--release'], { cwd: rescueDir });
  await runStep('rescue fault drills', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'rescue', 'run-drills.mjs')]);
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
    await runStep('backend enterprise m1 tests', npxExecutable, [
      'jest',
      'src/__tests__/security/enterprise-permissions.test.ts',
      'src/__tests__/security/deployment-bundle-signing.test.ts',
      'src/__tests__/middleware/helper-auth.middleware.test.ts',
      'src/__tests__/services/deployment-run.service.test.ts',
      '--runInBand',
    ], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend tests', npmExecutable, ['run', 'test:all'], { cwd: path.join(workspaceRoot, 'backend') });
    await runStep('backend route db guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-route-db-access.mjs')]);

    await runStep('frontend install', npmExecutable, ['ci'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend lint', npmExecutable, ['run', 'lint'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend typecheck', npmExecutable, ['run', 'typecheck'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend i18n contracts', npmExecutable, ['run', 'test:i18n'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend build', npmExecutable, ['run', 'build'], { cwd: path.join(workspaceRoot, 'frontend') });
    await runStep('frontend direct api guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-no-direct-api-fetch.mjs')]);
    await runStep('frontend api contract guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-frontend-api-contract.mjs')]);
    await runStep('repository hygiene guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-repository-hygiene.mjs')]);
    await runStep('rescue release-capability guard', nodeExecutable, [path.join(workspaceRoot, 'scripts', 'guards', 'check-rescue-no-release.mjs')]);

    await runStep('e2e install', npmExecutable, ['ci'], { cwd: path.join(workspaceRoot, 'e2e') });

    await runRustChecks();
    await runFirmwareChecks();
    await runSimulatorChecks();
    await runRescueChecks();
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

    await checkHttp('http://127.0.0.1:3005/health/live', 'backend liveness');
    await checkReadiness('http://127.0.0.1:3005/health/ready', 'backend readiness');
    await checkHttp('http://127.0.0.1:8080/', 'frontend home');
    await runStep('fastpath self-check', 'docker', ['compose', 'exec', '-T', 'fastpath', 'aetherguard-fastpath', 'self-check']);
    await collectDockerArtifacts();
    const readinessReport = {
      status: 'software-gates-passed-hardware-hil-pending',
      runtimeMode: defaultEnv.AETHERGUARD_RUNTIME_MODE,
      productionAuthority: 'AetherGuard Root-Resistant Gateway Appliance (M1-M4)',
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
      hilRequirement: '1 Gateway Appliance with STM32 controller, secure element, physical interlock feedback, and a cabled Linux target host',
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
