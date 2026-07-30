#!/usr/bin/env node
'use strict';
// Fail-closed verifier for the VIguard LAN challenge-capture dataset.
//
// Exit code is NON-ZERO if ANY of these hold (no "print and continue"):
//   - a JSONL line cannot be parsed
//   - a sample fails its JSON Schema (evidence / benchmark / model-input / model-label
//     / manifest) - the benchmark schema deliberately REJECTS the legacy flat structure
//   - a cross-field semantic rule is violated (verdict/family/action/intent/consistency)
//   - a per-file consistency rule is violated (attack file has no benign, etc.)
//   - a duplicate sampleId exists
//   - a red-line privacy indicator is found in any committed DATA file: full OR PARTIAL
//     identifiers (truncated UUID prefix, sessionId/token half, sensitive key + non-placeholder
//     value, partial JWT). ANY residual partial fragment makes the verifier exit non-zero.
//   - a benchmark sample's `input` contains any label/post-response field (label leakage)
//   - model-inputs.jsonl / model-labels.jsonl sampleId sets disagree with the benchmark
//   - manifest counts disagree with actual file line counts
//   - all-sanitized.jsonl does not equal the union of the five category files
//   - any sample is marked eligibleForTraining=true or a non external_challenge_test split
//
// On full success it prints "PASS" and exits 0. Otherwise "FAIL" and exits 1.

const fs = require('fs');
const path = require('path');
const { auditText } = require('./sanitize');
const { buildIdMappingReport, CATEGORY_FILE_MAP, ALLOWED_OMISSION_REASONS } = require('./dataset-files');

const DIR = __dirname;
const FILES = CATEGORY_FILE_MAP;
const CATEGORY_RULE = {
  normal: s => s.groundTruth.verdict === 'benign',
  attack: s => s.groundTruth.verdict === 'attack',
  hardNegative: s => s.groundTruth.verdict === 'benign' && s.isHardNegative === true,
  promptInjection: s => s.groundTruth.attackFamily === 'prompt_injection',
  unknown: s => s.groundTruth.verdict === 'unknown',
};
// Label / post-response fields that must NEVER appear inside `benchmark.input`.
const INPUT_FORBIDDEN = [
  'responseStatus', 'responseSanitized', 'responseHeaders', 'responseBody',
  'latencyMs', 'executionEvidence', 'canaryObserved', 'exploitConfirmed',
  'exploitAttempted', 'responseActuallyReceived', 'targetIp', 'safety', 'evidenceSummary',
  'verdict', 'attackFamily', 'recommendedAction', 'contextSufficient', 'requestIntent',
  'exploitOutcome', 'isHardNegative', 'groundTruth', 'labels', 'metadata',
  'split', 'eligibleForTraining', 'humanReviewed', 'reviewerCount', 'cohenKappa',
  'interAnnotatorAgreement', 'adjudicatedSamples', 'targetSpecific', 'source',
];
// Legacy flat top-level fields that must NOT exist on a benchmark record (must be input/labels/metadata).
const BENCHMARK_FLAT_FORBIDDEN = [
  'method', 'path', 'headers', 'body', 'sourceContext', 'requestIntent',
  'groundTruth', 'datasetMetadata', 'responseStatus', 'responseSanitized',
];

// ---------- AJV (prefer challenge-dataset-pinned copy; draft 2020-12) ----------
let Ajv2020;
const candidates = [
  'ajv/dist/2020',
  path.join(__dirname, 'node_modules', 'ajv', 'dist', '2020.js'),
  path.join(__dirname, '..', '..', '..', 'backend', 'node_modules', 'ajv', 'dist', '2020.js'),
];
for (const c of candidates) {
  if (Ajv2020) break;
  try { const m = require(c); Ajv2020 = m.default || m; } catch (e) { /* try next */ }
}

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, 'schema', name), 'utf8'));
}

function readJsonl(fp) {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
}

