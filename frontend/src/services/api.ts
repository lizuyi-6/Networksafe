import i18n from '../i18n';
import { isDemoModeActive } from '../config/demo-mode';
import {
    setSessionUserIdentity,
} from './session-cache';
import {
    DashboardStats,
    LogItem,
    MultiAgentSystemStats,
    TrafficStats,
    FlowInfo,
    AttackType,
    AttackSimulationReport,
    AlertRecord,
    SecurityFinding,
    ScanAssetGroup,
    RuleRecord,
    RuleCandidateRecord,
    DetectionEventRecord,
    RuleSummary
} from '../types/api';
import {
    cancelDemoScanTask,
    createDemoAIEndpoint,
    createDemoAdminApiKey,
    createDemoAgentOnboardingCode,
    createDemoScanTask,
    getDemoDeviceConfig,
    deleteDemoAdminApiKey,
    deleteDemoAIEndpoint,
    generateDemoDeploymentConfig,
    getDemoActiveFlows,
    getDemoAdminApiKeys,
    getDemoAdminOversightEvidence,
    getDemoAdminOversightExport,
    getDemoAdminOversightSummary,
    getDemoAdminOversightTenants,
    getDemoAdminOversightTimeline,
    getDemoAdminUsers,
    getDemoAgentHealth,
    getDemoAgentOnboardingCodes,
    getDemoAgents,
    getDemoAIEndpoints,
    getDemoAgentSystemStats,
    getDemoAlerts,
    getDemoAttackHistory,
    getDemoAttackTypes,
    getDemoDeploymentHistory,
    getDemoDeviceDetail,
    getDemoDeviceEvents,
    getDemoDevices,
    getDemoDownloadUrl,
    getDemoFixHistory,
    getDemoFixHistoryDetail,
    getDemoLogs,
    getDemoProtocolDistribution,
    getDemoRegisteredAgents,
    getDemoRecentAgentThreats,
    getDemoScanHistory,
    getDemoScanTask,
    getDemoScanTaskResults,
    getDemoSites,
    getDemoStats,
    getDemoSystemBadges,
    getDemoThreatDetections,
    getDemoTrafficStats,
    revokeDemoAgentCredential,
    runDemoAttackSimulation,
    saveDemoDeviceConfig,
    sendDemoDeviceCommand,
    saveDemoDeploymentConfig,
    testDemoAIEndpoint,
    updateDemoAlertStatus,
    updateDemoAdminUser,
    verifyDemoAdminAuditLog,
    updateDemoAIEndpoint
} from './demo-data';

export const API_BASE_URL = '/api';
const shouldUseDemoData = (): boolean => isDemoModeActive();

const demoState = {
    statsOffset: { totalRequests: 0, threatsBlocked: 0 },
    trafficOffset: { packetsProcessed: 0, packetsAllowed: 0, packetsBlocked: 0, packetsInspected: 0, bytesProcessed: 0, activeConnections: 0 },
    agentOffset: { queueSize: 0, totalCaseFiles: 0, lessonsLearned: 0, policyUpdates: 0, totalMessages: 0 }
};

const applyDemoJitter = () => {
    if (!isDemoModeActive()) return;
    if (Math.random() > 0.1) { // 90% chance to bounce
        const reqInc = Math.floor(Math.random() * 120) + 10;
        const threatInc = Math.random() > 0.7 ? Math.floor(Math.random() * 5) + 1 : 0;

        demoState.statsOffset.totalRequests += reqInc;
        demoState.statsOffset.threatsBlocked += threatInc;

        demoState.trafficOffset.packetsProcessed += reqInc * 15;
        demoState.trafficOffset.packetsAllowed += (reqInc - threatInc) * 15;
        demoState.trafficOffset.packetsBlocked += threatInc * 15;
        demoState.trafficOffset.packetsInspected += reqInc * 15;
        demoState.trafficOffset.bytesProcessed += reqInc * 1024 * (Math.random() * 8 + 2);

        const connChange = Math.floor(Math.random() * 31) - 15;
        demoState.trafficOffset.activeConnections += connChange;

        demoState.agentOffset.queueSize = Math.max(0, demoState.agentOffset.queueSize + Math.floor(Math.random() * 7) - 3);
        demoState.agentOffset.totalCaseFiles += threatInc;
        if (Math.random() > 0.7) demoState.agentOffset.lessonsLearned += 1;
        if (Math.random() > 0.8) demoState.agentOffset.policyUpdates += 1;
        demoState.agentOffset.totalMessages += Math.floor(Math.random() * 150) + 30;
    }
};


// In-memory token storage for development (cookie fallback)
let _accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
    _accessToken = token;
};

const getAuthHeaders = () => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    // In dev, also send Authorization header as cookie fallback
    if (_accessToken) {
        headers['Authorization'] = `Bearer ${_accessToken}`;
    }
    return headers;
};

// SECURITY FIX: Fetch options with credentials for httpOnly cookies
const _fetchBase = (url: string, options: RequestInit = {}) => {
    return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
            ...getAuthHeaders(),
            ...options.headers
        }
    });
};

let isRefreshing = false;
let refreshSubscribers: ((success: boolean) => void)[] = [];

const doRefresh = async (): Promise<boolean> => {
    try {
        const response = await _fetchBase(`${API_BASE_URL}/auth/refresh`, { method: 'POST' });
        return response.ok;
    } catch {
        return false;
    }
};

const fetchWithAutoRefresh = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const response = await _fetchBase(url, options);

    if (response.status !== 401 || url.includes('/auth/refresh') || url.includes('/health/') || url.includes('/auth/login')) {
        return response;
    }

    if (!isRefreshing) {
        isRefreshing = true;
        const success = await doRefresh();
        isRefreshing = false;
        refreshSubscribers.forEach(cb => cb(success));
        refreshSubscribers = [];
        if (!success) {
            setSessionUserIdentity(null);
            setAccessToken(null);
            return response;
        }
        // Retry the original request after successful refresh
        return _fetchBase(url, options);
    }

    // Another refresh is in progress — wait for it
    return new Promise((resolve) => {
        refreshSubscribers.push((success: boolean) => {
            if (success) {
                resolve(_fetchBase(url, options));
            } else {
                resolve(response);
            }
        });
    });
};

const fetchWithCredentials = (url: string, options: RequestInit = {}) => {
    return fetchWithAutoRefresh(url, options);
};

type ApiEnvelope<T> = {
    success?: boolean;
    data?: T;
    error?: unknown;
    meta?: Record<string, any>;
};

const isApiEnvelope = <T>(payload: unknown): payload is ApiEnvelope<T> => (
    Boolean(payload)
    && typeof payload === 'object'
    && ('success' in (payload as Record<string, unknown>))
    && ('data' in (payload as Record<string, unknown>))
);

const unwrapApiEnvelope = <T>(payload: unknown): T => {
    if (isApiEnvelope<T>(payload) && payload.data !== undefined) {
        return payload.data as T;
    }
    return payload as T;
};

const readJson = async <T>(response: Response): Promise<T> => {
    const payload = await response.json().catch(() => null);
    return unwrapApiEnvelope<T>(payload);
};

export interface CurrentUserSession {
    userId: string;
    email: string;
    username: string;
    role: 'admin' | 'tenant' | 'viewer' | 'platform_admin' | 'tenant_admin' | 'tenant_operator' | 'tenant_viewer' | 'auditor';
    plan?: 'starter' | 'pro' | 'ultra';
    tenantId?: string;
    permissions?: string[];
    authProvider?: 'local' | 'oidc';
}

export interface LoginResponse {
    message?: string;
    user: CurrentUserSession;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
}

export interface ApiReadiness {
    ok: boolean;
    status: 'ready' | 'not_ready';
    blockers: string[];
}

export const fetchCurrentUserSession = async (signal?: AbortSignal): Promise<CurrentUserSession | null> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/auth/me`, { signal });
    if (!response.ok) {
        setSessionUserIdentity(null);
        return null;
    }

    const payload = await response.json().catch(() => null) as any;
    const data = unwrapApiEnvelope<{ user?: CurrentUserSession }>(payload);
    const user = data?.user || payload?.user || null;
    setSessionUserIdentity(user);
    return user;
};

const extractErrorMessage = (payload: any, fallback: string): string => {
    if (typeof payload?.error === 'string') {
        return payload.error;
    }

    if (payload?.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
        return payload.error.message;
    }

    if (typeof payload?.message === 'string') {
        return payload.message;
    }

    return fallback;
};

export const login = async (
    credentials: { email: string; password: string },
    signal?: AbortSignal
): Promise<LoginResponse> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        signal,
        body: JSON.stringify(credentials)
    });

    const payload = await response.json().catch(() => null) as any;
    const data = unwrapApiEnvelope<Partial<LoginResponse>>(payload);

    if (!response.ok) {
        setSessionUserIdentity(null);
        throw new Error(extractErrorMessage(payload, `FG-AUTH-LOGIN-${response.status}`));
    }

    const user = data?.user || payload?.user;
    if (!user) {
        throw new Error('FG-AUTH-LOGIN-USER-MISSING');
    }

    setSessionUserIdentity(user);
    setAccessToken(data?.accessToken || payload?.accessToken || null);
    return {
        message: data?.message || payload?.message,
        user,
        accessToken: data?.accessToken || payload?.accessToken,
        refreshToken: data?.refreshToken || payload?.refreshToken,
        expiresIn: data?.expiresIn || payload?.expiresIn
    };
};

export const loginWithOidc = async (): Promise<{ authorizationUrl: string }> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/auth/oidc/login`);
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `FG-AUTH-OIDC-LOGIN-${response.status}`));
    }
    const data = unwrapApiEnvelope<{ authorizationUrl: string }>(payload);
    return {
        authorizationUrl: data.authorizationUrl
    };
};

export const logout = async (signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        signal
    });

    const payload = await response.json().catch(() => null) as any;
    setSessionUserIdentity(null);
    setAccessToken(null);

    if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `FG-AUTH-LOGOUT-${response.status}`));
    }

    return unwrapApiEnvelope<{ message?: string }>(payload);
};

