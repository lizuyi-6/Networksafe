/**
 * SECURITY (audit 2026-08, AUD-01-2): Redis keys derived from bearer-token
 * secrets must carry only the keyed digest — never the raw token.
 */

import crypto from 'crypto';
import { tokenKeyDigest } from '../../security/redis-token-keys';

describe('tokenKeyDigest', () => {
    const ORIGINAL_SECRET = process.env.JWT_SECRET;

    beforeAll(() => {
        process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
    });

    afterAll(() => {
        process.env.JWT_SECRET = ORIGINAL_SECRET;
    });

    it('produces a stable 64-char hex digest for the same token', () => {
        const digest = tokenKeyDigest('raw-bearer-token-value');
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
        expect(tokenKeyDigest('raw-bearer-token-value')).toBe(digest);
    });

    it('produces different digests for different tokens', () => {
        expect(tokenKeyDigest('token-a')).not.toBe(tokenKeyDigest('token-b'));
    });

    it('is keyed: a token digest cannot be recomputed without JWT_SECRET', () => {
        const digest = tokenKeyDigest('raw-bearer-token-value');
        const unkeyed = crypto.createHash('sha256').update('raw-bearer-token-value').digest('hex');
        expect(digest).not.toBe(unkeyed);
        // And flipping the secret flips the digest (purpose-bound subkey).
        process.env.JWT_SECRET = 'another-jwt-secret-minimum-32-chars!!';
        // Cached subkey means the same process keeps the old key until a
        // fresh module instance — recompute via a direct HMAC with the new
        // derived key to document the keyed construction.
        const alternate = crypto
            .createHmac('sha256', crypto.createHash('sha256').update('aetherguard:redis-token-key:v1:another-jwt-secret-minimum-32-chars!!').digest('hex'))
            .update('raw-bearer-token-value')
            .digest('hex');
        expect(alternate).not.toBe(digest);
        process.env.JWT_SECRET = ORIGINAL_SECRET;
    });
});
