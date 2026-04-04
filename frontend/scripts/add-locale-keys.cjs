const fs = require('fs');
const en = JSON.parse(fs.readFileSync('src/locales/en.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('src/locales/zh.json', 'utf8'));

// Scanner keys
en.scanner = en.scanner || {};
zh.scanner = zh.scanner || {};
const scannerKeys = {
    status_idle: ['Idle', '空闲'],
    status_pending: ['Pending', '排队中'],
    status_running: ['Running', '执行中'],
    status_completed: ['Completed', '已完成'],
    status_failed: ['Failed', '失败'],
    status_cancelled: ['Cancelled', '已取消'],
    phase_queued: ['Queued', '等待执行'],
    phase_url_scan: ['URL Scan', 'Web 指纹与 TLS'],
    phase_host_scan: ['Host Scan', '主机与服务'],
    phase_nuclei_scan: ['Nuclei Scan', '模板验证'],
    phase_finalizing: ['Finalizing', '结果归档'],
    phase_done: ['Done', '已结束'],
    task_started: ['Scan task started', '扫描任务已启动'],
    task_log_received: ['Received task log', '收到任务日志'],
    task_completed: ['Scan task completed', '扫描任务已完成'],
    task_failed: ['Scan failed', '扫描失败'],
    task_cancelled: ['Scan task cancelled', '扫描任务已取消'],
    create_failed: ['Failed to create scan task', '创建扫描任务失败'],
    title: ['Scanner', '扫描中心'],
    subtitle: ['Scan history, live logs, and findings', '查看扫描历史、实时日志与安全发现'],
    scan_input: ['Scan Input', '扫描输入'],
    scan_input_subtitle: ['Configure target URL, host range, or select predefined scan profiles', '配置扫描目标 URL、主机范围，或选择预设扫描配置'],
    local_scope: ['Local Scope', '本机扫描范围'],
    baseline: ['System Baseline', '系统基线与主机状态'],
    web_fingerprint: ['Web Fingerprint', 'Web 服务指纹与配置'],
    no_tasks: ['No scan tasks', '暂无扫描任务'],
    no_tasks_desc: ['Start a scan to discover vulnerabilities in your infrastructure', '启动扫描以发现基础设施中的漏洞'],
    findings: ['Findings', '发现列表'],
    no_findings: ['No findings', '暂无发现项'],
    start_scan: ['Start Scan', '启动扫描'],
    export: ['Export', '导出'],
    export_view: ['Exported current view', '已导出当前视图'],
};
for (const [key, [enVal, zhVal]] of Object.entries(scannerKeys)) {
    en.scanner[key] = enVal;
    zh.scanner[key] = zhVal;
}

// Dashboard keys
en.dashboard = en.dashboard || {};
zh.dashboard = zh.dashboard || {};
const dashboardKeys = {
    title: ['Security Console', '安全控制台'],
    subtitle: ['Unified monitoring, rules, logs, and operational summary', '统一监控、规则、日志与运营摘要'],
    total_requests: ['Total Requests', '总请求数'],
    threats_blocked: ['Threats Blocked', '拦截威胁'],
    avg_latency: ['Avg Latency', '平均延迟'],
    global_health: ['Global Health', '全局健康'],
    cpu_usage: ['CPU Usage', 'CPU 使用率'],
    memory_usage: ['Memory Usage', '内存占用'],
    disk_usage: ['Disk Usage', '磁盘占用'],
    network_throughput: ['Network Throughput', '网络吞吐'],
    high_risk: ['High Risk', '高危发现'],
    active_alerts: ['Active Alerts', '活跃告警'],
    scan_tasks: ['Scan Tasks', '扫描任务'],
    observed_sessions: ['Observed Sessions', '观测会话'],
    traffic_analysis: ['Traffic Analysis', '流量分析'],
    traffic_subtitle: ['Requests and blocking trends by time window', '按时间窗口查看请求与拦截趋势'],
    attack_sources: ['Attack Sources', '攻击来源'],
    attack_sources_subtitle: ['Recent source distribution by region', '按地区聚合的最近来源分布'],
    real_time_logs: ['Real-time Logs', '实时日志流'],
    logs_subtitle: ['Live log stream from the security pipeline', '来自安全流水线的实时日志流'],
    time_1h: ['1 Hour', '1 小时'],
    time_24h: ['24 Hours', '24 小时'],
    no_sessions: ['No sessions observed recently', '暂无会话可展示'],
    no_anomalies: ['No anomalies detected recently', '暂无异常流量特征'],
    no_attack_sources: ['No attack sources detected', '暂无攻击来源数据'],
    health_good: ['System Healthy', '系统健康'],
    health_stable: ['Running Stable', '运行稳定'],
    health_warning: ['Needs Attention', '需要重点关注'],
    scale: ['Overall traffic processing scale', '整体流量处理规模'],
    recent_events: ['Recent blocking events', '近期拦截事件累计'],
    p99_latency: ['P99 Latency', 'P99 延迟'],
    host_cpu: ['Host CPU', '主机 CPU'],
    system_memory: ['System Memory', '系统内存'],
    root_partition: ['Root Partition', '根分区使用率'],
    real_time_io: ['Real-time I/O', '实时 I/O 吞吐量'],
    high_risk_total: ['High Risk Total', '高风险总数'],
    pending_actions: ['Pending Actions', '待处理动作'],
    queued_tasks: ['Queued', '排队中'],
    anomaly_traffic: ['Anomalous Traffic', '异常流量'],
    recent_actions: ['Recent Actions', '最近运营动作'],
};
for (const [key, [enVal, zhVal]] of Object.entries(dashboardKeys)) {
    en.dashboard[key] = enVal;
    zh.dashboard[key] = zhVal;
}

// Agents keys
en.agents = en.agents || {};
zh.agents = zh.agents || {};
const agentsKeys = {
    title: ['Agents', '智能体'],
    subtitle: ['Monitor and manage agent nodes', '统一监控和管理所有智能体节点'],
    refresh: ['Refresh', '刷新'],
    total_agents: ['Total Agents', '总智能体'],
    online_nodes: ['Online Nodes', '在线节点'],
    recent_threats: ['Recent Threats', '近期威胁'],
    online_rate: ['Online Rate', '在线率'],
    initiate_scan: ['Initiate Scan', '发起扫描'],
    day: ['d', '天'],
    hour: ['h', '小时'],
    minute: ['m', '分钟'],
    loading: ['Loading...', '加载中...'],
    no_agents: ['No agent nodes', '暂无智能体节点'],
    no_agents_desc: ['Register new agents to start monitoring', '注册新节点以开始监控'],
};
for (const [key, [enVal, zhVal]] of Object.entries(agentsKeys)) {
    en.agents[key] = enVal;
    zh.agents[key] = zhVal;
}

// AlertDetail keys
en.alertDetail = en.alertDetail || {};
zh.alertDetail = zh.alertDetail || {};
const alertDetailKeys = {
    title: ['Alert Detail', '告警详情'],
    subtitle: ['Detailed view of the selected alert', '查看所选告警的详细信息和上下文'],
    back: ['Back to Alerts', '返回告警中心'],
    loading: ['Loading alert detail...', '正在加载告警详情'],
    severity_level: ['Severity Level', '严重级别'],
    status: ['Status', '状态'],
    source: ['Source', '来源'],
    time: ['Time', '时间'],
    evidence: ['Evidence and Related Scans', '证据与关联扫描'],
    no_evidence: ['No structured evidence', '暂无结构化证据'],
    timeline: ['Timeline', '时间线'],
    no_timeline: ['No timeline events', '暂无时间线事件'],
    related_actions: ['Related Actions', '关联动作'],
    no_actions: ['No related actions', '暂无关联动作'],
};
for (const [key, [enVal, zhVal]] of Object.entries(alertDetailKeys)) {
    en.alertDetail[key] = enVal;
    zh.alertDetail[key] = zhVal;
}

// FixHistory keys
en.fixHistory = en.fixHistory || {};
zh.fixHistory = zh.fixHistory || {};
const fixHistoryKeys = {
    title: ['Fix History', '修复历史'],
    subtitle: ['View and track AI self-fix operations', '查看和管理所有 AI 自修复操作记录'],
    loading: ['Loading history...', '正在加载历史记录'],
    no_records: ['No history records', '当前没有可展示的历史记录'],
    view_detail: ['View Detail', '查看详情'],
};
for (const [key, [enVal, zhVal]] of Object.entries(fixHistoryKeys)) {
    en.fixHistory[key] = enVal;
    zh.fixHistory[key] = zhVal;
}

// FixHistoryDetail keys
en.fixHistoryDetail = en.fixHistoryDetail || {};
zh.fixHistoryDetail = zh.fixHistoryDetail || {};
const fixDetailKeys = {
    title: ['Fix Record Detail', '修复记录详情'],
    back: ['Back to Fix History', '返回修复历史'],
    loading: ['Loading fix record...', '正在加载修复记录'],
    status: ['Status', '状态'],
    phase: ['Phase', '阶段'],
    progress: ['Progress', '进度'],
    error: ['Error', '错误'],
    none: ['None', '无'],
    summary: ['Fix Summary', '修复摘要'],
    findings: ['Findings', '发现项'],
    no_findings: ['No related findings', '暂无关联发现项'],
};
for (const [key, [enVal, zhVal]] of Object.entries(fixDetailKeys)) {
    en.fixHistoryDetail[key] = enVal;
    zh.fixHistoryDetail[key] = zhVal;
}

// Devices keys
en.devices = en.devices || {};
zh.devices = zh.devices || {};
const devicesKeys = {
    subtitle: ['Unified view of devices, commands, configuration, and security context', '设备、命令、配置与安全上下文统一查看'],
    active_alerts: ['Active Alerts', '活跃告警'],
    running_scans: ['Running Scans', '进行中扫描'],
    recheck: ['Recheck Access Status', '重新检查接入状态'],
};
for (const [key, [enVal, zhVal]] of Object.entries(devicesKeys)) {
    en.devices[key] = enVal;
    zh.devices[key] = zhVal;
}

// AgentMonitor keys
en.agentMonitor = en.agentMonitor || {};
zh.agentMonitor = zh.agentMonitor || {};
const agentMonitorKeys = {
    active_alerts: ['Active Alerts', '活跃告警'],
    running_scans: ['Running Scans', '进行中扫描'],
};
for (const [key, [enVal, zhVal]] of Object.entries(agentMonitorKeys)) {
    en.agentMonitor[key] = enVal;
    zh.agentMonitor[key] = zhVal;
}

// AgentDetail keys
en.agentDetail = en.agentDetail || {};
zh.agentDetail = zh.agentDetail || {};
const agentDetailKeys = {
    recent_threats: ['Recent Threats and Tasks', '最近威胁与任务'],
    no_threats: ['No related threats', '暂无关联威胁'],
    status_timeline: ['Status Timeline', '状态时间线'],
};
for (const [key, [enVal, zhVal]] of Object.entries(agentDetailKeys)) {
    en.agentDetail[key] = enVal;
    zh.agentDetail[key] = zhVal;
}

// App keys
en.app = en.app || {};
zh.app = zh.app || {};
const appKeys = {
    role_not_set: ['Role not set', '未设置角色'],
    unnamed_user: ['Unnamed User', '未命名用户'],
    chinese: ['Chinese', '中文'],
};
for (const [key, [enVal, zhVal]] of Object.entries(appKeys)) {
    en.app[key] = enVal;
    zh.app[key] = zhVal;
}

// DeploymentWizard keys
en.deploy = en.deploy || {};
zh.deploy = zh.deploy || {};
const deployKeys = {
    title: ['Deployment Wizard', '部署向导'],
    subtitle: ['Deploy ESP32 gateway', '部署 ESP32 网关'],
    step1: ['Step 1', '步骤一'],
    step2: ['Step 2', '步骤二'],
    step3: ['Step 3', '步骤三'],
    select_server: ['Select gateway base', '选择网关基座'],
    configure_middleware: ['Configure middleware parameters', '配置中间件参数'],
    listen_port: ['Listen port', '监听端口'],
    server_name: ['Domain', '绑定业务域名'],
    rate_limit: ['Rate limit (REQ/s)', 'CC 限流阈值 (REQ/s)'],
    config_ready: ['Deployment config compiled successfully!', '部署配置下发编译成功！'],
    config_desc: ['Apply this config and start the local gateway, or download the firmware', '下发此配置并在本地网关服务器拉起，或直接下载固件执行'],
    back: ['Back', '上一步'],
    next: ['Next', '下一步'],
    download: ['Download', '下载'],
};
for (const [key, [enVal, zhVal]] of Object.entries(deployKeys)) {
    en.deploy[key] = enVal;
    zh.deploy[key] = zhVal;
}

// TrafficInterceptor extra keys
const trafficExtra = {
    hint_passed: ['Passed detection pipeline', '已通过检测链路'],
};
for (const [key, [enVal, zhVal]] of Object.entries(trafficExtra)) {
    en.trafficInterceptor[key] = enVal;
    zh.trafficInterceptor[key] = zhVal;
}

// Status line labels (shared)
en.common = en.common || {};
zh.common = zh.common || {};
const commonKeys = {
    status: ['Status', '状态'],
    phase: ['Phase', '阶段'],
    progress: ['Progress', '进度'],
    error: ['Error', '错误'],
    none: ['None', '无'],
    no: ['No', '否'],
    yes: ['Yes', '是'],
    recent_occurrences: ['Recent Occurrences', '最近出现'],
    source: ['Source', '来源'],
    destination: ['Destination', '目标'],
    packets: ['Packets', '报文'],
    bytes: ['Bytes', '字节'],
    last_seen: ['Last Seen', '最近出现'],
    back: ['Back', '返回'],
    detail: ['Detail', '详情'],
    loading: ['Loading...', '加载中...'],
};
for (const [key, [enVal, zhVal]] of Object.entries(commonKeys)) {
    en.common[key] = enVal;
    zh.common[key] = zhVal;
}

fs.writeFileSync('src/locales/en.json', JSON.stringify(en, null, 4) + '\n', 'utf8');
fs.writeFileSync('src/locales/zh.json', JSON.stringify(zh, null, 2) + '\n', 'utf8');
console.log('All locale keys added!');
