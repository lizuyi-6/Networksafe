import type {
    AttackSimulationReport,
    AttackType,
    DashboardStats,
    FlowInfo,
    LogItem,
    MultiAgentSystemStats,
    ScanAssetGroup,
    SecurityFinding,
    TrafficStats
} from '../types/api';

type AlertItem = {
    id: string;
    title: string;
    message: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    type: 'security' | 'performance' | 'system';
    source: string;
    time: string;
    status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed';
    timestamp: string;
};

type DemoSite = {
    id: string;
    domain: string;
    target: string;
    status: 'secure' | 'monitoring';
};

type DemoRule = {
    id: string;
    name: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    count: number;
    enabled: boolean;
};

type DemoAIEndpoint = {
    id: string;
    name: string;
    url: string;
    modelName: string;
    apiKey: string;
    enabled: boolean;
    priority: number;
    timeout: number;
    type: 'ollama' | 'openai' | 'custom';
    lastTest?: {
        success: boolean;
        latency: number;
        timestamp: string;
    };
};

type DemoAdminUser = {
    id: string;
    email: string;
    role: 'admin' | 'tenant' | 'viewer';
    plan: 'starter' | 'pro' | 'ultra';
    tenant_id: string;
    status: 'active' | 'suspended';
    last_login: string | null;
};

type DemoOnboardingCode = {
    id: string;
    status: 'active' | 'used' | 'expired' | 'revoked';
    expectedHostname: string | null;
    maxUses: number;
    usedCount: number;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    usedByAgentId: string | null;
};

type DemoRegisteredAgent = {
    agentId: string;
    hostname: string;
    platform: string;
    status: 'pending' | 'approved' | 'revoked';
    createdAt: string;
    lastSeenAt?: string;
};

type DemoDeploymentHistoryRow = {
    id: string;
    name: string;
    version: string;
    server_type: 'nginx' | 'apache';
    checksum: string;
    created_at: string;
};

type DemoScanTaskFinding = {
    target: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    sourceEngine: string;
    createdAt: string;
};

type DemoScanTask = {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    phase: string;
    progress: number;
    error: string | null;
    createdAt: string;
    completedAt?: string;
    urlFindings: DemoScanTaskFinding[];
    hostFindings: DemoScanTaskFinding[];
    nucleiFindings: DemoScanTaskFinding[];
};

const normalizeDemoScanTaskFindings = (task: DemoScanTask): SecurityFinding[] => {
    const merged = [...task.urlFindings, ...task.hostFindings, ...task.nucleiFindings];
    return merged.map((finding, index) => ({
        findingId: `${task.id}-legacy-${index}`,
        assetId: undefined,
        sourceType: 'scanner',
        sourceRef: task.id,
        target: finding.target,
        category: finding.sourceEngine,
        severity: finding.severity,
        status: 'open',
        title: finding.title,
        description: finding.description,
        evidence: {
            sourceEngine: finding.sourceEngine,
            target: finding.target
        },
        remediation: {
            recommendation: `Review ${finding.sourceEngine} evidence for ${finding.target} and confirm whether mitigation is required.`
        },
        occurrenceCount: 1,
        firstSeenAt: finding.createdAt,
        lastSeenAt: finding.createdAt
    }));
};

const buildDemoScanAssetGroups = (findings: SecurityFinding[]): ScanAssetGroup[] => (
    findings.reduce<ScanAssetGroup[]>((groups, finding) => {
        const existing = groups.find((group) => group.target === finding.target && group.category === finding.category);
        if (existing) {
            existing.findings.push(finding);
            existing.severities[finding.severity] = (existing.severities[finding.severity] || 0) + 1;
            return groups;
        }

        groups.push({
            assetId: finding.assetId,
            target: finding.target,
            category: finding.category,
            findings: [finding],
            severities: { [finding.severity]: 1 }
        });
        return groups;
    }, [])
);

type DemoAgent = {
    agentId: string;
    hostname: string;
    platform: string;
    isOnline: boolean;
    lastHeartbeat: string;
    status: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
    };
    registration: {
        arch: string;
        cpus: number;
        totalMemory: number;
        version: string;
    };
};

type DemoDevice = {
    deviceId: string;
    version: string;
    chipModel: string;
    flashSize: number;
    freeHeap: number;
    sdkVersion: string;
    mode: 'online' | 'offline';
    isOnline: boolean;
    lastHeartbeat: string;
    connectedAgents: string[];
    status: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
        wifiRssi: number;
    };
    systemInfo: {
        hostname: string;
        os: string;
        kernel: string;
        arch: string;
    };
    config?: DemoDeviceConfig;
    latestCommand?: DemoDeviceCommand | null;
};

type DemoDeviceEvent = {
    id: string;
    deviceId: string;
    type: string;
    payload: Record<string, unknown>;
    timestamp: string;
};

type DemoDeviceConfig = {
    displayName: string;
    group: string;
    site: string;
    networkProfile: string;
    scanProfile: string;
    notes: string;
    commandPermissions: string[];
    tags: string[];
    updatedAt: string;
};

type DemoDeviceCommand = {
    id: string;
    deviceId: string;
    command: string;
    status: 'queued' | 'completed' | 'failed';
    message: string;
    executedBy: string;
    createdAt: string;
    completedAt?: string;
    params?: Record<string, unknown>;
};

type DemoFixHistoryItem = {
    id: string;
    status: string;
    phase: string;
    progress: number;
    createdAt: string;
    completedAt?: string;
};

