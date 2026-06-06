/**
 * Audit Logger Concurrent Write — Redteam Test
 *
 * Verifies that concurrent auditLogger.log() calls do not lose entries and do
 * not corrupt the audit_log table. Uses the REAL in-memory SQLite (sql.js)
 * and the REAL AuditLogger singleton — the same code path as production.
 * Concurrent writes are serialized by Node's event loop and SQLite's WAL mode
 * handles the disk writes.
 *
 * This test:
 *   1. Calls log() 50 times in parallel via Promise.all
 *   2. Asserts all 50 rows are present in the local audit_log table
 *   3. Asserts all IDs are unique (no duplicates from race conditions)
 */

import { getDatabase, initDatabase } from '../../config/database';
import auditLogger from '../../security/audit-logger.service';

describe('AuditLogger concurrent writes (redteam)', () => {
  beforeAll(async () => {
    await initDatabase();
    auditLogger.prepare();
  });

  beforeEach(() => {
    // Clear the audit log between tests so concurrent_write_test /
    // sequential_write_test rows from previous runs don't accumulate.
    // The shared sql.js in-memory database persists across tests in the
    // same Jest worker.
    const db = getDatabase();
    db.exec("DELETE FROM audit_log WHERE action IN ('concurrent_write_test', 'sequential_write_test');");
  });

  it('persists all 50 entries when log() is called 50 times in parallel', async () => {
    const PARALLEL = 50;
    const ids = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        auditLogger.log({
          eventType: `concurrent_test_${i}`,
          category: 'system',
          severity: 'info',
          actor: { type: 'system', id: 'concurrent-writer' },
          action: 'concurrent_write_test',
          details: { index: i },
          status: 'success'
        })
      )
    );

    expect(ids).toHaveLength(PARALLEL);
    expect(new Set(ids).size).toBe(PARALLEL); // all unique

    // Verify all 50 rows are queryable
    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM audit_log WHERE action = 'concurrent_write_test'")
      .all() as any[];

    expect(rows).toHaveLength(PARALLEL);

    // Verify each index appears exactly once
    const indices = rows
      .map((r) => JSON.parse(r.details_json).index)
      .sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: PARALLEL }, (_, i) => i));
  });

  it('handles 100 rapid sequential writes without losing any entries', async () => {
    const COUNT = 100;
    const ids: string[] = [];

    for (let i = 0; i < COUNT; i++) {
      const id = await auditLogger.log({
        eventType: `sequential_test_${i}`,
        category: 'system',
        severity: 'info',
        actor: { type: 'system', id: 'sequential-writer' },
        action: 'sequential_write_test',
        details: { index: i },
        status: 'success'
      });
      ids.push(id);
    }

    expect(ids).toHaveLength(COUNT);
    expect(new Set(ids).size).toBe(COUNT);

    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM audit_log WHERE action = 'sequential_write_test'")
      .all() as any[];
    expect(rows).toHaveLength(COUNT);
  });

  it('produces unique IDs under concurrent load', async () => {
    const CONCURRENT = 30;
    const ids = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        auditLogger.log({
          eventType: `idempotency_test_${i}`,
          category: 'system',
          severity: 'info',
          actor: { type: 'system', id: 'idempotency-writer' },
          action: 'idempotency_test',
          details: { index: i },
          status: 'success'
        })
      )
    );

    // All IDs must be unique — no UUID collisions under concurrency
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(CONCURRENT);
  });
});
