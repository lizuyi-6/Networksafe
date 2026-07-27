import { useEffect, useMemo, useState } from 'react';
import { motion, Variants } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useLanguage } from '../context/LanguageContext';
import {
    Activity,
    AlertTriangle,
    Cpu,
    Database,
    Globe,
    HardDrive,
    Server,
    Shield,
    Zap,
} from 'lucide-react';
import {
    fetchAdminApiKeys,
    fetchCurrentUserSession,
    fetchDashboardRulesSummary,
    fetchLogs,
    fetchStats,
    isRequestAbortError,
} from '../services/api';
import { DashboardSecuritySummary, DashboardStats, LogItem } from '../types/api';
import ErrorDisplay from '../components/ErrorDisplay';
import { useWebSocket } from '../context/WebSocketContext';
import { useLiveMode } from '../context/LiveModeContext';
import { ConsolePanel, ConsoleEmptyState } from '../components/ConsolePrimitives';
import StableResponsiveChart from '../components/StableResponsiveChart';

// New dashboard sub-components
import { DashboardHeader, TimeRange } from '../components/dashboard/DashboardHeader';
import { MetricBar, MetricItem } from '../components/dashboard/MetricBar';
import { SystemGauges, GaugeItem } from '../components/dashboard/SystemGauges';
import { ThreatIntelPanel } from '../components/dashboard/ThreatIntelPanel';
import { SecurityOpsPanel } from '../components/dashboard/SecurityOpsPanel';
import { LiveLogStream } from '../components/dashboard/LiveLogStream';
import { AdminKeySection } from '../components/dashboard/AdminKeySection';

const defaultSecuritySummary: DashboardSecuritySummary = {
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
    recentValidations: [],
};

const staggerContainerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.06 },
    },
};

const fadeUpVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
};

// Traffic chart (kept inline as it's tightly coupled to the page data)
interface TrafficPoint {
    time: string;
    requests: number;
    blocked: number;
}

const formatCount = (n: number) => (typeof n === 'number' ? n.toLocaleString() : n);

// requests and blocked differ by ~2-3 orders of magnitude, so plotting them on one
// shared axis pins the blocked line to the baseline. Small multiples give each series
// its own self-scaled axis while keeping the shared time axis for comparison.
const TrafficTooltip = ({
    active,
    payload,
    label,
    seriesLabel,
}: {
    active?: boolean;
    payload?: Array<{ value: number; color: string }>;
    label?: string;
    seriesLabel: string;
}) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    return (
        <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-md">
            <div className="mb-1 font-medium text-muted-foreground">{label}</div>
            <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-foreground">{seriesLabel}</span>
                <span className="ml-3 font-mono font-semibold text-foreground">{formatCount(entry.value)}</span>
            </div>
        </div>
    );
};

const TrafficMiniChart = ({
    data,
    dataKey,
    color,
    gradientId,
    seriesLabel,
    loadingText,
}: {
    data: TrafficPoint[];
    dataKey: 'requests' | 'blocked';
    color: string;
    gradientId: string;
    seriesLabel: string;
    loadingText: string;
}) => (
    <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {seriesLabel}
        </div>
        <StableResponsiveChart minHeight={150} loadingText={loadingText}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} dy={6} minTickGap={24} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatCount(v as number)} />
                <Tooltip content={<TrafficTooltip seriesLabel={seriesLabel} />} />
                <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fillOpacity={1} fill={`url(#${gradientId})`} />
            </AreaChart>
        </StableResponsiveChart>
    </div>
);

const TrafficChart = ({
    data,
    loadingText,
    requestsLabel,
    blockedLabel,
    emptyTitle,
    emptyDesc,
}: {
    data: TrafficPoint[];
    loadingText: string;
    requestsLabel: string;
    blockedLabel: string;
    emptyTitle: string;
    emptyDesc: string;
}) => {
    if (!data.length) {
        return <ConsoleEmptyState title={emptyTitle} description={emptyDesc} />;
    }
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <TrafficMiniChart data={data} dataKey="requests" color="hsl(var(--chart-requests))" gradientId="colorRequests" seriesLabel={requestsLabel} loadingText={loadingText} />
            <TrafficMiniChart data={data} dataKey="blocked" color="hsl(var(--chart-blocked))" gradientId="colorBlocked" seriesLabel={blockedLabel} loadingText={loadingText} />
        </div>
    );
};

