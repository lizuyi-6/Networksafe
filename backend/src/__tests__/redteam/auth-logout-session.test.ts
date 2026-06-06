/**
 * REDTEAM SECURITY TEST — Auth logout session removal (D7 Task 2)
 * ===============================================================
 *
 * Bug: The logout handler only called removeSession(userId, sessionId)
 * when sessionId was present in the token.  Pre-sessionId tokens
 * (issued before the V9.x change) could not identify which session to
 * revoke, so the session row remained in authSecurityService and the
 * next request would re-admit the same sessionId via validateSession.
 *
 * Fix: When sessionId is absent from the token, invalidateSession(userId)
 * is called to revoke ALL sessions for that user.  A WARNING audit entry
 * is also written to record the legacy-token event.
 *
 * Red-team test:
 *   - Register a real user via the test app (gets a userId in the DB)
 *   - Directly manipulate the fallback session store to plant a session
 *   - Mint a legacy JWT that carries no sessionId claim
 *   - Call POST /api/auth/logout with that token
 *   - Assert the session row was removed (validateSession returns false)
 *   - Assert the audit WARNING was emitted
 */

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import authRouter from '../../api/routes/auth.routes';
import authSecurityService from '../../security/auth-security.service';
import auditLogger from '../../security/audit-logger.service';

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cookieParser());

const TEST_USER_ID = `legacy-test-user-${Date.now()}`;
const TEST_EMAIL = 'legacy-logout@example.com';
const JWT_TEST_SECRET = 'test-jwt-secret-at-least-32-chars-long-ok';

// Mock authenticate to set req.user directly (bypassing JWT verifyTokenAsync)
// while still allowing the handler to decode the Authorization header.
const mockAuthenticate = jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: TEST_USER_ID, email: TEST_EMAIL, role: 'user', tenantId: 'tenant-001' };
    next();
});
jest.mock('../../middleware/auth.middleware', () => ({
    authenticate: mockAuthenticate,
    verifyRefreshToken: jest.fn()
}));
jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

// Re-import router after mocking — use require for dynamic resolution
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authRouter = require('../../api/routes/auth.routes').default;
app.use('/api/auth', authRouter);

const testDataDir = path.join(os.tmpdir(), `aetherguard-logout-session-test-${Date.now()}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mintLegacyToken(): string {
    // Pre-V9.x payload shape — no sessionId field.
    return jwt.sign(
        { sub: TEST_USER_ID, email: TEST_EMAIL, role: 'user', permissions: [] },
        JWT_TEST_SECRET,
        { expiresIn: '1h', algorithm: 'HS256' }
    );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('REDTEAM auth logout session removal', () => {
    beforeEach(async () => {
        mockAuthenticate.mockClear();
        // Reset fallback maps for test isolation
        authSecurityService['sessionsFallback'] = new Map();
        authSecurityService['concurrentSessionsFallback'] = new Map();
    });

    it('revokes all sessions and emits WARNING audit log', async () => {
        // ── 1. Plant a session row in the fallback store ─────────────────────
        const sessionId = authSecurityService.generateSessionId();
        await authSecurityService.addSession(TEST_USER_ID, sessionId, { device: 'test-phone' });
        expect(await authSecurityService.validateSession(TEST_USER_ID, sessionId)).toBe(true);

        // ── 2. Spy on auditLogger.log ────────────────────────────────────────
        const auditSpy = jest.spyOn(auditLogger, 'log').mockResolvedValue('audit-legacy-001');

        // ── 3. Mint a legacy token (no sessionId claim) ────────────────────
        const legacyToken = mintLegacyToken();

        // ── 4. Call POST /api/auth/logout ───────────────────────────────────
        const response = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${legacyToken}`);

        expect(response.status).toBe(200);

        // ── 5. Assert session was removed ────────────────────────────────────
        expect(await authSecurityService.validateSession(TEST_USER_ID, sessionId)).toBe(false);

        // ── 6. Assert WARNING audit entry was emitted ────────────────────────
        expect(auditSpy).toHaveBeenCalled();
        const auditCall = auditSpy.mock.calls.find(
            (call) => (call[0] as any).eventType === 'logout_legacy_token'
        );
        expect(auditCall).toBeDefined();
        expect((auditCall![0] as any).severity).toBe('warning');
        expect((auditCall![0] as any).details.reason).toBe(
            'sessionId missing — all sessions revoked'
        );

        auditSpy.mockRestore();
    });

    it('still emits WARNING audit log when user has no sessions', async () => {
        const auditSpy = jest.spyOn(auditLogger, 'log').mockResolvedValue('audit-no-sess-001');
        const legacyToken = mintLegacyToken();

        const response = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${legacyToken}`);

        expect(response.status).toBe(200);
        expect(auditSpy).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'logout_legacy_token', severity: 'warning' })
        );

        auditSpy.mockRestore();
    });
});
