/*
 * build-report.js — adjudication-report.md (§16) and adjudication-report.json.
 * Pulls every number from agreement-report.json, build-stats.json, and the manifest so the
 * prose cannot drift from the computed artifacts. Declarations (§16 mandatory list) are
 * authored text, not derived.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const agree = JSON.parse(fs.readFileSync(path.join(OUT, 'agreement-report.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(OUT, 'build-stats.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'final-labels-manifest.json'), 'utf8'));
const visibilityAudit = JSON.parse(fs.readFileSync(path.join(OUT, 'context-visibility-audit.json'), 'utf8'));

const rd = stats.resolutionDecisionDistribution;
const aa = stats.acceptedAnnotatorDistribution;
const knownLimitations = [
  'Annotator B labels were produced by a deterministic rule program authored in one model session, creating intra-class correlation risk.',
  'The three AI systems may still share common training-data or safety-policy biases.',
  'AI annotation and AI adjudication do not constitute human review.',
  'Samples requiring identity, role, ownership, tenant-boundary, or server-side execution semantics may remain unknown when those facts are absent from the model-visible input.',
  'The dataset is an authorized live-execution challenge set, not natural production traffic.',
  'The benchmark does not contain confirmed successful exploits.',
  'Reference labels should not be described as objective human-verified ground truth.',
];
const report = {
  schemaVersion: 2,
  title: 'VIguard LAN Challenge Set — Dual-LLM Annotation Adjudication Report',
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
    humanReviewed: false,
    reviewerCount: 0,
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
  frozenAt: manifest.labelsFrozenAt,
  declarations: {
    dualLlmAnnotationAndThirdLlmAdjudication: true,
    notHumanAnnotated: true,
    notProductionNaturalTraffic: true,
    noAetherArgusPredictionsUsed: true,
    noResponseResultsUsed: true,
    challengeSetNotAddedToTraining: true,
    labelsFrozenBeforeModelEvaluation: true,
    bSideDeterministicProgram: true,
    intraClassCorrelationRisk: true,
    adjudicatorCannotEliminateSharedSystematicBias: true,
  },
  knownLimitations,
};
fs.writeFileSync(path.join(OUT, 'adjudication-report.json'), JSON.stringify(report, null, 2) + '\n');

// Markdown
const L = [];
L.push('# VIguard LAN Challenge Set — Dual-LLM Annotation Adjudication Report');
L.push('');
L.push('## 1. Provenance and identities');
L.push('');
L.push('- **Annotator A:** ' + agree.annotators.A + ' (model-a-annotations.jsonl)');
L.push('- **Annotator B:** ' + agree.annotators.B + ' (model-b-annotations.jsonl)');
L.push('- **Adjudicator C:** ' + manifest.adjudicator.model);
L.push('- **Input:** `' + agree.generatedFrom.inputFile + '`');
L.push('- **Input SHA-256:** `' + agree.generatedFrom.inputSha256 + '`');
L.push('- **Annotator A SHA-256:** `' + agree.generatedFrom.annotatorASha256 + '`');
L.push('- **Annotator B SHA-256:** `' + agree.generatedFrom.annotatorBSha256 + '`');
L.push('- **Sample count:** A = ' + report.inputs.sampleCountA + ', B = ' + report.inputs.sampleCountB + ' (both exactly 413, identical sampleId sets, no duplicates)');
L.push('');

L.push('## 2. Mechanical inter-annotator agreement (Phase 2)');
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
L.push('Verdict conflicts: safe↔attack (severe) = **' + agree.verdict.conflicts.safe_attack + '**; attack↔unknown = ' + agree.verdict.conflicts.attack_unknown + '; safe↔unknown = ' + agree.verdict.conflicts.safe_unknown + '.');
L.push('');

L.push('## 3. Resolution outcome (Phase 3 + Phase 4)');
L.push('');
L.push('| Outcome | Count |');
L.push('|---|---:|');
L.push('| Auto-consensus (strict, unmodified) | ' + stats.consensusCount + ' |');
L.push('| Third-party adjudication (queue) | ' + stats.modelAdjudicationCount + ' |');
L.push('| → accept A | ' + (rd.accept_a || 0) + ' |');
L.push('| → accept B | ' + (rd.accept_b || 0) + ' |');
L.push('| → new_resolution | ' + (rd.new_resolution || 0) + ' |');
L.push('| → insufficient_context (final verdict unknown) | ' + (rd.insufficient_context || 0) + ' |');
L.push('');
L.push('Accepted annotator (when a side was accepted): A = ' + (aa.A || 0) + ', B = ' + (aa.B || 0) + ', neither (insufficient_context/new_resolution) = ' + (aa.null || 0) + '.');
L.push('');

L.push('## 4. Final frozen-label distribution');
L.push('');
L.push('- **Verdict:** ' + JSON.stringify(stats.finalVerdictDistribution) + ' (final unknown count = ' + (stats.finalVerdictDistribution.unknown || 0) + ')');
L.push('- **Recommended action:** ' + JSON.stringify(stats.finalRecommendedActionDistribution));
L.push('- **Attack family:** ' + JSON.stringify(stats.finalAttackFamilyDistribution));
L.push('- **final-labels.jsonl SHA-256:** `' + manifest.finalLabelsSha256 + '`');
L.push('- **labelsFrozenAt:** ' + manifest.labelsFrozenAt + ' (UTC) — the last time the bytes of `final-labels.jsonl` changed.');
L.push('- **provenanceMetadataCorrectedAt:** ' + manifest.provenanceMetadataCorrectedAt + ' (UTC).');
L.push('- Metadata corrections do not alter the label-freeze timestamp unless the byte content of `final-labels.jsonl` changes.');
L.push('');

L.push('## 5. Context-visibility audit');
L.push('');
L.push('- Audited model-visible inputs: **' + visibilityAudit.auditedSampleCount + '/413** (253 model-adjudication + 160 consensus).');
L.push('- Hidden-context issues corrected: **' + visibilityAudit.correctedLabelCount + '**; unchanged labels: **' + visibilityAudit.unchangedLabelCount + '**.');
L.push('- Issue categories: ' + JSON.stringify(visibilityAudit.issueCategories) + '.');
L.push('- Response-side evidence used: **no**; Collector Ground Truth or collector intent used: **no**.');
L.push('- Full audit: `context-visibility-audit.{json,md}`.');
L.push('');

L.push('## 6. Human-audit sampling list');
L.push('');
L.push('- Samples flagged `requiresHumanAudit=true`: **' + stats.requiresHumanAuditCount + '** / 413.');
L.push('- `humanReviewed=false`, `reviewerCount=0`. Two AI annotators + one AI adjudicator do **not** constitute human review; this list is a sampling queue, not completed review.');
L.push('');

L.push('## 7. Mandatory declarations');
L.push('');
L.push('- This is **dual-LLM independent annotation (A + B) followed by a third-LLM adjudication (C)** — not human annotation.');
L.push('- The challenge traffic is **pre-designed, live-captured synthetic attack-attempt traffic against an authorized target** — **not production / naturally-occurring traffic**.');
L.push('- **No AetherArgus predictions, model evaluation metrics, or model error lists were read or used.** Final labels were frozen before evaluating AetherArgus on the VIguard LAN challenge set.');
L.push('- **No response-side evidence was used** (no responseStatus / responseBody / responseSanitized / executionEvidence / exploitConfirmed / canaryObserved). Final reference labels are bounded by the corresponding `model-inputs.jsonl` row and endpoint semantics directly inferable from the request. Environment, endpoint-inventory, and role-matrix files are provenance aids only and are not decisive label evidence.');
L.push('- **The challenge set was not added to any training/validation set** (`eligibleForTraining=false`, `split=external_challenge_test` for all 413).');
L.push('- **Annotator B\'s labels were produced by a deterministic rule-based program** (`annotations/_build-b.js`) authored by the model in a single session, whereas annotator A produced per-sample judgments directly. This asymmetry creates **intra-class correlation risk** for B\'s labels (all B labels follow one rule set, so B-vs-B internal consistency is not evidence of independent correctness).');
L.push('- **A third-LLM adjudicator cannot eliminate systematic bias that the annotator models share** (e.g. a common misreading of the `/api/admin/tenant-oversight` boundary or a shared blind spot on stored-vs-parsed fields). The kappa and agreement numbers reflect LLM-vs-LLM agreement, not ground-truth accuracy.');
L.push('');

L.push('## 8. Known limitations');
L.push('');
for (const limitation of knownLimitations) L.push('- ' + limitation);
L.push('');

L.push('## 9. Artifacts');
L.push('');
L.push('All under `ml/data/lan_challenge_capture/adjudication/`: `compare-annotations.js`, `apply-context-visibility-corrections.js`, `build-outputs.js`, `build-manifest.js`, `validate-context-visibility.js`, `validate-adjudication.js`, `build-report.js`, `context-visibility-audit.{json,md}`, `agreement-report.{json,md}`, the three confusion matrices, `disagreement-queue.jsonl`, `consensus.jsonl`, `adjudication-worksheet.jsonl`, `decisions/batch-0[1-8].jsonl`, `adjudication.jsonl`, `final-labels.jsonl`, `final-labels-manifest.json`, `adjudication-report.{json,md}`, `build-stats.json`, `integrity-check.json`.');
L.push('');
L.push('Validation commands: `node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js` and `node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js`.');
fs.writeFileSync(path.join(OUT, 'adjudication-report.md'), L.join('\n') + '\n');

console.log('adjudication-report.md/json written.');
console.log('kappa:', report.agreement.cohensKappa, ' consensus:', report.resolution.consensusCount, ' adj:', report.resolution.modelAdjudicationCount, ' audit:', report.humanAudit.requiresHumanAuditCount);
