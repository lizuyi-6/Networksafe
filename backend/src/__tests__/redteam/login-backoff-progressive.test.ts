/**
 * Redteam test: progressive login failure backoff (D32)
 *
 * Verifies the observable lockout outcomes:
 * - 1 failed attempt  → not locked
 * - 6 failed attempts → locked (403), reason returned
 * - unlockAccount     → clears the lock
 *
 * Uses the real AuthSecurityService class (not the mocked singleton) via
 * jest.requireActual, with redis mocked to force the in-memory fallback path.
 */

jest.mock('../../security/redis.service', () => ({
    __esModule: true,
    default: { isAvailable: () => false }
}));

// Get the real class directly (not the mocked singleton default export)
const { AuthSecurityService } = jest.requireActual('../../security/auth-security.service');

const TEST_EMAIL = 'backoff-test@example.com';
const TEST_IP    = '10.0.0.99';

describe('Progressive login failure backoff (D32)', () => {
    let service: InstanceType<typeof AuthSecurityService>;

    beforeEach(() => {
        service = new AuthSecurityService();
        // Clear in-memory fallback maps to avoid cross-test pollution
        (service as any).loginAttemptsFallback = new Map();
        (service as any).lockedAccountsFallback = new Map();
    });

    // ---- 1 failure: not locked, no progressive delay ----
    it('1 failed attempt → isAccountLocked=false', async () => {
        await service.recordLoginAttempt(TEST_EMAIL, TEST_IP, false);

        const locked = await service.isAccountLocked(TEST_EMAIL);
        expect(locked).toBe(false);

        const attempts = await service.getFailedAttempts(TEST_EMAIL);
        expect(attempts.length).toBe(1);
    });

    // ---- 6 failures: account locked ----
    it('6 failed attempts → isAccountLocked=true', async () => {
        for (let i = 0; i < 6; i++) {
            await service.recordLoginAttempt(TEST_EMAIL, TEST_IP, false);
        }

        const locked = await service.isAccountLocked(TEST_EMAIL);
        expect(locked).toBe(true);

        const lockInfo = await service.getLockInfo(TEST_EMAIL);
        expect(lockInfo.locked).toBe(true);
        expect(lockInfo.reason).toContain('Too many failed');
        expect(lockInfo.remainingTime).toBeGreaterThan(0);
    });

    // ---- Locked account blocks subsequent login ----
    it('locked account → isAccountLocked=true', async () => {
        for (let i = 0; i < 6; i++) {
            await service.recordLoginAttempt(TEST_EMAIL, TEST_IP, false);
        }

        const locked = await service.isAccountLocked(TEST_EMAIL);
        expect(locked).toBe(true);

        const lockInfo = await service.getLockInfo(TEST_EMAIL);
        expect(lockInfo.remainingTime).toBeGreaterThan(0);
    });

    // ---- unlockAccount clears the lock ----
    it('unlockAccount clears the lock', async () => {
        for (let i = 0; i < 6; i++) {
            await service.recordLoginAttempt(TEST_EMAIL, TEST_IP, false);
        }
        expect(await service.isAccountLocked(TEST_EMAIL)).toBe(true);

        await service.unlockAccount(TEST_EMAIL);
        expect(await service.isAccountLocked(TEST_EMAIL)).toBe(false);
    });
});
