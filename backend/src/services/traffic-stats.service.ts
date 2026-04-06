/**
 * Traffic Stats Service
 *
 * Pure state container for traffic statistics.
 * Extracted from ai-system.routes.ts – no Express/Router dependency.
 */

import { DetectionAttackFamily } from './detection-engine';

export interface TrafficStats {
    packetsProcessed: number;
    packetsAllowed: number;
    packetsBlocked: number;
    packetsInspected: number;
    bytesProcessed: number;
    startTime: Date;
    threats: Map<string, { type: string; count: number; severity: string }>;
    activeFlows: any[];
}

const trafficStats: TrafficStats = {
    packetsProcessed: 0,
    packetsAllowed: 0,
    packetsBlocked: 0,
    packetsInspected: 0,
    bytesProcessed: 0,
    startTime: new Date(),
    threats: new Map(),
    activeFlows: []
};

export function getTrafficStats(): TrafficStats {
    return trafficStats;
}

export function normalizeDetectionAIConfidence(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(1, numeric));
}

export function normalizeDetectionAttackFamily(value: unknown): DetectionAttackFamily | undefined {
    const normalized = String(value || '').toLowerCase();
    if (
        normalized === 'benign' ||
        normalized === 'sqli' ||
        normalized === 'xss' ||
        normalized === 'path_traversal' ||
        normalized === 'command_injection' ||
        normalized === 'ssrf' ||
        normalized === 'automation' ||
        normalized === 'other'
    ) {
        return normalized;
    }
    return undefined;
}
