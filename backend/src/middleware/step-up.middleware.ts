/**
 * Step-up re-authentication middleware (WebAuthn/Passkey).
 *
 * ADR 2026-08-29-stepup-webauthn-risk-elevation: high-risk control-plane
 * operations additionally require a fresh Passkey assertion, so a stolen /
 * transplanted session cookie cannot drive dangerous actions even with a
 * perfectly valid JWT. Dangerous DEVICE actions keep their existing Hardware
 * Gate as the final layer — this middleware only hardens the control plane
 * entry.
 *
 * MUST be placed after `authenticate` in the route chain (it reads
 * req.user/sessionId). Enforcement is opt-in via STEPUP_ENFORCEMENT=on.
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import auditLogger from '../security/audit-logger.service';
import stepUpService, { isDeviceElevated } from '../security/step-up.service';
import { webauthnService } from '../services/webauthn.service';
import { isStepUpEnforced, getStepUpTokenTtlSeconds } from '../config/stepup';
import { sendError } from '../core/http/api-response';
import { AuthenticatedRequest, isHttpsRequest } from './auth.middleware';

export const STEPUP_COOKIE_NAME = 'stepUpToken';

export const buildStepUpCookieOptions = (req: Request) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' ? isHttpsRequest(req) : false,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: getStepUpTokenTtlSeconds() * 1000
});

export const clearStepUpCookieOptions = (req: Request) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' ? isHttpsRequest(req) : false,
    sameSite: 'strict' as const,
    path: '/'
});

function clientIpOf(req: AuthenticatedRequest): string {
    return req.ip || (req as any).connection?.remoteAddress || 'unknown';
}

/**
 * 503 when the strict store is unavailable — fail closed, consistent with the
 * auth token blacklist semantics.
 */
function storeUnavailable(res: Response): void {
    sendError(res, 503, {
        code: 'AUTH_STEPUP_STORE_UNAVAILABLE',
        message: 'backend.auth_stepup_store_unavailable',
        details: { retryable: true }
    }, {
        legacy: { retryable: true }
    });
}

export async function requireStepUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    await requireStepUpScope(undefined)(req, res, next);
}

/**
 * AUD-07-3: scoped step-up — the fresh assertion must have been performed
 * FOR this action/target. Routes that bind a token to an operation at
 * ceremony time should use this factory so a token issued for one
 * high-risk operation cannot be replayed against another.
 */
export function requireStepUpScope(expectedScope?: { action?: string; target?: string }) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        await stepUpGate(req, res, next, expectedScope);
    };
}

async function stepUpGate(
    req: Request,
    res: Response,
    next: NextFunction,
    expectedScope?: { action?: string; target?: string }
): Promise<void> {
    if (!isStepUpEnforced()) {
        next();
        return;
    }

    const user = (req as AuthenticatedRequest).user;
    if (!user || !user.sessionId) {
        sendError(res, 401, {
            code: 'AUTH_TOKEN_INVALID',
            message: 'backend.invalid_or_expired_token'
        });
        return;
    }

    const requestDevice = {
        ip: clientIpOf(req),
        userAgent: String(req.headers['user-agent'] || '')
    };

    const token = req.cookies?.[STEPUP_COOKIE_NAME];

    try {
        // A token issued after a successful assertion is bound to the device
        // that performed that assertion. Check it first so a risk-elevated
        // device is not trapped in a revoke-on-every-request loop.
        if (token && await stepUpService.validateToken(String(token), user.userId, user.sessionId, requestDevice, expectedScope)) {
            next();
            return;
        }

        // Any request whose current device differs from the login device is a
        // risk elevation, including a stale token copied from the original
        // browser. Revoke before returning STEPUP_REQUIRED.
        const sessionDevice = await stepUpService.getSessionDevice(user.sessionId);
        if (sessionDevice && isDeviceElevated(sessionDevice, req)) {
            await stepUpService.revokeSessionToken(user.sessionId);
            logger.warn('Step-up risk elevation: request device differs from login device', {
                userId: user.userId,
                sessionId: user.sessionId.slice(0, 8)
            });
            await auditLogger.log({
                tenantId: user.tenantId,
                eventType: 'session_risk_elevated',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'user', id: user.userId, email: user.email, ip: clientIpOf(req) },
                action: 'stepup_risk_elevated',
                target: { type: 'user', id: user.userId },
                details: { sessionId: user.sessionId.slice(0, 8) },
                status: 'success'
            });
        }
    } catch (error) {
        logger.error('Step-up risk evaluation failed; rejecting request', { error });
        storeUnavailable(res);
        return;
    }

    const credentialCount = webauthnService.countByUser(user.userId);
    if (credentialCount === 0) {
        sendError(res, 403, {
            code: 'STEPUP_ENROLL_REQUIRED',
            message: 'backend.stepup_enroll_required',
            details: {
                enrollOptionsEndpoint: '/api/auth/webauthn/register/options'
            }
        });
        return;
    }

    sendError(res, 403, {
        code: 'STEPUP_REQUIRED',
        message: 'backend.stepup_required',
        details: {
            stepUpOptionsEndpoint: '/api/auth/webauthn/stepup/options'
        }
    });
}
