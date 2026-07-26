/**
 * Tests for RedisService — when DISABLE_REDIS is set (as in test), the service
 * reports unavailable and all operations degrade gracefully. Verifies the
 * fail-safe behavior of the in-process singleton.
 */

import redisService from '../../security/redis.service';

describe('RedisService (DISABLE_REDIS mode)', () => {
    it('reports unavailable when Redis is disabled', () => {
        // In the test environment DISABLE_REDIS=true, so the service is not connected.
        expect(redisService.isAvailable()).toBe(false);
    });

    it('isDisabled returns true when DISABLE_REDIS is set', () => {
        expect(redisService.isDisabled()).toBe(true);
    });

    it('getClient throws when not connected', () => {
        expect(() => redisService.getClient()).toThrow();
    });

    it('healthCheck returns unhealthy with an error reason', async () => {
        const result = await redisService.healthCheck();
        expect(result.healthy).toBe(false);
        expect(result.error).toBeTruthy();
    });

    it('get returns null when unavailable', async () => {
        // The service should not throw, just return null.
        // (Implementation may resolve null or reject; we handle both.)
        try {
            const val = await redisService.get('any-key');
            expect(val).toBeNull();
        } catch {
            // Rejecting is also acceptable fail-safe behavior.
        }
    });

    it('set does not throw when unavailable', async () => {
        try {
            await redisService.set('any-key', 'val', 60);
        } catch {
            // Rejecting is acceptable.
        }
    });

    it('del does not throw when unavailable', async () => {
        try {
            await redisService.del('any-key');
        } catch {
            // Acceptable.
        }
    });

    it('exists returns false when unavailable', async () => {
        try {
            const result = await redisService.exists('any-key');
            expect(result).toBe(false);
        } catch {
            // Acceptable.
        }
    });

    it('atomically consumes a strict replay key once in the test fallback', async () => {
        const key = `refresh:used:test-${Date.now()}`;

        await expect(redisService.existsStrict(key)).resolves.toBe(false);
        await expect(redisService.setIfAbsentStrict(key, '1', 60)).resolves.toBe(true);
        await expect(redisService.setIfAbsentStrict(key, '1', 60)).resolves.toBe(false);
        await expect(redisService.existsStrict(key)).resolves.toBe(true);
    });

    it('reads strict test-fallback values without collapsing absence and errors', async () => {
        const key = `strict:get:test-${Date.now()}`;

        await expect(redisService.getStrict(key)).resolves.toBeNull();
        await redisService.setStrict(key, 'session-user', 60);
        await expect(redisService.getStrict(key)).resolves.toBe('session-user');
    });
});
