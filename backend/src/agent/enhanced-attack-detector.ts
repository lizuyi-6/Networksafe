/**
 * 增强的攻击检测引擎 V2
 *
 * 多层防御架构：
 * Layer 1: 语义分析（input-validator.ts）
 * Layer 2: 行为分析（本文件）
 * Layer 3: 异常检测（AI引擎）
 *
 * 即使源代码完全泄露，攻击者也无法绕过语义检查
 */

import logger from '../utils/logger';
import { TrafficEvent } from './traffic-monitor';
import { InputValidator, ValidationResult } from '../security/input-validator';

export interface ThreatAlert {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    sourceIP: string;
    description: string;
    evidence: string;
    ruleId: string;
    autoBlock: boolean;
    blockDuration?: number;
    timestamp: Date;
    confidence: number; // 新增：检测置信度 0-100
}

/**
 * 多维度速率限制追踪器
 */
class MultiDimensionalRateLimiter {
    // IP级别追踪
    private ipTracking = new Map<string, {
        count: number;
        firstSeen: number;
        violations: number; // 违规次数
    }>();

    // User-Agent级别追踪
    private uaTracking = new Map<string, {
        count: number;
        firstSeen: number;
    }>();

    // 指纹级别追踪（IP + UA + Path模式）
    private fingerprintTracking = new Map<string, {
        count: number;
        firstSeen: number;
    }>();

    // 路径级别追踪（检测扫描行为）
    private pathPatterns = new Map<string, Set<string>>();

    /**
     * 检查是否超过速率限制
     */
    checkLimit(event: TrafficEvent): ThreatAlert | null {
        const now = Date.now();

        // 1. IP级别检测
        const ipThreat = this.checkIPRate(event.sourceIP, now);
        if (ipThreat) return ipThreat;

        // 2. User-Agent级别检测
        if (event.userAgent) {
            const uaThreat = this.checkUARate(event.userAgent, now);
            if (uaThreat) return { ...uaThreat, sourceIP: event.sourceIP };
        }

        // 3. 指纹级别检测
        const fingerprint = this.createFingerprint(event);
        const fpThreat = this.checkFingerprintRate(fingerprint, event.sourceIP, now);
        if (fpThreat) return fpThreat;

        // 4. 扫描行为检测
        const scanThreat = this.detectScanningBehavior(event, now);
        if (scanThreat) return scanThreat;

        return null;
    }

    /**
     * IP级别速率检测（降低阈值）
     */
    private checkIPRate(ip: string, now: number): ThreatAlert | null {
        let data = this.ipTracking.get(ip);

        if (!data) {
            data = { count: 1, firstSeen: now, violations: 0 };
            this.ipTracking.set(ip, data);
            return null;
        }

        data.count++;
        const elapsed = (now - data.firstSeen) / 1000;
        const ratePerSecond = data.count / Math.max(elapsed, 0.1);

        // 动态阈值：违规次数越多，阈值越低
        const ddosThreshold = Math.max(50 - data.violations * 10, 20);
        const bruteForceThreshold = Math.max(20 - data.violations * 5, 5);

        if (ratePerSecond > ddosThreshold) {
            data.violations++;
            return {
                type: 'ddos',
                severity: 'critical',
                sourceIP: ip,
                description: 'DDoS Attack - High Request Rate',
                evidence: `${data.count} requests in ${elapsed.toFixed(1)}s (${ratePerSecond.toFixed(1)}/s)`,
                ruleId: 'RATE-001',
                autoBlock: true,
                blockDuration: 3600,
                timestamp: new Date(),
                confidence: 95
            };
        }

        if (ratePerSecond > bruteForceThreshold) {
            data.violations++;
            return {
                type: 'brute_force',
                severity: 'high',
                sourceIP: ip,
                description: 'Brute Force Attack Detected',
                evidence: `${data.count} requests in ${elapsed.toFixed(1)}s (${ratePerSecond.toFixed(1)}/s)`,
                ruleId: 'RATE-002',
                autoBlock: true,
                blockDuration: 1800,
                timestamp: new Date(),
                confidence: 85
            };
        }

        return null;
    }

