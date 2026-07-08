import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';
process.env.AUDIT_LOG_SECRET = process.env.AUDIT_LOG_SECRET || 'test-audit-log-secret-minimum-32-characters';
delete process.env.ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN;

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(() => false),
    exists: jest.fn()
  }
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
      code: 'AUTH_BLACKLIST_UNAVAILABLE',
      retryable: true
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
