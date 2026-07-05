#!/usr/bin/env node
/**
 * AetherGuard one-shot setup — cross-platform (Windows / Linux / macOS).
 *
 * Generates the two env files a fresh clone needs, filling every placeholder
 * with a cryptographically random secret (Node crypto, no openssl required):
 *
 *   .env          → consumed by docker-compose.yml (`:?` guards) and passed
 *                   into the backend container via env_file. Must satisfy the
 *                   production hard gates in backend/src/bootstrap/runtime-env.ts
 *                   (placeholder "change_me*" values are hard-rejected there).
 *   backend/.env  → local development (`cd backend && npm run dev`).
 *                   JWT_SECRET + AUDIT_LOG_SECRET are required in ALL modes.
 *
 * Existing files are never touched unless --force is given.
 * Bash-only alternative for docker hosts without Node:
 *   deployment/production/setup-env.sh (keep its key list in sync with GENERATED_KEYS).
 *
 * Usage:
 *   node scripts/setup.mjs                 # generate missing env files + print next steps
 *   node scripts/setup.mjs --install       # also npm install backend/ frontend/
 *   node scripts/setup.mjs --all           # --install plus simulator/ e2e/
 *   node scripts/setup.mjs --force         # regenerate env files even if they exist
 *   node scripts/setup.mjs --root <dir>    # operate on another checkout (mainly for tests)
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
};

const FORCE = hasFlag('--force');
const INSTALL = hasFlag('--install') || hasFlag('--all');
const INSTALL_ALL = hasFlag('--all');
const ROOT = path.resolve(flagValue('--root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const ok = (msg) => console.log(`  [ok]   ${msg}`);
const warn = (msg) => console.log(`  [warn] ${msg}`);
const info = (msg) => console.log(`  [..]   ${msg}`);
const fail = (msg) => {
  console.error(`  [FAIL] ${msg}`);
  process.exitCode = 1;
};

const hex = (bytes) => randomBytes(bytes).toString('hex');
// Readable-but-strong admin password: 24+ chars, no shell-hostile characters.
const generateAdminPassword = () => `Ag-${randomBytes(18).toString('base64url')}`;

/** Replace `KEY=<anything>` lines in template text. Throws if a key is absent so
 *  template drift is caught instead of silently leaving a placeholder behind. */
function fillTemplate(templateText, values, templateName) {
  let out = templateText;
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (!re.test(out)) {
      throw new Error(`${templateName} has no "${key}=" line — template and setup script are out of sync`);
    }
    out = out.replace(re, `${key}=${value}`);
  }
  return out;
}

/** @returns {'written' | 'skipped' | 'error'} */
function generateEnvFile({ templatePath, targetPath, values, label }) {
  if (!existsSync(templatePath)) {
    fail(`${label}: template missing: ${templatePath}`);
    return 'error';
  }
  if (existsSync(targetPath) && !FORCE) {
    ok(`${label}: ${targetPath} already exists — left untouched (use --force to regenerate)`);
    return 'skipped';
  }
  const filled = fillTemplate(readFileSync(templatePath, 'utf8'), values, templatePath);
  writeFileSync(targetPath, filled, { mode: 0o600 });
  ok(`${label}: wrote ${targetPath}`);
  return 'written';
}

function npmInstall(dir) {
  const cwd = path.join(ROOT, dir);
  if (!existsSync(path.join(cwd, 'package.json'))) {
    warn(`skip ${dir}: no package.json`);
    return true;
  }
  info(`npm install in ${dir}/ ...`);
  const res = spawnSync('npm', ['install', '--no-fund', '--no-audit'], {
    cwd,
    stdio: 'inherit',
    shell: true, // npm is npm.cmd on Windows
  });
  if (res.status !== 0) {
    fail(`npm install failed in ${dir}/ (exit ${res.status})`);
    return false;
  }
  ok(`${dir}/ dependencies installed`);
  return true;
}

// ─── 1. Environment checks (informational, non-fatal) ────────────────────────
console.log('\nAetherGuard setup\n=================');
console.log(`repo root: ${ROOT}\n`);
console.log('Environment:');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok(`Node.js ${process.versions.node}`);
else warn(`Node.js ${process.versions.node} — backend targets Node 20+; native modules (better-sqlite3) may fail to load`);

const dockerProbe = spawnSync('docker', ['compose', 'version'], { shell: true, encoding: 'utf8' });
if (dockerProbe.status === 0) {
  ok(`docker compose available (${String(dockerProbe.stdout).trim().split('\n')[0]})`);
} else {
  warn('docker compose (v2) not found — Docker quick start unavailable; local dev still works. ' +
    'Note: docker-compose.yml uses env_file long syntax and requires Compose v2.24+ (legacy docker-compose v1 will fail).');
}

// ─── 2. Generate env files ──────────────────────────────────────────────────
console.log('\nEnv files:');

