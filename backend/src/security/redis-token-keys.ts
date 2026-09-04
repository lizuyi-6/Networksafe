/**
 * SECURITY (audit 2026-08, batch 1 / AUD-01-2): Redis key derivation for
 * bearer-token-shaped secrets.
 *
 * Redis keys containing a raw token (blacklist, step-up tokens) leak the
 * full bearer credential to anything that can observe the keyspace: MONITOR,
 * SCAN/KEYS dumps, redis-cli --bigkeys, slowlog, RDB/AOF snapshots shipped
 * off-box. All Redis keys derived from a token MUST go through this HMAC
 * instead.
 *
 * The HMAC key is a purpose-derived subkey of JWT_SECRET (mandatory in every
 * environment per the runtime-env guard), so token derivation can never be
 * confused with another HMAC use of the same master secret. Missing secret
 * fails closed.
 */

import crypto from 'crypto';

let cachedSubkey: string | null = null;

function keySubkey(): string {
    if (cachedSubkey) {
        return cachedSubkey;
    }
    const master = String(process.env.JWT_SECRET || '').trim();
    if (!master) {
        throw new Error('backend.redis_token_key_secret_missing');
    }
    cachedSubkey = crypto
        .createHash('sha256')
        .update(`aetherguard:redis-token-key:v1:${master}`)
        .digest('hex');
    return cachedSubkey;
}

/** Stable keyed digest of a raw token — safe to place in a Redis key. */
export function tokenKeyDigest(rawToken: string): string {
    return crypto.createHmac('sha256', keySubkey()).update(rawToken).digest('hex');
}