type DemoFixHistoryDetail = DemoFixHistoryItem & {
    error: string | null;
    summary: Record<string, unknown>;
    startedAt?: string;
    findings: Array<{
        target_type: string;
        target: string;
        severity: string;
        title: string;
        description: string;
        source_engine: string;
        created_at: string;
    }>;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const timestampMinutesAgo = (minutesAgo: number): string =>
    new Date(Date.now() - minutesAgo * 60_000).toISOString();

const timeLabel = (minutesAgo: number): string => {
    if (minutesAgo <= 0) return 'Just now';
    if (minutesAgo < 60) return `${minutesAgo} mins ago`;
    const hours = Math.floor(minutesAgo / 60);
    if (hours < 24) return `${hours} hours ago`;
    return `${Math.floor(hours / 24)} days ago`;
};

const demoRules: DemoRule[] = [
    { id: 'sig-sqli', name: 'SQLi Multi-Vector Detection', severity: 'critical', count: 184, enabled: true },
    { id: 'sig-xss', name: 'Reflected XSS Guard', severity: 'high', count: 96, enabled: true },
    { id: 'sig-bot', name: 'Credential Stuffing Heuristic', severity: 'high', count: 71, enabled: true },
    { id: 'sig-ssrf', name: 'Metadata SSRF Shield', severity: 'critical', count: 42, enabled: true },
    { id: 'sig-ratelimit', name: 'Burst Abuse Rate Control', severity: 'medium', count: 29, enabled: true },
    { id: 'sig-upload', name: 'Malicious Upload Screening', severity: 'medium', count: 17, enabled: true }
];

const makeId = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const demoAIEndpointsBase: DemoAIEndpoint[] = [
    {
        id: 'ai-demo-1',
        name: 'Primary Ollama',
        url: 'http://demo-ollama.internal:11434',
        modelName: 'llama3:8b',
        apiKey: '',
        enabled: true,
        priority: 10,
        timeout: 30_000,
        type: 'ollama',
        lastTest: { success: true, latency: 182, timestamp: timestampMinutesAgo(8) }
    },
    {
        id: 'ai-demo-2',
        name: 'Fallback Qwen Gateway',
        url: 'https://demo-qwen-gateway.internal/v1',
        modelName: 'qwen3-max',
        apiKey: 'demo_key_hidden',
        enabled: true,
        priority: 20,
        timeout: 45_000,
        type: 'openai',
        lastTest: { success: true, latency: 426, timestamp: timestampMinutesAgo(17) }
    }
];

const demoAdminUsersBase: DemoAdminUser[] = [
    { id: 'usr-demo-001', email: 'admin@demo.local', role: 'admin', plan: 'ultra', tenant_id: 'tenant-alpha', status: 'active', last_login: timestampMinutesAgo(30) },
    { id: 'usr-demo-002', email: 'ops@demo.local', role: 'tenant', plan: 'pro', tenant_id: 'tenant-alpha', status: 'active', last_login: timestampMinutesAgo(90) },
    { id: 'usr-demo-003', email: 'viewer@demo.local', role: 'viewer', plan: 'starter', tenant_id: 'tenant-beta', status: 'suspended', last_login: null }
];

const demoOnboardingCodesBase: DemoOnboardingCode[] = [
    {
        id: 'onb-demo-001',
        status: 'active',
        expectedHostname: 'protected-web-01',
        maxUses: 1,
        usedCount: 0,
        createdAt: timestampMinutesAgo(12),
        expiresAt: timestampMinutesAgo(-18),
        usedAt: null,
        usedByAgentId: null
    },
    {
        id: 'onb-demo-002',
        status: 'used',
        expectedHostname: 'edge-probe-02',
        maxUses: 1,
        usedCount: 1,
        createdAt: timestampMinutesAgo(200),
        expiresAt: timestampMinutesAgo(140),
        usedAt: timestampMinutesAgo(175),
        usedByAgentId: 'agent-plato-02'
    }
];

const demoRegisteredAgentsBase: DemoRegisteredAgent[] = [
    { agentId: 'agent-socrates-01', hostname: 'redteam-edge-01', platform: 'linux', status: 'approved', createdAt: timestampMinutesAgo(3_000), lastSeenAt: timestampMinutesAgo(1) },
    { agentId: 'agent-plato-02', hostname: 'blueteam-core-02', platform: 'linux', status: 'approved', createdAt: timestampMinutesAgo(2_400), lastSeenAt: timestampMinutesAgo(2) },
    { agentId: 'agent-pending-05', hostname: 'field-probe-05', platform: 'linux', status: 'pending', createdAt: timestampMinutesAgo(25), lastSeenAt: timestampMinutesAgo(4) }
];

const demoDeploymentHistoryBase: DemoDeploymentHistoryRow[] = [
    { id: 'dep-demo-001', name: 'nginx-alpha.demo.fsce.local', version: '3', server_type: 'nginx', checksum: 'sha256:4e80ab12demo01', created_at: timestampMinutesAgo(320) },
    { id: 'dep-demo-002', name: 'apache-beta.demo.fsce.local', version: '2', server_type: 'apache', checksum: 'sha256:67bc102ademo02', created_at: timestampMinutesAgo(920) }
];

const demoScanTasksBase: DemoScanTask[] = [
    {
        id: 'scan-demo-003',
        status: 'completed',
        phase: 'done',
        progress: 100,
        error: null,
        createdAt: timestampMinutesAgo(36),
        completedAt: timestampMinutesAgo(31),
        urlFindings: [
            { target: 'https://alpha.demo.fsce.local/login', severity: 'high', title: 'Missing CSP nonce', description: 'Inline script path remains allowlisted.', sourceEngine: 'url-analyzer', createdAt: timestampMinutesAgo(33) }
        ],
        hostFindings: [
            { target: '127.0.0.1:6379', severity: 'medium', title: 'Redis accessible locally', description: 'Port is reachable from gateway namespace.', sourceEngine: 'host-analyzer', createdAt: timestampMinutesAgo(32) }
        ],
        nucleiFindings: [
            { target: 'alpha.demo.fsce.local', severity: 'critical', title: 'Default admin path exposed', description: 'Known admin route fingerprint matched.', sourceEngine: 'nuclei', createdAt: timestampMinutesAgo(31) }
        ]
    }
];

let demoApiKeysStore = clone([
    {
        id: 'key-demo-001',
        name: 'Demo Operations Key',
        prefix: 'fg_demo_ops_7HK2',
        created: '12 hours ago',
        lastUsed: '2 mins ago'
    }
]);

let demoAIEndpointsStore = clone(demoAIEndpointsBase);
let demoAdminUsersStore = clone(demoAdminUsersBase);
let demoOnboardingCodesStore = clone(demoOnboardingCodesBase);
let demoRegisteredAgentsStore = clone(demoRegisteredAgentsBase);
let demoDeploymentHistoryStore = clone(demoDeploymentHistoryBase);
let demoScanTasksStore = clone(demoScanTasksBase);
let demoAttackHistoryStore: AttackSimulationReport[] = [];
let demoAdminOversightExportsStore: any[] = [];

const demoAlertsBase: AlertItem[] = [
    {
        id: 'ALT-DEMO-001',
        title: 'Credential Stuffing Burst Blocked',
        message: 'Burst login attempts from 185.22.91.14 were contained before session creation.',
        severity: 'High',
        type: 'security',
        source: 'edge-gateway-01',
        time: timeLabel(3),
        status: 'open',
        timestamp: timestampMinutesAgo(3)
    },
    {
        id: 'ALT-DEMO-002',
        title: 'SSRF Probe Against Metadata Endpoint',
        message: 'Outbound request to 169.254.169.254 was intercepted and sandboxed.',
        severity: 'Critical',
        type: 'security',
        source: 'api-core-02',
        time: timeLabel(11),
        status: 'open',
        timestamp: timestampMinutesAgo(11)
    },
    {
        id: 'ALT-DEMO-003',
        title: 'Gateway Memory Pressure',
        message: 'Gateway Appliance memory pressure detected during packet replay.',
        severity: 'Medium',
        type: 'performance',
        source: 'esp32-gw-03',
        time: timeLabel(26),
        status: 'acknowledged',
        timestamp: timestampMinutesAgo(26)
    },
    {
        id: 'ALT-DEMO-004',
        title: 'Suspicious File Upload Quarantined',
        message: 'Portable executable disguised as image/jpeg was isolated for analysis.',
        severity: 'High',
        type: 'security',
        source: 'upload-worker-01',
        time: timeLabel(49),
        status: 'open',
        timestamp: timestampMinutesAgo(49)
    },
    {
        id: 'ALT-DEMO-005',
        title: 'Blue Team Policy Rollout Completed',
        message: 'Rate-limit profile promoted to all tenant ingress edges.',
        severity: 'Low',
        type: 'system',
        source: 'policy-engine',
        time: timeLabel(95),
        status: 'resolved',
        timestamp: timestampMinutesAgo(95)
    }
];

const demoLogsBase: LogItem[] = [
    { id: 1, time: timestampMinutesAgo(1), type: 'WAF', level: 'WARN', message: 'Blocked SQLi payload on /auth/login', ip: '185.22.91.14', status: 403, method: 'POST', path: '/auth/login' },
    { id: 2, time: timestampMinutesAgo(3), type: 'AI', level: 'INFO', message: 'Aristotle promoted remediation pack #FG-2217', ip: '127.0.0.1', status: 200, method: 'SYSTEM', path: '/internal/remediation' },
    { id: 3, time: timestampMinutesAgo(5), type: 'BOT', level: 'WARN', message: 'Credential stuffing heuristic triggered on tenant alpha', ip: '92.118.39.77', status: 429, method: 'POST', path: '/api/auth/login' },
    { id: 4, time: timestampMinutesAgo(8), type: 'DNS', level: 'WARN', message: 'Blocked metadata SSRF lookup through resolver chain', ip: '10.24.8.14', status: 403, method: 'GET', path: '/api/proxy/fetch' },
    { id: 5, time: timestampMinutesAgo(13), type: 'EDGE', level: 'INFO', message: 'Gateway esp32-gw-01 uploaded telemetry batch', ip: '10.0.2.31', status: 200, method: 'POST', path: '/api/devices/telemetry' },
    { id: 6, time: timestampMinutesAgo(19), type: 'WAF', level: 'ERROR', message: 'Command injection signature matched; request terminated', ip: '203.0.113.44', status: 403, method: 'POST', path: '/api/tools/ping' }
];

const demoSitesBase: DemoSite[] = [
    { id: 'site-alpha', domain: 'alpha.demo.fsce.local', target: 'https://alpha.internal:8443', status: 'secure' },
    { id: 'site-beta', domain: 'beta.demo.fsce.local', target: 'https://beta.internal:9443', status: 'secure' },
    { id: 'site-gamma', domain: 'gamma.demo.fsce.local', target: 'http://10.10.30.12:8080', status: 'monitoring' }
];

const demoFlowsBase: FlowInfo[] = [
    { id: 'flow-001', sourceIP: '185.22.91.14', destIP: '10.10.30.12', sourcePort: 51541, destPort: 443, protocol: 'tcp', state: 'BLOCKED', packetCount: 82, byteCount: 21984, startTime: timestampMinutesAgo(1), lastActivity: timestampMinutesAgo(1) },
    { id: 'flow-002', sourceIP: '10.0.2.31', destIP: '10.10.20.8', sourcePort: 44321, destPort: 8443, protocol: 'tcp', state: 'ESTABLISHED', packetCount: 1502, byteCount: 1_842_992, startTime: timestampMinutesAgo(7), lastActivity: timestampMinutesAgo(0) },
    { id: 'flow-003', sourceIP: '198.51.100.77', destIP: '10.10.20.8', sourcePort: 53921, destPort: 80, protocol: 'tcp', state: 'ESTABLISHED', packetCount: 931, byteCount: 602_144, startTime: timestampMinutesAgo(4), lastActivity: timestampMinutesAgo(0) },
    { id: 'flow-004', sourceIP: '10.0.5.17', destIP: '8.8.8.8', sourcePort: 53121, destPort: 53, protocol: 'udp', state: 'ESTABLISHED', packetCount: 412, byteCount: 67_012, startTime: timestampMinutesAgo(2), lastActivity: timestampMinutesAgo(0) },
    { id: 'flow-005', sourceIP: '203.0.113.55', destIP: '10.10.30.12', sourcePort: 52211, destPort: 443, protocol: 'tcp', state: 'ESTABLISHED', packetCount: 1240, byteCount: 920_440, startTime: timestampMinutesAgo(9), lastActivity: timestampMinutesAgo(1) }
];

const demoAgentsBase: DemoAgent[] = [
    {
        agentId: 'agent-socrates-01',
        hostname: 'redteam-edge-01',
        platform: 'linux',
        isOnline: true,
        lastHeartbeat: timestampMinutesAgo(1),
        status: { cpuUsage: 31, memoryUsage: 54, uptime: 259_200 },
        registration: { arch: 'x64', cpus: 8, totalMemory: 34_359_738_368, version: '2.3.1' }
    },
    {
        agentId: 'agent-plato-02',
        hostname: 'blueteam-core-02',
        platform: 'linux',
        isOnline: true,
        lastHeartbeat: timestampMinutesAgo(2),
        status: { cpuUsage: 43, memoryUsage: 61, uptime: 411_840 },
        registration: { arch: 'x64', cpus: 16, totalMemory: 68_719_476_736, version: '2.3.1' }
    },
    {
        agentId: 'agent-aristotle-03',
        hostname: 'analysis-lab-03',
        platform: 'linux',
        isOnline: true,
        lastHeartbeat: timestampMinutesAgo(1),
        status: { cpuUsage: 37, memoryUsage: 49, uptime: 604_800 },
        registration: { arch: 'arm64', cpus: 12, totalMemory: 34_359_738_368, version: '2.4.0' }
    },
    {
        agentId: 'agent-probe-04',
        hostname: 'remote-probe-04',
        platform: 'linux',
        isOnline: false,
        lastHeartbeat: timestampMinutesAgo(18),
        status: { cpuUsage: 0, memoryUsage: 0, uptime: 0 },
        registration: { arch: 'x64', cpus: 4, totalMemory: 17_179_869_184, version: '2.2.9' }
    }
];

const demoDevicesBase: DemoDevice[] = [
    // NOTE: These demo devices model the AetherGuard Gateway Appliance (STM32H5/U5 + Zephyr RTOS,
    // the active hardware since 2026-06-13). The deviceId prefix `esp32-gw-*` and tag values `esp32-s3`/`esp32-c6`
    // are retained for backward-compat because the IDs are used as keys in demoDeviceEventsBase /
    // demoDeviceCommandsStore below; they are legacy demo-fixture names, NOT indicators of active ESP32 hardware.
    // ESP32 serial-deployer / control-board hardware is retired and archived.
    {
        deviceId: 'esp32-gw-01',
        version: '1.8.4',
        chipModel: 'STM32H563',
        flashSize: 16 * 1024 * 1024,
        freeHeap: 312_000,
        sdkVersion: 'Zephyr RTOS v3.5',
        mode: 'online',
        isOnline: true,
        lastHeartbeat: timestampMinutesAgo(1),
        connectedAgents: ['agent-socrates-01', 'agent-plato-02'],
        status: { cpuUsage: 28, memoryUsage: 41, uptime: 172_800, wifiRssi: -48 },
        systemInfo: { hostname: 'edge-gateway-01', os: 'zephyr', kernel: 'zephyr-3.5', arch: 'arm-cortex-m33' },
        config: {
            displayName: '北区边缘网关',
            group: 'core-edge',
            site: 'factory-north',
            networkProfile: 'cloud-mesh',
            scanProfile: 'balanced',
            notes: 'Primary ingestion gateway for the north plant.',
            commandPermissions: ['collect', 'reboot', 'sync-config'],
            tags: ['stm32h5', 'gateway-appliance', 'north', 'production'],
            updatedAt: timestampMinutesAgo(14)
        },
        latestCommand: null
    },
    {
        deviceId: 'esp32-gw-02',
        version: '1.8.4',
        chipModel: 'STM32U575',
        flashSize: 8 * 1024 * 1024,
        freeHeap: 214_000,
        sdkVersion: 'Zephyr RTOS v3.5',
        mode: 'offline',
        isOnline: true,
        lastHeartbeat: timestampMinutesAgo(4),
        connectedAgents: [],
        status: { cpuUsage: 17, memoryUsage: 33, uptime: 93_600, wifiRssi: -65 },
        systemInfo: { hostname: 'field-sensor-02', os: 'zephyr', kernel: 'zephyr-3.5', arch: 'arm-cortex-m33' },
        config: {
            displayName: '园区巡检节点 02',
            group: 'field-edge',
            site: 'factory-south',
            networkProfile: 'buffered-edge',
            scanProfile: 'conservative',
            notes: 'Intermittent uplink, buffers telemetry locally.',
            commandPermissions: ['collect', 'sync-config'],
            tags: ['stm32u5', 'gateway-appliance', 'field', 'standalone'],
            updatedAt: timestampMinutesAgo(21)
        },
        latestCommand: null
    },
    {
        deviceId: 'esp32-gw-03',
        version: '1.7.9',
        chipModel: 'STM32H563',
        flashSize: 16 * 1024 * 1024,
        freeHeap: 0,
        sdkVersion: 'Zephyr RTOS v3.5',
        mode: 'offline',
        isOnline: false,
        lastHeartbeat: timestampMinutesAgo(47),
        connectedAgents: ['agent-aristotle-03'],
        status: { cpuUsage: 0, memoryUsage: 0, uptime: 0, wifiRssi: -92 },
        systemInfo: { hostname: 'warehouse-gateway-03', os: 'zephyr', kernel: 'zephyr-3.5', arch: 'arm-cortex-m33' },
        config: {
            displayName: '仓储边缘网关 03',
            group: 'warehouse-edge',
            site: 'warehouse-west',
            networkProfile: 'offline-recovery',
            scanProfile: 'offline-recovery',
            notes: 'Awaiting power recovery and heap diagnostics.',
            commandPermissions: ['sync-config'],
            tags: ['stm32h5', 'gateway-appliance', 'warehouse', 'recovery'],
            updatedAt: timestampMinutesAgo(53)
        },
        latestCommand: null
    }
];

const demoDeviceEventsBase: Record<string, DemoDeviceEvent[]> = {
    'esp32-gw-01': [
        { id: 'evt-101', deviceId: 'esp32-gw-01', type: 'telemetry', payload: { cpu: 28, mem: 41, queueDepth: 3 }, timestamp: timestampMinutesAgo(1) },
        { id: 'evt-102', deviceId: 'esp32-gw-01', type: 'alert', payload: { code: 'A002', summary: 'Reflected XSS blocked on captive portal' }, timestamp: timestampMinutesAgo(6) },
        { id: 'evt-103', deviceId: 'esp32-gw-01', type: 'command', payload: { action: 'collect', queuedBy: 'demo-mode' }, timestamp: timestampMinutesAgo(9) }
    ],
    'esp32-gw-02': [
        { id: 'evt-201', deviceId: 'esp32-gw-02', type: 'heartbeat', payload: { rssi: -65, uptime: 93_600 }, timestamp: timestampMinutesAgo(4) },
        { id: 'evt-202', deviceId: 'esp32-gw-02', type: 'data', payload: { sampleWindow: '5m', blocked: 17 }, timestamp: timestampMinutesAgo(10) }
    ],
    'esp32-gw-03': [
        { id: 'evt-301', deviceId: 'esp32-gw-03', type: 'disconnect', payload: { reason: 'power_cycle', code: 'E005' }, timestamp: timestampMinutesAgo(47) },
        { id: 'evt-302', deviceId: 'esp32-gw-03', type: 'unknown_error', payload: { reason: 'heap starvation', code: 'E003' }, timestamp: timestampMinutesAgo(52) }
    ]
};

const demoFixHistoryBase: DemoFixHistoryDetail[] = [
    {
        id: 'scan-demo-001',
        status: 'completed',
        phase: 'verify',
        progress: 100,
        createdAt: timestampMinutesAgo(180),
        startedAt: timestampMinutesAgo(179),
        completedAt: timestampMinutesAgo(166),
        error: null,
        summary: { remediated: 3, acceptedRisk: 1, remaining: 0 },
        findings: [
            {
                target_type: 'site',
                target: 'alpha.demo.fsce.local',
                severity: 'high',
                title: 'Reflected XSS exposure',
                description: 'Added output encoding guard and CSP hardening.',
                source_engine: 'ai-fixer',
                created_at: timestampMinutesAgo(170)
            },
            {
                target_type: 'endpoint',
                target: '/api/auth/login',
                severity: 'medium',
                title: 'Missing adaptive rate limit',
                description: 'Applied burst profile and lockout telemetry.',
                source_engine: 'policy-engine',
                created_at: timestampMinutesAgo(168)
            }
        ]
    },
    {
        id: 'scan-demo-002',
        status: 'running',
        phase: 'analyze',
        progress: 62,
        createdAt: timestampMinutesAgo(48),
        startedAt: timestampMinutesAgo(47),
        completedAt: undefined,
        error: null,
        summary: { remediated: 0, acceptedRisk: 0, remaining: 4 },
        findings: [
            {
                target_type: 'site',
                target: 'gamma.demo.fsce.local',
                severity: 'critical',
                title: 'Metadata SSRF candidate',
                description: 'Outbound allowlist mismatch detected in fetch proxy.',
                source_engine: 'behavioral-analyzer',
                created_at: timestampMinutesAgo(39)
            }
        ]
    }
];

let demoAlertsStore = clone(demoAlertsBase);
let demoDevicesStore = clone(demoDevicesBase);
let demoDeviceEventsStore = clone(demoDeviceEventsBase);
let demoDeviceCommandsStore: Record<string, DemoDeviceCommand[]> = {
    'esp32-gw-01': [
        {
            id: 'cmd-demo-001',
            deviceId: 'esp32-gw-01',
            command: 'collect',
            status: 'completed',
            message: 'Security telemetry collection completed.',
            executedBy: 'demo-ops',
            createdAt: timestampMinutesAgo(9),
            completedAt: timestampMinutesAgo(9)
        }
    ]
};

const getDemoDeviceCommands = (deviceId: string) => clone(demoDeviceCommandsStore[deviceId] || []);

const countOpenAlerts = () => demoAlertsStore.filter((item) => item.status === 'open' || item.status === 'acknowledged' || item.status === 'investigating').length;
const countRunningDemoScans = () => demoScanTasksStore.filter((task) => task.status === 'running' || task.status === 'pending').length;

const syncDemoDevice = (deviceId: string, patch: Partial<DemoDevice>) => {
    demoDevicesStore = demoDevicesStore.map((device) => (
        device.deviceId === deviceId
            ? {
                  ...device,
                  ...patch
              }
            : device
    ));
};

const demoAttackHistoryBase: AttackSimulationReport[] = [
    {
        total: 12,
        blocked: 11,
        allowed: 1,
        errors: 0,
        startTime: timestampMinutesAgo(90),
        endTime: timestampMinutesAgo(88),
        results: []
    },
    {
        total: 8,
        blocked: 8,
        allowed: 0,
        errors: 0,
        startTime: timestampMinutesAgo(220),
        endTime: timestampMinutesAgo(217),
        results: []
    }
];

demoAttackHistoryStore = clone(demoAttackHistoryBase);

const demoAttackTypesBase: AttackType[] = [
    { id: 'sql-demo-1', name: 'Union Select Exfiltration', category: 'sql_injection', severity: 'critical', description: 'Attempts UNION-based data extraction.' },
    { id: 'xss-demo-1', name: 'Stored Payload Injection', category: 'xss', severity: 'high', description: 'Persists a script payload in profile metadata.' },
    { id: 'ssrf-demo-1', name: 'Metadata SSRF Pivot', category: 'ssrf', severity: 'critical', description: 'Targets cloud metadata through backend fetcher.' },
    { id: 'upload-demo-1', name: 'Polyglot Upload', category: 'file_upload', severity: 'high', description: 'Uploads an executable masked as an image.' }
];

export const getDemoStats = (): DashboardStats => {
    progressDemoScanTasks();
    const history = Array.from({ length: 20 }, (_, index) => {
        const offset = 19 - index;
        const requests = 160 + index * 24 + ((index % 3) * 9);
        const blocked = 4 + (index % 4) + (index > 12 ? 3 : 0);
        return {
            time: new Date(Date.now() - offset * 120_000).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }),
            requests,
            blocked
        };
    });

    return clone({
        totalRequests: 1_284_320 + demoAttackHistoryStore.length * 120 + demoScanTasksStore.length * 40,
        currentRPS: 312,
        blockedRequests: 2_931 + countOpenAlerts() * 3 + demoAttackHistoryStore.reduce((sum, run) => sum + run.blocked, 0),
        activeConnections: 84 + demoDevicesStore.filter((device) => device.isOnline).length + countRunningDemoScans(),
        successRate: Math.max(92, 98.7 - demoAttackHistoryStore.filter((run) => run.allowed > 0).length * 0.8),
        avgProcessingTime: 18,
        history,
        threats: [
            { name: 'SQLi', value: 41, color: '#ef4444' },
            { name: 'XSS', value: 22, color: '#f97316' },
            { name: 'Bot', value: 19, color: '#3b82f6' },
            { name: 'SSRF', value: 8, color: '#8b5cf6' }
        ],
        attackOrigins: [
            { country: 'United States', countryCode: 'US', count: 441, percentage: 32 },
            { country: 'Germany', countryCode: 'DE', count: 251, percentage: 18 },
            { country: 'Japan', countryCode: 'JP', count: 196, percentage: 14 },
            { country: 'China', countryCode: 'CN', count: 167, percentage: 12 },
            { country: 'Unknown', countryCode: 'Unknown', count: 321, percentage: 24 }
        ],
        requestsTrend: 14.2,
        blockedTrend: 8.7,
        p99Latency: 41,
        cpuUsage: 34.8 + countRunningDemoScans() * 2,
        memoryUsage: 57.1 + countOpenAlerts() * 1.5,
        diskUsage: 48.3,
        networkUsage: 12.42
    });
};

