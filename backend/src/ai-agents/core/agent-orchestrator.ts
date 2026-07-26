/**
 * Agent Orchestrator - L1: Multi-Agent Collaboration Layer
 * Routes traffic to specialized agents and coordinates analysis
 */

import { uuidv4 } from '../../utils/uuid';
import {
    AgentRole,
    AgentConfig,
    TrafficContext,
    TrafficRequest,
    AnalysisResult,
    SecurityDecision,
    MultiAgentConfig,
    Evidence,
    CaseAction,
    AttackFamily,
    LayerConfig,
    LayerActivation,
    LayerTrace,
    THINKING_DEPTH_PARAMS,
    AnalysisResult as AgentAnalysisResult
} from './types';
import { BaseAgent, ExpertAgent } from './base-agent';
import { MessageBus, globalMessageBus } from './message-bus';
import { SocratesAgent } from '../roles/socrates-agent';
import { PlatoAgent } from '../roles/plato-agent';
import { AristotleAgent } from '../roles/aristotle-agent';
import { DebateProtocol } from '../debate/debate-protocol';
import { traceContextManager } from '../tracing/trace-context';
import { toolExecutor } from '../capabilities/tool-executor';
import {
    blendDistributions,
    buildDebateTriggerMetrics,
    confidenceFromDistribution,
    dominantVerdict,
    verdictToDecision
} from './scoring';
import logger from '../../utils/logger';

interface AgentRegistry {
    [key: string]: BaseAgent;
}

interface AnalysisTask {
    id: string;
    requestId: string;
    startTime: Date;
    status: 'pending' | 'running' | 'completed' | 'failed';
    results: Map<AgentRole, AnalysisResult>;
    finalDecision?: SecurityDecision;
    threatType?: AttackFamily;
}

export class AgentOrchestrator {
    private agents: AgentRegistry = {};
    private messageBus: MessageBus;
    private config: MultiAgentConfig;
    private activeTasks: Map<string, AnalysisTask> = new Map();
    /** Ring buffer of recent per-layer cascade traces for observability. */
    private recentTraces: Array<{ requestId: string; verdict: SecurityDecision['verdict']; traces: LayerTrace[]; timestamp: Date }> = [];
    private static readonly MAX_RECENT_TRACES = 25;
    private expertRouting: Map<string, AgentRole[]> = new Map();
    private debateProtocol: DebateProtocol;

    constructor(config: MultiAgentConfig, messageBus: MessageBus = globalMessageBus) {
        this.config = config;
        this.messageBus = messageBus;
        this.debateProtocol = new DebateProtocol(this.messageBus);
        this.initializeAgents();
        this.setupExpertRouting();
    }

    private initializeAgents(): void {
        const agentConfigs = this.createAgentConfigs();

        for (const [role, agentConfig] of Object.entries(agentConfigs)) {
            let agent: BaseAgent;

            switch (role as AgentRole) {
                case 'socrates':
                    agent = new SocratesAgent(agentConfig, this.messageBus);
                    break;
                case 'plato':
                    agent = new PlatoAgent(agentConfig, this.messageBus);
                    break;
                case 'aristotle':
                    agent = new AristotleAgent(agentConfig, this.messageBus);
                    break;
                case 'arbitrator':
                case 'orchestrator':
                    continue;
                default:
                    continue;
            }

            this.agents[role] = agent;
            logger.info(`Agent registered: ${role}`);
        }
    }

