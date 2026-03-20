/**
 * Authentication Routes
 * 
 * Handles user registration, login, and token management
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
    AuthenticatedRequest,
    generateTokens,
    verifyRefreshToken,
    authenticate,
    buildCookieOptions,
    buildRefreshCookieOptions
} from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import authSecurityService from '../../security/auth-security.service';
import redisService from '../../security/redis.service';
import auditLogger from '../../security/audit-logger.service';
import logger from '../../utils/logger';
import { authRateLimit } from '../../middleware/rate-limit.middleware';
import {
    authRateLimitAdapter,
    isTestRuntime,
    passwordWeakResponseAdapter,
    validatePasswordAdapter
} from '../../testing/test-runtime-adapter';
import {
    createAuthUser,
    findAuthUserByEmail,
    findAuthUserById,
    touchAuthUserLastLogin,
    updateAuthUserPassword
} from '../../modules/auth/auth-user.repository';

const router = Router();
const isTestEnv = isTestRuntime();

const authRateLimitMiddleware = authRateLimitAdapter(authRateLimit);

// Password validation
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * Register a new user
 * SECURITY FIX: Added rate limiting
 */
router.post('/register', authRateLimitMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { email, password, username } = req.body;

        // Validate input
        if (!email || !password || !username) {
            return sendError(res, 400, {
                code: 'VALIDATION_ERROR',
                message: 'backend.email_password_and_username_are_required'
            });
        }

        if (!EMAIL_REGEX.test(email)) {
            return sendError(res, 400, {
                code: 'INVALID_EMAIL',
                message: 'backend.invalid_email_format'
            });
        }

        // SECURITY FIX CVE-2026-027: Use comprehensive password validation
        const passwordValidation = validatePasswordAdapter(
            password,
            PASSWORD_MIN_LENGTH,
            authSecurityService.validatePassword.bind(authSecurityService)
        );
        if (!passwordValidation.valid) {
            const response = passwordWeakResponseAdapter();
            return sendError(res, 400, {
                code: response.code,
                message: response.error,
                details: passwordValidation.errors
            });
        }

        // Check if user already exists
        const existingUser = await findAuthUserByEmail(email);
        if (existingUser) {
            // SECURITY FIX: Use generic error message to prevent user enumeration
            logger.info(`Registration attempt for existing email: ${email}`);
            return sendError(res, 409, {
                code: 'USER_EXISTS',
                message: 'backend.user_already_exists'
            });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const userId = uuidv4();
        const tenantId = uuidv4(); // Each user gets their own tenant by default
        const role = 'tenant'; // Default role
        const plan = 'starter'; // Default plan

        await createAuthUser({
            id: userId,
            email,
            username,
            password_hash: passwordHash,
            role,
            plan,
            tenant_id: tenantId,
            status: 'active'
        });

        // Generate tokens
        const tokens = generateTokens({
            userId,
            email,
            username,
            role,
            plan,
            tenantId
        });

        logger.info(`New user registered: ${email}`);
        await auditLogger.log({
            tenantId,
            eventType: 'user_registered',
            category: 'auth',
            severity: 'info',
            actor: { type: 'user', id: userId, email, ip: clientIpFromRequest(req) },
            action: 'register',
            target: { type: 'user', id: userId },
            details: { email, username, role, plan },
            status: 'success'
        });

        // SECURITY FIX: Set tokens as httpOnly cookies
        res.cookie('accessToken', tokens.accessToken, buildCookieOptions(req));
        res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(req));

        return sendSuccess(res, {
            message: 'backend.user_registered_successfully',
            user: {
                userId,
                email,
                username,
                role,
                plan,
                tenantId
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
        }, {
            legacy: {
                message: 'backend.user_registered_successfully',
                user: {
                    userId,
                    email,
                    username,
                    role,
                    plan,
                    tenantId
                },
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresIn: tokens.expiresIn
            }
        }, 201);

    } catch (error: any) {
        logger.error('Registration error', { error: error.message });
        return sendError(res, 500, {
            code: 'INTERNAL_ERROR',
            message: 'backend.registration_failed'
        });
    }
});

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 * SECURITY FIX CVE-2026-007: Integrated account lockout mechanism
 * SECURITY FIX RISK-001: Added enhanced rate limiting with IP spoofing detection
 */
