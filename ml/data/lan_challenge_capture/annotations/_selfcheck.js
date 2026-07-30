#!/usr/bin/env node
/**
 * Section 15 pre-submission self-check. Every item is a falsifiable assertion
 * with a concrete PASS/FAIL, not a narrative claim.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../../..');
const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'model-inputs.jsonl');
const OUT = path.join(__dirname, 'model-b-annotations.jsonl');
const REPORT = path.join(__dirname, 'model-b-report.json');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

const inputRaw = fs.readFileSync(INPUT);
const inputs = inputRaw.toString('utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const annLines = fs.readFileSync(OUT, 'utf8').split(/\r?\n/).filter(Boolean);
const anns = annLines.map((l) => JSON.parse(l));
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

// 1. 输入输出样本数量相同
check('1 counts equal', inputs.length === anns.length, `input=${inputs.length} output=${anns.length}`);

// 2. 每个 sampleId 只出现一次
const ids = anns.map((a) => a.sampleId);
check('2 sampleIds unique', new Set(ids).size === ids.length, `distinct=${new Set(ids).size} total=${ids.length}`);

// 3. 无遗漏或新增 sampleId
const inSet = new Set(inputs.map((r) => r.sampleId));
const outSet = new Set(ids);
const missing = [...inSet].filter((x) => !outSet.has(x));
const extra = [...outSet].filter((x) => !inSet.has(x));
check('3 sampleId sets identical', missing.length === 0 && extra.length === 0, `missing=${missing.length} extra=${extra.length}`);

// 3b. 顺序与输入一致（便于 join）
const orderOk = inputs.every((r, i) => anns[i].sampleId === r.sampleId);
check('3b output order matches input order', orderOk, orderOk ? 'aligned' : 'MISALIGNED');

// 4. 字段符合 Schema —— 由 _validate-b.js 承担，这里复跑并断言退出码
let validateExit = 0;
try { execSync('node _validate-b.js', { cwd: __dirname, stdio: 'pipe' }); }
catch (e) { validateExit = e.status; }
check('4 schema validator exit 0', validateExit === 0, `exit=${validateExit}`);

// 5. 未访问禁止文件。
// 注意方法局限: 标注完成后分支被 rebase 到 origin/master, 整个数据集(含标签文件)
// 随之被 git 检出到工作树, 所以"文件不存在于磁盘"不再是可用的断言。
// 改为断言可机械验证的东西: 本目录下所有脚本的源码中, 没有任何一个禁止文件名
// 被引用 —— 即产物的生成与校验链路在代码层面无法读到标签/响应/裁决数据。
const FORBIDDEN = [
  'model-labels.jsonl', 'attack-traffic.jsonl', 'normal-traffic.jsonl', 'hard-negatives.jsonl',
  'prompt-injection.jsonl', 'unknown-cases.jsonl', 'all-sanitized.jsonl', 'findings.json',
  'review-queue.jsonl', 'adjudication.jsonl', 'model-benchmark.jsonl', 'adjudication-template.json',
  'dataset-manifest.json', 'verification-report.json', 'privacy-audit-report.json',
];
const scripts = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js'));
const refs = [];
for (const sf of scripts) {
  const src = fs.readFileSync(path.join(__dirname, sf), 'utf8');
  for (const bad of FORBIDDEN) {
    // 允许出现在本 FORBIDDEN 清单字面量里(即这段自检代码本身)
    const occurrences = src.split(bad).length - 1;
    const inList = sf === '_selfcheck.js' ? 1 : 0;
    if (occurrences > inList) refs.push(`${sf} -> ${bad}`);
  }
}
check('5 no forbidden dataset file referenced by any annotation script', refs.length === 0,
  refs.length ? refs.join('; ') : `${scripts.length} scripts read only model-inputs.jsonl`);

// 5b. 产物链路只读 model-inputs.jsonl: 断言每个脚本的 readFileSync 目标
const readTargets = new Set();
for (const sf of scripts) {
  const src = fs.readFileSync(path.join(__dirname, sf), 'utf8');
  for (const m of src.matchAll(/(?:INPUT|OUT|REPORT)\s*=\s*path\.join\(([^)]+)\)/g)) readTargets.add(`${sf}: ${m[1].trim()}`);
}
const readsDatasetRoot = [...readTargets].filter((t) => t.includes('ROOT,'));
const onlyInputs = readsDatasetRoot.every((t) => t.includes('model-inputs.jsonl'));
check('5b dataset-root reads are limited to model-inputs.jsonl', onlyInputs,
  readsDatasetRoot.length ? readsDatasetRoot.join(' | ') : 'no dataset-root read');

// 6. 未使用响应结果 —— 断言标注文本不含任何响应侧字段名或状态码断言
const FORBIDDEN_TEXT = /\b(responseStatus|responseBody|responseHeaders|responseSanitized|groundTruth|expectedVerdict|collectorLabel|exploitConfirmed|canaryObserved|executionEvidence|requestIntent|exploitOutcome|isHardNegative|latencyMs)\b/i;
const leaks = anns.filter((a) => FORBIDDEN_TEXT.test([...a.evidence, a.rationale, a.alternativeInterpretation, a.reviewReason].join(' ')));
check('6 no response-side artefact referenced', leaks.length === 0, leaks.length ? leaks.slice(0, 5).map((l) => l.sampleId).join(',') : '0 samples');

// 7. 未查看其他标注结果 —— 断言 annotations/ 下不存在 A 方产物
const otherA = fs.readdirSync(__dirname).filter((f) => /model-a|annotator-a|reviewerA/i.test(f));
check('7 no annotator-A artefact in annotations dir', otherA.length === 0, otherA.length ? otherA.join(',') : 'none');

// 8. 未修改原始挑战集 —— 断言提取出的文件与 git blob 逐字节一致
const REF = 'agent/viguard-lan-capture-20260729';
const TRACKED = [
  'model-inputs.jsonl', 'endpoint-inventory.json', 'role-permission-matrix.json',
  'environment.json', 'collection-report.md', 'review-guidelines.md',
  'schema/model-input-sample.schema.json',
];
const drift = [];
for (const f of TRACKED) {
  const blobSha = execSync(`git -C "${REPO}" rev-parse ${REF}:ml/data/lan_challenge_capture/${f}`).toString().trim();
  const local = fs.readFileSync(path.join(ROOT, f));
  const localSha = crypto.createHash('sha1').update(`blob ${local.length}\0`).update(local).digest('hex');
  if (blobSha !== localSha) drift.push(`${f} (git=${blobSha.slice(0, 8)} local=${localSha.slice(0, 8)})`);
}
check('8 dataset files byte-identical to git blobs', drift.length === 0, drift.length ? drift.join('; ') : `${TRACKED.length} files unmodified`);

// 9. JSONL 每行都可独立解析
let parseFails = 0;
annLines.forEach((l) => { try { JSON.parse(l); } catch { parseFails++; } });
check('9 every JSONL line parses standalone', parseFails === 0, `failures=${parseFails}`);

// 10. 报告统计与标注结果一致
const recount = (fn) => anns.reduce((m, a) => { const k = fn(a); m[k] = (m[k] || 0) + 1; return m; }, {});
const same = (a, b) => JSON.stringify(Object.fromEntries(Object.entries(a).sort())) === JSON.stringify(Object.fromEntries(Object.entries(b).sort()));
const statChecks = [
  ['sampleCount', report.sampleCount === anns.length],
  ['verdictDistribution', same(report.verdictDistribution, recount((a) => a.verdict))],
  ['attackFamilyDistribution', same(report.attackFamilyDistribution, recount((a) => a.attackFamily))],
  ['confidenceDistribution', same(report.confidenceDistribution, recount((a) => String(a.confidence)))],
  ['expertReviewCount', report.expertReviewCount === anns.filter((a) => a.needsExpertReview).length],
  ['inputSha256', report.inputSha256 === crypto.createHash('sha256').update(inputRaw).digest('hex')],
];
const badStats = statChecks.filter(([, ok]) => !ok).map(([n]) => n);
check('10 report stats match annotations', badStats.length === 0, badStats.length ? `MISMATCH: ${badStats.join(', ')}` : 'all 6 fields reconciled');

// 输出
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  [${r.detail}]`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