export const fetchApiReadiness = async (signal?: AbortSignal): Promise<ApiReadiness> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/health/ready`, { signal });
    const payload = await response.json().catch(() => null) as any;
    const data = unwrapApiEnvelope<{ status?: 'ready' | 'not_ready'; blockers?: string[] }>(payload);
    // Treat 503 as "reachable but not ready" - still proceed with auth check
    // since auth endpoints may work even when other services (postgres) are down
    const is503 = response.status === 503;
    return {
        ok: response.ok || is503,
        status: data?.status || payload?.status || 'not_ready',
        blockers: Array.isArray(data?.blockers) ? data.blockers : Array.isArray(payload?.blockers) ? payload.blockers : []
    };
};

type LegacyScanFinding = {
    target?: string;
    severity?: 'critical' | 'high' | 'medium' | 'low';
    title?: string;
    description?: string;
    sourceEngine?: string;
    createdAt?: string;
};

const normalizeLegacyScannerFindings = (data: {
    findings?: SecurityFinding[];
    urlFindings?: LegacyScanFinding[];
    hostFindings?: LegacyScanFinding[];
    nucleiFindings?: LegacyScanFinding[];
} | null | undefined): SecurityFinding[] => {
    if (Array.isArray(data?.findings) && data.findings.length > 0) {
        return data.findings;
    }

    const merged = [...(data?.urlFindings || []), ...(data?.hostFindings || []), ...(data?.nucleiFindings || [])];
    return merged.map((finding, index) => ({
        findingId: `legacy-${index}`,
        assetId: undefined,
        sourceType: 'scanner',
        sourceRef: '',
        target: finding.target || 'unknown',
        category: finding.sourceEngine || 'scanner',
        severity: finding.severity || 'medium',
        status: 'open',
        title: finding.title || 'Untitled finding',
        description: finding.description || '',
        evidence: {},
        remediation: {},
        occurrenceCount: 1,
        firstSeenAt: finding.createdAt || new Date().toISOString(),
        lastSeenAt: finding.createdAt || new Date().toISOString()
    }));
};

const buildScanAssetGroups = (findings: SecurityFinding[]): ScanAssetGroup[] => (
    findings.reduce<ScanAssetGroup[]>((groups, finding) => {
        const existing = groups.find((group) => group.assetId === finding.assetId && group.target === finding.target);
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

const normalizeScanTaskResultsPayload = <T extends { data?: any }>(payload: T): T => {
    if (!payload?.data) {
        return payload;
    }

    const findings = normalizeLegacyScannerFindings(payload.data);
    const assetGroups = Array.isArray(payload.data.assetGroups) && payload.data.assetGroups.length > 0
        ? payload.data.assetGroups
        : buildScanAssetGroups(findings);

    return {
        ...payload,
        data: {
            ...payload.data,
            findings,
            assetGroups
        }
    };
};

export const isRequestAbortError = (error: unknown, signal?: AbortSignal) => {
    if (signal?.aborted) {
        return true;
    }

    if (!error || typeof error !== 'object') {
        return false;
    }

    const value = error as { name?: string; message?: string };
    const message = `${value.name || ''} ${value.message || ''}`.toLowerCase();
    return value.name === 'AbortError' || /abort|aborted|cancelled|canceled/.test(message);
};

export type SystemMode = 'production' | 'demo';

export interface SystemModeResponse {
    appMode: SystemMode;
    demoEnabled: boolean;
    attackSimEnabled: boolean;
    canToggleMode?: boolean;
    devLoginEnabled?: boolean;
    passwordLoginEnabled?: boolean;
    oidcEnabled?: boolean;
    enterpriseRuntimeMode?: 'prod-enterprise' | 'trial' | 'lab';
    demoModeAllowed?: boolean;
    enterpriseStrictMode?: boolean;
    profile?: string;
    dbMode?: string;
}

export interface SystemBadges {
    agents: number;
    alerts: number;
    devices: number;
    agentMonitor: number;
    traffic: number;
    scanner: number;
}

export interface ActionResponse {
    success: boolean;
    message?: string;
    status?: string;
    updatedAt?: string;
    refreshHints?: string[];
    jobId?: string;
    historyId?: string;
    [key: string]: any;
}

export type DeploymentTarget =
    | 'nginx'
    | 'apache'
    | 'caddy'
    | 'docker_compose'
    | 'binary_agent'
    | 'k8s_daemonset';

export interface HardwareGateRecord {
    gateId: string;
    tenantId: string;
    displayName: string;
    algorithm: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    lastSeenAt?: string;
    metadata?: Record<string, any>;
}

export type InterlockState = 'isolated' | 'armed' | 'released' | 'fault' | 'disabled' | 'unknown';

export interface FinalDefensePolicyRecord {
    policyId: string;
    tenantId: string;
    companionId: string;
    gateId: string;
    policyDigest: string;
    allowedActions: Array<{
        commandType: string;
        scriptPath?: string;
        maxExecutionMs?: number;
        requiresInterlockRelease?: boolean;
    }>;
    breakerTarget: string;
    releaseTtlMs: number;
    createdAt: string;
    updatedAt: string;
    status: 'active' | 'staged' | 'revoked';
}

export interface FinalDefenseStatusRecord {
    tenantId: string;
    companionId: string;
    gateId: string;
    policyId?: string;
    policyDigest?: string;
    reportedPolicyDigest?: string;
    breakerTarget?: string;
    interlockState: InterlockState;
    externalPowerPresent: boolean;
    secureElementPresent: boolean;
    feedbackOk: boolean;
    companionOnline: boolean;
    lastHeartbeatAt?: string;
    lastVerifiedAt?: string;
    lastError?: string;
    active: boolean;
    degradedReasons: string[];
    createdAt: string;
    updatedAt: string;
}

export interface FinalDefenseStatusResponse {
    active: boolean;
    mode: 'active' | 'degraded' | 'not_configured';
    statuses: FinalDefenseStatusRecord[];
    policies: FinalDefensePolicyRecord[];
}

export interface DeploymentRunRecord {
    id: string;
    tenantId: string;
    helperId: string;
    gateId: string;
    requestType: 'install' | 'remove';
    serverType: DeploymentTarget;
    status: string;
    bundleChecksum: string;
    checksumShortCode: string;
    requestedBy: string;
    approvedBy?: string;
    backupRef?: string;
    hardwareGrantId?: string;
    evidenceStatus: 'pending' | 'ready' | 'failed';
    evidenceArtifactRef?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    lastError?: string;
}

export interface DeploymentHelperRecord {
    helperId: string;
    tenantId: string;
    fingerprint: string;
    version: string;
    hostname: string;
    systemdStatus: string;
    writablePaths: string[];
    targetHost: string;
    status: 'online' | 'offline' | 'stale';
    createdAt: string;
    updatedAt: string;
    lastHeartbeatAt?: string;
}

export interface DeploymentEvidenceResponse {
    run: DeploymentRunRecord;
    payload: Record<string, any>;
}

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';
export type NotificationChannelType = 'email' | 'smtp' | 'slack_webhook' | 'generic_webhook';
export type AIRoutingMode = 'cloud_only' | 'local_preferred' | 'local_only' | 'hybrid_verify';
export type PrivacyMode = 'off' | 'strict';
export type DetectionAIEscalationMode = 'high_risk_allowed_only' | 'all_allowed' | 'disabled';
export type DetectionLearningMode = 'malicious_review_queue' | 'passive_observe' | 'active_block';

export interface NotificationChannelConfig {
    id: string;
    name: string;
    type: NotificationChannelType;
    enabled: boolean;
    target: string;
    minimumSeverity: SeverityLevel;
    headers: Record<string, string>;
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: string;
        from: string;
    };
}

export interface PlatformConfigResponse {
    antiBot: {
        enabled: boolean;
        requestThreshold: number;
        fastRequestThreshold: number;
        blockDuration: number;
    };
    rateLimit: {
        requestsPerMinute: number;
        windowSeconds: number;
    };
    notifications: {
        enabled: boolean;
        dedupeWindowSeconds: number;
        retryDelaysSeconds: number[];
        channels: NotificationChannelConfig[];
    };
    aiRouting: {
        mode: AIRoutingMode;
        localEndpointId: string | null;
        localHotPathEndpointId: string | null;
        cloudEndpointId: string | null;
        fallbackAllowed: boolean;
        redactionEnabled: boolean;
    };
    privacyMode: PrivacyMode;
    auditArchive: {
        bucket: string;
        retentionDays: number;
        objectLockRequired: boolean;
        verifyIntervalMinutes: number;
    };
    fastpath: {
        enabled: boolean;
        baseUrl: string;
        transport: 'tcp' | 'unix';
        socketPath: string | null;
        timeoutMs: number;
        fallbackEnabled: boolean;
        trafficShadowEnabled: boolean;
        trafficShadowSampleRatePct: number;
        trafficMaxBodyBytes: number;
        configCacheTtlMs: number;
    };
    detectionPipeline: {
        ruleFirstEnabled: boolean;
        aiEscalationMode: DetectionAIEscalationMode;
        classificationLevel: 'standard' | 'elevated' | 'maximum';
        blockingDiscussionTimeoutMs: number;
        hotPathRouteMode: AIRoutingMode;
        asyncReviewEnabled: boolean;
        blockingReviewForHighRiskActions: boolean;
        enableHttpApi: boolean;
        enablePacketInterceptor: boolean;
        enableAgentAsyncReview: boolean;
        aiEscalationThreshold: number;
        candidateMinConfidence: number;
        learningMode: DetectionLearningMode;
    };
    deploymentDefaults: {
        serverType: DeploymentTarget;
        profileTemplates: Record<DeploymentTarget, {
            port: number;
            serverName: string;
            rateLimit: number;
            upstream: string;
            namespace: string;
            image: string;
        }>;
    };
    deviceGateway: {
        primaryPath: string;
        aliases: string[];
        syncMaskApiKeys: boolean;
        firmwareLocalHost: string;
        wifiSSID: string;
        localPort: number;
        firmwareChannel: string;
        firmwareRetentionDays: number;
        statusAliasEnabled: boolean;
    };
}

export interface NotificationDelivery {
    id: string;
    alertId?: string;
    channelId: string;
    channelType: NotificationChannelType;
    channelLabel: string;
    status: 'queued' | 'sending' | 'retrying' | 'sent' | 'failed' | 'skipped';
    severity: SeverityLevel;
    target: string;
    payload: Record<string, any>;
    response: Record<string, any>;
    error?: string;
    attemptCount: number;
    dedupeKey?: string;
    nextAttemptAt?: string;
    terminalAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface DeviceConfigurationPayload {
    displayName: string;
    group: string;
    site: string;
    networkProfile: string;
    scanProfile: string;
    notes: string;
    commandPermissions: string[];
    tags: string[];
    updatedAt?: string;
}

export const getAttackRunRouteId = (report: { id?: string; startTime?: string }) =>
    encodeURIComponent(report.id || report.startTime || 'unknown');

export const fetchSystemMode = async (signal?: AbortSignal): Promise<SystemModeResponse> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/system/mode`, { signal });
    if (!response.ok) {
        throw new Error(`FG-SYSTEM-MODE-${response.status}`);
    }
    return readJson<SystemModeResponse>(response);
};

