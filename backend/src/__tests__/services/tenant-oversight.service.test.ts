/**
 * Tests for the pure helper functions exported by tenant-oversight.service.
 * These are boundary-heavy filter/normalization helpers with no DB dependency.
 */

import {
    severityWeight,
    buildWindow,
    withinWindow,
    matchesUser,
    toTimelineEvent
} from '../../services/tenant-oversight.service';

describe('tenant-oversight pure helpers', () => {
    describe('severityWeight', () => {
        it('maps severity names to ordered weights', () => {
            expect(severityWeight('critical')).toBe(4);
            expect(severityWeight('high')).toBe(3);
            expect(severityWeight('medium')).toBe(2);
            expect(severityWeight('low')).toBe(1);
        });

        it('is case-insensitive', () => {
            expect(severityWeight('CRITICAL')).toBe(4);
            expect(severityWeight('High')).toBe(3);
        });

        it('returns 0 for unknown / missing severity', () => {
            expect(severityWeight('unknown')).toBe(0);
            expect(severityWeight(undefined)).toBe(0);
            expect(severityWeight('')).toBe(0);
        });
    });

    describe('buildWindow', () => {
        it('returns an empty window for "all" or missing range', () => {
            expect(buildWindow('all')).toEqual({});
            expect(buildWindow(undefined)).toEqual({});
            expect(buildWindow('')).toEqual({});
        });

        it('returns an empty window for non-positive or non-numeric ranges', () => {
            expect(buildWindow('abc')).toEqual({});
            expect(buildWindow('0')).toEqual({});
            expect(buildWindow('-7')).toEqual({});
        });

        it('builds a from..to ISO window N days back', () => {
            const before = Date.now();
            const w = buildWindow('7');
            expect(w.from).toBeDefined();
            expect(w.to).toBeDefined();
            expect(typeof w.from).toBe('string');
            expect(typeof w.to).toBe('string');
            // "to" is ~now, "from" is ~7 days earlier
            const toMs = Date.parse(w.to as string);
            const fromMs = Date.parse(w.from as string);
            expect(toMs - fromMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
            expect(toMs - fromMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);
            expect(toMs).toBeGreaterThanOrEqual(before);
        });
    });

    describe('withinWindow', () => {
        const filters = { tenantId: 't1' };
        it('treats missing timestamp as in-window', () => {
            expect(withinWindow(undefined, filters)).toBe(true);
        });
        it('respects from bound', () => {
            expect(withinWindow('2020-01-01', { ...filters, from: '2021-01-01' })).toBe(false);
            expect(withinWindow('2022-01-01', { ...filters, from: '2021-01-01' })).toBe(true);
        });
        it('respects to bound', () => {
            expect(withinWindow('2030-01-01', { ...filters, to: '2021-01-01' })).toBe(false);
            expect(withinWindow('2020-01-01', { ...filters, to: '2021-01-01' })).toBe(true);
        });
    });

    describe('matchesUser', () => {
        const filters = { tenantId: 't1', userId: 'user-42' };
        it('matches when no user filter is set', () => {
            expect(matchesUser({ email: 'x@y' }, { tenantId: 't1' })).toBe(true);
        });
        it('matches by actorId', () => {
            expect(matchesUser({ email: 'other@y' }, filters, 'user-42')).toBe(true);
        });
        it('matches by user email', () => {
            expect(matchesUser({ email: 'alice@y' }, filters, 'someone-else', 'alice@y')).toBe(true);
        });
        it('does not match a different user', () => {
            // actorId != filter and actorEmail != user.email → no match
            expect(matchesUser({ email: 'bob@y' }, filters, 'someone-else', 'carol@y')).toBe(false);
        });
        it('when user object is absent, matches only by actorId', () => {
            expect(matchesUser(null, filters, 'user-42')).toBe(true);
            expect(matchesUser(null, filters, 'wrong')).toBe(false);
        });
    });

    describe('toTimelineEvent', () => {
        it('fills defaults for severity and evidenceRefs', () => {
            const ev = toTimelineEvent({
                id: 'e1', tenantId: 't1', category: 'auth', action: 'login',
                status: 'success', timestamp: '2026-01-01', source: 'test'
            });
            expect(ev.severity).toBe('info');
            expect(ev.evidenceRefs).toEqual([]);
        });
        it('preserves provided severity and evidenceRefs', () => {
            const ev = toTimelineEvent({
                id: 'e1', tenantId: 't1', category: 'alert', action: 'x',
                status: 'open', timestamp: '2026-01-01', source: 'test',
                severity: 'critical', evidenceRefs: ['a', 'b']
            });
            expect(ev.severity).toBe('critical');
            expect(ev.evidenceRefs).toEqual(['a', 'b']);
        });
    });
});