export const getDemoLogs = (): LogItem[] => clone(demoLogsBase);

export const getDemoAlerts = (): AlertItem[] => clone(demoAlertsStore);

export const getDemoSites = (): DemoSite[] => clone(demoSitesBase);

export const getDemoDashboardRulesSummary = () =>
    clone({
        totalRules: demoRules.length,
        activeRules: demoRules.filter((rule) => rule.enabled).length,
        topRules: demoRules,
        updatedAt: new Date().toISOString()
    });

export const getDemoAdminApiKeys = () =>
    clone(demoApiKeysStore);

export const getDemoSystemBadges = () =>
    clone({
        alerts: countOpenAlerts() + demoAttackHistoryStore.filter((run) => run.allowed > 0).length,
        devices: demoDevicesStore.filter((device) => device.isOnline).length,
        agents: demoRegisteredAgentsStore.filter((agent) => agent.status === 'approved').length,
        agentMonitor: countRunningDemoScans() + demoAttackHistoryStore.filter((run) => run.allowed > 0).length,
        traffic: demoFlowsBase.length + demoAttackHistoryStore.reduce((sum, run) => sum + run.blocked + run.allowed, 0),
        scanner: countRunningDemoScans()
    });

export const getDemoAgentSystemStats = (): MultiAgentSystemStats =>
    clone({
        orchestrator: {
            activeTasks: demoScanTasksStore.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').length + Math.max(1, demoAttackHistoryStore.length),
            registeredAgents: demoRegisteredAgentsStore.filter((agent) => agent.status !== 'revoked').length
        },
        messageBus: {
            queueSize: countOpenAlerts() + demoScanTasksStore.length + Object.values(demoDeviceCommandsStore).reduce((sum, rows) => sum + rows.length, 0),
            subscriptionCount: 8 + demoRegisteredAgentsStore.filter((agent) => agent.status === 'approved').length,
            pendingRequests: countRunningDemoScans() + demoAttackHistoryStore.filter((run) => run.allowed > 0).length
        },
        synthesis: {
            totalCaseFiles: 96 + demoAlertsStore.length + demoAttackHistoryStore.length,
            totalLessons: 24 + demoAttackHistoryStore.filter((run) => run.blocked === run.total).length,
            totalPolicyUpdates: 8 + demoScanTasksStore.filter((task) => task.status === 'completed').length + Object.values(demoDeviceCommandsStore).reduce((sum, rows) => sum + rows.filter((row) => row.command === 'sync-config').length, 0),
            topPatterns: [
                { pattern: 'credential-stuffing', frequency: 11 + demoAlertsStore.filter((alert) => /Credential/i.test(alert.title)).length * 6 },
                { pattern: 'metadata-ssrf', frequency: 9 + demoAlertsStore.filter((alert) => /SSRF/i.test(alert.title)).length * 5 },
                { pattern: 'stored-xss', frequency: 7 + demoAttackHistoryStore.length * 2 },
                { pattern: 'path-traversal', frequency: 4 + demoScanTasksStore.length }
            ]
        },
        operations: {
            activeAlerts: countOpenAlerts(),
            runningScans: countRunningDemoScans(),
            pendingActions: demoScanTasksStore.filter((task) => task.status === 'completed').length + Object.values(demoDeviceCommandsStore).reduce((sum, rows) => sum + rows.length, 0),
            failedValidations: demoAttackHistoryStore.filter((run) => run.allowed > 0).length,
            assetsAtRisk: demoDevicesStore.length + demoSitesBase.length
        },
        health: {
            status: demoAttackHistoryStore.some((run) => run.allowed > 0) ? 'degraded' : 'healthy',
            details: demoAttackHistoryStore.some((run) => run.allowed > 0)
                ? { validation: 'Latest replay contains allowed attack paths.' }
                : {} as Record<string, string>
        },
        agents: [
            { agentId: 'agent-socrates-01', role: 'socrates', status: 'healthy', lastSeen: timestampMinutesAgo(1), responseTime: 46 + demoAttackHistoryStore.length, tasksCompleted: 321 + demoAttackHistoryStore.length, tasksPending: 1 + demoScanTasksStore.length, errorCount: 0 },
            { agentId: 'agent-plato-02', role: 'plato', status: 'healthy', lastSeen: timestampMinutesAgo(2), responseTime: 58 + demoScanTasksStore.length, tasksCompleted: 288 + demoAlertsStore.length, tasksPending: countOpenAlerts(), errorCount: 0 },
            { agentId: 'agent-aristotle-03', role: 'aristotle', status: 'healthy', lastSeen: timestampMinutesAgo(1), responseTime: 62 + demoAttackHistoryStore.filter((run) => run.allowed > 0).length * 5, tasksCompleted: 417 + demoScanTasksStore.length, tasksPending: 2 + demoAttackHistoryStore.length, errorCount: 1 },
            { agentId: 'agent-arbitrator-00', role: 'arbitrator', status: demoAttackHistoryStore.some((run) => run.allowed > 0) ? 'degraded' : 'healthy', lastSeen: timestampMinutesAgo(3), responseTime: 91 + demoAttackHistoryStore.filter((run) => run.allowed > 0).length * 7, tasksCompleted: 144 + demoScanTasksStore.length, tasksPending: 1 + demoAttackHistoryStore.filter((run) => run.allowed > 0).length, errorCount: 2 }
        ]
    });

