import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getTrafficStats, getAgentSystem } from './ai-system.routes';
import logger from '../../utils/logger';
import { SystemStats } from '../../utils/system-stats';
import { securityOperationsService } from '../../services/security-operations.service';

const router = Router();

router.use(authenticate);

function tenantOf(req: AuthenticatedRequest): string {
    return req.user?.tenantId || 'global';
}

router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const stats = getTrafficStats();
        const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
        const storedFlows = await securityOperationsService.listTrafficSessionsView(tenantOf(req), 200);

        const sys = SystemStats.getInstance();

        res.json({
            uptime,
            packetsProcessed: Math.max(stats.packetsProcessed, storedFlows.reduce((sum: number, flow: any) => sum + Number(flow.packet_count || 0), 0)),
            packetsAllowed: stats.packetsAllowed,
            packetsBlocked: stats.packetsBlocked,
            packetsInspected: stats.packetsInspected,
            bytesProcessed: Math.max(stats.bytesProcessed, storedFlows.reduce((sum: number, flow: any) => sum + Number(flow.byte_count || 0), 0)),
            currentFlows: Math.max(stats.activeFlows.length, storedFlows.length),
            activeConnections: Math.max(stats.activeFlows.filter((f: any) => f.state === 'ESTABLISHED').length, storedFlows.filter((f: any) => f.state === 'ESTABLISHED').length),
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

router.get('/flows', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const stats = getTrafficStats();
        const storedFlows = (await securityOperationsService.listTrafficSessionsView(tenantOf(req), 50)).map((flow: any) => ({
            id: flow.session_id,
            sourceIP: flow.source_ip,
            destIP: flow.dest_ip,
            sourcePort: Number(flow.source_port || 0),
            destPort: Number(flow.dest_port || 0),
            protocol: flow.protocol,
            state: flow.state,
            packetCount: Number(flow.packet_count || 0),
            byteCount: Number(flow.byte_count || 0),
            startTime: flow.start_time,
            lastActivity: flow.last_activity,
            ...(JSON.parse(flow.metadata_json || '{}'))
        }));

        if (storedFlows.length > 0) {
            res.json(storedFlows);
        } else if (stats.activeFlows.length > 0) {
            res.json(stats.activeFlows.slice(0, 20));
        } else {
            res.json([]);
        }
    } catch (error: any) {
        logger.error('Failed to get flows', { error: error.message });
        res.json([]);
    }
});

router.get('/flows/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const tenantId = tenantOf(req);
        const session = await securityOperationsService.getTrafficSessionByIdView(tenantId, req.params.id);

        if (!session) {
            return res.status(404).json({ success: false, error: 'backend.traffic_session_not_found' });
        }

        const metadata = session.metadata || {};
        const sourceAsset = session.sourceAssetId
            ? await securityOperationsService.getAssetByIdView(tenantId, session.sourceAssetId)
            : null;
        const destAsset = session.destAssetId
            ? await securityOperationsService.getAssetByIdView(tenantId, session.destAssetId)
            : null;
        const assetContext = await securityOperationsService.getOperationalContextForAssetIdsView(
            tenantId,
            [session.sourceAssetId, session.destAssetId].filter(Boolean) as string[],
            10
        );
        const validationRuns = metadata.attackId
            ? await securityOperationsService.listValidationRunsByAttackIdView(tenantId, String(metadata.attackId), 10)
            : [];
        const relatedFindings = assetContext.findings.filter((finding: any) =>
            metadata.attackId
                ? String(finding.evidence?.attackId || '') === String(metadata.attackId) ||
                  String(finding.sourceRef || '') === String(metadata.simulationId || '')
                : true
        );
        const findingIds = new Set(relatedFindings.map((finding: any) => finding.findingId));
        const relatedAlerts = assetContext.alerts.filter((alert: any) =>
            !alert.findingId || findingIds.size === 0 || findingIds.has(alert.findingId)
        );
        const relatedActions = assetContext.actions.filter((action: any) =>
            (!action.findingId && !action.alertId) ||
            (action.findingId && findingIds.has(action.findingId)) ||
            (action.alertId && relatedAlerts.some((alert: any) => alert.id === action.alertId))
        );

        res.json({
            success: true,
            data: {
                summary: {
                    id: session.sessionId,
                    sourceIP: session.sourceIP,
                    destIP: session.destIP,
                    sourcePort: session.sourcePort,
                    destPort: session.destPort,
                    protocol: session.protocol,
                    state: session.state,
                    packetCount: session.packetCount,
                    byteCount: session.byteCount,
                    startTime: session.startTime,
                    lastActivity: session.lastActivity
                },
                metadata,
                relatedAssets: [sourceAsset, destAsset].filter(Boolean),
                relatedFindings,
                relatedAlerts,
                relatedActions,
                relatedValidations: validationRuns,
                relatedScans: assetContext.scanRuns,
                serviceExposure: assetContext.serviceExposure,
                timeline: [
                    { title: 'Session started', description: `${session.sourceIP}:${session.sourcePort} -> ${session.destIP}:${session.destPort}`, timestamp: session.startTime },
                    { title: 'Last activity', description: `State ${session.state}`, timestamp: session.lastActivity },
                    ...validationRuns.map((run: any) => ({
                        title: 'Validation correlation',
                        description: `${run.attackName} finished with verdict ${run.verdict}`,
                        timestamp: run.completedAt
                    })),
                    ...relatedAlerts.slice(0, 5).map((alert: any) => ({
                        title: 'Alert correlation',
                        description: `${alert.title} is ${alert.status}`,
                        timestamp: alert.timestamp
                    }))
                ]
            }
        });
    } catch (error: any) {
        logger.error('Failed to get traffic flow detail', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.failed_to_fetch_traffic_session' });
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

router.get('/threats', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const stats = getTrafficStats();
        const threats = Array.from(stats.threats.values());
        const persistedThreats = await securityOperationsService.summarizeThreatsView(tenantOf(req));

        if (persistedThreats.length > 0) {
            res.json(persistedThreats);
        } else if (threats.length > 0) {
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
