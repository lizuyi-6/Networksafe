/**
 * Rate Limit Middleware Tests
 *
 * Tests for rate limiting, header handling, and endpoint limits.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn().mockReturnValue(false),
    getClient: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  }
}));

jest.mock('../../config', () => ({
  RATE_LIMIT: {
    WINDOW_SECONDS: 60,
    DEFAULT_REQUESTS_PER_MINUTE: 60,
  },
  HTTP_STATUS: {
    TOO_MANY_REQUESTS: 429,
  },
  REDIS_KEYS: {
    RATE_LIMIT_PREFIX: 'ratelimit',
    REQUEST_COUNT_SUFFIX: 'requests',
    LIMIT_SUFFIX: 'limit',
    WINDOW_SUFFIX: 'window',
  },
}));

import { rateLimitMiddleware } from '../../security/ratelimit.middleware';
import redisService from '../../security/redis.service';
import { Request, Response, NextFunction } from 'express';

const mockRedisService = redisService as jest.Mocked<typeof redisService>;

describe('rateLimitMiddleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let setMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    jsonMock = jest.fn().mockReturnThis();
    setMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    // Use unique user IDs for each test to avoid state pollution
    mockReq = {
      apiKey: {
        userId: `user-${Date.now()}-${Math.random()}`,
        rateLimit: {
          requestsPerMinute: 5,
        },
      },
    } as any;

    mockRes = {
      status: statusMock,
      json: jsonMock,
      set: setMock,
    };

    mockNext = jest.fn();
  });

  describe('Memory-based Rate Limiting', () => {
    it('should allow requests under limit', async () => {
      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
    });

    it('should track request count correctly', async () => {
      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      // Check that remaining decreases
      const remainingCalls = setMock.mock.calls.filter((call: any[]) => call[0] === 'X-RateLimit-Remaining');
      expect(remainingCalls.length).toBe(3);
      expect(remainingCalls[0][1]).toBe('4');
      expect(remainingCalls[1][1]).toBe('3');
      expect(remainingCalls[2][1]).toBe('2');
    });

    it('should block requests over limit', async () => {
      // Make 5 allowed requests
      for (let i = 0; i < 5; i++) {
        await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      // 6th request should be blocked
      jest.clearAllMocks();
      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(429);
      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
      expect(setMock).toHaveBeenCalledWith('Retry-After', expect.any(String));
    });

    it('should set correct rate limit headers', async () => {
      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
    });

    it('should return error response when limit exceeded', async () => {
      // Exhaust limit
      for (let i = 0; i < 6; i++) {
        jest.clearAllMocks();
        await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      expect(statusMock).toHaveBeenCalledWith(429);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        error: {
          message: 'backend.rate_limit_exceeded_please_retry_later',
          type: 'rate_limit_exceeded',
          param: null,
        },
      });
    });
  });

  describe('API Key Handling', () => {
    it('should skip when no apiKey present', async () => {
      mockReq = {} as any;

      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(setMock).not.toHaveBeenCalled();
    });

    it('should use custom rate limit from apiKey', async () => {
      (mockReq as { apiKey: { userId: string; rateLimit: { requestsPerMinute: number } } }).apiKey = {
        userId: `user-${Date.now()}`,
        rateLimit: {
          requestsPerMinute: 10,
        },
      };

      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    });
  });

  describe('Window Management', () => {
    it('should track different users independently', async () => {
      // User 1 makes 3 requests
      for (let i = 0; i < 3; i++) {
        await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      // Switch to user 2
      (mockReq as { apiKey: { userId: string } }).apiKey!.userId = `user-${Date.now()}-new`;
      jest.clearAllMocks();

      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      // User 2 should have full limit
      expect(setMock).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
    });
  });

  describe('Redis-based Rate Limiting', () => {
    // Note: Redis integration tests require complex mock setup for ioredis.
    // The middleware correctly delegates to Redis when available.

    it('should check Redis availability', async () => {
      mockRedisService.isAvailable.mockReturnValue(true);
      mockRedisService.get.mockResolvedValue(null);

      // Mock the multi chain
      const mockExec = jest.fn().mockResolvedValue([]);
      const mockSet = jest.fn().mockReturnValue({ exec: mockExec });
      mockRedisService.getClient.mockReturnValue({
        multi: jest.fn().mockReturnValue({ set: mockSet }),
      } as any);

      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRedisService.isAvailable).toHaveBeenCalled();
    });

    it('should block when Redis count exceeds limit', async () => {
      mockRedisService.isAvailable.mockReturnValue(true);
      const now = Date.now();
      mockRedisService.get.mockResolvedValue(now.toString());

      const mockClient = {
        incr: jest.fn().mockResolvedValue(6), // Over limit of 5
        multi: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        }),
      };
      mockRedisService.getClient.mockReturnValue(mockClient as any);

      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(429);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      // Simulate an error by providing invalid apiKey structure
      mockReq = {
        apiKey: null,
      } as any;

      // Should not throw
      await expect(rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext)).resolves.toBeUndefined();
    });
  });

  describe('Header Values', () => {
    it('should return numeric reset time', async () => {
      await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);

      const resetCalls = setMock.mock.calls.filter((call: any[]) => call[0] === 'X-RateLimit-Reset');
      expect(resetCalls.length).toBeGreaterThan(0);
      expect(typeof parseInt(resetCalls[0][1])).toBe('number');
      expect(parseInt(resetCalls[0][1])).toBeGreaterThan(Date.now() / 1000);
    });

    it('should return non-negative remaining', async () => {
      // Exhaust limit
      for (let i = 0; i < 10; i++) {
        await rateLimitMiddleware(mockReq as Request, mockRes as Response, mockNext);
      }

      const remainingCalls = setMock.mock.calls.filter((call: any[]) => call[0] === 'X-RateLimit-Remaining');
      expect(remainingCalls.length).toBeGreaterThan(0);
      const lastRemaining = parseInt(remainingCalls[remainingCalls.length - 1][1]);
      expect(lastRemaining).toBeGreaterThanOrEqual(0);
    });
  });
});
