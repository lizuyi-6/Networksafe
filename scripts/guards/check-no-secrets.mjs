#!/usr/bin/env node
/**
 * Release guard: no high-confidence secrets in git-tracked files.
 *
 * Audit 2026-08 (DP-001) follow-up: the FTP-credential leak class was only
 * caught by manual review. This guard scans every git-tracked text file for
 * high-confidence secret SHAPES — provider key literals whose value IS the
 * secret (no recognizable key name adjacent), private-key PEM blocks, and
 * URLs with embedded credentials (the original leak shape).
 *
 * Design rules:
 *  - High-confidence patterns only. Generic `password = "..."` assignments are
 *    deliberately NOT scanned (runtime WEAK_VALUE_PATTERNS already rejects
 *    placeholders; here they would drown the signal).
 *  - Scans git-tracked files AND untracked-but-present files (the DP-001
 *    lesson: secrets usually leak from local working copies before they are
 *    ever committed; catching them pre-commit is the whole point).
 *  - Test/fixture paths are exempt: tests legitimately contain fake keys.
 *  - Known documentation example values are allowlisted by exact value.
 *  - If this fires on a REAL secret: rotate the credential first, then remove
 *    the leak from the file (and git history if it was ever pushed) — do NOT
 *    allowlist it here.
 *
 * Usage: node scripts/guards/check-no-secrets.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd());

// High-confidence secret value shapes (kept in sync with the v0.3
// deterministic_checks _SECRET_PATTERNS and the v0.2 redactor shapes).
const PATTERNS = [
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github_pat', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['gitlab_pat', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['stripe_live', /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/],
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{50,}\b/],
  ['openai_key', /\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b/],
  ['google_api', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['google_oauth', /\bya29\.[A-Za-z0-9_-]{20,}\b/i],
  ['private_key_block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  // URL userinfo credentials: scheme://user:password@host — the DP-001 leak
  // shape (ftp://user:pass@... in a deploy script). `%s`/`%d` excluded:
  // printf-style placeholders are templates, not literals.
  ['url_credentials', /[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"=%]+:[^\s/@'"=%]+@/],
];

// Path exemptions: fixtures and tests hold deliberately fake credentials.
const EXEMPT_PATH_PATTERNS = [
  /(^|\/)__tests__\//,
  /\.(test|spec)\.[a-z]+$/,
  /^backend\/test-data\//,
  /^e2e\//,
  /^ml\/data_pipeline\/tests\//,
  /^ml\/data\/lan_challenge_capture\//, // sealed capture metadata (never real provider keys)
  /^scripts\/guards\//, // the detection patterns themselves live here
  // Historical audit reports quote attacker payloads / fake keys verbatim as
  // evidence. Sealed documents (frozen 2026-08) — not live configuration.
  /^docs\/security-audit\//,
];

// Exact values that are published documentation examples, safe by construction.
const SAFE_VALUES = new Set([
  'AKIAIOSFODNN7EXAMPLE', // AWS docs access-key example
  'AKIAIOSFODNN7EXAMPLEKEY', // AWS docs secret-access-key example
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', // AWS docs secret example
]);

// Committed test-only private keys (documented: vendor README "test-only
// ECDSA material", FINDINGS.md DP-004). These are dev-loop TLS/devices keys
// that never authenticate anything production — the finding about them is a
// governance item, and rotating them out is tracked separately. Listed by
// path so any NEW private-key file still trips the guard.
const TEST_ONLY_PRIVATE_KEY_PATHS = new Set([
  'certs/localhost.key', // local dev TLS (vite.config.ts https dev server)
  'vendor-templates/networksafe-nev-vendor/contracts/test-keys/physical-confirmation-private.pem',
]);

// URL-credential matches that are docs/config placeholders, not secrets.
const SAFE_URL_CREDENTIAL_SNIPPETS = [
  'user:password@',
  'user:pass@',
  'username:password@',
  'admin:admin@',
  'admin:password@',
  'test:test@',
  'user:token@',
  'user:key@',
  'aetherguard:aetherguard@',
  'your-username',
  'your-password',
  'your_username',
  'your_password',
  '<user>',
  '<password>',
];

// Skip binary/asset extensions entirely.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svgz', '.bmp',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.pdf', '.pptx', '.docx', '.xlsx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.stl', '.obj', '.gltf', '.glb',
  '.exe', '.dll', '.bin', '.hex', '.elf', '.db', '.sqlite',
  '.mp3', '.mp4', '.wav', '.mov', '.webm',
]);

const MAX_SCAN_BYTES = 4 * 1024 * 1024;

function trackedFiles() {
  return execSync('git ls-files', { cwd: repositoryRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

// Untracked but present in the working tree (excluding gitignored build
// noise): these are the files most likely to receive a pasted credential
// before anyone commits them.
function untrackedFiles() {
  let out = '';
  try {
    out = execSync('git ls-files --others --exclude-standard', {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return out.split(/\r?\n/).filter(Boolean);
}

function isExempt(relativePath) {
  return EXEMPT_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

const violations = [];
const seen = new Set();
let scanned = 0;
let skipped = 0;

const candidates = [...trackedFiles(), ...untrackedFiles()];
for (const relativePath of candidates) {
  if (seen.has(relativePath)) continue; // tracked + untracked can overlap on rename
  seen.add(relativePath);
  if (isExempt(relativePath)) {
    skipped += 1;
    continue;
  }
  const extension = path.extname(relativePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) {
    skipped += 1;
    continue;
  }
  const absolutePath = path.join(repositoryRoot, relativePath);
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    skipped += 1;
    continue;
  }
  if (stat.size > MAX_SCAN_BYTES) {
    skipped += 1;
    continue;
  }
  let contents;
  try {
    contents = readFileSync(absolutePath, 'utf8');
  } catch {
    skipped += 1;
    continue;
  }
  scanned += 1;
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const [name, pattern] of PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const matched = match[0];
      if (SAFE_VALUES.has(matched)) continue;
      if (
        name === 'private_key_block' &&
        TEST_ONLY_PRIVATE_KEY_PATHS.has(relativePath)
      ) {
        continue;
      }
      if (
        name === 'url_credentials' &&
        (matched.includes('$') || // compose/env interpolation, not a literal
          matched.includes('change_me') || // .env.example placeholders
          SAFE_URL_CREDENTIAL_SNIPPETS.some((snippet) =>
            matched.toLowerCase().includes(snippet)
          ))
      ) {
        continue;
      }
      violations.push(
        `${relativePath}:${idx + 1}: ${name}: ${matched.slice(0, 24)}${matched.length > 24 ? '...' : ''}`
      );
    }
  });
}

if (violations.length > 0) {
  console.error('no_secrets=failed');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error('\nIf any of these is a REAL credential: rotate it first, then remove');
  console.error('the leak (and scrub git history if it was pushed). Fix the leak —');
  console.error('do not allowlist real values.');
  process.exit(1);
}

console.log(`no_secrets=passed (${scanned} files scanned, ${skipped} exempt/skipped)`);
