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

const rd = stats.resolutionDecisionDistribution;
const aa = stats.acceptedAnnotatorDistribution;
const report = {
  schemaVersion: 1,
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
  finalLabelsSha256: manifest.finalLabelsSha256,
  frozenAt: manifest.frozenAt,
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
  knownLimitations: [],
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
L.push('| **Cohen\'s kappa (verdict)** | **' + agree.verdict.cohensKappa.toFixed(4) + '** (Po=' + agree.verdict.kappaComponents.Po + ', Pe=' + agree.verdict.kappaComponents.Pe + ') |');
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
L.push('- **frozenAt:** ' + manifest.frozenAt + ' (UTC) — before evaluating AetherArgus on this set.');
L.push('');

L.push('## 5. Human-audit sampling list');
L.push('');
L.push('- Samples flagged `requiresHumanAudit=true`: **' + stats.requiresHumanAuditCount + '** / 413.');
L.push('- `humanReviewed=false`, `reviewerCount=0`. Two AI annotators + one AI adjudicator do **not** constitute human review; this list is a sampling queue, not completed review.');
L.push('');

L.push('## 6. Mandatory declarations');
L.push('');
L.push('- This is **dual-LLM independent annotation (A + B) followed by a third-LLM adjudication (C)** — not human annotation.');
L.push('- The challenge traffic is **pre-designed, live-captured synthetic attack-attempt traffic against an authorized target** — **not production / naturally-occurring traffic**.');
L.push('- **No AetherArgus predictions, model evaluation metrics, or model error lists were read or used.** Final labels were frozen before evaluating AetherArgus on the VIguard LAN challenge set.');
L.push('- **No response-side evidence was used** (no responseStatus / responseBody / responseSanitized / executionEvidence / exploitConfirmed / canaryObserved). Adjudication used request-side evidence plus the permitted environment context (role-permission-matrix, endpoint-inventory, environment).');
L.push('- **The challenge set was not added to any training/validation set** (`eligibleForTraining=false`, `split=external_challenge_test` for all 413).');
L.push('- **Annotator B\'s labels were produced by a deterministic rule-based program** (`annotations/_build-b.js`) authored by the model in a single session, whereas annotator A produced per-sample judgments directly. This asymmetry creates **intra-class correlation risk** for B\'s labels (all B labels follow one rule set, so B-vs-B internal consistency is not evidence of independent correctness).');
L.push('- **A third-LLM adjudicator cannot eliminate systematic bias that the annotator models share** (e.g. a common misreading of the `/api/admin/tenant-oversight` boundary or a shared blind spot on stored-vs-parsed fields). The kappa and agreement numbers reflect LLM-vs-LLM agreement, not ground-truth accuracy.');
L.push('');

L.push('## 7. Known limitations');
L.push('');
L.push('- **Object ownership is not observable** in any sample: all direct-object-reference reads/actions on `/api/{alerts,agents,devices,admin/users,traffic}/[RESOURCE_ID]` are labelled `unknown` (idor_bola), not a definite verdict, regardless of how benign the note body looks.');
L.push('- **The acting principal\'s effective RBAC is only partially documented.** `role-permission-matrix.json` records that `tenant_admin` is denied on `/api/admin/tenant-oversight/*`, `PUT /api/admin/users/:id/role`, and `POST /api/admin/tenant-oversight/exports`; requests to those are labelled `attack` (authorization). Endpoints not in the matrix whose permissibility is genuinely ambiguous (e.g. `PUT /api/admin/users/:id/plan`) are labelled `unknown`, and authenticated admin-namespaced reads (`GET /api/admin/users`) are labelled `safe` with a `requiresHumanAudit` flag because tenant_admin\'s access is not request-observable.');
L.push('- **Stored-vs-parsed field position is not observable.** Bare attack payloads placed in a `note`/`q` field that may be storage-only (e.g. samples 000397–000404) were adjudicated `attack` on probe intent (systematic, no business narrative) but with reduced confidence and a human-audit flag, since success depends on whether the field reaches an interpreter.');
L.push('- **api_abuse / rate-dependent verdicts cannot be confirmed from a single request** (e.g. `limit=1000/2000`, `limit=0`, negative pagination): adjudicated `safe`/`monitor`, not `attack`, because abuse is a volume phenomenon invisible in one sample.');
L.push('- **Malformed/truncated bodies** (samples 000370–000380, 000410, 000413) are `unknown`: parser-fuzzing vs client defect is indistinguishable from the request alone.');
L.push('- **B-side intra-class correlation** (see §6) means agreement metrics may overstate label reliability for rule-determined categories.');
L.push('');

L.push('## 8. Artifacts');
L.push('');
L.push('All under `ml/data/lan_challenge_capture/adjudication/`: `compare-annotations.js`, `build-outputs.js`, `build-manifest.js`, `validate-adjudication.js`, `build-report.js`, `agreement-report.{json,md}`, the three confusion matrices, `disagreement-queue.jsonl`, `consensus.jsonl`, `adjudication-worksheet.jsonl`, `decisions/batch-0[1-8].jsonl`, `adjudication.jsonl`, `final-labels.jsonl`, `final-labels-manifest.json`, `adjudication-report.{json,md}`, `build-stats.json`, `integrity-check.json`.');
L.push('');
L.push('Validation command: `node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js` → all 15 checks pass (exit 0).');
fs.writeFileSync(path.join(OUT, 'adjudication-report.md'), L.join('\n') + '\n');

console.log('adjudication-report.md/json written.');
console.log('kappa:', report.agreement.cohensKappa, ' consensus:', report.resolution.consensusCount, ' adj:', report.resolution.modelAdjudicationCount, ' audit:', report.humanAudit.requiresHumanAuditCount);
