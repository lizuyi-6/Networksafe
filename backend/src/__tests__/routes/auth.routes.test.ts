import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
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
    validateSession: jest.fn().mockResolvedValue(true),
    validateSessionStrict: jest.fn().mockResolvedValue(true),
    removeSession: jest.fn().mockResolvedValue(true),
    invalidateSession: jest.fn().mockResolvedValue(true),
  }
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn().mockReturnValue(false),
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue('OK'),
    existsStrict: jest.fn().mockResolvedValue(false),
    setStrict: jest.fn().mockResolvedValue(undefined),
    setIfAbsentStrict: jest.fn().mockResolvedValue(true),
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
    req.user = {
      userId: 'u1',
      email: 'a@b.com',
      role: 'tenant',
      tenantId: 't1',
      username: 'testuser',
      plan: 'starter',
      sessionId: 'session-1'
    };
    next();
  }),
  generateTokens: jest.fn().mockReturnValue({
    accessToken: 'test_token',
    refreshToken: 'test_refresh_token',
    expiresIn: 86400
  }),
  verifyRefreshToken: jest.fn(),
  buildCookieOptions: jest.fn().mockReturnValue({
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  }),
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
  decode: jest.fn().mockReturnValue({ sessionId: 'session-1', exp: 4_102_444_800 }),
}));

jest.mock('../../config/enterprise-runtime', () => ({
  ...jest.requireActual('../../config/enterprise-runtime'),
  allowPasswordLogin: jest.fn().mockReturnValue(true),
}));

jest.mock('../../services/oidc-auth.service', () => ({
  oidcAuthService: {
    isConfigured: jest.fn().mockReturnValue(true),
    buildState: jest.fn().mockReturnValue('oidc-state'),
    buildStateAndNonce: jest.fn().mockReturnValue({ state: 'oidc-state', nonce: 'oidc-nonce' }),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://idp.example/authorize'),
    exchangeCode: jest.fn().mockResolvedValue({
      accessToken: 'oidc-access-token',
      idToken: 'signed-oidc-id-token'
    }),
    verifyIdToken: jest.fn().mockResolvedValue({
      valid: true,
      claims: {
        sub: 'oidc-subject',
        email: 'oidc@example.com',
        email_verified: true,
        amr: ['mfa']
      }
    }),
    fetchUserProfile: jest.fn().mockResolvedValue({
      sub: 'oidc-subject',
      email: 'oidc@example.com'
    }),
    revokeToken: jest.fn().mockResolvedValue(undefined),
    buildEndSessionUrl: jest.fn().mockReturnValue(
      'https://idp.example/logout?client_id=aetherguard-test-client'
    ),
    validateMfaEvidence: jest.fn().mockReturnValue({ valid: true }),
    resolveUser: jest.fn().mockResolvedValue({
      row: {
        id: 'oidc-user',
        email: 'oidc@example.com',
        username: 'oidc-user',
        role: 'tenant',
        plan: 'starter',
        tenant_id: 'oidc-tenant',
        status: 'active'
      }
    }),
    buildSessionUser: jest.fn().mockReturnValue({
      userId: 'oidc-user',
      email: 'oidc@example.com',
      username: 'oidc-user',
      role: 'tenant',
      plan: 'starter',
      tenantId: 'oidc-tenant'
    })
  }
}));

import {
  findAuthUserByEmail,
  findAuthUserById,
  createAuthUser,
  touchAuthUserLastLogin,
  updateAuthUserPassword
} from '../../modules/auth/auth-user.repository';
import { authenticate, buildCookieOptions, generateTokens, verifyRefreshToken } from '../../middleware/auth.middleware';
import authSecurityService from '../../security/auth-security.service';
import { oidcAuthService } from '../../services/oidc-auth.service';
import { allowPasswordLogin } from '../../config/enterprise-runtime';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(authRouter);

function responseCookie(response: request.Response, name: string): string | undefined {
  const cookies = (response.headers['set-cookie'] as unknown as string[]) || [];
  return cookies.find((entry) => entry.startsWith(`${name}=`));
}

