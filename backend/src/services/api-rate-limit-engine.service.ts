import { createHash } from 'crypto';
import logger from '../utils/logger';
import redisService from '../security/redis.service';

const DECISION_SOURCE = 'redis-lua-api-rate-limit';
const FINGERPRINT_TTL_MS = 60 * 60 * 1000;
const RECENT_IP_LIMIT = 10;
const IP_ROTATION_THRESHOLD = 5;
const RECENT_IP_TTL_SECONDS = 60 * 60;
const LATENCY_WINDOW_SIZE = 256;

const API_RATE_LIMIT_LUA = `
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local ip_limit = tonumber(ARGV[4])
local endpoint_limit = tonumber(ARGV[5])
local combined_limit = tonumber(ARGV[6])
local endpoint_active = tonumber(ARGV[7])
local fingerprint = ARGV[8]
local fingerprint_ttl_ms = tonumber(ARGV[9])
local forwarded_for = ARGV[10]
local real_ip = ARGV[11]
local source_ip = ARGV[12]
local session_id = ARGV[13]
local protocol = ARGV[14]
local recent_ip_limit = tonumber(ARGV[15])
local ip_rotation_threshold = tonumber(ARGV[16])
local recent_ip_ttl_seconds = tonumber(ARGV[17])

local function trim(value)
  if not value then
    return ''
  end
  local trimmed = string.gsub(value, '^%s*(.-)%s*$', '%1')
  return trimmed
end

local function add_flag(flags, flag)
  if flag and flag ~= '' then
    table.insert(flags, flag)
  end
end

local function check_dimension(key, limit)
  local count = tonumber(redis.call('INCR', key) or '0')
  local ttl_ms = tonumber(redis.call('PTTL', key) or -1)

  if count == 1 or ttl_ms < 0 then
    redis.call('PEXPIRE', key, window_ms)
    ttl_ms = window_ms
  end

  if ttl_ms < 0 then
    ttl_ms = window_ms
  end

  if count > limit then
    return { 0, 0, ttl_ms }
  end

  local remaining = limit - count
  if remaining < 0 then
    remaining = 0
  end

  return { 1, remaining, ttl_ms }
end

local risk_flags = {}
local block_reason = ''

if source_ip == '' then
  add_flag(risk_flags, 'missing_source_ip')
end

if forwarded_for ~= '' and real_ip ~= '' then
  local forwarded_first = forwarded_for
  local comma_index = string.find(forwarded_for, ',', 1, true)
  if comma_index then
    forwarded_first = string.sub(forwarded_for, 1, comma_index - 1)
  end

  if trim(forwarded_first) ~= trim(real_ip) then
    add_flag(risk_flags, 'ip_header_mismatch')
  end
end

if protocol ~= '' and string.sub(protocol, 1, 2) == 'ws' and session_id == '' then
  add_flag(risk_flags, 'missing_session_id')
end

if fingerprint ~= '' then
  local previous_fingerprint = redis.call('SET', KEYS[5], fingerprint, 'PX', fingerprint_ttl_ms, 'GET')
  if previous_fingerprint and previous_fingerprint ~= fingerprint then
    add_flag(risk_flags, 'fingerprint_changed')
  end
end

if source_ip ~= '' then
  local ip_exists = redis.call('LPOS', KEYS[6], source_ip)
  if not ip_exists then
    local recent_ips = redis.call('LRANGE', KEYS[6], 0, recent_ip_limit - 1)
    if #recent_ips >= ip_rotation_threshold then
      local seen_ips = {}
      local unique_count = 0

      for _, value in ipairs(recent_ips) do
        if not seen_ips[value] then
          seen_ips[value] = true
          unique_count = unique_count + 1
        end
      end

      if unique_count >= ip_rotation_threshold then
        block_reason = 'Rapid IP rotation detected'
      end
    end
  end

  redis.call('LPUSH', KEYS[6], source_ip)
  redis.call('LTRIM', KEYS[6], 0, recent_ip_limit - 1)
  redis.call('EXPIRE', KEYS[6], recent_ip_ttl_seconds)
end

local user_result = check_dimension(KEYS[1], max_requests)
local ip_result = check_dimension(KEYS[2], ip_limit)
local endpoint_result = { 1, max_requests, window_ms }
if endpoint_active == 1 then
  endpoint_result = check_dimension(KEYS[3], endpoint_limit)
end
local combined_result = check_dimension(KEYS[4], combined_limit)

local allowed = 1
local remaining = combined_result[2]
local min_ttl_ms = combined_result[3]

if user_result[1] == 0 then
  allowed = 0
  remaining = 0
  min_ttl_ms = user_result[3]
  block_reason = 'User rate limit exceeded'
elseif ip_result[1] == 0 then
  allowed = 0
  remaining = 0
  min_ttl_ms = ip_result[3]
  block_reason = 'IP rate limit exceeded'
elseif endpoint_active == 1 and endpoint_result[1] == 0 then
  allowed = 0
  remaining = 0
  min_ttl_ms = endpoint_result[3]
  block_reason = 'Endpoint rate limit exceeded'
elseif combined_result[1] == 0 then
  allowed = 0
  remaining = 0
  min_ttl_ms = combined_result[3]
  block_reason = 'Combined rate limit exceeded'
elseif block_reason ~= '' then
  allowed = 0
  remaining = 0
end

local reset_at_ms = now_ms + min_ttl_ms
return { allowed, remaining, reset_at_ms, block_reason, table.concat(risk_flags, ',') }
`;

