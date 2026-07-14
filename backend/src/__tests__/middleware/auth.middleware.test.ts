/**
 * Tests for the auth middleware's pure/semi-pure surface: JWT generation and
 * verification (incl. rotation fallback + bad-token handling), and the
 * requireRole / requirePermission authorization gates. DB/Redis-backed paths
 * (verifyTokenAsync blacklist, authenticateApiKey store lookup) are out of scope.
 */

import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
    generateTokens,
    verifyToken,
    verifyTokenAsyncDetailed,
    verifyTokenWithSecret,
    verifyRefreshToken,
    buildCookieOptions,
    authenticate,
    authenticateApiKey,
    authenticateAny,
    requireRole,
    requirePermission,
    type AuthenticatedUser,
    type AuthenticatedRequest
} from '../../middleware/auth.middleware';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
    return {
        userId: 'u1',
        email: 'u1@example.com',
        role: 'tenant_admin',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
        ...overrides
    } as AuthenticatedUser;
}

function makeAuthedReq(user: AuthenticatedUser | null): AuthenticatedRequest {
    return { user } as AuthenticatedRequest;
}

function stubRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    return { res: { status, json } as unknown as Response, status, json };
}

function expectErrorEnvelope(
    json: jest.Mock,
    code: string,
    message: string,
    legacy: Record<string, unknown> = {}
): void {
    expect(json).toHaveBeenCalledWith({
        success: false,
        data: null,
        error: expect.objectContaining({ code, message }),
        code,
        message,
        ...legacy
    });
}

describe('auth.middleware — JWT primitives', () => {
    describe('generateTokens + verifyToken round-trip', () => {
        it('issues an access token that verifies back to the user (role normalized)', () => {
            const { accessToken } = generateTokens(makeUser({ role: 'admin' /* legacy alias */ }));
            const decoded = verifyToken(accessToken);
            expect(decoded).not.toBeNull();
            expect(decoded?.userId).toBe('u1');
            expect(decoded?.sessionId).toBe('session-1');
            expect(decoded?.role).toBe('platform_admin'); // admin -> platform_admin
        });

        it('issues a refresh token of type "refresh"', () => {
            const { refreshToken } = generateTokens(makeUser());
            const decoded = verifyRefreshToken(refreshToken);
            expect(decoded).not.toBeNull();
            expect(decoded?.userId).toBe('u1');
        });

        it('populate permissions when not provided', () => {
            const { accessToken } = generateTokens(makeUser({ permissions: undefined } as any));
            const decoded = verifyToken(accessToken);
            expect(Array.isArray(decoded?.permissions)).toBe(true);
            expect(decoded?.permissions!.length).toBeGreaterThan(0);
        });
    });

    describe('verifyTokenWithSecret', () => {
        it('returns the decoded user for a token signed with the same secret', () => {
            const { accessToken } = generateTokens(makeUser());
            const secret = process.env.JWT_SECRET!;
            expect(verifyTokenWithSecret(accessToken, secret)?.userId).toBe('u1');
        });
        it('returns null for a token signed with a different secret', () => {
            const token = jwt.sign(makeUser(), 'a-different-secret-min-32-characters!!!', { algorithm: 'HS256' });
            expect(verifyTokenWithSecret(token, process.env.JWT_SECRET!)).toBeNull();
        });
        it('returns null for malformed input', () => {
            expect(verifyTokenWithSecret('not-a-jwt', process.env.JWT_SECRET!)).toBeNull();
            expect(verifyTokenWithSecret('', process.env.JWT_SECRET!)).toBeNull();
        });
    });

    describe('verifyToken error handling', () => {
        it('returns null for a malformed token', () => {
            expect(verifyToken('garbage')).toBeNull();
            expect(verifyToken('')).toBeNull();
        });
        it('returns null for an expired token', () => {
            const expired = jwt.sign(makeUser(), process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '-1s' });
            expect(verifyToken(expired)).toBeNull();
        });
        it('rejects a sessionless access token in the test runtime too', async () => {
            const { accessToken } = generateTokens(makeUser({ sessionId: undefined }));

            await expect(verifyTokenAsyncDetailed(accessToken)).resolves.toEqual({
                user: null,
                failureReason: 'invalid_session'
            });
        });
    });

    describe('verifyRefreshToken', () => {
        it('returns null for a non-refresh token', () => {
            const { accessToken } = generateTokens(makeUser()); // access, not refresh
            expect(verifyRefreshToken(accessToken)).toBeNull();
        });
        it('returns null for garbage', () => {
            expect(verifyRefreshToken('nope')).toBeNull();
        });
    });
});

describe('auth.middleware — cookie options', () => {
    it('sets SameSite=strict for auth cookies', () => {
        const options = buildCookieOptions({ secure: false, headers: {} } as any);

        expect(options.sameSite).toBe('strict');
    });
});

