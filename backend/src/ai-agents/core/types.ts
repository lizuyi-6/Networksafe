/**
 * Multi-Agent Decision System - Core Types
 * 7-Layer Architecture for AI-powered Security Analysis
 */

import type { AIRoutingMode } from '../../services/platform-config.service';

// ============================================================================
// Layer 1: Collaboration - Base Types
// ============================================================================

export type AgentRole = 'socrates' | 'plato' | 'aristotle' | 'arbitrator' | 'orchestrator';
export type AgentTeam = 'red' | 'blue' | 'analyst' | 'arbitrator';
export type SecurityVerdict = 'safe' | 'suspicious' | 'malicious' | 'unknown';
export type AttackFamily =
    | 'benign'
    | 'sqli'
    | 'xss'
    | 'path_traversal'
    | 'command_injection'
    | 'ssrf'
    | 'automation'
    | 'authentication'
    | 'business_logic'
    | 'other';
export type AnalysisPurpose = 'primary' | 'deep_analysis' | 'learning_verification' | 'blocking_review';
export type ExperimentMode =
    | 'single_agent'
    | 'multi_agent_no_debate'
    | 'multi_agent_with_debate';

export interface VerdictDistribution {
    safe: number;
    suspicious: number;
    malicious: number;
}

export interface DebateTriggerMetrics {
    triggered: boolean;
    labelConflict: boolean;
    confidenceRange: number;
    divergence: number;
    reasons: string[];
}

export interface StageLatencyBreakdown {
    proxyMs: number;
    roleAnalysisMs: number;
    debateMs: number;
    synthesisMs: number;
    asyncReviewMs: number;
    endToEndMs: number;
}

export interface AgentIdentity {
    id: string;
    role: AgentRole;
    team: AgentTeam;
    name: string;
    description: string;
    capabilities: string[];
}

export interface AgentConfig {
    identity: AgentIdentity;
    modelConfig: ModelConfig;
    timeout: number;
    modelTimeout?: number;
    maxRetries: number;
    heuristicOnly?: boolean;
}

export interface ModelConfig {
    provider: 'openai' | 'anthropic' | 'ollama' | 'zhipu' | 'dashscope' | 'local';
    model: string;
    temperature: number;
    maxTokens: number;
    baseURL?: string;
    apiKey?: string;
}

// ============================================================================
// Traffic & Request Types
// ============================================================================

export interface TrafficRequest {
    id: string;
    timestamp: Date;
    sourceIP: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    queryParams?: Record<string, string>;
    userAgent?: string;
    rawLog?: string;
    tenantId?: string;
    routeModeOverride?: AIRoutingMode;
    analysisPurpose?: AnalysisPurpose;
    forceDebate?: boolean;
    traceContext?: TraceContext;
}

export interface TrafficContext {
    request: TrafficRequest;
    history: HistoricalBehavior[];
    openApiSpec?: OpenApiSpec;
    relatedRequests: TrafficRequest[];
}

export interface HistoricalBehavior {
    timestamp: Date;
    action: string;
    result: 'success' | 'failure' | 'blocked';
    metadata?: Record<string, any>;
}

export interface OpenApiSpec {
    path: string;
    method: string;
    parameters: any[];
    requestBody?: any;
    responses: Record<string, any>;
}

// ============================================================================
// Layer 2: Role Playing - Analysis Types
// ============================================================================

export interface AnalysisResult {
    agentId: string;
    role: AgentRole;
    verdict: SecurityVerdict;
    confidence: number;
    classScores: VerdictDistribution;
    reasoning: string;
    evidence: Evidence[];
    attackFamily?: AttackFamily;
    mutations?: RequestMutation[];
    schemaValidation?: SchemaValidation;
    anomalyScore?: number;
    modelTier?: ModelTier;
    routeMode?: AIRoutingMode | 'unknown';
    modelLatencyMs?: number;
    analysisLatencyMs?: number;
}

export interface Evidence {
    type: 'pattern' | 'behavior' | 'statistical' | 'semantic' | 'tool_result';
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    data: any;
    source: string;
}

