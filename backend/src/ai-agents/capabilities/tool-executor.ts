/**
 * Tool Executor - L4: Capability Incarnation Layer
 * Safe execution of security analysis tools
 */

import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import {
    ToolDefinition,
    ToolExecutionRequest,
    ToolExecutionResult,
    SandboxOptions
} from '../core/types';
import logger from '../../utils/logger';

const DEFAULT_SANDBOX_OPTIONS: SandboxOptions = {
    enabled: true,
    timeout: 30000,
    memoryLimit: 256 * 1024 * 1024,
    networkAccess: false,
    fileSystemAccess: false
};

export class ToolExecutor {
    private registeredTools: Map<string, ToolDefinition> = new Map();
    private executionHistory: Map<string, ToolExecutionResult> = new Map();
    private defaultSandbox: SandboxOptions;

    constructor(sandboxOptions: Partial<SandboxOptions> = {}) {
        this.defaultSandbox = { ...DEFAULT_SANDBOX_OPTIONS, ...sandboxOptions };
        this.registerBuiltinTools();
    }

    private registerBuiltinTools(): void {
        this.registerTool({
            name: 'explain_sql',
            description: 'Safely execute EXPLAIN on SQL queries to detect injection risks',
            parameters: [
                { name: 'query', type: 'string', required: true, description: 'SQL query to explain' },
                { name: 'database', type: 'string', required: false, description: 'Database type (mysql, postgresql)' }
            ],
            riskLevel: 'low',
            requiresSandbox: true
        });

        this.registerTool({
            name: 'http_probe',
            description: 'Send safe HTTP probe to check endpoint behavior',
            parameters: [
                { name: 'url', type: 'string', required: true, description: 'URL to probe' },
                { name: 'method', type: 'string', required: false, description: 'HTTP method' },
                { name: 'headers', type: 'object', required: false, description: 'Headers to send' }
            ],
            riskLevel: 'medium',
            requiresSandbox: true
        });

        this.registerTool({
            name: 'decode_payload',
            description: 'Decode various encoding formats to analyze payloads',
            parameters: [
                { name: 'payload', type: 'string', required: true, description: 'Encoded payload' },
                { name: 'encoding', type: 'string', required: false, description: 'Encoding type (base64, url, hex)' }
            ],
            riskLevel: 'low',
            requiresSandbox: false
        });

        this.registerTool({
            name: 'analyze_headers',
            description: 'Analyze HTTP headers for security issues',
            parameters: [
                { name: 'headers', type: 'object', required: true, description: 'Headers to analyze' }
            ],
            riskLevel: 'low',
            requiresSandbox: false
        });

        this.registerTool({
            name: 'check_pattern',
            description: 'Check content against security patterns',
            parameters: [
                { name: 'content', type: 'string', required: true, description: 'Content to check' },
                { name: 'patterns', type: 'array', required: false, description: 'Patterns to match' }
            ],
            riskLevel: 'low',
            requiresSandbox: false
        });
    }

    registerTool(tool: ToolDefinition): void {
        this.registeredTools.set(tool.name, tool);
        logger.info(`Tool registered: ${tool.name}`);
    }

    async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
        const tool = this.registeredTools.get(request.toolName);
        
        if (!tool) {
            return this.createErrorResult(request, `Unknown tool: ${request.toolName}`);
        }

        const validation = this.validateParameters(tool, request.parameters);
        if (!validation.valid) {
            return this.createErrorResult(request, validation.error!);
        }

        const sandbox = request.sandboxOptions || 
            (tool.requiresSandbox ? this.defaultSandbox : { ...DEFAULT_SANDBOX_OPTIONS, enabled: false });

        const startTime = Date.now();