export const fetchSystemCapabilities = async (signal?: AbortSignal): Promise<SystemModeResponse> => {
    return fetchSystemMode(signal);
};

export const switchSystemMode = async (appMode: SystemMode, options?: {
    seedDemoData?: boolean;
    clearExisting?: boolean;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/system/mode`, {
        method: 'POST',
        body: JSON.stringify({
            appMode,
            seedDemoData: options?.seedDemoData ?? false,
            clearExisting: options?.clearExisting ?? false
        })
    });
    if (!response.ok) {
        let message = `FG-SYSTEM-MODE-SWITCH-${response.status}`;
        try {
            const data = await response.json();
            message = data?.message || data?.error || message;
        } catch {
            // ignore parse error
        }
        throw new Error(message);
    }
    return readJson<SystemModeResponse & { seeded?: boolean }>(response);
};

// --- API Functions ---

export const fetchStats = async (signal?: AbortSignal): Promise<DashboardStats | null> => {
    try {
        if (shouldUseDemoData()) {
            return getDemoStats();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/stats`, { signal });
        if (!response.ok) throw new Error(i18n.t('api.fetch_failed'));
        const data = await response.json();
        return data;
    } catch (e) {
        if (!isRequestAbortError(e, signal)) {
            console.error('Failed to fetch stats:', e);
        }
        return null;
    }
};

