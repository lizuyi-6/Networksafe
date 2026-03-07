export interface HistoryPoint {
    time: string;
    requests: number;
    blocked: number;
}

export interface ThreatItem {
    name: string;
    value: number;
    color: string;
}

export interface DashboardStats {
    totalRequests: number;
    currentRPS: number;
    blockedRequests: number;
    activeConnections: number;
    successRate: number;
    history: HistoryPoint[];
    threats: ThreatItem[];
    avgProcessingTime?: number;
    processingSamples?: number;
    attackOrigins?: AttackOrigin[];
    requestsTrend?: number;
    blockedTrend?: number;
    p99Latency?: number;
    cpuUsage?: number;
    memoryUsage?: number;
    diskUsage?: number;
    networkUsage?: number;
    securityOperations?: DashboardSecuritySummary;
}

export interface AttackOrigin {
    country: string;
    countryCode: string;
    count: number;
    percentage: number;
}

export interface AdminError {
    userId: string;
    errorCode: string;
    message: string;
    timestamp: string;
}

export interface ServerPerf {
    cpu: number;
    memory: number;
}

export interface ClientPerf {
    total_agents: number;
    avg_cpu_overhead: string;
    avg_latency_added: string;
}

export interface LogItem {
    id: number;
    time: string;
    type: string;
    level: string;
    message: string;
    ip: string;
    status?: number; // Optional mapping
    method?: string; // Optional mapping
    path?: string;   // Optional mapping
}

export interface AdminPerformance {
    server: ServerPerf;
    clients: ClientPerf;
}

// Multi-Agent System Types
export interface AgentStats {
    totalCaseFiles: number;
    totalLessons: number;
    totalPolicyUpdates: number;
    topPatterns: { pattern: string; frequency: number }[];
}

export interface AgentHeartbeat {
    agentId: string;
    role: string;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    lastSeen: string;
    responseTime: number;
    tasksCompleted: number;
    tasksPending: number;
    errorCount: number;
}

export interface MultiAgentSystemStats {
    orchestrator: {
        activeTasks: number;
        registeredAgents: number;
    };
    messageBus: {
        queueSize: number;
        subscriptionCount: number;
        pendingRequests: number;
    };
    synthesis: AgentStats;
    operations?: {
        activeAlerts: number;
        runningScans: number;
        pendingActions: number;
        failedValidations: number;
        assetsAtRisk: number;
    };
    health: {
        status: 'healthy' | 'degraded' | 'unhealthy';
        details: Record<string, string>;
    };
    agents: AgentHeartbeat[];
}

export interface DebateStats {
    totalDebates: number;
    resolvedDebates: number;
    avgRounds: number;
    consensusRate: number;
}

export interface ModelRouterStats {
    total: number;
    local: number;
    cloud: number;
    localRatio: number;
    avgLocalLatency: number;
    avgCloudLatency: number;
}

// Traffic Interceptor Types
export interface TrafficStats {
    uptime: number;
    packetsProcessed: number;
    packetsAllowed: number;
    packetsBlocked: number;
    packetsInspected: number;
    bytesProcessed: number;
    currentFlows: number;
    activeConnections: number;
    droppedPackets: number;
    bufferOverflows: number;
    avgProcessingTime: number;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage?: number;
    networkUsage?: number;
}

export interface FlowInfo {
    id: string;
    sourceIP: string;
    destIP: string;
    sourcePort: number;
    destPort: number;
    protocol: string;
    state: string;
    packetCount: number;
    byteCount: number;
    startTime: string;
    lastActivity: string;
    verdict?: string;
    attackName?: string;
    category?: string;
}

export interface ProtocolDistribution {
    http: number;
    https: number;
    dns: number;
    other: number;
}

export interface ThreatDetection {
    type: string;
    count: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
}

// Attack Simulator Types
export interface AttackType {
    id: string;
    name: string;
    category: string;
    severity: string;
    description: string;
}

export interface AttackResult {
    attackId: string;
    attackName: string;
    category: string;
    severity: string;
    blocked: boolean;
    detected?: boolean;
    responseTime: number;
    statusCode?: number;
    error?: string;
    verdict?: string;
}

export interface AttackSimulationReport {
    id?: string;
    total: number;
    blocked: number;
    allowed: number;
    errors: number;
    results: AttackResult[];
    startTime: string;
    endTime: string;
    detected?: number;
    detectionRate?: string;
    blockRate?: string;
}

export interface DetailTimelineItem {
    title: string;
    description?: string;
    timestamp?: string;
}

export interface SecurityFinding {
    findingId: string;
    assetId?: string;
    sourceType: string;
    sourceRef: string;
    target: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed' | 'ignored';
    title: string;
    description: string;
    evidence: Record<string, any>;
    remediation: Record<string, any>;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
}

export interface ScanAssetGroup {
    assetId?: string;
    target: string;
    category: string;
    severities: Record<string, number>;
    findings: SecurityFinding[];
}

export interface DashboardSecuritySummary {
    openCriticalFindings: number;
    highRiskFindings?: number;
    activeAlerts: number;
    runningScans: number;
    queuedScans?: number;
    pendingActions: number;
    failedValidations: number;
    assetsAtRisk: number;
    observedSessions?: number;
    trafficAnomalies?: number;
    recentActions: {
        actionId: string;
        title: string;
        status: string;
        createdAt: string;
        updatedAt: string;
    }[];
    recentValidations: {
        validationRunId: string;
        attackName: string;
        verdict: string;
        severity: string;
        completedAt: string;
    }[];
}

export interface AlertRecord {
    id: string;
    title: string;
    message: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    type: 'security' | 'performance' | 'system';
    source: string;
    time: string;
    status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed';
    timestamp: string;
    assetId?: string;
    findingId?: string;
    investigationId?: string;
    metadata?: Record<string, any>;
}
