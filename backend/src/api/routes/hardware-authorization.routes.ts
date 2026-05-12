import { Router } from 'express';
import { authenticate, AuthenticatedRequest, requirePermission, requireRole } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';
import { authenticateHelperRequest } from '../../middleware/helper-auth.middleware';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { deploymentRunService } from '../../services/deployment-run.service';
import { isPlatformAdminRole } from '../../security/permissions';

const router = Router();

function tenantOf(req: AuthenticatedRequest): string {
  return resolveRequestTenantContext(req, {
    allowAdminPlatformFallback: isPlatformAdminRole(req.user?.role)
  })?.tenantId || req.user?.tenantId || PLATFORM_TENANT_ID;
}

router.post('/commands/intents', authenticate, requirePermission('deployment.run.create'), async (req: AuthenticatedRequest, res) => {
  try {
    const scope = String(req.body?.scope || '').trim();
    const targetId = String(req.body?.targetId || '').trim();
    const commandType = String(req.body?.commandType || '').trim();
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    if (!['agent', 'device', 'deployment'].includes(scope)) {
      return sendError(res, 400, { code: 'INVALID_COMMAND_SCOPE', message: 'backend.invalid_command_scope' });
    }
    if (!targetId || !commandType) {
      return sendError(res, 400, { code: 'COMMAND_INTENT_REQUIRED_FIELDS', message: 'backend.command_intent_required_fields' });
    }

    const actor = {
      tenantId: tenantOf(req),
      userId: req.user?.userId || 'unknown',
      email: req.user?.email,
      ip: req.ip
    };

    const result = scope === 'agent'
      ? await commandDispatcherService.dispatchAgentCommand({
          agentId: targetId,
          commandType,
          payload,
          actor
        })
      : await commandDispatcherService.dispatchDeviceCommand({
          deviceId: targetId,
          commandType,
          payload,
          actor
        });

    const statusCode = result.success ? 200 : result.reason === 'hardware_gate_unavailable' ? 503 : 400;
    if (!result.success) {
      return sendError(res, statusCode, {
        code: String(result.reason || 'COMMAND_INTENT_FAILED').toUpperCase(),
        message: result.message
      }, {
        legacy: {
          actionId: result.actionId,
          status: result.status,
          confirmationSessionId: result.confirmationSessionId || null
        }
      });
    }

    return sendSuccess(res, result, {
      legacy: {
        actionId: result.actionId,
        status: result.status,
        message: result.message,
        confirmationSessionId: result.confirmationSessionId || null
      }
    });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'COMMAND_INTENT_FAILED',
      message: error?.message || 'backend.command_intent_failed'
    });
  }
});

router.get('/hardware-confirmations/:id', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const session = hardwareAuthorizationService.getConfirmationSession(req.params.id);
    if (!session || session.tenantId !== tenantOf(req)) {
      return sendError(res, 404, { code: 'HARDWARE_CONFIRMATION_NOT_FOUND', message: 'backend.hardware_confirmation_not_found' });
    }

    return sendSuccess(res, session, { legacy: { session } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'HARDWARE_CONFIRMATION_LOOKUP_FAILED',
      message: error?.message || 'backend.hardware_confirmation_lookup_failed'
    });
  }
});

router.post('/hardware-gates/enroll', authenticate, requirePermission('gate.enroll'), async (req: AuthenticatedRequest, res) => {
  try {
    const gateId = String(req.body?.gateId || '').trim();
    const publicKeyPem = String(req.body?.publicKeyPem || '').trim();
    if (!gateId || !publicKeyPem) {
      return sendError(res, 400, { code: 'HARDWARE_GATE_REQUIRED_FIELDS', message: 'backend.hardware_gate_required_fields' });
    }

    const gate = hardwareAuthorizationService.enrollGate({
      tenantId: tenantOf(req),
      gateId,
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : undefined,
      publicKeyPem,
      algorithm: typeof req.body?.algorithm === 'string' ? req.body.algorithm.trim() : undefined,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
      status: 'enrolled'
    });

    return sendSuccess(res, gate, { legacy: { gate } }, 201);
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'HARDWARE_GATE_ENROLL_FAILED',
      message: error?.message || 'backend.hardware_gate_enroll_failed'
    });
  }
});

router.get('/hardware-gates', authenticate, requirePermission('gate.read'), async (req: AuthenticatedRequest, res) => {
  try {
    const gates = hardwareAuthorizationService.listGates(tenantOf(req));
    return sendSuccess(res, { gates }, { legacy: { gates } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'HARDWARE_GATE_LIST_FAILED',
      message: error?.message || 'backend.hardware_gate_list_failed'
    });
  }
});