// ---------- semantic (cross-field) rules on an evidence sample ----------
function semanticErrors(s) {
  const errs = [];
  const gt = s.groundTruth || {};
  const ev = s.executionEvidence || {};
  const v = gt.verdict, fam = gt.attackFamily, act = gt.recommendedAction;

  if (v === 'attack') {
    if (fam == null) errs.push('attack verdict but attackFamily is null');
    if (!['block', 'review', 'monitor'].includes(act)) errs.push(`attack verdict but recommendedAction=${act}`);
  }
  if (v === 'benign' && fam != null) errs.push(`benign verdict but attackFamily=${fam}`);
  if (v === 'unknown') {
    if (gt.contextSufficient !== false) errs.push('unknown verdict but contextSufficient!=false');
    if (!['review', 'monitor'].includes(act)) errs.push(`unknown verdict but recommendedAction=${act}`);
  }
  if ((v === 'attack' || fam === 'prompt_injection') && s.requestIntent !== 'malicious_attempt' && s.requestIntent !== 'prompt_injection_attempt') {
    errs.push(`attack/PI sample but requestIntent=${s.requestIntent}`);
  }
  if (s.isHardNegative === true && s.requestIntent !== 'benign_resembling_attack') {
    errs.push(`hard-negative but requestIntent=${s.requestIntent}`);
  }
  if (s.responseActuallyReceived === true && !(s.responseStatus > 0)) errs.push('responseActuallyReceived=true but responseStatus<=0');
  if (s.responseActuallyReceived === false && s.responseStatus !== 0) errs.push('responseActuallyReceived=false but responseStatus!=0');
  if (ev.exploitConfirmed === true && ev.exploitAttempted !== true) errs.push('exploitConfirmed=true but exploitAttempted!=true');
  if (ev.canaryObserved === true && ev.exploitAttempted !== true) errs.push('canaryObserved=true but exploitAttempted!=true');
  if (ev.exploitConfirmed === true && s.exploitOutcome !== 'confirmed') errs.push('exploitConfirmed=true but exploitOutcome!=confirmed');
  if (s.requestActuallySent !== true) errs.push('requestActuallySent!=true');
  const dm = s.datasetMetadata || {};
  if (dm.eligibleForTraining !== false) errs.push('datasetMetadata.eligibleForTraining!=false');
  if (dm.split !== 'external_challenge_test') errs.push(`datasetMetadata.split=${dm.split}`);
  return errs;
}

