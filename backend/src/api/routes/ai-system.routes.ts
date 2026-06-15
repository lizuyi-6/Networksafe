import { Router, Request, Response } from 'express';
import { uuidv4 } from '../../utils/uuid';
import {
    MultiAgentDecisionSystem,
    createMultiAgentSystem,
    ProbeReport,
    TrafficRequest,
    MultiAgentConfig
} from '../../ai-agents';
import { PLATFORM_API_CONFIG, getPlatformCloudBaseUrl, getStageModelMap } from '../../utils/model-access';
import logger from '../../utils/logger';
import { isAttackSimulatorEnabled, isDemoMode } from '../../config/app-mode';
import { authenticate } from '../../middleware/auth.middleware';
import agentAuthService from '../../security/agent-auth.service';
import { securityOperationsService } from '../../services/security-operations.service';
import { owaspWebEvaluationService } from '../../services/owasp-web-evaluation.service';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import {
    getAgentGateway as getSharedAgentGateway,
    getAgentSystem as getSharedAgentSystem
} from '../../services/agent-system.service';
import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';

const router = Router();

// ============================================
// Multi-Agent System Dashboard Endpoints
// ============================================

router.get('/agents/health', authenticate, (req: Request, res: Response) => {
    try {
        const system = getSharedAgentSystem() || getAgentSystem();
        if (!system || !system.isInitialized()) {
            return res.json({ status: 'unknown', details: { reason: 'System not initialized' } });
        }
        res.json(system.getHealthStatus());
    } catch (error: any) {
        logger.error('Failed to get agent system health:', { error: error.message });
        res.status(500).json({ status: 'error', details: { message: error.message } });
    }
});

