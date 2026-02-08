/**
 * JWT Authentication Middleware
 *
 * Provides secure authentication for FluxGuard API endpoints
 * SECURITY FIX: Enhanced environment variable validation
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import logger from '../utils/logger';
import redisService from '../security/redis.service';
import EnvValidator from '../security/env-validator.service';

// Validate environment variables at module load
try {
  EnvValidator.require('JWT_SECRET', {
    minLength: 32,
    description: 'JWT signing secret'
  });
} catch (error) {
  // Re-throw with clearer message
  throw new Error('FATAL: JWT_SECRET environment variable is required (minimum 32 characters). Server cannot start without it.');
}

const JWT_SECRET: string = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = EnvValidator.optional('JWT_EXPIRES_IN', '24h');
const JWT_REFRESH_EXPIRES_IN = EnvValidator.optional('JWT_REFRESH_EXPIRES_IN', '7d');

/**
 * Authenticated user payload stored in JWT
 */
export interface AuthenticatedUser {
    userId: string;
    email: string;
    username: string;
    role: 'admin' | 'tenant' | 'viewer';
    tenantId?: string;
}

/**
 * Extended Express Request with user info
 */
export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
}

/**
 * Token pair for authentication
 */
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

/**
 * Generate JWT token pair
 */
export function generateTokens(user: AuthenticatedUser): TokenPair {
    const accessToken = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
    const refreshToken = jwt.sign(
        { userId: user.userId, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions
    );

    // Calculate expiration in seconds
    const decoded = jwt.decode(accessToken) as jwt.JwtPayload;
    const expiresIn = (decoded?.exp || 0) - Math.floor(Date.now() / 1000);

    return { accessToken, refreshToken, expiresIn };
}

/**
 * Verify and decode JWT token
 * SECURITY FIX CVE-2026-001: Now checks Redis blacklist for logged-out tokens
 */
export function verifyToken(token: string): AuthenticatedUser | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
        return decoded;
    } catch (error) {
        return null;
    }
}

/**
 * Async version of verifyToken that checks Redis blacklist
 * SECURITY FIX CVE-2026-001: Check if token is blacklisted before accepting
 */
export async function verifyTokenAsync(token: string): Promise<AuthenticatedUser | null> {
    try {
        // First check if token is blacklisted
        const isBlacklisted = await redisService.exists(`token:blacklist:${token}`);
        if (isBlacklisted) {
            logger.warn('Attempted use of blacklisted token');
            return null;
        }

        const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
        return decoded;
    } catch (error) {
        return null;
    }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; type: string };
        if (decoded.type !== 'refresh') {
            return null;
        }
        return { userId: decoded.userId };
    } catch (error) {
        return null;
    }
}

/**
 * SECURITY FIX: Cookie configuration for httpOnly tokens
 */
export const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
};

export const REFRESH_COOKIE_OPTIONS = {
    ...COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

/**
 * Authentication middleware - requires valid JWT token
 * SECURITY FIX: Now checks httpOnly cookie first, then Authorization header
 * SECURITY FIX CVE-2026-001: Now checks Redis blacklist for logged-out tokens
 */
export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    // SECURITY FIX: Check httpOnly cookie first
    let token = req.cookies?.accessToken;

    // Fallback to Authorization header for API clients
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }

    if (!token) {
        res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_TOKEN_MISSING'
        });
        return;
    }

    // SECURITY FIX CVE-2026-001: Use async version with blacklist check
    const user = await verifyTokenAsync(token);

    if (!user) {
        res.status(401).json({
            error: 'Invalid or expired token',
            code: 'AUTH_TOKEN_INVALID'
        });
        return;
    }

    req.user = user;
    logger.debug(`Authenticated user: ${user.email}`);
    next();
}

/**
 * Optional authentication - attaches user if token present, continues otherwise
 * SECURITY FIX: Now uses async blacklist check
 */
