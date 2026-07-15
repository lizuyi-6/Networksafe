/**
 * Authentication Routes
 * 
 * Handles user registration, login, and token management
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { uuidv4 } from '../../utils/uuid';
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
    recordLoginHistory,
    touchAuthUserLastLogin,
    updateAuthUserPassword
} from '../../modules/auth/auth-user.repository';
import { allowPasswordLogin } from '../../config/enterprise-runtime';
import { getRuntimeProfile } from '../../config/platform-runtime';
import { oidcAuthService } from '../../services/oidc-auth.service';
import { buildAllowedOrigins } from '../../bootstrap/allowed-origins';

const router = Router();
const isTestEnv = isTestRuntime();

const authRateLimitMiddleware = authRateLimitAdapter(authRateLimit);

// Password validation
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONCURRENT_SESSIONS = 5;
const OIDC_TEMP_COOKIE_MAX_AGE = 10 * 60 * 1000;

function publicRegistrationEnabled(): boolean {
    const configured = process.env.ALLOW_PUBLIC_REGISTRATION;
    if (configured !== undefined) {
        return configured === 'true';
    }
    return getRuntimeProfile() !== 'prod';
}

async function establishTrackedSession(req: AuthenticatedRequest, userId: string): Promise<{
    sessionId: string;
    concurrentWarning: string | null;
} | null> {
    if (process.env.NODE_ENV === 'production' && !redisService.isAvailable()) {
        return null;
    }

    const sessionId = authSecurityService.generateSessionId();
    const allowed = await authSecurityService.checkConcurrentSessions(userId, MAX_CONCURRENT_SESSIONS);
    await authSecurityService.addSession(userId, sessionId, {
        ip: clientIpFromRequest(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        loginAt: new Date().toISOString(),
    });

    let sessionVerified = false;
    try {
        sessionVerified = await authSecurityService.validateSessionStrict(userId, sessionId);
    } catch (error) {
        logger.warn('New session could not be verified because the session store is unavailable', { error, userId });
    }
    if (!sessionVerified) {
        const sessionRemoved = await authSecurityService.removeSession(userId, sessionId);
        if (!sessionRemoved) {
            logger.error('Unverified session could not be removed', { userId, sessionId });
        }
        return null;
    }

    return {
        sessionId,
        concurrentWarning: allowed
            ? null
            : `Multiple concurrent sessions detected (max ${MAX_CONCURRENT_SESSIONS}). New login added.`,
    };
}

/**
 * POST /api/auth/register
 * Register a new user
 * SECURITY FIX: Added rate limiting
 */
