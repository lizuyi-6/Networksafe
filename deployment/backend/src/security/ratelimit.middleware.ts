import { Request, Response, NextFunction } from 'express';
import redisService from './redis.service';
import { RATE_LIMIT, HTTP_STATUS, REDIS_KEYS } from '../config';
import logger from '../utils/logger';

// Helper function to set rate limit headers
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

// Rate limit middleware using Redis
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

    // Create rate limit keys
    const requestCountKey = `${REDIS_KEYS.RATE_LIMIT_PREFIX}:${userId}:${REDIS_KEYS.REQUEST_COUNT_SUFFIX}`;
    const requestLimitKey = `${REDIS_KEYS.RATE_LIMIT_PREFIX}:${userId}:${REDIS_KEYS.LIMIT_SUFFIX}`;
    const windowKey = `${REDIS_KEYS.RATE_LIMIT_PREFIX}:${userId}:${REDIS_KEYS.WINDOW_SUFFIX}`;

    const now = Date.now();

    // Use atomic increment with expiry to prevent race conditions
    const client = redisService.getClient();

    // Get current window info
    const currentWindow = await redisService.get(windowKey);

    if (!currentWindow) {
      // Start new window atomically
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
      // New window - reset atomically
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

    // Atomic increment and check in one operation
    const newCount = await client.incr(requestCountKey);

    if (newCount > limit) {
      const resetTime = Math.ceil((windowStart + RATE_LIMIT.WINDOW_SECONDS * 1000) / 1000);
      const retryAfter = Math.max(0, resetTime - Math.ceil(Date.now() / 1000));

      setRateLimitHeaders(res, limit, 0, resetTime);
      res.set('Retry-After', retryAfter.toString());

      res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        error: {
          message: 'Rate limit exceeded. Please retry later.',
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
    // On Redis error, allow request but log warning
    next();
  }
};
