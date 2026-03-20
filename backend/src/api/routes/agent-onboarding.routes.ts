import { Router, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { requirePlanQuota } from '../../middleware/plan.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import agentAuthService from '../../security/agent-auth.service';
import auditLogger from '../../security/audit-logger.service';
import logger from '../../utils/logger';
import {
  getAgentOnboardingCodeByHash,
  getLatestAgentRegistration,
  listAgentOnboardingCodes,
  saveAgentCredentialAudit,
  saveAgentOnboardingCode
} from '../../modules/agent-onboarding/agent-onboarding.repository';

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

function mirrorLatestAgentRegistration(agentId: string): void {
  const row = getLatestAgentRegistration(agentId);
  if (row) {
    void require('../../services/postgres-shadow-store.service').postgresShadowStoreService.upsert('agent_registrations', row);
  }
}

router.post('/codes', authenticate, requireRole('admin', 'tenant'), requirePlanQuota('agent'), async (req: AuthenticatedRequest, res: Response) => {
  try {
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

    await saveAgentOnboardingCode({
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

    await saveAgentCredentialAudit({
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

    return sendSuccess(res, {
      onboardingCode: rawCode,
      expiresAt,
      maxUses
    }, undefined, 201);
  } catch (error: any) {
    logger.error('Failed to create onboarding code', { error: error.message });
    return sendError(res, 500, {
      code: 'ONBOARDING_CODE_CREATE_FAILED',
      message: 'backend.failed_to_create_onboarding_code'
    });
  }
});

router.get('/codes', authenticate, requireRole('admin', 'tenant'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = await listAgentOnboardingCodes(req.user!.tenantId || null, req.user!.role, status, limit);

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

    return sendSuccess(res, normalized, {
      legacy: {
        count: normalized.length
      }
    });
  } catch (error: any) {
    logger.error('Failed to list onboarding codes', { error: error.message });
    return sendError(res, 500, {
      code: 'ONBOARDING_CODE_LIST_FAILED',
      message: 'backend.failed_to_list_onboarding_codes'
    });
  }
});

router.post('/exchange', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const onboardingCode = String(req.body?.onboardingCode || '').trim();
    const hostname = String(req.body?.hostname || '').trim();
    const platform = String(req.body?.platform || '').trim();
    const mac = typeof req.body?.mac === 'string' ? req.body.mac : undefined;

    if (!onboardingCode || !hostname || !platform) {
      return sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'backend.onboardingcode_hostname_and_platform_are_required'
      });
    }

    const row = await getAgentOnboardingCodeByHash(hashCode(onboardingCode));

    if (!row) {
      return sendError(res, 404, {
        code: 'ONBOARDING_CODE_NOT_FOUND',
        message: 'backend.onboarding_code_not_found'
      });
    }
    if (row.status !== 'active') {
      return sendError(res, 409, {
        code: 'ONBOARDING_CODE_INACTIVE',
        message: 'backend.onboarding_code_is_not_active'
      });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await saveAgentOnboardingCode({ ...row, status: 'expired' });
      return sendError(res, 410, {
        code: 'ONBOARDING_CODE_EXPIRED',
        message: 'backend.onboarding_code_expired'
      });
    }
    if (Number(row.used_count || 0) >= Number(row.max_uses || 1)) {
      await saveAgentOnboardingCode({ ...row, status: 'used' });
      return sendError(res, 409, {
        code: 'ONBOARDING_CODE_USED',
        message: 'backend.onboarding_code_already_used'
      });
    }
    if (row.expected_hostname && row.expected_hostname !== hostname) {
      return sendError(res, 409, {
        code: 'ONBOARDING_POLICY_MISMATCH',
        message: 'backend.hostname_does_not_match_onboarding_policy'
      });
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
    await saveAgentOnboardingCode({
      ...row,
      used_count: nextUsedCount,
      used_at: usedAt,
      used_by_agent_id: registration.agentId,
      status
    });

    await saveAgentCredentialAudit({
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

    return sendSuccess(res, {
      agentId: registration.agentId,
      apiKey: registration.apiKey,
      secretKey: registration.secretKey,
      wsUrl: process.env.AGENT_WS_URL || process.env.PUBLIC_WS_URL || process.env.PUBLIC_BASE_URL || derivedWsUrl,
      issuedAt: usedAt
    }, undefined, 201);
  } catch (error: any) {
    logger.error('Failed to exchange onboarding code', { error: error.message });
    return sendError(res, 500, {
      code: 'ONBOARDING_EXCHANGE_FAILED',
      message: 'backend.failed_to_exchange_onboarding_code'
    });
  }
});

router.get('/agents', authenticate, requireRole('admin', 'tenant'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = agentAuthService.listAgents()
      .filter((agent) => req.user?.role === 'admin' || agent.tenantId === req.user?.tenantId);
    return sendSuccess(res, agents, {
      legacy: {
        agents,
        count: agents.length
      }
    });
  } catch (error: any) {
    logger.error('Failed to list registered agents', { error: error.message });
    return sendError(res, 500, {
      code: 'REGISTERED_AGENT_LIST_FAILED',
      message: 'backend.failed_to_list_registered_agents'
    });
  }
});

router.post('/revoke/:agentId', authenticate, requireRole('admin', 'tenant'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const agentId = req.params.agentId;
    const ok = agentAuthService.revokeAgent(agentId);
    if (!ok) {
      return sendError(res, 404, {
        code: 'AGENT_NOT_FOUND',
        message: 'backend.agent_not_found'
      });
    }

    mirrorLatestAgentRegistration(agentId);
    await saveAgentCredentialAudit({
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

    return sendSuccess(res, { agentId, revoked: true }, {
      legacy: {
        actionId: agentId
      }
    });
  } catch (error: any) {
    logger.error('Failed to revoke agent credential', { error: error.message });
    return sendError(res, 500, {
      code: 'AGENT_REVOKE_FAILED',
      message: 'backend.failed_to_revoke_agent_credential'
    });
  }
});

export default router;
