import { DatabaseManager, getDatabase } from '../../config/database';
import { getDatabaseMode, isSqliteFallbackEnabled } from '../../config/platform-runtime';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface SiteRow {
  id: number;
  domain: string;
  target: string;
  sslEnabled: number | boolean;
  antiBotEnabled?: number | boolean;
  rateLimitEnabled?: number | boolean;
  rateLimitRequests?: number | null;
  concurrencyEnabled?: number | boolean;
  concurrencyMax?: number | null;
  tenant_id?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

let injectedDb: DatabaseManager | null = null;

function getDb(): DatabaseManager {
  return injectedDb || getDatabase();
}

function shouldWriteSqliteFallback(): boolean {
  return getDatabaseMode() === 'sqlite' || isSqliteFallbackEnabled();
}

export function setSiteRepositoryDatabase(db: DatabaseManager | null): void {
  injectedDb = db;
}

export async function listSitesForUser(role: string, tenantId?: string): Promise<SiteRow[]> {
  if (role === 'admin' && postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryAll<SiteRow>(`
      SELECT *
      FROM sites
      ORDER BY "createdAt" DESC
    `);
  }

  if (role !== 'admin' && tenantId && postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryAll<SiteRow>(`
      SELECT *
      FROM sites
      WHERE tenant_id = $1
      ORDER BY "createdAt" DESC
    `, [tenantId]);
  }

  const db = getDb();
  if (role === 'admin') {
    return db.prepare('SELECT * FROM sites ORDER BY createdAt DESC').all() as SiteRow[];
  }

  return db.prepare('SELECT * FROM sites WHERE tenant_id = ? ORDER BY createdAt DESC').all(tenantId) as SiteRow[];
}

export async function getSiteForUser(id: string, role: string, tenantId?: string): Promise<SiteRow | null> {
  if (role === 'admin' && postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<SiteRow>(`
      SELECT *
      FROM sites
      WHERE id = $1
      LIMIT 1
    `, [id]);
  }

  if (role !== 'admin' && tenantId && postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<SiteRow>(`
      SELECT *
      FROM sites
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `, [id, tenantId]);
  }

  const db = getDb();
  if (role === 'admin') {
    return db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as SiteRow | null;
  }

  return db.prepare('SELECT * FROM sites WHERE id = ? AND tenant_id = ?').get(id, tenantId) as SiteRow | null;
}

export async function createSite(row: Omit<SiteRow, 'id'>): Promise<number | null> {
  let authoritativeId: number | null = null;

  if (getDatabaseMode() === 'postgres') {
    const inserted = await postgresShadowStoreService.queryOne<{ id: number }>(`
      INSERT INTO sites (
        domain, target, "sslEnabled", tenant_id,
        "antiBotEnabled", "rateLimitEnabled", "concurrencyEnabled",
        "rateLimitRequests", "concurrencyMax", "createdAt", "updatedAt"
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      row.domain,
      row.target,
      Number(Boolean(row.sslEnabled)),
      row.tenant_id || null,
      Number(Boolean(row.antiBotEnabled)),
      Number(Boolean(row.rateLimitEnabled)),
      Number(Boolean(row.concurrencyEnabled)),
      row.rateLimitRequests || 60,
      row.concurrencyMax || 5,
      row.createdAt || new Date().toISOString(),
      row.updatedAt || new Date().toISOString()
    ]);
    // Postgres is the source of truth — its id is what we return and what the
    // SQLite fallback row must carry, so GET/PUT/DELETE (which read Postgres)
    // resolve the same site the POST just created.
    authoritativeId = inserted?.id ?? null;
    if (!shouldWriteSqliteFallback()) {
      return authoritativeId;
    }
  }

  if (shouldWriteSqliteFallback()) {
    const db = getDb();
    if (getDatabaseMode() === 'postgres' && authoritativeId !== null) {
      // Write the fallback row with the SAME id Postgres assigned, so the two
      // stores agree. (Previously the SQLite AUTOINCREMENT id was returned and
      // the Postgres id was lost — a later GET by id 404'd if sequences differed.)
      db.prepare(`
        INSERT OR REPLACE INTO sites (
          id, domain, target, sslEnabled, tenant_id,
          antiBotEnabled, rateLimitEnabled, concurrencyEnabled,
          rateLimitRequests, concurrencyMax, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        authoritativeId,
        row.domain,
        row.target,
        row.sslEnabled ? 1 : 0,
        row.tenant_id || null,
        row.antiBotEnabled ? 1 : 0,
        row.rateLimitEnabled ? 1 : 0,
        row.concurrencyEnabled ? 1 : 0,
        row.rateLimitRequests || 60,
        row.concurrencyMax || 5,
        row.createdAt || new Date().toISOString(),
        row.updatedAt || new Date().toISOString()
      );
      return authoritativeId;
    }

    // SQLite is the source of truth (mode === sqlite, or postgres-reads-from-sqlite).
    db.prepare(`
      INSERT INTO sites (
        domain, target, sslEnabled, tenant_id,
        antiBotEnabled, rateLimitEnabled, concurrencyEnabled,
        rateLimitRequests, concurrencyMax
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.domain,
      row.target,
      row.sslEnabled ? 1 : 0,
      row.tenant_id || null,
      row.antiBotEnabled ? 1 : 0,
      row.rateLimitEnabled ? 1 : 0,
      row.concurrencyEnabled ? 1 : 0,
      row.rateLimitRequests || 60,
      row.concurrencyMax || 5
    );

    const created = db.prepare('SELECT id FROM sites WHERE domain = ?').get(row.domain) as { id: number } | null;

    if (getDatabaseMode() !== 'postgres' && created) {
      void postgresShadowStoreService.upsert('sites', {
        id: created.id,
        ...row
      });
    }

    return created?.id ?? null;
  }

  return null;
}

export async function updateSite(
  id: string,
  updates: {
    domain?: string | null;
    target?: string | null;
    sslEnabled?: boolean | null;
    antiBotEnabled?: boolean | null;
    rateLimitEnabled?: boolean | null;
    concurrencyEnabled?: boolean | null;
    rateLimitRequests?: number | null;
    concurrencyMax?: number | null;
  }
): Promise<void> {
  const updatedAt = new Date().toISOString();

  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      UPDATE sites SET
        domain = COALESCE($1, domain),
        target = COALESCE($2, target),
        "sslEnabled" = COALESCE($3, "sslEnabled"),
        "antiBotEnabled" = COALESCE($4, "antiBotEnabled"),
        "rateLimitEnabled" = COALESCE($5, "rateLimitEnabled"),
        "concurrencyEnabled" = COALESCE($6, "concurrencyEnabled"),
        "rateLimitRequests" = COALESCE($7, "rateLimitRequests"),
        "concurrencyMax" = COALESCE($8, "concurrencyMax"),
        "updatedAt" = $9
      WHERE id = $10
    `, [
      updates.domain || null,
      updates.target || null,
      updates.sslEnabled === undefined ? null : Number(Boolean(updates.sslEnabled)),
      updates.antiBotEnabled === undefined ? null : Number(Boolean(updates.antiBotEnabled)),
      updates.rateLimitEnabled === undefined ? null : Number(Boolean(updates.rateLimitEnabled)),
      updates.concurrencyEnabled === undefined ? null : Number(Boolean(updates.concurrencyEnabled)),
      updates.rateLimitRequests ?? null,
      updates.concurrencyMax ?? null,
      updatedAt,
      id
    ]);
  }

  if (shouldWriteSqliteFallback()) {
    getDb().prepare(`
      UPDATE sites SET
        domain = COALESCE(?, domain),
        target = COALESCE(?, target),
        sslEnabled = COALESCE(?, sslEnabled),
        antiBotEnabled = COALESCE(?, antiBotEnabled),
        rateLimitEnabled = COALESCE(?, rateLimitEnabled),
        concurrencyEnabled = COALESCE(?, concurrencyEnabled),
        rateLimitRequests = COALESCE(?, rateLimitRequests),
        concurrencyMax = COALESCE(?, concurrencyMax),
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      updates.domain || null,
      updates.target || null,
      updates.sslEnabled === undefined ? null : (updates.sslEnabled ? 1 : 0),
      updates.antiBotEnabled === undefined ? null : (updates.antiBotEnabled ? 1 : 0),
      updates.rateLimitEnabled === undefined ? null : (updates.rateLimitEnabled ? 1 : 0),
      updates.concurrencyEnabled === undefined ? null : (updates.concurrencyEnabled ? 1 : 0),
      updates.rateLimitRequests ?? null,
      updates.concurrencyMax ?? null,
      id
    );
  }
}

export async function deleteSiteForUser(id: string, role: string, tenantId?: string): Promise<number> {
  if (getDatabaseMode() === 'postgres') {
    // Postgres is the source of truth; the delete count comes from it.
    const deleted = role === 'admin'
      ? await postgresShadowStoreService.execute('DELETE FROM sites WHERE id = $1', [id])
      : await postgresShadowStoreService.execute('DELETE FROM sites WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (shouldWriteSqliteFallback()) {
      // Mirror the delete into SQLite WITHOUT consulting getSiteForUser():
      // getSiteForUser() may read from Postgres, which we just deleted from, so
      // it would return null and wrongly skip the SQLite fallback delete —
      // leaving a stale row in the fallback DB.
      const db = getDb();
      if (role === 'admin') {
        db.prepare('DELETE FROM sites WHERE id = ?').run(id);
      } else {
        db.prepare('DELETE FROM sites WHERE id = ? AND tenant_id = ?').run(id, tenantId);
      }
    }
    return deleted;
  }

  // SQLite-only mode. Avoid relying on .run().changes — its return shape differs
  // between better-sqlite3 ({ changes }) and sql.js (no changes field), so a
  // prior existence check (already tenant-scoped via getSiteForUser) reports an
  // accurate count that is consistent across both drivers.
  const existing = await getSiteForUser(id, role, tenantId);
  if (!existing) {
    return 0;
  }

  const db = getDb();
  if (role === 'admin') {
    db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  } else {
    db.prepare('DELETE FROM sites WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  }
  return 1;
}