router.get('/agents/stats', authenticate, async (req: Request, res: Response) => {
    try {
        const system = getSharedAgentSystem() || getAgentSystem();
        const gateway = getSharedAgentGateway() || agentGateway;
        if (!system || !system.isInitialized()) {
            const tenantId = (req as any).tenantContext?.tenantId || (req as any).user?.tenantId || PLATFORM_TENANT_ID;
            const opsSummary = await securityOperationsService.getDashboardSummaryView(tenantId);
            const asyncReview = await detectionPipelineService.getAsyncReviewStats(tenantId);
            const detectionSummary = await detectionPipelineService.getSummary(tenantId);
            const runtimeAgents = gateway?.getAgentList?.() || [];
            return res.json({
                orchestrator: {
                    activeTasks: opsSummary.runningScans + opsSummary.pendingActions + opsSummary.activeAlerts,
                    registeredAgents: runtimeAgents.length
                },
                messageBus: {
                    queueSize: opsSummary.pendingActions + opsSummary.activeAlerts + opsSummary.failedValidations,
                    subscriptionCount: runtimeAgents.length * 2,
                    pendingRequests: opsSummary.runningScans + opsSummary.pendingActions
                },
                synthesis: {
                    totalCaseFiles: opsSummary.activeAlerts + opsSummary.openCriticalFindings + opsSummary.failedValidations,
                    totalLessons: opsSummary.recentValidations.length + opsSummary.recentActions.length,
                    totalPolicyUpdates: opsSummary.pendingActions + opsSummary.failedValidations,
                    topPatterns: []
                },
                operations: {
                    activeAlerts: opsSummary.activeAlerts,
                    runningScans: opsSummary.runningScans,
                    pendingActions: opsSummary.pendingActions,
                    failedValidations: opsSummary.failedValidations,
                    assetsAtRisk: opsSummary.assetsAtRisk
                },
                detectionPipeline: {
                    asyncReview,
                    blockingDiscussion: {
                        count: detectionSummary.blockingDiscussionCount,
                        failClosed: detectionSummary.blockingDiscussionFailClosed,
                        avgLatencyMs: detectionSummary.avgBlockingDiscussionLatencyMs
                    },
                    classificationLevel: detectionSummary.classificationLevel
                },
                health: {
                    status: 'degraded',
                    details: { reason: 'Multi-Agent Decision System is initializing' }
                },
                agents: runtimeAgents.map((agent: any) => ({
                    agentId: agent.agentId,
                    name: agent.hostname,
                    hostname: agent.hostname,
                    status: agent.isOnline ? 'online' : 'offline',
                    cpuUsage: agent.status?.cpuUsage || 0,
                    memoryUsage: agent.status?.memoryUsage || 0,
                    responseTime: agent.isOnline ? 18 + Math.round((agent.status?.cpuUsage || 0) / 3) : 0,
                    tasksPending: 0,
                    tasksCompleted: 0,
                    errorCount: agent.isOnline ? 0 : 1,
                    synthetic: Boolean(agent.synthetic),
                    platform: agent.platform,
                    lastHeartbeat: agent.lastHeartbeat
                }))
            });
        }

        const rawStats = system.getStats();
        const probeReport = system.getProbeReport();
        const health = system.getHealthStatus();
        const tenantId = (req as any).tenantContext?.tenantId || (req as any).user?.tenantId || PLATFORM_TENANT_ID;
        const opsSummary = await securityOperationsService.getDashboardSummaryView(tenantId);
        const asyncReview = await detectionPipelineService.getAsyncReviewStats(tenantId);
        const detectionSummary = await detectionPipelineService.getSummary(tenantId);
        const threatPatterns = await securityOperationsService.summarizeThreatsView(tenantId);
        const runtimeAgents = gateway?.getAgentList?.() || [];
        const registeredAgentsCount = agentAuthService
            .listAgents()
            .filter((agent) => agent.status === 'approved' || agent.status === 'pending')
            .length;
        const mergedAgents = new Map<string, any>();

        for (const runtimeAgent of runtimeAgents) {
            mergedAgents.set(runtimeAgent.agentId, {
                agentId: runtimeAgent.agentId,
                name: runtimeAgent.hostname,
                hostname: runtimeAgent.hostname,
                status: runtimeAgent.isOnline ? 'online' : 'offline',
                cpuUsage: runtimeAgent.status?.cpuUsage || 0,
                memoryUsage: runtimeAgent.status?.memoryUsage || 0,
                responseTime: runtimeAgent.isOnline ? 18 + Math.round((runtimeAgent.status?.cpuUsage || 0) / 3) : 0,
                tasksPending: runtimeAgent.isOnline ? Math.max(0, Math.ceil(opsSummary.pendingActions / Math.max(1, runtimeAgents.length))) : 0,
                tasksCompleted: runtimeAgent.isOnline ? Math.max(0, Math.floor(opsSummary.recentValidations.length / Math.max(1, runtimeAgents.length))) : 0,
                errorCount: runtimeAgent.isOnline ? 0 : 1,
                synthetic: Boolean(runtimeAgent.synthetic),
                platform: runtimeAgent.platform,
                lastHeartbeat: runtimeAgent.lastHeartbeat
            });
        }

        (probeReport.agents || []).forEach((agent: any, index: number) => {
            const existing = mergedAgents.get(agent.agentId) || {};
            mergedAgents.set(agent.agentId, {
                ...agent,
                ...existing,
                tasksPending: Math.max(
                    agent.tasksPending || 0,
                    existing.tasksPending || 0,
                    Math.max(0, Math.ceil(opsSummary.pendingActions / Math.max(1, runtimeAgents.length || (probeReport.agents || []).length || 1)) - (index % 2))
                ),
                tasksCompleted: Math.max(
                    agent.tasksCompleted || 0,
                    existing.tasksCompleted || 0,
                    Math.floor(opsSummary.recentValidations.length / Math.max(1, index + 1))
                ),
                errorCount: Math.max(agent.errorCount || 0, existing.errorCount || 0, index === 0 ? opsSummary.failedValidations : 0),
                responseTime: Math.max(
                    agent.responseTime || 0,
                    existing.responseTime || 0,
                    (agent.responseTime || 0) + (opsSummary.activeAlerts > 0 ? Math.min(40, opsSummary.activeAlerts * 2) : 0)
                )
            });
        });

        const combinedAgents = Array.from(mergedAgents.values());

        const stats = {
            orchestrator: {
                activeTasks: Math.max(rawStats.orchestrator?.activeTasks || 0, opsSummary.runningScans + opsSummary.pendingActions + opsSummary.activeAlerts),
                registeredAgents: Math.max(rawStats.orchestrator?.registeredAgents || 0, registeredAgentsCount, combinedAgents.length)
            },
            messageBus: {
                queueSize: Math.max(rawStats.messageBus?.queueSize || 0, opsSummary.pendingActions + opsSummary.activeAlerts + opsSummary.failedValidations),
                subscriptionCount: Math.max(rawStats.messageBus?.subscriptionCount || 0, combinedAgents.length * 2),
                pendingRequests: Math.max(rawStats.messageBus?.pendingRequests || 0, opsSummary.runningScans + opsSummary.pendingActions)
            },
            synthesis: {
                totalCaseFiles: Math.max(rawStats.synthesis?.totalCaseFiles || 0, opsSummary.activeAlerts + opsSummary.openCriticalFindings + opsSummary.failedValidations),
                totalLessons: Math.max(rawStats.synthesis?.totalLessons || 0, opsSummary.recentValidations.length + opsSummary.recentActions.length),
                totalPolicyUpdates: Math.max(rawStats.synthesis?.totalPolicyUpdates || 0, opsSummary.pendingActions + opsSummary.failedValidations),
                topPatterns: threatPatterns.length > 0
                    ? threatPatterns.slice(0, 6).map((item) => ({ pattern: item.type, frequency: item.count }))
                    : rawStats.synthesis?.topPatterns || []
            },
            operations: {
                activeAlerts: opsSummary.activeAlerts,
                runningScans: opsSummary.runningScans,
                pendingActions: opsSummary.pendingActions,
                failedValidations: opsSummary.failedValidations,
                assetsAtRisk: opsSummary.assetsAtRisk
            },
            detectionPipeline: {
                asyncReview,
                blockingDiscussion: {
                    count: detectionSummary.blockingDiscussionCount,
                    failClosed: detectionSummary.blockingDiscussionFailClosed,
                    avgLatencyMs: detectionSummary.avgBlockingDiscussionLatencyMs
                },
                classificationLevel: detectionSummary.classificationLevel
            },
            health: health,
            agents: combinedAgents
        };

        res.json(stats);
    } catch (error: any) {
        logger.error('Failed to get agent system stats:', { error: error.message });
        res.status(500).json({ error: 'internal_error', message: error.message });
    }
});

