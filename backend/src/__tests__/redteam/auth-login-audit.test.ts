/**
 * Auth Login Audit — Redteam Regression Test
 *
 * Verifies that failed login attempts are correctly audit-logged:
 *   - Wrong password  -> eventType: 'failed_login'
 *   - User not found  -> eventType: 'failed_login'
 *   - Locked account  -> eventType: 'login_locked_account'
 *
 * D24 observation: the isLocked path was missing an audit event (now fixed).
 */

import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';

jest.mock('../../testing/test-runtime-adapter', () => ({
  authRateLimitAdapter: jest.fn(() => (req: any, _res: any, next: any) => next()),
  isTestRuntime: jest.fn().mockReturnValue(false),
  passwordWeakResponseAdapter: jest.fn((r: any) => r),
  validatePasswordAdapter: jest.fn((p: any) => ({ valid: true, message: '' })),
}));

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn().mockReturnValue(false),
    exists: jest.fn().mockResolvedValue(false),
    set: jest.fn().mockResolvedValue('OK'),
  }
}));

jest.mock('../../security/auth-security.service', () => ({
  __esModule: true,
  default: {
    isAccountLocked: jest.fn().mockResolvedValue(false),
    getLockInfo: jest.fn().mockResolvedValue({ remainingTime: 0 }),
    detectSuspiciousLogin: jest.fn().mockResolvedValue([]),
    recordLoginAttempt: jest.fn().mockResolvedValue(undefined),
    applyFailureDelay: jest.fn().mockResolvedValue(undefined),
    getFailedAttempts: jest.fn().mockResolvedValue([]),
    getSessionOidcToken: jest.fn().mockResolvedValue(null),
    validatePassword: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    generateSessionId: jest.fn().mockReturnValue('session-1'),
    checkConcurrentSessions: jest.fn().mockResolvedValue(true),
    addSession: jest.fn().mockResolvedValue(undefined),
    removeSession: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../config/enterprise-runtime', () => ({
  allowPasswordLogin: jest.fn().mockReturnValue(true),
  oidcRequireMfa: jest.fn().mockReturnValue(false),
}));

jest.mock('../../services/oidc-auth.service', () => ({
  oidcAuthService: {
    isConfigured: jest.fn(() => true),
    buildState: jest.fn(() => 'oidc-state-1'),
    buildStateAndNonce: jest.fn(() => ({ state: 'oidc-state-1', nonce: 'oidc-nonce-1' })),
    buildAuthorizationUrl: jest.fn(() => 'https://idp.example.test/auth?state=oidc-state-1&nonce=oidc-nonce-1'),
    verifyIdToken: jest.fn().mockResolvedValue({ valid: true, claims: { sub: 'oidc-sub-1', amr: ['pwd', 'mfa'] } }),
    exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'oidc-access-token', idToken: 'oidc-id-token' }),
    fetchUserProfile: jest.fn().mockResolvedValue({ sub: 'oidc-sub-1', email: 'oidc@example.com', amr: ['pwd', 'mfa'] }),
    validateMfaEvidence: jest.fn(() => ({ valid: true })),
    resolveUser: jest.fn().mockResolvedValue({
      row: {
        id: 'oidc-user-1',
        email: 'oidc@example.com',
        username: 'oidcuser',
        role: 'tenant',
        plan: 'starter',
        tenant_id: 'tenant-oidc',
        status: 'active',
        password_hash: 'oidc:oidc-sub-1'
      },
      isProvisioned: false
    }),
    buildSessionUser: jest.fn((row: any) => ({
      userId: row.id,
      email: row.email,
      username: row.username,
      role: row.role,
      plan: row.plan,
      tenantId: row.tenant_id,
      permissions: []
    })),
    revokeToken: jest.fn().mockResolvedValue(undefined)
  }
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

import authRouter from '../../api/routes/auth.routes';
import auditLogger from '../../security/audit-logger.service';
import authSecurityService from '../../security/auth-security.service';
import { findAuthUserByEmail } from '../../modules/auth/auth-user.repository';
import { allowPasswordLogin } from '../../config/enterprise-runtime';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(authRouter);

describe('Auth login audit (redteam)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (allowPasswordLogin as jest.Mock).mockReturnValue(true);
  });

  it('fires 5 audit events for 5 wrong-password attempts (failed_login)', async () => {
    const targetEmail = 'wrongpw@example.com';
    const bcrypt = require('bcryptjs');

    (findAuthUserByEmail as jest.Mock).mockResolvedValue({
      id: 'audit-user-id',
      email: targetEmail,
      username: 'audittest',
      role: 'tenant',
      plan: 'starter',
      password_hash: '$2b$12$hashedpasswordfortest',
      tenant_id: 'audit-tenant',
      status: 'active'
    });

    for (let i = 0; i < 5; i++) {
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      const response = await request(app)
        .post('/login')
        .send({ email: targetEmail, password: `WrongPassword${i}!` });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    }

    const failedLoginCalls = (auditLogger.log as jest.Mock).mock.calls.filter(
      ([call]: [any]) => call.eventType === 'failed_login'
    );
    expect(failedLoginCalls).toHaveLength(5);
    failedLoginCalls.forEach(([call]: [any]) => {
      expect(call.category).toBe('auth');
      expect(call.severity).toBe('warning');
      expect(call.status).toBe('failure');
      expect(call.actor?.email).toBe(targetEmail);
    });
  });

  it('fires failed_login audit event when user does not exist', async () => {
    (findAuthUserByEmail as jest.Mock).mockResolvedValue(null);

    const response = await request(app)
      .post('/login')
      .send({ email: 'ghost@example.com', password: 'AnyPassword123!' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');

    const failedLoginCalls = (auditLogger.log as jest.Mock).mock.calls.filter(
      ([call]: [any]) => call.eventType === 'failed_login'
    );
    expect(failedLoginCalls).toHaveLength(1);
    const [call] = failedLoginCalls;
    expect(call[0].category).toBe('auth');
    expect(call[0].severity).toBe('warning');
    expect(call[0].status).toBe('failure');
    expect(call[0].actor?.email).toBe('ghost@example.com');
    expect(call[0].details?.reason).toBe('user_not_found');
  });

  it('fires login_locked_account audit event when account is locked', async () => {
    const targetEmail = 'locked@example.com';
    let attemptCount = 0;

    (findAuthUserByEmail as jest.Mock).mockResolvedValue({
      id: 'locked-user-id',
      email: targetEmail,
      username: 'lockeduser',
      role: 'tenant',
      plan: 'starter',
      password_hash: '$2b$12$hashedpasswordfortest',
      tenant_id: 'locked-tenant',
      status: 'active'
    });

    (authSecurityService.isAccountLocked as jest.Mock).mockImplementation(async () => {
      attemptCount++;
      return attemptCount > 3;
    });

    (authSecurityService.getLockInfo as jest.Mock).mockResolvedValue({ remainingTime: 600 });

    const bcrypt = require('bcryptjs');
    // First 3 attempts: not locked yet, bcrypt returns false
    for (let i = 0; i < 3; i++) {
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      await request(app)
        .post('/login')
        .send({ email: targetEmail, password: `WrongPassword${i}!` });
    }

    // 4th attempt: account is locked (isAccountLocked returns true)
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
    const response = await request(app)
      .post('/login')
      .send({ email: targetEmail, password: 'WrongPassword3!' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_LOCKED');

    const lockedCalls = (auditLogger.log as jest.Mock).mock.calls.filter(
      ([call]: [any]) => call.eventType === 'login_locked_account'
    );
    expect(lockedCalls).toHaveLength(1);
    const [call] = lockedCalls;
    expect(call[0].category).toBe('auth');
    expect(call[0].severity).toBe('warning');
    expect(call[0].status).toBe('failure');
    expect(call[0].actor?.email).toBe(targetEmail);
  });
});
