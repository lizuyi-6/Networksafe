import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
        const limitRaw = Number(req.query.limit || 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
        const db = getDatabase();

        const rows = db.prepare(`
            SELECT id, status, phase, progress, created_at, completed_at
            FROM scan_tasks
            ORDER BY created_at DESC
            LIMIT ?
        `).all(limit) as any[];

        const data = (rows || []).map((r) => ({
            id: r.id,
            status: r.status,
            phase: r.phase,
            progress: r.progress,
            createdAt: r.created_at,
            completedAt: r.completed_at
        }));

        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-FIX-HISTORY-LIST-500',
                message: error?.message || 'Failed to fetch fix history',
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = getDatabase();
        const row = db.prepare(`
            SELECT id, status, phase, progress, created_at, started_at, completed_at, error, summary_json
            FROM scan_tasks
            WHERE id = ?
        `).get(req.params.id) as any;

        if (!row) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FG-FIX-HISTORY-404',
                    message: 'backend.history_record_not_found',
                    timestamp: new Date().toISOString()
                }
            });
        }

        const findings = db.prepare(`
            SELECT target_type, target, severity, title, description, source_engine, created_at
            FROM scan_findings
            WHERE task_id = ?
            ORDER BY created_at DESC
            LIMIT 500
        `).all(req.params.id);

        res.json({
            success: true,
            data: {
                id: row.id,
                status: row.status,
                phase: row.phase,
                progress: row.progress,
                error: row.error || null,
                summary: row.summary_json ? JSON.parse(row.summary_json) : {},
                createdAt: row.created_at,
                startedAt: row.started_at,
                completedAt: row.completed_at,
                findings
            }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-FIX-HISTORY-DETAIL-500',
                message: error?.message || 'Failed to fetch fix history detail',
                timestamp: new Date().toISOString()
            }
        });
    }
});

export default router;
