import { getDatabase } from '../../config/database';
import { getDatabaseMode, isSqliteFallbackEnabled } from '../../config/platform-runtime';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface AdminApiKeyRow {
  id: string;
  name: string;
  key_hash?: string;
  user_id?: string | null;
  tenant_id?: string | null;
  permissions?: string | null;
  last_used?: string | null;
  expires_at?: string | null;
  created_at: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  role: string;
  plan?: string | null;
  tenant_id?: string | null;
  status?: string | null;
  last_login?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function shouldWriteSqliteFallback(): boolean {
  return getDatabaseMode() === 'sqlite' || isSqliteFallbackEnabled();
}

export async function listAdminApiKeys(): Promise<AdminApiKeyRow[]> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryAll<AdminApiKeyRow>(`
      SELECT id, name, created_at, last_used
      FROM api_keys
      ORDER BY created_at DESC
      LIMIT 200
    `);
  }

  return getDatabase().prepare(`
    SELECT id, name, created_at, last_used
    FROM api_keys
    ORDER BY created_at DESC
    LIMIT 200
  `).all() as AdminApiKeyRow[];
}

export async function saveAdminApiKey(row: AdminApiKeyRow): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      INSERT INTO api_keys (id, name, key_hash, user_id, tenant_id, permissions, last_used, expires_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        key_hash = EXCLUDED.key_hash,
        user_id = EXCLUDED.user_id,
        tenant_id = EXCLUDED.tenant_id,
        permissions = EXCLUDED.permissions,
        last_used = EXCLUDED.last_used,
        expires_at = EXCLUDED.expires_at,
        created_at = EXCLUDED.created_at
    `, [
      row.id,
      row.name,
      row.key_hash || null,
      row.user_id || null,
      row.tenant_id || null,
      row.permissions || null,
      row.last_used || null,
      row.expires_at || null,
      row.created_at
    ]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`
      INSERT OR REPLACE INTO api_keys (id, name, key_hash, user_id, tenant_id, permissions, last_used, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.name,
      row.key_hash || null,
      row.user_id || null,
      row.tenant_id || null,
      row.permissions || null,
      row.last_used || null,
      row.expires_at || null,
      row.created_at
    );
  }

  if (getDatabaseMode() !== 'postgres') {
    void postgresShadowStoreService.upsert('api_keys', row as unknown as Record<string, unknown>);
  }
}

export async function deleteAdminApiKey(id: string): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute('DELETE FROM api_keys WHERE id = $1', [id]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  }
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryAll<AdminUserRow>(`
      SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
      FROM users
      ORDER BY created_at DESC
    `);
  }

  return getDatabase().prepare(`
    SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
    FROM users
    ORDER BY created_at DESC
  `).all() as AdminUserRow[];
}

export async function getAdminUserById(id: string): Promise<AdminUserRow | null> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<AdminUserRow>(`
      SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `, [id]);
  }

  return getDatabase().prepare(`
    SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at, updated_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `).get(id) as AdminUserRow | null;
}

export async function updateAdminUserField(
  id: string,
  field: 'plan' | 'role' | 'status',
  value: string
): Promise<void> {
  const updatedAt = new Date().toISOString();

  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      UPDATE users
      SET "${field}" = $1, updated_at = $2
      WHERE id = $3
    `, [value, updatedAt, id]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`UPDATE users SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
  }
}