    private createAgentConfigs(): Record<AgentRole, AgentConfig> {
        const baseConfig = {
            timeout: this.config.timeouts.analysis,
            modelTimeout: this.config.timeouts.modelResponse,
            maxRetries: 3,
            heuristicOnly: this.config.heuristicOnly
        };
        // L2 role-playing team reasons at its configured thinking depth: the layer's
        // temperature / token budget is stamped onto each role agent so the team
        // genuinely thinks at that depth (vs. the deeper L5 debate budget).
        const roleDepth = THINKING_DEPTH_PARAMS[this.config.layers.l2_rolePlaying.thinkingDepth || 'standard'];
        const roleModelConfig = {
            ...this.config.models.cloud,
            temperature: roleDepth.temperature,
            maxTokens: roleDepth.maxTokens
        };
        // Fast triage role (Socrates, red-team) runs on the LOCAL base model at shallow
        // depth so the heterogeneous routing is real: a fast local judgement vs. the
        // cloud-backed verify/arbitrate path. Falls back to cloud behaviour via the
        // shared config when no local model is configured (provider stays ollama but
        // the router degrades gracefully if Ollama is unreachable).
        const fastRoleModelConfig = {
            ...this.config.models.local,
            temperature: THINKING_DEPTH_PARAMS['shallow'].temperature,
            maxTokens: THINKING_DEPTH_PARAMS['shallow'].maxTokens
        };


        return {
            socrates: {
                identity: {
                    id: `socrates-${uuidv4()}`,
                    role: 'socrates',
                    team: 'red',
                    name: 'Socrates',
                    description: 'Red team agent - Attempts to find bypasses and mutations',
                    capabilities: ['mutation', 'bypass_detection', 'attack_simulation']
                },
                modelConfig: fastRoleModelConfig,
                ...baseConfig
            },
            plato: {
                identity: {
                    id: `plato-${uuidv4()}`,
                    role: 'plato',
                    team: 'blue',
                    name: 'Plato',
                    description: 'Blue team agent - Schema validation and compliance checking',
                    capabilities: ['schema_validation', 'compliance_check', 'pattern_matching']
                },
                modelConfig: roleModelConfig,
                ...baseConfig
            },
            aristotle: {
                identity: {
                    id: `aristotle-${uuidv4()}`,
                    role: 'aristotle',
                    team: 'analyst',
                    name: 'Aristotle',
                    description: 'Analyst agent - Historical behavior and anomaly analysis',
                    capabilities: ['anomaly_detection', 'behavior_analysis', 'statistical_analysis']
                },
                modelConfig: roleModelConfig,
                ...baseConfig
            },
            arbitrator: {
                identity: {
                    id: `arbitrator-${uuidv4()}`,
                    role: 'arbitrator',
                    team: 'arbitrator',
                    name: 'Arbitrator',
                    description: 'Final decision maker - Resolves debates and makes final calls',
                    capabilities: ['debate_resolution', 'final_decision', 'policy_enforcement']
                },
                modelConfig: roleModelConfig,
                ...baseConfig
            },
            orchestrator: {
                identity: {
                    id: `orchestrator-${uuidv4()}`,
                    role: 'orchestrator',
                    team: 'analyst',
                    name: 'Orchestrator',
                    description: 'System coordinator - Routes requests and manages agents',
                    capabilities: ['routing', 'coordination', 'task_management']
                },
                modelConfig: roleModelConfig,
                ...baseConfig
            }
        };
    }

    private setupExpertRouting(): void {
        this.expertRouting.set('sqli', ['socrates', 'plato', 'aristotle']);
        this.expertRouting.set('xss', ['socrates', 'plato', 'aristotle']);
        this.expertRouting.set('command_injection', ['socrates', 'plato']);
        this.expertRouting.set('path_traversal', ['socrates', 'plato']);
        this.expertRouting.set('ssrf', ['socrates', 'plato', 'aristotle']);
        this.expertRouting.set('automation', ['aristotle', 'plato']);
        this.expertRouting.set('authentication', ['aristotle', 'plato']);
        this.expertRouting.set('rate_limit', ['aristotle']);
        this.expertRouting.set('business_logic', ['socrates', 'aristotle']);
        this.expertRouting.set('benign', ['socrates', 'plato', 'aristotle']);
        this.expertRouting.set('default', ['socrates', 'plato', 'aristotle']);
    }

    async initialize(): Promise<void> {
        for (const agent of Object.values(this.agents)) {
            await agent.initialize();
        }
        logger.info('Agent Orchestrator initialized');
    }

