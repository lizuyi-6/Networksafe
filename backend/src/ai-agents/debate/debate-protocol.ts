/**
 * Debate Protocol - L5: Debate Protocol Layer
 * Core innovation: Multi-agent debate with arbitrator resolution
 */

import { uuidv4 } from '../../utils/uuid';
import {
    DebateSession,
    DebateRound,
    DebateVerdict,
    VotingRecord,
    AgentRole,
    AnalysisResult,
    TrafficRequest,
    Evidence,
    DebateTriggerMetrics,
    ThinkingDepth,
    THINKING_DEPTH_PARAMS
} from '../core/types';
import { MessageBus } from '../core/message-bus';
import {
    averagePairwiseDivergence,
    blendDistributions,
    confidenceFromDistribution,
    dominantVerdict,
    normalizeDistribution
} from '../core/scoring';
import logger from '../../utils/logger';

export interface DebateConfig {
    maxRounds: number;
    roundTimeout: number;
    consensusThreshold: number;
    arbitratorModel: string;
    /** Thinking depth for debate reasoning; drives model temperature / token budget. */
    thinkingDepth?: ThinkingDepth;
}

const DEFAULT_DEBATE_CONFIG: DebateConfig = {
    maxRounds: 3,
    roundTimeout: 30000,
    consensusThreshold: 0.7,
    arbitratorModel: 'cloud',
    thinkingDepth: 'deep'
};

export class DebateProtocol {
    private sessions: Map<string, DebateSession> = new Map();
    private messageBus: MessageBus;
    private config: DebateConfig;

    constructor(messageBus: MessageBus, config: Partial<DebateConfig> = {}) {
        this.messageBus = messageBus;
        this.config = { ...DEFAULT_DEBATE_CONFIG, ...config };
    }

    async initiateDebate(
        requestId: string,
        results: AnalysisResult[],
        request: TrafficRequest,
        triggerMetrics?: DebateTriggerMetrics
    ): Promise<DebateSession> {
        const sessionId = uuidv4();
        const startedAt = Date.now();
        
        const session: DebateSession = {
            id: sessionId,
            requestId,
            topic: this.generateDebateTopic(results, request),
            participants: ['socrates', 'plato', 'aristotle', 'arbitrator'],
            rounds: [],
            status: 'active',
            startTime: new Date(),
            triggerMetrics
        };

        this.sessions.set(sessionId, session);

        try {
            await this.runDebateRounds(session, results, request);
            session.finalVerdict = await this.arbitrate(session, results);
            session.status = 'resolved';
            session.endTime = new Date();
            session.consensusReached = this.checkConsensus(session, results);
            session.aggregateDistribution = session.finalVerdict.aggregatedDistribution;
            session.latencyMs = Date.now() - startedAt;
        } catch (error: any) {
            session.status = 'failed';
            logger.error(`Debate ${sessionId} failed`, { error: error.message });
        }

        return session;
    }

    private generateDebateTopic(results: AnalysisResult[], request: TrafficRequest): string {
        const conflictingViews = results.filter((result) => dominantVerdict(result.classScores) !== dominantVerdict(results[0]?.classScores || result.classScores));
        
        if (conflictingViews.length > 0) {
            return `Conflict resolution: Agents disagree on request to ${request.path}`;
        }

        const lowConfidence = results.filter(r => r.confidence < 0.7);
        if (lowConfidence.length > 0) {
            return `Confidence review: Low confidence analysis for ${request.path}`;
        }

        return `Standard review: Analysis of request to ${request.path}`;
    }

    private async runDebateRounds(
        session: DebateSession,
        results: AnalysisResult[],
        request: TrafficRequest
    ): Promise<void> {
        for (let roundNum = 1; roundNum <= this.config.maxRounds; roundNum++) {
            logger.debug(`Debate ${session.id}: Starting round ${roundNum}`);

            const round = await this.executeRound(session, roundNum, results, request);
            session.rounds.push(round);

            if (this.checkConsensus(session, results)) {
                logger.info(`Debate ${session.id}: Consensus reached at round ${roundNum}`);
                break;
            }
        }
    }