// One admin password shared by both files in a single run, printed once below.
const ADMIN_PASSWORD = generateAdminPassword();
const POSTGRES_PASSWORD = hex(16);
const DEVICE_COMMAND_SECRET = hex(32);
const SERIAL_HELPER_SHARED_SECRET = hex(32);
if (SERIAL_HELPER_SHARED_SECRET === DEVICE_COMMAND_SECRET) {
  // Practically impossible, but the runtime hard-rejects equality, so guard it.
  throw new Error('secret collision: SERIAL_HELPER_SHARED_SECRET === DEVICE_COMMAND_SECRET — rerun setup');
}

// Keep this key list in sync with deployment/production/setup-env.sh.
const GENERATED_KEYS = {
  REDIS_PASSWORD: hex(16),
  JWT_SECRET: hex(32),
  AUDIT_LOG_SECRET: hex(32),
  ENCRYPTION_KEY: hex(32),
  ENCRYPTION_SALT: hex(16),
  ADMIN_PASSWORD,
  DEVICE_COMMAND_SECRET,
  SERIAL_HELPER_SHARED_SECRET,
  POSTGRES_PASSWORD,
  SHADOW_DATABASE_URL: `postgres://aetherguard:${POSTGRES_PASSWORD}@postgres:5432/aetherguard`,
  S3_SECRET_KEY: hex(16),
  DEVICE_API_KEYS: `device_key_${hex(8)}`,
};

const rootEnvPath = path.join(ROOT, '.env');
const rootResult = generateEnvFile({
  templatePath: path.join(ROOT, '.env.example'),
  targetPath: rootEnvPath,
  values: GENERATED_KEYS,
  label: 'docker env',
});

const backendEnvPath = path.join(ROOT, 'backend', '.env');
const backendResult = generateEnvFile({
  templatePath: path.join(ROOT, 'backend', '.env.example'),
  targetPath: backendEnvPath,
  values: {
    JWT_SECRET: hex(32),
    AUDIT_LOG_SECRET: hex(32),
    REDIS_PASSWORD: hex(16),
    ADMIN_PASSWORD,
  },
  label: 'backend dev env',
});

// ─── 3. Self-check the generated files (falsifiable assertions) ─────────────
console.log('\nSelf-check:');

const checks = [
  { label: 'docker env', file: rootEnvPath, result: rootResult, placeholderRe: /change_me/ },
  { label: 'backend dev env', file: backendEnvPath, result: backendResult, placeholderRe: /your-super-secret|your-audit-log-signing-secret/ },
];
for (const { label, file, result, placeholderRe } of checks) {
  if (!existsSync(file)) continue;
  // Only inspect KEY=value lines — template comments legitimately mention "change_me".
  const valueLines = readFileSync(file, 'utf8').split('\n').filter((l) => /^[A-Za-z0-9_]+=/.test(l));
  const hasPlaceholder = valueLines.some((l) => placeholderRe.test(l));
  if (result === 'written') {
    if (hasPlaceholder) fail(`${label}: placeholder secrets remain after generation — template/script drift, do not deploy this file`);
    else ok(`${label}: no placeholder secrets remain`);
  } else if (hasPlaceholder) {
    warn(`${label}: pre-existing file still contains placeholder secrets — fill them or rerun with --force`);
  }
}

if (existsSync(rootEnvPath)) {
  const rootText = readFileSync(rootEnvPath, 'utf8');
  const pg = rootText.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1];
  const shadow = rootText.match(/^SHADOW_DATABASE_URL=(.+)$/m)?.[1];
  if (pg && shadow) {
    if (shadow.includes(`:${pg}@`)) ok('POSTGRES_PASSWORD and SHADOW_DATABASE_URL are consistent');
    else warn('POSTGRES_PASSWORD does not match the password embedded in SHADOW_DATABASE_URL — backend will fail to reach postgres');
  }
}

// ─── 4. Optional dependency install ──────────────────────────────────────────
if (INSTALL) {
  console.log('\nDependencies:');
  const dirs = INSTALL_ALL ? ['backend', 'frontend', 'simulator', 'e2e'] : ['backend', 'frontend'];
  for (const dir of dirs) {
    if (!npmInstall(dir)) break;
  }
} else {
  console.log('\nDependencies: skipped (pass --install for backend+frontend, --all to add simulator+e2e)');
}

// ─── 5. Next steps ───────────────────────────────────────────────────────────
console.log('\nNext steps:');
if (rootResult === 'written' || backendResult === 'written') {
  console.log('  Admin login (stored in the env files written this run — change after first login):');
  console.log(`    ADMIN_PASSWORD: ${ADMIN_PASSWORD}`);
  if (rootResult === 'written') console.log('    docker admin email:      admin@AetherGuard.com   (ADMIN_EMAIL in .env)');
  if (backendResult === 'written') console.log('    backend-dev admin email: admin@yourdomain.com    (ADMIN_EMAIL in backend/.env)');
}
console.log('  Docker (all services):   docker compose up -d --build');
console.log('                           frontend http://localhost:8080 · backend http://localhost:3005');
console.log('  Local dev:               cd backend  && npm install && npm run dev');
console.log('                           cd frontend && npm install && npm run dev');
console.log('  Full test suite:         cd backend && npm run test:all   (never plain `npm test` — OOM)');
console.log('');

process.exit(process.exitCode ?? 0);
