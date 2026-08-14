#!/usr/bin/env node
/**
 * Build a self-contained OFFLINE (air-gapped) distribution bundle of AetherGuard.
 *
 * Run on an ONLINE build machine with Docker + Compose v2. Produces a single
 * tar.gz that a customer host installs with zero network access:
 *
 *   dist/offline/aetherguard-offline-<version>-<arch>.tar.gz
 *     ├── images/images.tar          # docker save of ALL stack images
 *     ├── docker-compose.yml         # unmodified stack definition
 *     ├── docker-compose.offline.yml # deterministic image tags (no build on site)
 *     ├── .env.example               # template; installer fills secrets offline
 *     ├── install.sh                 # deployment/offline/install-offline.sh
 *     ├── README.md                  # deployment/offline/README.md
 *     ├── manifest.json              # version, images, arch, flags
 *     ├── SHA256SUMS                 # integrity manifest (verified on site)
 *     └── docker/ (optional)         # --include-docker: static engine + compose plugin
 *
 * Usage:
 *   node scripts/release/build-offline-bundle.mjs [--version <v>] [--include-docker]
 *        [--docker-version <v>] [--compose-version <v>] [--arch x86_64|aarch64]
 *        [--skip-pull]   # don't re-pull base images (use local cache)
 *        [--keep-staging]
 *
 * Notes:
 *   - Image architecture = this build machine's Docker architecture. Building an
 *     aarch64 bundle on x86_64 requires buildx/qemu and is NOT handled here (v1).
 *   - --arch only selects which Docker STATIC BINARIES to download for the
 *     optional docker/ payload; it does not cross-build images.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const flagValue = (n, dflt) => {
  const i = args.indexOf(n);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : dflt;
};

// Pinned defaults — verified against this repo's tooling era; override via flags.
const DOCKER_STATIC_VERSION = flagValue('--docker-version', '29.4.3');
const COMPOSE_PLUGIN_VERSION = flagValue('--compose-version', '5.1.3');
const ARCH = flagValue('--arch', 'x86_64'); // for static-binary download only
const INCLUDE_DOCKER = hasFlag('--include-docker');
const SKIP_PULL = hasFlag('--skip-pull');
const KEEP_STAGING = hasFlag('--keep-staging');
// SECURITY (audit 2026-08, DP-011): optional digest pins for the downloaded
// Docker static engine / Compose plugin. Set them in CI (env or flags) so a
// MITM'd download cannot silently enter the bundle. Without a pin the build
// still prints the computed digest for operator review and records it in
// manifest.json; the customer host additionally verifies every staged file
// against the signed SHA256SUMS.
const DOCKER_STATIC_TGZ_SHA256 = flagValue('--docker-engine-sha256', process.env.DOCKER_STATIC_TGZ_SHA256 || '');
const DOCKER_COMPOSE_PLUGIN_SHA256 = flagValue('--compose-plugin-sha256', process.env.DOCKER_COMPOSE_PLUGIN_SHA256 || '');
// SECURITY (audit 2026-08, DP-010): optional detached vendor signature over
// SHA256SUMS, verified on the customer host via install.sh --verify-key.
const SIGNING_KEY = flagValue('--signing-key', process.env.AETHERGUARD_BUNDLE_SIGNING_KEY || '');

const log = (m) => console.log(`[bundle] ${m}`);
const die = (m) => {
  console.error(`[bundle] ERROR: ${m}`);
  process.exit(1);
};

function sh(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32', // docker.exe/tar.exe resolve fine, npm-style .cmd shims need shell
    env: { ...process.env, ...opts.env },
  });
  if (res.status !== 0) die(`command failed (exit ${res.status}): ${cmd} ${cmdArgs.join(' ')}`);
  return res.stdout ?? '';
}

// ─── Version stamp ────────────────────────────────────────────────────────────
let gitDesc = 'untagged';
try {
  gitDesc = execFileSync('git', ['describe', '--tags', '--always', '--dirty'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch { /* not a git checkout — fall back to untagged */ }
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const VERSION = flagValue('--version', `${today}-${gitDesc}`);
// Tag must be a valid docker tag (no '+', spaces, etc.)
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(VERSION)) die(`--version "${VERSION}" is not a valid docker image tag`);

const COMPOSE_FILES = ['-f', 'docker-compose.yml', '-f', 'docker-compose.offline.yml'];
const VERSION_ENV = { AETHERGUARD_VERSION: VERSION };

// Compose interpolation needs the `:?` guards satisfied even for build/config.
// Use throwaway values — nothing from this env ends up inside the images.
const BUILD_ENV = {
  ...VERSION_ENV,
  REDIS_PASSWORD: 'bundle-build-only',
  JWT_SECRET: 'bundle-build-only-not-a-real-secret-32ch',
  AUDIT_LOG_SECRET: 'bundle-build-only-not-a-real-secret-32ch',
  ADMIN_PASSWORD: 'bundle-build-only',
  ENCRYPTION_KEY: 'bundle-build-only-not-a-real-secret-32ch',
  ENCRYPTION_SALT: 'bundle-build-only',
  DEVICE_COMMAND_SECRET: 'bundle-build-only-not-real',
};

