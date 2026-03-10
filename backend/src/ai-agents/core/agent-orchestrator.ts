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
    CaseAction
} from './types';
import { BaseAgent, ExpertAgent } from './base-agent';
import { MessageBus, globalMessageBus } from './message-bus';
import { SocratesAgent } from '../roles/socrates-agent';
import { PlatoAgent } from '../roles/plato-agent';
import { AristotleAgent } from '../roles/aristotle-agent';
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
}

export class AgentOrchestrator {
    private agents: AgentRegistry = {};
    private messageBus: MessageBus;
    private config: MultiAgentConfig;
    private activeTasks: Map<string, AnalysisTask> = new Map();
    private expertRouting: Map<string, AgentRole[]> = new Map();

    constructor(config: MultiAgentConfig, messageBus: MessageBus = globalMessageBus) {
        this.config = config;
        this.messageBus = messageBus;
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
            maxRetries: 3
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
        this.expertRouting.set('sql_injection', ['socrates', 'plato', 'aristotle']);
        this.expertRouting.set('xss', ['socrates', 'plato', 'aristotle']);
        this.expertRouting.set('command_injection', ['socrates', 'plato']);
        this.expertRouting.set('path_traversal', ['socrates', 'plato']);
        this.expertRouting.set('authentication', ['aristotle', 'plato']);
        this.expertRouting.set('rate_limit', ['aristotle']);
        this.expertRouting.set('business_logic', ['socrates', 'aristotle']);
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
            const assignedAgents = this.routeToExperts(threatType);

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

            const decision = await this.makeDecision(task, request);

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

    private classifyThreatType(request: TrafficRequest): string {
        const content = [
            request.path,
            request.body || '',
            JSON.stringify(request.queryParams || {}),
            request.userAgent || ''
        ].join(' ').toLowerCase();

        if (content.includes('select') || content.includes('union') || content.includes("' or ")) {
            return 'sql_injection';
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
        if (content.includes('login') || content.includes('auth') || content.includes('token')) {
            return 'authentication';
        }

        return 'default';
    }

    private routeToExperts(threatType: string): AgentRole[] {
        return this.expertRouting.get(threatType) || this.expertRouting.get('default')!;
    }

    private async makeDecision(task: AnalysisTask, request: TrafficRequest): Promise<SecurityDecision> {
        const results = Array.from(task.results.values());
        
        if (results.length === 0) {
            return this.createDefaultDecision(request, task.id);
        }

        const allEvidence: Evidence[] = [];
        let maxConfidence = 0;
        let worstVerdict: 'safe' | 'suspicious' | 'malicious' | 'unknown' = 'safe';

        for (const result of results) {
            if (result) {
                allEvidence.push(...result.evidence);

                if (result.confidence > maxConfidence) {
                    maxConfidence = result.confidence;
                }

                if (this.verdictSeverity(result.verdict) > this.verdictSeverity(worstVerdict)) {
                    worstVerdict = result.verdict;
                }
            }
        }

        const shouldDebate = this.shouldTriggerDebate(results);
        let finalVerdict: SecurityDecision['verdict'];
        let finalConfidence = maxConfidence;

        if (shouldDebate) {
            logger.info(`Debate triggered for request ${request.id}`);
            const debateResult = await this.triggerDebate(task, request, results);
            finalVerdict = debateResult.verdict;
            finalConfidence = debateResult.confidence;
        } else {
            finalVerdict = this.mapVerdictToDecision(worstVerdict);
        }

        const threatLevel = this.calculateThreatLevel(worstVerdict, allEvidence);
        const actions = this.determineActions(finalVerdict, threatLevel, request);

        return {
            id: uuidv4(),
            requestId: request.id,
            timestamp: new Date(),
            verdict: finalVerdict,
            confidence: finalConfidence,
            threatLevel,
            reasoning: this.buildReasoning(results),
            evidence: allEvidence,
            actions,
            caseFileId: task.id,
            processingTime: Date.now() - task.startTime.getTime(),
            layersActivated: [1, 2]
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

    private shouldTriggerDebate(results: (AnalysisResult | null)[]): boolean {
        const validResults = results.filter(r => r !== null) as AnalysisResult[];
        
        if (validResults.length < 2) return false;

        const verdicts = validResults.map(r => r.verdict);
        const hasConflict = verdicts.some(v => v === 'malicious') && 
                           verdicts.some(v => v === 'safe');

        const confidenceRange = Math.max(...validResults.map(r => r.confidence)) -
                               Math.min(...validResults.map(r => r.confidence));

        return hasConflict || confidenceRange > this.config.thresholds.debateTrigger;
    }

    private async triggerDebate(
        task: AnalysisTask, 
        request: TrafficRequest, 
        results: (AnalysisResult | null)[]
    ): Promise<{ verdict: SecurityDecision['verdict']; confidence: number }> {
        return {
            verdict: 'monitor',
            confidence: 0.7
        };
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

    private buildReasoning(results: (AnalysisResult | null)[]): string {
        const validResults = results.filter(r => r !== null) as AnalysisResult[];
        
        if (validResults.length === 0) {
            return 'No analysis results available';
        }

        const parts = validResults.map(r => 
            `[${r.role}]: ${r.reasoning} (confidence: ${(r.confidence * 100).toFixed(0)}%)`
        );

        return parts.join(' | ');
    }

    private createDefaultDecision(request: TrafficRequest, taskId: string): SecurityDecision {
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
            layersActivated: [1]
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