router.post('/deployment-runs', authenticate, requirePermission('deployment.run.create'), async (req: AuthenticatedRequest, res) => {
  try {
    const helperId = String(req.body?.helperId || '').trim();
    const gateId = String(req.body?.gateId || '').trim();
    const requestType = String(req.body?.requestType || 'install').trim() as 'install' | 'remove';
    const serverType = String(req.body?.serverType || 'docker_compose').trim() as any;
    const profile = req.body?.profile && typeof req.body.profile === 'object' ? req.body.profile : {};

    if (!helperId || !gateId || !serverType) {
      return sendError(res, 400, {
        code: 'DEPLOYMENT_RUN_REQUIRED_FIELDS',
        message: 'backend.deployment_run_required_fields'
      });
    }

    const run = await deploymentRunService.createRun({
      tenantId: tenantOf(req),
      helperId,
      gateId,
      requestType,
      serverType,
      profile,
      requestedBy: req.user?.email || req.user?.userId || 'unknown'
    });

    return sendSuccess(res, run, { legacy: { run } }, 201);
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_RUN_CREATE_FAILED',
      message: error?.message || 'backend.deployment_run_create_failed'
    });
  }
});

router.get('/deployment-runs', authenticate, requirePermission('deployment.run.read'), async (req: AuthenticatedRequest, res) => {
  try {
    const runs = deploymentRunService.listRuns(tenantOf(req));
    return sendSuccess(res, { runs }, { legacy: { runs } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_RUN_LIST_FAILED',
      message: error?.message || 'backend.deployment_run_list_failed'
    });
  }
});

router.post('/deployment-runs/:id/approve', authenticate, requirePermission('deployment.run.approve'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await deploymentRunService.requestApproval(req.params.id, {
      tenantId: tenantOf(req),
      userId: req.user?.userId || 'unknown',
      email: req.user?.email,
      ip: req.ip
    });
    return sendSuccess(res, result, { legacy: result });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_RUN_APPROVE_FAILED',
      message: error?.message || 'backend.deployment_run_approve_failed'
    });
  }
});

router.get('/deployment-runs/:id/evidence', authenticate, requirePermission('deployment.evidence.read'), async (req: AuthenticatedRequest, res) => {
  try {
    const evidence = await deploymentRunService.readEvidence(req.params.id, tenantOf(req));
    if (!evidence) {
      return sendError(res, 404, {
        code: 'DEPLOYMENT_EVIDENCE_NOT_FOUND',
        message: 'backend.deployment_evidence_not_found'
      });
    }
    return sendSuccess(res, {
      run: evidence.run,
      payload: JSON.parse(evidence.payload)
    });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_EVIDENCE_READ_FAILED',
      message: error?.message || 'backend.deployment_evidence_read_failed'
    });
  }
});

router.get('/helpers', authenticate, requirePermission('deployment.run.read'), async (req: AuthenticatedRequest, res) => {
  try {
    const helpers = deploymentRunService.listHelpers(tenantOf(req));
    return sendSuccess(res, { helpers }, { legacy: { helpers } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_HELPER_LIST_FAILED',
      message: error?.message || 'backend.deployment_helper_list_failed'
    });
  }
});

router.post('/helpers/register', authenticateHelperRequest, async (req, res) => {
  try {
    const helperId = String(req.body?.helperId || '').trim();
    const tenantId = String(req.body?.tenantId || '').trim();
    const fingerprint = String(req.body?.fingerprint || '').trim();
    const version = String(req.body?.version || '').trim();
    const hostname = String(req.body?.hostname || '').trim();
    const systemdStatus = String(req.body?.systemdStatus || '').trim();
    const targetHost = String(req.body?.targetHost || '').trim();
    const writablePaths = Array.isArray(req.body?.writablePaths) ? req.body.writablePaths.map((item: unknown) => String(item)) : [];

    if (!helperId || !tenantId || !fingerprint || !version || !hostname || !systemdStatus || !targetHost) {
      return sendError(res, 400, {
        code: 'DEPLOYMENT_HELPER_REQUIRED_FIELDS',
        message: 'backend.deployment_helper_required_fields'
      });
    }

    const helper = await deploymentRunService.registerHelper({
      helperId,
      tenantId,
      fingerprint,
      version,
      hostname,
      systemdStatus,
      writablePaths,
      targetHost
    });
    return sendSuccess(res, helper, { legacy: { helper } }, 201);
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_HELPER_REGISTER_FAILED',
      message: error?.message || 'backend.deployment_helper_register_failed'
    });
  }
});

router.post('/helpers/:id/heartbeat', authenticateHelperRequest, async (req, res) => {
  try {
    const helper = deploymentRunService.heartbeatHelper(req.params.id, {
      systemdStatus: String(req.body?.systemdStatus || 'unknown').trim(),
      targetHost: typeof req.body?.targetHost === 'string' ? req.body.targetHost.trim() : undefined,
      writablePaths: Array.isArray(req.body?.writablePaths) ? req.body.writablePaths.map((item: unknown) => String(item)) : undefined
    });

    if (!helper) {
      return sendError(res, 404, {
        code: 'DEPLOYMENT_HELPER_NOT_FOUND',
        message: 'backend.deployment_helper_not_found'
      });
    }

    return sendSuccess(res, helper, { legacy: { helper } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'DEPLOYMENT_HELPER_HEARTBEAT_FAILED',
      message: error?.message || 'backend.deployment_helper_heartbeat_failed'
    });
  }
});

export default router;
