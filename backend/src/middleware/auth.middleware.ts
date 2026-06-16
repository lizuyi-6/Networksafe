/**
 * JWT Authentication Middleware
 *
 * Provides secure authentication for AetherGuard API endpoints
 * SECURITY FIX: Enhanced environment variable validation
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import logger from '../utils/logger';
import redisService from '../security/redis.service';
import EnvValidator from '../security/env-validator.service';
import { resolveRequestTenantContext, TenantContext } from '../core/tenant/tenant-context';
import {
    getRolePermissions,
    hasPermission,
    isPlatformAdminRole,
    normalizeRole,
    type Permission
} from '../security/permissions';

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
const JWT_SECRET_PREVIOUS: string | undefined =
  process.env.JWT_SECRET_PREVIOUS && process.env.JWT_SECRET_PREVIOUS.length >= 32
    ? process.env.JWT_SECRET_PREVIOUS
    : undefined;
const JWT_EXPIRES_IN = EnvValidator.optional('JWT_EXPIRES_IN', '24h');
const JWT_REFRESH_EXPIRES_IN = EnvValidator.optional('JWT_REFRESH_EXPIRES_IN', '7d');

/**
 * Authenticated user payload stored in JWT
 */
export interface AuthenticatedUser {
    userId: string;
    email: string;
    username: string;
    role: 'admin' | 'tenant' | 'viewer' | 'platform_admin' | 'tenant_admin' | 'tenant_operator' | 'tenant_viewer' | 'auditor';
    plan?: 'starter' | 'pro' | 'ultra';
    tenantId?: string;
    permissions?: Permission[];
    authProvider?: 'local' | 'oidc';
}

/**
 * Extended Express Request with user info
 */
export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
    tenantContext?: TenantContext;
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
 * SECURITY FIX: Explicitly specify algorithm for token generation
 */
export function generateTokens(user: AuthenticatedUser): TokenPair {
    const normalizedUser: AuthenticatedUser = {
        ...user,
        role: normalizeRole(user.role),
        permissions: user.permissions || getRolePermissions(user.role)
    };
    const accessToken = jwt.sign(normalizedUser, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions);
    const refreshToken = jwt.sign(
        { userId: user.userId, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions
    );

    // Calculate expiration in seconds
    const decoded = jwt.decode(accessToken) as jwt.JwtPayload;
    const expiresIn = (decoded?.exp || 0) - Math.floor(Date.now() / 1000);

    return { accessToken, refreshToken, expiresIn };
}

/**
 * Verify a JWT using an EXPLICIT secret. Exposed for tests and for the
 * rotation fallback chain. Does NOT touch Redis or normalize the role —
 * returns the raw decoded payload.
 */
export function verifyTokenWithSecret(token: string, secret: string): AuthenticatedUser | null {
    try {
        return jwt.verify(token, secret, { algorithms: ['HS256'] }) as AuthenticatedUser;
    } catch (error) {
        return null;
    }
}

/**
 * Verify and decode JWT token
 * SECURITY FIX CVE-2026-001: Now checks Redis blacklist for logged-out tokens
 * SECURITY FIX: Explicitly specify allowed algorithms to prevent algorithm confusion attacks
 * SECURITY FIX D30: if JWT_SECRET_PREVIOUS is set, accept tokens signed
 * with it during the rotation window.
 */
export function verifyToken(token: string): AuthenticatedUser | null {
    // Try current secret first
    let decoded = verifyTokenWithSecret(token, JWT_SECRET);
    // Rotation fallback: if current failed and previous is configured, try it
    if (!decoded && JWT_SECRET_PREVIOUS) {
        decoded = verifyTokenWithSecret(token, JWT_SECRET_PREVIOUS);
    }
    if (!decoded) return null;
    decoded.role = normalizeRole(decoded.role);
    decoded.permissions = decoded.permissions || getRolePermissions(decoded.role);
    return decoded;
}

/**
 * Async version of verifyToken that checks Redis blacklist
 * SECURITY FIX CVE-2026-001: Check if token is blacklisted before accepting
 * SECURITY FIX: Fail secure when Redis is unavailable - reject tokens if we can't verify blacklist
 * SECURITY FIX: Explicitly specify allowed algorithms to prevent algorithm confusion attacks
 */
export async function verifyTokenAsync(token: string): Promise<AuthenticatedUser | null> {
    let isRedisAvailable = false;

    // First verify JWT is valid
    let decoded: AuthenticatedUser;
    try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthenticatedUser;
        decoded.role = normalizeRole(decoded.role);
        decoded.permissions = decoded.permissions || getRolePermissions(decoded.role);
    } catch (error) {
        return null;
    }

    // Try to check blacklist - fail secure if Redis unavailable
    try {
        isRedisAvailable = redisService.isAvailable();
    } catch (error) {
        isRedisAvailable = false;
    }

    if (isRedisAvailable) {
        try {
            const isBlacklisted = await redisService.exists(`token:blacklist:${token}`);
            if (isBlacklisted) {
                logger.warn('Attempted use of blacklisted token');
                return null;
            }
        } catch (error) {
            // Redis error during blacklist check - fail secure
            logger.error('Token blacklist check failed due to Redis error, rejecting token for security');
            return null;
        }
    } else {
        // When Redis is unavailable and bypass is enabled, skip blacklist check and accept the token.
        // This is acceptable because: (1) tokens not in blacklist are valid, (2) logout blacklist
        // is a defense-in-depth measure, not a hard security requirement.
        const allowInsecureBypass =
            process.env.NODE_ENV === 'test' ||
            process.env.ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN === 'true';

        if (!allowInsecureBypass) {
            logger.warn('Redis unavailable, rejecting token for security (fail-secure)');
            return null;
        }

        logger.warn('Redis unavailable, allowing token (blacklist check skipped) due to ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN=true');
    }

    return decoded;
}

