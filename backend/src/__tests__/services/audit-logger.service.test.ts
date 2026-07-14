/**
 * Audit Logger Service Tests
 *
 * Smoke tests for the tamper-evident audit log.
 * Verifies: write/read round-trip, signature integrity on the happy path, and
 * signature verification failure when log contents are tampered with after the
 * fact. Uses the real in-memory SQLite database and the real AuditLogger
 * singleton — no DB mocking — to exercise the same code path that production
 * hits.
 */

import { getDatabase, initDatabase } from '../../config/database';
import auditLogger from '../../security/audit-logger.service';

describe('auditLogger', () => {
  beforeAll(async () => {
    await initDatabase();
    auditLogger.prepare();
  });

  it('persists an auth event and reads it back with the signature intact', async () => {
    const logId = await auditLogger.logAuth({
      action: 'login',
      actor: { id: 'user-smoke-1', ip: '10.0.0.1' },
      success: true,
      details: { userAgent: 'jest' }
    });

    expect(logId).toBeTruthy();

    const logs = auditLogger.getLogs({ actorId: 'user-smoke-1' });
    const persisted = logs.find((entry) => entry.id === logId);
    expect(persisted).toBeDefined();
    expect(persisted!.eventType).toBe('login');
    expect(persisted!.category).toBe('auth');
    expect(persisted!.status).toBe('success');
    expect(persisted!.actor.id).toBe('user-smoke-1');
    expect(persisted!.actor.ip).toBe('10.0.0.1');
    expect(persisted!.details).toEqual({ userAgent: 'jest' });
    expect(persisted!.signature).toBeTruthy();

    // Happy-path signature must verify.
    expect(auditLogger.verifyIntegrity(logId)).toBe(true);
  });

  it('detects tampering when an audit log row is mutated after insertion', async () => {
    const logId = await auditLogger.logCommand({
      commandType: 'host_remove',
      agentId: 'agent-smoke-2',
      userId: 'user-smoke-2',
      success: true,
      details: { path: '/opt/aetherguard' }
    });

    expect(logId).toBeTruthy();
    expect(auditLogger.verifyIntegrity(logId)).toBe(true);

    // Simulate an attacker who has write access to the database row itself
    // and rewrites the action string — the HMAC was computed over the
    // original action and must no longer match.
    const db = getDatabase();
    db.prepare('UPDATE audit_log SET action = ? WHERE id = ?')
      .run('execute_shell_injection', logId);

    expect(auditLogger.verifyIntegrity(logId)).toBe(false);
  });

  it('returns false from verifyIntegrity for an unknown log id', () => {
    expect(auditLogger.verifyIntegrity('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('owns periodic jobs explicitly and stops every timer', async () => {
    jest.useFakeTimers();
    try {
      auditLogger.startBackgroundJobs();
      expect(jest.getTimerCount()).toBe(3);

      auditLogger.startBackgroundJobs();
      expect(jest.getTimerCount()).toBe(3);

      await auditLogger.stopBackgroundJobs();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await auditLogger.stopBackgroundJobs();
      jest.useRealTimers();
    }
  });
});
