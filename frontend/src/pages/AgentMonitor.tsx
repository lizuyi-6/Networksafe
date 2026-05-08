import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLiveMode } from '../context/LiveModeContext';
import {
    Brain,
    Activity,
    MessageSquare,
    Zap,
    TrendingUp,
    AlertTriangle,
    CheckCircle,
    XCircle,
    RefreshCw,
    Users,
    BarChart3,
    Clock,
    ShieldAlert,
    Network,
} from 'lucide-react';
import { fetchAgentSystemStats, fetchAgentHealth } from '../services/api';
import type { MultiAgentSystemStats, AgentHeartbeat } from '../types/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';

const AGENT_ROLES = {
    socrates: { name: 'Socrates', teamKey: 'agentMonitor.redTeam', color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', icon: 'SO' },
    plato: { name: 'Plato', teamKey: 'agentMonitor.blueTeam', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', icon: 'PL' },
    aristotle: { name: 'Aristotle', teamKey: 'agentMonitor.analyst', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: 'AR' },
    arbitrator: { name: 'Arbitrator', teamKey: 'agentMonitor.decision', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: 'AB' },
};

export default function AgentMonitor() {
    const { t } = useTranslation();
    const { liveModeEnabled } = useLiveMode();
    const [stats, setStats] = useState<MultiAgentSystemStats | null>(null);
    const [health, setHealth] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const layerInfo = [
        { id: 1, nameKey: 'agentMonitor.layers.collaboration', icon: Users },
        { id: 2, nameKey: 'agentMonitor.layers.rolePlaying', icon: Brain },
        { id: 3, nameKey: 'agentMonitor.layers.sceneTraversal', icon: Network },
        { id: 4, nameKey: 'agentMonitor.layers.capability', icon: Zap },
        { id: 5, nameKey: 'agentMonitor.layers.debate', icon: MessageSquare },
        { id: 6, nameKey: 'agentMonitor.layers.heterogeneous', icon: Activity },
        { id: 7, nameKey: 'agentMonitor.layers.synthesis', icon: ShieldAlert },
    ];

    useEffect(() => {
        loadData();

        if (autoRefresh && liveModeEnabled) {
            const interval = setInterval(loadData, 5000);
            return () => clearInterval(interval);
        }
    }, [autoRefresh, liveModeEnabled]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statsData, healthData] = await Promise.all([fetchAgentSystemStats(), fetchAgentHealth()]);
            setStats(statsData);
            setHealth(healthData);
        } catch (e) {
            console.error('Failed to load agent data', e);
        }
        setLoading(false);
    };

    const getStatusTone = (status: string) => {
        switch (status) {
            case 'healthy':
                return 'text-emerald-600 dark:text-emerald-400';
            case 'degraded':
                return 'text-amber-600 dark:text-amber-400';
            case 'unhealthy':
                return 'text-rose-600 dark:text-rose-400';
            default:
                return 'text-muted-foreground';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'healthy':
                return <CheckCircle className="h-6 w-6 text-emerald-500" />;
            case 'degraded':
                return <AlertTriangle className="h-6 w-6 text-amber-500" />;
            case 'unhealthy':
                return <XCircle className="h-6 w-6 text-rose-500" />;
            default:
                return <Activity className="h-6 w-6 text-muted-foreground" />;
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'healthy':
                return t('agentMonitor.healthy');
            case 'degraded':
                return t('agentMonitor.degraded');
            case 'unhealthy':
                return t('agentMonitor.unhealthy');
            default:
                return t('agentMonitor.unknown');
        }
    };

    return (
        <ConsolePage
            title={t('agentMonitor.title')}
            subtitle={t('agentMonitor.subtitle')}
            actions={
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-2 shadow-sm">
                    <label className="flex cursor-pointer items-center gap-2 px-3 text-sm font-medium text-foreground">
                        <input
                            data-testid="agent-monitor-auto-refresh"
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary/30"
                        />
                        {t('agentMonitor.autoRefresh')}
                    </label>
                    <button
                        data-testid="agent-monitor-refresh"
                        onClick={loadData}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        {t('agentMonitor.refresh')}
                    </button>
                </div>
            }
        >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard
                    icon={ShieldAlert}
                    label={t('agentMonitor.systemHealth')}
                    value={getStatusText(health?.status || 'unknown').toUpperCase()}
                    hint={health?.details && Object.keys(health.details).length > 0 ? Object.keys(health.details).join(', ') : t('agentMonitor.auto_refresh_on')}
                    tone={health?.status === 'healthy' ? 'success' : health?.status === 'unhealthy' ? 'danger' : 'warning'}
                />
                <ConsoleStatCard
                    icon={Users}
                    label={t('agentMonitor.activeAgents')}
                    value={stats?.orchestrator.registeredAgents || 0}
                    hint={t('agentMonitor.orchestrator_hint')}
                    tone="primary"
                />
                <ConsoleStatCard
                    icon={MessageSquare}
                    label={t('agentMonitor.queueSize')}
                    value={stats?.messageBus.queueSize || 0}
                    hint={t('agentMonitor.queue_hint')}
                    tone="neutral"
                />
                <ConsoleStatCard
                    icon={BarChart3}
                    label={t('agentMonitor.caseFiles')}
                    value={stats?.synthesis.totalCaseFiles || 0}
                    hint={t('agentMonitor.casefile_hint')}
                    tone="warning"
                />
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <ConsoleStatCard
                    icon={AlertTriangle}
                    label={t('agentMonitor.active_alerts')}
                    value={stats?.operations?.activeAlerts || 0}
                    hint={t('agentMonitor.scans_hint')}
                    tone="danger"
                />
                <ConsoleStatCard
                    icon={RefreshCw}
                    label={t('agentMonitor.running_scans')}
                    value={stats?.operations?.runningScans || 0}
                    hint={t('agentMonitor.running_hint')}
                    tone="warning"
                />
                <ConsoleStatCard
                    icon={Zap}
                    label={t('agentMonitor.actions_hint')}
                    value={stats?.operations?.pendingActions || 0}
                    hint={t('agentMonitor.queue_depth_hint')}
                    tone="primary"
                />
                <ConsoleStatCard
                    icon={XCircle}
                    label={t('agentMonitor.validations_failed')}
                    value={stats?.operations?.failedValidations || 0}
                    hint={t('agentMonitor.drill_no_block')}
                    tone="danger"
                />
                <ConsoleStatCard
                    icon={ShieldAlert}
                    label={t('agentMonitor.high_risk_assets')}
                    value={stats?.operations?.assetsAtRisk || 0}
                    hint={t('agentMonitor.high_risk_hint')}
                    tone="warning"
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                    <ConsolePanel title={t('agentMonitor.layerArchitecture')} subtitle={t('agentMonitor.decision_chain')} icon={Brain} iconTone="primary">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {layerInfo.map((layer, index) => {
                                const Icon = layer.icon;
                                return (
                                    <motion.div
                                        key={layer.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.05 * index }}
                                        className="rounded-xl border border-border bg-muted/15 p-4"
                                    >
                                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                                            <Icon size={18} />
                                        </div>
                                        <div className="text-xl font-bold tracking-tight text-foreground">L{layer.id}</div>
                                        <div className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{t(layer.nameKey)}</div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </ConsolePanel>
                </div>

                <div className="lg:col-span-5">
                    <ConsolePanel title={t('agentMonitor.messageBusStats')} subtitle={t('agentMonitor.dispatch_subtitle')} icon={Clock} iconTone="neutral">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-border bg-muted/15 p-4 text-center">
                                <p className="text-3xl font-bold text-foreground font-mono">{stats?.messageBus.queueSize || 0}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{t('agentMonitor.queueSize')}</p>
                            </div>
                            <div className="rounded-xl border border-border bg-muted/15 p-4 text-center">
                                <p className="text-3xl font-bold text-foreground font-mono">{stats?.messageBus.subscriptionCount || 0}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{t('agentMonitor.subscriptions')}</p>
                            </div>
                            <div className="rounded-xl border border-border bg-muted/15 p-4 text-center">
                                <p className="text-3xl font-bold text-foreground font-mono">{stats?.messageBus.pendingRequests || 0}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{t('agentMonitor.pendingRequests')}</p>
                            </div>
                            <div className="rounded-xl border border-border bg-muted/15 p-4 text-center">
                                <p className="text-3xl font-bold text-foreground font-mono">{stats?.orchestrator.activeTasks || 0}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{t('agentMonitor.activeTasks')}</p>
                            </div>
                        </div>
                    </ConsolePanel>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <ConsolePanel title={t('agentMonitor.agentHeartbeats')} subtitle={t('agentMonitor.telemetry_subtitle')} icon={Users} iconTone="primary">
                    <div className="space-y-3">
                        {stats?.agents?.length ? (
                            stats.agents.map((agent: AgentHeartbeat, index: number) => {
                                const roleInfo =
                                    AGENT_ROLES[agent.role as keyof typeof AGENT_ROLES] || {
                                        name: agent.role,
                                        teamKey: 'agentMonitor.unknown',
                                        color: 'text-muted-foreground',
                                        bg: 'bg-muted/20',
                                        border: 'border-border',
                                        icon: '--',
                                    };

                                return (
                                    <motion.div
                                        key={agent.agentId}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.05 * index }}
                                        className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-muted/15 p-4 sm:flex-row sm:items-center"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`flex h-10 w-10 items-center justify-center rounded-lg border text-[11px] font-bold tracking-wide ${roleInfo.bg} ${roleInfo.border} ${roleInfo.color}`}>
                                                {roleInfo.icon}
                                            </div>
                                            <div>
                                                <p className={`text-sm font-semibold ${roleInfo.color}`}>{roleInfo.name}</p>
                                                <p className="text-xs text-muted-foreground">{t(roleInfo.teamKey)}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4 text-center">
                                            <div>
                                                <p className="text-xs text-muted-foreground">{t('agentMonitor.tasks')}</p>
                                                <p className="mt-1 text-lg font-bold font-mono text-foreground">{agent.tasksCompleted}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">{t('agentMonitor.latency')}</p>
                                                <p className="mt-1 text-lg font-bold font-mono text-foreground">
                                                    {agent.responseTime}
                                                    <span className="ml-1 text-xs text-muted-foreground">ms</span>
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">{t('agentMonitor.status')}</p>
                                                <p className={`mt-1 text-xs font-bold uppercase ${getStatusTone(agent.status)}`}>{agent.status}</p>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })
                        ) : (
                            <ConsoleEmptyState title={t('agentMonitor.noAgents')} description={t('agentMonitor.no_heartbeat')} />
                        )}
                    </div>
                </ConsolePanel>

                <ConsolePanel title={t('agentMonitor.synthesisStats')} subtitle={t('agentMonitor.learning')} icon={TrendingUp} iconTone="success">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-4">
                            <span className="text-sm text-muted-foreground">{t('agentMonitor.totalCaseFiles')}</span>
                            <span className="text-xl font-bold font-mono text-foreground">{stats?.synthesis.totalCaseFiles || 0}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-4">
                            <span className="text-sm text-muted-foreground">{t('agentMonitor.lessonsLearned')}</span>
                            <span className="text-xl font-bold font-mono text-foreground">{stats?.synthesis.totalLessons || 0}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-4">
                            <span className="text-sm text-muted-foreground">{t('agentMonitor.policyUpdates')}</span>
                            <span className="text-xl font-bold font-mono text-foreground">{stats?.synthesis.totalPolicyUpdates || 0}</span>
                        </div>

                        {stats?.synthesis.topPatterns?.length ? (
                            <div className="border-t border-border pt-4">
                                <p className="mb-3 text-xs font-medium text-muted-foreground">{t('agentMonitor.topPatterns')}</p>
                                <div className="space-y-2">
                                    {stats.synthesis.topPatterns.slice(0, 5).map((pattern, index) => (
                                        <div key={`${pattern.pattern}-${index}`} className="flex items-center justify-between rounded-lg border border-border bg-muted/15 px-3 py-2">
                                            <span className="truncate pr-4 text-sm font-medium text-foreground">{pattern.pattern}</span>
                                            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{pattern.frequency}x</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <ConsoleEmptyState title={t('agentMonitor.no_patterns')} description={t('agentMonitor.no_patterns_desc')} />
                        )}
                    </div>
                </ConsolePanel>
            </div>

            <ConsolePanel title={t('agentMonitor.systemHealth')} subtitle={t('agentMonitor.systemHealth')} icon={ShieldAlert} iconTone="warning">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            {getStatusIcon(health?.status || 'unknown')}
                            <div>
                                <div className={`text-2xl font-bold tracking-tight ${getStatusTone(health?.status || 'unknown')}`}>
                                    {getStatusText(health?.status || 'unknown').toUpperCase()}
                                </div>
                                <p className="text-sm text-muted-foreground">{t('agentMonitor.systemHealth')}</p>
                            </div>
                        </div>
                    </div>

                    {health?.details && Object.keys(health.details).length > 0 ? (
                        <div className="w-full rounded-xl border border-border bg-muted/15 p-4 md:max-w-md">
                            <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">{t('agentMonitor.systemHealth')}</div>
                            <div className="space-y-1 font-mono text-xs text-foreground">
                                {Object.entries(health.details).map(([key, value]) => (
                                    <div key={key} className="truncate">
                                        <span className="text-muted-foreground">{key}:</span> {String(value)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-border bg-muted/15 px-4 py-3 text-sm text-muted-foreground">{t('agentMonitor.no_degradation')}</div>
                    )}
                </div>
            </ConsolePanel>
        </ConsolePage>
    );
}