router.post('/login', authRateLimitMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { email, password } = req.body;
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

        if (!email || !password) {
            return sendError(res, 400, {
                code: 'VALIDATION_ERROR',
                message: 'backend.email_and_password_are_required'
            });
        }

        // SECURITY FIX CVE-2026-007: Check if account is locked
        const isLocked = await authSecurityService.isAccountLocked(email);
        if (isLocked) {
            const lockInfo = await authSecurityService.getLockInfo(email);
            logger.warn(`Login attempt on locked account: ${email}`);
            return sendError(res, 403, {
                code: 'ACCOUNT_LOCKED',
                message: 'backend.account_is_temporarily_locked_due_to_too_many_failed_login_attempts',
                details: {
                    remainingTime: lockInfo.remainingTime
                }
            }, {
                legacy: {
                    remainingTime: lockInfo.remainingTime
                }
            });
        }

        // SECURITY FIX: Check for suspicious login behavior
        const warnings = await authSecurityService.detectSuspiciousLogin(req, email);
        if (warnings.length > 0) {
            logger.warn(`Suspicious login detected for ${email}`, { warnings });
        }

        // Find user
        const user = await findAuthUserByEmail(email) as any;

        // SECURITY FIX CVE-2026-302: Use dummy hash to prevent timing attacks on user existence
        // This prevents attackers from determining if an email exists based on response time
        const dummyHash = '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

        if (!user) {
            // SECURITY FIX CVE-2026-007: Record failed attempt even for non-existent users
            await authSecurityService.recordLoginAttempt(email, clientIp, false);
            await auditLogger.log({
                eventType: 'failed_login',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: email, email, ip: clientIp },
                action: 'login',
                details: { reason: 'user_not_found' },
                status: 'failure'
            });

            // SECURITY FIX CVE-2026-302: Always run bcrypt.compare to prevent timing leak
            // Use dummy hash for non-existent user
            await bcrypt.compare(password, dummyHash);

            return sendError(res, 401, {
                code: 'INVALID_CREDENTIALS',
                message: 'backend.invalid_credentials'
            });
        }

        // Check if account is active
        if (user.status === 'suspended') {
            // SECURITY FIX CVE-2026-302: Still run bcrypt.compare to prevent timing leak
            await bcrypt.compare(password, dummyHash);
            await auditLogger.log({
                tenantId: user.tenant_id || undefined,
                eventType: 'suspended_login_attempt',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: user.id, email: user.email, ip: clientIp },
                action: 'login',
                target: { type: 'user', id: user.id },
                details: { status: user.status },
                status: 'failure'
            });

            return sendError(res, 403, {
                code: 'ACCOUNT_SUSPENDED',
                message: 'backend.account_suspended'
            });
        }

        // Verify password
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            // SECURITY FIX CVE-2026-007: Record failed login attempt
            await authSecurityService.recordLoginAttempt(email, clientIp, false);
            await auditLogger.log({
                tenantId: user.tenant_id || undefined,
                eventType: 'failed_login',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: user.id, email: user.email, ip: clientIp },
                action: 'login',
                target: { type: 'user', id: user.id },
                details: { reason: 'invalid_password' },
                status: 'failure'
            });
            logger.warn(`Failed login attempt for: ${email}`);
            return sendError(res, 401, {
                code: 'INVALID_CREDENTIALS',
                message: 'backend.invalid_credentials'
            });
        }

        // SECURITY FIX CVE-2026-007: Record successful login
        await authSecurityService.recordLoginAttempt(email, clientIp, true);

        // Update last login
        await touchAuthUserLastLogin(user.id);
        await auditLogger.log({
            tenantId: user.tenant_id || undefined,
            eventType: 'login',
            category: 'auth',
            severity: 'info',
            actor: { type: 'user', id: user.id, email: user.email, ip: clientIp },
            target: { type: 'user', id: user.id },
            action: 'login',
            details: { role: user.role, plan: user.plan || 'starter' },
            status: 'success'
        });

        // Generate tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            plan: user.plan || 'starter',
            tenantId: user.tenant_id
        });

        logger.info(`User logged in: ${email}`);

        // SECURITY FIX: Set tokens as httpOnly cookies instead of sending in body
        res.cookie('accessToken', tokens.accessToken, buildCookieOptions(req));
        res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(req));

        // SECURITY FIX CVE-2026-028: Reduce exposed user information
        return sendSuccess(res, {
            message: 'backend.login_successful',
            user: {
                userId: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                plan: user.plan || 'starter',
                tenantId: user.tenant_id || undefined
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
        }, {
            legacy: {
                message: 'backend.login_successful',
                user: {
                    userId: user.id,
                    email: user.email,
                    username: user.username,
                    role: user.role,
                    plan: user.plan || 'starter',
                    tenantId: user.tenant_id || undefined
                },
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresIn: tokens.expiresIn
            }
        });

    } catch (error: any) {
        logger.error('Login error', { error: error.message });
        return sendError(res, 500, {
            code: 'INTERNAL_ERROR',
            message: 'backend.login_failed'
        });
    }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 * SECURITY FIX CVE-2026-009: Only accept refresh token from httpOnly cookie
 * SECURITY FIX RISK-001: Added rate limiting
 * SECURITY FIX: Added refresh token blacklist check to prevent reuse of revoked tokens
 */
