import { Router } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';
import auditLogger from '../../security/audit-logger.service';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { getAgentGateway } from '../../services/agent-system.service';

const router = Router();

function tenantOf(req: AuthenticatedRequest): string {
  return resolveRequestTenantContext(req, {
    allowAdminPlatformFallback: req.user?.role === 'admin'
  })?.tenantId || PLATFORM_TENANT_ID;
}

function actorOf(req: AuthenticatedRequest): string {
  return req.user?.userId || req.user?.email || 'unknown';
}

router.use(authenticate, requireRole('admin'));

router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
    const dynamicOnly = String(req.query.dynamicOnly || '').toLowerCase() === 'true';
    const rules = dynamicOnly
      ? await detectionPipelineService.listDynamicRules(tenantId, channel as any)
      : await detectionPipelineService.listRules(tenantId);
    const summary = await detectionPipelineService.getSummary(tenantId);

    sendSuccess(res, {
      rules,
      summary
    }, {
      legacy: {
        rules,
        summary
      }
    });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_list_rules',
      message: error?.message || 'backend.failed_to_list_rules'
    });
  }
});

router.get('/events', async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const rawChannel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
    const rawVerdict = typeof req.query.verdict === 'string' ? req.query.verdict : undefined;
    const rawEscalated = typeof req.query.escalatedToAI === 'string' ? req.query.escalatedToAI.toLowerCase() : undefined;
    const rawCandidateId = typeof req.query.candidateId === 'string' ? req.query.candidateId : undefined;
    const rawFrom = typeof req.query.from === 'string' ? req.query.from : undefined;
    const rawTo = typeof req.query.to === 'string' ? req.query.to : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

    const events = await detectionPipelineService.listDetectionEvents(tenantId, {
      channel: rawChannel === 'http_api' || rawChannel === 'packet' || rawChannel === 'agent' ? rawChannel : undefined,
      verdict: rawVerdict === 'allow' || rawVerdict === 'block' || rawVerdict === 'monitor' ? rawVerdict : undefined,
      escalatedToAI: rawEscalated === 'true' ? true : rawEscalated === 'false' ? false : undefined,
      candidateId: rawCandidateId || undefined,
      from: rawFrom || undefined,
      to: rawTo || undefined,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined
    });

    sendSuccess(res, { events }, { legacy: { events } });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_list_detection_events',
      message: error?.message || 'backend.failed_to_list_detection_events'
    });
  }
});

router.get('/candidates', async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected'
      ? rawStatus
      : undefined;
    const candidates = await detectionPipelineService.listRuleCandidates(tenantId, status);

    sendSuccess(res, { candidates }, { legacy: { candidates } });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_list_rule_candidates',
      message: error?.message || 'backend.failed_to_list_rule_candidates'
    });
  }
});

router.post('/candidates/manual', async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const channel = req.body?.channel === 'http_api' || req.body?.channel === 'packet' || req.body?.channel === 'agent'
      ? req.body.channel
      : null;
    const attackFamily = ['benign', 'sqli', 'xss', 'path_traversal', 'command_injection', 'ssrf', 'automation', 'other']
      .includes(String(req.body?.attackFamily || ''))
      ? String(req.body.attackFamily)
      : null;
    const severity = ['low', 'medium', 'high', 'critical'].includes(String(req.body?.severity || ''))
      ? String(req.body.severity)
      : null;
    const reasoning = typeof req.body?.reasoning === 'string' ? req.body.reasoning.trim() : '';
    const aiConfidence = Number(req.body?.aiConfidence ?? 0.99);
    const requestSnapshot = req.body?.request && typeof req.body.request === 'object' ? req.body.request : null;

    if (!channel || !attackFamily || !severity || !reasoning || !requestSnapshot) {
      return sendError(res, 400, {
        code: 'backend.invalid_manual_rule_candidate_payload',
        message: 'backend.invalid_manual_rule_candidate_payload'
      });
    }

    const candidate = await detectionPipelineService.createManualRuleCandidate({
      tenantId,
      channel: channel as any,
      attackFamily: attackFamily as any,
      severity: severity as any,
      reasoning,
      aiConfidence,
      request: {
        tenantId,
        channel: channel as any,
        requestId: String(requestSnapshot.requestId || `manual-candidate:${Date.now()}`),
        timestamp: String(requestSnapshot.timestamp || new Date().toISOString()),
        sourceIp: typeof requestSnapshot.sourceIp === 'string' ? requestSnapshot.sourceIp : undefined,
        method: typeof requestSnapshot.method === 'string' ? requestSnapshot.method : 'POST',
        path: typeof requestSnapshot.path === 'string' ? requestSnapshot.path : '/',
        decodedPath: typeof requestSnapshot.decodedPath === 'string' ? requestSnapshot.decodedPath : undefined,
        query: typeof requestSnapshot.query === 'string' ? requestSnapshot.query : undefined,
        decodedQuery: typeof requestSnapshot.decodedQuery === 'string' ? requestSnapshot.decodedQuery : undefined,
        parsedQuery: typeof requestSnapshot.parsedQuery === 'string' ? requestSnapshot.parsedQuery : undefined,
        headers: requestSnapshot.headers && typeof requestSnapshot.headers === 'object' ? requestSnapshot.headers : {},
        body: typeof requestSnapshot.body === 'string' ? requestSnapshot.body : '',
        normalizedBody: typeof requestSnapshot.normalizedBody === 'string' ? requestSnapshot.normalizedBody : undefined,
        parsedBody: typeof requestSnapshot.parsedBody === 'string' ? requestSnapshot.parsedBody : undefined,
        userAgent: typeof requestSnapshot.userAgent === 'string' ? requestSnapshot.userAgent : undefined,
        evidence: typeof requestSnapshot.evidence === 'string' ? requestSnapshot.evidence : '',
        protocol: typeof requestSnapshot.protocol === 'string' ? requestSnapshot.protocol : undefined,
        rawPayload: typeof requestSnapshot.rawPayload === 'string' ? requestSnapshot.rawPayload : undefined,
        metadata: requestSnapshot.metadata && typeof requestSnapshot.metadata === 'object' ? requestSnapshot.metadata : {}
      },
      evidence: req.body?.evidence && typeof req.body.evidence === 'object' ? req.body.evidence : undefined
    });

    if (!candidate) {
      return sendError(res, 500, {
        code: 'backend.failed_to_create_manual_rule_candidate',
        message: 'backend.failed_to_create_manual_rule_candidate'
      });
    }

    await auditLogger.log({
      tenantId,
      eventType: 'manual_rule_candidate_created',
      category: 'system',
      severity: 'warning',
      actor: { type: 'user', id: actorOf(req), email: req.user?.email, ip: req.ip },
      action: 'create_manual_rule_candidate',
      target: { type: 'rule', id: candidate.candidateId },
      details: {
        candidateId: candidate.candidateId,
        channel: candidate.channel,
        attackFamily: candidate.attackFamily
      },
      status: 'success'
    });

    sendSuccess(res, { candidate }, { legacy: { candidate } }, 201);
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_create_manual_rule_candidate',
      message: error?.message || 'backend.failed_to_create_manual_rule_candidate'
    });
  }
});

