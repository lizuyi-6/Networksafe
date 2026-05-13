/**
 * Agent Orchestrator - L1: Multi-Agent Collaboration Layer
 * Routes traffic to specialized agents and coordinates analysis
 */

import { v4 as uuidv4 } from 'uuid';
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
    AnalysisResult as AgentAnalysisResult
} from './types';
import { BaseAgent, ExpertAgent } from './base-agent';
import { MessageBus, globalMessageBus } from './message-bus';
import { SocratesAgent } from '../roles/socrates-agent';
import { PlatoAgent } from '../roles/plato-agent';
import { AristotleAgent } from '../roles/aristotle-agent';
import { DebateProtocol } from '../debate/debate-protocol';
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
                modelConfig: this.config.models.cloud,
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
                modelConfig: this.config.models.cloud,
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
                modelConfig: this.config.models.cloud,
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
                modelConfig: this.config.models.cloud,
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
                modelConfig: this.config.models.cloud,
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
        const shouldDebate =
            request.forceDebate === true ||
            request.analysisPurpose === 'blocking_review' ||
            (request.analysisPurpose !== 'primary' &&
            this.config.experimentMode !== 'single_agent' &&
            this.config.experimentMode !== 'multi_agent_no_debate' &&
            triggerMetrics.triggered);
        let finalVerdict: SecurityDecision['verdict'] = verdictToDecision(aggregateVerdict);
        let finalConfidence = confidenceFromDistribution(aggregateDistribution);
        let debateSession;

        if (shouldDebate) {
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
        const layersActivated = [1, 2];
        if (results.some((result) => result.modelTier)) {
            layersActivated.push(6);
        }
        if (debateSession) {
            layersActivated.push(5);
        }

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
            aggregatedDistribution: debateSession?.finalVerdict?.aggregatedDistribution || aggregateDistribution,
            analysisResults: results,
            experimentMode: this.config.experimentMode || 'multi_agent_with_debate',
            attackFamily: threatType,
            routeMode: results.find((result) => result.routeMode && result.routeMode !== 'unknown')?.routeMode || 'unknown',
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
}

export default AgentOrchestrator;
