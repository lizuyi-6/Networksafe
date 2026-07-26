#!/usr/bin/env node
/**
 * Rescue control-plane fault-injection drills (PRD §12).
 *
 * Runs the REAL `ag-rescue` release binary against mock endpoints and asserts
 * concrete JSON fields (never just exit codes / HTTP 200).
 *
 * Usage:   node scripts/rescue/run-drills.mjs
 * Prereq:  cd rescue && cargo build --release
 *
 * Scenarios covered here (software-runnable):
 *   DRILL-001  primary down -> status readable, isolate still executes
 *   DRILL-008  audit log unwritable -> action refused (fail-closed)
 *   SEC-001    wrong rescue auth -> denied with reason
 *   SEC-005    appliance feedback mismatch -> isolate NOT reported confirmed
 *   SEC-005b   isolated state with negative physical feedback -> fail-closed
 *   SEC-007    truncated local log -> resync refuses (anchor breaks)
 * Architecture assertions via cargo metadata:
 *   DRILL-002/003/006/007 (no Redis/DB/AI/WebSocket dependency)
 * NOT runnable here: physical appliance / serial drills (need hardware).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'rescue', 'target', 'release', process.platform === 'win32' ? 'ag-rescue.exe' : 'ag-rescue');
if (!existsSync(BIN)) {
  console.error(`drill: binary not found at ${BIN}. Build first: cd rescue && cargo build --release`);
  process.exit(2);
}

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
}

function run(args, opts = {}) {
  // async: spawnSync would freeze the event loop and starve the mock servers.
  return new Promise((resolve) => {
    const p = spawn(BIN, args, { ...opts });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => p.kill(), 30000);
    p.on('close', (code) => {
      clearTimeout(timer);
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n').pop()); } catch { /* non-JSON output */ }
      resolve({ code, stdout, stderr, json });
    });
  });
}