router.get('/candidates/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const candidate = await detectionPipelineService.getRuleCandidateById(tenantOf(req), req.params.id);
    if (!candidate) {
      return sendError(res, 404, {
        code: 'backend.rule_candidate_not_found',
        message: 'backend.rule_candidate_not_found'
      });
    }

    sendSuccess(res, { candidate }, { legacy: { candidate } });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_get_rule_candidate',
      message: error?.message || 'backend.failed_to_get_rule_candidate'
    });
  }
});

router.post('/candidates/:id/approve', async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const actorId = actorOf(req);
    const candidate = await detectionPipelineService.approveRuleCandidate(
      tenantId,
      req.params.id,
      actorId,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined
    );

    if (!candidate) {
      return sendError(res, 404, {
        code: 'backend.rule_candidate_not_found',
        message: 'backend.rule_candidate_not_found'
      });
    }

    let sync = { attempted: 0, succeeded: 0 };
    if (candidate.channel === 'agent') {
      const gateway = getAgentGateway();
      if (gateway?.syncTenantDetectionRules) {
        sync = await gateway.syncTenantDetectionRules(tenantId);
      }
    }

    await auditLogger.log({
      tenantId,
      eventType: 'rule_candidate_approved',
      category: 'system',
      severity: 'warning',
      actor: { type: 'user', id: actorId, email: req.user?.email, ip: req.ip },
      action: 'approve_rule_candidate',
      target: { type: 'rule', id: candidate.candidateId },
      details: {
        candidateId: candidate.candidateId,
        approvedRuleId: candidate.approvedRuleId,
        channel: candidate.channel,
        sync
      },
      status: 'success'
    });

    sendSuccess(res, {
      candidate,
      sync
    }, {
      legacy: {
        candidate,
        sync
      }
    });
  } catch (error: any) {
    if (error?.code === 'backend.rule_candidate_invalid_regex') {
      return sendError(res, 422, {
        code: 'backend.rule_candidate_invalid_regex',
        message: 'backend.rule_candidate_invalid_regex'
      }, {
        meta: { invalidPatterns: error.invalidPatterns || [] }
      });
    }
    sendError(res, 500, {
      code: 'backend.failed_to_approve_rule_candidate',
      message: error?.message || 'backend.failed_to_approve_rule_candidate'
    });
  }
});

router.post('/candidates/:id/reject', async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const actorId = actorOf(req);
    const candidate = await detectionPipelineService.rejectRuleCandidate(
      tenantId,
      req.params.id,
      actorId,
      typeof req.body?.reason === 'string' ? req.body.reason : undefined
    );

    if (!candidate) {
      return sendError(res, 404, {
        code: 'backend.rule_candidate_not_found',
        message: 'backend.rule_candidate_not_found'
      });
    }

    await auditLogger.log({
      tenantId,
      eventType: 'rule_candidate_rejected',
      category: 'system',
      severity: 'info',
      actor: { type: 'user', id: actorId, email: req.user?.email, ip: req.ip },
      action: 'reject_rule_candidate',
      target: { type: 'rule', id: candidate.candidateId },
      details: {
        candidateId: candidate.candidateId,
        reviewReason: candidate.reviewReason,
        channel: candidate.channel
      },
      status: 'success'
    });

    sendSuccess(res, { candidate }, { legacy: { candidate } });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_reject_rule_candidate',
      message: error?.message || 'backend.failed_to_reject_rule_candidate'
    });
  }
});

export default router;