        try {
            let output: any;

            switch (tool.name) {
                case 'explain_sql':
                    output = await this.executeExplainSQL(request.parameters, sandbox);
                    break;
                case 'http_probe':
                    output = await this.executeHTTPProbe(request.parameters, sandbox);
                    break;
                case 'decode_payload':
                    output = this.executeDecodePayload(request.parameters);
                    break;
                case 'analyze_headers':
                    output = this.executeAnalyzeHeaders(request.parameters);
                    break;
                case 'check_pattern':
                    output = this.executeCheckPattern(request.parameters);
                    break;
                default:
                    output = await this.executeGenericTool(tool, request.parameters, sandbox);
            }

            const result: ToolExecutionResult = {
                requestId: request.requestId,
                toolName: request.toolName,
                success: true,
                output,
                executionTime: Date.now() - startTime,
                sandboxed: sandbox.enabled
            };

            this.executionHistory.set(request.requestId, result);
            return result;

        } catch (error: any) {
            const result: ToolExecutionResult = {
                requestId: request.requestId,
                toolName: request.toolName,
                success: false,
                output: null,
                error: error.message,
                executionTime: Date.now() - startTime,
                sandboxed: sandbox.enabled
            };

            this.executionHistory.set(request.requestId, result);
            return result;
        }
    }

    private validateParameters(
        tool: ToolDefinition, 
        params: Record<string, any>
    ): { valid: boolean; error?: string } {
        for (const param of tool.parameters) {
            if (param.required && !(param.name in params)) {
                return { valid: false, error: `Missing required parameter: ${param.name}` };
            }

            if (param.name in params && param.validation) {
                const regex = new RegExp(param.validation);
                if (!regex.test(String(params[param.name]))) {
                    return { valid: false, error: `Parameter ${param.name} failed validation` };
                }
            }
        }

        return { valid: true };
    }

    private async executeExplainSQL(
        params: Record<string, any>,
        sandbox: SandboxOptions
    ): Promise<any> {
        const { query, database = 'mysql' } = params;

        const sanitized = this.sanitizeSQLQuery(query);
        
        const analysis = {
            originalQuery: query.substring(0, 200),
            sanitizedQuery: sanitized.substring(0, 200),
            riskIndicators: [] as string[],
            suggestedIndex: null as string | null,
            warnings: [] as string[]
        };

        const dangerousPatterns = [
            { pattern: /;\s*(drop|delete|truncate|update|insert)/i, risk: 'Multiple statements detected' },
            { pattern: /union\s+select/i, risk: 'UNION injection pattern' },
            { pattern: /'\s*or\s+'/i, risk: 'Boolean injection pattern' },
            { pattern: /--\s*$/m, risk: 'Comment injection pattern' },
            { pattern: /load_file\s*\(/i, risk: 'File access attempt' },
            { pattern: /into\s+(out|dump)file/i, risk: 'File write attempt' }
        ];

        for (const { pattern, risk } of dangerousPatterns) {
            if (pattern.test(query)) {
                analysis.riskIndicators.push(risk);
            }
        }

        if (query.length > 10000) {
            analysis.warnings.push('Query exceeds safe length limit');
        }

        return analysis;
    }

    private sanitizeSQLQuery(query: string): string {
        let sanitized = query;
        sanitized = sanitized.replace(/--.*$/gm, '');
        sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');
        sanitized = sanitized.replace(/;\s*(drop|delete|truncate|update|insert)/gi, '');
        return sanitized;
    }

    private async executeHTTPProbe(
        params: Record<string, any>,
        sandbox: SandboxOptions
    ): Promise<any> {
        const { url, method = 'GET', headers = {} } = params;

        if (!sandbox.networkAccess) {
            return {
                status: 'blocked',
                reason: 'Network access disabled in sandbox',
                url: this.sanitizeURL(url)
            };
        }

        const sanitizedURL = this.sanitizeURL(url);
        
        return {
            status: 'simulated',
            url: sanitizedURL,
            method,
            simulatedResponse: {
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                body: '{ "status": "ok" }'
            },
            note: 'HTTP probe executed in safe mode'
        };
    }

    private sanitizeURL(url: string): string {
        try {
            const parsed = new URL(url);
            const dangerousParams = ['password', 'token', 'secret', 'key', 'auth'];
            
            const sanitizedParams = new URLSearchParams();
            for (const [key, value] of parsed.searchParams) {
                if (dangerousParams.some(d => key.toLowerCase().includes(d))) {
                    sanitizedParams.set(key, '[REDACTED]');
                } else {
                    sanitizedParams.set(key, value.substring(0, 100));
                }
            }
            
            parsed.search = sanitizedParams.toString();
            return parsed.toString();
        } catch {
            return '[INVALID_URL]';
        }
    }

    private executeDecodePayload(params: Record<string, any>): any {
        const { payload, encoding = 'auto' } = params;
        const results: { encoding: string; decoded: string; success: boolean }[] = [];

        const tryDecode = (enc: string): { decoded: string; success: boolean } => {
            try {
                let decoded: string;
                
                switch (enc) {
                    case 'base64':
                        decoded = Buffer.from(payload, 'base64').toString('utf-8');
                        break;
                    case 'url':
                        decoded = decodeURIComponent(payload);
                        break;
                    case 'hex':
                        decoded = Buffer.from(payload.replace(/\s/g, ''), 'hex').toString('utf-8');
                        break;
                    case 'unicode':
                        decoded = payload.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => 
                            String.fromCharCode(parseInt(hex, 16))
                        );
                        break;
                    case 'html':
                        decoded = payload.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
                            String.fromCharCode(parseInt(hex, 16))
                        ).replace(/&#(\d+);/g, (_, dec) =>
                            String.fromCharCode(parseInt(dec, 10))
                        );
                        break;
                    default:
                        return { decoded: payload, success: false };
                }
                
                return { decoded, success: true };
            } catch {
                return { decoded: payload, success: false };
            }
        };

        const encodings = encoding === 'auto' 
            ? ['base64', 'url', 'hex', 'unicode', 'html']
            : [encoding];

        for (const enc of encodings) {
            const result = tryDecode(enc);
            if (result.success) {
                results.push({ encoding: enc, decoded: result.decoded, success: true });
            }
        }

        return {
            original: payload.substring(0, 500),
            decodedVersions: results,
            totalDecoded: results.length
        };
    }

    private executeAnalyzeHeaders(params: Record<string, any>): any {
        const { headers } = params;
        const issues: { header: string; issue: string; severity: string }[] = [];
        const recommendations: string[] = [];

        const securityHeaders = {
            'strict-transport-security': { required: true, recommendation: 'Add HSTS header' },
            'content-security-policy': { required: true, recommendation: 'Add CSP header' },
            'x-frame-options': { required: true, recommendation: 'Add X-Frame-Options header' },
            'x-content-type-options': { required: true, recommendation: 'Add X-Content-Type-Options header' },
            'x-xss-protection': { required: false, recommendation: 'Consider adding X-XSS-Protection header' }
        };

        const headerKeys = Object.keys(headers).map(k => k.toLowerCase());

        for (const [header, config] of Object.entries(securityHeaders)) {
            if (!headerKeys.includes(header)) {
                issues.push({
                    header,
                    issue: 'Missing security header',
                    severity: config.required ? 'high' : 'medium'
                });
                recommendations.push(config.recommendation);
            }
        }

        for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            
            if (lowerKey === 'server' && String(value).length > 20) {
                issues.push({
                    header: key,
                    issue: 'Server header reveals too much information',
                    severity: 'low'
                });
            }

            if (lowerKey === 'x-powered-by') {
                issues.push({
                    header: key,
                    issue: 'Technology disclosure',
                    severity: 'low'
                });
                recommendations.push('Remove X-Powered-By header');
            }
        }

        return {
            headerCount: Object.keys(headers).length,
            issues,
            recommendations,
            securityScore: Math.max(0, 100 - issues.length * 15)
        };
    }

    private executeCheckPattern(params: Record<string, any>): any {
        const { content, patterns = [] } = params;
        const matches: { pattern: string; match: string; position: number }[] = [];

        const defaultPatterns = [
            { name: 'sql_injection', pattern: /'\s*(or|and)\s+('|\d)/i },
            { name: 'xss_script', pattern: /<script[^>]*>/i },
            { name: 'xss_event', pattern: /on\w+\s*=/i },
            { name: 'path_traversal', pattern: /\.\.[\/\\]/ },
            { name: 'command_injection', pattern: /[;&|`$]/ },
            { name: 'ssrf', pattern: /^(https?:)?\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i }
        ];

        const patternsToCheck = patterns.length > 0 
            ? patterns.map((p: string) => ({ name: p, pattern: new RegExp(p, 'gi') }))
            : defaultPatterns;

        for (const { name, pattern } of patternsToCheck) {
            const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'gi');
            let match;
            
            while ((match = regex.exec(content)) !== null) {
                matches.push({
                    pattern: name,
                    match: match[0].substring(0, 50),
                    position: match.index
                });
            }
        }

        return {
            contentLength: content.length,
            patternsChecked: patternsToCheck.length,
            matchesFound: matches.length,
            matches: matches.slice(0, 20),
            riskLevel: matches.length > 5 ? 'high' : matches.length > 0 ? 'medium' : 'low'
        };
    }

    private async executeGenericTool(
        tool: ToolDefinition,
        params: Record<string, any>,
        sandbox: SandboxOptions
    ): Promise<any> {
        return {
            tool: tool.name,
            status: 'not_implemented',
            params: Object.keys(params),
            sandboxed: sandbox.enabled
        };
    }

    private createErrorResult(request: ToolExecutionRequest, error: string): ToolExecutionResult {
        return {
            requestId: request.requestId,
            toolName: request.toolName,
            success: false,
            output: null,
            error,
            executionTime: 0,
            sandboxed: false
        };
    }

    getTool(name: string): ToolDefinition | undefined {
        return this.registeredTools.get(name);
    }

    listTools(): ToolDefinition[] {
        return Array.from(this.registeredTools.values());
    }

    getExecutionHistory(requestId?: string): ToolExecutionResult | ToolExecutionResult[] {
        if (requestId) {
            return this.executionHistory.get(requestId) || [];
        }
        return Array.from(this.executionHistory.values());
    }
}

export const toolExecutor = new ToolExecutor();
