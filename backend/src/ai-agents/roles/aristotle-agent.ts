/**
 * Aristotle Agent - L2: Role Playing Layer (Analyst)
 * Historical behavior analysis and anomaly detection
 */

import { uuidv4 } from '../../utils/uuid';
import {
    AgentConfig,
    AgentMessage,
    AnalysisResult,
    TrafficContext,
    HistoricalBehavior,
    Evidence
} from '../core/types';
import { ExpertAgent } from '../core/base-agent';
import { MessageBus } from '../core/message-bus';
import logger from '../../utils/logger';

interface BehaviorProfile {
    ip: string;
    requestCount: number;
    errorRate: number;
    avgRequestInterval: number;
    commonPaths: Map<string, number>;
    commonUserAgents: Map<string, number>;
    timeOfDayDistribution: number[];
    lastSeen: Date;
    firstSeen: Date;
}

interface AnomalyIndicators {
    rateAnomaly: boolean;
    patternAnomaly: boolean;
    timeAnomaly: boolean;
    geoAnomaly: boolean;
    behaviorAnomaly: boolean;
}

export class AristotleAgent extends ExpertAgent {
    private behaviorProfiles: Map<string, BehaviorProfile> = new Map();
    private globalStats = {
        totalRequests: 0,
        uniqueIPs: 0,
        avgErrorRate: 0.02,
        peakHours: [9, 10, 11, 14, 15, 16, 17]
    };

    constructor(config: AgentConfig, messageBus: MessageBus) {
        super(config, messageBus, [
            'anomaly_detection',
            'behavior_analysis',
            'statistical_analysis',
            'rate_limiting',
            'authentication'
        ]);
    }

