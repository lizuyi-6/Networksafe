/**
 * Tests for TraceContextManager (L3) — distributed tracing and attack narrative
 * reconstruction. Pure logic: add trace events, build attack narrative.
 */

import { TraceContextManager, traceContextManager } from '../../../ai-agents/tracing/trace-context';

describe('TraceContextManager', () => {
    let manager: TraceContextManager;

    beforeEach(() => {
        manager = new TraceContextManager();
    });

    it('starts with empty traces', () => {
        const narrative = manager.buildAttackNarrative('trace-empty');
        expect(narrative.attackChain).toHaveLength(0);
        expect(narrative.services).toHaveLength(0);
    });

    it('records trace events and they appear in the narrative', () => {
        const traceId = 'trace-1';
        manager.addTraceEvent(traceId, {
            service: 'api-gateway',
            event: 'Received malicious request',
            severity: 'critical'
        });
        manager.addTraceEvent(traceId, {
            service: 'auth-service',
            event: 'Token validation failed',
            severity: 'warning'
        });
        const narrative = manager.buildAttackNarrative(traceId);
        expect(narrative.services).toContain('api-gateway');
        expect(narrative.services).toContain('auth-service');
        expect(narrative.timeline.length).toBeGreaterThanOrEqual(2);
    });

    it('buildAttackNarrative constructs an attack chain from events', () => {
        const traceId = 'trace-chain';
        manager.addTraceEvent(traceId, { service: 'api', event: 'SQL injection detected', severity: 'critical' });
        manager.addTraceEvent(traceId, { service: 'db', event: 'Unauthorized query', severity: 'critical' });
        const narrative = manager.buildAttackNarrative(traceId);
        expect(narrative.attackChain.length).toBeGreaterThan(0);
        expect(narrative.riskLevel).toMatch(/critical|high/);
    });

    it('isolates traces by traceId', () => {
        manager.addTraceEvent('trace-A', { service: 'svc-A', event: 'event-A', severity: 'info' });
        manager.addTraceEvent('trace-B', { service: 'svc-B', event: 'event-B', severity: 'info' });
        const narrA = manager.buildAttackNarrative('trace-A');
        const narrB = manager.buildAttackNarrative('trace-B');
        expect(narrA.services).toContain('svc-A');
        expect(narrA.services).not.toContain('svc-B');
        expect(narrB.services).toContain('svc-B');
        expect(narrB.services).not.toContain('svc-A');
    });

    it('returns a summary string in the narrative', () => {
        manager.addTraceEvent('trace-summary', { service: 'svc', event: 'event', severity: 'info' });
        const narrative = manager.buildAttackNarrative('trace-summary');
        expect(typeof narrative.summary).toBe('string');
        expect(narrative.summary.length).toBeGreaterThan(0);
    });

    it('getNarrative returns undefined for unknown traceId', () => {
        expect(manager.getNarrative('nonexistent')).toBeUndefined();
    });

    it('getStats returns a stats object', () => {
        manager.addTraceEvent('trace-stats', { service: 'svc', event: 'e', severity: 'info' });
        const stats = manager.getStats();
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
    });

    it('the singleton traceContextManager is an instance of TraceContextManager', () => {
        expect(traceContextManager).toBeInstanceOf(TraceContextManager);
    });
});
