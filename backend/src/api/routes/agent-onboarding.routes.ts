import { Router, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { requirePlanQuota } from '../../middleware/plan.middleware';
import { getDatabase } from '../../config/database';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import agentAuthService from '../../security/agent-auth.service';
import auditLogger from '../../security/audit-logger.service';
import logger from '../../utils/logger';

const router = Router();

function nowIso(): string {
  return new Date().toISOString();
}

function hashCode(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function randomCode(): string {
  return `fgob_${crypto.randomBytes(18).toString('base64url')}`;
}

function ensureSchema(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_onboarding_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      tenant_id TEXT,
      created_by TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'used', 'expired', 'revoked')),
      expected_hostname TEXT,
      expected_tags_json TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      used_by_agent_id TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_credentials_audit (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      action TEXT NOT NULL CHECK(action IN ('issued', 'rotated', 'revoked', 'onboarding_code_issued', 'onboarding_code_used')),
      operator_id TEXT,
      reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

async function persistOnboardingCode(row: Record<string, any>): Promise<void> {
  if (postgresShadowStoreService.canServeReads()) {
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
      row.tenant_id,
      row.created_by,
      row.max_uses,
      row.used_count,
      row.status,
      row.expected_hostname,
      row.expected_tags_json,
      row.expires_at,
      row.created_at,
      row.used_at || null,
      row.used_by_agent_id || null
    ]);
  }

  getDatabase().prepare(`
    INSERT OR REPLACE INTO agent_onboarding_codes
    (id, code_hash, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.code_hash,
    row.tenant_id,
    row.created_by,
    row.max_uses,
    row.used_count,
    row.status,
    row.expected_hostname,
    row.expected_tags_json,
    row.expires_at,
    row.created_at,
    row.used_at || null,
    row.used_by_agent_id || null
  );

  if (!postgresShadowStoreService.canServeReads()) {
    void postgresShadowStoreService.upsert('agent_onboarding_codes', row);
  }
}

async function persistCredentialAudit(row: Record<string, any>): Promise<void> {
  if (postgresShadowStoreService.canServeReads()) {
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

  if (!postgresShadowStoreService.canServeReads()) {
    void postgresShadowStoreService.upsert('agent_credentials_audit', row);
  }
}

async function getOnboardingCodeByHash(codeHash: string) {
  if (postgresShadowStoreService.canServeReads()) {
    return await postgresShadowStoreService.queryOne<any>(`
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
  `).get(codeHash) as any;
}

async function listOnboardingCodes(tenantId: string | null, role: string, status: string, limit: number) {
  if (postgresShadowStoreService.canServeReads()) {
    if (status && ['active', 'used', 'expired', 'revoked'].includes(status)) {
      return await postgresShadowStoreService.queryAll<any>(`
        SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
        FROM agent_onboarding_codes
        WHERE status = $1 AND (tenant_id = $2 OR $3 = 'admin')
        ORDER BY created_at DESC
        LIMIT $4
      `, [status, tenantId, role, limit]);
    }
    return await postgresShadowStoreService.queryAll<any>(`
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
    `).all(status, tenantId, role, limit) as any[];
  }
  return db.prepare(`
    SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
    FROM agent_onboarding_codes
    WHERE tenant_id = ? OR ? = 'admin'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(tenantId, role, limit) as any[];
}

function mirrorLatestAgentRegistration(agentId: string): void {
  const row = getDatabase().prepare(`
    SELECT *
    FROM agent_registrations
    WHERE agent_id = ?
    LIMIT 1
  `).get(agentId) as Record<string, unknown> | undefined;
  if (row) {
    void postgresShadowStoreService.upsert('agent_registrations', row);
  }
}

router.post('/codes', authenticate, requireRole('admin', 'tenant'), requirePlanQuota('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const ttlMinutes = Math.max(1, Math.min(Number(req.body?.ttlMinutes || 10), 60 * 24));
    const maxUses = Math.max(1, Math.min(Number(req.body?.maxUses || 1), 5));
    const expectedHostname = typeof req.body?.hostname === 'string' ? req.body.hostname : null;
    const expectedTags = Array.isArray(req.body?.expectedTags) ? req.body.expectedTags.slice(0, 10) : [];
    const tenantId = req.user?.tenantId || null;

    const rawCode = randomCode();
    const codeHash = hashCode(rawCode);
    const id = uuidv4();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    await persistOnboardingCode({
      id,
      code_hash: codeHash,
      tenant_id: tenantId,
      created_by: req.user!.userId,
      max_uses: maxUses,
      used_count: 0,
      status: 'active',
      expected_hostname: expectedHostname,
      expected_tags_json: JSON.stringify(expectedTags),
      expires_at: expiresAt,
      created_at: createdAt,
      used_at: null,
      used_by_agent_id: null
    });

    await persistCredentialAudit({
      id: uuidv4(),
      agent_id: null,
      action: 'onboarding_code_issued',
      operator_id: req.user!.userId,
      reason: null,
      metadata_json: JSON.stringify({ onboardingCodeId: id, ttlMinutes, maxUses, expectedHostname }),
      created_at: createdAt
    });

    await auditLogger.log({
      tenantId: tenantId || undefined,
      eventType: 'agent_onboarding_code_created',
      category: 'agent',
      severity: 'warning',
      actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: req.ip },
      action: 'create_agent_onboarding_code',
      details: { onboardingCodeId: id, ttlMinutes, maxUses, expectedHostname },
      status: 'success'
    });

    return res.status(201).json({
      success: true,
      data: {
        onboardingCode: rawCode,
        expiresAt,
        maxUses
      }
    });
  } catch (error: any) {
    logger.error('Failed to create onboarding code', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_create_onboarding_code' });
  }
});

