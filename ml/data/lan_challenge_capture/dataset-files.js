'use strict';
// Shared definitions + computations for the VIguard LAN challenge-capture dataset.
//
// WHY THIS EXISTS: verify.js and finalize.js previously hand-wrote DIFFERENT file lists for
// ID-mapping statistics. verify.js scanned review-queue.jsonl; finalize.js did not. The same
// metric name `totalMappedOccurrences` therefore meant 688 in verification-report.json and 596
// in dataset-manifest.json -- a silent divergence that looked like a contradiction. This module
// is the single source of truth for which files constitute each statistical view, and for the
// id-mapping / body-omission computations, so manifest, verification-report, and privacy-audit
// report are all produced from ONE code path and can never drift apart.
//
// Two explicitly-named metrics (per the remediation spec):
//   - canonicalEvidence  : the five captured evidence files only (the source of truth).
//                          uniqueInternalIdsMapped / totalMappedOccurrences here count the
//                          DISTINCT captured identifiers and their occurrences in the evidence.
//   - allCommittedViews  : every committed data view (evidence + derived). totalMappedOccurrences
//                          here is the CROSS-VIEW occurrence count of the SAME placeholders across
//                          all committed files -- useful for leak auditing, but it is NOT the
//                          number of distinct identifiers (the derived views re-project the same
//                          identifiers). 688 != "688 real identifiers".

const fs = require('fs');
const path = require('path');
const S = require('./sanitize');
const { scanFinalStats, auditText, mappingMethod, hasSalt } = S;

// The method label written when the committed data uses the salted HMAC placeholder format
// (8-hex [PREFIX_ID_XXXXXXXX]). MUST be byte-identical to sanitize.js's HAS_SALT mappingMethod
// so the manifest (written by finalize.js WITH the salt) and verification-report (written by
// verify.js, which in CI runs WITHOUT the gitignored salt) agree. method/salted are DATA-derived
// (does the committed data carry salted-format placeholders?), NOT process-derived (does this
// run have the salt file?): the verifier must be able to confirm the dataset is salted even when
// it cannot read the secret salt, because salted-ness is a property of the committed placeholders.
const SALTED_METHOD = 'hmac-sha256[salt=raw-private/.id-salt(gitignored),trunc=8hex]';

const DIR = __dirname;

// cat-name -> filename (single source of truth; enrich.js reads/writes via this map, verify.js
// and finalize.js derive their stats file sets from CATEGORY_FILES below).
const CATEGORY_FILE_MAP = {
  normal: 'normal-traffic.jsonl',
  attack: 'attack-traffic.jsonl',
  hardNegative: 'hard-negatives.jsonl',
  promptInjection: 'prompt-injection.jsonl',
  unknown: 'unknown-cases.jsonl',
};

const CATEGORY_FILES = Object.values(CATEGORY_FILE_MAP);

// Derived data views: each is a re-projection of the 5 category evidence files (never a new
// source of identifiers). all-sanitized = concatenation; benchmark/input/labels/review-queue =
// request-side re-projection. Placeholder occurrences in these are CROSS-VIEW duplicates of the
// same identifiers in the evidence files, NOT distinct identifiers.
const DERIVED_DATA_FILES = [
  'all-sanitized.jsonl',
  'model-benchmark.jsonl',
  'model-inputs.jsonl',
  'model-labels.jsonl',
  'review-queue.jsonl',
];

// canonicalEvidence: the five captured evidence files (source of truth).
const CANONICAL_EVIDENCE_FILES = CATEGORY_FILES.slice();

// allCommittedViews: every committed data view (evidence + derived).
const ALL_COMMITTED_VIEWS_FILES = [...CATEGORY_FILES, ...DERIVED_DATA_FILES];

// Strict enum of allowed bodyOmittedReason values. Mirrored in evidence-sample.schema.json.
// `legacy_capture_omitted_reason_unknown` is the fallback for historical data whose prior reason
// is genuinely missing; an existing explicit reason must NEVER be downgraded to it.
const ALLOWED_OMISSION_REASONS = [
  'legacy_capture_truncated_before_complete_sanitization',
  'legacy_capture_structurally_truncated',
  'legacy_capture_omitted_reason_unknown',
];

