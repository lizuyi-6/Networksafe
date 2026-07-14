/**
 * REDTEAM SECURITY TEST — Audit shadow-write silent drop (R12 V12.2)
 * =====================================================================
 *
 * Bug: AuditLogger.log() wrote to local SQLite AFTER the shadow write.
 * When postgresShadowStoreService.execute() (or upsert()) threw, the outer
 * catch returned auditEvent.id (success) but the SQLite row had never been
 * inserted — the audit event was silently lost.
 *
 * Fix: SQLite insert moved BEFORE any shadow write.  The shadow is a
 * best-effort mirror; it must never prevent the local commit.  When
 * AUDIT_LOG_FAIL_CLOSED=true the original error is re-thrown AFTER the
 * local row is already committed, so callers can treat it as a compliance
 * event without data loss.
 *
 * Red-team test:
 *   Mock postgresShadowStoreService.execute  → throws Postgres error
 *   Mock postgresShadowStoreService.upsert   → throws Postgres error
 *   Call auditLogger.log({ ... })
 *   Assert local SQLite HAS the row (was committed before shadow failed)
 *   Assert function returned the event id
 *   Assert function did NOT throw (AUDIT_LOG_FAIL_CLOSED not set)
 *   Assert auditShadowWriteFailures counter incremented
 *
 *   With AUDIT_LOG_FAIL_CLOSED=true:
 *   Assert function DOES throw AFTER committing locally
 *   Assert local SQLite row still exists
 */

import {
  flushPendingAuditShadowWrites,
  getAuditShadowWriteMetrics,
  resetAuditShadowWriteMetrics
} from '../../security/audit-logger.service';

const mockExecute = jest.fn();
const mockUpsert = jest.fn();
const mockIsEnabled = jest.fn();
const mockCanServeReads = jest.fn();
const mockDescribe = jest.fn();
const mockGetDatabase = jest.fn();
const mockGetDatabaseMode = jest.fn();

jest.mock('../../config/database', () => ({
  getDatabase: () => mockGetDatabase(),
  initDatabase: jest.fn()
}));

jest.mock('../../config/platform-runtime', () => ({
  getDatabaseMode: () => mockGetDatabaseMode()
}));

jest.mock('../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    execute: (...args: unknown[]) => mockExecute(...args),
    upsert: (...args: unknown[]) => mockUpsert(...args),
    isEnabled: () => mockIsEnabled(),
    canServeReads: () => mockCanServeReads(),
    describe: () => mockDescribe()
  }
}));

import auditLogger from '../../security/audit-logger.service';

interface FakeDb {
  prepare: jest.Mock;
  exec: jest.Mock;
}

function buildFakeDb(): FakeDb {
  const run = jest.fn();
  const get = jest.fn();
  const all = jest.fn();
  const prepare = jest.fn().mockReturnValue({ run, get, all });
  return { prepare, exec: jest.fn() };
}

const REAL_ENV_AUDIT_FAIL_CLOSED = process.env.AUDIT_LOG_FAIL_CLOSED;