    private async executeRound(
        session: DebateSession,
        roundNum: number,
        results: AnalysisResult[],
        request: TrafficRequest
    ): Promise<DebateRound> {
        const speaker = this.determineSpeaker(roundNum);
        const position = this.determinePosition(speaker);
        
        const argument = await this.generateArgument(speaker, position, results, request, session.rounds);
        
        return {
            roundNumber: roundNum,
            speaker,
            position,
            argument: argument.content,
            evidence: argument.evidence,
            timestamp: new Date()
        };
    }

    private determineSpeaker(roundNum: number): AgentRole {
        const order: AgentRole[] = ['socrates', 'plato', 'aristotle'];
        return order[(roundNum - 1) % order.length];
    }

    private determinePosition(speaker: AgentRole): 'attack' | 'defend' | 'analyze' {
        switch (speaker) {
            case 'socrates': return 'attack';
            case 'plato': return 'defend';
            case 'aristotle': return 'analyze';
            default: return 'analyze';
        }
    }

    private async generateArgument(
        speaker: AgentRole,
        position: 'attack' | 'defend' | 'analyze',
        results: AnalysisResult[],
        request: TrafficRequest,
        previousRounds: DebateRound[]
    ): Promise<{ content: string; evidence: Evidence[] }> {
        const speakerResult = results.find(r => r.role === speaker);
        const otherResults = results.filter(r => r.role !== speaker);

        const basePrompt = this.buildArgumentPrompt(speaker, position, speakerResult, otherResults, request);
        const fullPrompt = previousRounds.length > 0
            ? `${basePrompt}\n\n--- PREVIOUS ARGUMENTS IN THIS DEBATE ---\n` +
              previousRounds.map((round) => `${round.speaker} (${round.position}): ${round.argument}`).join('\n') +
              `\n\nRespond to the other agents: defend your position with new evidence, or concede if their argument is stronger. Keep it to 2-4 sentences.`
            : `${basePrompt}\n\nProvide your concise opening argument (2-4 sentences).`;

        const evidence: Evidence[] = [];
        this.collectSpeakerEvidence(speaker, speakerResult, evidence);

        // REAL DEBATE: each round actually calls the model with the prior rounds in
        // context, so agents genuinely reason about and respond to each other — not
        // canned template lines. Falls back to the deterministic role generator only
        // when no model is wired (keeps the debate fail-closed and unit-testable).
        // Thinking depth (L5 = deep) drives the model's temperature and token budget,
        // so this layer reasons with materially more budget than a shallow triage call.
        const requestedDepth = this.config.thinkingDepth || 'deep';
        const depthParams = THINKING_DEPTH_PARAMS[requestedDepth] ?? THINKING_DEPTH_PARAMS.deep;
        if (!THINKING_DEPTH_PARAMS[requestedDepth] && this.config.thinkingDepth) {
            logger.warn(`Unknown debate thinkingDepth '${this.config.thinkingDepth}'; falling back to 'deep'`);
        }
        let content = '';
        try {
            const response = await this.messageBus.requestModel({
                id: uuidv4(),
                prompt: fullPrompt,
                context: { role: speaker, agentId: speakerResult?.agentId || speaker, debate: true, position },
                tier: 'cloud',
                priority: 'high',
                timeout: Math.min(this.config.roundTimeout, 20000),
                sanitizationLevel: 'basic',
                analysisPurpose: 'deep_analysis',
                temperature: depthParams.temperature,
                maxTokens: depthParams.maxTokens
            });
            content = (response?.content || '').trim();
        } catch (error: any) {
            logger.debug(`Debate model call failed for ${speaker}; using deterministic fallback`, { error: error?.message });
        }
        if (!content) {
            content = this.fallbackArgument(speaker, speakerResult, otherResults, previousRounds);
        }

        return { content, evidence };
    }

