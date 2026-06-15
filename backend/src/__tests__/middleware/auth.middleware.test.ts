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
    verifyTokenWithSecret,
    verifyRefreshToken,
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

describe('auth.middleware — JWT primitives', () => {
    describe('generateTokens + verifyToken round-trip', () => {
        it('issues an access token that verifies back to the user (role normalized)', () => {
            const { accessToken } = generateTokens(makeUser({ role: 'admin' /* legacy alias */ }));
            const decoded = verifyToken(accessToken);
            expect(decoded).not.toBeNull();
            expect(decoded?.userId).toBe('u1');
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
        const { res, status } = stubRes();
        const next = jest.fn();
        requireRole('tenant_admin')(makeAuthedReq(null), res, next as NextFunction);
        expect(status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
    it('rejects with 403 when the role is not allowed', () => {
        const { res, status } = stubRes();
        const next = jest.fn();
        requireRole('platform_admin')(
            makeAuthedReq(makeUser({ role: 'tenant_viewer' })),
            res,
            next as NextFunction
        );
        expect(status).toHaveBeenCalledWith(403);
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
        const { res, status } = stubRes();
        const next = jest.fn();
        requirePermission('audit.read')(makeAuthedReq(null), res, next as NextFunction);
        expect(status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
    it('rejects with 403 when the permission is missing', () => {
        const { res, status } = stubRes();
        const next = jest.fn();
        requirePermission('gate.manage')(
            makeAuthedReq(makeUser({ role: 'tenant_viewer', permissions: ['auth.oidc_login'] as any })),
            res,
            next as NextFunction
        );
        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