function resolve(files) { return files.map(f => path.join(DIR, f)); }
function existing(files) {
  return resolve(files).filter(p => { try { fs.accessSync(p); return true; } catch { return false; } });
}
function canonicalEvidencePaths() { return existing(CANONICAL_EVIDENCE_FILES); }
function allCommittedViewsPaths() { return existing(ALL_COMMITTED_VIEWS_FILES); }

// Build a per-bucket stats object from a scanFinalStats result.
function bucketFrom(stats, fileSet) {
  return {
    uniqueInternalIdsMapped: stats.uniqueInternalIdsMapped,
    totalMappedOccurrences: stats.totalMappedOccurrences,
    mappedByCategory: stats.mappedByCategory,
    fileSet,
  };
}

// Read legacyPlaceholderRemapped from regeneration-meta.json (a process property of the enrich
// run; both finalize and verify read it the same way so the manifest and the report agree).
function readLegacyPlaceholderRemapped() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'regeneration-meta.json'), 'utf8'));
    return !!meta.legacyPlaceholderRemapped;
  } catch { return false; }
}

// Scan the committed data files for privacy findings (full + partial identifiers). Returns the
// findings list + the residual raw/partial counts derived from it. Scoped to DATA files only
// (the id-mapping residuals describe the data; prose in manifest/README is a separate check the
// verifier runs on top).
function scanDataPrivacy() {
  const files = allCommittedViewsPaths();
  const findings = [];
  for (const fp of files) {
    const txt = fs.readFileSync(fp, 'utf8');
    for (const f of auditText(txt, path.basename(fp))) findings.push(f);
  }
  const residualRawIdentifiers = findings.filter(f =>
    /raw-uuid|raw-value|sessionId-token|email-address|test-email-literal|jwt$|authorization-header|set-cookie|password-literal/.test(f.indicator)
  ).length;
  const residualPartialIdentifiers = findings.filter(f =>
    /partial-uuid-fragment|partial-jwt|partial-value|hex-session-tail/.test(f.indicator)
  ).length;
  return { findings, residualRawIdentifiers, residualPartialIdentifiers };
}

// Count malformed double-bracket placeholders [[PREFIX_HEX] (or [[PREFIX_HEX]]) left by a prior
// buggy legacy-remap. scanFinalStats only scans the CORRECT [PREFIX_ID_HEX] format, so without
// this gate the data could be malformed while stats report zero (a false PASS).
function countMalformedPlaceholders() {
  let malformed = 0;
  for (const fp of allCommittedViewsPaths()) {
    const txt = fs.readFileSync(fp, 'utf8');
    malformed += (txt.match(/\[\[(?:RESOURCE|SESSION|USER|TENANT)_[0-9A-Fa-f]{4,8}\]?\]/g) || []).length;
  }
  return malformed;
}

// Count PARTIAL (truncated) identifier placeholders in committed data: an opening
// [PREFIX_ID_ followed by 0-7 hex chars with NO closing ] reachable via more hex. A complete
// placeholder is [PREFIX_ID_<8hex>]; the negative lookahead (?![0-9A-F]*\]) rejects complete
// placeholders (4 or 8 hex + ]) so they do NOT match. A partial leaks a partial HMAC prefix and
// breaks the non-reversible mapping guarantee; safeTruncate rolls these back at write time, and
// this scan is the fail-closed defense-in-depth that catches any residual in committed data.
function countPartialPlaceholders() {
  let partial = 0;
  for (const fp of allCommittedViewsPaths()) {
    const txt = fs.readFileSync(fp, 'utf8');
    partial += (txt.match(/\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9A-F]{0,7}(?![0-9A-F]*\])/g) || []).length;
  }
  return partial;
}

// Count INVALID identifier placeholders: any token shaped [PREFIX_ID_<anything>] that does NOT
// match the canonical [PREFIX_ID_<exactly 8 uppercase hex>]. The sanitizer uppercases the HMAC
// truncation to 8 hex, so a well-formed dataset has ZERO of these. Without this gate, a token
// like [RESOURCE_ID_ABCDEF] (6 hex) or [RESOURCE_ID_abcdef12] (lowercase) would be silently
// accepted by scanFinalStats as a valid mapped id - a false PASS that hides a sanitizer/regen
// regression. The partial scan (countPartialPlaceholders) only catches openers with NO closing
// ], and the malformed scan (countMalformedPlaceholders) only catches [[ double-bracket shapes,
// so neither catches a well-bracketed-but-wrong-format token. This scan is the fail-closed gate
// for the canonical syntax. (Top-level report field, NOT in manifest idMapping, so no manifest
// schema change and no regeneration.)
function countInvalidPlaceholders() {
  const SHAPED = /\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[^\]]*\]/g;
  const CANON = /^\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9A-F]{8}\]$/;
  let invalid = 0;
  for (const fp of allCommittedViewsPaths()) {
    const txt = fs.readFileSync(fp, 'utf8');
    for (const tok of (txt.match(SHAPED) || [])) {
      if (!CANON.test(tok)) invalid++;
    }
  }
  return invalid;
}

