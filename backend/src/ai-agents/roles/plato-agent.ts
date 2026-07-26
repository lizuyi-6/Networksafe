/**
 * Plato Agent - L2: Role Playing Layer (Blue Team)
 * Schema validation and compliance checking
 */

import { uuidv4 } from '../../utils/uuid';
import {
    AgentConfig,
    AgentMessage,
    AnalysisResult,
    TrafficContext,
    SchemaValidation,
    SchemaViolation,
    Evidence
} from '../core/types';
import { ExpertAgent } from '../core/base-agent';
import { MessageBus } from '../core/message-bus';
import logger from '../../utils/logger';

export class PlatoAgent extends ExpertAgent {
    private commonPatterns: Map<string, RegExp>;

    constructor(config: AgentConfig, messageBus: MessageBus) {
        super(config, messageBus, [
            'schema_validation',
            'compliance_check',
            'pattern_matching',
            'input_validation'
        ]);

        this.commonPatterns = this.initializePatterns();
    }

    private initializePatterns(): Map<string, RegExp> {
        return new Map([
            ['email', /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/],
            ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
            ['ip_v4', /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/],
            ['url', /^https?:\/\/[^\s/$.?#].[^\s]*$/i],
            ['alphanumeric', /^[a-zA-Z0-9]+$/],
            ['numeric', /^[0-9]+$/],
            ['date_iso', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/],
            ['json_safe', /^[\w\s\-.,:;!?@#$%&*()[\]{}"\'\/\\]+$/]
        ]);
    }

    getSystemPrompt(): string {
        return `You are Plato, a blue team security agent. Your role is to enforce standards and validate requests.

Your mission:
1. Validate requests against expected schemas and patterns
2. Check for compliance with security policies
3. Identify deviations from expected behavior
4. Enforce strict input validation rules

Key principles:
- "The unexamined request is not worth processing"
- Apply strict schema validation
- Check for type correctness and format compliance
- Identify any deviation from expected patterns

When analyzing:
- Validate data types and formats
- Check parameter names against allowed list
- Verify required fields are present
- Ensure values are within acceptable ranges
- Detect unexpected or extra fields

Provide your analysis in JSON format:
{
    "verdict": "safe|suspicious|malicious|unknown",
    "confidence": 0.0-1.0,
    "reasoning": "detailed explanation",
    "schemaValidation": {
        "isValid": true|false,
        "violations": [
            {
                "field": "field_name",
                "expected": "expected type/format",
                "actual": "actual value",
                "severity": "error|warning"
            }
        ],
        "matchedSchema": "schema_name or null"
    },
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

            const schemaValidation = this.performSchemaValidation(context);
            if (!schemaValidation.isValid && analysis.verdict === 'safe') {
                analysis.verdict = 'suspicious';
                analysis.confidence = Math.max(analysis.confidence, 0.7);
            }

            return this.finalizeAnalysisResult({
                agentId: this.identity.id,
                role: 'plato',
                verdict: analysis.verdict,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning,
                evidence: analysis.evidence || [],
                schemaValidation,
                classScores: analysis.classScores,
                attackFamily: this.inferAttackFamily([
                    context.request.path,
                    context.request.body || '',
                    JSON.stringify(context.request.queryParams || {})
                ].join(' ')),
                modelTier: response.tier,
                routeMode: response.routeMode || 'unknown',
                modelLatencyMs: response.latency,
                analysisLatencyMs: Date.now() - startedAt
            });
        } catch (error: any) {
            logger.error('Plato analysis failed', { error: error.message });
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

    private performSchemaValidation(context: TrafficContext): SchemaValidation {
        const violations: SchemaViolation[] = [];
        const { request, openApiSpec } = context;

        if (request.queryParams) {
            for (const [key, value] of Object.entries(request.queryParams)) {
                const validation = this.validateParameterValue(key, value);
                if (!validation.isValid) {
                    violations.push(...validation.violations);
                }
            }
        }

        if (request.body) {
            const bodyValidation = this.validateBody(request.body, request.headers['content-type']);
            violations.push(...bodyValidation.violations);
        }

        if (request.path) {
            const pathValidation = this.validatePath(request.path);
            violations.push(...pathValidation.violations);
        }

        if (request.headers) {
            const headerValidation = this.validateHeaders(request.headers);
            violations.push(...headerValidation.violations);
        }

        return {
            isValid: violations.filter(v => v.severity === 'error').length === 0,
            violations,
            matchedSchema: openApiSpec ? `${openApiSpec.method} ${openApiSpec.path}` : undefined
        };
    }

    private validateParameterValue(key: string, value: string): { isValid: boolean; violations: SchemaViolation[] } {
        const violations: SchemaViolation[] = [];

        if (value.length > 10000) {
            violations.push({
                field: key,
                expected: 'length <= 10000',
                actual: `length = ${value.length}`,
                severity: 'warning'
            });
        }

        if (this.containsDangerousPatterns(value)) {
            violations.push({
                field: key,
                expected: 'safe characters only',
                actual: 'contains potentially dangerous patterns',
                severity: 'error'
            });
        }

        if (key.toLowerCase().includes('id') && !this.commonPatterns.get('uuid')!.test(value) && !this.commonPatterns.get('numeric')!.test(value)) {
            violations.push({
                field: key,
                expected: 'UUID or numeric ID',
                actual: value.substring(0, 50),
                severity: 'warning'
            });
        }

        return { isValid: violations.length === 0, violations };
    }

    private validateBody(body: string, contentType?: string): { violations: SchemaViolation[] } {
        const violations: SchemaViolation[] = [];

        if (!body) {
            return { violations };
        }

        if (contentType?.includes('application/json')) {
            try {
                const parsed = JSON.parse(body);
                
                const depth = this.getObjectDepth(parsed);
                if (depth > 10) {
                    violations.push({
                        field: 'body',
                        expected: 'JSON depth <= 10',
                        actual: `depth = ${depth}`,
                        severity: 'warning'
                    });
                }

                const size = JSON.stringify(parsed).length;
                if (size > 100000) {
                    violations.push({
                        field: 'body',
                        expected: 'size <= 100KB',
                        actual: `size = ${(size / 1024).toFixed(2)}KB`,
                        severity: 'warning'
                    });
                }
            } catch {
                violations.push({
                    field: 'body',
                    expected: 'valid JSON',
                    actual: 'invalid JSON',
                    severity: 'error'
                });
            }
        }

        if (this.containsDangerousPatterns(body)) {
            violations.push({
                field: 'body',
                expected: 'safe content',
                actual: 'contains potentially dangerous patterns',
                severity: 'error'
            });
        }

        return { violations };
    }

    private validatePath(path: string): { violations: SchemaViolation[] } {
        const violations: SchemaViolation[] = [];

        if (path.length > 2048) {
            violations.push({
                field: 'path',
                expected: 'length <= 2048',
                actual: `length = ${path.length}`,
                severity: 'warning'
            });
        }

        const normalizedPath = decodeURIComponent(path);
        if (normalizedPath.includes('..') || normalizedPath.includes('~')) {
            violations.push({
                field: 'path',
                expected: 'no path traversal',
                actual: 'contains .. or ~',
                severity: 'error'
            });
        }

        if (/[<>:"|?*]/.test(path)) {
            violations.push({
                field: 'path',
                expected: 'valid URL characters',
                actual: 'contains invalid characters',
                severity: 'warning'
            });
        }

        return { violations };
    }

    private validateHeaders(headers: Record<string, string>): { violations: SchemaViolation[] } {
        const violations: SchemaViolation[] = [];

        for (const [key, value] of Object.entries(headers)) {
            if (value.length > 8192) {
                violations.push({
                    field: `header.${key}`,
                    expected: 'length <= 8192',
                    actual: `length = ${value.length}`,
                    severity: 'warning'
                });
            }

            if (this.containsDangerousPatterns(value)) {
                violations.push({
                    field: `header.${key}`,
                    expected: 'safe characters',
                    actual: 'contains dangerous patterns',
                    severity: 'error'
                });
            }
        }

        return { violations };
    }

    private containsDangerousPatterns(input: string): boolean {
        const dangerousPatterns = [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,
            /'\s*(or|and)\s+'/i,
            /union\s+select/i,
            /;\s*(drop|delete|update|insert)/i,
            /(?:;|&&|\|\|)\s*(cat|curl|wget|bash|sh|type|powershell)\b/i,
            /\.\.\//,
            /%2e%2e/i,
            /\|\s*\w+/,
            /\$\(/,
            /`.*`/
        ];

        return dangerousPatterns.some(pattern => pattern.test(input));
    }

    private getObjectDepth(obj: any, depth: number = 0): number {
        if (typeof obj !== 'object' || obj === null) {
            return depth;
        }

        const values = Object.values(obj);
        if (values.length === 0) {
            return depth;
        }

        return Math.max(...values.map(v => this.getObjectDepth(v, depth + 1)));
    }

    private fallbackAnalysis(context: TrafficContext): AnalysisResult {
        const startedAt = Date.now();
        const schemaValidation = this.performSchemaValidation(context);
        const evidence: Evidence[] = [];
        let verdict: AnalysisResult['verdict'] = 'safe';
        let confidence = 0.78;
        const content = [
            context.request.path,
            context.request.body || '',
            JSON.stringify(context.request.queryParams || {}),
            JSON.stringify(context.request.headers || {})
        ].join(' ');
        const signals = this.inspectContentHeuristics(content);

        const errorCount = schemaValidation.violations.filter(v => v.severity === 'error').length;
        const warningCount = schemaValidation.violations.filter(v => v.severity === 'warning').length;

        if (errorCount > 0 || signals.hardSignals.length > 0) {
            verdict = 'malicious';
            confidence = 0.9;
            evidence.push({
                type: 'pattern',
                description: `Found ${Math.max(errorCount, 1)} blocking validation issue(s)`,
                severity: 'high',
                data: {
                    violations: schemaValidation.violations.filter(v => v.severity === 'error'),
                    indicators: signals.hardSignals.map(signal => signal.label)
                },
                source: 'Plato'
            });
        } else if (warningCount > 1 || signals.softSignals.length > 1) {
            verdict = 'suspicious';
            confidence = 0.72;
            evidence.push({
                type: 'pattern',
                description: `Found ${Math.max(warningCount, signals.softSignals.length)} non-blocking validation concern(s)`,
                severity: 'medium',
                data: {
                    violations: schemaValidation.violations,
                    indicators: signals.softSignals.map(signal => signal.label)
                },
                source: 'Plato'
            });
        }

        return this.finalizeAnalysisResult({
            agentId: this.identity.id,
            role: 'plato',
            verdict,
            confidence,
            reasoning: schemaValidation.isValid
                ? signals.softSignals.length > 0
                    ? `Request is structurally valid but exposes risky input surfaces: ${signals.softSignals.map(signal => signal.label).join(', ')}`
                    : 'Request conforms to expected schema'
                : `Schema validation failed: ${schemaValidation.violations.map(v => v.field).join(', ')}`,
            evidence,
            schemaValidation,
            classScores:
                verdict === 'malicious'
                    ? { safe: 0.06, suspicious: 0.12, malicious: 0.82 }
                    : verdict === 'suspicious'
                        ? { safe: 0.24, suspicious: 0.58, malicious: 0.18 }
                        : { safe: 0.82, suspicious: 0.12, malicious: 0.06 },
            attackFamily: signals.attackFamily,
            heuristicFallback: true,
            modelTier: undefined,
            routeMode: 'unknown',
            analysisLatencyMs: Date.now() - startedAt
        });
    }

    protected async handleAnalysisRequest(message: AgentMessage): Promise<void> {
        const context = message.payload as TrafficContext;
        const result = await this.analyze(context);
        await this.sendMessage('orchestrator', 'analysis_result', result);
    }

    protected async handleDebateInvitation(message: AgentMessage): Promise<void> {
        logger.info(`Plato received debate invitation for: ${message.payload.topic}`);
    }

    protected async handleDebateArgument(message: AgentMessage): Promise<void> {
        logger.debug(`Plato received debate argument`);
    }

    protected async handleToolResult(message: AgentMessage): Promise<void> {
        logger.debug(`Plato received tool result`);
    }
}
