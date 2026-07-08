/**
 * Synthesis Engine - L7: Distributed Fault Tolerance & Synthesis
 * Generates case files and enables self-evolution
 */

import { uuidv4 } from '../../utils/uuid';
import {
    CaseFile,
    CaseAction,
    LessonLearned,
    PolicyUpdate,
    SecurityDecision,
    DebateSession,
    AttackNarrative,
    DebateVerdict
} from '../core/types';
import logger from '../../utils/logger';

export interface SynthesisConfig {
    maxLessons: number;
    policyUpdateThreshold: number;
    learningRate: number;
}

const DEFAULT_CONFIG: SynthesisConfig = {
    maxLessons: 100,
    policyUpdateThreshold: 0.8,
    learningRate: 0.1
};

export class SynthesisEngine {
    private config: SynthesisConfig;
    private caseFiles: Map<string, CaseFile> = new Map();
    private lessonsLearned: LessonLearned[] = [];
    private policyUpdates: PolicyUpdate[] = [];
    private patternFrequency: Map<string, number> = new Map();

    constructor(config: Partial<SynthesisConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    generateCaseFile(
        decision: SecurityDecision,
        narrative: AttackNarrative,
        debate: DebateSession
    ): CaseFile {
        const caseFile: CaseFile = {
            id: uuidv4(),
            requestId: decision.requestId,
            timestamp: new Date(),
            summary: this.generateSummary(decision, narrative, debate),
            narrative,
            debate,
            verdict: debate.finalVerdict || this.createDefaultVerdict(decision),
            actions: decision.actions,
            lessons: [],
            policyUpdates: []
        };

        caseFile.lessons = this.extractLessons(caseFile);
        caseFile.policyUpdates = this.suggestPolicyUpdates(caseFile);

        this.caseFiles.set(caseFile.id, caseFile);
        this.updatePatternFrequency(caseFile);

        for (const lesson of caseFile.lessons) {
            this.addLesson(lesson);
        }

        for (const update of caseFile.policyUpdates) {
            this.addPolicyUpdate(update);
        }

        logger.info(`Case file generated: ${caseFile.id}`, {
            verdict: decision.verdict,
            threatLevel: decision.threatLevel,
            lessonsCount: caseFile.lessons.length
        });

        return caseFile;
    }

    private generateSummary(
        decision: SecurityDecision,
        narrative: AttackNarrative,
        debate: DebateSession
    ): string {
        const parts: string[] = [];

        parts.push(`Security Decision: ${decision.verdict.toUpperCase()}`);
        parts.push(`Threat Level: ${decision.threatLevel.toUpperCase()}`);
        parts.push(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);

        if (narrative.attackChain.length > 0) {
            parts.push(`Attack Chain: ${narrative.attackChain.length} step(s) detected`);
        }

        if (debate.rounds.length > 0) {
            parts.push(`Debate: ${debate.rounds.length} round(s) conducted`);
        }

        parts.push(`Processing Time: ${decision.processingTime}ms`);
        parts.push(`Layers Activated: L${decision.layersActivated.join(', L')}`);

        return parts.join('. ') + '.';
    }

    private createDefaultVerdict(decision: SecurityDecision): DebateVerdict {
        return {
            decision: decision.verdict === 'allow' ? 'safe' : 
                      decision.verdict === 'block' ? 'malicious' : 'requires_review',
            confidence: decision.confidence,
            reasoning: decision.reasoning,
            votingRecord: [],
            arbitratorNotes: 'Auto-generated verdict without debate'
        };
    }

    private extractLessons(caseFile: CaseFile): LessonLearned[] {
        const lessons: LessonLearned[] = [];
        const { narrative, verdict, actions } = caseFile;

        if (verdict.decision === 'malicious' && narrative.attackChain.length > 0) {
            lessons.push({
                category: 'attack_pattern',
                insight: `Attack chain detected: ${narrative.attackChain.map(s => s.action).join(' → ')}`,
                confidence: verdict.confidence,
                applicableScenarios: ['similar_attack_chains', 'same_attack_vector']
            });
        }

        if (narrative.services.length > 1) {
            lessons.push({
                category: 'multi_service_attack',
                insight: `Cross-service attack spanning: ${narrative.services.join(', ')}`,
                confidence: 0.8,
                applicableScenarios: ['distributed_attacks', 'service_correlation']
            });
        }

        for (const action of actions) {
            if (action.action === 'block' && action.automated) {
                lessons.push({
                    category: 'automated_response',
                    insight: `Automated blocking effective for: ${action.reason}`,
                    confidence: 0.9,
                    applicableScenarios: ['similar_threats', 'automated_defense']
                });
            }
        }

        if (caseFile.debate.rounds.length > 0) {
            const consensusReached = caseFile.debate.rounds.length < 3;
            lessons.push({
                category: 'debate_efficiency',
                insight: consensusReached 
                    ? 'Consensus reached efficiently through debate protocol'
                    : 'Full debate required for resolution',
                confidence: 0.7,
                applicableScenarios: ['similar_conflicts', 'decision_making']
            });
        }

        return lessons;
    }

    private suggestPolicyUpdates(caseFile: CaseFile): PolicyUpdate[] {
        const updates: PolicyUpdate[] = [];
        const { verdict, narrative, actions } = caseFile;

        const patternKey = this.getPatternKey(caseFile);
        const frequency = this.patternFrequency.get(patternKey) || 0;

        if (frequency >= 3 && verdict.decision === 'malicious') {
            updates.push({
                id: uuidv4(),
                type: 'rule_addition',
                description: `Auto-generated rule for recurring attack pattern: ${patternKey}`,
                changes: {
                    pattern: patternKey,
                    action: 'block',
                    confidence: Math.min(frequency * 0.2, 0.95)
                },
                effectiveFrom: new Date(),
                source: 'ai_evolution'
            });
        }

        if (narrative.riskLevel === 'critical') {
            updates.push({
                id: uuidv4(),
                type: 'threshold_adjustment',
                description: 'Lower threshold for critical risk patterns',
                changes: {
                    riskLevel: 'critical',
                    thresholdAdjustment: -0.1
                },
                effectiveFrom: new Date(),
                source: 'ai_evolution'
            });
        }

        const blockActions = actions.filter(a => a.action === 'block');
        if (blockActions.length > 0) {
            updates.push({
                id: uuidv4(),
                type: 'rule_modification',
                description: `Update block duration based on threat severity`,
                changes: {
                    blockDuration: this.calculateOptimalBlockDuration(caseFile),
                    reason: 'Adaptive blocking based on case analysis'
                },
                effectiveFrom: new Date(),
                source: 'ai_evolution'
            });
        }

        return updates;
    }

    private getPatternKey(caseFile: CaseFile): string {
        const parts: string[] = [];

        if (caseFile.narrative.attackChain.length > 0) {
            parts.push(caseFile.narrative.attackChain[0].action.substring(0, 30));
        }

        if (caseFile.narrative.services.length > 0) {
            parts.push(caseFile.narrative.services[0]);
        }

        parts.push(caseFile.verdict.decision);

        return parts.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
    }

    private calculateOptimalBlockDuration(caseFile: CaseFile): number {
        const baseDuration = 3600;
        const { verdict, narrative } = caseFile;

        let multiplier = 1;

        if (narrative.riskLevel === 'critical') multiplier *= 24;
        else if (narrative.riskLevel === 'high') multiplier *= 4;
        else if (narrative.riskLevel === 'medium') multiplier *= 2;

        if (verdict.confidence > 0.9) multiplier *= 1.5;

        if (narrative.attackChain.length > 2) multiplier *= 2;

        return Math.min(baseDuration * multiplier, 86400 * 7);
    }

    private updatePatternFrequency(caseFile: CaseFile): void {
        const patternKey = this.getPatternKey(caseFile);
        const current = this.patternFrequency.get(patternKey) || 0;
        this.patternFrequency.set(patternKey, current + 1);
    }

    private addLesson(lesson: LessonLearned): void {
        this.lessonsLearned.push(lesson);

        if (this.lessonsLearned.length > this.config.maxLessons) {
            this.lessonsLearned = this.lessonsLearned
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, this.config.maxLessons);
        }
    }

