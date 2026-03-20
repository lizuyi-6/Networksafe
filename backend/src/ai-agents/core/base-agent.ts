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
    Evidence,
    AttackFamily,
    SecurityVerdict
} from './types';
import { MessageBus } from './message-bus';
import { distributionFromVerdict, normalizeDistribution } from './scoring';
import logger from '../../utils/logger';

// Re-export AgentMessage for convenience
export type { AgentMessage };

interface HeuristicSignalMatch {
    family: AttackFamily;
    label: string;
    severity: 'hard' | 'soft';
}

interface ContentHeuristicSignals {
    attackFamily: AttackFamily;
    hardSignals: HeuristicSignalMatch[];
    softSignals: HeuristicSignalMatch[];
    normalizedInput: string;
}

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
        const timeoutMs = this.config.modelTimeout ?? this.config.timeout;
        const routeModeOverride = context?.routeModeOverride;
        const analysisPurpose = context?.analysisPurpose;

        if (this.config.heuristicOnly) {
            throw new Error('heuristic_fallback_enabled');
        }

        try {
            const response = await this.messageBus.requestModel({
                id: uuidv4(),
                prompt,
                context: {
                    role: this.identity.role,
                    agentId: this.identity.id,
                    ...(context || {})
                },
                tier: this.determineModelTier(),
                priority: 'medium',
                timeout: timeoutMs,
                sanitizationLevel: 'basic',
                routeModeOverride,
                analysisPurpose
            });

            return response;
        } catch (error: any) {
            logger.error(`Model call failed for ${this.identity.name}`, {
                error: error.message,
                timeoutMs
            });
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

    protected buildModelContext(context: TrafficContext, extra: Record<string, any> = {}): Record<string, any> {
        return {
            tenantId: context.request.tenantId,
            requestId: context.request.id,
            routeModeOverride: context.request.routeModeOverride,
            analysisPurpose: context.request.analysisPurpose || 'primary',
            ...extra
        };
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

    protected inferAttackFamily(input: string): AttackFamily {
        return this.inspectContentHeuristics(input).attackFamily;
    }

    protected inspectContentHeuristics(input: string): ContentHeuristicSignals {
        const normalizedInput = input.toLowerCase();
        const hardSignals: HeuristicSignalMatch[] = [];
        const softSignals: HeuristicSignalMatch[] = [];

        const hardRules: Array<{ family: AttackFamily; label: string; pattern: RegExp }> = [
            { family: 'sqli', label: 'sql_or_bypass', pattern: /'\s*(or|and)\s*['"(]?[a-z0-9_]+/i },
            { family: 'sqli', label: 'sql_union', pattern: /union\s+select/i },
            { family: 'sqli', label: 'sql_stacked_query', pattern: /;\s*(drop|delete|update|insert)\b/i },
            { family: 'sqli', label: 'sql_time_probe', pattern: /\b(sleep|benchmark)\s*\(/i },
            { family: 'xss', label: 'script_tag', pattern: /<script/i },
            { family: 'xss', label: 'event_handler', pattern: /on(?:error|load|click)\s*=/i },
            { family: 'xss', label: 'javascript_scheme', pattern: /javascript:/i },
            { family: 'path_traversal', label: 'relative_traversal', pattern: /\.\.\//i },
            { family: 'path_traversal', label: 'encoded_traversal', pattern: /%2e%2e|%252e%252e/i },
            { family: 'path_traversal', label: 'sensitive_file', pattern: /\/etc\/passwd|boot\.ini/i },
            { family: 'command_injection', label: 'shell_separator', pattern: /(?:;|&&|\|\|)\s*(cat|curl|wget|bash|sh|type|powershell)\b/i },
            { family: 'command_injection', label: 'command_substitution', pattern: /\$\(|`[^`]+`/i },
            { family: 'ssrf', label: 'metadata_service', pattern: /169\.254\.169\.254|metadata\.google\.internal|latest\/meta-data/i }
        ];

        const softRules: Array<{ family: AttackFamily; label: string; pattern: RegExp }> = [
            { family: 'sqli', label: 'sql_keyword', pattern: /\bselect\b|\bfrom\b|\border\s+by\b/i },
            { family: 'xss', label: 'html_markup', pattern: /<[^>]+>/i },
            { family: 'path_traversal', label: 'filesystem_probe', pattern: /\b(?:config|backup|logs?)\b/i },
            { family: 'command_injection', label: 'loopback_target', pattern: /\b127\.0\.0\.1\b|\blocalhost\b/i },
            { family: 'command_injection', label: 'network_probe', pattern: /\bping\b|\bnslookup\b|\btraceroute\b/i },
            { family: 'ssrf', label: 'url_fetch_surface', pattern: /\bhttps?:\/\/|\burl\s*=|\bfetch\b/i },
            { family: 'automation', label: 'automation_user_agent', pattern: /\bsqlmap\b|\bnikto\b|\bpython-requests\b|\bheadless\b|\bselenium\b|\bcurl\/|\bwget\//i },
            { family: 'authentication', label: 'auth_surface', pattern: /\blogin\b|\bauth\b|\btoken\b|\bsession\b/i }
        ];

        for (const rule of hardRules) {
            if (rule.pattern.test(normalizedInput)) {
                hardSignals.push({
                    family: rule.family,
                    label: rule.label,
                    severity: 'hard'
                });
            }
        }

        for (const rule of softRules) {
            if (rule.pattern.test(normalizedInput)) {
                softSignals.push({
                    family: rule.family,
                    label: rule.label,
                    severity: 'soft'
                });
            }
        }

        const rankedFamilies: AttackFamily[] = [
            'sqli',
            'xss',
            'path_traversal',
            'command_injection',
            'ssrf',
            'automation',
            'authentication',
            'business_logic',
            'other',
            'benign'
        ];

        const familyScores = new Map<AttackFamily, number>();
        for (const signal of hardSignals) {
            familyScores.set(signal.family, (familyScores.get(signal.family) || 0) + 3);
        }
        for (const signal of softSignals) {
            familyScores.set(signal.family, (familyScores.get(signal.family) || 0) + 1);
        }

        const attackFamily = rankedFamilies.reduce<AttackFamily>((best, family) => {
            if ((familyScores.get(family) || 0) > (familyScores.get(best) || 0)) {
                return family;
            }
            return best;
        }, 'benign');

        return {
            attackFamily,
            hardSignals,
            softSignals,
            normalizedInput
        };
    }

    protected finalizeAnalysisResult(
        partial: Omit<AnalysisResult, 'classScores'> & { classScores?: AnalysisResult['classScores'] }
    ): AnalysisResult {
        const classScores = partial.classScores
            ? normalizeDistribution(partial.classScores)
            : distributionFromVerdict(partial.verdict as SecurityVerdict, partial.confidence);

        return {
            ...partial,
            classScores
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
