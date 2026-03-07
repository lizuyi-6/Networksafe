import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
    Activity,
    Code,
    Cpu,
    Database,
    Download,
    Globe,
    HardDrive,
    Key,
    Pause,
    Search,
    Server,
    Shield,
    Terminal,
    AlertTriangle,
    Zap,
} from 'lucide-react';
import {
    fetchAdminApiKeys,
    fetchDashboardRulesSummary,
    fetchLogs,
    fetchStats,
    isRequestAbortError,
} from '../services/api';
import { DashboardSecuritySummary, DashboardStats, LogItem } from '../types/api';
import ErrorDisplay from '../components/ErrorDisplay';
import { useWebSocket } from '../context/WebSocketContext';
import { useLiveMode } from '../context/LiveModeContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import StableResponsiveChart from '../components/StableResponsiveChart';

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

const TrafficChart = ({ data }: { data: { time: string; requests: number; blocked: number }[] }) => (
    <StableResponsiveChart minHeight={300} loadingText="Waiting for chart container...">
        <AreaChart data={data}>
            <defs>
                <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} dy={10} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} dx={-10} />
            <Tooltip
                contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '12px',
                }}
            />
            <Area type="monotone" dataKey="requests" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRequests)" />
            <Area type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2.5} fillOpacity={1} fill="url(#colorBlocked)" />
        </AreaChart>
    </StableResponsiveChart>
);

