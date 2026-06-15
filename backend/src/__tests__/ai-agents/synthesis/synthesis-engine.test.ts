/**
 * Tests for SynthesisEngine (L7) — case file generation, lesson extraction,
 * and self-evolution policy suggestions. Pure logic, no DB.
 */

import { SynthesisEngine } from '../../../ai-agents/synthesis/synthesis-engine';
import type { SecurityDecision, AttackNarrative, DebateSession } from '../../../ai-agents/core/types';

function makeNarrative(): AttackNarrative {
    return {
        id: 'narr-1',
        traceId: 'trace-1',
        timeline: [],
        services: ['api', 'db'],
        attackChain: [
            { order: 1, service: 'api', action: 'injection', result: 'success' },
            { order: 2, service: 'db', action: 'exfiltration', result: 'success' }
        ],
        summary: 'SQL injection leading to data exfiltration',
        riskLevel: 'critical'
    };
}

function makeDebate(): DebateSession {
    return {
        id: 'debate-1',
        requestId: 'req-1',
        topic: 'Test debate',
        participants: ['socrates', 'plato', 'aristotle'],
        rounds: [],
        status: 'resolved',
        startTime: new Date(),
        finalVerdict: {
            decision: 'malicious',
            confidence: 0.95,
            reasoning: 'Confirmed attack',
            votingRecord: [],
            arbitratorNotes: 'Consensus',
            aggregatedDistribution: { safe: 0.05, suspicious: 0.05, malicious: 0.9 }
        }
    };
}

function makeDecision(): SecurityDecision {
    return {
        id: 'dec-1',
        requestId: 'req-1',
        timestamp: new Date(),
        verdict: 'block',
        confidence: 0.95,
        threatLevel: 'critical',
        reasoning: 'SQL injection detected',
        evidence: [],
        actions: [{ action: 'block', target: '10.0.0.1', reason: 'threat', automated: true, duration: 3600 }],
        caseFileId: '',
        processingTime: 50,
        layersActivated: [1, 2, 5, 7]
    };
}

describe('SynthesisEngine', () => {
    let engine: SynthesisEngine;

    beforeEach(() => {
        engine = new SynthesisEngine();
    });

    it('generateCaseFile produces a case file with an id', () => {
        const decision = makeDecision();
        const narrative = makeNarrative();
        const debate = makeDebate();
        const caseFile = engine.generateCaseFile(decision, narrative, debate);
        expect(caseFile.id).toBeTruthy();
        expect(typeof caseFile.summary).toBe('string');
        expect(caseFile.summary.length).toBeGreaterThan(0);
        expect(caseFile.verdict.decision).toBe('malicious');
        expect(caseFile.actions).toHaveLength(1);
    });

    it('generateCaseFile extracts lessons from malicious + attack chain', () => {
        const caseFile = engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        expect(caseFile.lessons.length).toBeGreaterThan(0);
        const attackLesson = caseFile.lessons.find((l) => l.category === 'attack_pattern');
        expect(attackLesson).toBeDefined();
    });

    it('generateCaseFile extracts multi-service lesson when services > 1', () => {
        const caseFile = engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        const multiService = caseFile.lessons.find((l) => l.category === 'multi_service_attack');
        expect(multiService).toBeDefined();
    });

    it('generateCaseFile extracts automated-response lesson for auto-block', () => {
        const caseFile = engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        const autoResp = caseFile.lessons.find((l) => l.category === 'automated_response');
        expect(autoResp).toBeDefined();
    });

    it('getCaseFile retrieves a previously generated case file', () => {
        const caseFile = engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        const fetched = engine.getCaseFile(caseFile.id);
        expect(fetched).toBeDefined();
        expect(fetched?.id).toBe(caseFile.id);
    });

    it('getCaseFile returns undefined for unknown id', () => {
        expect(engine.getCaseFile('nonexistent')).toBeUndefined();
    });

    it('getRecentCaseFiles returns the most recent N', () => {
        for (let i = 0; i < 5; i++) {
            engine.generateCaseFile({ ...makeDecision(), id: `dec-${i}` }, makeNarrative(), makeDebate());
        }
        const recent = engine.getRecentCaseFiles(3);
        expect(recent).toHaveLength(3);
    });

    it('getLessonsByCategory filters lessons', () => {
        engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        const lessons = engine.getLessonsByCategory('attack_pattern');
        expect(lessons.length).toBeGreaterThan(0);
        expect(lessons.every((l) => l.category === 'attack_pattern')).toBe(true);
    });

    it('getEvolutionStats returns totalCaseFiles, lessons, topPatterns', () => {
        engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        const stats = engine.getEvolutionStats();
        expect(stats.totalCaseFiles).toBeGreaterThan(0);
        expect(stats.totalLessons).toBeGreaterThan(0);
        expect(Array.isArray(stats.topPatterns)).toBe(true);
    });

    it('cleanupOldData removes old case files', () => {
        engine.generateCaseFile(makeDecision(), makeNarrative(), makeDebate());
        // maxAge of 0 means everything is older than now
        engine.cleanupOldData(0);
        expect(engine.getEvolutionStats().totalCaseFiles).toBe(0);
    });
});
