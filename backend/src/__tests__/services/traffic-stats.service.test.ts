/**
 * Tests for the pure state-container services extracted from the routes layer:
 * traffic-stats (normalizers) and api-request-tracker (counting + percentages).
 * These are boundary-heavy pure functions with no DB, so they reward unit coverage.
 */

import {
    getTrafficStats,
    normalizeDetectionAIConfidence,
    normalizeDetectionAttackFamily
} from '../../services/traffic-stats.service';
import {
    recordApiRequest,
    getApiRequestCount,
    getApiBlockedCount,
    getCachedAttackOrigins,
    setCachedAttackOrigins,
    type AttackOrigin
} from '../../services/api-request-tracker.service';

describe('traffic-stats normalizers', () => {
    it('normalizeDetectionAIConfidence clamps to [0,1] and coerces non-numbers to 0', () => {
        expect(normalizeDetectionAIConfidence(0.5)).toBe(0.5);
        expect(normalizeDetectionAIConfidence(1)).toBe(1);
        expect(normalizeDetectionAIConfidence(0)).toBe(0);
        expect(normalizeDetectionAIConfidence(1.7)).toBe(1);
        expect(normalizeDetectionAIConfidence(-0.3)).toBe(0);
        expect(normalizeDetectionAIConfidence(Number.NaN)).toBe(0);
        expect(normalizeDetectionAIConfidence(Number.POSITIVE_INFINITY)).toBe(0);
        expect(normalizeDetectionAIConfidence('0.9')).toBe(0.9); // Number('0.9') is finite
        expect(normalizeDetectionAIConfidence('not-a-number')).toBe(0);
        expect(normalizeDetectionAIConfidence(undefined)).toBe(0);
        expect(normalizeDetectionAIConfidence(null)).toBe(0);
    });

    it('normalizeDetectionAttackFamily accepts known families and rejects unknown', () => {
        for (const family of ['benign', 'sqli', 'xss', 'path_traversal', 'command_injection', 'ssrf', 'automation', 'other']) {
            expect(normalizeDetectionAttackFamily(family)).toBe(family);
        }
        // case-insensitive
        expect(normalizeDetectionAttackFamily('SQLI')).toBe('sqli');
        expect(normalizeDetectionAttackFamily('XSS')).toBe('xss');
        // rejected
        expect(normalizeDetectionAttackFamily('dropper')).toBeUndefined();
        expect(normalizeDetectionAttackFamily('')).toBeUndefined();
        expect(normalizeDetectionAttackFamily(null)).toBeUndefined();
        expect(normalizeDetectionAttackFamily(undefined)).toBeUndefined();
    });

    it('getTrafficStats returns a mutable shared stats object with a threats map', () => {
        const stats = getTrafficStats();
        expect(stats).toBeDefined();
        expect(stats.threats).toBeInstanceOf(Map);
        expect(Array.isArray(stats.activeFlows)).toBe(true);
        // Same reference each call (shared state container)
        expect(getTrafficStats()).toBe(stats);
    });
});

describe('api-request-tracker', () => {
    it('counts requests and blocked requests', () => {
        const before = getApiRequestCount();
        const beforeBlocked = getApiBlockedCount();
        recordApiRequest(false);
        recordApiRequest(true, '10.0.0.1');
        recordApiRequest(false);
        expect(getApiRequestCount()).toBe(before + 3);
        expect(getApiBlockedCount()).toBe(beforeBlocked + 1);
    });

    it('tracks blocked origins and recomputes percentages', () => {
        setCachedAttackOrigins([]);
        recordApiRequest(true, '203.0.113.10');
        recordApiRequest(true, '203.0.113.10');
        recordApiRequest(true, '198.51.100.7');

        const origins = getCachedAttackOrigins();
        expect(origins).toHaveLength(2);
        const a = origins.find((o) => o.country === '203.0.113.10');
        const b = origins.find((o) => o.country === '198.51.100.7');
        expect(a?.count).toBe(2);
        expect(b?.count).toBe(1);
        // 2 of 3 ≈ 66.67%, 1 of 3 ≈ 33.33%
        expect(a?.percentage).toBeCloseTo((2 / 3) * 100, 1);
        expect(b?.percentage).toBeCloseTo((1 / 3) * 100, 1);
        // percentages sum to ~100
        const sum = origins.reduce((s, o) => s + o.percentage, 0);
        expect(sum).toBeCloseTo(100, 1);
    });

    it('setCachedAttackOrigins replaces the origin set', () => {
        const replacement: AttackOrigin[] = [
            { country: '1.2.3.4', countryCode: 'XX', count: 5, percentage: 100 }
        ];
        setCachedAttackOrigins(replacement);
        expect(getCachedAttackOrigins()).toEqual(replacement);
    });

    it('non-blocked requests do not create attack origins', () => {
        setCachedAttackOrigins([]);
        recordApiRequest(false, '9.9.9.9');
        recordApiRequest(false);
        expect(getCachedAttackOrigins()).toHaveLength(0);
    });
});
