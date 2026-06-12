/**
 * Tool Executor - L4: Capability Incarnation Layer
 * Safe execution of security analysis tools
 */

import { uuidv4 } from '../../utils/uuid';
import { spawn } from 'child_process';
import crypto from 'crypto';
import dns from 'dns';
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
    private sanitizeToolOutput(value: unknown): unknown {
        if (typeof value === "string") {
            const stripped = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
            return stripped.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        }
        if (Array.isArray(value)) return value.map((v) => this.sanitizeToolOutput(v));
        if (value && typeof value === "object") {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) out[k] = this.sanitizeToolOutput(v);
            return out;
        }
        return value;
    }
    private sanitizeErrorMessage(message: unknown): string {
        const text = typeof message === "string" ? message : String(message ?? "");
        const truncated = text.length > 500 ? text.slice(0, 500) + "...[truncated]" : text;
        const stripped = truncated.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        return stripped.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    private classifyUnsafePattern(pattern: string): string | null {
        if (pattern.length > 200) return "pattern exceeds the safe length ceiling";
        let depth = 0, maxDepth = 0;
        for (let i = 0; i < pattern.length; i++) {
            const ch = pattern[i];
            if (ch === "\\") { i++; continue; }
            if (ch === "(" && pattern[i + 1] !== "?") { depth++; if (depth > maxDepth) maxDepth = depth; }
            else if (ch === ")") { if (depth > 0) depth--; }
        }
        if (maxDepth > 2) return "nesting depth exceeds the safe ceiling";
        const stripped = pattern.replace(/\./g, "").replace(/\[[^\]]*\]/g, "");
        if (/\([^)]*[+*?][^)]*\)[+*?]/.test(stripped)) return "catastrophic backtracking (nested quantifier)";
        if (/\\[1-9]/.test(pattern) && /[+*?]/.test(stripped)) return "catastrophic backtracking (back-reference with quantifier)";
        return null;
    }
    private async checkSsrfSafety(url: string): Promise<string | null> {
        let parsed: URL;
        try { parsed = new URL(url); } catch { return "invalid_url"; }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "unsupported_protocol:" + parsed.protocol;
        const host = parsed.hostname.replace(/^\[|\]$/g, "");
        if (this.isPrivateOrLoopbackAddress(host)) return "private_or_loopback_address:" + host;
        const lh = host.toLowerCase();
        if (lh === "localhost" || lh.endsWith(".localhost") || lh === "metadata.google.internal" || lh.endsWith(".internal")) return "private_or_loopback_address:" + host;
        try {
            const resolved = await dns.promises.lookup(host, { all: true });
            for (const addr of resolved) if (this.isPrivateOrLoopbackAddress(addr.address)) return "private_or_loopback_address:" + host;
        } catch {}
        return null;
    }
    private isPrivateOrLoopbackAddress(host: string): boolean {
        const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
        if (m) {
            const a = Number(m[1]), b = Number(m[2]);
            if (a === 10 || a === 127 || a === 0) return true;
            if (a === 169 && b === 254) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 100 && b >= 64 && b <= 127) return true;
        }
        if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
        if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
        if (/^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host)) return true;
        return false;
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
                output: this.sanitizeToolOutput(output),
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
                error: this.sanitizeErrorMessage(error?.message ?? String(error)),
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

        const ssrfReason = await this.checkSsrfSafety(url);
        if (ssrfReason) {
            return { status: 'blocked', reason: 'ssrf_blocked:' + ssrfReason, url: this.sanitizeURL(url) };
        }

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
                        decoded = payload.replace(/\\u([0-9a-f]{4})/gi, (_: string, hex: string) => 
                            String.fromCharCode(parseInt(hex, 16))
                        );
                        break;
                    case 'html':
                        decoded = payload.replace(/&#x([0-9a-f]+);/gi, (_: string, hex: string) =>
                            String.fromCharCode(parseInt(hex, 16))
                        ).replace(/&#(\d+);/g, (_: string, dec: string) =>
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

        const CONTENT_BYTE_LIMIT = 1024 * 1024;
        if (typeof content === 'string' && Buffer.byteLength(content) > CONTENT_BYTE_LIMIT) {
            throw new Error('unsafe content size rejected: input exceeds the 1MB byte limit');
        }
        const userPatterns = Array.isArray(patterns) ? patterns : [];
        for (const p of userPatterns) {
            if (typeof p === 'string') {
                const reason = this.classifyUnsafePattern(p);
                if (reason) throw new Error('unsafe regex pattern rejected (' + reason + '): ' + p);
            }
        }

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

        const MATCH_CAP = 1000;
        let matchesCapped = false;
        cap: for (const { name, pattern } of patternsToCheck) {
            const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'gi');
            let match;
            
            while ((match = regex.exec(content)) !== null) {
                matches.push({
                    pattern: name,
                    match: match[0].substring(0, 50),
                    position: match.index
                });
                if (matches.length >= MATCH_CAP) { matchesCapped = true; break cap; }
            }
        }

        return {
            contentLength: content.length,
            patternsChecked: patternsToCheck.length,
            matchesFound: matches.length,
            matches: matches.slice(0, 20),
            matchesCapped,
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
            error: this.sanitizeErrorMessage(error),
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
