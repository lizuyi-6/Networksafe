import { useEffect, useState } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
    Shield, Server, Zap, Globe, Terminal,
    Search, Pause, Download, Code, ArrowUpRight, Key
} from 'lucide-react';
import {
    fetchStats,
    fetchLogs,
    fetchDashboardRulesSummary,
    fetchAdminApiKeys
} from '../services/api';
import { DashboardStats, LogItem } from '../types/api';
import ErrorDisplay from '../components/ErrorDisplay';
import { useLanguage } from '../context/LanguageContext';
import { useDemo } from '../context/DemoContext';
import { useWebSocket } from '../context/WebSocketContext';

const StatCard = ({ title, value, subtext, icon: Icon, color, trend }: any) => (
    <div className="bg-card border border-border rounded-lg p-5 relative overflow-hidden group hover:border-border/80 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
        <div className="flex justify-between items-start mb-4">
            <div className="flex flex-col">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
                <span className="text-2xl font-medium text-foreground tracking-tight mt-1">{value}</span>
            </div>
            <Icon className={`text-muted-foreground/70 group-hover:${color} transition-colors`} size={20} />
        </div>
        <div className="flex items-center gap-2">
            {trend !== undefined && (
                <span className={`text-xs font-medium flex items-center gap-0.5 ${trend > 0 ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'} px-1.5 py-0.5 rounded`}>
                    <ArrowUpRight size={10} /> {Math.abs(trend)}%
                </span>
            )}
            <span className="text-xs text-muted-foreground">{subtext}</span>
        </div>
    </div>
);

const TrafficChart = ({ data }: { data: any[] }) => (
    <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
                <defs>
                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', borderRadius: '4px' }} itemStyle={{ color: 'var(--foreground)' }} />
                <Area type="monotone" dataKey="requests" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorRequests)" />
                <Area type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} fillOpacity={0} fill="transparent" />
            </AreaChart>
        </ResponsiveContainer>
    </div>
);

