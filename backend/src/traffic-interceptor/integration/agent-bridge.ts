/**
 * Agent Bridge - Integration with Multi-Agent Decision System
 */

import { v4 as uuidv4 } from 'uuid';
import {
    Verdict,
    InterceptionResult,
    PacketForAnalysis,
    AnalysisResult,
    ThreatEvent,
    ParsedPacket
} from '../core/types';
import { Packet } from '../core/packet';
import { ProtocolParser, ThreatIndicator } from '../processing/protocol-parser';
import { FlowManager } from '../core/flow';
import { MultiAgentDecisionSystem } from '../../ai-agents';
import logger from '../../utils/logger';

export interface AgentBridgeConfig {
    enabled: boolean;
    batchSize: number;
    timeout: number;
    fallbackVerdict: Verdict;
    cacheResults: boolean;
    cacheTTL: number;
}

const DEFAULT_CONFIG: AgentBridgeConfig = {
    enabled: true,
    batchSize: 10,
    timeout: 5000,
    fallbackVerdict: 'allow',
    cacheResults: true,
    cacheTTL: 60000
};

export class AgentBridge {
    private config: AgentBridgeConfig;
    private agentSystem: MultiAgentDecisionSystem | null = null;
    private protocolParser: ProtocolParser;
    private flowManager: FlowManager;
    private verdictCache: Map<string, { verdict: Verdict; timestamp: number }>;
    private pendingAnalyses: Map<string, Promise<AnalysisResult>>;
    private stats = {
        totalAnalyzed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        timeouts: 0,
        errors: 0,
        avgLatency: 0
    };

    constructor(
        flowManager: FlowManager,
        config: Partial<AgentBridgeConfig> = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.protocolParser = new ProtocolParser();
        this.flowManager = flowManager;
        this.verdictCache = new Map();
        this.pendingAnalyses = new Map();
    }

    async initialize(): Promise<void> {
        if (!this.config.enabled) {
            logger.info('Agent bridge disabled');
            return;
        }

        try {
            this.agentSystem = new MultiAgentDecisionSystem();
            await this.agentSystem.initialize();
            logger.info('Agent bridge initialized successfully');
        } catch (error: any) {
            logger.error('Failed to initialize agent bridge', { error: error.message });
            this.agentSystem = null;
        }
    }

