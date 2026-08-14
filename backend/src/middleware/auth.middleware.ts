/**
 * JWT Authentication Middleware
 *
 * Provides secure authentication for AetherGuard API endpoints
 * SECURITY FIX: Enhanced environment variable validation
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
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
import authSecurityService from '../security/auth-security.service';
import { findAuthUserById } from '../modules/auth/auth-user.repository';
import { sendError } from '../core/http/api-response';
import { allowLabInMemoryAuthSessions } from '../config/enterprise-runtime';

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
    sessionId?: string;
}

/**
 * Extended Express Request with user info
 */
export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
    tenantContext?: TenantContext;
}

export type TokenVerificationFailureReason =
    | 'invalid_token'
    | 'blacklisted_token'
    | 'redis_unavailable'
    | 'blacklist_check_failed'
    | 'session_check_failed'
    | 'invalid_session'
    | 'identity_check_failed'
    | 'identity_changed'
    | 'user_inactive';

export interface TokenVerificationResult {
    user: AuthenticatedUser | null;
    failureReason?: TokenVerificationFailureReason;
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
        { userId: user.userId, sessionId: user.sessionId, type: 'refresh', jti: randomUUID() },
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
export async function verifyTokenAsyncDetailed(token: string): Promise<TokenVerificationResult> {
    let isRedisAvailable = false;

    // First verify JWT is valid
    let decoded = verifyTokenWithSecret(token, JWT_SECRET);
    if (!decoded && JWT_SECRET_PREVIOUS) {
        decoded = verifyTokenWithSecret(token, JWT_SECRET_PREVIOUS);
    }
    if (!decoded) {
        return { user: null, failureReason: 'invalid_token' };
    }
    decoded.role = normalizeRole(decoded.role);
    decoded.permissions = decoded.permissions || getRolePermissions(decoded.role);

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
                return { user: null, failureReason: 'blacklisted_token' };
            }
        } catch (error) {
            // Redis error during blacklist check - fail secure
            logger.error('Token blacklist check failed due to Redis error, rejecting token for security');
            return { user: null, failureReason: 'blacklist_check_failed' };
        }
    } else {
        // A process-local session store is allowed only in an explicitly
        // configured non-production lab. Login uses the same policy, so a 200
        // response can never issue a session rejected by the next request.
        if (!allowLabInMemoryAuthSessions()) {
            logger.warn('Redis unavailable, rejecting token for security (fail-secure)');
            return { user: null, failureReason: 'redis_unavailable' };
        }

        logger.warn('Redis unavailable; using explicitly configured lab in-memory authentication sessions');
    }

    if (!decoded.sessionId) {
        return { user: null, failureReason: 'invalid_session' };
    }

    let sessionValid: boolean;
    try {
        sessionValid = await authSecurityService.validateSessionStrict(decoded.userId, decoded.sessionId);
    } catch (error) {
        logger.error('Token session check failed due to session store error', { error });
        return { user: null, failureReason: 'session_check_failed' };
    }
    if (!sessionValid) {
        return { user: null, failureReason: 'invalid_session' };
    }

    try {
        const currentUser = await findAuthUserById(decoded.userId);
        if (!currentUser || currentUser.status !== 'active') {
            return { user: null, failureReason: 'user_inactive' };
        }

        const currentRole = normalizeRole(currentUser.role);
        const currentTenantId = currentUser.tenant_id || undefined;
        const tokenTenantId = decoded.tenantId || undefined;
        if (currentRole !== decoded.role || currentTenantId !== tokenTenantId) {
            return { user: null, failureReason: 'identity_changed' };
        }

        return {
            user: {
                userId: currentUser.id,
                email: currentUser.email,
                username: currentUser.username,
                role: currentRole,
                plan: currentUser.plan || undefined,
                tenantId: currentTenantId,
                permissions: getRolePermissions(currentRole),
                authProvider: decoded.authProvider,
                sessionId: decoded.sessionId,
            }
        };
    } catch (error) {
        logger.error('Token identity revalidation failed, rejecting token', { error });
        return { user: null, failureReason: 'identity_check_failed' };
    }
}

