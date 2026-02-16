import { Router, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import agentAuthService from '../../security/agent-auth.service';
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

router.post('/codes', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
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

    const db = getDatabase();
    db.prepare(`
      INSERT INTO agent_onboarding_codes
      (id, code_hash, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?)
    `).run(
      id,
      codeHash,
      tenantId,
      req.user!.userId,
      maxUses,
      expectedHostname,
      JSON.stringify(expectedTags),
      expiresAt,
      createdAt
    );

    db.prepare(`
      INSERT INTO agent_credentials_audit
      (id, agent_id, action, operator_id, reason, metadata_json, created_at)
      VALUES (?, NULL, 'onboarding_code_issued', ?, NULL, ?, ?)
    `).run(
      uuidv4(),
      req.user!.userId,
      JSON.stringify({ onboardingCodeId: id, ttlMinutes, maxUses, expectedHostname }),
      createdAt
    );

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
    return res.status(500).json({ success: false, error: 'Failed to create onboarding code' });
  }
});

router.get('/codes', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const db = getDatabase();

    let rows: any[] = [];
    if (status && ['active', 'used', 'expired', 'revoked'].includes(status)) {
      rows = db.prepare(`
        SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
        FROM agent_onboarding_codes
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(status, limit) as any[];
    } else {
      rows = db.prepare(`
        SELECT id, tenant_id, created_by, max_uses, used_count, status, expected_hostname, expected_tags_json, expires_at, created_at, used_at, used_by_agent_id
        FROM agent_onboarding_codes
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as any[];
    }

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
    return res.status(500).json({ success: false, error: 'Failed to list onboarding codes' });
  }
});

router.post('/exchange', (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const onboardingCode = String(req.body?.onboardingCode || '').trim();
    const hostname = String(req.body?.hostname || '').trim();
    const platform = String(req.body?.platform || '').trim();
    const mac = typeof req.body?.mac === 'string' ? req.body.mac : undefined;

    if (!onboardingCode || !hostname || !platform) {
      return res.status(400).json({ success: false, error: 'onboardingCode, hostname and platform are required' });
    }

    const db = getDatabase();
    const row = db.prepare(`
      SELECT *
      FROM agent_onboarding_codes
      WHERE code_hash = ?
      LIMIT 1
    `).get(hashCode(onboardingCode)) as any;

    if (!row) {
      return res.status(404).json({ success: false, error: 'Onboarding code not found' });
    }
    if (row.status !== 'active') {
      return res.status(409).json({ success: false, error: 'Onboarding code is not active' });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare(`UPDATE agent_onboarding_codes SET status = 'expired' WHERE id = ?`).run(row.id);
      return res.status(410).json({ success: false, error: 'Onboarding code expired' });
    }
    if (Number(row.used_count || 0) >= Number(row.max_uses || 1)) {
      db.prepare(`UPDATE agent_onboarding_codes SET status = 'used' WHERE id = ?`).run(row.id);
      return res.status(409).json({ success: false, error: 'Onboarding code already used' });
    }
    if (row.expected_hostname && row.expected_hostname !== hostname) {
      return res.status(409).json({ success: false, error: 'Hostname does not match onboarding policy' });
    }

    const registration = agentAuthService.registerAgent({
      hostname,
      platform,
      mac,
      tenantId: row.tenant_id || undefined
    });

    const usedAt = nowIso();
    const nextUsedCount = Number(row.used_count || 0) + 1;
    const status = nextUsedCount >= Number(row.max_uses || 1) ? 'used' : 'active';
    db.prepare(`
      UPDATE agent_onboarding_codes
      SET used_count = ?, used_at = ?, used_by_agent_id = ?, status = ?
      WHERE id = ?
    `).run(nextUsedCount, usedAt, registration.agentId, status, row.id);

    db.prepare(`
      INSERT INTO agent_credentials_audit
      (id, agent_id, action, operator_id, reason, metadata_json, created_at)
      VALUES (?, ?, 'issued', NULL, 'onboarding_exchange', ?, ?)
    `).run(
      uuidv4(),
      registration.agentId,
      JSON.stringify({ onboardingCodeId: row.id, hostname, platform }),
      usedAt
    );

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
    return res.status(500).json({ success: false, error: 'Failed to exchange onboarding code' });
  }
});

router.get('/agents', authenticate, requireRole('admin'), (_req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = agentAuthService.listAgents();
    return res.json({ success: true, data: agents });
  } catch (error: any) {
    logger.error('Failed to list registered agents', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to list registered agents' });
  }
});

router.post('/revoke/:agentId', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    ensureSchema();
    const agentId = req.params.agentId;
    const ok = agentAuthService.revokeAgent(agentId);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    getDatabase().prepare(`
      INSERT INTO agent_credentials_audit
      (id, agent_id, action, operator_id, reason, metadata_json, created_at)
      VALUES (?, ?, 'revoked', ?, ?, ?, ?)
    `).run(
      uuidv4(),
      agentId,
      req.user!.userId,
      String(req.body?.reason || 'manual_revoke'),
      JSON.stringify({ by: req.user!.email }),
      nowIso()
    );

    return res.json({ success: true, data: { agentId, revoked: true } });
  } catch (error: any) {
    logger.error('Failed to revoke agent credential', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to revoke agent credential' });
  }
});

export default router;
