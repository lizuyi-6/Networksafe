/**
 * Audit Logger Dual-Write Atomicity Tests
 *
 * SECURITY FIX R12 V12.1: validates that the audit logger surfaces shadow
 * store write failures (previously fire-and-forget) and that critical
 * failures fail-closed when AUDIT_LOG_FAIL_CLOSED is enabled.
 *
 * The shadow store service is fully mocked — no real Postgres connection
 * is required.
 */

import {
  getAuditShadowWriteMetrics,
  resetAuditShadowWriteMetrics
} from '../../security/audit-logger.service';

const mockCanServeReads = jest.fn();
const mockExecute = jest.fn();
const mockUpsert = jest.fn();
const mockIsEnabled = jest.fn();
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
    canServeReads: () => mockCanServeReads(),
    execute: (...args: unknown[]) => mockExecute(...args),
    upsert: (...args: unknown[]) => mockUpsert(...args),
    isEnabled: () => mockIsEnabled(),
    describe: () => mockDescribe()
  }
}));

// Import the singleton after mocks are in place so it picks them up.
import auditLogger from '../../security/audit-logger.service';

interface FakeDb {
  prepare: jest.Mock;
  exec: jest.Mock;
}

function buildFakeDb(): FakeDb {
  const run = jest.fn();
  const prepare = jest.fn().mockReturnValue({ run });
  return {
    prepare,
    exec: jest.fn()
  };
}

const ORIGINAL_FAIL_CLOSED = process.env.AUDIT_LOG_FAIL_CLOSED;
const ORIGINAL_SHADOW_REQUIRED = process.env.AUDIT_SHADOW_REQUIRED;

describe('AuditLogger dual-write atomicity (R12 V12.1)', () => {
  let db: FakeDb;

  beforeEach(() => {
    jest.clearAllMocks();
    resetAuditShadowWriteMetrics();
    delete process.env.AUDIT_LOG_FAIL_CLOSED;
    delete process.env.AUDIT_SHADOW_REQUIRED;

    db = buildFakeDb();
    mockGetDatabase.mockReturnValue(db);
    // Default: sqlite mode, shadow enabled, no active read replica.
    mockGetDatabaseMode.mockReturnValue('sqlite');
    mockCanServeReads.mockReturnValue(false);
    mockIsEnabled.mockReturnValue(true);
    // Default: no error in shadow state.
    mockDescribe.mockReturnValue({ lastError: null });
    // Default: upsert resolves successfully.
    mockUpsert.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (ORIGINAL_FAIL_CLOSED === undefined) {
      delete process.env.AUDIT_LOG_FAIL_CLOSED;
    } else {
      process.env.AUDIT_LOG_FAIL_CLOSED = ORIGINAL_FAIL_CLOSED;
    }
    if (ORIGINAL_SHADOW_REQUIRED === undefined) {
      delete process.env.AUDIT_SHADOW_REQUIRED;
    } else {
      process.env.AUDIT_SHADOW_REQUIRED = ORIGINAL_SHADOW_REQUIRED;
    }
  });

  it('persists the local SQLite row when the shadow upsert fails (best-effort default)', async () => {
    // Shadow write reports failure via describe().lastError but the
    // function itself does not throw. Best-effort mode must still
    // succeed because SQLite is the canonical local source of truth.
    mockUpsert.mockResolvedValue(undefined);
    mockDescribe.mockReturnValue({ lastError: 'connection refused' });

    const logId = await auditLogger.logAuth({
      action: 'login',
      actor: { id: 'user-dw-1', ip: '10.0.0.1' },
      success: true
    });

    expect(logId).toBeTruthy();
    // The local SQLite INSERT was issued.
    expect(db.prepare).toHaveBeenCalled();
    // We attempted the shadow upsert.
    expect(mockUpsert).toHaveBeenCalledWith(
      'audit_log',
      expect.objectContaining({ id: logId, event_type: 'login' })
    );
    // Failure was recorded in the metric.
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(0);
  });

  it('records shadow write failures and success in the metric counters', async () => {
    // First write: failure recorded in describe()
    mockUpsert.mockResolvedValue(undefined);
    mockDescribe.mockReturnValueOnce({ lastError: 'shadow timeout' });
    await auditLogger.logAuth({
      action: 'failed_login',
      actor: { id: 'user-dw-2' },
      success: false
    });

    // Second write: success
    mockDescribe.mockReturnValueOnce({ lastError: null });
    await auditLogger.logAuth({
      action: 'login',
      actor: { id: 'user-dw-3' },
      success: true
    });

    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.failures).toBe(1);
    expect(metrics.successes).toBe(1);
  });

  it('throws when the local SQLite write fails and AUDIT_LOG_FAIL_CLOSED is enabled', async () => {
    process.env.AUDIT_LOG_FAIL_CLOSED = 'true';

    // Make the SQLite prepare().run() throw.
    db.prepare.mockImplementation(() => ({
      run: () => {
        throw new Error('disk full');
      }
    }));

    await expect(
      auditLogger.logAuth({
        action: 'login',
        actor: { id: 'user-dw-4' },
        success: true
      })
    ).rejects.toThrow(/disk full|Failed to write audit log/);
  });

  it('returns the audit id when both local SQLite and shadow writes succeed', async () => {
    mockUpsert.mockResolvedValue(undefined);
    mockDescribe.mockReturnValue({ lastError: null });

    const logId = await auditLogger.logCommand({
      commandType: 'host_remove',
      agentId: 'agent-dw-1',
      userId: 'user-dw-5',
      success: true,
      details: { path: '/opt/aetherguard' }
    });

    expect(logId).toBeTruthy();
    expect(mockUpsert).toHaveBeenCalledWith(
      'audit_log',
      expect.objectContaining({
        id: logId,
        event_type: 'command_executed',
        action: 'execute_host_remove'
      })
    );
    // The local SQLite INSERT was issued.
    expect(db.prepare).toHaveBeenCalled();
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.successes).toBe(1);
    expect(metrics.failures).toBe(0);
  });

  it('does not invoke shadow upsert when shadow is disabled', async () => {
    mockIsEnabled.mockReturnValue(false);
    mockCanServeReads.mockReturnValue(false);
    mockDescribe.mockReturnValue({ lastError: null });

    const logId = await auditLogger.logAuth({
      action: 'logout',
      actor: { id: 'user-dw-6' },
      success: true
    });

    expect(logId).toBeTruthy();
    expect(mockUpsert).not.toHaveBeenCalled();
    // No shadow metrics touched.
    const metrics = getAuditShadowWriteMetrics();
    expect(metrics.successes).toBe(0);
    expect(metrics.failures).toBe(0);
  });
});