    /**
     * User-Agent级别速率检测
     */
    private checkUARate(ua: string, now: number): Omit<ThreatAlert, 'sourceIP'> | null {
        let data = this.uaTracking.get(ua);

        if (!data) {
            data = { count: 1, firstSeen: now };
            this.uaTracking.set(ua, data);
            return null;
        }

        data.count++;
        const elapsed = (now - data.firstSeen) / 1000;

        // 同一UA每分钟最多100个请求
        if (elapsed < 60 && data.count > 100) {
            return {
                type: 'ua_abuse',
                severity: 'medium',
                description: 'User-Agent Rate Limit Exceeded',
                evidence: `${data.count} requests from same UA in ${elapsed.toFixed(1)}s`,
                ruleId: 'RATE-003',
                autoBlock: false,
                timestamp: new Date(),
                confidence: 70
            } as Omit<ThreatAlert, 'sourceIP'>;
        }

        return null;
    }

    /**
     * 创建请求指纹
     */
    private createFingerprint(event: TrafficEvent): string {
        const ip = event.sourceIP;
        const ua = event.userAgent || 'unknown';
        const pathPattern = this.extractPathPattern(event.path || '');

        return `${ip}:${ua}:${pathPattern}`;
    }

    /**
     * 提取路径模式（去除动态参数）
     */
    private extractPathPattern(path: string): string {
        // 移除查询字符串
        const pathOnly = path.split('?')[0];

        // 将数字替换为{id}，识别路径模式
        return pathOnly.replace(/\/\d+/g, '/{id}');
    }

    /**
     * 指纹级别速率检测
     */
    private checkFingerprintRate(fingerprint: string, ip: string, now: number): ThreatAlert | null {
        let data = this.fingerprintTracking.get(fingerprint);

        if (!data) {
            data = { count: 1, firstSeen: now };
            this.fingerprintTracking.set(fingerprint, data);
            return null;
        }

        data.count++;
        const elapsed = (now - data.firstSeen) / 1000;

        // 同一指纹每小时最多1000个请求
        if (elapsed < 3600 && data.count > 1000) {
            return {
                type: 'fingerprint_abuse',
                severity: 'high',
                sourceIP: ip,
                description: 'Request Fingerprint Abuse',
                evidence: `${data.count} identical requests in ${elapsed.toFixed(0)}s`,
                ruleId: 'RATE-004',
                autoBlock: true,
                blockDuration: 1800,
                timestamp: new Date(),
                confidence: 80
            };
        }

        return null;
    }

    /**
     * 扫描行为检测
     */
    private detectScanningBehavior(event: TrafficEvent, now: number): ThreatAlert | null {
        const ip = event.sourceIP;
        const path = event.path || '';

        // 获取该IP访问的所有路径
        let paths = this.pathPatterns.get(ip);
        if (!paths) {
            paths = new Set();
            this.pathPatterns.set(ip, paths);
        }

        paths.add(path);

        // 如果短时间内访问了大量不同路径，判定为扫描
        const ipData = this.ipTracking.get(ip);
        if (ipData) {
            const elapsed = (now - ipData.firstSeen) / 1000;
            const uniquePaths = paths.size;
            const diversityRatio = uniquePaths / ipData.count;

            // 5分钟内访问了30+个不同路径，且多样性>0.8
            if (elapsed < 300 && uniquePaths > 30 && diversityRatio > 0.8) {
                return {
                    type: 'scanning',
                    severity: 'high',
                    sourceIP: ip,
                    description: 'Automated Scanning Detected',
                    evidence: `${uniquePaths} unique paths in ${elapsed.toFixed(0)}s (diversity: ${(diversityRatio * 100).toFixed(0)}%)`,
                    ruleId: 'SCAN-001',
                    autoBlock: true,
                    blockDuration: 7200,
                    timestamp: new Date(),
                    confidence: 90
                };
            }
        }

        return null;
    }

    /**
     * 清理过期数据
     */
    cleanup(maxAge: number = 300000): void {
        const now = Date.now();

        // 清理IP追踪
        for (const [ip, data] of this.ipTracking) {
            if (now - data.firstSeen > maxAge) {
                this.ipTracking.delete(ip);
                this.pathPatterns.delete(ip);
            }
        }

        // 清理UA追踪
        for (const [ua, data] of this.uaTracking) {
            if (now - data.firstSeen > maxAge) {
                this.uaTracking.delete(ua);
            }
        }

        // 清理指纹追踪
        for (const [fp, data] of this.fingerprintTracking) {
            if (now - data.firstSeen > maxAge) {
                this.fingerprintTracking.delete(fp);
            }
        }
    }
}

/**
 * 增强的攻击检测引擎
 */