// Count DOUBLE-BRACKET placeholders: a CANONICAL [PREFIX_ID_<8 hex>] token with an EXTRA '['
// immediately before it or an EXTRA ']' immediately after it - i.e. [[RESOURCE_ID_12345678],
// [RESOURCE_ID_12345678]], or [[RESOURCE_ID_12345678]]. This is a DISTINCT blind spot from the
// other three scans: countMalformedPlaceholders only catches the LEGACY [[RESOURCE_<hex>] shape
// (no _ID_), countPartialPlaceholders only catches openers with NO closing ], and
// countInvalidPlaceholders matches the INNER canonical token (which PASSES its CANON test, so the
// extra bracket is silently accepted as a valid mapped id). Without this gate a sanitizer/regen
// bug emitting a stray bracket around a valid token would PASS the verifier. (Top-level report
// field, NOT in manifest idMapping, so no manifest schema change and no regeneration - same as
// partial/invalid.) charAt is UTF-16 code-unit based, matching the regex matchAll index space.
function countDoubleBracketPlaceholders() {
  const CANON = /\[(?:RESOURCE_ID|SESSION_ID|USER_ID|TENANT_ID)_[0-9A-F]{8}\]/g;
  let doubleBracket = 0;
  for (const fp of allCommittedViewsPaths()) {
    const txt = fs.readFileSync(fp, 'utf8');
    for (const m of txt.matchAll(CANON)) {
      const start = m.index;
      const end = start + m[0].length;
      // Extra '[' immediately before the canonical opener, OR extra ']' immediately after the
      // canonical closer. else-if so [[..]] counts once (the before-branch wins on the single
      // inner match). Adjacent clean tokens [PH][PH] do NOT match: charAt(end)='[', not ']'.
      if (start > 0 && txt.charAt(start - 1) === '[') doubleBracket++;
      else if (end < txt.length && txt.charAt(end) === ']') doubleBracket++;
    }
  }
  return doubleBracket;
}

// Body-omission stats from parsed samples. Counts each sample ONCE (request-omission takes
// precedence over response-omission), matching the historical bodiesOmitted semantics.
// omittedBodiesWithUnknownRetainedLength = samples omitted for the partial-fragment reason whose
// pre-omission retained bytes are 0 (historical data damaged by a prior non-idempotent enrich run;
// the original bodies are gone and the byte count is unrecoverable -- 0 here means UNKNOWN, not a
// real 0-length body).
function computeBodyOmissionStats(samples) {
  let bodiesOmitted = 0;
  const breakdown = {};
  let unknownRetained = 0;
  for (const s of samples) {
    for (const part of [s.requestSanitized, s.responseSanitized]) {
      if (part && part.bodyOmitted) {
        bodiesOmitted++;
        const reason = part.bodyOmittedReason || 'unspecified';
        breakdown[reason] = (breakdown[reason] || 0) + 1;
        if (reason === 'legacy_capture_truncated_before_complete_sanitization' &&
            (Number(part.preOmissionRetainedBytes) === 0 || Number(part.originalBodyBytes) === 0)) {
          unknownRetained++;
        }
        break; // count each sample once (request-omission takes precedence)
      }
    }
  }
  return {
    bodiesOmitted,
    bodiesOmittedReasonBreakdown: breakdown,
    bodiesOmittedReasonSummary: Object.keys(breakdown).sort().join(' + ') || null,
    omittedBodiesWithUnknownRetainedLength: unknownRetained,
  };
}