export default function Dashboard() {
    const { subscribe } = useWebSocket();
    const { liveModeEnabled } = useLiveMode();
    const { t } = useLanguage();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [logs, setLogs] = useState<LogItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [rulesSummary, setRulesSummary] = useState<{ totalRules: number; topRules: any[] }>({ totalRules: 0, topRules: [] });
    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [userRole, setUserRole] = useState('viewer');
    const [timeRange, setTimeRange] = useState<TimeRange>('1h');
    const [filterQuery, setFilterQuery] = useState('');
    const [paused, setPaused] = useState(false);
    const [exportMessage, setExportMessage] = useState<string | null>(null);

    const filteredLogs = useMemo(() => logs.filter((log) => {
        if (!filterQuery.trim()) return true;
        const query = filterQuery.toLowerCase();
        return [log.type, log.level, log.message, log.path, log.method, String(log.status || '')]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
    }), [filterQuery, logs]);

    // The backend now serves a real fixed-interval window for the requested range
    // (persisted samples bucketed uniformly), keyed off the ?range= param we send
    // with each fetch. history therefore already spans the selected window — no
    // client-side slicing needed.
    const filteredHistory = useMemo(() => stats?.history || [], [stats?.history]);

    const securitySummary = stats?.securityOperations || defaultSecuritySummary;

    // --- Data fetching (unchanged) ---
    useEffect(() => {
        let disposed = false;
        let controller: AbortController | null = null;

        const loadData = async () => {
            controller?.abort();
            controller = new AbortController();
            try {
                const statsData = await fetchStats(controller.signal, timeRange);
                if (!disposed && statsData) {
                    setStats(statsData);
                    setError(null);
                }
            } catch (err: any) {
                if (!disposed && !isRequestAbortError(err, controller.signal)) {
                    setError(err.message || 'FG-DASHBOARD-STATS');
                }
            }
        };

        void loadData();
        if (!liveModeEnabled || paused) {
            return () => {
                disposed = true;
                controller?.abort();
            };
        }

        const interval = setInterval(() => {
            void loadData();
        }, 4000);

        return () => {
            disposed = true;
            controller?.abort();
            clearInterval(interval);
        };
    }, [liveModeEnabled, paused, timeRange]);

    useEffect(() => {
        let disposed = false;
        const controller = new AbortController();

        void fetchLogs(controller.signal)
            .then((rows) => {
                if (!disposed && Array.isArray(rows)) {
                    setLogs(rows);
                }
            })
            .catch((err) => {
                if (!disposed && !isRequestAbortError(err, controller.signal)) {
                    setError(err.message || 'FG-DASHBOARD-LOGS');
                }
            });

        const unsubscribe = subscribe('agent:log', (logData: any) => {
            if (paused) return;
            setLogs((prev) => [logData, ...prev].slice(0, 100));
        });

        return () => {
            disposed = true;
            controller.abort();
            unsubscribe();
        };
    }, [paused, subscribe]);

    useEffect(() => {
        let disposed = false;
        const controller = new AbortController();

        const loadSideData = async () => {
            try {
                const user = await fetchCurrentUserSession(controller.signal);
                const role = user?.role || 'viewer';
                if (disposed) return;
                setUserRole(role);

                const [rules, keys] = await Promise.all([
                    fetchDashboardRulesSummary(controller.signal),
                    role === 'admin' ? fetchAdminApiKeys(controller.signal) : Promise.resolve([]),
                ]);

                if (disposed) return;
                setRulesSummary(rules || { totalRules: 0, topRules: [] });
                setApiKeys(keys || []);
            } catch (err: any) {
                if (!disposed && !isRequestAbortError(err, controller.signal)) {
                    setError(err.message || 'FG-DASHBOARD-SIDE');
                }
            }
        };

        void loadSideData();

        return () => {
            disposed = true;
            controller.abort();
        };
    }, []);

    // --- Error / Loading states ---
    if (error) {
        return <ErrorDisplay title={t('dashboard.unavailable')} message={error} onRetry={() => window.location.reload()} />;
    }

    if (!stats) {
        return (
            <div className="flex min-h-[400px] items-center justify-center">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="h-8 w-8 rounded-full border-b-2 border-t-2 border-primary"
                />
            </div>
        );
    }

    // --- Export ---
    const exportSnapshot = (format: 'json' | 'csv') => {
        const payload = format === 'json'
            ? JSON.stringify({
                generatedAt: new Date().toISOString(),
                timeRange,
                filterQuery,
                stats,
                logs: filteredLogs,
            }, null, 2)
            : [
                'time,type,level,status,method,path,message',
                ...filteredLogs.map((log) => [
                    log.time,
                    log.type,
                    log.level,
                    log.status || '',
                    log.method || '',
                    log.path || '',
                    `"${String(log.message).replace(/"/g, '""')}"`,
                ].join(',')),
            ].join('\n');

        const blob = new Blob([payload], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `dashboard-${timeRange}-${Date.now()}.${format}`;
        anchor.click();
        window.URL.revokeObjectURL(url);
        setExportMessage(`${t('dashboard.exported')} (${format.toUpperCase()})`);
        window.setTimeout(() => setExportMessage(null), 2500);
    };

    // --- Derived values ---
    const emptyAttackDescription = securitySummary.observedSessions || securitySummary.trafficAnomalies
        ? t('dashboard.empty_attack_observed', { sessions: securitySummary.observedSessions || 0, anomalies: securitySummary.trafficAnomalies || 0 })
        : t('dashboard.empty_attack_fallback');
    const emptyRulesDescription = securitySummary.activeAlerts || securitySummary.highRiskFindings
        ? t('dashboard.empty_rules_alert', { alerts: securitySummary.activeAlerts, risks: securitySummary.highRiskFindings || 0 })
        : t('dashboard.empty_rules_fallback');
    const emptyLogsText = securitySummary.pendingActions || securitySummary.failedValidations
        ? t('dashboard.empty_logs_pending', { pending: securitySummary.pendingActions, failed: securitySummary.failedValidations })
        : t('dashboard.empty_logs_fallback');
    const telemetryAvailable = stats.telemetryAvailable !== false;

    // --- Metric bar items ---
    const metricItems: MetricItem[] = [
        { icon: Server, label: t('dashboard.total_requests'), value: telemetryAvailable ? (stats.totalRequests ?? 0).toLocaleString() : '--', trend: telemetryAvailable ? stats.requestsTrend : undefined, tone: 'primary', goodDirection: 'up' },
        { icon: Shield, label: t('dashboard.threats_blocked'), value: telemetryAvailable ? (stats.blockedRequests ?? 0).toLocaleString() : '--', trend: telemetryAvailable ? stats.blockedTrend : undefined, tone: 'danger', goodDirection: 'down' },
        { icon: Globe, label: t('dashboard.success_rate'), value: telemetryAvailable ? `${stats.successRate ?? 0}%` : '--', tone: telemetryAvailable ? 'success' : 'neutral', goodDirection: 'up' },
        { icon: Zap, label: t('dashboard.avg_latency'), value: telemetryAvailable ? `${stats.avgProcessingTime || 0}ms` : '--', tone: telemetryAvailable ? 'warning' : 'neutral', goodDirection: 'down' },
        { icon: Activity, label: t('dashboard.active_connections'), value: telemetryAvailable ? (stats.activeConnections ?? 0).toLocaleString() : '--', tone: telemetryAvailable ? 'primary' : 'neutral', goodDirection: 'up' },
        { icon: AlertTriangle, label: t('dashboard.high_risk'), value: securitySummary.openCriticalFindings, tone: 'danger', goodDirection: 'down' },
    ];

    // --- System gauges ---
    const gaugeItems: GaugeItem[] = [
        { icon: Cpu, label: t('dashboard.cpu_usage'), value: stats.cpuUsage || 0, tone: 'primary' },
        { icon: HardDrive, label: t('dashboard.memory_usage'), value: stats.memoryUsage || 0, tone: 'warning' },
        { icon: Database, label: t('dashboard.disk_usage'), value: stats.diskUsage || 0, tone: 'neutral' },
        { icon: Activity, label: t('dashboard.network_throughput'), value: stats.networkUsage || 0, tone: 'success', kind: 'value', unit: 'MB/s' },
    ];

    return (
        <motion.div
            variants={staggerContainerVariants}
            initial="hidden"
            animate="visible"
            className="mx-auto min-h-screen max-w-[1600px] space-y-4 p-6 pb-12"
            data-testid="dashboard-page"
        >
            {/* Header: title + time range + actions */}
            <DashboardHeader
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
                paused={paused}
                onTogglePause={() => setPaused((c) => !c)}
                onExport={exportSnapshot}
            />

            {/* Export notification */}
            {exportMessage && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300"
                >
                    {exportMessage}
                </motion.div>
            )}

            {!telemetryAvailable && (
                <div
                    role="alert"
                    data-testid="tenant-telemetry-unavailable"
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
                >
                    {t('dashboard.tenant_telemetry_unavailable')}
                </div>
            )}

            {/* Metric Bar — 6 core KPIs in one row */}
            <MetricBar items={metricItems} />

            {/* Traffic Trend + System Gauges */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <motion.div variants={fadeUpVariants} className="lg:col-span-8">
                    <ConsolePanel
                        title={t('dashboard.traffic_analysis')}
                        subtitle={t('dashboard.traffic_subtitle')}
                        icon={Activity}
                        iconTone="primary"
                    >
                        <TrafficChart
                            data={telemetryAvailable ? filteredHistory : []}
                            loadingText={t('dashboard.waiting_chart')}
                            requestsLabel={t('dashboard.requests')}
                            blockedLabel={t('dashboard.blocked')}
                            emptyTitle={telemetryAvailable ? t('dashboard.traffic_empty_title') : t('dashboard.telemetry_unavailable_title')}
                            emptyDesc={telemetryAvailable ? t('dashboard.traffic_empty_desc') : t('dashboard.tenant_telemetry_unavailable')}
                        />
                    </ConsolePanel>
                </motion.div>

                <motion.div variants={fadeUpVariants} className="lg:col-span-4">
                    <ConsolePanel
                        title={t('dashboard.system_resources')}
                        subtitle={t('dashboard.system_status')}
                        icon={Cpu}
                        iconTone="neutral"
                    >
                        {telemetryAvailable ? (
                            <SystemGauges gauges={gaugeItems} />
                        ) : (
                            <ConsoleEmptyState
                                title={t('dashboard.telemetry_unavailable_title')}
                                description={t('dashboard.tenant_telemetry_unavailable')}
                            />
                        )}
                    </ConsolePanel>
                </motion.div>
            </div>

            {/* Threat Intel + Security Ops */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <motion.div variants={fadeUpVariants}>
                    <ThreatIntelPanel
                        origins={stats.attackOrigins || []}
                        threats={stats.threats || []}
                        emptyDescription={emptyAttackDescription}
                    />
                </motion.div>

                <motion.div variants={fadeUpVariants}>
                    <SecurityOpsPanel
                        rules={rulesSummary}
                        actions={securitySummary.recentActions}
                        validations={securitySummary.recentValidations}
                        emptyRulesDescription={emptyRulesDescription}
                    />
                </motion.div>
            </div>

            {/* Live Log Stream — full width */}
            <motion.div variants={fadeUpVariants}>
                <LiveLogStream
                    logs={filteredLogs}
                    filterQuery={filterQuery}
                    onFilterChange={setFilterQuery}
                    emptyText={emptyLogsText}
                />
            </motion.div>

            {/* Admin API Keys */}
            <motion.div variants={fadeUpVariants}>
                <AdminKeySection apiKeys={apiKeys} visible={userRole === 'admin'} />
            </motion.div>
        </motion.div>
    );
}
