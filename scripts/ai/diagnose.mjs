#!/usr/bin/env node
/**
 * AI-assistant one-shot diagnostics for the AetherGuard repo.
 *
 * Purpose: give an external AI assistant (Claude Code / OpenCode / etc.) ONE
 * command that answers "what is broken right now", with machine-readable
 * output and honest skip reporting.
 *
 * Usage (from repo root):
 *   node scripts/ai/diagnose.mjs             # fast set: guards + typecheck + lint
 *   node scripts/ai/diagnose.mjs --tests     # + backend full test shards, cargo, firmware, simulator scenarios
 *   node scripts/ai/diagnose.mjs --json      # machine-readable JSON on stdout (combinable with --tests)
 *
 * Exit code: 0 iff every non-skipped check passed. Skipped checks (missing
 * toolchain) are reported explicitly and DO NOT count as passed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const RUN_TESTS = args.has('--tests') || args.has('--full');
const AS_JSON = args.has('--json');

const TAIL_LINES = 25;

function tail(text, lines = TAIL_LINES) {
  const arr = String(text || '').trim().split(/\r?\n/);
  return arr.slice(-lines).join('\n');
}

function toolAvailable(cmd) {
  const probe = spawnSync(cmd, ['--version'], { shell: true, encoding: 'utf8' });
  return probe.status === 0;
}

function runCheck({ name, cmd, cwd, skipReason }) {
  if (skipReason) {
    return { name, cmd, cwd, status: 'skipped', exitCode: null, durationMs: 0, tail: skipReason };
  }
  const started = Date.now();
  const result = spawnSync(cmd, {
    shell: true,
    cwd: path.join(ROOT, cwd || '.'),
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024
  });
  const durationMs = Date.now() - started;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    name,
    cmd,
    cwd: cwd || '.',
    status: result.status === 0 ? 'pass' : 'fail',
    exitCode: result.status,
    durationMs,
    tail: tail(output)
  };
}

const gccMissing = toolAvailable('gcc') ? null : 'gcc not on PATH (host-side firmware tests need MSYS2/MinGW gcc)';
const cargoMissing = toolAvailable('cargo') ? null : 'cargo not on PATH (Rust toolchain required)';

const FAST_CHECKS = [
  { name: 'guard:route-db-access', cmd: 'node scripts/guards/check-route-db-access.mjs' },
  { name: 'guard:no-direct-api-fetch', cmd: 'node scripts/guards/check-no-direct-api-fetch.mjs' },
  { name: 'guard:frontend-api-contract', cmd: 'node scripts/guards/check-frontend-api-contract.mjs' },
  { name: 'guard:repository-hygiene', cmd: 'node scripts/guards/check-repository-hygiene.mjs' },
  { name: 'backend:typecheck', cmd: 'npm run typecheck', cwd: 'backend' },
  { name: 'backend:lint', cmd: 'npm run lint', cwd: 'backend' },
  { name: 'frontend:typecheck', cmd: 'npm run typecheck', cwd: 'frontend' },
  { name: 'frontend:lint', cmd: 'npm run lint', cwd: 'frontend' }
];

const TEST_CHECKS = [
  { name: 'backend:test:all', cmd: 'npm run test:all', cwd: 'backend' },
  { name: 'rust:test', cmd: 'cargo test', cwd: 'rust-fastpath', skipReason: cargoMissing },
  { name: 'rust:clippy', cmd: 'cargo clippy -- -D warnings', cwd: 'rust-fastpath', skipReason: cargoMissing },
  {
    name: 'firmware:host-tests',
    cmd: 'gcc -Wall -Wextra -std=c11 -g -Itest -ICore/Inc -ICore/Src -o test_controller test/mock_hal.c test/test_stubs.c test/test_controller.c Core/Src/controller_tasks.c Core/Src/serial_json.c Core/Src/interlock_driver.c && ./test_controller',
    cwd: 'firmware/controller-stm32h5',
    skipReason: gccMissing
  },
  { name: 'simulator:invalid-sig', cmd: 'npm run test:invalid-sig', cwd: 'simulator' },
  { name: 'simulator:counter-rollback', cmd: 'npm run test:counter-rollback', cwd: 'simulator' },
  { name: 'simulator:heartbeat-stale', cmd: 'npm run test:heartbeat-stale', cwd: 'simulator' },
  { name: 'simulator:estop', cmd: 'npm run test:estop', cwd: 'simulator' }
];

const checks = RUN_TESTS ? [...FAST_CHECKS, ...TEST_CHECKS] : FAST_CHECKS;
const results = [];

for (const check of checks) {
  if (!AS_JSON) process.stderr.write(`[diagnose] ${check.name} ...\n`);
  results.push(runCheck(check));
}

const summary = {
  pass: results.filter((r) => r.status === 'pass').length,
  fail: results.filter((r) => r.status === 'fail').length,
  skipped: results.filter((r) => r.status === 'skipped').length
};
const exitCode = summary.fail > 0 ? 1 : 0;

if (AS_JSON) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), mode: RUN_TESTS ? 'full' : 'fast', summary, exitCode, results }, null, 2));
} else {
  console.log('\n=== AetherGuard diagnostics ===');
  for (const r of results) {
    const mark = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
    console.log(`  [${mark}] ${r.name} (${r.durationMs}ms, exit=${r.exitCode})`);
    if (r.status !== 'pass') {
      console.log(r.tail.split('\n').map((l) => `        ${l}`).join('\n'));
    }
  }
  console.log(`\nSummary: ${summary.pass} pass, ${summary.fail} fail, ${summary.skipped} skipped (skipped ≠ passed)`);
  if (!existsSync(path.join(ROOT, 'backend', 'node_modules'))) {
    console.log('NOTE: backend/node_modules missing — run npm install first.');
  }
}

process.exit(exitCode);