export const getDemoAgentHealth = () =>
    clone({
        status: 'healthy',
        details: {}
    });

export const getDemoTrafficStats = (): TrafficStats =>
    clone({
        uptime: 259_200,
        packetsProcessed: 2_483_920,
        packetsAllowed: 2_467_012,
        packetsBlocked: 16_908,
        packetsInspected: 2_471_300,
        bytesProcessed: 3_284_912_640,
        currentFlows: demoFlowsBase.length,
        activeConnections: demoFlowsBase.filter((flow) => flow.state === 'ESTABLISHED').length,
        droppedPackets: 14,
        bufferOverflows: 1,
        avgProcessingTime: 1.37,
        cpuUsage: 33.4,
        memoryUsage: 52.6
    });

export const getDemoActiveFlows = (): FlowInfo[] => clone(demoFlowsBase);

export const getDemoProtocolDistribution = () =>
    clone({
        http: 28,
        https: 64,
        dns: 11,
        other: 5
    });

export const getDemoThreatDetections = () =>
    clone([
        { type: 'SQL Injection', count: 184 + demoAttackHistoryStore.filter((run) => run.allowed > 0).length, severity: 'critical' },
        { type: 'Credential Stuffing', count: 123 + countOpenAlerts(), severity: 'high' },
        { type: 'Stored XSS', count: 57 + demoScanTasksStore.length, severity: 'high' },
        { type: 'SSRF', count: 19 + demoAlertsStore.filter((alert) => /SSRF/i.test(alert.title)).length, severity: 'critical' },
        { type: 'Rate Abuse', count: 31 + Object.values(demoDeviceCommandsStore).reduce((sum, rows) => sum + rows.length, 0), severity: 'medium' }
    ]);

