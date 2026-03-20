import { getDatabase } from '../../config/database';
import { getDatabaseMode, isSqliteFallbackEnabled } from '../../config/platform-runtime';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface AgentOnboardingCodeRow {
  id: string;
  code_hash: string;
  tenant_id?: string | null;
  created_by: string;
  max_uses: number;
  used_count: number;
  status: string;
  expected_hostname?: string | null;
  expected_tags_json?: string | null;
  expires_at: string;
  created_at: string;
  used_at?: string | null;
  used_by_agent_id?: string | null;
}

export interface AgentCredentialAuditRow {
  id: string;
  agent_id?: string | null;
  action: string;
  operator_id?: string | null;
  reason?: string | null;
  metadata_json?: string | null;
  created_at: string;
}

function shouldWriteSqliteFallback(): boolean {
  return getDatabaseMode() === 'sqlite' || isSqliteFallbackEnabled();
}

export async function saveAgentOnboardingCode(row: AgentOnboardingCodeRow): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      INSERT INTO agent_onboarding_codes
      (id, code_hash, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id)
      DO UPDATE SET
        code_hash = EXCLUDED.code_hash,
        tenant_id = EXCLUDED.tenant_id,
        created_by = EXCLUDED.created_by,
        max_uses = EXCLUDED.max_uses,
        used_count = EXCLUDED.used_count,
        status = EXCLUDED.status,
        expected_hostname = EXCLUDED.expected_hostname,
        expected_tags_json = EXCLUDED.expected_tags_json,
        expires_at = EXCLUDED.expires_at,
        created_at = EXCLUDED.created_at,
        used_at = EXCLUDED.used_at,
        used_by_agent_id = EXCLUDED.used_by_agent_id
    `, [
      row.id,
      row.code_hash,
      row.tenant_id || null,
      row.created_by,
      row.max_uses,
      row.used_count,
      row.status,
      row.expected_hostname || null,
      row.expected_tags_json || null,
      row.expires_at,
      row.created_at,
      row.used_at || null,
      row.used_by_agent_id || null
    ]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`
      INSERT OR REPLACE INTO agent_onboarding_codes
      (id, code_hash, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.code_hash,
      row.tenant_id || null,
      row.created_by,
      row.max_uses,
      row.used_count,
      row.status,
      row.expected_hostname || null,
      row.expected_tags_json || null,
      row.expires_at,
      row.created_at,
      row.used_at || null,
      row.used_by_agent_id || null
    );
  }

  if (getDatabaseMode() !== 'postgres') {
    void postgresShadowStoreService.upsert('agent_onboarding_codes', row as unknown as Record<string, unknown>);
  }
}

export async function saveAgentCredentialAudit(row: AgentCredentialAuditRow): Promise<void> {
  if (getDatabaseMode() === 'postgres') {
    await postgresShadowStoreService.execute(`
      INSERT INTO agent_credentials_audit
      (id, agent_id, action, operator_id, reason, metadata_json, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id)
      DO UPDATE SET
        agent_id = EXCLUDED.agent_id,
        action = EXCLUDED.action,
        operator_id = EXCLUDED.operator_id,
        reason = EXCLUDED.reason,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at
    `, [
      row.id,
      row.agent_id || null,
      row.action,
      row.operator_id || null,
      row.reason || null,
      row.metadata_json || '{}',
      row.created_at
    ]);
  }

  if (shouldWriteSqliteFallback()) {
    getDatabase().prepare(`
      INSERT OR REPLACE INTO agent_credentials_audit
      (id, agent_id, action, operator_id, reason, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.agent_id || null,
      row.action,
      row.operator_id || null,
      row.reason || null,
      row.metadata_json || '{}',
      row.created_at
    );
  }

  if (getDatabaseMode() !== 'postgres') {
    void postgresShadowStoreService.upsert('agent_credentials_audit', row as unknown as Record<string, unknown>);
  }
}

export async function getAgentOnboardingCodeByHash(codeHash: string): Promise<AgentOnboardingCodeRow | null> {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<AgentOnboardingCodeRow>(`
      SELECT *
      FROM agent_onboarding_codes
      WHERE code_hash = $1
      LIMIT 1
    `, [codeHash]);
  }

  return getDatabase().prepare(`
    SELECT *
    FROM agent_onboarding_codes
    WHERE code_hash = ?
    LIMIT 1
  `).get(codeHash) as AgentOnboardingCodeRow | null;
}

export async function listAgentOnboardingCodes(
  tenantId: string | null,
  role: string,
  status: string,
  limit: number
): Promise<AgentOnboardingCodeRow[]> {
  if (postgresShadowStoreService.canServeReads()) {
    if (status && ['active', 'used', 'expired', 'revoked'].includes(status)) {
      return await postgresShadowStoreService.queryAll<AgentOnboardingCodeRow>(`
        SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
        FROM agent_onboarding_codes
        WHERE status = $1 AND (tenant_id = $2 OR $3 = 'admin')
        ORDER BY created_at DESC
        LIMIT $4
      `, [status, tenantId, role, limit]);
    }

    return await postgresShadowStoreService.queryAll<AgentOnboardingCodeRow>(`
      SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
      FROM agent_onboarding_codes
      WHERE tenant_id = $1 OR $2 = 'admin'
      ORDER BY created_at DESC
      LIMIT $3
    `, [tenantId, role, limit]);
  }

  const db = getDatabase();
  if (status && ['active', 'used', 'expired', 'revoked'].includes(status)) {
    return db.prepare(`
      SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
      FROM agent_onboarding_codes
      WHERE status = ? AND (tenant_id = ? OR ? = 'admin')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(status, tenantId, role, limit) as AgentOnboardingCodeRow[];
  }

  return db.prepare(`
    SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
    FROM agent_onboarding_codes
    WHERE tenant_id = ? OR ? = 'admin'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(tenantId, role, limit) as AgentOnboardingCodeRow[];
}

export function getLatestAgentRegistration(agentId: string): Record<string, unknown> | null {
  return getDatabase().prepare(`
    SELECT *
    FROM agent_registrations
    WHERE agent_id = ?
    LIMIT 1
  `).get(agentId) as Record<string, unknown> | null;
}
