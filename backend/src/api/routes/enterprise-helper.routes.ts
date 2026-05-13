import { Router } from 'express';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { authenticateHelperRequest } from '../../middleware/helper-auth.middleware';
import { deploymentRunService, type SerialRequestType } from '../../services/deployment-run.service';

const router = Router();

router.get('/helpers/:id/serial-request/:requestType', authenticateHelperRequest, async (req, res) => {
  try {
    const requestType = String(req.params.requestType || '').trim().toUpperCase() as SerialRequestType;
    if (!['ENV', 'BACKUP', 'INSTALL', 'REMOVE'].includes(requestType)) {
      return sendError(res, 400, {
        code: 'INVALID_SERIAL_REQUEST_TYPE',
        message: 'backend.invalid_serial_request_type'
      });
    }

    if (requestType === 'ENV') {
      return sendSuccess(res, {
        ok: true,
        environment: process.platform === 'win32' ? 'WINDOWS' : 'LINUX'
      });
    }

    const resolved = await deploymentRunService.resolveSerialRequest(req.params.id, requestType);
    if (!resolved.ok) {
      return sendError(res, 404, {
        code: 'SERIAL_REQUEST_NOT_READY',
        message: resolved.message || 'backend.serial_request_not_ready'
      });
    }

    return sendSuccess(res, resolved);
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'SERIAL_REQUEST_FAILED',
      message: error?.message || 'backend.serial_request_failed'
    });
  }
});

router.post('/helpers/:id/serial-request-result', authenticateHelperRequest, async (req, res) => {
  try {
    const runId = String(req.body?.runId || '').trim();
    const tenantId = String(req.body?.tenantId || '').trim();
    const requestType = String(req.body?.requestType || '').trim().toUpperCase() as SerialRequestType;
    const success = Boolean(req.body?.success);
    const output = typeof req.body?.output === 'string' ? req.body.output : '';
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : undefined;
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : undefined;

    if (!runId || !tenantId || !requestType) {
      return sendError(res, 400, {
        code: 'SERIAL_REQUEST_RESULT_REQUIRED_FIELDS',
        message: 'backend.serial_request_result_required_fields'
      });
    }

    const run = await deploymentRunService.reportSerialRequestResult({
      helperId: req.params.id,
      runId,
      tenantId,
      requestType,
      success,
      output,
      payload,
      signature
    });

    if (!run) {
      return sendError(res, 404, {
        code: 'DEPLOYMENT_RUN_NOT_FOUND',
        message: 'backend.deployment_run_not_found'
      });
    }

    return sendSuccess(res, run, { legacy: { run } });
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'SERIAL_REQUEST_RESULT_FAILED',
      message: error?.message || 'backend.serial_request_result_failed'
    });
  }
});

export default router;
