// Fix Dashboard.tsx
const fs = require('fs');
let content = fs.readFileSync('src/pages/Dashboard.tsx', 'utf8');

// Replace hardcoded Chinese strings
const replacements = [
    [/title="安全控制台" subtitle="统一监控、规则、日志与运营摘要"/, `title={t('dashboard.title')} subtitle={t('dashboard.subtitle')}`],
    [/label="总请求数" value=\{stats\.totalRequests\.toLocaleString\(\)\} hint="整体流量处理规模"/, `label={t('dashboard.total_requests')} value={stats.totalRequests.toLocaleString()} hint={t('dashboard.scale')}`],
    [/label="拦截威胁" value=\{stats\.blockedRequests\.toLocaleString\(\)\} hint="近期拦截事件累计"/, `label={t('dashboard.threats_blocked')} value={stats.blockedRequests.toLocaleString()} hint={t('dashboard.recent_events')}`],
    [/label="平均延迟" value=`\$\{stats\.avgProcessingTime \|\| 0\}ms` hint=`P99 \$\{stats\.p99Latency \|\| 0\}ms`/g, `label={t('dashboard.avg_latency')} value={\`\${stats.avgProcessingTime || 0}ms\`} hint={\`\${t('dashboard.p99_latency')} \${stats.p99Latency || 0}ms\`}`],
    [/label="全局健康" value=`\$\{stats\.successRate\}%` hint=\{healthStatus\}/, `label={t('dashboard.global_health')} value={\`\${stats.successRate}%\`} hint={healthStatus}`],
    [/label="CPU 使用率"/, `label={t('dashboard.cpu_usage')}`],
    [/hint="主机 CPU"/, `hint={t('dashboard.host_cpu')}`],
    [/label="内存占用"/, `label={t('dashboard.memory_usage')}`],
    [/hint="系统内存"/, `hint={t('dashboard.system_memory')}`],
    [/label="磁盘占用"/, `label={t('dashboard.disk_usage')}`],
    [/hint="根分区使用率"/, `hint={t('dashboard.root_partition')}`],
    [/label="网络吞吐"/, `label={t('dashboard.network_throughput')}`],
    [/hint="实时 I\/O 吞吐量"/, `hint={t('dashboard.real_time_io')}`],
    [/label="高危发现" value=\{securitySummary\.openCriticalFindings\}/g, `label={t('dashboard.high_risk')} value={securitySummary.openCriticalFindings}`],
    [/hint=`高风险总数 \$\{securitySummary\.highRiskFindings \|\| 0\}`/g, `hint={\`\${t('dashboard.high_risk_total')} \${securitySummary.highRiskFindings || 0}\`}`],
    [/label="活跃告警" value=\{securitySummary\.activeAlerts\}/g, `label={t('dashboard.active_alerts')} value={securitySummary.activeAlerts}`],
    [/hint=`待处理动作 \$\{securitySummary\.pendingActions\}`/g, `hint={\`\${t('dashboard.pending_actions')} \${securitySummary.pendingActions}\`}`],
    [/label="扫描任务" value=\{securitySummary\.runningScans\}/g, `label={t('dashboard.scan_tasks')} value={securitySummary.runningScans}`],
    [/hint=`排队中 \$\{securitySummary\.queuedScans \|\| 0\}`/g, `hint={\`\${t('dashboard.queued_tasks')} \${securitySummary.queuedScans || 0}\`}`],
    [/label="观测会话" value=\{securitySummary\.observedSessions \|\| 0\}/g, `label={t('dashboard.observed_sessions')} value={securitySummary.observedSessions || 0}`],
    [/hint=`异常流量 \$\{securitySummary\.trafficAnomalies \|\| 0\}`/g, `hint={\`\${t('dashboard.anomaly_traffic')} \${securitySummary.trafficAnomalies || 0}\`}`],
    [/title="流量分析" subtitle="按时间窗口查看请求与拦截趋势"/, `title={t('dashboard.traffic_analysis')} subtitle={t('dashboard.traffic_subtitle')}`],
    [/>1 小时</g, `>{t('dashboard.time_1h')}<`],
    [/>24 小时</g, `>{t('dashboard.time_24h')}<`],
    [/title="攻击来源" subtitle="按地区聚合的最近来源分布"/, `title={t('dashboard.attack_sources')} subtitle={t('dashboard.attack_sources_subtitle')}`],
    [/title="实时日志流" subtitle="来自安全流水线的实时日志流"/, `title={t('dashboard.real_time_logs')} subtitle={t('dashboard.logs_subtitle')}`],
    [/label="最近运营动作"/g, `label={t('dashboard.recent_actions')}`],
    [/label="最近日志"/g, `label={t('dashboard.recent_logs') || 'Recent Logs'}`],
];

for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
}

// Replace healthStatus strings
content = content.replace(/const healthStatus = stats\.successRate >= 99 \? '系统健康' : stats\.successRate >= 95 \? '运行稳定' : '需要重点关注';/,
    `const healthStatus = stats.successRate >= 99 ? t('dashboard.health_good') : stats.successRate >= 95 ? t('dashboard.health_stable') : t('dashboard.health_warning');`);

// Replace empty descriptions
content = content.replace(/const emptyAttackDescription = \$\{securitySummary\.observedSessions \|\| securitySummary\.trafficAnomalies[^;]+;/,
    `const emptyAttackDescription = securitySummary.observedSessions || securitySummary.trafficAnomalies ? \`\${t('dashboard.recent_sessions') || 'Sessions'} \${securitySummary.observedSessions || 0}  \${securitySummary.trafficAnomalies || 0}\` : t('dashboard.no_recent_sessions') || 'No recent sessions';`);
content = content.replace(/const emptyRulesDescription = \$\{securitySummary\.activeAlerts[^;]+;/,
    `const emptyRulesDescription = securitySummary.activeAlerts || securitySummary.highRiskFindings ? \`\${t('dashboard.alerts_waiting') || 'Alerts'} \${securitySummary.activeAlerts} \${securitySummary.highRiskFindings || 0}\` : t('dashboard.no_rules') || 'No rules';`);
content = content.replace(/const emptyLogsText = \$\{securitySummary\.pendingActions[^;]+;/,
    `const emptyLogsText = securitySummary.pendingActions || securitySummary.failedValidations ? \`\${t('dashboard.no_new_logs') || 'No logs'} \${securitySummary.pendingActions} \${securitySummary.failedValidations}\` : t('dashboard.waiting_logs') || 'Waiting for logs';`);

fs.writeFileSync('src/pages/Dashboard.tsx', content);
console.log('Dashboard.tsx updated!');
