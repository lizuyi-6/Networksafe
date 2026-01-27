/**
 * 攻击检测引擎
 * 
 * 实时分析流量，检测各类攻击模式：
 * - SQL 注入
 * - XSS 攻击
 * - 目录遍历
 * - 命令注入
 * - 暴力破解
 * - DDoS 模式
 */

import logger from '../utils/logger';
import { TrafficEvent } from './traffic-monitor';

export interface ThreatAlert {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    sourceIP: string;
    description: string;
    evidence: string;
    ruleId: string;
    autoBlock: boolean;
    blockDuration?: number; // 秒
    timestamp: Date;
}

interface DetectionRule {
    id: string;
    name: string;
    type: string;
    severity: ThreatAlert['severity'];
    patterns: RegExp[];
    autoBlock: boolean;
    blockDuration?: number;
}

export class AttackDetector {
    private rules: DetectionRule[] = [];

    // IP 请求计数器 (用于检测暴力破解和 DDoS)
    private ipRequestCount: Map<string, { count: number; firstSeen: number }> = new Map();

    // 清理计数器的间隔
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.initializeDefaultRules();
        this.startCleanupTimer();
    }

    /**
     * 初始化默认检测规则
     */
    private initializeDefaultRules(): void {
        this.rules = [
            // SQL 注入检测
            {
                id: 'SQL-001',
                name: 'SQL Injection - UNION SELECT',
                type: 'sql_injection',
                severity: 'critical',
                patterns: [
                    /(\s|%20)union(\s|%20)+select/i,
                    /(\s|%20)union(\s|%20)+all(\s|%20)+select/i
                ],
                autoBlock: true,
                blockDuration: 3600
            },
            {
                id: 'SQL-002',
                name: 'SQL Injection - Comment Bypass',
                type: 'sql_injection',
                severity: 'high',
                patterns: [
                    /'\s*or\s*'1'\s*=\s*'1/i,
                    /'\s*or\s*1\s*=\s*1/i,
                    /'\s*--/,
                    /'\s*#/
                ],
                autoBlock: true,
                blockDuration: 3600
            },
            {
                id: 'SQL-003',
                name: 'SQL Injection - Stacked Queries',
                type: 'sql_injection',
                severity: 'critical',
                patterns: [
                    /;\s*(drop|delete|insert|update|create|alter|truncate)/i
                ],
                autoBlock: true,
                blockDuration: 7200
            },

            // XSS 检测
            {
                id: 'XSS-001',
                name: 'XSS - Script Tag',
                type: 'xss',
                severity: 'high',
                patterns: [
                    /<script[^>]*>/i,
                    /<\/script>/i,
                    /javascript:/i
                ],
                autoBlock: true,
                blockDuration: 1800
            },
            {
                id: 'XSS-002',
                name: 'XSS - Event Handler',
                type: 'xss',
                severity: 'medium',
                patterns: [
                    /on(load|error|click|mouseover|submit|focus|blur)\s*=/i,
                    /onerror\s*=/i
                ],
                autoBlock: false
            },
            {
                id: 'XSS-003',
                name: 'XSS - Data URI',
                type: 'xss',
                severity: 'high',
                patterns: [
                    /data:\s*text\/html/i,
                    /data:\s*application\/javascript/i
                ],
                autoBlock: true,
                blockDuration: 1800
            },

            // 目录遍历检测
            {
                id: 'LFI-001',
                name: 'Path Traversal',
                type: 'lfi',
                severity: 'high',
                patterns: [
                    /\.\.\//,
                    /\.\.%2[fF]/,
                    /%2e%2e%2f/i,
                    /\.\.\\/,
                ],
                autoBlock: true,
                blockDuration: 3600
            },
            {
                id: 'LFI-002',
                name: 'Sensitive File Access',
                type: 'lfi',
                severity: 'critical',
                patterns: [
                    /\/etc\/passwd/i,
                    /\/etc\/shadow/i,
                    /\/proc\/self/i,
                    /web\.config/i,
                    /\.env/,
                    /\.git\//
                ],
                autoBlock: true,
                blockDuration: 7200
            },

            // 命令注入检测
            {
                id: 'CMD-001',
                name: 'Command Injection',
                type: 'command_injection',
                severity: 'critical',
                patterns: [
                    /;\s*(ls|cat|whoami|id|uname|pwd|wget|curl)/i,
                    /\|\s*(ls|cat|whoami|id|uname|pwd|wget|curl)/i,
                    /`[^`]+`/,
                    /\$\([^)]+\)/
                ],
                autoBlock: true,
                blockDuration: 7200
            },

            // 恶意 Bot 检测
            {
                id: 'BOT-001',
                name: 'Malicious Bot User-Agent',
                type: 'bad_bot',
                severity: 'medium',
                patterns: [
                    /sqlmap/i,
                    /nikto/i,
                    /nessus/i,
                    /masscan/i,
                    /zgrab/i,
                    /python-requests/i,
                    /libwww-perl/i
                ],
                autoBlock: true,
                blockDuration: 86400
            }
        ];

        logger.info(`Loaded ${this.rules.length} detection rules`);
    }

    /**
     * 分析流量事件
     */
    analyze(event: TrafficEvent): ThreatAlert | null {
        // 更新 IP 请求计数
        this.updateIPCounter(event.sourceIP);

        // 检查是否为 DDoS/暴力破解
        const rateThreat = this.checkRateLimit(event.sourceIP);
        if (rateThreat) {
            return rateThreat;
        }

        // 构建待检测的内容
        const contentToCheck = [
            event.path || '',
            event.requestBody || '',
            event.userAgent || '',
            event.rawLog || ''
        ].join(' ');

        // 遍历规则进行检测
        for (const rule of this.rules) {
            for (const pattern of rule.patterns) {
                if (pattern.test(contentToCheck)) {
                    const threat: ThreatAlert = {
                        type: rule.type,
                        severity: rule.severity,
                        sourceIP: event.sourceIP,
                        description: rule.name,
                        evidence: this.extractEvidence(contentToCheck, pattern),
                        ruleId: rule.id,
                        autoBlock: rule.autoBlock,
                        blockDuration: rule.blockDuration,
                        timestamp: new Date()
                    };

                    logger.warn(`Attack detected: ${rule.name}`, {
                        ip: event.sourceIP,
                        ruleId: rule.id
                    });

                    return threat;
                }
            }
        }

        return null;
    }

    /**
     * 更新 IP 请求计数器
     */
    private updateIPCounter(ip: string): void {
        const now = Date.now();
        const existing = this.ipRequestCount.get(ip);

        if (existing) {
            existing.count++;
        } else {
            this.ipRequestCount.set(ip, { count: 1, firstSeen: now });
        }
    }

    /**
     * 检查请求速率限制
     */
    private checkRateLimit(ip: string): ThreatAlert | null {
        const data = this.ipRequestCount.get(ip);
        if (!data) return null;

        const elapsed = (Date.now() - data.firstSeen) / 1000; // 秒
        const ratePerSecond = data.count / Math.max(elapsed, 1);

        // 超过 100 请求/秒 视为 DDoS
        if (ratePerSecond > 100) {
            return {
                type: 'ddos',
                severity: 'critical',
                sourceIP: ip,
                description: 'DDoS Attack Detected - High Request Rate',
                evidence: `${data.count} requests in ${elapsed.toFixed(1)}s (${ratePerSecond.toFixed(1)}/s)`,
                ruleId: 'DDOS-001',
                autoBlock: true,
                blockDuration: 3600,
                timestamp: new Date()
            };
        }

        // 超过 30 请求/秒 视为暴力破解
        if (ratePerSecond > 30) {
            return {
                type: 'brute_force',
                severity: 'high',
                sourceIP: ip,
                description: 'Possible Brute Force Attack',
                evidence: `${data.count} requests in ${elapsed.toFixed(1)}s (${ratePerSecond.toFixed(1)}/s)`,
                ruleId: 'BF-001',
                autoBlock: true,
                blockDuration: 1800,
                timestamp: new Date()
            };
        }

        return null;
    }

    /**
     * 提取攻击证据
     */
    private extractEvidence(content: string, pattern: RegExp): string {
        const match = content.match(pattern);
        if (match) {
            // 返回匹配内容前后各 20 个字符
            const index = content.indexOf(match[0]);
            const start = Math.max(0, index - 20);
            const end = Math.min(content.length, index + match[0].length + 20);
            return `...${content.substring(start, end)}...`;
        }
        return '';
    }

    /**
     * 启动清理计时器
     */
    private startCleanupTimer(): void {
        // 每分钟清理过期的计数器
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const expiryTime = 60000; // 1 分钟

            for (const [ip, data] of this.ipRequestCount) {
                if (now - data.firstSeen > expiryTime) {
                    this.ipRequestCount.delete(ip);
                }
            }
        }, 60000);
    }

    /**
     * 更新检测规则
     */
    updateRules(newRules: DetectionRule[]): void {
        this.rules = newRules;
        logger.info(`Updated detection rules: ${newRules.length} rules loaded`);
    }

    /**
     * 添加自定义规则
     */
    addRule(rule: DetectionRule): void {
        this.rules.push(rule);
        logger.info(`Added detection rule: ${rule.id}`);
    }

    /**
     * 获取所有规则
     */
    getRules(): DetectionRule[] {
        return [...this.rules];
    }

    /**
     * 停止检测器
     */
    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.ipRequestCount.clear();
    }
}
