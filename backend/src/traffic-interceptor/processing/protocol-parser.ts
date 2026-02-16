/**
 * Protocol Parser - Fast protocol detection and parsing
 */

import {
    ParsedPacket,
    HTTPRequest,
    DNSQuery,
    TLSHandshake
} from '../core/types';
import logger from '../../utils/logger';

export interface ProtocolDetectionResult {
    protocol: string;
    confidence: number;
    isEncrypted: boolean;
    isRequest: boolean;
}

export interface ParsedProtocol {
    type: string;
    data: any;
    threats: ThreatIndicator[];
}

export interface ThreatIndicator {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    location: { start: number; end: number };
}

export class ProtocolParser {
    private static readonly HTTP_METHODS = [
        'GET ', 'POST', 'PUT ', 'DELE', 'HEAD', 'OPTI', 'PATC', 'TRAC', 'CONN'
    ];

    private static readonly SQL_KEYWORDS = [
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'EXEC',
        'EXECUTE', 'DECLARE', 'CAST', 'CONVERT', 'CONCAT', 'CHAR',
        'NCHAR', 'VARCHAR', 'NVARCHAR', 'ALTER', 'CREATE', 'TRUNCATE'
    ];

    private static readonly XSS_PATTERNS = [
        /<script[\s\S]*?>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe[\s\S]*?>/gi,
        /<object[\s\S]*?>/gi,
        /<embed[\s\S]*?>/gi,
        /expression\s*\(/gi,
        /vbscript:/gi,
        /data:\s*text\/html/gi
    ];

    private static readonly PATH_TRAVERSAL_PATTERNS = [
        /\.\.[\/\\]/g,
        /%2e%2e[%\/\\]/gi,
        /\.\.%2f/gi,
        /%2e%2e\//gi,
        /\.\.%5c/gi
    ];

    detectProtocol(payload: Buffer): ProtocolDetectionResult {
        if (payload.length < 4) {
            return { protocol: 'unknown', confidence: 0, isEncrypted: false, isRequest: false };
        }

        const firstBytes = payload.subarray(0, 4);
        const first4Str = firstBytes.toString('ascii');

        if (this.isHTTP(first4Str)) {
            return { protocol: 'http', confidence: 0.95, isEncrypted: false, isRequest: true };
        }

        if (this.isTLS(firstBytes)) {
            return { protocol: 'tls', confidence: 0.95, isEncrypted: true, isRequest: false };
        }

        if (this.isDNS(payload)) {
            return { protocol: 'dns', confidence: 0.9, isEncrypted: false, isRequest: true };
        }

        if (this.isSSH(firstBytes)) {
            return { protocol: 'ssh', confidence: 0.95, isEncrypted: true, isRequest: false };
        }

        if (this.isSMTP(first4Str)) {
            return { protocol: 'smtp', confidence: 0.9, isEncrypted: false, isRequest: false };
        }

        return { protocol: 'unknown', confidence: 0.5, isEncrypted: false, isRequest: false };
    }

    private isHTTP(first4: string): boolean {
        return ProtocolParser.HTTP_METHODS.some(method => first4.startsWith(method));
    }

    private isTLS(firstBytes: Buffer): boolean {
        const contentType = firstBytes[0];
        const version = (firstBytes[1] << 8) | firstBytes[2];
        
        return contentType >= 20 && contentType <= 23 &&
               (version === 0x0301 || version === 0x0302 || 
                version === 0x0303 || version === 0x0300);
    }

    private isDNS(payload: Buffer): boolean {
        if (payload.length < 12) return false;

        const flags = payload.readUInt16BE(2);
        const qr = (flags >> 15) & 1;
        const opcode = (flags >> 11) & 0xF;
        const qdcount = payload.readUInt16BE(4);
        const ancount = payload.readUInt16BE(6);

        return opcode <= 2 && qdcount <= 10 && ancount <= 100;
    }

    private isSSH(firstBytes: Buffer): boolean {
        return firstBytes.toString('ascii').startsWith('SSH-');
    }

    private isSMTP(first4: string): boolean {
        return first4.startsWith('220 ') || 
               first4.startsWith('EHLO') ||
               first4.startsWith('HELO') ||
               first4.startsWith('MAIL') ||
               first4.startsWith('RCPT');
    }

    parseHTTP(payload: Buffer): { request: HTTPRequest | null; threats: ThreatIndicator[] } {
        const threats: ThreatIndicator[] = [];
        let request: HTTPRequest | null = null;

        try {
            const headerEnd = this.findHeaderEnd(payload);
            if (headerEnd === -1) {
                return { request: null, threats };
            }

            const headerStr = payload.subarray(0, headerEnd).toString('utf-8');
            const lines = headerStr.split('\r\n');
            const [method, path, version] = (lines[0] || '').split(' ');

            const headers: Record<string, string> = {};
            for (let i = 1; i < lines.length; i++) {
                const colonIndex = lines[i].indexOf(':');
                if (colonIndex !== -1) {
                    const key = lines[i].substring(0, colonIndex).trim().toLowerCase();
                    const value = lines[i].substring(colonIndex + 1).trim();
                    headers[key] = value;
                }
            }

            const body = payload.subarray(headerEnd + 4);

            request = { method, path, version, headers, body };

            threats.push(...this.detectHTTPThreats(request, payload));

        } catch (error: any) {
            logger.debug('HTTP parsing error', { error: error.message });
        }

        return { request, threats };
    }

    private detectHTTPThreats(request: HTTPRequest, payload: Buffer): ThreatIndicator[] {
        const threats: ThreatIndicator[] = [];
        const fullRequest = payload.toString('utf-8');

        const sqlInjection = this.detectSQLInjection(fullRequest);
        threats.push(...sqlInjection);

        const xss = this.detectXSS(fullRequest);
        threats.push(...xss);

        const pathTraversal = this.detectPathTraversal(request.path || '');
        threats.push(...pathTraversal);

        const headerInjection = this.detectHeaderInjection(request.headers);
        threats.push(...headerInjection);

        return threats;
    }

    private detectSQLInjection(content: string): ThreatIndicator[] {
        const threats: ThreatIndicator[] = [];
        const upperContent = content.toUpperCase();

        for (const keyword of ProtocolParser.SQL_KEYWORDS) {
            let pos = 0;
            while ((pos = upperContent.indexOf(keyword, pos)) !== -1) {
                const context = content.substring(Math.max(0, pos - 5), pos + keyword.length + 5);
                
                if (this.isSQLContext(context)) {
                    threats.push({
                        type: 'sql_injection',
                        severity: 'high',
                        description: `SQL keyword detected: ${keyword}`,
                        location: { start: pos, end: pos + keyword.length }
                    });
                }
                pos++;
            }
        }

        const injectionPatterns = [
            { pattern: /'\s*(OR|AND)\s+['\d]/gi, type: 'sql_injection', severity: 'critical' as const },
            { pattern: /;\s*(DROP|DELETE|UPDATE|INSERT)/gi, type: 'sql_injection', severity: 'critical' as const },
            { pattern: /UNION\s+(ALL\s+)?SELECT/gi, type: 'sql_injection', severity: 'critical' as const },
            { pattern: /--\s*$/gm, type: 'sql_injection', severity: 'high' as const },
            { pattern: /\/\*[\s\S]*?\*\//g, type: 'sql_injection', severity: 'medium' as const }
        ];

        for (const { pattern, type, severity } of injectionPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                threats.push({
                    type,
                    severity,
                    description: `SQL injection pattern: ${match[0].substring(0, 50)}`,
                    location: { start: match.index, end: match.index + match[0].length }
                });
            }
        }

        return threats;
    }

