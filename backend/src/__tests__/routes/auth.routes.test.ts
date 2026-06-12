import express from 'express';
import request from 'supertest';
import authRouter from '../../api/routes/auth.routes';

jest.mock('../../testing/test-runtime-adapter', () => ({
  authRateLimitAdapter: jest.fn(() => (req: any, _res: any, next: any) => next()),
  isTestRuntime: jest.fn().mockReturnValue(false),
  passwordWeakResponseAdapter: jest.fn((r: any) => r),
  validatePasswordAdapter: jest.fn((p: any) => ({ valid: true, message: '' })),
}));

jest.mock('../../security/auth-security.service', () => ({
  __esModule: true,
  default: {
    login: jest.fn(),
    register: jest.fn(),
    isAccountLocked: jest.fn().mockResolvedValue(false),
    getLockInfo: jest.fn().mockResolvedValue({ remainingTime: 0 }),
    detectSuspiciousLogin: jest.fn().mockResolvedValue([]),
    recordLoginAttempt: jest.fn().mockResolvedValue(undefined),
    validatePassword: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    generateSessionId: jest.fn().mockReturnValue('session-1'),
    checkConcurrentSessions: jest.fn().mockResolvedValue(true),
    addSession: jest.fn().mockResolvedValue(undefined),
  }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn().mockReturnValue(false),
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue('OK'),
  }
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue(undefined),
  }
}));

jest.mock('../../modules/auth/auth-user.repository', () => ({
  createAuthUser: jest.fn(),
  findAuthUserByEmail: jest.fn(),
  findAuthUserById: jest.fn(),
  recordLoginHistory: jest.fn(),
  touchAuthUserLastLogin: jest.fn(),
  updateAuthUserPassword: jest.fn(),
}));

jest.mock('../../middleware/rate-limit.middleware', () => ({
  authRateLimit: jest.fn(),
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'tenant', tenantId: 't1', username: 'testuser', plan: 'starter' };
    next();
  }),
  generateTokens: jest.fn().mockReturnValue({
    accessToken: 'test_token',
    refreshToken: 'test_refresh_token',
    expiresIn: 86400
  }),
  verifyRefreshToken: jest.fn(),
  buildCookieOptions: jest.fn().mockReturnValue({ httpOnly: true, secure: false, sameSite: 'strict' }),
  buildRefreshCookieOptions: jest.fn().mockReturnValue({ httpOnly: true, secure: false, sameSite: 'strict', path: '/' }),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('test_token'),
  verify: jest.fn(),
}));

jest.mock('../../config/enterprise-runtime', () => ({
  ...jest.requireActual('../../config/enterprise-runtime'),
  allowPasswordLogin: jest.fn().mockReturnValue(true),
}));

import { findAuthUserByEmail, createAuthUser } from '../../modules/auth/auth-user.repository';
import { authenticate } from '../../middleware/auth.middleware';

const app = express();
app.use(express.json());
app.use(authRouter);

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- POST /register ----

  describe('POST /register', () => {
    it('returns 400 when email is missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({ password: 'Password123!', username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when password is missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({ email: 'test@example.com', username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when username is missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 when email already exists', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue({ id: 'existing-user-id', email: 'test@example.com' });

      const response = await request(app)
        .post('/register')
        .send({ email: 'test@example.com', password: 'Password123!', username: 'testuser' });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('USER_EXISTS');
    });

    it('returns 201 when registration is successful', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue(null);
      (createAuthUser as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/register')
        .send({ email: 'new@example.com', password: 'Password123!', username: 'newuser' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('new@example.com');
      expect(response.body.data.user.username).toBe('newuser');
      expect(response.body.data.accessToken).toBeDefined();
      expect(createAuthUser).toHaveBeenCalled();
    });
  });

  // ---- POST /login ----

  describe('POST /login', () => {
    it('returns 400 when email is missing', async () => {
      const response = await request(app)
        .post('/login')
        .send({ password: 'Password123!' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when password is missing', async () => {
      const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 when user is not found', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/login')
        .send({ email: 'nonexistent@example.com', password: 'Password123!' });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 200 with token on successful login', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue({
        id: 'user-id-1',
        email: 'test@example.com',
        username: 'testuser',
        role: 'tenant',
        plan: 'starter',
        password_hash: 'hashed_password',
        tenant_id: 'tenant-1',
        status: 'active'
      });

      const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.email).toBe('test@example.com');
    });
  });

  // ---- GET /me ----

  describe('GET /me', () => {
    it('returns user data when authenticated', async () => {
      const response = await request(app).get('/me');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('a@b.com');
    });
  });
});
