'use strict';
// Test suite for the VIguard LAN challenge-capture remediation.
// Runner: Node's built-in test runner (no new deps), with an AJV-backed schema check that
// uses the repo-pinned backend copy of ajv (draft 2020-12). Run from the dataset dir:
//   node test/run-tests.js
// Exits non-zero on any failure.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DIR = __dirname;
const DATA = path.join(DIR, '..');
const saltPath = path.join(DATA, 'raw-private', '.id-salt');

// P0 fix: the test suite MUST NOT write a salt to the real raw-private/.id-salt. A prior version
// wrote a fixed PUBLIC synthetic salt there if the file was absent, which let a later enrich.js
// (production mode, which only checked "salt file exists") map REAL identifiers with a PUBLIC salt
// - silently bypassing the fail-closed salt design. The bypass chain was:
//   clean clone -> run tests -> tests write public fixed salt -> run enrich.js -> enrich sees a
//   salt file and maps real identifiers with a public, predictable salt.
// Instead, run the WHOLE suite in SANITIZER_TEST_MODE: sanitize.js then holds the salt IN MEMORY
// (a synthetic value, or SANITIZER_TEST_SALT if a test pins one) and NEVER touches the salt file.
// sanitize.js also FAILS CLOSED in production if raw-private/.id-salt is missing OR holds the
// known synthetic value (see SALT1/SALT2/SALT3 tests). This MUST be set before requiring
// sanitize.js, which reads SANITIZER_TEST_MODE at module load.
process.env.SANITIZER_TEST_MODE = 'true';
const S = require(path.join(DATA, 'sanitize.js'));

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }

// ---- AJV (repo-pinned, draft 2020-12) ----
let Ajv2020 = null;
for (const c of ['ajv/dist/2020', path.join(DATA, '..', '..', '..', 'backend', 'node_modules', 'ajv', 'dist', '2020.js')]) {
  if (Ajv2020) break;
  try { const m = require(c); Ajv2020 = m.default || m; } catch (e) {}
}
function schemaValidator(file) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(DATA, 'schema', file), 'utf8')));
}

function readJsonl(fp) { return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
const FILES = ['normal-traffic.jsonl', 'attack-traffic.jsonl', 'hard-negatives.jsonl', 'prompt-injection.jsonl', 'unknown-cases.jsonl'];
function allSamples() { return FILES.flatMap(f => readJsonl(path.join(DATA, f))); }

// ---------- sanitizer unit tests (1-9) ----------
test('1. sessionId value is cleaned', () => {
  const synthetic = 'aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233';
  const out = S.deepSanitize({ sessionId: synthetic });
  assert(!JSON.stringify(out).includes(synthetic), 'raw session token survived');
  assert(/\[SESSION_ID_[0-9A-F]{8}\]/.test(out.sessionId), 'sessionId not mapped to placeholder');
});

test('2. access token is cleaned', () => {
  const out = S.deepSanitize({ accessToken: 'abcsecrettoken123' });
  assertEq(out.accessToken, '[REDACTED_TOKEN]');
});

test('3. refresh token is cleaned', () => {
  const out = S.deepSanitize({ refreshToken: 'refreshsecrettoken456' });
  assertEq(out.refreshToken, '[REDACTED_TOKEN]');
});

test('4. cookie header is dropped', () => {
  const out = S.sanitizeHeaders({ Cookie: 'accessToken=xyz', 'Content-Type': 'application/json' });
  assert(!('Cookie' in out) && !('cookie' in out), 'cookie header not dropped');
  assertEq(out['Content-Type'], 'application/json');
});

test('5. authorization header is dropped', () => {
  const out = S.sanitizeHeaders({ Authorization: 'Bearer abc', Accept: '*/*' });
  assert(!('Authorization' in out) && !('authorization' in out), 'authorization header not dropped');
});

test('6. arbitrary userId is stably anonymized', () => {
  const u1 = '11112222-3333-4444-5555-666677778888';
  const u2 = '9999aaaa-bbbb-cccc-dddd-eeeeffff0000';
  const a = S.deepSanitize({ userId: u1 });
  const b = S.deepSanitize({ userId: u1 });
  const c = S.deepSanitize({ userId: u2 });
  assert(/\[USER_ID_[0-9A-F]{8}\]/.test(a.userId), 'userId not mapped');
  assertEq(a.userId, b.userId, 'same userId not stable');
  assert(a.userId !== c.userId, 'different userIds collided');
});

test('7. arbitrary tenantId is stably anonymized', () => {
  const t1 = 'abc12345-6789-4def-8abc-def012345678';
  const a = S.deepSanitize({ tenantId: t1 });
  const b = S.deepSanitize({ tenantId: t1 });
  assert(/\[TENANT_ID_[0-9A-F]{8}\]/.test(a.tenantId), 'tenantId not mapped');
  assertEq(a.tenantId, b.tenantId, 'same tenantId not stable');
});

test('8. nested object sensitive fields are cleaned', () => {
  const out = S.deepSanitize({ user: { profile: { password: 'hunter2', sessionId: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } } });
  assertEq(out.user.profile.password, '[REDACTED_PASSWORD]');
  assert(/\[SESSION_ID_/.test(out.user.profile.sessionId), 'nested sessionId not cleaned');
});

test('9. sensitive objects inside arrays are cleaned', () => {
  const out = S.deepSanitize({ items: [{ token: 't1' }, { authorization: 'Bearer x' }, { note: 'ok' }] });
  assertEq(out.items[0].token, '[REDACTED_TOKEN]');
  assert(!('authorization' in out.items[1]), 'authorization in array not dropped');
  assertEq(out.items[2].note, 'ok');
});

// ---------- benchmark leakage (10-12) ----------
const benchmark = fs.existsSync(path.join(DATA, 'model-benchmark.jsonl')) ? readJsonl(path.join(DATA, 'model-benchmark.jsonl')) : [];
const INPUT_FORBIDDEN = ['responseStatus', 'responseSanitized', 'responseHeaders', 'responseBody', 'latencyMs', 'executionEvidence', 'canaryObserved', 'exploitConfirmed', 'exploitAttempted', 'verdict', 'attackFamily', 'recommendedAction', 'contextSufficient', 'requestIntent', 'exploitOutcome', 'isHardNegative', 'groundTruth', 'labels', 'metadata', 'sampleId', 'split', 'eligibleForTraining'];
test('10. benchmark contains no response fields (top-level or in input)', () => {
  assert(benchmark.length > 0, 'benchmark empty');
  for (const b of benchmark) {
    for (const f of ['responseStatus', 'responseSanitized', 'responseHeaders', 'responseBody']) {
      assert(!(f in b), `benchmark ${b.sampleId} has ${f}`);
      assert(!(b.input && f in b.input), `benchmark ${b.sampleId}.input has ${f}`);
    }
  }
});
test('11. benchmark contains no latency (top-level or in input)', () => {
  for (const b of benchmark) {
    assert(!('latencyMs' in b), `benchmark ${b.sampleId} has latencyMs`);
    assert(!(b.input && 'latencyMs' in b.input), `benchmark ${b.sampleId}.input has latencyMs`);
  }
});
test('12. benchmark contains no executionEvidence and no label in input', () => {
  for (const b of benchmark) {
    for (const f of ['executionEvidence', 'canaryObserved', 'exploitConfirmed', 'exploitAttempted']) {
      assert(!(f in b), `benchmark ${b.sampleId} has ${f}`);
    }
    // No label/post-response field may live inside input (label leakage into model view).
    for (const f of INPUT_FORBIDDEN) {
      assert(!(b.input && f in b.input), `benchmark ${b.sampleId}.input leaks ${f}`);
    }
  }
});

// ---------- semantic / file-consistency (13-14) ----------
test('13. attack file has no benign verdict', () => {
  for (const s of readJsonl(path.join(DATA, 'attack-traffic.jsonl'))) {
    assertEq(s.groundTruth.verdict, 'attack', `${s.sampleId} in attack file not attack`);
  }
});
test('14. unknown verdict requires contextSufficient=false', () => {
  for (const s of allSamples()) {
    if (s.groundTruth.verdict === 'unknown') assertEq(s.groundTruth.contextSufficient, false, `${s.sampleId} unknown but contextSufficient!=false`);
  }
});

// ---------- fail-closed validator behavior (15-17, 19-20 via child procs) ----------
const verifyPath = path.join(DATA, 'verify.js');
// Run a specific verify.js file (by path) with a given cwd. For the clean-tree check we
// run the dataset's own verify.js; for mutation tests we run the TEMP COPY's verify.js so
// its __dirname points at the mutated files.
function runVerifyFile(verifyFile, cwd) { return spawnSync(process.execPath, [verifyFile], { cwd: cwd || DATA, encoding: 'utf8' }); }

test('20. verify.js exits 0 on the clean regenerated dataset', () => {
  const r = runVerifyFile(verifyPath, DATA);
  assertEq(r.status, 0, `verify.js should PASS on clean data; stderr=${(r.stderr || '').slice(0, 400)}`);
});

// helper: copy dataset to a temp dir, mutate, run the TEMP COPY's verify.js, expect non-zero.
// The temp copy has no reachable AJV (backend/node_modules is not under the temp root), so
// we neutralize AJV there (no-op validators) to isolate the SPECIFIC injected fault: without
// this, a temp-copy verify would fail merely because the schema validator is missing.
// If `mustContain` is given, the test additionally asserts that exact substring appears in the
// verifier output -- this proves the SPECIFIC gate fired (not some other check coincidentally
// failing), so a green mutation test actually demonstrates the invariant it claims to.
const COPY_EXCLUDES = new Set(['raw-private', 'node_modules', '.git']);
function copyDatasetTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (COPY_EXCLUDES.has(entry.name)) continue;
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDatasetTree(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

test('COPY1. mutation-test dataset copy supports nested directories and excludes private/VCS trees', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-copy-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(path.join(source, 'adjudication', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(source, 'raw-private'), { recursive: true });
  fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(source, '.git'), { recursive: true });
  fs.writeFileSync(path.join(source, 'adjudication', 'decisions', 'batch.jsonl'), '{}\n');
  fs.writeFileSync(path.join(source, 'raw-private', 'secret'), 'do-not-copy');
  fs.writeFileSync(path.join(source, 'node_modules', 'module.js'), 'do-not-copy');
  fs.writeFileSync(path.join(source, '.git', 'config'), 'do-not-copy');

  copyDatasetTree(source, destination);

  assert(fs.existsSync(path.join(destination, 'adjudication', 'decisions', 'batch.jsonl')), 'nested decision file not copied');
  assert(!fs.existsSync(path.join(destination, 'raw-private')), 'raw-private copied');
  assert(!fs.existsSync(path.join(destination, 'node_modules')), 'node_modules copied');
  assert(!fs.existsSync(path.join(destination, '.git')), '.git copied');
  fs.rmSync(root, { recursive: true, force: true });
});

test('ADJ1. context-visibility validator passes over all frozen adjudication artifacts', () => {
  const validator = path.join(DATA, 'adjudication', 'validate-context-visibility.js');
  const result = spawnSync(process.execPath, [validator], { cwd: DATA, encoding: 'utf8' });
  assertEq(result.status, 0,
    `context visibility validation failed; stdout=${(result.stdout || '').slice(0, 600)} stderr=${(result.stderr || '').slice(0, 600)}`);
  assert((result.stdout || '').includes('CONTEXT VISIBILITY VALIDATION PASSED'),
    'context visibility validator did not emit its success marker');
});

function withMutatedDataset(mutate, expectDesc, mustContain) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-verify-'));
  copyDatasetTree(DATA, tmp);
  // Neutralize AJV in the temp copy: replace the draft-2020 loader with a stub that yields
  // no-op validators, so schema validation passes trivially and only the injected fault fails.
  const vf = path.join(tmp, 'verify.js');
  let vs = fs.readFileSync(vf, 'utf8');
  vs = vs.replace(/let Ajv2020;[\s\S]*?for \(const c of candidates\) \{[\s\S]*?\n\}/,
    'let Ajv2020 = function(){ return { compile: () => (() => true) }; };');
  fs.writeFileSync(vf, vs);
  mutate(tmp);
  const r = runVerifyFile(vf, tmp);
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.status !== 0, `verify.js should FAIL (${expectDesc}) but exited 0; stdout=${(r.stdout||'').slice(0,200)} stderr=${(r.stderr||'').slice(0,300)}`);
  if (mustContain) {
    assert(out.includes(mustContain), `verify.js failed for (${expectDesc}) but output did not contain the expected gate marker "${mustContain}"; output=${out.slice(0,400)}`);
  }
}

