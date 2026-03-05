import { Request, Response, NextFunction } from 'express';
import redisService from './redis.service';
import { RATE_LIMIT, HTTP_STATUS, REDIS_KEYS } from '../config';
import logger from '../utils/logger';

function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetTime: number
): void {
  res.set('X-RateLimit-Limit', limit.toString());
  res.set('X-RateLimit-Remaining', remaining.toString());
  res.set('X-RateLimit-Reset', resetTime.toString());
}

interface RateLimitState {
  count: number;
  windowStart: number;
  limit: number;
}

const memoryRateLimits: Map<string, RateLimitState> = new Map();

function checkMemoryRateLimit(userId: string, limit: number): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const state = memoryRateLimits.get(userId);

  if (!state || now - state.windowStart >= RATE_LIMIT.WINDOW_SECONDS * 1000) {
    memoryRateLimits.set(userId, {
      count: 1,
      windowStart: now,
      limit: limit,
    });
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime: Math.ceil((now + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000),
    };
  }

  state.count++;
  const remaining = Math.max(0, limit - state.count);
  const resetTime = Math.ceil((state.windowStart + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000);

  return {
    allowed: state.count <= limit,
    remaining,
    resetTime,
  };
}

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!(req as any).apiKey) {
      next();
      return;
    }

    const { userId, rateLimit } = (req as any).apiKey;
    const limit = rateLimit.requestsPerMinute;

    if (!redisService.isAvailable()) {
      const result = checkMemoryRateLimit(userId, limit);

      if (!result.allowed) {
        const retryAfter = Math.max(0, result.resetTime - Math.ceil(Date.now() / 1000));
        setRateLimitHeaders(res, limit, 0, result.resetTime);
        res.set('Retry-After', retryAfter.toString());

        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          error: {
            message: 'backend.rate_limit_exceeded_please_retry_later',
            type: 'rate_limit_exceeded',
            param: null,
          },
        });
        return;
      }

      setRateLimitHeaders(res, limit, result.remaining, result.resetTime);
      next();
      return;
    }

    const requestCountKey = `${REDIS_KEYS.RATE_LIMIT_PREFIX}:${userId}:${REDIS_KEYS.REQUEST_COUNT_SUFFIX}`;
    const requestLimitKey = `${REDIS_KEYS.RATE_LIMIT_PREFIX}:${userId}:${REDIS_KEYS.LIMIT_SUFFIX}`;
    const windowKey = `${REDIS_KEYS.RATE_LIMIT_PREFIX}:${userId}:${REDIS_KEYS.WINDOW_SUFFIX}`;

    const now = Date.now();

    const client = redisService.getClient();

    const currentWindow = await redisService.get(windowKey);

    if (!currentWindow) {
      const multi = client.multi();
      multi.set(windowKey, now.toString(), 'EX', RATE_LIMIT.WINDOW_SECONDS);
      multi.set(requestCountKey, '1', 'EX', RATE_LIMIT.WINDOW_SECONDS);
      multi.set(requestLimitKey, limit.toString(), 'EX', RATE_LIMIT.WINDOW_SECONDS);
      await multi.exec();

      setRateLimitHeaders(
        res,
        limit,
        limit - 1,
        Math.ceil((now + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000)
      );

      next();
      return;
    }

    const windowStart = parseInt(currentWindow, 10);
    const elapsed = now - windowStart;

    if (elapsed >= RATE_LIMIT.WINDOW_SECONDS * 1000) {
      const multi = client.multi();
      multi.set(windowKey, now.toString(), 'EX', RATE_LIMIT.WINDOW_SECONDS);
      multi.set(requestCountKey, '1', 'EX', RATE_LIMIT.WINDOW_SECONDS);
      multi.set(requestLimitKey, limit.toString(), 'EX', RATE_LIMIT.WINDOW_SECONDS);
      await multi.exec();

      setRateLimitHeaders(
        res,
        limit,
        limit - 1,
        Math.ceil((now + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000)
      );

      next();
      return;
    }

    const newCount = await client.incr(requestCountKey);

    if (newCount > limit) {
      const resetTime = Math.ceil((windowStart + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000);
      const retryAfter = Math.max(0, resetTime - Math.ceil(Date.now() / 1000));

      setRateLimitHeaders(res, limit, 0, resetTime);
      res.set('Retry-After', retryAfter.toString());

      res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        error: {
          message: 'backend.rate_limit_exceeded_please_retry_later',
          type: 'rate_limit_exceeded',
          param: null,
        },
      });
      return;
    }

    const remaining = Math.max(0, limit - newCount);
    const resetTime = Math.ceil((windowStart + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000);

    setRateLimitHeaders(res, limit, remaining, resetTime);

    next();
  } catch (error) {
    logger.error('Rate limit error', { error, userId: (req as any).apiKey?.userId });
    next();
  }
};
