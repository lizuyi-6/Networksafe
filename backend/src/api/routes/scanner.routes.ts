import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { InputValidator } from '../../security/input-validator';
import logger from '../../utils/logger';
import { scannerTaskService } from '../../services/scanner-task.service';
import { getDatabase } from '../../config/database';
import * as dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

// SECURITY FIX CVE-2026-014: Add input validation to scanner routes
const inputValidator = new InputValidator();

const router = Router();
router.use(authenticate, requireRole('admin'));

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
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
        error: 'backend.invalid_input',
        details: validationResult.errors
      });
    }

    const tenantId = tenantOf(req);
    const urls = Array.isArray(req.body?.targets?.urls) ? req.body.targets.urls : [];
    const host = req.body?.targets?.host || {
      mode: 'local',
      includeSystem: true,
      includeWeb: true,
      includePorts: true
    };

    const urlValidation = await validateUrls(urls);
    if (!urlValidation.valid) {
      return res.status(400).json({ success: false, error: urlValidation.error });
    }

    const task = await scannerTaskService.createTask({
      tenantId,
      createdBy: req.user!.userId,
      enginePolicy: 'opt_then_nuclei',
      targets: { urls: urlValidation.filteredUrls, host }
    });

    return res.json({
      success: true,
      data: {
        taskId: task.id,
        status: task.status,
        createdAt: task.createdAt
      }
    });
  } catch (error: any) {
    if (error.code === 'TENANT_TASK_RUNNING') {
      return res.status(409).json({ success: false, error: error.message });
    }
    logger.error('Failed to create scan task', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_create_scan_task' });
  }
});

/**
 * GET /api/scanner/tasks/history
 */
router.get('/tasks/history', (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
  const history = scannerTaskService.getHistory(tenantOf(req), limit);
  return res.json({ success: true, data: history });
});

/**
 * GET /api/scanner/tasks/:taskId
 * Get task status
 */
router.get('/tasks/:taskId', (req: AuthenticatedRequest, res: Response) => {
  const task = scannerTaskService.getTask(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return res.status(404).json({ success: false, error: 'backend.task_not_found' });
  }
  return res.json({
    success: true,
    data: {
      taskId: task.id,
      status: task.status,
      phase: task.phase,
      progress: task.progress,
      summary: task.summary,
      error: task.error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt
    }
  });
});

/**
 * GET /api/scanner/tasks/:taskId/results
 * Get task detailed results
 */
router.get('/tasks/:taskId/results', (req: AuthenticatedRequest, res: Response) => {
  const task = scannerTaskService.getTask(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return res.status(404).json({ success: false, error: 'backend.task_not_found' });
  }
  const result = scannerTaskService.getTaskResults(req.params.taskId);
  return res.json({ success: true, data: result });
});

/**
 * POST /api/scanner/tasks/:taskId/cancel
 */
router.post('/tasks/:taskId/cancel', (req: AuthenticatedRequest, res: Response) => {
  const task = scannerTaskService.getTask(req.params.taskId);
  if (!task || task.tenantId !== tenantOf(req)) {
    return res.status(404).json({ success: false, error: 'backend.task_not_found' });
  }
  const ok = scannerTaskService.cancelTask(req.params.taskId);
  return res.json({ success: ok });
});

/**
 * Backward compatibility endpoint expected by old frontend:
 * GET /api/scanner
 */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  const history = scannerTaskService.getHistory(tenantOf(req), 1);
  if (history.length === 0) {
    return res.json([]);
  }
  const latest = history[0];
  const result = scannerTaskService.getTaskResults(latest.id);
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
  return res.json(flattened);
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
      return res.status(400).json({ success: false, error: validation.error });
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
    return res.json({
      success: true,
      data: {
        taskId: task.id,
        status: task.status,
        createdAt: task.createdAt
      }
    });
  } catch (error: any) {
    if (error.code === 'TENANT_TASK_RUNNING') {
      return res.status(409).json({ success: false, error: error.message });
    }
    logger.error('Failed to run scan', { error: error.message });
    return res.status(500).json({ success: false, error: 'backend.failed_to_start_scan' });
  }
});

/**
 * Keep legacy endpoints but return explicit not supported for now
 */
router.post('/apply', (_req: Request, res: Response) => {
  return res.status(501).json({ success: false, error: 'backend.use_smart_fix_endpoints_for_remediation_actions' });
});

router.get('/results/:id', (req: AuthenticatedRequest, res: Response) => {
  // Try task id first
  const task = scannerTaskService.getTask(req.params.id);
  if (task && task.tenantId === tenantOf(req)) {
    return res.json({
      success: true,
      data: scannerTaskService.getTaskResults(task.id)
    });
  }

  // Fallback to legacy numeric scan_results table row
  const numericId = parseInt(req.params.id, 10);
  if (Number.isFinite(numericId) && numericId > 0) {
    try {
      const row = getDatabase().prepare('SELECT * FROM scan_results WHERE id = ?').get(numericId) as any;
      if (!row) {
        return res.status(404).json({ success: false, error: 'backend.scan_result_not_found' });
      }
      return res.json({ success: true, data: row });
    } catch {
      // ignore
    }
  }
  return res.status(404).json({ success: false, error: 'backend.scan_result_not_found' });
});

router.get('/report/:id', (req: AuthenticatedRequest, res: Response) => {
  const task = scannerTaskService.getTask(req.params.id);
  if (!task || task.tenantId !== tenantOf(req)) {
    return res.status(404).json({ success: false, error: 'backend.task_not_found' });
  }
  const data = scannerTaskService.getTaskResults(task.id);
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
  return res.send(JSON.stringify(report, null, 2));
});

export default router;
