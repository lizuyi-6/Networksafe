import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertCircle, AlertTriangle, Bell, CheckCircle, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLiveMode } from '../context/LiveModeContext';
import {
    acknowledgeAlert,
    fetchAlerts,
    fetchStats,
    investigateAlert,
    isRequestAbortError,
    resolveAlert,
    suppressAlert,
} from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import type { AlertRecord, DashboardSecuritySummary, DashboardStats } from '../types/api';

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

const statusLabels: Record<string, string> = {
    open: '待处理',
    acknowledged: '已确认',
    investigating: '调查中',
    resolved: '已解决',
    suppressed: '已抑制',
};

const severityStyles: Record<string, string> = {
    critical: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
    high: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20',
    medium: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
    low: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20',
};

const Alerts = () => {
    const { liveModeEnabled } = useLiveMode();
    const [alerts, setAlerts] = useState<AlertRecord[]>([]);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [severityFilter, setSeverityFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const loadAlerts = async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const [nextAlerts, nextStats] = await Promise.all([
                fetchAlerts(signal),
                fetchStats(signal),
            ]);

            if (signal?.aborted) {
                return;
            }

            setAlerts(nextAlerts || []);
            if (nextStats) {
                setStats(nextStats);
            }
            setError(null);
        } catch (err: any) {
            if (!isRequestAbortError(err, signal)) {
                setError(err?.message || '告警数据加载失败');
            }
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        let disposed = false;
        let controller: AbortController | null = null;

        const refresh = async () => {
            const nextController = new AbortController();
            controller?.abort();
            controller = nextController;
            await loadAlerts(nextController.signal);
        };

        void refresh();

        if (!liveModeEnabled) {
            return () => {
                disposed = true;
                controller?.abort();
            };
        }

        const interval = setInterval(() => {
            if (!disposed) {
                void refresh();
            }
        }, 5000);

        return () => {
            disposed = true;
            controller?.abort();
            clearInterval(interval);
        };
    }, [liveModeEnabled]);

    const filteredAlerts = useMemo(
        () => alerts.filter((alert) => {
            const severityMatch = severityFilter === 'all' || alert.severity.toLowerCase() === severityFilter;
            const statusMatch = statusFilter === 'all' || alert.status === statusFilter;
            return severityMatch && statusMatch;
        }),
        [alerts, severityFilter, statusFilter],
    );

    const securitySummary = stats?.securityOperations || defaultSecuritySummary;

    const getIcon = (type: string) => {
        switch (type) {
            case 'security':
                return <ShieldAlert size={18} />;
            case 'system':
                return <AlertCircle size={18} />;
            case 'performance':
                return <AlertTriangle size={18} />;
            default:
                return <Bell size={18} />;
        }
    };

    const executeAction = async (action: () => Promise<any>) => {
        try {
            setActionError(null);
            await action();
            await loadAlerts();
        } catch (nextError: any) {
            setActionError(nextError?.message || '告警状态更新失败');
        }
    };

    if (loading && !stats && alerts.length === 0) {
        return <div className="p-8 text-muted-foreground">正在加载告警中心…</div>;
    }

    return (
        <ConsolePage
            title="告警中心"
            subtitle="真实告警、状态流转和近期运营上下文在同一页收口展示。"
            actions={
                <div className="flex flex-wrap gap-2">
                    <Link
                        to="/rules"
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/30"
                    >
                        Open Rules Ops
                    </Link>
                    {['all', 'critical', 'high', 'medium', 'low'].map((value) => (
                        <button
                            key={value}
                            onClick={() => setSeverityFilter(value)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                                severityFilter === value
                                    ? 'border border-primary bg-primary text-primary-foreground'
                                    : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {value === 'all' ? '全部级别' : value}
                        </button>
                    ))}
                    {['all', 'open', 'acknowledged', 'investigating', 'resolved', 'suppressed'].map((value) => (
                        <button
                            key={value}
                            onClick={() => setStatusFilter(value)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                statusFilter === value
                                    ? 'border border-primary bg-primary text-primary-foreground'
                                    : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {value === 'all' ? '全部状态' : statusLabels[value]}
                        </button>
                    ))}
                </div>
            }
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {actionError && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{actionError}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={Bell} label="活跃告警" value={securitySummary.activeAlerts} hint="当前未解决或调查中的告警" tone="danger" />
                <ConsoleStatCard icon={ShieldAlert} label="高危发现" value={securitySummary.highRiskFindings || securitySummary.openCriticalFindings} hint="需要优先处置的高风险发现" tone="warning" />
                <ConsoleStatCard icon={Activity} label="待执行动作" value={securitySummary.pendingActions} hint="系统已生成但仍待执行的处置动作" tone="primary" />
                <ConsoleStatCard icon={XCircle} label="失败验证" value={securitySummary.failedValidations} hint="最近未命中或结果异常的验证任务" tone="danger" />
            </div>

            <ConsolePanel
                title="告警列表"
                subtitle="筛选、确认、调查、解决和抑制都在同一条链路内闭环。"
                icon={Bell}
                iconTone="warning"
            >
                <div className="divide-y divide-border/50">
                    {filteredAlerts.length === 0 ? (
                        <div className="space-y-4">
                            <ConsoleEmptyState
                                title="当前筛选条件下没有可显示的告警"
                                description="系统仍在持续聚合扫描、流量和验证结果。下面保留最近动作与验证上下文，避免页面看起来像空壳。"
                            />
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <div className="rounded-xl border border-border bg-muted/10 p-4">
                                    <div className="text-sm font-medium text-foreground">最近处置动作</div>
                                    <div className="mt-3 space-y-3">
                                        {securitySummary.recentActions.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">当前没有新的处置动作。待新的高置信发现生成后，这里会显示最近的执行记录。</p>
                                        ) : (
                                            securitySummary.recentActions.slice(0, 4).map((action) => (
                                                <div key={action.actionId} className="rounded-lg border border-border bg-card px-3 py-2">
                                                    <div className="text-sm font-medium text-foreground">{action.title}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">{action.status} · {new Date(action.updatedAt).toLocaleString()}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-border bg-muted/10 p-4">
                                    <div className="text-sm font-medium text-foreground">最近验证结果</div>
                                    <div className="mt-3 space-y-3">
                                        {securitySummary.recentValidations.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">当前没有新的验证失败。后续攻击演练、回放和策略验证会在这里保留最近的结论。</p>
                                        ) : (
                                            securitySummary.recentValidations.slice(0, 4).map((validation) => (
                                                <div key={validation.validationRunId} className="rounded-lg border border-border bg-card px-3 py-2">
                                                    <div className="text-sm font-medium text-foreground">{validation.attackName}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">{validation.verdict} · {validation.severity} · {new Date(validation.completedAt).toLocaleString()}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        filteredAlerts.map((alert, index) => {
                            const severityKey = alert.severity.toLowerCase();
                            return (
                                <motion.div
                                    key={alert.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.03 }}
                                    className="group flex items-start gap-4 p-4 transition-colors hover:bg-muted/20"
                                >
                                    <div className={`mt-1 shrink-0 rounded-lg border p-2 ${severityStyles[severityKey] || severityStyles.medium}`}>
                                        {getIcon(alert.type)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-1 flex items-start justify-between gap-4">
                                            <div>
                                                <h3 className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">{alert.title}</h3>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                    <span className="rounded border border-border bg-muted/20 px-2 py-0.5">{statusLabels[alert.status]}</span>
                                                    <span>{alert.source}</span>
                                                    {alert.assetId && <span>Asset {alert.assetId.slice(0, 8)}</span>}
                                                    {alert.investigationId && <span>调查 {alert.investigationId}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1"><Clock size={12} />{alert.time}</span>
                                            </div>
                                        </div>
                                        <p className="text-sm leading-relaxed text-muted-foreground">{alert.message}</p>
                                        {alert.metadata && Object.keys(alert.metadata).length > 0 && (
                                            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-[11px] text-muted-foreground">
                                                {JSON.stringify(alert.metadata, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Link to={`/alerts/${alert.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="查看详情">
                                            <Clock size={16} />
                                        </Link>
                                        <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="确认" onClick={() => executeAction(() => acknowledgeAlert(alert.id))}>
                                            <CheckCircle size={16} />
                                        </button>
                                        <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="调查" onClick={() => executeAction(() => investigateAlert(alert.id))}>
                                            <Activity size={16} />
                                        </button>
                                        <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="解决" onClick={() => executeAction(() => resolveAlert(alert.id))}>
                                            <CheckCircle size={16} />
                                        </button>
                                        <button className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="抑制" onClick={() => executeAction(() => suppressAlert(alert.id))}>
                                            <XCircle size={16} />
                                        </button>
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </div>
            </ConsolePanel>
        </ConsolePage>
    );
};

export default Alerts;