    async analyze(request: TrafficRequest, context?: Partial<TrafficContext>): Promise<SecurityDecision> {
        const startTime = Date.now();
        const taskId = uuidv4();

        const fullContext: TrafficContext = {
            request,
            history: context?.history || [],
            openApiSpec: context?.openApiSpec,
            relatedRequests: context?.relatedRequests || []
        };

        const task: AnalysisTask = {
            id: taskId,
            requestId: request.id,
            startTime: new Date(),
            status: 'running',
            results: new Map()
        };
        this.activeTasks.set(taskId, task);

        try {
            const threatType = this.classifyThreatType(request);
            task.threatType = threatType;
            const assignedAgents = this.routeToExperts(threatType, request);

            logger.debug(`Task ${taskId}: Assigned agents ${assignedAgents.join(', ')} for threat type ${threatType}`);

            const analysisPromises = assignedAgents.map(async (role) => {
                const agent = this.agents[role];
                if (!agent) {
                    logger.warn(`Agent not found: ${role}`);
                    return null;
                }

                try {
                    const result = await agent.analyze(fullContext);
                    task.results.set(role, result);
                    return result;
                } catch (error: any) {
                    logger.error(`Agent ${role} analysis failed`, { error: error.message });
                    return null;
                }
            });

            await Promise.all(analysisPromises);

            const decision = await this.makeDecision(task, request, threatType);

            task.status = 'completed';
            task.finalDecision = decision;
            if (decision.cascadeTrace) {
                this.recentTraces.unshift({ requestId: request.id, verdict: decision.verdict, traces: decision.cascadeTrace, timestamp: new Date() });
                if (this.recentTraces.length > AgentOrchestrator.MAX_RECENT_TRACES) {
                    this.recentTraces.pop();
                }
            }

            return decision;
        } catch (error: any) {
            task.status = 'failed';
            logger.error(`Analysis task ${taskId} failed`, { error: error.message });
            throw error;
        } finally {
            this.activeTasks.delete(taskId);
        }
    }

    private classifyThreatType(request: TrafficRequest): AttackFamily {
        const content = [
            request.path,
            request.body || '',
            JSON.stringify(request.queryParams || {}),
            request.userAgent || ''
        ].join(' ').toLowerCase();

        if (content.includes('select') || content.includes('union') || content.includes("' or ")) {
            return 'sqli';
        }
        if (content.includes('<script') || content.includes('javascript:') || content.includes('onerror')) {
            return 'xss';
        }
        if (content.includes('../') || content.includes('/etc/') || content.includes('cmd.exe')) {
            return 'path_traversal';
        }
        if (content.includes('|') || content.includes(';') || content.includes('&&')) {
            return 'command_injection';
        }
        if (content.includes('169.254.169.254') || content.includes('metadata.google.internal') || content.includes('latest/meta-data')) {
            return 'ssrf';
        }
        if (
            content.includes('sqlmap') ||
            content.includes('python-requests') ||
            content.includes('headless') ||
            content.includes('selenium') ||
            content.includes('curl/') ||
            content.includes('wget/')
        ) {
            return 'automation';
        }
        if (content.includes('login') || content.includes('auth') || content.includes('token')) {
            return 'authentication';
        }

        return 'benign';
    }

    private routeToExperts(threatType: AttackFamily, request?: TrafficRequest): AgentRole[] {
        if (request?.analysisPurpose === 'blocking_review' || request?.forceDebate) {
            const allRoles = Object.keys(this.agents) as AgentRole[];
            return allRoles.length > 0 ? allRoles : [this.config.primarySingleAgentRole || 'aristotle'];
        }

        if (this.config.experimentMode === 'single_agent' || request?.analysisPurpose === 'primary') {
            return [this.config.primarySingleAgentRole || 'aristotle'];
        }

        return this.expertRouting.get(threatType) || this.expertRouting.get('default')!;
    }

