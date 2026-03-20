import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    MultiAgentDecisionSystem,
    createMultiAgentSystem,
    ProbeReport,
    TrafficRequest,
    MultiAgentConfig
} from '../../ai-agents';
import { PLATFORM_API_CONFIG, getPlatformCloudBaseUrl } from '../../utils/model-access';
import logger from '../../utils/logger';
import { isAttackSimulatorEnabled, isDemoMode } from '../../config/app-mode';
import { authenticate } from '../../middleware/auth.middleware';
import agentAuthService from '../../security/agent-auth.service';
import { securityOperationsService } from '../../services/security-operations.service';
import { owaspWebEvaluationService } from '../../services/owasp-web-evaluation.service';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';

const router = Router();

// ============================================
// Multi-Agent System Dashboard Endpoints
// ============================================

router.get('/agents/health', authenticate, (req: Request, res: Response) => {
    try {
        const system = getAgentSystem();
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
        const system = getAgentSystem();
        if (!system || !system.isInitialized()) {
            return res.status(503).json({
                error: 'system_unavailable',
                message: 'Multi-Agent Decision System is initializing...'
            });
        }

        const rawStats = system.getStats();
        const probeReport = system.getProbeReport();
        const health = system.getHealthStatus();
        const tenantId = (req as any).tenantContext?.tenantId || (req as any).user?.tenantId || PLATFORM_TENANT_ID;
        const opsSummary = await securityOperationsService.getDashboardSummaryView(tenantId);
        const threatPatterns = await securityOperationsService.summarizeThreatsView(tenantId);
        const runtimeAgents = agentGateway?.getAgentList?.() || [];
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
            health: health,
            agents: combinedAgents
        };

        res.json(stats);
    } catch (error: any) {
        logger.error('Failed to get agent system stats:', { error: error.message });
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
                model: 'qwen3-max-2026-01-23',
                temperature: 0.2,
                maxTokens: 4000,
                baseURL: getPlatformCloudBaseUrl(),
                apiKey: PLATFORM_API_CONFIG.apiKey
            }
        }
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
                    analysisPurpose: options?.analysisPurpose || 'primary'
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