// The single id-mapping computation shared by finalize.js (writes the manifest) and verify.js
// (writes verification-report.json + privacy-audit-report.json + the live values it cross-checks
// the manifest against). Because both call THIS, the same-named metric has the same value in all
// three reports by construction. Returns { idMapping, privacyFindings, malformedPlaceholderCount,
// partialPlaceholderCount, invalidPlaceholderCount, doubleBracketPlaceholderCount }.
// (partialPlaceholderCount, invalidPlaceholderCount and doubleBracketPlaceholderCount are
// verify-time fail-closed gates; they are NOT written into the manifest idMapping, so adding them
// needs no manifest regeneration.)
function buildIdMappingReport(samples, reviewQueueEntries) {
  const canon = scanFinalStats(canonicalEvidencePaths());
  const all = scanFinalStats(allCommittedViewsPaths());
  const priv = scanDataPrivacy();
  const malformed = countMalformedPlaceholders();
  const partial = countPartialPlaceholders();
  const invalid = countInvalidPlaceholders();
  const doubleBracket = countDoubleBracketPlaceholders();
  const body = computeBodyOmissionStats(samples || []);
  // Data-derived: the committed data is salted iff it carries salted-format HMAC placeholders.
  // all.totalMappedOccurrences counts [PREFIX_ID_XXXXXXXX] occurrences (>0 => salted). This is
  // stable across environments (CI has no salt file but the committed data still has HMAC
  // placeholders), so manifest vs verification-report method/salted never diverge on salt access.
  const dataUsesSaltedFormat = all.totalMappedOccurrences > 0;
  const idMapping = {
    method: dataUsesSaltedFormat ? SALTED_METHOD : mappingMethod,
    salted: dataUsesSaltedFormat || hasSalt(),
    canonicalEvidence: bucketFrom(canon,
      '5 category evidence files (source of truth; distinct captured identifiers)'),
    allCommittedViews: bucketFrom(all,
      '5 evidence + all-sanitized + benchmark + model-inputs + model-labels + review-queue (CROSS-VIEW occurrences of the same placeholders; NOT distinct identifiers)'),
    residualLegacySequential: all.residualLegacySequential,
    residualRawIdentifiers: priv.residualRawIdentifiers,
    residualPartialIdentifiers: priv.residualPartialIdentifiers,
    malformedPlaceholderCount: malformed,
    legacyPlaceholderRemapped: readLegacyPlaceholderRemapped(),
    bodiesOmitted: body.bodiesOmitted,
    bodiesOmittedReason: body.bodiesOmittedReasonSummary,
    bodiesOmittedReasonBreakdown: body.bodiesOmittedReasonBreakdown,
    omittedBodiesWithUnknownRetainedLength: body.omittedBodiesWithUnknownRetainedLength,
    note: 'Two explicitly-named metrics: canonicalEvidence scans the 5 category evidence files only (distinct captured identifiers); allCommittedViews scans every committed data view (evidence + derived) and counts CROSS-VIEW occurrences of the SAME placeholders -- allCommittedViews.totalMappedOccurrences is NOT the number of distinct identifiers (derived views re-project the same identifiers). manifest/verification-report/privacy-audit-report are all produced from one shared computation (dataset-files.js buildIdMappingReport) so the same metric name has the same value everywhere. legacyPlaceholderRemapped=true means prior sequential placeholders were re-mapped through HMAC(salt, "legacy:"+old); the original resource id is gone (opaque remap, not recovery). bodiesOmittedReason is the sorted union of per-sample bodyOmittedReason; bodiesOmittedReasonBreakdown is the machine-readable per-reason count. omittedBodiesWithUnknownRetainedLength counts partial-fragment omissions whose pre-omission retained bytes are 0 (unrecoverable historical damage; 0 = UNKNOWN length, not a real 0-length body).',
  };
  if (reviewQueueEntries != null) idMapping.reviewQueueEntries = reviewQueueEntries;
  return { idMapping, privacyFindings: priv.findings, malformedPlaceholderCount: malformed, partialPlaceholderCount: partial, invalidPlaceholderCount: invalid, doubleBracketPlaceholderCount: doubleBracket };
}

module.exports = {
  DIR,
  CATEGORY_FILE_MAP,
  CATEGORY_FILES,
  DERIVED_DATA_FILES,
  CANONICAL_EVIDENCE_FILES,
  ALL_COMMITTED_VIEWS_FILES,
  ALLOWED_OMISSION_REASONS,
  resolve,
  canonicalEvidencePaths,
  allCommittedViewsPaths,
  computeBodyOmissionStats,
  buildIdMappingReport,
  readLegacyPlaceholderRemapped,
  countDoubleBracketPlaceholders,
};