export class EnhancedAttackDetector {
    private inputValidator = new InputValidator();
    private rateLimiter = new MultiDimensionalRateLimiter();
    private cleanupInterval: NodeJS.Timeout | null = null;

    // 恶意Bot特征库（扩展）
    private readonly maliciousBots = new Set([
        'sqlmap', 'nikto', 'nessus', 'masscan', 'zgrab', 'nmap',
        'python-requests', 'libwww-perl', 'curl', 'wget',
        'go-http-client', 'java/', 'httpclient', 'axios',
        'scrapy', 'selenium', 'phantomjs', 'headless',
        'bot', 'crawler', 'spider', 'scraper'
    ]);

    constructor() {
        this.startCleanupTimer();
    }

    /**
     * 主分析函数 - 多层检测
     */
    analyze(event: TrafficEvent): ThreatAlert | null {
        // Layer 1: 速率限制检测（最先执行，阻止DDoS）
        const rateThreat = this.rateLimiter.checkLimit(event);
        if (rateThreat) {
            logger.warn(`Rate limit violation: ${rateThreat.description}`, {
                ip: event.sourceIP,
                ruleId: rateThreat.ruleId
            });
            return rateThreat;
        }

        // Layer 2: Bot检测
        if (event.userAgent) {
            const botThreat = this.detectMaliciousBot(event.userAgent, event.sourceIP);
            if (botThreat) return botThreat;
        }

        // Layer 3: 语义分析（输入验证）
        const contentToCheck = this.buildCheckContent(event);

        // SQL注入检测
        const sqlResult = this.inputValidator.validateSQL(contentToCheck);
        if (!sqlResult.isValid) {
            return this.buildThreatAlert('sql_injection', sqlResult, event.sourceIP);
        }

        // XSS检测
        const xssResult = this.inputValidator.validateXSS(contentToCheck);
        if (!xssResult.isValid) {
            return this.buildThreatAlert('xss', xssResult, event.sourceIP);
        }

        // 路径遍历检测
        if (event.path) {
            const pathResult = this.inputValidator.validatePath(event.path);
            if (!pathResult.isValid) {
                return this.buildThreatAlert('path_traversal', pathResult, event.sourceIP);
            }
        }

        // 查询参数路径遍历检测
        if (event.queryParams) {
            for (const [, value] of Object.entries(event.queryParams)) {
                const strValue = String(value);
                if (strValue.includes('../') || strValue.includes('..\\')) {
                    const pathResult = this.inputValidator.validatePath(strValue);
                    if (!pathResult.isValid) {
                        return this.buildThreatAlert('path_traversal', pathResult, event.sourceIP);
                    }
                }
            }
        }

        // 命令注入检测（排除明显路径类参数值，避免Windows路径误报）
        const isPathValue = (v: string) => /^[a-zA-Z]:[\\\/]/.test(v) || v.includes('../') || v.includes('..\\');
        const cmdCheckContent = [
            event.path || '',
            event.requestBody || '',
            event.userAgent || '',
            event.rawLog || '',
            ...(event.queryParams
                ? Object.entries(event.queryParams)
                    .filter(([, v]) => !isPathValue(String(v)))
                    .map(([k, v]) => `${k}=${v}`)
                : [])
        ].join(' ');
        const cmdResult = this.inputValidator.validateCommand(cmdCheckContent);
        if (!cmdResult.isValid) {
            return this.buildThreatAlert('command_injection', cmdResult, event.sourceIP);
        }

        // Layer 4: 启发式检测
        const heuristicThreat = this.heuristicAnalysis(event);
        if (heuristicThreat) return heuristicThreat;

        return null;
    }

    /**
     * 构建检查内容
     */
    private buildCheckContent(event: TrafficEvent): string {
        const queryString = event.queryParams
            ? Object.entries(event.queryParams).map(([k, v]) => `${k}=${v}`).join('&')
            : '';
        return [
            event.path || '',
            queryString,
            event.requestBody || '',
            event.userAgent || '',
            event.rawLog || ''
        ].join(' ');
    }

