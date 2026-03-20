import logger from '../utils/logger';
import redisService from '../security/redis.service';
import { fastpathClientService, FastpathCheckResponse } from './fastpath-client.service';

// SECURITY FIX: Lua script for atomic rate limit check and increment
const SOCKET_RATE_LIMIT_SCRIPT = `
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
let socketRateLimitScriptSha: string | null = null;

interface MemoryRateLimitEntry {
  count: number;
  resetTime: number;
}

export interface SocketRateLimitInput {
  tenantId?: string;
  key: string;
  limit: number;
  windowMs: number;
  sourceIp?: string;
  sessionId?: string;
  headers?: Record<string, any>;
  protocol: string;
  preferFastpath?: boolean;
}

export interface SocketRateLimitResult extends FastpathCheckResponse {
  usedFallback: boolean;
}

class SocketRateLimitService {
  private readonly memoryFallback = new Map<string, MemoryRateLimitEntry>();
  // SECURITY FIX: Lock map for preventing race conditions in memory fallback
  private readonly memoryLocks = new Map<string, Promise<void>>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  /**
   * SECURITY FIX: Load and cache the Lua script for atomic rate limiting
   */
  private async loadRateLimitScript(): Promise<string> {
    if (socketRateLimitScriptSha) {
      return socketRateLimitScriptSha;
    }

    try {
      const client = redisService.getClient();
      const sha = await client.script('LOAD', SOCKET_RATE_LIMIT_SCRIPT);
      socketRateLimitScriptSha = typeof sha === 'string' ? sha : String(sha);
      logger.info('Socket rate limit Lua script loaded', { sha: socketRateLimitScriptSha });
      return socketRateLimitScriptSha;
    } catch (error) {
      logger.error('Failed to load socket rate limit Lua script', { error });
      throw error;
    }
  }

  async check(input: SocketRateLimitInput): Promise<SocketRateLimitResult> {
    if (input.preferFastpath !== false) {
      const fastpath = await fastpathClientService.checkSocket(input);
      if (fastpath) {
        return {
          ...fastpath,
          usedFallback: false
        };
      }
    }

    const fallback = await this.checkFallback(input.tenantId || 'anonymous', input.key, input.limit, input.windowMs);
    return {
      ...fallback,
      usedFallback: true,
      decisionSource: fallback.decisionSource || 'socket-fallback'
    };
  }

  close(): void {
    clearInterval(this.cleanupTimer);
  }

  private async checkFallback(tenantId: string, key: string, limit: number, windowMs: number): Promise<FastpathCheckResponse> {
    const namespacedKey = `socket:${tenantId}:${key}`;
    const now = Date.now();
    const resetTime = now + windowMs;

    if (!redisService.isAvailable()) {
      return this.checkMemoryFallbackWithLock(namespacedKey, limit, windowMs);
    }

    try {
      const client = redisService.getClient();
      const redisKey = `ratelimit:${namespacedKey}`;
      const resetKey = `${redisKey}:reset`;

      // SECURITY FIX: Use atomic Lua script to prevent race conditions
      try {
        const sha = await this.loadRateLimitScript();
        const result = await client.evalsha(sha, 2, redisKey, resetKey, limit.toString(), windowMs.toString(), resetTime.toString()) as [number, number, number];

        const [allowed, remaining, actualResetTime] = result;

        return {
          allowed: allowed === 1,
          remaining: Math.max(remaining, 0),
          resetAt: new Date(actualResetTime).toISOString(),
          resetAtMs: actualResetTime,
          decisionSource: 'redis-fallback',
          riskFlags: []
        };
      } catch (evalError: any) {
        // If script not found (NOSCRIPT), reload it
        if (evalError.message?.includes('NOSCRIPT')) {
          socketRateLimitScriptSha = null;
          const sha = await this.loadRateLimitScript();
          const result = await client.evalsha(sha, 2, redisKey, resetKey, limit.toString(), windowMs.toString(), resetTime.toString()) as [number, number, number];

          const [allowed, remaining, actualResetTime] = result;

          return {
            allowed: allowed === 1,
            remaining: Math.max(remaining, 0),
            resetAt: new Date(actualResetTime).toISOString(),
            resetAtMs: actualResetTime,
            decisionSource: 'redis-fallback',
            riskFlags: []
          };
        }
        throw evalError;
      }
    } catch (error: any) {
      logger.warn('Redis websocket rate limit failed, using memory fallback', {
        key: namespacedKey,
        error: error?.message
      });
      return this.checkMemoryFallbackWithLock(namespacedKey, limit, windowMs);
    }
  }

  /**
   * SECURITY FIX: Memory fallback with proper locking to prevent race conditions
   */
  private async checkMemoryFallbackWithLock(key: string, limit: number, windowMs: number): Promise<FastpathCheckResponse> {
    // Wait for any existing lock on this key
    while (this.memoryLocks.has(key)) {
      await this.memoryLocks.get(key);
    }

    // Create lock for this operation
    let lockResolver: () => void;
    const lockPromise = new Promise<void>(resolve => { lockResolver = resolve; });
    this.memoryLocks.set(key, lockPromise);

    try {
      return this.checkMemoryFallback(key, limit, windowMs);
    } finally {
      this.memoryLocks.delete(key);
      lockResolver!();
    }
  }

  private checkMemoryFallback(key: string, limit: number, windowMs: number): FastpathCheckResponse {
    const now = Date.now();
    const current = this.memoryFallback.get(key);

    if (!current || now >= current.resetTime) {
      const resetTime = now + windowMs;
      this.memoryFallback.set(key, {
        count: 1,
        resetTime
      });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(resetTime).toISOString(),
        resetAtMs: resetTime,
        decisionSource: 'memory-fallback',
        riskFlags: []
      };
    }

    if (current.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(current.resetTime).toISOString(),
        resetAtMs: current.resetTime,
        decisionSource: 'memory-fallback',
        riskFlags: []
      };
    }

    current.count += 1;
    return {
      allowed: true,
      remaining: Math.max(limit - current.count, 0),
      resetAt: new Date(current.resetTime).toISOString(),
      resetAtMs: current.resetTime,
      decisionSource: 'memory-fallback',
      riskFlags: []
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryFallback.entries()) {
      if (now >= entry.resetTime) {
        this.memoryFallback.delete(key);
      }
    }
  }
}

export const socketRateLimitService = new SocketRateLimitService();
