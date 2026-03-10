import logger from '../utils/logger';
import redisService from '../security/redis.service';
import { fastpathClientService, FastpathCheckResponse } from './fastpath-client.service';

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
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupTimer.unref?.();
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

    const fallback = await this.checkFallback(input.key, input.limit, input.windowMs);
    return {
      ...fallback,
      usedFallback: true,
      decisionSource: fallback.decisionSource || 'socket-fallback'
    };
  }

  close(): void {
    clearInterval(this.cleanupTimer);
  }

  private async checkFallback(key: string, limit: number, windowMs: number): Promise<FastpathCheckResponse> {
    const namespacedKey = `socket:${key}`;
    const now = Date.now();
    const resetTime = now + windowMs;

    if (!redisService.isAvailable()) {
      return this.checkMemoryFallback(namespacedKey, limit, windowMs);
    }

    try {
      const client = redisService.getClient();
      const redisKey = `ratelimit:${namespacedKey}`;
      const current = await client.get(redisKey);
      if (current === null) {
        await client.setex(redisKey, Math.max(Math.ceil(windowMs / 1000), 1), '1');
        await client.setex(`${redisKey}:reset`, Math.max(Math.ceil(windowMs / 1000), 1), String(resetTime));
        return {
          allowed: true,
          remaining: limit - 1,
          resetAt: new Date(resetTime).toISOString(),
          resetAtMs: resetTime,
          decisionSource: 'redis-fallback',
          riskFlags: []
        };
      }

      const count = Number.parseInt(current, 10);
      if (count >= limit) {
        const storedReset = await client.get(`${redisKey}:reset`);
        const resolvedReset = storedReset ? Number.parseInt(storedReset, 10) || resetTime : resetTime;
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(resolvedReset).toISOString(),
          resetAtMs: resolvedReset,
          decisionSource: 'redis-fallback',
          riskFlags: []
        };
      }

      const nextCount = await client.incr(redisKey);
      return {
        allowed: true,
        remaining: Math.max(limit - nextCount, 0),
        resetAt: new Date(resetTime).toISOString(),
        resetAtMs: resetTime,
        decisionSource: 'redis-fallback',
        riskFlags: []
      };
    } catch (error: any) {
      logger.warn('Redis websocket rate limit failed, using memory fallback', {
        key: namespacedKey,
        error: error?.message
      });
      return this.checkMemoryFallback(namespacedKey, limit, windowMs);
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