    private collectSpeakerEvidence(
        speaker: AgentRole,
        speakerResult: AnalysisResult | undefined,
        evidence: Evidence[]
    ): void {
        if (speaker === 'socrates' && speakerResult?.mutations && speakerResult.mutations.length > 0) {
            evidence.push({
                type: 'semantic',
                description: `${speakerResult.mutations.length} potential bypass mutation(s) identified`,
                severity: 'high',
                data: { mutations: speakerResult.mutations.slice(0, 3) },
                source: 'Socrates'
            });
        }
        if (speaker === 'plato' && speakerResult?.schemaValidation && !speakerResult.schemaValidation.isValid) {
            evidence.push({
                type: 'pattern',
                description: `${speakerResult.schemaValidation.violations.length} schema violation(s) found`,
                severity: 'medium',
                data: { violations: speakerResult.schemaValidation.violations.slice(0, 3) },
                source: 'Plato'
            });
        }
        if (speaker === 'aristotle' && speakerResult?.anomalyScore && speakerResult.anomalyScore > 0.5) {
            evidence.push({
                type: 'statistical',
                description: `Anomaly score: ${(speakerResult.anomalyScore * 100).toFixed(0)}%`,
                severity: speakerResult.anomalyScore > 0.7 ? 'high' : 'medium',
                data: { anomalyScore: speakerResult.anomalyScore },
                source: 'Aristotle'
            });
        }
    }

    private fallbackArgument(
        speaker: AgentRole,
        speakerResult: AnalysisResult | undefined,
        otherResults: AnalysisResult[],
        previousRounds: DebateRound[]
    ): string {
        switch (speaker) {
            case 'socrates': return this.generateSocratesArgument(speakerResult, otherResults, previousRounds);
            case 'plato': return this.generatePlatoArgument(speakerResult, otherResults, previousRounds);
            case 'aristotle': return this.generateAristotleArgument(speakerResult, otherResults, previousRounds);
            default: return 'Insufficient basis to take a position.';
        }
    }

    private buildArgumentPrompt(
        speaker: AgentRole,
        position: string,
        speakerResult: AnalysisResult | undefined,
        otherResults: AnalysisResult[],
        request: TrafficRequest
    ): string {
        return `You are ${speaker} in a security debate about request ${request.path}.
        
Your position: ${position}
Your initial analysis: ${speakerResult?.reasoning || 'No analysis available'}
Your verdict: ${speakerResult?.verdict || 'unknown'}
Your confidence: ${speakerResult?.confidence || 0}

Other agents' views:
${otherResults.map(r => `- ${r.role}: ${r.verdict} (${(r.confidence * 100).toFixed(0)}% confidence)`).join('\n')}

Provide a concise argument supporting your position. Focus on evidence and reasoning.`;
    }

    private generateSocratesArgument(
        speakerResult: AnalysisResult | undefined,
        otherResults: AnalysisResult[],
        previousRounds: DebateRound[]
    ): string {
        const mutations = speakerResult?.mutations || [];
        const mutationCount = mutations.length;

        if (mutationCount > 0) {
            const topMutations = mutations.slice(0, 3).map(m => m.description).join(', ');
            return `I've identified ${mutationCount} potential attack vector(s). The most concerning are: ${topMutations}. ` +
                   `Even if current defenses hold, these mutations could bypass detection. ` +
                   `I argue for treating this as potentially malicious.`;
        }

        const platoResult = otherResults.find(r => r.role === 'plato');
        if (platoResult?.verdict === 'safe') {
            return `While Plato argues the request is schema-compliant, compliance doesn't guarantee safety. ` +
                   `I question whether we've considered all possible attack variations. ` +
                   `What if the attacker is probing for information?`;
        }

        return `I maintain my position that this request warrants careful scrutiny. ` +
               `The absence of obvious attack patterns doesn't prove innocence.`;
    }

    private generatePlatoArgument(
        speakerResult: AnalysisResult | undefined,
        otherResults: AnalysisResult[],
        previousRounds: DebateRound[]
    ): string {
        const schemaValidation = speakerResult?.schemaValidation;

        if (schemaValidation?.isValid) {
            return `The request conforms to expected schema and patterns. ` +
                   `All parameters are properly formatted and within acceptable ranges. ` +
                   `I see no technical violations that would warrant blocking.`;
        }

        if (schemaValidation && !schemaValidation.isValid) {
            const violations = schemaValidation.violations.slice(0, 3);
            return `I've detected ${schemaValidation.violations.length} schema violation(s): ` +
                   `${violations.map(v => v.field).join(', ')}. ` +
                   `However, these may be errors rather than attacks. Context matters.`;
        }

        return `Based on schema analysis, I find the request ${speakerResult?.verdict || 'unknown'}. ` +
               `The technical evidence supports this assessment.`;
    }

