/**
 * Orchestrator-level degradation transparency: when every role agent answers
 * via its heuristic fallback (heuristicOnly system config — same path as
 * "model unreachable"), the aggregated SecurityDecision must say so.
 * Complements heuristic-fallback-transparency.test.ts, which pins the
 * per-agent marker; this pins the aggregation in agent-orchestrator.ts.
 */
import { MultiAgentDecisionSystem } from '../../../ai-agents';

describe('SecurityDecision degradation transparency (aggregation)', () => {
    let system: MultiAgentDecisionSystem;

    beforeAll(async () => {
        system = new MultiAgentDecisionSystem({ heuristicOnly: true, useIsolatedBus: true });
        await system.initialize();
    });

    afterAll(async () => {
        await system.shutdown();
    });

    it('marks the decision heuristicDegraded when every role answered via fallback', async () => {
        const decision = await system.analyze({
            id: 'test-degraded-001',
            timestamp: new Date(),
            sourceIP: '192.168.1.50',
            method: 'GET',
            path: '/api/users',
            headers: {},
            queryParams: { page: '1' }
        });

        const results = decision.analysisResults || [];
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((r) => r.heuristicFallback === true)).toBe(true);
        expect(decision.heuristicFallbackCount).toBe(results.length);
        expect(decision.heuristicDegraded).toBe(true);
        // No fallback result may claim a model tier (the old lie was 'cloud').
        expect(results.every((r) => r.modelTier === undefined)).toBe(true);
    });
});