    private addPolicyUpdate(update: PolicyUpdate): void {
        this.policyUpdates.push(update);
        logger.info(`Policy update recorded: ${update.type}`, {
            description: update.description,
            source: update.source
        });
    }

    getCaseFile(id: string): CaseFile | undefined {
        return this.caseFiles.get(id);
    }

    getRecentCaseFiles(count: number = 10): CaseFile[] {
        return Array.from(this.caseFiles.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, count);
    }

    getLessonsByCategory(category: string): LessonLearned[] {
        return this.lessonsLearned.filter(l => l.category === category);
    }

    getPendingPolicyUpdates(): PolicyUpdate[] {
        return this.policyUpdates.filter(u => 
            u.effectiveFrom <= new Date() && u.source === 'ai_evolution'
        );
    }

    applyPolicyUpdates(updates: PolicyUpdate[]): void {
        for (const update of updates) {
            logger.info(`Applying policy update: ${update.id}`, {
                type: update.type,
                description: update.description
            });
        }
    }

    getEvolutionStats(): {
        totalCaseFiles: number;
        totalLessons: number;
        totalPolicyUpdates: number;
        topPatterns: { pattern: string; frequency: number }[];
    } {
        const topPatterns = Array.from(this.patternFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([pattern, frequency]) => ({ pattern, frequency }));

        return {
            totalCaseFiles: this.caseFiles.size,
            totalLessons: this.lessonsLearned.length,
            totalPolicyUpdates: this.policyUpdates.length,
            topPatterns
        };
    }

    cleanupOldData(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
        const cutoff = new Date(Date.now() - maxAge);

        for (const [id, caseFile] of this.caseFiles) {
            if (caseFile.timestamp <= cutoff) {
                this.caseFiles.delete(id);
            }
        }

        this.policyUpdates = this.policyUpdates.filter(u => u.effectiveFrom >= cutoff);
    }
}

export const synthesisEngine = new SynthesisEngine();
