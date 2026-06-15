/**
 * Multi-Agent Decision System - Main Entry Point
 * 7-Layer Architecture for AI-powered Security Analysis
 * 
 * L1: Multi-Agent Collaboration - Traffic routing to specialized agents
 * L2: Role Playing - Socrates (Red), Plato (Blue), Aristotle (Analyst)
 * L3: Scene Traversal - Distributed tracing and attack narrative
 * L4: Capability Incarnation - Safe tool execution
 * L5: Debate Protocol - Multi-agent debate with arbitrator
 * L6: Heterogeneous Model - Local + Cloud model collaboration
 * L7: Synthesis - Case files and self-evolution
 */

import {
    MultiAgentConfig,
    TrafficRequest,
    TrafficContext,
    SecurityDecision,
    CaseFile,
    AnalysisResult,
    DebateSession,
    AttackNarrative
} from './core/types';
import { AgentOrchestrator } from './core/agent-orchestrator';
import { MessageBus, globalMessageBus } from './core/message-bus';
import { DebateProtocol } from './debate/debate-protocol';
import { TraceContextManager, traceContextManager } from './tracing/trace-context';
import { ToolExecutor, toolExecutor } from './capabilities/tool-executor';
import { ModelRouter, modelRouter } from './models/model-router';
import { SynthesisEngine, synthesisEngine } from './synthesis/synthesis-engine';
import { ProbeAgent, ProbeReport } from './monitoring/probe-agent';
import logger from '../utils/logger';

export * from './core/types';
export { AgentOrchestrator } from './core/agent-orchestrator';
export { BaseAgent, ExpertAgent } from './core/base-agent';
export { MessageBus, globalMessageBus } from './core/message-bus';
export { SocratesAgent } from './roles/socrates-agent';
export { PlatoAgent } from './roles/plato-agent';
export { AristotleAgent } from './roles/aristotle-agent';
export { DebateProtocol } from './debate/debate-protocol';
export { TraceContextManager, traceContextManager } from './tracing/trace-context';
export { ToolExecutor, toolExecutor } from './capabilities/tool-executor';
export { ModelRouter, modelRouter } from './models/model-router';
export { SynthesisEngine, synthesisEngine } from './synthesis/synthesis-engine';
export { ProbeAgent } from './monitoring/probe-agent';
export type { ProbeReport, AgentHeartbeat, SystemMetrics, ProbeAlert, ProbeConfig } from './monitoring/probe-agent';

const DEFAULT_CONFIG: MultiAgentConfig = {
    enabled: true,
    experimentMode: 'multi_agent_with_debate',
    primarySingleAgentRole: 'aristotle',
    heuristicOnly: false,
    useIsolatedBus: false,
    layers: {
        l1_collaboration: { enabled: true, priority: 1, timeout: 5000, maxConcurrency: 10, thinkingDepth: 'shallow', modelTier: 'local', activation: { always: true } },
        l2_rolePlaying: { enabled: true, priority: 2, timeout: 10000, maxConcurrency: 3, thinkingDepth: 'standard', modelTier: 'local', activation: { requiresLayers: [1] } },
        l3_sceneTraversal: { enabled: true, priority: 3, timeout: 5000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { requiresLayers: [2], minRiskScore: 0.4 } },
        l4_capability: { enabled: true, priority: 4, timeout: 30000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { requiresLayers: [2], minRiskScore: 0.6 } },
        l5_debate: { enabled: true, priority: 5, timeout: 60000, maxConcurrency: 3, thinkingDepth: 'deep', modelTier: 'cloud', activation: { requiresLayers: [2], requiresDebateTrigger: true } },
        l6_heterogeneous: { enabled: true, priority: 6, timeout: 30000, maxConcurrency: 10, thinkingDepth: 'deliberative', modelTier: 'cloud', activation: { requiresLayers: [2], requiresEscalation: true } },
        l7_synthesis: { enabled: true, priority: 7, timeout: 5000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { always: true } }
    },
    models: {
        local: {
            provider: 'ollama',
            model: 'llama3:8b',
            temperature: 0.3,
            maxTokens: 2000,
            baseURL: 'http://localhost:11434'
        },
        cloud: {
            provider: 'zhipu',
            model: 'glm-4',
            temperature: 0.2,
            maxTokens: 4000
        }
    },
    thresholds: {
        debateTrigger: 0.3,
        debateDivergence: 0.3,
        debateConfidenceRange: 0.3,
        cloudEscalation: 0.6,
        autoBlock: 0.85
    },
    timeouts: {
        analysis: 10000,
        debate: 60000,
        toolExecution: 30000,
        modelResponse: 30000
    }
};