    private generateAristotleArgument(
        speakerResult: AnalysisResult | undefined,
        otherResults: AnalysisResult[],
        previousRounds: DebateRound[]
    ): string {
        const anomalyScore = speakerResult?.anomalyScore || 0;

        if (anomalyScore > 0.7) {
            return `Statistical analysis reveals significant anomalies (score: ${(anomalyScore * 100).toFixed(0)}%). ` +
                   `The behavior pattern deviates substantially from historical norms. ` +
                   `This warrants elevated concern regardless of technical compliance.`;
        }

        if (anomalyScore > 0.4) {
            return `I observe moderate behavioral anomalies (score: ${(anomalyScore * 100).toFixed(0)}%). ` +
                   `While not definitive, the pattern suggests increased monitoring is warranted. ` +
                   `Historical context adds important nuance to the technical analysis.`;
        }

        return `Behavioral analysis shows no significant anomalies. ` +
               `The request pattern aligns with historical norms for this source. ` +
               `From a statistical perspective, this appears within normal parameters.`;
    }

    private checkConsensus(session: DebateSession, results: AnalysisResult[]): boolean {
        if (session.rounds.length < 2) return false;

        const dominantLabels = new Set(results.map((result) => dominantVerdict(result.classScores)));
        if (dominantLabels.size === 1) {
            return true;
        }

        return averagePairwiseDivergence(results) <= Math.max(0.05, 1 - this.config.consensusThreshold);
    }

    private async arbitrate(
        session: DebateSession,
        results: AnalysisResult[]
    ): Promise<DebateVerdict> {
        const votingRecord = this.collectVotes(results);
        const initialAggregateDistribution = blendDistributions(results);
        const aggregateDistribution = this.applyDebateAdjustments(
            initialAggregateDistribution,
            session,
            results,
            votingRecord
        );
        const aggregateVerdict = dominantVerdict(aggregateDistribution);
        
        const maliciousVotes = votingRecord.filter(v => v.vote === 'malicious').length;
        const safeVotes = votingRecord.filter(v => v.vote === 'safe').length;
        const abstainVotes = votingRecord.filter(v => v.vote === 'abstain').length;
        const totalVotes = votingRecord.length;
        const hardEvidenceCount = session.rounds.reduce((sum, round) => (
            sum + round.evidence.filter((evidence) => evidence.severity === 'high' || evidence.severity === 'critical').length
        ), 0);

        let decision: 'safe' | 'malicious' | 'requires_review';
        let confidence: number;
        let reasoning: string;

        if (
            maliciousVotes >= Math.ceil(totalVotes / 2) ||
            aggregateDistribution.malicious >= 0.58 ||
            hardEvidenceCount >= 2
        ) {
            const avgConfidence = votingRecord
                .filter(v => v.vote === 'malicious')
                .reduce((sum, v) => sum + v.confidence, 0) / Math.max(maliciousVotes, 1);
            
            decision = 'malicious';
            confidence = Math.max(avgConfidence, confidenceFromDistribution(aggregateDistribution));
            reasoning = `Aggregated posterior favors malicious with ${(aggregateDistribution.malicious * 100).toFixed(0)}% support`;
        } else if (
            safeVotes >= Math.ceil(totalVotes / 2) ||
            (
                safeVotes >= 1 &&
                maliciousVotes === 0 &&
                aggregateDistribution.safe >= aggregateDistribution.malicious
            ) ||
            (
                safeVotes >= 1 &&
                maliciousVotes === 1 &&
                abstainVotes >= 1 &&
                session.triggerMetrics?.labelConflict
            )
        ) {
            const avgConfidence = votingRecord
                .filter(v => v.vote === 'safe')
                .reduce((sum, v) => sum + v.confidence, 0) / Math.max(safeVotes, 1);
            
            decision = 'safe';
            confidence = Math.max(avgConfidence, confidenceFromDistribution(aggregateDistribution));
            reasoning = `Aggregated posterior favors safe with ${(aggregateDistribution.safe * 100).toFixed(0)}% support`;
        } else if (aggregateVerdict === 'malicious' && abstainVotes > 0 && safeVotes > 0) {
            decision = 'requires_review';
            confidence = Math.max(0.55, confidenceFromDistribution(aggregateDistribution));
            reasoning = `Debate preserved ambiguity after conflicting evidence; ${(aggregateDistribution.suspicious * 100).toFixed(0)}% posterior mass remains in review space`;
        } else {
            decision = 'requires_review';
            confidence = Math.max(0.5, confidenceFromDistribution(aggregateDistribution));
            reasoning = `Posterior remains ambiguous with ${(aggregateDistribution.suspicious * 100).toFixed(0)}% suspicious support`;
        }

        const arbitratorNotes = this.generateArbitratorNotes(session, votingRecord);

        return {
            decision,
            confidence,
            reasoning,
            votingRecord,
            arbitratorNotes,
            aggregatedDistribution: normalizeDistribution(aggregateDistribution)
        };
    }

