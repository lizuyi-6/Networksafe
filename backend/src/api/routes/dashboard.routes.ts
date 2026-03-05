import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getTrafficStats } from './ai-system.routes';

const router = Router();

router.use(authenticate);

router.get('/rules/summary', (req: AuthenticatedRequest, res: Response) => {
    try {
        const stats = getTrafficStats();
        const threatEntries = Array.from(stats.threats.entries()).map(([key, item]) => ({
            id: key,
            name: item.type,
            severity: item.severity,
            count: item.count,
            enabled: true
        }));

        res.json({
            success: true,
            data: {
                totalRules: threatEntries.length,
                activeRules: threatEntries.filter((r) => r.enabled).length,
                topRules: threatEntries.sort((a, b) => b.count - a.count).slice(0, 10),
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
