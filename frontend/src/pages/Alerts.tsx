import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertCircle, AlertTriangle, Bell, CheckCircle, CheckSquare, Clock, ExternalLink, ShieldAlert, Square, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLiveMode } from '../context/LiveModeContext';
import { useLanguage } from '../context/LanguageContext';
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

const statusKeyMap: Record<string, string> = {
    open: 'status_open',
    acknowledged: 'status_acknowledged',
    investigating: 'status_investigating',
    resolved: 'status_resolved',
    suppressed: 'status_suppressed',
};

const severityStyles: Record<string, string> = {
    critical: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
    high: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20',
    medium: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
    low: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20',
};

const Alerts = () => {
    const { liveModeEnabled } = useLiveMode();
    const { t } = useLanguage();
    const [alerts, setAlerts] = useState<AlertRecord[]>([]);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [severityFilter, setSeverityFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

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
                setError(err?.message || t('alerts.load_failed'));
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
            setActionError(nextError?.message || t('alerts.actionFailed'));
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredAlerts.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredAlerts.map((a) => a.id)));
        }
    };

    const executeBulkAction = async (action: 'acknowledge' | 'resolve' | 'suppress') => {
        if (selectedIds.size === 0) return;
        setBulkLoading(true);
        setActionError(null);
        try {
            const ids = Array.from(selectedIds);
            for (const id of ids) {
                if (action === 'acknowledge') await acknowledgeAlert(id);
                else if (action === 'resolve') await resolveAlert(id);
                else if (action === 'suppress') await suppressAlert(id);
            }
            setSelectedIds(new Set());
            await loadAlerts();
        } catch (nextError: any) {
            setActionError(nextError?.message || t('alerts.actionFailed'));
        } finally {
            setBulkLoading(false);
        }
    };

    if (loading && !stats && alerts.length === 0) {
        return <div className="p-8 text-muted-foreground">{t('alerts.loading')}</div>;
    }

    const allSelected = filteredAlerts.length > 0 && selectedIds.size === filteredAlerts.length;

    return (
        <ConsolePage
            title={t('alerts.title')}
            subtitle={t('alerts.subtitle')}
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
                            data-testid={`alerts-severity-${value}`}
                            onClick={() => setSeverityFilter(value)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                                severityFilter === value
                                    ? 'border border-primary bg-primary text-primary-foreground'
                                    : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {value === 'all' ? t('alerts.filterAllLevels') : value}
                        </button>
                    ))}
                    {['all', 'open', 'acknowledged', 'investigating', 'resolved', 'suppressed'].map((value) => (
                        <button
                            key={value}
                            data-testid={`alerts-status-${value}`}
                            onClick={() => setStatusFilter(value)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                statusFilter === value
                                    ? 'border border-primary bg-primary text-primary-foreground'
                                    : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {value === 'all' ? t('alerts.filterAllStatus') : t(`alerts.${statusKeyMap[value]}`)}
                        </button>
                    ))}
                </div>
            }
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {actionError && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{actionError}</div>}

            {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
                    <button
                        onClick={() => void executeBulkAction('acknowledge')}
                        disabled={bulkLoading}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/30 disabled:opacity-50"
                    >
                        {t('alerts.confirm')} All
                    </button>
                    <button
                        onClick={() => void executeBulkAction('resolve')}
                        disabled={bulkLoading}
                        className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                        {t('alerts.resolve')} All
                    </button>
                    <button
                        onClick={() => void executeBulkAction('suppress')}
                        disabled={bulkLoading}
                        className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                    >
                        {t('alerts.suppress')} All
                    </button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    >
                        Clear
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={Bell} label={t('alerts.activeAlerts')} value={securitySummary.activeAlerts} hint={t('alerts.activeHint')} tone="danger" />
                <ConsoleStatCard icon={ShieldAlert} label={t('alerts.highRisk')} value={securitySummary.highRiskFindings || securitySummary.openCriticalFindings} hint={t('alerts.highRiskHint')} tone="warning" />
                <ConsoleStatCard icon={Activity} label={t('alerts.pendingActions')} value={securitySummary.pendingActions} hint={t('alerts.pendingHint')} tone="primary" />
                <ConsoleStatCard icon={XCircle} label={t('alerts.failedValidations')} value={securitySummary.failedValidations} hint={t('alerts.validationHint')} tone="danger" />
            </div>

            <ConsolePanel
                title={t('alerts.listTitle')}
                subtitle={t('alerts.listSubtitle')}
                icon={Bell}
                iconTone="warning"
                headerAction={filteredAlerts.length > 0 ? (
                    <button
                        onClick={toggleSelectAll}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                        {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                ) : undefined}
            >
                <div className="divide-y divide-border/50">
                    {filteredAlerts.length === 0 ? (
                        <div className="space-y-4">
                            <ConsoleEmptyState
                                title={t('alerts.noAlertsFiltered')}
                                description={t('alerts.noAlertsDesc')}
                            />
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <div className="rounded-xl border border-border bg-muted/10 p-4">
                                    <div className="text-sm font-medium text-foreground">{t('alerts.recentActions')}</div>
                                    <div className="mt-3 space-y-3">
                                        {securitySummary.recentActions.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">{t('alerts.noActions')}</p>
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
                                    <div className="text-sm font-medium text-foreground">{t('alerts.recentValidations')}</div>
                                    <div className="mt-3 space-y-3">
                                        {securitySummary.recentValidations.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">{t('alerts.noValidations')}</p>
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
                            const isSelected = selectedIds.has(alert.id);
                            return (
                                <motion.div
                                    key={alert.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.03 }}
                                    className={`group flex items-start gap-4 p-4 transition-colors hover:bg-muted/20 ${isSelected ? 'bg-primary/5' : ''}`}
                                >
                                    <button
                                        onClick={() => toggleSelect(alert.id)}
                                        aria-label={isSelected ? t('alerts.deselect') : t('alerts.select')}
                                        className="mt-1 shrink-0 p-1 text-muted-foreground hover:text-foreground"
                                    >
                                        {isSelected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
                                    </button>
                                    <div className={`mt-1 shrink-0 rounded-lg border p-2 ${severityStyles[severityKey] || severityStyles.medium}`}>
                                        {getIcon(alert.type)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-1 flex items-start justify-between gap-4">
                                            <div>
                                                <h3 className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">{alert.title}</h3>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                    <span className="rounded border border-border bg-muted/20 px-2 py-0.5">{t(`alerts.${statusKeyMap[alert.status]}`)}</span>
                                                    <span>{alert.source}</span>
                                                    {alert.assetId && <span>Asset {alert.assetId.slice(0, 8)}</span>}
                                                    {alert.investigationId && <span>{t('alerts.investigate')} {alert.investigationId}</span>}
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
                                        <Link data-testid={`alert-detail-${alert.id}`} to={`/alerts/${alert.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('alerts.viewDetail')}>
                                            <ExternalLink size={16} />
                                        </Link>
                                        <button data-testid={`alert-acknowledge-${alert.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('alerts.confirm')} onClick={() => executeAction(() => acknowledgeAlert(alert.id))}>
                                            <CheckCircle size={16} />
                                        </button>
                                        <button data-testid={`alert-investigate-${alert.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('alerts.investigate')} onClick={() => executeAction(() => investigateAlert(alert.id))}>
                                            <Activity size={16} />
                                        </button>
                                        <button data-testid={`alert-resolve-${alert.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('alerts.resolve')} onClick={() => executeAction(() => resolveAlert(alert.id))}>
                                            <CheckCircle size={16} />
                                        </button>
                                        <button data-testid={`alert-suppress-${alert.id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('alerts.suppress')} onClick={() => executeAction(() => suppressAlert(alert.id))}>
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