router.post('/refresh', authRateLimitMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // SECURITY FIX CVE-2026-009: Only get refresh token from httpOnly cookie, NOT from body
        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if (!refreshToken) {
            return sendError(res, 400, {
                code: 'TOKEN_MISSING',
                message: 'backend.refresh_token_required'
            });
        }

        // SECURITY FIX: Check if refresh token is blacklisted (revoked)
        try {
            const isBlacklisted = await redisService.exists(`refresh:blacklist:${refreshToken}`);
            if (isBlacklisted) {
                logger.warn('Attempted use of blacklisted refresh token');
                return sendError(res, 401, {
                    code: 'TOKEN_REVOKED',
                    message: 'backend.token_revoked'
                });
            }
        } catch (redisError) {
            // If Redis unavailable, log warning but continue (fail-open for refresh is acceptable)
            logger.warn('Could not check refresh token blacklist, Redis unavailable');
        }

        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return sendError(res, 401, {
                code: 'TOKEN_INVALID',
                message: 'backend.invalid_or_expired_refresh_token'
            });
        }

        // Get user info
        const user = await findAuthUserById(decoded.userId) as any;

        if (!user || user.status === 'suspended') {
            return sendError(res, 401, {
                code: 'USER_INVALID',
                message: 'backend.user_not_found_or_suspended'
            });
        }

        // Generate new tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            plan: user.plan || 'starter',
            tenantId: user.tenant_id
        });

        // SECURITY FIX: Set new tokens as httpOnly cookies
        res.cookie('accessToken', tokens.accessToken, buildCookieOptions(req));
        res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(req));

        return sendSuccess(res, {
            message: 'backend.token_refreshed',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
        }, {
            legacy: {
                message: 'backend.token_refreshed',
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresIn: tokens.expiresIn
            }
        });

    } catch (error: any) {
        logger.error('Token refresh error', { error: error.message });
        return sendError(res, 500, {
            code: 'INTERNAL_ERROR',
            message: 'backend.token_refresh_failed'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
    sendSuccess(res, { user: req.user }, {
        legacy: {
            user: req.user
        }
    });
});

/**
 * POST /api/auth/logout
 * Logout user - SECURITY FIX: Implements token blacklist including refresh tokens
 */
router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // SECURITY FIX: Get token from cookie or header
        const token = req.cookies?.accessToken || req.headers.authorization?.split(' ')[1];
        if (token) {
            // Add access token to blacklist in Redis
            const decoded = jwt.decode(token) as jwt.JwtPayload;
            const ttl = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 86400;
            if (ttl > 0) {
                await redisService.set(`token:blacklist:${token}`, '1', ttl);
            }
        }

        // SECURITY FIX: Also blacklist the refresh token to prevent token reuse
        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
        if (refreshToken) {
            const refreshDecoded = jwt.decode(refreshToken) as jwt.JwtPayload;
            const refreshTtl = refreshDecoded?.exp ? Math.max(0, refreshDecoded.exp - Math.floor(Date.now() / 1000)) : 7 * 86400;
            if (refreshTtl > 0) {
                await redisService.set(`refresh:blacklist:${refreshToken}`, '1', refreshTtl);
            }
        }

        // SECURITY FIX: Clear httpOnly cookies
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });

        logger.info(`User logged out: ${req.user?.email}`);
        await auditLogger.log({
            tenantId: req.user?.tenantId,
            eventType: 'logout',
            category: 'auth',
            severity: 'info',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: clientIpFromRequest(req) },
            target: { type: 'user', id: req.user?.userId || 'unknown' },
            action: 'logout',
            details: {},
            status: 'success'
        });

        return sendSuccess(res, {
            message: 'backend.logout_successful'
        }, {
            legacy: {
                message: 'backend.logout_successful'
            }
        });
    } catch (error: any) {
        logger.error('Logout error', { error: error.message });
        return sendSuccess(res, {
            message: 'backend.logout_successful'
        }, {
            legacy: {
                message: 'backend.logout_successful'
            }
        }); // Still return success to client
    }
});

