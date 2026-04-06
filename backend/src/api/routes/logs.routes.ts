import { Router } from 'express';
import logger from '../../utils/logger';
import { getTrafficStats } from '../../services/traffic-stats.service';
import { getAgentSystem } from '../../services/agent-system.service';
import { addLog, getRecentLogs } from '../../services/log-state.service';

const router = Router();

// GET /logs - public endpoint for dashboard (no auth required)
router.get('/', (req, res) => {
    try {
        const trafficStats = getTrafficStats();
        const agentSystem = getAgentSystem();
        const logs = getRecentLogs();

        if (agentSystem && agentSystem.isInitialized()) {
            const probeReport = agentSystem.getProbeReport();
            const alerts = probeReport.alerts || [];

            alerts.forEach((alert: any) => {
                logs.push(addLog({
                    type: alert.metadata?.threatType || 'Security',
                    level: alert.severity === 'critical' ? 'CRITICAL' : 'WARN',
                    message: alert.message || 'Security event detected',
                    ip: alert.metadata?.sourceIP || 'unknown',
                    status: 403,
                    method: alert.metadata?.method || 'POST',
                    path: alert.metadata?.path || '/api/unknown'
                }));
            });
        }

        trafficStats.activeFlows.forEach((flow: any) => {
            if (flow.state === 'BLOCKED') {
                addLog({
                    type: flow.attackName || 'Blocked',
                    level: 'WARN',
                    message: `Blocked request from ${flow.sourceIP}`,
                    ip: flow.sourceIP,
                    status: 403,
                    method: 'POST',
                    path: '/api/protected'
                });
            }
        });

        // Sort by time descending
        logs.sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime());
        res.json(logs.slice(0, 50));
    } catch (error: any) {
        logger.error('Failed to get logs', { error: error.message });
        res.json([]);
    }
});

export default router;
