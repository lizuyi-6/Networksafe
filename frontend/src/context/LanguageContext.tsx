import { createContext, useState, useContext, ReactNode } from 'react';

type Language = 'en' | 'zh';

interface LanguageContextType {
    language: Language;
    toggleLanguage: () => void;
    t: (key: string) => string;
}

const translations: Record<string, Record<Language, string>> = {
    // Sidebar
    'nav.dashboard': { en: 'Dashboard', zh: '控制台' },
    'nav.scanner': { en: 'Scanner', zh: '安全扫描' },
    'nav.sites': { en: 'Sites', zh: '站点管理' },
    'nav.deployment': { en: 'Deployment', zh: '部署向导' },
    'nav.history': { en: 'Fix History', zh: '修复记录' },
    'nav.settings': { en: 'Settings', zh: '系统设置' },
    'nav.admin': { en: 'Super Admin', zh: '超级管理员' },
    'app.title': { en: 'FluxGuard', zh: 'FluxGuard' },
    'app.protected': { en: 'PROTECTED', zh: '已防护' },

    // Dashboard
    'dashboard.title': { en: 'Security Dashboard', zh: '安全控制台' },
    'dashboard.subtitle': { en: 'Real-time system monitoring', zh: '实时系统监控' },
    'dashboard.system_online': { en: 'SYSTEM ONLINE', zh: '系统在线' },
    'dashboard.total_requests': { en: 'Total Requests', zh: '总请求数' },
    'dashboard.threats_blocked': { en: 'Threats Blocked', zh: '拦截威胁' },
    'dashboard.active_connections': { en: 'Active Connections', zh: '活跃连接' },
    'dashboard.success_rate': { en: 'Success Rate', zh: '成功率' },
    'dashboard.traffic_overview': { en: 'Traffic Overview', zh: '流量概览' },
    'dashboard.threat_distribution': { en: 'Threat Distribution', zh: '威胁分布' },
    'dashboard.recent_alerts': { en: 'Recent Alerts', zh: '近期警报' },
    'dashboard.system_status': { en: 'System Status', zh: '系统状态' },
    'dashboard.cpu_usage': { en: 'CPU Usage', zh: 'CPU 使用率' },
    'dashboard.memory_usage': { en: 'Memory Usage', zh: '内存使用率' },

    // Scanner
    'scanner.title': { en: 'Security Configuration Scanner', zh: '安全配置扫描器' },
    'scanner.subtitle': { en: 'Automated vulnerability assessment', zh: '自动化漏洞评估' },
    'scanner.ready_title': { en: 'Ready to Scan', zh: '准备扫描' },
    'scanner.ready_desc': { en: 'Start a comprehensive scan to identify misconfigurations and security loopholes in your API implementation.', zh: '开始全面扫描，识别 API 实现中的配置错误和安全漏洞。' },
    'scanner.start_btn': { en: 'Start Security Scan', zh: '开始安全扫描' },
    'scanner.scanning': { en: 'Scanning system...', zh: '正在扫描系统...' },
    'scanner.complete_title': { en: 'Scan Completed', zh: '扫描完成' },
    'scanner.complete_desc': { en: 'Scan finished. Found', zh: '扫描结束。发现' },
    'scanner.issues': { en: 'potential issues.', zh: '个潜在问题。' },
    'scanner.new_scan_btn': { en: 'Run New Scan', zh: '运行新扫描' },
    'scanner.results_title': { en: 'Scan Results', zh: '扫描结果' },
    'scanner.no_vulns': { en: 'No vulnerabilities detected yet.', zh: '尚未检测到漏洞。' },
    'scanner.secure_title': { en: 'System Secure', zh: '系统安全' },
    'scanner.secure_desc': { en: 'No threats found.', zh: '未发现威胁。' },

    // Sites
    'sites.title': { en: 'Site Management', zh: '站点管理' },
    'sites.protected_domains': { en: 'Protected Domains', zh: '受保护的域名' },
    'sites.no_sites': { en: 'No sites found.', zh: '未找到站点。' },

    // Deployment
    'deploy.title': { en: 'Deployment Wizard', zh: '部署向导' },
    'deploy.step1': { en: 'Select Server', zh: '选择服务器' },
    'deploy.step2': { en: 'Configuration', zh: '配置参数' },
    'deploy.step3': { en: 'Download', zh: '下载配置' },
    'deploy.select_server': { en: 'Select Your Web Server', zh: '选择您的 Web 服务器' },
    'deploy.configure_middleware': { en: 'Configure Middleware', zh: '配置中间件' },
    'deploy.listen_port': { en: 'Listen Port', zh: '监听端口' },
    'deploy.server_name': { en: 'Server Name', zh: '服务器名称' },
    'deploy.rate_limit': { en: 'Rate Limit (Req/Min)', zh: '速率限制 (次/分钟)' },
    'deploy.config_ready': { en: 'Configuration Ready', zh: '配置已就绪' },
    'deploy.config_desc': { en: 'Copy the configuration below or download the file.', zh: '复制以下配置或下载文件。' },
    'deploy.back': { en: 'Back', zh: '上一步' },
    'deploy.next': { en: 'Next Step', zh: '下一步' },
    'deploy.download': { en: 'Download Config', zh: '下载配置' },

    // Fix History
    'history.title': { en: 'Fix History', zh: '修复记录' },
    'history.desc': { en: 'History of fixes applied.', zh: '已应用修复的历史记录。' },

    // Settings
    'settings.title': { en: 'System Settings', zh: '系统设置' },
    'settings.desc': { en: 'System configuration settings.', zh: '系统配置设置。' },

    // Super Admin
    'admin.title': { en: 'Super Admin Console', zh: '超级管理员控制台' },
    'admin.server_cpu': { en: 'Control Server CPU', zh: '控制服务器 CPU' },
    'admin.memory': { en: 'Memory Usage', zh: '内存使用率' },
    'admin.active_agents': { en: 'Active Agents', zh: '活跃 Agent' },
    'admin.recent_errors': { en: 'Recent User Errors', zh: '近期用户错误' },
    'admin.client_perf': { en: 'Client Performance Overhead', zh: '客户端性能开销' },

    // New Design Elements
    'nav.platform': { en: 'Platform', zh: '平台' },
    'nav.governance': { en: 'Governance', zh: '治理' },
    'nav.monitoring': { en: 'Monitoring', zh: '监控' },
    'nav.keys': { en: 'API Keys', zh: 'API 密钥' },
    'nav.audit': { en: 'Audit Logs', zh: '审计日志' },
    'nav.alerts': { en: 'Alerts', zh: '警报' },

    'header.overview': { en: 'Overview', zh: '概览' },
    'header.system_healthy': { en: 'System Healthy', zh: '系统健康' },
    'header.live': { en: 'Live', zh: '实时' },

    'dashboard.avg_latency': { en: 'Avg Latency', zh: '平均延迟' },
    'dashboard.global_health': { en: 'Global Health', zh: '全局健康' },
    'dashboard.traffic_analysis': { en: 'Traffic Analysis', zh: '流量分析' },
    'dashboard.requests_per_second': { en: 'Requests / Second', zh: '请求/秒' },
    'dashboard.blocked_request': { en: 'Blocked Request', zh: '已拦截请求' },
    'dashboard.attack_origin': { en: 'Attack Origin', zh: '攻击来源' },
    'dashboard.top_vectors': { en: 'Top Vectors', zh: '主要攻击向量' },
    'dashboard.live_log_stream': { en: 'Live Log Stream', zh: '实时日志流' },
    'dashboard.waiting_for_logs': { en: 'Waiting for logs...', zh: '等待日志...' },
    'dashboard.active_rules': { en: 'Active Rules', zh: '活跃规则' },
    'dashboard.rule_sql_injection': { en: 'Block SQL Injection', zh: '拦截 SQL 注入' },
    'dashboard.rule_xss': { en: 'Block XSS Scripts', zh: '拦截 XSS 脚本' },
    'dashboard.rule_ddos': { en: 'DDoS Mitigation', zh: 'DDoS 缓解' },
    'dashboard.quick_api_key': { en: 'Quick API Key', zh: '快速 API 密钥' },
    'dashboard.generate_key': { en: 'Generate Key', zh: '生成密钥' },
    'dashboard.manage_keys': { en: 'Manage Keys', zh: '管理密钥' },

    // Alerts Page
    'alerts.subtitle': { en: 'Real-time security and system notifications', zh: '实时安全与系统通知' },
    'alerts.filter_all': { en: 'All', zh: '全部' },
    'alerts.filter_critical': { en: 'Critical', zh: '严重' },
    'alerts.filter_high': { en: 'High', zh: '高危' },
    'alerts.filter_medium': { en: 'Medium', zh: '中等' },
    'alerts.no_alerts': { en: 'No active alerts matching your filter.', zh: '没有匹配的活跃警报。' },
    'alerts.source': { en: 'Source', zh: '来源' },
    'alerts.id': { en: 'ID', zh: '编号' },
    'alerts.status_active': { en: 'Active', zh: '活跃' },
    'alerts.loading': { en: 'Loading alerts...', zh: '正在加载警报...' },

    // Admin / API Keys
    'admin.loading': { en: 'Loading...', zh: '加载中...' },
    'admin.unavailable': { en: 'System data unavailable in this mode.', zh: '当前模式下系统数据不可用。' },
    'admin.api_keys_title': { en: 'API Keys', zh: 'API 密钥' },
    'admin.create_key': { en: 'Create New Key', zh: '创建新密钥' },
    'admin.key_created': { en: 'Created', zh: '创建于' },
    'admin.key_last_used': { en: 'Last used', zh: '上次使用' },
    'admin.table_user': { en: 'User ID', zh: '用户 ID' },
    'admin.table_code': { en: 'Error Code', zh: '错误代码' },
    'admin.table_msg': { en: 'Message', zh: '消息' },
    'admin.table_time': { en: 'Time', zh: '时间' },
    'admin.avg_cpu': { en: 'Avg CPU Overhead', zh: '平均 CPU 开销' },
    'admin.low_impact': { en: 'Low Impact', zh: '低影响' },
    'admin.avg_latency': { en: 'Avg Added Latency', zh: '平均增加延迟' },
    'admin.negligible': { en: 'Negligible', zh: '可忽略' },
    'admin.clients_summary': { en: 'Active Clients Summary', zh: '活跃客户端汇总' },
    'admin.connected_agents': { en: 'Connected Agents', zh: '已连接 Agent' },

    // Board Status
    'board.device_id': { en: 'DEVICE ID', zh: '设备 ID' },
    'board.unknown': { en: 'UNKNOWN', zh: '未知' },
    'board.system_nominal': { en: 'System Nominal', zh: '系统正常' },
    'board.admin_console': { en: 'Admin Console', zh: '管理控制台' },
    'board.security_level': { en: 'Security Level', zh: '安全等级' },
    'board.topology': { en: 'Server Topology', zh: '服务器拓扑' },
    'board.live_map': { en: 'LIVE MAP', zh: '实时地图' },
    'board.optimal': { en: 'OPTIMAL', zh: '正常' },
    'board.warn': { en: 'WARN', zh: '警告' },
    'board.load_balance': { en: 'Load Balance', zh: '负载均衡' },
    'board.core_temp': { en: 'Core Temp', zh: '核心温度' },
    'board.active_threads': { en: 'Active Threads', zh: '活跃线程' },
    'board.vs_avg': { en: '+12% vs avg', zh: '+12% 同比' },
    'board.physical_breaker': { en: 'Physical Breaker', zh: '物理断路器' },
    'board.emergency_desc': { en: 'EMERGENCY HARDWARE DISCONNECT', zh: '紧急硬件断开装置' },
    'board.bridge_connected': { en: 'BRIDGE CONNECTED', zh: '网桥已连通' },
    'board.bridge_disconnected': { en: 'DISCONNECTED', zh: '网桥已断开' },
    'board.event_stream': { en: 'Event Stream', zh: '事件流' },
    'board.tailing': { en: 'TAILING -F', zh: '实时追踪 -F' },
    'board.buffer': { en: 'BUFFER', zh: '缓冲区' },
    'board.encryption': { en: 'ENCRYPTION', zh: '加密' },
    'board.systemd_init': { en: 'Systemd initialized', zh: 'Systemd 已初始化' },
    'board.service_pid': { en: 'FluxGuard Service v4.2.1 [PID 4092]', zh: 'FluxGuard 服务 v4.2.1 [PID 4092]' },
    'board.status_locked': { en: 'ARMED', zh: '已锁定' },
    'board.status_disengage': { en: 'DISENGAGE', zh: '已脱离' },
    'board.log_init': { en: 'Initializing hardware handshake protocol...', zh: '正在初始化硬件握手协议...' },
    'board.log_handshake': { en: 'ESP32 Cryptographic Handshake >> NODE_A04', zh: 'ESP32 加密握手 >> NODE_A04' },
    'board.log_token': { en: 'Token verification: SUCCESS (2ms)', zh: '令牌验证: 成功 (2ms)' },
    'board.log_check': { en: 'Routine integrity check started', zh: '开始常规完整性检查' },
    'board.log_warn': { en: 'WARN: Minor voltage fluctuation in Rack 4', zh: '警告: 机架 4 电压微小波动' },
    'board.log_stabilized': { en: 'Auto-compensator engaged. Stabilized.', zh: '自动补偿器已启动。已稳定。' },
    'board.log_poll': { en: 'Physical Bridge poll: ARMED', zh: '物理网桥轮询: 已连通' },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguage] = useState<Language>('en');

    const toggleLanguage = () => {
        setLanguage(prev => prev === 'en' ? 'zh' : 'en');
    };

    const t = (key: string): string => {
        const translation = translations[key];
        if (!translation) return key;
        return translation[language];
    };

    return (
        <LanguageContext.Provider value={{ language, toggleLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
