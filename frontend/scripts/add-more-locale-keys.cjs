/**
 * Add missing locale keys found by audit
 */
const fs = require('fs');
const path = require('path');

const zhPath = path.join(__dirname, '../src/locales/zh.json');
const enPath = path.join(__dirname, '../src/locales/en.json');

const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

const missing = {
  board: {
    backToList: { zh: '返回列表', en: 'Back to list' },
    deviceMetrics: { zh: '设备指标', en: 'Device metrics' },
    gatewayMetrics: { zh: '网关指标', en: 'Gateway metrics' },
    eventStream: { zh: '事件流', en: 'Event stream' },
    noEvents: { zh: '暂无事件', en: 'No events' },
    noEventsDesc: { zh: '当前无活跃事件', en: 'No active events at this time' },
  },
  deploymentWizard: {
    page_subtitle: { zh: '部署配置向导', en: 'Deployment configuration wizard' },
    wizard_title: { zh: '部署向导', en: 'Deployment Wizard' },
    wizard_subtitle: { zh: '按照向导步骤配置并部署系统', en: 'Follow the wizard steps to configure and deploy the system' },
    history_subtitle: { zh: '查看历史部署记录', en: 'View historical deployment records' },
    no_saved_configs: { zh: '暂无已保存的配置', en: 'No saved configurations' },
  },
  fixHistoryDetail: {
    page_subtitle: { zh: '查看修复记录详情 {id}', en: 'View fix record detail {id}' },
  },
  scanner: {
    ws_connected: { zh: '实时连接已建立', en: 'Live connection established' },
    ws_polling: { zh: '轮询中...', en: 'Polling...' },
    current_task_hint: { zh: '当前任务', en: 'Current task' },
    task_status_hint: { zh: '任务状态', en: 'Task status' },
    progress_hint: { zh: '进度', en: 'Progress' },
    port_scan: { zh: '端口扫描', en: 'Port scan' },
    asset_view_subtitle: { zh: '资产视图', en: 'Asset view' },
    evidence_panel: { zh: '证据面板', en: 'Evidence panel' },
    evidence_panel_subtitle: { zh: '相关证据和上下文', en: 'Related evidence and context' },
    create_action: { zh: '创建动作', en: 'Create action' },
    evidence: { zh: '证据', en: 'Evidence' },
  },
  siteDetail: {
    page_subtitle: { zh: '查看站点 {id} 详情', en: 'View site {id} details' },
  },
  sites: {
    listSubtitle: { zh: '支持直接进入站点详情页查看暴露面和关联安全上下文。', en: 'Directly access site detail pages to view exposure and related security context.' },
    noSites: { zh: '暂无站点', en: 'No sites' },
  },
  alerts: {
    title: { zh: '系统警报', en: 'System Alerts' },
  },
};

let zhCount = 0;
let enCount = 0;

for (const [section, keys] of Object.entries(missing)) {
  if (!zh[section]) zh[section] = {};
  if (!en[section]) en[section] = {};
  for (const [key, { zh: zhVal, en: enVal }] of Object.entries(keys)) {
    if (!zh[section][key]) { zh[section][key] = zhVal; zhCount++; }
    if (!en[section][key]) { en[section][key] = enVal; enCount++; }
  }
}

fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2) + '\n', 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

console.log(`Added ${zhCount} keys to zh.json, ${enCount} keys to en.json`);