test('15. duplicate sampleId causes verify failure', () => {
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'normal-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    lines.push(lines[0]); // duplicate first sample
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'duplicate id');
});

test('16. manifest count mismatch causes verify failure', () => {
  withMutatedDataset(tmp => {
    const mp = path.join(tmp, 'dataset-manifest.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.sampleCounts.normal = m.sampleCounts.normal + 1; // now wrong
    m.totalSamples = m.totalSamples + 1;
    fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  }, 'manifest mismatch');
});

test('17. a red-line sensitive value causes verify failure', () => {
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'attack-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const s = JSON.parse(lines[0]);
    s.responseSanitized.body = (s.responseSanitized.body || '') + ' "sessionId":"aa11bb22cc33dd44ee55ff6600112233aa11bb22cc33dd44ee55ff6600112233"';
    lines[0] = JSON.stringify(s);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'red-line sessionId');
});

test('19. all-sanitized mismatch with category files causes verify failure', () => {
  withMutatedDataset(tmp => {
    // drop a line from all-sanitized so it no longer equals the union
    const f = path.join(tmp, 'all-sanitized.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    lines.pop();
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'all-sanitized mismatch');
});

// Mutation tests proving the NEW fail-closed gates actually fire (not trivially passing).
test('19b. a malformed [[ double-bracket placeholder causes verify failure', () => {
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'normal-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const s = JSON.parse(lines[0]);
    // bodyTruncated=true so the structural-integrity gate is skipped -> isolates the
    // malformed-placeholder gate as the detector (the split('_')[0] legacy-remap bug shape).
    s.responseSanitized.bodyTruncated = true;
    s.responseSanitized.body = (s.responseSanitized.body || '') + ' [[RESOURCE_DEADBEEF]';
    lines[0] = JSON.stringify(s);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'malformed [[ placeholder', 'malformed [[');
});

test('21. a structurally-truncated JSON response body marked complete causes verify failure', () => {
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'normal-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const s = JSON.parse(lines[0]);
    // Reproduce the old-collector defect: body cut mid-string but bodyTruncated stayed false.
    s.responseSanitized.body = '{"partial":"this was cut off mid-string and is not valid JSON because';
    s.responseSanitized.bodyTruncated = false;
    s.responseSanitized.bodyOmitted = false;
    s.responseSanitized.headers = Object.assign({}, s.responseSanitized.headers, { 'content-type': 'application/json' });
    lines[0] = JSON.stringify(s);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'structurally-truncated JSON body marked complete', 'STRUCT:');
});

test('22. a review-queue entry missing input.headers causes verify failure', () => {
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'review-queue.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const r = JSON.parse(lines[0]);
    delete r.input.headers; // strip request-side evidence a reviewer needs to judge intent
    lines[0] = JSON.stringify(r);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'review-queue missing input.headers', 'RQ:');
});

// ---------- schema validity + benchmark schema (also exercises AJV path) ----------
test('schema: every evidence sample validates against evidence schema', () => {
  assert(Ajv2020, 'AJV 2020-12 unavailable');
  const v = schemaValidator('evidence-sample.schema.json');
  let bad = 0;
  for (const s of allSamples()) { if (!v(s)) bad++; }
  assertEq(bad, 0, `${bad} evidence samples failed schema (e.g. ${JSON.stringify(v.errors && v.errors[0])})`);
});
test('schema: every benchmark sample validates against benchmark schema', () => {
  const v = schemaValidator('benchmark-sample.schema.json');
  let bad = 0;
  for (const b of benchmark) { if (!v(b)) bad++; }
  assertEq(bad, 0, `${bad} benchmark samples failed schema (e.g. ${JSON.stringify(v.errors && v.errors[0])})`);
});
test('schema: manifest validates against manifest schema', () => {
  const v = schemaValidator('manifest.schema.json');
  const m = JSON.parse(fs.readFileSync(path.join(DATA, 'dataset-manifest.json'), 'utf8'));
  assert(v(m), `manifest failed schema: ${JSON.stringify(v.errors)}`);
});

