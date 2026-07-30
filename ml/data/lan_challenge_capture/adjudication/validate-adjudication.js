/*
 * validate-adjudication.js — programmatic validation (§17). Exits non-zero on any failure.
 *
 * 15 checks over final-labels.jsonl, adjudication.jsonl, disagreement-queue.jsonl,
 * consensus.jsonl, model-inputs.jsonl, the A/B annotation files, integrity-check.json, and
 * final-labels-manifest.json. Pure mechanical verification — no LLM, no network.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = __dirname;
const DATA = path.resolve(OUT, '..');
const ANN = path.join(DATA, 'annotations');

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`unparseable line ${i + 1} in ${p}: ${e.message}`); }
  });
}
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

const failures = [];
function check(cond, msg) { if (!cond) failures.push(msg); }

const inputs = readJsonl(path.join(DATA, 'model-inputs.jsonl'));
const annA = readJsonl(path.join(ANN, 'model-a-annotations.jsonl'));
const annB = readJsonl(path.join(ANN, 'model-b-annotations.jsonl'));
const finalLabels = readJsonl(path.join(OUT, 'final-labels.jsonl'));
const adjudication = readJsonl(path.join(OUT, 'adjudication.jsonl'));
const queue = readJsonl(path.join(OUT, 'disagreement-queue.jsonl'));
const consensus = readJsonl(path.join(OUT, 'consensus.jsonl'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'final-labels-manifest.json'), 'utf8'));
const integrity = JSON.parse(fs.readFileSync(path.join(OUT, 'integrity-check.json'), 'utf8'));

const aMap = new Map(annA.map(r => [r.sampleId, r]));
const bMap = new Map(annB.map(r => [r.sampleId, r]));
const inputIds = new Set(inputs.map(r => r.sampleId));

// Enum sets derived empirically from the annotators (the authoritative schema actually used).
const VERDICTS = new Set(['safe', 'attack', 'unknown']);
const ACTIONS = new Set(['allow', 'monitor', 'block', 'challenge', 'isolate']);
const famUnion = new Set();
for (const r of annA) famUnion.add(r.attackFamily);
for (const r of annB) famUnion.add(r.attackFamily);

// 1. final-labels exactly 413
check(finalLabels.length === 413, `final-labels count ${finalLabels.length} != 413`);

// 2 & 3. sampleId alignment with input, no dup, no missing
const finalIds = finalLabels.map(r => r.sampleId);
check(new Set(finalIds).size === finalIds.length, 'final-labels has duplicate sampleId');
check(finalIds.every(id => inputIds.has(id)), 'final-labels sampleId not all in input');
check(inputIds.size === new Set(finalIds).size && [...inputIds].every(id => finalIds.includes(id)),
  'final-labels does not cover every input sampleId exactly once');

// 4. all enums legal
for (const r of finalLabels) {
  check(VERDICTS.has(r.verdict), `${r.sampleId} illegal verdict ${r.verdict}`);
  check(ACTIONS.has(r.recommendedAction), `${r.sampleId} illegal action ${r.recommendedAction}`);
  check(famUnion.has(r.attackFamily), `${r.sampleId} illegal family ${r.attackFamily}`);
  check(typeof r.contextSufficient === 'boolean', `${r.sampleId} ctx not boolean`);
  check(['consensus', 'model_adjudication'].includes(r.resolutionType), `${r.sampleId} bad resolutionType`);
  check(Number.isInteger(r.adjudicatorConfidence) && r.adjudicatorConfidence >= 1 && r.adjudicatorConfidence <= 5, `${r.sampleId} bad conf`);
}

// 5. all eligibleForTraining=false
check(finalLabels.every(r => r.eligibleForTraining === false), 'some final-label not eligibleForTraining=false');

// 6. all split=external_challenge_test
check(finalLabels.every(r => r.split === 'external_challenge_test'), 'some final-label split != external_challenge_test');

// 7. consensus samples strictly satisfy consensus rules
const HIGH_RISK = new Set(['authorization', 'idor_bola', 'business_logic', 'prompt_injection', 'authentication', 'file_upload', 'ssrf', 'deserialization']);
function isStrictConsensus(a, b) {
  return a.verdict === b.verdict
    && a.attackFamily === b.attackFamily
    && a.recommendedAction === b.recommendedAction
    && !!a.contextSufficient === !!b.contextSufficient
    && a.confidence >= 4 && b.confidence >= 4
    && !a.needsExpertReview && !b.needsExpertReview
    && a.verdict !== 'unknown' && b.verdict !== 'unknown'
    && !HIGH_RISK.has(a.attackFamily) && !HIGH_RISK.has(b.attackFamily);
}
const consensusSet = new Set(consensus.map(r => r.sampleId));
for (const r of finalLabels) {
  if (r.resolutionType === 'consensus') {
    check(consensusSet.has(r.sampleId), `${r.sampleId} marked consensus but not in consensus set`);
    const a = aMap.get(r.sampleId), b = bMap.get(r.sampleId);
    check(isStrictConsensus(a, b), `${r.sampleId} consensus row does not satisfy strict consensus rules`);
    check(r.requiresHumanAudit === false, `${r.sampleId} consensus row unexpectedly requiresHumanAudit`);
  }
}

// 8. non-consensus samples all have an adjudication record
const adjBySample = new Map(adjudication.map(r => [r.sampleId, r]));
for (const r of finalLabels) {
  if (r.resolutionType === 'model_adjudication') {
    check(adjBySample.has(r.sampleId), `${r.sampleId} model_adjudication but no adjudication.jsonl record`);
  }
}
for (const r of adjudication) {
  const f = finalLabels.find(x => x.sampleId === r.sampleId);
  check(!!f && f.resolutionType === 'model_adjudication', `${r.sampleId} adjudication record has no matching model_adjudication final-label`);
}

// 9. adjudication queue aligns with adjudication results (same sampleId set)
const queueIds = new Set(queue.map(r => r.sampleId));
const adjIds = new Set(adjudication.map(r => r.sampleId));
check(queueIds.size === adjIds.size && [...queueIds].every(id => adjIds.has(id)),
  'adjudication queue and adjudication.jsonl sampleId sets differ');
for (const r of adjudication) {
  const q = queue.find(x => x.sampleId === r.sampleId);
  check(r.annotatorAVerdict === q.annotatorA.verdict, `${r.sampleId} annotatorAVerdict mismatch`);
  check(r.annotatorBVerdict === q.annotatorB.verdict, `${r.sampleId} annotatorBVerdict mismatch`);
}

// 10. no response fields or collector labels leaked into any adjudication output
const forbiddenKeys = ['responseStatus', 'responseBody', 'responseSanitized', 'executionEvidence',
  'exploitConfirmed', 'canaryObserved', 'requestIntent', 'exploitOutcome', 'collectorLabel',
  'groundTruth', 'isHardNegative', 'latencyMs', 'responseHeaders'];
function hasForbidden(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const k of forbiddenKeys) if (k in obj) return true;
  return false;
}
for (const r of finalLabels) check(!hasForbidden(r), `final-labels ${r.sampleId} leaked forbidden field`);
for (const r of adjudication) check(!hasForbidden(r), `adjudication ${r.sampleId} leaked forbidden field`);

// 11. A/B original SHA-256 unchanged (vs integrity-check.json recorded at compare time)
check(sha256File(path.join(ANN, 'model-a-annotations.jsonl')) === integrity.aSha256, 'model-a SHA changed since integrity check');
check(sha256File(path.join(ANN, 'model-b-annotations.jsonl')) === integrity.bSha256, 'model-b SHA changed since integrity check');
check(sha256File(path.join(DATA, 'model-inputs.jsonl')) === integrity.inputSha256, 'model-inputs SHA changed since integrity check');

// 12. final-labels SHA-256 matches manifest
check(sha256File(path.join(OUT, 'final-labels.jsonl')) === manifest.finalLabelsSha256, 'final-labels SHA != manifest');
check(manifest.inputSha256 === integrity.inputSha256, 'manifest inputSha256 != integrity');
check(manifest.annotatorASha256 === integrity.aSha256, 'manifest A sha != integrity');
check(manifest.annotatorBSha256 === integrity.bSha256, 'manifest B sha != integrity');
check(manifest.sampleCount === 413 && manifest.consensusCount + manifest.modelAdjudicationCount === 413,
  'manifest counts inconsistent');

// 13. humanReviewed=false
check(manifest.humanReviewed === false && manifest.reviewerCount === 0, 'manifest not humanReviewed=false/reviewerCount=0');
check(manifest.labelsFrozenBeforeAetherArgusEvaluation === true, 'manifest frozen flag not true');
check(manifest.eligibleForTraining === false, 'manifest eligibleForTraining not false');

// 14. no AetherArgus prediction files referenced: assert forbidden prediction/collector files
//     are NOT present inside the adjudication output directory tree.
const forbiddenPredFiles = ['model-labels.jsonl', 'all-sanitized.jsonl', 'attack-traffic.jsonl',
  'normal-traffic.jsonl', 'hard-negatives.jsonl', 'prompt-injection.jsonl', 'unknown-cases.jsonl',
  'findings.json', 'model-benchmark.jsonl', 'review-queue.jsonl'];
const presentInAdjudication = new Set();
(function walk(d) {
  for (const e of fs.readdirSync(d)) {
    const full = path.join(d, e);
    if (fs.statSync(full).isDirectory()) walk(full);
    else presentInAdjudication.add(e);
  }
})(OUT);
for (const f of forbiddenPredFiles) check(!presentInAdjudication.has(f), `forbidden prediction/collector file ${f} present in adjudication dir`);

// 15. every JSONL line independently parseable (already enforced by readJsonl above for our outputs)
//     Re-state explicitly: re-parse every line of the three core outputs.
for (const p of ['final-labels.jsonl', 'adjudication.jsonl', 'disagreement-queue.jsonl']) {
  const lines = fs.readFileSync(path.join(OUT, p), 'utf8').split(/\r?\n/).filter(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    try { JSON.parse(lines[i]); } catch (e) { failures.push(`${p} line ${i + 1} unparseable`); }
  }
}

// report
console.log('=== validate-adjudication ===');
console.log('final-labels:', finalLabels.length, ' adjudication:', adjudication.length, ' queue:', queue.length, ' consensus:', consensus.length);
console.log('checks failed:', failures.length);
if (failures.length) {
  for (const f of failures.slice(0, 40)) console.log('  FAIL:', f);
  process.exit(1);
}
console.log('ALL 15 CHECKS PASSED');