router.post('/register', authRateLimitMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!publicRegistrationEnabled()) {
            return sendError(res, 403, {
                code: 'REGISTRATION_DISABLED',
                message: 'backend.public_registration_disabled'
            });
        }

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

        const session = await establishTrackedSession(req, userId);
        if (!session) {
            return sendError(res, 503, {
                code: 'AUTH_SESSION_STORE_UNAVAILABLE',
                message: 'backend.auth_session_store_unavailable'
            });
        }

        try {
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
        } catch (error) {
            const sessionRemoved = await authSecurityService.removeSession(userId, session.sessionId);
            if (!sessionRemoved) {
                logger.error('Registration failed and provisional session could not be revoked', { userId });
            }
            throw error;
        }

        // Generate tokens
        const tokens = generateTokens({
            userId,
            email,
            username,
            role,
            plan,
            tenantId,
            sessionId: session.sessionId
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
                expiresIn: tokens.expiresIn
            }
        }, 201);

    } catch (error: any) {
        // SECURITY FIX R4-w3 / V12.25: catch unique-constraint violations
        // from parallel registrations of the same email and translate
        // them to a stable 409 instead of leaking as 500.
        const msg = String(error?.message || '');
        const isUniqueViolation =
            msg.includes('UNIQUE constraint failed') ||
            msg.includes('duplicate key value') ||
            msg.includes('UNIQUE') ||
            error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            error?.code === '23505';
        if (isUniqueViolation) {
            // email/password/username are in the outer try block — re-read
            // safely from req.body for the audit log
            const requestEmail = (req.body && typeof req.body.email === 'string') ? req.body.email : 'unknown';
            logger.info(`Registration race lost for: ${requestEmail}`);
            return sendError(res, 409, {
                code: 'EMAIL_ALREADY_EXISTS',
                message: 'backend.user_already_exists'
            });
        }
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
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const password = req.body?.password;
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

        if (!email || !password) {
            return sendError(res, 400, {
                code: 'VALIDATION_ERROR',
                message: 'backend.email_and_password_are_required'
            });
        }

        // AG-006: close the password-validity oracle. Local password login is a
        // GLOBAL policy (already public via GET /api/system/mode), so when it is
        // disabled we must reject BEFORE looking up the account or running
        // bcrypt. The previous ordering verified the password first and only
        // then returned LOCAL_LOGIN_DISABLED, letting anyone with a candidate
        // password distinguish correct (403) from incorrect (401) without ever
        // logging in. Rejecting uniformly here reveals nothing per-account and
        // removes the oracle. The later allowPasswordLogin() gate before session
        // creation is retained as defense-in-depth.
        if (!allowPasswordLogin()) {
            return sendError(res, 403, {
                code: 'LOCAL_LOGIN_DISABLED',
                message: 'backend.local_password_login_disabled'
            });
        }

        // SECURITY FIX CVE-2026-007: Check if account is locked
        const isLocked = await authSecurityService.isAccountLocked(email);
        if (isLocked) {
            const lockInfo = await authSecurityService.getLockInfo(email);
            logger.warn(`Login attempt on locked account: ${email}`);
            // Audit the locked-account attempt so SIEM can detect
            // credential-stuffing waves against the same target.
            await auditLogger.log({
                eventType: 'login_locked_account',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: email, email, ip: clientIp },
                action: 'login',
                details: { reason: 'account_locked', remainingTime: lockInfo.remainingTime },
                status: 'failure'
            });
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

        // Do not disclose account state until the caller has proved possession
        // of the password. Pending and suspended users cannot create sessions.
        if (user.status !== 'active') {
            await auditLogger.log({
                tenantId: user.tenant_id || undefined,
                eventType: 'inactive_login_attempt',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: user.id, email: user.email, ip: clientIp },
                action: 'login',
                target: { type: 'user', id: user.id },
                details: { status: user.status },
                status: 'failure'
            });

            return sendError(res, 403, {
                code: 'ACCOUNT_NOT_ACTIVE',
                message: 'backend.account_not_active'
            });
        }

        // AG-006 defense-in-depth: policy may flip between the early gate and
        // here (e.g. runtime reconfiguration mid-request). Re-check before
        // minting a session. This branch no longer creates a per-account oracle
        // because the early gate already rejected the disabled case uniformly.
        if (!allowPasswordLogin()) {
            return sendError(res, 403, {
                code: 'LOCAL_LOGIN_DISABLED',
                message: 'backend.local_password_login_disabled'
            });
        }

        const session = await establishTrackedSession(req, user.id);
        if (!session) {
            await auditLogger.log({
                tenantId: user.tenant_id || undefined,
                eventType: 'login_session_failed',
                category: 'auth',
                severity: 'critical',
                actor: { type: 'user', id: user.id, email: user.email, ip: clientIp },
                target: { type: 'user', id: user.id },
                action: 'login',
                details: { reason: 'session_store_unavailable' },
                status: 'failure'
            });
            return sendError(res, 503, {
                code: 'AUTH_SESSION_STORE_UNAVAILABLE',
                message: 'backend.auth_session_store_unavailable'
            });
        }

        // SECURITY FIX CVE-2026-007: Record successful login
        await authSecurityService.recordLoginAttempt(email, clientIp, true);

        // Update last login
        await touchAuthUserLastLogin(user.id);

        // Record login history
        try {
            const loginHistoryId = uuidv4();
            await recordLoginHistory({
                id: loginHistoryId,
                userId: user.id,
                ipAddress: clientIp,
                userAgent: req.headers['user-agent'] || 'unknown',
                status: 'success'
            });
        } catch (historyError: any) {
            logger.warn('Failed to record login history', { error: historyError.message });
        }

        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            plan: user.plan || 'starter',
            tenantId: user.tenant_id,
            authProvider: 'local',
            sessionId: session.sessionId
        });

        await auditLogger.log({
            tenantId: user.tenant_id || undefined,
            eventType: 'login',
            category: 'auth',
            severity: 'info',
            actor: { type: 'user', id: user.id, email: user.email, ip: clientIp },
            target: { type: 'user', id: user.id },
            action: 'login',
            details: { role: user.role, plan: user.plan || 'starter', sessionId: session.sessionId },
            status: 'success'
        });

        logger.info(`User logged in: ${email}`);

        if (session.concurrentWarning) {
            logger.warn(`Concurrent session limit exceeded for user ${email}`, {
                userId: user.id,
                sessionId: session.sessionId,
            });
        }

        // SECURITY FIX: Set tokens as httpOnly cookies instead of sending in body
        res.cookie('accessToken', tokens.accessToken, buildCookieOptions(req));
        res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(req));

        // SECURITY FIX CVE-2026-028: Reduce exposed user information
        return sendSuccess(res, {
            message: 'backend.login_successful',
            concurrentWarning: session.concurrentWarning,
            user: {
                userId: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                plan: user.plan || 'starter',
                tenantId: user.tenant_id || undefined
            },
            expiresIn: tokens.expiresIn
        }, {
            legacy: {
                message: 'backend.login_successful',
                concurrentWarning: session.concurrentWarning,
                user: {
                    userId: user.id,
                    email: user.email,
                    username: user.username,
                    role: user.role,
                    plan: user.plan || 'starter',
                    tenantId: user.tenant_id || undefined
                },
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

router.get('/oidc/login', authRateLimitMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        if (!oidcAuthService.isConfigured()) {
            return sendError(res, 503, {
                code: 'OIDC_NOT_CONFIGURED',
                message: 'backend.oidc_not_configured'
            });
        }

        const { state, nonce } = oidcAuthService.buildStateAndNonce();
        res.cookie('oidcState', state, buildOidcTemporaryCookieOptions(_req));
        return sendSuccess(res, {
            state,
            authorizationUrl: oidcAuthService.buildAuthorizationUrl(state, nonce)
        });
    } catch (error: any) {
        return sendError(res, 500, {
            code: 'OIDC_LOGIN_INIT_FAILED',
            message: error?.message || 'backend.oidc_login_init_failed'
        });
    }
});

router.get('/oidc/callback', authRateLimitMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!oidcAuthService.isConfigured()) {
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=not-configured'));
        }

        const state = String(req.query?.state || '').trim();
        const expectedState = String(req.cookies?.oidcState || '').trim();
        const code = String(req.query?.code || '').trim();
        if (!code || !state || !expectedState || !timingSafeStringEqual(state, expectedState)) {
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=state-mismatch'));
        }

        const token = await oidcAuthService.exchangeCode(code, state);
        const verification = await oidcAuthService.verifyIdToken(token.idToken || '', state);
        if (!verification.valid || !verification.claims) {
            logger.warn('OIDC id_token verification failed', { reason: verification.reason || 'claims_missing' });
            res.clearCookie('oidcState', buildOidcTemporaryCookieClearOptions(req));
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=failed'));
        }

        const profile = await (async () => {
            try {
                return await oidcAuthService.fetchUserProfile(token.accessToken);
            } finally {
                await oidcAuthService.revokeToken(token.accessToken);
            }
        })();
        if (!verification.claims.sub || profile.sub !== verification.claims.sub) {
            logger.warn('OIDC userinfo subject mismatch');
            res.clearCookie('oidcState', buildOidcTemporaryCookieClearOptions(req));
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=failed'));
        }

        const mfaEvidence = oidcAuthService.validateMfaEvidence(profile, verification.claims);
        if (!mfaEvidence.valid) {
            logger.warn('OIDC MFA evidence rejected', { reason: mfaEvidence.reason || 'unknown' });
            res.clearCookie('oidcState', buildOidcTemporaryCookieClearOptions(req));
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=mfa-required'));
        }

        const user = await oidcAuthService.resolveUser(profile, verification.claims);
        if (user.row.status !== 'active') {
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=account-inactive'));
        }
        const sessionUser = oidcAuthService.buildSessionUser(user.row);
        const session = await establishTrackedSession(req, sessionUser.userId);
        if (!session) {
            return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=session-unavailable'));
        }
        const tokens = generateTokens({
            ...sessionUser,
            authProvider: 'oidc',
            sessionId: session.sessionId
        } as any);

        res.cookie('accessToken', tokens.accessToken, buildCookieOptions(req));
        res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(req));
        res.clearCookie('oidcState', buildOidcTemporaryCookieClearOptions(req));

        return res.redirect(buildOidcRedirectTarget(req, '/dashboard?auth=oidc'));
    } catch (error: any) {
        logger.warn('OIDC callback failed', { error: error?.message });
        return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=failed'));
    }
});