// Deep-merge nested config maps (layers/models/thresholds/timeouts) so a caller
// passing a partial `layers`/`models` override does not replace the default and
// silently drop fields like `activation` (which would make gating always-on).
function mergeMultiAgentConfig(
    defaults: MultiAgentConfig,
    override: Partial<MultiAgentConfig>
): MultiAgentConfig {
    const merged: MultiAgentConfig = { ...defaults, ...override };
    if (override.layers) {
        const defaultLayers = defaults.layers;
        merged.layers = { ...defaultLayers };
        for (const key of Object.keys(override.layers) as Array<keyof typeof defaultLayers>) {
            const partial = override.layers[key];
            if (partial) {
                merged.layers[key] = { ...defaultLayers[key], ...partial };
            }
        }
    }
    if (override.models) {
        merged.models = {
            local: { ...defaults.models.local, ...override.models.local },
            cloud: { ...defaults.models.cloud, ...override.models.cloud }
        };
    }
    if (override.thresholds) {
        merged.thresholds = { ...defaults.thresholds, ...override.thresholds };
    }
    if (override.timeouts) {
        merged.timeouts = { ...defaults.timeouts, ...override.timeouts };
    }
    return merged;
}

export class MultiAgentDecisionSystem {
    private config: MultiAgentConfig;
    private orchestrator: AgentOrchestrator;
    private debateProtocol: DebateProtocol;
    private traceManager: TraceContextManager;
    private toolExecutor: ToolExecutor;
    private modelRouter: ModelRouter;
    private synthesisEngine: SynthesisEngine;
    private probeAgent: ProbeAgent;
    private messageBus: MessageBus;
    private initialized: boolean = false;
    private probeReportCallback: ((report: ProbeReport) => void) | null = null;

    constructor(config: Partial<MultiAgentConfig> = {}) {
        this.config = mergeMultiAgentConfig(DEFAULT_CONFIG, config);
        this.messageBus = this.config.useIsolatedBus ? new MessageBus() : globalMessageBus;
        this.orchestrator = new AgentOrchestrator(this.config, this.messageBus);
        this.debateProtocol = new DebateProtocol(this.messageBus);
        this.traceManager = traceContextManager;
        this.toolExecutor = toolExecutor;
        // Inject stage model overrides into the shared model router
        if (this.config.modelRouterOverrides) {
            modelRouter.updateStageOverrides(this.config.modelRouterOverrides);
        }
        this.modelRouter = modelRouter;
        this.synthesisEngine = synthesisEngine;
        this.probeAgent = new ProbeAgent(
            {
                identity: {
                    id: 'probe-main',
                    role: 'orchestrator',
                    team: 'analyst',
                    name: 'ProbeAgent',
                    description: 'System monitoring and health check agent',
                    capabilities: ['monitoring', 'health_check', 'metrics_collection']
                },
                modelConfig: this.config.models.local,
                timeout: 5000,
                maxRetries: 1
            },
            this.messageBus
        );
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn('Multi-Agent Decision System already initialized');
            return;
        }

        this.messageBus.setModelRequestHandler(async (request) => {
            return this.modelRouter.route(request);
        });

        await this.orchestrator.initialize();
        await this.probeAgent.initialize();

        // Register orchestrator agents with probe agent for monitoring
        const orchestratorAgents = this.orchestrator.getAgents();
        for (const [role, agent] of Object.entries(orchestratorAgents)) {
            this.probeAgent.updateAgentHeartbeat({
                agentId: agent.getIdentity().id,
                role: role as any,
                status: 'healthy',
                lastSeen: new Date(),
                responseTime: 0,
                tasksCompleted: 0,
                tasksPending: 0,
                errorCount: 0,
                memoryUsage: 0,
                cpuUsage: 0
            });
        }

        this.probeAgent.onReport((report) => {
            if (this.probeReportCallback) {
                this.probeReportCallback(report);
            }
        });

