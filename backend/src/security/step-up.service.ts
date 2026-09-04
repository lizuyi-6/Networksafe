/**
 * Step-up re-authentication state store.
 *
 * Holds WebAuthn ceremony challenges and short-lived step-up tokens in Redis
 * using ONLY the strict (throwing) operations — an unavailable session/blacklist
 * store must fail closed exactly like the auth token blacklist does
 * (CVE-2026-001 semantics). The NODE_ENV=test in-process fallback inside
 * redis.service keeps Jest hermetic.
 *
 * Deletion is implemented as a tombstone rewrite (SET 'revoked'/'consumed')
 * instead of DEL because the lenient del() silently no-ops when Redis is
 * unavailable, and revocation must persist (or at least be observable) across
 * a Redis outage window.
 */

import crypto from 'crypto';
import type { Request } from 'express';
import redisService from './redis.service';
import authSecurityService from './auth-security.service';
import logger from '../utils/logger';
import { getStepUpTokenTtlSeconds, getStepUpChallengeTtlSeconds } from '../config/stepup';
import { tokenKeyDigest } from './redis-token-keys';

export interface StepUpSessionDeviceInfo {
    ip?: string;
    userAgent?: string;
    loginAt?: string;
}

export interface StepUpTokenRecord {
    userId: string;
    sessionId: string;
    issuedAt: number;
    deviceIp?: string;
    deviceUserAgent?: string;
    /** AUD-07-3: optional action/target binding — a scoped token must not be
     * reused for a different high-risk operation within its TTL. */
    actionScope?: string;
    targetScope?: string;
}

export interface StepUpExpectedScope {
    action?: string;
    target?: string;
}

export type WebAuthnCeremony = 'registration' | 'stepup';

const CHALLENGE_PREFIX = 'stepup:challenge:';
const REGISTRATION_CHALLENGE_PREFIX = 'webauthn:registration:challenge:';
const TOKEN_PREFIX = 'stepup:token:';
const SESSION_INDEX_PREFIX = 'stepup:session:';
// auth:session:{sessionId} — key format owned by auth-security.service.
const AUTH_SESSION_PREFIX = 'auth:session:';
const TOMBSTONE = 'revoked';

class StepUpService {
    async storeChallenge(userId: string, sessionId: string, challenge: string): Promise<void> {
        await redisService.setStrict(
            `${CHALLENGE_PREFIX}${userId}:${sessionId}`,
            challenge,
            getStepUpChallengeTtlSeconds()
        );
    }

    async storeRegistrationChallenge(userId: string, sessionId: string, challenge: string): Promise<void> {
        await redisService.setStrict(
            `${REGISTRATION_CHALLENGE_PREFIX}${userId}:${sessionId}`,
            challenge,
            getStepUpChallengeTtlSeconds()
        );
    }

    async consumeRegistrationChallenge(userId: string, sessionId: string): Promise<string | null> {
        return this.consumeChallengeAtKey(`${REGISTRATION_CHALLENGE_PREFIX}${userId}:${sessionId}`);
    }

    /**
     * Single-use consume: returns the stored challenge and claims it atomically
     * so a parallel or replayed verify can never reuse it.
     */
    async consumeChallenge(userId: string, sessionId: string): Promise<string | null> {
        return this.consumeChallengeAtKey(`${CHALLENGE_PREFIX}${userId}:${sessionId}`);
    }

    private async consumeChallengeAtKey(key: string): Promise<string | null> {
        const stored = await redisService.getStrict(key);
        if (!stored) {
            return null;
        }
        const digest = crypto.createHash('sha256').update(stored).digest('base64url');
        const claimed = await redisService.setIfAbsentStrict(`${key}:used:${digest}`, '1', getStepUpChallengeTtlSeconds());
        return claimed ? stored : null;
    }

    async issueToken(
        userId: string,
        sessionId: string,
        device?: StepUpSessionDeviceInfo,
        scope?: StepUpExpectedScope
    ): Promise<string> {
        const token = crypto.randomBytes(32).toString('base64url');
        const ttl = getStepUpTokenTtlSeconds();
        const indexKey = `${SESSION_INDEX_PREFIX}${sessionId}`;
        // SECURITY (audit 2026-08, AUD-01-2): token keys and the session
        // index VALUE both carry only the keyed digest — a raw step-up
        // token never enters the Redis keyspace. The index value is the
        // digest of the live token, so tombstoning the previous token keys
        // directly off that digest.
        const tokenDigest = tokenKeyDigest(token);
        // Only one live step-up token is valid per session. Tombstone the
        // previous token before publishing the new index to close a replay
        // window when a user completes two ceremonies in parallel.
        const previousTokenDigest = await redisService.getStrict(indexKey);
        if (previousTokenDigest && previousTokenDigest !== TOMBSTONE) {
            await redisService.setStrict(`${TOKEN_PREFIX}${previousTokenDigest}`, TOMBSTONE, ttl);
        }
        await redisService.setStrict(
            `${TOKEN_PREFIX}${tokenDigest}`,
            JSON.stringify({
                userId,
                sessionId,
                issuedAt: Date.now(),
                deviceIp: device?.ip,
                deviceUserAgent: device?.userAgent,
                actionScope: scope?.action,
                targetScope: scope?.target
            } satisfies StepUpTokenRecord),
            ttl
        );
        await redisService.setStrict(indexKey, tokenDigest, ttl);
        return token;
    }

