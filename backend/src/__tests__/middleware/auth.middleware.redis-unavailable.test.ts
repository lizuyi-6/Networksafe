import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';
process.env.AUDIT_LOG_SECRET = process.env.AUDIT_LOG_SECRET || 'test-audit-log-secret-minimum-32-characters';
delete process.env.ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN;

const mockRedisService = {
  isAvailable: jest.fn(() => false),
  exists: jest.fn()
};

const mockAuthSecurityService = {
  validateSessionStrict: jest.fn()
};

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: mockRedisService
}));

jest.mock('../../security/auth-security.service', () => ({
  __esModule: true,
  default: mockAuthSecurityService
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn()
  }
}));

import type { AuthenticatedRequest } from '../../middleware/auth.middleware';

const { authenticate } = require('../../middleware/auth.middleware') as typeof import('../../middleware/auth.middleware');

describe('auth.middleware Redis outage response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.isAvailable.mockReturnValue(false);
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns 503 with AUTH_BLACKLIST_UNAVAILABLE instead of a logout-class 401', async () => {
    const token = jwt.sign(
      {
        userId: 'user-redis-down',
        email: 'redis-down@example.com',
        username: 'redis-down',
        role: 'tenant_admin'
      },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const req = {
      cookies: { accessToken: token },
      headers: {}
    } as AuthenticatedRequest;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as unknown as Response & { status: jest.Mock; json: jest.Mock };
    const next = jest.fn() as NextFunction;

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      data: null,
      code: 'AUTH_BLACKLIST_UNAVAILABLE',
      message: 'backend.auth_blacklist_check_unavailable',
      retryable: true
    }));
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('AUTH_BLACKLIST_UNAVAILABLE');
    expect(body.error.message).toBe('backend.auth_blacklist_check_unavailable');
    expect(body.error.details.retryable).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns retryable 503 when a Redis session read times out', async () => {
    mockRedisService.isAvailable.mockReturnValue(true);
    mockRedisService.exists.mockResolvedValue(false);
    mockAuthSecurityService.validateSessionStrict.mockRejectedValueOnce(new Error('redis command timeout'));
    const token = jwt.sign(
      {
        userId: 'user-session-timeout',
        email: 'session-timeout@example.com',
        username: 'session-timeout',
        role: 'tenant_admin',
        sessionId: 'session-timeout-id'
      },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const req = { cookies: { accessToken: token }, headers: {} } as AuthenticatedRequest;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    } as unknown as Response & { status: jest.Mock; json: jest.Mock };
    const next = jest.fn() as NextFunction;

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.code).toBe('AUTH_SESSION_STORE_UNAVAILABLE');
    expect(body.retryable).toBe(true);
    expect(body.error.code).toBe('AUTH_SESSION_STORE_UNAVAILABLE');
    expect(body.error.details.retryable).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});