export const fetchSystemBadges = async (signal?: AbortSignal): Promise<SystemBadges> => {
    try {
        if (shouldUseDemoData()) {
            return getDemoSystemBadges();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/stats/badges`, { signal });
        if (!response.ok) return { agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 };
        return response.json();
    } catch (e) {
        if (!isRequestAbortError(e, signal)) {
            console.warn('Failed to fetch system badges:', e);
        }
        return { agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 };
    }
};

export const fetchSites = async () => {
    try {
        if (shouldUseDemoData()) {
            return getDemoSites();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/sites`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_sites'));
        const json = await response.json();
        return json?.data || [];
    } catch (e) {
        console.error('Failed to fetch sites:', e);
        return [];
    }
};

export const fetchLogs = async (signal?: AbortSignal): Promise<LogItem[] | null> => {
    try {
        if (shouldUseDemoData()) {
            return getDemoLogs();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/logs`, { signal });
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_logs'));
        return response.json();
    } catch (e) {
        if (!isRequestAbortError(e, signal)) {
            console.error('Failed to fetch logs:', e);
        }
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
    serverType: DeploymentTarget;
    profile: {
        port: number;
        serverName: string;
        rateLimit: number;
        upstream: string;
        namespace?: string;
        image?: string;
    };
    siteId?: string;
}) => {
    if (shouldUseDemoData()) {
        return generateDemoDeploymentConfig(payload as any);
    }

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
    serverType: DeploymentTarget;
    profile: Record<string, any>;
    configText: string;
    envSnippet: string;
    siteId?: string;
    name?: string;
}) => {
    if (shouldUseDemoData()) {
        return saveDemoDeploymentConfig(payload as any);
    }

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
    if (shouldUseDemoData()) {
        return getDemoDeploymentHistory(limit);
    }

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

export const generateDeploymentBundle = async (payload: {
    serverType: DeploymentTarget;
    profile: Record<string, any>;
    deploymentId?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployments/generate-bundle`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(i18n.t('api.failed_to_generate_deployment_bundle'));
    }
    return response.json();
};

export const fetchEsp32Status = async () => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployments/esp32-status`);
    if (!response.ok) {
        return { success: false, connected: false };
    }
    return response.json();
};

export const getDeploymentDownloadUrl = (deploymentId: string, format: 'conf' | 'env' | 'bundle' = 'bundle') => {
    if (shouldUseDemoData()) {
        return getDemoDownloadUrl(deploymentId, format);
    }

    return `${API_BASE_URL}/deployments/${deploymentId}/download?format=${format}`;
};

const getDefaultPlatformConfig = (): PlatformConfigResponse => ({
    antiBot: {
        enabled: true,
        requestThreshold: 100,
        fastRequestThreshold: 10,
        blockDuration: 3600
    },
    rateLimit: {
        requestsPerMinute: 60,
        windowSeconds: 60
    },
    notifications: {
        enabled: true,
        dedupeWindowSeconds: 300,
        retryDelaysSeconds: [30, 300, 900],
        channels: []
    },
    aiRouting: {
        mode: 'local_only',
        localEndpointId: 'default-laptop',
        localHotPathEndpointId: null,
        cloudEndpointId: null,
        fallbackAllowed: false,
        redactionEnabled: true
    },
    privacyMode: 'off',
    auditArchive: {
        bucket: 'aetherguard-audit-lock',
        retentionDays: 30,
        objectLockRequired: true,
        verifyIntervalMinutes: 60
    },
    fastpath: {
        enabled: true,
        baseUrl: 'http://fastpath:8081',
        transport: 'tcp',
        socketPath: '/var/run/aetherguard-fastpath.sock',
        timeoutMs: 1500,
        fallbackEnabled: true,
        trafficShadowEnabled: false,
        trafficShadowSampleRatePct: 10,
        trafficMaxBodyBytes: 65536,
        configCacheTtlMs: 30000
    },
    detectionPipeline: {
        ruleFirstEnabled: true,
        aiEscalationMode: 'high_risk_allowed_only',
        classificationLevel: 'standard',
        blockingDiscussionTimeoutMs: 30000,
        hotPathRouteMode: 'local_only',
        asyncReviewEnabled: true,
        blockingReviewForHighRiskActions: true,
        enableHttpApi: true,
        enablePacketInterceptor: true,
        enableAgentAsyncReview: true,
        aiEscalationThreshold: 0.4,
        candidateMinConfidence: 0.85,
        learningMode: 'malicious_review_queue'
    },
    deploymentDefaults: {
        serverType: 'nginx',
        profileTemplates: {
            nginx: { port: 8080, serverName: 'api.example.com', rateLimit: 100, upstream: 'http://backend:3005', namespace: 'aetherguard', image: 'ghcr.io/aetherguard/agent:latest' },
            apache: { port: 8080, serverName: 'api.example.com', rateLimit: 100, upstream: 'http://backend:3005', namespace: 'aetherguard', image: 'ghcr.io/aetherguard/agent:latest' },
            caddy: { port: 8080, serverName: 'api.example.com', rateLimit: 100, upstream: 'http://backend:3005', namespace: 'aetherguard', image: 'ghcr.io/aetherguard/agent:latest' },
            docker_compose: { port: 8080, serverName: 'api.example.com', rateLimit: 100, upstream: 'http://backend:3005', namespace: 'aetherguard', image: 'ghcr.io/aetherguard/agent:latest' },
            binary_agent: { port: 8080, serverName: 'api.example.com', rateLimit: 100, upstream: 'http://backend:3005', namespace: 'aetherguard', image: 'ghcr.io/aetherguard/agent:latest' },
            k8s_daemonset: { port: 8080, serverName: 'api.example.com', rateLimit: 100, upstream: 'http://backend:3005', namespace: 'aetherguard', image: 'ghcr.io/aetherguard/agent:latest' }
        }
    },
    deviceGateway: {
        primaryPath: '/ws/device',
        aliases: ['/ws/status'],
        syncMaskApiKeys: true,
        firmwareLocalHost: '192.168.4.1',
        wifiSSID: 'AetherGuard-Setup',
        localPort: 8080,
        firmwareChannel: 'stable',
        firmwareRetentionDays: 30,
        statusAliasEnabled: true
    }
});

const demoRuleSummary = (): RuleSummary => ({
    totalRules: 4,
    activeRules: 4,
    pendingCandidates: 1,
    approvedCandidates: 1,
    rejectedCandidates: 1,
    ruleHitRate: 0.62,
    aiEscalationRate: 0.18,
    localModelHitRate: 0.16,
    avgProcessingTimeMs: 14.8,
    localAICount: 18,
    cloudAICount: 2,
    asyncReviewQueueDepth: 3,
    asyncReviewRunning: 1,
    asyncReviewCompleted: 14,
    asyncReviewFailed: 1,
    debateCompletionRate: 0.42,
    avgAsyncReviewLatencyMs: 1880,
    classificationLevel: 'elevated',
    blockingDiscussionCount: 6,
    blockingDiscussionFailClosed: 1,
    avgBlockingDiscussionLatencyMs: 412.6,
    topRules: [
        { ruleId: 'seed-http-sqli', name: 'SQLi UNION SELECT', severity: 'critical', hitCount: 12, source: 'seed' },
        { ruleId: 'candidate-agent-bruteforce', name: 'Agent credential spray', severity: 'high', hitCount: 6, source: 'candidate' }
    ]
});

const demoRules = (): RuleRecord[] => ([
    {
        ruleId: 'seed-http-sqli',
        tenantId: 'demo-tenant',
        name: 'SQLi UNION SELECT',
        description: 'Blocks classic UNION SELECT payloads on HTTP entrypoints.',
        scope: 'http_api',
        action: 'block',
        priority: 1000,
        severity: 'critical',
        matcher: { bodyIncludesAny: ['union select', 'information_schema'] },
        source: 'seed',
        enabled: true,
        attackFamily: 'sqli',
        version: 1,
        metadata: {}
    },
    {
        ruleId: 'dynamic-packet-path-traversal',
        tenantId: 'demo-tenant',
        name: 'Traversal packet signature',
        description: 'Reviews packet payloads that resemble traversal probes.',
        scope: 'packet',
        action: 'review',
        priority: 420,
        severity: 'medium',
        matcher: { evidenceIncludesAny: ['../', '..\\\\'] },
        source: 'dynamic',
        enabled: true,
        attackFamily: 'path_traversal',
        version: 3,
        metadata: {}
    },
    {
        ruleId: 'candidate-agent-bruteforce',
        tenantId: 'demo-tenant',
        name: 'Agent credential spray',
        description: 'Promoted from AI review after repeated malicious agent samples.',
        scope: 'agent',
        action: 'block',
        priority: 820,
        severity: 'high',
        matcher: { metadataMatches: { authFailureBurst: true } },
        source: 'candidate',
        enabled: true,
        attackFamily: 'automation',
        version: 1,
        metadata: {}
    },
    {
        ruleId: 'dynamic-http-xss',
        tenantId: 'demo-tenant',
        name: 'Reflected XSS review',
        description: 'Escalates suspicious reflected script payloads to AI review.',
        scope: 'http_api',
        action: 'review',
        priority: 450,
        severity: 'medium',
        matcher: { bodyIncludesAny: ['<script', 'javascript:'] },
        source: 'dynamic',
        enabled: true,
        attackFamily: 'xss',
        version: 2,
        metadata: {}
    }
]);

const demoRuleCandidates = (): RuleCandidateRecord[] => ([
    {
        candidateId: 'candidate-http-xss-1',
        tenantId: 'demo-tenant',
        channel: 'http_api',
        attackFamily: 'xss',
        name: 'Stored XSS admin panel probe',
        severity: 'high',
        matcher: { bodyIncludesAny: ['<script>alert(', 'onerror='] },
        matcherFingerprint: 'demo-xss-fingerprint',
        reasoning: 'AI observed repeated admin panel payloads that survived review rules and matched malicious reflected script behavior.',
        status: 'pending',
        sampleCount: 3,
        aiConfidence: 0.93,
        latestEvidence: {
            request: { method: 'POST', path: '/admin/widgets', sourceIp: '203.0.113.20' },
            ai: { verdict: 'malicious', routeMode: 'local_preferred', model: 'demo-local' }
        },
        approvedRuleId: null,
        reviewReason: null,
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        updatedAt: new Date(Date.now() - 900_000).toISOString(),
        reviewedAt: null,
        reviewedBy: null
    },
    {
        candidateId: 'candidate-agent-approve-1',
        tenantId: 'demo-tenant',
        channel: 'agent',
        attackFamily: 'automation',
        name: 'Agent credential spray',
        severity: 'high',
        matcher: { metadataMatches: { authFailureBurst: true } },
        matcherFingerprint: 'demo-agent-fingerprint',
        reasoning: 'Reviewed and promoted after multiple malicious agent review samples with strong agreement.',
        status: 'approved',
        sampleCount: 7,
        aiConfidence: 0.97,
        latestEvidence: {
            request: { hostname: 'node-17', sourceIp: '198.51.100.18' },
            ai: { verdict: 'malicious', routeMode: 'local_preferred', model: 'demo-local' }
        },
        approvedRuleId: 'candidate-agent-bruteforce',
        reviewReason: 'Approved for hot rollout.',
        createdAt: new Date(Date.now() - 86400_000).toISOString(),
        updatedAt: new Date(Date.now() - 7200_000).toISOString(),
        reviewedAt: new Date(Date.now() - 7200_000).toISOString(),
        reviewedBy: 'admin@example.com'
    },
    {
        candidateId: 'candidate-packet-reject-1',
        tenantId: 'demo-tenant',
        channel: 'packet',
        attackFamily: 'other',
        name: 'Noisy binary payload',
        severity: 'medium',
        matcher: { protocol: 'tcp', evidenceIncludesAny: ['0x16 0x03'] },
        matcherFingerprint: 'demo-packet-fingerprint',
        reasoning: 'Rejected because the matcher overlaps with benign TLS handshake fragments.',
        status: 'rejected',
        sampleCount: 2,
        aiConfidence: 0.88,
        latestEvidence: {
            request: { protocol: 'tcp', sourceIp: '192.0.2.15' },
            ai: { verdict: 'suspicious', routeMode: 'local_preferred', model: 'demo-local' }
        },
        approvedRuleId: null,
        reviewReason: 'Matcher too broad.',
        createdAt: new Date(Date.now() - 172800_000).toISOString(),
        updatedAt: new Date(Date.now() - 86400_000).toISOString(),
        reviewedAt: new Date(Date.now() - 86400_000).toISOString(),
        reviewedBy: 'admin@example.com'
    }
]);

const demoDetectionEvents = (): DetectionEventRecord[] => ([
    {
        detectionEventId: 'event-http-1',
        tenantId: 'demo-tenant',
        requestId: 'req-http-1',
        channel: 'http_api',
        verdict: 'block',
        matchedRuleIds: ['seed-http-sqli'],
        riskScore: 0.98,
        escalatedToAI: false,
        aiVerdict: null,
        aiConfidence: null,
        aiRouteMode: null,
        aiModel: null,
        attackFamily: 'sqli',
        candidateId: null,
        decisionSource: 'seed:block',
        processingTimeMs: 6,
        requestSnapshot: { method: 'POST', path: '/login', sourceIp: '203.0.113.10' },
        responseSnapshot: { verdict: 'block' },
        createdAt: new Date(Date.now() - 240_000).toISOString()
    },
    {
        detectionEventId: 'event-agent-1',
        tenantId: 'demo-tenant',
        requestId: 'req-agent-1',
        channel: 'agent',
        verdict: 'block',
        matchedRuleIds: [],
        riskScore: 0.74,
        escalatedToAI: true,
        aiVerdict: 'malicious',
        aiConfidence: 0.95,
        aiRouteMode: 'local_preferred',
        aiModel: 'demo-local',
        attackFamily: 'automation',
        candidateId: 'candidate-agent-approve-1',
        decisionSource: 'ai:malicious',
        processingTimeMs: 41,
        requestSnapshot: { hostname: 'node-17', sourceIp: '198.51.100.18' },
        responseSnapshot: { verdict: 'block', candidateId: 'candidate-agent-approve-1' },
        createdAt: new Date(Date.now() - 1800_000).toISOString()
    },
    {
        detectionEventId: 'event-http-2',
        tenantId: 'demo-tenant',
        requestId: 'req-http-2',
        channel: 'http_api',
        verdict: 'monitor',
        matchedRuleIds: ['dynamic-http-xss'],
        riskScore: 0.45,
        escalatedToAI: true,
        aiVerdict: 'suspicious',
        aiConfidence: 0.68,
        aiRouteMode: 'local_preferred',
        aiModel: 'demo-local',
        attackFamily: 'xss',
        candidateId: 'candidate-http-xss-1',
        decisionSource: 'ai:suspicious',
        processingTimeMs: 29,
        requestSnapshot: { method: 'POST', path: '/admin/widgets', sourceIp: '203.0.113.20' },
        responseSnapshot: { verdict: 'monitor', candidateId: 'candidate-http-xss-1' },
        createdAt: new Date(Date.now() - 900_000).toISOString()
    }
]);

const normalizeDashboardRuleSummary = (payload: any) => ({
    totalRules: Number(payload?.totalRules || 0),
    activeRules: Number(payload?.activeRules || 0),
    topRules: Array.isArray(payload?.topRules)
        ? payload.topRules.map((rule: any) => ({
            id: rule?.id || rule?.ruleId || '',
            name: rule?.name || rule?.id || rule?.ruleId || 'Unnamed rule',
            severity: rule?.severity || 'medium',
            count: Number(rule?.count ?? rule?.hitCount ?? 0),
            source: rule?.source || 'event'
        }))
        : []
});

export const fetchPlatformConfig = async (): Promise<PlatformConfigResponse> => {
    if (shouldUseDemoData()) {
        return getDefaultPlatformConfig();
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/config`);
    if (!response.ok) {
        throw new Error(`FG-CONFIG-GET-${response.status}`);
    }
    return readJson<PlatformConfigResponse>(response);
};

export const savePlatformConfig = async (payload: PlatformConfigResponse) => {
    if (shouldUseDemoData()) {
        return { success: true, config: payload };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/config`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `FG-CONFIG-SAVE-${response.status}`);
    }
    return readJson<{ success: boolean; config?: PlatformConfigResponse; message?: string }>(response);
};

export const fetchNotificationDeliveries = async (limit: number = 20): Promise<NotificationDelivery[]> => {
    if (shouldUseDemoData()) {
        return [];
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/config/notifications/deliveries?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-NOTIFICATION-DELIVERIES-${response.status}`);
    }
    const data = await response.json();
    return data?.deliveries || [];
};

