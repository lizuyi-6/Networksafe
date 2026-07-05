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
    /**
     * True when this result came from the agent's heuristic fallback path
     * (model unreachable / heuristicOnly), NOT from a model call. Downstream
     * consumers must not present a fallback verdict as AI analysis.
     */
    heuristicFallback?: boolean;
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
    /** Per-call sampling override, typically derived from the calling layer's thinking depth. */
    temperature?: number;
    maxTokens?: number;
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
    /**
     * SECURITY (V12.18): tenant tag bound at publish time. Subscribers
     * bound to a different tenant never receive the envelope. Undefined
     * on envelopes produced by older code paths (treated as platform-scope).
     */
    tenantId?: string;
    /**
     * SECURITY (V12.18): HMAC-SHA256 over the canonical (type, from, to,
     * payload JSON, tenantId) tuple using MESSAGE_BUS_SIGNING_KEY. The
     * processor drops envelopes whose signature is missing or does not
     * recompute, so an in-process agent cannot forge a foreign envelope.
     */
    signature?: string;
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
    /**
     * Per-layer execution trace for the 7-layer cascade. Every layer appears once,
     * marked activated/dormant with its thinking depth, model tier, step latency,
     * and a short note describing what it did (or why it stayed dormant). This is
     * the observable backbone that makes the Athens Academy a real, inspectable
     * cascade rather than a flat pipeline.
     */
    cascadeTrace?: LayerTrace[];
    aggregatedDistribution?: VerdictDistribution;
    analysisResults?: AnalysisResult[];
    experimentMode?: ExperimentMode;
    attackFamily?: AttackFamily;
    routeMode?: AIRoutingMode | 'unknown';
    stageLatencies?: StageLatencyBreakdown;
    debateSession?: DebateSession;
    /**
     * Degradation transparency: how many contributing agent results came from
     * heuristic fallbacks instead of model calls. When every contributing
     * result is a fallback, the decision must not be presented as AI-verified.
     */
    heuristicFallbackCount?: number;
    heuristicDegraded?: boolean;
}

export interface LayerTrace {
    layer: number;
    name: string;
    activated: boolean;
    thinkingDepth?: ThinkingDepth;
    modelTier?: ModelTier;
    latencyMs?: number;
    note?: string;
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
    /**
     * How deeply this layer's agent team reasons. Maps to concrete model
     * temperature / max-token budget via THINKING_DEPTH_PARAMS so each layer
     * genuinely thinks at a different depth rather than being a relabeled stage.
     */
    thinkingDepth?: ThinkingDepth;
    /**
     * When this layer's team activates. A layer only fires when its activation
     * condition holds against the accumulated cascade state (risk, confidence,
     * debate trigger, escalation). Omitted = always-on foundation/synthesis.
     */
    activation?: LayerActivation;
    /** Preferred model tier for this layer's team (local = fast/cheap, cloud = deep). */
    modelTier?: ModelTier;
}

/**
 * Reasoning depth per layer. Shallow = fast triage on the local model;
 * deliberative = slow, high-token cloud reasoning reserved for the hardest
 * calls. The seven layers span this spectrum so the system spends compute
 * proportional to ambiguity and stakes.
 */
export type ThinkingDepth = 'shallow' | 'standard' | 'deep' | 'deliberative';

/**
 * Cascade activation condition for a layer's agent team.
 */
export interface LayerActivation {
    /** Fire on every request (foundation / synthesis layers). */
    always?: boolean;
    /** Fire only when the upstream risk score is at least this high. */
    minRiskScore?: number;
    /** Fire when the primary-path confidence drops below this (uncertainty). */
    maxPrimaryConfidence?: number;
    /** Fire when the primary-path confidence is at least this (high-stakes). */
    minPrimaryConfidence?: number;
    /** Fire only when the debate trigger conditions are met (divergence / label conflict). */
    requiresDebateTrigger?: boolean;
    /** Fire only when the cloud-escalation threshold is reached. */
    requiresEscalation?: boolean;
    /** Restrict to specific attack families (empty/undefined = any). */
    attackFamilies?: AttackFamily[];
    /** Lower-layer numbers that must have activated first (cascade dependency). */
    requiresLayers?: number[];
}

/**
 * Concrete model sampling parameters for each thinking depth. Layers derive
 * their temperature and token budget from this so depth is enforced, not cosmetic.
 */
export const THINKING_DEPTH_PARAMS: Record<ThinkingDepth, { temperature: number; maxTokens: number }> = {
    shallow: { temperature: 0.1, maxTokens: 400 },
    standard: { temperature: 0.3, maxTokens: 1000 },
    deep: { temperature: 0.4, maxTokens: 2000 },
    deliberative: { temperature: 0.5, maxTokens: 4000 }
};
