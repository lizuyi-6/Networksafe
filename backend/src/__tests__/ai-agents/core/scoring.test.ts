/**
 * Tests for the scoring module — verdict distribution math used by the Athens
 * Academy orchestrator and debate protocol. Pure functions: distribution
 * normalization, blending, divergence, confidence, and debate trigger logic.
 */

import {
    normalizeDistribution,
    distributionFromVerdict,
    dominantVerdict,
    confidenceFromDistribution,
    blendDistributions,
    averagePairwiseDivergence,
    confidenceRange,
    buildDebateTriggerMetrics,
    verdictToDecision
} from '../../../ai-agents/core/scoring';
import type { AnalysisResult } from '../../../ai-agents/core/types';

function makeResult(role: string, verdict: string, confidence: number, dist?: { safe: number; suspicious: number; malicious: number }): AnalysisResult {
    return {
        agentId: `${role}-1`, role: role as any, verdict: verdict as any, confidence,
        classScores: dist || distributionFromVerdict(verdict as any, confidence),
        reasoning: `${role}:${verdict}`, evidence: []
    } as AnalysisResult;
}

describe('scoring module', () => {
    describe('normalizeDistribution', () => {
        it('normalizes a distribution that sums > 1', () => {
            const result = normalizeDistribution({ safe: 3, suspicious: 3, malicious: 3 });
            const sum = result.safe + result.suspicious + result.malicious;
            expect(sum).toBeCloseTo(1, 5);
        });
        it('returns equal thirds for all-zero input', () => {
            const result = normalizeDistribution({ safe: 0, suspicious: 0, malicious: 0 });
            expect(result.safe).toBeCloseTo(1 / 3, 5);
            expect(result.malicious).toBeCloseTo(1 / 3, 5);
        });
        it('preserves an already-normalized distribution', () => {
            const result = normalizeDistribution({ safe: 0.5, suspicious: 0.3, malicious: 0.2 });
            expect(result.safe).toBeCloseTo(0.5, 5);
            expect(result.suspicious).toBeCloseTo(0.3, 5);
        });
    });

    describe('distributionFromVerdict', () => {
        it('maps a malicious verdict to high malicious mass', () => {
            const dist = distributionFromVerdict('malicious', 0.9);
            expect(dist.malicious).toBeGreaterThan(0.5);
            expect(dist.safe).toBeLessThan(0.2);
        });
        it('maps a safe verdict to high safe mass', () => {
            const dist = distributionFromVerdict('safe', 0.9);
            expect(dist.safe).toBeGreaterThan(0.5);
        });
    });

    describe('dominantVerdict', () => {
        it('returns the verdict with the highest mass', () => {
            expect(dominantVerdict({ safe: 0.1, suspicious: 0.1, malicious: 0.8 })).toBe('malicious');
            expect(dominantVerdict({ safe: 0.7, suspicious: 0.2, malicious: 0.1 })).toBe('safe');
        });
    });

    describe('confidenceFromDistribution', () => {
        it('returns a high confidence for a peaked distribution', () => {
            const c = confidenceFromDistribution({ safe: 0.9, suspicious: 0.05, malicious: 0.05 });
            expect(c).toBeGreaterThan(0.5);
        });
        it('returns a low confidence for a flat distribution', () => {
            const c = confidenceFromDistribution({ safe: 0.34, suspicious: 0.33, malicious: 0.33 });
            expect(c).toBeLessThan(0.5);
        });
    });

    describe('blendDistributions', () => {
        it('averages distributions from multiple results', () => {
            const results = [
                makeResult('socrates', 'malicious', 0.8),
                makeResult('plato', 'safe', 0.8)
            ];
            const blended = blendDistributions(results);
            expect(blended.safe + blended.suspicious + blended.malicious).toBeCloseTo(1, 5);
        });
        it('returns a default distribution for empty input', () => {
            const blended = blendDistributions([]);
            const sum = blended.safe + blended.suspicious + blended.malicious;
            expect(sum).toBeCloseTo(1, 1);
        });
    });

    describe('averagePairwiseDivergence', () => {
        it('returns 0 for identical verdicts', () => {
            const results = [
                makeResult('socrates', 'safe', 0.8),
                makeResult('plato', 'safe', 0.8)
            ];
            expect(averagePairwiseDivergence(results)).toBeCloseTo(0, 1);
        });
        it('returns a positive value for conflicting verdicts', () => {
            const results = [
                makeResult('socrates', 'malicious', 0.9),
                makeResult('plato', 'safe', 0.9)
            ];
            expect(averagePairwiseDivergence(results)).toBeGreaterThan(0);
        });
    });

    describe('confidenceRange', () => {
        it('returns 0 for a single result', () => {
            expect(confidenceRange([makeResult('a', 'safe', 0.8)])).toBe(0);
        });
        it('returns the spread for varying confidences', () => {
            const results = [
                makeResult('a', 'safe', 0.9),
                makeResult('b', 'safe', 0.3)
            ];
            const range = confidenceRange(results);
            expect(range).toBeGreaterThan(0);
        });
    });

    describe('buildDebateTriggerMetrics', () => {
        it('triggers on label conflict (safe vs malicious)', () => {
            const results = [
                makeResult('socrates', 'malicious', 0.9),
                makeResult('plato', 'safe', 0.9)
            ];
            const metrics = buildDebateTriggerMetrics(results, 0.3, 0.3);
            expect(metrics.triggered).toBe(true);
            expect(metrics.labelConflict).toBe(true);
        });
        it('does not trigger when all agents agree', () => {
            const results = [
                makeResult('socrates', 'safe', 0.9),
                makeResult('plato', 'safe', 0.85)
            ];
            const metrics = buildDebateTriggerMetrics(results, 0.3, 0.3);
            expect(metrics.triggered).toBe(false);
        });
        it('returns false for fewer than 2 results', () => {
            const metrics = buildDebateTriggerMetrics([makeResult('a', 'safe', 0.9)], 0.3, 0.3);
            expect(metrics.triggered).toBe(false);
        });
    });

    describe('verdictToDecision', () => {
        it('maps verdicts to security decisions', () => {
            expect(verdictToDecision('safe')).toBe('allow');
            expect(verdictToDecision('suspicious')).toBe('monitor');
            expect(verdictToDecision('malicious')).toBe('block');
            expect(verdictToDecision('unknown')).toBe('challenge');
        });
    });
});