export const testNotificationChannel = async (channelId: string): Promise<NotificationDelivery> => {
    if (shouldUseDemoData()) {
        return {
            id: `demo-${channelId}`,
            channelId,
            channelType: 'generic_webhook',
            channelLabel: 'Demo Channel',
            status: 'sent',
            severity: 'high',
            target: 'https://example.com/demo',
            payload: {},
            response: {},
            attemptCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/config/notifications/test`, {
        method: 'POST',
        body: JSON.stringify({ channelId })
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `FG-NOTIFICATION-TEST-${response.status}`);
    }
    const data = await response.json();
    return data?.delivery;
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
    if (shouldUseDemoData()) {
        return createDemoScanTask();
    }

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
    if (shouldUseDemoData()) {
        return getDemoScanTask(taskId);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}`);
    if (!response.ok) {
        throw new Error(i18n.t('api.failed_to_fetch_scan_task'));
    }
    return response.json();
};

export const fetchScanTaskResults = async (taskId: string) => {
    if (shouldUseDemoData()) {
        return normalizeScanTaskResultsPayload(getDemoScanTaskResults(taskId));
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}/results`);
    if (!response.ok) {
        throw new Error(i18n.t('api.failed_to_fetch_scan_task_results'));
    }
    return normalizeScanTaskResultsPayload(await response.json());
};

export const cancelScanTask = async (taskId: string) => {
    if (shouldUseDemoData()) {
        return cancelDemoScanTask(taskId);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/${taskId}/cancel`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(i18n.t('api.failed_to_cancel_scan_task'));
    }
    return response.json();
};

export const fetchScanHistory = async (limit: number = 20) => {
    if (shouldUseDemoData()) {
        return getDemoScanHistory(limit);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/tasks/history?limit=${limit}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data?.data || [];
};

export const fetchAdminData = async (signal?: AbortSignal) => {
    try {
        const errRes = await fetchWithCredentials(`${API_BASE_URL}/admin/errors`, { signal });
        const perfRes = await fetchWithCredentials(`${API_BASE_URL}/admin/performance`, { signal });

        if (!errRes.ok || !perfRes.ok) {
            throw new Error(i18n.t('api.failed_to_fetch_admin_data'));
        }

        return {
            errors: await errRes.json(),
            performance: await perfRes.json()
        };
    } catch (e) {
        if (!isRequestAbortError(e, signal)) {
            console.warn('Failed to fetch admin data:', e);
        }
        return null;
    }
};

export const fetchAlerts = async (signal?: AbortSignal): Promise<AlertRecord[]> => {
    try {
        if (shouldUseDemoData()) {
            return getDemoAlerts() as AlertRecord[];
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/alerts`, { signal });
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_alerts'));
        return readJson<AlertRecord[]>(response);
    } catch (e) {
        if (!isRequestAbortError(e, signal)) {
            console.error('Failed to fetch alerts:', e);
        }
        return [];
    }
};

export const fetchAlertDetail = async (alertId: string) => {
    if (shouldUseDemoData()) {
        const alert = getDemoAlerts().find((item: any) => item.id === alertId);
        if (!alert) {
            throw new Error('FG-ALERT-DETAIL-404');
        }
        return {
            success: true,
            data: {
                summary: alert,
                asset: null,
                evidence: [],
                timeline: [{ title: 'Alert created', description: alert.message, timestamp: alert.timestamp }],
                relatedAssets: [],
                relatedAlerts: [],
                relatedScans: getDemoScanHistory(10).slice(0, 3),
                relatedActions: [],
                relatedSessions: getDemoActiveFlows().slice(0, 3),
                metadata: (alert as any).metadata || {}
            }
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/alerts/${encodeURIComponent(alertId)}`);
    if (!response.ok) {
        throw new Error(`FG-ALERT-DETAIL-${response.status}`);
    }
    return response.json();
};

export const fetchSiteDetail = async (siteId: string) => {
    if (shouldUseDemoData()) {
        const site = getDemoSites().find((item) => item.id === siteId);
        if (!site) {
            throw new Error('FG-SITE-DETAIL-404');
        }
        return {
            success: true,
            data: {
                ...site,
                securityOverview: null,
                relatedAlerts: getDemoAlerts().filter((alert: any) => String(alert.source || '').toLowerCase().includes(site.domain.split('.')[0])).slice(0, 5),
                relatedFlows: getDemoActiveFlows().slice(0, 5)
            }
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/sites/${encodeURIComponent(siteId)}`);
    if (!response.ok) {
        throw new Error(`FG-SITE-DETAIL-${response.status}`);
    }
    return response.json();
};

export const acknowledgeAlert = async (alertId: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAlertStatus(alertId, 'acknowledged');
    }
    const response = await fetchWithCredentials(`${API_BASE_URL}/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-ALERT-ACK-${response.status}`);
    }
    return response.json();
};

export const createScanRemediationAction = async (findingId: string) => {
    if (shouldUseDemoData()) {
        return {
            success: true,
            data: {
                actionId: `demo-action-${Date.now().toString(36)}`,
                title: 'Demo remediation action',
                status: 'pending'
            }
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/scanner/findings/${encodeURIComponent(findingId)}/actions`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-SCAN-ACTION-${response.status}`);
    }
    return response.json();
};

export const investigateAlert = async (alertId: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAlertStatus(alertId, 'investigating');
    }
    const response = await fetchWithCredentials(`${API_BASE_URL}/alerts/${encodeURIComponent(alertId)}/investigate`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-ALERT-INVESTIGATE-${response.status}`);
    }
    return response.json();
};

export const resolveAlert = async (alertId: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAlertStatus(alertId, 'resolved');
    }
    const response = await fetchWithCredentials(`${API_BASE_URL}/alerts/${encodeURIComponent(alertId)}/resolve`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-ALERT-RESOLVE-${response.status}`);
    }
    return response.json();
};

export const suppressAlert = async (alertId: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAlertStatus(alertId, 'suppressed');
    }
    const response = await fetchWithCredentials(`${API_BASE_URL}/alerts/${encodeURIComponent(alertId)}/suppress`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-ALERT-SUPPRESS-${response.status}`);
    }
    return response.json();
};

// --- Multi-Agent System API ---


export const fetchAgentSystemStats = async (): Promise<MultiAgentSystemStats | null> => {
    try {
        if (shouldUseDemoData()) {
            return getDemoAgentSystemStats();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/ai-system/agents/stats`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_agent_stats'));
        const data = await response.json();

        if (isDemoModeActive() && data) {
            applyDemoJitter();
            data.queueSize = (data.queueSize || 0) + demoState.agentOffset.queueSize;
            data.totalCaseFiles = (data.totalCaseFiles || 0) + demoState.agentOffset.totalCaseFiles;
            data.lessonsLearned = (data.lessonsLearned || 0) + demoState.agentOffset.lessonsLearned;
            data.policyUpdates = (data.policyUpdates || 0) + demoState.agentOffset.policyUpdates;
            data.totalMessages = (data.totalMessages || 0) + demoState.agentOffset.totalMessages;
            data.activeTasks = Math.floor(Math.random() * 15) + 3;
            data.avgLatency = Math.floor(Math.random() * 80) + 40;
        }
        return data;
    } catch (e) {
        console.error('Failed to fetch agent system stats:', e);
        return null;
    }
};

export const fetchAgentHealth = async () => {
    try {
        if (shouldUseDemoData()) {
            return getDemoAgentHealth();
        }

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
        if (shouldUseDemoData()) {
            return getDemoTrafficStats();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/stats`);
        if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_traffic_stats'));
        const data = await response.json();

        if (isDemoModeActive() && data) {
            applyDemoJitter();
            data.packetsProcessed = (data.packetsProcessed || 0) + demoState.trafficOffset.packetsProcessed;
            data.packetsAllowed = (data.packetsAllowed || 0) + demoState.trafficOffset.packetsAllowed;
            data.packetsBlocked = (data.packetsBlocked || 0) + demoState.trafficOffset.packetsBlocked;
            data.packetsInspected = (data.packetsInspected || 0) + demoState.trafficOffset.packetsInspected;
            data.bytesProcessed = (data.bytesProcessed || 0) + demoState.trafficOffset.bytesProcessed;
            data.activeConnections = Math.max(0, (data.activeConnections || 0) + demoState.trafficOffset.activeConnections);
            data.averageProcessingTime = Math.random() * 1.5 + 0.5;
            data.droppedPackets = Math.floor(Math.random() * 10);
            data.bufferOverflows = Math.random() > 0.95 ? 1 : 0;
            data.cpuUsage = Math.floor(Math.random() * 40) + 20;
        }
        return data;
    } catch (e) {
        console.error('Failed to fetch traffic stats:', e);
        return null;
    }
};

export const fetchActiveFlows = async (): Promise<FlowInfo[]> => {
    try {
        if (shouldUseDemoData()) {
            return getDemoActiveFlows();
        }

        const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/flows`);
        if (!response.ok) return [];
        return response.json();
    } catch (e) {
        console.error('Failed to fetch active flows:', e);
        return [];
    }
};

export const fetchTrafficSessionDetail = async (sessionId: string) => {
    if (shouldUseDemoData()) {
        const flow = getDemoActiveFlows().find((item) => item.id === sessionId);
        if (!flow) {
            throw new Error('FG-TRAFFIC-DETAIL-404');
        }
        return {
            success: true,
            data: {
                summary: flow,
                metadata: {
                    category: flow.category || 'traffic-session',
                    attackName: flow.attackName || null
                },
                relatedAssets: [],
                timeline: [
                    { title: 'Session started', description: `${flow.sourceIP}:${flow.sourcePort} -> ${flow.destIP}:${flow.destPort}`, timestamp: flow.startTime },
                    { title: 'Last activity', description: flow.state, timestamp: flow.lastActivity }
                ]
            }
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/traffic/flows/${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
        throw new Error(`FG-TRAFFIC-DETAIL-${response.status}`);
    }
    return response.json();
};

export const fetchProtocolDistribution = async () => {
    try {
        if (shouldUseDemoData()) {
            return getDemoProtocolDistribution();
        }

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
        if (shouldUseDemoData()) {
            return getDemoThreatDetections();
        }

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
        if (!response.ok) {
            if (shouldUseDemoData()) {
                return getDemoAttackTypes();
            }
            return [];
        }
        return response.json();
    } catch (e) {
        console.error('Failed to fetch attack types:', e);
        return shouldUseDemoData() ? getDemoAttackTypes() : [];
    }
};

export const runAttackSimulation = async (attackIds?: string[]): Promise<AttackSimulationReport | null> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/simulate`, {
            method: 'POST',
            body: JSON.stringify({ attackIds })
        });
        if (!response.ok) {
            if (shouldUseDemoData()) {
                return runDemoAttackSimulation(attackIds);
            }
            throw new Error(i18n.t('api.failed_to_run_attack_simulation'));
        }
        return response.json();
    } catch (e) {
        console.error('Failed to run attack simulation:', e);
        return shouldUseDemoData() ? runDemoAttackSimulation(attackIds) : null;
    }
};

