/**
 * Attack detector with local rule matching plus shared rule-first review heuristics.
 */

import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import {
  assessDetectionHeuristics,
  buildSeedDetectionRules,
  DetectionAttackFamily,
  DetectionRequest,
  DetectionRuleMatcher,
  DetectionRuleRecord,
  DetectionSeverity,
  DetectionSignal,
  evaluateDetectionRules,
  inferAttackFamily,
  severityToBlockDurationSeconds
} from '../services/detection-engine';
import { TrafficEvent } from './traffic-monitor';

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

export interface AgentReviewSample {
  requestId: string;
  timestamp: string;
  sourceIp: string;
  method?: string;
  path?: string;
  headers: Record<string, string>;
  body?: string;
  userAgent?: string;
  evidence?: string;
  protocol: string;
  rawPayload?: string;
  existingSignals: DetectionSignal[];
  matchedRuleIds: string[];
  riskScore: number;
  attackFamily: DetectionAttackFamily;
  decisionSource: string;
  metadata?: Record<string, any>;
}

function mapAttackFamilyToThreatType(family: DetectionAttackFamily | undefined): string {
  switch (family) {
    case 'sqli':
      return 'sql_injection';
    case 'xss':
      return 'xss';
    case 'path_traversal':
      return 'lfi';
    case 'command_injection':
      return 'command_injection';
    case 'ssrf':
      return 'ssrf';
    case 'automation':
      return 'bad_bot';
    default:
      return 'other';
  }
}

export class AttackDetector {
  private rules: DetectionRule[] = [];
  private remoteRules: DetectionRuleRecord[] = [];
  private ipRequestCount: Map<string, { count: number; firstSeen: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeDefaultRules();
    this.startCleanupTimer();
  }

