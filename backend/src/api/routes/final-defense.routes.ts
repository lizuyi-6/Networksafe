import { Router } from 'express';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';
import { authenticate, AuthenticatedRequest, requirePermission } from '../../middleware/auth.middleware';
import { authenticateHelperRequest } from '../../middleware/helper-auth.middleware';
import { finalDefenseService } from '../../services/final-defense.service';
import { FinalDefenseAllowedAction, FinalDefensePolicyStatus } from '../../security/final-defense-policy';
import { isPlatformAdminRole } from '../../security/permissions';

const router = Router();

const VALID_POLICY_STATUSES = new Set<FinalDefensePolicyStatus>(['active', 'staged', 'revoked']);

function tenantOf(req: AuthenticatedRequest): string {
  return resolveRequestTenantContext(req, {
    allowAdminPlatformFallback: isPlatformAdminRole(req.user?.role)
  })?.tenantId || req.user?.tenantId || PLATFORM_TENANT_ID;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAllowedActions(value: unknown): FinalDefenseAllowedAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => item && typeof item === 'object' ? item as Record<string, any> : null)
    .filter(Boolean)
    .map((item) => ({
      commandType: nonEmptyString(item?.commandType),
      scriptPath: nonEmptyString(item?.scriptPath) || undefined,
      maxExecutionMs: Number.isFinite(Number(item?.maxExecutionMs)) ? Number(item?.maxExecutionMs) : undefined,
      requiresInterlockRelease: Boolean(item?.requiresInterlockRelease)
    }))
    .filter((item) => item.commandType);
}

router.get('/status', authenticate, requirePermission('final_defense.read'), async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const statuses = finalDefenseService.listStatus(tenantId);
    const rootResistantGateways = finalDefenseService.listRootResistantGateways(tenantId);
    const policies = finalDefenseService.listPolicies(tenantId);
    const rootResistantActive = rootResistantGateways.some((gateway) => gateway.active);
    const hostCompanionActive = statuses.some((status) => status.active);
    const active = rootResistantActive;
    return sendSuccess(res, {
      active,
      rootResistantActive,
      hostCompanionActive,
      mode: active ? 'active' : statuses.length > 0 || rootResistantGateways.length > 0 ? 'degraded' : 'not_configured',
      statuses,
      rootResistantGateways,
      policies
    });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'FINAL_DEFENSE_STATUS_FAILED',
      message: error?.message || 'backend.final_defense_status_failed'
    });
  }
});

router.post('/status/report', authenticateHelperRequest, async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = nonEmptyString(req.body?.tenantId);
    const companionId = nonEmptyString(req.body?.companionId);
    const gateId = nonEmptyString(req.body?.gateId);

    if (!tenantId || !companionId || !gateId) {
      return sendError(res, 400, {
        code: 'FINAL_DEFENSE_STATUS_REQUIRED_FIELDS',
        message: 'backend.final_defense_status_required_fields'
      });
    }

    const status = finalDefenseService.reportStatus({
      tenantId,
      companionId,
      gateId,
      policyId: nonEmptyString(req.body?.policyId) || undefined,
      policyDigest: nonEmptyString(req.body?.policyDigest) || undefined,
      breakerTarget: nonEmptyString(req.body?.breakerTarget) || undefined,
      interlockState: nonEmptyString(req.body?.interlockState) || undefined,
      externalPowerPresent: Boolean(req.body?.externalPowerPresent),
      secureElementPresent: Boolean(req.body?.secureElementPresent),
      feedbackOk: Boolean(req.body?.feedbackOk),
      lastError: nonEmptyString(req.body?.lastError) || undefined
    });

    return sendSuccess(res, { status }, { legacy: { status } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'FINAL_DEFENSE_STATUS_REPORT_FAILED',
      message: error?.message || 'backend.final_defense_status_report_failed'
    });
  }
});

router.post('/gateways/status/report', authenticateHelperRequest, async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = nonEmptyString(req.body?.tenantId);
    const gatewayId = nonEmptyString(req.body?.gatewayId);

    if (!tenantId || !gatewayId) {
      return sendError(res, 400, {
        code: 'ROOT_GATEWAY_STATUS_REQUIRED_FIELDS',
        message: 'backend.root_gateway_status_required_fields'
      });
    }

    const gateway = finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId,
      policyDigest: nonEmptyString(req.body?.policyDigest) || undefined,
      reportedPolicyDigest: nonEmptyString(req.body?.reportedPolicyDigest) || undefined,
      firmwareDigest: nonEmptyString(req.body?.firmwareDigest) || undefined,
      bridgeState: nonEmptyString(req.body?.bridgeState) || undefined,
      serverPortLink: Boolean(req.body?.serverPortLink),
      lanPortLink: Boolean(req.body?.lanPortLink),
      mgmtPath: nonEmptyString(req.body?.mgmtPath) || undefined,
      secureElementPresent: Boolean(req.body?.secureElementPresent),
      lastAttestationAt: nonEmptyString(req.body?.lastAttestationAt) || undefined,
      isolationReason: nonEmptyString(req.body?.isolationReason) || undefined,
      lastError: nonEmptyString(req.body?.lastError) || undefined
    });

    return sendSuccess(res, { gateway }, { legacy: { gateway } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'ROOT_GATEWAY_STATUS_REPORT_FAILED',
      message: error?.message || 'backend.root_gateway_status_report_failed'
    });
  }
});