const LogStream = ({ logs, emptyText }: { logs: LogItem[]; emptyText: string }) => (
    <div className="h-full rounded-xl border border-border bg-muted/15 p-4">
        <div className="h-full space-y-2 overflow-y-auto font-mono text-xs">
            <AnimatePresence>
                {logs.map((log) => (
                    <motion.div
                        key={`${log.id}-${log.time}`}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex gap-4 rounded-lg border p-2.5 ${
                            log.level === 'ERROR' || log.status === 403
                                ? 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                                : 'border-border bg-card text-foreground'
                        }`}
                    >
                        <span className="w-20 shrink-0 text-muted-foreground">{new Date(log.time).toLocaleTimeString()}</span>
                        <span className="w-12 shrink-0 font-bold">{log.status || 200}</span>
                        <span className="w-12 shrink-0 font-semibold text-primary">{log.type}</span>
                        <span className="break-all">{log.message}</span>
                    </motion.div>
                ))}
            </AnimatePresence>
            {logs.length === 0 && <div className="py-8 text-center font-sans text-muted-foreground">{emptyText}</div>}
        </div>
    </div>
);

const countryColor = (code: string) => ({
    CN: 'bg-rose-500',
    US: 'bg-blue-500',
    RU: 'bg-rose-600',
    JP: 'bg-amber-500',
    DE: 'bg-cyan-500',
    GB: 'bg-indigo-500',
    Unknown: 'bg-slate-400',
}[code] || 'bg-slate-400');

export default function Dashboard() {
    const { subscribe } = useWebSocket();
    const { liveModeEnabled } = useLiveMode();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [logs, setLogs] = useState<LogItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [rulesSummary, setRulesSummary] = useState<{ totalRules: number; topRules: any[] }>({ totalRules: 0, topRules: [] });
    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [userRole, setUserRole] = useState('viewer');
    const [timeRange, setTimeRange] = useState<'1h' | '24h'>('1h');
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

    const filteredHistory = useMemo(
        () => stats?.history?.slice(timeRange === '1h' ? -10 : 0) || [],
        [stats?.history, timeRange],
    );

    const securitySummary = stats?.securityOperations || defaultSecuritySummary;

    useEffect(() => {
        let disposed = false;
        let controller: AbortController | null = null;

        const loadData = async () => {
            controller?.abort();
            controller = new AbortController();
            try {
                const statsData = await fetchStats(controller.signal);
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
    }, [liveModeEnabled, paused]);

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
                const meRes = await fetch('/api/auth/me', {
                    credentials: 'include',
                    signal: controller.signal,
                });
                const role = meRes.ok ? (await meRes.json()).user?.role || 'viewer' : 'viewer';
                if (disposed) return;
                setUserRole(role);

                const [rules, keys] = await Promise.all([
                    fetchDashboardRulesSummary(controller.signal),
                    role === 'admin' ? fetchAdminApiKeys(controller.signal).catch(() => []) : Promise.resolve([]),
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

    if (error) {
        return <ErrorDisplay title="Dashboard unavailable" message={error} onRetry={() => window.location.reload()} />;
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
        setExportMessage(`已导出当前视图（${format.toUpperCase()}）`);
        window.setTimeout(() => setExportMessage(null), 2500);
    };

    const healthStatus = stats.successRate >= 99 ? '系统健康' : stats.successRate >= 95 ? '运行稳定' : '需要重点关注';
    const emptyAttackDescription = securitySummary.observedSessions || securitySummary.trafficAnomalies
        ? `最近已观测 ${securitySummary.observedSessions || 0} 条会话，识别 ${securitySummary.trafficAnomalies || 0} 个异常流量特征。`
        : '当前没有新的来源分布，但系统仍在持续接收实时流量摘要。';
    const emptyRulesDescription = securitySummary.activeAlerts || securitySummary.highRiskFindings
        ? `当前有 ${securitySummary.activeAlerts} 条活跃告警、${securitySummary.highRiskFindings || 0} 条高风险发现等待规则命中。`
        : '规则命中后这里会显示排行；当前可转到监控、告警和设备页查看实时状态。';
    const emptyLogsText = securitySummary.pendingActions || securitySummary.failedValidations
        ? `当前没有新的日志流；待执行动作 ${securitySummary.pendingActions}，失败验证 ${securitySummary.failedValidations}。`
        : '正在等待新的日志事件进入当前视图。';

    return (
        <ConsolePage title="安全控制台" subtitle="统一监控、规则、日志与运营摘要">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={Server} label="总请求数" value={stats.totalRequests.toLocaleString()} hint="整体流量处理规模" tone="primary" />
                <ConsoleStatCard icon={Shield} label="拦截威胁" value={stats.blockedRequests.toLocaleString()} hint="近期拦截事件累计" tone="danger" />
                <ConsoleStatCard icon={Zap} label="平均延迟" value={`${stats.avgProcessingTime || 0}ms`} hint={`P99 ${stats.p99Latency || 0}ms`} tone="warning" />
                <ConsoleStatCard icon={Globe} label="全局健康" value={`${stats.successRate}%`} hint={healthStatus} tone="success" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={Cpu} label="CPU 使用率" value={`${stats.cpuUsage?.toFixed(1) || 0}%`} hint="主机 CPU" tone="primary" />
                <ConsoleStatCard icon={HardDrive} label="内存占用" value={`${stats.memoryUsage?.toFixed(1) || 0}%`} hint="系统内存" tone="warning" />
                <ConsoleStatCard icon={Database} label="磁盘占用" value={`${stats.diskUsage?.toFixed(1) || 0}%`} hint="根分区使用率" tone="neutral" />
                <ConsoleStatCard icon={Activity} label="网络吞吐" value={`${stats.networkUsage?.toFixed(2) || 0} MB/s`} hint="实时 I/O 吞吐量" tone="success" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={AlertTriangle} label="高危发现" value={securitySummary.openCriticalFindings} hint={`高风险总数 ${securitySummary.highRiskFindings || 0}`} tone="danger" />
                <ConsoleStatCard icon={Shield} label="活跃告警" value={securitySummary.activeAlerts} hint={`待处理动作 ${securitySummary.pendingActions}`} tone="warning" />
                <ConsoleStatCard icon={Search} label="扫描任务" value={securitySummary.runningScans} hint={`排队中 ${securitySummary.queuedScans || 0}`} tone="primary" />
                <ConsoleStatCard icon={Globe} label="观测会话" value={securitySummary.observedSessions || 0} hint={`异常流量 ${securitySummary.trafficAnomalies || 0}`} tone="success" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8">
                    <ConsolePanel
                        title="流量分析"
                        subtitle="按时间窗口查看请求与拦截趋势"
                        icon={Activity}
                        iconTone="primary"
                    >
                        <div className="flex items-center justify-end gap-2 pb-4">
                            <button
                                onClick={() => setTimeRange('1h')}
                                className={`rounded-lg border px-4 py-1.5 text-xs font-semibold ${
                                    timeRange === '1h'
                                        ? 'border-border bg-card text-foreground'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                1 小时
                            </button>
                            <button
                                onClick={() => setTimeRange('24h')}
                                className={`rounded-lg border px-4 py-1.5 text-xs font-semibold ${
                                    timeRange === '24h'
                                        ? 'border-border bg-card text-foreground'
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                24 小时
                            </button>
                        </div>
                        <TrafficChart data={filteredHistory} />
                    </ConsolePanel>
                </div>

                <div className="lg:col-span-4">
                    <ConsolePanel title="攻击来源" subtitle="按地区聚合的最近来源分布" icon={Globe} iconTone="warning">
                        <div className="space-y-5">
                            {(stats.attackOrigins || []).length > 0 ? (
                                stats.attackOrigins!.map((item, index) => (
                                    <div key={`${item.countryCode}-${index}`}>
                                        <div className="mb-2 flex items-center justify-between text-sm">
                                            <span className="flex items-center gap-2 font-medium text-foreground">
                                                <span className={`h-2 w-2 rounded-full ${countryColor(item.countryCode)}`} />
                                                {item.country}
                                                <span className="text-muted-foreground">({item.countryCode})</span>
                                            </span>
                                            <span className="font-mono font-bold text-foreground">{Math.round(item.percentage)}%</span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full border border-border/50 bg-muted">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${item.percentage}%` }}
                                                transition={{ duration: 0.6, delay: index * 0.06 }}
                                                className={`h-full ${countryColor(item.countryCode)}`}
                                            />
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <ConsoleEmptyState title="暂无攻击来源分布" description={emptyAttackDescription} />
                            )}
                        </div>
                    </ConsolePanel>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-8">
                    <ConsolePanel
                        title="实时日志流"
                        subtitle="筛选当前视图并导出结果"
                        icon={Terminal}
                        iconTone="neutral"
                        headerAction={(
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <Search className="absolute left-3 top-2 text-muted-foreground" size={16} />
                                    <input
                                        type="text"
                                        value={filterQuery}
                                        onChange={(event) => setFilterQuery(event.target.value)}
                                        placeholder="筛选：status / type / path / message"
                                        className="w-full rounded-lg border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none md:w-64"
                                    />
                                </div>
                                <button
                                    onClick={() => setPaused((current) => !current)}
                                    className={`rounded-lg border border-border bg-card p-2 transition-colors hover:bg-muted/30 ${
                                        paused ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    <Pause size={18} />
                                </button>
                                <button
                                    onClick={() => exportSnapshot('json')}
                                    className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                                >
                                    <Download size={18} />
                                </button>
                                <button
                                    onClick={() => exportSnapshot('csv')}
                                    className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                                >
                                    CSV
                                </button>
                            </div>
                        )}
                    >
                        {exportMessage && (
                            <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300">
                                {exportMessage}
                            </div>
                        )}
                        <div className="h-[450px]">
                            <LogStream logs={filteredLogs} emptyText={emptyLogsText} />
                        </div>
                    </ConsolePanel>
                </div>

                <div className="space-y-6 lg:col-span-4">
                    <ConsolePanel title="最近运营动作" subtitle="来自扫描、处置和验证链路的最新结果" icon={Zap} iconTone="success">
                        {(securitySummary.recentActions || []).length > 0 || (securitySummary.recentValidations || []).length > 0 ? (
                            <div className="space-y-3">
                                {(securitySummary.recentActions || []).slice(0, 3).map((action) => (
                                    <div key={action.actionId} className="rounded-xl border border-border bg-muted/15 p-3">
                                        <div className="text-sm font-semibold text-foreground">{action.title}</div>
                                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{action.status}</span>
                                            <span>{new Date(action.updatedAt || action.createdAt).toLocaleString()}</span>
                                        </div>
                                    </div>
                                ))}
                                {(securitySummary.recentValidations || []).slice(0, 2).map((validation) => (
                                    <div key={validation.validationRunId} className="rounded-xl border border-border bg-muted/15 p-3">
                                        <div className="text-sm font-semibold text-foreground">{validation.attackName}</div>
                                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{validation.verdict}</span>
                                            <span>{new Date(validation.completedAt).toLocaleString()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <ConsoleEmptyState title="暂无新的运营动作" description="当扫描、处置或攻击验证完成后，这里会展示最近的真实结果。" />
                        )}
                    </ConsolePanel>

                    <ConsolePanel
                        title="活跃规则"
                        subtitle="触发次数最高的规则清单"
                        icon={Code}
                        iconTone="primary"
                        headerAction={(
                            <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                                总计 {rulesSummary.totalRules || 0}
                            </span>
                        )}
                    >
                        <div className="space-y-4">
                            {(rulesSummary.topRules || []).length > 0 ? (
                                (rulesSummary.topRules || []).slice(0, 5).map((rule: any) => (
                                    <div key={rule.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-3 transition-colors hover:bg-muted/25">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                                                <Code size={18} />
                                            </div>
                                            <div>
                                                <div className="text-sm font-semibold text-foreground">{rule.name || rule.id}</div>
                                                <div className="text-xs uppercase tracking-wide text-muted-foreground">严重级别 {rule.severity || 'unknown'}</div>
                                            </div>
                                        </div>
                                        <div className="rounded-md border border-primary/15 bg-primary/10 px-2 py-1 font-mono text-sm font-semibold text-primary">
                                            {rule.count || 0}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <ConsoleEmptyState title="暂无规则遥测" description={emptyRulesDescription} />
                            )}
                        </div>
                    </ConsolePanel>

                    {userRole === 'admin' && (
                        <ConsolePanel title="管理员 API 密钥" subtitle="快速查看最近使用的接入前缀" icon={Key} iconTone="success">
                            <div className="space-y-4">
                                <p className="text-sm leading-6 text-muted-foreground">
                                    展示当前管理员可快速核对的首个密钥前缀与最近使用时间，便于排查接入链路。
                                </p>
                                <div className="flex items-center justify-between rounded-xl border border-border bg-muted p-3">
                                    <code className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                        {apiKeys[0]?.prefix ? `${apiKeys[0].prefix}********` : '未找到'}
                                    </code>
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        {apiKeys[0]?.lastUsed || 'never'}
                                    </span>
                                </div>
                            </div>
                        </ConsolePanel>
                    )}
                </div>
            </div>
        </ConsolePage>
    );
}
