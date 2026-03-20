import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import { scannerTaskService } from '../../services/scanner-task.service';
import { listFixHistoryRows } from '../../modules/scanner/scanner-route.repository';

const router = Router();

router.use(authenticate, requireRole('admin'));

const scannerTaskViews = scannerTaskService as typeof scannerTaskService & {
    getHistoryView?: (tenantId: string, limit?: number) => Promise<any[]>;
    getTaskView?: (taskId: string) => Promise<any | null>;
    getTaskResultsView?: (taskId: string) => Promise<any>;
};

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const limitRaw = Number(req.query.limit || 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
        const rows = await listFixHistoryRows(limit);

        const data = (rows || []).map((row) => ({
            id: row.id,
            status: row.status,
            phase: row.phase,
            progress: row.progress,
            createdAt: row.created_at,
            completedAt: row.completed_at
        }));

        return sendSuccess(res, data, {
            legacy: {
                count: data.length
            }
        });
    } catch (error: any) {
        return sendError(res, 500, {
            code: 'FG-FIX-HISTORY-LIST-500',
            message: error?.message || 'Failed to fetch fix history'
        });
    }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const row = typeof scannerTaskViews.getTaskView === 'function'
            ? await scannerTaskViews.getTaskView(req.params.id)
            : scannerTaskService.getTask(req.params.id);

        if (!row) {
            return sendError(res, 404, {
                code: 'FG-FIX-HISTORY-404',
                message: 'backend.history_record_not_found'
            });
        }

        const results = typeof scannerTaskViews.getTaskResultsView === 'function'
            ? await scannerTaskViews.getTaskResultsView(req.params.id)
            : scannerTaskService.getTaskResults(req.params.id);
        const findings = (results?.findings || []).map((finding: any) => ({
            target_type: finding.targetType || finding.target_type || '',
            target: finding.target,
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            source_engine: finding.sourceEngine || finding.source_engine || '',
            created_at: finding.createdAt || finding.created_at || row.createdAt
        }));

        return sendSuccess(res, {
            id: row.id,
            status: row.status,
            phase: row.phase,
            progress: row.progress,
            error: row.error || null,
            summary: row.summary || {},
            createdAt: row.createdAt,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            findings
        });
    } catch (error: any) {
        return sendError(res, 500, {
            code: 'FG-FIX-HISTORY-DETAIL-500',
            message: error?.message || 'Failed to fetch fix history detail'
        });
    }
});

export default router;
