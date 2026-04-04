// Fix AlertDetail.tsx, FixHistory.tsx, FixHistoryDetail.tsx, Devices.tsx, AgentMonitor.tsx, AgentDetail.tsx, App.tsx, DeploymentWizard.tsx
const fs = require('fs');

// AlertDetail.tsx
let ad = fs.readFileSync('src/pages/AlertDetail.tsx', 'utf8');
ad = ad.replace(/title="告警详情" subtitle="[^"]*"/g, 'title={t(\'alertDetail.title\')} subtitle={t(\'alertDetail.subtitle\')}');
ad = ad.replace(/返回告警中心/g, "{t('alertDetail.back')}");
ad = ad.replace(/title="正在加载告警详情"/g, 'title={t(\'alertDetail.loading\')}');
ad = ad.replace(/严重级别/g, "{t('alertDetail.severity_level')}");
ad = ad.replace(/状态/g, "{t('alertDetail.status')}");
ad = ad.replace(/来源/g, "{t('alertDetail.source')}");
ad = ad.replace(/时间/g, "{t('alertDetail.time')}");
ad = ad.replace(/title="证据与关联扫描"/g, 'title={t(\'alertDetail.evidence\')}');
ad = ad.replace(/title="暂无结构化证据"/g, 'title={t(\'alertDetail.no_evidence\')}');
ad = ad.replace(/title="时间线"/g, 'title={t(\'alertDetail.timeline\')}');
ad = ad.replace(/title="暂无关联动作"/g, 'title={t(\'alertDetail.no_actions\')}');
fs.writeFileSync('src/pages/AlertDetail.tsx', ad);
console.log('AlertDetail.tsx updated!');

// FixHistory.tsx
let fh = fs.readFileSync('src/pages/FixHistory.tsx', 'utf8');
fh = fh.replace(/title="修复历史" subtitle="[^"]*"/g, 'title={t(\'fixHistory.title\')} subtitle={t(\'fixHistory.subtitle\')}');
fh = fh.replace(/title="正在加载历史记录"/g, 'title={t(\'fixHistory.loading\')}');
fh = fh.replace(/title="当前没有可展示的历史记录"/g, 'title={t(\'fixHistory.no_records\')}');
fh = fh.replace(/查看详情/g, "{t('fixHistory.view_detail')}");
fs.writeFileSync('src/pages/FixHistory.tsx', fh);
console.log('FixHistory.tsx updated!');

// FixHistoryDetail.tsx
let fhd = fs.readFileSync('src/pages/FixHistoryDetail.tsx', 'utf8');
fhd = fhd.replace(/title="修复记录详情"/g, 'title={t(\'fixHistoryDetail.title\')}');
fhd = fhd.replace(/返回修复历史/g, "{t('fixHistoryDetail.back')}");
fhd = fhd.replace(/title="正在加载修复记录"/g, 'title={t(\'fixHistoryDetail.loading\')}');
fhd = fhd.replace(/状态：/g, "{t('fixHistoryDetail.status')}: ");
fhd = fhd.replace(/阶段：/g, "{t('fixHistoryDetail.phase')}: ");
fhd = fhd.replace(/进度：/g, "{t('fixHistoryDetail.progress')}: ");
fhd = fhd.replace(/错误：/g, "{t('fixHistoryDetail.error')}: ");
fhd = fhd.replace(/无/g, "{t('fixHistoryDetail.none')}");
fhd = fhd.replace(/title="修复摘要"/g, 'title={t(\'fixHistoryDetail.summary\')}');
fhd = fhd.replace(/title="发现项"/g, 'title={t(\'fixHistoryDetail.findings\')}');
fhd = fhd.replace(/title="暂无关联发现项"/g, 'title={t(\'fixHistoryDetail.no_findings\')}');
fs.writeFileSync('src/pages/FixHistoryDetail.tsx', fhd);
console.log('FixHistoryDetail.tsx updated!');

// Devices.tsx
let dev = fs.readFileSync('src/pages/Devices.tsx', 'utf8');
dev = dev.replace(/subtitle="设备、命令、配置与安全上下文统一查看。"/g, 'subtitle={t(\'devices.subtitle\')}');
dev = dev.replace(/活跃告警/g, "{t('devices.active_alerts')}");
dev = dev.replace(/进行中扫描/g, "{t('devices.running_scans')}");
dev = dev.replace(/重新检查接入状态/g, "{t('devices.recheck')}");
fs.writeFileSync('src/pages/Devices.tsx', dev);
console.log('Devices.tsx updated!');

// AgentMonitor.tsx
let am = fs.readFileSync('src/pages/AgentMonitor.tsx', 'utf8');
am = am.replace(/活跃告警/g, "{t('agentMonitor.active_alerts')}");
am = am.replace(/进行中扫描/g, "{t('agentMonitor.running_scans')}");
fs.writeFileSync('src/pages/AgentMonitor.tsx', am);
console.log('AgentMonitor.tsx updated!');

// AgentDetail.tsx
let adet = fs.readFileSync('src/pages/AgentDetail.tsx', 'utf8');
adet = adet.replace(/title="最近威胁与任务"/g, 'title={t(\'agentDetail.recent_threats\')}');
adet = adet.replace(/title="暂无关联威胁"/g, 'title={t(\'agentDetail.no_threats\')}');
adet = adet.replace(/title="状态时间线"/g, 'title={t(\'agentDetail.status_timeline\')}');
fs.writeFileSync('src/pages/AgentDetail.tsx', adet);
console.log('AgentDetail.tsx updated!');

// App.tsx - fix language toggle and user display
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(/role: user\.role \|\| '未设置角色'/g, "role: user.role || t('app.role_not_set')");
app = app.replace(/name: '未命名用户', role: '未设置角色'/g, "name: user.name || t('app.unnamed_user'), role: user.role || t('app.role_not_set')");
app = app.replace(/中文/g, "{t('app.chinese')}");
fs.writeFileSync('src/App.tsx', app);
console.log('App.tsx updated!');

console.log('\nAll components updated!');