export interface RequestMutation {
    id: string;
    originalValue: string;
    mutatedValue: string;
    mutationType: 'encoding' | 'injection' | 'bypass' | 'obfuscation';
    description: string;
    potentialImpact: string;
}

export interface SchemaValidation {
    isValid: boolean;
    violations: SchemaViolation[];
    matchedSchema?: string;
}

export interface SchemaViolation {
    field: string;
    expected: string;
    actual: string;
    severity: 'error' | 'warning';
}

// ============================================================================
// Layer 3: Scene Traversal - Distributed Tracing
// ============================================================================

export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    service: string;
    timestamp: Date;
    duration?: number;
    tags: Record<string, string>;
}

export interface AttackNarrative {
    id: string;
    traceId: string;
    timeline: NarrativeEvent[];
    services: string[];
    attackChain: AttackChainStep[];
    summary: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface NarrativeEvent {
    timestamp: Date;
    service: string;
    event: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    correlationId: string;
    rawLog?: string;
}

export interface AttackChainStep {
    order: number;
    service: string;
    action: string;
    payload?: string;
    result: 'success' | 'failure' | 'blocked';
    nextStep?: number;
}

// ============================================================================
// Layer 4: Capability Incarnation - Tool Execution
// ============================================================================

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameter[];
    riskLevel: 'low' | 'medium' | 'high';
    requiresSandbox: boolean;
}

export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description: string;
    validation?: string;
}

export interface ToolExecutionRequest {
    toolName: string;
    parameters: Record<string, any>;
    requestId: string;
    timeout: number;
    sandboxOptions?: SandboxOptions;
}

export interface ToolExecutionResult {
    requestId: string;
    toolName: string;
    success: boolean;
    output: any;
    error?: string;
    executionTime: number;
    sandboxed: boolean;
}

export interface SandboxOptions {
    enabled: boolean;
    timeout: number;
    memoryLimit: number;
    networkAccess: boolean;
    fileSystemAccess: boolean;
}

// ============================================================================
// Layer 5: Debate Protocol
// ============================================================================

export interface DebateSession {
    id: string;
    requestId: string;
    topic: string;
    participants: AgentRole[];
    rounds: DebateRound[];
    status: 'pending' | 'active' | 'resolved' | 'failed';
    finalVerdict?: DebateVerdict;
    startTime: Date;
    endTime?: Date;
    triggerMetrics?: DebateTriggerMetrics;
    consensusReached?: boolean;
    aggregateDistribution?: VerdictDistribution;
    latencyMs?: number;
}

export interface DebateRound {
    roundNumber: number;
    speaker: AgentRole;
    position: 'attack' | 'defend' | 'analyze';
    argument: string;
    evidence: Evidence[];
    timestamp: Date;
}

export interface DebateVerdict {
    decision: 'safe' | 'malicious' | 'requires_review';
    confidence: number;
    reasoning: string;
    votingRecord: VotingRecord[];
    arbitratorNotes: string;
    aggregatedDistribution?: VerdictDistribution;
}

export interface VotingRecord {
    agentId: string;
    role: AgentRole;
    vote: 'safe' | 'malicious' | 'abstain';
    confidence: number;
    reasoning: string;
}

// ============================================================================
// Layer 6: Heterogeneous Model Collaboration
// ============================================================================

export type ModelTier = 'local' | 'cloud' | 'hybrid';

export interface ModelRoutingDecision {
    tier: ModelTier;
    model: string;
    reason: string;
    estimatedLatency: number;
    estimatedCost: number;
}

export interface ModelRequest {
    id: string;
    prompt: string;
    context: Record<string, any>;
    tier: ModelTier;
    priority: 'low' | 'medium' | 'high' | 'critical';
    timeout: number;
    sanitizationLevel: 'none' | 'basic' | 'aggressive';
    routeModeOverride?: AIRoutingMode;
    analysisPurpose?: AnalysisPurpose;
}

export interface ModelResponse {
    id: string;
    content: string;
    model: string;
    tier: ModelTier;
    latency: number;
    tokensUsed: number;
    sanitized: boolean;
    routeMode?: AIRoutingMode | 'unknown';
}

