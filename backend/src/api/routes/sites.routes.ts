import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

const router = Router();

router.use(authenticate);

router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = getDatabase().getDb();
        const user = req.user!;

        let sites;
        if (user.role === 'admin') {
            sites = db.prepare('SELECT * FROM sites ORDER BY createdAt DESC').all();
        } else {
            sites = db.prepare('SELECT * FROM sites WHERE tenantId = ? ORDER BY createdAt DESC').all(user.tenantId);
        }

        if (!sites || sites.length === 0) {
            return res.json([]);
        }

        const formattedSites = sites.map((site: any) => ({
            id: site.id,
            domain: site.domain,
            target: site.target,
            status: site.sslEnabled ? 'secure' : 'warning',
            sslEnabled: Boolean(site.sslEnabled),
            antiBotEnabled: Boolean(site.antiBotEnabled),
            rateLimitEnabled: Boolean(site.rateLimitEnabled),
            concurrencyEnabled: Boolean(site.concurrencyEnabled)
        }));

        res.json(formattedSites);
    } catch (error: any) {
        logger.error('Failed to get sites', { error: error.message });
        res.json([]);
    }
});

router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = getDatabase().getDb();
        const user = req.user!;

        let site;
        if (user.role === 'admin') {
            site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
        } else {
            site = db.prepare('SELECT * FROM sites WHERE id = ? AND tenantId = ?').get(req.params.id, user.tenantId);
        }

        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }

        res.json({
            id: (site as any).id,
            domain: (site as any).domain,
            target: (site as any).target,
            status: (site as any).sslEnabled ? 'secure' : 'warning',
            sslEnabled: Boolean((site as any).sslEnabled)
        });
    } catch (error: any) {
        logger.error('Failed to get site', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