// ---------- training-leak (18): dataset not eligible + guard passes on clean tree ----------
test('18. no sample is eligibleForTraining and split==external_challenge_test', () => {
  for (const s of allSamples()) {
    assertEq(s.datasetMetadata.eligibleForTraining, false, `${s.sampleId} eligibleForTraining!=false`);
    assertEq(s.datasetMetadata.split, 'external_challenge_test', `${s.sampleId} wrong split`);
  }
});
test('18b. training-leak guard exits non-zero when a challenge id enters a training manifest', () => {
  const guard = path.join(DATA, '..', '..', '..', 'scripts', 'guards', 'check-training-leak-challenge-capture.mjs');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-leak-'));
  // Build a fake repo layout: scripts/guards + ml/data/releases with a poisoned manifest
  fs.mkdirSync(path.join(tmp, 'scripts', 'guards'), { recursive: true });
  fs.copyFileSync(guard, path.join(tmp, 'scripts', 'guards', 'check-training-leak-challenge-capture.mjs'));
  fs.mkdirSync(path.join(tmp, 'ml', 'data', 'lan_challenge_capture'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ml', 'data', 'lan_challenge_capture', 'normal-traffic.jsonl'), JSON.stringify({ sampleId: 'viguard-lan-000001' }) + '\n');
  fs.mkdirSync(path.join(tmp, 'ml', 'data', 'releases'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ml', 'data', 'releases', 'train-manifest.json'), JSON.stringify({ ids: ['viguard-lan-000001'] }));
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'guards', 'check-training-leak-challenge-capture.mjs')], { cwd: tmp, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.status !== 0, 'guard should FAIL when a challenge id is in a training manifest');
});

// ---------- partial-identifier detection (§4, 8 cases) ----------
// The scanner MUST detect full AND partial (truncated) identifiers so a truncated-before-
// sanitize body cannot slip through. These use auditText on synthetic strings (no salt needed).
function hasIndicator(findings, indicator) { return findings.some(f => f.indicator === indicator); }
test('PF1. full UUID is detected as raw-uuid and sanitized to a placeholder', () => {
  const full = 'd512b525-dca9-4b8e-aa6c-2bb3b5f4e0a1';
  const f = S.auditText(full, 'synth');
  assert(hasIndicator(f, 'raw-uuid'), 'full UUID not flagged as raw-uuid');
  const san = S.sanitizeString(full);
  assert(!san.includes(full), 'full UUID survived sanitization');
  assert(/\[RESOURCE_ID_[0-9A-F]{8}\]/.test(san), 'full UUID not mapped to placeholder');
});
test('PF2. UUID missing last 1 char is detected as partial-uuid-fragment', () => {
  const partial = 'd512b525-dca9-4b8e-aa6c-2bb3b5f4e0a'; // 35 chars
  assert(partial.length === 35, 'fixture length wrong');
  const f = S.auditText(partial, 'synth');
  assert(hasIndicator(f, 'partial-uuid-fragment'), 'UUID missing 1 char not detected as partial');
});
test('PF3. UUID missing last 7 chars (the original leak) is detected as partial', () => {
  const partial = 'd512b525-dca9-4b8e-aa6c-2bb3b'; // 29 chars (original leak shape)
  const f = S.auditText(partial, 'synth');
  assert(hasIndicator(f, 'partial-uuid-fragment'), 'original 29-char leak not detected');
});
test('PF4. UUID truncated at group boundary (8-4-4, no 4th hyphen) is detected as partial', () => {
  const partial = 'd512b525-dca9-4b8e'; // 18 chars, 3 groups
  assert(partial.length === 18, 'fixture length wrong');
  const f = S.auditText(partial, 'synth');
  assert(hasIndicator(f, 'partial-uuid-fragment'), '8-4-4 truncated UUID not detected');
});
test('PF5. sessionId value truncated half is detected', () => {
  const body = '"sessionId":"aa11bb22cc33dd44ee55ff6600112233aa11bb'; // truncated mid-token
  const f = S.auditText(body, 'synth');
  assert(hasIndicator(f, 'sessionId-partial-value') || hasIndicator(f, 'sessionId-raw-value') || hasIndicator(f, 'sessionId-token'), 'truncated sessionId not detected');
});
test('PF6. JWT truncated half is detected as partial-jwt', () => {
  const partial = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0'; // 2 segments, incomplete
  const f = S.auditText(partial, 'synth');
  assert(hasIndicator(f, 'partial-jwt'), 'truncated JWT not detected');
});
test('PF7. partial UUID embedded in stringified JSON is detected', () => {
  const body = '{"source":"d512b525-dca9-4b8e-aa6c-2bb3b","ok":true}';
  const f = S.auditText(body, 'synth');
  assert(hasIndicator(f, 'partial-uuid-fragment') || hasIndicator(f, 'source-raw-id-value'), 'partial UUID in stringified JSON not detected');
});
test('PF8. body hitting limit mid-sensitive-value triggers omission (enrich processBody)', () => {
  // A body whose only problem is a BARE partial UUID (not under a sensitive key, so
  // sanitizeString does not map it) must yield a partial finding -> enrich.js omits it.
  const body = 'x'.repeat(3990) + ' trailing d512b525-dca9-4b8e-aa6c-2bb3b';
  const f = S.auditText(S.sanitizeString(body), 'synth');
  const partialFindings = f.filter(x => x.indicator === 'partial-uuid-fragment');
  assert(partialFindings.length > 0, 'mid-sensitive-value body did not yield a partial finding (omission gate would not fire)');
});

// ---------- schema rejection of label leakage (§3) ----------
test('SCHEMA-R1. benchmark schema rejects input.verdict (label in input)', () => {
  const v = schemaValidator('benchmark-sample.schema.json');
  const bad = { sampleId: 'viguard-lan-000001', input: { method: 'GET', path: '/x', headers: {}, body: null, sourceContext: { authenticated: false, targetApplication: 'AetherGuard' }, verdict: 'attack' }, labels: { verdict: 'attack', attackFamily: null, recommendedAction: 'block', contextSufficient: false, requestIntent: 'malicious_attempt', exploitOutcome: 'not_confirmed', isHardNegative: false }, metadata: { split: 'external_challenge_test', eligibleForTraining: false, humanReviewed: false, reviewerCount: 0, interAnnotatorAgreement: null, cohenKappa: null, adjudicatedSamples: 0, targetSpecific: true } };
  assert(!v(bad), 'schema accepted input.verdict (label leakage)');
});
test('SCHEMA-R2. benchmark schema rejects legacy flat structure (top-level requestIntent)', () => {
  const v = schemaValidator('benchmark-sample.schema.json');
  const flat = { sampleId: 'viguard-lan-000001', source: 'local', method: 'GET', path: '/x', headers: {}, body: null, sourceContext: { authenticated: false, targetApplication: 'AetherGuard' }, requestIntent: 'malicious_attempt', groundTruth: { verdict: 'attack', attackFamily: null, recommendedAction: 'block', contextSufficient: false }, datasetMetadata: { split: 'external_challenge_test', eligibleForTraining: false, humanReviewed: false, reviewerCount: 0, interAnnotatorAgreement: null, cohenKappa: null, adjudicatedSamples: 0, targetSpecific: true } };
  assert(!v(flat), 'schema accepted legacy flat benchmark structure');
});
test('SCHEMA-R3. model-input schema rejects a record carrying labels', () => {
  const v = schemaValidator('model-input-sample.schema.json');
  const bad = { sampleId: 'viguard-lan-000001', input: { method: 'GET', path: '/x', headers: {}, body: null, sourceContext: { authenticated: false, targetApplication: 'AetherGuard' }, requestIntent: 'malicious_attempt' } };
  assert(!v(bad), 'model-input schema accepted requestIntent inside input');
});

// ---------- whitelist prompt builder + label sentinels (§3) ----------
const builder = require(path.join(DATA, 'build-model-input.js'));
const LABEL_SENTINEL_REQUEST_INTENT = '__LABEL_SENTINEL_REQUEST_INTENT_malicious_attempt__';
const LABEL_SENTINEL_VERDICT = '__LABEL_SENTINEL_VERDICT_attack__';
const LABEL_SENTINEL_ACTION = '__LABEL_SENTINEL_ACTION_block__';
const LABEL_SENTINEL_METADATA = '__LABEL_SENTINEL_METADATA_eligibleForTraining__';
function synthBenchmark() {
  return {
    sampleId: 'viguard-lan-000001',
    input: { method: 'POST', path: '/api/x', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}', sourceContext: { authenticated: true, targetApplication: 'AetherGuard' } },
    labels: { verdict: LABEL_SENTINEL_VERDICT, attackFamily: 'sqli', recommendedAction: LABEL_SENTINEL_ACTION, contextSufficient: false, requestIntent: LABEL_SENTINEL_REQUEST_INTENT, exploitOutcome: 'not_confirmed', isHardNegative: false },
    metadata: { split: 'external_challenge_test', eligibleForTraining: false, humanReviewed: false, reviewerCount: 0, interAnnotatorAgreement: null, cohenKappa: null, adjudicatedSamples: 0, targetSpecific: true },
  };
}
test('WB1. buildPrompt does not leak labels/metadata/sampleId/requestIntent/groundTruth', () => {
  const { prompt } = builder.buildPrompt(synthBenchmark());
  for (const sentinel of [LABEL_SENTINEL_REQUEST_INTENT, LABEL_SENTINEL_VERDICT, LABEL_SENTINEL_ACTION, LABEL_SENTINEL_METADATA]) {
    assert(!prompt.includes(sentinel), `prompt leaked sentinel: ${sentinel}`);
  }
  assert(!prompt.includes('viguard-lan-000001'), 'prompt leaked sampleId');
  assert(!prompt.includes('groundTruth'), 'prompt leaked groundTruth key');
  assert(!prompt.includes('eligibleForTraining'), 'prompt leaked metadata key');
});
test('WB2. buildPrompt does not include responseStatus/latencyMs/executionEvidence in input', () => {
  const rec = synthBenchmark();
  for (const f of ['responseStatus', 'latencyMs', 'executionEvidence', 'responseSanitized', 'canaryObserved', 'exploitConfirmed']) {
    assert(!(f in rec.input), `synth input should not have ${f}`);
  }
  const { prompt } = builder.buildPrompt(rec);
  assert(!/responseStatus|latencyMs|executionEvidence/.test(prompt), 'prompt contains response-time field');
});
test('WB3. buildPrompt fails closed when input contains a label field', () => {
  const bad = synthBenchmark();
  bad.input.verdict = 'attack'; // label leaked into input
  let threw = false;
  try { builder.buildPrompt(bad); } catch (e) { threw = true; }
  assert(threw, 'builder did not fail closed on input.verdict');
});
test('WB4. buildPrompt does not serialize extra/unknown input fields', () => {
  const rec = synthBenchmark();
  rec.input.sneakyBackdoor = 'LEAKED_THROUGH_SPREAD';
  const { prompt } = builder.buildPrompt(rec);
  assert(!prompt.includes('LEAKED_THROUGH_SPREAD'), 'builder serialized an unknown input field (spread leak)');
});

// ---------- ID-mapping unification (§4) ----------
test('IDMAP1. all internal-id placeholders in committed data use unified 8-hex HMAC format', () => {
  const files = FILES.map(f => path.join(DATA, f)).concat([path.join(DATA, 'all-sanitized.jsonl'), path.join(DATA, 'model-benchmark.jsonl')]);
  let legacy = 0, hmac = 0;
  for (const fp of files) {
    if (!fs.existsSync(fp)) continue;
    const txt = fs.readFileSync(fp, 'utf8');
    legacy += (txt.match(/\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9]{4}\]/g) || []).length;
    hmac += (txt.match(/\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9A-F]{8}\]/g) || []).length;
  }
  assertEq(legacy, 0, 'residual legacy sequential placeholders found (format not unified)');
  assert(hmac > 0, 'no HMAC placeholders found (mapping produced nothing)');
});
test('IDMAP2. verifier reports residualLegacySequential=0 and legacyPlaceholderRemapped=true', () => {
  const rep = JSON.parse(fs.readFileSync(path.join(DATA, 'verification-report.json'), 'utf8'));
  assertEq(rep.idMapping.residualLegacySequential, 0, 'residualLegacySequential != 0');
  assertEq(rep.idMapping.legacyPlaceholderRemapped, true, 'legacyPlaceholderRemapped != true (migration not recorded)');
});
test('IDMAP3. no malformed [[ double-bracket placeholders in committed data', () => {
  // The prior buggy legacy-remap used match.split('_')[0], producing [[RESOURCE_727DAE3A]
  // instead of [RESOURCE_ID_727DAE3A]. scanFinalStats only scans the CORRECT format, so this
  // gate (mirrored in verify.js) is what catches the corruption rather than reporting a false zero.
  const files = FILES.map(f => path.join(DATA, f)).concat([path.join(DATA, 'all-sanitized.jsonl'), path.join(DATA, 'model-benchmark.jsonl'), path.join(DATA, 'model-inputs.jsonl'), path.join(DATA, 'model-labels.jsonl'), path.join(DATA, 'review-queue.jsonl')]);
  let malformed = 0;
  for (const fp of files) {
    if (!fs.existsSync(fp)) continue;
    const txt = fs.readFileSync(fp, 'utf8');
    malformed += (txt.match(/\[\[(?:RESOURCE|SESSION|USER|TENANT)_[0-9A-Fa-f]{4,8}\]?\]/g) || []).length;
  }
  assertEq(malformed, 0, `${malformed} malformed [[ double-bracket placeholders (legacy-remap normalization incomplete)`);
});

