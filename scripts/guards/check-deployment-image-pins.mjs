#!/usr/bin/env node
/**
 * Release guard: deployment image references must be immutably pinned.
 *
 * Audit 2026-08 (DP-008) found floating base-image tags across compose and
 * Dockerfiles while this guard only checked MinIO. Generalized:
 *
 *  1. MinIO parity (kept from the original guard): the bare-metal installer's
 *     AG_MINIO_IMAGE must be a dated RELEASE reference AND match the canonical
 *     compose image.
 *  2. Digest-pin sweep: every `FROM` in every git-tracked Dockerfile and every
 *     `image:` in every git-tracked compose file must be digest-pinned
 *     (`@sha256:<64 hex>`), or match an explicit allowlist entry below with a
 *     documented reason. The allowlist is intentionally short — add entries
 *     only with a justification, not to make a violation go away.
 *
 * Usage: node scripts/guards/check-deployment-image-pins.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd());

// ---------------------------------------------------------------------------
// Allowlist: image references that are immutable WITHOUT a sha256 digest.
// Every entry needs a reason. Anything else must carry @sha256:<64 hex>.
// ---------------------------------------------------------------------------
const ALLOWED_WITHOUT_DIGEST = [
  {
    // MinIO does not publish conventional version tags; its dated RELEASE.*
    // tags are immutable in practice (accepted pin strategy, audit DP-008).
    test: /^minio\/(?:minio|mc):RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/,
    reason: 'MinIO dated RELEASE tags are immutable',
  },
  {
    // The offline bundle loads these from `docker save` archives produced by
    // this repo's own build; integrity is anchored in the bundle SHA256SUMS,
    // not a registry digest.
    test: /^aetherguard\//,
    reason: 'locally built/loaded namespace (offline bundle)',
  },
];

const DIGEST_SUFFIX = /@sha256:[a-f0-9]{64}$/;

function isAllowed(reference) {
  // Strip compose interpolation (${VAR} / ${VAR:-default}) before matching:
  // the pin decision is about the repository/image, not the tag value passed
  // at deploy time (offline images are loaded, not pulled).
  const stripped = reference.replace(/\$\{[^}]*\}/g, '');
  return ALLOWED_WITHOUT_DIGEST.some((entry) => entry.test.test(stripped)) || null;
}

function allowlistReason(reference) {
  const stripped = reference.replace(/\$\{[^}]*\}/g, '');
  const entry = ALLOWED_WITHOUT_DIGEST.find((e) => e.test.test(stripped));
  return entry ? entry.reason : null;
}

// ---------------------------------------------------------------------------
// Collect git-tracked Dockerfiles and compose files.
// ---------------------------------------------------------------------------
function trackedFiles() {
  return execSync('git ls-files', { cwd: repositoryRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

const isDockerfile = (rel) => {
  const base = path.basename(rel);
  return base.startsWith('Dockerfile') || base.endsWith('.Dockerfile');
};
const isCompose = (rel) => /^docker-compose.*\.ya?ml$/.test(path.basename(rel));

const violations = [];

const dockerfiles = trackedFiles().filter(isDockerfile);
const composeFiles = trackedFiles().filter(isCompose);

// ---------------------------------------------------------------------------
// Sweep 1: Dockerfile FROM lines.
// ---------------------------------------------------------------------------
for (const rel of dockerfiles) {
  const lines = readFileSync(path.join(repositoryRoot, rel), 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const match = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+\S+)?\s*$/i);
    if (!match) return;
    const reference = match[1];
    if (reference === 'scratch') return; // no base image
    if (DIGEST_SUFFIX.test(reference)) return;
    const reason = allowlistReason(reference);
    if (reason) return;
    violations.push(`${rel}:${idx + 1}: FROM ${reference} is not digest-pinned`);
  });
}

// ---------------------------------------------------------------------------
// Sweep 2: compose `image:` references.
// ---------------------------------------------------------------------------
for (const rel of composeFiles) {
  const lines = readFileSync(path.join(repositoryRoot, rel), 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const match = line.match(/^\s*image:\s*(.+?)\s*$/);
    if (!match) return;
    const reference = match[1].replace(/^["']|["']$/g, '');
    if (DIGEST_SUFFIX.test(reference)) return;
    const reason = allowlistReason(reference);
    if (reason) return;
    violations.push(`${rel}:${idx + 1}: image ${reference} is not digest-pinned`);
  });
}

// ---------------------------------------------------------------------------
// Kept from the original guard: MinIO parity between compose and bare-metal.
// ---------------------------------------------------------------------------
const composePath = path.join(repositoryRoot, 'docker-compose.yml');
const bareMetalInstallerPath = path.join(
  repositoryRoot,
  'deployment',
  'bare-metal',
  'install.sh'
);

const composeContents = readFileSync(composePath, 'utf8');
const bareMetalInstallerContents = readFileSync(bareMetalInstallerPath, 'utf8');

const mutableMinioReference = /minio\/minio:latest\b/;
const datedMinioReleaseReference = /^minio\/minio:RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:@sha256:[a-f0-9]{64})?$/;

for (const [relativePath, contents] of [
  ['docker-compose.yml', composeContents],
  ['deployment/bare-metal/install.sh', bareMetalInstallerContents],
]) {
  if (mutableMinioReference.test(contents)) {
    violations.push(`${relativePath}: deployable MinIO image must not use the mutable latest tag`);
  }
}

const composeImageMatch = composeContents.match(/^\s{4}image:\s*(minio\/minio:[^\s]+)\s*$/m);
const bareMetalImageMatch = bareMetalInstallerContents.match(/AG_MINIO_IMAGE:=(minio\/minio:[^}]+)}/);

if (!composeImageMatch) {
  violations.push('docker-compose.yml: unable to resolve the canonical MinIO server image');
}
if (!bareMetalImageMatch) {
  violations.push('deployment/bare-metal/install.sh: unable to resolve AG_MINIO_IMAGE');
}
if (composeImageMatch && !datedMinioReleaseReference.test(composeImageMatch[1])) {
  violations.push(`docker-compose.yml: MinIO image is not a dated immutable release reference: ${composeImageMatch[1]}`);
}
if (bareMetalImageMatch && !datedMinioReleaseReference.test(bareMetalImageMatch[1])) {
  violations.push(`deployment/bare-metal/install.sh: MinIO image is not a dated immutable release reference: ${bareMetalImageMatch[1]}`);
}
if (composeImageMatch && bareMetalImageMatch && composeImageMatch[1] !== bareMetalImageMatch[1]) {
  violations.push(
    `bare-metal MinIO image ${bareMetalImageMatch[1]} does not match canonical Compose image ${composeImageMatch[1]}`
  );
}

// ---------------------------------------------------------------------------
if (violations.length > 0) {
  console.error('deployment_image_pins=failed');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error('\nPin images with @sha256:<digest> (resolve via `docker manifest inspect`');
  console.error('or the registry /v2 API). Allowlist entries require a documented reason.');
  process.exit(1);
}

console.log('deployment_image_pins=passed');
console.log(`dockerfiles_scanned=${dockerfiles.length} compose_files_scanned=${composeFiles.length}`);
console.log(`minio_image=${composeImageMatch[1]}`);