describe('auth.middleware authentication error envelopes', () => {
    it('returns the project envelope when the JWT is missing', async () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();

        await authenticate({ cookies: {}, headers: {} } as AuthenticatedRequest, res, next as NextFunction);

        expect(status).toHaveBeenCalledWith(401);
        expectErrorEnvelope(json, 'AUTH_TOKEN_MISSING', 'backend.authentication_required');
        expect(next).not.toHaveBeenCalled();
    });

    it('returns the project envelope when the JWT is invalid', async () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();

        await authenticate({ cookies: { accessToken: 'not-a-jwt' }, headers: {} } as AuthenticatedRequest, res, next as NextFunction);

        expect(status).toHaveBeenCalledWith(401);
        expectErrorEnvelope(json, 'AUTH_TOKEN_INVALID', 'backend.invalid_or_expired_token');
        expect(next).not.toHaveBeenCalled();
    });

    it('returns the project envelope when the API key is missing', () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();

        authenticateApiKey({ headers: {} } as AuthenticatedRequest, res, next as NextFunction);

        expect(status).toHaveBeenCalledWith(401);
        expectErrorEnvelope(json, 'API_KEY_MISSING', 'backend.api_key_required');
        expect(next).not.toHaveBeenCalled();
    });

    it('returns the project envelope when API keys are not configured', () => {
        const originalValidApiKeys = process.env.VALID_API_KEYS;
        delete process.env.VALID_API_KEYS;
        try {
            const { res, status, json } = stubRes();
            const next = jest.fn();

            authenticateApiKey({ headers: { 'x-api-key': 'present-but-unconfigured' } } as unknown as AuthenticatedRequest, res, next as NextFunction);

            expect(status).toHaveBeenCalledWith(500);
            expectErrorEnvelope(json, 'API_KEYS_NOT_CONFIGURED', 'backend.server_configuration_error');
            expect(next).not.toHaveBeenCalled();
        } finally {
            if (originalValidApiKeys === undefined) delete process.env.VALID_API_KEYS;
            else process.env.VALID_API_KEYS = originalValidApiKeys;
        }
    });

    it('returns the project envelope when the API key is invalid', () => {
        const originalValidApiKeys = process.env.VALID_API_KEYS;
        process.env.VALID_API_KEYS = 'valid-api-key-minimum-test-value';
        try {
            const { res, status, json } = stubRes();
            const next = jest.fn();

            authenticateApiKey({ headers: { 'x-api-key': 'invalid-api-key-value' } } as unknown as AuthenticatedRequest, res, next as NextFunction);

            expect(status).toHaveBeenCalledWith(401);
            expectErrorEnvelope(json, 'API_KEY_INVALID', 'backend.invalid_api_key');
            expect(next).not.toHaveBeenCalled();
        } finally {
            if (originalValidApiKeys === undefined) delete process.env.VALID_API_KEYS;
            else process.env.VALID_API_KEYS = originalValidApiKeys;
        }
    });

    it('returns the project envelope when neither combined-auth credential is present', async () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();

        await authenticateAny({ headers: {} } as AuthenticatedRequest, res, next as NextFunction);

        expect(status).toHaveBeenCalledWith(401);
        expectErrorEnvelope(json, 'AUTH_REQUIRED', 'backend.authentication_required_jwt_or_api_key');
        expect(next).not.toHaveBeenCalled();
    });
});

describe('auth.middleware — requireRole gate', () => {
    it('calls next when the role is allowed', () => {
        const next = jest.fn();
        requireRole('platform_admin', 'tenant_admin')(
            makeAuthedReq(makeUser({ role: 'tenant_admin' })),
            stubRes().res,
            next as NextFunction
        );
        expect(next).toHaveBeenCalled();
    });
    it('accepts legacy role aliases (admin -> platform_admin)', () => {
        const next = jest.fn();
        requireRole('platform_admin')(
            makeAuthedReq(makeUser({ role: 'admin' as any })),
            stubRes().res,
            next as NextFunction
        );
        expect(next).toHaveBeenCalled();
    });
    it('rejects with 401 when no user is authenticated', () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();
        requireRole('tenant_admin')(makeAuthedReq(null), res, next as NextFunction);
        expect(status).toHaveBeenCalledWith(401);
        expectErrorEnvelope(json, 'AUTH_REQUIRED', 'backend.authentication_required');
        expect(next).not.toHaveBeenCalled();
    });
    it('rejects with 403 when the role is not allowed', () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();
        const requiredRoles = ['platform_admin'];
        requireRole('platform_admin')(
            makeAuthedReq(makeUser({ role: 'tenant_viewer' })),
            res,
            next as NextFunction
        );
        expect(status).toHaveBeenCalledWith(403);
        expectErrorEnvelope(json, 'AUTH_FORBIDDEN', 'backend.insufficient_permissions', { requiredRoles });
        expect(json.mock.calls[0][0].error.details.requiredRoles).toEqual(requiredRoles);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('auth.middleware — requirePermission gate', () => {
    it('allows when the user has the required permission', () => {
        const next = jest.fn();
        // platform_admin has final_defense.execute
        requirePermission('final_defense.execute')(
            makeAuthedReq(makeUser({ role: 'platform_admin', permissions: ['final_defense.execute'] as any })),
            stubRes().res,
            next as NextFunction
        );
        expect(next).toHaveBeenCalled();
    });
    it('rejects with 401 when no user', () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();
        requirePermission('audit.read')(makeAuthedReq(null), res, next as NextFunction);
        expect(status).toHaveBeenCalledWith(401);
        expectErrorEnvelope(json, 'AUTH_REQUIRED', 'backend.authentication_required');
        expect(next).not.toHaveBeenCalled();
    });
    it('rejects with 403 when the permission is missing', () => {
        const { res, status, json } = stubRes();
        const next = jest.fn();
        const missingPermissions = ['gate.manage'];
        requirePermission('gate.manage')(
            makeAuthedReq(makeUser({ role: 'tenant_viewer', permissions: ['auth.oidc_login'] as any })),
            res,
            next as NextFunction
        );
        expect(status).toHaveBeenCalledWith(403);
        expectErrorEnvelope(json, 'AUTH_PERMISSION_FORBIDDEN', 'backend.insufficient_permissions', { missingPermissions });
        expect(json.mock.calls[0][0].error.details.missingPermissions).toEqual(missingPermissions);
        expect(next).not.toHaveBeenCalled();
    });
});
