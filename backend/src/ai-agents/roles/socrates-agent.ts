/**
 * Socrates Agent - L2: Role Playing Layer (Red Team)
 * Attempts to find bypasses and mutations in requests
 */

import { v4 as uuidv4 } from 'uuid';
import {
    AgentConfig,
    AgentMessage,
    AnalysisResult,
    TrafficContext,
    RequestMutation,
    Evidence
} from '../core/types';
import { ExpertAgent } from '../core/base-agent';
import { MessageBus } from '../core/message-bus';
import logger from '../../utils/logger';

export class SocratesAgent extends ExpertAgent {
    constructor(config: AgentConfig, messageBus: MessageBus) {
        super(config, messageBus, [
            'sql_injection',
            'xss',
            'command_injection',
            'path_traversal',
            'authentication_bypass',
            'business_logic'
        ]);
    }

    getSystemPrompt(): string {
        return `You are Socrates, a red team security agent. Your role is to think like an attacker.

Your mission:
1. Analyze the request for potential security vulnerabilities
2. Attempt to find ways to bypass security controls
3. Generate mutations that could evade detection
4. Think adversarially about how an attacker would exploit this

Key principles:
- Question everything: "What if the attacker tries X?"
- Look for edge cases and boundary conditions
- Consider encoding, obfuscation, and bypass techniques
- Identify assumptions that defenders might make

When analyzing:
- Check for injection points (SQL, XSS, command, path)
- Look for authentication/authorization bypasses
- Consider business logic flaws
- Identify potential for data exfiltration

Provide your analysis in JSON format:
{
    "verdict": "safe|suspicious|malicious|unknown",
    "confidence": 0.0-1.0,
    "reasoning": "detailed explanation",
    "mutations": [
        {
            "id": "mutation-id",
            "originalValue": "original",
            "mutatedValue": "mutated",
            "mutationType": "encoding|injection|bypass|obfuscation",
            "description": "what this mutation attempts",
            "potentialImpact": "potential impact if successful"
        }
    ],
    "evidence": [
        {
            "type": "pattern|behavior|statistical|semantic",
            "description": "what was found",
            "severity": "low|medium|high|critical",
            "data": {}
        }
    ]
}`;
    }

    async analyze(context: TrafficContext): Promise<AnalysisResult> {
        const prompt = this.buildAnalysisPrompt(context);
        const startedAt = Date.now();
        
        try {
            const response = await this.callModel(prompt, this.buildModelContext(context));
            const analysis = this.parseAnalysisResponse(response.content);
            const content = [
                context.request.path,
                context.request.body || '',
                JSON.stringify(context.request.queryParams || {})
            ].join(' ');

            return this.finalizeAnalysisResult({
                agentId: this.identity.id,
                role: 'socrates',
                verdict: analysis.verdict,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning,
                evidence: analysis.evidence || [],
                mutations: analysis.mutations || [],
                classScores: analysis.classScores,
                attackFamily: this.inferAttackFamily(content),
                modelTier: response.tier,
                routeMode: response.routeMode || 'unknown',
                modelLatencyMs: response.latency,
                analysisLatencyMs: Date.now() - startedAt
            });
        } catch (error: any) {
            logger.error('Socrates analysis failed', { error: error.message });
            
            return this.fallbackAnalysis(context);
        }
    }

