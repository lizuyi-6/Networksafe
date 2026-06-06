/**
 * REDTEAM SECURITY TEST — Refresh Token Reuse Detection (R4-w3 · V12.25)
 * ======================================================================
 *
 * Attack scenario:
 *   A stolen refresh token is replayed more than once. Without per-token
 *   consumption tracking, the second replay succeeds and a new pair is
 *   issued — the attacker keeps the session alive indefinitely.
 *
 * Fix (auth.routes.ts /refresh handler):
 *   On first use the token is marked as `refresh:used:<token>` in Redis.
 *   Any subsequent presentation hits this key and returns 401 TOKEN_INVALIDATED,
 *   invalidating the session family.
 *
 * Test:
 *   1. Register → get refresh token T0
 *   2. POST /api/auth/refresh with T0 → 200, T0 marked as used
 *   3. POST /api/auth/refresh with T0 again → 401 TOKEN_INVALIDATED
 *   4. Session is gone; subsequent refresh fails
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ── Stateful mock for Redis (tracks used refresh tokens) ─────────────────────
const usedRefreshTokens = new Set<string>();

jest.mock('../../security/redis.service', () => ({
    __esModule: true,
    default: {
        isAvailable: jest.fn().mockReturnValue(true),
        exists: jest.fn((key: string) =>
            // When the replay-detection key exists, return true (token already used)
            Promise.resolve(usedRefreshTokens.has(key))
        ),
        set: jest.fn((key: string) => {
            if (key.startsWith('refresh:used:')) {
                // Store the raw token value (key = 'refresh:used:<token>')
                usedRefreshTokens.add(key);
            }
            return Promise.resolve('OK');
        }),
        del: jest.fn().mockResolvedValue(undefined),
    }
}));

jest.mock('../../security/auth-security.service', () => ({
    __esModule: true,
    default: {
        generateSessionId: jest.fn().mockReturnValue('session-r4w3'),
        addSession: jest.fn().mockResolvedValue(undefined),
        checkConcurrentSessions: jest.fn().mockResolvedValue(true),
        validateSession: jest.fn().mockResolvedValue(true),
        removeSession: jest.fn().mockResolvedValue(undefined),
        isAccountLocked: jest.fn().mockResolvedValue(false),
        detectSuspiciousLogin: jest.fn().mockResolvedValue([]),
        recordLoginAttempt: jest.fn().mockResolvedValue(undefined),
        validatePassword: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    }
}));

jest.mock('../../security/audit-logger.service', () => ({
    __esModule: true,
    default: { log: jest.fn().mockResolvedValue(undefined) }
}));

jest.mock('../../config/enterprise-runtime', () => ({
    allowPasswordLogin: jest.fn(() => true),
    oidcRequireMfa: jest.fn(() => false),
}));

jest.mock('../../services/oidc-auth.service', () => ({
    oidcAuthService: { isConfigured: jest.fn(() => false) }
}));

jest.mock('../../middleware/rate-limit.middleware', () => ({
    authRateLimit: jest.fn(),
}));

jest.mock('../../modules/auth/auth-user.repository', () => ({
    createAuthUser: jest.fn().mockResolvedValue(undefined),
    findAuthUserByEmail: jest.fn().mockResolvedValue(null),  // user doesn't exist
    findAuthUserById: jest.fn().mockResolvedValue({
        id: 'test-user-r4w3',
        email: 'test-r4w3@example.com',
        username: 'testuser',
        role: 'tenant',
        plan: 'starter',
        tenant_id: 'tenant-r4w3',
        status: 'active',
        password_hash: '$2b$12$LQv3c1yqBWVHxkd0L5kLOGdr1J1J1J1J1J1J1J1J1J1J1J1J1J1J'
    }),
    recordLoginHistory: jest.fn(),
    touchAuthUserLastLogin: jest.fn(),
    updateAuthUserPassword: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

// ── Test setup ─────────────────────────────────────────────────────────────────
let app: express.Application;
const TEST_EMAIL = `r4w3-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'Str0ng!Pass2';
const TEST_USERNAME = 'r4w3user';

// Set required env vars BEFORE importing anything that reads them
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-r4w3';
process.env.AUDIT_LOG_SECRET = 'test-audit-secret-at-least-32-chars-r4w3';

import { initDatabase, closeDatabase } from '../../config/database';
import authRouter from '../../api/routes/auth.routes';

beforeAll(async () => {
    process.env.DATA_DIR = `/tmp/refresh-reuse-test-${Date.now()}`;
    await initDatabase();

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
});

afterAll(async () => {
    await closeDatabase();
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('Refresh token replay detection', () => {
    let refreshToken: string;

    it('should issue tokens on registration', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: TEST_EMAIL, password: TEST_PASSWORD, username: TEST_USERNAME });

        expect(res.status).toBe(201);
        const cookies: string[] = res.headers['set-cookie'] || [];
        const refreshCookie = cookies.find((c: string) => c.startsWith('refreshToken='));
        expect(refreshCookie).toBeDefined();
        refreshToken = refreshCookie!.split(';')[0].replace('refreshToken=', '');
    });

    it('should succeed on first use of the refresh token', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', [`refreshToken=${refreshToken}`]);

        // First use: token not yet in `usedRefreshTokens`, should issue new pair
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('should reject a replay of the SAME refresh token with TOKEN_INVALIDATED', async () => {
        // Replay: token IS now in `usedRefreshTokens`, handler returns 401
        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', [`refreshToken=${refreshToken}`]);

        expect(res.status).toBe(401);
        expect(res.body.error?.code).toBe('TOKEN_INVALIDATED');
    });

    it('should fail on subsequent replay attempts', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', [`refreshToken=${refreshToken}`]);

        // Token still flagged as used; session was removed by the previous call
        expect([401, 503]).toContain(res.status);
    });
});
