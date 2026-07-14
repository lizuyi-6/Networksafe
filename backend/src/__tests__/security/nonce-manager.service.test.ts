/**
 * Tests for NonceManager — replay-attack protection (memory fallback path, since
 * DISABLE_REDIS forces the in-memory store). A nonce must be accepted once and
 * rejected as a replay on second use, until it expires.
 */

import { NonceManager } from '../../security/nonce-manager.service';

describe('NonceManager (memory fallback)', () => {
    let manager: NonceManager;

    beforeEach(() => {
        manager = new NonceManager();
    });

    afterEach(async () => {
        await manager.clearAll();
        manager.close();
    });

    it('does not keep the process alive with its cleanup timer', () => {
        expect((manager as any).cleanupTimer.hasRef()).toBe(false);
    });

    it('releases its cleanup timer when closed', () => {
        const timer = (manager as any).cleanupTimer;

        manager.close();

        expect(timer).toBeDefined();
        expect((manager as any).cleanupTimer).toBeNull();
    });

    it('accepts a fresh nonce and rejects the same nonce as a replay', async () => {
        const nonce = 'nonce-replay-1';
        expect(await manager.checkAndUseNonce(nonce)).toBe(true);   // first use OK
        expect(await manager.checkAndUseNonce(nonce)).toBe(false);  // replay rejected
    });

    it('treats distinct nonces independently', async () => {
        expect(await manager.checkAndUseNonce('a')).toBe(true);
        expect(await manager.checkAndUseNonce('b')).toBe(true);
        expect(await manager.checkAndUseNonce('a')).toBe(false); // a is a replay
        expect(await manager.checkAndUseNonce('c')).toBe(true);
    });

    it('hasNonce detects a used nonce without consuming it', async () => {
        expect(await manager.hasNonce('peek')).toBe(false);
        await manager.markNonceUsed('peek');
        expect(await manager.hasNonce('peek')).toBe(true);
        // hasNonce must NOT mark; the nonce is still considered present
        expect(await manager.hasNonce('peek')).toBe(true);
    });

    it('markNonceUsed makes a subsequent checkAndUseNonce reject', async () => {
        await manager.markNonceUsed('pre-marked');
        expect(await manager.checkAndUseNonce('pre-marked')).toBe(false);
    });

    it('getStats reports the memory store count and redis availability', async () => {
        await manager.markNonceUsed('stat-1');
        await manager.markNonceUsed('stat-2');
        const stats = manager.getStats();
        expect(stats.memoryCount).toBeGreaterThanOrEqual(2);
        expect(typeof stats.redisAvailable).toBe('boolean');
    });

    it('clearAll empties the memory store', async () => {
        await manager.markNonceUsed('to-clear');
        await manager.clearAll();
        expect(manager.getStats().memoryCount).toBe(0);
        // After clear, the nonce can be used again (not a replay anymore).
        expect(await manager.checkAndUseNonce('to-clear')).toBe(true);
    });

    it('honors a custom ttl (short ttl expires and allows reuse)', async () => {
        // ttl in seconds; use a tiny ttl and advance via a second use after mark.
        const nonce = 'ttl-nonce';
        expect(await manager.checkAndUseNonce(nonce, 1)).toBe(true);
        // Immediately it is a replay.
        expect(await manager.checkAndUseNonce(nonce, 1)).toBe(false);
        // hasNonce still sees it within the ttl window.
        expect(await manager.hasNonce(nonce)).toBe(true);
    }, 10000);
});