export interface ApiRateLimitEngineCheckInput {
  identifier: string;
  ip: string;
  bucketScope?: string;
  endpoint?: string;
  maxRequests: number;
  windowMs: number;
  fingerprint: string;
  forwardedFor?: string;
  realIp?: string;
  sessionId?: string;
  protocol?: string;
}

export interface ApiRateLimitEngineCheckResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  decisionSource: string;
  riskFlags: string[];
  reason?: string;
}

export interface ApiRateLimitEngineLatencyStats {
  count: number;
  avg: number | null;
  p95: number | null;
  max: number | null;
  last: number | null;
}

export interface ApiRateLimitEngineMetricsSnapshot {
  decisionEngine: string;
  totalChecks: number;
  fallbackCount: number;
  redisScriptLatencyMs: ApiRateLimitEngineLatencyStats;
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return Number(sorted[index].toFixed(3));
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildRateLimitKey(kind: string, value: string): string {
  return `ratelimit:${kind}:${value || 'unknown'}`;
}

export function hashRateLimitFingerprint(fingerprint: string): string {
  return createHash('sha1').update(fingerprint).digest('hex');
}

export class ApiRateLimitEngineService {
  private scriptSha: string | null = null;
  private scriptLoadingPromise: Promise<string> | null = null;
  private totalChecks = 0;
  private fallbackCount = 0;
  private readonly latencyWindow: number[] = [];
  private lastLatency: number | null = null;

  async check(input: ApiRateLimitEngineCheckInput): Promise<ApiRateLimitEngineCheckResult | null> {
    this.totalChecks += 1;

    if (!redisService.isAvailable()) {
      this.fallbackCount += 1;
      return null;
    }

    try {
      return await this.executeWithLoadedScript(input);
    } catch (error: any) {
      if (this.isNoScriptError(error)) {
        try {
          this.scriptSha = null;
          return await this.executeWithLoadedScript(input);
        } catch (retryError: any) {
          this.fallbackCount += 1;
          logger.warn('API rate limit engine unavailable after Lua reload retry', {
            error: retryError?.message
          });
          return null;
        }
      }

      this.fallbackCount += 1;
      logger.warn('API rate limit engine unavailable, falling back to legacy limiter', {
        error: error?.message
      });
      return null;
    }
  }

  resetMetrics(): void {
    this.totalChecks = 0;
    this.fallbackCount = 0;
    this.latencyWindow.length = 0;
    this.lastLatency = null;
  }

  snapshotMetrics(): ApiRateLimitEngineMetricsSnapshot {
    const count = this.latencyWindow.length;
    const total = this.latencyWindow.reduce((sum, value) => sum + value, 0);
    const max = count > 0 ? Number(Math.max(...this.latencyWindow).toFixed(3)) : null;

    return {
      decisionEngine: DECISION_SOURCE,
      totalChecks: this.totalChecks,
      fallbackCount: this.fallbackCount,
      redisScriptLatencyMs: {
        count,
        avg: count > 0 ? Number((total / count).toFixed(3)) : null,
        p95: percentile(this.latencyWindow, 0.95),
        max,
        last: this.lastLatency
      }
    };
  }

