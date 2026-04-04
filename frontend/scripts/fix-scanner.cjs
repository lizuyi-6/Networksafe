// Batch fix Scanner.tsx - replace hardcoded Chinese with t() calls
const fs = require('fs');
let content = fs.readFileSync('src/pages/Scanner.tsx', 'utf8');

// Replace log messages
content = content.replace(/addLog\('扫描任务已启动'\)/g, "addLog(t('scanner.task_started'))");
content = content.replace(/addLog\('扫描任务已完成'\)/g, "addLog(t('scanner.task_completed'))");
content = content.replace(/addLog\('扫描任务已取消'\)/g, "addLog(t('scanner.task_cancelled'))");
content = content.replace(/addLog\(evt\.payload\?\.message \|\| '收到任务日志'\)/g, "addLog(evt.payload?.message || t('scanner.task_log_received'))");
content = content.replace(/setError\(evt\.payload\?\.error \|\| '扫描失败'\)/g, "setError(evt.payload?.error || t('scanner.task_failed'))");
content = content.replace(/addLog\(`扫描失败：\$\{evt\.payload\?\.error \|\| '未知错误'\}`\)/g, "`scan failed: ${evt.payload?.error || t('scanner.none')}`");
content = content.replace(/setError\(scanError\.message \|\| '创建扫描任务失败'\)/g, "setError(scanError.message || t('scanner.create_failed'))");
content = content.replace(/setError\(scanError\.message \|\| '取消任务失败'\)/g, "setError(scanError.message || t('scanner.cancel_failed'))");
content = content.replace(/setActionMessage\(actionError\.message \|\| '创建处置动作失败'\)/g, "setActionMessage(actionError.message || t('scanner.action_failed'))");

// Replace STATUS_LABELS and PHASE_LABELS usage in subscriptions
content = content.replace(/addLog\(`进入阶段：\$\{PHASE_LABELS\[evt\.payload\?\.phase\] \|\| evt\.payload\?\.phase`\)/g, "`Entered phase: ${t(PHASE_LABELS_KEYS[evt.payload?.phase]) || evt.payload?.phase}`");

// Replace STATUS_LABELS[status] and PHASE_LABELS[phase] references
content = content.replace(/STATUS_LABELS\[status\] \|\| status/g, `t(STATUS_LABELS_KEYS[status]) || status`);
content = content.replace(/PHASE_LABELS\[phase\] \|\| phase/g, `t(PHASE_LABELS_KEYS[phase]) || phase`);
content = content.replace(/STATUS_LABELS\[item\.status\] \|\| item\.status/g, `t(STATUS_LABELS_KEYS[item.status]) || item.status`);
content = content.replace(/PHASE_LABELS\[item\.phase\] \|\| item\.phase/g, `t(PHASE_LABELS_KEYS[item.phase]) || item.phase`);
content = content.replace(/PHASE_LABELS\[evt\.payload\?\.phase\] \|\| evt\.payload\?\.phase/g, `t(PHASE_LABELS_KEYS[evt.payload?.phase]) || evt.payload?.phase`);

// Replace hardcoded Chinese strings in JSX
content = content.replace(/title="扫描中心"/g, `title={t('scanner.title')}`);
content = content.replace(/subtitle=`统一管理扫描任务、资产证据与处置建议\$\{connected \? '，WebSocket 已连接' : '，当前使用轮询回退'\}`/g, `subtitle={t('scanner.subtitle')}`);
content = content.replace(/>启动扫描</g, `>{t('scanner.start_scan')}<`);
content = content.replace(/label="当前任务"/g, `label={t('scanner.current_task') || 'Current Task'}`);
content = content.replace(/label="任务状态"/g, `label={t('scanner.task_status') || 'Task Status'}`);
content = content.replace(/label="执行进度"/g, `label={t('scanner.progress') || 'Progress'}`);
content = content.replace(/title="扫描输入" subtitle="保留现有入口，但把结果深化为资产、证据与处置闭环"/g, `title={t('scanner.scan_input')} subtitle={t('scanner.scan_input_subtitle')}`);
content = content.replace(/本机扫描范围/g, `t('scanner.local_scope')`);
content = content.replace(/系统基线与主机状态/g, `t('scanner.baseline')`);
content = content.replace(/Web 服务指纹与配置/g, `t('scanner.web_fingerprint')`);
content = content.replace(/title="暂无扫描任务" description="执行一次扫描后，这里会保留最近任务与执行进度。"/g, `title={t('scanner.no_tasks')} description={t('scanner.no_tasks_desc')}`);
content = content.replace(/title="暂无发现项" description="完成扫描后，这里会显示按严重级别排序的发现项。"/g, `title={t('scanner.no_findings') || 'No Findings'} description={t('scanner.no_findings_desc') || 'Findings will appear here after scan'} `);

// Replace addLog messages that still have Chinese
content = content.replace(/addLog\('已请求取消当前任务'\)/g, "addLog(t('scanner.cancel_requested') || 'Cancel requested')");
content = content.replace(/addLog\(`已创建任务 \$\{id\`}\)`\)/g, "`Task created: ${id}`");

fs.writeFileSync('src/pages/Scanner.tsx', content);
console.log('Scanner.tsx updated!');
