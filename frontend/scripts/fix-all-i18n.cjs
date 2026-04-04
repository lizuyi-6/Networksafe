/**
 * Add ALL missing locale keys to zh.json and en.json
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'locales');

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
}
function writeJson(file, data) {
    fs.writeFileSync(path.join(LOCALES_DIR, file), JSON.stringify(data, null, 2) + '\n');
}

const zh = readJson('zh.json');
const en = readJson('en.json');

function setKey(obj, key, val) {
    const parts = key.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!o[parts[i]]) o[parts[i]] = {};
        o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
}

// All new keys: { key: [zh, en] }
const K = {
    // dashboard
    'dashboard.empty_attack_observed': ['最近已观测 {sessions} 条会话，识别 {anomalies} 个异常流量特征。', 'Observed {sessions} sessions, identified {anomalies} anomalies.'],
    'dashboard.empty_attack_fallback': ['当前没有新的来源分布，但系统仍在持续接收实时流量摘要。', 'No new source distribution yet, system is still receiving real-time traffic.'],
    'dashboard.empty_rules_alert': ['当前有 {alerts} 条活跃告警、{risks} 条高风险发现等待规则命中。', '{alerts} active alerts, {risks} high-risk findings awaiting rule matches.'],
    'dashboard.empty_rules_fallback': ['规则命中后这里会显示排行；当前可转到监控、告警和设备页查看实时状态。', 'Rankings appear after rule matches. Check monitoring, alerts, and devices for real-time status.'],
    'dashboard.empty_logs_pending': ['当前没有新的日志流；待执行动作 {pending}，失败验证 {failed}。', 'No new logs. Pending actions: {pending}, failed validations: {failed}.'],
    'dashboard.empty_logs_fallback': ['正在等待新的日志事件进入当前视图', 'Waiting for new log events'],
    'dashboard.traffic_trend_subtitle': ['按时间窗口查看请求与拦截趋势', 'View requests and blocking trends by time window'],
    'dashboard.no_attack_sources': ['暂无攻击来源分布', 'No Attack Source Distribution'],
    'dashboard.real_time_logs': ['实时日志流', 'Real-time Log Stream'],
    'dashboard.logs_filter_subtitle': ['筛选当前视图并导出结果', 'Filter current view and export results'],
    'dashboard.filter_placeholder': ['筛选：status / type / path / message', 'Filter: status / type / path / message'],
    'dashboard.recent_actions': ['最近运营动作', 'Recent Operations'],
    'dashboard.recent_actions_subtitle': ['来自扫描、处置和验证链路的最新结果', 'Latest results from scans, remediations, and validations'],
    'dashboard.no_recent_actions': ['暂无新的运营动作', 'No Recent Operations'],
    'dashboard.no_recent_actions_desc': ['当扫描、处置或攻击验证完成后，这里会展示最近的真实结果。', 'Results appear here after scans, remediations, or validations complete.'],
    'dashboard.no_rules': ['暂无规则遥测', 'No Rule Telemetry'],
    'dashboard.exported': ['已导出当前视图', 'Current view exported'],
    'dashboard.api_key_desc_full': ['展示当前管理员可快速核对的首个密钥前缀与最近使用时间，便于排查接入链路。', 'Shows the first key prefix and last usage time for quick access verification.'],

    // agents
    'agents.page_title': ['智能体', 'Agents'],
    'agents.page_subtitle': ['统一查看智能体在线状态、资源占用与近期威胁事件。', 'View agent status, resource usage, and recent threats.'],
    'agents.total_agents_hint': ['已注册智能体总数', 'Total registered agents'],
    'agents.online_hint': ['当前在线节点数量', 'Current online nodes'],
    'agents.threats_hint': ['最近相关安全事件数', 'Recent security events'],
    'agents.online_rate_hint': ['在线健康比例', 'Online health ratio'],
    'agents.fleet': ['智能体机群', 'Agent Fleet'],
    'agents.fleet_subtitle': ['每个卡片都支持执行动作和进入详情页。', 'Each card supports actions and detail navigation.'],
    'agents.loading_agents': ['正在加载智能体数据', 'Loading Agent Data'],
    'agents.no_agents_display': ['当前没有可显示的智能体节点', 'No Agent Nodes to Display'],
    'agents.online': ['在线', 'Online'],
    'agents.offline': ['离线', 'Offline'],
    'agents.memory': ['内存', 'Memory'],
    'agents.uptime_label': ['运行时长', 'Uptime'],
    'agents.view_detail': ['查看详情', 'View Details'],
    'agents.threat_panel': ['安全事件', 'Security Events'],
    'agents.threat_panel_subtitle': ['近期与智能体相关的事件', 'Recent agent-related events'],
    'agents.no_active_threats': ['暂无活动威胁', 'No Active Threats'],
    'agents.no_threats_desc': ['最近没有检测到新的智能体安全事件。', 'No new agent security events detected.'],
    'agents.source_label': ['来源', 'Source'],
    'agents.time_label': ['时间', 'Time'],

    // agentDetail
    'agentDetail.page_title': ['智能体详情', 'Agent Details'],
    'agentDetail.page_subtitle': ['查看智能体 {id} 的健康、能力与事件', 'View health, capabilities, and events for agent {id}'],
    'agentDetail.back': ['返回智能体', 'Back to Agents'],
    'agentDetail.scan': ['发起扫描', 'Start Scan'],
    'agentDetail.loading': ['正在加载智能体详情', 'Loading Agent Details'],
    'agentDetail.online': ['在线', 'Online'],
    'agentDetail.offline': ['离线', 'Offline'],
    'agentDetail.platform': ['平台', 'Platform'],
    'agentDetail.last_heartbeat': ['最近心跳', 'Last Heartbeat'],
    'agentDetail.memory': ['内存', 'Memory'],
    'agentDetail.capabilities': ['运行能力', 'Capabilities'],
    'agentDetail.capabilities_subtitle': ['版本、架构与资源描述', 'Version, architecture, and resources'],
    'agentDetail.recent_threats_title': ['近期安全事件', 'Recent Security Events'],
    'agentDetail.recent_threats_subtitle': ['与该智能体关联的安全事件', 'Security events related to this agent'],
    'agentDetail.no_threats': ['暂无安全事件', 'No Security Events'],
    'agentDetail.no_threats_desc': ['扫描和策略命中后，这里会显示与该智能体相关的事件。', 'Events appear after scans and policy matches.'],
    'agentDetail.status_timeline': ['状态时间线', 'Status Timeline'],
    'agentDetail.status_timeline_subtitle': ['心跳和运行态变化', 'Heartbeat and runtime changes'],

    // agentMonitor
    'agentMonitor.auto_refresh_on': ['监控已启用', 'Auto-refresh On'],
    'agentMonitor.orchestrator_hint': ['当前已注册的编排节点', 'Registered orchestrator nodes'],
    'agentMonitor.queue_hint': ['当前消息总线排队深度', 'Message bus queue depth'],
    'agentMonitor.casefile_hint': ['已保留的综合研判案卷', 'Retained case files'],
    'agentMonitor.scans_hint': ['来自扫描、流量与验证链路', 'From scans, traffic, and validations'],
    'agentMonitor.running_hint': ['当前仍在执行的扫描任务', 'Currently running scans'],
    'agentMonitor.actions_hint': ['待执行动作', 'Pending actions'],
    'agentMonitor.queue_depth_hint': ['处置动作与队列积压', 'Actions and queue backlog'],
    'agentMonitor.validations_failed': ['验证失败', 'Validations Failed'],
    'agentMonitor.drill_no_block': ['未拦截或误报的演练运行', 'Unblocked or false-positive drills'],
    'agentMonitor.high_risk_assets': ['高风险资产', 'High-Risk Assets'],
    'agentMonitor.high_risk_hint': ['当前需要优先关注的资产', 'Assets requiring priority attention'],
    'agentMonitor.decision_chain': ['七层协同决策链路', '7-Layer Decision Chain'],
    'agentMonitor.dispatch_subtitle': ['调度与传输运行指标', 'Dispatch and transport metrics'],
    'agentMonitor.telemetry_subtitle': ['各节点活动与响应遥测', 'Node activity and response telemetry'],
    'agentMonitor.no_heartbeat': ['当前环境还没有可用的心跳数据', 'No heartbeat data available'],
    'agentMonitor.learning': ['学习结果与模式沉淀', 'Learning Results & Patterns'],
    'agentMonitor.no_patterns': ['暂无综合模式', 'No Composite Patterns'],
    'agentMonitor.no_patterns_desc': ['案卷积累后，这里会展示高频归纳模式。', 'Patterns appear after case files accumulate.'],
    'agentMonitor.no_degradation': ['当前未发现降级子系统。', 'No degraded subsystems detected.'],

    // alertDetail
    'alertDetail.page_title': ['告警详情', 'Alert Details'],
    'alertDetail.page_subtitle': ['查看告警 {id} 的证据、线索与关联对象', 'View evidence and related objects for alert {id}'],
    'alertDetail.findings': ['与本次告警相关的发现', 'Findings Related to This Alert'],
    'alertDetail.findings_subtitle': ['扫描与流量会话', 'Scans and traffic sessions'],
    'alertDetail.findings_desc': ['后续扫描、验证和流量事件会在这里聚合', 'Follow-up scans, validations, and traffic events aggregated here'],
    'alertDetail.context': ['调查上下文', 'Investigation Context'],
    'alertDetail.actions': ['关联动作', 'Related Actions'],
    'alertDetail.actions_subtitle': ['已创建的调查与处置动作', 'Created investigation and remediation actions'],
    'alertDetail.actions_desc': ['从扫描和告警页创建处置动作后，这里会显示执行记录', 'Execution records appear after creating actions from scans and alerts'],

    // devices
    'devices.page_subtitle': ['设备、命令、配置与安全上下文统一查看。', 'Unified view of devices, commands, configurations, and security.'],
    'devices.no_device_desc': ['平台当前运行正常，但该租户尚未注册任何物联网网关。生产模式下不会再注入演示设备，因此这里会真实反映接入现状。', 'Platform running normally, no IoT gateways registered. Demo devices not injected in production.'],
    'devices.online_agents': ['在线智能体', 'Online Agents'],

    // fixHistory
    'fixHistory.page_title': ['修复记录', 'Fix History'],
    'fixHistory.page_subtitle': ['点击按钮进入稳定详情页查看完整记录', 'Click to view complete records in detail'],

    // fixHistoryDetail
    'fixHistoryDetail.task_summary': ['任务摘要', 'Task Summary'],
    'fixHistoryDetail.stats': ['结果统计与剩余工作', 'Result Statistics & Remaining Work'],
    'fixHistoryDetail.remediation': ['修复摘要', 'Remediation Summary'],
    'fixHistoryDetail.remediation_subtitle': ['本次记录关联的风险与修复对象', 'Risks and remediation objects for this record'],
    'fixHistoryDetail.findings': ['关联发现项', 'Related Findings'],

    // scanner extra
    'scanner.no_action_desc': ['当前发现项没有可创建的处置动作。', 'No remediation actions can be created for this finding.'],
    'scanner.action_created': ['已创建处置动作', 'Remediation action created'],
    'scanner.default_task_title': ['待处理修复任务', 'Pending Remediation Task'],
    'scanner.task_created': ['已创建任务 {id}', 'Task created: {id}'],
    'scanner.subtitle_connected': ['统一管理扫描任务、资产证据与处置建议，WebSocket 已连接', 'Manage scans, evidence, and remediation. WebSocket connected'],
    'scanner.subtitle_polling': ['统一管理扫描任务、资产证据与处置建议，当前使用轮询回退', 'Manage scans, evidence, and remediation. Using polling fallback'],
    'scanner.cancel_task': ['取消任务', 'Cancel Task'],
    'scanner.start_scan_btn': ['启动扫描', 'Start Scan'],
    'scanner.findings_total': ['发现总数', 'Total Findings'],
    'scanner.task_history': ['任务历史', 'Task History'],
    'scanner.task_history_subtitle': ['保留原来的历史区块，但支持重新载入完整证据', 'Historical tasks with full evidence reload'],
    'scanner.view_detail': ['查看详情', 'View Details'],
    'scanner.asset_view': ['资产视角', 'Asset View'],
    'scanner.asset_subtitle': ['按目标聚合风险，快速判断优先级', 'Aggregate risks by target for prioritization'],
    'scanner.no_assets': ['暂无资产结果', 'No Asset Results'],
    'scanner.no_assets_desc': ['任务完成后，这里会显示按资产聚合的风险分布。', 'Risk distribution by asset appears after task completion.'],
    'scanner.findings_panel': ['发现列表', 'Findings List'],
    'scanner.findings_panel_subtitle': ['当前任务中所有可追踪的发现项', 'All trackable findings in current task'],
    'scanner.select_finding': ['选择一个发现项', 'Select a Finding'],
    'scanner.select_finding_desc': ['点击左侧发现项后，这里会展开证据与修复建议。', 'Click a finding to view evidence and remediation.'],
    'scanner.finding_status': ['状态', 'Status'],
    'scanner.last_seen': ['最近出现', 'Last Seen'],
    'scanner.timeline_panel': ['任务时间线', 'Task Timeline'],
    'scanner.timeline_subtitle': ['保留实时日志区，但同时展示结构化阶段事件', 'Real-time logs with structured phase events'],
    'scanner.no_logs': ['暂无任务日志。', 'No task logs.'],
    'scanner.no_timeline': ['暂无结构化时间线。', 'No structured timeline.'],
    'scanner.enter_phase': ['进入阶段', 'Entering phase'],
    'scanner.target': ['目标', 'Target'],
    'scanner.one_per_line': ['每行一个', 'One per line'],
    'scanner.current_task_subtitle': ['最近一次加载或执行的扫描任务', 'Most recently loaded or executed scan task'],
    'scanner.realtime_phase': ['实时阶段与任务状态', 'Real-time Phase & Status'],
    'scanner.phase_progress': ['任务阶段推进情况', 'Task phase progress'],

    // scannerRunDetail
    'scannerRunDetail.page_subtitle': ['查看任务 {id} 的阶段、证据与修复建议', 'View task {id} phases, evidence, and remediation'],

    // siteDetail
    'siteDetail.status': ['状态', 'Status'],
    'siteDetail.target': ['目标', 'Target'],
    'siteDetail.risk_score': ['风险分', 'Risk Score'],

    // trafficInterceptor
    'trafficInterceptor.processed_packets': ['累计处理报文数', 'Total Packets Processed'],
    'trafficInterceptor.passed': ['已通过检测链路', 'Passed Detection'],
    'trafficInterceptor.blocked': ['已被主动拦截', 'Actively Blocked'],
    'trafficInterceptor.deep_inspected': ['已完成深度检查', 'Deep Inspection Done'],
    'trafficInterceptor.throughput': ['累计吞吐量', 'Total Throughput'],
    'trafficInterceptor.uptime': ['拦截器持续运行时长', 'Interceptor Uptime'],
    'trafficInterceptor.no_active': ['当前没有可供查看的活动连接', 'No active connections to display'],

    // trafficSessionDetail
    'trafficSessionDetail.page_subtitle': ['查看会话 {id} 的上下文、元数据与时间线', 'View session {id} context, metadata, and timeline'],

    // attackSimulator
    'attackSimulator.start': ['开始演练', 'Start Drill'],
    'attackSimulator.start_attack': ['开始执行攻击', 'Execute Attack'],
    'attackSimulator.drill_failed': ['演练失败', 'Drill Failed'],
    'attackSimulator.no_results': ['未返回结果数据', 'No result data returned'],
    'attackSimulator.attacks_count': ['项攻击', 'attacks'],
    'attackSimulator.log_stream': ['执行日志流', 'Execution Log Stream'],
    'attackSimulator.terminal': ['终端输出', 'Terminal Output'],
    'attackSimulator.view_detail': ['查看详情', 'View Details'],

    // deploymentWizard
    'deploymentWizard.generate_failed': ['生成配置失败', 'Configuration generation failed'],
    'deploymentWizard.save_failed': ['保存部署配置失败', 'Failed to save deployment config'],
    'deploymentWizard.checksum': ['校验和', 'Checksum'],

    // adminUsers
    'adminUsers.audit': ['监察', 'Audit'],

    // boardStatus
    'board.recent': ['最近', 'Recent'],
};

let added = 0;
for (const [key, [zhVal, enVal]] of Object.entries(K)) {
    const parts = key.split('.');
    let zhObj = zh, enObj = en;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!zhObj[parts[i]]) zhObj[parts[i]] = {};
        if (!enObj[parts[i]]) enObj[parts[i]] = {};
        zhObj = zhObj[parts[i]];
        enObj = enObj[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    if (!zhObj[lastKey]) { zhObj[lastKey] = zhVal; added++; }
    if (!enObj[lastKey]) { enObj[lastKey] = enVal; added++; }
}

writeJson('zh.json', zh);
writeJson('en.json', en);
console.log(`Added ${added} locale keys!`);
