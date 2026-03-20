import { getDatabase } from '../../config/database';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface FixHistoryRow {
  id: string;
  status: string;
  phase?: string | null;
  progress?: number | null;
  created_at?: string | null;
  completed_at?: string | null;
}

export async function listFixHistoryRows(limit: number): Promise<FixHistoryRow[]> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryAll<FixHistoryRow>(`
      SELECT id, status, phase, progress, created_at, completed_at
      FROM scan_runs
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
  }

  return getDatabase().prepare(`
    SELECT id, status, phase, progress, created_at, completed_at
    FROM scan_tasks
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as FixHistoryRow[];
}

export function getLegacyScanResultById(id: number): Record<string, any> | null {
  return getDatabase().prepare('SELECT * FROM scan_results WHERE id = ?').get(id) as Record<string, any> | null;
}
