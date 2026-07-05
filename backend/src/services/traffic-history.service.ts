/**
 * Traffic History Service
 *
 * Persists fixed-interval traffic samples to SQLite so the dashboard can render
 * real 1h / 24h / 7d windows. This replaces the previous approach where the
 * stats route kept an in-process ring of ~20 samples taken opportunistically on
 * /stats hits — that buffer could not represent any real time window (all three
 * range labels showed the same ~80s of data) and drew unequal sample intervals
 * as if they were equally spaced.
 *
 * The sampling loop reads the cumulative traffic counters at a fixed cadence and
 * stores the per-interval delta with an absolute epoch-ms timestamp. Queries
 * bucket those raw samples into evenly-spaced buckets spanning the requested
 * window, so gaps in sampling (server idle, restart) render as real gaps rather
 * than being compressed away.
 */

import { getDatabase } from '../config/database';
import { getTrafficStats } from './traffic-stats.service';
import logger from '../utils/logger';

export type TrafficRange = '1h' | '24h' | '7d';

export interface RawSample {
    ts: number; // epoch ms (bucket source timestamp)
    requests: number; // requests observed in the interval ending at ts
    blocked: number; // blocked observed in the interval ending at ts
}

export interface TrafficBucket {
    /** Bucket start, epoch ms — stable key for the x-axis. */
    t: number;
    /** Localized-agnostic display label chosen for the range granularity. */
    time: string;
    requests: number;
    blocked: number;
}

interface RangeSpec {
    windowMs: number;
    bucketMs: number;
}

// Window + bucket granularity per range. Bucket counts stay bounded (60 / 96 / 84)
// so the payload and the chart both stay small regardless of sampling cadence.
const RANGE_SPECS: Record<TrafficRange, RangeSpec> = {
    '1h': { windowMs: 60 * 60 * 1000, bucketMs: 60 * 1000 }, // 60 x 1min
    '24h': { windowMs: 24 * 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 }, // 96 x 15min
    '7d': { windowMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 2 * 60 * 60 * 1000 }, // 84 x 2h
};

// Keep raw samples for the widest window plus a small margin; prune the rest.
const RETENTION_MS = RANGE_SPECS['7d'].windowMs + 60 * 60 * 1000;

export function normalizeRange(value: unknown): TrafficRange {
    return value === '24h' || value === '7d' ? value : '1h';
}

function formatBucketLabel(t: number, range: TrafficRange): string {
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (range === '7d') {
        // MM-DD HH — day granularity dominates a week view
        return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
    }
    // HH:MM for hour/day views
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Pure bucketing: fold raw samples into evenly-spaced buckets covering
 * [now - windowMs, now]. Empty buckets are emitted as zero so the time axis
 * stays uniform (an idle gap is a visible flat run, not a compressed jump).
 *
 * Exported for unit testing without a database.
 */
export function bucketSamples(
    samples: RawSample[],
    range: TrafficRange,
    now: number = Date.now()
): TrafficBucket[] {
    const { windowMs, bucketMs } = RANGE_SPECS[range];
    const bucketCount = Math.round(windowMs / bucketMs);
    // Align the newest bucket to the current bucket boundary.
    const end = Math.floor(now / bucketMs) * bucketMs;
    const start = end - (bucketCount - 1) * bucketMs;

    const buckets: TrafficBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
        const t = start + i * bucketMs;
        buckets.push({ t, time: formatBucketLabel(t, range), requests: 0, blocked: 0 });
    }

    for (const s of samples) {
        if (s.ts < start || s.ts > end + bucketMs) continue;
        const idx = Math.floor((s.ts - start) / bucketMs);
        if (idx < 0 || idx >= bucketCount) continue;
        buckets[idx].requests += s.requests;
        buckets[idx].blocked += s.blocked;
    }

    return buckets;
}

let lastSampledRequests = 0;
let lastSampledBlocked = 0;
let initialized = false;
let samplingTimer: NodeJS.Timeout | null = null;

function ensureInitialized(): void {
    if (initialized) return;
    // Seed the delta baseline from the current cumulative counters so the first
    // persisted sample reflects only traffic seen after startup, not a spike.
    const ts = getTrafficStats();
    lastSampledRequests = ts.packetsProcessed;
    lastSampledBlocked = ts.packetsBlocked;
    initialized = true;
}

/**
 * Capture one fixed-interval sample: the delta since the previous capture,
 * stamped with the current time. Safe to call even if the DB write fails
 * (logged, non-throwing) so the sampling loop never crashes the process.
 */
export function captureSample(now: number = Date.now()): RawSample | null {
    ensureInitialized();
    const ts = getTrafficStats();
    const totalRequests = ts.packetsProcessed;
    const totalBlocked = ts.packetsBlocked;

    // Counters are monotonic within a process lifetime; clamp negatives that
    // would appear if they were ever reset (e.g. a restart mid-loop).
    const requests = Math.max(0, totalRequests - lastSampledRequests);
    const blocked = Math.max(0, totalBlocked - lastSampledBlocked);
    lastSampledRequests = totalRequests;
    lastSampledBlocked = totalBlocked;

    const sample: RawSample = { ts: now, requests, blocked };

    try {
        const db = getDatabase();
        db.run(
            'INSERT INTO traffic_samples (ts_epoch_ms, requests, blocked) VALUES (?, ?, ?)',
            [sample.ts, sample.requests, sample.blocked]
        );
        // Opportunistic retention prune (cheap: indexed range delete).
        db.run('DELETE FROM traffic_samples WHERE ts_epoch_ms < ?', [now - RETENTION_MS]);
    } catch (err: any) {
        logger.warn('traffic-history: failed to persist sample', { error: err?.message });
        return null;
    }

    return sample;
}

/**
 * Read persisted samples for a range and fold them into uniform buckets.
 * Returns an empty array (not throwing) if the DB is unavailable so the route
 * can fall back to an empty-state.
 */
export function getTrafficHistory(range: TrafficRange, now: number = Date.now()): TrafficBucket[] {
    const { windowMs } = RANGE_SPECS[range];
    const since = now - windowMs;
    let rows: RawSample[] = [];
    try {
        const db = getDatabase();
        rows = db
            .prepare(
                'SELECT ts_epoch_ms AS ts, requests, blocked FROM traffic_samples WHERE ts_epoch_ms >= ? ORDER BY ts_epoch_ms ASC'
            )
            .all(since) as RawSample[];
    } catch (err: any) {
        logger.warn('traffic-history: failed to read samples', { error: err?.message });
        return [];
    }
    return bucketSamples(rows, range, now);
}

const SAMPLE_INTERVAL_MS = 15_000;

/** Start the fixed-interval sampling daemon. Idempotent. */
export function startTrafficSamplingLoop(intervalMs: number = SAMPLE_INTERVAL_MS): void {
    if (samplingTimer) return;
    ensureInitialized();
    samplingTimer = setInterval(() => captureSample(), intervalMs);
    if (typeof samplingTimer.unref === 'function') {
        samplingTimer.unref();
    }
    logger.info('traffic-history: sampling loop started', { intervalMs });
}

export function stopTrafficSamplingLoop(): void {
    if (samplingTimer) {
        clearInterval(samplingTimer);
        samplingTimer = null;
    }
}
