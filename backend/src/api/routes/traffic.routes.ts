import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getTrafficStats, getAgentSystem } from './ai-system.routes';
import logger from '../../utils/logger';
import { SystemStats } from '../../utils/system-stats';

const router = Router();

router.use(authenticate);

router.get('/stats', (req: Request, res: Response) => {
    try {
        const stats = getTrafficStats();
        const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);

        const sys = SystemStats.getInstance();

        res.json({
            uptime,
            packetsProcessed: stats.packetsProcessed,
            packetsAllowed: stats.packetsAllowed,
            packetsBlocked: stats.packetsBlocked,
            packetsInspected: stats.packetsInspected,
            bytesProcessed: stats.bytesProcessed,
            currentFlows: stats.activeFlows.length,
            activeConnections: stats.activeFlows.filter((f: any) => f.state === 'ESTABLISHED').length,
            droppedPackets: 0,
            bufferOverflows: 0,
            avgProcessingTime: stats.packetsProcessed > 0
                ? Math.floor(stats.bytesProcessed / stats.packetsProcessed / 100)
                : 0,
            cpuUsage: sys.cpuUsage,
            memoryUsage: sys.memoryUsage,
            diskUsage: sys.diskUsage,
            networkUsage: sys.networkUsageMb
        });
    } catch (error: any) {
        logger.error('Failed to get traffic stats', { error: error.message });
        res.json({
            uptime: 0,
            packetsProcessed: 0,
            packetsAllowed: 0,
            packetsBlocked: 0,
            packetsInspected: 0,
            bytesProcessed: 0,
            currentFlows: 0,
            activeConnections: 0,
            droppedPackets: 0,
            bufferOverflows: 0,
            avgProcessingTime: 0,
            cpuUsage: 0,
            memoryUsage: 0,
            diskUsage: 0,
            networkUsage: 0
        });
    }
});

router.get('/flows', (req: Request, res: Response) => {
    try {
        const stats = getTrafficStats();

        if (stats.activeFlows.length > 0) {
            res.json(stats.activeFlows.slice(0, 20));
        } else {
            res.json([]);
        }
    } catch (error: any) {
        logger.error('Failed to get flows', { error: error.message });
        res.json([]);
    }
});

router.get('/protocols', (req: Request, res: Response) => {
    try {
        const stats = getTrafficStats();

        // Calculate real protocol distribution from active flows
        let httpCount = 0;
        let httpsCount = 0;
        let dnsCount = 0;
        let otherCount = 0;

        for (const flow of stats.activeFlows) {
            const port = flow.destPort || 0;
            const protocol = flow.protocol?.toLowerCase() || '';

            // Classify by destination port
            if (port === 80 || port === 8080 || port === 3000) {
                httpCount++;
            } else if (port === 443 || port === 8443) {
                httpsCount++;
            } else if (port === 53) {
                dnsCount++;
            } else {
                otherCount++;
            }
        }

        // If no active flows, return 0
        if (stats.activeFlows.length === 0) {
            res.json({
                http: 0,
                https: 0,
                dns: 0,
                other: 0
            });
        } else {
            res.json({
                http: httpCount,
                https: httpsCount,
                dns: dnsCount,
                other: otherCount
            });
        }
    } catch (error: any) {
        logger.error('Failed to get protocols', { error: error.message });
        res.json({ http: 0, https: 0, dns: 0, other: 0 });
    }
});

router.get('/threats', (req: Request, res: Response) => {
    try {
        const stats = getTrafficStats();
        const threats = Array.from(stats.threats.values());

        if (threats.length > 0) {
            res.json(threats);
        } else {
            res.json([]);
        }
    } catch (error: any) {
        logger.error('Failed to get threats', { error: error.message });
        res.json([]);
    }
});

export default router;
