/**
 * JWT Authentication Middleware
 * 
 * Provides secure authentication for FluxGuard API endpoints
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger';

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fluxguard-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

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
 * Authentication middleware - requires valid JWT token
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_TOKEN_MISSING'
        });
        return;
    }

    const token = authHeader.split(' ')[1];
    const user = verifyToken(token);

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
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const user = verifyToken(token);
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

    if (requestedTenantId && requestedTenantId !== req.user.tenantId) {
        res.status(403).json({
            error: 'Cannot access resources from another tenant',
            code: 'TENANT_MISMATCH'
        });
        return;
    }

    next();
}

/**
 * API Key authentication for agent/device communication
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

    // In production, validate against database
    // For now, use environment variable
    const validApiKeys = (process.env.VALID_API_KEYS || 'demo-api-key').split(',');

    if (!validApiKeys.includes(apiKey)) {
        logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 8)}...`);
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
export function authenticateAny(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
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