const LogStream = ({ logs }: { logs: LogItem[] }) => (
    <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1 scrollbar-hide bg-slate-50 dark:bg-black/50 border border-border/50 rounded h-full">
        {logs.map((log) => (
            <div key={log.id} className={`flex gap-4 group p-1 rounded cursor-pointer transition-colors border-l-2 ${log.level === 'ERROR' || log.status === 403 ? 'bg-red-500/10 border-red-500 dark:bg-red-500/5' : 'hover:bg-indigo-50 dark:hover:bg-muted/50 border-transparent hover:border-primary/50'}`}>
                <span className="text-muted-foreground/70 shrink-0 w-20">{new Date(log.time).toLocaleTimeString()}</span>
                <span className={`shrink-0 w-12 font-medium ${log.status === 200 ? 'text-emerald-600 dark:text-emerald-400' : log.status === 403 ? 'text-red-500 dark:text-red-400' : log.status === 429 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{log.status || 200}</span>
                <span className="text-muted-foreground shrink-0 w-10">{log.type}</span>
                <span className="text-foreground break-all">{log.message}</span>
            </div>
        ))}
        {logs.length === 0 && <div className="text-muted-foreground text-center py-4">Waiting for logs...</div>}
    </div>
);

function getCountryColor(code: string): string {
    const colors: Record<string, string> = {
        CN: 'bg-red-500',
        US: 'bg-blue-500',
        RU: 'bg-red-500',
        JP: 'bg-yellow-500',
        DE: 'bg-blue-500',
        GB: 'bg-blue-500',
        Unknown: 'bg-gray-500'
    };
    return colors[code] || 'bg-gray-500';
}

const Dashboard = () => {
    const { t } = useLanguage();
    const { isDemoMode } = useDemo();
    const { subscribe } = useWebSocket();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [logs, setLogs] = useState<LogItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [rulesSummary, setRulesSummary] = useState<any>({ totalRules: 0, activeRules: 0, topRules: [] });
    const [apiKeys, setApiKeys] = useState<any[]>([]);

    useEffect(() => {
        const loadData = async () => {
            try {
                const statsData = await fetchStats();
                setStats(statsData);
                setError(null);
            } catch (err: any) {
                setError(err.message || 'FG-DASHBOARD-STATS');
            }
        };

        loadData();
        const interval = setInterval(loadData, 2000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        fetchLogs().then((rows) => {
            if (Array.isArray(rows)) setLogs(rows);
        }).catch((err) => setError(err.message || 'FG-DASHBOARD-LOGS'));

        const unsubscribe = subscribe('agent:log', (logData: any) => {
            setLogs(prev => [logData, ...prev].slice(0, 100));
        });

        return unsubscribe;
    }, [subscribe]);

    useEffect(() => {
        const loadSideData = async () => {
            try {
                const [rules, keys] = await Promise.all([
                    fetchDashboardRulesSummary(),
                    fetchAdminApiKeys().catch(() => [])
                ]);
                setRulesSummary(rules || { totalRules: 0, activeRules: 0, topRules: [] });
                setApiKeys(keys || []);
            } catch (e: any) {
                setError(e.message || 'FG-DASHBOARD-SIDE');
            }
        };
        loadSideData();
    }, []);

    if (error) {
        return <ErrorDisplay title="Error Loading Dashboard" message={error} onRetry={() => window.location.reload()} />;
    }

    if (!stats) return <div className="p-8 text-muted-foreground">Initializing Dashboard...</div>;

    return (
        <div className="space-y-6 relative">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title={t('dashboard.total_requests')} value={stats.totalRequests.toLocaleString()} subtext="vs last 24h" trend={12} icon={Server} color="text-indigo-400" />
                <StatCard title={t('dashboard.threats_blocked')} value={stats.blockedRequests.toLocaleString()} subtext="Rate spike detected" trend={-4.2} icon={Shield} color="text-red-400" />
                <StatCard title={t('dashboard.avg_latency')} value={`${stats.avgProcessingTime || 0}ms`} subtext={`P99: ${Math.round((stats.avgProcessingTime || 0) * 2.5)}ms`} icon={Zap} color="text-amber-400" />
                <StatCard title={t('dashboard.global_health')} value={`${stats.successRate}%`} subtext={t('header.system_healthy')} icon={Globe} color="text-emerald-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-6 min-h-[400px] flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-base font-medium text-foreground tracking-tight">{t('dashboard.traffic_analysis')}</h3>
                            <p className="text-xs text-muted-foreground mt-1">{t('dashboard.requests_per_second')} vs {t('dashboard.blocked_request')}</p>
                        </div>
                        <div className="flex bg-muted p-0.5 rounded-md border border-border">
                            <button className="px-3 py-1 text-xs font-medium text-foreground bg-background rounded shadow-sm">1h</button>
                            <button className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">24h</button>
                        </div>
                    </div>
                    <TrafficChart data={stats.history} />
                </div>

                <div className="bg-surface border border-border rounded-lg p-6 flex flex-col">
                    <h3 className="text-base font-medium text-foreground tracking-tight mb-4">{t('dashboard.attack_origin')}</h3>
                    <div className="flex-1 space-y-4">
                        {stats.attackOrigins && stats.attackOrigins.length > 0 ? (
                            stats.attackOrigins.map((item, i) => (
                                <div key={i} className="relative group">
                                    <div className="flex justify-between items-center text-sm mb-1">
                                        <span className="flex items-center gap-2 text-foreground"><span className={`w-2 h-2 rounded-full ${getCountryColor(item.countryCode)}`}></span>{item.country} ({item.countryCode})</span>
                                        <span className="font-mono text-muted-foreground">{Math.round(item.percentage)}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden"><div className={`h-full ${getCountryColor(item.countryCode)}`} style={{ width: `${item.percentage}%` }}></div></div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">No attack data available</div>
                        )}
                        {isDemoMode && (
                            <div className="mt-8 pt-6 border-t border-border/50">
                                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{t('dashboard.top_vectors')}</h4>
                                <div className="flex flex-wrap gap-2">
                                    <span className="px-2 py-1 rounded text-xs border border-red-500/20 bg-red-500/10 text-red-400">SQL Injection</span>
                                    <span className="px-2 py-1 rounded text-xs border border-orange-500/20 bg-orange-500/10 text-orange-400">XSS Reflected</span>
                                    <span className="px-2 py-1 rounded text-xs border border-border bg-muted text-muted-foreground">Bad Bot</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-muted border border-border rounded-lg flex flex-col h-[400px] overflow-hidden">
                    <div className="px-4 py-3 border-b border-border bg-card/50 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Terminal size={16} className="text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">{t('dashboard.live_log_stream')}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <Search className="absolute left-2 top-1.5 text-muted-foreground" size={14} />
                                <input type="text" placeholder="filter: status=403..." className="bg-background border border-border rounded text-xs py-1 pl-7 pr-2 text-foreground focus:outline-none focus:border-primary w-48 font-mono" />
                            </div>
                            <Pause size={18} className="text-muted-foreground hover:text-foreground cursor-pointer" />
                            <Download size={18} className="text-muted-foreground hover:text-foreground cursor-pointer" />
                        </div>
                    </div>
                    <LogStream logs={logs} />
                </div>

                <div className="lg:col-span-4 space-y-6">
                    <div className="bg-card border border-border rounded-lg p-5">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-medium text-foreground">{t('dashboard.active_rules')}</h3>
                            <span className="text-xs text-muted-foreground">total: {rulesSummary.totalRules || 0}</span>
                        </div>
                        <div className="space-y-3">
                            {(rulesSummary.topRules || []).length > 0 ? (
                                (rulesSummary.topRules || []).slice(0, 5).map((rule: any) => (
                                    <div key={rule.id} className="flex items-center justify-between p-2 rounded bg-muted/20 border border-border">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded bg-indigo-500/20 text-indigo-400 flex items-center justify-center"><Code size={16} /></div>
                                            <div>
                                                <div className="text-xs font-medium text-foreground">{rule.name || rule.id}</div>
                                                <div className="text-xxs text-muted-foreground">severity: {rule.severity || 'unknown'}</div>
                                            </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono">{rule.count || 0}</div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-xs text-muted-foreground">No real rule telemetry available.</div>
                            )}
                        </div>
                    </div>

                    <div className="bg-surface border border-border rounded-lg p-5">
                        <div className="flex flex-col h-full justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-6 h-6 rounded bg-slate-200 dark:bg-zinc-800 flex items-center justify-center text-slate-600 dark:text-zinc-400"><Key size={14} /></div>
                                    <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">{t('dashboard.quick_api_key')}</span>
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed">Showing latest real API key prefix from backend.</p>
                            </div>

                            <div className="mt-4 p-2 bg-muted/20 rounded border border-border flex items-center justify-between">
                                <code className="text-xs font-mono text-foreground">{apiKeys[0]?.prefix ? `${apiKeys[0].prefix}***` : 'N/A'}</code>
                                <span className="text-[10px] text-muted-foreground">{apiKeys[0]?.lastUsed || 'never'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <footer className="mt-10 pt-6 border-t border-border/50 text-center pb-6">
                <p className="text-xxs text-muted-foreground">FluxGuard Console v2.4.0 - Enterprise Edition</p>
            </footer>
        </div>
    );
};

export default Dashboard;
