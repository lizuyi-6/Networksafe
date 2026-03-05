/**
 * Rate Limiting Middleware
 *
 * SECURITY FIX for RISK-001: IP Spoofing Bypass
 *
 * Provides multi-dimensional rate limiting for API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import enhancedRateLimiter from '../security/enhanced-rate-limiter.service';
import logger from '../utils/logger';

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

export interface RateLimitMiddlewareOptions {
  maxRequests?: number;
  windowMs?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response) => void;
}

/**
 * Default rate limit handler
 */
function defaultHandler(req: Request, res: Response): void {
  res.status(429).json({
    error: 'backend.too_many_requests',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 60, // seconds
  });
}

/**
 * Create rate limit middleware
 */
export function rateLimit(options: RateLimitMiddlewareOptions = {}) {
  const {
    maxRequests = 100,
    windowMs = 60000,
    keyGenerator,
    handler = defaultHandler,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Generate identifier for rate limiting
      const identifier = keyGenerator
        ? keyGenerator(req)
        : getDefaultKey(req);

      // Get IP address (with proxy support)
      const ip = getClientIP(req);

      // Check rate limit with multi-dimensional validation
      const result = await enhancedRateLimiter.checkRateLimit({
        identifier,
        ip,
        endpoint: `${req.method}:${req.path}`,
        config: {
          maxRequests,
          windowMs,
        },
      });

      // Detect IP spoofing
      const spoofingCheck = await enhancedRateLimiter.detectIPSpoofing({
        identifier,
        ip,
      });

      if (spoofingCheck.suspicious) {
        logger.error('IP spoofing detected, blocking request', {
          identifier,
          ip,
          reason: spoofingCheck.reason,
        });

        res.status(429).json({
          error: 'backend.request_blocked_suspicious_activity_detected',
          code: 'IP_SPOOFING_DETECTED',
        });
        return;
      }

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.floor(result.resetTime.getTime() / 1000).toString());

      if (!result.allowed) {
        logger.warn('Rate limit exceeded', {
          identifier,
          ip,
          endpoint: req.path,
          reason: result.reason,
        });

        // Retry-After header (seconds)
        const retryAfter = Math.ceil((result.resetTime.getTime() - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());

        return handler(req, res);
      }

      next();
    } catch (error) {
      logger.error('Rate limit middleware error', { error });
      // Fail open - allow request if rate limiter fails
      next();
    }
  };
}

/**
 * Get default key for rate limiting
 * Priority: user ID > session ID > IP
 */
function getDefaultKey(req: Request): string {
  const user = (req as any).user;
  if (user?.userId) {
    return `user:${user.userId}`;
  }

  const sessionID = (req as any).sessionID || req.headers['x-session-id'];
  if (sessionID) {
    return `session:${sessionID}`;
  }

  return `ip:${getClientIP(req)}`;
}

/**
 * Get client IP address with proxy support
 */
function getClientIP(req: Request): string {
  if (TRUST_PROXY) {
    const forwardedFor = req.headers['x-forwarded-for'] as string;
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    const realIp = req.headers['x-real-ip'] as string;
    if (realIp) {
      return realIp.trim();
    }
  }
  return (
    req.socket.remoteAddress ||
    (req.connection as any)?.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  ).trim();
}

/**
 * Pre-configured rate limiters for different use cases
 */

// Strict rate limiter for authentication endpoints
export const authRateLimit = rateLimit({
  maxRequests: 5, // 5 requests per minute
  windowMs: 60000,
  handler: (req, res) => {
    res.status(429).json({
      error: 'backend.too_many_authentication_attempts_please_try_again_later',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
});

// Standard rate limiter for general API endpoints
export const apiRateLimit = rateLimit({
  maxRequests: 100,
  windowMs: 60000,
});

// Lenient rate limiter for less critical endpoints
export const lenientRateLimit = rateLimit({
  maxRequests: 300,
  windowMs: 60000,
});

// Strict rate limiter for admin operations
export const adminRateLimit = rateLimit({
  maxRequests: 20,
  windowMs: 60000,
  handler: (req, res) => {
    res.status(429).json({
      error: 'backend.too_many_admin_operations_please_slow_down',
      code: 'ADMIN_RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
});

// WebSocket connection rate limit
export const wsRateLimit = rateLimit({
  maxRequests: 10,
  windowMs: 60000,
  handler: (req, res) => {
    res.status(429).json({
      error: 'backend.too_many_websocket_connection_attempts',
      code: 'WS_RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
});

export default rateLimit;