function main() {
  const schemaErrors = [];
  const semanticErrs = [];
  const privacyFindings = [];
  const dupIds = [];
  const benchmarkLeak = [];
  const alignmentErrors = [];
  const manifestErrors = [];
  const structuralErrs = [];
  const reviewQueueErrs = [];
  const bodyOmissionErrs = [];
  const seenIds = new Set();
  const counts = {};
  const statusDist = {};
  let total = 0, exploitConfirmed = 0, canaryObserved = 0, bodiesOmitted = 0;
  const unionIds = [];
  const samples = [];

  let evValidate = null, bmValidate = null, miValidate = null, mlValidate = null, mfValidate = null;
  if (Ajv2020) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    evValidate = ajv.compile(loadSchema('evidence-sample.schema.json'));
    bmValidate = ajv.compile(loadSchema('benchmark-sample.schema.json'));
    miValidate = ajv.compile(loadSchema('model-input-sample.schema.json'));
    mlValidate = ajv.compile(loadSchema('model-label-sample.schema.json'));
    mfValidate = ajv.compile(loadSchema('manifest.schema.json'));
  } else {
    schemaErrors.push('AJV (draft 2020-12) not available; cannot run schema validation (run `npm install` in ml/data/lan_challenge_capture)');
  }

  const ajvErrs = (validate, obj) => {
    if (!validate) return [];
    const ok = validate(obj);
    return ok ? [] : (validate.errors || []).map(e => `${e.instancePath || '(root)'} ${e.message}`);
  };

  // ---- per-category evidence files ----
  for (const [cat, file] of Object.entries(FILES)) {
    const lines = readJsonl(path.join(DIR, file));
    counts[cat] = lines.length;
    for (const line of lines) {
      let s;
      try { s = JSON.parse(line); } catch (e) { schemaErrors.push(`${file}: unparseable JSON line`); continue; }
      total++;
      samples.push(s);
      unionIds.push(s.sampleId);
      if (seenIds.has(s.sampleId)) dupIds.push(s.sampleId); else seenIds.add(s.sampleId);
      for (const m of ajvErrs(evValidate, s)) schemaErrors.push(`${s.sampleId || '?'} [schema] ${m}`);
      for (const m of semanticErrors(s)) semanticErrs.push(`${s.sampleId || '?'} ${m}`);
      if (!CATEGORY_RULE[cat](s)) semanticErrs.push(`${s.sampleId || '?'} violates ${cat} file-consistency rule`);
      // Structural integrity: a RESPONSE body marked complete (bodyTruncated=false, bodyOmitted=false)
      // that is JSON-shaped MUST parse. Catches old-collector structural truncation mislabeled as
      // complete -- the body was cut to ~4000 chars mid-string before sanitization broke JSON.parse,
      // but bodyTruncated stayed false (a false PASS). Scoped to RESPONSE bodies: phase6_unknown
      // intentionally constructs malformed JSON REQUEST bodies as ambiguous-intent signals.
      const _rs = s.responseSanitized;
      if (_rs && _rs.bodyOmitted === false && _rs.bodyTruncated === false && _rs.body != null) {
        const _ct = (_rs.headers && (_rs.headers['content-type'] || _rs.headers['Content-Type'])) || '';
        if (/json/i.test(_ct) || /^\s*[\[{]/.test(String(_rs.body))) {
          try { JSON.parse(_rs.body); }
          catch (e) { structuralErrs.push(`${s.sampleId || '?'} response body is JSON-shaped and marked complete (bodyTruncated=false,bodyOmitted=false) but JSON.parse fails: ${e.message}`); }
        }
      }
      const st = s.responseStatus; statusDist[st] = (statusDist[st] || 0) + 1;
      if (s.executionEvidence && s.executionEvidence.exploitConfirmed) exploitConfirmed++;
      if (s.executionEvidence && s.executionEvidence.canaryObserved) canaryObserved++;
      // bodiesOmitted is computed from the shared dataset-files.js path (liveIdMapping.bodiesOmitted)
      // below, so verify.js and finalize.js can never report different body-omission counts.
    }
  }

  // ---- all-sanitized == union of category files ----
  const allSan = readJsonl(path.join(DIR, 'all-sanitized.jsonl')).map(l => { try { return JSON.parse(l); } catch (e) { schemaErrors.push('all-sanitized.jsonl: unparseable line'); return null; } }).filter(Boolean);
  const allIds = allSan.map(s => s.sampleId).sort();
  const unionSorted = unionIds.slice().sort();
  if (JSON.stringify(allIds) !== JSON.stringify(unionSorted)) {
    manifestErrors.push(`all-sanitized.jsonl (${allIds.length} ids) != union of category files (${unionSorted.length} ids)`);
  }

  // ---- benchmark: schema + no label/post-response leakage into input + reject flat ----
  const bmLines = readJsonl(path.join(DIR, 'model-benchmark.jsonl'));
  if (bmLines.length !== total) manifestErrors.push(`model-benchmark.jsonl has ${bmLines.length} samples but evidence total is ${total}`);
  const bmIds = [];
  for (const line of bmLines) {
    let b; try { b = JSON.parse(line); } catch (e) { schemaErrors.push('model-benchmark.jsonl: unparseable line'); continue; }
    bmIds.push(b.sampleId);
    for (const m of ajvErrs(bmValidate, b)) schemaErrors.push(`${b.sampleId || '?'} [benchmark schema] ${m}`);
    // Reject legacy flat structure at top level.
    for (const f of BENCHMARK_FLAT_FORBIDDEN) if (f in b) benchmarkLeak.push(`${b.sampleId || '?'} has flat top-level field ${f} (legacy structure rejected)`);
    // No label/post-response field may live inside input.
    const input = b.input || {};
    for (const f of INPUT_FORBIDDEN) if (f in input) benchmarkLeak.push(`${b.sampleId || '?'} input contains forbidden field ${f}`);
    // sampleId must not be present in input (it is a join key, never a model feature).
    if ('sampleId' in input) benchmarkLeak.push(`${b.sampleId || '?'} input contains sampleId`);
  }

  // ---- model-inputs.jsonl: schema + no label fields; sampleId alignment with benchmark ----
  const miLines = readJsonl(path.join(DIR, 'model-inputs.jsonl'));
  const miIds = [];
  for (const line of miLines) {
    let mi; try { mi = JSON.parse(line); } catch (e) { schemaErrors.push('model-inputs.jsonl: unparseable line'); continue; }
    miIds.push(mi.sampleId);
    for (const m of ajvErrs(miValidate, mi)) schemaErrors.push(`${mi.sampleId || '?'} [model-input schema] ${m}`);
    const input = mi.input || {};
    for (const f of INPUT_FORBIDDEN) if (f in input) benchmarkLeak.push(`${mi.sampleId || '?'} model-input contains forbidden field ${f}`);
  }
  if (JSON.stringify(miIds.slice().sort()) !== JSON.stringify(bmIds.slice().sort())) {
    alignmentErrors.push(`model-inputs.jsonl (${miIds.length} ids) sampleId set != benchmark (${bmIds.length} ids)`);
  }

  // ---- model-labels.jsonl: schema; sampleId alignment with benchmark ----
  const mlLines = readJsonl(path.join(DIR, 'model-labels.jsonl'));
  const mlIds = [];
  for (const line of mlLines) {
    let ml; try { ml = JSON.parse(line); } catch (e) { schemaErrors.push('model-labels.jsonl: unparseable line'); continue; }
    mlIds.push(ml.sampleId);
    for (const m of ajvErrs(mlValidate, ml)) schemaErrors.push(`${ml.sampleId || '?'} [model-label schema] ${m}`);
    // model-labels must NOT carry an `input` field.
    if ('input' in ml) benchmarkLeak.push(`${ml.sampleId || '?'} model-label carries input (must be labels/metadata only)`);
  }
  if (JSON.stringify(mlIds.slice().sort()) !== JSON.stringify(bmIds.slice().sort())) {
    alignmentErrors.push(`model-labels.jsonl (${mlIds.length} ids) sampleId set != benchmark (${bmIds.length} ids)`);
  }

  // ---- ID-mapping + privacy + body-omission + malformed stats: SHARED computation ----
  // verify.js and finalize.js MUST compute the same id-mapping metrics from the same data via the
  // shared dataset-files.js buildIdMappingReport(). This eliminates the historical divergence
  // (verify.js scanned review-queue.jsonl -> 688 occurrences; finalize.js did not -> 596) by
  // making both callers use ONE code path. The report exposes TWO explicitly-named buckets:
  //   canonicalEvidence  - 5 category evidence files only (the actual captured evidence)
  //   allCommittedViews  - every committed derived view (incl. all-sanitized/benchmark/inputs/
  //                         labels/review-queue) = cross-view occurrences of the same placeholders
  // 688/596 are CROSS-VIEW occurrences of the same 10 distinct internal ids, NOT 688 distinct ids.
  const rqLines = readJsonl(path.join(DIR, 'review-queue.jsonl'));
  if (rqLines.length !== total) manifestErrors.push(`review-queue.jsonl has ${rqLines.length} entries but evidence total is ${total}`);
  const { idMapping: liveIdMapping, privacyFindings: dataPrivacy, malformedPlaceholderCount, partialPlaceholderCount, invalidPlaceholderCount, doubleBracketPlaceholderCount } = buildIdMappingReport(samples, rqLines.length);
  for (const f of dataPrivacy) privacyFindings.push(f);

  // Prose scan: manifest + README may carry residual identifiers in prose (partial-uuid
  // detection still applies). These are SEPARATE from the data-file residuals tallied inside
  // buildIdMappingReport (which describe the committed data only) -- prose findings are pushed
  // here so they still count toward privacyFindings / the fail gate, but are NOT re-counted as
  // data residuals.
  for (const name of ['dataset-manifest.json', 'README.md']) {
    const fp = path.join(DIR, name);
    if (fs.existsSync(fp)) {
      const txt = fs.readFileSync(fp, 'utf8');
      for (const finding of auditText(txt, name)) privacyFindings.push(finding);
    }
  }
  const malformedPlaceholders = malformedPlaceholderCount;

  // Fail closed: after a salted regeneration there must be ZERO residual legacy sequential
  // placeholders in the committed data. A non-zero count means a sequential placeholder
  // survived remapping (incomplete sanitization / inconsistent id-mapping format).
  if (liveIdMapping.residualLegacySequential > 0) {
    manifestErrors.push(`${liveIdMapping.residualLegacySequential} residual legacy sequential placeholders [PREFIX_NNNN] in committed data (remapping incomplete; id-mapping format inconsistent)`);
  }
  // Fail closed on malformed double-bracket placeholders [[PREFIX_HEX] left by a prior buggy
  // legacy-remap. buildIdMappingReport scans the data for the malformed [[ shape; a non-zero
  // count means the committed data is corrupted (the correct [PREFIX_ID_HEX] gate alone would
  // report a false zero). Without this gate the verifier would PASS malformed data.
  if (malformedPlaceholders > 0) {
    manifestErrors.push(`${malformedPlaceholders} malformed [[ double-bracket placeholders in committed data (legacy-remap normalization incomplete; id-mapping format corrupted)`);
  }
  // Fail closed on PARTIAL (truncated) identifier placeholders: an opening [PREFIX_ID_<0-7 hex>
  // with no closing ] - a safeTruncate cut mid-token. A partial leaks a partial HMAC prefix and
  // breaks the non-reversible mapping guarantee. safeTruncate rolls these back at write time; this
  // scan is the defense-in-depth that catches any residual in committed data.
  if (partialPlaceholderCount > 0) {
    manifestErrors.push(`${partialPlaceholderCount} partial (truncated) identifier placeholder(s) in committed data (a [PREFIX_ID_<hex>] cut mid-token; a partial HMAC prefix must not leak - safeTruncate must roll back to the placeholder start)`);
  }
  // Invalid placeholder gate: a token shaped [PREFIX_ID_<anything>] that does NOT match the
  // canonical [PREFIX_ID_<exactly 8 uppercase hex>]. The sanitizer uppercases the HMAC truncation
  // to 8 hex, so a well-formed dataset has ZERO. Without this gate, a token like
  // [RESOURCE_ID_ABCDEF] (6 hex) or [RESOURCE_ID_abcdef12] (lowercase) would be silently accepted
  // by scanFinalStats as a valid mapped id - a false PASS hiding a sanitizer/regen regression.
  // The partial scan only catches openers with NO ]; the malformed scan only catches [[ shapes;
  // neither catches a well-bracketed-but-wrong-format token.
  if (invalidPlaceholderCount > 0) {
    manifestErrors.push(`${invalidPlaceholderCount} invalid identifier placeholder(s) in committed data (a [PREFIX_ID_<...>] token not matching the canonical [PREFIX_ID_<8 uppercase hex>] syntax; wrong hex length or case hides a sanitizer/regen regression)`);
  }
  // Double-bracket gate: a CANONICAL [PREFIX_ID_<8 hex>] token with an extra '[' before it or ']'
  // after it ([[RESOURCE_ID_12345678], [RESOURCE_ID_12345678]], [[..]]). This is a distinct blind
  // spot: the malformed scan only catches legacy [[RESOURCE_<hex>] (no _ID_), the partial scan
  // only catches openers with NO ], and the invalid scan matches the INNER canonical token (which
  // passes its CANON test, so the extra bracket is silently accepted). Without this gate a stray
  // bracket around a valid token would PASS. See countDoubleBracketPlaceholders.
  if (doubleBracketPlaceholderCount > 0) {
    manifestErrors.push(`${doubleBracketPlaceholderCount} double-bracket placeholder(s) in committed data (a canonical [PREFIX_ID_<8 hex>] with an extra [ before or ] after - e.g. [[RESOURCE_ID_12345678]; a stray bracket around a valid token hides a sanitizer/regen regression)`);
  }

  // ---- review-queue.jsonl: structural completeness (reviewer needs request-side evidence) ----
  // Each entry must carry the full de-labeled REQUEST input (method/path/headers/body/
  // sourceContext) so a reviewer can judge intent from request evidence -- e.g. the X-Note
  // prompt-injection header that distinguishes otherwise-identical GET /api/auth/me samples
  // 330-337. Withholding collector category/labels/responseStatus/responseBody/execution outcome.
  const rqIds = [];
  for (const line of rqLines) {
    let r; try { r = JSON.parse(line); } catch (e) { schemaErrors.push('review-queue.jsonl: unparseable line'); continue; }
    if (r && r.sampleId) rqIds.push(r.sampleId);
    if (!r || typeof r !== 'object' || r.input == null || typeof r.input !== 'object') {
      reviewQueueErrs.push(`${(r && r.sampleId) || '?'} review-queue entry missing input object (reviewer needs request-side evidence: method/path/headers/body/sourceContext)`);
      continue;
    }
    if (r.input.headers == null || typeof r.input.headers !== 'object') reviewQueueErrs.push(`${r.sampleId} review-queue input missing headers (reviewer cannot distinguish e.g. prompt-injection X-Note samples that share method+path)`);
    if (!r.input.method || !r.input.path) reviewQueueErrs.push(`${r.sampleId} review-queue input missing method/path`);
    if ('sampleId' in r.input) reviewQueueErrs.push(`${r.sampleId} review-queue input leaks sampleId`);
    for (const f of INPUT_FORBIDDEN) if (f in r.input) reviewQueueErrs.push(`${r.sampleId} review-queue input leaks forbidden field ${f}`);
    // collector category/labels/responseStatus/responseBody/execution outcome must NOT be in input
    // (these are withheld to keep the reviewer judging intent, not outcome).
    for (const f of ['category', 'labels', 'responseStatus', 'responseBody', 'executionEvidence']) {
      if (f in r.input) reviewQueueErrs.push(`${r.sampleId} review-queue input leaks outcome field ${f} (must withhold to keep reviewer judging intent)`);
    }
  }
  if (JSON.stringify(rqIds.slice().sort()) !== JSON.stringify(unionSorted)) {
    manifestErrors.push(`review-queue.jsonl sampleId set (${rqIds.length}) != evidence sampleId set (${unionSorted.length})`);
  }

  // ---- body-omission consistency (fail-closed; mirrors §5 of the remediation spec) ----
  // For every omitted request/response body: body must be null, retainedBodyBytes 0, reason in
  // the allowed enum, capturedContentLengthHeader null-or-nonneg-int, preOmissionRetainedBytes +
  // originalBodyBytes non-negative ints. A `legacy_capture_structurally_truncated` omission MUST
  // retain >0 pre-omission bytes (a 0 means the true size was lost -- a real defect); a
  // `legacy_capture_truncated_before_complete_sanitization` omission MAY be 0 (unrecoverable
  // historical damage, recorded as omittedBodiesWithUnknownRetainedLength, NOT a real 0-length body).
  for (const s of samples) {
    for (const [side, part] of [['request', s.requestSanitized], ['response', s.responseSanitized]]) {
      if (!part || part.bodyOmitted !== true) continue;
      const id = s.sampleId || '?';
      if (part.body != null) bodyOmissionErrs.push(`${id} ${side} bodyOmitted=true but body!=null (omitted body must be null)`);
      if (part.retainedBodyBytes !== 0) bodyOmissionErrs.push(`${id} ${side} bodyOmitted=true but retainedBodyBytes=${part.retainedBodyBytes} (must be 0)`);
      if (!ALLOWED_OMISSION_REASONS.includes(part.bodyOmittedReason)) bodyOmissionErrs.push(`${id} ${side} bodyOmitted=true but bodyOmittedReason="${part.bodyOmittedReason}" not in allowed enum ${JSON.stringify(ALLOWED_OMISSION_REASONS)}`);
      const clh = part.capturedContentLengthHeader;
      if (clh != null && !(Number.isInteger(clh) && clh >= 0)) bodyOmissionErrs.push(`${id} ${side} capturedContentLengthHeader=${clh} not null or non-negative integer`);
      const pre = part.preOmissionRetainedBytes;
      const orig = part.originalBodyBytes;
      if (!(Number.isInteger(pre) && pre >= 0)) bodyOmissionErrs.push(`${id} ${side} preOmissionRetainedBytes=${pre} not non-negative integer`);
      if (!(Number.isInteger(orig) && orig >= 0)) bodyOmissionErrs.push(`${id} ${side} originalBodyBytes=${orig} not non-negative integer`);
      if (part.bodyOmittedReason === 'legacy_capture_structurally_truncated') {
        if (!(pre > 0 && orig > 0)) bodyOmissionErrs.push(`${id} ${side} structural omission but preOmissionRetainedBytes=${pre}/originalBodyBytes=${orig} (structural must retain >0 pre-omission bytes; a 0 means the true size was lost)`);
      }
      if (side === 'response' && clh != null && clh === 0) bodyOmissionErrs.push(`${id} response omitted but capturedContentLengthHeader=0 (a known Content-Length must be >0 for an omitted response body)`);
    }
  }
  bodiesOmitted = liveIdMapping.bodiesOmitted;

  // ---- manifest: schema + counts match reality ----
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'dataset-manifest.json'), 'utf8')); }
  catch (e) { manifestErrors.push('dataset-manifest.json unparseable'); }
  if (manifest) {
    for (const m of ajvErrs(mfValidate, manifest)) manifestErrors.push(`[manifest schema] ${m}`);
    const sc = manifest.sampleCounts || {};
    for (const cat of Object.keys(FILES)) {
      if (sc[cat] !== counts[cat]) manifestErrors.push(`manifest.sampleCounts.${cat}=${sc[cat]} != actual ${counts[cat]}`);
    }
    if (manifest.totalSamples !== total) manifestErrors.push(`manifest.totalSamples=${manifest.totalSamples} != actual ${total}`);
    const dm = manifest.datasetMetadata || {};
    if (dm.eligibleForTraining !== false) manifestErrors.push('manifest.datasetMetadata.eligibleForTraining!=false');
    if (dm.humanReviewed !== false) manifestErrors.push('manifest.datasetMetadata.humanReviewed!=false (must stay false until review is real)');
    // ---- manifest.idMapping consistency (§4 of the remediation spec) ----
    // The manifest's idMapping block is produced by finalize.js via the SAME shared
    // buildIdMappingReport() path used here (liveIdMapping). Any divergence is a real defect
    // (stale manifest / partial regeneration / hand-edit) and must fail-closed. We compare the
    // exact metric fields both producers expose, NOT just sample counts.
    const mid = manifest.idMapping || {};
    const cmp = (label, manifestVal, liveVal) => {
      if (JSON.stringify(manifestVal) !== JSON.stringify(liveVal)) {
        manifestErrors.push(`manifest.idMapping.${label}=<${JSON.stringify(manifestVal)}> != live=<${JSON.stringify(liveVal)}> (manifest stale or regenerated with different data; re-run finalize.js)`);
      }
    };
    cmp('method', mid.method, liveIdMapping.method);
    cmp('salted', mid.salted, liveIdMapping.salted);
    cmp('canonicalEvidence', mid.canonicalEvidence, liveIdMapping.canonicalEvidence);
    cmp('allCommittedViews', mid.allCommittedViews, liveIdMapping.allCommittedViews);
    cmp('residualLegacySequential', mid.residualLegacySequential, liveIdMapping.residualLegacySequential);
    cmp('residualRawIdentifiers', mid.residualRawIdentifiers, liveIdMapping.residualRawIdentifiers);
    cmp('residualPartialIdentifiers', mid.residualPartialIdentifiers, liveIdMapping.residualPartialIdentifiers);
    cmp('malformedPlaceholderCount', mid.malformedPlaceholderCount, liveIdMapping.malformedPlaceholderCount);
    cmp('legacyPlaceholderRemapped', mid.legacyPlaceholderRemapped, liveIdMapping.legacyPlaceholderRemapped);
    cmp('bodiesOmitted', mid.bodiesOmitted, liveIdMapping.bodiesOmitted);
    cmp('bodiesOmittedReasonBreakdown', mid.bodiesOmittedReasonBreakdown, liveIdMapping.bodiesOmittedReasonBreakdown);
    cmp('omittedBodiesWithUnknownRetainedLength', mid.omittedBodiesWithUnknownRetainedLength, liveIdMapping.omittedBodiesWithUnknownRetainedLength);
  }

  const failCount = schemaErrors.length + semanticErrs.length + privacyFindings.length + dupIds.length + benchmarkLeak.length + alignmentErrors.length + manifestErrors.length + structuralErrs.length + reviewQueueErrs.length + bodyOmissionErrs.length;
  const pass = failCount === 0;

  const report = {
    result: pass ? 'PASS' : 'FAIL',
    verifiedAt: new Date().toISOString(),
    idMapping: liveIdMapping,
    countsFromActualLines: counts,
    totalSamples: total,
    bodiesOmitted,
    bodiesOmittedReasonBreakdown: liveIdMapping.bodiesOmittedReasonBreakdown,
    omittedBodiesWithUnknownRetainedLength: liveIdMapping.omittedBodiesWithUnknownRetainedLength,
    responseStatusDistribution: statusDist,
    exploitConfirmedCount: exploitConfirmed,
    canaryObservedCount: canaryObserved,
    schemaErrorCount: schemaErrors.length,
    semanticErrorCount: semanticErrs.length,
    privacyFindingCount: privacyFindings.length,
    duplicateIdCount: dupIds.length,
    benchmarkLeakageCount: benchmarkLeak.length,
    alignmentErrorCount: alignmentErrors.length,
    manifestErrorCount: manifestErrors.length,
    structuralErrorCount: structuralErrs.length,
    reviewQueueErrorCount: reviewQueueErrs.length,
    bodyOmissionErrorCount: bodyOmissionErrs.length,
    malformedPlaceholderCount: malformedPlaceholders,
    partialPlaceholderCount,
    invalidPlaceholderCount,
    doubleBracketPlaceholderCount,
    schemaErrors: schemaErrors.slice(0, 60),
    semanticErrors: semanticErrs.slice(0, 60),
    privacyFindings: privacyFindings.slice(0, 60),
    duplicateSampleIds: dupIds.slice(0, 60),
    benchmarkLeakage: benchmarkLeak.slice(0, 60),
    alignmentErrors: alignmentErrors.slice(0, 60),
    manifestErrors: manifestErrors.slice(0, 60),
    structuralErrors: structuralErrs.slice(0, 60),
    reviewQueueErrors: reviewQueueErrs.slice(0, 60),
    bodyOmissionErrors: bodyOmissionErrs.slice(0, 60),
    passGate: {
      description: 'failCount = schema + semantic + privacy + dupId + benchmarkLeak + alignment + manifest + structural + reviewQueue + bodyOmission. A PASS requires every term == 0; any non-zero term is a real defect, not a tolerated warning.',
      failCount,
      nonZeroTerms: [
        ['schemaErrors', schemaErrors.length],
        ['semanticErrs', semanticErrs.length],
        ['privacyFindings', privacyFindings.length],
        ['dupIds', dupIds.length],
        ['benchmarkLeak', benchmarkLeak.length],
        ['alignmentErrors', alignmentErrors.length],
        ['manifestErrors', manifestErrors.length],
        ['structuralErrs', structuralErrs.length],
        ['reviewQueueErrs', reviewQueueErrs.length],
        ['bodyOmissionErrs', bodyOmissionErrs.length],
      ].filter(([, n]) => n > 0),
    },
  };
  fs.writeFileSync(path.join(DIR, 'verification-report.json'), JSON.stringify(report, null, 2));

  // Refresh privacy-audit-report.json from the same scan.
  const auditByCat = {};
  for (const f of privacyFindings) {
    auditByCat[f.category] = auditByCat[f.category] || { count: 0, indicators: new Set(), files: new Set() };
    auditByCat[f.category].count += f.count;
    auditByCat[f.category].indicators.add(f.indicator);
    auditByCat[f.category].files.add(f.file);
  }
  const auditReport = {
    auditedAt: new Date().toISOString(),
    method: 'Static scan of committed sanitized data files for residual sensitive indicators (full + PARTIAL). Partial detection is context-aware (UUID prefix shape, sensitive key + non-placeholder value, session/token key + long hex, partial JWT). Values are never copied into this report (indicator names + counts only).',
    idMapping: { ...liveIdMapping, note: 'Internal identifiers (sessionId/userId/tenantId/findingId/UUID) are replaced with stable, non-reversible HMAC placeholders. Legacy sequential placeholders are remapped; original resource ids are gone (opaque remap, not recovery). canonicalEvidence = 5 evidence files only; allCommittedViews = every committed derived view (cross-view occurrences of the same 10 distinct internal ids).' },
    categories: Object.fromEntries(Object.entries(auditByCat).map(([k, v]) => [k, { occurrences: v.count, indicators: [...v.indicators], files: [...v.files] }])),
    residualFindingsTotal: privacyFindings.length,
    clean: privacyFindings.length === 0,
    note: 'clean=true means no residual red-line indicator (full OR partial) remains after sanitization. The verifier fails (exit 1) whenever residualFindingsTotal>0.',
  };
  fs.writeFileSync(path.join(DIR, 'privacy-audit-report.json'), JSON.stringify(auditReport, null, 2));

  console.log(pass ? 'PASS' : 'FAIL');
  console.log('sample count: ' + total);
  console.log('bodies omitted (partial-fragment safe handling): ' + bodiesOmitted);
  console.log('schema errors: ' + schemaErrors.length);
  console.log('semantic errors: ' + semanticErrs.length);
  console.log('privacy findings: ' + privacyFindings.length);
  console.log('duplicate IDs: ' + dupIds.length);
  console.log('benchmark/input leakage findings: ' + benchmarkLeak.length);
  console.log('sampleId alignment errors: ' + alignmentErrors.length);
  console.log('structural integrity errors: ' + structuralErrs.length);
  console.log('review-queue errors: ' + reviewQueueErrs.length);
  console.log('malformed [[ placeholders: ' + malformedPlaceholders);
  console.log('partial placeholders: ' + partialPlaceholderCount);
  console.log('invalid placeholders: ' + invalidPlaceholderCount);
  console.log('double-bracket placeholders: ' + doubleBracketPlaceholderCount);
  console.log('id mapping: canonicalUnique=' + liveIdMapping.canonicalEvidence.uniqueInternalIdsMapped + ' canonicalOccurrences=' + liveIdMapping.canonicalEvidence.totalMappedOccurrences + ' allViewsOccurrences=' + liveIdMapping.allCommittedViews.totalMappedOccurrences + ' legacyRemapped=' + liveIdMapping.legacyPlaceholderRemapped + ' bodiesOmittedUnknownLen=' + liveIdMapping.omittedBodiesWithUnknownRetainedLength);
  if (!pass) {
    if (schemaErrors.length) console.error('SCHEMA: ' + schemaErrors.slice(0, 8).join(' | '));
    if (semanticErrs.length) console.error('SEMANTIC: ' + semanticErrs.slice(0, 8).join(' | '));
    if (privacyFindings.length) console.error('PRIVACY: ' + privacyFindings.slice(0, 8).map(f => `${f.file}:${f.category}:${f.indicator}x${f.count}`).join(' | '));
    if (dupIds.length) console.error('DUP: ' + dupIds.slice(0, 8).join(' | '));
    if (benchmarkLeak.length) console.error('BM-LEAK: ' + benchmarkLeak.slice(0, 8).join(' | '));
    if (alignmentErrors.length) console.error('ALIGN: ' + alignmentErrors.slice(0, 8).join(' | '));
    if (manifestErrors.length) console.error('MANIFEST: ' + manifestErrors.slice(0, 8).join(' | '));
    if (structuralErrs.length) console.error('STRUCT: ' + structuralErrs.slice(0, 8).join(' | '));
    if (reviewQueueErrs.length) console.error('RQ: ' + reviewQueueErrs.slice(0, 8).join(' | '));
    if (bodyOmissionErrs.length) console.error('OMIT: ' + bodyOmissionErrs.slice(0, 8).join(' | '));
    if (partialPlaceholderCount > 0) console.error('PARTIAL: ' + partialPlaceholderCount + ' partial (truncated) identifier placeholder(s) - safeTruncate cut a [PREFIX_ID_<hex>] mid-token');
    if (invalidPlaceholderCount > 0) console.error('INVALID: ' + invalidPlaceholderCount + ' invalid identifier placeholder(s) - a [PREFIX_ID_<...>] token not matching the canonical [PREFIX_ID_<8 uppercase hex>] syntax');
  if (doubleBracketPlaceholderCount > 0) console.error('DOUBLE: ' + doubleBracketPlaceholderCount + ' double-bracket placeholder(s) - a canonical [PREFIX_ID_<8 hex>] with an extra [ before or ] after (e.g. [[RESOURCE_ID_12345678])');
  }
  process.exit(pass ? 0 : 1);
}

main();