export interface AmbiguityScore {
    score: number;
    factors: string[];
    recommendation: 'local' | 'cloud';
}

// ============================================================================
// Layer 7: Synthesis & Evolution
// ============================================================================

export interface CaseFile {
    id: string;
    requestId: string;
    timestamp: Date;
    summary: string;
    narrative: AttackNarrative;
    debate: DebateSession;
    verdict: DebateVerdict;
    actions: CaseAction[];
    lessons: LessonLearned[];
    policyUpdates: PolicyUpdate[];
}

export interface CaseAction {
    action: 'block' | 'allow' | 'monitor' | 'investigate';
    target: string;
    reason: string;
    duration?: number;
    automated: boolean;
}

export interface LessonLearned {
    category: string;
    insight: string;
    confidence: number;
    applicableScenarios: string[];
}

export interface PolicyUpdate {
    id: string;
    type: 'rule_addition' | 'rule_modification' | 'rule_removal' | 'threshold_adjustment';
    description: string;
    changes: Record<string, any>;
    effectiveFrom: Date;
    source: 'human' | 'ai_evolution';
}

// ============================================================================
// Message Types for Agent Communication
// ============================================================================

export type MessageType = 
    | 'analysis_request'
    | 'analysis_result'
    | 'debate_invitation'
    | 'debate_argument'
    | 'debate_verdict'
    | 'tool_request'
    | 'tool_result'
    | 'trace_event'
    | 'model_request'
    | 'model_response'
    | 'case_file'
    | 'policy_update'
    | 'heartbeat_request'
    | 'heartbeat_response';

export interface AgentMessage {
    id: string;
    type: MessageType;
    from: AgentRole;
    to: AgentRole | 'broadcast';
    payload: any;
    timestamp: Date;
    correlationId?: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface MessageEnvelope {
    message: AgentMessage;
    routingKey: string;
    ttl: number;
    retryCount: number;
}

// ============================================================================
// Final Decision Output
// ============================================================================

export interface SecurityDecision {
    id: string;
    requestId: string;
    timestamp: Date;
    verdict: 'allow' | 'block' | 'challenge' | 'monitor';
    confidence: number;
    threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
    reasoning: string;
    evidence: Evidence[];
    actions: CaseAction[];
    caseFileId: string;
    processingTime: number;
    layersActivated: number[];
    aggregatedDistribution?: VerdictDistribution;
    analysisResults?: AnalysisResult[];
    experimentMode?: ExperimentMode;
    attackFamily?: AttackFamily;
    routeMode?: AIRoutingMode | 'unknown';
    stageLatencies?: StageLatencyBreakdown;
    debateSession?: DebateSession;
}

// ============================================================================
// System Configuration
// ============================================================================

export interface MultiAgentConfig {
    enabled: boolean;
    experimentMode?: ExperimentMode;
    primarySingleAgentRole?: 'socrates' | 'plato' | 'aristotle';
    heuristicOnly?: boolean;
    useIsolatedBus?: boolean;
    /** Per-detection-stage model ID overrides passed to ModelRouter (stage → model ID). */
    modelRouterOverrides?: Record<string, string>;
    layers: {
        l1_collaboration: LayerConfig;
        l2_rolePlaying: LayerConfig;
        l3_sceneTraversal: LayerConfig;
        l4_capability: LayerConfig;
        l5_debate: LayerConfig;
        l6_heterogeneous: LayerConfig;
        l7_synthesis: LayerConfig;
    };
    models: {
        local: ModelConfig;
        cloud: ModelConfig;
    };
    thresholds: {
        debateTrigger: number;
        debateDivergence: number;
        debateConfidenceRange: number;
        cloudEscalation: number;
        autoBlock: number;
    };
    timeouts: {
        analysis: number;
        debate: number;
        toolExecution: number;
        modelResponse: number;
    };
}

export interface LayerConfig {
    enabled: boolean;
    priority: number;
    timeout: number;
    maxConcurrency: number;
}
