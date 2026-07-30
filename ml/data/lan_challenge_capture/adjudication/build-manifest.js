/*
 * build-manifest.js — final-labels-manifest.json (§15).
 * Computes SHA-256 of inputs/A/B/final-labels, pulls counts from build-stats.json, stamps
 * frozenAt from the real clock (this is a plain Node script, not a workflow sandbox), and
 * records the source commit. adjudicationCommit stays null until the branch is committed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const OUT = __dirname;
const DATA = path.resolve(OUT, '..');
const ANN = path.join(DATA, 'annotations');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function git(args) {
  try { return execSync('git ' + args, { cwd: DATA, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return null; }
}

const stats = JSON.parse(fs.readFileSync(path.join(OUT, 'build-stats.json'), 'utf8'));

const manifest = {
  schemaVersion: 1,
  sampleCount: 413,
  inputFile: 'ml/data/lan_challenge_capture/model-inputs.jsonl',
  inputSha256: sha256File(path.join(DATA, 'model-inputs.jsonl')),
  annotatorAFile: 'ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl',
  annotatorASha256: sha256File(path.join(ANN, 'model-a-annotations.jsonl')),
  annotatorBFile: 'ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl',
  annotatorBSha256: sha256File(path.join(ANN, 'model-b-annotations.jsonl')),
  finalLabelsFile: 'ml/data/lan_challenge_capture/adjudication/final-labels.jsonl',
  finalLabelsSha256: sha256File(path.join(OUT, 'final-labels.jsonl')),
  consensusCount: stats.consensusCount,
  modelAdjudicationCount: stats.modelAdjudicationCount,
  requiresHumanAuditCount: stats.requiresHumanAuditCount,
  humanReviewed: false,
  reviewerCount: 0,
  eligibleForTraining: false,
  split: 'external_challenge_test',
  labelsFrozenBeforeAetherArgusEvaluation: true,
  frozenAt: new Date().toISOString(),
  sourceCommit: git('rev-parse HEAD'),
  adjudicationCommit: null,
  annotators: {
    A: { model: 'GPT-5.6-SOL', reportFile: 'ml/data/lan_challenge_capture/annotations/model-a-report.json' },
    B: { model: 'Claude Opus 5', reportFile: 'ml/data/lan_challenge_capture/annotations/model-b-report.json' },
  },
  adjudicator: {
    model: 'GLM-5.2 (Zhipu AI) acting as independent third-party adjudicator C',
    modelIdentityBasis: 'operator-confirmed',
    note: 'Adjudicator identity is operator-confirmed: the operator states GLM-5.2 (Zhipu AI) actually served the adjudication session. The harness session label displayed a different (Claude-class) name; the running model cannot self-introspect its exact build/checkpoint from inside the session (the same limitation annotator B documented in model-b-report.json), so the precise version follows operator confirmation rather than self-identification. Two AI annotators + one AI adjudicator do NOT constitute human review (humanReviewed=false, reviewerCount=0).',
  },
  finalVerdictDistribution: stats.finalVerdictDistribution,
  finalAttackFamilyDistribution: stats.finalAttackFamilyDistribution,
  resolutionDecisionDistribution: stats.resolutionDecisionDistribution,
};

fs.writeFileSync(path.join(OUT, 'final-labels-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest written. final-labels sha256:', manifest.finalLabelsSha256);
console.log('frozenAt:', manifest.frozenAt);
console.log('sourceCommit:', manifest.sourceCommit);