  private async executeWithLoadedScript(input: ApiRateLimitEngineCheckInput): Promise<ApiRateLimitEngineCheckResult> {
    const client = redisService.getClient() as any;
    const sha = await this.ensureScriptLoaded(client);
    const keys = this.buildKeys(input);
    const args = this.buildArgs(input);
    const startedAt = process.hrtime.bigint();
    const rawResult = await client.evalsha(sha, keys.length, ...keys, ...args);
    const latencyMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
    this.recordLatency(latencyMs);
    return this.mapScriptResult(rawResult, input.windowMs);
  }

  private async ensureScriptLoaded(client: any): Promise<string> {
    if (this.scriptSha) {
      return this.scriptSha;
    }

    if (!this.scriptLoadingPromise) {
      this.scriptLoadingPromise = (async () => {
        const sha = await client.script('LOAD', API_RATE_LIMIT_LUA);
        this.scriptSha = String(sha);
        return this.scriptSha;
      })().finally(() => {
        this.scriptLoadingPromise = null;
      });
    }

    return this.scriptLoadingPromise;
  }

  private buildKeys(input: ApiRateLimitEngineCheckInput): string[] {
    const scopedIp = input.bucketScope ? `${input.bucketScope}:${input.ip || '__missing__'}` : input.ip || '__missing__';
    const endpointKey = input.endpoint
      ? buildRateLimitKey('endpoint', `${input.endpoint}:${input.identifier}`)
      : buildRateLimitKey('endpoint', '__disabled__');

    return [
      buildRateLimitKey('user', input.identifier),
      buildRateLimitKey('ip', scopedIp),
      endpointKey,
      buildRateLimitKey('combined', `${input.identifier}:${scopedIp}`),
      buildRateLimitKey('fingerprint', input.identifier),
      buildRateLimitKey('recent-ips', input.identifier)
    ];
  }

  private buildArgs(input: ApiRateLimitEngineCheckInput): string[] {
    const maxRequests = Math.max(Math.floor(input.maxRequests), 1);
    const ipLimit = Math.max(Math.floor(maxRequests * 2), 1);
    const endpointLimit = Math.max(Math.floor(maxRequests / 2), 1);
    const combinedLimit = maxRequests;

    return [
      String(Date.now()),
      String(Math.max(Math.floor(input.windowMs), 1000)),
      String(maxRequests),
      String(ipLimit),
      String(endpointLimit),
      String(combinedLimit),
      input.endpoint ? '1' : '0',
      input.fingerprint,
      String(FINGERPRINT_TTL_MS),
      String(input.forwardedFor || ''),
      String(input.realIp || ''),
      String(input.ip || ''),
      String(input.sessionId || ''),
      String(input.protocol || 'http'),
      String(RECENT_IP_LIMIT),
      String(IP_ROTATION_THRESHOLD),
      String(RECENT_IP_TTL_SECONDS)
    ];
  }

  private mapScriptResult(rawResult: unknown, windowMs: number): ApiRateLimitEngineCheckResult {
    const [allowedRaw, remainingRaw, resetAtMsRaw, reasonRaw, riskFlagsRaw] = Array.isArray(rawResult) ? rawResult : [];
    const resetAtMs = normalizeNumber(resetAtMsRaw, Date.now() + windowMs);
    const riskFlags = String(riskFlagsRaw || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const reason = String(reasonRaw || '').trim();

    return {
      allowed: normalizeNumber(allowedRaw, 0) === 1,
      remaining: Math.max(normalizeNumber(remainingRaw, 0), 0),
      resetAtMs,
      decisionSource: DECISION_SOURCE,
      riskFlags,
      reason: reason || undefined
    };
  }

  private isNoScriptError(error: unknown): boolean {
    return String((error as any)?.message || '').toUpperCase().includes('NOSCRIPT');
  }

  private recordLatency(latencyMs: number): void {
    this.lastLatency = latencyMs;
    this.latencyWindow.push(latencyMs);
    if (this.latencyWindow.length > LATENCY_WINDOW_SIZE) {
      this.latencyWindow.shift();
    }
  }
}

export const apiRateLimitEngineService = new ApiRateLimitEngineService();