// ---------- structural integrity (SI) ----------
test('SI1. every JSON-shaped response body marked complete parses as JSON', () => {
  // Catches old-collector structural truncation mislabeled as complete (body cut to ~4000 chars
  // mid-string before sanitization broke JSON.parse, but bodyTruncated stayed false).
  let bad = 0;
  for (const s of allSamples()) {
    const rs = s.responseSanitized;
    if (!rs || rs.bodyOmitted === true || rs.bodyTruncated === true || rs.body == null) continue;
    const ct = (rs.headers && (rs.headers['content-type'] || rs.headers['Content-Type'])) || '';
    if (/json/i.test(ct) || /^\s*[\[{]/.test(String(rs.body))) {
      try { JSON.parse(rs.body); } catch (e) { bad++; }
    }
  }
  assertEq(bad, 0, `${bad} JSON-shaped response bodies marked complete failed to parse (structurally truncated)`);
});

// ---------- review-queue structural completeness (RQ) ----------
test('RQ1. every review-queue entry carries full request input (method/path/headers)', () => {
  const lines = readJsonl(path.join(DATA, 'review-queue.jsonl'));
  assert(lines.length > 0, 'review-queue.jsonl empty');
  let missing = 0;
  for (const r of lines) {
    if (!r.input || typeof r.input !== 'object' || !r.input.method || !r.input.path || r.input.headers == null || typeof r.input.headers !== 'object') missing++;
  }
  assertEq(missing, 0, `${missing} review-queue entries missing request-side input (method/path/headers)`);
});
test('RQ2. review-queue sampleId set matches the evidence union', () => {
  const rqIds = readJsonl(path.join(DATA, 'review-queue.jsonl')).map(r => r.sampleId).sort();
  const evIds = allSamples().map(s => s.sampleId).sort();
  assertEq(JSON.stringify(rqIds), JSON.stringify(evIds), 'review-queue sampleId set != evidence sampleId set');
});
test('RQ3. review-queue input withholds collector category + outcome/label fields', () => {
  const lines = readJsonl(path.join(DATA, 'review-queue.jsonl'));
  const OUTCOME = ['category', 'labels', 'responseStatus', 'responseBody', 'executionEvidence', 'groundTruth', 'verdict', 'sampleId', 'split', 'eligibleForTraining'];
  let leaks = 0;
  for (const r of lines) {
    if (!r.input) continue;
    for (const f of OUTCOME) if (f in r.input) leaks++;
  }
  assertEq(leaks, 0, `${leaks} review-queue entries leak an outcome/category/label field into input`);
});
test('RQ4. prompt-injection probes 330-337 carry a distinguishing X-Note request header', () => {
  // Samples 330-337 share method+path (GET /api/auth/me); the X-Note header is what lets a
  // reviewer distinguish them. It must survive de-labeling (the prior queue had only method+path).
  const lines = readJsonl(path.join(DATA, 'review-queue.jsonl'));
  const pi = lines.filter(r => /^viguard-lan-00033[0-7]$/.test(r.sampleId));
  assert(pi.length === 8, `expected 8 prompt-injection 330-337 entries, found ${pi.length}`);
  let noNote = 0;
  for (const r of pi) {
    const h = (r.input && r.input.headers) || {};
    if (!Object.keys(h).some(k => /note/i.test(k))) noNote++;
  }
  assertEq(noNote, 0, `${noNote}/8 prompt-injection 330-337 review-queue entries lack a *-Note header (indistinguishable to reviewer)`);
});

// ---------- model-inputs / model-labels schema + alignment (§3) ----------
test('ML1. every model-input sample validates against model-input schema', () => {
  const v = schemaValidator('model-input-sample.schema.json');
  const lines = readJsonl(path.join(DATA, 'model-inputs.jsonl'));
  assert(lines.length > 0, 'model-inputs.jsonl empty');
  let bad = 0;
  for (const mi of lines) { if (!v(mi)) bad++; }
  assertEq(bad, 0, `${bad} model-input samples failed schema`);
});
test('ML2. every model-label sample validates against model-label schema', () => {
  const v = schemaValidator('model-label-sample.schema.json');
  const lines = readJsonl(path.join(DATA, 'model-labels.jsonl'));
  assert(lines.length > 0, 'model-labels.jsonl empty');
  let bad = 0;
  for (const ml of lines) { if (!v(ml)) bad++; }
  assertEq(bad, 0, `${bad} model-label samples failed schema`);
});
test('ML3. model-inputs / model-labels / benchmark sampleId sets are identical', () => {
  const ids = fp => readJsonl(path.join(DATA, fp)).map(x => x.sampleId).sort();
  const bi = ids('model-benchmark.jsonl');
  const ii = ids('model-inputs.jsonl');
  const li = ids('model-labels.jsonl');
  assertEq(JSON.stringify(ii), JSON.stringify(bi), 'model-inputs ids != benchmark ids');
  assertEq(JSON.stringify(li), JSON.stringify(bi), 'model-labels ids != benchmark ids');
});
test('ML4. build-model-input.js runs clean over the committed benchmark (0 violations)', () => {
  const r = spawnSync(process.execPath, [path.join(DATA, 'build-model-input.js')], { cwd: DATA, encoding: 'utf8' });
  assertEq(r.status, 0, `build-model-input.js failed: stderr=${(r.stderr || '').slice(0, 300)}`);
});

// ---------- enrich processBody idempotency (§1/§2) ----------
// processBody must PRESERVE a previously-omitted body's reason + byte fields across re-runs
// instead of reclassifying the reason and zeroing preOmissionRetainedBytes/originalBodyBytes
// (the prior non-idempotent bug). Requiring enrich.js as a module does NOT run main() (main is
// guarded by require.main===module) and does NOT need the salt.
const enrichMod = require(path.join(DATA, 'enrich.js'));

test('IDEM1. processBody preserves a structural omission (orig 12191 / pre 3832) across re-runs', () => {
  const prev = { bodyTruncated: true, bodyOmitted: true, bodyOmittedReason: 'legacy_capture_structurally_truncated',
    capturedContentLengthHeader: 12191, preOmissionRetainedBytes: 3832, originalBodyBytes: 12191, retainedBodyBytes: 0 };
  const out = enrichMod.processBody(null, prev, 12191, true);
  assertEq(out.body, null, 'structural omission body should stay null');
  assertEq(out.bodyOmitted, true, 'bodyOmitted not preserved');
  assertEq(out.bodyOmittedReason, 'legacy_capture_structurally_truncated', 'reason reclassified (idempotency broken)');
  assertEq(out.preOmissionRetainedBytes, 3832, 'preOmissionRetainedBytes zeroed on re-run (the bug)');
  assertEq(out.originalBodyBytes, 12191, 'originalBodyBytes zeroed on re-run (the bug)');
  assertEq(out.retainedBodyBytes, 0, 'retainedBodyBytes must be 0 for an omitted body');
  assertEq(out.capturedContentLengthHeader, 12191, 'capturedContentLengthHeader not preserved');
});

test('IDEM2. processBody preserves a partial-fragment omission (orig 31676 / pre 4000) across re-runs', () => {
  const prev = { bodyTruncated: true, bodyOmitted: true, bodyOmittedReason: 'legacy_capture_truncated_before_complete_sanitization',
    capturedContentLengthHeader: 31676, preOmissionRetainedBytes: 4000, originalBodyBytes: 31676, retainedBodyBytes: 0 };
  const out = enrichMod.processBody(null, prev, 31676, true);
  assertEq(out.body, null, 'partial-fragment omission body should stay null');
  assertEq(out.bodyOmittedReason, 'legacy_capture_truncated_before_complete_sanitization', 'reason reclassified');
  assertEq(out.preOmissionRetainedBytes, 4000, 'preOmissionRetainedBytes zeroed on re-run (the bug)');
  assertEq(out.originalBodyBytes, 31676, 'originalBodyBytes zeroed on re-run (the bug)');
  assertEq(out.retainedBodyBytes, 0, 'retainedBodyBytes must be 0');
  assertEq(out.capturedContentLengthHeader, 31676, 'capturedContentLengthHeader not preserved');
});

test('IDEM2b. processBody falls back to legacy_capture_omitted_reason_unknown when prior reason is missing', () => {
  const prev = { bodyTruncated: true, bodyOmitted: true, bodyOmittedReason: null,
    capturedContentLengthHeader: 100, preOmissionRetainedBytes: 50, originalBodyBytes: 100, retainedBodyBytes: 0 };
  const out = enrichMod.processBody(null, prev, 100, true);
  assertEq(out.bodyOmittedReason, 'legacy_capture_omitted_reason_unknown', 'missing reason should fall back to unknown, not be invented/guessed');
  assertEq(out.preOmissionRetainedBytes, 50, 'byte fields should still be preserved even when prior reason was missing');
});

test('IDEM2c. processBody never downgrades an explicit reason to legacy_capture_omitted_reason_unknown', () => {
  for (const reason of ['legacy_capture_truncated_before_complete_sanitization', 'legacy_capture_structurally_truncated']) {
    const prev = { bodyTruncated: true, bodyOmitted: true, bodyOmittedReason: reason,
      capturedContentLengthHeader: 200, preOmissionRetainedBytes: 100, originalBodyBytes: 200, retainedBodyBytes: 0 };
    const out = enrichMod.processBody(null, prev, 200, true);
    assertEq(out.bodyOmittedReason, reason, `explicit reason ${reason} downgraded to unknown`);
  }
});

// ---------- full-pipeline idempotency (§2 Tests 3+4) ----------
// Run enrich+finalize+verify N times on a FIXED-salt temp copy and assert the 13 committed
// output files are byte-stable after stripping the only legitimately-non-deterministic fields
// (regeneratedAt/verifiedAt/auditedAt/generatedAt/environment.timestamp). Proves re-running
// the pipeline never reclassifies an omission reason or zeros byte fields on already-omitted bodies.
const TS_KEYS = new Set(['regeneratedAt', 'verifiedAt', 'auditedAt', 'generatedAt']);
function stripTs(value) {
  if (Array.isArray(value)) return value.map(stripTs);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (TS_KEYS.has(k)) continue;
      if (k === 'environment' && typeof value[k] === 'object' && value[k]) {
        const env = {};
        for (const ek of Object.keys(value[k]).sort()) { if (ek === 'timestamp') continue; env[ek] = stripTs(value[k][ek]); }
        out[k] = env; continue;
      }
      out[k] = stripTs(value[k]);
    }
    return out;
  }
  return value;
}
function normalizeFile(fp) {
  const txt = fs.readFileSync(fp, 'utf8');
  if (fp.endsWith('.jsonl')) return txt.split('\n').filter(Boolean).map(l => JSON.stringify(stripTs(JSON.parse(l)))).join('\n');
  return JSON.stringify(stripTs(JSON.parse(txt)));
}
const PIPELINE_FILES = ['normal-traffic.jsonl','attack-traffic.jsonl','hard-negatives.jsonl','prompt-injection.jsonl','unknown-cases.jsonl','all-sanitized.jsonl','model-benchmark.jsonl','model-inputs.jsonl','model-labels.jsonl','review-queue.jsonl','dataset-manifest.json','verification-report.json','privacy-audit-report.json'];
function hashPipeline(dir) {
  const h = require('crypto').createHash('sha256');
  for (const f of PIPELINE_FILES) h.update(f + '\x00' + normalizeFile(path.join(dir, f)) + '\x00');
  return h.digest('hex').slice(0, 16);
}
function copyForPipeline(srcDir) {
  srcDir = srcDir || DATA;
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-idem-'));
  // Full recursive copy INCLUDING node_modules (verify.js needs the repo-pinned ajv, which the
  // temp-copy verify.js resolves via __dirname/node_modules). raw-private is EXCLUDED AT THE
  // SOURCE via cpSync's filter (not copy-then-delete): a cpSync followed by rmSync would briefly
  // materialize the operator's real salt/creds/cookies in /tmp, and a crash between the two calls
  // could leave them there. The filter rejects raw-private before any byte is written, so the
  // operator's secrets never reach the temp dir. SENTINEL1 proves this by planting a sentinel and
  // asserting it NEVER appears in tmp (not merely that it was deleted afterward). srcDir is
  // parameterized so SENTINEL1 can run copyForPipeline on a fake dataset with a planted sentinel.
  const rawPrivate = path.resolve(srcDir, 'raw-private');
  fs.cpSync(srcDir, tmp, {
    recursive: true,
    filter(src) {
      const r = path.resolve(src);
      return r !== rawPrivate && !r.startsWith(rawPrivate + path.sep);
    },
  });
  // Write the .synthetic-regeneration-fixture marker. enrich.js refuseTestModeInRealDir requires
  // BOTH under-tmpdir AND this marker to allow SANITIZER_TEST_MODE, so a real repo cloned under /tmp
  // (under tmpdir but no marker) is still refused. Fixed content (no timestamp/random) so it is
  // deterministic; it is NOT in PIPELINE_FILES so it does not perturb the idempotency hash.
  fs.writeFileSync(path.join(tmp, '.synthetic-regeneration-fixture'),
    'synthetic-regeneration-fixture\nThis temp copy was created by copyForPipeline for in-memory synthetic-salt test runs only.\n');
  return tmp;
}
function runPipelineOnce(dir) {
  const opts = { cwd: dir, encoding: 'utf8' };
  const e = spawnSync(process.execPath, [path.join(dir, 'enrich.js')], opts);
  if (e.status !== 0) throw new Error('enrich failed: ' + (e.stderr || '').slice(0, 300));
  const f = spawnSync(process.execPath, [path.join(dir, 'finalize.js')], opts);
  if (f.status !== 0) throw new Error('finalize failed: ' + (f.stderr || '').slice(0, 300));
  const v = spawnSync(process.execPath, [path.join(dir, 'verify.js')], opts);
  if (v.status !== 0) throw new Error('verify failed: ' + (v.stdout || '') + (v.stderr || '').slice(0, 300));
}

