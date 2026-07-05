/**
 * Tests for traffic-history.service bucketing — the pure logic that folds raw
 * fixed-interval samples into evenly-spaced buckets for the dashboard 1h/24h/7d
 * traffic charts. No database is touched: bucketSamples/normalizeRange are pure.
 */

import {
    bucketSamples,
    normalizeRange,
    type RawSample,
} from '../../services/traffic-history.service';

describe('traffic-history normalizeRange', () => {
    it('accepts the three known ranges', () => {
        expect(normalizeRange('1h')).toBe('1h');
        expect(normalizeRange('24h')).toBe('24h');
        expect(normalizeRange('7d')).toBe('7d');
    });

    it('falls back to 1h for anything unknown', () => {
        expect(normalizeRange(undefined)).toBe('1h');
        expect(normalizeRange('')).toBe('1h');
        expect(normalizeRange('30d')).toBe('1h');
        expect(normalizeRange(42)).toBe('1h');
        expect(normalizeRange(null)).toBe('1h');
    });
});

describe('traffic-history bucketSamples', () => {
    // Fixed clock so bucket boundaries are deterministic.
    const NOW = 1_700_000_000_000;

    it('emits the expected bounded bucket count per range', () => {
        expect(bucketSamples([], '1h', NOW)).toHaveLength(60); // 60 x 1min
        expect(bucketSamples([], '24h', NOW)).toHaveLength(96); // 96 x 15min
        expect(bucketSamples([], '7d', NOW)).toHaveLength(84); // 84 x 2h
    });

    it('emits empty buckets as zero (idle gap is a flat run, not compressed away)', () => {
        const buckets = bucketSamples([], '1h', NOW);
        expect(buckets.every((b) => b.requests === 0 && b.blocked === 0)).toBe(true);
        // Buckets are strictly increasing in time and evenly spaced.
        for (let i = 1; i < buckets.length; i++) {
            expect(buckets[i].t - buckets[i - 1].t).toBe(60 * 1000);
        }
    });

    it('sums samples that fall into the same bucket', () => {
        const bucketMs = 60 * 1000;
        const end = Math.floor(NOW / bucketMs) * bucketMs;
        // The last bucket spans [end, end + bucketMs). Two samples inside it, one
        // in the previous bucket (at its start boundary end - bucketMs).
        const samples: RawSample[] = [
            { ts: end, requests: 10, blocked: 1 },
            { ts: end + 100, requests: 5, blocked: 2 },
            { ts: end - bucketMs, requests: 7, blocked: 3 },
        ];
        const buckets = bucketSamples(samples, '1h', NOW);
        const last = buckets[buckets.length - 1];
        const prev = buckets[buckets.length - 2];
        expect(last.requests).toBe(15);
        expect(last.blocked).toBe(3);
        expect(prev.requests).toBe(7);
        expect(prev.blocked).toBe(3);
    });

    it('drops samples outside the window', () => {
        const windowMs = 60 * 60 * 1000; // 1h
        const samples: RawSample[] = [
            { ts: NOW - windowMs - 10 * 60 * 1000, requests: 999, blocked: 999 }, // too old
            { ts: NOW, requests: 4, blocked: 1 },
        ];
        const buckets = bucketSamples(samples, '1h', NOW);
        const total = buckets.reduce((a, b) => a + b.requests, 0);
        expect(total).toBe(4); // the old sample is excluded
    });

    it('preserves a stable epoch-ms key and a display label per bucket', () => {
        const buckets = bucketSamples([], '24h', NOW);
        expect(typeof buckets[0].t).toBe('number');
        expect(typeof buckets[0].time).toBe('string');
        expect(buckets[0].time.length).toBeGreaterThan(0);
    });
});