export const fetchAttackHistory = async (): Promise<AttackSimulationReport[]> => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/history`);
        if (!response.ok) {
            if (shouldUseDemoData()) {
                return getDemoAttackHistory().map((report) => ({
                    ...report,
                    id: report.id || report.startTime
                }));
            }
            return [];
        }
        const data = await response.json();
        return (data || []).map((report: any) => ({
            ...report,
            id: report.id || report.startTime
        }));
    } catch (e) {
        console.error('Failed to fetch attack history:', e);
        return shouldUseDemoData()
            ? getDemoAttackHistory().map((report) => ({
                ...report,
                id: report.id || report.startTime
            }))
            : [];
    }
};

export const fetchAttackRunDetail = async (runId: string) => {
    try {
        const response = await fetchWithCredentials(`${API_BASE_URL}/attack/history/${encodeURIComponent(runId)}`);
        if (!response.ok) {
            if (shouldUseDemoData()) {
                const report = getDemoAttackHistory().find((item) => (item.id || item.startTime) === runId);
                if (!report) {
                    throw new Error('FG-ATTACK-RUN-404');
                }
                return {
                    success: true,
                    data: {
                        id: report.id || report.startTime,
                        summary: report,
                        timeline: [
                            { title: 'Simulation started', timestamp: report.startTime },
                            { title: 'Simulation completed', timestamp: report.endTime }
                        ],
                        result: report
                    }
                };
            }
            throw new Error(`FG-ATTACK-RUN-DETAIL-${response.status}`);
        }
        return response.json();
    } catch (error) {
        if (!shouldUseDemoData()) {
            throw error;
        }
        const report = getDemoAttackHistory().find((item) => (item.id || item.startTime) === runId);
        if (!report) {
            throw new Error('FG-ATTACK-RUN-404');
        }
        return {
            success: true,
            data: {
                id: report.id || report.startTime,
                summary: report,
                timeline: [
                    { title: 'Simulation started', timestamp: report.startTime },
                    { title: 'Simulation completed', timestamp: report.endTime }
                ],
                result: report
            }
        };
    }
};

// --- Agent Onboarding API ---

export const createAgentOnboardingCode = async (payload: {
    hostname?: string;
    expectedTags?: string[];
    ttlMinutes?: number;
    maxUses?: number;
}) => {
    if (shouldUseDemoData()) {
        return createDemoAgentOnboardingCode(payload || {});
    }

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
    if (shouldUseDemoData()) {
        return {
            success: true,
            data: {
                agentId: `agent-exchange-${Date.now().toString(36)}`,
                approved: true
            }
        };
    }

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
    if (shouldUseDemoData()) {
        return revokeDemoAgentCredential(agentId);
    }

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

export const fetchAgentOnboardingCodes = async (status?: 'active' | 'used' | 'expired' | 'revoked', limit: number = 50, signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAgentOnboardingCodes(status, limit);
    }

    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    if (status) qs.set('status', status);
    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/codes?${qs.toString()}`, { signal });
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchRegisteredAgents = async (signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoRegisteredAgents();
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/agent-onboarding/agents`, { signal });
    if (!response.ok) {
        return [];
    }
    const data = await response.json();
    return data?.data || [];
};

// --- AI Endpoints API ---

export const fetchAIEndpoints = async () => {
    if (shouldUseDemoData()) {
        return getDemoAIEndpoints();
    }

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
    purpose?: 'hot_path' | 'deep_analysis';
    priority?: number;
    timeout?: number;
}) => {
    if (shouldUseDemoData()) {
        return createDemoAIEndpoint(payload);
    }

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
    if (shouldUseDemoData()) {
        return updateDemoAIEndpoint(id, payload);
    }

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
    if (shouldUseDemoData()) {
        return deleteDemoAIEndpoint(id);
    }

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
    if (shouldUseDemoData()) {
        return testDemoAIEndpoint(id);
    }

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
    category: 'tencent' | 'partner';
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
    route?: string;
    purpose?: 'hot_path' | 'deep_analysis';
    provider?: string;
    upstreamPath?: string;
    requestId?: string;
}

export interface PlatformAIProofError extends Error {
    diagnostics?: {
        provider?: string;
        upstreamStatus?: number;
        upstreamPath?: string;
        requestId?: string;
    };
}

export const sendChatMessage = async (modelId: string, messages: ChatMessage[]): Promise<ChatResponse> => {
    if (shouldUseDemoData()) {
        return {
            success: true,
            content: `Demo response from ${modelId}: simulated chat completed.`,
            model: modelId,
            usage: { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 },
            latency: 245,
            route: 'demo',
            purpose: 'deep_analysis'
        };
    }

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

export const fetchAdminApiKeys = async (signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminApiKeys();
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/api-keys`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-APIKEYS-LIST-${response.status}`);
    }
    const data = await response.json();
    return data?.keys || [];
};

export const createAdminApiKey = async (name: string) => {
    if (shouldUseDemoData()) {
        return createDemoAdminApiKey(name);
    }

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
    if (shouldUseDemoData()) {
        return deleteDemoAdminApiKey(id);
    }

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

export const fetchDashboardRulesSummary = async (signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return normalizeDashboardRuleSummary(demoRuleSummary());
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/dashboard/rules/summary`, { signal });
    if (!response.ok) {
        throw new Error(`FG-DASHBOARD-RULES-${response.status}`);
    }
    const data = await response.json();
    return normalizeDashboardRuleSummary(data?.data);
};

export const fetchRules = async (params?: {
    channel?: 'http_api' | 'packet' | 'agent';
    dynamicOnly?: boolean;
}, signal?: AbortSignal): Promise<{ rules: RuleRecord[]; summary: RuleSummary }> => {
    if (shouldUseDemoData()) {
        const allRules = demoRules();
        const rules = allRules.filter((rule) => {
            if (params?.dynamicOnly && rule.source === 'seed') {
                return false;
            }
            if (params?.channel && !(rule.scope === 'all' || rule.scope === params.channel)) {
                return false;
            }
            return true;
        });

        return {
            rules,
            summary: demoRuleSummary()
        };
    }

    const search = new URLSearchParams();
    if (params?.channel) {
        search.set('channel', params.channel);
    }
    if (params?.dynamicOnly) {
        search.set('dynamicOnly', 'true');
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/rules${search.toString() ? `?${search.toString()}` : ''}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-RULES-LIST-${response.status}`);
    }
    return readJson<{ rules: RuleRecord[]; summary: RuleSummary }>(response);
};

export const fetchRuleCandidates = async (params?: {
    status?: 'pending' | 'approved' | 'rejected';
}, signal?: AbortSignal): Promise<RuleCandidateRecord[]> => {
    if (shouldUseDemoData()) {
        const candidates = demoRuleCandidates();
        return params?.status ? candidates.filter((candidate) => candidate.status === params.status) : candidates;
    }

    const search = new URLSearchParams();
    if (params?.status) {
        search.set('status', params.status);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/rules/candidates${search.toString() ? `?${search.toString()}` : ''}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-RULE-CANDIDATES-${response.status}`);
    }
    const data = await readJson<{ candidates: RuleCandidateRecord[] }>(response);
    return data?.candidates || [];
};

export const fetchRuleCandidate = async (candidateId: string, signal?: AbortSignal): Promise<RuleCandidateRecord | null> => {
    if (shouldUseDemoData()) {
        return demoRuleCandidates().find((candidate) => candidate.candidateId === candidateId) || null;
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/rules/candidates/${encodeURIComponent(candidateId)}`, { signal });
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`FG-RULE-CANDIDATE-${response.status}`);
    }
    const data = await readJson<{ candidate: RuleCandidateRecord }>(response);
    return data?.candidate || null;
};

export const approveRuleCandidate = async (candidateId: string, reason?: string): Promise<{
    candidate: RuleCandidateRecord;
    sync?: { attempted: number; succeeded: number };
}> => {
    if (shouldUseDemoData()) {
        const candidate = demoRuleCandidates().find((item) => item.candidateId === candidateId);
        if (!candidate) {
            throw new Error('FG-RULE-CANDIDATE-404');
        }
        return {
            candidate: {
                ...candidate,
                status: 'approved',
                reviewReason: reason || candidate.reviewReason || 'approved',
                reviewedAt: new Date().toISOString(),
                reviewedBy: 'demo-admin@example.com',
                approvedRuleId: candidate.approvedRuleId || `approved-${candidateId}`,
                updatedAt: new Date().toISOString()
            },
            sync: candidate.channel === 'agent' ? { attempted: 1, succeeded: 1 } : undefined
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/rules/candidates/${encodeURIComponent(candidateId)}/approve`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {})
    });
    if (!response.ok) {
        throw new Error(`FG-RULE-CANDIDATE-APPROVE-${response.status}`);
    }
    return readJson<{ candidate: RuleCandidateRecord; sync?: { attempted: number; succeeded: number } }>(response);
};

