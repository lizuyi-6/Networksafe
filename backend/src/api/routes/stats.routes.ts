/**
 * Stats Routes
 * SECURITY FIX CVE-2026-039: Added authentication middleware
 */
import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getTrafficStats, getAgentGateway, getAgentSystem } from './ai-system.routes';
import { getAlerts } from './alerts.routes';
import { getDeviceList } from './devices.routes';
import { SystemStats } from '../../utils/system-stats';
import { securityOperationsService } from '../../services/security-operations.service';

const router = Router();

// Rolling history: keep last 20 data points (sampled on each request)
interface HistoryPoint {
    time: string;
    requests: number;
    blocked: number;
}

const historyBuffer: HistoryPoint[] = [];
let lastSampledRequests = 0;
let lastSampledBlocked = 0;
let lastSampleTime = Date.now();

function sampleHistory(total: number, blocked: number): void {
    const now = Date.now();
    // Only add a new point if at least 2 seconds have passed
    if (now - lastSampleTime < 2000) return;

    const label = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    historyBuffer.push({
        time: label,
        requests: total - lastSampledRequests,
        blocked: blocked - lastSampledBlocked
    });

    if (historyBuffer.length > 20) {
        historyBuffer.shift();
    }

    lastSampledRequests = total;
    lastSampledBlocked = blocked;
    lastSampleTime = now;
}

// SECURITY FIX CVE-2026-039: Apply authentication
router.use(authenticate);

router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
        const ts = getTrafficStats();

        const total = ts.packetsProcessed;
        const blocked = ts.packetsBlocked;
        const allowed = ts.packetsAllowed;

        // Update rolling history
        sampleHistory(total, blocked);

        // Dynamic Global Health Score calculation
        let successRate = total > 0 ? Math.round((allowed / total) * 100) : 100;

        // Adjust health based on system alerts and offline devices
        const agentGateway = getAgentSystem() as any;
        const tenantId = req.user?.tenantId || 'global';
        const alerts = (await getAlerts(tenantId)).filter(a => a.status !== 'resolved' && a.status !== 'suppressed');
        const devices = getDeviceList();
        const opsSummary = await securityOperationsService.getDashboardSummaryView(tenantId);

        const offlineDevices = devices.filter(d => !d.isOnline).length;
        const totalDevices = devices.length;

        if (alerts.length > 0) {
            successRate = Math.max(0, successRate - (alerts.length * 2));
        }
        if (totalDevices > 0) {
            const deviceHealthImpact = (offlineDevices / totalDevices) * 15;
            successRate = Math.max(0, Math.round(successRate - deviceHealthImpact));
        }

        // Average processing time estimate (ms)
        const avgProcessingTime = total > 0
            ? Math.max(1, Math.floor(ts.bytesProcessed / total / 100))
            : 0;

        // Attack origins derived from threat categories
        const threatEntries = Array.from(ts.threats.values());
        const totalThreats = threatEntries.reduce((sum, t) => sum + t.count, 0);
        const attackOrigins = threatEntries.map(t => ({
            country: t.type,
            countryCode: 'Unknown',
            count: t.count,
            percentage: totalThreats > 0 ? (t.count / totalThreats) * 100 : 0
        }));

        let requestsTrend = 0;
        let blockedTrend = 0;
        if (historyBuffer.length >= 2) {
            const older = historyBuffer.slice(0, Math.floor(historyBuffer.length / 2));
            const newer = historyBuffer.slice(Math.floor(historyBuffer.length / 2));
            const oldReq = older.reduce((a, b) => a + b.requests, 0) || 1;
            const newReq = newer.reduce((a, b) => a + b.requests, 0);
            const oldBlk = older.reduce((a, b) => a + b.blocked, 0) || 1;
            const newBlk = newer.reduce((a, b) => a + b.blocked, 0);
            requestsTrend = parseFloat((((newReq - oldReq) / oldReq) * 100).toFixed(1));
            blockedTrend = parseFloat((((newBlk - oldBlk) / oldBlk) * 100).toFixed(1));
        }
        // Simulate P99 latency dynamically using system load
        const cpuOverhead = ts.activeFlows.length > 0 ? (ts.activeFlows.length * 0.5) : 0;
        const p99Latency = Math.round(Math.max(avgProcessingTime * 1.5, avgProcessingTime + cpuOverhead + Math.random() * 5));

        const sys = SystemStats.getInstance();

        res.json({
            totalRequests: total,
            blockedRequests: blocked,
            activeConnections: ts.activeFlows.filter((f: any) => f.state === 'ESTABLISHED').length,
            successRate,
            avgProcessingTime,
            currentRPS: 0,
            history: historyBuffer,
            attackOrigins,
            threats: threatEntries,
            requestsTrend,
            blockedTrend,
            p99Latency,
            cpuUsage: sys.cpuUsage,
            memoryUsage: sys.memoryUsage,
            diskUsage: sys.diskUsage,
            networkUsage: sys.networkUsageMb,
            securityOperations: opsSummary
        });
    } catch (err: any) {
        res.json({
            totalRequests: 0,
            blockedRequests: 0,
            activeConnections: 0,
            successRate: 100,
            avgProcessingTime: 0,
            currentRPS: 0,
            history: [],
            attackOrigins: [],
            threats: [],
            requestsTrend: 0,
            blockedTrend: 0,
            p99Latency: 0,
            cpuUsage: 0,
            memoryUsage: 0,
            diskUsage: 0,
            networkUsage: 0,
            securityOperations: {
                openCriticalFindings: 0,
                highRiskFindings: 0,
                activeAlerts: 0,
                runningScans: 0,
                queuedScans: 0,
                pendingActions: 0,
                failedValidations: 0,
                assetsAtRisk: 0,
                observedSessions: 0,
                trafficAnomalies: 0,
                recentActions: [],
                recentValidations: []
            }
        });
    }
});