    private async makeDecision(
        task: AnalysisTask,
        request: TrafficRequest,
        threatType: AttackFamily
    ): Promise<SecurityDecision> {
        const results = Array.from(task.results.values());

        if (results.length === 0) {
            return this.createDefaultDecision(request, task.id, threatType);
        }

        const allEvidence: Evidence[] = [];
        let worstVerdict: 'safe' | 'suspicious' | 'malicious' | 'unknown' = 'safe';

        for (const result of results) {
            if (result) {
                allEvidence.push(...result.evidence);

                if (this.verdictSeverity(result.verdict) > this.verdictSeverity(worstVerdict)) {
                    worstVerdict = result.verdict;
                }
            }
        }

        const aggregateDistribution = blendDistributions(results);
        const aggregateVerdict = dominantVerdict(aggregateDistribution);
        const triggerMetrics = this.shouldTriggerDebate(results);
        const debateWillRun =
            request.forceDebate === true ||
            request.analysisPurpose === 'blocking_review' ||
            (request.analysisPurpose !== 'primary' &&
            this.config.experimentMode !== 'single_agent' &&
            this.config.experimentMode !== 'multi_agent_no_debate' &&
            triggerMetrics.triggered);
        // L3/L4 execute as real evidence-producing steps (not verdict-changing) when
        // their cascade gate holds, then the full 7-layer trace is assembled for the
        // returned decision so the Athens Academy is an inspectable cascade end to end.
        const { evidence: cascadeEvidence, traces } = await this.runCascadeSteps({
            request, results, threatType,
            debateTriggered: debateWillRun
        });
        allEvidence.push(...cascadeEvidence);
        let finalVerdict: SecurityDecision['verdict'] = verdictToDecision(aggregateVerdict);
        let finalConfidence = confidenceFromDistribution(aggregateDistribution);
        let debateSession;

        if (debateWillRun) {
            logger.info(`Debate triggered for request ${request.id}`);
            debateSession = await this.triggerDebate(task, request, results, triggerMetrics);
            if (debateSession.finalVerdict) {
                finalVerdict = this.mapDebateVerdictToDecision(debateSession.finalVerdict.decision);
                finalConfidence = debateSession.finalVerdict.confidence;
            }
        }

        const threatLevel = this.calculateThreatLevel(
            finalVerdict === 'block' ? 'malicious' : finalVerdict === 'monitor' ? 'suspicious' : worstVerdict,
            allEvidence
        );
        const actions = this.determineActions(finalVerdict, threatLevel, request);
        const roleAnalysisMs = Number(
            Math.max(...results.map((result) => result.analysisLatencyMs || result.modelLatencyMs || 0)).toFixed(2)
        );
        const debateMs = Number((debateSession?.latencyMs || 0).toFixed(2));
        const endToEndMs = Number((Date.now() - task.startTime.getTime()).toFixed(2));
        // Truthful cascade: each layer is recorded as activated only when its
        // activation condition holds against the real accumulated state (risk,
        // confidence, debate trigger, escalation, layer dependencies). Replaces the
        // old hardcoded [1,2] + push(5/6) which made every layer look always-on.
        const layersActivated = this.evaluateLayerCascade({
            results,
            primaryConfidence: finalConfidence,
            threatType,
            debateTriggered: Boolean(debateSession) || triggerMetrics.triggered,
            escalationReached: results.some((r) => r && (r.modelTier === 'cloud' || r.modelTier === 'hybrid')),
            forceDebate: request.forceDebate === true || request.analysisPurpose === 'blocking_review'
        });

        const heuristicFallbackCount = results.filter((r) => r && r.heuristicFallback === true).length;

        return {
            id: uuidv4(),
            requestId: request.id,
            timestamp: new Date(),
            verdict: finalVerdict,
            confidence: finalConfidence,
            threatLevel,
            reasoning: this.buildReasoning(results, triggerMetrics, debateSession?.finalVerdict?.reasoning),
            evidence: allEvidence,
            actions,
            caseFileId: task.id,
            processingTime: endToEndMs,
            layersActivated,
            cascadeTrace: traces,
            aggregatedDistribution: debateSession?.finalVerdict?.aggregatedDistribution || aggregateDistribution,
            analysisResults: results,
            experimentMode: this.config.experimentMode || 'multi_agent_with_debate',
            attackFamily: threatType,
            routeMode: results.find((result) => result.routeMode && result.routeMode !== 'unknown')?.routeMode || 'unknown',
            // Degradation transparency: a verdict reached purely by heuristic
            // fallbacks (model unreachable) must never be presented as
            // AI-verified downstream.
            heuristicFallbackCount,
            heuristicDegraded: results.length > 0 && heuristicFallbackCount === results.length,
            stageLatencies: {
                proxyMs: 0,
                roleAnalysisMs,
                debateMs,
                synthesisMs: 0,
                asyncReviewMs: roleAnalysisMs + debateMs,
                endToEndMs
            },
            debateSession
        };
    }

    private verdictSeverity(verdict: string): number {
        const severityMap: Record<string, number> = {
            'safe': 0,
            'unknown': 1,
            'suspicious': 2,
            'malicious': 3
        };
        return severityMap[verdict] || 0;
    }

    private mapVerdictToDecision(verdict: string): SecurityDecision['verdict'] {
        const mapping: Record<string, SecurityDecision['verdict']> = {
            'safe': 'allow',
            'suspicious': 'monitor',
            'malicious': 'block',
            'unknown': 'challenge'
        };
        return mapping[verdict] || 'challenge';
    }

