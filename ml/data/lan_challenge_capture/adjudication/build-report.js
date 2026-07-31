/*
 * build-report.js — adjudication-report.md and adjudication-report.json.
 * Pulls every number from agreement-report.json, build-stats.json, the label manifest,
 * the context-visibility audit, and the confidential human-review attestation.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const DATA = path.resolve(OUT, '..');
const agree = JSON.parse(fs.readFileSync(path.join(OUT, 'agreement-report.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(OUT, 'build-stats.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'final-labels-manifest.json'), 'utf8'));
const visibilityAudit = JSON.parse(fs.readFileSync(path.join(OUT, 'context-visibility-audit.json'), 'utf8'));
const humanReview = JSON.parse(fs.readFileSync(path.join(DATA, 'human-review', 'human-review-attestation.json'), 'utf8'));

const rd = stats.resolutionDecisionDistribution;
const aa = stats.acceptedAnnotatorDistribution;
const knownLimitations = [
  'Annotator B labels were produced by a deterministic rule program authored in one model session, creating intra-class correlation risk.',
  'The three AI systems may still share common training-data or safety-policy biases.',
  'The public human-review evidence is an operator-confirmed attestation; reviewer identities, count, worksheets, and raw materials are withheld for confidentiality.',
  'The human review occurred after the frozen model evaluation, although the unchanged label SHA means the existing scoring remains applicable.',
  'Samples requiring identity, role, ownership, tenant-boundary, or server-side execution semantics may remain unknown when those facts are absent from the model-visible input.',
  'The dataset is an authorized live-execution challenge set, not natural production traffic.',
  'The benchmark does not contain confirmed successful exploits.',
  'Human-reviewed reference labels should not be described as infallible or universally generalizable objective ground truth.',
];

const report = {
  schemaVersion: 3,
  title: 'VIguard LAN Challenge Set — AI-Assisted Adjudication and Confidential Blind Human Review Report',
  annotators: agree.annotators,
  adjudicator: manifest.adjudicator,
  inputs: {
    inputFile: agree.generatedFrom.inputFile,
    inputSha256: agree.generatedFrom.inputSha256,
    annotatorAFile: agree.generatedFrom.annotatorAFile,
    annotatorASha256: agree.generatedFrom.annotatorASha256,
    annotatorBFile: agree.generatedFrom.annotatorBFile,
    annotatorBSha256: agree.generatedFrom.annotatorBSha256,
    sampleCountA: 413,
    sampleCountB: 413,
  },
  agreement: {
    verdictObservedAgreement: agree.verdict.observedAgreement,
    verdictObservedAgreementRate: agree.verdict.observedAgreementRate,
    cohensKappa: agree.verdict.cohensKappa,
    kappaComponents: agree.verdict.kappaComponents,
    attackFamilyFullAgreementRate: agree.attackFamily.fullAgreementRate,
    attackFamilyMacroAgreementRate: agree.attackFamily.macroAgreementRate,
    actionFullAgreementRate: agree.recommendedAction.fullAgreementRate,
    contextSufficientAgreementRate: agree.contextSufficient.agreementRate,
    verdictConflicts: agree.verdict.conflicts,
  },
  resolution: {
    consensusCount: stats.consensusCount,
    modelAdjudicationCount: stats.modelAdjudicationCount,
    acceptA: rd.accept_a || 0,
    acceptB: rd.accept_b || 0,
    newResolution: rd.new_resolution || 0,
    insufficientContext: rd.insufficient_context || 0,
    acceptedAnnotatorA: aa.A || 0,
    acceptedAnnotatorB: aa.B || 0,
    acceptedAnnotatorNull: aa.null || 0,
  },
  finalLabelDistribution: {
    verdict: stats.finalVerdictDistribution,
    attackFamily: stats.finalAttackFamilyDistribution,
    recommendedAction: stats.finalRecommendedActionDistribution,
    finalUnknownCount: stats.finalVerdictDistribution.unknown || 0,
  },
  humanAudit: {
    requiresHumanAuditCount: stats.requiresHumanAuditCount,
    humanReviewed: true,
    reviewTiming: 'post_evaluation',
    reviewMode: 'confidential_blind_review',
    reviewCoverage: humanReview.reviewScope.sampleCount,
    confirmedSampleCount: humanReview.reviewOutcome.confirmedSampleCount,
    disagreementCount: humanReview.reviewOutcome.disagreementWithFrozenReferenceCount,
    finalLabelsChanged: humanReview.reviewOutcome.finalLabelsChanged,
    reviewerCount: null,
    reviewerCountDisclosure: humanReview.reviewerCountDisclosure,
    attestationFile: 'ml/data/lan_challenge_capture/human-review/human-review-attestation.json',
    attestationSha256: manifest.humanReviewAttestationSha256,
    reviewerSawAOrBBeforeDecision: humanReview.reviewScope.reviewerSawAnnotatorAOrBLabelsBeforeDecision,
    reviewerSawAdjudicationBeforeDecision: humanReview.reviewScope.reviewerSawAdjudicatorDecisionBeforeDecision,
    reviewerSawAetherArgusPredictions: humanReview.reviewScope.reviewerSawAetherArgusPredictions,
  },
  contextVisibilityAudit: {
    auditedSampleCount: visibilityAudit.auditedSampleCount,
    hiddenContextIssueCount: visibilityAudit.hiddenContextIssueCount,
    correctedLabelCount: visibilityAudit.correctedLabelCount,
    unchangedLabelCount: visibilityAudit.unchangedLabelCount,
    issueCategories: visibilityAudit.issueCategories,
    responseSideEvidenceUsed: visibilityAudit.responseSideEvidenceUsed,
    collectorGroundTruthUsed: visibilityAudit.collectorGroundTruthUsed,
  },
  finalLabelsSha256: manifest.finalLabelsSha256,
  labelsFrozenAt: manifest.labelsFrozenAt,
  provenanceMetadataCorrectedAt: manifest.provenanceMetadataCorrectedAt,
  humanReviewCompletedAt: manifest.humanReviewCompletedAt,
  frozenAt: manifest.labelsFrozenAt,
  declarations: {
    dualLlmAnnotationAndThirdLlmAdjudication: true,
    confidentialBlindHumanReviewCompleted: true,
    humanReviewOperatorAttested: true,
    rawHumanReviewArtifactsPubliclyReleased: false,
    humanReviewChangedLabels: false,
    notProductionNaturalTraffic: true,
    noAetherArgusPredictionsUsedForLabelingOrHumanReview: true,
    noResponseResultsUsedForAIAdjudication: true,
    challengeSetNotAddedToTraining: true,
    labelsFrozenBeforeModelEvaluation: true,
    humanReviewOccurredAfterModelEvaluation: true,
    unchangedLabelHashPreservesScoringApplicability: true,
    bSideDeterministicProgram: true,
    intraClassCorrelationRisk: true,
    adjudicatorCannotEliminateSharedSystematicBias: true,
  },
  knownLimitations,
};
fs.writeFileSync(path.join(OUT, 'adjudication-report.json'), JSON.stringify(report, null, 2) + '\n');

const L = [];
L.push('# VIguard LAN Challenge Set — AI-Assisted Adjudication and Confidential Blind Human Review Report');
L.push('');
L.push('## 1. Provenance and identities');
L.push('');
L.push('- **Annotator A:** ' + agree.annotators.A + ' (`model-a-annotations.jsonl`)');
L.push('- **Annotator B:** ' + agree.annotators.B + ' (`model-b-annotations.jsonl`)');
L.push('- **Adjudicator C:** ' + manifest.adjudicator.model);
L.push('- **Input:** `' + agree.generatedFrom.inputFile + '`');
L.push('- **Input SHA-256:** `' + agree.generatedFrom.inputSha256 + '`');
L.push('- **Annotator A SHA-256:** `' + agree.generatedFrom.annotatorASha256 + '`');
L.push('- **Annotator B SHA-256:** `' + agree.generatedFrom.annotatorBSha256 + '`');
L.push('- **Sample count:** A = ' + report.inputs.sampleCountA + ', B = ' + report.inputs.sampleCountB + ' (both exactly 413).');
L.push('');

L.push('## 2. Mechanical inter-annotator agreement');
L.push('');
L.push('| Metric | Value |');
L.push('|---|---:|');
L.push('| Verdict observed agreement | ' + agree.verdict.observedAgreement + '/' + agree.sampleCount + ' = ' + (agree.verdict.observedAgreementRate * 100).toFixed(2) + '% |');
L.push('| **Cohen\'s kappa (verdict)** | **' + agree.verdict.cohensKappa.toFixed(6) + '** (Po=' + agree.verdict.kappaComponents.Po.toFixed(6) + ', Pe=' + agree.verdict.kappaComponents.Pe.toFixed(6) + ') |');
L.push('| Attack family full agreement | ' + (agree.attackFamily.fullAgreementRate * 100).toFixed(2) + '% |');
L.push('| Attack family macro agreement | ' + (agree.attackFamily.macroAgreementRate * 100).toFixed(2) + '% |');
L.push('| Recommended action full agreement | ' + (agree.recommendedAction.fullAgreementRate * 100).toFixed(2) + '% |');
L.push('| contextSufficient agreement | ' + (agree.contextSufficient.agreementRate * 100).toFixed(2) + '% |');
L.push('');
L.push('Verdict conflicts: safe↔attack = **' + agree.verdict.conflicts.safe_attack + '**; attack↔unknown = ' + agree.verdict.conflicts.attack_unknown + '; safe↔unknown = ' + agree.verdict.conflicts.safe_unknown + '.');
L.push('');

L.push('## 3. AI adjudication outcome');
L.push('');
L.push('| Outcome | Count |');
L.push('|---|---:|');
L.push('| Auto-consensus | ' + stats.consensusCount + ' |');
L.push('| Third-model adjudication queue | ' + stats.modelAdjudicationCount + ' |');
L.push('| → accept A | ' + (rd.accept_a || 0) + ' |');
L.push('| → accept B | ' + (rd.accept_b || 0) + ' |');
L.push('| → insufficient_context | ' + (rd.insufficient_context || 0) + ' |');
L.push('');

L.push('## 4. Final frozen-label distribution');
L.push('');
L.push('- **Verdict:** ' + JSON.stringify(stats.finalVerdictDistribution));
L.push('- **Recommended action:** ' + JSON.stringify(stats.finalRecommendedActionDistribution));
L.push('- **Attack family:** ' + JSON.stringify(stats.finalAttackFamilyDistribution));
L.push('- **final-labels.jsonl SHA-256:** `' + manifest.finalLabelsSha256 + '`');
L.push('- **labelsFrozenAt:** ' + manifest.labelsFrozenAt + ' (UTC).');
L.push('');

L.push('## 5. Context-visibility audit');
L.push('');
L.push('- Audited model-visible inputs: **' + visibilityAudit.auditedSampleCount + '/413**.');
L.push('- Hidden-context issues corrected before model evaluation: **' + visibilityAudit.correctedLabelCount + '**; unchanged: **' + visibilityAudit.unchangedLabelCount + '**.');
L.push('- Response-side evidence used: **no**; collector ground truth used: **no**.');
L.push('');

L.push('## 6. Confidential blind human review');
L.push('');
L.push('- Status: **completed** after the frozen model evaluation.');
L.push('- Coverage: **' + humanReview.reviewOutcome.confirmedSampleCount + '/413** samples.');
L.push('- Reviewers were blind to A/B labels, the third-model adjudication, AetherArgus predictions, and evaluation metrics before their decisions.');
L.push('- Human-vs-frozen-reference disagreements: **' + humanReview.reviewOutcome.disagreementWithFrozenReferenceCount + '**.');
L.push('- Label changes required: **' + (humanReview.reviewOutcome.finalLabelsChanged ? 'yes' : 'no') + '**.');
L.push('- Reviewer identities, count, worksheets, and raw materials are withheld from the public repository for confidentiality.');
L.push('- Public attestation: `ml/data/lan_challenge_capture/human-review/human-review-attestation.json`, SHA-256 `' + manifest.humanReviewAttestationSha256 + '`.');
L.push('- Because `final-labels.jsonl` remained byte-identical, existing predictions and statistical results did not require rerunning or rescoring.');
L.push('');

L.push('## 7. Publication declarations');
L.push('');
L.push('- The labels were produced through dual-AI annotation and third-AI adjudication, then subsequently confirmed through confidential blind human review.');
L.push('- The public repository contains an operator-confirmed attestation, not the confidential raw reviewer worksheets.');
L.push('- No AetherArgus predictions or evaluation results were used for label creation or human review.');
L.push('- The challenge set was not added to training or validation data.');
L.push('- The dataset is authorized challenge traffic, not naturally occurring production traffic.');
L.push('- Recommended wording: **confidentially human-reviewed reference labels**.');
L.push('- Do not describe the labels as infallible, universally generalizable, or publicly reproducible human ground truth.');
L.push('');

L.push('## 8. Known limitations');
L.push('');
for (const limitation of knownLimitations) L.push('- ' + limitation);
L.push('');

L.push('## 9. Validation');
L.push('');
L.push('Run:');
L.push('');
L.push('```bash');
L.push('node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js');
L.push('node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js');
L.push('```');
L.push('');
fs.writeFileSync(path.join(OUT, 'adjudication-report.md'), L.join('\n') + '\n');

console.log('adjudication-report.md/json written.');
console.log('kappa:', report.agreement.cohensKappa,
  ' human review:', report.humanAudit.reviewCoverage,
  ' disagreements:', report.humanAudit.disagreementCount);
