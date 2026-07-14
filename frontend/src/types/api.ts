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
    telemetryAvailable?: boolean;
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
    detectionPipeline?: RuleSummary | null;
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
    detectionPipeline?: {
        asyncReview: {
            queueDepth: number;
            queued: number;
            running: number;
            completed: number;
            failed: number;
            completionRate: number;
            debateCompletionRate: number;
            avgLatencyMs: number;
        };
        blockingDiscussion?: {
            count: number;
            failClosed: number;
            avgLatencyMs: number;
        };
        classificationLevel?: 'standard' | 'elevated' | 'maximum';
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
    aiAnalysis?: {
        enabled?: boolean;
        usedAI?: boolean;
        engine?: string;
        route?: 'cloud' | 'local' | 'unknown' | 'error';
        provider?: string | null;
        model?: string | null;
        error?: string;
        modelRouterDelta?: {
            total: number;
            local: number;
            cloud: number;
        };
    };
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
    aiAnalysis?: {
        aiBackedCount: number;
        cloudCount: number;
        localCount: number;
        errorCount: number;
    };
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

export type DetectionChannel = 'http_api' | 'packet' | 'agent';
export type DetectionVerdict = 'allow' | 'block' | 'monitor';
export type DetectionAttackFamily =
    | 'benign'
    | 'sqli'
    | 'xss'
    | 'path_traversal'
    | 'command_injection'
    | 'ssrf'
    | 'automation'
    | 'other';

export interface RuleRecord {
    ruleId: string;
    tenantId?: string;
    name: string;
    description?: string;
    scope: DetectionChannel | 'all';
    action: 'allow' | 'block' | 'review';
    priority: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    matcher: Record<string, any>;
    source: 'seed' | 'candidate' | 'dynamic';
    enabled: boolean;
    attackFamily?: DetectionAttackFamily;
    version?: number;
    metadata?: Record<string, any>;
}

export interface RuleCandidateRecord {
    candidateId: string;
    tenantId: string;
    channel: DetectionChannel;
    attackFamily: DetectionAttackFamily;
    name: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    matcher: Record<string, any>;
    matcherFingerprint: string;
    reasoning: string;
    status: 'pending' | 'approved' | 'rejected';
    sampleCount: number;
    aiConfidence: number;
    latestEvidence: Record<string, any>;
    approvedRuleId?: string | null;
    reviewReason?: string | null;
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
}

export interface DetectionEventRecord {
    detectionEventId: string;
    tenantId: string;
    requestId: string;
    channel: DetectionChannel;
    verdict: DetectionVerdict;
    matchedRuleIds: string[];
    riskScore: number;
    escalatedToAI: boolean;
    queuedForAsyncReview?: boolean;
    classificationLevel?: 'standard' | 'elevated' | 'maximum';
    blockingDiscussion?: boolean;
    discussionStatus?: 'not_required' | 'completed' | 'failed' | 'timeout' | 'unavailable';
    discussionLatencyMs?: number;
    aiVerdict?: string | null;
    aiConfidence?: number | null;
    aiRouteMode?: string | null;
    aiModel?: string | null;
    /** True when the AI verdict came entirely from heuristic fallbacks (no model call). */
    aiHeuristicDegraded?: boolean;
    attackFamily: DetectionAttackFamily;
    candidateId?: string | null;
    decisionSource: string;
    processingTimeMs: number;
    requestSnapshot: Record<string, any>;
    responseSnapshot: Record<string, any>;
    createdAt: string;
}

export interface RuleSummary {
    totalRules: number;
    activeRules: number;
    pendingCandidates: number;
    approvedCandidates: number;
    rejectedCandidates: number;
    ruleHitRate: number;
    aiEscalationRate: number;
    localModelHitRate: number;
    avgProcessingTimeMs: number;
    localAICount: number;
    cloudAICount: number;
    asyncReviewQueueDepth: number;
    asyncReviewRunning: number;
    asyncReviewCompleted: number;
    asyncReviewFailed: number;
    debateCompletionRate: number;
    avgAsyncReviewLatencyMs: number;
    classificationLevel: 'standard' | 'elevated' | 'maximum';
    blockingDiscussionCount: number;
    blockingDiscussionFailClosed: number;
    avgBlockingDiscussionLatencyMs: number;
    topRules: Array<{
        ruleId: string;
        name: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        hitCount: number;
        source: string;
    }>;
}
