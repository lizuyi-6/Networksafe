/**
 * SECURITY FIX (Sprint 5 Wave 8 · F22 · V12.22):
 *
 * Pure helpers for `agent:traffic_stats` poisoning defense. Exported
 * here so they can be unit-tested without spinning up the full
 * AgentGateway / socket layer. The handlers in `agent-gateway.ts`
 * re-use the same logic.
 */

export const TRAFFIC_STAT_LIMITS = {
  bytesProcessed: 1e12,
  packetsProcessed: 1e9,
  packetsAllowed: 1e9,
  packetsBlocked: 1e9,
  packetsInspected: 1e9,
  responseTime: 60_000,
  cpuUsage: 100,
  memoryUsage: 100,
  activeFlows: 200
} as const;

export type SanitizeResult =
  | { ok: true; stats: Record<string, any> }
  | { ok: false; reason: string };

/**
 * Validate a `stats` payload against physical limits. Anything
 * obviously out of range (1.5 TB/sec, -1ms latency, 250% CPU,
 * 50_000 active flows, NaN, Infinity) is rejected with a `reason`
 * the audit log can pin down.
 */
export function sanitizeTrafficStats(raw: any): SanitizeResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'stats_not_object' };
  }
  const sanitized: Record<string, any> = {};
  for (const [key, limit] of Object.entries(TRAFFIC_STAT_LIMITS)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    if (key === 'activeFlows') {
      // activeFlows is an array, not a number; limit is the array length.
      if (!Array.isArray(raw[key])) {
        return { ok: false, reason: `${key}_not_array` };
      }
      if (raw[key].length > limit) {
        return { ok: false, reason: `${key}_out_of_range(${raw[key].length} > ${limit})` };
      }
      sanitized[key] = raw[key];
      continue;
    }
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < 0 || value > limit) {
      return { ok: false, reason: `${key}_out_of_range(${raw[key]} > ${limit})` };
    }
    sanitized[key] = value;
  }
  return { ok: true, stats: sanitized };
}
