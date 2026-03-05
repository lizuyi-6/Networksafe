import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';
import { getTrafficStats, getAgentSystem } from './ai-system.routes';
import { isDemoMode } from '../../config/app-mode';

const router = Router();

interface LogItem {
    id: number;
    time: string;
    type: string;
    level: string;
    message: string;
    ip: string;
    status?: number;
    method?: string;
    path?: string;
}

let logCounter = 0;
const recentLogs: LogItem[] = [];

export const addLog = (log: Omit<LogItem, 'id' | 'time'>) => {
    const newLog: LogItem = {
        ...log,
        id: ++logCounter,
        time: new Date().toISOString()
    };
    recentLogs.unshift(newLog);
    if (recentLogs.length > 100) {
        recentLogs.pop();
    }
    return newLog;
};

router.get('/', authenticate, (req, res) => {
    try {
        const trafficStats = getTrafficStats();
        const agentSystem = getAgentSystem();
        const logs: LogItem[] = [...recentLogs];

        if (agentSystem && agentSystem.isInitialized()) {
            const probeReport = agentSystem.getProbeReport();
            const alerts = probeReport.alerts || [];

            alerts.forEach((alert: any, index: number) => {
                logs.push({
                    id: logCounter + index + 1,
                    time: alert.timestamp || new Date().toISOString(),
                    type: alert.metadata?.threatType || 'Security',
                    level: alert.severity === 'critical' ? 'ERROR' : 'WARN',
                    message: alert.message || 'Security event detected',
                    ip: alert.metadata?.sourceIP || 'unknown',
                    status: 403,
                    method: alert.metadata?.method || 'POST',
                    path: alert.metadata?.path || '/api/unknown'
                });
            });
        }

        trafficStats.activeFlows.forEach((flow: any, index: number) => {
            if (flow.state === 'BLOCKED') {
                logs.push({
                    id: logCounter + 1000 + index,
                    time: flow.lastActivity || new Date().toISOString(),
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

        // 无论是否是演示模式，都返回真实数据
        logs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        res.json(logs.slice(0, 50));
    } catch (error: any) {
        logger.error('Failed to get logs', { error: error.message });
        res.json([]);
    }
});

export default router;
