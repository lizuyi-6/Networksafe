/*
 * build-outputs.js — assemble adjudication.jsonl (§12) and final-labels.jsonl (§14, 413 rows).
 *
 * Inputs (all request-side / adjudicator-authored; no AetherArgus predictions, no collector
 * labels, no response fields):
 *   - adjudication/consensus.jsonl               (160 strict-consensus rows from compare-annotations)
 *   - adjudication/disagreement-queue.jsonl      (253 queue rows, full §8 format)
 *   - adjudication/decisions/batch-*.jsonl       (adjudicator-C per-sample decisions)
 *
 * Outputs:
 *   - adjudication/adjudication.jsonl            (253 rows, §12 format, sorted by sampleId)
 *   - adjudication/final-labels.jsonl            (413 rows, §14 format, sorted by sampleId)
 *   - adjudication/build-stats.json              (counts for the manifest/report)
 *
 * requiresHumanAudit is computed DETERMINISTICALLY from the §13 trigger set, then OR-ed with
 * any adjudicator-supplied auditReason, so coverage does not depend on the adjudicator remembering
 * to set the flag. humanAuditReason is non-empty whenever requiresHumanAudit is true.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const DATA = path.resolve(__dirname, '..');

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}
function writeJsonl(p, rows) {
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

const consensus = readJsonl(path.join(OUT, 'consensus.jsonl'));
const queue = readJsonl(path.join(OUT, 'disagreement-queue.jsonl'));
const queueBySample = new Map(queue.map(r => [r.sampleId, r]));

// Load adjudicator decisions (batch files).
const decDir = path.join(OUT, 'decisions');
const decisions = new Map();
for (const f of fs.readdirSync(decDir).sort()) {
  if (!/^batch-\d+\.jsonl$/.test(f)) continue;
  for (const d of readJsonl(path.join(decDir, f))) {
    if (decisions.has(d.sampleId)) throw new Error('duplicate decision sampleId: ' + d.sampleId);
    decisions.set(d.sampleId, d);
  }
}

if (decisions.size !== queue.length) {
  throw new Error(`decision count ${decisions.size} != queue count ${queue.length}`);
}
for (const r of queue) {
  if (!decisions.has(r.sampleId)) throw new Error('no decision for queue sample ' + r.sampleId);
}
for (const sid of decisions.keys()) {
  if (!queueBySample.has(sid)) throw new Error('decision for non-queue sample ' + sid);
}

// §13 deterministic human-audit triggers.
const AUDIT_FAMILIES = new Set(['idor_bola', 'authorization', 'authentication', 'business_logic', 'prompt_injection']);
function auditReasons(dec, qrow) {
  const reasons = [];
  const a = qrow.annotatorA, b = qrow.annotatorB;
  if ((a.verdict === 'attack' && b.verdict === 'safe') || (a.verdict === 'safe' && b.verdict === 'attack')) {
    reasons.push('safe_attack_verdict_flip');
  }
  if (dec.finalVerdict === 'unknown') reasons.push('final_verdict_unknown');
  if (AUDIT_FAMILIES.has(dec.finalAttackFamily)) reasons.push('high_risk_family:' + dec.finalAttackFamily);
  if (dec.adjudicatorConfidence <= 3) reasons.push('adjudicator_confidence_le_3');
  if (dec.resolutionDecision === 'new_resolution') reasons.push('new_resolution');
  const coreSame = a.verdict === b.verdict && a.attackFamily === b.attackFamily && a.recommendedAction === b.recommendedAction;
  if (a.confidence >= 4 && b.confidence >= 4 && !coreSame) reasons.push('both_high_conf_core_disagree');
  if (dec.auditReason && dec.auditReason.trim()) reasons.push('adjudicator:' + dec.auditReason.trim());
  return reasons;
}
function acceptedAnnotator(rd) {
  if (rd === 'accept_a') return 'A';
  if (rd === 'accept_b') return 'B';
  return null;
}

// --- adjudication.jsonl (§12) ---
const adjudicationRows = [];
for (const r of queue) {
  const d = decisions.get(r.sampleId);
  const reasons = auditReasons(d, r);
  const requiresHumanAudit = reasons.length > 0;
  adjudicationRows.push({
    sampleId: r.sampleId,
    annotatorAVerdict: r.annotatorA.verdict,
    annotatorBVerdict: r.annotatorB.verdict,
    finalVerdict: d.finalVerdict,
    finalAttackFamily: d.finalAttackFamily,
    finalRecommendedAction: d.finalRecommendedAction,
    finalContextSufficient: d.finalContextSufficient,
    adjudicatorConfidence: d.adjudicatorConfidence,
    resolutionDecision: d.resolutionDecision,
    resolutionType: 'model_adjudication',
    acceptedAnnotator: acceptedAnnotator(d.resolutionDecision),
    evidence: d.evidence,
    rationale: d.rationale,
    requiresHumanAudit,
    humanAuditReason: requiresHumanAudit ? reasons.join('; ') : '',
  });
}
adjudicationRows.sort((x, y) => (x.sampleId < y.sampleId ? -1 : x.sampleId > y.sampleId ? 1 : 0));
writeJsonl(path.join(OUT, 'adjudication.jsonl'), adjudicationRows);

// --- final-labels.jsonl (§14): 160 consensus + 253 adjudication = 413 ---
const ANNOT_SOURCES = ['GPT-5.6-SOL', 'Claude Opus 5'];
const finalRows = [];

for (const c of consensus) {
  finalRows.push({
    sampleId: c.sampleId,
    verdict: c.verdict,
    attackFamily: c.attackFamily,
    recommendedAction: c.recommendedAction,
    contextSufficient: c.contextSufficient,
    resolutionType: 'consensus',
    resolutionDecision: 'a_b_agreement',
    adjudicatorConfidence: c.confidence,
    annotationSources: ANNOT_SOURCES,
    requiresHumanAudit: false,
    eligibleForTraining: false,
    split: 'external_challenge_test',
  });
}

const adjBySample = new Map(adjudicationRows.map(r => [r.sampleId, r]));
for (const r of queue) {
  const d = decisions.get(r.sampleId);
  const a = adjBySample.get(r.sampleId);
  finalRows.push({
    sampleId: r.sampleId,
    verdict: d.finalVerdict,
    attackFamily: d.finalAttackFamily,
    recommendedAction: d.finalRecommendedAction,
    contextSufficient: d.finalContextSufficient,
    resolutionType: 'model_adjudication',
    resolutionDecision: d.resolutionDecision,
    adjudicatorConfidence: d.adjudicatorConfidence,
    annotationSources: ANNOT_SOURCES,
    requiresHumanAudit: a.requiresHumanAudit,
    eligibleForTraining: false,
    split: 'external_challenge_test',
  });
}

finalRows.sort((x, y) => (x.sampleId < y.sampleId ? -1 : x.sampleId > y.sampleId ? 1 : 0));
if (finalRows.length !== 413) throw new Error('final-labels count ' + finalRows.length + ' != 413');
writeJsonl(path.join(OUT, 'final-labels.jsonl'), finalRows);

// --- build-stats.json (for manifest/report) ---
function dist(rows, key) {
  const d = {};
  for (const r of rows) d[r[key]] = (d[r[key]] || 0) + 1;
  return d;
}
const stats = {
  sampleCount: finalRows.length,
  consensusCount: consensus.length,
  modelAdjudicationCount: adjudicationRows.length,
  requiresHumanAuditCount: finalRows.filter(r => r.requiresHumanAudit).length,
  finalVerdictDistribution: dist(finalRows, 'verdict'),
  finalAttackFamilyDistribution: dist(finalRows, 'attackFamily'),
  finalRecommendedActionDistribution: dist(finalRows, 'recommendedAction'),
  resolutionDecisionDistribution: dist(adjudicationRows, 'resolutionDecision'),
  acceptedAnnotatorDistribution: dist(adjudicationRows, 'acceptedAnnotator'),
};
fs.writeFileSync(path.join(OUT, 'build-stats.json'), JSON.stringify(stats, null, 2) + '\n');

console.log('adjudication.jsonl rows:', adjudicationRows.length);
console.log('final-labels.jsonl rows:', finalRows.length);
console.log('consensus:', consensus.length, ' adjudication:', adjudicationRows.length);
console.log('requiresHumanAudit:', stats.requiresHumanAuditCount);
console.log('final verdict dist:', JSON.stringify(stats.finalVerdictDistribution));
console.log('resolutionDecision dist:', JSON.stringify(stats.resolutionDecisionDistribution));
console.log('acceptedAnnotator dist:', JSON.stringify(stats.acceptedAnnotatorDistribution));
