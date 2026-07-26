/**
 * Stats Routes - Dashboard statistics
 * Authenticated, tenant-scoped dashboard statistics.
 */
import { Router } from 'express';
import { sendSuccess, sendError } from '../../core/http/api-response';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';
import { getTrafficStats } from '../../services/traffic-stats.service';
import { getAgentGateway } from '../../services/agent-system.service';
import { getAlerts } from '../../services/alert-state.service';
import { getDeviceList } from '../../services/device-registry.service';
import { SystemStats } from '../../utils/system-stats';
import { securityOperationsService } from '../../services/security-operations.service';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { getTrafficHistory, normalizeRange } from '../../services/traffic-history.service';
import metrics, { HistogramSample } from '../../observability/metrics';
import { getApiBlockedCount, getCachedAttackOrigins } from '../../services/api-request-tracker.service';

const router = Router();
router.use((req: AuthenticatedRequest, res, next) => {
    if (req.user) {
        next();
        return;
    }
    void authenticate(req, res, next);
});

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

const emptyOpsSummary = {
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

interface TenantStatsCache {
    opsSummary: any;
    alerts: any[];
    updatedAt: number;
}

const tenantStatsCache = new Map<string, TenantStatsCache>();
const TENANT_CACHE_TTL_MS = 30_000;

async function loadTenantCache(tenantId: string): Promise<TenantStatsCache> {
    const cached = tenantStatsCache.get(tenantId);
    if (cached && Date.now() - cached.updatedAt < TENANT_CACHE_TTL_MS) {
        return cached;
    }

    const [opsSummary, alerts] = await Promise.all([
        Promise.resolve(securityOperationsService.getDashboardSummaryView(tenantId))
            .catch(() => cached?.opsSummary || emptyOpsSummary),
        Promise.resolve(getAlerts(tenantId))
            .catch(() => cached?.alerts || [])
    ]);
    const next = { opsSummary, alerts, updatedAt: Date.now() };
    tenantStatsCache.set(tenantId, next);
    return next;
}

function tenantOf(req: AuthenticatedRequest): string | null {
    return resolveRequestTenantContext(req, { allowAdminPlatformFallback: true })?.tenantId || null;
}

interface HttpMetricsSummary {
    total: number;
    serverErrors: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
}

function businessSamples<T extends { labels: Record<string, string> }>(samples: T[]): T[] {
    return samples.filter((sample) => !sample.labels.scope || sample.labels.scope === 'business');
}

function approximateP99(samples: HistogramSample[]): number {
    const count = samples.reduce((sum, sample) => sum + sample.count, 0);
    if (count === 0) return 0;

    const target = Math.ceil(count * 0.99);
    const boundaries = Array.from(new Set(
        samples.flatMap((sample) => Array.from(sample.buckets.keys()))
    )).sort((a, b) => a - b);

    for (const boundary of boundaries) {
        const cumulative = samples.reduce(
            (sum, sample) => sum + (sample.buckets.get(boundary) || 0),
            0
        );
        if (cumulative >= target) return boundary;
    }

    return Math.ceil(Math.max(...samples.map((sample) => sample.max), 0));
}

function getHttpMetricsSummary(): HttpMetricsSummary {
    const counters = businessSamples(metrics.getCounterSamples('http_requests_total'));
    const histograms = businessSamples(metrics.getHistogramSamples('http_request_duration_ms'));
    const total = counters.reduce((sum, sample) => sum + sample.value, 0);
    const serverErrors = counters.reduce((sum, sample) => {
        const status = Number(sample.labels.status);
        return sum + (status >= 500 ? sample.value : 0);
    }, 0);
    const durationCount = histograms.reduce((sum, sample) => sum + sample.count, 0);
    const durationSum = histograms.reduce((sum, sample) => sum + sample.sum, 0);

    return {
        total,
        serverErrors,
        avgLatencyMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
        p99LatencyMs: approximateP99(histograms)
    };
}

router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = tenantOf(req);
        if (!tenantId) {
            return sendError(res, 403, {
                code: 'TENANT_CONTEXT_REQUIRED',
                message: 'backend.tenant_context_required'
            });
        }
        const tenantCache = await loadTenantCache(tenantId);
        const isPlatformTenant = tenantId === PLATFORM_TENANT_ID;

        const ts = getTrafficStats();
        const httpMetrics = getHttpMetricsSummary();

        const total = isPlatformTenant ? httpMetrics.total : 0;
        const blocked = isPlatformTenant ? Math.min(getApiBlockedCount(), total) : 0;

        if (isPlatformTenant) {
            sampleHistory(total, blocked);
        }

        // Dynamic Global Health Score calculation
        // Health reflects system's ability to handle traffic properly
        // Blocked attacks count as "successfully handled" (security working)
        // Penalized only by: unresolved alerts, offline devices, errors
        let successRate = isPlatformTenant
            ? (total > 0 ? Math.round(((total - httpMetrics.serverErrors) / total) * 100) : 0)
            : 0;

        // Use cached alerts (no AI/DB call on every request)
        const alerts = tenantCache.alerts.filter((a: any) => a.status !== 'resolved' && a.status !== 'suppressed');
        // The in-memory device registry is platform-scoped and has no tenant key.
        // Do not expose it to tenant sessions until the registry itself is tenant-aware.
        const devices = isPlatformTenant ? getDeviceList() : [];

        const offlineDevices = devices.filter((d: any) => !d.isOnline).length;
        const totalDevices = devices.length;

        if (alerts.length > 0) {
            successRate = Math.max(0, successRate - (alerts.length * 2));
        }
        if (totalDevices > 0) {
            const deviceHealthImpact = (offlineDevices / totalDevices) * 15;
            successRate = Math.max(0, Math.round(successRate - deviceHealthImpact));
        }

        const avgProcessingTime = isPlatformTenant ? httpMetrics.avgLatencyMs : 0;

        const threatEntries = isPlatformTenant ? Array.from(ts.threats.values()) : [];

        let requestsTrend = 0;
        let blockedTrend = 0;
        if (isPlatformTenant && historyBuffer.length >= 2) {
            const older = historyBuffer.slice(0, Math.floor(historyBuffer.length / 2));
            const newer = historyBuffer.slice(Math.floor(historyBuffer.length / 2));
            const oldReq = older.reduce((a, b) => a + b.requests, 0) || 1;
            const newReq = newer.reduce((a, b) => a + b.requests, 0);
            const oldBlk = older.reduce((a, b) => a + b.blocked, 0) || 1;
            const newBlk = newer.reduce((a, b) => a + b.blocked, 0);
            requestsTrend = parseFloat((((newReq - oldReq) / oldReq) * 100).toFixed(1));
            blockedTrend = parseFloat((((newBlk - oldBlk) / oldBlk) * 100).toFixed(1));
        }

        const p99Latency = isPlatformTenant ? httpMetrics.p99LatencyMs : 0;

        const sys = SystemStats.getInstance();
        const detectionPipeline = await detectionPipelineService.getSummary(tenantId).catch(() => null);

        // Real fixed-interval history for the requested window (persisted samples,
        // bucketed uniformly). Falls back to the in-process ring only while no
        // persisted samples exist yet (fresh DB / first minutes after boot), so an
        // existing dashboard never renders empty during warm-up.
        const range = normalizeRange(req.query.range);
        const persistedHistory = isPlatformTenant ? getTrafficHistory(range) : [];
        const history = isPlatformTenant
            ? (persistedHistory.some((b) => b.requests > 0 || b.blocked > 0) ? persistedHistory : historyBuffer)
            : [];

        sendSuccess(res, {
            telemetryAvailable: isPlatformTenant,
            totalRequests: total,
            blockedRequests: blocked,
            activeConnections: isPlatformTenant
                ? ts.activeFlows.filter((f: any) => f.state === 'ESTABLISHED').length
                : 0,
            successRate,
            avgProcessingTime,
            currentRPS: 0,
            range,
            history,
            attackOrigins: isPlatformTenant ? getCachedAttackOrigins() : [],
            threats: threatEntries,
            requestsTrend,
            blockedTrend,
            p99Latency,
            cpuUsage: isPlatformTenant ? sys.cpuUsage : 0,
            memoryUsage: isPlatformTenant ? sys.memoryUsage : 0,
            diskUsage: isPlatformTenant ? sys.diskUsage : 0,
            networkUsage: isPlatformTenant ? sys.networkUsageMb : 0,
            securityOperations: tenantCache.opsSummary,
            detectionPipeline
        });
    } catch (err: any) {
        sendError(res, 500, { code: 'STATS_ERROR', message: err.message });
    }
});

router.get('/badges', async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = tenantOf(req);
        if (!tenantId) {
            return sendError(res, 403, {
                code: 'TENANT_CONTEXT_REQUIRED',
                message: 'backend.tenant_context_required'
            });
        }
        const tenantCache = await loadTenantCache(tenantId);
        const isPlatformTenant = tenantId === PLATFORM_TENANT_ID;
        const activeAlertsCount = tenantCache.alerts.filter((a: any) => a.status !== 'resolved' && a.status !== 'suppressed').length;

        const devices = isPlatformTenant ? getDeviceList() : [];
        const onlineDevicesCount = devices.filter((d: any) => d.isOnline).length;

        // Get agents from gateway only (no AI calls)
        const runtimeAgents = getAgentGateway()?.getAgentList?.() || [];
        const agentsCount = runtimeAgents.filter((agent: any) =>
            agent.isOnline && (isPlatformTenant || agent.tenantId === tenantId)
        ).length;

        const summary = tenantCache.opsSummary;

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