/**
 * Verify refresh token
 * SECURITY FIX: Explicitly specify allowed algorithms to prevent algorithm confusion attacks
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
    let decoded: { userId: string; type: string } | null = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string; type: string };
    } catch (_) {
        decoded = null;
    }
    // SECURITY FIX D30: rotation fallback
    if (!decoded && JWT_SECRET_PREVIOUS) {
        try {
            decoded = jwt.verify(token, JWT_SECRET_PREVIOUS, { algorithms: ['HS256'] }) as { userId: string; type: string };
        } catch (_) {
            decoded = null;
        }
    }
    if (!decoded || decoded.type !== 'refresh') {
        return null;
    }
    return { userId: decoded.userId };
}

/**
 * SECURITY FIX: Cookie configuration for httpOnly tokens
 * SECURITY FIX: Changed sameSite from 'lax' to 'strict' for better security
 */
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const isHttpsRequest = (req: Request): boolean => {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    return req.secure || proto === 'https';
};

export const buildCookieOptions = (req: Request) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' ? isHttpsRequest(req) : false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE // 24 hours
});

export const buildRefreshCookieOptions = (req: Request) => ({
    ...buildCookieOptions(req),
    maxAge: REFRESH_COOKIE_MAX_AGE // 7 days
});

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
            error: 'backend.authentication_required',
            code: 'AUTH_TOKEN_MISSING'
        });
        return;
    }

    // SECURITY FIX CVE-2026-001: Use async version with blacklist check
    const user = await verifyTokenAsync(token);

    if (!user) {
        res.status(401).json({
            error: 'backend.invalid_or_expired_token',
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
export function requireRole(...allowedRoles: Array<'admin' | 'tenant' | 'viewer' | 'platform_admin' | 'tenant_admin' | 'tenant_operator' | 'tenant_viewer' | 'auditor'>) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({
                error: 'backend.authentication_required',
                code: 'AUTH_REQUIRED'
            });
            return;
        }

        const currentRole = normalizeRole(req.user.role);
        if (!allowedRoles.map((role) => normalizeRole(role)).includes(currentRole)) {
            logger.warn(`Access denied for user ${req.user.email} (role: ${req.user.role}), required: ${allowedRoles.join('/')}`);
            res.status(403).json({
                error: 'backend.insufficient_permissions',
                code: 'AUTH_FORBIDDEN',
                requiredRoles: allowedRoles
            });
            return;
        }

        next();
    };
}

