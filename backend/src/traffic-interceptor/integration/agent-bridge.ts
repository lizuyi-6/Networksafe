/**
 * Agent Bridge - Integration with the rule-first detection pipeline
 */

import {
    Verdict,
    InterceptionResult,
    AnalysisResult,
    ThreatEvent,
    ParsedPacket
} from '../core/types';
import { Packet } from '../core/packet';
import { ProtocolParser } from '../processing/protocol-parser';
import { FlowManager } from '../core/flow';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
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
    private protocolParser: ProtocolParser;
    private flowManager: FlowManager;
    private verdictCache: Map<string, { verdict: Verdict; timestamp: number }>;
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
    }

    async initialize(): Promise<void> {
        if (!this.config.enabled) {
            logger.info('Agent bridge disabled');
            return;
        }

        logger.info('Agent bridge initialized successfully');
    }

    async analyzePacket(packet: Packet): Promise<InterceptionResult> {
        const startTime = Date.now();
        const packetId = packet.id;

        try {
            const parsed = packet.parsed;

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

            const analysisResult = await this.performDetectionPipelineAnalysis(parsed);

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

    private async performDetectionPipelineAnalysis(parsed: ParsedPacket): Promise<AnalysisResult> {
        try {
            const protocolResult = this.protocolParser.parse(parsed.payload);
            const existingSignals = protocolResult.threats.map((threat) => ({
                source: 'existing_signal' as const,
                key: `protocol:${threat.type}`,
                score: threat.severity === 'critical' ? 1 : threat.severity === 'high' ? 0.8 : 0.55,
                severity: threat.severity,
                description: threat.description
            }));

            const decision = await Promise.race([
                detectionPipelineService.evaluateRequest({
                    tenantId: 'global',
                    channel: 'packet',
                    requestId: parsed.id,
                    timestamp: new Date().toISOString(),
                    sourceIp: parsed.ipHeader?.sourceIP || '',
                    method: parsed.protocol.toUpperCase(),
                    path: this.extractPath(parsed),
                    headers: {},
                    body: parsed.payload.toString('utf-8'),
                    evidence: protocolResult.threats.map((threat) => threat.description).join('\n'),
                    protocol: parsed.protocol,
                    rawPayload: parsed.raw.toString('utf-8'),
                    existingSignals,
                    metadata: {
                        destIP: parsed.ipHeader?.destIP || '',
                        sourcePort: (parsed.transportHeader as any)?.sourcePort || 0,
                        destPort: (parsed.transportHeader as any)?.destPort || 0,
                        direction: parsed.metadata.direction,
                        flowId: this.flowManager.getOrCreateFlow(parsed)?.id || ''
                    }
                }),
                this.createTimeoutPromise<any>()
            ]);

            return {
                packetId: parsed.id,
                verdict: decision.verdict === 'allow' ? 'allow' :
                         decision.verdict === 'block' ? 'block' : 'monitor',
                confidence: decision.aiConfidence ?? decision.riskScore,
                threatType: decision.attackFamily !== 'benign' ? decision.attackFamily : undefined,
                threatLevel: decision.verdict === 'block'
                    ? 'high'
                    : decision.verdict === 'monitor'
                        ? 'medium'
                        : undefined,
                reasoning: decision.decisionSource
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
            pendingCount: 0
        };
    }

    clearCache(): void {
        this.verdictCache.clear();
    }

    async shutdown(): Promise<void> {
        this.verdictCache.clear();
        logger.info('Agent bridge shutdown complete');
    }
}

export default AgentBridge;
