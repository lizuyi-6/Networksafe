/**
 * Tests for traffic-stats-helper — sanitization of agent-reported traffic stats
 * to prevent poisoning (e.g. a compromised agent reporting 1.5 TB/s, 250% CPU,
 * or NaN to overflow dashboard counters). Pure logic, security-critical.
 */

import {
    sanitizeTrafficStats,
    TRAFFIC_STAT_LIMITS,
    type SanitizeResult
} from '../../websocket/traffic-stats-helper';

describe('sanitizeTrafficStats', () => {
    it('accepts a well-formed stats payload within limits', () => {
        const result = sanitizeTrafficStats({
            bytesProcessed: 1000,
            packetsProcessed: 50,
            packetsAllowed: 40,
            packetsBlocked: 10,
            packetsInspected: 50,
            responseTime: 15,
            cpuUsage: 5.5,
            memoryUsage: 42,
            activeFlows: [{ id: 'flow-1' }]
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.stats.bytesProcessed).toBe(1000);
            expect(result.stats.cpuUsage).toBe(5.5);
            expect(result.stats.activeFlows).toHaveLength(1);
        }
    });

    it('rejects null / non-object input', () => {
        expect(sanitizeTrafficStats(null).ok).toBe(false);
        expect(sanitizeTrafficStats('string').ok).toBe(false);
        expect(sanitizeTrafficStats(undefined).ok).toBe(false);
    });

    it('rejects bytesProcessed exceeding the physical limit', () => {
        const result = sanitizeTrafficStats({ bytesProcessed: TRAFFIC_STAT_LIMITS.bytesProcessed + 1 });
        expect(result.ok).toBe(false);
        if (!result.ok) { expect(result.reason).toContain('bytesProcessed_out_of_range'); }
    });

    it('rejects negative values', () => {
        const result = sanitizeTrafficStats({ cpuUsage: -1 });
        expect(result.ok).toBe(false);
    });

    it('rejects NaN and Infinity', () => {
        expect(sanitizeTrafficStats({ cpuUsage: NaN }).ok).toBe(false);
        expect(sanitizeTrafficStats({ responseTime: Infinity }).ok).toBe(false);
    });

    it('rejects CPU usage over 100%', () => {
        expect(sanitizeTrafficStats({ cpuUsage: 101 }).ok).toBe(false);
    });

    it('rejects memory usage over 100%', () => {
        expect(sanitizeTrafficStats({ memoryUsage: 150 }).ok).toBe(false);
    });

    it('rejects activeFlows over the array-length limit', () => {
        const tooMany = Array(TRAFFIC_STAT_LIMITS.activeFlows + 1).fill({ id: 'x' });
        expect(sanitizeTrafficStats({ activeFlows: tooMany }).ok).toBe(false);
    });

    it('rejects activeFlows that is not an array', () => {
        expect(sanitizeTrafficStats({ activeFlows: 42 }).ok).toBe(false);
    });

    it('accepts activeFlows as an empty array', () => {
        expect(sanitizeTrafficStats({ activeFlows: [] }).ok).toBe(true);
    });

    it('accepts values exactly at the limit (boundary)', () => {
        const result = sanitizeTrafficStats({
            cpuUsage: 100,
            memoryUsage: 100,
            responseTime: TRAFFIC_STAT_LIMITS.responseTime
        });
        expect(result.ok).toBe(true);
    });

    it('skips undefined / null fields (does not reject)', () => {
        const result = sanitizeTrafficStats({ bytesProcessed: undefined, cpuUsage: null });
        expect(result.ok).toBe(true);
    });

    it('accepts an empty object (all fields optional)', () => {
        expect(sanitizeTrafficStats({}).ok).toBe(true);
    });
});
