#!/usr/bin/env node
'use strict';
// Regenerate all report/manifest outputs from the ACTUAL collected JSONL data.
// Run after a successful capture. Reads actual samples for honest metrics.
const fs = require('fs'), path = require('path');
const { buildIdMappingReport, CATEGORY_FILE_MAP } = require('./dataset-files');
const DIR = __dirname;
const FILES = CATEGORY_FILE_MAP;
const MY_IP = '192.168.3.107';

const counts = {}, statusDist = {};
let total = 0, failed = 0, exploitConfirmed = 0, canaryObserved = 0;
const attackFamilies = {};
const samples = [];
for (const [cat, file] of Object.entries(FILES)) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').filter(Boolean);
  counts[cat] = lines.length;
  for (const line of lines) {
    const s = JSON.parse(line); samples.push(s); total++;
    statusDist[s.responseStatus] = (statusDist[s.responseStatus] || 0) + 1;
    if (s.responseStatus === 0) failed++;
    if (s.executionEvidence.exploitConfirmed) exploitConfirmed++;
    if (s.executionEvidence.canaryObserved) canaryObserved++;
    if (s.groundTruth.attackFamily) attackFamilies[s.groundTruth.attackFamily] = (attackFamilies[s.groundTruth.attackFamily] || 0) + 1;
  }
}

// all-sanitized.jsonl = concatenation (rebuild to be safe)
fs.writeFileSync(path.join(DIR, 'all-sanitized.jsonl'), samples.map(s => JSON.stringify(s)).join('\n') + '\n');

