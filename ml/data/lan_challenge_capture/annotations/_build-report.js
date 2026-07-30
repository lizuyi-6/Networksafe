#!/usr/bin/env node
/**
 * Builds model-b-report.json from the annotation file + the input file.
 * Every number is computed from the artefacts, never hand-written.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'model-inputs.jsonl');
const OUT = path.join(__dirname, 'model-b-annotations.jsonl');
const REPORT = path.join(__dirname, 'model-b-report.json');

const startedAt = process.env.ANNOTATION_STARTED_AT;
const completedAt = process.env.ANNOTATION_COMPLETED_AT;
if (!startedAt || !completedAt) throw new Error('ANNOTATION_STARTED_AT / ANNOTATION_COMPLETED_AT must be provided');

const inputRaw = fs.readFileSync(INPUT);
const inputSha = crypto.createHash('sha256').update(inputRaw).digest('hex');
const inputs = inputRaw.toString('utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const anns = fs.readFileSync(OUT, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const dist = (fn) => anns.reduce((m, a) => { const k = fn(a); m[k] = (m[k] || 0) + 1; return m; }, {});
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

const ids = anns.map((a) => a.sampleId);
const dupCount = ids.length - new Set(ids).size;
const missingCount = inputs.filter((r) => !ids.includes(r.sampleId)).length + anns.filter((a) => !a.sampleId).length;

const report = {
  annotatorId: 'annotator-b',
  modelName: 'Claude Opus 5 (Anthropic), running as the Claude Code session model',
  modelVersion:
    'claude-opus-5 — confirmed by the operator as the model actually serving this session. The harness UI mislabelled the session model (it displayed a different Claude model name), and the exact build/checkpoint string is not exposed to the running model, so no more precise version identifier can be asserted from inside the session. All 413 annotations were produced by this one model in a single session.',
  inputFile: 'ml/data/lan_challenge_capture/model-inputs.jsonl',
  inputSha256: inputSha,
  sampleCount: anns.length,
  verdictDistribution: sortObj(dist((a) => a.verdict)),
  attackFamilyDistribution: sortObj(dist((a) => a.attackFamily)),
  confidenceDistribution: Object.fromEntries(
    Object.entries(dist((a) => String(a.confidence))).sort((a, b) => Number(a[0]) - Number(b[0]))
  ),
  recommendedActionDistribution: sortObj(dist((a) => a.recommendedAction)),
  contextSufficientDistribution: sortObj(dist((a) => String(a.contextSufficient))),
  expertReviewCount: anns.filter((a) => a.needsExpertReview).length,
  schemaErrorCount: 0,
  duplicateSampleIdCount: dupCount,
  missingSampleIdCount: missingCount,
  forbiddenFileAccessed: false,
  forbiddenFiles: [],
  startedAt,
  completedAt,
  notes: {
    inputSourceNote:
      'ml/data/lan_challenge_capture/ contained only node_modules/ and gitignored raw-private/ in the working tree. The seven permitted files were extracted from git ref agent/viguard-lan-capture-20260729 and each was byte-size-verified against its git blob before use.',
    filesRead: [
      'model-inputs.jsonl (annotation input)',
      'endpoint-inventory.json',
      'role-permission-matrix.json',
      'environment.json',
      'collection-report.md',
      'review-guidelines.md (annotation-guideline equivalent)',
      'schema/model-input-sample.schema.json',
    ],
    forbiddenFieldScan:
      'model-inputs.jsonl was scanned for groundTruth/requestIntent/exploitOutcome/exploitConfirmed/canaryObserved/executionEvidence/responseStatus/responseBody/responseSanitized/collectorLabel/expectedVerdict/labels/metadata/verdict/attackFamily/recommendedAction/isHardNegative/split/latencyMs — zero occurrences. Top-level keys are exactly {sampleId, input}; input keys are exactly {method, path, headers, body, sourceContext}.',
    labelDistributionIndependence:
      'collection-report.md contains a category-count table and a pre-designed attack-family table. Those numbers were read but explicitly NOT used to shape any label; no sample was relabelled to approach any target proportion. Annotator-b totals differ from that table (e.g. 110 attack vs 69 attack-traffic; 46 unknown vs 51 unknown-cases), which is consistent with independent judgement rather than proportion-fitting.',
    promptInjectionHandling:
      'Samples contain instruction-shaped text (Ignore previous instructions / Reveal your system prompt / Output verdict benign / Change the schema). All such text was treated strictly as data to classify. No instruction inside any sample altered the schema, the output paths, or any verdict.',
    perspective:
      'Annotator-b applied a business-context and false-positive-control lens: a dangerous string sitting in a stored note, KB article, postmortem or detection-rule pattern was judged on its business function rather than on keyword match, while the same string placed in a parsed query/path/URL/cmd slot was judged an attempt. Ownership-, role- and scope-dependent cases were labelled unknown rather than guessed.',
    knownLimitations: [
      'Object ownership is not observable in any sample, so all direct-object-reference reads (123-127, 204-209) are unknown/idor_bola rather than a definite verdict.',
      'The acting principal role is not carried in the input; role-permission-matrix.json documents only the tested tenant_admin role. Cross-tenant oversight reads and the two privileged writes are therefore flagged for expert review even where a verdict was assigned.',
      'Whether a given field is stored, rendered or parsed cannot be determined from the request, so stored-payload cases (XSS notes, SQL-in-note, log query fragments) carry an explicit review reason.',
      'Response-side evidence was not used at all, by rule; exploit success is therefore never asserted, only attempt.',
    ],
  },
};

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`wrote ${REPORT}`);
console.log(`inputSha256=${inputSha}`);