    private isSQLContext(context: string): boolean {
        const suspiciousChars = ["'", '"', '=', '(', ')', ';', ' '];
        return suspiciousChars.some(c => context.includes(c));
    }

    private detectXSS(content: string): ThreatIndicator[] {
        const threats: ThreatIndicator[] = [];

        for (const pattern of ProtocolParser.XSS_PATTERNS) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                threats.push({
                    type: 'xss',
                    severity: 'high',
                    description: `XSS pattern detected: ${match[0].substring(0, 50)}`,
                    location: { start: match.index, end: match.index + match[0].length }
                });
            }
        }

        return threats;
    }

    private detectPathTraversal(path: string): ThreatIndicator[] {
        const threats: ThreatIndicator[] = [];

        for (const pattern of ProtocolParser.PATH_TRAVERSAL_PATTERNS) {
            let match;
            while ((match = pattern.exec(path)) !== null) {
                threats.push({
                    type: 'path_traversal',
                    severity: 'high',
                    description: `Path traversal attempt: ${match[0]}`,
                    location: { start: match.index, end: match.index + match[0].length }
                });
            }
        }

        return threats;
    }

    private detectHeaderInjection(headers: Record<string, string>): ThreatIndicator[] {
        const threats: ThreatIndicator[] = [];

        for (const [key, value] of Object.entries(headers)) {
            if (value.includes('\r\n')) {
                threats.push({
                    type: 'header_injection',
                    severity: 'high',
                    description: `Header injection in ${key}`,
                    location: { start: 0, end: value.length }
                });
            }
        }

        return threats;
    }

    parseDNS(payload: Buffer): { query: DNSQuery | null; threats: ThreatIndicator[] } {
        const threats: ThreatIndicator[] = [];
        let query: DNSQuery | null = null;

        try {
            if (payload.length < 12) {
                return { query: null, threats };
            }

            const transactionId = payload.readUInt16BE(0);
            const flags = payload.readUInt16BE(2);
            const qdcount = payload.readUInt16BE(4);
            const ancount = payload.readUInt16BE(6);

            const questions = this.parseDNSQuestions(payload, 12, qdcount);

            query = {
                transactionId,
                flags,
                questions,
                answers: []
            };

            for (const q of questions) {
                if (this.isSuspiciousDomain(q.name)) {
                    threats.push({
                        type: 'dns_exfil',
                        severity: 'medium',
                        description: `Suspicious DNS query: ${q.name}`,
                        location: { start: 0, end: q.name.length }
                    });
                }
            }

        } catch (error: any) {
            logger.debug('DNS parsing error', { error: error.message });
        }

        return { query, threats };
    }

    private parseDNSQuestions(payload: Buffer, offset: number, count: number): { name: string; type: number; class: number }[] {
        const questions: { name: string; type: number; class: number }[] = [];

        for (let i = 0; i < count && offset < payload.length; i++) {
            const name = this.readDNSName(payload, offset);
            offset += name.length + 2;

            if (offset + 4 > payload.length) break;

            const type = payload.readUInt16BE(offset);
            const cls = payload.readUInt16BE(offset + 2);
            offset += 4;

            questions.push({ name, type, class: cls });
        }

        return questions;
    }

    private readDNSName(payload: Buffer, offset: number): string {
        const labels: string[] = [];
        let pos = offset;
        let jumped = false;
        const maxJumps = 10;
        let jumps = 0;

        while (pos < payload.length) {
            const len = payload[pos];

            if (len === 0) {
                break;
            }

            if ((len & 0xC0) === 0xC0) {
                if (!jumped) {
                    jumped = true;
                }
                const jumpOffset = ((len & 0x3F) << 8) | payload[pos + 1];
                pos = jumpOffset;
                jumps++;
                if (jumps > maxJumps) break;
                continue;
            }

            pos++;
            if (pos + len > payload.length) break;

            labels.push(payload.subarray(pos, pos + len).toString('ascii'));
            pos += len;
        }

        return labels.join('.');
    }

    private isSuspiciousDomain(domain: string): boolean {
        const suspiciousPatterns = [
            /^[a-z0-9]{32,}\./i,
            /\.(local|localhost|internal)$/i,
            /^[a-f0-9]{16,}\./i
        ];

        return suspiciousPatterns.some(p => p.test(domain));
    }

    private findHeaderEnd(data: Buffer): number {
        for (let i = 0; i < data.length - 3; i++) {
            if (data[i] === 0x0D && data[i + 1] === 0x0A && 
                data[i + 2] === 0x0D && data[i + 3] === 0x0A) {
                return i;
            }
        }
        return -1;
    }

    parse(payload: Buffer): ParsedProtocol {
        const detection = this.detectProtocol(payload);
        const threats: ThreatIndicator[] = [];

        switch (detection.protocol) {
            case 'http':
                const httpResult = this.parseHTTP(payload);
                return {
                    type: 'http',
                    data: httpResult.request,
                    threats: httpResult.threats
                };

            case 'dns':
                const dnsResult = this.parseDNS(payload);
                return {
                    type: 'dns',
                    data: dnsResult.query,
                    threats: dnsResult.threats
                };

            case 'tls':
                return {
                    type: 'tls',
                    data: { encrypted: true },
                    threats: []
                };

            default:
                const genericThreats = [
                    ...this.detectSQLInjection(payload.toString('utf-8')),
                    ...this.detectXSS(payload.toString('utf-8'))
                ];
                return {
                    type: 'unknown',
                    data: null,
                    threats: genericThreats
                };
        }
    }
}

export const protocolParser = new ProtocolParser();
export default ProtocolParser;