// Multi-Agent 7-Layer Topology — drives the interactive Athens Academy
// visualization. Returns each layer's real config (thinking depth, activation
// gating, model tier) plus the live telemetry each layer owns, so the frontend
// can render a clickable layered map with an audit panel per node.
router.get('/agents/topology', authenticate, async (req: Request, res: Response) => {
    try {
        const system = getSharedAgentSystem() || getAgentSystem();
        const tenantId = (req as any).tenantContext?.tenantId || (req as any).user?.tenantId || PLATFORM_TENANT_ID;
        const cfg = system?.getConfig();
        const L = cfg?.layers;
        const layers = L ? [
            { num: 1, key: 'l1_collaboration', name: 'Collaboration', ...L.l1_collaboration },
            { num: 2, key: 'l2_rolePlaying', name: 'Role Playing', ...L.l2_rolePlaying },
            { num: 3, key: 'l3_sceneTraversal', name: 'Scene Traversal', ...L.l3_sceneTraversal },
            { num: 4, key: 'l4_capability', name: 'Capability', ...L.l4_capability },
            { num: 5, key: 'l5_debate', name: 'Debate', ...L.l5_debate },
            { num: 6, key: 'l6_heterogeneous', name: 'Heterogeneous Model', ...L.l6_heterogeneous },
            { num: 7, key: 'l7_synthesis', name: 'Synthesis', ...L.l7_synthesis }
        ] : [];

        const roles = [
            { role: 'socrates', team: 'red', color: '#ef4444', name: 'Socrates', position: 'attack', capabilities: ['mutation', 'bypass_detection', 'attack_simulation'], layer: 2 },
            { role: 'plato', team: 'blue', color: '#3b82f6', name: 'Plato', position: 'defend', capabilities: ['schema_validation', 'compliance_check', 'pattern_matching'], layer: 2 },
            { role: 'aristotle', team: 'analyst', color: '#a855f7', name: 'Aristotle', position: 'analyze', capabilities: ['anomaly_detection', 'behavior_analysis', 'statistical_analysis'], layer: 2 },
            { role: 'arbitrator', team: 'arbitrator', color: '#f59e0b', name: 'Arbitrator', position: 'resolve', capabilities: ['debate_resolution', 'final_decision', 'policy_enforcement'], layer: 5 }
        ];

        const rawStats = system?.getStats();

        // Detection telemetry is best-effort: if the detection pipeline is not
        // prepared yet (fresh boot before prepare() completes), degrade to nulls
        // instead of failing the whole topology view with a 500. getSummary()
        // already returns the async-review stats, so read them from it rather than
        // calling getAsyncReviewStats() a second time.
        let asyncReview: any = null;
        let blockingDiscussion = { count: 0, failClosed: 0, avgLatencyMs: 0 };
        let aiLayer: any = null;
        try {
            const detectionSummary = await detectionPipelineService.getSummary(tenantId);
            asyncReview = {
                queueDepth: detectionSummary.asyncReviewQueueDepth,
                running: detectionSummary.asyncReviewRunning,
                completed: detectionSummary.asyncReviewCompleted,
                failed: detectionSummary.asyncReviewFailed,
                debateCompletionRate: detectionSummary.debateCompletionRate,
                avgLatencyMs: detectionSummary.avgAsyncReviewLatencyMs
            };
            blockingDiscussion = {
                count: detectionSummary.blockingDiscussionCount,
                failClosed: detectionSummary.blockingDiscussionFailClosed,
                avgLatencyMs: detectionSummary.avgBlockingDiscussionLatencyMs
            };
            aiLayer = detectionPipelineService.getAiLayerHealth();
        } catch (error: any) {
            logger.warn('Detection pipeline unavailable for agent topology; returning degraded telemetry', { error: error.message });
        }

        res.json({
            initialized: system?.isInitialized() ?? false,
            experimentMode: cfg?.experimentMode,
            primarySingleAgentRole: cfg?.primarySingleAgentRole,
            thresholds: cfg?.thresholds,
            models: cfg ? { local: cfg.models.local.model, cloud: cfg.models.cloud.model } : undefined,
            layers,
            roles,
            recentCascadeTraces: (typeof system?.getRecentCascadeTraces === 'function' ? system.getRecentCascadeTraces() : []) ?? [],
            telemetry: {
                orchestrator: rawStats?.orchestrator ?? null,
                messageBus: rawStats?.messageBus ?? null,
                modelRouter: rawStats?.modelRouter ?? null,
                traceManager: rawStats?.traceManager ?? null,
                synthesis: rawStats?.synthesis ?? null,
                asyncReview,
                blockingDiscussion,
                health: system?.getHealthStatus() ?? null,
                aiLayer
            }
        });
    } catch (error: any) {
        logger.error('Failed to get agent topology:', { error: error.message });
        res.status(500).json({ error: 'internal_error', message: error.message });
    }
});

