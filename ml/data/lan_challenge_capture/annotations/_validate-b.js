#!/usr/bin/env node
/**
 * Independent schema + self-check validator for model-b-annotations.jsonl.
 * Falsifiable assertions only: each check either finds a concrete violating
 * sampleId or reports 0. Exits non-zero on any violation.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'model-inputs.jsonl');
const OUT = path.join(__dirname, 'model-b-annotations.jsonl');

const VERDICTS = new Set(['safe', 'attack', 'unknown']);
const FAMILIES = new Set([
  'none', 'sqli', 'xss', 'command_injection', 'path_traversal', 'ssrf',
  'authentication', 'authorization', 'idor_bola', 'csrf', 'cors', 'file_upload',
  'deserialization', 'api_abuse', 'business_logic', 'prompt_injection',
  'protocol_attack', 'information_disclosure', 'other', 'unknown',
]);
const ACTIONS = new Set(['allow', 'monitor', 'challenge', 'block', 'isolate']);
const FIELDS = [
  'sampleId', 'annotatorId', 'verdict', 'attackFamily', 'recommendedAction',
  'contextSufficient', 'confidence', 'evidence', 'alternativeInterpretation',
  'rationale', 'needsExpertReview', 'reviewReason',
];

const inputs = fs.readFileSync(INPUT, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const rawOut = fs.readFileSync(OUT, 'utf8').split(/\r?\n/).filter(Boolean);

const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);

// 15.9 每行可独立解析
const anns = [];
rawOut.forEach((line, i) => {
  try { anns.push(JSON.parse(line)); }
  catch (e) { errors.push(`line ${i + 1}: JSON.parse failed - ${e.message}`); }
});

// 15.1 数量一致
if (anns.length !== inputs.length) errors.push(`count mismatch: input=${inputs.length} output=${anns.length}`);

// 15.2/15.3 sampleId 集合完全相同、无重复
const inIds = new Set(inputs.map((r) => r.sampleId));
const seen = new Set();
let dupes = 0, missingId = 0;
for (const a of anns) {
  if (!a.sampleId) { missingId++; continue; }
  if (seen.has(a.sampleId)) { dupes++; err(a.sampleId, 'duplicate sampleId'); }
  seen.add(a.sampleId);
  if (!inIds.has(a.sampleId)) err(a.sampleId, 'sampleId not present in model-inputs.jsonl');
}
for (const id of inIds) if (!seen.has(id)) err(id, 'sampleId missing from annotations');

// 15.4 Schema
for (const a of anns) {
  const id = a.sampleId || '<no-id>';
  const keys = Object.keys(a);
  for (const f of FIELDS) if (!keys.includes(f)) err(id, `missing field ${f}`);
  for (const k of keys) if (!FIELDS.includes(k)) err(id, `unexpected field ${k}`);
  if (a.annotatorId !== 'annotator-b') err(id, `annotatorId=${a.annotatorId}`);
  if (!VERDICTS.has(a.verdict)) err(id, `bad verdict ${a.verdict}`);
  if (!FAMILIES.has(a.attackFamily)) err(id, `bad attackFamily ${a.attackFamily}`);
  if (!ACTIONS.has(a.recommendedAction)) err(id, `bad recommendedAction ${a.recommendedAction}`);
  if (typeof a.contextSufficient !== 'boolean') err(id, 'contextSufficient not boolean');
  if (!Number.isInteger(a.confidence) || a.confidence < 1 || a.confidence > 5) err(id, `bad confidence ${a.confidence}`);
  if (!Array.isArray(a.evidence) || a.evidence.length < 1 || a.evidence.length > 4) err(id, `evidence length ${Array.isArray(a.evidence) ? a.evidence.length : 'n/a'} outside 1-4`);
  else a.evidence.forEach((e, i) => { if (typeof e !== 'string' || !e.trim()) err(id, `evidence[${i}] empty`); });
  if (typeof a.alternativeInterpretation !== 'string') err(id, 'alternativeInterpretation not string');
  if (typeof a.rationale !== 'string' || !a.rationale.trim()) err(id, 'rationale empty');
  const han = (a.rationale.match(/[一-鿿]/g) || []).length;
  if (han > 100) err(id, `rationale ${han} han chars > 100`);
  if (typeof a.needsExpertReview !== 'boolean') err(id, 'needsExpertReview not boolean');
  if (typeof a.reviewReason !== 'string') err(id, 'reviewReason not string');
  if (a.needsExpertReview && !a.reviewReason.trim()) err(id, 'needsExpertReview=true but reviewReason empty');
  if (!a.needsExpertReview && a.reviewReason.trim()) err(id, 'needsExpertReview=false but reviewReason set');
}

// 六/七/十三节语义一致性
for (const a of anns) {
  const id = a.sampleId;
  if (a.verdict === 'unknown') {
    if (a.contextSufficient !== false) err(id, 'verdict=unknown requires contextSufficient=false');
    if (!a.needsExpertReview) err(id, 'verdict=unknown requires needsExpertReview=true');
    if (a.recommendedAction === 'allow') err(id, 'verdict=unknown must not recommend allow');
    if (a.confidence > 2) err(id, `verdict=unknown with confidence=${a.confidence} (>2 contradicts "cannot judge reliably")`);
  }
  if (a.verdict === 'safe' && a.attackFamily !== 'none') err(id, `verdict=safe with attackFamily=${a.attackFamily}`);
  if (a.verdict === 'attack') {
    if (a.attackFamily === 'none') err(id, 'verdict=attack with attackFamily=none');
    if (!['block', 'isolate', 'challenge', 'monitor'].includes(a.recommendedAction)) err(id, `verdict=attack with action=${a.recommendedAction}`);
  }
  if (a.confidence <= 2 && !a.needsExpertReview) err(id, 'confidence<=2 requires needsExpertReview=true');
}

// 十二节: evidence 不得引用响应结果 / ground truth
const FORBIDDEN_EVIDENCE = /\b(responseStatus|responseBody|responseHeaders|groundTruth|expectedVerdict|collectorLabel|exploitConfirmed|canaryObserved|executionEvidence|requestIntent|exploitOutcome|isHardNegative|HTTP\s*(200|401|403|404|500))\b/i;
for (const a of anns) {
  const blob = [...a.evidence, a.rationale, a.alternativeInterpretation].join(' || ');
  const m = blob.match(FORBIDDEN_EVIDENCE);
  if (m) err(a.sampleId, `evidence/rationale references a forbidden post-response artefact: "${m[0]}"`);
}

// 证据必须与该样本的实际请求对应: method 与 path 断言
const inputById = new Map(inputs.map((r) => [r.sampleId, r.input]));
let pathCited = 0;
for (const a of anns) {
  const inp = inputById.get(a.sampleId);
  if (!inp) continue;
  const blob = a.evidence.join(' || ');
  const bare = inp.path.split('?')[0];
  if (blob.includes(bare) || blob.includes(inp.path)) pathCited++;
}

// 十二节 "不得补充请求中不存在的事实":
// 证据里被双引号括起的、长度>=8 的字面片段，必须真实出现在该样本的
// path / body / header 值中（原文或 URL 解码后），否则视为捏造。
let quotedChecked = 0;
for (const a of anns) {
  const inp = inputById.get(a.sampleId);
  if (!inp) continue;
  let hay = [inp.method, inp.path, inp.body || '', ...Object.values(inp.headers || {})].join(' ~|~ ');
  try { hay += ' ~|~ ' + decodeURIComponent(inp.path); } catch { /* invalid encoding sample */ }
  for (const h of Object.values(inp.headers || {})) {
    try { hay += ' ~|~ ' + decodeURIComponent(h); } catch { /* ignore */ }
  }
  for (const ev of a.evidence) {
    for (const m of ev.matchAll(/"([^"]{8,})"/g)) {
      const frag = m[1];
      // Skip descriptive phrases that are prose, not claimed request content:
      // heuristic — a claimed literal must contain no ' — ' and be short enough.
      if (frag.includes(' — ') || frag.length > 200) continue;
      quotedChecked++;
      if (!hay.includes(frag)) err(a.sampleId, `evidence quotes "${frag.slice(0, 60)}" which does not appear in this sample's request`);
    }
  }
}

// 报告统计
const dist = (fn) => anns.reduce((m, a) => { const k = fn(a); m[k] = (m[k] || 0) + 1; return m; }, {});
const summary = {
  sampleCount: anns.length,
  verdictDistribution: dist((a) => a.verdict),
  attackFamilyDistribution: dist((a) => a.attackFamily),
  confidenceDistribution: dist((a) => String(a.confidence)),
  actionDistribution: dist((a) => a.recommendedAction),
  expertReviewCount: anns.filter((a) => a.needsExpertReview).length,
  duplicateSampleIdCount: dupes,
  missingSampleIdCount: missingId,
  evidenceCitesOwnPath: pathCited,
  quotedFragmentsVerified: quotedChecked,
  schemaErrorCount: errors.length,
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) {
  console.error(`\n${errors.length} VIOLATION(S):`);
  errors.slice(0, 60).forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log('\nALL CHECKS PASSED (0 violations)');
fs.writeFileSync(path.join(__dirname, '_validate-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