/** Mock appliance: newline-JSON TCP server answering every line with a state frame. */
function mockAppliance(frame) {
  return new Promise((resolve, reject) => {
    const socketErrors = [];
    const server = createServer((socket) => {
      socket.once('error', (error) => socketErrors.push(error));
      socket.once('data', () => socket.end(JSON.stringify(frame) + '\n'));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, socketErrors }));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function freshEnv(tag, extraConfig = {}) {
  const dir = join(tmpdir(), `ag-rescue-drill-${tag}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  const prov = await run(['provision', '--data-dir', join(dir, 'data'), '--json']);
  if (prov.code !== 0) throw new Error(`provision failed: ${prov.stdout} ${prov.stderr}`);
  const configPath = join(dir, 'rescue.json');
  writeFileSync(configPath, JSON.stringify({ data_dir: join(dir, 'data'), ...extraConfig }));
  return { dir, configPath, keyPath: join(dir, 'data', 'rescue-keyring', 'rescue-auth.key') };
}

// ---------- DRILL-001: primary down, rescue still reads status and isolates ----------
{
  const isolatedFrame = { type: 'interlock_result', interlockState: 'isolated', feedbackOk: true, secureElementPresent: true };
  const { server, port, socketErrors } = await mockAppliance(isolatedFrame);
  const env = await freshEnv('d001', {
    appliance_endpoint: `127.0.0.1:${port}`,
    primary_health_url: 'http://127.0.0.1:1/health', // nothing listens: primary is DOWN
  });
  const status = await run(['status', '--json', '--config', env.configPath]);
  const okStatus = status.json?.primary?.status === 'down' && status.json?.rescue?.status === 'ready';
  record('DRILL-001a', okStatus, `primary.status=${status.json?.primary?.status} rescue.status=${status.json?.rescue?.status} (expect down/ready)`);
  const iso = await run(['isolate', '--reason', 'drill-001', '--json', '--config', env.configPath]);
  await closeServer(server);
  const okIso = iso.code === 0 && iso.json?.decision === 'allowed'
    && iso.json?.appliance?.bridge_state === 'isolated' && socketErrors.length === 0;
  record('DRILL-001b', okIso, `exit=${iso.code} decision=${iso.json?.decision} bridgeState=${iso.json?.appliance?.bridge_state} socketErrors=${socketErrors.length} (expect 0/allowed/isolated/0)`);
}

// ---------- DRILL-008: audit log unwritable -> action refused ----------
{
  const env = await freshEnv('d008');
  // Make the events path a DIRECTORY: appends must fail, actions must refuse.
  mkdirSync(join(env.dir, 'data', 'rescue-events.log'), { recursive: true });
  const iso = await run(['isolate', '--reason', 'drill-008', '--json', '--config', env.configPath]);
  const ok = iso.code === 3 && iso.json?.decision === 'denied' && String(iso.json?.reason).startsWith('audit_unwritable_action_refused');
  record('DRILL-008', ok, `exit=${iso.code} decision=${iso.json?.decision} reason=${iso.json?.reason} (expect 3/denied/audit_unwritable*)`);
}

// ---------- SEC-001: wrong rescue auth over HTTP -> denied ----------
{
  const env = await freshEnv('s001', { listen_addr: '127.0.0.1:0' }); // 0 not routable for listen; pick a port instead
  const port = 17890 + Math.floor(Math.random() * 1000);
  writeFileSync(env.configPath, JSON.stringify({ data_dir: join(env.dir, 'data'), listen_addr: `127.0.0.1:${port}` }));
  const serveProc = spawn(BIN, ['serve', '--config', env.configPath], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const ch = await fetch(`http://127.0.0.1:${port}/rescue/challenge`).then((r) => r.json());
    const bad = await fetch(`http://127.0.0.1:${port}/rescue/interlock/assert`, {
      method: 'POST',
      headers: { 'x-rescue-auth': `${ch.nonce}:${'00'.repeat(32)}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await bad.json();
    const ok = bad.status === 401 && body.decision === 'denied' && body.reason === 'auth_failed';
    record('SEC-001', ok, `http=${bad.status} decision=${body.decision} reason=${body.reason} (expect 401/denied/auth_failed)`);
  } finally {
    serveProc.kill();
  }
}

// ---------- SEC-005: appliance feedback mismatch -> not reported confirmed ----------
{
  const mismatchFrame = { type: 'interlock_result', interlockState: 'released', feedbackOk: false };
  const { server, port, socketErrors } = await mockAppliance(mismatchFrame);
  const env = await freshEnv('s005', { appliance_endpoint: `127.0.0.1:${port}` });
  const iso = await run(['isolate', '--reason', 'sec-005', '--json', '--config', env.configPath]);
  await closeServer(server);
  const ok = iso.code === 4 && iso.json?.decision === 'error'
    && iso.json?.appliance?.bridge_state !== 'isolated' && socketErrors.length === 0;
record('SEC-005', ok, `exit=${iso.code} decision=${iso.json?.decision} bridgeState=${iso.json?.appliance?.bridge_state} socketErrors=${socketErrors.length} (expect 4/error/not-isolated/0 => no fake confirmation)`);
}

// ---------- SEC-005b: isolated state without positive feedback -> fail-closed ----------
{
  const negativeFeedbackFrame = { type: 'interlock_result', interlockState: 'isolated', feedbackOk: false };
  const { server, port, socketErrors } = await mockAppliance(negativeFeedbackFrame);
  const env = await freshEnv('s005b', { appliance_endpoint: `127.0.0.1:${port}` });
  const iso = await run(['isolate', '--reason', 'sec-005b', '--json', '--config', env.configPath]);
  await closeServer(server);
  const ok = iso.code === 4 && iso.json?.decision === 'error'
    && iso.json?.appliance?.bridge_state === 'isolated'
    && iso.json?.appliance?.feedback_ok === false
    && String(iso.json?.reason).includes('feedback_ok=Some(false)')
    && socketErrors.length === 0;
  record('SEC-005b', ok, `exit=${iso.code} decision=${iso.json?.decision} bridgeState=${iso.json?.appliance?.bridge_state} feedbackOk=${iso.json?.appliance?.feedback_ok} reason=${iso.json?.reason} socketErrors=${socketErrors.length} (expect 4/error/isolated/false/reason-feedback-false/0)`);
}

// ---------- SEC-007: truncated log -> resync refuses via anchor ----------
{
  const isolatedFrame = { type: 'interlock_result', interlockState: 'isolated', feedbackOk: true, secureElementPresent: true };
  const { server, port, socketErrors } = await mockAppliance(isolatedFrame);
  const env = await freshEnv('s007', { appliance_endpoint: `127.0.0.1:${port}` });
  // Generate two audited actions (4 chain events), then truncate the log.
  await run(['isolate', '--reason', 'sec-007-a', '--json', '--config', env.configPath]);
  await run(['isolate', '--reason', 'sec-007-b', '--json', '--config', env.configPath]);
  await closeServer(server);
  const logPath = join(env.dir, 'data', 'rescue-events.log');
  const lines = readFileSync(logPath, 'utf8').trim().split('\n');
  writeFileSync(logPath, lines.slice(0, 2).join('\n') + '\n'); // drop the tail
  const rs = await run(['resync', '--json', '--config', env.configPath]);
  const ok = rs.code === 4 && rs.json?.outcome?.accepted === false && String(rs.json?.outcome?.reason).includes('anchor mismatch');
  record('SEC-007', ok, `exit=${rs.code} accepted=${rs.json?.outcome?.accepted} reason=${rs.json?.outcome?.reason} (expect 4/false/anchor mismatch)`);
  const verify = await run(['audit', 'verify', '--json', '--config', env.configPath]);
  const okV = verify.code === 4 && verify.json?.chain_valid === false && socketErrors.length === 0;
  record('SEC-007v', okV, `audit verify exit=${verify.code} chainValid=${verify.json?.chain_valid} socketErrors=${socketErrors.length} (expect 4/false/0)`);
}

// ---------- Architecture dependency assertions (real cargo metadata, no unconditional passes) ----------
{
  const metadata = spawnSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1'],
    { cwd: join(ROOT, 'rescue'), encoding: 'utf8' }
  );
  let dependencyNames = [];
  let metadataError = metadata.error?.message || metadata.stderr || '';
  if (metadata.status === 0) {
    try {
      const parsed = JSON.parse(metadata.stdout);
      const rescuePackage = parsed.packages?.find((pkg) => pkg.name === 'ag-rescue');
      dependencyNames = (rescuePackage?.dependencies || []).map((dependency) => dependency.name);
    } catch (error) {
      metadataError = error?.message || String(error);
    }
  }

  for (const [id, label, forbidden] of [
    ['DRILL-002', 'Redis', ['redis', 'fred', 'deadpool-redis', 'bb8-redis']],
    ['DRILL-003', 'database', ['rusqlite', 'sqlx', 'postgres', 'tokio-postgres', 'diesel', 'sea-orm', 'mongodb', 'rocksdb', 'sled']],
    ['DRILL-006', 'AI runtime', ['async-openai', 'openai-api-rs', 'llm', 'candle-core', 'tch', 'ort']],
    ['DRILL-007', 'WebSocket', ['tungstenite', 'tokio-tungstenite', 'websocket', 'ws']],
  ]) {
    const matches = dependencyNames.filter((name) => forbidden.includes(name));
    const ok = metadata.status === 0 && !metadataError && matches.length === 0;
    record(
      id,
      ok,
      `cargo metadata ${label} dependencies=${JSON.stringify(matches)} metadataExit=${metadata.status} error=${metadataError || 'none'} (expect []/0/none)`
    );
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} drill assertions passed`);
if (failed.length > 0) process.exit(1);
