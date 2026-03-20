/**
 * Model Router - L6: Heterogeneous Model Collaboration
 * Routes between local and cloud models based on complexity
 */

import { v4 as uuidv4 } from 'uuid';
import {
    ModelRequest,
    ModelResponse,
    ModelRoutingDecision,
    ModelTier,
    AmbiguityScore
} from '../core/types';
import { AIEngine } from '../../scanner/ai-engine';
import { ZhipuClient } from '../../scanner/zhipu-client';
import logger from '../../utils/logger';
import {
    PLATFORM_API_CONFIG,
    PlatformProvider,
    getDefaultModel,
    getPlatformCloudBaseUrl
} from '../../utils/model-access';
import { AIRoutingSettings, PlatformConfig, platformConfigService } from '../../services/platform-config.service';
import auditLogger from '../../security/audit-logger.service';
import { PlatformCloudClient, createPlatformCloudClient } from '../../services/platform-cloud-provider.service';

export interface ModelRouterConfig {
    localModel: {
        provider: 'ollama';
        model: string;
        baseURL: string;
    };
    cloudModel: {
        provider: PlatformProvider | 'openai' | 'zhipu' | 'anthropic';
        model: string;
        apiKey: string;
        baseURL?: string;
    };
    escalationThreshold: number;
    maxLocalLatency: number;
}

const DEFAULT_CONFIG: ModelRouterConfig = {
    localModel: {
        provider: 'ollama',
        model: 'llama3:8b',
        baseURL: 'http://localhost:11434'
    },
    cloudModel: {
        provider: PLATFORM_API_CONFIG.provider,
        model: getDefaultModel('starter').id,
        apiKey: PLATFORM_API_CONFIG.apiKey,
        baseURL: getPlatformCloudBaseUrl()
    },
    escalationThreshold: 0.6,
    maxLocalLatency: 5000
};

export class ModelRouter {
    private config: ModelRouterConfig;
    private localEngine: AIEngine | null = null;
    private cloudClient: ZhipuClient | PlatformCloudClient | null = null;
    private requestStats = {
        total: 0,
        local: 0,
        cloud: 0,
        avgLocalLatency: 0,
        avgCloudLatency: 0
    };

    constructor(config: Partial<ModelRouterConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.initializeModels();
    }

    private getTenantId(request: ModelRequest): string {
        return String(request.context?.tenantId || 'global');
    }

