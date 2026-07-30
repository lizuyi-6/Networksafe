/*
 * compare-annotations.js — VIguard LAN challenge set, dual-LLM annotation agreement analysis.
 *
 * Phase 1 (integrity / input freeze) + Phase 2 (mechanical agreement) + queue/consensus split.
 *
 * Reads ONLY the permitted request-side files:
 *   - ml/data/lan_challenge_capture/model-inputs.jsonl
 *   - ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl
 *   - ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl
 *   - the two annotator report JSON files (only to cross-check recorded inputSha256 / counts)
 *
 * It never reads collector ground truth, AetherArgus predictions, response bodies/status,
 * or any of the forbidden fields enumerated in the adjudication contract.
 *
 * Deterministic, hermetic: no network, no LLM API, no Date.now/random. Output is stable so
 * re-running yields byte-identical artifacts (the frozenAt timestamp is injected later by
 * the manifest builder, not here).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.resolve(__dirname, '..');            // .../ml/data/lan_challenge_capture
const ANN = path.join(DATA, 'annotations');
const OUT = __dirname;                                  // .../adjudication

const FILES = {
  inputs: path.join(DATA, 'model-inputs.jsonl'),
  a: path.join(ANN, 'model-a-annotations.jsonl'),
  b: path.join(ANN, 'model-b-annotations.jsonl'),
  aReport: path.join(ANN, 'model-a-report.json'),
  bReport: path.join(ANN, 'model-b-report.json'),
};

const VERDICTS = ['safe', 'attack', 'unknown'];
// Action enum = union of what both annotators actually produced (task §6.3 core set + isolate).
const ACTIONS = ['allow', 'monitor', 'block', 'challenge', 'isolate'];
// Families cited by §7.9 as high-risk (systematic-correlation-prone) categories.
const HIGH_RISK_FAMILIES = new Set([
  'authorization', 'idor_bola', 'business_logic', 'prompt_injection',
  'authentication', 'file_upload', 'ssrf', 'deserialization',
]);
const REQUIRED_ANN_FIELDS = [
  'sampleId', 'annotatorId', 'verdict', 'attackFamily', 'recommendedAction',
  'contextSufficient', 'confidence', 'evidence', 'alternativeInterpretation',
  'rationale', 'needsExpertReview', 'reviewReason',
];

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(OUT);

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}
function sha256Json(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
function readJsonl(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  const out = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    try { out.push(JSON.parse(t)); }
    catch (e) { throw new Error(`JSON parse failed in ${p} at line ${i + 1}: ${e.message}`); }
  });
  return out;
}

// ---------------------------------------------------------------------------
// PHASE 1 — integrity + input freeze
// ---------------------------------------------------------------------------
const problems = [];
function problem(msg) { problems.push(msg); }

const sha = {
  inputs: sha256File(FILES.inputs),
  a: sha256File(FILES.a),
  b: sha256File(FILES.b),
};

const inputs = readJsonl(FILES.inputs);
const annA = readJsonl(FILES.a);
const annB = readJsonl(FILES.b);

// Cross-check recorded SHA in reports.
let aReport = null, bReport = null;
try { aReport = JSON.parse(fs.readFileSync(FILES.aReport, 'utf8')); } catch (e) { problem(`model-a-report.json unreadable: ${e.message}`); }
try { bReport = JSON.parse(fs.readFileSync(FILES.bReport, 'utf8')); } catch (e) { problem(`model-b-report.json unreadable: ${e.message}`); }
if (aReport && aReport.inputSha256 && aReport.inputSha256 !== sha.inputs) problem(`A report inputSha256 ${aReport.inputSha256} != actual ${sha.inputs}`);
if (bReport && bReport.inputSha256 && bReport.inputSha256 !== sha.inputs) problem(`B report inputSha256 ${bReport.inputSha256} != actual ${sha.inputs}`);

// Counts.
if (inputs.length !== 413) problem(`model-inputs.jsonl has ${inputs.length} rows, expected 413`);
if (annA.length !== 413) problem(`model-a-annotations.jsonl has ${annA.length} rows, expected 413`);
if (annB.length !== 413) problem(`model-b-annotations.jsonl has ${annB.length} rows, expected 413`);

// sampleId helpers.
const idRe = /^viguard-lan-[0-9]{6}$/;
function idMap(arr, label) {
  const m = new Map();
  for (const r of arr) {
    const id = r && r.sampleId;
    if (typeof id !== 'string' || !idRe.test(id)) { problem(`${label}: bad/missing sampleId ${JSON.stringify(id)}`); continue; }
    if (m.has(id)) problem(`${label}: duplicate sampleId ${id}`);
    m.set(id, r);
  }
  return m;
}
const inMap = idMap(inputs, 'inputs');
const aMap = idMap(annA, 'A');
const bMap = idMap(annB, 'B');

// Set alignment.
const inIds = new Set(inMap.keys()), aIds = new Set(aMap.keys()), bIds = new Set(bMap.keys());
const setEqual = (x, y) => x.size === y.size && [...x].every(v => y.has(v));
if (!setEqual(inIds, aIds)) problem(`inputs/A sampleId sets differ (A-only=${[...aIds].filter(i=>!inIds.has(i)).length}, input-only=${[...inIds].filter(i=>!aIds.has(i)).length})`);
if (!setEqual(inIds, bIds)) problem(`inputs/B sampleId sets differ (B-only=${[...bIds].filter(i=>!inIds.has(i)).length}, input-only=${[...inIds].filter(i=>!bIds.has(i)).length})`);

// Per-record field/enum validation for A and B.
function validateAnnotator(map, label, famSetSeen) {
  for (const [id, r] of map) {
    for (const f of REQUIRED_ANN_FIELDS) {
      if (!(f in r)) { problem(`${label} ${id}: missing field ${f}`); }
    }
    if (!VERDICTS.includes(r.verdict)) problem(`${label} ${id}: illegal verdict ${JSON.stringify(r.verdict)}`);
    if (typeof r.attackFamily !== 'string') problem(`${label} ${id}: attackFamily not string (${r.attackFamily})`);
    else famSetSeen.add(r.attackFamily);
    if (!ACTIONS.includes(r.recommendedAction)) problem(`${label} ${id}: illegal recommendedAction ${JSON.stringify(r.recommendedAction)}`);
    if (typeof r.contextSufficient !== 'boolean') problem(`${label} ${id}: contextSufficient not boolean`);
    if (!Number.isInteger(r.confidence) || r.confidence < 1 || r.confidence > 5) problem(`${label} ${id}: confidence out of range (${r.confidence})`);
    if (typeof r.needsExpertReview !== 'boolean') problem(`${label} ${id}: needsExpertReview not boolean`);
    if (!Array.isArray(r.evidence)) problem(`${label} ${id}: evidence not array`);
    if (typeof r.rationale !== 'string') problem(`${label} ${id}: rationale not string`);
    if (typeof r.alternativeInterpretation !== 'string') problem(`${label} ${id}: alternativeInterpretation not string`);
    if (typeof r.reviewReason !== 'string') problem(`${label} ${id}: reviewReason not string`);
    // Consistency: unknown => contextSufficient false (review-guidelines honored by both annotators).
    if (r.verdict === 'unknown' && r.contextSufficient === true) problem(`${label} ${id}: unknown verdict but contextSufficient=true`);
  }
}
const famA = new Set(), famB = new Set();
validateAnnotator(aMap, 'A', famA);
validateAnnotator(bMap, 'B', famB);

const integrity = {
  inputRowCount: inputs.length,
  aRowCount: annA.length,
  bRowCount: annB.length,
  inputSha256: sha.inputs,
  aSha256: sha.a,
  bSha256: sha.b,
  aReportInputSha256: aReport ? aReport.inputSha256 || null : null,
  bReportInputSha256: bReport ? bReport.inputSha256 || null : null,
  setIdAlignment: setEqual(inIds, aIds) && setEqual(inIds, bIds),
  duplicateSampleIds: problems.filter(p => p.includes('duplicate')).length,
  parseErrors: problems.filter(p => p.includes('JSON parse')).length,
  schemaProblems: problems.filter(p => !p.includes('duplicate') && !p.includes('JSON parse')).length,
  problems,
};
fs.writeFileSync(path.join(OUT, 'integrity-check.json'), JSON.stringify(integrity, null, 2) + '\n');

if (problems.length > 0) {
  console.error('BLOCKED_ANNOTATION_ALIGNMENT_FAILURE');
  console.error(problems.join('\n'));
  process.exit(2);
}

// ---------------------------------------------------------------------------
// PHASE 2 — mechanical agreement
// ---------------------------------------------------------------------------
const ids = [...inIds].sort();
const N = ids.length;

// 6.1 Verdict
const verdictConfusion = {};
for (const va of VERDICTS) { verdictConfusion[va] = {}; for (const vb of VERDICTS) verdictConfusion[va][vb] = 0; }
let verdictAgree = 0;
const verdictByLabelAgree = { safe: 0, attack: 0, unknown: 0 };
const aVerdictMarg = { safe: 0, attack: 0, unknown: 0 };
const bVerdictMarg = { safe: 0, attack: 0, unknown: 0 };
const conflictCounts = { safe_attack: 0, attack_unknown: 0, safe_unknown: 0 };

for (const id of ids) {
  const a = aMap.get(id), b = bMap.get(id);
  verdictConfusion[a.verdict][b.verdict]++;
  aVerdictMarg[a.verdict]++; bVerdictMarg[b.verdict]++;
  if (a.verdict === b.verdict) { verdictAgree++; verdictByLabelAgree[a.verdict]++; }
  const pair = [a.verdict, b.verdict].sort().join('_');
  if (pair === 'attack_safe') conflictCounts.safe_attack++;
  else if (pair === 'attack_unknown') conflictCounts.attack_unknown++;
  else if (pair === 'safe_unknown') conflictCounts.safe_unknown++;
}
const Po = verdictAgree / N;
let Pe = 0;
for (const v of VERDICTS) Pe += (aVerdictMarg[v] / N) * (bVerdictMarg[v] / N);
const kappa = (1 - Pe) === 0 ? 1 : (Po - Pe) / (1 - Pe);

// 6.2 Attack family
const famAarr = [...famA].sort(), famBarr = [...famB].sort();
const famUnion = [...new Set([...famA, ...famB])].sort();
const famConfusion = {};
for (const fa of famUnion) { famConfusion[fa] = {}; for (const fb of famUnion) famConfusion[fa][fb] = 0; }
let famAgree = 0, famAgreeSubsetOfVerdictAgree = 0;
for (const id of ids) {
  const a = aMap.get(id), b = bMap.get(id);
  famConfusion[a.attackFamily][b.attackFamily]++;
  if (a.attackFamily === b.attackFamily) {
    famAgree++;
    if (a.verdict === b.verdict) famAgreeSubsetOfVerdictAgree++;
  }
}
// verdict-agree but family-disagree count
let verdictAgreeFamilyDisagree = 0;
for (const id of ids) {
  const a = aMap.get(id), b = bMap.get(id);
  if (a.verdict === b.verdict && a.attackFamily !== b.attackFamily) verdictAgreeFamilyDisagree++;
}
// macro family agreement = average per-family recall-ish (each family: agreed/union-observed)
const famMacro = [];
for (const f of famUnion) {
  const observed = ids.filter(id => aMap.get(id).attackFamily === f || bMap.get(id).attackFamily === f).length;
  const agreed = ids.filter(id => aMap.get(id).attackFamily === f && bMap.get(id).attackFamily === f).length;
  if (observed > 0) famMacro.push({ family: f, observed, agreed, rate: agreed / observed });
}
const macroFamAgreement = famMacro.reduce((s, m) => s + m.rate, 0) / famMacro.length;

// 6.3 Recommended action
const actUnion = [...new Set([...ACTIONS])].sort();
const actConfusion = {};
for (const xa of actUnion) { actConfusion[xa] = {}; for (const xb of actUnion) actConfusion[xa][xb] = 0; }
let actAgree = 0;
const actConflicts = { allow_block: 0, allow_challenge: 0, monitor_block: 0, challenge_block: 0 };
for (const id of ids) {
  const a = aMap.get(id), b = bMap.get(id);
  actConfusion[a.recommendedAction][b.recommendedAction]++;
  if (a.recommendedAction === b.recommendedAction) actAgree++;
  const pair = [a.recommendedAction, b.recommendedAction].sort().join('_');
  if (pair === 'allow_block') actConflicts.allow_block++;
  else if (pair === 'allow_challenge') actConflicts.allow_challenge++;
  else if (pair === 'block_monitor') actConflicts.monitor_block++;
  else if (pair === 'block_challenge') actConflicts.challenge_block++;
}

// 6.4 other fields
let ctxAgree = 0, expertAgree = 0;
const aConf = [], bConf = [], absDiffDist = {};
let bothHighConfLabelDisagree = 0, bothExpert = 0, onlyAExpert = 0, onlyBExpert = 0;
for (const id of ids) {
  const a = aMap.get(id), b = bMap.get(id);
  if (!!a.contextSufficient === !!b.contextSufficient) ctxAgree++;
  if (!!a.needsExpertReview === !!b.needsExpertReview) expertAgree++;
  aConf.push(a.confidence); bConf.push(b.confidence);
  const d = Math.abs(a.confidence - b.confidence);
  absDiffDist[d] = (absDiffDist[d] || 0) + 1;
  if (a.confidence >= 4 && b.confidence >= 4) {
    const coreSame = a.verdict === b.verdict && a.attackFamily === b.attackFamily && a.recommendedAction === b.recommendedAction;
    if (!coreSame) bothHighConfLabelDisagree++;
  }
  if (a.needsExpertReview && b.needsExpertReview) bothExpert++;
  else if (a.needsExpertReview) onlyAExpert++;
  else if (b.needsExpertReview) onlyBExpert++;
}
const median = (arr) => { const s = [...arr].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const confDist = (arr) => { const d = {}; for (const c of [1, 2, 3, 4, 5]) d[String(c)] = 0; for (const c of arr) d[String(c)]++; return d; };

// ---------------------------------------------------------------------------
// Queue / consensus split
// ---------------------------------------------------------------------------
function diffFields(a, b) {
  const f = [];
  if (a.verdict !== b.verdict) f.push('verdict');
  if (a.attackFamily !== b.attackFamily) f.push('attackFamily');
  if (a.recommendedAction !== b.recommendedAction) f.push('recommendedAction');
  if (!!a.contextSufficient !== !!b.contextSufficient) f.push('contextSufficient');
  if (!!a.needsExpertReview !== !!b.needsExpertReview) f.push('needsExpertReview');
  if (Math.abs(a.confidence - b.confidence) >= 2) f.push('confidenceGap');
  return f;
}
function queueReasons(a, b) {
  const r = [];
  if (a.verdict !== b.verdict) r.push('1_verdict_mismatch');
  if (a.attackFamily !== b.attackFamily) r.push('2_family_mismatch');
  if (a.recommendedAction !== b.recommendedAction) r.push('3_action_mismatch');
  if (!!a.contextSufficient !== !!b.contextSufficient) r.push('4_context_mismatch');
  if (a.needsExpertReview || b.needsExpertReview) r.push('5_expert_review_requested');
  if (a.confidence <= 2 || b.confidence <= 2) r.push('6_low_confidence');
  if (a.verdict === b.verdict && a.attackFamily !== b.attackFamily) r.push('7_verdict_agree_family_disagree');
  if (a.confidence >= 4 && b.confidence >= 4) {
    const coreSame = a.verdict === b.verdict && a.attackFamily === b.attackFamily && a.recommendedAction === b.recommendedAction;
    if (!coreSame) r.push('8_high_conf_core_disagree');
  }
  if (HIGH_RISK_FAMILIES.has(a.attackFamily) || HIGH_RISK_FAMILIES.has(b.attackFamily)) r.push('9_high_risk_family');
  if (a.verdict === 'unknown' || b.verdict === 'unknown') r.push('10_unknown_verdict');
  // 11/12 are request-structural; approximate conservatively. Full judgment at adjudication.
  return r;
}
function isConsensus(a, b) {
  if (a.verdict !== b.verdict) return false;
  if (a.attackFamily !== b.attackFamily) return false;
  if (a.recommendedAction !== b.recommendedAction) return false;
  if (!!a.contextSufficient !== !!b.contextSufficient) return false;
  if (a.confidence < 4 || b.confidence < 4) return false;
  if (a.needsExpertReview || b.needsExpertReview) return false;
  // §7.10 / §7.9 conservative escalation: unknown verdicts and high-risk families are
  // adjudicated even on full agreement, to guard against correlated LLM errors.
  if (a.verdict === 'unknown' || b.verdict === 'unknown') return false;
  if (HIGH_RISK_FAMILIES.has(a.attackFamily) || HIGH_RISK_FAMILIES.has(b.attackFamily)) return false;
  return true;
}

const consensusRows = [];
const queueRows = [];
const worksheetRows = [];

for (const id of ids) {
  const inp = inMap.get(id).input;
  const a = aMap.get(id), b = bMap.get(id);
  if (isConsensus(a, b)) {
    consensusRows.push({
      sampleId: id,
      verdict: a.verdict,
      attackFamily: a.attackFamily,
      recommendedAction: a.recommendedAction,
      contextSufficient: a.contextSufficient,
      confidence: Math.min(a.confidence, b.confidence),
      resolutionType: 'consensus',
    });
  } else {
    const reasons = queueReasons(a, b);
    queueRows.push({
      sampleId: id,
      input: {
        method: inp.method,
        path: inp.path,
        headers: inp.headers,
        body: inp.body,
        sourceContext: inp.sourceContext,
      },
      annotatorA: {
        verdict: a.verdict, attackFamily: a.attackFamily, recommendedAction: a.recommendedAction,
        contextSufficient: a.contextSufficient, confidence: a.confidence, evidence: a.evidence,
        alternativeInterpretation: a.alternativeInterpretation, rationale: a.rationale,
        needsExpertReview: a.needsExpertReview, reviewReason: a.reviewReason,
      },
      annotatorB: {
        verdict: b.verdict, attackFamily: b.attackFamily, recommendedAction: b.recommendedAction,
        contextSufficient: b.contextSufficient, confidence: b.confidence, evidence: b.evidence,
        alternativeInterpretation: b.alternativeInterpretation, rationale: b.rationale,
        needsExpertReview: b.needsExpertReview, reviewReason: b.reviewReason,
      },
      disagreementFields: diffFields(a, b),
      queueReasons: reasons,
      adjudicationRequired: true,
    });
    // Compact worksheet for the human/model adjudicator: full request-side evidence + compact A/B.
    worksheetRows.push({
      sampleId: id,
      request: {
        method: inp.method, path: inp.path, headers: inp.headers,
        body: inp.body, authenticated: inp.sourceContext && inp.sourceContext.authenticated,
      },
      A: {
        verdict: a.verdict, family: a.attackFamily, action: a.recommendedAction,
        ctx: a.contextSufficient, conf: a.confidence, expert: a.needsExpertReview,
        rationale: a.rationale, alt: a.alternativeInterpretation, reviewReason: a.reviewReason,
      },
      B: {
        verdict: b.verdict, family: b.attackFamily, action: b.recommendedAction,
        ctx: b.contextSufficient, conf: b.confidence, expert: b.needsExpertReview,
        rationale: b.rationale, alt: b.alternativeInterpretation, reviewReason: b.reviewReason,
      },
      disagree: diffFields(a, b),
      reasons: reasons,
    });
  }
}

// Write artifacts
function writeJsonl(p, rows) { fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); }
writeJsonl(path.join(OUT, 'disagreement-queue.jsonl'), queueRows);
writeJsonl(path.join(OUT, 'consensus.jsonl'), consensusRows);
writeJsonl(path.join(OUT, 'adjudication-worksheet.jsonl'), worksheetRows);

fs.writeFileSync(path.join(OUT, 'verdict-confusion-matrix.json'), JSON.stringify({
  order_rows_A: VERDICTS, order_cols_B: VERDICTS, matrix: verdictConfusion,
}, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'attack-family-confusion-matrix.json'), JSON.stringify({
  order_rows_A: famUnion, order_cols_B: famUnion, matrix: famConfusion,
}, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'action-confusion-matrix.json'), JSON.stringify({
  order_rows_A: actUnion, order_cols_B: actUnion, matrix: actConfusion,
}, null, 2) + '\n');

const report = {
  schemaVersion: 1,
  generatedFrom: {
    inputFile: 'ml/data/lan_challenge_capture/model-inputs.jsonl',
    inputSha256: sha.inputs,
    annotatorAFile: 'ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl',
    annotatorASha256: sha.a,
    annotatorBFile: 'ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl',
    annotatorBSha256: sha.b,
  },
  sampleCount: N,
  annotators: { A: 'GPT-5.6-SOL', B: 'Claude Opus 5' },
  verdict: {
    observedAgreement: verdictAgree,
    observedAgreementRate: Number(Po.toFixed(6)),
    cohensKappa: Number(kappa.toFixed(6)),
    kappaComponents: { Po: Number(Po.toFixed(6)), Pe: Number(Pe.toFixed(6)) },
    marginalA: aVerdictMarg,
    marginalB: bVerdictMarg,
    agreementByLabel: verdictByLabelAgree,
    conflicts: conflictCounts,
  },
  attackFamily: {
    fullAgreement: famAgree,
    fullAgreementRate: Number((famAgree / N).toFixed(6)),
    macroAgreementRate: Number(macroFamAgreement.toFixed(6)),
    perFamily: famMacro,
    aOnly: famAarr.filter(f => !famB.has(f)),
    bOnly: famBarr.filter(f => !famA.has(f)),
    verdictAgreeButFamilyDisagree: verdictAgreeFamilyDisagree,
  },
  recommendedAction: {
    fullAgreement: actAgree,
    fullAgreementRate: Number((actAgree / N).toFixed(6)),
    conflicts: actConflicts,
  },
  contextSufficient: { agreement: ctxAgree, agreementRate: Number((ctxAgree / N).toFixed(6)) },
  needsExpertReview: {
    agreement: expertAgree, agreementRate: Number((expertAgree / N).toFixed(6)),
    bothTrue: bothExpert, onlyA: onlyAExpert, onlyB: onlyBExpert,
  },
  confidence: {
    a: { mean: Number(mean(aConf).toFixed(4)), median: median(aConf), distribution: confDist(aConf) },
    b: { mean: Number(mean(bConf).toFixed(4)), median: median(bConf), distribution: confDist(bConf) },
    absoluteDifferenceDistribution: absDiffDist,
    bothHighConfButCoreLabelDisagree: bothHighConfLabelDisagree,
  },
  split: {
    consensus: consensusRows.length,
    adjudicationQueue: queueRows.length,
  },
};
fs.writeFileSync(path.join(OUT, 'agreement-report.json'), JSON.stringify(report, null, 2) + '\n');

// Markdown
const md = [];
md.push('# VIguard LAN Challenge Set — Dual-LLM Annotation Agreement Report');
md.push('');
md.push('Mechanically computed from `model-a-annotations.jsonl` (annotator A = **GPT-5.6-SOL**) and');
md.push('`model-b-annotations.jsonl` (annotator B = **Claude Opus 5**), aligned on `sampleId` against');
md.push('`model-inputs.jsonl`. No LLM API, no collector labels, no response fields used.');
md.push('');
md.push('## Inputs (frozen)');
md.push(`- sampleCount: **${N}**`);
md.push(`- model-inputs.jsonl sha256: \`${sha.inputs}\``);
md.push(`- model-a-annotations.jsonl sha256: \`${sha.a}\``);
md.push(`- model-b-annotations.jsonl sha256: \`${sha.b}\``);
md.push('');
md.push('## 6.1 Verdict');
md.push(`- observed agreement: **${verdictAgree}/${N} = ${(Po * 100).toFixed(2)}%**`);
md.push(`- Cohen's kappa: **${kappa.toFixed(4)}**  (Po=${Po.toFixed(4)}, Pe=${Pe.toFixed(4)})`);
md.push(`- marginal A: ${JSON.stringify(aVerdictMarg)}`);
md.push(`- marginal B: ${JSON.stringify(bVerdictMarg)}`);
md.push(`- agreement by label: ${JSON.stringify(verdictByLabelAgree)}`);
md.push(`- safe↔attack severe conflicts: **${conflictCounts.safe_attack}**`);
md.push(`- attack↔unknown: ${conflictCounts.attack_unknown}`);
md.push(`- safe↔unknown: ${conflictCounts.safe_unknown}`);
md.push('');
md.push('### Verdict confusion (rows = A, cols = B)');
md.push('');
md.push(`| A \\ B | ${VERDICTS.join(' | ')} |`);
md.push(`|---|${VERDICTS.map(() => '---:').join('|')}|`);
for (const va of VERDICTS) md.push(`| ${va} | ${VERDICTS.map(vb => verdictConfusion[va][vb]).join(' | ')} |`);
md.push('');
md.push('## 6.2 Attack family');
md.push(`- full agreement: **${famAgree}/${N} = ${(famAgree / N * 100).toFixed(2)}%**`);
md.push(`- macro agreement rate: ${(macroFamAgreement * 100).toFixed(2)}%`);
md.push(`- verdict-agree but family-disagree: ${verdictAgreeFamilyDisagree}`);
md.push(`- families used by A only: ${famAarr.filter(f => !famB.has(f)).join(', ') || '(none)'}`);
md.push(`- families used by B only: ${famBarr.filter(f => !famA.has(f)).join(', ') || '(none)'}`);
md.push('');
md.push('## 6.3 Recommended action');
md.push(`- full agreement: **${actAgree}/${N} = ${(actAgree / N * 100).toFixed(2)}%**`);
md.push(`- allow↔block: ${actConflicts.allow_block}; allow↔challenge: ${actConflicts.allow_challenge}; monitor↔block: ${actConflicts.monitor_block}; challenge↔block: ${actConflicts.challenge_block}`);
md.push('');
md.push('## 6.4 Other fields');
md.push(`- contextSufficient agreement: ${ctxAgree}/${N} = ${(ctxAgree / N * 100).toFixed(2)}%`);
md.push(`- needsExpertReview agreement: ${expertAgree}/${N} = ${(expertAgree / N * 100).toFixed(2)}% (both=${bothExpert}, onlyA=${onlyAExpert}, onlyB=${onlyBExpert})`);
md.push(`- confidence A: mean=${mean(aConf).toFixed(2)} median=${median(aConf)}; B: mean=${mean(bConf).toFixed(2)} median=${median(bConf)}`);
md.push(`- both high-conf (≥4) but core label disagree: ${bothHighConfLabelDisagree}`);
md.push(`- |Δconfidence| distribution: ${JSON.stringify(absDiffDist)}`);
md.push('');
md.push('## Queue / consensus split');
md.push(`- auto-consensus: **${consensusRows.length}**`);
md.push(`- adjudication queue: **${queueRows.length}**`);
md.push('');
md.push('_Consensus is applied conservatively: per §7.9/§7.10, samples carrying a high-risk family');
md.push('(authorization/idor_bola/business_logic/prompt_injection/authentication/file_upload/ssrf/deserialization)');
md.push('or any unknown verdict are adjudicated even when the two annotators fully agreed, to guard against');
md.push('correlated LLM errors in the highest-bias categories._');
fs.writeFileSync(path.join(OUT, 'agreement-report.md'), md.join('\n') + '\n');

// Console summary
console.log('=== integrity: OK (no problems) ===');
console.log(`verdict agree ${verdictAgree}/${N} = ${(Po * 100).toFixed(2)}%  kappa=${kappa.toFixed(4)}`);
console.log(`family agree ${famAgree}/${N} = ${(famAgree / N * 100).toFixed(2)}%  macro=${(macroFamAgreement * 100).toFixed(2)}%`);
console.log(`action agree ${actAgree}/${N} = ${(actAgree / N * 100).toFixed(2)}%`);
console.log(`safe<->attack conflicts: ${conflictCounts.safe_attack}`);
console.log(`CONSENSUS=${consensusRows.length}  QUEUE=${queueRows.length}`);
console.log('artifacts written to ml/data/lan_challenge_capture/adjudication/');
