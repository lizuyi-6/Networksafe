/**
 * Redteam test: JWT secret rotation support (D30)
 *
 * Verifies that:
 * 1. A token signed with JWT_SECRET_PREVIOUS is accepted (via fallback chain)
 * 2. A token signed with a third (invalid) secret is rejected
 * 3. verifyRefreshToken also accepts JWT_SECRET_PREVIOUS as fallback
 *
 * The env-var-controlled fallback (JWT_SECRET_PREVIOUS set → fallback active)
 * is tested using jest.isolateModules() to get a fresh module load with the
 * desired env var in place.
 */

import jwt from 'jsonwebtoken';

const CURRENT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
const PREV_SECRET    = 'prev-jwt-secret-minimum-32-characters-long!!';
const INVALID_SECRET = 'invalid-secret-that-no-one-uses';

const mockUser = {
    userId:       'test-user-1',
    email:        'test@example.com',
    username:     'testuser',
    role:         'tenant' as const,
    plan:         'starter' as const,
    tenantId:     'test-tenant-1',
    sessionId:    'test-session-1',
    permissions:  [],
};

describe('JWT secret rotation (D30)', () => {
    // -------------------------------------------------------------------------
    // Cryptographic baseline: prove PREV_SECRET and INVALID_SECRET behave
    // correctly when used as the verification key directly.
    // -------------------------------------------------------------------------
    describe('baseline: PREV_SECRET and INVALID_SECRET keys', () => {
        it('accepts PREV-signed token when verified against PREV_SECRET', async () => {
            const { verifyTokenWithSecret } = await import('../../middleware/auth.middleware');
            const token = jwt.sign(mockUser, PREV_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = verifyTokenWithSecret(token, PREV_SECRET);
            expect(decoded).not.toBeNull();
            expect(decoded!.userId).toBe(mockUser.userId);
        });

        it('accepts PREV-signed refresh token when verified against PREV_SECRET', async () => {
            const { verifyTokenWithSecret } = await import('../../middleware/auth.middleware');
            const token = jwt.sign(
                { userId: mockUser.userId, type: 'refresh', sessionId: mockUser.sessionId },
                PREV_SECRET,
                { expiresIn: '7d', algorithm: 'HS256' }
            );
            const decoded = verifyTokenWithSecret(token, PREV_SECRET);
            expect(decoded).not.toBeNull();
            expect(decoded!.userId).toBe(mockUser.userId);
        });
    });

    // -------------------------------------------------------------------------
    // Rotation window: JWT_SECRET_PREVIOUS is set → fallback chain active
    // -------------------------------------------------------------------------
    describe('with JWT_SECRET_PREVIOUS configured (rotation window)', () => {
        it('accepts PREV-signed token via verifyToken fallback', async () => {
            let mod: ReturnType<typeof import('../../middleware/auth.middleware')>;
            await jest.isolateModulesAsync(async () => {
                process.env.JWT_SECRET_PREVIOUS = PREV_SECRET;
                mod = await import('../../middleware/auth.middleware');
            });
            const token = jwt.sign(mockUser, PREV_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = mod!.verifyToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded!.userId).toBe(mockUser.userId);
        });

        it('accepts PREV-signed refresh token via verifyRefreshToken fallback', async () => {
            let mod: ReturnType<typeof import('../../middleware/auth.middleware')>;
            await jest.isolateModulesAsync(async () => {
                process.env.JWT_SECRET_PREVIOUS = PREV_SECRET;
                mod = await import('../../middleware/auth.middleware');
            });
            const token = jwt.sign(
                { userId: mockUser.userId, type: 'refresh', sessionId: mockUser.sessionId },
                PREV_SECRET,
                { expiresIn: '7d', algorithm: 'HS256' }
            );
            const decoded = mod!.verifyRefreshToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded!.userId).toBe(mockUser.userId);
        });

        it('still accepts CURRENT-signed token', async () => {
            let mod: ReturnType<typeof import('../../middleware/auth.middleware')>;
            await jest.isolateModulesAsync(async () => {
                process.env.JWT_SECRET_PREVIOUS = PREV_SECRET;
                mod = await import('../../middleware/auth.middleware');
            });
            const token = jwt.sign(mockUser, CURRENT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = mod!.verifyToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded!.userId).toBe(mockUser.userId);
        });

        it('rejects INVALID-signed token', async () => {
            let mod: ReturnType<typeof import('../../middleware/auth.middleware')>;
            await jest.isolateModulesAsync(async () => {
                process.env.JWT_SECRET_PREVIOUS = PREV_SECRET;
                mod = await import('../../middleware/auth.middleware');
            });
            const token = jwt.sign(mockUser, INVALID_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = mod!.verifyToken(token);
            expect(decoded).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // Normal operation (no rotation): JWT_SECRET_PREVIOUS not set → fallback
    // inactive → PREV-signed tokens must be rejected
    // -------------------------------------------------------------------------
    describe('without JWT_SECRET_PREVIOUS (normal operation)', () => {
        it('accepts CURRENT-signed token', async () => {
            const { verifyToken } = await import('../../middleware/auth.middleware');
            const token = jwt.sign(mockUser, CURRENT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = verifyToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded!.userId).toBe(mockUser.userId);
        });

        it('rejects PREV-signed token when JWT_SECRET_PREVIOUS is not configured', async () => {
            const { verifyToken } = await import('../../middleware/auth.middleware');
            const token = jwt.sign(mockUser, PREV_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = verifyToken(token);
            expect(decoded).toBeNull();
        });

        it('rejects INVALID-signed token', async () => {
            const { verifyToken } = await import('../../middleware/auth.middleware');
            const token = jwt.sign(mockUser, INVALID_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
            const decoded = verifyToken(token);
            expect(decoded).toBeNull();
        });
    });
});
