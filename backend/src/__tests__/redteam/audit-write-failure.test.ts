/**
 * Audit Logger Write Failure — Redteam Test
 *
 * D22 FIX: The audit log log() method now wraps its local SQLite INSERT in a
 * try/catch and re-throws so callers can retry instead of silently returning
 * a success id when the write failed.
 *
 * Attack scenario:
 *   DB locked, disk full, or corrupted schema causes the local INSERT to throw.
 *   Without re-throw the function returned auditEvent.id as if it succeeded,
 *   leaving the caller unaware that the entry was never written. A retry by
 *   the caller would then generate a new ID and log with a gap — undetectable
 *   unless the audit consumer noticed the missing sequence.
 *
 * Fix verification:
 *   - mock db.prepare().run() to throw
 *   - call auditLogger.log()
 *   - assert the function re-throws an error whose message includes
 *     "audit_log_local_insert_failed"
 */

import { initDatabase } from '../../config/database';
import auditLogger from '../../security/audit-logger.service';

jest.mock('../../config/database');

import { getDatabase } from '../../config/database';

describe('AuditLogger write failure re-throw (redteam)', () => {
  beforeAll(async () => {
    // Initialise the real in-memory DB for schema creation.
    await initDatabase();
  });

  beforeEach(() => {
    // Reset the mock before each test so we can configure it independently.
    jest.clearAllMocks();
  });

  it('re-throws when the local SQLite INSERT throws', async () => {
    const mockDb = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('SQLITE_BUSY: database locked');
        })
      }),
      exec: jest.fn(),
      all: jest.fn().mockReturnValue([]),
      get: jest.fn()
    };
    (getDatabase as jest.Mock).mockReturnValue(mockDb);

    // Override prepare to return our throwing mock for the INSERT call.
    // The schema must still be initialised on the mock so that assertPrepared
    // does not throw "schema not initialised".
    const originalPrepare = mockDb.prepare.bind(mockDb);
    mockDb.prepare = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO audit_log')) {
        const stmt = { run: jest.fn().mockImplementation(() => {
          throw new Error('SQLITE_BUSY: database locked');
        })};
        return stmt;
      }
      return originalPrepare(sql);
    });

    await expect(auditLogger.log({
      eventType: 'test_failure',
      category: 'system',
      severity: 'info',
      actor: { type: 'system', id: 'redteam' },
      action: 'audit_write_failure_test',
      details: { test: true },
      status: 'success'
    })).rejects.toThrow(/audit_log_local_insert_failed/);
  });

  it('returns successfully when the local SQLite INSERT succeeds', async () => {
    const mockDb = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn().mockReturnValue(undefined)
      }),
      exec: jest.fn(),
      all: jest.fn().mockReturnValue([]),
      get: jest.fn()
    };
    (getDatabase as jest.Mock).mockReturnValue(mockDb);

    const id = await auditLogger.log({
      eventType: 'test_success',
      category: 'system',
      severity: 'info',
      actor: { type: 'system', id: 'redteam' },
      action: 'audit_write_success_test',
      details: { test: true },
      status: 'success'
    });

    expect(id).toBeTruthy();
  });
});
