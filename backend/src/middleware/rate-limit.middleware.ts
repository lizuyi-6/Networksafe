/**
 * Rate Limiting Middleware
 *
 * SECURITY FIX for RISK-001: IP Spoofing Bypass
 *
 * Provides multi-dimensional rate limiting for API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import enhancedRateLimiter from '../security/enhanced-rate-limiter.service';
import {
  apiRateLimitEngineService,
  hashRateLimitFingerprint
} from '../services/api-rate-limit-engine.service';
import logger from '../utils/logger';

export interface RateLimitMiddlewareOptions {
  maxRequests?: number;
  windowMs?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  namespace?: string;
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
    namespace,
    keyGenerator,
    handler = defaultHandler,
  } = options;
  const limiterNamespace = namespace ? sanitizeNamespace(namespace) : undefined;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const baseIdentifier = keyGenerator
        ? keyGenerator(req)
        : getDefaultKey(req);
      const identifier = limiterNamespace
        ? `${limiterNamespace}:${baseIdentifier}`
        : baseIdentifier;
      const ip = getClientIP(req);
      const sessionId = String((req as any).sessionID || req.headers['x-session-id'] || '');
      const forwardedFor = String(req.headers['x-forwarded-for'] || '').trim();
      const realIp = String(req.headers['x-real-ip'] || '').trim();
      const endpoint = `${req.method}:${req.path}`;
      const fingerprint = hashRateLimitFingerprint(buildRequestFingerprint(req, ip));

      if (isApiRateLimitEngineEnabled()) {
        const engineResult = await apiRateLimitEngineService.check({
          identifier,
          ip,
          bucketScope: limiterNamespace,
          endpoint,
          maxRequests,
          windowMs,
          fingerprint,
          forwardedFor,
          realIp,
          sessionId,
          protocol: 'http'
        });

        if (engineResult) {
          res.setHeader('X-RateLimit-Limit', maxRequests.toString());
          res.setHeader('X-RateLimit-Remaining', engineResult.remaining.toString());
          res.setHeader('X-RateLimit-Reset', Math.floor(engineResult.resetAtMs / 1000).toString());

          if (!engineResult.allowed) {
            if (isRapidIpRotation(engineResult.reason)) {
              logger.error('IP spoofing detected, blocking request', {
                identifier,
                ip,
                reason: engineResult.reason,
                riskFlags: engineResult.riskFlags
              });

              res.status(429).json({
                error: 'backend.request_blocked_suspicious_activity_detected',
                code: 'IP_SPOOFING_DETECTED',
              });
              return;
            }

            const retryAfter = Math.ceil((engineResult.resetAtMs - Date.now()) / 1000);
            res.setHeader('Retry-After', Math.max(retryAfter, 1).toString());
            return handler(req, res);
          }

          next();
          return;
        }
      }

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
      const result = await enhancedRateLimiter.checkRateLimit({
        identifier,
        ip,
        endpoint,
        bucketScope: limiterNamespace,
        config: {
          maxRequests,
          windowMs,
        },
      });

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

        const retryAfter = Math.ceil((result.resetTime.getTime() - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());

        return handler(req, res);
      }

      next();
    } catch (error) {
      logger.error('Rate limit middleware error', { error });
      // SECURITY FIX: Fail closed - reject request if rate limiter fails
      // This prevents attackers from bypassing rate limits by causing Redis failures
      res.status(503).json({
        error: 'backend.service_temporarily_unavailable',
        code: 'RATE_LIMIT_CHECK_FAILED',
        retryAfter: 5,
      });
    }
  };
}

function buildRequestFingerprint(req: Request, ip: string): string {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  const userAgent = String(req.headers['user-agent'] || '').trim();
  const acceptLanguage = String(req.headers['accept-language'] || '').trim();
  return [ip, forwardedFor, realIp, userAgent, acceptLanguage].join('|');
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
  const trustProxy = process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
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

function isApiRateLimitEngineEnabled(): boolean {
  const raw = String(process.env.API_RATE_LIMIT_ENGINE || '').trim().toLowerCase();
  return raw === 'redis-lua' || raw === 'true' || raw === '1';
}

function isRapidIpRotation(reason?: string): boolean {
  return String(reason || '').toLowerCase().includes('rapid ip rotation');
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeNamespace(namespace: string): string {
  return namespace.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'default';
}

/**
 * Pre-configured rate limiters for different use cases
 */

// Strict rate limiter for authentication endpoints
export const authRateLimit = rateLimit({
  namespace: 'auth',
  maxRequests: parsePositiveIntEnv('AUTH_RATE_LIMIT_MAX_REQUESTS', 120),
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
  namespace: 'api',
  maxRequests: parsePositiveIntEnv('API_RATE_LIMIT_MAX_REQUESTS', 600),
  windowMs: 60000,
});

// Lenient rate limiter for less critical endpoints
export const lenientRateLimit = rateLimit({
  namespace: 'lenient',
  maxRequests: 300,
  windowMs: 60000,
});

// Strict rate limiter for admin operations
export const adminRateLimit = rateLimit({
  namespace: 'admin',
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
  namespace: 'ws',
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
