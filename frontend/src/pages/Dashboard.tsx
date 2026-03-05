import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
    Shield, Server, Zap, Globe, Terminal,
    Search, Pause, Download, Code, ArrowUpRight, Key,
    Cpu, HardDrive, Database, Activity
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

const StatCard = ({ title, value, subtext, icon: Icon, color, trend, delay = 0 }: any) => {
    const bgColor = color.replace('text-', 'bg-').replace(/-\d+$/, '-50');
    const darkBgColor = color.replace('text-', 'dark:bg-').replace(/-\d+$/, '-50/10');
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay }}
            whileHover={{ y: -5, scale: 1.02 }}
            className="relative overflow-hidden rounded-2xl p-6 bg-card border border-border shadow-sm group"
        >
            <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">{title}</span>
                    <span className="text-3xl font-extrabold text-foreground tracking-tight mt-2 flex items-baseline gap-1">
                        {value}
                    </span>
                </div>
                <div className={`p-3 rounded-xl ${bgColor} ${darkBgColor} ${color} transition-colors group-hover:bg-opacity-80`}>
                    <Icon size={24} strokeWidth={2} />
                </div>
            </div>
            <div className="flex items-center gap-3 relative z-10">
                {trend !== undefined && (
                    <span className={`text-xs font-bold flex items-center gap-1 ${trend > 0 ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10' : 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10'} px-2 py-1 rounded-lg`}>
                        <ArrowUpRight size={12} className={trend < 0 ? 'rotate-90' : ''} /> {Math.abs(trend)}%
                    </span>
                )}
                <span className="text-xs text-muted-foreground font-medium">{subtext}</span>
            </div>
        </motion.div>
    );
};

const TrafficChart = ({ data }: { data: any[] }) => (
    <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
                <defs>
                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} dx={-10} />
                <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', backdropFilter: 'blur(8px)', borderColor: 'hsl(var(--border))', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                    itemStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="requests" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorRequests)" activeDot={{ r: 6, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }} />
                <Area type="monotone" dataKey="blocked" stroke="#e11d48" strokeWidth={3} fillOpacity={1} fill="url(#colorBlocked)" activeDot={{ r: 6, fill: '#e11d48', stroke: '#fff', strokeWidth: 2 }} />
            </AreaChart>
        </ResponsiveContainer>
    </div>
);

