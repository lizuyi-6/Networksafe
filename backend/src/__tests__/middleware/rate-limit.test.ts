/**
 * Rate Limit Middleware Tests
 *
 * Tests for rate limiting functionality
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimit, authRateLimit, apiRateLimit } from '../../middleware/rate-limit.middleware';
import enhancedRateLimiter from '../../security/enhanced-rate-limiter.service';
import { apiRateLimitEngineService } from '../../services/api-rate-limit-engine.service';

// Mock dependencies
jest.mock('../../security/enhanced-rate-limiter.service', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetTime: new Date(Date.now() + 60000)
  }),
  detectIPSpoofing: jest.fn().mockResolvedValue({
    suspicious: false
  })
}));

jest.mock('../../services/api-rate-limit-engine.service', () => ({
  apiRateLimitEngineService: {
    check: jest.fn().mockResolvedValue(null)
  },
  hashRateLimitFingerprint: jest.fn((value: string) => `hashed:${value}`)
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));

describe('Rate Limit Middleware', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;
  const originalApiRateLimitEngine = process.env.API_RATE_LIMIT_ENGINE;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockSetHeader: jest.Mock;

  beforeEach(() => {
    process.env.TRUST_PROXY = 'true';
    delete process.env.API_RATE_LIMIT_ENGINE;
    mockSetHeader = jest.fn();
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    mockRequest = {
      method: 'GET',
      path: '/api/test',
      headers: {},
      connection: { remoteAddress: '127.0.0.1' } as any,
      socket: { remoteAddress: '127.0.0.1' } as any
    };
    mockResponse = {
      status: mockStatus,
      json: mockJson,
      setHeader: mockSetHeader
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
    (apiRateLimitEngineService.check as jest.Mock).mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
    if (originalApiRateLimitEngine === undefined) {
      delete process.env.API_RATE_LIMIT_ENGINE;
    } else {
      process.env.API_RATE_LIMIT_ENGINE = originalApiRateLimitEngine;
    }
  });

  describe('rateLimit', () => {
    it('should allow requests within limit', async () => {
      const middleware = rateLimit({ maxRequests: 100, windowMs: 60000 });

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '99');
    });

    it('should allow redis lua decisions without local fallback', async () => {
      process.env.API_RATE_LIMIT_ENGINE = 'redis-lua';
      (apiRateLimitEngineService.check as jest.Mock).mockResolvedValueOnce({
        allowed: true,
        remaining: 88,
        resetAtMs: Date.now() + 60000,
        decisionSource: 'redis-lua-api-rate-limit',
        riskFlags: []
      });

      const middleware = rateLimit({ maxRequests: 100, windowMs: 60000 });

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(enhancedRateLimiter.checkRateLimit).not.toHaveBeenCalled();
      expect(enhancedRateLimiter.detectIPSpoofing).not.toHaveBeenCalled();
      expect(mockSetHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '88');
    });

    it('should block requests exceeding limit', async () => {
      (enhancedRateLimiter.checkRateLimit as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetTime: new Date(Date.now() + 60000),
        reason: 'Limit exceeded'
      });

      const middleware = rateLimit({ maxRequests: 100, windowMs: 60000 });

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    });

    it('should block suspicious IP (IP spoofing)', async () => {
      process.env.API_RATE_LIMIT_ENGINE = 'redis-lua';
      (apiRateLimitEngineService.check as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAtMs: Date.now() + 60000,
        decisionSource: 'redis-lua-api-rate-limit',
        riskFlags: ['ip_header_mismatch'],
        reason: 'Rapid IP rotation detected'
      });

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(enhancedRateLimiter.detectIPSpoofing).not.toHaveBeenCalled();
    });

    it('should fall back to legacy limiter when redis lua engine is unavailable', async () => {
      process.env.API_RATE_LIMIT_ENGINE = 'redis-lua';
      (apiRateLimitEngineService.check as jest.Mock).mockResolvedValueOnce(null);

      const middleware = rateLimit({ maxRequests: 100, windowMs: 60000 });

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(enhancedRateLimiter.detectIPSpoofing).toHaveBeenCalled();
      expect(enhancedRateLimiter.checkRateLimit).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use custom key generator', async () => {
      const customKeyGenerator = jest.fn(() => 'custom-key-123');
      const middleware = rateLimit({
        keyGenerator: customKeyGenerator
      });

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(customKeyGenerator).toHaveBeenCalledWith(mockRequest);
    });

    it('should use custom handler', async () => {
      const customHandler = jest.fn();
      (enhancedRateLimiter.checkRateLimit as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetTime: new Date()
      });

      const middleware = rateLimit({
        handler: customHandler
      });

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(customHandler).toHaveBeenCalled();
    });

    it('should fail closed on limiter errors', async () => {
      (enhancedRateLimiter.checkRateLimit as jest.Mock).mockRejectedValueOnce(
        new Error('Redis connection error')
      );

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'RATE_LIMIT_CHECK_FAILED'
        })
      );
    });

    it('should use user ID as key when available', async () => {
      (mockRequest as any).user = { userId: 'user-001' };

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(enhancedRateLimiter.checkRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'user:user-001'
        })
      );
    });
  });

  describe('authRateLimit', () => {
    it('should have stricter limits for auth endpoints', async () => {
      await authRateLimit(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return auth-specific error message on limit exceeded', async () => {
      (enhancedRateLimiter.checkRateLimit as jest.Mock).mockResolvedValueOnce({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetTime: new Date()
      });

      await authRateLimit(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_RATE_LIMIT_EXCEEDED'
        })
      );
    });
  });

  describe('apiRateLimit', () => {
    it('should allow API requests within limit', async () => {
      await apiRateLimit(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('IP extraction', () => {
    it('should use X-Forwarded-For header for IP', async () => {
      mockRequest.headers = {
        'x-forwarded-for': '192.168.1.100, 10.0.0.1'
      };

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(enhancedRateLimiter.checkRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: '192.168.1.100'
        })
      );
    });

    it('should use X-Real-IP header', async () => {
      mockRequest.headers = {
        'x-real-ip': '192.168.1.200'
      };

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(enhancedRateLimiter.checkRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: '192.168.1.200'
        })
      );
    });
  });
});