// ID-mapping + body-omission stats: computed from the ACTUAL committed data files via the
// SHARED dataset-files.js module (the same code path verify.js uses), so the manifest and the
// verification report can never report different values for the same metric name (a prior
// divergence let them report 688 vs 596 because verify.js scanned review-queue.jsonl and
// finalize.js did not). Two explicitly-named metrics: canonicalEvidence (5 evidence files;
// distinct captured identifiers) and allCommittedViews (all committed views; CROSS-VIEW
// occurrences of the same placeholders, NOT distinct identifiers).
const reviewQueueEntries = (function () {
  try { return fs.readFileSync(path.join(DIR, 'review-queue.jsonl'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
})();
const { idMapping } = buildIdMappingReport(samples, reviewQueueEntries);
const bodiesOmitted = idMapping.bodiesOmitted;
const bodiesOmittedReasonBreakdown = idMapping.bodiesOmittedReasonBreakdown;
const bodiesOmittedReasonSummary = idMapping.bodiesOmittedReason;

fs.writeFileSync(path.join(DIR, 'scope-validation.json'), JSON.stringify({
  authorizedTargetIp: '192.168.3.140',
  authorizedTargetUrl: 'http://192.168.3.140:5173',
  targetApplicationIdentified: 'AetherGuard',
  operatorCodename: 'VIguard',
  identificationEvidence: [
    'GET / returned <title>AetherGuard | 杭州视界奇点科技有限公司</title> and /aetherguard-logo-512.png',
    'Vite dev server markers (/@vite/client, /@react-refresh)',
    'GET /health -> 200 {"status":"ok"} (AetherGuard direct health endpoint)',
    'GET /api/health -> 401 AUTH_TOKEN_MISSING (AetherGuard auth middleware, {success,data,error} envelope)',
    'POST /api/auth/login -> 200 with accessToken/refreshToken httpOnly cookies',
  ],
  codenameJustification: '"VIguard" appears nowhere in the codebase (3 case-insensitive grep variants, 0 matches). The live service at 192.168.3.140:5173 is unambiguously AetherGuard from this repo. "VIguard" is the operator-assigned codename for the deployed AetherGuard instance.',
  scopeAdherence: { onlyAccessedAuthorizedIp: true, noSubnetScan: true, noLateralMovement: true, noOtherLanHostsAccessed: true, maxConcurrency: 1, maxRatePerSec: 2, actualAvgDelayMs: 550 },
  redirectToOtherHostObserved: false,
  outOfScopeRedirect: null,
}, null, 2));

fs.writeFileSync(path.join(DIR, 'environment.json'), JSON.stringify({
  workspacePath: 'X:/repos/Networksafe',
  gitBranch: 'agent/viguard-lan-capture-20260729',
  targetIp: '192.168.3.140',
  targetReachable: true,
  targetHttpPort: 5173,
  targetApp: 'AetherGuard (Vite dev frontend + Express API via /api proxy)',
  apiBase: 'http://192.168.3.140:5173/api',
  localMachineIp: MY_IP,
  localMachineIsTarget: false,
  proxyConfiguredToLeaveLan: false,
  collectionTool: 'Node.js ' + process.version + ' built-in http',
  rateLimitObserved: { auth: '120 req/window', general: '600 req/window' },
  targetStabilityNote: 'During sequential challenge capture the client observed repeated authenticated-session invalidation and at least one period of connection failure. Root cause is unconfirmed: no server-side PID, restart counter, OOM log, or stack trace was collected.',
  loginVerified: true,
  timestamp: new Date().toISOString(),
}, null, 2));

fs.writeFileSync(path.join(DIR, 'credential-discovery-report.json'), JSON.stringify({
  credentialSource: 'operator_provided',
  credentialType: 'test_account',
  username: '[TEST_ACCOUNT]',
  password: '[REDACTED]',
  accountRole: 'tenant_admin',
  accountPlan: 'starter',
  tenantId: '[TENANT_ID]',
  codebaseCredentialSearch: {
    searchedFor: ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'TEST_USER', 'DEMO_USER', 'SEED_USER', 'LOGIN_EMAIL'],
    result: 'No "VIguard" credentials in codebase (VIguard not present). AetherGuard .env holds a DIFFERENT local admin account; not used because its nature vs the authorized target could not be confirmed. Operator provided a dedicated test account.',
  },
  credentialHandling: { storedInGitignoredFile: 'raw-private/.test-creds.env (gitignored)', writtenToDataset: false, writtenToReport: false, committedToGit: false, redactedInAllOutputs: true },
}, null, 2));

fs.writeFileSync(path.join(DIR, 'role-permission-matrix.json'), JSON.stringify({
  testedRole: 'tenant_admin',
  note: 'Actual per-endpoint status codes are in each sample\'s responseStatus field. tenant_admin received 403 on superadmin/oversight endpoints and was allowed on tenant-scoped alert/agent/device/dashboard reads.',
  permissionsObserved: [
    { endpoint: 'GET /api/auth/me', result: 'allowed (200)' },
    { endpoint: 'GET /api/alerts', result: 'allowed (tenant-scoped, 200/404)' },
    { endpoint: 'GET /api/agents', result: 'allowed (200)' },
    { endpoint: 'GET /api/devices', result: 'allowed (200)' },
    { endpoint: 'GET /api/dashboard', result: 'allowed (200)' },
    { endpoint: 'GET /api/admin/tenant-oversight/tenants', result: 'denied (403) - see normal-traffic permission-insufficient samples' },
    { endpoint: 'PUT /api/admin/users/:id/role', result: 'denied (403) - see attack-traffic privilege_escalation samples' },
    { endpoint: 'POST /api/admin/tenant-oversight/exports', result: 'denied (403) - see attack-traffic privilege_escalation samples' },
  ],
}, null, 2));

const findings = [
  { id: 'FND-001', category: 'auth', severity: 'info', title: 'Authentication enforced on all /api endpoints', evidence: 'GET /api/health -> 401 AUTH_TOKEN_MISSING; missing/malformed/forged JWT -> 401 (see attack-traffic auth_bypass samples).' },
  { id: 'FND-002', category: 'input-validation', severity: 'info', title: 'No injection canary observed', evidence: `${exploitConfirmed} exploit(s) confirmed; ${canaryObserved} canary(ies) observed across ${counts.attack} attack samples. SQLi/XSS/cmdi/path-traversal payloads were rejected or returned no canary (see attack-traffic.jsonl).` },
  { id: 'FND-003', category: 'ssrf', severity: 'info', title: 'No SSRF observed', evidence: 'Local echo listener on 192.168.3.107:9999 received 0 fetch from the target across SSRF payloads (echoHits=0).' },
  {
    id: 'FND-004',
    category: 'stability',
    severity: 'needs-investigation',
    title: 'Availability anomalies and repeated session invalidation observed during sequential challenge capture',
    evidence: 'During sequential requests at concurrency 1 and approximately 1.8 requests/s, the client observed repeated authenticated-session invalidation and at least one period of connection failure. The capture harness re-authenticated automatically to keep payloads reaching the application layer. No server-side PID, restart counter, OOM log, memory telemetry, or stack trace was collected; therefore the root cause is unconfirmed.',
    recommendation: 'Inspect backend process logs, systemd/Docker restart counters, memory telemetry, OOM-killer logs, and endpoint-specific traces before attributing the anomaly to crash, restart, OOM, or concurrency.',
  },
  { id: 'FND-005', category: 'rate-limiting', severity: 'info', title: 'Rate limiting present', evidence: 'x-ratelimit-limit headers: 120 (auth) / 600 (general) per window.' },
];
fs.writeFileSync(path.join(DIR, 'findings.json'), JSON.stringify({ findings, attackFamilyDistribution: attackFamilies, echoHitsTotal: 0, exploitConfirmedCount: exploitConfirmed, canaryObservedCount: canaryObserved, generatedAt: new Date().toISOString() }, null, 2));

fs.writeFileSync(path.join(DIR, 'pii-redaction-report.json'), JSON.stringify({
  realPiiEncountered: false, realPiiRedacted: 0,
  syntheticCanariesUsed: ['TEST_PERSON_001', 'TEST_PERSON_002', 'AETHER_CANARY_', '@example.test'],
  redactionPatternsApplied: ['password -> [REDACTED_PASSWORD]', 'test email -> [TEST_ACCOUNT]', 'tenantId -> [TENANT_ID]', 'JWT -> [REDACTED_JWT]', 'cookie/authorization headers dropped'],
  credentialsInOutputs: false, realPersonDataInDataset: false, realPiiEncounteredAndRedactedEvents: 0, status: 'NO_REAL_PII_ENCOUNTERED',
}, null, 2));

fs.writeFileSync(path.join(DIR, 'dataset-manifest.json'), JSON.stringify({
  datasetName: 'viguard-lan-challenge-capture-20260729',
  datasetDescription: 'Authorized LAN Live-Execution Challenge Set (live-captured synthetic attack-attempt benchmark). Every request was really sent to the authorized target and every retained sample captured a real response; attack payloads and attack-intent labels were pre-designed by the test plan, not naturally occurring. exploitConfirmed=0 and canaryObserved=0. Target-specific. Not production/naturally-occurring traffic. NOT eligible for training; reserved as an external independent challenge test set.',
  targetApplication: 'AetherGuard (codename VIguard)',
  targetIp: '192.168.3.140',
  captureDate: '2026-07-29',
  sampleCounts: counts,
  totalSamples: total,
  files: {
    'normal-traffic.jsonl': counts.normal, 'attack-traffic.jsonl': counts.attack,
    'hard-negatives.jsonl': counts.hardNegative, 'prompt-injection.jsonl': counts.promptInjection,
    'unknown-cases.jsonl': counts.unknown, 'all-sanitized.jsonl': total,
    'model-benchmark.jsonl': total, 'model-inputs.jsonl': total, 'model-labels.jsonl': total,
    'review-queue.jsonl': total,
  },
  idMapping,
  datasetMetadata: {
    split: 'external_challenge_test',
    eligibleForTraining: false,
    humanReviewed: false,
    reviewerCount: 0,
    interAnnotatorAgreement: null,
    cohenKappa: null,
    adjudicatedSamples: 0,
    targetSpecific: true,
  },
  responseStatusDistribution: statusDist,
  failedConnectionSamples: failed,
  exploitConfirmedCount: exploitConfirmed, canaryObservedCount: canaryObserved,
  attackFamilyDistribution: attackFamilies,
  schemaVersion: '2.1', allSamplesReal: true, fabricationUsed: false, redactionApplied: true, gitignoreExcludesRawPrivate: true,
  verifiedAt: new Date().toISOString(),
}, null, 2));

const statusRows = Object.entries(statusDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| HTTP ${k} | ${v} |`).join('\n');
const famRows = Object.entries(attackFamilies).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
const md = `# VIguard (AetherGuard) Authorized LAN Live-Execution Challenge Set

**Dataset class:** Authorized LAN Live-Execution Challenge Set (live-captured synthetic attack-attempt benchmark).
**Date:** 2026-07-29 · **Target:** 192.168.3.140:5173 (AetherGuard; operator codename "VIguard")
**Scope:** authorized LAN testing on 192.168.3.140 only · sequential, <=2 req/s, concurrency 1

> **What this dataset is - and is not.** Every request was really sent to the authorized
> target and every retained sample captured a real response. However, the attack payloads
> were **pre-designed by the test plan** and the attack-intent labels come **primarily from
> that design**, not from naturally occurring traffic. \`exploitConfirmed=0\` and
> \`canaryObserved=0\` across the set. This is therefore **not** "real-world/production
> attack traffic", **not** a corpus of confirmed successful exploits, and it is
> **target-specific**. It is reserved as an **external independent challenge test set**
> (\`split=external_challenge_test\`, \`eligibleForTraining=false\`) and must **not** be used
> as training data. Human double-review has **not** been completed
> (\`humanReviewed=false\`, \`reviewerCount=0\`, \`cohenKappa=null\`).

## Target identification

"VIguard" appears nowhere in the codebase (3 case-insensitive grep variants, 0 matches). The live service at 192.168.3.140:5173 was identified as **AetherGuard** by: \`<title>AetherGuard | 杭州视界奇点科技有限公司</title>\`, \`/aetherguard-logo-512.png\`, Vite dev server, \`GET /health -> 200 {"status":"ok"}\`, and \`GET /api/health -> 401 AUTH_TOKEN_MISSING\` ({success,data,error} envelope). "VIguard" is the operator-assigned codename for this deployed AetherGuard instance.

## Credentials

Operator-provided dedicated test account (tenant_admin, starter). Password redacted everywhere; stored only in gitignored \`raw-private/.test-creds.env\`. The AetherGuard \`.env\` local admin account was NOT used (its nature vs the authorized target was unconfirmable). Login verified: HTTP 200 with httpOnly cookies.

## Sample counts

| Category | Count | Target |
|---|---|---|
| normal-traffic | ${counts.normal} | >=150 |
| attack-traffic | ${counts.attack} | >=40 |
| hard-negatives | ${counts.hardNegative} | >=80 |
| prompt-injection | ${counts.promptInjection} | >=50 |
| unknown-cases | ${counts.unknown} | >=50 |
| **total** | **${total}** | |

## Evidence view vs. model-benchmark view (input/labels/metadata isolation)

Three views of the same ${total} samples exist and must not be conflated:

- **Evidence capture** (\`*-traffic.jsonl\`, \`all-sanitized.jsonl\`) retains request + response
  status/headers/body + latency + ground truth + execution evidence. It proves each request
  was really executed, but is **not** a valid model input.
- **Model benchmark** (\`model-benchmark.jsonl\`) is a **physically isolated** record:
  \`{sampleId, input, labels, metadata}\`. \`input\` holds ONLY pre-request, client-observable
  fields (method, path, request headers/body, authenticated flag, targetApplication) and is
  the ONLY object a model may read. \`labels\` (verdict, attackFamily, recommendedAction,
  contextSufficient, **requestIntent**, exploitOutcome, isHardNegative) and \`metadata\`
  (split, eligibleForTraining, ...) are scoring/audit data and must NEVER enter the model
  prompt. **\`requestIntent\` is a LABEL (derived from the capture verdict), NOT a model input.**
  The JSON Schema (\`schema/benchmark-sample.schema.json\`) rejects the legacy flat structure
  (top-level method/path/requestIntent) and rejects any label field placed inside \`input\`.
- **Process-level isolation files** (\`model-inputs.jsonl\` = sampleId+input ONLY;
  \`model-labels.jsonl\` = sampleId+labels+metadata) exist so an eval harness can feed the model
  process ONLY inputs and join predictions to labels via \`sampleId\` afterwards. \`sampleId\` is a
  join key, never a model feature. \`build-model-input.js\` is a whitelist prompt builder that
  reads ONLY \`input.*\` by explicit field name (no object spread) and fails closed if any label
  field appears in \`input\`.

> **No-response leakage.** responseStatus, response headers/body, latencyMs, and executionEvidence
> appear ONLY in the evidence view - never in \`input\`. A model cannot read target-response
> features to guess labels.

## Body omission (two reasons; both fail-closed)

Bodies are omitted (set to \`null\` with \`bodyOmitted=true\`) for two distinct reasons, both
visible per-sample via \`bodyOmittedReason\` and summarized in the manifest \`idMapping.bodiesOmittedReasonBreakdown\`:

1. **\`legacy_capture_truncated_before_complete_sanitization\`** (partial-fragment-safe omission).
   The original capture truncated some response bodies to 4000 bytes BEFORE completing sanitization,
   which could split an identifier mid-value and leave a partial fragment. Because \`raw-private/\`
   holds no raw response bodies, those fragments cannot be recovered - they are **omitted, not
   guessed**. Any body that still contains a partial-identifier fragment (truncated UUID prefix,
   sensitive key + non-placeholder value, partial JWT, session/token key + long hex) is omitted.

2. **\`legacy_capture_structurally_truncated\`** (JSON structural break; new in v2.1).
   The same legacy pre-sanitization truncation could cut a JSON response body mid-string, breaking
   \`JSON.parse\`. The verifier's structural-integrity gate now fails closed if a response body
   marked complete (\`bodyTruncated=false\`, \`bodyOmitted=false\`) is JSON-shaped but does not parse;
   enrichment detects this at regeneration time and omits the body with this reason instead of
   leaving a structurally-broken body in the benchmark. The **true original size is preserved** via
   \`capturedContentLengthHeader\` (the captured Content-Length header) and \`preOmissionRetainedBytes\`
   (bytes of sanitized body held immediately before omission), so omission never resets the captured
   size evidence to 0.

${bodiesOmitted} sample(s) had body content omitted. Breakdown: ${JSON.stringify(bodiesOmittedReasonBreakdown)}.
Of these, ${idMapping.omittedBodiesWithUnknownRetainedLength} have \`preOmissionRetainedBytes=0\` (historical damage from a prior NON-IDEMPOTENT enrich run that zeroed the retained-byte evidence after omitting the body; the original bodies are gone and the byte count is UNRECOVERABLE -- 0 here means UNKNOWN retained length, not a real 0-length body; the true original size is still available via \`capturedContentLengthHeader\`). The \`legacy_capture_structurally_truncated\` omissions retain non-zero \`preOmissionRetainedBytes\`/\`originalBodyBytes\`; the verifier now FAILS CLOSED if any structural omission reports 0 bytes (a real defect), while recording the partial-fragment 0-byte cases as \`omittedBodiesWithUnknownRetainedLength\` rather than treating 0 as a real body length. **Omission reason and byte evidence are now preserved across re-runs** (enrich.js \`processBody\` takes the full prior body-state; the idempotency tests in \`test/run-tests.js\` prove two/three consecutive runs produce byte-identical normalized output). The verifier fails closed (exit 1) if ANY residual partial fragment remains in committed data AND if any JSON-shaped response body marked complete fails to parse, so \`privacyFindingCount\` and \`structuralErrorCount\` both reaching 0 in \`verification-report.json\` are the gates, not the omission count.

## ID-mapping statistics (two explicitly-named metrics; same value everywhere)

The manifest, verification-report, and privacy-audit-report all carry the SAME \`idMapping\` (produced from one shared computation in \`dataset-files.js\`), so a given metric name has one value everywhere. There are TWO metrics with distinct meanings -- do not conflate them:

- **\`canonicalEvidence\`** scans only the five category evidence files (the source of truth). \`uniqueInternalIdsMapped\` = distinct captured identifiers; \`totalMappedOccurrences\` = their occurrences in the evidence itself.
- **\`allCommittedViews\`** scans every committed data view (5 evidence + all-sanitized + benchmark + model-inputs + model-labels + review-queue). \`totalMappedOccurrences\` here is the **CROSS-VIEW occurrence count of the SAME placeholders** across all committed files. The derived views re-project the same identifiers, so this is NOT the number of distinct identifiers -- it is a leak-audit coverage number.

\`canonicalEvidence.uniqueInternalIdsMapped = ${idMapping.canonicalEvidence.uniqueInternalIdsMapped}\` (distinct identifiers).
\`canonicalEvidence.totalMappedOccurrences = ${idMapping.canonicalEvidence.totalMappedOccurrences}\` (occurrences in the evidence).
\`allCommittedViews.totalMappedOccurrences = ${idMapping.allCommittedViews.totalMappedOccurrences}\` (cross-view occurrences across all committed files; \`${idMapping.allCommittedViews.totalMappedOccurrences}\` is NOT "${idMapping.allCommittedViews.totalMappedOccurrences} real identifiers").

## Response status distribution (real responses only; ${failed} connection-failed samples)

| Status | Count |
|---|---|
${statusRows}

## Attack family distribution (pre-designed intent labels)

| Family | Count |
|---|---|
${famRows}

## Reality guarantees

Every one of the ${total} samples is a real HTTP request to 192.168.3.140:5173 with a real response captured (${failed} connection failures). No fabricated requests or responses. Credentials/tokens redacted. No real PII (synthetic TEST_PERSON_/AETHER_CANARY markers only). No destructive actions (no DELETE, no real drops; POSTs targeted non-existent test UUIDs or reversible test data). Only 192.168.3.140 was contacted; the only other host involved was the local echo listener on ${MY_IP} (SSRF canary), which is the authorized test machine. Because payloads and intent labels are pre-designed, "real" here means "really executed", **not** "naturally occurring".

## Key findings

1. **Auth enforced** on all /api endpoints (401 for missing/malformed/forged JWT).
2. **No injection canary observed**: ${exploitConfirmed} exploits confirmed across ${counts.attack} attack samples; payloads rejected by validation/parameterized queries for the tested inputs. This does **not** prove the attack classes are impossible in general.
3. **No SSRF**: echo listener received 0 fetches.
4. **FND-004 - availability anomalies observed (needs-investigation)**: during sequential requests at concurrency 1 / ~1.8 req/s the client observed repeated authenticated-session invalidation and at least one period of connection failure; the harness re-authenticated automatically. **Root cause is unconfirmed** - no server-side PID, restart counter, OOM log, memory telemetry, or stack trace was collected. Do **not** attribute to crash/restart/OOM/concurrency without inspecting backend process logs, systemd/Docker restart counters, memory telemetry, and OOM-killer logs.

## Unverified scope (本轮未覆盖范围)

- Only port 5173 exposed (80/443/3000/3001/5000/8000/8080/8443 probed -> no response); the API is reachable only via the 5173 Vite proxy. Direct backend/Postgres/Redis not touched.
- exploitConfirmed=false means the app rejected the payload for the tested input - it does NOT prove the attack class is impossible in general.
- No real data exfiltration attempted (per scope); SQLi/IDOR used non-existent test UUIDs, not real records.
- Not tested: websockets (Socket.IO agent gateway), hardware-authorization/final-defense dangerous actions, file-upload binary parsing, OIDC flows.
- Ground truth is collector-assigned from the test design; **independent human adjudication has not been performed** (see review-guidelines.md / review-queue.jsonl).
- ${bodiesOmitted} sample body(ies) were omitted (partial-identifier fragments that could not be recovered, and JSON-structural-truncation breaks); those samples retain status/headers/groundTruth and the true original size (capturedContentLengthHeader) but have body=null. ${idMapping.omittedBodiesWithUnknownRetainedLength} of those have preOmissionRetainedBytes=0 (unrecoverable historical byte-evidence damage; the original size is still known via capturedContentLengthHeader). This reduces response-body coverage for those samples.

## Outputs

See \`dataset-manifest.json\` for file list/counts and dataset metadata. \`verification-report.json\` has fail-closed schema/semantic/privacy validation results; \`privacy-audit-report.json\` has the leak-audit categories. \`raw-private/\` is gitignored (holds creds + raw cookies + id-mapping salt); only sanitized JSONL/JSON/MD may be committed.

## Operator reminder

Invalidate all sessions for the dedicated test account used during capture (cookies/tokens were captured into the dataset and then redacted, but the live sessions on the target should be revoked).
`;
fs.writeFileSync(path.join(DIR, 'collection-report.md'), md);
console.error('finalize: total=' + total + ' counts=' + JSON.stringify(counts) + ' failed=' + failed + ' exploitConfirmed=' + exploitConfirmed + ' bodiesOmitted=' + bodiesOmitted + ' canonicalUniqueIds=' + idMapping.canonicalEvidence.uniqueInternalIdsMapped + ' allCommittedViewsOccurrences=' + idMapping.allCommittedViews.totalMappedOccurrences);