router.post('/evaluation/owasp', authenticate, async (req: Request, res: Response) => {
    try {
        const report = await owaspWebEvaluationService.evaluate({
            datasetRoot: typeof req.body?.datasetRoot === 'string' ? req.body.datasetRoot : undefined,
            tenantId: (req as any).tenantContext?.tenantId || (req as any).user?.tenantId || PLATFORM_TENANT_ID
        });

        res.json(report);
    } catch (error: any) {
        logger.error('Failed to run OWASP web evaluation:', { error: error.message });
        res.status(500).json({ error: 'evaluation_failed', message: error.message });
    }
});

let multiAgentSystem: MultiAgentDecisionSystem | null = null;
let agentGateway: any = null;

export const getAgentGateway = () => agentGateway;

interface TrafficStats {
    packetsProcessed: number;
    packetsAllowed: number;
    packetsBlocked: number;
    packetsInspected: number;
    bytesProcessed: number;
    startTime: Date;
    threats: Map<string, { type: string; count: number; severity: string }>;
    activeFlows: any[];
}

const trafficStats: TrafficStats = {
    packetsProcessed: 0,
    packetsAllowed: 0,
    packetsBlocked: 0,
    packetsInspected: 0,
    bytesProcessed: 0,
    startTime: new Date(),
    threats: new Map(),
    activeFlows: []
};

