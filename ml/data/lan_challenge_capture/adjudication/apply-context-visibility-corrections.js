/*
 * Apply the one-time context-visibility audit corrections to adjudicator-C decisions
 * and emit the machine-readable / human-readable audit artifacts.
 *
 * This script reads only model-visible inputs and the existing adjudication artifacts.
 * It does not read responses, collector labels, AetherArgus predictions, or private data.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const DATA = path.resolve(OUT, '..');
const DECISIONS = path.join(OUT, 'decisions');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

const inputs = readJsonl(path.join(DATA, 'model-inputs.jsonl'));
const inputById = new Map(inputs.map((row) => [row.sampleId, row.input]));
const consensus = readJsonl(path.join(OUT, 'consensus.jsonl'));

const authorizationAttackIds = new Set([
  'viguard-lan-000128',
  'viguard-lan-000129',
  'viguard-lan-000130',
  'viguard-lan-000131',
  'viguard-lan-000132',
  'viguard-lan-000210',
  'viguard-lan-000212',
]);

const privilegedOperationIds = new Set([
  'viguard-lan-000115',
  'viguard-lan-000116',
  'viguard-lan-000117',
  'viguard-lan-000118',
  'viguard-lan-000119',
  'viguard-lan-000120',
  'viguard-lan-000121',
  'viguard-lan-000122',
  'viguard-lan-000270',
  'viguard-lan-000271',
  'viguard-lan-000272',
  'viguard-lan-000273',
  'viguard-lan-000274',
  'viguard-lan-000275',
  'viguard-lan-000276',
  'viguard-lan-000277',
  'viguard-lan-000278',
  'viguard-lan-000279',
  'viguard-lan-000280',
]);

const objectOwnershipIds = new Set([
  'viguard-lan-000258',
  'viguard-lan-000259',
  'viguard-lan-000260',
  'viguard-lan-000261',
  'viguard-lan-000262',
  'viguard-lan-000263',
  'viguard-lan-000264',
  'viguard-lan-000265',
  'viguard-lan-000266',
  'viguard-lan-000267',
  'viguard-lan-000268',
  'viguard-lan-000269',
  'viguard-lan-000286',
  'viguard-lan-000287',
  'viguard-lan-000288',
  'viguard-lan-000289',
  'viguard-lan-000290',
  'viguard-lan-000291',
  'viguard-lan-000292',
  'viguard-lan-000293',
  'viguard-lan-000304',
  'viguard-lan-000305',
  'viguard-lan-000306',
]);

const storedSqlIds = new Set([
  'viguard-lan-000163',
  'viguard-lan-000164',
  'viguard-lan-000165',
  'viguard-lan-000397',
  'viguard-lan-000398',
  'viguard-lan-000399',
  'viguard-lan-000400',
  'viguard-lan-000401',
  'viguard-lan-000402',
  'viguard-lan-000403',
  'viguard-lan-000404',
]);

const storedXssIds = new Set([
  'viguard-lan-000168',
  'viguard-lan-000169',
  'viguard-lan-000170',
  'viguard-lan-000171',
  'viguard-lan-000172',
  'viguard-lan-000173',
  'viguard-lan-000174',
  'viguard-lan-000175',
]);

const originalAttackIds = new Set([...authorizationAttackIds, ...storedSqlIds, ...storedXssIds]);
const correctionIds = new Set([
  ...authorizationAttackIds,
  ...privilegedOperationIds,
  ...objectOwnershipIds,
  ...storedSqlIds,
  ...storedXssIds,
]);
const issues = [];
let decisionCount = 0;

for (const file of fs.readdirSync(DECISIONS).filter((name) => /^batch-\d+\.jsonl$/.test(name)).sort()) {
  const fullPath = path.join(DECISIONS, file);
  const rows = readJsonl(fullPath);

  for (const row of rows) {
    decisionCount += 1;
    if (!correctionIds.has(row.sampleId)) continue;

    const input = inputById.get(row.sampleId);
    if (!input) throw new Error(`missing model-visible input for ${row.sampleId}`);

    const previousVerdict = originalAttackIds.has(row.sampleId) ? 'attack' : 'safe';
    let category;
    let hiddenEvidence;
    let visibleInputFields;
    let reason;

    if (authorizationAttackIds.has(row.sampleId) || privilegedOperationIds.has(row.sampleId)) {
      category = 'principal_role_missing';
      hiddenEvidence = [
        'actual acting principal role',
        'role-permission-matrix outcome for the collection account',
      ];
      visibleInputFields = [
        'input.method',
        'input.path',
        'input.body',
        'input.sourceContext.authenticated',
      ];
      reason = 'The model-visible input confirms authentication but does not identify the acting principal role, so a legitimate privileged admin, rule-management, or deployment operation cannot be distinguished from an authorization attack.';
      row.evidence = [
        `${input.method} ${input.path}`,
        'sourceContext.authenticated=true; no principalRole, tenantRole, permissionScope, or response outcome is present',
      ];
      row.rationale = '模型可见输入仅表明已认证,未提供实际调用者角色或权限范围;合法高权限操作与越权请求无法区分,按上下文不足改判 unknown。';
      row.auditReason = 'context_visibility:actual principal role and permission scope are absent from model-inputs.jsonl';
      row.finalAttackFamily = 'authorization';
    } else if (objectOwnershipIds.has(row.sampleId)) {
      category = 'object_ownership_missing';
      hiddenEvidence = [
        'ownership and tenant scope of the referenced alert object',
        'whether the acting principal may modify that object',
      ];
      visibleInputFields = [
        'input.method',
        'input.path',
        'input.body',
        'input.sourceContext.authenticated',
      ];
      reason = 'The request performs a state-changing action on an opaque alert identifier, while the model-visible input contains no owner, tenant, or permission scope for that object.';
      row.evidence = [
        `${input.method} ${input.path}`,
        'the alert identifier is opaque; no objectOwner, tenantId, permissionScope, or response outcome is present',
      ];
      row.rationale = '请求对不透明告警 ID 执行状态变更,但模型输入不含对象归属、租户边界或调用者对象权限;正常处置与 IDOR/BOLA 无法区分,改判 unknown。';
      row.auditReason = 'context_visibility:object ownership and tenant scope are absent from model-inputs.jsonl';
      row.finalAttackFamily = 'idor_bola';
    } else if (storedSqlIds.has(row.sampleId)) {
      category = 'server_execution_semantics_missing';
      hiddenEvidence = [
        'whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter',
      ];
      visibleInputFields = [
        'input.method',
        'input.path',
        'input.body.note',
        ...(input.body && Object.prototype.hasOwnProperty.call(input.body, 'filter') ? ['input.body.filter'] : []),
        ...(input.body && Object.prototype.hasOwnProperty.call(input.body, 'q') ? ['input.body.q'] : []),
      ];
      reason = 'The payload is visible, but the input does not establish that the acknowledgement note/filter/q fields reach a SQL interpreter rather than being stored as text.';
      row.evidence = [
        `${input.method} ${input.path}`,
        'SQL-like text is present only in acknowledgement note/filter/q fields; no server-side parsing or execution semantics are model-visible',
      ];
      row.rationale = '输入中的 SQL 语法仅位于告警处置的 note/filter/q 文本字段;模型看不到这些字段会进入 SQL 解释器还是仅被存储,因此改判 unknown。';
      row.auditReason = 'context_visibility:server-side SQL parsing or execution semantics are absent from model-inputs.jsonl';
    } else {
      category = 'server_execution_semantics_missing';
      hiddenEvidence = [
        'whether body.note is rendered into an executable HTML context',
      ];
      visibleInputFields = [
        'input.method',
        'input.path',
        'input.body.note',
      ];
      reason = 'The payload is visible, but the input does not establish that the acknowledgement note is rendered into an executable HTML context rather than stored or escaped as text.';
      row.evidence = [
        `${input.method} ${input.path}`,
        'HTML/JavaScript-like text is present only in body.note; no rendering, escaping, or response-side behavior is model-visible',
      ];
      row.rationale = '输入中的 XSS 语法仅位于告警处置 note 文本字段;模型看不到该字段是否进入可执行 HTML 上下文或被转义存储,因此改判 unknown。';
      row.auditReason = 'context_visibility:server-side rendering and escaping semantics are absent from model-inputs.jsonl';
    }

    row.finalVerdict = 'unknown';
    row.finalRecommendedAction = 'challenge';
    row.finalContextSufficient = false;
    row.adjudicatorConfidence = 2;
    row.resolutionDecision = 'insufficient_context';

    issues.push({
      sampleId: row.sampleId,
      previousVerdict,
      finalVerdict: 'unknown',
      attackFamily: row.finalAttackFamily,
      category,
      hiddenEvidence,
      visibleInputFields,
      resolution: 'changed_to_unknown',
      reason,
    });
  }

  writeJsonl(fullPath, rows);
}

issues.sort((a, b) => a.sampleId.localeCompare(b.sampleId));

if (decisionCount !== 253) throw new Error(`expected 253 adjudication decisions, found ${decisionCount}`);
if (consensus.length !== 160) throw new Error(`expected 160 consensus rows, found ${consensus.length}`);
if (inputs.length !== 413) throw new Error(`expected 413 model inputs, found ${inputs.length}`);
if (issues.length !== correctionIds.size) {
  const found = new Set(issues.map((issue) => issue.sampleId));
  const missing = [...correctionIds].filter((id) => !found.has(id));
  throw new Error(`applied ${issues.length}/${correctionIds.size} corrections; missing=${missing.join(',')}`);
}

const auditedAt = process.env.VIGUARD_AUDITED_AT || new Date().toISOString();
const audit = {
  schemaVersion: 1,
  auditedAt,
  modelVisibleInputFile: 'ml/data/lan_challenge_capture/model-inputs.jsonl',
  sampleCount: 413,
  adjudicatedSampleCount: 253,
  consensusSampleCount: 160,
  auditedSampleCount: 413,
  hiddenContextIssueCount: issues.length,
  correctedLabelCount: issues.length,
  unchangedLabelCount: 413 - issues.length,
  issueCategories: {
    principal_role_missing: issues.filter((issue) => issue.category === 'principal_role_missing').length,
    object_ownership_missing: issues.filter((issue) => issue.category === 'object_ownership_missing').length,
    tenant_boundary_missing: 0,
    server_execution_semantics_missing: issues.filter((issue) => issue.category === 'server_execution_semantics_missing').length,
    response_side_dependency: 0,
    collector_intent_dependency: 0,
    other: 0,
  },
  responseSideEvidenceUsed: false,
  collectorGroundTruthUsed: false,
  auditedSampleIds: inputs.map((row) => row.sampleId).sort(),
  correctedSampleIds: issues.map((issue) => issue.sampleId),
  issues,
};

fs.writeFileSync(path.join(OUT, 'context-visibility-audit.json'), JSON.stringify(audit, null, 2) + '\n');

const markdown = [];
markdown.push('# VIguard Context-Visibility Audit');
markdown.push('');
markdown.push(`Audited all **${audit.sampleCount}** model-visible inputs: ${audit.adjudicatedSampleCount} model-adjudication rows and ${audit.consensusSampleCount} strict-consensus rows.`);
markdown.push('');
markdown.push('## Evidence boundary');
markdown.push('');
markdown.push('- **Model-visible evidence** is limited to the matching row in `model-inputs.jsonl`: request method, path, headers, body, and the two `sourceContext` fields.');
markdown.push('- **Adjudicator auxiliary context** includes environment files, endpoint inventories, role matrices, collection plans, and response-side observations. Those sources may explain collection, but they cannot make a reference label more certain than the evaluated model can be.');
markdown.push('- A complete attack syntax remains an attack only when the model-visible field is itself a clear security-sensitive execution entry. Text in a note, filter, search, or record field is not assumed to execute, render, or reach an interpreter.');
markdown.push('');
markdown.push('## Results');
markdown.push('');
markdown.push(`- Hidden-context issues corrected: **${audit.correctedLabelCount}**`);
markdown.push(`- Labels retained after review: **${audit.unchangedLabelCount}**`);
markdown.push(`- Principal-role dependencies removed: **${audit.issueCategories.principal_role_missing}**`);
markdown.push(`- Missing object ownership / tenant scope corrected: **${audit.issueCategories.object_ownership_missing}**`);
markdown.push(`- Missing server execution/rendering semantics corrected: **${audit.issueCategories.server_execution_semantics_missing}**`);
markdown.push('- Response-side evidence or response outcomes used: **no**');
markdown.push('- Collector ground truth, collector intent, or AetherArgus predictions used: **no**');
markdown.push('');
markdown.push('The corrected labels use `verdict=unknown`, `contextSufficient=false`, `recommendedAction=challenge`, and `resolutionDecision=insufficient_context`. Role-dependent cases use the `authorization` family, object-scope cases use `idor_bola`, and stored-text cases retain their visible payload family.');
markdown.push('');
markdown.push('## Corrected labels');
markdown.push('');
markdown.push('| Sample | Previous | Final | Family | Missing model-visible context |');
markdown.push('|---|---|---|---|---|');
for (const issue of issues) {
  markdown.push(`| ${issue.sampleId} | ${issue.previousVerdict} | ${issue.finalVerdict} | ${issue.attackFamily} | ${issue.hiddenEvidence.join('; ')} |`);
}
markdown.push('');
markdown.push('## Fairness conclusion');
markdown.push('');
markdown.push('Every final label is now bounded by the evidence available to AetherArgus in the corresponding `model-inputs.jsonl` row. Environment and response artifacts are provenance aids only. The audit does not claim exploit success, does not treat AI adjudication as human review, and does not make the challenge set eligible for training.');
markdown.push('');

fs.writeFileSync(path.join(OUT, 'context-visibility-audit.md'), markdown.join('\n'));

console.log(`context visibility corrections applied: ${issues.length}`);
console.log('adjudicated rows audited:', decisionCount);
console.log('consensus rows audited:', consensus.length);