    /**
     * 构建威胁告警
     */
    private buildThreatAlert(
        type: string,
        validation: ValidationResult,
        sourceIP: string
    ): ThreatAlert {
        const severityMap: Record<string, ThreatAlert['severity']> = {
            'critical': 'critical',
            'high': 'high',
            'medium': 'medium',
            'low': 'low'
        };

        const blockDurationMap: Record<string, number> = {
            'critical': 7200,
            'high': 3600,
            'medium': 1800,
            'low': 900
        };

        const severity = validation.threatLevel || 'high';

        return {
            type,
            severity: severityMap[severity],
            sourceIP,
            description: validation.reason || 'Threat Detected',
            evidence: validation.sanitized || '',
            ruleId: `SEMANTIC-${type.toUpperCase()}`,
            autoBlock: severity === 'critical' || severity === 'high',
            blockDuration: blockDurationMap[severity],
            timestamp: new Date(),
            confidence: 95
        };
    }

    /**
     * Bot检测（增强）
     */
    private detectMaliciousBot(userAgent: string, sourceIP: string): ThreatAlert | null {
        const ua = userAgent.toLowerCase();

        // 检测恶意Bot特征
        for (const botSignature of this.maliciousBots) {
            if (ua.includes(botSignature)) {
                return {
                    type: 'malicious_bot',
                    severity: 'high',
                    sourceIP,
                    description: `Malicious Bot Detected: ${botSignature}`,
                    evidence: userAgent,
                    ruleId: 'BOT-001',
                    autoBlock: true,
                    blockDuration: 86400,
                    timestamp: new Date(),
                    confidence: 90
                };
            }
        }

        // 检测空UA或可疑UA
        if (!userAgent || userAgent.length < 10) {
            return {
                type: 'suspicious_bot',
                severity: 'medium',
                sourceIP,
                description: 'Suspicious User-Agent',
                evidence: userAgent || '(empty)',
                ruleId: 'BOT-002',
                autoBlock: false,
                timestamp: new Date(),
                confidence: 60
            };
        }

        return null;
    }

    /**
     * 启发式分析
     */
    private heuristicAnalysis(event: TrafficEvent): ThreatAlert | null {
        const content = this.buildCheckContent(event);

        // 检测异常长的输入（可能的缓冲区溢出）
        if (content.length > 10000) {
            return {
                type: 'buffer_overflow',
                severity: 'high',
                sourceIP: event.sourceIP,
                description: 'Abnormally Long Input Detected',
                evidence: `Input length: ${content.length} bytes`,
                ruleId: 'HEURISTIC-001',
                autoBlock: true,
                blockDuration: 3600,
                timestamp: new Date(),
                confidence: 75
            };
        }

        // 检测高熵字符串（可能的加密payload）
        const entropy = this.calculateEntropy(content);
        if (entropy > 4.5 && content.length > 100) {
            return {
                type: 'encrypted_payload',
                severity: 'medium',
                sourceIP: event.sourceIP,
                description: 'High Entropy Payload Detected',
                evidence: `Entropy: ${entropy.toFixed(2)}`,
                ruleId: 'HEURISTIC-002',
                autoBlock: false,
                timestamp: new Date(),
                confidence: 65
            };
        }

        // 检测重复字符（可能的模糊测试）
        const repeatedChars = this.detectRepeatedChars(content);
        if (repeatedChars > 50) {
            return {
                type: 'fuzzing',
                severity: 'medium',
                sourceIP: event.sourceIP,
                description: 'Fuzzing Attack Detected',
                evidence: `${repeatedChars} repeated characters`,
                ruleId: 'HEURISTIC-003',
                autoBlock: true,
                blockDuration: 1800,
                timestamp: new Date(),
                confidence: 70
            };
        }

        return null;
    }

    /**
     * 计算字符串熵
     */
    private calculateEntropy(str: string): number {
        const freq = new Map<string, number>();
        for (const char of str) {
            freq.set(char, (freq.get(char) || 0) + 1);
        }

        let entropy = 0;
        const len = str.length;

        for (const count of freq.values()) {
            const p = count / len;
            entropy -= p * Math.log2(p);
        }

        return entropy;
    }

    /**
     * 检测重复字符
     */
    private detectRepeatedChars(str: string): number {
        let maxRepeats = 0;
        let currentChar = '';
        let currentCount = 0;

        for (const char of str) {
            if (char === currentChar) {
                currentCount++;
                maxRepeats = Math.max(maxRepeats, currentCount);
            } else {
                currentChar = char;
                currentCount = 1;
            }
        }

        return maxRepeats;
    }

    /**
     * 启动清理定时器
     */
    private startCleanupTimer(): void {
        this.cleanupInterval = setInterval(() => {
            this.rateLimiter.cleanup(300000); // 5分钟
        }, 60000); // 每分钟清理一次
    }

    /**
     * 停止检测器
     */
    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}