const LogStream = ({ logs, t }: { logs: LogItem[], t: any }) => (
    <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2 scrollbar-hide bg-muted/30 rounded-b-xl h-full relative border-t border-border">
        <AnimatePresence>
            {logs.map((log) => (
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={log.id}
                    className={`flex gap-4 p-2.5 rounded-lg cursor-pointer transition-all border shadow-sm ${log.level === 'ERROR' || log.status === 403
                        ? 'bg-destructive/10 border-destructive/20 hover:bg-destructive/20 text-destructive'
                        : 'bg-card border-border hover:border-primary/50 text-foreground'
                        }`}
                >
                    <span className="text-muted-foreground shrink-0 w-20">{new Date(log.time).toLocaleTimeString()}</span>
                    <span className={`shrink-0 w-12 font-bold ${log.status === 200 ? 'text-emerald-600 dark:text-emerald-400' : log.status === 403 ? 'text-rose-600 dark:text-rose-400' : log.status === 429 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{log.status || 200}</span>
                    <span className="text-primary font-semibold shrink-0 w-10">{log.type}</span>
                    <span className="break-all">{log.message}</span>
                </motion.div>
            ))}
        </AnimatePresence>
        {logs.length === 0 && <div className="text-muted-foreground text-center py-8 font-sans">{t('dashboard.waiting_logs')}</div>}
    </div>
);

function getCountryColor(code: string): string {
    const colors: Record<string, string> = {
        CN: 'bg-rose-500',
        US: 'bg-indigo-500',
        RU: 'bg-rose-600',
        JP: 'bg-amber-500',
        DE: 'bg-blue-500',
        GB: 'bg-blue-600',
        Unknown: 'bg-slate-400'
    };
    return colors[code] || 'bg-slate-400';
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

    const [userRole, setUserRole] = useState<string>('viewer');

    useEffect(() => {
        const loadSideData = async () => {
            try {
                let role = 'viewer';
                try {
                    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
                    if (meRes.ok) {
                        const meData = await meRes.json();
                        role = meData.user?.role || 'viewer';
                        setUserRole(role);
                    }
                } catch { /* ignore */ }

                const fetchPromises: Promise<any>[] = [fetchDashboardRulesSummary()];

                if (role === 'admin') {
                    fetchPromises.push(fetchAdminApiKeys().catch(() => []));
                }

                const [rules, keys] = await Promise.all(fetchPromises);

                setRulesSummary(rules || { totalRules: 0, activeRules: 0, topRules: [] });
                if (role === 'admin') {
                    setApiKeys(keys || []);
                }
            } catch (e: any) {
                setError(e.message || 'FG-DASHBOARD-SIDE');
            }
        };
        loadSideData();
    }, []);

    if (error) {
        return <ErrorDisplay title="Error Loading Dashboard" message={error} onRetry={() => window.location.reload()} />;
    }

    if (!stats) return (
        <div className="flex items-center justify-center min-h-[400px]">
            <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                className="w-8 h-8 rounded-full border-t-2 border-b-2 border-indigo-500"
            />
        </div>
    );

    return (
        <div className="space-y-8 relative min-h-screen pb-10 bg-background text-foreground overflow-hidden px-8">
            <div className="absolute inset-0 pointer-events-none z-0 opacity-40">
                <div className="absolute inset-0"
                    style={{
                        backgroundImage: 'linear-gradient(hsl(var(--primary) / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.05) 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}>
                </div>
            </div>

            <div className="flex flex-col mb-8 relative z-10 pt-4">
                <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">{t('dashboard.title') || 'Platform Overview'}</h1>
                <p className="text-muted-foreground font-medium">{t('dashboard.subtitle') || 'Real-time telemetry and threat intelligence'}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title={t('dashboard.total_requests')} value={stats.totalRequests.toLocaleString()} subtext={t('dashboard.vs_last_period') || "vs last period"} trend={stats.requestsTrend} icon={Server} color="text-indigo-600" delay={0.1} />
                <StatCard title={t('dashboard.threats_blocked')} value={stats.blockedRequests.toLocaleString()} subtext={t('dashboard.rate_spike_detected') || "Recent spike detected"} trend={stats.blockedTrend} icon={Shield} color="text-rose-600" delay={0.2} />
                <StatCard title={t('dashboard.avg_latency')} value={`${stats.avgProcessingTime || 0}ms`} subtext={`P99: ${stats.p99Latency || 0}ms`} icon={Zap} color="text-amber-600" delay={0.3} />
                <StatCard title={t('dashboard.global_health')} value={`${stats.successRate}%`} subtext={t('header.system_healthy')} icon={Globe} color="text-emerald-600" delay={0.4} />
            </div>

            {/* System Status Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title={t('dashboard.cpu_usage') || 'CPU Usage'} value={`${(stats.cpuUsage && !isNaN(stats.cpuUsage)) ? stats.cpuUsage.toFixed(1) : 0}%`} subtext={t('dashboard.host_cpu') || "Host CPU"} icon={Cpu} color="text-cyan-600" delay={0.5} />
                <StatCard title={t('dashboard.ram_usage') || 'RAM Usage'} value={`${(stats.memoryUsage && !isNaN(stats.memoryUsage)) ? stats.memoryUsage.toFixed(1) : 0}%`} subtext={t('dashboard.host_ram') || "System Memory"} icon={HardDrive} color="text-emerald-600" delay={0.6} />
                <StatCard title={t('dashboard.disk_usage') || 'Disk Usage'} value={`${(stats.diskUsage && !isNaN(stats.diskUsage)) ? stats.diskUsage.toFixed(1) : 0}%`} subtext={t('dashboard.sys_disk') || "Root Drive"} icon={Database} color="text-indigo-600" delay={0.7} />
                <StatCard title={t('dashboard.network_usage') || 'Network Usage'} value={`${(stats.networkUsage && !isNaN(stats.networkUsage)) ? stats.networkUsage.toFixed(2) : 0} MB/s`} subtext={t('dashboard.throughput') || "I/O Throughput"} icon={Activity} color="text-purple-600" delay={0.8} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 }}
                    className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 min-h-[400px] flex flex-col shadow-sm relative overflow-hidden"
                >
                    <div className="flex justify-between items-center mb-6 relative z-10">
                        <div>
                            <h3 className="text-lg font-bold text-foreground tracking-tight">{t('dashboard.traffic_analysis')}</h3>
                            <p className="text-sm text-muted-foreground mt-1">{t('dashboard.requests_per_second')} vs {t('dashboard.blocked_request')}</p>
                        </div>
                        <div className="flex bg-muted p-1 rounded-lg border border-border shadow-inner">
                            <button className="px-4 py-1.5 text-xs font-bold text-foreground bg-card rounded shadow-sm border border-border">{t('dashboard.time_1h')}</button>
                            <button className="px-4 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors">{t('dashboard.time_24h')}</button>
                        </div>
                    </div>
                    <TrafficChart data={stats.history} />
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                    className="bg-card border border-border shadow-sm rounded-2xl p-6 flex flex-col relative overflow-hidden"
                >
                    <h3 className="text-lg font-bold text-foreground tracking-tight mb-6 relative z-10">{t('dashboard.attack_origin')}</h3>
                    <div className="flex-1 space-y-5 relative z-10">
                        {stats.attackOrigins && stats.attackOrigins.length > 0 ? (
                            stats.attackOrigins.map((item, i) => (
                                <div key={i} className="relative group">
                                    <div className="flex justify-between items-center text-sm mb-2">
                                        <span className="flex items-center gap-2 text-foreground font-medium">
                                            <span className={`w-2 h-2 rounded-full ${getCountryColor(item.countryCode)}`}></span>
                                            {item.country} <span className="text-muted-foreground">({item.countryCode})</span>
                                        </span>
                                        <span className="font-mono text-foreground font-bold">{Math.round(item.percentage)}%</span>
                                    </div>
                                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border/50">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${item.percentage}%` }}
                                            transition={{ duration: 1, delay: 0.5 + (i * 0.1) }}
                                            className={`h-full ${getCountryColor(item.countryCode)} relative`}
                                        >
                                        </motion.div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-10 text-muted-foreground">{t('dashboard.no_attack_data')}</div>
                        )}
                        {isDemoMode && (
                            <div className="mt-8 pt-6 border-t border-border">
                                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">{t('dashboard.top_vectors')}</h4>
                                <div className="flex flex-wrap gap-2">
                                    <span className="px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 shadow-sm">{t('dashboard.sql_injection')}</span>
                                    <span className="px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 shadow-sm">{t('dashboard.xss_reflected')}</span>
                                    <span className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border bg-muted text-foreground shadow-sm">{t('dashboard.bad_bot')}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="lg:col-span-8 bg-card border border-border rounded-2xl flex flex-col h-[450px] shadow-sm relative overflow-hidden"
                >
                    <div className="px-5 py-4 bg-card border-b border-border flex justify-between items-center z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                                <Terminal size={18} strokeWidth={2.5} />
                            </div>
                            <span className="text-sm font-bold text-foreground tracking-wide">{t('dashboard.live_log_stream')}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="relative group">
                                <Search className="absolute left-3 top-2 text-muted-foreground group-focus-within:text-primary transition-colors" size={16} />
                                <input type="text" placeholder={t('dashboard.filter_placeholder')} className="bg-card border border-border rounded-lg text-sm py-1.5 pl-9 pr-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-full md:w-64 font-mono transition-all placeholder:text-muted-foreground shadow-sm" />
                            </div>
                            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border"><Pause size={18} /></button>
                            <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border"><Download size={18} /></button>
                        </div>
                    </div>
                    <LogStream logs={logs} t={t} />
                </motion.div>

                <div className="lg:col-span-4 space-y-6">
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.7 }}
                        className="bg-card border border-border rounded-2xl p-6 shadow-sm relative overflow-hidden"
                    >
                        <div className="flex justify-between items-center mb-6 relative z-10">
                            <h3 className="text-lg font-bold text-foreground tracking-tight">{t('dashboard.active_rules')}</h3>
                            <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20 shadow-sm">Total: {rulesSummary.totalRules || 0}</span>
                        </div>
                        <div className="space-y-4 relative z-10">
                            {(rulesSummary.topRules || []).length > 0 ? (
                                (rulesSummary.topRules || []).slice(0, 5).map((rule: any, i: number) => (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.8 + (i * 0.1) }}
                                        key={rule.id}
                                        className="flex items-center justify-between p-3 rounded-xl bg-card border border-border shadow-sm hover:border-primary/50 hover:bg-muted/50 transition-colors group cursor-pointer"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center group-hover:scale-110 transition-transform"><Code size={18} strokeWidth={2} /></div>
                                            <div>
                                                <div className="text-sm font-bold text-foreground mb-0.5">{rule.name || rule.id}</div>
                                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sev: {rule.severity || 'UNKNOWN'}</div>
                                            </div>
                                        </div>
                                        <div className="text-sm font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded border border-primary/20 shadow-sm">{rule.count || 0}</div>
                                    </motion.div>
                                ))
                            ) : (
                                <div className="text-sm text-center py-6 text-muted-foreground">{t('dashboard.no_rule_telemetry')}</div>
                            )}
                        </div>
                    </motion.div>

                    {userRole === 'admin' && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.8 }}
                            className="bg-card border border-border shadow-sm rounded-2xl p-6 relative overflow-hidden group hover:shadow-md transition-shadow"
                        >
                            <div className="flex flex-col h-full justify-between relative z-10">
                                <div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-sm"><Key size={16} strokeWidth={2.5} /></div>
                                        <span className="text-sm font-bold text-foreground tracking-wide">{t('dashboard.quick_api_key')}</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed font-medium">{t('dashboard.api_key_desc')}</p>
                                </div>

                                <div className="mt-6 p-3 bg-muted rounded-xl border border-border flex items-center justify-between group-hover:border-emerald-500/30 transition-colors shadow-inner">
                                    <code className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">{apiKeys[0]?.prefix ? `${apiKeys[0].prefix}••••••••••` : 'NOT_FOUND'}</code>
                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{apiKeys[0]?.lastUsed || t('dashboard.never_used')}</span>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </div>
            </div>

            <footer className="mt-12 pt-8 border-t border-border text-center pb-8 opacity-60 hover:opacity-100 transition-opacity relative z-10">
                <p className="text-xs font-bold text-muted-foreground tracking-widest">{t('dashboard.version')}</p>
            </footer>
        </div>
    );
};

export default Dashboard;