    /**
     * Execute the evidence-producing cascade steps (L3 scene traversal, L4
     * capability) and return their evidence plus a trace entry for every layer.
     *
     * L3 reconstructs the attack narrative from the trace context and folds its
     * findings into evidence. L4 runs a sandboxed capability tool (e.g. SQL
     * explain, HTTP probe) when the risk gate clears. Neither changes the verdict —
     * they enrich evidence only, preserving the 0%-FPR / fail-closed invariants.
     * L6 (heterogeneous verification) executes asynchronously via the detection
     * pipeline's cloud re-review and disagreement capture; its trace note points
     * there. This makes L3/L4 real, inspectable steps instead of dormant layers.
     */
    private async runCascadeSteps(ctx: {
        request: TrafficRequest;
        results: (AnalysisResult | null)[];
        threatType: AttackFamily;
        debateTriggered: boolean;
    }): Promise<{ evidence: Evidence[]; traces: LayerTrace[] }> {
        const L = this.config.layers;
        const riskScore = this.estimateRiskScore(ctx.results);
        const escalationReached = ctx.results.some((r) => r && (r.modelTier === 'cloud' || r.modelTier === 'hybrid'));
        const evidence: Evidence[] = [];
        const traces: LayerTrace[] = [];

        const activated = new Set<number>([1, 2]);

        // L3 — Scene traversal: build the attack narrative from trace context.
        const l3Cfg = L.l3_sceneTraversal;
        const l3Active = l3Cfg.enabled
            && this.evaluateLayerActivation(l3Cfg.activation, { activatedLayers: activated, riskScore, primaryConfidence: this.bestConfidence(ctx.results), debateTriggered: ctx.debateTriggered, escalationReached, attackFamily: ctx.threatType });
        const l3Start = Date.now();
        if (l3Active) {
            try {
                const traceId = ctx.request.traceContext?.traceId;
                const narrative = traceContextManager.buildAttackNarrative(
                    traceId || `req-${ctx.request.id}`
                );
                if (narrative && narrative.attackChain.length > 0) {
                    evidence.push({
                        type: 'behavior',
                        description: `Attack narrative reconstructed: ${narrative.attackChain.length} step(s) across ${narrative.services.length || 1} service(s)`,
                        severity: narrative.riskLevel === 'critical' || narrative.riskLevel === 'high' ? 'high' : 'medium',
                        data: { chain: narrative.attackChain.map((s) => s.action), riskLevel: narrative.riskLevel },
                        source: 'L3-scene-traversal'
                    });
                }
            } catch (error: any) {
                logger.debug('L3 scene traversal skipped', { error: error?.message });
            }
            activated.add(3);
        }

        // L4 — Capability: run a sandboxed tool when the risk gate clears.
        const l4Cfg = L.l4_capability;
        const l4Active = l4Cfg.enabled
            && this.evaluateLayerActivation(l4Cfg.activation, { activatedLayers: activated, riskScore, primaryConfidence: this.bestConfidence(ctx.results), debateTriggered: ctx.debateTriggered, escalationReached, attackFamily: ctx.threatType });
        const l4Start = Date.now();
        let l4ProducedEvidence = false;
        if (l4Active) {
            const tool = this.selectCapabilityTool(ctx.threatType, ctx.request);
            if (tool) {
                try {
                    const result = await toolExecutor.execute({
                        toolName: tool.name,
                        parameters: tool.parameters,
                        requestId: ctx.request.id,
                        timeout: Math.min(l4Cfg.timeout, 8000),
                        sandboxOptions: { enabled: true, timeout: 8000, memoryLimit: 256, networkAccess: false, fileSystemAccess: false }
                    });
                    // A tool that ran but was blocked/denied by the sandbox (e.g.
                    // http_probe, which needs network the sandbox forbids) did not
                    // produce usable evidence — do not record it as a positive L4
                    // finding, or the trace would claim capability ran when it didn't.
                    const blocked = this.toolOutputWasBlocked(result.output);
                    if (result.success && !blocked) {
                        evidence.push({
                            type: 'tool_result',
                            description: `Capability tool ${tool.name} executed (sandboxed)`,
                            severity: 'medium',
                            data: { tool: tool.name, output: typeof result.output === 'string' ? result.output.slice(0, 240) : result.output },
                            source: 'L4-capability'
                        });
                        l4ProducedEvidence = true;
                    } else if (result.success && blocked) {
                        logger.debug('L4 capability tool produced no usable evidence (sandboxed)', { tool: tool.name });
                    }
                } catch (error: any) {
                    logger.debug('L4 capability tool skipped', { error: error?.message });
                }
            }
            activated.add(4);
        }

        // Assemble a trace entry for every layer, dormant or active, so the
        // returned decision carries a complete inspectable cascade.
        const layerDefs: Array<{ num: number; cfg: LayerConfig; name: string; note: string }> = [
            { num: 1, cfg: L.l1_collaboration, name: 'Collaboration', note: `Routed to ${ctx.results.length} role agent(s)` },
            { num: 2, cfg: L.l2_rolePlaying, name: 'Role Playing', note: 'Role team analyzed in parallel' },
            { num: 3, cfg: L.l3_sceneTraversal, name: 'Scene Traversal', note: l3Active ? 'Attack narrative reconstructed from trace' : `Dormant: risk ${riskScore.toFixed(2)} below gate` },
            { num: 4, cfg: L.l4_capability, name: 'Capability', note: l4Active ? (l4ProducedEvidence ? 'Sandboxed capability tool executed' : 'Capability tool ran but produced no usable evidence (sandboxed)') : `Dormant: risk ${riskScore.toFixed(2)} below gate` },
            { num: 5, cfg: L.l5_debate, name: 'Debate', note: ctx.debateTriggered ? 'Debate ran with real model rounds' : 'Dormant: no disagreement' },
            { num: 6, cfg: L.l6_heterogeneous, name: 'Heterogeneous Model', note: escalationReached ? 'Cloud verification via detection async review' : 'Dormant: below escalation threshold (async review off)' },
            { num: 7, cfg: L.l7_synthesis, name: 'Synthesis', note: 'Case file + lessons + policy suggestions synthesized' }
        ];
        for (const def of layerDefs) {
            traces.push({
                layer: def.num,
                name: def.name,
                activated: activated.has(def.num) || def.num === 5 && ctx.debateTriggered || def.num === 7 || def.num === 1,
                thinkingDepth: def.cfg.thinkingDepth,
                modelTier: def.cfg.modelTier,
                latencyMs: def.num === 3 && l3Active ? Date.now() - l3Start : def.num === 4 && l4Active ? Date.now() - l4Start : undefined,
                note: def.note
            });
        }
        return { evidence, traces };
    }