export const rejectRuleCandidate = async (candidateId: string, reason?: string): Promise<{ candidate: RuleCandidateRecord }> => {
    if (shouldUseDemoData()) {
        const candidate = demoRuleCandidates().find((item) => item.candidateId === candidateId);
        if (!candidate) {
            throw new Error('FG-RULE-CANDIDATE-404');
        }
        return {
            candidate: {
                ...candidate,
                status: 'rejected',
                reviewReason: reason || candidate.reviewReason || 'rejected',
                reviewedAt: new Date().toISOString(),
                reviewedBy: 'demo-admin@example.com',
                updatedAt: new Date().toISOString()
            }
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/rules/candidates/${encodeURIComponent(candidateId)}/reject`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {})
    });
    if (!response.ok) {
        throw new Error(`FG-RULE-CANDIDATE-REJECT-${response.status}`);
    }
    return readJson<{ candidate: RuleCandidateRecord }>(response);
};

export const fetchRuleEvents = async (params?: {
    channel?: 'http_api' | 'packet' | 'agent';
    verdict?: 'allow' | 'block' | 'monitor';
    escalatedToAI?: boolean;
    candidateId?: string;
    from?: string;
    to?: string;
    limit?: number;
}, signal?: AbortSignal): Promise<DetectionEventRecord[]> => {
    if (shouldUseDemoData()) {
        return demoDetectionEvents().filter((event) => {
            if (params?.channel && event.channel !== params.channel) {
                return false;
            }
            if (params?.verdict && event.verdict !== params.verdict) {
                return false;
            }
            if (typeof params?.escalatedToAI === 'boolean' && event.escalatedToAI !== params.escalatedToAI) {
                return false;
            }
            if (params?.candidateId && event.candidateId !== params.candidateId) {
                return false;
            }
            return true;
        }).slice(0, params?.limit || 50);
    }

    const search = new URLSearchParams();
    if (params?.channel) {
        search.set('channel', params.channel);
    }
    if (params?.verdict) {
        search.set('verdict', params.verdict);
    }
    if (typeof params?.escalatedToAI === 'boolean') {
        search.set('escalatedToAI', String(params.escalatedToAI));
    }
    if (params?.candidateId) {
        search.set('candidateId', params.candidateId);
    }
    if (params?.from) {
        search.set('from', params.from);
    }
    if (params?.to) {
        search.set('to', params.to);
    }
    if (params?.limit) {
        search.set('limit', String(params.limit));
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/rules/events${search.toString() ? `?${search.toString()}` : ''}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-RULE-EVENTS-${response.status}`);
    }
    const data = await readJson<{ events: DetectionEventRecord[] }>(response);
    return data?.events || [];
};

export const fetchRecentAgentThreats = async (limit: number = 50) => {
    if (shouldUseDemoData()) {
        return getDemoRecentAgentThreats(limit);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/agents/threats/recent?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-AGENT-THREATS-${response.status}`);
    }
    const data = await response.json();
    return data?.threats || [];
};

export const fetchDeviceEvents = async (deviceId: string, limit: number = 100) => {
    if (shouldUseDemoData()) {
        return getDemoDeviceEvents(deviceId, limit);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}/events?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-DEVICE-EVENTS-${response.status}`);
    }
    const data = await response.json();
    return data?.events || [];
};

// --- Fix History ---

export const fetchFixHistory = async (limit: number = 50) => {
    if (shouldUseDemoData()) {
        return getDemoFixHistory(limit);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/fix-history?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`FG-FIX-HISTORY-${response.status}`);
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchFixHistoryDetail = async (id: string) => {
    if (shouldUseDemoData()) {
        return getDemoFixHistoryDetail(id);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/fix-history/${encodeURIComponent(id)}`);
    if (!response.ok) {
        throw new Error(`FG-FIX-HISTORY-DETAIL-${response.status}`);
    }
    const data = await response.json();
    return data?.data || null;
};

export const fetchAdminUsersList = async (signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminUsers();
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users`, { signal });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_fetch_admin_users'));
    return response.json();
};

// Batch operations on users
export const batchUpdateUsers = async (payload: {
    userIds: string[];
    action: 'suspend' | 'activate' | 'setPlan' | 'setRole';
    value?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/batch`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.batch_update_failed')));
    }
    return data;
};

// User detail
export const fetchAdminUserDetail = async (userId: string, signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}`, { signal });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_get_user')));
    return data;
};

// Login history
export const fetchUserLoginHistory = async (userId: string, limit: number = 50, signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/login-history?limit=${limit}`, { signal });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_get_login_history')));
    return data;
};

// Reset user password
export const resetUserPassword = async (userId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/reset-password`, {
        method: 'POST'
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_reset_password')));
    }
    return data;
};

// Announcements - Public endpoint (no auth required)
export const fetchPublicAnnouncements = async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/announcements`, { signal });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_list_announcements'));
    return readJson<any[]>(response);
};

// Announcements - Admin endpoints
export const fetchAnnouncements = async (signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements`, { signal });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_list_announcements'));
    return readJson<any[]>(response);
};

export const createAnnouncement = async (payload: { title: string; content: string; type?: string; expiresAt?: string }) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_create_announcement')));
    }
    return data;
};

export const updateAnnouncement = async (id: string, payload: { title?: string; content?: string; type?: string; expiresAt?: string }) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_update_announcement')));
    }
    return data;
};

export const deleteAnnouncement = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements/${id}`, {
        method: 'DELETE'
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_delete_announcement')));
    }
    return data;
};

export const publishAnnouncement = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements/${id}/publish`, {
        method: 'POST'
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_publish_announcement')));
    }
    return data;
};

export const archiveAnnouncement = async (id: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements/${id}/archive`, {
        method: 'POST'
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
        throw new Error(extractErrorMessage(data, i18n.t('api.failed_to_archive_announcement')));
    }
    return data;
};

// Public: fetch published announcements for banner display
export const fetchPublishedAnnouncements = async (signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/announcements`, { signal });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({ data: [] })) as any;
    // Filter to only published and non-expired
    const now = new Date().toISOString();
    return (data?.data || []).filter((a: any) =>
        a.status === 'published' && (!a.expires_at || a.expires_at > now)
    );
};

export const fetchAdminOversightTenants = async (signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightTenants();
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/tenants`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-TENANTS-${response.status}`);
    }
    const data = await response.json();
    return data?.tenants || [];
};

export const fetchAdminOversightSummary = async (tenantId: string, userId?: string, signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightSummary(tenantId, userId);
    }

    const qs = new URLSearchParams();
    if (userId) qs.set('userId', userId);
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/tenants/${encodeURIComponent(tenantId)}/summary${qs.toString() ? `?${qs.toString()}` : ''}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-SUMMARY-${response.status}`);
    }
    const data = await response.json();
    return data?.data || null;
};

export const fetchAdminOversightTimeline = async (params: {
    tenantId: string;
    userId?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
}, signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightTimeline(params);
    }

    const qs = new URLSearchParams();
    if (params.userId) qs.set('userId', params.userId);
    if (params.category) qs.set('category', params.category);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.limit) qs.set('limit', String(params.limit));
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/tenants/${encodeURIComponent(params.tenantId)}/timeline?${qs.toString()}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-TIMELINE-${response.status}`);
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchAdminOversightUserTimeline = async (userId: string, params: {
    tenantId?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
}, signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightTimeline({
            tenantId: params.tenantId || 'tenant-alpha',
            userId,
            category: params.category,
            from: params.from,
            to: params.to,
            limit: params.limit
        });
    }

    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.limit) qs.set('limit', String(params.limit));
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/users/${encodeURIComponent(userId)}/timeline?${qs.toString()}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-USER-TIMELINE-${response.status}`);
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchAdminOversightEvidence = async (params: {
    tenantId: string;
    userId?: string;
    category?: string;
    from?: string;
    to?: string;
    limit?: number;
}, signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightEvidence(params);
    }

    const qs = new URLSearchParams();
    if (params.userId) qs.set('userId', params.userId);
    if (params.category) qs.set('category', params.category);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.limit) qs.set('limit', String(params.limit));
    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/tenants/${encodeURIComponent(params.tenantId)}/evidence?${qs.toString()}`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-EVIDENCE-${response.status}`);
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchAdminOversightEventDetail = async (tenantId: string, eventId: string) => {
    if (shouldUseDemoData()) {
        return { success: true, data: { summary: { eventId }, timeline: [], evidence: [], relatedAssets: [], relatedAlerts: [], relatedActions: [] } };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/tenants/${encodeURIComponent(tenantId)}/events/${encodeURIComponent(eventId)}`);
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-EVENT-${response.status}`);
    }
    return response.json();
};

export const verifyPlatformAI = async (): Promise<ChatResponse> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/ai-endpoints/chat`, {
        method: 'POST',
        body: JSON.stringify({
            modelId: 'glm-5',
            purpose: 'deep_analysis',
            messages: [
                { role: 'system', content: 'You are a concise security assistant.' },
                { role: 'user', content: 'Reply with exactly the text: AETHERGUARD_REMOTE_AI_OK' }
            ]
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || `FG-AI-VERIFY-${response.status}`) as PlatformAIProofError;
        error.diagnostics = {
            provider: data.provider,
            upstreamStatus: data.upstreamStatus,
            upstreamPath: data.upstreamPath,
            requestId: data.requestId
        };
        throw error;
    }
    return data;
};

export const verifyAdminAuditLog = async (logId: string) => {
    if (shouldUseDemoData()) {
        return verifyDemoAdminAuditLog(logId);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/audit/verify/${encodeURIComponent(logId)}`);
    if (!response.ok) {
        throw new Error(`FG-ADMIN-AUDIT-VERIFY-${response.status}`);
    }
    return response.json();
};

export const createAdminOversightExport = async (payload: {
    tenantId: string;
    filters?: Record<string, any>;
}) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightExport(payload);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/exports`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-EXPORT-${response.status}`);
    }
    return response.json();
};

export const fetchAdminOversightExports = async (tenantId: string, signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        const summary = getDemoAdminOversightSummary(tenantId);
        return summary?.recentExports || [];
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/tenants/${encodeURIComponent(tenantId)}/exports`, { signal });
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-EXPORTS-${response.status}`);
    }
    const data = await response.json();
    return data?.data || [];
};

export const fetchAdminOversightExport = async (exportId: string) => {
    if (shouldUseDemoData()) {
        return getDemoAdminOversightExport({ exportId });
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/tenant-oversight/exports/${encodeURIComponent(exportId)}`);
    if (!response.ok) {
        throw new Error(`FG-ADMIN-OVERSIGHT-EXPORT-DETAIL-${response.status}`);
    }
    const data = await response.json();
    return data?.data || null;
};

