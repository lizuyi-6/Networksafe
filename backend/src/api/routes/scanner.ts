import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';
import { scannerTaskService } from '../../services/scanner-task.service';
import { getDatabase } from '../../config/database';

const router = Router();
router.use(authenticate, requireRole('admin'));

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
}

/**
 * POST /api/scanner/tasks
 * Create async scan task (URL + host)
 */
router.post('/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const urls = Array.isArray(req.body?.targets?.urls) ? req.body.targets.urls : [];
    const host = req.body?.targets?.host || {
      mode: 'local',
      includeSystem: true,
      includeWeb: true,
      includePorts: true
    };

    const task = await scannerTaskService.createTask({
      tenantId,
      createdBy: req.user!.userId,
      enginePolicy: 'opt_then_nuclei',
      targets: { urls, host }
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
    return res.status(500).json({ success: false, error: 'Failed to create scan task' });
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
    return res.status(404).json({ success: false, error: 'Task not found' });
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
    return res.status(404).json({ success: false, error: 'Task not found' });
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
    return res.status(404).json({ success: false, error: 'Task not found' });
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
    const task = await scannerTaskService.createTask({
      tenantId,
      createdBy: req.user!.userId,
      enginePolicy: 'opt_then_nuclei',
      targets: {
        urls,
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
    return res.status(500).json({ success: false, error: 'Failed to start scan' });
  }
});

/**
 * Keep legacy endpoints but return explicit not supported for now
 */
router.post('/apply', (_req: Request, res: Response) => {
  return res.status(501).json({ success: false, error: 'Use smart-fix endpoints for remediation actions' });
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
        return res.status(404).json({ success: false, error: 'Scan result not found' });
      }
      return res.json({ success: true, data: row });
    } catch {
      // ignore
    }
  }
  return res.status(404).json({ success: false, error: 'Scan result not found' });
});

router.get('/report/:id', (req: AuthenticatedRequest, res: Response) => {
  const task = scannerTaskService.getTask(req.params.id);
  if (!task || task.tenantId !== tenantOf(req)) {
    return res.status(404).json({ success: false, error: 'Task not found' });
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
