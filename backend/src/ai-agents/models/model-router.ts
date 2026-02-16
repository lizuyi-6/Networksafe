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
import { OpenAICompatibleClient, createDashScopeClient } from '../../scanner/openai-compatible-client';
import logger from '../../utils/logger';

export interface ModelRouterConfig {
    localModel: {
        provider: 'ollama';
        model: string;
        baseURL: string;
    };
    cloudModel: {
        provider: 'openai' | 'zhipu' | 'anthropic' | 'dashscope';
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
        provider: 'dashscope',
        model: 'qwen3-coder-480b-a35b-instruct',
        apiKey: process.env.DASHSCOPE_API_KEY || process.env.ZHIPU_API_KEY || '',
        baseURL: process.env.DASHSCOPE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    },
    escalationThreshold: 0.6,
    maxLocalLatency: 5000
};

export class ModelRouter {
    private config: ModelRouterConfig;
    private localEngine: AIEngine | null = null;
    private cloudClient: ZhipuClient | OpenAICompatibleClient | null = null;
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
                if (this.config.cloudModel.provider === 'dashscope') {
                    this.cloudClient = createDashScopeClient(
                        this.config.cloudModel.apiKey,
                        this.config.cloudModel.model
                    );
                    logger.info('DashScope cloud model initialized', { model: this.config.cloudModel.model });
                } else {
                    this.cloudClient = new ZhipuClient(
                        this.config.cloudModel.apiKey,
                        this.config.cloudModel.baseURL
                    );
                    logger.info('Cloud model initialized', { provider: this.config.cloudModel.provider });
                }
            } catch (error: any) {
                logger.warn('Failed to initialize cloud model', { error: error.message });
            }
        }
    }

    async route(request: ModelRequest): Promise<ModelResponse> {
        const decision = this.makeRoutingDecision(request);
        const startTime = Date.now();

        this.requestStats.total++;

        try {
            let response: ModelResponse;

            response = await this.executeCloud(request);
            this.requestStats.cloud++;

            const latency = Date.now() - startTime;
            this.updateLatencyStats(decision.tier, latency);

            return {
                ...response,
                latency,
                tier: decision.tier
            };

        } catch (error: any) {
            logger.error('Model routing failed', { error: error.message, tier: decision.tier });
            throw error;
        }
    }

    makeRoutingDecision(request: ModelRequest): ModelRoutingDecision {
        return {
            tier: 'cloud',
            model: this.config.cloudModel.model,
            reason: 'Force cloud model for all requests',
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
                this.config.cloudModel.model
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