export const getDemoAgents = (): DemoAgent[] => clone(demoAgentsBase);

export const getDemoRecentAgentThreats = (limit: number) =>
    clone(
        demoAlertsStore
            .filter((alert) => alert.type === 'security')
            .slice(0, limit)
            .map((alert) => ({
                id: alert.id,
                title: alert.title,
                message: alert.message,
                severity: alert.severity.toLowerCase(),
                source: alert.source,
                timestamp: alert.timestamp
            }))
    );

export const getDemoDevices = (): DemoDevice[] =>
    clone(demoDevicesStore.map((device) => ({ ...device, latestCommand: getDemoDeviceCommands(device.deviceId)[0] || null })));

export const getDemoDeviceDetail = (deviceId: string): DemoDevice | null =>
    clone((() => {
        const device = demoDevicesStore.find((row) => row.deviceId === deviceId);
        return device ? { ...device, latestCommand: getDemoDeviceCommands(deviceId)[0] || null } : null;
    })());

export const getDemoDeviceEvents = (deviceId: string, limit: number): DemoDeviceEvent[] =>
    clone((demoDeviceEventsStore[deviceId] || []).slice(0, limit));

export const getDemoFixHistory = (limit: number): DemoFixHistoryItem[] =>
    clone(demoFixHistoryBase.slice(0, limit).map(({ findings, summary, error, startedAt, ...row }) => row));

