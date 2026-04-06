/**
 * Agent System Service
 *
 * Pure state container for the multi-agent decision system and agent gateway.
 * Extracted from ai-system.routes.ts – no Express/Router dependency.
 */

import {
    MultiAgentDecisionSystem,
    createMultiAgentSystem,
    ProbeReport,
    MultiAgentConfig
} from '../ai-agents';
import { PLATFORM_API_CONFIG, getPlatformCloudBaseUrl, getStageModelMap } from '../utils/model-access';
import logger from '../utils/logger';
import { detectionPipelineService } from './detection-pipeline.service';
import { normalizeDetectionAIConfidence, normalizeDetectionAttackFamily } from './traffic-stats.service';

let multiAgentSystem: MultiAgentDecisionSystem | null = null;
let agentGateway: any = null;

export function getAgentGateway(): any {
    return agentGateway;
}

export function setAgentGateway(gateway: any): void {
    agentGateway = gateway;
}

export function getAgentSystem(): MultiAgentDecisionSystem | null {
    return multiAgentSystem;
}

export async function initializeAgentSystem(): Promise<void> {
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
}