router.post('/policies', authenticate, requirePermission('final_defense.manage'), async (req: AuthenticatedRequest, res) => {
  try {
    const companionId = nonEmptyString(req.body?.companionId);
    const gateId = nonEmptyString(req.body?.gateId);
    const breakerTarget = nonEmptyString(req.body?.breakerTarget);
    const allowedActions = parseAllowedActions(req.body?.allowedActions);
    const requestedStatus = nonEmptyString(req.body?.status) as FinalDefensePolicyStatus;
    const status = VALID_POLICY_STATUSES.has(requestedStatus) ? requestedStatus : 'active';

    if (!companionId || !gateId || !breakerTarget || allowedActions.length === 0) {
      return sendError(res, 400, {
        code: 'FINAL_DEFENSE_POLICY_REQUIRED_FIELDS',
        message: 'backend.final_defense_policy_required_fields'
      });
    }

    const policy = finalDefenseService.upsertPolicy({
      tenantId: tenantOf(req),
      companionId,
      gateId,
      allowedActions,
      breakerTarget,
      releaseTtlMs: Number.isFinite(Number(req.body?.releaseTtlMs)) ? Number(req.body?.releaseTtlMs) : undefined,
      status,
      policyId: nonEmptyString(req.body?.policyId) || undefined,
      createdAt: nonEmptyString(req.body?.createdAt) || undefined
    });

    return sendSuccess(res, { policy }, { legacy: { policy } }, 201);
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'FINAL_DEFENSE_POLICY_UPSERT_FAILED',
      message: error?.message || 'backend.final_defense_policy_upsert_failed'
    });
  }
});

router.post('/gateways/actions', authenticate, requirePermission('final_defense.execute'), async (req: AuthenticatedRequest, res) => {
  try {
    const gatewayId = nonEmptyString(req.body?.gatewayId);
    const action = nonEmptyString(req.body?.action);
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    if (!gatewayId || !action) {
      return sendError(res, 400, {
        code: 'ROOT_GATEWAY_ACTION_REQUIRED_FIELDS',
        message: 'backend.root_gateway_action_required_fields'
      });
    }

    const result = await finalDefenseService.requestGatewayAction({
      tenantId: tenantOf(req),
      gatewayId,
      action,
      payload,
      challenge: nonEmptyString(req.body?.challenge) || undefined,
      actorId: req.user?.userId || 'unknown',
      actorEmail: req.user?.email,
      actorIp: req.ip
    });

    if (!result.success) {
      const statusCode = result.reason === 'hardware_gate_unavailable' || result.reason === 'root_gateway_not_configured' ? 503 : 400;
      return sendError(res, statusCode, {
        code: String(result.reason || 'ROOT_GATEWAY_ACTION_FAILED').toUpperCase(),
        message: result.message
      });
    }

    const intent = 'intent' in result ? result.intent : undefined;
    const session = 'session' in result ? result.session : undefined;
    return sendSuccess(res, result, {
      legacy: {
        actionId: intent?.actionId,
        confirmationSessionId: session?.sessionId,
        hardwareGateId: session?.gateId,
        status: intent?.status
      }
    });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'ROOT_GATEWAY_ACTION_FAILED',
      message: error?.message || 'backend.root_gateway_action_failed'
    });
  }
});

router.post('/actions', authenticate, requirePermission('final_defense.execute'), async (req: AuthenticatedRequest, res) => {
  try {
    const companionId = nonEmptyString(req.body?.companionId);
    const commandType = nonEmptyString(req.body?.commandType);
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    if (!companionId || !commandType) {
      return sendError(res, 400, {
        code: 'FINAL_DEFENSE_ACTION_REQUIRED_FIELDS',
        message: 'backend.final_defense_action_required_fields'
      });
    }

    const result = await finalDefenseService.requestAction({
      tenantId: tenantOf(req),
      companionId,
      commandType,
      payload,
      challenge: nonEmptyString(req.body?.challenge) || undefined,
      actorId: req.user?.userId || 'unknown',
      actorEmail: req.user?.email,
      actorIp: req.ip
    });

    if (!result.success) {
      const statusCode = result.reason === 'hardware_gate_unavailable' ? 503 : 400;
      return sendError(res, statusCode, {
        code: String(result.reason || 'FINAL_DEFENSE_ACTION_FAILED').toUpperCase(),
        message: result.message
      });
    }

    const intent = 'intent' in result ? result.intent : undefined;
    const session = 'session' in result ? result.session : undefined;
    return sendSuccess(res, result, {
      legacy: {
        actionId: intent?.actionId,
        confirmationSessionId: session?.sessionId,
        hardwareGateId: session?.gateId,
        status: intent?.status
      }
    });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'FINAL_DEFENSE_ACTION_FAILED',
      message: error?.message || 'backend.final_defense_action_failed'
    });
  }
});

export default router;