    async getTokenRecord(token: string, userId: string, sessionId: string): Promise<StepUpTokenRecord | null> {
        if (!token) {
            return null;
        }
        const raw = await redisService.getStrict(`${TOKEN_PREFIX}${tokenKeyDigest(token)}`);
        if (!raw || raw === TOMBSTONE) {
            return null;
        }
        try {
            const record = JSON.parse(raw) as StepUpTokenRecord;
            if (record.userId !== userId || record.sessionId !== sessionId) {
                return null;
            }
            return record;
        } catch {
            return null;
        }
    }

    async validateToken(
        token: string,
        userId: string,
        sessionId: string,
        requestDevice?: StepUpSessionDeviceInfo,
        expectedScope?: StepUpExpectedScope
    ): Promise<boolean> {
        const record = await this.getTokenRecord(token, userId, sessionId);
        if (!record) {
            return false;
        }
        // AUD-07-3: a scoped expected action/target must match the scope the
        // token was issued for — tokens cannot be replayed across different
        // high-risk operations.
        if (expectedScope?.action !== undefined && record.actionScope !== expectedScope.action) {
            return false;
        }
        if (expectedScope?.target !== undefined && record.targetScope !== expectedScope.target) {
            return false;
        }
        const indexedToken = await redisService.getStrict(`${SESSION_INDEX_PREFIX}${sessionId}`);
        // The index stores the keyed digest of the live token; compare
        // digest-to-digest in constant time.
        if (!indexedToken || indexedToken === TOMBSTONE || !constantTimeStringEqual(indexedToken, tokenKeyDigest(token))) {
            return false;
        }
        if (requestDevice && (record.deviceIp || record.deviceUserAgent)) {
            return ipMatches(normalizeIp(record.deviceIp), normalizeIp(requestDevice.ip))
                && String(record.deviceUserAgent || '') === String(requestDevice.userAgent || '');
        }
        return true;
    }

    /**
     * Kill the session's outstanding step-up token (risk elevation). Best
     * effort with an explicit log — the requireStepUp check itself fails
     * closed while Redis is down, so a missed tombstone only matters after
     * recovery, and the token TTL bounds that window.
     */
    async revokeSessionToken(sessionId: string): Promise<void> {
        try {
            const indexKey = `${SESSION_INDEX_PREFIX}${sessionId}`;
            const token = await redisService.getStrict(indexKey);
            if (!token || token === TOMBSTONE) {
                return;
            }
            const ttl = getStepUpTokenTtlSeconds();
            await redisService.setStrict(`${TOKEN_PREFIX}${token}`, TOMBSTONE, ttl);
            await redisService.setStrict(indexKey, TOMBSTONE, ttl);
        } catch (error) {
            logger.error('Step-up token revocation failed; check will fail closed', { error, sessionId: sessionId.slice(0, 8) });
            throw error;
        }
    }

    /**
     * Read back the login-time device fingerprint recorded by
     * establishTrackedSession() (auth.routes). Stored, never yet compared —
     * this is the read side of the "risk elevation" signal.
     */
    async getSessionDevice(sessionId: string): Promise<StepUpSessionDeviceInfo | null> {
        const stored = await redisService.getStrict(`${AUTH_SESSION_PREFIX}${sessionId}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as { deviceInfo?: StepUpSessionDeviceInfo };
                return parsed?.deviceInfo || null;
            } catch {
                return null;
            }
        }
        // Test/lab in-memory auth sessions retain the same device metadata as
        // Redis sessions; use it rather than silently disabling risk checks.
        return await authSecurityService.getFallbackSessionDeviceInfo(sessionId) as StepUpSessionDeviceInfo | null;
    }
}

function constantTimeStringEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeIp(ip: string | undefined): string {
    return String(ip || '').trim().replace(/^::ffff:/, '').toLowerCase();
}

function ipMatches(sessionIp: string, requestIp: string): boolean {
    if (!sessionIp || !requestIp) {
        return true; // no baseline to compare — do not fabricate a signal
    }
    if (sessionIp === requestIp) {
        return true;
    }
    const isIpv4 = (value: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
    if (isIpv4(sessionIp) && isIpv4(requestIp)) {
        // Same /24 subnet counts as the same egress network.
        return sessionIp.split('.').slice(0, 3).join('.') === requestIp.split('.').slice(0, 3).join('.');
    }
    if (!isIpv4(sessionIp) && !isIpv4(requestIp)) {
        // Same /64 for IPv6.
        const first64 = (value: string) => value.split(':').slice(0, 4).join(':');
        return first64(sessionIp) === first64(requestIp);
    }
    return false;
}

/**
 * Risk elevation: the request does NOT match the device fingerprint captured
 * at login (different egress network and/or different User-Agent). Sessions
 * without a fingerprint baseline (lab in-memory store) never elevate — there
 * is nothing to compare against and lab mode is not a hardened target.
 */
export function isDeviceElevated(
    sessionDevice: StepUpSessionDeviceInfo | null | undefined,
    req: Request
): boolean {
    if (!sessionDevice) {
        return false;
    }
    const requestIp = normalizeIp(req.ip || undefined);
    const requestUa = String(req.headers['user-agent'] || '').trim();
    const sessionIp = normalizeIp(sessionDevice.ip);
    const sessionUa = String(sessionDevice.userAgent || '').trim();
    return !(ipMatches(sessionIp, requestIp) && sessionUa === requestUa);
}

export default new StepUpService();