test('IDEM3. full pipeline (enrich+finalize+verify) run twice -> identical normalized hash of 13 files', () => {
  const tmp = copyForPipeline();
  try {
    runPipelineOnce(tmp);
    const h1 = hashPipeline(tmp);
    runPipelineOnce(tmp);
    const h2 = hashPipeline(tmp);
    assertEq(h1, h2, `pipeline NOT idempotent: run1 hash ${h1} != run2 hash ${h2} (a re-run reclassified an omission reason or zeroed byte fields)`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('IDEM4. full pipeline run thrice -> hashes run1===run2===run3', () => {
  const tmp = copyForPipeline();
  try {
    runPipelineOnce(tmp); const h1 = hashPipeline(tmp);
    runPipelineOnce(tmp); const h2 = hashPipeline(tmp);
    runPipelineOnce(tmp); const h3 = hashPipeline(tmp);
    assertEq(h1, h2, `run1 ${h1} != run2 ${h2}`);
    assertEq(h2, h3, `run2 ${h2} != run3 ${h3}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---------- body-omission consistency (§5) ----------
// Find the first omitted body part (request takes precedence) so the mutation targets a real
// counted sample. Returns { fp, lines, i, s, part }.
function findOmittedSample(tmp, wantReason) {
  for (const f of FILES) {
    const fp = path.join(tmp, f);
    const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const s = JSON.parse(lines[i]);
      for (const part of [s.requestSanitized, s.responseSanitized]) {
        if (part && part.bodyOmitted === true && (!wantReason || part.bodyOmittedReason === wantReason)) {
          return { fp, lines, i, s, part };
        }
      }
    }
  }
  return null;
}
test('OMIT1. a structural omission with preOmissionRetainedBytes=0 fails with OMIT:', () => {
  withMutatedDataset(tmp => {
    const found = findOmittedSample(tmp, 'legacy_capture_structurally_truncated');
    assert(found, 'no structural-omission sample found to mutate');
    found.part.preOmissionRetainedBytes = 0; // structural MUST retain >0; 0 means the true size was lost
    found.part.originalBodyBytes = 0;
    found.lines[found.i] = JSON.stringify(found.s);
    fs.writeFileSync(found.fp, found.lines.join('\n') + '\n');
  }, 'structural omission with 0 retained bytes (size lost)', 'OMIT:');
});
test('OMIT2. an omitted body that is non-null fails with OMIT:', () => {
  withMutatedDataset(tmp => {
    const found = findOmittedSample(tmp);
    assert(found, 'no omitted sample found to mutate');
    found.part.body = 'should-be-null-because-omitted';
    found.lines[found.i] = JSON.stringify(found.s);
    fs.writeFileSync(found.fp, found.lines.join('\n') + '\n');
  }, 'omitted body is non-null', 'OMIT:');
});
test('OMIT3. an omitted body with a disallowed reason fails with OMIT:', () => {
  withMutatedDataset(tmp => {
    const found = findOmittedSample(tmp);
    assert(found, 'no omitted sample found to mutate');
    found.part.bodyOmittedReason = 'not_a_real_reason';
    found.lines[found.i] = JSON.stringify(found.s);
    fs.writeFileSync(found.fp, found.lines.join('\n') + '\n');
  }, 'omitted body with disallowed reason', 'OMIT:');
});

// ---------- manifest idMapping consistency (§4: 6 mutation tests) ----------
// Each mutates ONE manifest.idMapping field and asserts the MANIFEST: gate fires (proving the
// verifier compares the manifest against the live shared computation, not just sample counts).
function mutateManifest(tmp, fn) {
  const mp = path.join(tmp, 'dataset-manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  fn(m.idMapping);
  fs.writeFileSync(mp, JSON.stringify(m, null, 2));
}
test('MAN1. manifest.idMapping.allCommittedViews.totalMappedOccurrences mismatch -> MANIFEST:', () => {
  withMutatedDataset(tmp => mutateManifest(tmp, idm => { idm.allCommittedViews.totalMappedOccurrences = 999999; }), 'allCommittedViews.totalMappedOccurrences mismatch', 'MANIFEST:');
});
test('MAN2. manifest.idMapping.allCommittedViews resource occurrence mismatch -> MANIFEST:', () => {
  withMutatedDataset(tmp => mutateManifest(tmp, idm => { idm.allCommittedViews.mappedByCategory.resource.occurrences = 999999; }), 'resource occurrence mismatch', 'MANIFEST:');
});
test('MAN3. manifest.idMapping.bodiesOmitted mismatch -> MANIFEST:', () => {
  withMutatedDataset(tmp => mutateManifest(tmp, idm => { idm.bodiesOmitted = 999999; }), 'bodiesOmitted mismatch', 'MANIFEST:');
});
test('MAN4. manifest.idMapping omission reason distribution mismatch -> MANIFEST:', () => {
  withMutatedDataset(tmp => mutateManifest(tmp, idm => { idm.bodiesOmittedReasonBreakdown['legacy_capture_structurally_truncated'] = 999999; }), 'omission reason distribution mismatch', 'MANIFEST:');
});
test('MAN5. deleting an omission reason from the manifest breakdown -> MANIFEST:', () => {
  withMutatedDataset(tmp => mutateManifest(tmp, idm => { delete idm.bodiesOmittedReasonBreakdown['legacy_capture_structurally_truncated']; }), 'omission reason deleted from breakdown', 'MANIFEST:');
});
test('MAN6. manifest.idMapping.legacyPlaceholderRemapped mismatch -> MANIFEST:', () => {
  withMutatedDataset(tmp => mutateManifest(tmp, idm => { idm.legacyPlaceholderRemapped = false; }), 'legacyPlaceholderRemapped mismatch', 'MANIFEST:');
});

// ---------- P0: test-salt isolation (salt never written to the real path) ----------
// A clean clone that runs the tests must NOT end up with a public fixed salt at
// raw-private/.id-salt (the old bypass). sanitize.js must (a) refuse the known synthetic salt in
// production, and (b) hold the test salt in memory only under SANITIZER_TEST_MODE.
test('SALT1. production mode refuses the known synthetic test salt (fail-closed)', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-salt-'));
  fs.mkdirSync(path.join(tmp, 'raw-private'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'raw-private', '.id-salt'), '0123456789abcdef'.repeat(4));
  fs.copyFileSync(path.join(DATA, 'sanitize.js'), path.join(tmp, 'sanitize.js'));
  // Require sanitize.js from the temp dir with SANITIZER_TEST_MODE unset -> production path. It
  // MUST throw (the salt file holds the public synthetic value; real evidence must fail closed).
  const r = spawnSync(process.execPath, ['-e', "require('./sanitize')"], { cwd: tmp, encoding: 'utf8', env: { ...process.env, SANITIZER_TEST_MODE: '' } });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.status !== 0, 'sanitize.js should FAIL CLOSED when raw-private/.id-salt is the known synthetic test salt');
  assert((r.stderr || '').toLowerCase().includes('synthetic') || (r.stderr || '').includes('FAIL CLOSED'),
    'expected fail-closed synthetic-salt refusal; stderr=' + (r.stderr || '').slice(0, 200));
});

test('SALT2. SANITIZER_TEST_MODE does not create raw-private/.id-salt (in-memory only, no pollution)', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-salt2-'));
  fs.copyFileSync(path.join(DATA, 'sanitize.js'), path.join(tmp, 'sanitize.js'));
  // No raw-private dir, no salt file. Require in TEST_MODE -> must load fine AND not create a file.
  const r = spawnSync(process.execPath, ['-e', "require('./sanitize')"], { cwd: tmp, encoding: 'utf8', env: { ...process.env, SANITIZER_TEST_MODE: 'true' } });
  const created = fs.existsSync(path.join(tmp, 'raw-private', '.id-salt'));
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.status === 0, 'sanitize.js should load in TEST_MODE without a salt file; stderr=' + (r.stderr || '').slice(0, 200));
  assert(!created, 'sanitize.js in TEST_MODE created raw-private/.id-salt (must be in-memory only; P0 regression)');
});

test('SALT3. test suite has not overwritten a real raw-private/.id-salt with the synthetic value', () => {
  // Guards against re-introducing the old write-the-synthetic-salt block: after the suite runs,
  // a pre-existing real salt must remain intact (not the public synthetic value). On a clean
  // clone with no salt file this is a no-op; locally (real salt present) it asserts the real salt
  // was not silently replaced.
  if (fs.existsSync(saltPath)) {
    const s = fs.readFileSync(saltPath, 'utf8').trim();
    assert(s !== '0123456789abcdef'.repeat(4), 'test suite overwrote the real salt with the synthetic value (P0 regression)');
  }
});

// ---------- P1: safeTruncate never cuts a placeholder mid-token ----------
const MAX = S.MAX_BODY_BYTES; // 4000
const PARTIAL_PH_RE = /\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9A-F]{0,7}(?![0-9A-F]*\])/g;
test('ST1. placeholder starting near the 4000-byte boundary is rolled back, not cut mid-token', () => {
  // [ at byte 3990; placeholder spans bytes 3991-4012 -> a naive cut at 4000 leaves [RESOURCE_
  const body = 'x'.repeat(3990) + '[RESOURCE_ID_7A2B9F31]';
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assert(!t.text.includes('[RESOURCE_ID'), 'placeholder fragment leaked into truncated output');
  assert((t.text.match(PARTIAL_PH_RE) || []).length === 0, 'partial placeholder fragment left at end');
});
test('ST2. placeholder ending just past the 4000-byte boundary is rolled back', () => {
  // placeholder ends at byte ~4009 (within 4001-4020); cut must not leave [SESSION_ID_
  const body = 'x'.repeat(3988) + '[SESSION_ID_11223344]';
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assert(!t.text.includes('[SESSION_ID'), 'placeholder fragment leaked');
  assert((t.text.match(PARTIAL_PH_RE) || []).length === 0, 'partial placeholder fragment left');
});
test('ST3. a partial \\uXXXX unicode escape at the boundary is rolled back', () => {
  const body = 'x'.repeat(3997) + '\\u0041'; // \u at byte 3997; cut at 4000 leaves \u0 (incomplete)
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assert(!/\\u[0-9A-Fa-f]{0,3}$/.test(t.text), 'incomplete \\u escape left at end: ' + JSON.stringify(t.text.slice(-12)));
});
test('ST4. a trailing backslash escape at the boundary is removed', () => {
  const body = 'x'.repeat(3999) + '\\y'; // 4001 bytes; cut at 4000 keeps the lone backslash
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assert(!t.text.endsWith('\\'), 'trailing backslash left at end');
});
test('ST5. a JSON string cut mid-value is honestly marked truncated (not silently complete)', () => {
  const body = 'x'.repeat(3990) + '{"key":"unterminated-value-without-close';
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  // A truncated JSON body is honestly marked truncated; the structural-integrity gate + omission
  // (not safeTruncate) decide whether a half-JSON response is kept or omitted.
});
test('ST6. a multibyte (UTF-8) char at the boundary is not split mid-byte', () => {
  const body = 'x'.repeat(3999) + '😀'; // 4-byte emoji; naive byte-truncation at 4000 would split it
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  // The kept text must be valid UTF-8 (no lone lead byte / surrogate): round-trips through Buffer.
  const rt = Buffer.from(t.text, 'utf8').toString('utf8');
  assertEq(rt, t.text, 'truncated text is not valid UTF-8 (multibyte char split)');
});

// ---------- P1: verifier fails closed on a partial (truncated) placeholder in committed data ----------
test('PARTIAL1. a partial [PREFIX_ID_<hex> placeholder in committed data fails verify with PARTIAL:', () => {
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'normal-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const s = JSON.parse(lines[0]);
    // bodyTruncated=true so the structural-integrity gate is skipped -> isolates the partial-
    // placeholder gate as the detector (a safeTruncate cut leaving [RESOURCE_ID_7A2B9F3, no ]).
    s.responseSanitized.bodyTruncated = true;
    s.responseSanitized.body = (s.responseSanitized.body || '') + ' trailing [RESOURCE_ID_7A2B9F3 no close';
    lines[0] = JSON.stringify(s);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'partial placeholder (truncated mid-token)', 'PARTIAL:');
});

// ---------- P1: safeTruncate span-based rollback (prefix-mid and 8-hex-no-] blind spots) ----------
test('ST7. a cut in the MIDDLE of the prefix name (e.g. [RESO) is rolled back via span matching', () => {
  // The full placeholder is [RESOURCE_ID_12345678]; the 4000-byte cut lands at '[RESO' (5 chars
  // into the prefix). The old end-anchored regex required a near-complete prefix and silently
  // missed this - a false PASS. The span-based rollback uses the full string and rolls back to
  // before the '['.
  const body = 'x'.repeat(3995) + '[RESOURCE_ID_12345678]';
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assertEq(t.text, 'x'.repeat(3995), 'should roll back to before the opener (cut was mid-prefix)');
  assert(!t.text.includes('[RESO'), 'prefix-mid fragment [RESO leaked into truncated output');
  assert((t.text.match(PARTIAL_PH_RE) || []).length === 0, 'partial placeholder fragment left at end');
});
test('ST8. a cut after 8 hex but before ] (e.g. [RESOURCE_ID_12345678 with no ]) is rolled back', () => {
  // 8-hex complete but the ']' is cut off. The old regex accepted only 0-7 hex, so 8 hex did not
  // roll back; the verifier's partial scan happened to catch it, but safeTruncate itself violated
  // its "never cut a placeholder" guarantee. The span-based rollback catches it.
  const body = 'x'.repeat(3979) + '[RESOURCE_ID_12345678]';
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assertEq(t.text, 'x'.repeat(3979), 'should roll back to before the opener (8-hex cut, no ])');
  assert(!t.text.includes('[RESOURCE_ID_12345678'), '8-hex opener with no ] leaked');
});
test('ST9. every cut position INSIDE any of the 4 ID-prefix placeholders rolls back (no fragment leaks)', () => {
  // For each of the 4 prefixes, cut at EVERY character position strictly inside the placeholder
  // (from 1 char in up to char before ']'). Each must roll back to before the '[' so no fragment
  // (opener, prefix name, '_', hex digits) ever leaks. This exhaustively covers the blind spots
  // ST7/ST8 demonstrated.
  for (const pfx of ['RESOURCE_ID', 'SESSION_ID', 'USER_ID', 'TENANT_ID']) {
    const ph = '[' + pfx + '_12345678]'; // canonical 8-hex complete placeholder
    for (let cutInside = 1; cutInside < ph.length; cutInside++) {
      // pad = MAX - cutInside ASCII bytes; the byte boundary lands at char index MAX, which is
      // strictly inside the placeholder span (start < MAX < end). Span rollback -> kept = pad.
      const padLen = MAX - cutInside;
      const body = 'x'.repeat(padLen) + ph;
      const t = S.safeTruncate(body, MAX);
      assertEq(t.truncated, true, pfx + ' cutInside=' + cutInside + ' should be truncated');
      assertEq(t.text, 'x'.repeat(padLen), pfx + ' cutInside=' + cutInside + ' should roll back to before the opener (no fragment)');
      assert(!t.text.includes('[' + pfx), pfx + ' cutInside=' + cutInside + ' opener fragment leaked');
    }
  }
});

// ---------- P0: safeTruncate UTF-16 code-unit index unification (surrogate-pair chars BEFORE a placeholder) ----------
test('ST10. surrogate-pair (emoji) chars BEFORE a placeholder: cut inside rolls back (Unicode index fix)', () => {
  // '...' (U+1F600) is 2 UTF-16 code units, 4 UTF-8 bytes. 999 emojis = 3996 bytes; the placeholder
  // starts at UTF-16 index 1998 (999*2). The PRIOR code tracked the cut as a CODE-POINT index
  // (1003, via Array.from), which is < 1998, so `cutCharIdx > start` was false and rollback never
  // fired - leaving `[RES` (the first bytes of the placeholder) in the output. The fix unifies on
  // UTF-16 code units: cutCodeUnitIdx += ch.length (2 per emoji) -> 2002, which IS inside
  // [1998, 2021), so rollback fires. ST7-ST9 used ASCII 'x' (code points == code units) and could
  // not catch this. This is the Unicode-index-mixing defect from the Round-7 review.
  const EMOJI = '😀';
  const body = EMOJI.repeat(999) + '[RESOURCE_ID_12345678]';
  const t = S.safeTruncate(body, MAX);
  assertEq(t.truncated, true, 'should be truncated');
  assertEq(t.text, EMOJI.repeat(999), 'must roll back to before the placeholder, leaving only the 999 emojis');
  assert(!t.text.includes('['), 'placeholder opener leaked; tail=' + t.text.slice(-24));
  assert(!t.text.endsWith('[RES'), 'must NOT end with [RES (the Unicode-index-mixing bug)');
  assertEq(Buffer.byteLength(t.text, 'utf8'), 3996, 'retained bytes = 999 emojis * 4');
});
test('ST11. every cut position inside a placeholder preceded by surrogate-pair chars rolls back (4 prefixes x varying emoji counts)', () => {
  // For each of the 4 prefixes, prepend a VARYING number of emoji (surrogate-pair) chars so the
  // placeholder lands at a different UTF-16 offset, then cut at EVERY position strictly inside the
  // placeholder. Each cut must roll back to before the '[' (leaving only the emoji prefix),
  // proving the UTF-16 code-unit index is consistent across the byte-walk, the regex match.index,
  // and slice. ST9 used ASCII 'x' as the prefix (code points == code units) and could not catch the
  // index-system desync that emoji (2 code units each) exposes.
  const EMOJI = '😀';
  for (const pfx of ['RESOURCE_ID', 'SESSION_ID', 'USER_ID', 'TENANT_ID']) {
    const ph = '[' + pfx + '_12345678]';   // canonical 8-hex; all ASCII (code units == bytes)
    const L = ph.length;
    for (let emojiCount = 1; emojiCount <= 6; emojiCount++) {  // vary the surrogate-pair prefix length
      const prefix = EMOJI.repeat(emojiCount);
      const prefixBytes = Buffer.byteLength(prefix, 'utf8');  // 4 * emojiCount
      for (let cutInside = 1; cutInside < L; cutInside++) {
        const body = prefix + ph;
        const maxBytes = prefixBytes + cutInside;   // cut exactly `cutInside` bytes into the placeholder
        const t = S.safeTruncate(body, maxBytes);
        assertEq(t.truncated, true, pfx + ' e=' + emojiCount + ' cut=' + cutInside + ' should be truncated');
        assertEq(t.text, prefix, pfx + ' e=' + emojiCount + ' cut=' + cutInside + ' must roll back to before the placeholder (emoji prefix only); got tail="' + t.text.slice(-24) + '"');
        assert(!t.text.includes('['), pfx + ' e=' + emojiCount + ' cut=' + cutInside + ' opener leaked; tail="' + t.text.slice(-24) + '"');
      }
    }
  }
});

// ---------- P1: verifier fails closed on a non-canonical (invalid) placeholder ----------
test('INVALID1. a non-canonical [PREFIX_ID_<6 hex>] placeholder in committed data fails verify with INVALID:', () => {
  // [RESOURCE_ID_ABCDEF] has 6 hex (not the canonical 8) WITH a closing ] -> NOT caught by the
  // partial scan (needs no ]) NOR the malformed scan (needs [[). Only the invalid-placeholder gate
  // detects it. scanFinalStats used to accept 4-8 hex and would have silently counted this as a
  // valid mapped id (a false PASS hiding a sanitizer/regen regression).
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'normal-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const s = JSON.parse(lines[0]);
    s.responseSanitized.bodyTruncated = true; // skip the JSON-structural-integrity gate to isolate INVALID
    s.responseSanitized.body = (s.responseSanitized.body || '') + ' ref [RESOURCE_ID_ABCDEF] here';
    lines[0] = JSON.stringify(s);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'invalid placeholder (non-canonical 6-hex)', 'INVALID:');
});

// ---------- P1: verifier fails closed on a double-bracket placeholder (extra [ or ] around a canonical token) ----------
test('DOUBLE1. a double-bracket [[PREFIX_ID_<hex>] placeholder in committed data fails verify with DOUBLE:', () => {
  // [[RESOURCE_ID_12345678] has an extra '[' before a canonical placeholder. The invalid scanner
  // misses it: its SHAPED regex matches the INNER [RESOURCE_ID_12345678] which IS canonical, so the
  // extra bracket is silently accepted. The malformed scanner only catches legacy [[RESOURCE_<hex>]
  // (no _ID_). The partial scanner only catches openers with NO ]. Only the double-bracket gate
  // detects it. The same blind spot applies to [PREFIX_ID_<hex>]] and [[PREFIX_ID_<hex>]].
  withMutatedDataset(tmp => {
    const f = path.join(tmp, 'normal-traffic.jsonl');
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const s = JSON.parse(lines[0]);
    s.responseSanitized.bodyTruncated = true; // skip the JSON-structural-integrity gate to isolate DOUBLE
    s.responseSanitized.body = (s.responseSanitized.body || '') + ' ref [[RESOURCE_ID_12345678] here';
    lines[0] = JSON.stringify(s);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  }, 'double-bracket placeholder (extra [ before canonical)', 'DOUBLE:');
});

// ---------- P0: copyForPipeline never materializes raw-private in the temp dir ----------
test('SENTINEL1. copyForPipeline excludes raw-private at the source (no copy-then-delete leak)', () => {
  // Plant a sentinel secret in a fake dataset's raw-private, run copyForPipeline on it, and assert
  // the sentinel NEVER appears anywhere under tmp. This proves raw-private is excluded at the
  // copy SOURCE (cpSync filter), not copied-then-deleted: a crash between cpSync and rmSync could
  // otherwise leave the operator's real salt/creds/cookies in /tmp.
  const fakeData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-sent-src-'));
  fs.mkdirSync(path.join(fakeData, 'raw-private'), { recursive: true });
  const SENT = 'SENTINEL_SECRET_' + 'Z'.repeat(40);
  fs.writeFileSync(path.join(fakeData, 'raw-private', '.id-salt'), SENT);
  fs.writeFileSync(path.join(fakeData, 'raw-private', '.test-creds.env'), 'VIGUARD_PASS=' + SENT + '\n');
  fs.writeFileSync(path.join(fakeData, 'normal-traffic.jsonl'), '{"sampleId":"000001"}\n');
  const tmp = copyForPipeline(fakeData);
  let leaked = false;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (fs.readFileSync(p, 'utf8').includes(SENT)) leaked = true;
    }
  };
  walk(tmp);
  const materialized = fs.existsSync(path.join(tmp, 'raw-private'));
  fs.rmSync(fakeData, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(!materialized, 'raw-private was materialized in tmp (must be excluded at the copy source, not deleted after)');
  assert(!leaked, 'sentinel secret from raw-private was written into the temp dir (must be excluded at the copy source)');
});

// ---------- P0: enrich.js refuses SANITIZER_TEST_MODE on the real data directory ----------
test('TESTMODE1. SANITIZER_TEST_MODE=true node enrich.js on a REAL (non-tmp) data dir is refused', () => {
  // Run enrich.js in a fixture dir that is NOT under os.tmpdir() (so it looks "real" to the
  // refusal check) but contains NO real data (only enrich.js + its require chain). The refusal
  // fires at main() start, before any data file is read/written. Using a fixture (not the real
  // DATA dir) means even if the refusal were buggy, no real evidence could be mutated - the for
  // loop would read empty/missing data files and write only into the throwaway fixture.
  const fixtureParent = path.join(DATA, '..', '.vig-refuse-fixture'); // ml/data/.vig-refuse-fixture (NOT under tmpdir)
  fs.rmSync(fixtureParent, { recursive: true, force: true });
  fs.mkdirSync(fixtureParent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(fixtureParent, 'real-'));
  try {
    // Copy enrich.js + its require chain. No data files / raw-private needed: the refusal fires
    // before the for loop reads FILES; sanitize.js in TEST_MODE holds the salt in memory.
    for (const f of ['enrich.js', 'sanitize.js', 'dataset-files.js']) {
      fs.copyFileSync(path.join(DATA, f), path.join(fixture, f));
    }
    const r = spawnSync(process.execPath, [path.join(fixture, 'enrich.js')], { cwd: fixture, encoding: 'utf8', env: { ...process.env, SANITIZER_TEST_MODE: 'true' } });
    assert(r.status !== 0, 'enrich.js should REFUSE to run in SANITIZER_TEST_MODE on a real (non-tmp) data dir');
    assert((r.stderr || '').includes('REFUSING'), 'expected REFUSING marker; stderr=' + (r.stderr || '').slice(0, 300));
  } finally {
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
});

// ---------- P0: enrich.js refuses SANITIZER_TEST_MODE under tmpdir WITHOUT the fixture marker (/tmp-clone footgun) ----------
test('TESTMODE2. SANITIZER_TEST_MODE=true under os.tmpdir() but WITHOUT the marker is refused', () => {
  // The Round-7 footgun: a real repo cloned under /tmp would pass the "is under tmpdir" check
  // alone (the Round-5 guard). The marker requirement closes this: a tmpdir location is necessary
  // but NOT sufficient; the .synthetic-regeneration-fixture marker (created only by
  // copyForPipeline) must also exist. This test plants enrich.js + deps under a REAL tmpdir temp
  // but writes NO marker, and asserts refusal - proving the marker (not the directory location)
  // is the deciding signal. The positive case (tmpdir + marker -> allowed) is covered by IDEM3/4
  // (copyForPipeline writes the marker, then runPipelineOnce runs enrich successfully).
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vig-testmode2-'));
  try {
    for (const f of ['enrich.js', 'sanitize.js', 'dataset-files.js']) {
      fs.copyFileSync(path.join(DATA, f), path.join(tmp, f));
    }
    // NO .synthetic-regeneration-fixture marker -> looks like a real repo cloned under /tmp.
    const r = spawnSync(process.execPath, [path.join(tmp, 'enrich.js')], { cwd: tmp, encoding: 'utf8', env: { ...process.env, SANITIZER_TEST_MODE: 'true' } });
    assert(r.status !== 0, 'enrich.js should REFUSE test mode under tmpdir WITHOUT the marker (closes the /tmp-clone footgun); exit=' + r.status);
    assert((r.stderr || '').includes('REFUSING'), 'expected REFUSING marker; stderr=' + (r.stderr || '').slice(0, 300));
    assert((r.stderr || '').includes('marker=false'), 'stderr should report marker=false (proving the marker, not isTemp, is the deciding signal); stderr=' + (r.stderr || '').slice(0, 300));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- summary ----------
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
console.log(`\n=== challenge-capture tests: ${passed}/${results.length} passed ===`);
for (const r of results) console.log((r.ok ? 'ok  ' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  -> ' + r.err));
process.exit(failed.length ? 1 : 0);
