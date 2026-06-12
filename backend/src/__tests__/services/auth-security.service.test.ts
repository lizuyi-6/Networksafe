/**
 * Auth Security Service Tests
 *
 * Smoke tests for session management and account lockout.
 * Uses the real in-memory SQLite database via Redis fallback mode
 * (redisService.isAvailable() returns false in test environment).
 */

import { initDatabase } from '../../config/database';
import authSecurityService from '../../security/auth-security.service';

describe('authSecurityService session management', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    // Reset fallback maps between tests to avoid state leakage
    authSecurityService['loginAttemptsFallback'] = new Map();
    authSecurityService['lockedAccountsFallback'] = new Map();
    authSecurityService['sessionsFallback'] = new Map();
    authSecurityService['concurrentSessionsFallback'] = new Map();
  });

  it('generates a session id and adds it to the fallback session store', async () => {
    const userId = `user-session-${Date.now()}`;
    const sessionId = authSecurityService.generateSessionId();

    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBe(64); // 32 bytes hex = 64 chars

    await authSecurityService.addSession(userId, sessionId, { browser: 'jest' });

    // Verify session was stored in fallback map
    const isValid = await authSecurityService.validateSession(userId, sessionId);
    expect(isValid).toBe(true);
  });

  it('rejects a session that does not exist', async () => {
    const userId = `user-invalid-${Date.now()}`;
    const fakeSessionId = '0000000000000000000000000000000000000000000000000000000000000000';

    const isValid = await authSecurityService.validateSession(userId, fakeSessionId);
    expect(isValid).toBe(false);
  });

  it('invalidates all sessions for a user', async () => {
    const userId = `user-invalidate-${Date.now()}`;
    const sessionId1 = authSecurityService.generateSessionId();
    const sessionId2 = authSecurityService.generateSessionId();

    await authSecurityService.addSession(userId, sessionId1, { device: 'desktop' });
    await authSecurityService.addSession(userId, sessionId2, { device: 'mobile' });

    // Both sessions should be valid before invalidation
    expect(await authSecurityService.validateSession(userId, sessionId1)).toBe(true);
    expect(await authSecurityService.validateSession(userId, sessionId2)).toBe(true);

    await authSecurityService.invalidateSession(userId);

    // Both sessions should be invalid after invalidation
    expect(await authSecurityService.validateSession(userId, sessionId1)).toBe(false);
    expect(await authSecurityService.validateSession(userId, sessionId2)).toBe(false);
  });

  it('validates password strength correctly', () => {
    // Weak passwords
    const weak1 = authSecurityService.validatePassword('123456');
    expect(weak1.valid).toBe(false);
    expect(weak1.strength).toBe('weak');

    const weak2 = authSecurityService.validatePassword('password');
    expect(weak2.valid).toBe(false);
    expect(weak2.strength).toBe('weak');

    const weak3 = authSecurityService.validatePassword('abc123');
    expect(weak3.valid).toBe(false);

    // Medium strength - missing special char (also in common-password list, so downgraded to weak)
    const medium = authSecurityService.validatePassword('Password1');
    expect(medium.valid).toBe(false);
    expect(medium.strength).toBe('weak');

    // Strong - meets all requirements
    const strong = authSecurityService.validatePassword('SecurePass1!');
    expect(strong.valid).toBe(true);
    expect(strong.strength).toBe('strong');

    // Too short
    const short = authSecurityService.validatePassword('Ab1!');
    expect(short.valid).toBe(false);
    expect(short.errors.some((e: string) => e.includes('at least'))).toBe(true);
  });

  it('locks an account after exceeding failed login attempts', async () => {
    const email = `locked-${Date.now()}@test.local`;

    // Record MAX_LOGIN_ATTEMPTS (5) failed attempts
    for (let i = 0; i < 5; i++) {
      await authSecurityService.recordLoginAttempt(email, '192.168.1.1', false);
    }

    const isLocked = await authSecurityService.isAccountLocked(email);
    expect(isLocked).toBe(true);

    const lockInfo = await authSecurityService.getLockInfo(email);
    expect(lockInfo.locked).toBe(true);
    expect(lockInfo.reason).toContain('Too many failed');
  });

  it('unlocks an account and allows login again', async () => {
    const email = `unlock-${Date.now()}@test.local`;

    // Lock the account
    for (let i = 0; i < 5; i++) {
      await authSecurityService.recordLoginAttempt(email, '192.168.1.1', false);
    }

    expect(await authSecurityService.isAccountLocked(email)).toBe(true);

    // Unlock
    await authSecurityService.unlockAccount(email);

    expect(await authSecurityService.isAccountLocked(email)).toBe(false);

    const lockInfo = await authSecurityService.getLockInfo(email);
    expect(lockInfo.locked).toBe(false);
  });
});
