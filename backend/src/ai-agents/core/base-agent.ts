/**
 * Base Agent - Abstract Base Class for All Agents
 * L1: Collaboration Layer Foundation
 */

import { v4 as uuidv4 } from 'uuid';
import {
    AgentConfig,
    AgentIdentity,
    AgentMessage,
    AgentRole,
    AnalysisResult,
    TrafficContext,
    ModelConfig,
    ModelResponse,
    Evidence
} from './types';
import { MessageBus } from './message-bus';
import logger from '../../utils/logger';

export abstract class BaseAgent {
    protected config: AgentConfig;
    protected identity: AgentIdentity;
    protected messageBus: MessageBus;
    protected isActive: boolean = false;
    protected pendingTasks: Map<string, Promise<any>> = new Map();

    constructor(config: AgentConfig, messageBus: MessageBus) {
        this.config = config;
        this.identity = config.identity;
        this.messageBus = messageBus;
    }

    abstract analyze(context: TrafficContext): Promise<AnalysisResult>;

    abstract getSystemPrompt(): string;

    async initialize(): Promise<void> {
        this.isActive = true;
        this.subscribeToMessages();
        logger.info(`Agent initialized: ${this.identity.name} (${this.identity.role})`);
    }

    async shutdown(): Promise<void> {
        this.isActive = false;
        logger.info(`Agent shutdown: ${this.identity.name}`);
    }

    protected subscribeToMessages(): void {
        this.messageBus.subscribe(this.identity.role, async (message: AgentMessage) => {
            await this.handleMessage(message);
        });
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        if (!this.isActive) {
            logger.warn(`Agent ${this.identity.name} received message while inactive`);
            return;
        }

        try {
            switch (message.type) {
                case 'analysis_request':
                    await this.handleAnalysisRequest(message);
                    break;
                case 'debate_invitation':
                    await this.handleDebateInvitation(message);
                    break;
                case 'debate_argument':
                    await this.handleDebateArgument(message);
                    break;
                case 'tool_result':
                    await this.handleToolResult(message);
                    break;
                default:
                    logger.debug(`Agent ${this.identity.name} ignoring message type: ${message.type}`);
            }
        } catch (error: any) {
            logger.error(`Agent ${this.identity.name} error handling message`, {
                error: error.message,
                messageType: message.type
            });
        }
    }

    protected abstract handleAnalysisRequest(message: AgentMessage): Promise<void>;
    protected abstract handleDebateInvitation(message: AgentMessage): Promise<void>;
    protected abstract handleDebateArgument(message: AgentMessage): Promise<void>;
    protected abstract handleToolResult(message: AgentMessage): Promise<void>;

    async sendMessage(to: AgentRole | 'broadcast', type: AgentMessage['type'], payload: any): Promise<void> {
        const message: AgentMessage = {
            id: uuidv4(),
            type,
            from: this.identity.role,
            to,
            payload,
            timestamp: new Date(),
            priority: 'medium'
        };

        await this.messageBus.publish(message);
    }

    protected async callModel(prompt: string, context?: Record<string, any>): Promise<ModelResponse> {
        const startTime = Date.now();

        try {
            const response = await this.messageBus.requestModel({
                id: uuidv4(),
                prompt,
                context: context || {},
                tier: this.determineModelTier(),
                priority: 'medium',
                timeout: this.config.timeout,
                sanitizationLevel: 'basic'
            });

            return response;
        } catch (error: any) {
            logger.error(`Model call failed for ${this.identity.name}`, { error: error.message });
            throw error;
        }
    }

    protected determineModelTier(): 'local' | 'cloud' {
        if (this.config.modelConfig.provider === 'dashscope' || 
            this.config.modelConfig.provider === 'zhipu' ||
            this.config.modelConfig.provider === 'openai' ||
            this.config.modelConfig.provider === 'anthropic') {
            return 'cloud';
        }
        return 'local';
    }

    protected buildAnalysisPrompt(context: TrafficContext): string {
        const { request, history, openApiSpec } = context;

        let prompt = this.getSystemPrompt();
        prompt += '\n\n--- REQUEST TO ANALYZE ---\n';
        prompt += `Method: ${request.method}\n`;
        prompt += `Path: ${request.path}\n`;
        prompt += `Source IP: ${request.sourceIP}\n`;
        prompt += `User-Agent: ${request.userAgent || 'Unknown'}\n`;

        if (request.body) {
            prompt += `Body: ${this.sanitizeForPrompt(request.body)}\n`;
        }

        if (request.queryParams && Object.keys(request.queryParams).length > 0) {
            prompt += `Query Params: ${JSON.stringify(request.queryParams)}\n`;
        }

        if (history.length > 0) {
            prompt += '\n--- RECENT HISTORY ---\n';
            prompt += `Total historical events: ${history.length}\n`;
            const recentHistory = history.slice(-5);
            for (const event of recentHistory) {
                prompt += `- ${event.timestamp}: ${event.action} (${event.result})\n`;
            }
        }

        if (openApiSpec) {
            prompt += '\n--- EXPECTED API SCHEMA ---\n';
            prompt += `Path: ${openApiSpec.path}\n`;
            prompt += `Method: ${openApiSpec.method}\n`;
        }

        return prompt;
    }

    protected sanitizeForPrompt(input: string): string {
        let sanitized = input;
        sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
        sanitized = sanitized.replace(/password["\s:=]+["']?[^"'\s,}]+/gi, 'password=[REDACTED]');
        sanitized = sanitized.replace(/api[_-]?key["\s:=]+["']?[^"'\s,}]+/gi, 'api_key=[REDACTED]');
        sanitized = sanitized.replace(/token["\s:=]+["']?[^"'\s,}]+/gi, 'token=[REDACTED]');
        return sanitized;
    }

    protected createEvidence(
        type: Evidence['type'],
        description: string,
        severity: Evidence['severity'],
        data: any,
        source: string = this.identity.name
    ): Evidence {
        return {
            type,
            description,
            severity,
            data,
            source
        };
    }

    getIdentity(): AgentIdentity {
        return this.identity;
    }

    isAgentActive(): boolean {
        return this.isActive;
    }

    getPendingTaskCount(): number {
        return this.pendingTasks.size;
    }
}

export abstract class ExpertAgent extends BaseAgent {
    protected expertise: string[];

    constructor(config: AgentConfig, messageBus: MessageBus, expertise: string[]) {
        super(config, messageBus);
        this.expertise = expertise;
    }

    canHandle(requestType: string): boolean {
        return this.expertise.some(exp => 
            requestType.toLowerCase().includes(exp.toLowerCase())
        );
    }

    getExpertise(): string[] {
        return this.expertise;
    }
}

export interface AgentFactory {
    createAgent(role: AgentRole, config: AgentConfig, messageBus: MessageBus): BaseAgent;
}