export const fetchAgentsList = async () => {
    if (shouldUseDemoData()) {
        const agents = getDemoAgents();
        return { success: true, count: agents.length, agents };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/agents`);
    if (!response.ok) {
        throw new Error(`FG-AGENTS-LIST-${response.status}`);
    }
    return response.json();
};

export const fetchAgentDetail = async (agentId: string) => {
    if (shouldUseDemoData()) {
        const agent = getDemoAgents().find((item) => item.agentId === agentId);
        if (!agent) {
            throw new Error('FG-AGENT-DETAIL-404');
        }
        return {
            success: true,
            data: {
                summary: agent,
                capabilities: agent.registration || {},
                recentThreats: getDemoRecentAgentThreats(10),
                timeline: [
                    {
                        title: 'Last heartbeat',
                        description: agent.isOnline ? 'Agent reported healthy telemetry.' : 'Agent heartbeat is stale.',
                        timestamp: agent.lastHeartbeat
                    }
                ]
            }
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/agents/${encodeURIComponent(agentId)}`);
    if (!response.ok) {
        throw new Error(`FG-AGENT-DETAIL-${response.status}`);
    }
    return response.json();
};

export const triggerAgentScan = async (agentId: string) => {
    if (shouldUseDemoData()) {
        return { success: true, simulated: true, message: `Simulated scan queued for ${agentId}` };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/agents/${encodeURIComponent(agentId)}/scan`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-AGENT-SCAN-${response.status}`);
    }
    return response.json();
};

export const fetchScannerRunDetail = async (taskId: string) => {
    const [task, results] = await Promise.all([
        fetchScanTask(taskId),
        fetchScanTaskResults(taskId)
    ]);

    return {
        success: true,
        data: {
            summary: task?.data || null,
            result: results?.data || null
        }
    };
};

export const fetchDevicesList = async (signal?: AbortSignal) => {
    if (shouldUseDemoData()) {
        const devices = getDemoDevices();
        return {
            success: true,
            total: devices.length,
            online: devices.filter((device) => device.isOnline).length,
            devices
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/devices`, { signal });
    if (!response.ok) {
        throw new Error(`FG-DEVICES-LIST-${response.status}`);
    }
    return response.json();
};

export const fetchDeviceDetail = async (deviceId: string) => {
    if (shouldUseDemoData()) {
        const device = getDemoDeviceDetail(deviceId);
        if (!device) {
            throw new Error('FG-DEVICE-DETAIL-404');
        }
        return { success: true, device };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}`);
    if (!response.ok) {
        throw new Error(`FG-DEVICE-DETAIL-${response.status}`);
    }
    return response.json();
};

export const fetchDeviceConfig = async (deviceId: string) => {
    if (shouldUseDemoData()) {
        return getDemoDeviceConfig(deviceId);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}/config`);
    if (!response.ok) {
        throw new Error(`FG-DEVICE-CONFIG-${response.status}`);
    }
    return response.json();
};

export const saveDeviceConfig = async (deviceId: string, payload: Partial<DeviceConfigurationPayload>) => {
    if (shouldUseDemoData()) {
        return saveDemoDeviceConfig(deviceId, payload);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`FG-DEVICE-SAVE-${response.status}`);
    }
    return response.json();
};

export const sendDeviceCommand = async (deviceId: string, command: string): Promise<ActionResponse> => {
    if (shouldUseDemoData()) {
        return sendDemoDeviceCommand(deviceId, command);
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/commands/intents`, {
        method: 'POST',
        body: JSON.stringify({
            scope: 'device',
            targetId: deviceId,
            commandType: command,
            payload: {}
        })
    });
    if (!response.ok) {
        throw new Error(`FG-DEVICE-CMD-${response.status}`);
    }
    return response.json();
};

export const fetchHardwareConfirmation = async (sessionId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/hardware-confirmations/${encodeURIComponent(sessionId)}`);
    if (!response.ok) {
        throw new Error(`FG-HARDWARE-CONFIRMATION-${response.status}`);
    }
    return response.json();
};

export const fetchHardwareGates = async (signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/hardware-gates`, { signal });
    if (!response.ok) {
        throw new Error(`FG-HARDWARE-GATES-${response.status}`);
    }
    const payload = await response.json();
    const data = unwrapApiEnvelope<{ gates: HardwareGateRecord[] }>(payload);
    return data?.gates || [];
};

export const fetchFinalDefenseStatus = async (signal?: AbortSignal): Promise<FinalDefenseStatusResponse> => {
    if (shouldUseDemoData()) {
        const now = new Date().toISOString();
        return {
            active: true,
            mode: 'active',
            statuses: [{
                tenantId: 'demo-tenant',
                companionId: 'final-defense-companion-01',
                gateId: 'control-board-v1-01',
                policyId: 'demo-final-defense-policy',
                policyDigest: 'b7d8f1e0a9c44d21demo',
                reportedPolicyDigest: 'b7d8f1e0a9c44d21demo',
                breakerTarget: 'mgmt-uplink-relay-a',
                interlockState: 'isolated',
                externalPowerPresent: true,
                secureElementPresent: true,
                feedbackOk: true,
                companionOnline: true,
                lastHeartbeatAt: now,
                lastVerifiedAt: now,
                active: true,
                degradedReasons: [],
                createdAt: now,
                updatedAt: now
            }],
            policies: []
        };
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/final-defense/status`, { signal });
    if (!response.ok) {
        throw new Error(`FG-FINAL-DEFENSE-STATUS-${response.status}`);
    }
    return readJson<FinalDefenseStatusResponse>(response);
};

export const createFinalDefensePolicy = async (payload: {
    companionId: string;
    gateId: string;
    allowedActions: FinalDefensePolicyRecord['allowedActions'];
    breakerTarget: string;
    releaseTtlMs?: number;
    status?: FinalDefensePolicyRecord['status'];
    policyId?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/final-defense/policies`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`FG-FINAL-DEFENSE-POLICY-${response.status}`);
    }
    return readJson<{ policy: FinalDefensePolicyRecord }>(response);
};

export const requestFinalDefenseAction = async (payload: {
    companionId: string;
    commandType: string;
    payload?: Record<string, any>;
    challenge?: string;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/final-defense/actions`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`FG-FINAL-DEFENSE-ACTION-${response.status}`);
    }
    return readJson<ActionResponse>(response);
};

export const enrollHardwareGate = async (payload: {
    gateId: string;
    displayName?: string;
    publicKeyPem: string;
    algorithm?: string;
    metadata?: Record<string, any>;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/hardware-gates/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`FG-HARDWARE-GATE-ENROLL-${response.status}`);
    }
    return readJson<HardwareGateRecord>(response);
};

export const fetchDeploymentHelpers = async (signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/helpers`, { signal });
    if (!response.ok) {
        throw new Error(`FG-DEPLOYMENT-HELPERS-${response.status}`);
    }
    const payload = await response.json();
    const data = unwrapApiEnvelope<{ helpers: DeploymentHelperRecord[] }>(payload);
    return data?.helpers || [];
};

export const createDeploymentRun = async (payload: {
    helperId: string;
    gateId: string;
    requestType: 'install' | 'remove';
    serverType: DeploymentTarget;
    profile: Record<string, any>;
}) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployment-runs`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(`FG-DEPLOYMENT-RUN-CREATE-${response.status}`);
    }
    return readJson<DeploymentRunRecord>(response);
};

export const fetchDeploymentRuns = async (signal?: AbortSignal) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployment-runs`, { signal });
    if (!response.ok) {
        throw new Error(`FG-DEPLOYMENT-RUNS-${response.status}`);
    }
    const payload = await response.json();
    const data = unwrapApiEnvelope<{ runs: DeploymentRunRecord[] }>(payload);
    return data?.runs || [];
};

export const approveDeploymentRun = async (runId: string) => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployment-runs/${encodeURIComponent(runId)}/approve`, {
        method: 'POST'
    });
    if (!response.ok) {
        throw new Error(`FG-DEPLOYMENT-RUN-APPROVE-${response.status}`);
    }
    return readJson<{ run: DeploymentRunRecord; sessionId?: string }>(response);
};

export const fetchDeploymentEvidence = async (runId: string): Promise<DeploymentEvidenceResponse> => {
    const response = await fetchWithCredentials(`${API_BASE_URL}/deployment-runs/${encodeURIComponent(runId)}/evidence`);
    if (!response.ok) {
        throw new Error(`FG-DEPLOYMENT-EVIDENCE-${response.status}`);
    }
    return readJson<DeploymentEvidenceResponse>(response);
};

export const updateAdminUserPlan = async (userId: string, plan: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAdminUser(userId, { plan: plan as 'starter' | 'pro' | 'ultra' });
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/plan`, {
        method: 'PUT',
        body: JSON.stringify({ plan })
    });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_update_plan'));
    return response.json();
};

export const updateAdminUserRole = async (userId: string, role: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAdminUser(userId, { role: role as 'admin' | 'tenant' | 'viewer' });
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role })
    });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_update_role'));
    return response.json();
};

export const updateAdminUserStatus = async (userId: string, status: string) => {
    if (shouldUseDemoData()) {
        return updateDemoAdminUser(userId, { status: status as 'active' | 'suspended' });
    }

    const response = await fetchWithCredentials(`${API_BASE_URL}/admin/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error(i18n.t('api.failed_to_update_status'));
    return response.json();
};
