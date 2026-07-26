#!/usr/bin/env node
/**
 * Release guard: the rescue control plane must have NO release capability.
 *
 * ADR: docs/adr/2026-07-08-rescue-release-policy.md
 * The rescue plane may only emit `hello` and `interlock_assert`. Any
 * occurrence of a release-frame string in rescue/src is a violation — the
 * correct fix is to remove the capability, not to allowlist it here.
 *
 * Usage: node scripts/guards/check-rescue-no-release.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RESCUE_SRC = join(process.cwd(), 'rescue', 'src');
const BANNED = ['interlock_release', 'released_ruleset', 'requestRelease', 'releaseInterlock'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.rs')) out.push(p);
  }
  return out;
}

let violations = 0;
let files = [];
try {
  files = walk(RESCUE_SRC);
} catch (err) {
  console.error(`check-rescue-no-release: cannot read ${RESCUE_SRC}: ${err.message}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error('check-rescue-no-release: no .rs files found under rescue/src — guard misconfigured');
  process.exit(1);
}
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const banned of BANNED) {
      if (line.includes(banned)) {
        console.error(`VIOLATION ${file}:${idx + 1}: contains '${banned}'`);
        violations += 1;
      }
    }
  });
}
if (violations > 0) {
  console.error(`\ncheck-rescue-no-release: ${violations} violation(s). The rescue plane must never gain release capability without the blocking ADR review (docs/adr/2026-07-08-rescue-release-policy.md).`);
  process.exit(1);
}
console.log(`check-rescue-no-release: OK (${files.length} files scanned, 0 violations)`);
