#!/usr/bin/env node
'use strict';
// Regenerate the VIguard LAN challenge-capture dataset with the hardened sanitizer.
//
// Reads the previously captured per-category JSONL evidence files, re-sanitizes every
// sample with sanitize.js, then:
//   - Safely OMITS any body that contains a partial (truncated) identifier fragment.
//     raw-private/ holds no raw response bodies, so truncated fragments cannot be
//     recovered; they are removed (bodyOmitted=true) rather than kept or guessed.
//   - Adds bodyTruncated / originalBodyBytes / retainedBodyBytes metadata.
//   - Enriches with requestIntent / exploitOutcome / datasetMetadata / isHardNegative.
//   - Builds the model benchmark in the input/labels/metadata shape (labels physically
//     separated from input so a whitelist builder can serialize input-only prompts).
//   - Emits model-inputs.jsonl (sampleId + input ONLY) and model-labels.jsonl
//     (sampleId + labels + metadata) for process-level isolation at eval time.
//
// This does NOT contact the target. It is a pure local transform of already-captured
// evidence. Re-running is idempotent because sanitization is stable-mapped (HMAC + salt).

const fs = require('fs');
const path = require('path');
const S = require('./sanitize');
const { deepSanitize, sanitizeHeaders, sanitizeString, safeTruncate, auditText, mappingMethod, hasSalt } = S;
const { CATEGORY_FILE_MAP, ALLOWED_OMISSION_REASONS } = require('./dataset-files');

const DIR = __dirname;
const FILES = CATEGORY_FILE_MAP;

const DATASET_METADATA = {
  split: 'external_challenge_test',
  eligibleForTraining: false,
  humanReviewed: false,
  reviewerCount: 0,
  interAnnotatorAgreement: null,
  cohenKappa: null,
  adjudicatedSamples: 0,
  targetSpecific: true,
};

