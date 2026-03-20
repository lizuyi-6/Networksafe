import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { InputValidator } from '../../security/input-validator';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';
import logger from '../../utils/logger';
import { scannerTaskService } from '../../services/scanner-task.service';
import { securityOperationsService } from '../../services/security-operations.service';
import * as dns from 'dns';
import { promisify } from 'util';
import { getLegacyScanResultById } from '../../modules/scanner/scanner-route.repository';

const dnsLookup = promisify(dns.lookup);

// SECURITY FIX CVE-2026-014: Add input validation to scanner routes
const inputValidator = new InputValidator();

const router = Router();
router.use(authenticate, requireRole('admin'));

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || PLATFORM_TENANT_ID;
}

async function getHistoryForView(tenantId: string, limit: number) {
  const service = scannerTaskService as any;
  if (typeof service.getHistoryView === 'function') {
    return await service.getHistoryView(tenantId, limit);
  }
  return service.getHistory(tenantId, limit);
}

async function getTaskForView(taskId: string) {
  const service = scannerTaskService as any;
  if (typeof service.getTaskView === 'function') {
    return await service.getTaskView(taskId);
  }
  return service.getTask(taskId);
}

async function getTaskResultsForView(taskId: string) {
  const service = scannerTaskService as any;
  if (typeof service.getTaskResultsView === 'function') {
    return await service.getTaskResultsView(taskId);
  }
  return service.getTaskResults(taskId);
}

function stringArray(input: any): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildTargetsFromRequest(body: any, filteredUrls: string[]) {
  const hostInput = body?.targets?.host;
  const host = hostInput && hostInput.mode === 'local'
    ? {
        mode: 'local' as const,
        includeSystem: Boolean(hostInput.includeSystem),
        includeWeb: Boolean(hostInput.includeWeb),
        includePorts: Boolean(hostInput.includePorts)
      }
    : undefined;

  return {
    urls: filteredUrls,
    domains: stringArray(body?.targets?.domains),
    ips: stringArray(body?.targets?.ips),
    cidrs: stringArray(body?.targets?.cidrs),
    assetIds: stringArray(body?.targets?.assetIds),
    deviceIds: stringArray(body?.targets?.deviceIds),
    agentIds: stringArray(body?.targets?.agentIds),
    items: Array.isArray(body?.targets?.items)
      ? body.targets.items
          .filter((item: any) => item && typeof item.kind === 'string' && typeof item.value === 'string')
          .map((item: any) => ({
            kind: item.kind,
            value: String(item.value).trim(),
            label: typeof item.label === 'string' ? item.label : undefined,
            metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : undefined
          }))
      : [],
    host
  };
}

const MAX_URLS = 100;

const PRIVATE_IP_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '0.0.0.0', end: '0.255.255.255' },
];

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIP(ip: string): boolean {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    return false;
  }
  
  const ipNum = ipToNumber(ip);
  
  for (const range of PRIVATE_IP_RANGES) {
    const startNum = ipToNumber(range.start);
    const endNum = ipToNumber(range.end);
    if (ipNum >= startNum && ipNum <= endNum) {
      return true;
    }
  }
  
  return false;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function isSSRFAttempt(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname;
    
    if (isPrivateIP(hostname)) {
      return true;
    }
    
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      try {
        const result = await dnsLookup(hostname, { family: 4 });
        if (isPrivateIP(result.address)) {
          return true;
        }
      } catch {
        // DNS lookup failed, allow the URL but log warning
        logger.warn('DNS lookup failed for URL hostname', { hostname });
      }
    }
    
    return false;
  } catch {
    return true;
  }
}

async function validateUrls(urls: string[]): Promise<{ valid: boolean; error?: string; filteredUrls: string[] }> {
  if (urls.length > MAX_URLS) {
    return { valid: false, error: `Too many URLs. Maximum ${MAX_URLS} allowed.`, filteredUrls: [] };
  }
  
  const filteredUrls: string[] = [];
  
  for (const url of urls) {
    if (typeof url !== 'string') {
      return { valid: false, error: 'Invalid URL format: URL must be a string', filteredUrls: [] };
    }
    
    if (!isValidUrl(url)) {
      return { valid: false, error: `Invalid URL format or protocol (only http/https allowed): ${url}`, filteredUrls: [] };
    }
    
    if (await isSSRFAttempt(url)) {
      logger.warn('SSRF attempt blocked', { url });
      return { valid: false, error: `SSRF attempt blocked: URL resolves to private IP address`, filteredUrls: [] };
    }
    
    filteredUrls.push(url);
  }
  
  return { valid: true, filteredUrls };
}