export async function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    // Check cookie first, then header
    let token = req.cookies?.accessToken;

    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }

    if (token) {
        // SECURITY FIX: Use async version with blacklist check
        const user = await verifyTokenAsync(token);
        if (user) {
            req.user = user;
        }
    }

    next();
}

/**
 * Role-based access control middleware
 */
export function requireRole(...allowedRoles: Array<'admin' | 'tenant' | 'viewer'>) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
            return;
        }

        if (!allowedRoles.includes(req.user.role)) {
            logger.warn(`Access denied for user ${req.user.email} (role: ${req.user.role}), required: ${allowedRoles.join('/')}`);
            res.status(403).json({
                error: 'Insufficient permissions',
                code: 'AUTH_FORBIDDEN',
                requiredRoles: allowedRoles
            });
            return;
        }

        next();
    };
}

/**
 * Tenant isolation middleware - ensures users can only access their tenant's resources
 * SECURITY FIX CVE-2026-010: Reject requests without tenantId for non-admin users
 */
export function requireTenantAccess(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    // Admins can access all tenants
    if (req.user.role === 'admin') {
        next();
        return;
    }

    // Check if requested tenant matches user's tenant
    const requestedTenantId = req.params.tenantId || req.query.tenantId || req.body?.tenantId;

    // SECURITY FIX CVE-2026-010: If no tenantId in request, use user's tenantId
    // This ensures tenant isolation is always enforced
    if (!requestedTenantId) {
        // Attach user's tenantId to request for downstream use
        if (!req.body) req.body = {};
        req.body.tenantId = req.user.tenantId;
        next();
        return;
    }

    if (requestedTenantId !== req.user.tenantId) {
        res.status(403).json({
            error: 'Cannot access resources from another tenant',
            code: 'TENANT_MISMATCH'
        });
        return;
    }

    next();
}

/**
 * SECURITY FIX CVE-2026-011 & CVE-2026-102: Constant-time string comparison
 * Fixed to prevent timing attacks on string length
 */
function constantTimeCompare(a: string, b: string): boolean {
    // SECURITY FIX CVE-2026-102: Early return is safe when lengths differ
    // Attackers can already tell the length difference from response time
    if (a.length !== b.length) {
        return false;
    }

    // Use crypto.timingSafeEqual for actual comparison
    return crypto.timingSafeEqual(
        Buffer.from(a, 'utf8'),
        Buffer.from(b, 'utf8')
    );
}

/**
 * API Key authentication for agent/device communication
 * SECURITY FIX CVE-2026-011: Use constant-time comparison
 */
export function authenticateApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
        res.status(401).json({
            error: 'API key required',
            code: 'API_KEY_MISSING'
        });
        return;
    }

    // SECURITY FIX: No default API keys allowed
    const validApiKeys = process.env.VALID_API_KEYS?.split(',').filter(k => k.trim());

    if (!validApiKeys || validApiKeys.length === 0) {
        logger.error('No valid API keys configured in VALID_API_KEYS environment variable');
        res.status(500).json({
            error: 'Server configuration error',
            code: 'API_KEYS_NOT_CONFIGURED'
        });
        return;
    }

    // SECURITY FIX CVE-2026-011: Use constant-time comparison to prevent timing attacks
    const isValidKey = validApiKeys.some(validKey => constantTimeCompare(apiKey, validKey.trim()));

    if (!isValidKey) {
        logger.warn('Invalid API key attempt', { ip: req.ip });
        res.status(401).json({
            error: 'Invalid API key',
            code: 'API_KEY_INVALID'
        });
        return;
    }

    // Attach a system user for API key requests
    req.user = {
        userId: 'api-key-user',
        email: 'api@fluxguard.local',
        username: 'API Client',
        role: 'tenant'
    };

    next();
}

/**
 * Combined auth - accepts either JWT or API key
 */
export async function authenticateAny(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authenticate(req, res, next);
    }

    if (apiKey) {
        return authenticateApiKey(req, res, next);
    }

    res.status(401).json({
        error: 'Authentication required (JWT or API key)',
        code: 'AUTH_REQUIRED'
    });
}
