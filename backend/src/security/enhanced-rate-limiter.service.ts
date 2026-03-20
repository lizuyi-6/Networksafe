/**
 * Enhanced Rate Limiter Service
 *
 * SECURITY FIX for RISK-001: IP Spoofing Bypass
 *
 * Features:
 * - Multi-dimensional rate limiting (user + IP)
 * - IP spoofing detection and prevention
 * - Distributed coordination via Redis
 * - Memory fallback for Redis failures
 * - Configurable limits per endpoint
 */

import logger from '../utils/logger';
import redisService from './redis.service';

// SECURITY FIX: Lua script for atomic rate limit check and increment
// This prevents race conditions between get() and incr() operations
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local resetKey = KEYS[2]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local resetTime = tonumber(ARGV[3])

local current = tonumber(redis.call('GET', key))
if current == nil then
    redis.call('SETEX', key, math.ceil(windowMs / 1000), '1')
    redis.call('SETEX', resetKey, math.ceil(windowMs / 1000), tostring(resetTime))
    return {1, limit - 1, resetTime}
end

if current >= limit then
    local storedReset = tonumber(redis.call('GET', resetKey)) or resetTime
    return {0, 0, storedReset}
end

local newCount = redis.call('INCR', key)
return {1, limit - newCount, resetTime}
`;

// Cache for compiled Lua script SHA
let rateLimitScriptSha: string | null = null;

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  reason?: string;
}

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

export class EnhancedRateLimiter {
  private memoryFallback: Map<string, RateLimitInfo> = new Map();
  // SECURITY FIX: Lock for memory fallback to prevent race conditions
  private memoryLocks: Map<string, Promise<void>> = new Map();
  private readonly DEFAULT_LIMITS: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60000,
  };

  /**
   * SECURITY FIX: Load and cache the Lua script for atomic rate limiting
   */
  private async loadRateLimitScript(): Promise<string> {
    if (rateLimitScriptSha) {
      return rateLimitScriptSha;
    }

    try {
      const client = redisService.getClient();
      const sha = await client.script('LOAD', RATE_LIMIT_SCRIPT);
      rateLimitScriptSha = typeof sha === 'string' ? sha : String(sha);
      logger.info('Rate limit Lua script loaded', { sha: rateLimitScriptSha });
      return rateLimitScriptSha;
    } catch (error) {
      logger.error('Failed to load rate limit Lua script', { error });
      throw error;
    }
  }

  async checkRateLimit(params: {
    identifier: string;
    ip: string;
    endpoint?: string;
    config?: Partial<RateLimitConfig>;
  }): Promise<RateLimitResult> {
    const { identifier, ip, endpoint, config } = params;
    const finalConfig = { ...this.DEFAULT_LIMITS, ...config };

    const now = Date.now();
    const resetTime = now + finalConfig.windowMs;

    const userKey = `ratelimit:user:${identifier}`;
    const ipKey = `ratelimit:ip:${ip}`;
    const endpointKey = endpoint ? `ratelimit:endpoint:${endpoint}:${identifier}` : null;
    const combinedKey = `ratelimit:combined:${identifier}:${ip}`;

    try {
      const results = await Promise.all([
        this.checkDimension(userKey, finalConfig.maxRequests, finalConfig.windowMs),
        this.checkDimension(ipKey, Math.floor(finalConfig.maxRequests * 2), finalConfig.windowMs),
        endpointKey ? this.checkDimension(endpointKey, Math.floor(finalConfig.maxRequests / 2), finalConfig.windowMs) : null,
        this.checkDimension(combinedKey, finalConfig.maxRequests, finalConfig.windowMs),
      ]);

      const userResult = results[0];
      const ipResult = results[1];
      const endpointResult = results[2];
      const combinedResult = results[3];

      if (!userResult.allowed) {
        return {
          ...userResult,
          reason: 'User rate limit exceeded',
        };
      }

      if (!ipResult.allowed) {
        logger.warn('IP rate limit exceeded', {
          ip,
          identifier,
          endpoint,
        });
        return {
          ...ipResult,
          reason: 'IP rate limit exceeded',
        };
      }

      if (endpointResult && !endpointResult.allowed) {
        return {
          ...endpointResult,
          reason: 'Endpoint rate limit exceeded',
        };
      }

      if (!combinedResult.allowed) {
        return {
          ...combinedResult,
          reason: 'Combined rate limit exceeded',
        };
      }

      return combinedResult;

    } catch (error) {
      logger.error('Rate limit check failed', { error, identifier, ip });
      // SECURITY FIX: Fail closed - reject request if rate limit check fails
      // This prevents attackers from bypassing rate limits by causing failures
      return {
        allowed: false,
        limit: finalConfig.maxRequests,
        remaining: 0,
        resetTime: new Date(resetTime),
        reason: 'Rate limit check failed - request rejected for security',
      };
    }
  }

  private async checkDimension(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const resetTime = now + windowMs;

    if (!redisService.isAvailable()) {
      return this.checkDimensionMemoryWithLock(key, limit, windowMs);
    }

    try {
      const client = redisService.getClient();
      const resetKey = `${key}:reset`;

      // SECURITY FIX: Use atomic Lua script to prevent race conditions
      try {
        const sha = await this.loadRateLimitScript();
        const result = await client.evalsha(sha, 2, key, resetKey, limit.toString(), windowMs.toString(), resetTime.toString()) as [number, number, number];

        const [allowed, remaining, actualResetTime] = result;

        return {
          allowed: allowed === 1,
          limit,
          remaining: Math.max(remaining, 0),
          resetTime: new Date(actualResetTime),
        };
      } catch (evalError: any) {
        // If script not found (NOSCRIPT), reload it
        if (evalError.message?.includes('NOSCRIPT')) {
          rateLimitScriptSha = null;
          const sha = await this.loadRateLimitScript();
          const result = await client.evalsha(sha, 2, key, resetKey, limit.toString(), windowMs.toString(), resetTime.toString()) as [number, number, number];

          const [allowed, remaining, actualResetTime] = result;

          return {
            allowed: allowed === 1,
            limit,
            remaining: Math.max(remaining, 0),
            resetTime: new Date(actualResetTime),
          };
        }
        throw evalError;
      }

    } catch (error) {
      logger.warn('Redis rate limit failed, using memory fallback', { error, key });
      return this.checkDimensionMemoryWithLock(key, limit, windowMs);
    }
  }

  /**
   * SECURITY FIX: Memory fallback with proper locking to prevent race conditions
   */
  private async checkDimensionMemoryWithLock(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    // Wait for any existing lock on this key
    while (this.memoryLocks.has(key)) {
      await this.memoryLocks.get(key);
    }

    // Create lock for this operation
    let lockResolver: () => void;
    const lockPromise = new Promise<void>(resolve => { lockResolver = resolve; });
    this.memoryLocks.set(key, lockPromise);

    try {
      return this.checkDimensionMemory(key, limit, windowMs);
    } finally {
      this.memoryLocks.delete(key);
      lockResolver!();
    }
  }

  private checkDimensionMemory(
    key: string,
    limit: number,
    windowMs: number
  ): RateLimitResult {
    const now = Date.now();
    const info = this.memoryFallback.get(key);

    if (!info || now > info.resetTime) {
      this.memoryFallback.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });

      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetTime: new Date(now + windowMs),
      };
    }

    if (info.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime: new Date(info.resetTime),
      };
    }

    info.count++;
    return {
      allowed: true,
      limit,
      remaining: limit - info.count,
      resetTime: new Date(info.resetTime),
    };
  }

  async detectIPSpoofing(params: {
    identifier: string;
    ip: string;
  }): Promise<{ suspicious: boolean; reason?: string }> {
    const { identifier, ip } = params;

    if (!redisService.isAvailable()) {
      return { suspicious: false };
    }

    const key = `ips:user:${identifier}`;

    try {
      const recentIPs = await redisService.getClient().lrange(key, 0, -1);

      const ipExists = recentIPs.some((entry: string) => {
        try {
          const data = JSON.parse(entry);
          return data.ip === ip;
        } catch {
          return false;
        }
      });

      await redisService.getClient().lpush(key, JSON.stringify({
        ip,
        timestamp: Date.now(),
      }));

      await redisService.getClient().ltrim(key, 0, 9);
      await redisService.getClient().expire(key, 3600);

      if (recentIPs.length >= 5) {
        const uniqueIPs = new Set();
        recentIPs.forEach((entry: string) => {
          try {
            const data = JSON.parse(entry);
            uniqueIPs.add(data.ip);
          } catch {}
        });

        if (uniqueIPs.size >= 5 && !ipExists) {
          logger.error('IP spoofing detected - rapid IP rotation', {
            identifier,
            uniqueIPCount: uniqueIPs.size,
            currentIP: ip,
          });

          return {
            suspicious: true,
            reason: `Rapid IP rotation detected: ${uniqueIPs.size} different IPs in 1 hour`,
          };
        }
      }

      return { suspicious: false };

    } catch (error) {
      logger.error('IP spoofing detection failed', { error });
      return { suspicious: false };
    }
  }

  cleanup(): void {
    if (!this.memoryFallback) {
      return;
    }
    const now = Date.now();
    for (const [key, info] of this.memoryFallback.entries()) {
      if (now > info.resetTime) {
        this.memoryFallback.delete(key);
      }
    }
  }

  async resetRateLimit(identifier: string): Promise<void> {
    const pattern = `ratelimit:*:${identifier}*`;
    try {
      logger.info('Rate limit reset requested', { identifier, pattern });
    } catch (error) {
      logger.error('Failed to reset rate limit', { error, identifier });
    }
  }

  async getStats(identifier: string): Promise<{
    userLimit: { used: number; limit: number };
    ipLimit?: { used: number; limit: number };
  }> {
    return {
      userLimit: { used: 0, limit: 100 },
    };
  }
}

const enhancedRateLimiterInstance = new EnhancedRateLimiter();
export default enhancedRateLimiterInstance;

setInterval(() => {
  enhancedRateLimiterInstance.cleanup();
}, 5 * 60 * 1000);