router.post('/oidc/logout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const sessionId = req.user?.sessionId;
        const sessionRevoked = Boolean(
            userId
            && sessionId
            && await authSecurityService.removeSession(userId, sessionId)
        );

        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });
        res.clearCookie('oidcState', buildOidcTemporaryCookieClearOptions(req));

        if (!sessionRevoked) {
            return sendError(res, 503, {
                code: 'LOGOUT_REVOCATION_FAILED',
                message: 'backend.logout_revocation_failed',
                details: { retryable: true }
            });
        }

        await auditLogger.log({
            tenantId: req.user?.tenantId,
            eventType: 'oidc_logout',
            category: 'auth',
            severity: 'info',
            actor: { type: 'user', id: userId!, email: req.user?.email, ip: clientIpFromRequest(req) },
            target: { type: 'user', id: userId! },
            action: 'logout',
            details: { sessionId },
            status: 'success'
        });

        const endSessionUrl = oidcAuthService.buildEndSessionUrl();
        return sendSuccess(res, {
            message: 'backend.logout_successful',
            endSessionUrl
        }, {
            legacy: {
                message: 'backend.logout_successful',
                endSessionUrl
            }
        });
    } catch (error: any) {
        logger.error('OIDC logout error', { error: error?.message });
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });
        res.clearCookie('oidcState', buildOidcTemporaryCookieClearOptions(req));
        return sendError(res, 503, {
            code: 'LOGOUT_REVOCATION_FAILED',
            message: 'backend.logout_revocation_failed',
            details: { retryable: true }
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
        // SECURITY FIX CVE-2026-009: refresh credentials never cross the JavaScript-readable body boundary.
        const refreshToken = req.cookies?.refreshToken;

        if (!refreshToken) {
            return sendError(res, 400, {
                code: 'TOKEN_MISSING',
                message: 'backend.refresh_token_required'
            });
        }

        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return sendError(res, 401, {
                code: 'TOKEN_INVALID',
                message: 'backend.invalid_or_expired_refresh_token'
            });
        }

        if (!decoded.sessionId) {
            return sendError(res, 401, {
                code: 'SESSION_INVALID',
                message: 'backend.session_invalid'
            });
        }

        let sessionValid: boolean;
        try {
            sessionValid = await authSecurityService.validateSessionStrict(decoded.userId, decoded.sessionId);
        } catch (error) {
            logger.warn('Refresh session validation unavailable; refusing refresh', { error });
            return sendError(res, 503, {
                code: 'AUTH_SESSION_STORE_UNAVAILABLE',
                message: 'backend.auth_session_store_unavailable',
                details: { retryable: true }
            }, {
                legacy: { retryable: true }
            });
        }
        if (!sessionValid) {
            return sendError(res, 401, {
                code: 'SESSION_INVALID',
                message: 'backend.session_invalid'
            });
        }

        // Get user info
        const user = await findAuthUserById(decoded.userId) as any;

        if (!user || user.status !== 'active') {
            return sendError(res, 401, {
                code: 'USER_INVALID',
                message: 'backend.user_not_found_or_suspended'
            });
        }

        const refreshPayload = jwt.decode(refreshToken) as jwt.JwtPayload | null;
        const refreshTtl = refreshPayload?.exp
            ? Math.max(0, refreshPayload.exp - Math.floor(Date.now() / 1000))
            : 0;
        if (refreshTtl <= 0) {
            return sendError(res, 401, {
                code: 'TOKEN_INVALID',
                message: 'backend.invalid_or_expired_refresh_token'
            });
        }

        try {
            if (await redisService.existsStrict(`refresh:blacklist:${refreshToken}`)) {
                logger.warn('Attempted use of blacklisted refresh token');
                return sendError(res, 401, {
                    code: 'TOKEN_REVOKED',
                    message: 'backend.token_revoked'
                });
            }

            const consumed = await redisService.setIfAbsentStrict(
                `refresh:used:${refreshToken}`,
                '1',
                refreshTtl
            );
            if (!consumed) {
                logger.warn('Refresh token replay detected');
                const sessionRevoked = await authSecurityService.removeSession(decoded.userId, decoded.sessionId);
                if (!sessionRevoked) {
                    return sendError(res, 503, {
                        code: 'REFRESH_SESSION_REVOCATION_FAILED',
                        message: 'backend.refresh_session_revocation_failed'
                    });
                }
                await redisService.setStrict(`refresh:blacklist:${refreshToken}`, '1', refreshTtl);
                return sendError(res, 401, {
                    code: 'TOKEN_INVALIDATED',
                    message: 'backend.refresh_token_replay_detected'
                });
            }
        } catch (redisError: any) {
            logger.warn('Refresh token replay gate unavailable; refusing refresh', {
                error: redisError?.message
            });
            return sendError(res, 503, {
                code: 'REFRESH_REPLAY_CHECK_UNAVAILABLE',
                message: 'backend.refresh_replay_check_unavailable'
            });
        }

        // Generate new tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            plan: user.plan || 'starter',
            tenantId: user.tenant_id,
            sessionId: decoded.sessionId
        });

        // SECURITY FIX: Set new tokens as httpOnly cookies
        res.cookie('accessToken', tokens.accessToken, buildCookieOptions(req));
        res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(req));

        return sendSuccess(res, {
            message: 'backend.token_refreshed',
            expiresIn: tokens.expiresIn
        }, {
            legacy: {
                message: 'backend.token_refreshed',
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
        let tokenHasSessionId = false;
        let tokenSessionId: string | undefined;
        if (token) {
            // Add access token to blacklist in Redis
            const decoded = jwt.decode(token) as jwt.JwtPayload;
            const ttl = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 86400;
            if (ttl > 0) {
                await redisService.set(`token:blacklist:${token}`, '1', ttl);
            }
            // Detect legacy token (no sessionId claim) — defense in depth
            tokenSessionId = typeof decoded?.sessionId === 'string' ? decoded.sessionId : undefined;
            tokenHasSessionId = Boolean(tokenSessionId);
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

        const userId = req.user?.userId;
        if (!userId) {
            throw new Error('Authenticated logout request is missing userId');
        }

        let sessionRevoked: boolean;
        if (tokenHasSessionId) {
            if (!req.user?.sessionId || req.user.sessionId !== tokenSessionId) {
                throw new Error('Authenticated logout session does not match token session');
            }
            sessionRevoked = await authSecurityService.removeSession(userId, req.user.sessionId);
        } else {
            // Defense in depth for callers that inject a legacy authenticated
            // principal. Normal authentication rejects sessionless tokens.
            sessionRevoked = await authSecurityService.invalidateSession(userId);
        }

        if (!sessionRevoked) {
            res.clearCookie('accessToken', { path: '/' });
            res.clearCookie('refreshToken', { path: '/' });
            return sendError(res, 503, {
                code: 'LOGOUT_REVOCATION_FAILED',
                message: 'backend.logout_revocation_failed',
                details: { retryable: true }
            });
        }

        // SECURITY FIX: Clear httpOnly cookies
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });

        logger.info(`User logged out: ${req.user?.email}`);

        if (!tokenHasSessionId) {
            // Audit as WARNING: a legacy token (no sessionId) reached the
            // logout endpoint, which is suspicious and forces a full
            // session revocation.
            await auditLogger.log({
                tenantId: req.user?.tenantId,
                eventType: 'logout_legacy_token',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: clientIpFromRequest(req) },
                target: { type: 'user', id: req.user?.userId || 'unknown' },
                action: 'logout_legacy_token',
                details: { reason: 'sessionId missing — all sessions revoked' },
                status: 'success'
            });
        } else {
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
        }

        const endSessionUrl = req.user?.authProvider === 'oidc'
            ? oidcAuthService.buildEndSessionUrl()
            : null;
        return sendSuccess(res, {
            message: 'backend.logout_successful',
            endSessionUrl
        }, {
            legacy: {
                message: 'backend.logout_successful',
                endSessionUrl
            }
        });
    } catch (error: any) {
        logger.error('Logout error', { error: error.message });
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });
        return sendError(res, 503, {
            code: 'LOGOUT_REVOCATION_FAILED',
            message: 'backend.logout_revocation_failed',
            details: { retryable: true }
        });
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

        // Revoke before and after the password write. The first pass removes
        // existing sessions; the second closes the concurrent-login window.
        if (!(await authSecurityService.invalidateSession(req.user!.userId))) {
            return sendError(res, 503, {
                code: 'PASSWORD_SESSION_REVOCATION_FAILED',
                message: 'backend.password_session_revocation_failed',
                details: { retryable: true }
            });
        }

        // Update password
        await updateAuthUserPassword(req.user!.userId, newPasswordHash);

        if (!(await authSecurityService.invalidateSession(req.user!.userId))) {
            return sendError(res, 503, {
                code: 'PASSWORD_SESSION_REVOCATION_FAILED',
                message: 'backend.password_session_revocation_failed',
                details: { retryable: true }
            });
        }

        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });

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

function timingSafeStringEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildOidcTemporaryCookieOptions(req: AuthenticatedRequest) {
    return {
        ...buildCookieOptions(req),
        httpOnly: true,
        sameSite: 'lax' as const,
        maxAge: OIDC_TEMP_COOKIE_MAX_AGE
    };
}

function buildOidcTemporaryCookieClearOptions(req: AuthenticatedRequest) {
    const { maxAge: _maxAge, ...options } = buildOidcTemporaryCookieOptions(req);
    return options;
}

function buildOidcRedirectTarget(_req: AuthenticatedRequest, path: string): string {
    const configuredOrigin = String(
        process.env.OIDC_POST_LOGIN_REDIRECT_ORIGIN
        || process.env.FRONTEND_APP_URL
        || process.env.APP_URL
        || process.env.PUBLIC_URL
        || String(process.env.ALLOWED_ORIGINS || '').split(',')[0]
        || ''
    ).trim();

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!configuredOrigin) {
        return normalizedPath;
    }

    const normalizedOrigin = normalizeHttpOrigin(configuredOrigin);
    const allowedOrigins = buildAllowedOrigins()
        .map(normalizeHttpOrigin)
        .filter((origin): origin is string => Boolean(origin));
    if (!normalizedOrigin || !allowedOrigins.includes(normalizedOrigin)) {
        logger.warn('OIDC redirect origin is invalid or not allowlisted; using same-origin relative redirect');
        return normalizedPath;
    }

    return `${normalizedOrigin}${normalizedPath}`;
}

function normalizeHttpOrigin(value: string): string | null {
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }
        if (
            parsed.username
            || parsed.password
            || parsed.search
            || parsed.hash
            || (parsed.pathname && parsed.pathname !== '/')
        ) {
            return null;
        }
        return parsed.origin;
    } catch {
        return null;
    }
}
