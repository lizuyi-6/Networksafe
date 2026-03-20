import { getDatabase } from '../../config/database';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface DeploymentProfileRow {
  id: string;
  tenant_id: string;
  site_id: string | null;
  server_type: string;
  name: string | null;
  profile_json: string;
  config_text: string;
  env_snippet: string;
  checksum: string;
  version: number;
  created_by: string;
  created_at: string;
}

let schemaReady = false;

export function ensureDeploymentProfileSchema(): void {
  if (schemaReady) {
    return;
  }

  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      site_id TEXT,
      server_type TEXT NOT NULL,
      name TEXT,
      profile_json TEXT NOT NULL,
      config_text TEXT NOT NULL,
      env_snippet TEXT NOT NULL,
      checksum TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  schemaReady = true;
}

export async function getDeploymentProfile(id: string, tenantId: string): Promise<DeploymentProfileRow | null> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<DeploymentProfileRow>(`
      SELECT *
      FROM deployment_profiles
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `, [id, tenantId]);
  }

  return getDatabase().prepare(`
    SELECT *
    FROM deployment_profiles
    WHERE id = ? AND tenant_id = ?
  `).get(id, tenantId) as DeploymentProfileRow | null;
}

export async function listDeploymentProfiles(
  tenantId: string,
  siteId: string | null,
  limit: number
): Promise<DeploymentProfileRow[]> {
  if (postgresShadowStoreService.canServeReads()) {
    if (siteId) {
      return await postgresShadowStoreService.queryAll<DeploymentProfileRow>(`
        SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
        FROM deployment_profiles
        WHERE tenant_id = $1 AND site_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `, [tenantId, siteId, limit]);
    }

    return await postgresShadowStoreService.queryAll<DeploymentProfileRow>(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [tenantId, limit]);
  }

  const db = getDatabase();
  if (siteId) {
    return db.prepare(`
      SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
      FROM deployment_profiles
      WHERE tenant_id = ? AND site_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, siteId, limit) as DeploymentProfileRow[];
  }

  return db.prepare(`
    SELECT id, site_id, server_type, name, checksum, version, created_by, created_at
    FROM deployment_profiles
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(tenantId, limit) as DeploymentProfileRow[];
}

export async function getNextDeploymentProfileVersion(
  tenantId: string,
  serverType: string,
  siteId: string | null
): Promise<number> {
  if (postgresShadowStoreService.canServeReads()) {
    const row = await postgresShadowStoreService.queryOne<{ maxVersion?: number }>(`
      SELECT MAX(version) AS "maxVersion"
      FROM deployment_profiles
      WHERE tenant_id = $1 AND server_type = $2 AND ((site_id = $3) OR ($3 IS NULL AND site_id IS NULL))
    `, [tenantId, serverType, siteId]);
    return (Number(row?.maxVersion || 0) || 0) + 1;
  }

  const row = getDatabase().prepare(`
    SELECT MAX(version) AS maxVersion
    FROM deployment_profiles
    WHERE tenant_id = ? AND server_type = ? AND (site_id = ? OR (? IS NULL AND site_id IS NULL))
  `).get(tenantId, serverType, siteId, siteId) as { maxVersion?: number } | undefined;
  return (Number(row?.maxVersion || 0) || 0) + 1;
}

export async function saveDeploymentProfile(row: DeploymentProfileRow): Promise<void> {
  if (postgresShadowStoreService.canServeReads()) {
    await postgresShadowStoreService.execute(`
      INSERT INTO deployment_profiles
      (id, tenant_id, site_id, server_type, name, profile_json, config_text, env_snippet, checksum, version, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id)
      DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        site_id = EXCLUDED.site_id,
        server_type = EXCLUDED.server_type,
        name = EXCLUDED.name,
        profile_json = EXCLUDED.profile_json,
        config_text = EXCLUDED.config_text,
        env_snippet = EXCLUDED.env_snippet,
        checksum = EXCLUDED.checksum,
        version = EXCLUDED.version,
        created_by = EXCLUDED.created_by,
        created_at = EXCLUDED.created_at
    `, [
      row.id,
      row.tenant_id,
      row.site_id,
      row.server_type,
      row.name,
      row.profile_json,
      row.config_text,
      row.env_snippet,
      row.checksum,
      row.version,
      row.created_by,
      row.created_at
    ]);
  }

  getDatabase().prepare(`
    INSERT OR REPLACE INTO deployment_profiles
    (id, tenant_id, site_id, server_type, name, profile_json, config_text, env_snippet, checksum, version, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.tenant_id,
    row.site_id,
    row.server_type,
    row.name,
    row.profile_json,
    row.config_text,
    row.env_snippet,
    row.checksum,
    row.version,
    row.created_by,
    row.created_at
  );

  if (!postgresShadowStoreService.canServeReads()) {
    void postgresShadowStoreService.upsert('deployment_profiles', { ...row });
  }
}