export async function verifyTokenAsync(token: string): Promise<AuthenticatedUser | null> {
    const result = await verifyTokenAsyncDetailed(token);
    return result.user;
}

/**
 * Verify refresh token
 * SECURITY FIX: Explicitly specify allowed algorithms to prevent algorithm confusion attacks
 */
export function verifyRefreshToken(token: string): { userId: string; sessionId?: string } | null {
    let decoded: { userId: string; sessionId?: string; type: string } | null = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string; sessionId?: string; type: string };
    } catch (_) {
        decoded = null;
    }
    // SECURITY FIX D30: rotation fallback
    if (!decoded && JWT_SECRET_PREVIOUS) {
        try {
            decoded = jwt.verify(token, JWT_SECRET_PREVIOUS, { algorithms: ['HS256'] }) as { userId: string; sessionId?: string; type: string };
        } catch (_) {
            decoded = null;
        }
    }
    if (!decoded || decoded.type !== 'refresh') {
        return null;
    }
    return { userId: decoded.userId, sessionId: decoded.sessionId };
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
    sameSite: 'strict' as const,
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
        sendError(res, 401, {
            code: 'AUTH_TOKEN_MISSING',
            message: 'backend.authentication_required'
        });
        return;
    }

    // SECURITY FIX CVE-2026-001: Use async version with blacklist check
    const verification = await verifyTokenAsyncDetailed(token);
    const user = verification.user;

    if (!user) {
        if (
            verification.failureReason === 'redis_unavailable' ||
            verification.failureReason === 'blacklist_check_failed' ||
            verification.failureReason === 'session_check_failed' ||
            verification.failureReason === 'identity_check_failed'
        ) {
            const sessionStoreUnavailable = verification.failureReason === 'session_check_failed';
            const identityStoreUnavailable = verification.failureReason === 'identity_check_failed';
            sendError(res, 503, {
                code: sessionStoreUnavailable
                    ? 'AUTH_SESSION_STORE_UNAVAILABLE'
                    : identityStoreUnavailable
                        ? 'AUTH_IDENTITY_STORE_UNAVAILABLE'
                        : 'AUTH_BLACKLIST_UNAVAILABLE',
                message: sessionStoreUnavailable
                    ? 'backend.auth_session_store_unavailable'
                    : identityStoreUnavailable
                        ? 'backend.auth_identity_store_unavailable'
                        : 'backend.auth_blacklist_check_unavailable',
                details: { retryable: true }
            }, {
                legacy: { retryable: true }
            });
            return;
        }

        sendError(res, 401, {
            code: 'AUTH_TOKEN_INVALID',
            message: 'backend.invalid_or_expired_token'
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
            sendError(res, 401, {
                code: 'AUTH_REQUIRED',
                message: 'backend.authentication_required'
            });
            return;
        }

        const currentRole = normalizeRole(req.user.role);
        if (!allowedRoles.map((role) => normalizeRole(role)).includes(currentRole)) {
            logger.warn(`Access denied for user ${req.user.email} (role: ${req.user.role}), required: ${allowedRoles.join('/')}`);
            sendError(res, 403, {
                code: 'AUTH_FORBIDDEN',
                message: 'backend.insufficient_permissions',
                details: { requiredRoles: allowedRoles }
            }, {
                legacy: { requiredRoles: allowedRoles }
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
            sendError(res, 401, {
                code: 'AUTH_REQUIRED',
                message: 'backend.authentication_required'
            });
            return;
        }

        const missing = requiredPermissions.filter((permission) => !hasPermission(req.user?.role, permission));
        if (missing.length > 0) {
            sendError(res, 403, {
                code: 'AUTH_PERMISSION_FORBIDDEN',
                message: 'backend.insufficient_permissions',
                details: { missingPermissions: missing }
            }, {
                legacy: { missingPermissions: missing }
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
        sendError(res, 401, {
            code: 'API_KEY_MISSING',
            message: 'backend.api_key_required'
        });
        return;
    }

    // SECURITY FIX: No default API keys allowed
    const validApiKeys = process.env.VALID_API_KEYS?.split(',').filter(k => k.trim());

    if (!validApiKeys || validApiKeys.length === 0) {
        logger.error('No valid API keys configured in VALID_API_KEYS environment variable');
        sendError(res, 500, {
            code: 'API_KEYS_NOT_CONFIGURED',
            message: 'backend.server_configuration_error'
        });
        return;
    }

    // SECURITY FIX CVE-2026-011: Use constant-time comparison to prevent timing attacks
    const isValidKey = validApiKeys.some(validKey => constantTimeCompare(apiKey, validKey.trim()));

    if (!isValidKey) {
        logger.warn('Invalid API key attempt', { ip: req.ip });
        sendError(res, 401, {
            code: 'API_KEY_INVALID',
            message: 'backend.invalid_api_key'
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
export async function authenticateAny(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authenticate(req, res, next);
    }

    if (apiKey) {
        return authenticateApiKey(req, res, next);
    }

    sendError(res, 401, {
        code: 'AUTH_REQUIRED',
        message: 'backend.authentication_required_jwt_or_api_key'
    });
}

// Compatibility export for agent-only routes.
// SECURITY FIX (audit 2026-08, AG-A06): DEPRECATED — this grants a synthetic
// `role=tenant, plan=ultra` identity to ANY holder of the static shared
// VALID_API_KEYS list, bypassing the per-agent registration/revocation
// system. Agent-only routes must use `authenticateRegisteredAgent` below.
// Kept only for external embeddings; do not wire new routes to it.
export const authenticateAgent = authenticateApiKey;

/**
 * SECURITY FIX (audit 2026-08, AG-A06): per-agent authentication for
 * agent-only HTTP routes. Verifies `X-Agent-Id` + `X-Api-Key` against the
 * server-side agent registry (agent-auth.service: approved status + API key
 * hash, revocation effective immediately) instead of the static shared
 * VALID_API_KEYS list. The attached identity is a least-privilege service
 * identity — role 'viewer' (normalizes to tenant_viewer; unknown roles
 * normalize to tenant_viewer anyway) with NO plan — so a compromised agent
 * key cannot wield tenant/ultra privileges.
 */
export async function authenticateRegisteredAgent(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const agentId = req.headers['x-agent-id'] as string | undefined;
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (!agentId || !apiKey) {
        sendError(res, 401, {
            code: 'AGENT_CREDENTIALS_MISSING',
            message: 'backend.agent_id_and_api_key_required'
        });
        return;
    }

    let agent: import('../security/agent-auth.service').AuthenticatedAgent | null = null;
    try {
        const { default: agentAuthService } = await import('../security/agent-auth.service');
        agent = await agentAuthService.verifyAgent(String(agentId), String(apiKey));
    } catch (error: any) {
        logger.error('Agent authentication backend unavailable', { error: error?.message });
    }

    if (!agent) {
        logger.warn('Rejected agent credentials for investigation API', {
            agentId: String(agentId).slice(0, 64),
            ip: req.ip
        });
        sendError(res, 401, {
            code: 'AGENT_CREDENTIALS_INVALID',
            message: 'backend.invalid_agent_credentials'
        });
        return;
    }

    req.user = {
        userId: agent.agentId,
        email: `${agent.agentId}@agent.AetherGuard.local`,
        username: agent.hostname || agent.agentId,
        role: 'viewer',
        tenantId: agent.tenantId,
        permissions: getRolePermissions('viewer')
    };
    (req as AuthenticatedRequest & { agent?: unknown }).agent = agent;

    next();
}

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
