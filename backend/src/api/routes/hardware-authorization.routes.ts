import { Router } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';

const router = Router();

function tenantOf(req: AuthenticatedRequest): string {
  return resolveRequestTenantContext(req, {
    allowAdminPlatformFallback: req.user?.role === 'admin'
  })?.tenantId || req.user?.tenantId || PLATFORM_TENANT_ID;
}

router.post('/commands/intents', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
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

router.post('/hardware-gates/enroll', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
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

router.get('/hardware-gates', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
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

export default router;