/**
 * POST /api/scanner/tasks
 * Create async scan task (URL + host)
 * SECURITY FIX CVE-2026-014: Added input validation
 */
router.post('/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // SECURITY FIX CVE-2026-014: Validate input before processing
    const validationResult = inputValidator.validateRequest(req);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'INVALID_INPUT',
          message: 'backend.invalid_input',
          details: validationResult.errors
        },
        code: 'INVALID_INPUT',
        message: 'backend.invalid_input'
      });
    }

    const tenantId = tenantOf(req);
    const urls = Array.isArray(req.body?.targets?.urls) ? req.body.targets.urls : [];
    const urlValidation = await validateUrls(urls);
    if (!urlValidation.valid) {
      return sendError(res, 400, {
        code: 'INVALID_TARGETS',
        message: String(urlValidation.error || 'backend.invalid_input')
      });
    }

    const task = await scannerTaskService.createTask({
      tenantId,
      createdBy: req.user!.userId,
      enginePolicy: 'opt_then_nuclei',
      targets: buildTargetsFromRequest(req.body, urlValidation.filteredUrls)
    });

    return sendSuccess(res, {
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt
    }, {
      legacy: {
        taskId: task.id,
        status: task.status
      }
    });
  } catch (error: any) {
    logger.error('Failed to create scan task', { error: error.message });
    return sendError(res, 500, {
      code: 'SCAN_TASK_CREATE_FAILED',
      message: 'backend.failed_to_create_scan_task'
    });
  }
});

/**
 * GET /api/scanner/tasks/history
 */
router.get('/tasks/history', async (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
  const history = await getHistoryForView(tenantOf(req), limit);
  return sendSuccess(res, history, {
    legacy: {
      count: history.length
    }
  });
});

/**
 * GET /api/scanner/tasks/:taskId
 * Get task status
 */
router.get('/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  const task = await getTaskForView(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return sendError(res, 404, {
      code: 'TASK_NOT_FOUND',
      message: 'backend.task_not_found'
    });
  }
  return sendSuccess(res, {
    taskId: task.id,
    status: task.status,
    phase: task.phase,
    progress: task.progress,
    summary: task.summary,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt
  }, {
    legacy: {
      taskId: task.id,
      status: task.status
    }
  });
});

/**
 * GET /api/scanner/tasks/:taskId/results
 * Get task detailed results
 */
router.get('/tasks/:taskId/results', async (req: AuthenticatedRequest, res: Response) => {
  const task = await getTaskForView(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return sendError(res, 404, {
      code: 'TASK_NOT_FOUND',
      message: 'backend.task_not_found'
    });
  }
  const result = await getTaskResultsForView(req.params.taskId);
  return sendSuccess(res, result);
});

/**
 * POST /api/scanner/tasks/:taskId/cancel
 */
router.post('/tasks/:taskId/cancel', async (req: AuthenticatedRequest, res: Response) => {
  const task = await getTaskForView(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return sendError(res, 404, {
      code: 'TASK_NOT_FOUND',
      message: 'backend.task_not_found'
    });
  }
  const ok = scannerTaskService.cancelTask(req.params.taskId);
  return ok
    ? sendSuccess(res, { taskId: req.params.taskId, cancelled: true }, {
        legacy: { status: 'cancelled' }
      })
    : sendError(res, 409, {
        code: 'TASK_CANCEL_FAILED',
        message: 'backend.failed_to_cancel_scan_task'
      });
});

router.post('/tasks/:taskId/retry', async (req: AuthenticatedRequest, res: Response) => {
  const task = await getTaskForView(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return sendError(res, 404, {
      code: 'TASK_NOT_FOUND',
      message: 'backend.task_not_found'
    });
  }

  try {
    const retryTask = await scannerTaskService.retryTask(req.params.taskId, req.user?.userId);
    if (!retryTask) {
      return sendError(res, 404, {
        code: 'TASK_NOT_FOUND',
        message: 'backend.task_not_found'
      });
    }

    return sendSuccess(res, {
      taskId: retryTask.id,
      status: retryTask.status,
      createdAt: retryTask.createdAt
    }, {
      legacy: {
        taskId: retryTask.id,
        status: retryTask.status
      }
    });
  } catch (error: any) {
    logger.error('Failed to retry scan task', { error: error.message, taskId: req.params.taskId });
    return sendError(res, 500, {
      code: 'SCAN_TASK_RETRY_FAILED',
      message: 'backend.failed_to_retry_scan_task'
    });
  }
});