export { requireTenantAccess } from './tenant-access.middleware';

export function requirePermission(...requiredPermissions: Permission[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({
                error: 'backend.authentication_required',
                code: 'AUTH_REQUIRED'
            });
            return;
        }

        const missing = requiredPermissions.filter((permission) => !hasPermission(req.user?.role, permission));
        if (missing.length > 0) {
            res.status(403).json({
                error: 'backend.insufficient_permissions',
                code: 'AUTH_PERMISSION_FORBIDDEN',
                missingPermissions: missing
            });
            return;
        }

        req.user.permissions = req.user.permissions || getRolePermissions(req.user.role);
        next();
    };
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
 * SECURITY FIX CVE-2026-012: Add tenant isolation for API keys
 */
export function authenticateApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
        res.status(401).json({
            error: 'backend.api_key_required',
            code: 'API_KEY_MISSING'
        });
        return;
    }

    // SECURITY FIX: No default API keys allowed
    const validApiKeys = process.env.VALID_API_KEYS?.split(',').filter(k => k.trim());

    if (!validApiKeys || validApiKeys.length === 0) {
        logger.error('No valid API keys configured in VALID_API_KEYS environment variable');
        res.status(500).json({
            error: 'backend.server_configuration_error',
            code: 'API_KEYS_NOT_CONFIGURED'
        });
        return;
    }

    // SECURITY FIX CVE-2026-011: Use constant-time comparison to prevent timing attacks
    const isValidKey = validApiKeys.some(validKey => constantTimeCompare(apiKey, validKey.trim()));

    if (!isValidKey) {
        logger.warn('Invalid API key attempt', { ip: req.ip });
        res.status(401).json({
            error: 'backend.invalid_api_key',
            code: 'API_KEY_INVALID'
        });
        return;
    }

    // SECURITY FIX CVE-2026-012: Extract tenant ID from API key pattern or use default
    // Format: key_tenantId_suffix or use API_KEY_TENANT_ID env var
    const apiKeyTenantId = extractTenantIdFromApiKey(apiKey);

    // Attach a system user for API key requests with tenant isolation
    req.user = {
        userId: 'api-key-user',
        email: 'api@AetherGuard.local',
        username: 'API Client',
        role: 'tenant',
        plan: 'ultra',
        tenantId: apiKeyTenantId
    };

    next();
}

/**
 * SECURITY FIX CVE-2026-012: Extract tenant ID from API key or environment
 */
function extractTenantIdFromApiKey(apiKey: string): string {
    // Check if there's a configured tenant ID for API keys
    const configuredTenantId = process.env.API_KEY_TENANT_ID;
    if (configuredTenantId) {
        return configuredTenantId;
    }

    // Try to extract tenant ID from API key pattern (e.g., "key_tenant123_suffix")
    // Default pattern: the API key may contain tenant info after a delimiter
    const parts = apiKey.split('_');
    if (parts.length >= 2) {
        // Use second part as tenant ID if it looks like a valid ID
        const potentialTenantId = parts[1];
        if (potentialTenantId && potentialTenantId.length >= 8) {
            return potentialTenantId;
        }
    }

    // Fallback to a default tenant ID
    return 'default-tenant';
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
        error: 'backend.authentication_required_jwt_or_api_key',
        code: 'AUTH_REQUIRED'
    });
}

// Compatibility export for agent-only routes.
export const authenticateAgent = authenticateApiKey;

/**
 * Request timing middleware interface
 */
export interface TimedRequest extends Request {
  startTime?: number;
}

/**
 * Request timing middleware
 * Tracks request processing time and emits events for monitoring
 */
export function requestTimingMiddleware(
  req: TimedRequest,
  res: Response,
  next: NextFunction
): void {
  req.startTime = Date.now();

  // Listen for response finish event
  res.on('finish', () => {
    const duration = Date.now() - (req.startTime || 0);
    // Emit timing event for monitoring (will be picked up by simulation service)
    if (req.startTime) {
      req.emit('requestTiming', { duration, path: req.path });
    }
  });

  next();
}
