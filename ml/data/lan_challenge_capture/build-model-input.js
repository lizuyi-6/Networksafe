#!/usr/bin/env node
'use strict';
// Whitelist model-input builder for the VIguard LAN challenge set.
//
// The model may ONLY receive `record.input` (method, path, headers, body, sourceContext).
// This builder constructs a prompt string from EXACTLY those fields and nothing else:
//   - It does NOT use object spread ({ ...record }) which would leak labels/metadata/sampleId.
//   - It reads each input field by explicit name.
//   - On any structural violation (missing input, extra top-level fields that look like
//     labels, or input.* containing response/label fields) it FAILS CLOSED.
//
// Eval-time usage: the model process reads model-inputs.jsonl (sampleId + input only),
// produces predictions, then a separate scoring process joins on sampleId against
// model-labels.jsonl. sampleId is a join key only - it never enters the model prompt.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// Fields that must NEVER appear inside `input` (they are response-time or label data).
const FORBIDDEN_IN_INPUT = [
  'responseStatus', 'responseHeaders', 'responseBody', 'responseSanitized',
  'latencyMs', 'executionEvidence', 'canaryObserved', 'exploitConfirmed',
  'exploitAttempted', 'responseActuallyReceived', 'safety', 'evidenceSummary',
  'verdict', 'attackFamily', 'recommendedAction', 'contextSufficient',
  'requestIntent', 'exploitOutcome', 'isHardNegative', 'groundTruth',
  'labels', 'metadata', 'datasetMetadata', 'split', 'eligibleForTraining',
  'humanReviewed', 'reviewerCount', 'interAnnotatorAgreement', 'cohenKappa',
  'adjudicatedSamples', 'targetSpecific', 'targetIp', 'targetApplication',
  'requestActuallySent', 'source',
];

// Fields that may appear at the TOP level of a benchmark record (input/labels/metadata).
// Anything ELSE at top level is rejected.
const ALLOWED_TOP = new Set(['sampleId', 'input', 'labels', 'metadata']);

// Build a model prompt from a benchmark record. Returns { sampleId, prompt }.
// Throws (fail closed) if the record structure would leak labels into the prompt.
function buildPrompt(record) {
  if (!record || typeof record !== 'object') throw new Error('record is not an object');
  // Reject unknown top-level fields (a flattened/legacy record).
  for (const k of Object.keys(record)) {
    if (!ALLOWED_TOP.has(k)) throw new Error(`unexpected top-level field: ${k} (legacy/flat structure rejected)`);
  }
  const input = record.input;
  if (!input || typeof input !== 'object') throw new Error('record.input missing or not an object');
  // Reject any forbidden field inside input.
  for (const f of FORBIDDEN_IN_INPUT) {
    if (f in input) throw new Error(`forbidden field in input: ${f}`);
  }
  // Explicitly read each allowed input field by name (NO spread).
  const method = typeof input.method === 'string' ? input.method : '';
  const reqPath = typeof input.path === 'string' ? input.path : '';
  const headers = (input.headers && typeof input.headers === 'object') ? input.headers : {};
  const body = input.body == null ? '' : String(input.body);
  const sc = (input.sourceContext && typeof input.sourceContext === 'object') ? input.sourceContext : {};
  const authenticated = sc.authenticated === true;
  const targetApp = typeof sc.targetApplication === 'string' ? sc.targetApplication : '';

  // Construct the prompt from input fields ONLY. sampleId is NOT included.
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const prompt =
`HTTP ${method} ${reqPath}
headers:
${headerLines || '(none)'}
body:
${body || '(none)'}
authenticated: ${authenticated}
targetApplication: ${targetApp}`;
  return { sampleId: record.sampleId, prompt };
}

// CLI: read model-benchmark.jsonl, emit a prompt per sample to stdout as JSONL
// { sampleId, prompt }. Exits non-zero on ANY structural violation (fail closed).
function main() {
  const fp = path.join(DIR, 'model-benchmark.jsonl');
  if (!fs.existsSync(fp)) { console.error('model-benchmark.jsonl not found'); process.exit(1); }
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
  let n = 0, violations = 0;
  const out = [];
  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch (e) { console.error(`unparseable: ${line.slice(0, 60)}`); violations++; continue; }
    try {
      const { sampleId, prompt } = buildPrompt(rec);
      out.push(JSON.stringify({ sampleId, prompt }));
      n++;
    } catch (e) {
      console.error(`VIOLATION ${rec.sampleId || '?'}: ${e.message}`);
      violations++;
    }
  }
  if (violations > 0) { console.error(`build-model-input: ${violations} violation(s) - FAIL CLOSED`); process.exit(1); }
  process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
  console.error(`build-model-input: ${n} prompts emitted, 0 violations`);
}

module.exports = { buildPrompt, FORBIDDEN_IN_INPUT, ALLOWED_TOP };
if (require.main === module) main();