    async analyzePacket(packet: Packet): Promise<InterceptionResult> {
        const startTime = Date.now();
        const packetId = packet.id;

        try {
            const parsed = packet.parsed;
            
            const fastPathVerdict = this.fastPathAnalysis(parsed);
            if (fastPathVerdict) {
                return {
                    packetId,
                    verdict: fastPathVerdict.verdict,
                    processingTime: Date.now() - startTime,
                    matchedRule: fastPathVerdict.rule
                };
            }

            const cacheKey = this.generateCacheKey(parsed);
            if (this.config.cacheResults) {
                const cached = this.verdictCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
                    this.stats.cacheHits++;
                    return {
                        packetId,
                        verdict: cached.verdict,
                        processingTime: Date.now() - startTime,
                        matchedRule: 'cache'
                    };
                }
                this.stats.cacheMisses++;
            }

            const analysisResult = await this.performDeepAnalysis(parsed);

            const verdict = this.mapAnalysisVerdict(analysisResult);

            if (this.config.cacheResults) {
                this.verdictCache.set(cacheKey, { verdict, timestamp: Date.now() });
            }

            this.updateStats(Date.now() - startTime);

            return {
                packetId,
                verdict,
                processingTime: Date.now() - startTime,
                matchedRule: analysisResult.threatType,
                inspectionData: {
                    confidence: analysisResult.confidence,
                    threatLevel: analysisResult.threatLevel,
                    reasoning: analysisResult.reasoning
                }
            };

        } catch (error: any) {
            this.stats.errors++;
            logger.error('Packet analysis failed', { 
                packetId, 
                error: error.message 
            });

            return {
                packetId,
                verdict: this.config.fallbackVerdict,
                processingTime: Date.now() - startTime
            };
        }
    }

    private fastPathAnalysis(parsed: ParsedPacket): { verdict: Verdict; rule: string } | null {
        if (!parsed.ipHeader) return null;

        const payload = parsed.payload;
        if (payload.length === 0) return null;

        const protocolResult = this.protocolParser.detectProtocol(payload);
        
        if (protocolResult.protocol === 'http') {
            const httpResult = this.protocolParser.parseHTTP(payload);
            
            if (httpResult.threats.length > 0) {
                const criticalThreat = httpResult.threats.find(t => t.severity === 'critical');
                if (criticalThreat) {
                    return {
                        verdict: 'block',
                        rule: `fast_path:${criticalThreat.type}`
                    };
                }
            }
        }

        const payloadStr = payload.toString('utf-8');
        const genericThreats = this.detectGenericThreats(payloadStr);
        
        if (genericThreats.some(t => t.severity === 'critical')) {
            return {
                verdict: 'block',
                rule: 'fast_path:critical_threat'
            };
        }

        return null;
    }

    private detectGenericThreats(content: string): ThreatIndicator[] {
        const threats: ThreatIndicator[] = [];

        const criticalPatterns = [
            { pattern: /'\s*or\s+'1'\s*=\s*'1/gi, type: 'sql_injection' },
            { pattern: /;\s*drop\s+table/gi, type: 'sql_injection' },
            { pattern: /<script[\s\S]*?>[\s\S]*?<\/script>/gi, type: 'xss' },
            { pattern: /\.\.\/\.\.\/\.\.\/etc\/passwd/gi, type: 'path_traversal' }
        ];

        for (const { pattern, type } of criticalPatterns) {
            if (pattern.test(content)) {
                threats.push({
                    type,
                    severity: 'critical',
                    description: `Critical threat detected: ${type}`,
                    location: { start: 0, end: content.length }
                });
            }
        }

        return threats;
    }

    private async performDeepAnalysis(parsed: ParsedPacket): Promise<AnalysisResult> {
        if (!this.agentSystem) {
            return this.fallbackAnalysis(parsed);
        }

        const flow = this.flowManager.getOrCreateFlow(parsed);

        const analysisRequest: PacketForAnalysis = {
            id: parsed.id,
            timestamp: new Date(),
            sourceIP: parsed.ipHeader?.sourceIP || '',
            destIP: parsed.ipHeader?.destIP || '',
            sourcePort: (parsed.transportHeader as any)?.sourcePort || 0,
            destPort: (parsed.transportHeader as any)?.destPort || 0,
            protocol: parsed.protocol,
            payload: parsed.payload.toString('base64'),
            raw: parsed.raw.toString('base64'),
            flowId: flow?.id || '',
            direction: parsed.metadata.direction
        };

        try {
            const decision = await Promise.race([
                this.agentSystem.analyze({
                    id: analysisRequest.id,
                    timestamp: analysisRequest.timestamp,
                    sourceIP: analysisRequest.sourceIP,
                    method: parsed.protocol.toUpperCase(),
                    path: this.extractPath(parsed),
                    headers: {},
                    body: parsed.payload.toString('utf-8'),
                    queryParams: {},
                    traceContext: undefined
                }),
                this.createTimeoutPromise()
            ]);

            return {
                packetId: parsed.id,
                verdict: decision.verdict === 'allow' ? 'allow' :
                         decision.verdict === 'block' ? 'block' : 'monitor',
                confidence: decision.confidence,
                threatType: decision.threatLevel !== 'none' ? decision.threatLevel : undefined,
                threatLevel: decision.threatLevel !== 'none' ? decision.threatLevel : undefined,
                reasoning: decision.reasoning,
                actions: (decision.actions || []).map(a => a.action)
            };

        } catch (error: any) {
            this.stats.timeouts++;
            logger.warn('Deep analysis timeout or error', { error: error.message });
            return this.fallbackAnalysis(parsed);
        }
    }

    private extractPath(parsed: ParsedPacket): string {
        const appLayer = parsed.applicationLayer;
        if (appLayer?.parsed && 'path' in appLayer.parsed) {
            return appLayer.parsed.path;
        }
        return `/${parsed.protocol}/${(parsed.transportHeader as any)?.destPort || 0}`;
    }

    private createTimeoutPromise<T = AnalysisResult>(): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Analysis timeout')), this.config.timeout);
        });
    }

    private fallbackAnalysis(parsed: ParsedPacket): AnalysisResult {
        const protocolResult = this.protocolParser.parse(parsed.payload);
        
        let verdict: 'allow' | 'block' | 'monitor' = 'allow';
        let confidence = 0.5;
        let threatType: string | undefined;
        let threatLevel: 'low' | 'medium' | 'high' | 'critical' | undefined;

        if (protocolResult.threats.length > 0) {
            const maxSeverity = Math.max(
                ...protocolResult.threats.map(t => 
                    ({ low: 1, medium: 2, high: 3, critical: 4 })[t.severity]
                )
            );

            if (maxSeverity >= 4) {
                verdict = 'block';
                confidence = 0.9;
                threatLevel = 'critical';
            } else if (maxSeverity >= 3) {
                verdict = 'block';
                confidence = 0.8;
                threatLevel = 'high';
            } else {
                verdict = 'monitor';
                confidence = 0.6;
                threatLevel = 'medium';
            }

            threatType = protocolResult.threats[0].type;
        }

        return {
            packetId: parsed.id,
            verdict,
            confidence,
            threatType,
            threatLevel,
            reasoning: protocolResult.threats.length > 0
                ? `Detected ${protocolResult.threats.length} threat indicator(s)`
                : 'No threats detected in fallback analysis'
        };
    }

    private generateCacheKey(parsed: ParsedPacket): string {
        const parts = [
            parsed.ipHeader?.sourceIP || '',
            parsed.ipHeader?.destIP || '',
            (parsed.transportHeader as any)?.sourcePort || 0,
            (parsed.transportHeader as any)?.destPort || 0,
            parsed.protocol
        ];
        return parts.join(':');
    }

    private mapAnalysisVerdict(result: AnalysisResult): Verdict {
        switch (result.verdict) {
            case 'allow': return 'allow';
            case 'block': return 'block';
            default: return 'inspect';
        }
    }

    private updateStats(latency: number): void {
        this.stats.totalAnalyzed++;
        const total = this.stats.totalAnalyzed;
        this.stats.avgLatency = (this.stats.avgLatency * (total - 1) + latency) / total;
    }

    async analyzeBatch(packets: Packet[]): Promise<InterceptionResult[]> {
        const results: InterceptionResult[] = [];

        for (const packet of packets) {
            const result = await this.analyzePacket(packet);
            results.push(result);
        }

        return results;
    }

    getStats(): typeof this.stats & { cacheSize: number; pendingCount: number } {
        return {
            ...this.stats,
            cacheSize: this.verdictCache.size,
            pendingCount: this.pendingAnalyses.size
        };
    }

    clearCache(): void {
        this.verdictCache.clear();
    }

    async shutdown(): Promise<void> {
        if (this.agentSystem) {
            await this.agentSystem.shutdown();
        }
        this.verdictCache.clear();
        this.pendingAnalyses.clear();
        logger.info('Agent bridge shutdown complete');
    }
}

export default AgentBridge;