    private redactPrompt(prompt: string): string {
        return prompt
            .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
            .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
            .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._-]+\b/gi, '[redacted-token]');
    }

    private async getRuntimeConfig(request: ModelRequest): Promise<PlatformConfig> {
        return platformConfigService.getConfig(this.getTenantId(request));
    }

    private initializeModels(): void {
        try {
            this.localEngine = new AIEngine({
                name: 'ollama',
                model: this.config.localModel.model,
                baseURL: this.config.localModel.baseURL
            });
            logger.info('Local model initialized');
        } catch (error: any) {
            logger.warn('Failed to initialize local model', { error: error.message });
        }

        if (this.config.cloudModel.apiKey) {
            try {
                if (this.config.cloudModel.provider === 'zhipu') {
                    this.cloudClient = new ZhipuClient(
                        this.config.cloudModel.apiKey,
                        this.config.cloudModel.baseURL
                    );
                    logger.info('Cloud model initialized', { provider: this.config.cloudModel.provider });
                } else {
                    this.cloudClient = createPlatformCloudClient(
                        this.config.cloudModel.model,
                        {
                            maxTokens: 4000,
                            temperature: 0.2
                        }
                    );
                    logger.info('Platform cloud model initialized', {
                        provider: PLATFORM_API_CONFIG.providerId,
                        model: this.config.cloudModel.model
                    });
                }
            } catch (error: any) {
                logger.warn('Failed to initialize cloud model', { error: error.message });
            }
        }
    }

    async route(request: ModelRequest): Promise<ModelResponse> {
        const runtimeConfig = await this.getRuntimeConfig(request);
        const decision = this.makeRoutingDecision(request, runtimeConfig);
        const startTime = Date.now();
        const tenantId = this.getTenantId(request);
        const effectiveRouteMode = request.routeModeOverride || runtimeConfig.aiRouting.mode;

        this.requestStats.total++;

        try {
            let response: ModelResponse;
            const effectiveRequest = runtimeConfig.aiRouting.redactionEnabled
                ? { ...request, prompt: this.redactPrompt(request.prompt) }
                : request;

            switch (decision.tier) {
                case 'local':
                    try {
                        response = await this.executeLocal(request);
                        this.requestStats.local++;
                    } catch (localError: any) {
                        const allowFallback = runtimeConfig.aiRouting.mode === 'local_preferred'
                            && runtimeConfig.aiRouting.fallbackAllowed
                            && runtimeConfig.privacyMode !== 'strict';
                        if (!allowFallback) {
                            throw localError;
                        }

                        response = await this.executeCloud(effectiveRequest);
                        this.requestStats.cloud++;
                    }
                    break;
                case 'hybrid': {
                    const localResponse = await this.executeLocal(request);
                    this.requestStats.local++;
                    const cloudResponse = await this.executeCloud(effectiveRequest);
                    this.requestStats.cloud++;
                    response = this.mergeResponses(localResponse, cloudResponse);
                    break;
                }
                case 'cloud':
                default:
                    response = await this.executeCloud(effectiveRequest);
                    this.requestStats.cloud++;
                    break;
            }

            const latency = Date.now() - startTime;
            this.updateLatencyStats(response.tier, latency);

            void auditLogger.log({
                tenantId,
                eventType: 'model_routing_decision',
                category: 'system',
                severity: 'info',
                actor: { type: 'system', id: 'model-router' },
                action: 'route_model_request',
                details: {
                    requestedTier: request.tier,
                    actualTier: response.tier,
                    model: decision.model,
                    reason: decision.reason,
                    latency
                },
                status: 'success'
            });

            return {
                ...response,
                latency,
                routeMode: effectiveRouteMode
            };

        } catch (error: any) {
            logger.error('Model routing failed', { error: error.message, tier: decision.tier });
            throw error;
        }
    }

    makeRoutingDecision(request: ModelRequest, runtimeConfig?: PlatformConfig): ModelRoutingDecision {
        const aiRouting: AIRoutingSettings | undefined = runtimeConfig?.aiRouting;
        const privacyMode = runtimeConfig?.privacyMode || 'off';
        const overrideMode = request.routeModeOverride;
        const mode = overrideMode || (privacyMode === 'strict'
            ? 'local_only'
            : aiRouting?.mode || 'cloud_only');
        const reasonPrefix = overrideMode
            ? `Request-scoped override forces ${overrideMode}`
            : null;

        if (mode === 'local_only') {
            return {
                tier: 'local',
                model: this.config.localModel.model,
                reason: reasonPrefix || (privacyMode === 'strict'
                    ? 'Strict privacy mode forces local execution'
                    : 'AI routing mode is local_only'),
                estimatedLatency: 1500,
                estimatedCost: 0
            };
        }

        if (mode === 'hybrid_verify') {
            return {
                tier: 'hybrid',
                model: `${this.config.localModel.model}+${this.config.cloudModel.model}`,
                reason: reasonPrefix || 'AI routing mode is hybrid_verify',
                estimatedLatency: 4500,
                estimatedCost: 0.02
            };
        }

        if (mode === 'local_preferred') {
            return {
                tier: this.localEngine ? 'local' : 'cloud',
                model: this.localEngine ? this.config.localModel.model : this.config.cloudModel.model,
                reason: reasonPrefix || (this.localEngine
                    ? 'AI routing mode is local_preferred'
                    : 'Local model unavailable, falling back to cloud'),
                estimatedLatency: this.localEngine ? 1500 : 3000,
                estimatedCost: this.localEngine ? 0 : 0.01
            };
        }

        return {
            tier: 'cloud',
            model: this.config.cloudModel.model,
            reason: reasonPrefix || 'AI routing mode is cloud_only',
            estimatedLatency: 3000,
            estimatedCost: 0.01
        };
    }

    calculateAmbiguity(request: ModelRequest): AmbiguityScore {
        const factors: string[] = [];
        let score = 0;

        const prompt = request.prompt.toLowerCase();

        if (prompt.includes('injection') || prompt.includes('attack') || prompt.includes('exploit')) {
            score += 0.3;
            factors.push('Security-related keywords detected');
        }

        if (prompt.includes('uncertain') || prompt.includes('unknown') || prompt.includes('ambiguous')) {
            score += 0.2;
            factors.push('Uncertainty indicators in prompt');
        }

        if (prompt.length > 2000) {
            score += 0.15;
            factors.push('Long prompt requires deeper analysis');
        }

        if (request.context && Object.keys(request.context).length > 5) {
            score += 0.1;
            factors.push('Complex context provided');
        }

        if (request.priority === 'critical') {
            score += 0.25;
            factors.push('Critical priority request');
        }

        return {
            score: Math.min(score, 1),
            factors,
            recommendation: score > this.config.escalationThreshold ? 'cloud' : 'local'
        };
    }

    private needsCloudEscalation(response: ModelResponse): boolean {
        const content = response.content.toLowerCase();

        const uncertaintyIndicators = [
            'uncertain', 'unclear', 'cannot determine', 'insufficient information',
            'requires further', 'needs review', 'ambiguous'
        ];

        return uncertaintyIndicators.some(indicator => content.includes(indicator));
    }

    private async executeLocal(request: ModelRequest): Promise<ModelResponse> {
        if (!this.localEngine) {
            throw new Error('Local model not available');
        }

        const startTime = Date.now();

        try {
            const analysisResult = await this.localEngine.analyzeProblem({
                problem: {
                    title: 'Security Analysis',
                    description: request.prompt,
                    category: 'security',
                    priority: request.priority
                },
                context: {
                    systemInfo: {},
                    logs: [],
                    configFiles: request.context
                }
            });

            return {
                id: uuidv4(),
                content: JSON.stringify(analysisResult),
                model: this.config.localModel.model,
                tier: 'local',
                latency: Date.now() - startTime,
                tokensUsed: 0,
                sanitized: request.sanitizationLevel !== 'none'
            };
        } catch (error: any) {
            logger.error('Local model execution failed', { error: error.message });
            throw error;
        }
    }

    private async executeCloud(request: ModelRequest): Promise<ModelResponse> {
        if (!this.cloudClient) {
            throw new Error('Cloud model not available');
        }

        const startTime = Date.now();

        try {
            const content = await this.cloudClient.generateCompletion(
                request.prompt,
                this.config.cloudModel.provider === 'dashscope'
                    ? undefined
                    : this.config.cloudModel.model
            );

            return {
                id: uuidv4(),
                content,
                model: this.config.cloudModel.model,
                tier: 'cloud',
                latency: Date.now() - startTime,
                tokensUsed: 0,
                sanitized: request.sanitizationLevel !== 'none'
            };
        } catch (error: any) {
            logger.error('Cloud model execution failed', { error: error.message });
            throw error;
        }
    }

    private mergeResponses(local: ModelResponse, cloud: ModelResponse): ModelResponse {
        return {
            id: uuidv4(),
            content: `Local Analysis:\n${local.content}\n\nCloud Verification:\n${cloud.content}`,
            model: `${local.model}+${cloud.model}`,
            tier: 'hybrid',
            latency: local.latency + cloud.latency,
            tokensUsed: local.tokensUsed + cloud.tokensUsed,
            sanitized: true
        };
    }

    private updateLatencyStats(tier: ModelTier, latency: number): void {
        if (tier === 'local' || tier === 'hybrid') {
            this.requestStats.avgLocalLatency =
                (this.requestStats.avgLocalLatency * (this.requestStats.local - 1) + latency) /
                this.requestStats.local;
        }
        if (tier === 'cloud' || tier === 'hybrid') {
            this.requestStats.avgCloudLatency =
                (this.requestStats.avgCloudLatency * (this.requestStats.cloud - 1) + latency) /
                this.requestStats.cloud;
        }
    }

    getStats(): typeof this.requestStats & { localRatio: number } {
        return {
            ...this.requestStats,
            localRatio: this.requestStats.total > 0
                ? this.requestStats.local / this.requestStats.total
                : 0
        };
    }

    isLocalAvailable(): boolean {
        return this.localEngine !== null;
    }

    isCloudAvailable(): boolean {
        return this.cloudClient !== null;
    }
}

export const modelRouter = new ModelRouter();
