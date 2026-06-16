/**
 * Integration tests for scanner-route.repository — the thin fix-history +
 * legacy scan-result queries. Backed by the in-memory SQLite store.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import { listFixHistoryRows, getLegacyScanResultById } from '../../modules/scanner/scanner-route.repository';
import { scannerTaskService } from '../../services/scanner-task.service';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-scanner-route-test-data');

function insertScanTask(overrides: Partial<Record<string, unknown>> = {}) {
  const id = String(overrides.id || `task-${Math.random().toString(36).slice(2, 8)}`);
  getDatabase().prepare(`
    INSERT INTO scan_tasks (id, tenant_id, created_by, status, phase, progress, engine_policy, targets_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'tenant-test',
    'admin-1',
    String(overrides.status || 'completed'),
    (overrides.phase ?? 'done') as string,
    (overrides.progress ?? 100) as number,
    'nuclei',
    '[]',
    (overrides.created_at ?? new Date().toISOString()) as string
  );
  return id;
}

describe('scanner-route repository', () => {
  beforeAll(async () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    process.env.DATA_DIR = testDataDir;
    await initDatabase();
    scannerTaskService.prepare(); // creates scan_tasks table
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  it('listFixHistoryRows returns [] when there are no scan tasks', async () => {
    getDatabase().exec('DELETE FROM scan_tasks');
    const rows = await listFixHistoryRows(10);
    expect(rows).toEqual([]);
  });

  it('listFixHistoryRows returns tasks newest-first and respects the limit', async () => {
    getDatabase().exec('DELETE FROM scan_tasks');
    insertScanTask({ id: 't1', created_at: '2026-01-01T00:00:00Z' });
    insertScanTask({ id: 't2', created_at: '2026-02-01T00:00:00Z' });
    insertScanTask({ id: 't3', created_at: '2026-03-01T00:00:00Z' });

    const rows = await listFixHistoryRows(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('t3'); // newest first
    expect(rows[1].id).toBe('t2');
  });

  it('getLegacyScanResultById returns null for a missing id', () => {
    expect(getLegacyScanResultById(99999)).toBeFalsy();
  });

  it('getLegacyScanResultById reads a row from scan_results', () => {
    getDatabase().prepare(`
      INSERT INTO scan_results (id, siteId, scanType, result, status)
      VALUES (?, NULL, ?, ?, ?)
    `).run(42, 'web', 'clean', 'done');
    const row = getLegacyScanResultById(42);
    expect(row).not.toBeNull();
    expect(row?.scanType).toBe('web');
  });
});