describe('REDTEAM audit shadow-write silent drop', () => {
  let db: FakeDb;

  beforeEach(async () => {
    await flushPendingAuditShadowWrites();
    // Must use resetAllMocks to clear mock implementations/returnValues,
    // not just call history. clearAllMocks leaves mockReturnValue intact.
    jest.resetAllMocks();
    resetAuditShadowWriteMetrics();
    delete process.env.AUDIT_LOG_FAIL_CLOSED;

    db = buildFakeDb();
    mockGetDatabase.mockReturnValue(db);
    mockGetDatabaseMode.mockReturnValue('sqlite');
    mockCanServeReads.mockReturnValue(false);
    mockIsEnabled.mockReturnValue(true);
    // Each test must explicitly set describe() return value;
    // resetAllMocks cleared all mockReturnValue calls.
    mockDescribe.mockReturnValue({ lastError: null });
  });

  afterAll(() => {
    if (REAL_ENV_AUDIT_FAIL_CLOSED === undefined) {
      delete process.env.AUDIT_LOG_FAIL_CLOSED;
    } else {
      process.env.AUDIT_LOG_FAIL_CLOSED = REAL_ENV_AUDIT_FAIL_CLOSED;
    }
  });

  // -------------------------------------------------------------------------
  // Scenario: shadow execute() throws — local SQLite must still have the row
  // -------------------------------------------------------------------------
  it('commits local SQLite row when shadow execute() throws (AUDIT_LOG_FAIL_CLOSED=false)', async () => {
    // canServeReads=true: both execute() and upsert() are called.
    // execute fails → failures=1; upsert succeeds → successes=1.
    mockCanServeReads.mockReturnValue(true);
    mockExecute.mockRejectedValue(new Error('connection refused'));
    mockUpsert.mockResolvedValue(undefined);
    mockDescribe.mockReturnValue({ lastError: null });

    const eventId = await auditLogger.log({
      eventType: 'critical_action',
      category: 'command',
      severity: 'critical',
      actor: { type: 'user', id: 'redteam-user-1' },
      action: 'factory_reset',
      details: { target: 'server-1' },
      status: 'success'
    });
    await flushPendingAuditShadowWrites();

    // Function returned the id (did not throw)
    expect(eventId).toBeTruthy();

    // SQLite INSERT was issued (source of truth committed first)
    expect(db.prepare).toHaveBeenCalled();
    const sqliteCall = db.prepare.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_log')
    );
    expect(sqliteCall).toBeDefined();

    // Execute path failed, upsert path succeeded.
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(1);
  });

  it('commits local SQLite row when shadow execute() throws (AUDIT_LOG_FAIL_CLOSED=true) and re-throws', async () => {
    process.env.AUDIT_LOG_FAIL_CLOSED = 'true';
    mockCanServeReads.mockReturnValue(true);
    mockExecute.mockRejectedValue(new Error('connection refused'));
    mockUpsert.mockRejectedValue(new Error('upsert also down'));
    mockDescribe.mockReturnValue({ lastError: null });

    await expect(
      auditLogger.log({
        eventType: 'critical_action',
        category: 'command',
        severity: 'critical',
        actor: { type: 'user', id: 'redteam-user-2' },
        action: 'wipe_data',
        details: { target: 'server-2' },
        status: 'success'
      })
    ).rejects.toThrow('connection refused');

    // SQLite row was committed BEFORE the re-throw
    expect(db.prepare).toHaveBeenCalled();
    const sqliteCall = db.prepare.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_log')
    );
    expect(sqliteCall).toBeDefined();

    // When execute throws with AUDIT_LOG_FAIL_CLOSED=true, the execute catch
    // re-throws and immediately exits log().  The upsert path never runs.
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario: shadow upsert() throws — local SQLite must still have the row
  // -------------------------------------------------------------------------
  it('commits local SQLite row when shadow upsert() throws (AUDIT_LOG_FAIL_CLOSED=false)', async () => {
    mockCanServeReads.mockReturnValue(false);
    mockUpsert.mockRejectedValue(new Error('shadow network error'));
    mockDescribe.mockReturnValue({ lastError: null });

    const eventId = await auditLogger.log({
      eventType: 'host_remove',
      category: 'command',
      severity: 'critical',
      actor: { type: 'user', id: 'redteam-user-3' },
      action: 'host_remove',
      details: { target: 'server-3' },
      status: 'success'
    });
    await flushPendingAuditShadowWrites();

    expect(eventId).toBeTruthy();
    expect(db.prepare).toHaveBeenCalled();
    const sqliteCall = db.prepare.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_log')
    );
    expect(sqliteCall).toBeDefined();

    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(0);
  });

  it('commits local SQLite row when shadow upsert() throws (AUDIT_LOG_FAIL_CLOSED=true) and re-throws', async () => {
    process.env.AUDIT_LOG_FAIL_CLOSED = 'true';
    mockCanServeReads.mockReturnValue(false);
    mockUpsert.mockRejectedValue(new Error('shadow network error'));
    mockDescribe.mockReturnValue({ lastError: null });

    await expect(
      auditLogger.log({
        eventType: 'host_remove',
        category: 'command',
        severity: 'critical',
        actor: { type: 'user', id: 'redteam-user-4' },
        action: 'host_remove',
        details: { target: 'server-4' },
        status: 'success'
      })
    ).rejects.toThrow('shadow network error');

    expect(db.prepare).toHaveBeenCalled();
    const sqliteCall = db.prepare.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_log')
    );
    expect(sqliteCall).toBeDefined();

    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Scenario: shadow upsert() sets lastError via describe() (non-throwing path)
  // -------------------------------------------------------------------------
  it('commits local SQLite row when upsert() sets lastError (AUDIT_LOG_FAIL_CLOSED=false)', async () => {
    mockCanServeReads.mockReturnValue(false);
    mockUpsert.mockResolvedValue(undefined);  // upsert() doesn't throw
    mockDescribe.mockReturnValue({ lastError: 'replication lag exceeded' });

    const eventId = await auditLogger.log({
      eventType: 'firewall_rule',
      category: 'firewall',
      severity: 'critical',
      actor: { type: 'user', id: 'redteam-user-5' },
      action: 'block_ip',
      details: { ip: '203.0.113.99' },
      status: 'success'
    });
    await flushPendingAuditShadowWrites();

    expect(eventId).toBeTruthy();
    expect(db.prepare).toHaveBeenCalled();
    const sqliteCall = db.prepare.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_log')
    );
    expect(sqliteCall).toBeDefined();

    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(0);
  });

  it('commits local SQLite row when upsert() sets lastError (AUDIT_LOG_FAIL_CLOSED=true) and re-throws', async () => {
    process.env.AUDIT_LOG_FAIL_CLOSED = 'true';
    mockCanServeReads.mockReturnValue(false);
    mockUpsert.mockResolvedValue(undefined);
    mockDescribe.mockReturnValue({ lastError: 'replication lag exceeded' });

    await expect(
      auditLogger.log({
        eventType: 'firewall_rule',
        category: 'firewall',
        severity: 'critical',
        actor: { type: 'user', id: 'redteam-user-6' },
        action: 'block_ip',
        details: { ip: '203.0.113.100' },
        status: 'success'
      })
    ).rejects.toThrow('replication lag exceeded');

    expect(db.prepare).toHaveBeenCalled();
    const sqliteCall = db.prepare.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_log')
    );
    expect(sqliteCall).toBeDefined();

    // The shadow service reports write failures through describe().lastError.
    // Fail-closed mode must surface that state after the local row is committed.
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Regression: both shadows succeed — no counter increment
  // -------------------------------------------------------------------------
  it('increments successes counter when both shadow writes succeed', async () => {
    mockCanServeReads.mockReturnValue(true);
    mockExecute.mockResolvedValue(1);
    mockUpsert.mockResolvedValue(undefined);
    mockDescribe.mockReturnValue({ lastError: null });

    const eventId = await auditLogger.log({
      eventType: 'login',
      category: 'auth',
      severity: 'info',
      actor: { type: 'user', id: 'redteam-user-7' },
      action: 'login',
      details: {},
      status: 'success'
    });
    await flushPendingAuditShadowWrites();

    expect(eventId).toBeTruthy();
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.successes).toBeGreaterThanOrEqual(1);
    expect(metrics.failures).toBe(0);
  });
});