router.get('/codes', authenticate, requireRole('admin', 'tenant'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = await listOnboardingCodes(req.user!.tenantId || null, req.user!.role, status, limit);

    const now = Date.now();
    const normalized = rows.map((r) => {
      const expired = new Date(String(r.expires_at)).getTime() <= now;
      const effectiveStatus = (r.status === 'active' && expired) ? 'expired' : r.status;
      return {
        id: r.id,
        tenantId: r.tenant_id || null,
        createdBy: r.created_by,
        maxUses: Number(r.max_uses || 1),
        usedCount: Number(r.used_count || 0),
        status: effectiveStatus,
        expectedHostname: r.expected_hostname || null,
        expectedTags: r.expected_tags_json ? JSON.parse(r.expected_tags_json) : [],
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        usedAt: r.used_at || null,
        usedByAgentId: r.used_by_agent_id || null
      };
    });

    return res.json({ success: true, data: normalized });
  } catch (error: any) {
    logger.error('Failed to list onboarding codes', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_list_onboarding_codes' });
  }
});

router.post('/exchange', async (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const onboardingCode = String(req.body?.onboardingCode || '').trim();
    const hostname = String(req.body?.hostname || '').trim();
    const platform = String(req.body?.platform || '').trim();
    const mac = typeof req.body?.mac === 'string' ? req.body.mac : undefined;

    if (!onboardingCode || !hostname || !platform) {
      return res.status(400).json({ success: false, error: 'backend.onboardingcode_hostname_and_platform_are_required' });
    }

    const row = await getOnboardingCodeByHash(hashCode(onboardingCode));

    if (!row) {
      return res.status(404).json({ success: false, error: 'backend.onboarding_code_not_found' });
    }
    if (row.status !== 'active') {
      return res.status(409).json({ success: false, error: 'backend.onboarding_code_is_not_active' });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await persistOnboardingCode({ ...row, status: 'expired' });
      return res.status(410).json({ success: false, error: 'backend.onboarding_code_expired' });
    }
    if (Number(row.used_count || 0) >= Number(row.max_uses || 1)) {
      await persistOnboardingCode({ ...row, status: 'used' });
      return res.status(409).json({ success: false, error: 'backend.onboarding_code_already_used' });
    }
    if (row.expected_hostname && row.expected_hostname !== hostname) {
      return res.status(409).json({ success: false, error: 'backend.hostname_does_not_match_onboarding_policy' });
    }

    const registration = agentAuthService.registerAgent({
      hostname,
      platform,
      mac,
      tenantId: row.tenant_id || undefined
    });
    mirrorLatestAgentRegistration(registration.agentId);

    const usedAt = nowIso();
    const nextUsedCount = Number(row.used_count || 0) + 1;
    const status = nextUsedCount >= Number(row.max_uses || 1) ? 'used' : 'active';
    await persistOnboardingCode({
      ...row,
      used_count: nextUsedCount,
      used_at: usedAt,
      used_by_agent_id: registration.agentId,
      status
    });

    await persistCredentialAudit({
      id: uuidv4(),
      agent_id: registration.agentId,
      action: 'issued',
      operator_id: null,
      reason: 'onboarding_exchange',
      metadata_json: JSON.stringify({ onboardingCodeId: row.id, hostname, platform }),
      created_at: usedAt
    });

    await auditLogger.log({
      tenantId: row.tenant_id || undefined,
      eventType: 'agent_onboarding_exchange_completed',
      category: 'agent',
      severity: 'info',
      actor: { type: 'agent', id: registration.agentId, ip: req.ip },
      action: 'exchange_onboarding_code',
      target: { type: 'agent', id: registration.agentId },
      details: { onboardingCodeId: row.id, hostname, platform },
      status: 'success'
    });

    const host = req.get('host');
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const derivedWsUrl = host
      ? `${protocol === 'https' ? 'wss' : 'ws'}://${host}`
      : '';

    return res.status(201).json({
      success: true,
      data: {
        agentId: registration.agentId,
        apiKey: registration.apiKey,
        secretKey: registration.secretKey,
        wsUrl: process.env.AGENT_WS_URL || process.env.PUBLIC_WS_URL || process.env.PUBLIC_BASE_URL || derivedWsUrl,
        issuedAt: usedAt
      }
    });
  } catch (error: any) {
    logger.error('Failed to exchange onboarding code', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_exchange_onboarding_code' });
  }
});