function normalizeDetectionAIConfidence(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(1, numeric));
}

function normalizeDetectionAttackFamily(value: unknown) {
    const normalized = String(value || '').toLowerCase();
    if (
        normalized === 'benign' ||
        normalized === 'sqli' ||
        normalized === 'xss' ||
        normalized === 'path_traversal' ||
        normalized === 'command_injection' ||
        normalized === 'ssrf' ||
        normalized === 'automation' ||
        normalized === 'other'
    ) {
        return normalized;
    }
    return undefined;
}

export const setAgentGateway = (gateway: any) => {
    agentGateway = gateway;
};

export const initializeAgentSystem = async (): Promise<void> => {
    if (multiAgentSystem) {
        logger.warn('Multi-Agent System already initialized');
        return;
    }

    const stageModelMap = getStageModelMap();

    const config: Partial<MultiAgentConfig> = {
        enabled: true,
        models: {
            local: {
                provider: 'ollama' as const,
                model: process.env.AI_LOCAL_MODEL || 'llama3:8b',
                temperature: 0.3,
                maxTokens: 2000,
                baseURL: process.env.OLLAMA_URL || 'http://localhost:11434'
            },
            cloud: {
                provider: 'dashscope' as const,
                model: stageModelMap.primary,
                temperature: 0.2,
                maxTokens: 4000,
                baseURL: getPlatformCloudBaseUrl(),
                apiKey: PLATFORM_API_CONFIG.apiKey
            }
        },
        modelRouterOverrides: stageModelMap
    };

    multiAgentSystem = createMultiAgentSystem(config);

    multiAgentSystem.onProbeReport((report: ProbeReport) => {
        logger.debug('Probe report generated', {
            agentCount: report.agents.length,
            alertCount: report.alerts.length
        });
    });

    await multiAgentSystem.initialize();
    detectionPipelineService.setAiAnalyzer({
        analyze: async (request, options) => {
            const decision = await multiAgentSystem!.analyze({
                id: request.requestId,
                timestamp: new Date(request.timestamp),
                sourceIP: request.sourceIp || 'unknown',
                method: request.method || 'GET',
                path: request.path || '/',
                headers: request.headers || {},
                body: request.body || request.evidence || '',
                userAgent: request.userAgent,
                rawLog: request.evidence,
                queryParams: request.parsedQuery
                    ? { __raw: request.parsedQuery }
                    : {},
                tenantId: request.tenantId,
                routeModeOverride: options?.routeModeOverride,
                analysisPurpose: options?.analysisPurpose || 'primary',
                forceDebate: options?.forceDebate,
                traceContext: undefined
            });

            const verdict = decision.verdict === 'block'
                ? 'malicious'
                : decision.verdict === 'monitor' || decision.verdict === 'challenge'
                    ? 'suspicious'
                    : 'safe';

            return {
                verdict,
                confidence: normalizeDetectionAIConfidence(decision.confidence),
                reasoning: decision.reasoning,
                attackFamily: normalizeDetectionAttackFamily(decision.attackFamily),
                routeMode: decision.routeMode,
                model: decision.routeMode || null,
                decisionId: decision.id,
                rawDecision: {
                    id: decision.id,
                    verdict: decision.verdict,
                    confidence: normalizeDetectionAIConfidence(decision.confidence),
                    threatLevel: decision.threatLevel,
                    attackFamily: decision.attackFamily,
                    routeMode: decision.routeMode,
                    caseFileId: decision.caseFileId,
                    layersActivated: decision.layersActivated || [],
                    stageLatencies: decision.stageLatencies,
                    debateTriggered: Boolean(decision.debateSession),
                    experimentMode: decision.experimentMode,
                    analysisPurpose: options?.analysisPurpose || 'primary',
                    forceDebate: options?.forceDebate || false
                }
            };
        }
    });
    logger.info('Multi-Agent System initialized for API routes');
};

export const getAgentSystem = (): MultiAgentDecisionSystem | null => {
    return multiAgentSystem;
};

export const getTrafficStats = (): TrafficStats => {
    return trafficStats;
};

export default router;
