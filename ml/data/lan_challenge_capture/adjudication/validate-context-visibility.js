/*
 * Mechanical floor for the VIguard context-visibility contract.
 * Natural-language sufficiency still requires the completed audit; this validator blocks
 * known leakage fields, inconsistent unknown labels, unaudited samples, audit drift, and
 * inconsistent post-evaluation human-review provenance.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = __dirname;
const DATA = path.resolve(OUT, '..');
const ANN = path.join(DATA, 'annotations');
const DECISIONS = path.join(OUT, 'decisions');
const HUMAN_ATTESTATION = path.join(DATA, 'human-review', 'human-review-attestation.json');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) {
      throw new Error(`unparseable line ${index + 1} in ${file}: ${error.message}`);
    }
  });
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const inputs = readJsonl(path.join(DATA, 'model-inputs.jsonl'));
const finalLabels = readJsonl(path.join(OUT, 'final-labels.jsonl'));
const adjudication = readJsonl(path.join(OUT, 'adjudication.jsonl'));
const audit = JSON.parse(fs.readFileSync(path.join(OUT, 'context-visibility-audit.json'), 'utf8'));
const integrity = JSON.parse(fs.readFileSync(path.join(OUT, 'integrity-check.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'final-labels-manifest.json'), 'utf8'));
const humanAttestation = JSON.parse(fs.readFileSync(HUMAN_ATTESTATION, 'utf8'));
const decisions = [];
for (const file of fs.readdirSync(DECISIONS).filter((name) => /^batch-\d+\.jsonl$/.test(name)).sort()) {
  decisions.push(...readJsonl(path.join(DECISIONS, file)));
}

const inputIds = new Set(inputs.map((row) => row.sampleId));
const finalById = new Map(finalLabels.map((row) => [row.sampleId, row]));
const adjudicationById = new Map(adjudication.map((row) => [row.sampleId, row]));
const decisionById = new Map(decisions.map((row) => [row.sampleId, row]));
const issueById = new Map(audit.issues.map((row) => [row.sampleId, row]));

// 1-2. No response-side fields, Collector Ground Truth, or collection intent in final reasons.
const forbiddenReasonTerms = [
  'responseStatus',
  'responseBody',
  'responseSanitized',
  'responseHeaders',
  'groundTruth',
  'requestIntent',
  'collectorLabel',
  'exploitConfirmed',
  'canaryObserved',
  'executionEvidence',
];
for (const row of decisions) {
  const reasoning = JSON.stringify({
    evidence: row.evidence,
    rationale: row.rationale,
    auditReason: row.auditReason,
  });
  for (const term of forbiddenReasonTerms) {
    check(!reasoning.toLowerCase().includes(term.toLowerCase()), `${row.sampleId} decision reason references forbidden ${term}`);
  }
}

// 3. A context-sufficient label cannot simultaneously claim that critical RBAC/object facts are unknown.
const criticalContext = /(实际调用者|主体角色|调用者角色|对象归属|资源归属|当前租户|目标租户|principal\s+role|object\s+ownership|tenant\s+scope)/i;
const unavailable = /(不可观测|未知|未提供|未确认|不在.*输入|absent|unknown|not observable|not provided|not confirmed)/i;
for (const row of decisions) {
  if (!row.finalContextSufficient) continue;
  const reasoning = `${(row.evidence || []).join(' ')} ${row.rationale || ''} ${row.auditReason || ''}`;
  check(!(criticalContext.test(reasoning) && unavailable.test(reasoning)),
    `${row.sampleId} contextSufficient=true while critical role/ownership/tenant context is described as unavailable`);
}

// 4-5. Unknown / insufficient-context invariants.
for (const row of decisions) {
  if (row.resolutionDecision === 'insufficient_context') {
    check(row.finalVerdict === 'unknown', `${row.sampleId} insufficient_context but verdict=${row.finalVerdict}`);
    check(row.finalContextSufficient === false, `${row.sampleId} insufficient_context but contextSufficient!=false`);
    check(row.finalRecommendedAction !== 'allow', `${row.sampleId} insufficient_context but action=allow`);
  }
  if (row.finalVerdict === 'unknown') {
    check(row.finalContextSufficient === false, `${row.sampleId} unknown decision but contextSufficient!=false`);
  }
}
for (const row of finalLabels) {
  if (row.verdict === 'unknown') {
    check(row.contextSufficient === false, `${row.sampleId} unknown final label but contextSufficient!=false`);
    check(row.recommendedAction !== 'allow', `${row.sampleId} unknown final label but action=allow`);
  }
}

// 6. Every adjudication output must match its decision and final-label projection.
check(decisions.length === 253, `decision count ${decisions.length} != 253`);
check(adjudication.length === 253, `adjudication count ${adjudication.length} != 253`);
for (const decision of decisions) {
  const adjudicated = adjudicationById.get(decision.sampleId);
  const final = finalById.get(decision.sampleId);
  check(!!adjudicated, `${decision.sampleId} missing adjudication row`);
  check(!!final, `${decision.sampleId} missing final label`);
  if (!adjudicated || !final) continue;
  check(adjudicated.finalVerdict === decision.finalVerdict, `${decision.sampleId} adjudication verdict drift`);
  check(adjudicated.finalAttackFamily === decision.finalAttackFamily, `${decision.sampleId} adjudication family drift`);
  check(adjudicated.finalRecommendedAction === decision.finalRecommendedAction, `${decision.sampleId} adjudication action drift`);
  check(adjudicated.finalContextSufficient === decision.finalContextSufficient, `${decision.sampleId} adjudication context drift`);
  check(adjudicated.resolutionDecision === decision.resolutionDecision, `${decision.sampleId} adjudication resolution drift`);
  check(final.verdict === decision.finalVerdict, `${decision.sampleId} final verdict drift`);
  check(final.attackFamily === decision.finalAttackFamily, `${decision.sampleId} final family drift`);
  check(final.recommendedAction === decision.finalRecommendedAction, `${decision.sampleId} final action drift`);
  check(final.contextSufficient === decision.finalContextSufficient, `${decision.sampleId} final context drift`);
  check(final.resolutionDecision === decision.resolutionDecision, `${decision.sampleId} final resolution drift`);
}

// 7. Frozen source files remain byte-identical.
check(sha256File(path.join(DATA, 'model-inputs.jsonl')) === integrity.inputSha256, 'model-inputs SHA changed');
check(sha256File(path.join(ANN, 'model-a-annotations.jsonl')) === integrity.aSha256, 'model-a annotations SHA changed');
check(sha256File(path.join(ANN, 'model-b-annotations.jsonl')) === integrity.bSha256, 'model-b annotations SHA changed');

// 8. The audit explicitly covers all 413 model-visible rows.
const auditedIds = new Set(audit.auditedSampleIds || []);
check(audit.sampleCount === 413, `audit sampleCount ${audit.sampleCount} != 413`);
check(audit.adjudicatedSampleCount === 253, `audit adjudicatedSampleCount ${audit.adjudicatedSampleCount} != 253`);
check(audit.consensusSampleCount === 160, `audit consensusSampleCount ${audit.consensusSampleCount} != 160`);
check(audit.auditedSampleCount === 413, `audit auditedSampleCount ${audit.auditedSampleCount} != 413`);
check(auditedIds.size === 413, `audit unique audited IDs ${auditedIds.size} != 413`);
check([...inputIds].every((id) => auditedIds.has(id)), 'audit does not cover every model input sampleId');

// 9. Every recorded correction is real and projected through all generated artifacts.
const correctedIds = new Set(audit.correctedSampleIds || []);
check(correctedIds.size === audit.correctedLabelCount, 'audit correctedSampleIds count mismatch');
check(audit.hiddenContextIssueCount === audit.issues.length, 'audit issue count mismatch');
check(audit.correctedLabelCount === audit.issues.length, 'audit corrected label count mismatch');
for (const id of correctedIds) {
  const issue = issueById.get(id);
  const decision = decisionById.get(id);
  const final = finalById.get(id);
  check(!!issue, `${id} correctedSampleId missing issue`);
  check(!!decision && !!final, `${id} correction missing decision/final row`);
  if (!issue || !decision || !final) continue;
  check(issue.previousVerdict !== issue.finalVerdict, `${id} audit issue does not describe a changed verdict`);
  check(issue.finalVerdict === decision.finalVerdict && issue.finalVerdict === final.verdict, `${id} audit issue verdict drift`);
  check(decision.resolutionDecision === 'insufficient_context', `${id} correction not insufficient_context`);
}
const categoryTotal = Object.values(audit.issueCategories).reduce((sum, value) => sum + value, 0);
check(categoryTotal === audit.issues.length, `audit issue category total ${categoryTotal} != ${audit.issues.length}`);
check(audit.responseSideEvidenceUsed === false, 'audit does not declare responseSideEvidenceUsed=false');
check(audit.collectorGroundTruthUsed === false, 'audit does not declare collectorGroundTruthUsed=false');

// 10. Freeze timestamp, final hash, and confidential post-evaluation human-review attestation.
check(typeof manifest.labelsFrozenAt === 'string' && !!Date.parse(manifest.labelsFrozenAt), 'manifest labelsFrozenAt missing/invalid');
check(typeof manifest.provenanceMetadataCorrectedAt === 'string' && !!Date.parse(manifest.provenanceMetadataCorrectedAt),
  'manifest provenanceMetadataCorrectedAt missing/invalid');
check(manifest.frozenAt === manifest.labelsFrozenAt, 'legacy frozenAt does not alias labelsFrozenAt');
check(sha256File(path.join(OUT, 'final-labels.jsonl')) === manifest.finalLabelsSha256, 'manifest final-labels SHA drift');
check(manifest.humanReviewed === true, 'manifest humanReviewed must be true after blind review confirmation');
check(manifest.humanReviewTiming === 'post_evaluation', 'manifest humanReviewTiming must be post_evaluation');
check(manifest.humanReviewCoverage === 413, 'manifest humanReviewCoverage must be 413');
check(manifest.reviewerCount === null && manifest.reviewerCountDisclosure === 'withheld_for_confidentiality',
  'manifest reviewer-count confidentiality declaration is inconsistent');
check(manifest.humanReviewDisagreementCount === 0, 'manifest human-review disagreement count must be zero');
check(manifest.finalLabelsChangedAfterHumanReview === false, 'manifest must state no post-review label changes');
check(manifest.humanReviewAttestationSha256 === sha256File(HUMAN_ATTESTATION), 'human-review attestation SHA drift');
check(humanAttestation.status === 'completed', 'human-review attestation is not completed');
check(humanAttestation.reviewMode === 'blind_review', 'human-review mode is not blind_review');
check(humanAttestation.reviewScope.sampleCount === 413, 'human-review attestation does not cover 413');
check(humanAttestation.reviewScope.reviewerSawAnnotatorAOrBLabelsBeforeDecision === false,
  'human reviewer saw A/B labels before blind decision');
check(humanAttestation.reviewScope.reviewerSawAdjudicatorDecisionBeforeDecision === false,
  'human reviewer saw adjudicator decision before blind decision');
check(humanAttestation.reviewScope.reviewerSawAetherArgusPredictions === false,
  'human reviewer saw AetherArgus predictions');
check(humanAttestation.reviewOutcome.disagreementWithFrozenReferenceCount === 0,
  'human-review attestation reports disagreement');
check(humanAttestation.reviewOutcome.finalLabelsChanged === false,
  'human-review attestation reports label changes');
check(humanAttestation.reviewOutcome.finalLabelsSha256AfterReview === manifest.finalLabelsSha256,
  'human-review attestation final SHA does not match manifest');
check(manifest.eligibleForTraining === false, 'manifest makes challenge labels eligible for training');

console.log('=== validate-context-visibility ===');
console.log('audited:', audit.auditedSampleCount, ' corrected:', audit.correctedLabelCount, ' unchanged:', audit.unchangedLabelCount);
console.log('human review:', humanAttestation.status, ' coverage:', humanAttestation.reviewScope.sampleCount,
  ' disagreements:', humanAttestation.reviewOutcome.disagreementWithFrozenReferenceCount);
console.log('checks failed:', failures.length);
if (failures.length) {
  for (const failure of failures.slice(0, 50)) console.log('  FAIL:', failure);
  process.exit(1);
}
// Preserve the legacy marker consumed by the challenge-capture regression suite.
console.log('CONTEXT VISIBILITY VALIDATION PASSED');
console.log('CONTEXT VISIBILITY AND HUMAN REVIEW VALIDATION PASSED');
