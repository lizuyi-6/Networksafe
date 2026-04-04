/**
 * Anti-Bot Middleware Tests
 *
 * Tests for bot detection logic and challenge generation/validation.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn().mockReturnValue(false),
    getClient: jest.fn().mockReturnValue({
      zadd: jest.fn(),
      zremrangebyscore: jest.fn(),
      zcard: jest.fn(),
      zcount: jest.fn(),
      expire: jest.fn(),
    }),
    get: jest.fn(),
    set: jest.fn(),
    exists: jest.fn(),
  }
}));

jest.mock('../../config', () => ({
  defaultConfig: {
    env: 'production',
  }
}));

import { AntiBotMiddleware } from '../../security/anti-bot.middleware';
import redisService from '../../security/redis.service';
import { Request, Response, NextFunction } from 'express';

const mockRedisService = redisService as jest.Mocked<typeof redisService>;

describe('AntiBotMiddleware', () => {
  let middleware: AntiBotMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let setMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create fresh middleware instance for each test to clear fallback state
    middleware = new AntiBotMiddleware();

    jsonMock = jest.fn().mockReturnThis();
    setMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock, set: setMock });

    mockReq = {
      ip: '192.168.1.1',
      connection: { remoteAddress: '192.168.1.1' } as any,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate',
      },
      body: {},
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
      set: setMock,
      setHeader: jest.fn(),
    };

    mockNext = jest.fn();
  });

  describe('Known Bot Detection', () => {
    it('should allow known good bots', async () => {
      const knownBots = [
        'Googlebot/2.1 (+http://www.google.com/bot.html)',
        'Mozilla/5.0 (compatible; Bingbot/2.0)',
        'DuckDuckBot/1.0',
        'Baiduspider/2.0',
        'Mozilla/5.0 (compatible; YandexBot/3.0)',
      ];

      for (const bot of knownBots) {
        // Create fresh middleware for each bot to avoid IP blocking
        middleware = new AntiBotMiddleware();
        mockReq.headers!['user-agent'] = bot;
        await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        mockNext.mockClear();
      }
    });

    it('should allow facebook external hit', async () => {
      mockReq.headers!['user-agent'] = 'facebookexternalhit/1.1';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow twitterbot', async () => {
      mockReq.headers!['user-agent'] = 'Twitterbot/1.0';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Suspicious User Agent Detection', () => {
    it('should block curl user agent', async () => {
      mockReq.headers!['user-agent'] = 'curl/7.68.0';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'backend.access_denied',
      }));
    });

    it('should block wget user agent', async () => {
      mockReq.headers!['user-agent'] = 'Wget/1.20.3';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block python-requests user agent', async () => {
      mockReq.headers!['user-agent'] = 'python-requests/2.25.1';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block short user agents', async () => {
      mockReq.headers!['user-agent'] = 'bot';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block empty user agents', async () => {
      mockReq.headers!['user-agent'] = '';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block scraper user agents', async () => {
      mockReq.headers!['user-agent'] = 'WebScraper/1.0';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block crawler user agents', async () => {
      mockReq.headers!['user-agent'] = 'MyCrawler/2.0';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block java user agent', async () => {
      mockReq.headers!['user-agent'] = 'Java/11.0.11';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should block go-http-client user agent', async () => {
      mockReq.headers!['user-agent'] = 'Go-http-client/1.1';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('Honeypot Detection', () => {
    it('should block when honeypot field is filled', async () => {
      mockReq.body = { website_confirm: 'some value' };
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'backend.access_denied',
      }));
    });

    it('should allow when honeypot field is empty', async () => {
      mockReq.body = { website_confirm: '' };
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow when honeypot field is whitespace only', async () => {
      mockReq.body = { website_confirm: '   ' };
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow when honeypot field is missing', async () => {
      mockReq.body = { other_field: 'value' };
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow when body is empty', async () => {
      mockReq.body = {};
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests under threshold', async () => {
      // First request should be allowed
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should block requests exceeding rate limit', async () => {
      // Simulate many requests to exceed threshold
      for (let i = 0; i < 105; i++) {
        jest.clearAllMocks();
        await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      }

      // After threshold, should be blocked
      expect(statusMock).toHaveBeenCalledWith(429);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'backend.too_many_requests',
      }));
    });
  });

  describe('IP Blocking', () => {
    it('should block already blocked IPs', async () => {
      // First trigger a block
      mockReq.body = { website_confirm: 'bot' };
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);

      // Clear mocks and try again
      jest.clearAllMocks();
      mockReq.body = {};

      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(429);
    });
  });

  describe('Localhost Bypass', () => {
    it('should allow localhost IPv4', async () => {
      mockReq.ip = '127.0.0.1';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow localhost IPv6', async () => {
      mockReq.ip = '::1';
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Required Headers', () => {
    it('should reject missing accept header', async () => {
      delete mockReq.headers!['accept'];
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'backend.bad_request',
      }));
    });

    it('should reject requests with suspicious UA when user-agent is missing', async () => {
      // Missing user-agent is treated as suspicious (empty string triggers suspicious pattern)
      delete mockReq.headers!['user-agent'];
      await middleware.protect(mockReq as Request, mockRes as Response, mockNext);
      // Empty/missing user-agent triggers suspicious UA detection (403) before header validation
      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('Static Method', () => {
    it('should return honeypot field name', () => {
      const fieldName = AntiBotMiddleware.getHoneypotFieldName();
      expect(fieldName).toBe('website_confirm');
    });
  });

  describe('Error Handling', () => {
    // Note: The middleware has a try-catch in protect() that calls next() on error,
    // but the generateFingerprint method doesn't have null checks for connection.
    // This is a known limitation of the current implementation.
  });
});