// ─── Staging layout ───────────────────────────────────────────────────────────
const DIST = path.join(ROOT, 'dist', 'offline');
const STAGING = path.join(DIST, `staging-${VERSION}`);
const OUT_TARBALL = path.join(DIST, `aetherguard-offline-${VERSION}-${ARCH}.tar.gz`);
rmSync(STAGING, { recursive: true, force: true });
mkdirSync(path.join(STAGING, 'images'), { recursive: true });

log(`version=${VERSION} arch=${ARCH} include-docker=${INCLUDE_DOCKER}`);

// ─── 1. Resolve the full image list from compose itself ─────────────────────
const imagesOut = sh('docker', ['compose', ...COMPOSE_FILES, 'config', '--images'], { capture: true, env: BUILD_ENV });
const IMAGES = [...new Set(imagesOut.split('\n').map((l) => l.trim()).filter(Boolean))];
if (IMAGES.length === 0) die('compose config --images returned nothing');
log(`stack images (${IMAGES.length}):\n  ${IMAGES.join('\n  ')}`);

// ─── 2. Build the three first-party images with the version tag ──────────────
log('building first-party images (backend, frontend, fastpath)...');
sh('docker', ['compose', ...COMPOSE_FILES, 'build'], { env: BUILD_ENV });

// ─── 3. Pull third-party base images ─────────────────────────────────────────
const firstParty = IMAGES.filter((i) => i.startsWith('aetherguard/'));
const thirdParty = IMAGES.filter((i) => !i.startsWith('aetherguard/'));
if (!SKIP_PULL) {
  for (const img of thirdParty) {
    log(`pull ${img}`);
    sh('docker', ['pull', img]);
  }
} else {
  log('skip-pull: assuming third-party images are in the local cache');
}

