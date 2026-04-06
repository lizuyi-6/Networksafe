import { getDatabase } from '../../config/database';
import { getDatabaseMode, isSqliteFallbackEnabled } from '../../config/platform-runtime';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface AuthUserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'tenant' | 'viewer';
  plan?: 'starter' | 'pro' | 'ultra' | null;
  tenant_id?: string | null;
  status?: string | null;
  last_login?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function shouldWriteSqliteFallback(): boolean {
  return getDatabaseMode() === 'sqlite' || isSqliteFallbackEnabled();
}

export async function findAuthUserByEmail(email: string): Promise<AuthUserRow | null> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<AuthUserRow>(`
      SELECT id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at
      FROM users
      WHERE email = $1
      LIMIT 1
    `, [email]);
  }

  return getDatabase().prepare(`
    SELECT id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at
    FROM users
    WHERE email = ?
    LIMIT 1
  `).get(email) as AuthUserRow | null;
}

export async function findAuthUserById(userId: string): Promise<AuthUserRow | null> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<AuthUserRow>(`
      SELECT id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `, [userId]);
  }

  return getDatabase().prepare(`
    SELECT id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `).get(userId) as AuthUserRow | null;
}

export async function createAuthUser(row: AuthUserRow): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id)
      DO UPDATE SET
        email = EXCLUDED.email,
        username = EXCLUDED.username,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        plan = EXCLUDED.plan,
        tenant_id = EXCLUDED.tenant_id,
        status = EXCLUDED.status,
        last_login = EXCLUDED.last_login,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `, [
      row.id,
      row.email,
      row.username,
      row.password_hash,
      row.role,
      row.plan || 'starter',
      row.tenant_id || null,
      row.status || 'active',
      row.last_login || null,
      row.created_at || new Date().toISOString(),
      row.updated_at || new Date().toISOString()
    ]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`
      INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, status, last_login, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.email,
      row.username,
      row.password_hash,
      row.role,
      row.plan || 'starter',
      row.tenant_id || null,
      row.status || 'active',
      row.last_login || null,
      row.created_at || new Date().toISOString(),
      row.updated_at || new Date().toISOString()
    );
  }
}

export async function touchAuthUserLastLogin(userId: string, lastLogin = new Date().toISOString()): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      UPDATE users
      SET last_login = $1, updated_at = $2
      WHERE id = $3
    `, [lastLogin, lastLogin, userId]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`UPDATE users SET last_login = ?, updated_at = datetime('now') WHERE id = ?`).run(lastLogin, userId);
  }
}

export async function updateAuthUserPassword(userId: string, passwordHash: string): Promise<void> {
  const updatedAt = new Date().toISOString();

  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      UPDATE users
      SET password_hash = $1, updated_at = $2
      WHERE id = $3
    `, [passwordHash, updatedAt, userId]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(passwordHash, userId);
  }
}

export async function recordLoginHistory(params: {
  id: string; userId: string; ipAddress: string; userAgent: string; status: string;
}): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      INSERT INTO login_history (id, user_id, ip_address, user_agent, status, created_at)
      VALUES ($1, $2, $3, $4, $5, datetime('now'))
    `, [params.id, params.userId, params.ipAddress, params.userAgent, params.status]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`
      INSERT INTO login_history (id, user_id, ip_address, user_agent, status, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(params.id, params.userId, params.ipAddress, params.userAgent, params.status);
  }
}