    private estimateRiskScore(results: (AnalysisResult | null)[]): number {
        return results.reduce((max, r) => {
            if (!r) return max;
            const sev = r.verdict === 'malicious' ? 1 : r.verdict === 'suspicious' ? 0.6 : r.verdict === 'unknown' ? 0.3 : 0.1;
            return Math.max(max, Math.min(1, sev * Math.max(r.confidence, 0.5)));
        }, 0);
    }

    private bestConfidence(results: (AnalysisResult | null)[]): number {
        const best = results.reduce((max, r) => (r && r.confidence > max ? r.confidence : max), 0);
        return best;
    }

    private selectCapabilityTool(threatType: AttackFamily, request: TrafficRequest): { name: string; parameters: Record<string, any> } | null {
        const registered = new Set(toolExecutor.listTools().map((t) => t.name));
        const body = request.body || request.path || '';

        if (threatType === 'sqli' && registered.has('explain_sql')) {
            return { name: 'explain_sql', parameters: { query: body } };
        }
        if ((threatType === 'ssrf' || threatType === 'automation') && registered.has('http_probe')) {
            return { name: 'http_probe', parameters: { url: request.path || '', method: request.method || 'GET' } };
        }
        // Payload-bearing attack families -> pattern check against the request body/path.
        if (
            (threatType === 'xss' || threatType === 'path_traversal' || threatType === 'command_injection')
            && registered.has('check_pattern')
        ) {
            return { name: 'check_pattern', parameters: { content: body } };
        }
        // Authentication / business-logic -> header analysis when headers are present.
        if (
            (threatType === 'authentication' || threatType === 'business_logic')
            && registered.has('analyze_headers')
            && request.headers
            && Object.keys(request.headers).length > 0
        ) {
            return { name: 'analyze_headers', parameters: { headers: request.headers } };
        }
        // Encoded/obfuscated payloads -> attempt decode.
        if ((threatType === 'other') && registered.has('decode_payload') && body) {
            return { name: 'decode_payload', parameters: { payload: body } };
        }
        return null;
    }

    private toolOutputWasBlocked(output: unknown): boolean {
        if (!output || typeof output !== 'object' || Array.isArray(output)) {
            return false;
        }
        const status = (output as { status?: unknown }).status;
        return status === 'blocked' || status === 'denied' || status === 'ssrf_blocked';
    }

