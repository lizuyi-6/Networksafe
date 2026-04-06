/**
 * API Request Tracker Service
 *
 * Pure state container for API request counting and history tracking.
 * Extracted from stats.routes.ts – no Express/Router dependency.
 */

import { getTrafficStats } from './traffic-stats.service';
import { isDemoMode } from '../config/app-mode';

export interface HistoryPoint {
    time: string;
    requests: number;
    blocked: number;
}

export interface AttackOrigin {
    country: string;
    countryCode: string;
    count: number;
    percentage: number;
}

const historyBuffer: HistoryPoint[] = [];
let lastSampledRequests = 0;
let lastSampledBlocked = 0;
let lastSampleTime = Date.now();

let apiRequestCount = 0;
let apiBlockedCount = 0;

let cachedAttackOrigins: AttackOrigin[] = [];

export function sampleHistory(total: number, blocked: number): void {
    const now = Date.now();
    if (now - lastSampleTime < 2000) return;

    const label = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    historyBuffer.push({
        time: label,
        requests: total - lastSampledRequests,
        blocked: blocked - lastSampledBlocked
    });

    if (historyBuffer.length > 20) {
        historyBuffer.shift();
    }

    lastSampledRequests = total;
    lastSampledBlocked = blocked;
    lastSampleTime = now;
}

export function recordApiRequest(blocked: boolean = false, sourceIP?: string): void {
    apiRequestCount++;
    if (blocked) apiBlockedCount++;
    const ts = getTrafficStats();
    ts.packetsProcessed = apiRequestCount;
    ts.packetsBlocked = apiBlockedCount;
    ts.packetsAllowed = apiRequestCount - apiBlockedCount;

    // Track blocked request origins by source IP
    if (blocked && sourceIP) {
        const existing = cachedAttackOrigins.find(o => o.country === sourceIP);
        if (existing) {
            existing.count++;
        } else {
            cachedAttackOrigins.push({ country: sourceIP, countryCode: 'Unknown', count: 1, percentage: 0 });
        }
        // Recalculate percentages
        const total = cachedAttackOrigins.reduce((s, o) => s + o.count, 0);
        for (const o of cachedAttackOrigins) {
            o.percentage = total > 0 ? (o.count / total) * 100 : 0;
        }
    }
}

export function getHistoryBuffer(): HistoryPoint[] {
    return historyBuffer;
}

export function getCachedAttackOrigins(): AttackOrigin[] {
    return cachedAttackOrigins;
}

export function setCachedAttackOrigins(origins: AttackOrigin[]): void {
    cachedAttackOrigins = origins;
}

export function getApiRequestCount(): number {
    return apiRequestCount;
}

export function getApiBlockedCount(): number {
    return apiBlockedCount;
}

// Seed initial traffic data so dashboard is not all zeros on startup
// Only seed in demo mode - production mode starts with zero data
function seedInitialTraffic(): void {
    const ts = getTrafficStats();
    apiRequestCount = 147;
    apiBlockedCount = 12;
    ts.packetsProcessed = apiRequestCount;
    ts.packetsBlocked = apiBlockedCount;
    ts.packetsAllowed = apiRequestCount - apiBlockedCount;
    ts.bytesProcessed = apiRequestCount * 2400;

    // Seed some threat categories from attack traffic
    const threats = [
        { type: 'SQL Injection', count: 3, severity: 'critical' },
        { type: 'XSS Attack', count: 2, severity: 'high' },
        { type: 'Path Traversal', count: 4, severity: 'high' },
        { type: 'Command Injection', count: 1, severity: 'critical' },
        { type: 'Brute Force', count: 2, severity: 'medium' },
    ];
    for (const t of threats) {
        ts.threats.set(t.type, { type: t.type, count: t.count, severity: t.severity });
    }

    // Seed some active flows
    ts.activeFlows = [
        { id: 'flow-1', source: '192.168.1.100', dest: '10.0.0.1', port: 443, protocol: 'TCP', state: 'ESTABLISHED', bytes: 12400 },
        { id: 'flow-2', source: '172.16.0.50', dest: '10.0.0.1', port: 80, protocol: 'TCP', state: 'ESTABLISHED', bytes: 8200 },
        { id: 'flow-3', source: '203.0.113.45', dest: '10.0.0.1', port: 22, protocol: 'TCP', state: 'TIME_WAIT', bytes: 1500 },
    ];
}

// Only seed data in demo mode - production starts clean
if (isDemoMode()) {
    seedInitialTraffic();
}
