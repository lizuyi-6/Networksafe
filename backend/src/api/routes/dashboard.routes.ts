import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';
import { detectionPipelineService } from '../../services/detection-pipeline.service';

const router = Router();

router.use(authenticate);

router.get('/rules/summary', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const tenantId = req.tenantContext?.tenantId || req.user?.tenantId || PLATFORM_TENANT_ID;
        const summary = await detectionPipelineService.getSummary(tenantId);

        res.json({
            success: true,
            data: {
                ...summary,
                updatedAt: new Date().toISOString()
            }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-DASHBOARD-500',
                message: error?.message || 'Failed to load dashboard rule summary',
                timestamp: new Date().toISOString()
            }
        });
    }
});

export default router;