    /**
     * Evaluate the 7-layer cascade against the real decision state and return the
     * layers that actually activated, in order. Each layer fires only when its
     * activation condition holds AND its lower-layer dependencies fired — so the
     * seven layers behave as differentiated teams that engage at different depths
     * and triggers, not a flat always-on pipeline.
     */
    private evaluateLayerCascade(ctx: {
        results: (AnalysisResult | null)[];
        primaryConfidence: number;
        threatType: AttackFamily;
        debateTriggered: boolean;
        escalationReached: boolean;
        forceDebate: boolean;
    }): number[] {
        const layers = this.config.layers;
        const order: Array<{ num: number; cfg: LayerConfig }> = [
            { num: 1, cfg: layers.l1_collaboration },
            { num: 2, cfg: layers.l2_rolePlaying },
            { num: 3, cfg: layers.l3_sceneTraversal },
            { num: 4, cfg: layers.l4_capability },
            { num: 5, cfg: layers.l5_debate },
            { num: 6, cfg: layers.l6_heterogeneous },
            { num: 7, cfg: layers.l7_synthesis }
        ];
        // Risk proxy: confidence-weighted severity of the strongest role result.
        const riskScore = ctx.results.reduce((max, r) => {
            if (!r) return max;
            const sev = r.verdict === 'malicious' ? 1
                : r.verdict === 'suspicious' ? 0.6
                : r.verdict === 'unknown' ? 0.3 : 0.1;
            return Math.max(max, Math.min(1, sev * Math.max(r.confidence, 0.5)));
        }, 0);

        const activated = new Set<number>();
        for (const { num, cfg } of order) {
            if (!cfg.enabled) continue;
            if (!this.evaluateLayerActivation(cfg.activation, {
                activatedLayers: activated,
                riskScore,
                primaryConfidence: ctx.primaryConfidence,
                debateTriggered: ctx.debateTriggered || ctx.forceDebate,
                escalationReached: ctx.escalationReached,
                attackFamily: ctx.threatType
            })) {
                continue;
            }
            activated.add(num);
        }
        return Array.from(activated).sort((a, b) => a - b);
    }

    private evaluateLayerActivation(
        activation: LayerActivation | undefined,
        ctx: {
            activatedLayers: Set<number>;
            riskScore: number;
            primaryConfidence: number;
            debateTriggered: boolean;
            escalationReached: boolean;
            attackFamily: AttackFamily;
        }
    ): boolean {
        if (!activation || activation.always) return true;
        if (activation.requiresLayers && !activation.requiresLayers.every((n) => ctx.activatedLayers.has(n))) {
            return false;
        }
        if (typeof activation.minRiskScore === 'number' && ctx.riskScore < activation.minRiskScore) return false;
        if (typeof activation.maxPrimaryConfidence === 'number' && ctx.primaryConfidence > activation.maxPrimaryConfidence) return false;
        if (typeof activation.minPrimaryConfidence === 'number' && ctx.primaryConfidence < activation.minPrimaryConfidence) return false;
        if (activation.requiresDebateTrigger && !ctx.debateTriggered) return false;
        if (activation.requiresEscalation && !ctx.escalationReached) return false;
        if (activation.attackFamilies && activation.attackFamilies.length > 0 && !activation.attackFamilies.includes(ctx.attackFamily)) return false;
        return true;
    }

    private shouldTriggerDebate(results: AgentAnalysisResult[]): ReturnType<typeof buildDebateTriggerMetrics> {
        const validResults = results.filter(r => r !== null) as AnalysisResult[];
        
        if (validResults.length < 2) {
            return {
                triggered: false,
                labelConflict: false,
                confidenceRange: 0,
                divergence: 0,
                reasons: []
            };
        }

        return buildDebateTriggerMetrics(
            validResults,
            this.config.thresholds.debateDivergence,
            this.config.thresholds.debateConfidenceRange
        );
    }

    private async triggerDebate(
        task: AnalysisTask, 
        request: TrafficRequest, 
        results: AnalysisResult[],
        triggerMetrics: ReturnType<typeof buildDebateTriggerMetrics>
    ) {
        return this.debateProtocol.initiateDebate(
            task.requestId,
            results.filter((result): result is AnalysisResult => result != null),
            request,
            triggerMetrics
        );
    }

    private mapDebateVerdictToDecision(verdict: 'safe' | 'malicious' | 'requires_review'): SecurityDecision['verdict'] {
        switch (verdict) {
            case 'safe':
                return 'allow';
            case 'malicious':
                return 'block';
            default:
                return 'monitor';
        }
    }