router.get('/agents', authenticate, requireRole('admin', 'tenant'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = agentAuthService.listAgents();
    return res.json({ success: true, data: agents });
  } catch (error: any) {
    logger.error('Failed to list registered agents', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_list_registered_agents' });
  }
});

router.post('/revoke/:agentId', authenticate, requireRole('admin', 'tenant'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const agentId = req.params.agentId;
    const ok = agentAuthService.revokeAgent(agentId);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'backend.agent_not_found' });
    }

    mirrorLatestAgentRegistration(agentId);
    await persistCredentialAudit({
      id: uuidv4(),
      agent_id: agentId,
      action: 'revoked',
      operator_id: req.user!.userId,
      reason: String(req.body?.reason || 'manual_revoke'),
      metadata_json: JSON.stringify({ by: req.user!.email }),
      created_at: nowIso()
    });

    await auditLogger.log({
      tenantId: req.user?.tenantId || undefined,
      eventType: 'agent_credential_revoked',
      category: 'agent',
      severity: 'warning',
      actor: { type: 'user', id: req.user!.userId, email: req.user?.email, ip: req.ip },
      action: 'revoke_agent_credential',
      target: { type: 'agent', id: agentId },
      details: { reason: String(req.body?.reason || 'manual_revoke') },
      status: 'success'
    });

    return res.json({ success: true, data: { agentId, revoked: true } });
  } catch (error: any) {
    logger.error('Failed to revoke agent credential', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_revoke_agent_credential' });
  }
});

export default router;