  private initializeDefaultRules(): void {
    this.rules = [
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
        patterns: [/;\s*(drop|delete|insert|update|create|alter|truncate)/i],
        autoBlock: true,
        blockDuration: 7200
      },
      {
        id: 'XSS-001',
        name: 'XSS - Script Tag',
        type: 'xss',
        severity: 'high',
        patterns: [/<script[^>]*>/i, /<\/script>/i, /javascript:/i],
        autoBlock: true,
        blockDuration: 1800
      },
      {
        id: 'XSS-002',
        name: 'XSS - Event Handler',
        type: 'xss',
        severity: 'medium',
        patterns: [/on(load|error|click|mouseover|submit|focus|blur)\s*=/i, /onerror\s*=/i],
        autoBlock: false
      },
      {
        id: 'XSS-003',
        name: 'XSS - Data URI',
        type: 'xss',
        severity: 'high',
        patterns: [/data:\s*text\/html/i, /data:\s*application\/javascript/i],
        autoBlock: true,
        blockDuration: 1800
      },
      {
        id: 'LFI-001',
        name: 'Path Traversal',
        type: 'lfi',
        severity: 'high',
        patterns: [/\.\.\//, /\.\.%2[fF]/, /%2e%2e%2f/i, /\.\.\\/],
        autoBlock: true,
        blockDuration: 3600
      },
      {
        id: 'LFI-002',
        name: 'Sensitive File Access',
        type: 'lfi',
        severity: 'critical',
        patterns: [/\/etc\/passwd/i, /\/etc\/shadow/i, /\/proc\/self/i, /web\.config/i, /\.env/, /\.git\//],
        autoBlock: true,
        blockDuration: 7200
      },
      {
        id: 'CMD-001',
        name: 'Command Injection',
        type: 'command_injection',
        severity: 'critical',
        patterns: [/;\s*(ls|cat|whoami|id|uname|pwd|wget|curl)/i, /\|\s*(ls|cat|whoami|id|uname|pwd|wget|curl)/i, /`[^`]+`/, /\$\([^)]+\)/],
        autoBlock: true,
        blockDuration: 7200
      },
      {
        id: 'BOT-001',
        name: 'Malicious Bot User-Agent',
        type: 'bad_bot',
        severity: 'medium',
        patterns: [/sqlmap/i, /nikto/i, /nessus/i, /masscan/i, /zgrab/i, /python-requests/i, /libwww-perl/i],
        autoBlock: true,
        blockDuration: 86400
      }
    ];

    logger.info(`Loaded ${this.rules.length} detection rules`);
  }

  analyze(event: TrafficEvent): ThreatAlert | null {
    this.updateIPCounter(event.sourceIP);

    const rateThreat = this.checkRateLimit(event.sourceIP);
    if (rateThreat) {
      return rateThreat;
    }

    const contentToCheck = this.buildContentToCheck(event);
    const commandRules = this.rules.filter((rule) => rule.id.startsWith('CMD-'));
    const commandThreat = this.matchLegacyRules(commandRules, contentToCheck, event);
    if (commandThreat) {
      return commandThreat;
    }

    const remainingRules = this.rules.filter((rule) => !rule.id.startsWith('CMD-'));
    const legacyThreat = this.matchLegacyRules(remainingRules, contentToCheck, event);
    if (legacyThreat) {
      return legacyThreat;
    }

    if (this.remoteRules.length > 0) {
      const request = this.buildDetectionRequest(event);
      const evaluation = evaluateDetectionRules(request, this.remoteRules);
      if (evaluation.highestPriorityRule?.action === 'block') {
        return this.buildThreatFromRemoteRule(request, evaluation.highestPriorityRule);
      }
    }

    return null;
  }

  assessForReview(event: TrafficEvent): AgentReviewSample | null {
    const request = this.buildDetectionRequest(event);
    const ruleEvaluation = evaluateDetectionRules(request, [...buildSeedDetectionRules(), ...this.remoteRules]);
    const heuristicAssessment = assessDetectionHeuristics(request);
    const combinedSignals = [...ruleEvaluation.signals, ...heuristicAssessment.signals];
    const riskScore = Math.max(ruleEvaluation.riskScore, heuristicAssessment.riskScore);

    if (ruleEvaluation.ruleVerdict === 'block') {
      return null;
    }

    if (!ruleEvaluation.shouldEscalate && riskScore < 0.4) {
      return null;
    }

    return {
      requestId: request.requestId,
      timestamp: request.timestamp,
      sourceIp: request.sourceIp || '',
      method: request.method,
      path: request.path,
      headers: request.headers || {},
      body: request.body,
      userAgent: request.userAgent,
      evidence: request.evidence,
      protocol: request.protocol || 'agent',
      rawPayload: request.rawPayload,
      existingSignals: combinedSignals,
      matchedRuleIds: ruleEvaluation.matchedRuleIds,
      riskScore: Number(riskScore.toFixed(4)),
      attackFamily: inferAttackFamily(request, combinedSignals),
      decisionSource: ruleEvaluation.highestPriorityRule
        ? `${ruleEvaluation.highestPriorityRule.source}:${ruleEvaluation.highestPriorityRule.action}`
        : 'heuristic_only',
      metadata: {
        localRuleVerdict: ruleEvaluation.ruleVerdict || 'allow',
        eventPort: event.destPort
      }
    };
  }

  private buildContentToCheck(event: TrafficEvent): string {
    return [event.path || '', event.requestBody || '', event.userAgent || '', event.rawLog || ''].join(' ');
  }

  private buildDetectionRequest(event: TrafficEvent): DetectionRequest {
    const headers: Record<string, string> = {};
    if (event.userAgent) {
      headers['user-agent'] = event.userAgent;
    }

    return {
      tenantId: 'agent-local',
      channel: 'agent',
      requestId: randomUUID(),
      timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date().toISOString(),
      sourceIp: event.sourceIP,
      method: event.method,
      path: event.path || '/',
      headers,
      body: event.requestBody || '',
      userAgent: event.userAgent || '',
      evidence: event.rawLog || '',
      protocol: `tcp/${event.destPort || 0}`,
      rawPayload: this.buildContentToCheck(event),
      metadata: {
        destPort: event.destPort
      }
    };
  }

  private matchLegacyRules(rules: DetectionRule[], contentToCheck: string, event: TrafficEvent): ThreatAlert | null {
    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(contentToCheck)) {
          logger.warn(`Attack detected: ${rule.name}`, {
            ip: event.sourceIP,
            ruleId: rule.id
          });

          return {
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
        }
      }
    }

    return null;
  }

  private buildThreatFromRemoteRule(request: DetectionRequest, rule: DetectionRuleRecord): ThreatAlert {
    return {
      type: mapAttackFamilyToThreatType(rule.attackFamily),
      severity: rule.severity,
      sourceIP: request.sourceIp || 'unknown',
      description: rule.name,
      evidence: this.extractMatcherEvidence(request, rule.matcher),
      ruleId: rule.ruleId,
      autoBlock: rule.action === 'block',
      blockDuration: severityToBlockDurationSeconds(rule.severity),
      timestamp: new Date()
    };
  }

  private extractMatcherEvidence(request: DetectionRequest, matcher: DetectionRuleMatcher): string {
    const content = [
      request.path || '',
      request.body || '',
      request.evidence || '',
      request.userAgent || '',
      request.rawPayload || ''
    ].join(' ');

    const patterns = [
      ...(matcher.pathPatterns || []),
      ...(matcher.bodyPatterns || []),
      ...(matcher.evidencePatterns || []),
      ...(matcher.userAgentPatterns || []),
      ...(matcher.keywordPatterns || [])
    ];

    for (const pattern of patterns) {
      try {
        const evidence = this.extractEvidence(content, new RegExp(pattern, 'i'));
        if (evidence) {
          return evidence;
        }
      } catch {
        continue;
      }
    }

    return content.length > 180 ? `${content.slice(0, 177)}...` : content;
  }

  private updateIPCounter(ip: string): void {
    const now = Date.now();
    const existing = this.ipRequestCount.get(ip);

    if (existing) {
      existing.count += 1;
    } else {
      this.ipRequestCount.set(ip, { count: 1, firstSeen: now });
    }
  }

  private checkRateLimit(ip: string): ThreatAlert | null {
    const data = this.ipRequestCount.get(ip);
    if (!data) {
      return null;
    }

    const elapsed = (Date.now() - data.firstSeen) / 1000;
    const ratePerSecond = data.count / Math.max(elapsed, 1);

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

  private extractEvidence(content: string, pattern: RegExp): string {
    const match = content.match(pattern);
    if (match) {
      const index = content.indexOf(match[0]);
      const start = Math.max(0, index - 20);
      const end = Math.min(content.length, index + match[0].length + 20);
      return `...${content.substring(start, end)}...`;
    }
    return '';
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const expiryTime = 60000;

      for (const [ip, data] of this.ipRequestCount) {
        if (now - data.firstSeen > expiryTime) {
          this.ipRequestCount.delete(ip);
        }
      }
    }, 60000);
  }

  updateRules(newRules: DetectionRule[]): void {
    this.rules = newRules;
    logger.info(`Updated detection rules: ${newRules.length} rules loaded`);
  }

  updateRemoteRules(newRules: DetectionRuleRecord[]): void {
    this.remoteRules = Array.isArray(newRules)
      ? newRules
        .filter((rule) => rule && rule.enabled !== false)
        .filter((rule) => rule.scope === 'all' || rule.scope === 'agent')
      : [];

    logger.info('Updated remote detection rules', {
      ruleCount: this.remoteRules.length
    });
  }

  addRule(rule: DetectionRule): void {
    this.rules.push(rule);
    logger.info(`Added detection rule: ${rule.id}`);
  }

  getRules(): DetectionRule[] {
    return [...this.rules];
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.ipRequestCount.clear();
  }
}