        this.initialized = true;
        logger.info('Multi-Agent Decision System initialized', {
            layers: Object.keys(this.config.layers).length,
            thresholds: this.config.thresholds,
            probeAgent: 'active'
        });
    }

    async analyze(
        request: TrafficRequest,
        context?: Partial<TrafficContext>
    ): Promise<SecurityDecision> {
        if (!this.initialized) {
            await this.initialize();
        }

        const startTime = Date.now();
        const traceId = request.traceContext?.traceId || this.createTraceId();

        this.traceManager.addTraceEvent(traceId, {
            service: 'multi-agent-system',
            event: `Analysis started for ${request.method} ${request.path}`,
            severity: 'info'
        });

        try {
            const decision = await this.orchestrator.analyze(request, context);

            this.traceManager.addTraceEvent(traceId, {
                service: 'orchestrator',
                event: `Decision: ${decision.verdict} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`,
                severity: decision.threatLevel === 'critical' ? 'critical' :
                          decision.threatLevel === 'high' ? 'error' :
                          decision.threatLevel === 'medium' ? 'warning' : 'info'
            });

            const narrative = this.traceManager.buildAttackNarrative(traceId);
            
            const debate = decision.debateSession;

            const caseFile = this.synthesisEngine.generateCaseFile(
                decision,
                narrative,
                debate || this.createEmptyDebate(request.id)
            );

            decision.caseFileId = caseFile.id;
            decision.processingTime = Date.now() - startTime;
            decision.layersActivated = Array.from(new Set([...(decision.layersActivated || []), 7])).sort();
            if (decision.stageLatencies) {
                decision.stageLatencies.synthesisMs = Number((Date.now() - startTime - (decision.stageLatencies.roleAnalysisMs + decision.stageLatencies.debateMs)).toFixed(2));
                decision.stageLatencies.endToEndMs = Number((Date.now() - startTime).toFixed(2));
            }

            this.traceManager.addTraceEvent(traceId, {
                service: 'synthesis',
                event: `Case file generated: ${caseFile.id}`,
                severity: 'info'
            });

            return decision;

        } catch (error: any) {
            logger.error('Multi-Agent analysis failed', { 
                error: error.message, 
                requestId: request.id 
            });

            this.traceManager.addTraceEvent(traceId, {
                service: 'error-handler',
                event: `Analysis failed: ${error.message}`,
                severity: 'critical'
            });

            throw error;
        }
    }

    private createTraceId(): string {
        return `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private createEmptyDebate(requestId: string): DebateSession {
        return {
            id: 'no-debate',
            requestId,
            topic: 'No debate required',
            participants: [],
            rounds: [],
            status: 'resolved',
            startTime: new Date(),
            finalVerdict: {
                decision: 'safe',
                confidence: 0.5,
                reasoning: 'No debate was triggered',
                votingRecord: [],
                arbitratorNotes: 'Skipped debate phase',
                aggregatedDistribution: {
                    safe: 0.5,
                    suspicious: 0.3,
                    malicious: 0.2
                }
            }
        };
    }

    async shutdown(): Promise<void> {
        await this.probeAgent.shutdown();
        await this.orchestrator.shutdown();
        this.messageBus.shutdown();
        this.initialized = false;
        logger.info('Multi-Agent Decision System shutdown complete');
    }

    onProbeReport(callback: (report: ProbeReport) => void): void {
        this.probeReportCallback = callback;
    }

    getProbeReport(): ProbeReport {
        return this.probeAgent.generateReport();
    }

    getHealthStatus(): { status: 'healthy' | 'degraded' | 'unhealthy'; details: Record<string, string> } {
        return this.probeAgent.getHealthStatus();
    }

    getRecentCascadeTraces(): ReturnType<AgentOrchestrator['getRecentCascadeTraces']> {
        return this.orchestrator.getRecentCascadeTraces();
    }

    getStats(): {
        orchestrator: ReturnType<AgentOrchestrator['getStats']>;
        messageBus: ReturnType<MessageBus['getStats']>;
        traceManager: ReturnType<TraceContextManager['getStats']>;
        modelRouter: ReturnType<ModelRouter['getStats']>;
        synthesis: ReturnType<SynthesisEngine['getEvolutionStats']>;
    } {
        return {
            orchestrator: this.orchestrator.getStats(),
            messageBus: this.messageBus.getStats(),
            traceManager: this.traceManager.getStats(),
            modelRouter: this.modelRouter.getStats(),
            synthesis: this.synthesisEngine.getEvolutionStats()
        };
    }

    getConfig(): MultiAgentConfig {
        return { ...this.config };
    }

    isInitialized(): boolean {
        return this.initialized;
    }
}

export const createMultiAgentSystem = (config?: Partial<MultiAgentConfig>): MultiAgentDecisionSystem => {
    return new MultiAgentDecisionSystem(config);
};

export default MultiAgentDecisionSystem;