export const getDemoFixHistoryDetail = (id: string): DemoFixHistoryDetail | null =>
    clone(demoFixHistoryBase.find((row) => row.id === id) || null);

export const getDemoAttackHistory = (): AttackSimulationReport[] => clone(demoAttackHistoryStore);

export const getDemoAttackTypes = (): AttackType[] => clone(demoAttackTypesBase);

export const createDemoAdminApiKey = (name: string) => {
    const key = {
        id: makeId('key-demo'),
        name,
        prefix: `fg_demo_${Math.random().toString(36).slice(2, 10)}`,
        created: 'Just now',
        lastUsed: 'Never'
    };
    demoApiKeysStore.unshift(key);
    return clone({ success: true, key });
};

export const deleteDemoAdminApiKey = (id: string) => {
    demoApiKeysStore = demoApiKeysStore.filter((key) => key.id !== id);
    return clone({ success: true });
};

export const getDemoAIEndpoints = (): DemoAIEndpoint[] =>
    clone([...demoAIEndpointsStore].sort((a, b) => a.priority - b.priority));

export const createDemoAIEndpoint = (payload: Partial<DemoAIEndpoint>) => {
    const endpoint: DemoAIEndpoint = {
        id: makeId('ai-demo'),
        name: payload.name || 'Demo Endpoint',
        url: payload.url || 'http://demo-endpoint.local',
        modelName: payload.modelName || 'demo-model',
        apiKey: payload.apiKey || '',
        enabled: true,
        priority: Number(payload.priority || 10),
        timeout: Number(payload.timeout || 30_000),
        type: (payload.type as DemoAIEndpoint['type']) || 'custom'
    };
    demoAIEndpointsStore.push(endpoint);
    return clone({ success: true, endpoint });
};

export const updateDemoAIEndpoint = (id: string, payload: Record<string, unknown>) => {
    demoAIEndpointsStore = demoAIEndpointsStore.map((endpoint) =>
        endpoint.id === id ? { ...endpoint, ...payload } : endpoint
    );
    return clone({ success: true });
};

export const deleteDemoAIEndpoint = (id: string) => {
    demoAIEndpointsStore = demoAIEndpointsStore.filter((endpoint) => endpoint.id !== id);
    return clone({ success: true });
};

export const testDemoAIEndpoint = (id: string) => {
    demoAIEndpointsStore = demoAIEndpointsStore.map((endpoint) =>
        endpoint.id === id
            ? {
                  ...endpoint,
                  lastTest: {
                      success: true,
                      latency: Math.floor(Math.random() * 320) + 90,
                      timestamp: new Date().toISOString()
                  }
              }
            : endpoint
    );
    return clone({ success: true });
};

export const getDemoAdminUsers = () => clone({ users: demoAdminUsersStore });

export const updateDemoAdminUser = (userId: string, patch: Partial<DemoAdminUser>) => {
    demoAdminUsersStore = demoAdminUsersStore.map((user) =>
        user.id === userId ? { ...user, ...patch } : user
    );
    return clone({ success: true });
};

const buildDemoOversightTimeline = (params: {
    tenantId: string;
    userId?: string;
    category?: string;
    limit?: number;
}) => {
    const user = params.userId ? demoAdminUsersStore.find((item) => item.id === params.userId) : null;
    const rows = [
        ...demoAlertsStore
            .filter(() => !params.category || params.category === 'all' || params.category === 'alert')
            .map((alert) => ({
                id: `alert:${alert.id}`,
                tenantId: params.tenantId,
                category: 'alert',
                action: alert.title,
                status: alert.status,
                timestamp: alert.timestamp,
                actor: null,
                target: { type: 'alert', id: alert.id },
                details: { message: alert.message, severity: alert.severity, source: alert.source },
                source: 'demo-alerts',
                severity: alert.severity
            })),
        ...demoLogsBase
            .filter(() => !params.category || params.category === 'all' || params.category === 'system' || params.category === 'auth')
            .map((log) => ({
                id: `audit:${log.id}`,
                tenantId: params.tenantId,
                category: String(log.path || '').includes('auth') ? 'auth' : 'system',
                action: log.message,
                status: Number(log.status || 0) >= 400 ? 'failure' : 'success',
                timestamp: log.time,
                actor: { type: 'user', id: user?.id || 'system', email: user?.email },
                target: { type: 'log', id: String(log.id) },
                details: log,
                source: 'demo-logs',
                severity: log.level.toLowerCase()
            })),
        ...demoScanTasksStore
            .filter(() => !params.category || params.category === 'all' || params.category === 'scanner')
            .map((task) => ({
                id: `scan:${task.id}`,
                tenantId: params.tenantId,
                category: 'scanner',
                action: task.phase,
                status: task.status,
                timestamp: task.createdAt,
                actor: { type: 'user', id: user?.id || 'usr-demo-001', email: user?.email || 'admin@demo.local' },
                target: { type: 'scan', id: task.id },
                details: { progress: task.progress, error: task.error },
                source: 'demo-scanner',
                severity: task.status === 'failed' ? 'warning' : 'info'
            })),
        ...demoAttackHistoryStore.map((run) => ({
            id: `validation:${run.id || run.startTime}`,
            tenantId: params.tenantId,
            category: 'validation',
            action: run.results?.[0]?.attackName || 'attack-simulation',
            status: run.allowed > 0 ? 'missed' : 'blocked',
            timestamp: run.endTime || run.startTime,
            actor: { type: 'user', id: user?.id || 'usr-demo-001', email: user?.email || 'admin@demo.local' },
            target: { type: 'validation', id: run.id || run.startTime },
            details: run,
            source: 'demo-attack',
            severity: run.allowed > 0 ? 'high' : 'info'
        }))
    ]
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    return rows.slice(0, params.limit || 100);
};

export const getDemoAdminOversightTenants = () => {
    const tenantIds = Array.from(new Set(demoAdminUsersStore.map((user) => user.tenant_id)));
    return clone(tenantIds.map((tenantId) => {
        const users = demoAdminUsersStore.filter((user) => user.tenant_id === tenantId);
        return {
            tenantId,
            tenantName: `Tenant ${tenantId}`,
            status: users.some((user) => user.status === 'suspended') ? 'attention' : 'active',
            userCount: users.length,
            lastActiveAt: users.reduce((latest, user) => {
                const next = user.last_login || timestampMinutesAgo(180);
                return !latest || next > latest ? next : latest;
            }, null as string | null),
            openHighAlerts: demoAlertsStore.filter((alert) => alert.severity === 'Critical' || alert.severity === 'High').length,
            failedValidations: demoAttackHistoryStore.filter((run) => run.allowed > 0).length,
            riskLevel: demoAlertsStore.some((alert) => alert.severity === 'Critical') ? 'high' : 'medium'
        };
    }));
};

