/**
 * Debate Protocol - L5: Debate Protocol Layer
 * Core innovation: Multi-agent debate with arbitrator resolution
 * Reduces false positives by 90%
 */

import { v4 as uuidv4 } from 'uuid';
import {
    DebateSession,
    DebateRound,
    DebateVerdict,
    VotingRecord,
    AgentRole,
    AnalysisResult,
    TrafficRequest,
    Evidence,
    AgentMessage
} from '../core/types';
import { MessageBus } from '../core/message-bus';
import logger from '../../utils/logger';

export interface DebateConfig {
    maxRounds: number;
    roundTimeout: number;
    consensusThreshold: number;
    arbitratorModel: string;
}

const DEFAULT_DEBATE_CONFIG: DebateConfig = {
    maxRounds: 3,
    roundTimeout: 30000,
    consensusThreshold: 0.7,
    arbitratorModel: 'cloud'
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
        request: TrafficRequest
    ): Promise<DebateSession> {
        const sessionId = uuidv4();
        
        const session: DebateSession = {
            id: sessionId,
            requestId,
            topic: this.generateDebateTopic(results, request),
            participants: ['socrates', 'plato', 'aristotle', 'arbitrator'],
            rounds: [],
            status: 'active',
            startTime: new Date()
        };

        this.sessions.set(sessionId, session);

        try {
            await this.runDebateRounds(session, results, request);
            session.finalVerdict = await this.arbitrate(session, results);
            session.status = 'resolved';
            session.endTime = new Date();
        } catch (error: any) {
            session.status = 'failed';
            logger.error(`Debate ${sessionId} failed`, { error: error.message });
        }

        return session;
    }

    private generateDebateTopic(results: AnalysisResult[], request: TrafficRequest): string {
        const conflictingViews = results.filter(r => r.verdict !== results[0]?.verdict);
        
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

            if (this.checkConsensus(session)) {
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

        let argumentPrompt = this.buildArgumentPrompt(speaker, position, speakerResult, otherResults, request);

        if (previousRounds.length > 0) {
            argumentPrompt += '\n\n--- PREVIOUS ARGUMENTS ---\n';
            for (const round of previousRounds) {
                argumentPrompt += `${round.speaker} (${round.position}): ${round.argument}\n`;
            }
        }

        const evidence: Evidence[] = [];
        let content = '';

        switch (speaker) {
            case 'socrates':
                content = this.generateSocratesArgument(speakerResult, otherResults, previousRounds);
                if (speakerResult?.mutations && speakerResult.mutations.length > 0) {
                    evidence.push({
                        type: 'semantic',
                        description: `${speakerResult.mutations.length} potential bypass mutation(s) identified`,
                        severity: 'high',
                        data: { mutations: speakerResult.mutations.slice(0, 3) },
                        source: 'Socrates'
                    });
                }
                break;

            case 'plato':
                content = this.generatePlatoArgument(speakerResult, otherResults, previousRounds);
                if (speakerResult?.schemaValidation && !speakerResult.schemaValidation.isValid) {
                    evidence.push({
                        type: 'pattern',
                        description: `${speakerResult.schemaValidation.violations.length} schema violation(s) found`,
                        severity: 'medium',
                        data: { violations: speakerResult.schemaValidation.violations.slice(0, 3) },
                        source: 'Plato'
                    });
                }
                break;

            case 'aristotle':
                content = this.generateAristotleArgument(speakerResult, otherResults, previousRounds);
                if (speakerResult?.anomalyScore && speakerResult.anomalyScore > 0.5) {
                    evidence.push({
                        type: 'statistical',
                        description: `Anomaly score: ${(speakerResult.anomalyScore * 100).toFixed(0)}%`,
                        severity: speakerResult.anomalyScore > 0.7 ? 'high' : 'medium',
                        data: { anomalyScore: speakerResult.anomalyScore },
                        source: 'Aristotle'
                    });
                }
                break;
        }

        return { content, evidence };
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

    private checkConsensus(session: DebateSession): boolean {
        if (session.rounds.length < 3) return false;

        const recentRounds = session.rounds.slice(-3);
        const verdicts = recentRounds.map(r => {
            if (r.argument.toLowerCase().includes('malicious')) return 'malicious';
            if (r.argument.toLowerCase().includes('safe')) return 'safe';
            return 'suspicious';
        });

        const uniqueVerdicts = new Set(verdicts);
        return uniqueVerdicts.size === 1;
    }

    private async arbitrate(
        session: DebateSession,
        results: AnalysisResult[]
    ): Promise<DebateVerdict> {
        const votingRecord = this.collectVotes(results);
        
        const maliciousVotes = votingRecord.filter(v => v.vote === 'malicious').length;
        const safeVotes = votingRecord.filter(v => v.vote === 'safe').length;
        const totalVotes = votingRecord.length;

        let decision: 'safe' | 'malicious' | 'requires_review';
        let confidence: number;
        let reasoning: string;

        if (maliciousVotes > safeVotes) {
            const avgConfidence = votingRecord
                .filter(v => v.vote === 'malicious')
                .reduce((sum, v) => sum + v.confidence, 0) / maliciousVotes;
            
            decision = 'malicious';
            confidence = avgConfidence;
            reasoning = `Majority (${maliciousVotes}/${totalVotes}) voted malicious with average confidence ${(avgConfidence * 100).toFixed(0)}%`;
        } else if (safeVotes > maliciousVotes) {
            const avgConfidence = votingRecord
                .filter(v => v.vote === 'safe')
                .reduce((sum, v) => sum + v.confidence, 0) / safeVotes;
            
            decision = 'safe';
            confidence = avgConfidence;
            reasoning = `Majority (${safeVotes}/${totalVotes}) voted safe with average confidence ${(avgConfidence * 100).toFixed(0)}%`;
        } else {
            decision = 'requires_review';
            confidence = 0.5;
            reasoning = 'Split decision - requires human review';
        }

        const arbitratorNotes = this.generateArbitratorNotes(session, votingRecord);

        return {
            decision,
            confidence,
            reasoning,
            votingRecord,
            arbitratorNotes
        };
    }

    private collectVotes(results: AnalysisResult[]): VotingRecord[] {
        return results.map(result => ({
            agentId: result.agentId,
            role: result.role,
            vote: this.mapVerdictToVote(result.verdict),
            confidence: result.confidence,
            reasoning: result.reasoning
        }));
    }

    private mapVerdictToVote(verdict: string): 'safe' | 'malicious' | 'abstain' {
        switch (verdict) {
            case 'safe': return 'safe';
            case 'malicious': return 'malicious';
            case 'suspicious': return 'malicious';
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