// Every image must now exist locally, else docker save fails late and unclearly.
for (const img of IMAGES) {
  const probe = spawnSync('docker', ['image', 'inspect', img], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  if (probe.status !== 0) die(`image not present locally after build/pull: ${img}`);
}

// ─── 4. docker save ───────────────────────────────────────────────────────────
const imagesTar = path.join(STAGING, 'images', 'images.tar');
log(`docker save → ${imagesTar} (this can take a while)...`);
sh('docker', ['save', '-o', imagesTar, ...IMAGES]);

// ─── 5. Copy stack + installer files ─────────────────────────────────────────
const copies = [
  ['docker-compose.yml', 'docker-compose.yml'],
  ['docker-compose.offline.yml', 'docker-compose.offline.yml'],
  ['.env.example', '.env.example'],
  [path.join('deployment', 'offline', 'install-offline.sh'), 'install.sh'],
  [path.join('deployment', 'offline', 'README.md'), 'README.md'],
];
for (const [src, dst] of copies) {
  const abs = path.join(ROOT, src);
  if (!existsSync(abs)) die(`missing bundle input: ${src}`);
  cpSync(abs, path.join(STAGING, dst));
}

// ─── 6. Optional: bundle Docker static engine + compose plugin ───────────────
let dockerPayload = null;
if (INCLUDE_DOCKER) {
  mkdirSync(path.join(STAGING, 'docker'), { recursive: true });
  const engineUrl = `https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_STATIC_VERSION}.tgz`;
  const composeArch = ARCH === 'aarch64' ? 'aarch64' : 'x86_64';
  const composeUrl = `https://github.com/docker/compose/releases/download/v${COMPOSE_PLUGIN_VERSION}/docker-compose-linux-${composeArch}`;
  const enginePath = path.join(STAGING, 'docker', `docker-${DOCKER_STATIC_VERSION}.tgz`);
  const composePath = path.join(STAGING, 'docker', 'docker-compose');
  // --speed-limit/--speed-time abort stalled transfers (then --retry re-attempts);
  // a bare curl with no timeouts can hang forever on a dead connection.
  const CURL_FLAGS = ['-fsSL', '--connect-timeout', '20', '--speed-limit', '10240', '--speed-time', '30', '--retry', '3', '--retry-delay', '2'];
  log(`downloading Docker static engine ${DOCKER_STATIC_VERSION} (${ARCH})...`);
  sh('curl', [...CURL_FLAGS, '-o', enginePath, engineUrl]);
  log(`downloading Compose plugin v${COMPOSE_PLUGIN_VERSION}...`);
  sh('curl', [...CURL_FLAGS, '-o', composePath, composeUrl]);

  // SECURITY (audit 2026-08, DP-011): verify the downloads against digest
  // pins when provided (die on mismatch); always print + record the computed
  // digests so the operator can pin them in CI afterwards.
  const digestOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const engineSha = digestOf(enginePath);
  const composeSha = digestOf(composePath);
  log(`docker engine sha256  : ${engineSha}`);
  log(`compose plugin sha256 : ${composeSha}`);
  if (DOCKER_STATIC_TGZ_SHA256) {
    if (engineSha !== DOCKER_STATIC_TGZ_SHA256.toLowerCase()) {
      die(`Docker static engine digest mismatch: got ${engineSha}, pin ${DOCKER_STATIC_TGZ_SHA256} — aborting (possible MITM/proxy tampering)`);
    }
    log('docker engine digest pin: VERIFIED');
  } else {
    log('NOTE: DOCKER_STATIC_TGZ_SHA256 pin not set — pin it in CI to make this check mandatory');
  }
  if (DOCKER_COMPOSE_PLUGIN_SHA256) {
    if (composeSha !== DOCKER_COMPOSE_PLUGIN_SHA256.toLowerCase()) {
      die(`Compose plugin digest mismatch: got ${composeSha}, pin ${DOCKER_COMPOSE_PLUGIN_SHA256} — aborting (possible MITM/proxy tampering)`);
    }
    log('compose plugin digest pin: VERIFIED');
  } else {
    log('NOTE: DOCKER_COMPOSE_PLUGIN_SHA256 pin not set — pin it in CI to make this check mandatory');
  }

  dockerPayload = {
    engine: path.basename(enginePath),
    engineVersion: DOCKER_STATIC_VERSION,
    engineSha256: engineSha,
    composePlugin: 'docker-compose',
    composeVersion: COMPOSE_PLUGIN_VERSION,
    composeSha256: composeSha,
    arch: ARCH,
  };
}

// ─── 7. Manifest ──────────────────────────────────────────────────────────────
const manifest = {
  name: 'aetherguard-offline',
  version: VERSION,
  created: new Date().toISOString(),
  buildMachineDockerArch: sh('docker', ['version', '--format', '{{.Server.Arch}}'], { capture: true }).trim(),
  images: IMAGES,
  firstPartyImages: firstParty,
  docker: dockerPayload, // null = customer host must already have Docker + Compose v2.24+
};
writeFileSync(path.join(STAGING, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// ─── 8. SHA256SUMS (relative paths, sha256sum -c compatible) ─────────────────
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const sums = [];
for (const file of walk(STAGING)) {
  const rel = path.relative(STAGING, file).split(path.sep).join('/');
  if (rel === 'SHA256SUMS') continue;
  const h = createHash('sha256').update(readFileSync(file)).digest('hex');
  sums.push(`${h}  ${rel}`);
}
writeFileSync(path.join(STAGING, 'SHA256SUMS'), `${sums.sort((a, b) => a.localeCompare(b)).join('\n')}\n`);
log(`SHA256SUMS written (${sums.length} files)`);

// SECURITY (audit 2026-08, DP-010): detached vendor signature over SHA256SUMS.
// The public key is distributed to customers out-of-band; install.sh verifies
// the signature (openssl dgst -sha256 -verify) before trusting the manifest —
// closing the "SHA256SUMS only defends transport corruption, not deliberate
// replacement" gap (previously admitted in the offline README).
if (SIGNING_KEY) {
  if (!existsSync(SIGNING_KEY)) die(`--signing-key not found: ${SIGNING_KEY}`);
  sh('openssl', ['dgst', '-sha256', '-sign', SIGNING_KEY, '-out', path.join(STAGING, 'SHA256SUMS.sig'), path.join(STAGING, 'SHA256SUMS')]);
  log('SHA256SUMS.sig written (vendor signature; verify on site with --verify-key)');
}

// ─── 9. Final tarball ─────────────────────────────────────────────────────────
log(`packing ${OUT_TARBALL} ...`);
rmSync(OUT_TARBALL, { force: true });
// Run tar from inside the staging dir with a RELATIVE output path: GNU tar
// interprets "X:\..." as a remote host (rsh syntax) on Windows drive letters.
sh('tar', ['-czf', path.join('..', path.basename(OUT_TARBALL)), '.'], { cwd: STAGING });
const sizeMb = (statSync(OUT_TARBALL).size / (1024 * 1024)).toFixed(1);
const bundleHash = createHash('sha256').update(readFileSync(OUT_TARBALL)).digest('hex');
writeFileSync(`${OUT_TARBALL}.sha256`, `${bundleHash}  ${path.basename(OUT_TARBALL)}\n`);

if (!KEEP_STAGING) rmSync(STAGING, { recursive: true, force: true });

log('');
log('════════════════════════════════════════════════════════');
log(` bundle:  ${OUT_TARBALL}`);
log(` size:    ${sizeMb} MB`);
log(` sha256:  ${bundleHash}`);
log(` images:  ${IMAGES.length} (${firstParty.length} first-party, tag ${VERSION})`);
log(` docker payload: ${dockerPayload ? `engine ${DOCKER_STATIC_VERSION} + compose ${COMPOSE_PLUGIN_VERSION} (${ARCH})` : 'NOT included (host needs Docker + Compose v2.24+)'}`);
log('════════════════════════════════════════════════════════');
log('Transfer the .tar.gz (and .sha256) to the customer host, then:');
log('  mkdir -p /opt/aetherguard && tar -xzf aetherguard-offline-*.tar.gz -C /opt/aetherguard');
log('  cd /opt/aetherguard && sudo bash install.sh');