export const getDemoAdminOversightSummary = (tenantId: string, userId?: string) => {
    const users = demoAdminUsersStore.filter((user) => user.tenant_id === tenantId && (!userId || user.id === userId));
    return clone({
        tenant: {
            tenantId,
            tenantName: `Tenant ${tenantId}`,
            userCount: demoAdminUsersStore.filter((user) => user.tenant_id === tenantId).length,
            lastActiveAt: users[0]?.last_login || timestampMinutesAgo(45)
        },
        users,
        metrics: {
            openCriticalFindings: demoAlertsStore.filter((alert) => alert.severity === 'Critical').length,
            activeAlerts: demoAlertsStore.filter((alert) => alert.status === 'open' || alert.status === 'investigating').length,
            runningScans: demoScanTasksStore.filter((task) => task.status === 'running').length,
            pendingActions: demoFixHistoryBase.filter((item) => item.status !== 'completed').length,
            failedValidations: demoAttackHistoryStore.filter((run) => run.allowed > 0).length,
            assetsAtRisk: demoSitesBase.length + demoDevicesStore.length
        },
        recentTimeline: buildDemoOversightTimeline({ tenantId, userId, limit: 12 }),
        recentAuth: demoLogsBase.slice(0, 5),
        recentDeployments: demoDeploymentHistoryStore.slice(0, 5),
        recentActions: demoFixHistoryBase.slice(0, 5),
        recentValidations: demoAttackHistoryStore.slice(0, 5),
        recentExports: demoAdminOversightExportsStore.filter((item) => item.tenantId === tenantId).slice(0, 10)
    });
};

export const getDemoAdminOversightTimeline = (params: {
    tenantId: string;
    userId?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
}) => clone(buildDemoOversightTimeline(params));

export const getDemoAdminOversightEvidence = (params: {
    tenantId: string;
    userId?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
}) => clone(
    buildDemoOversightTimeline(params)
        .filter((item) => item.id.startsWith('audit:'))
        .map((item) => ({
            logId: item.id.replace('audit:', ''),
            tenantId: item.tenantId,
            timestamp: item.timestamp,
            category: item.category,
            action: item.action,
            status: item.status,
            actor: item.actor,
            target: item.target,
            details: item.details,
            integrity: 'valid',
            relatedEventId: item.id
        }))
);

export const verifyDemoAdminAuditLog = (logId: string) =>
    clone({ success: true, valid: Boolean(logId) });

export const getDemoAdminOversightExport = (payload: { tenantId?: string; filters?: Record<string, any>; exportId?: string }) => {
    if (payload.exportId) {
        return clone(demoAdminOversightExportsStore.find((item) => item.id === payload.exportId) || null);
    }

    const tenantId = payload.tenantId || 'tenant-alpha';
    const summary = getDemoAdminOversightSummary(tenantId, payload.filters?.userId);
    const timeline = getDemoAdminOversightTimeline({ tenantId, ...(payload.filters || {}), limit: 200 });
    const evidence = getDemoAdminOversightEvidence({ tenantId, ...(payload.filters || {}), limit: 200 });
    const record = {
        id: makeId('oversight-export'),
        tenantId,
        requestedBy: 'admin@demo.local',
        requestedAt: new Date().toISOString(),
        filters: payload.filters || {},
        summary,
        jsonPayload: JSON.stringify({ tenantId, summary, timeline, evidence }, null, 2),
        csvPayload: [
            'timestamp,category,action,status',
            ...timeline.map((item) => [item.timestamp, item.category, `"${String(item.action).replace(/"/g, '""')}"`, item.status].join(','))
        ].join('\n')
    };
    demoAdminOversightExportsStore.unshift(record);
    return clone({ success: true, data: record });
};