    private applyDebateAdjustments(
        aggregateDistribution: ReturnType<typeof normalizeDistribution>,
        session: DebateSession,
        results: AnalysisResult[],
        votingRecord: VotingRecord[]
    ) {
        const adjusted = {
            ...normalizeDistribution(aggregateDistribution)
        };
        const maliciousVotes = votingRecord.filter((vote) => vote.vote === 'malicious').length;
        const safeVotes = votingRecord.filter((vote) => vote.vote === 'safe').length;
        const abstainVotes = votingRecord.filter((vote) => vote.vote === 'abstain').length;
        const divergence = session.triggerMetrics?.divergence ?? averagePairwiseDivergence(results);

        if (maliciousVotes >= 2) {
            adjusted.malicious += 0.08;
            adjusted.suspicious -= 0.03;
            adjusted.safe -= 0.05;
        } else if (maliciousVotes === 1 && safeVotes >= 1 && abstainVotes >= 1 && divergence >= 0.08) {
            adjusted.safe += 0.1;
            adjusted.suspicious += 0.03;
            adjusted.malicious -= 0.13;
        } else if (safeVotes >= 2 && divergence >= 0.08) {
            adjusted.safe += 0.07;
            adjusted.suspicious -= 0.04;
            adjusted.malicious -= 0.03;
        }

        return normalizeDistribution(adjusted);
    }

    private collectVotes(results: AnalysisResult[]): VotingRecord[] {
        return results.map(result => ({
            agentId: result.agentId,
            role: result.role,
            vote: this.mapVerdictToVote(dominantVerdict(result.classScores)),
            confidence: result.confidence,
            reasoning: result.reasoning
        }));
    }

    private mapVerdictToVote(verdict: string): 'safe' | 'malicious' | 'abstain' {
        switch (verdict) {
            case 'safe': return 'safe';
            case 'malicious': return 'malicious';
            case 'suspicious': return 'abstain';
            default: return 'abstain';
        }
    }

    private generateArbitratorNotes(session: DebateSession, votingRecord: VotingRecord[]): string {
        const rounds = session.rounds.length;
        const keyEvidence: string[] = [];

        for (const round of session.rounds) {
            for (const evidence of round.evidence) {
                keyEvidence.push(`${round.speaker}: ${evidence.description}`);
            }
        }

        let notes = `Debate completed in ${rounds} round(s).\n`;
        notes += `Key evidence presented:\n`;
        notes += keyEvidence.slice(0, 5).map(e => `- ${e}`).join('\n');
        
        if (keyEvidence.length > 5) {
            notes += `\n... and ${keyEvidence.length - 5} more items`;
        }

        return notes;
    }

    getSession(sessionId: string): DebateSession | undefined {
        return this.sessions.get(sessionId);
    }

    getActiveDebates(): DebateSession[] {
        return Array.from(this.sessions.values()).filter(s => s.status === 'active');
    }

    cleanupCompletedDebates(maxAge: number = 3600000): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (session.status !== 'active' && 
                session.endTime && 
                now - session.endTime.getTime() > maxAge) {
                this.sessions.delete(id);
            }
        }
    }
}

export default DebateProtocol;