// Fail closed: real-evidence regeneration requires the dataset-local salt. This check lives in
// main() (not at module load) so test/run-tests.js can require this module to unit-test
// processBody() idempotency WITHOUT triggering a regeneration or a salt-required exit.
function requireSaltOrExit() {
  if (!hasSalt() && !S.isTestMode()) {
    console.error('enrich.js: FAIL CLOSED - no raw-private/.id-salt and not in SANITIZER_TEST_MODE.');
    console.error('  Create one: node -e "require(\'fs\').writeFileSync(\'raw-private/.id-salt\',require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
}

// Safety footgun guard: SANITIZER_TEST_MODE maps identifiers with a PUBLIC synthetic salt. That
// is fine for a TEMP fixture (the idempotency test runs the pipeline on a temp copy created by
// copyForPipeline under os.tmpdir() that carries a .synthetic-regeneration-fixture marker), but it
// MUST NOT run on the REAL committed data directory - doing so would re-sanitize the real evidence
// with a public salt, silently bypassing the fail-closed salt design (the very defect Round-5
// fixed). Refuse unless ALL THREE hold: (1) SANITIZER_TEST_MODE=true, (2) the working dir is under
// os.tmpdir(), AND (3) a .synthetic-regeneration-fixture marker file is present (created only by
// copyForPipeline). Requiring BOTH the tmpdir location AND the marker closes two paths: running on
// the real committed dir (not tmp, no marker), AND a real repo cloned under /tmp (under tmpdir, but
// no marker - the directory LOCATION alone is not sufficient evidence that this is a throwaway
// synthetic fixture). An explicit ALLOW_SYNTHETIC_REGEN=true override still forces it (intentional
// synthetic regen only). This closes the `SANITIZER_TEST_MODE=true node enrich.js`-on-the-real-dir
// path AND the `/tmp`-cloned-real-repo path.
const SYNTHETIC_FIXTURE_MARKER = '.synthetic-regeneration-fixture';
function refuseTestModeInRealDir() {
  if (!S.isTestMode() || process.env.ALLOW_SYNTHETIC_REGEN === 'true') return;
  const os = require('os');
  const realDir = path.resolve(DIR);
  const tmpRoot = path.resolve(os.tmpdir());
  const isTemp = realDir === tmpRoot || realDir.startsWith(tmpRoot + path.sep);
  const hasMarker = fs.existsSync(path.join(DIR, SYNTHETIC_FIXTURE_MARKER));
  if (!isTemp || !hasMarker) {
    console.error('enrich.js: REFUSING to run in SANITIZER_TEST_MODE on ' + realDir +
      ': test mode uses a PUBLIC synthetic salt and would re-sanitize committed evidence with it, ' +
      'bypassing the fail-closed salt design. Test mode is only allowed on a copyForPipeline temp ' +
      'copy (under ' + tmpRoot + ' AND carrying a ' + SYNTHETIC_FIXTURE_MARKER + ' marker). ' +
      'Set ALLOW_SYNTHETIC_REGEN=true to force (intentional synthetic regen only). ' +
      '[isTemp=' + isTemp + ' marker=' + hasMarker + ']');
    process.exit(1);
  }
}

function deriveIntentOutcome(cat) {
  let requestIntent, exploitOutcome;
  if (cat === 'attack') { requestIntent = 'malicious_attempt'; exploitOutcome = 'not_confirmed'; }
  else if (cat === 'promptInjection') { requestIntent = 'prompt_injection_attempt'; exploitOutcome = 'not_confirmed'; }
  else if (cat === 'hardNegative') { requestIntent = 'benign_resembling_attack'; exploitOutcome = 'not_applicable'; }
  else if (cat === 'unknown') { requestIntent = 'ambiguous_or_inconclusive'; exploitOutcome = 'not_applicable'; }
  else { requestIntent = 'benign_operational'; exploitOutcome = 'not_applicable'; }
  return { requestIntent, exploitOutcome };
}

function readJsonl(fp) {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Check a body string for partial-identifier fragments (truncated UUIDs, raw sensitive
// key-values). Returns the list of findings (empty = clean).
function bodyFindings(body) {
  if (body == null) return [];
  return auditText(String(body), 'body').filter(f =>
    f.indicator === 'partial-uuid-fragment' ||
    f.indicator === 'source-raw-id-value' ||
    f.indicator === 'findingId-raw-value' ||
    f.indicator === 'userId-raw-value' ||
    f.indicator === 'tenantId-raw-value' ||
    f.indicator === 'sessionId-raw-value' ||
    f.indicator === 'sessionId-partial-value' ||
    f.indicator === 'token-raw-value' ||
    f.indicator === 'partial-jwt' ||
    f.indicator === 'hex-session-tail'
  );
}

let bodiesOmitted = 0;
const omittedSampleIds = [];

// Whether a body should be treated as JSON for structural-integrity checking. The
// Content-Type header is authoritative when present; otherwise a body that starts like a
// JSON object/array is treated as JSON.
function looksLikeJson(body, headers) {
  const ct = (headers && (headers['content-type'] || headers['Content-Type'])) || '';
  if (/json/i.test(ct)) return true;
  if (body != null && /^\s*[\[{]/.test(String(body))) return true;
  return false;
}
// Read the Content-Length header (Node lowercases response headers; collect.js sets the
// request header as "Content-Length"). Returns a non-negative integer or null.
function getContentLength(headers) {
  if (!headers) return null;
  const v = headers['content-length'] || headers['Content-Length'];
  const n = v == null ? NaN : parseInt(String(v), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Process a body for the committed dataset. `previous` is the FULL prior body-state object
// (bodyTruncated / bodyOmitted / bodyOmittedReason / capturedContentLengthHeader /
// preOmissionRetainedBytes / originalBodyBytes / retainedBodyBytes), so re-running enrich is
// IDEMPOTENT: a body already dropped to null (because a prior run found an unrecoverable fragment
// or structural break and omitted it) STAYS omitted with its ORIGINAL reason and byte evidence,
// instead of being reclassified and reset. The prior signature passed only `wasOmitted===true`,
// which forced every already-omitted body through one branch that reset bodyOmittedReason to
// legacy_capture_truncated_before_complete_sanitization and zeroed preOmissionRetainedBytes /
// originalBodyBytes -- destroying the structural-truncation reason and the captured-size evidence
// (see test/run-tests.js idempotency tests 1-4).
// `capturedContentLengthHeader` is the live Content-Length from the headers (fallback when the
// prior-run preserved value is absent, e.g. on the first run from raw capture).
// `isResponse` scopes the JSON structural-integrity check to RESPONSE bodies only: request
// bodies in the unknown-cases category are INTENTIONALLY malformed JSON (ambiguous-intent
// samples) and must not be omitted merely for failing to parse.
function normalizeLength(v) {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function processBody(body, previous, capturedContentLengthHeader, isResponse) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  // capturedContentLengthHeader: prefer the prior-run preserved value (so an omitted body never
  // loses its true original size across re-runs); fall back to the live Content-Length.
  const clh = normalizeLength(prev.capturedContentLengthHeader) != null
    ? normalizeLength(prev.capturedContentLengthHeader)
    : normalizeLength(capturedContentLengthHeader);

  // IDEMPOTENT preserve: body already omitted by a prior run. Keep its reason + byte evidence.
  // Never reclassify the reason, never zero valid non-zero bytes, never regenerate the body.
  if (body == null && prev.bodyOmitted === true) {
    const preservedOriginalBytes =
      normalizeLength(prev.originalBodyBytes) ??
      normalizeLength(prev.preOmissionRetainedBytes) ??
      0;
    const preservedPreOmissionBytes =
      normalizeLength(prev.preOmissionRetainedBytes) ??
      preservedOriginalBytes;
    // Preserve the explicit prior reason verbatim if it is a known enum value; otherwise fall
    // back to legacy_capture_omitted_reason_unknown. NEVER fabricate a different explicit reason
    // and NEVER downgrade an existing explicit reason to a different one.
    const reason = ALLOWED_OMISSION_REASONS.includes(prev.bodyOmittedReason)
      ? prev.bodyOmittedReason
      : 'legacy_capture_omitted_reason_unknown';
    return {
      body: null,
      bodyTruncated: prev.bodyTruncated === true,
      bodyOmitted: true,
      bodyOmittedReason: reason,
      capturedContentLengthHeader: clh,
      preOmissionRetainedBytes: preservedPreOmissionBytes,
      originalBodyBytes: preservedOriginalBytes,
      retainedBodyBytes: 0,
    };
  }

  if (body == null) {
    // body was legitimately null (e.g. a GET with no body, or a 204) - NOT an omission.
    return { body: null, bodyTruncated: false, bodyOmitted: false, bodyOmittedReason: null, capturedContentLengthHeader: clh, preOmissionRetainedBytes: 0, originalBodyBytes: 0, retainedBodyBytes: 0 };
  }
  // Re-sanitize the already-committed body (catches any residual full identifiers; also
  // normalizes any [[PREFIX_HEX] malformed placeholders back to [PREFIX_ID_HEX]).
  const sanitized = sanitizeString(String(body));
  const preOmissionBytes = Buffer.byteLength(sanitized, 'utf8');
  // (a) Partial (truncated) identifier fragment that cannot be recovered (raw-private has no
  //     raw bodies) -> safely OMIT.
  const findings = bodyFindings(sanitized);
  if (findings.length > 0) {
    return { body: null, bodyTruncated: false, bodyOmitted: true, bodyOmittedReason: 'legacy_capture_truncated_before_complete_sanitization', capturedContentLengthHeader: clh, preOmissionRetainedBytes: preOmissionBytes, originalBodyBytes: preOmissionBytes, retainedBodyBytes: 0 };
  }
  // (b) Safe truncation on the sanitized body (handles oversized bodies; sets bodyTruncated
  //     =true when it cuts at the UTF-8 code-point boundary).
  const t = safeTruncate(sanitized, S.MAX_BODY_BYTES);
  // (c) Structural integrity (RESPONSE bodies only): a body that is JSON-shaped and was NOT
  //     truncated by us (so it is expected to be complete) MUST parse. A parse failure here
  //     means the body was structurally truncated by the OLD collector (cut to ~4000 chars
  //     mid-string) but never marked truncated -> OMIT rather than ship a half-JSON body
  //     marked complete (bodyTruncated=false). Bodies we ourselves truncated are honestly
  //     marked bodyTruncated=true; a truncated JSON body is expected not to parse, so the
  //     parse requirement is skipped for those.
  if (isResponse && !t.truncated && looksLikeJson(t.text)) {
    try { JSON.parse(t.text); }
    catch (e) {
      return { body: null, bodyTruncated: false, bodyOmitted: true, bodyOmittedReason: 'legacy_capture_structurally_truncated', capturedContentLengthHeader: clh, preOmissionRetainedBytes: preOmissionBytes, originalBodyBytes: preOmissionBytes, retainedBodyBytes: 0 };
    }
  }
  return { body: t.text, bodyTruncated: t.truncated, bodyOmitted: false, bodyOmittedReason: null, capturedContentLengthHeader: clh, preOmissionRetainedBytes: t.retainedBytes, originalBodyBytes: t.originalBytes, retainedBodyBytes: t.retainedBytes };
}

function main() {
  requireSaltOrExit();
  refuseTestModeInRealDir();
  const counts = {};
  const allSanitized = [];
  const benchmark = [];
  const modelInputs = [];
  const modelLabels = [];
  const reviewQueue = [];
  const idOrder = [];

  for (const [cat, file] of Object.entries(FILES)) {
    const raw = readJsonl(path.join(DIR, file));
    const outLines = [];
    for (const original of raw) {
      const s = deepSanitize(original);
      // Headers: apply the stricter header drop list on top.
      if (s.requestSanitized) {
        if (s.requestSanitized.headers) s.requestSanitized.headers = sanitizeHeaders(s.requestSanitized.headers);
        // Process request body: omit if partial fragments, else safe-truncate. Preserve prior omission.
        // isResponse=false: request bodies (incl. intentionally-malformed unknown-cases JSON) are NOT
        // structurally integrity-checked - their malformation is the signal, not a defect.
        const rqClh = getContentLength(s.requestSanitized.headers);
        const rb = processBody(s.requestSanitized.body, s.requestSanitized, rqClh, false);
        s.requestSanitized.body = rb.body;
        s.requestSanitized.bodyTruncated = rb.bodyTruncated;
        s.requestSanitized.originalBodyBytes = rb.originalBodyBytes;
        s.requestSanitized.retainedBodyBytes = rb.retainedBodyBytes;
        s.requestSanitized.bodyOmitted = rb.bodyOmitted;
        s.requestSanitized.bodyOmittedReason = rb.bodyOmittedReason;
        s.requestSanitized.capturedContentLengthHeader = rb.capturedContentLengthHeader;
        s.requestSanitized.preOmissionRetainedBytes = rb.preOmissionRetainedBytes;
        if (rb.bodyOmitted) { bodiesOmitted++; omittedSampleIds.push(s.sampleId); }
      }
      if (s.responseSanitized) {
        if (s.responseSanitized.headers) s.responseSanitized.headers = sanitizeHeaders(s.responseSanitized.headers);
        // isResponse=true: response bodies ARE structurally integrity-checked - a JSON-shaped
        // response body marked complete (bodyTruncated=false, bodyOmitted=false) that fails to
        // parse was structurally truncated by the old collector and is OMITTED, not kept half-JSON.
        const rsClh = getContentLength(s.responseSanitized.headers);
        const rb = processBody(s.responseSanitized.body, s.responseSanitized, rsClh, true);
        s.responseSanitized.body = rb.body;
        s.responseSanitized.bodyTruncated = rb.bodyTruncated;
        s.responseSanitized.originalBodyBytes = rb.originalBodyBytes;
        s.responseSanitized.retainedBodyBytes = rb.retainedBodyBytes;
        s.responseSanitized.bodyOmitted = rb.bodyOmitted;
        s.responseSanitized.bodyOmittedReason = rb.bodyOmittedReason;
        s.responseSanitized.capturedContentLengthHeader = rb.capturedContentLengthHeader;
        s.responseSanitized.preOmissionRetainedBytes = rb.preOmissionRetainedBytes;
        if (rb.bodyOmitted && !omittedSampleIds.includes(s.sampleId)) { bodiesOmitted++; omittedSampleIds.push(s.sampleId); }
      }
      const { requestIntent, exploitOutcome } = deriveIntentOutcome(cat);
      s.requestIntent = requestIntent;
      s.exploitOutcome = exploitOutcome;
      s.isHardNegative = cat === 'hardNegative';
      s.datasetMetadata = DATASET_METADATA;
      outLines.push(JSON.stringify(s));
      allSanitized.push(s);
      idOrder.push(s.sampleId);

      // Build benchmark in input/labels/metadata shape (labels physically separated).
      const rs = s.requestSanitized || {};
      const input = {
        method: s.method,
        path: s.path,
        headers: Object.assign({}, rs.headers || {}),
        body: rs.body != null ? rs.body : null,
        sourceContext: {
          authenticated: rs.hasAuthCookie === true,
          targetApplication: s.targetApplication,
        },
      };
      const labels = {
        verdict: s.groundTruth.verdict,
        attackFamily: s.groundTruth.attackFamily,
        recommendedAction: s.groundTruth.recommendedAction,
        contextSufficient: s.groundTruth.contextSufficient,
        requestIntent,
        exploitOutcome,
        isHardNegative: s.isHardNegative,
      };
      benchmark.push({ sampleId: s.sampleId, input, labels, metadata: DATASET_METADATA });
      modelInputs.push({ sampleId: s.sampleId, input });
      modelLabels.push({ sampleId: s.sampleId, labels, metadata: DATASET_METADATA });
      // Review queue: full de-labeled REQUEST input so a reviewer can judge intent from
      // request-side evidence (e.g. the X-Note prompt-injection header that distinguishes
      // otherwise-identical GET /api/auth/me samples). Withholds collector category, labels,
      // responseStatus/body, execution outcome. `input` is the SAME object used for the
      // benchmark (no label/response field can leak because it is pre-request only).
      reviewQueue.push({ sampleId: s.sampleId, input, reviewerA: null, reviewerB: null, adjudication: null });
    }
    counts[cat] = outLines.length;
    fs.writeFileSync(path.join(DIR, file), outLines.join('\n') + (outLines.length ? '\n' : ''));
  }

  // Order by numeric sample id for deterministic diffs.
  const num = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  allSanitized.sort((a, b) => num(a.sampleId) - num(b.sampleId));
  benchmark.sort((a, b) => num(a.sampleId) - num(b.sampleId));
  modelInputs.sort((a, b) => num(a.sampleId) - num(b.sampleId));
  modelLabels.sort((a, b) => num(a.sampleId) - num(b.sampleId));
  reviewQueue.sort((a, b) => num(a.sampleId) - num(b.sampleId));

  fs.writeFileSync(path.join(DIR, 'all-sanitized.jsonl'), allSanitized.map(s => JSON.stringify(s)).join('\n') + (allSanitized.length ? '\n' : ''));
  fs.writeFileSync(path.join(DIR, 'model-benchmark.jsonl'), benchmark.map(s => JSON.stringify(s)).join('\n') + (benchmark.length ? '\n' : ''));
  fs.writeFileSync(path.join(DIR, 'model-inputs.jsonl'), modelInputs.map(s => JSON.stringify(s)).join('\n') + (modelInputs.length ? '\n' : ''));
  fs.writeFileSync(path.join(DIR, 'model-labels.jsonl'), modelLabels.map(s => JSON.stringify(s)).join('\n') + (modelLabels.length ? '\n' : ''));

  // Review queue (built per-sample above): each entry carries the full de-labeled REQUEST
  // input (method/path/headers/body/sourceContext) so a reviewer can independently judge
  // verdict/attackFamily/requestIntent/recommendedAction/contextSufficient/exploitOutcome
  // from request-side evidence. Labels, responseStatus/body, execution outcome, and collector
  // category are withheld. sampleId is a join key (never inside input).
  fs.writeFileSync(path.join(DIR, 'review-queue.jsonl'), reviewQueue.map(s => JSON.stringify(s)).join('\n') + (reviewQueue.length ? '\n' : ''));

  // Persist regeneration metadata so finalize.js / verify.js (separate processes that do NOT
  // call sanitizeString) can honestly report whether legacy sequential placeholders were
  // remapped during this run. legacyPlaceholderRemapped is MONOTONIC: once the dataset has
  // been through the legacy->HMAC migration it stays true across re-runs (a re-run finds
  // nothing left to remap, but the migration still happened). residualLegacySequential in the
  // verifier stats independently confirms the final files contain ZERO legacy-format placeholders.
  let priorMeta = null;
  try { priorMeta = JSON.parse(fs.readFileSync(path.join(DIR, 'regeneration-meta.json'), 'utf8')); } catch (e) { /* first run */ }
  const legacyRemappedNow = S.legacyRemapped();
  const legacyRemappedEver = legacyRemappedNow || !!(priorMeta && priorMeta.legacyPlaceholderRemapped);
  fs.writeFileSync(path.join(DIR, 'regeneration-meta.json'), JSON.stringify({
    regeneratedAt: new Date().toISOString(),
    idMappingMethod: mappingMethod,
    saltedIdMapping: hasSalt(),
    legacyPlaceholderRemapped: legacyRemappedEver,
    legacyRemappedThisRun: legacyRemappedNow,
    bodiesOmitted,
    omittedSampleCount: omittedSampleIds.length,
    omittedSampleIds,
    note: 'legacyPlaceholderRemapped=true means prior sequential [PREFIX_NNNN] placeholders were re-mapped through HMAC(salt, "legacy:"+old) at some point. The original resource id is gone; the remap is opaque, not a recovery. legacyRemappedThisRun shows whether THIS run performed any remap; residualLegacySequential in the verifier stats MUST be 0 (confirms no legacy-format placeholders remain).',
  }, null, 2));

  console.error('REGENERATE ' + JSON.stringify({
    regeneratedAt: new Date().toISOString(),
    idMappingMethod: mappingMethod,
    saltedIdMapping: hasSalt(),
    legacyPlaceholderRemapped: legacyRemappedEver,
    legacyRemappedThisRun: legacyRemappedNow,
    counts,
    total: allSanitized.length,
    benchmarkSamples: benchmark.length,
    bodiesOmitted,
    omittedSampleIds: omittedSampleIds.slice(0, 30),
  }));
}

// Run only when executed directly (not when required by the test suite for processBody tests).
if (require.main === module) main();

// Exported for unit-testing processBody() idempotency (test/run-tests.js) WITHOUT triggering a
// full regeneration. main() runs only when this file is executed directly.
module.exports = { processBody, normalizeLength, ALLOWED_OMISSION_REASONS };