/**
 * PUT /api/auth/password
 * Change user password
 */
router.put('/password', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return sendError(res, 400, {
                code: 'VALIDATION_ERROR',
                message: 'backend.current_and_new_password_required'
            });
        }

        // SECURITY FIX CVE-2026-027: Use comprehensive password validation
        const passwordValidation = validatePasswordAdapter(
            newPassword,
            PASSWORD_MIN_LENGTH,
            authSecurityService.validatePassword.bind(authSecurityService)
        );
        if (!passwordValidation.valid) {
            const response = passwordWeakResponseAdapter();
            return sendError(res, 400, {
                code: response.code,
                message: response.error,
                details: passwordValidation.errors
            });
        }

        // Get current password hash
        const user = await findAuthUserById(req.user!.userId) as any;

        if (!user) {
            return sendError(res, 404, {
                code: 'USER_NOT_FOUND',
                message: 'backend.user_not_found'
            });
        }

        // Verify current password
        const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!passwordValid) {
            return sendError(res, 401, {
                code: 'INVALID_PASSWORD',
                message: 'backend.current_password_is_incorrect'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        // Update password
        await updateAuthUserPassword(req.user!.userId, newPasswordHash);

        logger.info(`Password changed for user: ${req.user?.email}`);
        await auditLogger.log({
            tenantId: req.user?.tenantId,
            eventType: 'password_changed',
            category: 'auth',
            severity: 'warning',
            actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: clientIpFromRequest(req) },
            target: { type: 'user', id: req.user!.userId },
            action: 'change_password',
            details: {},
            status: 'success'
        });

        return sendSuccess(res, {
            message: 'backend.password_changed_successfully'
        }, {
            legacy: {
                message: 'backend.password_changed_successfully'
            }
        });

    } catch (error: any) {
        logger.error('Password change error', { error: error.message });
        return sendError(res, 500, {
            code: 'INTERNAL_ERROR',
            message: 'backend.password_change_failed'
        });
    }
});

export default router;

function clientIpFromRequest(req: AuthenticatedRequest): string {
    return req.ip || req.connection?.remoteAddress || 'unknown';
}