describe('Auth Routes', () => {
  const originalPublicRegistration = process.env.ALLOW_PUBLIC_REGISTRATION;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ALLOW_PUBLIC_REGISTRATION = 'true';
  });

  afterAll(() => {
    if (originalPublicRegistration === undefined) {
      delete process.env.ALLOW_PUBLIC_REGISTRATION;
    } else {
      process.env.ALLOW_PUBLIC_REGISTRATION = originalPublicRegistration;
    }
  });

  // ---- POST /register ----

  describe('POST /register', () => {
    it('returns 403 without touching user state when public registration is disabled', async () => {
      process.env.ALLOW_PUBLIC_REGISTRATION = 'false';

      const response = await request(app)
        .post('/register')
        .send({ email: 'blocked@example.com', password: 'Password123!', username: 'blocked' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('REGISTRATION_DISABLED');
      expect(findAuthUserByEmail).not.toHaveBeenCalled();
      expect(createAuthUser).not.toHaveBeenCalled();
    });

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
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.data.expiresIn).toBe(86400);
      expect(response.body.expiresIn).toBe(86400);
      expect(responseCookie(response, 'accessToken')).toContain('HttpOnly');
      expect(responseCookie(response, 'refreshToken')).toContain('HttpOnly');
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

    it('uses the trimmed email for the account lock decision', async () => {
      (authSecurityService.isAccountLocked as jest.Mock).mockImplementationOnce(
        async (candidate: string) => candidate === 'admin@example.com'
      );

      const response = await request(app)
        .post('/login')
        .send({ email: '  admin@example.com  ', password: 'Password123!' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(authSecurityService.isAccountLocked).toHaveBeenCalledWith('admin@example.com');
      expect(findAuthUserByEmail).not.toHaveBeenCalled();
    });

    it('returns 200 with cookie-only tokens on successful login', async () => {
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
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.data.expiresIn).toBe(86400);
      expect(response.body.expiresIn).toBe(86400);
      expect(responseCookie(response, 'accessToken')).toContain('HttpOnly');
      expect(responseCookie(response, 'refreshToken')).toContain('HttpOnly');
      expect(response.body.data.user.email).toBe('test@example.com');
    });

    it.each(['pending', 'suspended'])('rejects a %s user after valid password verification', async (status) => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue({
        id: `user-${status}`,
        email: `${status}@example.com`,
        username: status,
        role: 'tenant',
        plan: 'starter',
        password_hash: 'hashed_password',
        tenant_id: 'tenant-1',
        status
      });

      const response = await request(app)
        .post('/login')
        .send({ email: `${status}@example.com`, password: 'Password123!' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('does not record a successful login when session tracking fails', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue({
        id: 'user-session-failure',
        email: 'session-failure@example.com',
        username: 'session-failure',
        role: 'tenant',
        plan: 'starter',
        password_hash: 'hashed_password',
        tenant_id: 'tenant-1',
        status: 'active'
      });
      (authSecurityService.validateSessionStrict as jest.Mock).mockResolvedValueOnce(false);

      const response = await request(app)
        .post('/login')
        .send({ email: 'session-failure@example.com', password: 'Password123!' });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('AUTH_SESSION_STORE_UNAVAILABLE');
      expect(authSecurityService.removeSession).toHaveBeenCalledWith('user-session-failure', 'session-1');
      expect(touchAuthUserLastLogin).not.toHaveBeenCalled();
    });

    it('does not reveal local-login policy before password verification', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue({
        id: 'oidc-only-user',
        email: 'oidc-only@example.com',
        username: 'oidc-only',
        role: 'tenant',
        plan: 'starter',
        password_hash: 'hashed_password',
        tenant_id: 'tenant-1',
        status: 'active'
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      (allowPasswordLogin as jest.Mock).mockReturnValueOnce(false);

      const response = await request(app)
        .post('/login')
        .send({ email: 'oidc-only@example.com', password: 'wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(allowPasswordLogin).not.toHaveBeenCalled();
    });

    it('rejects a break-glass admin when password login is disabled', async () => {
      (findAuthUserByEmail as jest.Mock).mockResolvedValue({
        id: 'break-glass-admin',
        email: 'admin@example.com',
        username: 'admin',
        role: 'platform_admin',
        plan: 'ultra',
        password_hash: 'hashed_password',
        tenant_id: 'tenant-1',
        status: 'active'
      });
      (allowPasswordLogin as jest.Mock).mockReturnValueOnce(false);

      const response = await request(app)
        .post('/login')
        .send({ email: 'admin@example.com', password: 'Password123!' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('LOCAL_LOGIN_DISABLED');
      expect(authSecurityService.addSession).not.toHaveBeenCalled();
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

  describe('OIDC session lifecycle', () => {
    it('binds server-side state, nonce, and PKCE parameters during login initialization', async () => {
      (buildCookieOptions as jest.Mock).mockReturnValueOnce({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        domain: 'app.example.test',
        maxAge: 24 * 60 * 60 * 1000
      });

      const response = await request(app).get('/oidc/login');

      expect(response.status).toBe(200);
      expect(response.body.data.state).toBe('oidc-state');
      expect(oidcAuthService.buildStateAndNonce).toHaveBeenCalledTimes(1);
      expect(oidcAuthService.buildAuthorizationUrl).toHaveBeenCalledWith('oidc-state', 'oidc-nonce');
      expect(oidcAuthService.buildState).not.toHaveBeenCalled();
      const stateCookie = responseCookie(response, 'oidcState');
      expect(stateCookie).toContain('HttpOnly');
      expect(stateCookie).toContain('Secure');
      expect(stateCookie).toContain('Domain=app.example.test');
      expect(stateCookie).toContain('Path=/');
      expect(stateCookie).toContain('Max-Age=600');
      expect(stateCookie).toContain('SameSite=Lax');
      expect(stateCookie).not.toContain('SameSite=Strict');
    });

    it('uses a relative redirect when an attacker controls Host and no trusted origin is configured', async () => {
      const redirectEnvKeys = [
        'OIDC_POST_LOGIN_REDIRECT_ORIGIN',
        'FRONTEND_APP_URL',
        'APP_URL',
        'PUBLIC_URL',
        'ALLOWED_ORIGINS'
      ] as const;
      const originalEnv = Object.fromEntries(
        redirectEnvKeys.map((key) => [key, process.env[key]])
      );
      redirectEnvKeys.forEach((key) => delete process.env[key]);

      try {
        const response = await request(app)
          .get('/oidc/callback?code=code-1&state=attacker-state')
          .set('Host', 'attacker.example')
          .set('Cookie', ['oidcState=expected-state']);

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/login?oidc=state-mismatch');
        expect(response.headers.location).not.toContain('attacker.example');
      } finally {
        redirectEnvKeys.forEach((key) => {
          const value = originalEnv[key];
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        });
      }
    });

    it('uses an absolute OIDC redirect only when the configured origin is allowlisted', async () => {
      const originalRedirectOrigin = process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN;
      const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
      process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN = 'https://app.example.test/';
      process.env.ALLOWED_ORIGINS = 'https://app.example.test';

      try {
        const response = await request(app)
          .get('/oidc/callback?code=code-1&state=attacker-state')
          .set('Host', 'attacker.example')
          .set('Cookie', ['oidcState=expected-state']);

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('https://app.example.test/login?oidc=state-mismatch');
      } finally {
        if (originalRedirectOrigin === undefined) {
          delete process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN;
        } else {
          process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN = originalRedirectOrigin;
        }
        if (originalAllowedOrigins === undefined) {
          delete process.env.ALLOWED_ORIGINS;
        } else {
          process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
        }
      }
    });

    it('falls back to a relative redirect when the configured origin is not allowlisted', async () => {
      const originalRedirectOrigin = process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN;
      const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;
      process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN = 'https://attacker.example';
      process.env.ALLOWED_ORIGINS = 'https://app.example.test';

      try {
        const response = await request(app)
          .get('/oidc/callback?code=code-1&state=attacker-state')
          .set('Host', 'attacker.example')
          .set('Cookie', ['oidcState=expected-state']);

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('/login?oidc=state-mismatch');
        expect(response.headers.location).not.toContain('attacker.example');
      } finally {
        if (originalRedirectOrigin === undefined) {
          delete process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN;
        } else {
          process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN = originalRedirectOrigin;
        }
        if (originalAllowedOrigins === undefined) {
          delete process.env.ALLOWED_ORIGINS;
        } else {
          process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
        }
      }
    });

    it('rejects a callback whose token response omits id_token', async () => {
      (oidcAuthService.exchangeCode as jest.Mock).mockResolvedValueOnce({
        accessToken: 'oidc-access-token'
      });
      (oidcAuthService.verifyIdToken as jest.Mock).mockResolvedValueOnce({
        valid: false,
        reason: 'id_token_missing'
      });

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=failed');
      expect(oidcAuthService.verifyIdToken).toHaveBeenCalledWith('', 'oidc-state');
      expect(oidcAuthService.fetchUserProfile).not.toHaveBeenCalled();
      expect(oidcAuthService.resolveUser).not.toHaveBeenCalled();
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it.each([
      ['verification fails', { valid: false, reason: 'bad_signature' }],
      ['verified claims are absent', { valid: true }]
    ])('rejects a callback when %s', async (_label, verification) => {
      (oidcAuthService.verifyIdToken as jest.Mock).mockResolvedValueOnce(verification);

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=failed');
      expect(oidcAuthService.verifyIdToken).toHaveBeenCalledWith('signed-oidc-id-token', 'oidc-state');
      expect(oidcAuthService.validateMfaEvidence).not.toHaveBeenCalled();
      expect(oidcAuthService.resolveUser).not.toHaveBeenCalled();
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it('rejects userinfo whose subject differs from the verified id_token subject', async () => {
      (oidcAuthService.fetchUserProfile as jest.Mock).mockResolvedValueOnce({
        sub: 'different-subject',
        email: 'oidc@example.com'
      });

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=failed');
      expect(oidcAuthService.validateMfaEvidence).not.toHaveBeenCalled();
      expect(oidcAuthService.resolveUser).not.toHaveBeenCalled();
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it('revokes the OIDC access token even when userinfo retrieval fails', async () => {
      (oidcAuthService.fetchUserProfile as jest.Mock).mockRejectedValueOnce(
        new Error('userinfo unavailable')
      );

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=failed');
      expect(oidcAuthService.revokeToken).toHaveBeenCalledWith('oidc-access-token');
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it('rejects a callback whose verified claims do not satisfy the MFA gate', async () => {
      (oidcAuthService.validateMfaEvidence as jest.Mock).mockReturnValueOnce({
        valid: false,
        reason: 'amr_mfa_missing'
      });

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=mfa-required');
      expect(oidcAuthService.validateMfaEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'oidc-subject' }),
        expect.objectContaining({ sub: 'oidc-subject', email_verified: true })
      );
      expect(oidcAuthService.resolveUser).not.toHaveBeenCalled();
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it('rejects an inactive OIDC account before creating a session', async () => {
      (oidcAuthService.resolveUser as jest.Mock).mockResolvedValueOnce({
        row: { id: 'oidc-user', status: 'pending' }
      });

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=account-inactive');
      expect(authSecurityService.addSession).not.toHaveBeenCalled();
    });

    it('redirects without issuing tokens when OIDC session tracking fails', async () => {
      (authSecurityService.validateSessionStrict as jest.Mock).mockResolvedValueOnce(false);

      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/login?oidc=session-unavailable');
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it('binds a successful OIDC token pair to the tracked session', async () => {
      const response = await request(app)
        .get('/oidc/callback?code=code-1&state=oidc-state')
        .set('Cookie', ['oidcState=oidc-state']);

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('/dashboard?auth=oidc');
      expect(oidcAuthService.exchangeCode).toHaveBeenCalledWith('code-1', 'oidc-state');
      expect(oidcAuthService.verifyIdToken).toHaveBeenCalledWith('signed-oidc-id-token', 'oidc-state');
      expect(oidcAuthService.fetchUserProfile).toHaveBeenCalledWith('oidc-access-token');
      expect(oidcAuthService.revokeToken).toHaveBeenCalledWith('oidc-access-token');
      expect(oidcAuthService.validateMfaEvidence).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'oidc-subject' }),
        expect.objectContaining({ sub: 'oidc-subject', email_verified: true })
      );
      expect(oidcAuthService.resolveUser).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'oidc-subject' }),
        expect.objectContaining({ sub: 'oidc-subject', email_verified: true })
      );
      expect(generateTokens).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'oidc-user',
        authProvider: 'oidc',
        sessionId: 'session-1'
      }));
    });

    it('revokes the tracked OIDC session on logout', async () => {
      const response = await request(app).post('/oidc/logout');

      expect(response.status).toBe(200);
      expect(authSecurityService.removeSession).toHaveBeenCalledWith('u1', 'session-1');
      expect(response.body.data.message).toBe('backend.logout_successful');
      expect(response.body.data.endSessionUrl)
        .toBe('https://idp.example/logout?client_id=aetherguard-test-client');
    });

    it('returns 503 when the OIDC session cannot be revoked', async () => {
      (authSecurityService.removeSession as jest.Mock).mockResolvedValueOnce(false);

      const response = await request(app).post('/oidc/logout');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('LOGOUT_REVOCATION_FAILED');
    });
  });

  describe('POST /refresh', () => {
    it('returns retryable 503 when the tracked session store cannot be read', async () => {
      (verifyRefreshToken as jest.Mock).mockReturnValueOnce({ userId: 'u1', sessionId: 'session-1' });
      (authSecurityService.validateSessionStrict as jest.Mock)
        .mockRejectedValueOnce(new Error('redis command timeout'));

      const response = await request(app)
        .post('/refresh')
        .set('Cookie', ['refreshToken=test_refresh_token']);

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('AUTH_SESSION_STORE_UNAVAILABLE');
      expect(response.body.retryable).toBe(true);
      expect(response.body.error.details.retryable).toBe(true);
      expect(generateTokens).not.toHaveBeenCalled();
    });
  });

  describe('POST /logout', () => {
    it('removes the authenticated session before reporting success', async () => {
      const response = await request(app)
        .post('/logout')
        .set('Authorization', 'Bearer test_token');

      expect(response.status).toBe(200);
      expect(authSecurityService.removeSession).toHaveBeenCalledWith('u1', 'session-1');
      expect(response.body.data.message).toBe('backend.logout_successful');
    });

    it('returns 503 when the authenticated session cannot be revoked', async () => {
      (authSecurityService.removeSession as jest.Mock).mockResolvedValueOnce(false);

      const response = await request(app)
        .post('/logout')
        .set('Authorization', 'Bearer test_token');

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('LOGOUT_REVOCATION_FAILED');
    });
  });

  describe('PUT /password', () => {
    it('does not write the new password when existing sessions cannot be revoked', async () => {
      (findAuthUserById as jest.Mock).mockResolvedValueOnce({
        id: 'u1',
        password_hash: 'current-password-hash'
      });
      (authSecurityService.invalidateSession as jest.Mock).mockResolvedValueOnce(false);

      const response = await request(app)
        .put('/password')
        .send({ currentPassword: 'Current123!', newPassword: 'NewPassword123!' });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('PASSWORD_SESSION_REVOCATION_FAILED');
      expect(updateAuthUserPassword).not.toHaveBeenCalled();
    });
  });
});
