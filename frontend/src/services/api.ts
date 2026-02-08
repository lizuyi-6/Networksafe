import { DashboardStats, LogItem } from '../types/api';

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
    // Force real mode by default for now
    return false;
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
                message: 'Multiple UNION SELECT payloads detected from IP 203.15.44.12 targeting /api/v1/auth/login. Firewall has blocked 45 attempts.',
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
