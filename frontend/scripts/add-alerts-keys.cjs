/**
 * Add missing alerts keys to zh.json and en.json
 */
const fs = require('fs');
const path = require('path');

const zhPath = path.join(__dirname, '../src/locales/zh.json');
const enPath = path.join(__dirname, '../src/locales/en.json');

const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// Keys used by Alerts.tsx but missing from locale files
// Component uses keys like "alerts.filterAllLevels" but locale has "alerts.alertsFilterAllLevels"
// We add the keys the component expects (without the extra "alerts" prefix)
const missingKeys = {
  filterAllLevels: { zh: '全部级别', en: 'All levels' },
  filterAllStatus: { zh: '全部状态', en: 'All statuses' },
  activeAlerts: { zh: '活跃告警', en: 'Active alerts' },
  activeHint: { zh: '当前未解决或调查中的告警', en: 'Currently unresolved or under investigation' },
  highRisk: { zh: '高危发现', en: 'High-risk findings' },
  highRiskHint: { zh: '需要优先处置的高风险发现', en: 'High-risk findings requiring priority action' },
  pendingActions: { zh: '待执行动作', en: 'Pending actions' },
  pendingHint: { zh: '系统已生成但仍待执行的处置动作', en: 'System-generated actions still pending execution' },
  failedValidations: { zh: '失败验证', en: 'Failed validations' },
  validationHint: { zh: '最近未命中或结果异常的验证任务', en: 'Recently missed or abnormally-resulting validations' },
  listTitle: { zh: '告警列表', en: 'Alert list' },
  listSubtitle: { zh: '筛选、确认、调查、解决和抑制都在同一条链路内闭环。', en: 'Filter, confirm, investigate, resolve and suppress all closed in one chain.' },
  noAlertsFiltered: { zh: '当前筛选条件下没有可显示的告警', en: 'No alerts match the current filter' },
  noAlertsDesc: { zh: '系统仍在持续聚合扫描、流量和验证结果。', en: 'System continues aggregating scan, traffic and validation results.' },
  recentActions: { zh: '最近处置动作', en: 'Recent actions' },
  noActions: { zh: '当前没有新的处置动作。', en: 'No new actions at this time.' },
  recentValidations: { zh: '最近验证结果', en: 'Recent validations' },
  noValidations: { zh: '当前没有新的验证失败。', en: 'No new validation failures.' },
  investigate: { zh: '调查', en: 'Investigate' },
  viewDetail: { zh: '查看详情', en: 'View detail' },
  confirm: { zh: '确认', en: 'Confirm' },
  resolve: { zh: '解决', en: 'Resolve' },
  suppress: { zh: '抑制', en: 'Suppress' },
  actionFailed: { zh: '操作失败', en: 'Action failed' },
  load_failed: { zh: '告警数据加载失败', en: 'Failed to load alerts' },
};

let zhCount = 0;
let enCount = 0;

for (const [key, vals] of Object.entries(missingKeys)) {
  if (!zh.alerts[key]) {
    zh.alerts[key] = vals.zh;
    zhCount++;
  }
  if (!en.alerts[key]) {
    en.alerts[key] = vals.en;
    enCount++;
  }
}

fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2) + '\n', 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

console.log(`Added ${zhCount} keys to zh.json, ${enCount} keys to en.json`);