router.post('/findings/:findingId/actions', async (req: AuthenticatedRequest, res: Response) => {
  const action = await securityOperationsService.createActionFromFindingView(
    tenantOf(req),
    req.params.findingId,
    req.user?.email || req.user?.userId || 'unknown'
  );

  if (!action) {
    return sendError(res, 404, {
      code: 'FINDING_NOT_FOUND',
      message: 'backend.finding_not_found'
    });
  }

  return sendSuccess(res, action, {
    legacy: {
      actionId: action.actionId
    }
  });
});

/**
 * Backward compatibility endpoint expected by old frontend:
 * GET /api/scanner
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const history = await getHistoryForView(tenantOf(req), 1);
  if (history.length === 0) {
    res.setHeader('X-Deprecated-Endpoint', 'Use /api/scanner/tasks/* instead');
    return sendSuccess(res, [], {
      legacy: {
        events: []
      }
    });
  }
  const latest = history[0];
  const result = await getTaskResultsForView(latest.id);
  const flattened = [
    ...(result?.urlFindings || []),
    ...(result?.hostFindings || []),
    ...(result?.nucleiFindings || [])
  ].map((f: any, idx: number) => ({
    id: idx + 1,
    name: f.title,
    severity: String(f.severity || 'Medium').replace(/^./, (m) => m.toUpperCase()),
    description: f.description || '',
    status: 'Open'
  }));
  res.setHeader('X-Deprecated-Endpoint', 'Use /api/scanner/tasks/* instead');
  return sendSuccess(res, flattened, {
    legacy: {
      events: flattened
    }
  });
});

/**
 * Backward compatibility: POST /api/scanner/run
 * Create a task and return task metadata.
 */
router.post('/run', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];

    const validation = await validateUrls(urls);
    if (!validation.valid) {
      return sendError(res, 400, {
        code: 'INVALID_TARGETS',
        message: String(validation.error || 'backend.invalid_input')
      });
    }

    const task = await scannerTaskService.createTask({
      tenantId,
      createdBy: req.user!.userId,
      enginePolicy: 'opt_then_nuclei',
      targets: {
        urls: validation.filteredUrls,
        host: {
          mode: 'local',
          includeSystem: true,
          includeWeb: true,
          includePorts: true
        }
      }
    });
    return sendSuccess(res, {
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt
    }, {
      legacy: {
        taskId: task.id,
        status: task.status
      }
    });
  } catch (error: any) {
    if (error.code === 'TENANT_TASK_RUNNING') {
      return sendError(res, 409, {
        code: 'TENANT_TASK_RUNNING',
        message: error.message
      });
    }
    logger.error('Failed to run scan', { error: error.message });
    return sendError(res, 500, {
      code: 'SCAN_START_FAILED',
      message: 'backend.failed_to_start_scan'
    });
  }
});

/**
 * Keep legacy endpoints but return explicit not supported for now
 */
router.post('/apply', (_req: Request, res: Response) => {
  return sendError(res, 501, {
    code: 'SMART_FIX_REQUIRED',
    message: 'backend.use_smart_fix_endpoints_for_remediation_actions'
  });
});

router.get('/results/:id', async (req: AuthenticatedRequest, res: Response) => {
  // Try task id first
  const task = await getTaskForView(req.params.id);
  if (task && task.tenantId === tenantOf(req)) {
    return sendSuccess(res, await getTaskResultsForView(task.id));
  }

  // Fallback to legacy numeric scan_results table row
  const numericId = parseInt(req.params.id, 10);
  if (Number.isFinite(numericId) && numericId > 0) {
    const row = getLegacyScanResultById(numericId);
    if (row) {
      return sendSuccess(res, row);
    }
  }
  return sendError(res, 404, {
    code: 'SCAN_RESULT_NOT_FOUND',
    message: 'backend.scan_result_not_found'
  });
});

router.get('/report/:id', async (req: AuthenticatedRequest, res: Response) => {
  const task = await getTaskForView(req.params.id);
  if (!task || task.tenantId !== tenantOf(req)) {
    return sendError(res, 404, {
      code: 'TASK_NOT_FOUND',
      message: 'backend.task_not_found'
    });
  }
  const data = await getTaskResultsForView(task.id);
  const report = {
    taskId: task.id,
    status: task.status,
    phase: task.phase,
    summary: data.summary,
    findings: {
      url: data.urlFindings.length,
      host: data.hostFindings.length,
      nuclei: data.nucleiFindings.length
    }
  };
  res.setHeader('Content-Type', 'application/json');
  return sendSuccess(res, report, {
    legacy: report
  });
});

export default router;