    private calculateThreatLevel(
        verdict: string, 
        evidence: Evidence[]
    ): SecurityDecision['threatLevel'] {
        if (verdict === 'malicious') {
            const hasCritical = evidence.some(e => e.severity === 'critical');
            return hasCritical ? 'critical' : 'high';
        }

        if (verdict === 'suspicious') {
            return 'medium';
        }

        if (verdict === 'unknown') {
            return 'low';
        }

        return 'none';
    }

    private determineActions(
        verdict: SecurityDecision['verdict'],
        threatLevel: string,
        request: TrafficRequest
    ): CaseAction[] {
        const actions: CaseAction[] = [];

        switch (verdict) {
            case 'block':
                actions.push({
                    action: 'block',
                    target: request.sourceIP,
                    reason: `Threat detected: ${threatLevel}`,
                    duration: 3600,
                    automated: true
                });
                break;
            case 'monitor':
                actions.push({
                    action: 'monitor',
                    target: request.sourceIP,
                    reason: 'Suspicious activity detected',
                    automated: true
                });
                break;
            case 'challenge':
                actions.push({
                    action: 'investigate',
                    target: request.sourceIP,
                    reason: 'Uncertain - requires review',
                    automated: false
                });
                break;
        }

        return actions;
    }

    private buildReasoning(
        results: (AnalysisResult | null)[],
        triggerMetrics?: ReturnType<typeof buildDebateTriggerMetrics>,
        debateReasoning?: string
    ): string {
        const validResults = results.filter(r => r !== null) as AnalysisResult[];
        
        if (validResults.length === 0) {
            return 'No analysis results available';
        }

        const parts = validResults.map(r => 
            `[${r.role}]: ${r.reasoning} (confidence: ${(r.confidence * 100).toFixed(0)}%, route: ${r.routeMode || 'unknown'})`
        );

        if (triggerMetrics?.triggered) {
            parts.push(`debate_trigger=${triggerMetrics.reasons.join(',')}; divergence=${triggerMetrics.divergence.toFixed(3)}; range=${triggerMetrics.confidenceRange.toFixed(3)}`);
        }
        if (debateReasoning) {
            parts.push(`debate_outcome=${debateReasoning}`);
        }

        return parts.join(' | ');
    }

    private createDefaultDecision(request: TrafficRequest, taskId: string, threatType: AttackFamily): SecurityDecision {
        return {
            id: uuidv4(),
            requestId: request.id,
            timestamp: new Date(),
            verdict: 'challenge',
            confidence: 0.5,
            threatLevel: 'low',
            reasoning: 'Unable to complete analysis - defaulting to challenge',
            evidence: [],
            actions: [{
                action: 'investigate',
                target: request.sourceIP,
                reason: 'Analysis incomplete',
                automated: false
            }],
            caseFileId: taskId,
            processingTime: 0,
            layersActivated: [1],
            experimentMode: this.config.experimentMode || 'multi_agent_with_debate',
            attackFamily: threatType,
            routeMode: 'unknown',
            // No agent produced a model-backed result on this path.
            heuristicFallbackCount: 0,
            heuristicDegraded: true,
            stageLatencies: {
                proxyMs: 0,
                roleAnalysisMs: 0,
                debateMs: 0,
                synthesisMs: 0,
                asyncReviewMs: 0,
                endToEndMs: 0
            }
        };
    }

    async shutdown(): Promise<void> {
        for (const agent of Object.values(this.agents)) {
            await agent.shutdown();
        }
        this.activeTasks.clear();
        logger.info('Agent Orchestrator shutdown complete');
    }

    getAgent(role: AgentRole): BaseAgent | undefined {
        return this.agents[role];
    }

    getActiveTaskCount(): number {
        return this.activeTasks.size;
    }

    getStats(): {
        activeTasks: number;
        registeredAgents: number;
        messageBusStats: ReturnType<MessageBus['getStats']>;
    } {
        return {
            activeTasks: this.activeTasks.size,
            registeredAgents: Object.keys(this.agents).length,
            messageBusStats: this.messageBus.getStats()
        };
    }

    getAgents(): Record<string, BaseAgent> {
        return { ...this.agents };
    }

    /** Recent per-layer cascade traces, newest first (observability for the viz). */
    getRecentCascadeTraces() {
        return this.recentTraces.map((entry) => ({
            requestId: entry.requestId,
            verdict: entry.verdict,
            timestamp: entry.timestamp,
            traces: entry.traces
        }));
    }
}

export default AgentOrchestrator;
