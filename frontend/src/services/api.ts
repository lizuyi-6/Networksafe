import i18n from '../i18n';
import {
    DashboardStats,
    LogItem,
    MultiAgentSystemStats,
    TrafficStats,
    FlowInfo,
    AttackType,
    AttackSimulationReport
} from '../types/api';

export const API_BASE_URL = '/api';


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


// --- API Functions ---

export const fetchStats = async (): Promise<DashboardStats | null> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/stats`);
        if (!response.ok) throw new Error(i18n.t('api.fetch_failed'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch stats:', e);
        return null;
    }
};

export const fetchSystemBadges = async () => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/stats/badges`);
        if (!response.ok) return { agents: 0, alerts: 0, devices: 0 };
        return response.json();
    } catch (e) {
        console.error('Failed to fetch system badges:', e);
        return { agents: 0, alerts: 0, devices: 0 };
    }
};

export const fetchSites = async () => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/sites`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_sites'));
        const json = await response.json();
        return json?.data || [];
    } catch (e) {
        console.error('Failed to fetch sites:', e);
        return [];
    }
};

export const fetchLogs = async (): Promise<LogItem[] | null> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/logs`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_logs'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch logs:', e);
        return null;
    }
};

export const fetchScannerResults = async () => {
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
        throw new Error(i18n.t('api.failed_to_generate_deployment_config'));
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
        throw new Error(i18n.t('api.failed_to_save_deployment_config'));
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
        throw new Error(i18n.t('api.failed_to_fetch_scan_task'));
    }
    return response.json();
};

export const fetchScanTaskResults = async (taskId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}/results`);
    if (!response.ok) {
        throw new Error(i18n.t('api.failed_to_fetch_scan_task_results'));
    }
    return response.json();
};

export const cancelScanTask = async (taskId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}/cancel`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(i18n.t('api.failed_to_cancel_scan_task'));
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
    try {
        const errRes = await fetchWithCredentials(`${API_BASE_URL}/admin/errors`);
        const perfRes = await fetchWithCredentials(`${API_BASE_URL}/admin/performance`);

        if (!errRes.ok || !perfRes.ok) {
            throw new Error(i18n.t('api.failed_to_fetch_admin_data'));
        }

        return {
            errors: await errRes.json(),
            performance: await perfRes.json()
        };
    } catch (e) {
        console.error('Failed to fetch admin data:', e);
        return null;
    }
};

export const fetchAlerts = async () => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/alerts`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_alerts'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch alerts:', e);
        return null;
    }
};

// --- Multi-Agent System API ---


export const fetchAgentSystemStats = async (): Promise<MultiAgentSystemStats | null> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/agents/stats`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_agent_stats'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch agent system stats:', e);
        return null;
    }
};

export const fetchAgentHealth = async () => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/agents/health`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_agent_health'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch agent health:', e);
        return { status: 'unknown', details: {} };
    }
};

// --- Traffic Interceptor API ---

export const fetchTrafficStats = async (): Promise<TrafficStats | null> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/stats`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_traffic_stats'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch traffic stats:', e);
        return null;
    }
};

export const fetchActiveFlows = async (): Promise<FlowInfo[]> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/flows`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch active flows:', e);
        return [];
    }
};

export const fetchProtocolDistribution = async () => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/protocols`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_protocol_distribution'));
        return response.json();
    } catch (e) {
        console.error('Failed to fetch protocol distribution:', e);
        return { http: 0, https: 0, dns: 0, other: 0 };
    }
};

export const fetchThreatDetections = async () => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/threats`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch threat detections:', e);
        return [];
    }
};

// --- Attack Simulator API ---



export const fetchAttackTypes = async (): Promise<AttackType[]> => {
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
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/simulate`, {
            method: 'POST',
            body: JSON.stringify({ attackIds })
        });
        if (!response.ok) throw new Error(i18n.t('api.failed_to_run_attack_simulation'));
        return response.json();
    } catch (e) {
        console.error('Failed to run attack simulation:', e);
        return null;
    }
};

export const fetchAttackHistory = async (): Promise<AttackSimulationReport[]> => {
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

// --- AI Model Access (订阅层级感知) ---

export interface AIModelInfo {
    id: string;
    name: string;
    description: string;
    category: 'qwen' | 'third-party';
    maxTokens: number;
    available: boolean;
    minTier: 'starter' | 'pro' | 'ultra';
    isDefault: boolean;
}

export interface ModelsResponse {
    success: boolean;
    plan: string;
    canCustomize: boolean;
    models: AIModelInfo[];
    defaultModelId: string;
}

export const fetchAvailableModels = async (): Promise<ModelsResponse> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints/models?t=${Date.now()}`);
    if (!response.ok) {
        throw new Error(`FG-AI-MODELS-LIST-${response.status}`);
    }
    return response.json();
};

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatResponse {
    success: boolean;
    content: string;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
    latency: number;
}

export const sendChatMessage = async (modelId: string, messages: ChatMessage[]): Promise<ChatResponse> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints/chat`, {
        method: 'POST',
        body: JSON.stringify({ modelId, messages })
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `FG-AI-CHAT-${response.status}`);
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

export const fetchAdminUsersList = async () => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users`);
    if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_admin_users'));
    return response.json();
};

export const updateAdminUserPlan = async (userId: string, plan: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/plan`, {
        method: 'PUT',
        body: JSON.stringify({ plan })
    });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_update_plan'));
    return response.json();
};

export const updateAdminUserRole = async (userId: string, role: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role })
    });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_update_role'));
    return response.json();
};

export const updateAdminUserStatus = async (userId: string, status: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_update_status'));
    return response.json();
};
