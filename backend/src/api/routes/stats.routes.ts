/**
 * Stats Routes - Dashboard statistics
 * Public endpoints (no auth required for read-only dashboard data)
 */
import { Router, Request, Response } from 'express';
import { sendSuccess, sendError } from '../../core/http/api-response';
import { getTrafficStats } from '../../services/traffic-stats.service';
import { getAgentGateway, getAgentSystem } from '../../services/agent-system.service';
import { getAlerts } from '../../services/alert-state.service';
import { getDeviceList } from '../../services/device-registry.service';
import { SystemStats } from '../../utils/system-stats';
import { securityOperationsService } from '../../services/security-operations.service';
import { detectionPipelineService } from '../../services/detection-pipeline.service';

const router = Router();

// Rolling history: keep last 20 data points (sampled on each request)
interface HistoryPoint {
    time: string;
    requests: number;
    blocked: number;
}

interface AttackOrigin {
    country: string;
    countryCode: string;
    count: number;
    percentage: number;
}

const historyBuffer: HistoryPoint[] = [];
let lastSampledRequests = 0;
let lastSampledBlocked = 0;
let lastSampleTime = Date.now();

function sampleHistory(total: number, blocked: number): void {
    const now = Date.now();
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

// Cache ops summary to avoid slow AI calls on every request
let cachedOpsSummary: any = {
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
};

// Cache alerts to avoid slow DB/AI calls on every stats request
// Initialize with empty array - will be populated by background refresh
let cachedAlerts: any[] = [];

// Attack origins populated from real traffic
let cachedAttackOrigins: AttackOrigin[] = [];

// Background refresh (non-blocking, errors ignored)
const refreshCache = async () => {
    try {
        cachedOpsSummary = await securityOperationsService.getDashboardSummaryView('global');
    } catch {}
    try {
        cachedAlerts = await getAlerts('global');
    } catch {}
};

// Start background refresh after 5 seconds (allow server to start first)
setTimeout(() => {
    refreshCache();
    setInterval(refreshCache, 30_000);
}, 5_000);

// Track incoming API requests for traffic stats
let apiRequestCount = 0;
let apiBlockedCount = 0;

export function recordApiRequest(blocked: boolean = false, sourceIP?: string): void {
    apiRequestCount++;
    if (blocked) apiBlockedCount++;
    const ts = getTrafficStats();
    ts.packetsProcessed = apiRequestCount;
    ts.packetsBlocked = apiBlockedCount;
    ts.packetsAllowed = apiRequestCount - apiBlockedCount;

    // Track blocked request origins by source IP
    if (blocked && sourceIP) {
        const existing = cachedAttackOrigins.find(o => o.country === sourceIP);
        if (existing) {
            existing.count++;
        } else {
            cachedAttackOrigins.push({ country: sourceIP, countryCode: 'Unknown', count: 1, percentage: 0 });
        }
        // Recalculate percentages
        const total = cachedAttackOrigins.reduce((s, o) => s + o.count, 0);
        for (const o of cachedAttackOrigins) {
            o.percentage = total > 0 ? (o.count / total) * 100 : 0;
        }
    }
}

// GET /stats - public dashboard endpoint
router.get('/', async (req: any, res: any) => {
    try {
        // Count this request
        recordApiRequest(false);

        const ts = getTrafficStats();

        const total = ts.packetsProcessed;
        const blocked = ts.packetsBlocked;
        const allowed = ts.packetsAllowed;

        // Update rolling history
        sampleHistory(total, blocked);

        // Dynamic Global Health Score calculation
        // Health reflects system's ability to handle traffic properly
        // Blocked attacks count as "successfully handled" (security working)
        // Penalized only by: unresolved alerts, offline devices, errors
        const handledRequests = allowed + blocked; // All requests that got a response
        let successRate = total > 0 ? Math.round((handledRequests / total) * 100) : 100;

        // Use cached alerts (no AI/DB call on every request)
        const alerts = cachedAlerts.filter((a: any) => a.status !== 'resolved' && a.status !== 'suppressed');
        const devices = getDeviceList();

        const offlineDevices = devices.filter((d: any) => !d.isOnline).length;
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

        const threatEntries = Array.from(ts.threats.values());

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

        const cpuOverhead = ts.activeFlows.length > 0 ? (ts.activeFlows.length * 0.5) : 0;
        const p99Latency = Math.round(Math.max(avgProcessingTime * 1.5, avgProcessingTime + cpuOverhead + Math.random() * 5));

        const sys = SystemStats.getInstance();
        const detectionPipeline = await detectionPipelineService.getSummary('global').catch(() => null);

        sendSuccess(res, {
            totalRequests: total,
            blockedRequests: blocked,
            activeConnections: ts.activeFlows.filter((f: any) => f.state === 'ESTABLISHED').length,
            successRate,
            avgProcessingTime,
            currentRPS: 0,
            history: historyBuffer,
            attackOrigins: cachedAttackOrigins,
            threats: threatEntries,
            requestsTrend,
            blockedTrend,
            p99Latency,
            cpuUsage: sys.cpuUsage,
            memoryUsage: sys.memoryUsage,
            diskUsage: sys.diskUsage,
            networkUsage: sys.networkUsageMb,
            securityOperations: cachedOpsSummary,
            detectionPipeline
        });
    } catch (err: any) {
        sendError(res, 500, { code: 'STATS_ERROR', message: err.message });
    }
});

// GET /stats/badges - public dashboard badges
router.get('/badges', async (req: any, res: any) => {
    try {
        const activeAlertsCount = cachedAlerts.filter((a: any) => a.status !== 'resolved' && a.status !== 'suppressed').length;

        const devices = getDeviceList();
        const onlineDevicesCount = devices.filter((d: any) => d.isOnline).length;

        // Get agents from gateway only (no AI calls)
        const runtimeAgents = getAgentGateway()?.getAgentList?.() || [];
        const agentsCount = runtimeAgents.filter((agent: any) => agent.isOnline).length;

        const summary = cachedOpsSummary;

        sendSuccess(res, {
            alerts: activeAlertsCount,
            devices: onlineDevicesCount,
            agents: agentsCount,
            agentMonitor: summary.runningScans + summary.pendingActions + summary.failedValidations + summary.queuedScans + summary.trafficAnomalies,
            traffic: summary.trafficAnomalies,
            scanner: summary.runningScans + summary.highRiskFindings + summary.pendingActions
        });
    } catch (err: any) {
        sendError(res, 500, { code: 'BADGES_ERROR', message: err.message });
    }
});

export default router;
