/**
 * Rate Limit Middleware Tests
 *
 * Tests for rate limiting functionality
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimit, authRateLimit, apiRateLimit } from '../../middleware/rate-limit.middleware';
import enhancedRateLimiter from '../../security/enhanced-rate-limiter.service';

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

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));

describe('Rate Limit Middleware', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockSetHeader: jest.Mock;

  beforeEach(() => {
    process.env.TRUST_PROXY = 'true';
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
  });

  afterAll(() => {
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
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
      (enhancedRateLimiter.detectIPSpoofing as jest.Mock).mockResolvedValueOnce({
        suspicious: true,
        reason: 'IP mismatch detected'
      });

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(429);
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

    it('should fail open on error', async () => {
      (enhancedRateLimiter.checkRateLimit as jest.Mock).mockRejectedValueOnce(
        new Error('Redis connection error')
      );

      const middleware = rateLimit();

      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
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