router.get('/badges', async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = req.user?.tenantId || 'global';
        const alerts = await getAlerts(tenantId);
        const activeAlertsCount = alerts.filter(a => a.status !== 'resolved' && a.status !== 'suppressed').length;

        const devices = getDeviceList();
        const onlineDevicesCount = devices.filter(d => d.isOnline).length;

        const agentSystem = getAgentSystem();
        const runtimeAgents = getAgentGateway()?.getAgentList?.() || [];
        let agentsCount = runtimeAgents.filter((agent: any) => agent.isOnline).length;
        if (agentSystem && agentSystem.isInitialized()) {
            const probeReport = agentSystem.getProbeReport();
            agentsCount = Math.max(agentsCount, probeReport.agents?.length || 0);
        }
        const summary = await securityOperationsService.getDashboardSummaryView(tenantId);
        const trafficThreats = await securityOperationsService.summarizeThreatsView(tenantId);
        const trafficSessions = await securityOperationsService.listTrafficSessionsView(tenantId, 200);
        const recentTrafficSessions = trafficSessions.filter((flow: any) => {
            const activity = new Date(flow.last_activity || flow.lastActivity || 0).getTime();
            return Number.isFinite(activity) && Date.now() - activity <= 24 * 60 * 60 * 1000;
        }).length;

        res.json({
            alerts: activeAlertsCount,
            devices: onlineDevicesCount,
            agents: agentsCount,
            agentMonitor: summary.runningScans + summary.pendingActions + summary.failedValidations + summary.queuedScans + summary.trafficAnomalies,
            traffic: Math.max(summary.trafficAnomalies, recentTrafficSessions, trafficThreats.reduce((sum, item) => sum + item.count, 0)),
            scanner: summary.runningScans + summary.highRiskFindings + summary.pendingActions
        });
    } catch (err: any) {
        res.json({ alerts: 0, devices: 0, agents: 0, agentMonitor: 0, traffic: 0, scanner: 0 });
    }
});

export default router;