    private parseAnalysisResponse(content: string): any {
        try {
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                content.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1] || jsonMatch[0]);
            }
            
            return { verdict: 'unknown', confidence: 0.5, reasoning: content };
        } catch {
            return { verdict: 'unknown', confidence: 0.5, reasoning: 'Failed to parse response' };
        }
    }

    private fallbackAnalysis(context: TrafficContext): AnalysisResult {
        const startedAt = Date.now();
        const { request } = context;
        const mutations: RequestMutation[] = [];
        const evidence: Evidence[] = [];
        let verdict: AnalysisResult['verdict'] = 'safe';
        let confidence = 0.62;

        const content = [
            request.path,
            request.body || '',
            JSON.stringify(request.queryParams || {}),
            JSON.stringify(request.headers || {})
        ].join(' ');
        const signals = this.inspectContentHeuristics(content);

        const sqlPatterns = [
            { pattern: /'\s*or\s+'/i, type: 'SQL Injection - OR bypass' },
            { pattern: /union\s+select/i, type: 'SQL Injection - UNION' },
            { pattern: /;\s*drop/i, type: 'SQL Injection - DROP' },
            { pattern: /'\s*--/, type: 'SQL Injection - Comment bypass' }
        ];

        for (const { pattern, type } of sqlPatterns) {
            if (pattern.test(content)) {
                mutations.push({
                    id: uuidv4(),
                    originalValue: content.match(pattern)?.[0] || '',
                    mutatedValue: this.generateSQLMutation(content.match(pattern)?.[0] || ''),
                    mutationType: 'injection',
                    description: type,
                    potentialImpact: 'Potential database access or data exfiltration'
                });
                verdict = 'malicious';
                confidence = 0.9;
            }
        }

        const xssPatterns = [
            { pattern: /<script/i, type: 'XSS - Script tag' },
            { pattern: /javascript:/i, type: 'XSS - JavaScript protocol' },
            { pattern: /onerror\s*=/i, type: 'XSS - Event handler' },
            { pattern: /<img[^>]+onerror/i, type: 'XSS - Image error handler' }
        ];

        for (const { pattern, type } of xssPatterns) {
            if (pattern.test(content)) {
                mutations.push({
                    id: uuidv4(),
                    originalValue: content.match(pattern)?.[0] || '',
                    mutatedValue: this.generateXSSMutation(content.match(pattern)?.[0] || ''),
                    mutationType: 'injection',
                    description: type,
                    potentialImpact: 'Potential cross-site scripting attack'
                });
                verdict = 'malicious';
                confidence = 0.85;
            }
        }

        const bypassPatterns = [
            { pattern: /\.\.\//i, type: 'Path Traversal' },
            { pattern: /%2e%2e/i, type: 'Encoded Path Traversal' },
            { pattern: /\.\.\\/i, type: 'Windows Path Traversal' }
        ];

        for (const { pattern, type } of bypassPatterns) {
            if (pattern.test(content)) {
                mutations.push({
                    id: uuidv4(),
                    originalValue: content.match(pattern)?.[0] || '',
                    mutatedValue: this.generateBypassMutation(content.match(pattern)?.[0] || ''),
                    mutationType: 'bypass',
                    description: type,
                    potentialImpact: 'Potential file system access'
                });
                verdict = verdict === 'malicious' ? verdict : 'suspicious';
                confidence = Math.max(confidence, 0.8);
            }
        }

        if (signals.hardSignals.length > 0) {
            verdict = 'malicious';
            confidence = Math.max(confidence, 0.88);
        } else if (signals.softSignals.length > 0) {
            verdict = verdict === 'malicious' ? verdict : 'suspicious';
            confidence = Math.max(confidence, 0.74);
        }

        if (
            verdict === 'safe' &&
            signals.attackFamily === 'authentication' &&
            /login|auth|token/i.test(content)
        ) {
            verdict = 'suspicious';
            confidence = 0.68;
        }

        if (mutations.length > 0) {
            evidence.push({
                type: 'pattern',
                description: `Found ${mutations.length} potential attack pattern(s)`,
                severity: verdict === 'malicious' ? 'critical' : 'high',
                data: { mutations: mutations.map(m => m.description) },
                source: 'Socrates'
            });
        }

        if (signals.softSignals.length > 0 && mutations.length === 0) {
            evidence.push({
                type: 'semantic',
                description: `Adversarial probe indicators detected: ${signals.softSignals.map(signal => signal.label).join(', ')}`,
                severity: verdict === 'malicious' ? 'high' : 'medium',
                data: { indicators: signals.softSignals.map(signal => signal.label) },
                source: 'Socrates'
            });
        }

        return this.finalizeAnalysisResult({
            agentId: this.identity.id,
            role: 'socrates',
            verdict,
            confidence,
            reasoning: mutations.length > 0
                ? `Identified ${mutations.length} potential attack vector(s): ${mutations.map(m => m.description).join(', ')}`
                : signals.softSignals.length > 0
                    ? `Adversarial surface indicators detected: ${signals.softSignals.map(signal => signal.label).join(', ')}`
                    : 'No obvious attack patterns detected, but further analysis recommended',
            evidence,
            mutations,
            classScores:
                verdict === 'malicious'
                    ? { safe: 0.04, suspicious: 0.16, malicious: 0.8 }
                    : verdict === 'suspicious'
                        ? { safe: 0.18, suspicious: 0.62, malicious: 0.2 }
                        : { safe: 0.7, suspicious: 0.2, malicious: 0.1 },
            attackFamily: signals.attackFamily,
            modelTier: 'cloud',
            routeMode: 'unknown',
            modelLatencyMs: undefined,
            analysisLatencyMs: Date.now() - startedAt
        });
    }

    private generateSQLMutation(original: string): string {
        const mutations = [
            original.replace(/'/g, "''"),
            original.replace(/\s+/g, '/**/'),
            original.replace(/'/g, "%27"),
            original.replace(/or/i, 'oR'),
            original + "' AND '1'='1"
        ];
        return mutations[Math.floor(Math.random() * mutations.length)];
    }

    private generateXSSMutation(original: string): string {
        const mutations = [
            original.replace(/<script/i, '<ScRiPt'),
            original.replace(/script/i, 'scr\x00ipt'),
            original.replace(/</g, '%3C'),
            original.replace(/javascript:/i, 'java&#x73;cript:'),
            original + '"><img src=x onerror=alert(1)>'
        ];
        return mutations[Math.floor(Math.random() * mutations.length)];
    }

    private generateBypassMutation(original: string): string {
        const mutations = [
            original.replace(/\.\./g, '%2e%2e'),
            original.replace(/\.\./g, '....//'),
            original.replace(/\//g, '%2f'),
            original + '/../../../etc/passwd'
        ];
        return mutations[Math.floor(Math.random() * mutations.length)];
    }

    protected async handleAnalysisRequest(message: AgentMessage): Promise<void> {
        const context = message.payload as TrafficContext;
        const result = await this.analyze(context);
        await this.sendMessage('orchestrator', 'analysis_result', result);
    }

    protected async handleDebateInvitation(message: AgentMessage): Promise<void> {
        logger.info(`Socrates received debate invitation for: ${message.payload.topic}`);
    }

    protected async handleDebateArgument(message: AgentMessage): Promise<void> {
        logger.debug(`Socrates received debate argument`);
    }

    protected async handleToolResult(message: AgentMessage): Promise<void> {
        logger.debug(`Socrates received tool result`);
    }
}
