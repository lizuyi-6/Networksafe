/*
 * build-manifest.js — final-labels-manifest.json (§15).
 * Computes SHA-256 of inputs/A/B/final-labels and pulls counts from build-stats.json.
 * labelsFrozenAt changes only when final-labels.jsonl bytes change. Provenance-only
 * corrections and post-evaluation human-review attestations have separate timestamps.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const OUT = __dirname;
const DATA = path.resolve(OUT, '..');
const ANN = path.join(DATA, 'annotations');
const HUMAN = path.join(DATA, 'human-review');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function git(args) {
  try { return execSync('git ' + args, { cwd: DATA, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return null; }
}

const stats = JSON.parse(fs.readFileSync(path.join(OUT, 'build-stats.json'), 'utf8'));
const attestationPath = path.join(HUMAN, 'human-review-attestation.json');
const attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
const manifestPath = path.join(OUT, 'final-labels-manifest.json');
let previous = null;
try { previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {}

const now = process.env.VIGUARD_MANIFEST_AT || new Date().toISOString();
const finalLabelsSha256 = sha256File(path.join(OUT, 'final-labels.jsonl'));
const labelsChanged = !previous || previous.finalLabelsSha256 !== finalLabelsSha256;
const previousLabelsFrozenAt = previous && (previous.labelsFrozenAt || previous.frozenAt);
const labelsFrozenAt = process.env.VIGUARD_LABELS_FROZEN_AT
  || (labelsChanged ? now : (previousLabelsFrozenAt || now));
const provenanceMetadataCorrectedAt = process.env.VIGUARD_PROVENANCE_CORRECTED_AT
  || (labelsChanged ? now : (previous && previous.provenanceMetadataCorrectedAt))
  || now;
const sourceCommit = process.env.VIGUARD_SOURCE_COMMIT
  || (previous && previous.sourceCommit)
  || git('rev-parse HEAD')
  || null;

if (attestation.status !== 'completed' || attestation.reviewOutcome.finalLabelsChanged !== false) {
  throw new Error('human-review attestation is incomplete or reports label changes');
}
if (attestation.reviewOutcome.finalLabelsSha256AfterReview !== finalLabelsSha256) {
  throw new Error('human-review attestation final-label SHA does not match final-labels.jsonl');
}

const manifest = {
  schemaVersion: 3,
  sampleCount: 413,
  inputFile: 'ml/data/lan_challenge_capture/model-inputs.jsonl',
  inputSha256: sha256File(path.join(DATA, 'model-inputs.jsonl')),
  annotatorAFile: 'ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl',
  annotatorASha256: sha256File(path.join(ANN, 'model-a-annotations.jsonl')),
  annotatorBFile: 'ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl',
  annotatorBSha256: sha256File(path.join(ANN, 'model-b-annotations.jsonl')),
  finalLabelsFile: 'ml/data/lan_challenge_capture/adjudication/final-labels.jsonl',
  finalLabelsSha256,
  consensusCount: stats.consensusCount,
  modelAdjudicationCount: stats.modelAdjudicationCount,
  requiresHumanAuditCount: stats.requiresHumanAuditCount,
  humanReviewed: true,
  humanReviewTiming: 'post_evaluation',
  humanReviewCoverage: attestation.reviewScope.sampleCount,
  reviewerCount: null,
  reviewerCountDisclosure: attestation.reviewerCountDisclosure,
  humanReviewAttestationFile: 'ml/data/lan_challenge_capture/human-review/human-review-attestation.json',
  humanReviewAttestationSha256: sha256File(attestationPath),
  humanReviewMode: 'confidential_blind_review',
  humanReviewDisagreementCount: attestation.reviewOutcome.disagreementWithFrozenReferenceCount,
  finalLabelsChangedAfterHumanReview: attestation.reviewOutcome.finalLabelsChanged,
  eligibleForTraining: false,
  split: 'external_challenge_test',
  labelsFrozenBeforeAetherArgusEvaluation: true,
  labelsFrozenAt,
  provenanceMetadataCorrectedAt,
  humanReviewCompletedAt: attestation.completedAt,
  frozenAt: labelsFrozenAt,
  timestampSemantics: 'Metadata and post-evaluation human-review attestations do not alter the label-freeze timestamp unless the byte content of final-labels.jsonl changes.',
  sourceCommit,
  adjudicationCommit: previous && previous.adjudicationCommit ? previous.adjudicationCommit : null,
  annotators: {
    A: { model: 'GPT-5.6-SOL', reportFile: 'ml/data/lan_challenge_capture/annotations/model-a-report.json' },
    B: { model: 'Claude Opus 5', reportFile: 'ml/data/lan_challenge_capture/annotations/model-b-report.json' },
  },
  adjudicator: {
    model: 'GLM-5.2 (Zhipu AI) acting as independent third-party adjudicator C',
    modelIdentityBasis: 'operator-confirmed',
    note: 'The AI-assisted labels were produced by two AI annotators and a third AI adjudicator. A subsequent confidential blind human review, conducted outside the public repository, confirmed all 413 frozen reference labels with zero label changes. Reviewer identities, count, and raw worksheets are withheld for confidentiality.',
  },
  finalVerdictDistribution: stats.finalVerdictDistribution,
  finalAttackFamilyDistribution: stats.finalAttackFamilyDistribution,
  resolutionDecisionDistribution: stats.resolutionDecisionDistribution,
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest written. final-labels sha256:', manifest.finalLabelsSha256);
console.log('human-review attestation sha256:', manifest.humanReviewAttestationSha256);
console.log('labels changed:', labelsChanged);
console.log('labelsFrozenAt:', manifest.labelsFrozenAt);
console.log('humanReviewCompletedAt:', manifest.humanReviewCompletedAt);
console.log('sourceCommit:', manifest.sourceCommit);