    getSystemPrompt(): string {
        return `You are Aristotle, an analyst security agent. Your role is to analyze patterns and detect anomalies.

Your mission:
1. Analyze historical behavior patterns
2. Detect statistical anomalies in requests
3. Identify deviations from normal behavior
4. Correlate current request with historical data

Key principles:
- "We are what we repeatedly do" - behavior defines intent
- Look for patterns that deviate from the norm
- Consider temporal patterns (time of day, frequency)
- Identify unusual sequences of actions

When analyzing:
- Compare current behavior to historical baseline
- Check for rate anomalies (too fast, too slow)
- Identify unusual access patterns
- Detect geographic or time-based anomalies
- Look for behavioral fingerprints

Provide your analysis in JSON format:
{
    "verdict": "safe|suspicious|malicious|unknown",
    "confidence": 0.0-1.0,
    "reasoning": "detailed explanation",
    "anomalyScore": 0.0-1.0,
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

            const anomalyIndicators = this.detectAnomalies(context);
            const anomalyScore = this.calculateAnomalyScore(anomalyIndicators);

            if (anomalyScore > 0.7 && analysis.verdict === 'safe') {
                analysis.verdict = 'suspicious';
                analysis.confidence = Math.max(analysis.confidence, anomalyScore);
            }

            this.updateBehaviorProfile(context);

            return this.finalizeAnalysisResult({
                agentId: this.identity.id,
                role: 'aristotle',
                verdict: analysis.verdict,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning,
                evidence: analysis.evidence || [],
                anomalyScore,
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
            logger.error('Aristotle analysis failed', { error: error.message });
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

    private detectAnomalies(context: TrafficContext): AnomalyIndicators {
        const { request, history } = context;
        const ip = request.sourceIP;

        return {
            rateAnomaly: this.detectRateAnomaly(ip, history),
            patternAnomaly: this.detectPatternAnomaly(request, history),
            timeAnomaly: this.detectTimeAnomaly(request),
            geoAnomaly: false,
            behaviorAnomaly: this.detectBehaviorAnomaly(request, history)
        };
    }

    private detectRateAnomaly(ip: string, history: HistoricalBehavior[]): boolean {
        const recentHistory = history.filter(h => 
            Date.now() - h.timestamp.getTime() < 60000
        );

        if (recentHistory.length > 100) {
            return true;
        }

        const profile = this.behaviorProfiles.get(ip);
        if (profile && profile.avgRequestInterval > 0) {
            const currentInterval = Date.now() - profile.lastSeen.getTime();
            if (currentInterval < profile.avgRequestInterval * 0.1) {
                return true;
            }
        }

        return false;
    }

    private detectPatternAnomaly(request: TrafficContext['request'], history: HistoricalBehavior[]): boolean {
        const profile = this.behaviorProfiles.get(request.sourceIP);
        if (!profile) return false;

        const path = request.path.split('?')[0];
        const pathCount = profile.commonPaths.get(path) || 0;
        const totalRequests = profile.requestCount;

        if (totalRequests > 10 && pathCount === 0) {
            return true;
        }

        const pathDiversity = profile.commonPaths.size;
        if (totalRequests > 50 && pathDiversity > totalRequests * 0.8) {
            return true;
        }

        return false;
    }

    private detectTimeAnomaly(request: TrafficContext['request']): boolean {
        const hour = new Date().getHours();
        const profile = this.behaviorProfiles.get(request.sourceIP);

        if (profile && profile.timeOfDayDistribution) {
            const usualActivity = profile.timeOfDayDistribution[hour];
            const avgActivity = profile.timeOfDayDistribution.reduce((a, b) => a + b, 0) / 24;

            if (usualActivity === 0 && avgActivity > 0) {
                return true;
            }
        }

        return false;
    }

    private detectBehaviorAnomaly(request: TrafficContext['request'], history: HistoricalBehavior[]): boolean {
        const recentFailures = history.filter(h => 
            h.result === 'failure' || h.result === 'blocked'
        ).length;

        if (recentFailures > 5) {
            return true;
        }

        const profile = this.behaviorProfiles.get(request.sourceIP);
        if (profile && profile.errorRate > this.globalStats.avgErrorRate * 3) {
            return true;
        }

        return false;
    }

    private calculateAnomalyScore(indicators: AnomalyIndicators): number {
        const weights = {
            rateAnomaly: 0.25,
            patternAnomaly: 0.20,
            timeAnomaly: 0.15,
            geoAnomaly: 0.20,
            behaviorAnomaly: 0.20
        };

        let score = 0;
        for (const [key, value] of Object.entries(indicators)) {
            if (value) {
                score += weights[key as keyof AnomalyIndicators];
            }
        }

        return Math.min(score, 1.0);
    }

    private updateBehaviorProfile(context: TrafficContext): void {
        const { request, history } = context;
        const ip = request.sourceIP;
        let profile = this.behaviorProfiles.get(ip);

        if (!profile) {
            profile = {
                ip,
                requestCount: 0,
                errorRate: 0,
                avgRequestInterval: 0,
                commonPaths: new Map(),
                commonUserAgents: new Map(),
                timeOfDayDistribution: new Array(24).fill(0),
                lastSeen: new Date(),
                firstSeen: new Date()
            };
            this.behaviorProfiles.set(ip, profile);
            this.globalStats.uniqueIPs++;
        }

        profile.requestCount++;
        profile.lastSeen = new Date();

        const path = request.path.split('?')[0];
        profile.commonPaths.set(path, (profile.commonPaths.get(path) || 0) + 1);

        if (request.userAgent) {
            profile.commonUserAgents.set(
                request.userAgent, 
                (profile.commonUserAgents.get(request.userAgent) || 0) + 1
            );
        }

        const hour = new Date().getHours();
        profile.timeOfDayDistribution[hour]++;

        const failures = history.filter(h => h.result === 'failure' || h.result === 'blocked').length;
        profile.errorRate = history.length > 0 ? failures / history.length : 0;

        this.globalStats.totalRequests++;
    }

    private fallbackAnalysis(context: TrafficContext): AnalysisResult {
        const startedAt = Date.now();
        const { request, history } = context;
        const evidence: Evidence[] = [];
        let verdict: AnalysisResult['verdict'] = 'safe';
        let confidence = 0.6;
        let anomalyScore = 0;
        const content = [
            request.path,
            request.body || '',
            JSON.stringify(request.queryParams || {}),
            JSON.stringify(request.headers || {})
        ].join(' ');
        const signals = this.inspectContentHeuristics(content);

        const anomalyIndicators = this.detectAnomalies(context);
        anomalyScore = this.calculateAnomalyScore(anomalyIndicators);

        if (anomalyIndicators.rateAnomaly) {
            evidence.push({
                type: 'behavior',
                description: 'Rate anomaly detected - unusual request frequency',
                severity: 'high',
                data: { indicator: 'rate' },
                source: 'Aristotle'
            });
        }

        if (anomalyIndicators.patternAnomaly) {
            evidence.push({
                type: 'behavior',
                description: 'Pattern anomaly detected - unusual access pattern',
                severity: 'medium',
                data: { indicator: 'pattern' },
                source: 'Aristotle'
            });
        }

        if (anomalyIndicators.timeAnomaly) {
            evidence.push({
                type: 'statistical',
                description: 'Time anomaly detected - access at unusual hour',
                severity: 'low',
                data: { indicator: 'time' },
                source: 'Aristotle'
            });
        }

        if (anomalyIndicators.behaviorAnomaly) {
            evidence.push({
                type: 'behavior',
                description: 'Behavior anomaly detected - unusual error rate',
                severity: 'high',
                data: { indicator: 'behavior' },
                source: 'Aristotle'
            });
        }

        if (signals.hardSignals.length >= 2 || anomalyScore > 0.7) {
            verdict = 'malicious';
            confidence = 0.85;
        } else if (signals.hardSignals.length === 1 || signals.softSignals.length > 0 || anomalyScore > 0.2) {
            verdict = 'suspicious';
            confidence = Math.max(0.68, anomalyScore > 0.4 ? 0.75 : 0.68);
        }

        const historyInsight = history.length > 0
            ? `Based on ${history.length} historical events`
            : 'No historical data available';

        return this.finalizeAnalysisResult({
            agentId: this.identity.id,
            role: 'aristotle',
            verdict,
            confidence,
            reasoning: evidence.length > 0
                ? `${historyInsight}. Detected ${evidence.length} anomaly indicator(s): ${evidence.map(e => e.description).join('; ')}`
                : signals.softSignals.length > 0 || signals.hardSignals.length > 0
                    ? `${historyInsight}. Request includes heuristic risk indicators: ${[...signals.hardSignals, ...signals.softSignals].map(signal => signal.label).join(', ')}.`
                    : `${historyInsight}. No significant anomalies detected.`,
            evidence,
            anomalyScore,
            classScores:
                verdict === 'malicious'
                    ? { safe: 0.08, suspicious: 0.17, malicious: 0.75 }
                    : verdict === 'suspicious'
                        ? { safe: 0.22, suspicious: 0.56, malicious: 0.22 }
                        : { safe: 0.74, suspicious: 0.18, malicious: 0.08 },
            attackFamily: signals.attackFamily,
            modelTier: 'cloud',
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
        logger.info(`Aristotle received debate invitation for: ${message.payload.topic}`);
    }

    protected async handleDebateArgument(message: AgentMessage): Promise<void> {
        logger.debug(`Aristotle received debate argument`);
    }

    protected async handleToolResult(message: AgentMessage): Promise<void> {
        logger.debug(`Aristotle received tool result`);
    }

    getBehaviorProfile(ip: string): BehaviorProfile | undefined {
        return this.behaviorProfiles.get(ip);
    }

    getGlobalStats(): typeof this.globalStats {
        return { ...this.globalStats };
    }

    cleanupStaleProfiles(maxAge: number = 86400000): void {
        const now = Date.now();
        for (const [ip, profile] of this.behaviorProfiles) {
            if (now - profile.lastSeen.getTime() > maxAge) {
                this.behaviorProfiles.delete(ip);
            }
        }
    }
}