export const createDemoAgentOnboardingCode = (payload: { hostname?: string; ttlMinutes?: number; maxUses?: number }) => {
    const ttl = Number(payload.ttlMinutes || 10);
    const code = `DEMO-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const row: DemoOnboardingCode = {
        id: makeId('onb-demo'),
        status: 'active',
        expectedHostname: payload.hostname || null,
        maxUses: Number(payload.maxUses || 1),
        usedCount: 0,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
        usedAt: null,
        usedByAgentId: null
    };
    demoOnboardingCodesStore.unshift(row);
    return clone({
        success: true,
        data: {
            onboardingCode: code,
            expiresAt: row.expiresAt
        }
    });
};

export const getDemoAgentOnboardingCodes = (status?: DemoOnboardingCode['status'], limit: number = 50) =>
    clone(
        demoOnboardingCodesStore
            .filter((row) => (status ? row.status === status : true))
            .slice(0, limit)
    );

export const getDemoRegisteredAgents = () => clone(demoRegisteredAgentsStore);

export const revokeDemoAgentCredential = (agentId: string) => {
    demoRegisteredAgentsStore = demoRegisteredAgentsStore.map((row) =>
        row.agentId === agentId ? { ...row, status: 'revoked' } : row
    );
    return clone({ success: true });
};

export const getDemoDeploymentHistory = (limit: number = 20) => clone(demoDeploymentHistoryStore.slice(0, limit));

export const generateDemoDeploymentConfig = (payload: {
    serverType: 'nginx' | 'apache';
    profile: { port: number; serverName: string; rateLimit: number; upstream: string };
}) => {
    const checksum = `sha256:${Math.random().toString(16).slice(2, 14)}`;
    const configText =
        payload.serverType === 'nginx'
            ? `server {\n  listen ${payload.profile.port};\n  server_name ${payload.profile.serverName};\n  location / {\n    proxy_pass ${payload.profile.upstream};\n    limit_req zone=burst burst=${payload.profile.rateLimit};\n  }\n}`
            : `<VirtualHost *:${payload.profile.port}>\n  ServerName ${payload.profile.serverName}\n  ProxyPass / ${payload.profile.upstream}\n  ProxyPassReverse / ${payload.profile.upstream}\n</VirtualHost>`;
    const envSnippet = `FG_RATE_LIMIT=${payload.profile.rateLimit}\nFG_UPSTREAM=${payload.profile.upstream}`;
    return clone({
        success: true,
        data: {
            configText,
            envSnippet,
            checksum,
            warnings: ['Demo mode: configuration is simulated and not persisted server-side.']
        }
    });
};

export const saveDemoDeploymentConfig = (payload: { serverType: 'nginx' | 'apache'; name?: string }) => {
    const row: DemoDeploymentHistoryRow = {
        id: makeId('dep-demo'),
        name: payload.name || `${payload.serverType}-demo`,
        version: String(demoDeploymentHistoryStore.length + 1),
        server_type: payload.serverType,
        checksum: `sha256:${Math.random().toString(16).slice(2, 14)}`,
        created_at: new Date().toISOString()
    };
    demoDeploymentHistoryStore.unshift(row);
    return clone({ success: true, data: { deploymentId: row.id } });
};

export const getDemoDownloadUrl = (deploymentId: string, format: 'conf' | 'env' | 'bundle' = 'bundle') =>
    `#demo-download-${deploymentId}-${format}`;

const progressDemoScanTasks = () => {
    const now = Date.now();
    demoScanTasksStore = demoScanTasksStore.map((task) => {
        if (task.status !== 'pending' && task.status !== 'running') {
            return task;
        }

        const ageMs = now - new Date(task.createdAt).getTime();
        if (ageMs > 7_000) {
            return {
                ...task,
                status: 'completed',
                phase: 'done',
                progress: 100,
                completedAt: new Date().toISOString()
            };
        }

        if (ageMs > 4_000) {
            return {
                ...task,
                status: 'running',
                phase: 'nuclei-scan',
                progress: 82
            };
        }

        return {
            ...task,
            status: 'running',
            phase: 'host-scan',
            progress: 46
        };
    });
};

export const createDemoScanTask = () => {
    const id = makeId('scan-demo');
    const task: DemoScanTask = {
        id,
        status: 'pending',
        phase: 'queued',
        progress: 5,
        error: null,
        createdAt: new Date().toISOString(),
        urlFindings: [
            { target: 'https://demo-target.local/login', severity: 'high', title: 'Reflected input path', description: 'Demo scanner found reflected parameter sink.', sourceEngine: 'url-analyzer', createdAt: new Date().toISOString() }
        ],
        hostFindings: [
            { target: 'localhost:22', severity: 'medium', title: 'SSH exposed', description: 'Service is reachable in local scan profile.', sourceEngine: 'host-analyzer', createdAt: new Date().toISOString() }
        ],
        nucleiFindings: [
            { target: 'demo-target.local', severity: 'critical', title: 'Admin console fingerprint', description: 'Demo nuclei signature matched admin panel route.', sourceEngine: 'nuclei', createdAt: new Date().toISOString() }
        ]
    };
    demoScanTasksStore.unshift(task);
    return clone({ success: true, data: { taskId: id } });
};

export const getDemoScanTask = (id: string) => {
    progressDemoScanTasks();
    const task = demoScanTasksStore.find((row) => row.id === id);
    return clone({
        success: Boolean(task),
        data: task
            ? {
                  id: task.id,
                  status: task.status,
                  phase: task.phase,
                  progress: task.progress,
                  error: task.error,
                  createdAt: task.createdAt,
                  completedAt: task.completedAt
              }
            : null
    });
};

export const getDemoScanTaskResults = (id: string) => {
    progressDemoScanTasks();
    const task = demoScanTasksStore.find((row) => row.id === id);
    const findings = task ? normalizeDemoScanTaskFindings(task) : [];
    return clone({
        success: Boolean(task),
        data: task
            ? {
                  findings,
                  assetGroups: buildDemoScanAssetGroups(findings),
                  timeline: [
                      {
                          eventType: 'task-state',
                          payload: {
                              status: task.status,
                              phase: task.phase,
                              progress: task.progress
                          },
                          createdAt: task.completedAt || task.createdAt
                      }
                  ],
                  urlFindings: task.urlFindings,
                  hostFindings: task.hostFindings,
                  nucleiFindings: task.nucleiFindings
                }
            : { findings: [], assetGroups: [], timeline: [], urlFindings: [], hostFindings: [], nucleiFindings: [] }
    });
};

export const getDemoScanHistory = (limit: number = 20) => {
    progressDemoScanTasks();
    return clone(
        demoScanTasksStore.slice(0, limit).map((task) => ({
            id: task.id,
            status: task.status,
            phase: task.phase,
            progress: task.progress,
            createdAt: task.createdAt,
            completedAt: task.completedAt
        }))
    );
};

export const cancelDemoScanTask = (id: string) => {
    demoScanTasksStore = demoScanTasksStore.map((task) =>
        task.id === id ? { ...task, status: 'cancelled', phase: 'done', progress: 100 } : task
    );
    return clone({ success: true });
};

export const updateDemoAlertStatus = (alertId: string, status: 'acknowledged' | 'investigating' | 'resolved' | 'suppressed') => {
    demoAlertsStore = demoAlertsStore.map((alert) => (
        alert.id === alertId
            ? {
                  ...alert,
                  status,
                  time: 'Just now',
                  timestamp: new Date().toISOString()
              }
            : alert
    ));
    return clone({ success: true });
};

export const getDemoDeviceConfig = (deviceId: string) => {
    const device = demoDevicesStore.find((row) => row.deviceId === deviceId);
    return clone({
        success: Boolean(device),
        config: device?.config || null,
        commandHistory: getDemoDeviceCommands(deviceId)
    });
};

export const saveDemoDeviceConfig = (deviceId: string, payload: Partial<DemoDeviceConfig>) => {
    const now = new Date().toISOString();
    const device = demoDevicesStore.find((row) => row.deviceId === deviceId);
    if (!device) {
        throw new Error('FG-DEMO-DEVICE-404');
    }

    const nextConfig: DemoDeviceConfig = {
        ...(device.config as DemoDeviceConfig),
        ...payload,
        updatedAt: now,
        commandPermissions: Array.isArray(payload.commandPermissions) ? payload.commandPermissions : device.config?.commandPermissions || [],
        tags: Array.isArray(payload.tags) ? payload.tags : device.config?.tags || []
    };

    syncDemoDevice(deviceId, { config: nextConfig });
    demoDeviceEventsStore[deviceId] = [
        {
            id: makeId('evt-demo'),
            deviceId,
            type: 'command',
            payload: { action: 'sync-config', status: 'completed', updatedAt: now, config: nextConfig },
            timestamp: now
        },
        ...(demoDeviceEventsStore[deviceId] || [])
    ].slice(0, 20);

    const command: DemoDeviceCommand = {
        id: makeId('cmd-demo'),
        deviceId,
        command: 'sync-config',
        status: 'completed',
        message: 'Device configuration saved.',
        executedBy: 'demo-user',
        createdAt: now,
        completedAt: now
    };
    demoDeviceCommandsStore[deviceId] = [command, ...(demoDeviceCommandsStore[deviceId] || [])].slice(0, 20);
    syncDemoDevice(deviceId, { latestCommand: command });

    return clone({ success: true, config: nextConfig, commandHistory: demoDeviceCommandsStore[deviceId] });
};

export const sendDemoDeviceCommand = (deviceId: string, command: string) => {
    const device = demoDevicesStore.find((row) => row.deviceId === deviceId);
    if (!device) {
        throw new Error('FG-DEMO-DEVICE-404');
    }

    if (!device.isOnline) {
        throw new Error('FG-DEMO-DEVICE-OFFLINE');
    }

    const physicalCommands = new Set([
        'reboot',
        'host_remove',
        'host_install',
        'recovery_flash',
        'factory_reset',
        'ota_update',
        'deploy_bundle',
        'wipe_data',
        'diagnostic_unlock',
        'critical_config_change'
    ]);
    const now = new Date().toISOString();
    const isPhysical = physicalCommands.has(command);
    const record: DemoDeviceCommand = {
        id: makeId('cmd-demo'),
        deviceId,
        command,
        status: isPhysical
            ? 'queued'
            : 'completed',
        message: isPhysical
            ? 'Waiting for hardware confirmation.'
            : command === 'reboot'
                ? 'Device rebooted and reported healthy.'
                : 'Telemetry collection completed.',
        executedBy: 'demo-user',
        createdAt: now,
        completedAt: isPhysical ? undefined : now
    };

    demoDeviceCommandsStore[deviceId] = [record, ...(demoDeviceCommandsStore[deviceId] || [])].slice(0, 20);
    demoDeviceEventsStore[deviceId] = [
        {
            id: makeId('evt-demo'),
            deviceId,
            type: 'command',
            payload: { action: command, status: record.status, message: record.message },
            timestamp: now
        },
        ...(demoDeviceEventsStore[deviceId] || [])
    ].slice(0, 20);

    syncDemoDevice(deviceId, {
        latestCommand: record,
        lastHeartbeat: now,
        freeHeap: Math.max(64_000, device.freeHeap - (command === 'collect' ? 2_048 : 512)),
        status: {
            ...device.status,
            cpuUsage: command === 'reboot' ? Math.max(6, Math.round(device.status.cpuUsage * 0.6)) : Math.min(95, device.status.cpuUsage + 4),
            uptime: command === 'reboot' ? 0 : device.status.uptime + 30
        }
    });

    return clone({
        success: true,
        message: record.message,
        status: isPhysical ? 'approval_required' : 'completed',
        confirmationSessionId: isPhysical ? makeId('sess-demo') : null,
        command: record,
        latestCommand: record
    });
};

export const runDemoAttackSimulation = (attackIds?: string[]): AttackSimulationReport => {
    const selectedIds = attackIds?.length ? attackIds : demoAttackTypesBase.map((item) => item.id);
    const results = demoAttackTypesBase
        .filter((item) => selectedIds.includes(item.id))
        .map((item, index) => ({
            attackId: item.id,
            attackName: item.name,
            category: item.category,
            severity: item.severity,
            blocked: index % 5 !== 0,
            responseTime: Math.floor(Math.random() * 140) + 30,
            statusCode: index % 5 !== 0 ? 403 : 200
        }));

    const report: AttackSimulationReport = {
        total: results.length,
        blocked: results.filter((item) => item.blocked).length,
        allowed: results.filter((item) => !item.blocked).length,
        errors: 0,
        results,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString()
    };
    demoAttackHistoryStore.unshift(report);
    return clone(report);
};
