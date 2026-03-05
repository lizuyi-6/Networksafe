import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    Network,
    Activity,
    Shield,
    ArrowUpRight,
    ArrowDownLeft,
    Globe,
    Zap,
    Clock,
    Database,
    RefreshCw,
    XCircle,
    CheckCircle,
    ShieldAlert
} from 'lucide-react';
import {
    fetchTrafficStats,
    fetchActiveFlows,
    fetchProtocolDistribution,
    fetchThreatDetections
} from '../services/api';
import type { TrafficStats, FlowInfo } from '../types/api';

export default function TrafficInterceptor() {
    const { t } = useTranslation();
    const [stats, setStats] = useState<TrafficStats | null>(null);
    const [flows, setFlows] = useState<FlowInfo[]>([]);
    const [protocols, setProtocols] = useState({ http: 0, https: 0, dns: 0, other: 0 });
    const [threats, setThreats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    useEffect(() => {
        loadData();

        if (autoRefresh) {
            const interval = setInterval(loadData, 3000);
            return () => clearInterval(interval);
        }
    }, [autoRefresh]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statsData, flowsData, protocolsData, threatsData] = await Promise.all([
                fetchTrafficStats(),
                fetchActiveFlows(),
                fetchProtocolDistribution(),
                fetchThreatDetections()
            ]);

            if (statsData) setStats(statsData);
            if (flowsData) setFlows(flowsData);
            if (protocolsData) setProtocols(protocolsData);
            if (threatsData) setThreats(threatsData);
        } catch (e) {
            console.error("Traffic fetch error", e);
        }
        setLoading(false);
    };

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    };

    const formatUptime = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    };

    const getProtocolPercentage = (value: number) => {
        const total = protocols.http + protocols.https + protocols.dns + protocols.other;
        if (total === 0) return 0;
        return ((value / total) * 100).toFixed(1);
    };

    const getSeverityText = (severity: string) => {
        return t(`trafficInterceptor.severities.${severity}`);
    };

    const StatCard = ({ icon: Icon, label, value, color, glowColor, delay }: any) => (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay }}
            className="bg-card backdrop-blur-xl border border-border rounded-2xl p-5 relative overflow-hidden group shadow-2xl"
        >
            <div className={`absolute -right-10 -bottom-10 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity ${glowColor}`} />
            <div className="flex items-center gap-3 relative z-10 mb-3">
                <div className={`p-2 rounded-xl bg-muted/50 border border-border/50 shadow-[0_0_15px_rgba(0,0,0,0.5)] group-hover:shadow-[0_0_20px_currentColor] transition-shadow ${color}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
            </div>
            <p className={`text-3xl font-black ${color} tracking-tighter relative z-10 font-mono drop-shadow-[0_0_8px_currentColor]`}>
                {value}
            </p>
        </motion.div>
    );

    return (
        <div className="p-6 md:p-8 space-y-8 relative min-h-screen pb-12 overflow-hidden">
            {/* Background Map & Radar Elements */}
            <div className="absolute inset-0 pointer-events-none -z-10 flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-background" />
                {/* Radar Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />
                <div className="absolute w-[800px] h-[800px] border border-cyan-500/10 rounded-full" />
                <div className="absolute w-[600px] h-[600px] border border-cyan-500/15 rounded-full" />
                <div className="absolute w-[400px] h-[400px] border border-cyan-500/20 rounded-full bg-cyan-500/5" />
                <div className="absolute w-[2px] h-[800px] bg-cyan-500/10 rotate-45" />
                <div className="absolute w-[800px] h-[2px] bg-cyan-500/10 rotate-45" />

                {/* Scanline Sweep */}
                <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] -mt-[400px] -ml-[400px] origin-bottom-right bg-[conic-gradient(from_180deg_at_100%_100%,rgba(34,211,238,0.1)_0deg,transparent_60deg)] animate-[spin_4s_linear_infinite]" />
            </div>

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-500/20 border border-cyan-500/40 rounded-2xl shadow-[0_0_20px_rgba(34,211,238,0.4)] backdrop-blur-md relative overflow-hidden">
                        <div className="absolute inset-0 bg-cyan-400/20 animate-pulse pointer-events-none" />
                        <Network className="w-10 h-10 text-cyan-400 relative z-10" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-foreground tracking-tight drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]">{t('trafficInterceptor.title')}</h1>
                        <p className="text-cyan-500/70 mt-1 font-medium flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                            {t('trafficInterceptor.subtitle')}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4 bg-card backdrop-blur-xl p-2 rounded-xl border border-border shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer px-3 hover:text-cyan-400 transition-colors">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="w-4 h-4 rounded bg-background border-border text-cyan-500 focus:ring-cyan-500/50"
                        />
                        {t('trafficInterceptor.autoRefresh')}
                    </label>
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-lg hover:from-cyan-500 hover:to-blue-500 transition-all text-white font-bold shadow-[0_0_15px_rgba(34,211,238,0.5)] border border-cyan-400/50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {t('trafficInterceptor.refresh')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 relative z-10">
                <StatCard icon={Activity} label={t('trafficInterceptor.packets')} value={stats?.packetsProcessed?.toLocaleString() || 0} color="text-cyan-400" glowColor="bg-cyan-500" delay={0.0} />
                <StatCard icon={CheckCircle} label={t('trafficInterceptor.allowed')} value={stats?.packetsAllowed?.toLocaleString() || 0} color="text-emerald-400" glowColor="bg-emerald-500" delay={0.1} />
                <StatCard icon={XCircle} label={t('trafficInterceptor.blocked')} value={stats?.packetsBlocked?.toLocaleString() || 0} color="text-rose-500" glowColor="bg-rose-600" delay={0.2} />
                <StatCard icon={Shield} label={t('trafficInterceptor.inspected')} value={stats?.packetsInspected?.toLocaleString() || 0} color="text-amber-400" glowColor="bg-amber-500" delay={0.3} />
                <StatCard icon={Database} label={t('trafficInterceptor.bytes')} value={formatBytes(Number(stats?.bytesProcessed || 0))} color="text-purple-400" glowColor="bg-purple-500" delay={0.4} />
                <StatCard icon={Clock} label={t('trafficInterceptor.uptime')} value={formatUptime(stats?.uptime || 0)} color="text-foreground" glowColor="bg-foreground/50" delay={0.5} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-card backdrop-blur-xl border border-border rounded-2xl p-6 md:p-8 shadow-[0_0_30px_rgba(0,0,0,0.5)] relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/10 blur-3xl rounded-full" />
                    <h2 className="text-xl font-bold text-foreground mb-8 flex items-center gap-3 relative z-10">
                        <div className="p-2 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                            <Globe className="w-6 h-6" />
                        </div>
                        {t('trafficInterceptor.protocolDistribution')}
                    </h2>

                    <div className="space-y-6 relative z-10">
                        {[
                            { name: 'HTTP', value: protocols.http, color: 'bg-blue-500', glow: 'shadow-[0_0_10px_rgba(59,130,246,0.5)]' },
                            { name: 'HTTPS', value: protocols.https, color: 'bg-emerald-500', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.5)]' },
                            { name: 'DNS', value: protocols.dns, color: 'bg-amber-500', glow: 'shadow-[0_0_10px_rgba(245,158,11,0.5)]' },
                            { name: t('trafficInterceptor.other'), value: protocols.other, color: 'bg-muted-foreground', glow: '' }
                        ].map((protocol, i) => (
                            <div key={protocol.name} className="group">
                                <div className="flex justify-between text-sm font-bold mb-2">
                                    <span className="text-muted-foreground uppercase tracking-widest">{protocol.name}</span>
                                    <span className="text-foreground font-mono">{getProtocolPercentage(protocol.value)}%</span>
                                </div>
                                <div className="h-3 bg-muted rounded-full overflow-hidden border border-border/50 shadow-inner">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${getProtocolPercentage(protocol.value)}%` }}
                                        transition={{ duration: 1, delay: 0.5 + (i * 0.1) }}
                                        className={`h-full ${protocol.color} ${protocol.glow} relative`}
                                    >
                                        <div className="absolute inset-0 bg-white/20 w-full h-full" style={{ filter: 'blur(2px)' }}></div>
                                    </motion.div>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                    className="bg-card backdrop-blur-xl border border-rose-500/20 rounded-2xl p-6 md:p-8 shadow-[0_0_30px_rgba(244,63,94,0.15)] relative overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-orange-500/5 pointer-events-none" />
                    <div className="absolute top-0 right-0 w-40 h-40 bg-rose-500/10 blur-3xl rounded-full" />
                    <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3 relative z-10">
                        <div className="p-2 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
                            <ShieldAlert className="w-6 h-6" />
                        </div>
                        {t('trafficInterceptor.threatDetections')}
                        <span className="ml-auto w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    </h2>

                    <div className="relative z-10">
                        {threats.length > 0 ? (
                            <div className="space-y-3">
                                <AnimatePresence>
                                    {threats.slice(0, 5).map((threat, i) => (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ delay: 0.6 + (i * 0.1) }}
                                            key={i}
                                            className="flex items-center justify-between p-3.5 bg-muted/60 rounded-xl border border-rose-500/20 hover:bg-muted/80 hover:border-rose-500/40 transition-colors group cursor-pointer"
                                        >
                                            <div className="flex items-center gap-4">
                                                <span className={`px-3 py-1 rounded-lg text-xs font-bold tracking-widest ${threat.severity === 'critical' ? 'bg-red-500/20 text-red-400 border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]' :
                                                    threat.severity === 'high' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 shadow-[0_0_10px_rgba(249,115,22,0.2)]' :
                                                        threat.severity === 'medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                                                            'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                    }`}>
                                                    {getSeverityText(threat.severity).toUpperCase()}
                                                </span>
                                                <span className="text-sm font-semibold text-rose-100 group-hover:text-foreground transition-colors">{threat.type}</span>
                                            </div>
                                            <span className="text-rose-400 font-mono font-bold bg-rose-500/10 px-3 py-1 rounded-lg border border-rose-500/20">{threat.count}</span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        ) : (
                            <div className="text-center flex flex-col items-center justify-center py-12 border border-dashed border-border/50 rounded-xl bg-muted/40">
                                <Shield className="w-12 h-12 text-muted-foreground mb-3" />
                                <div className="text-muted-foreground font-bold tracking-widest">{t('trafficInterceptor.noThreats')}</div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="bg-card backdrop-blur-xl border border-cyan-500/30 rounded-2xl shadow-[0_0_30px_rgba(34,211,238,0.1)] relative overflow-hidden z-10"
            >
                <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none" />
                <div className="p-6 md:p-8 border-b border-border/50">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
                            <div className="p-2 rounded-full bg-cyan-500/20 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                                <Zap className="w-6 h-6" />
                            </div>
                            {t('trafficInterceptor.activeFlows')}
                        </h2>
                        <span className="text-xs font-bold text-cyan-400 bg-cyan-400/10 px-3 py-1.5 rounded-full border border-cyan-400/20 uppercase tracking-widest">
                            {stats?.currentFlows || 0} {t('trafficInterceptor.connections')}
                        </span>
                    </div>
                </div>

                <div className="p-2">
                    {flows.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead>
                                    <tr className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border/50">
                                        <th className="py-4 px-6">{t('trafficInterceptor.source')}</th>
                                        <th className="py-4 px-6">{t('trafficInterceptor.destination')}</th>
                                        <th className="py-4 px-6">{t('trafficInterceptor.protocol')}</th>
                                        <th className="py-4 px-6">{t('trafficInterceptor.state')}</th>
                                        <th className="py-4 px-6 text-right">{t('trafficInterceptor.packets')}</th>
                                        <th className="py-4 px-6 text-right">{t('trafficInterceptor.bytes')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <AnimatePresence>
                                        {flows.slice(0, 10).map((flow, i) => (
                                            <motion.tr
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.7 + (i * 0.05) }}
                                                key={flow.id}
                                                className="border-b border-border/50 hover:bg-muted/50 transition-colors group"
                                            >
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                                            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                                                        </div>
                                                        <span className="text-foreground font-mono font-medium group-hover:text-emerald-300 transition-colors">
                                                            {flow.sourceIP}<span className="text-muted-foreground">:{flow.sourcePort}</span>
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center">
                                                            <ArrowDownLeft className="w-3 h-3 text-indigo-400" />
                                                        </div>
                                                        <span className="text-foreground font-mono font-medium group-hover:text-indigo-300 transition-colors">
                                                            {flow.destIP}<span className="text-muted-foreground">:{flow.destPort}</span>
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-6">
                                                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold tracking-widest border ${flow.protocol === 'tcp' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' :
                                                        flow.protocol === 'udp' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' :
                                                            'bg-muted/50 text-muted-foreground border-border'
                                                        }`}>
                                                        {flow.protocol.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-6">
                                                    <span className="text-muted-foreground font-mono text-xs font-semibold">{flow.state}</span>
                                                </td>
                                                <td className="py-4 px-6 text-right font-mono font-bold text-cyan-400">
                                                    {(flow.packetCount ?? 0).toLocaleString()}
                                                </td>
                                                <td className="py-4 px-6 text-right font-mono font-bold text-muted-foreground">
                                                    {formatBytes(flow.byteCount ?? 0)}
                                                </td>
                                            </motion.tr>
                                        ))}
                                    </AnimatePresence>
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-center flex flex-col items-center justify-center py-16">
                            <Activity className="w-12 h-12 text-muted-foreground mb-4 animate-pulse" />
                            <div className="text-muted-foreground font-bold tracking-widest">{t('trafficInterceptor.noFlows')}</div>
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Bottom Status Blocks */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10 opacity-70 hover:opacity-100 transition-opacity">
                <div className="bg-card dark:bg-slate-900/60 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl p-4 text-center group hover:border-border dark:hover:border-white/10 transition-colors">
                    <p className="text-[10px] font-bold text-muted-foreground dark:text-slate-500 uppercase tracking-widest mb-1">{t('trafficInterceptor.avgProcessingTime')}</p>
                    <p className="text-xl font-bold text-muted-foreground dark:text-slate-300 font-mono group-hover:text-foreground dark:group-hover:text-white transition-colors">
                        {(stats?.avgProcessingTime || 0).toFixed(2)}<span className="text-sm text-muted-foreground dark:text-slate-600 ml-1">ms</span>
                    </p>
                </div>
                <div className="bg-card dark:bg-slate-900/60 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl p-4 text-center group hover:border-rose-500/30 transition-colors">
                    <p className="text-[10px] font-bold text-muted-foreground dark:text-slate-500 uppercase tracking-widest mb-1">{t('trafficInterceptor.droppedPackets')}</p>
                    <p className="text-xl font-bold text-rose-500/70 font-mono group-hover:text-rose-400 transition-colors">
                        {stats?.droppedPackets?.toLocaleString() || 0}
                    </p>
                </div>
                <div className="bg-card dark:bg-slate-900/60 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl p-4 text-center group hover:border-amber-500/30 transition-colors">
                    <p className="text-[10px] font-bold text-muted-foreground dark:text-slate-500 uppercase tracking-widest mb-1">{t('trafficInterceptor.bufferOverflows')}</p>
                    <p className="text-xl font-bold text-amber-500/70 font-mono group-hover:text-amber-400 transition-colors">
                        {stats?.bufferOverflows?.toLocaleString() || 0}
                    </p>
                </div>
                <div className="bg-card dark:bg-slate-900/60 backdrop-blur-md border border-border/50 dark:border-white/5 rounded-2xl p-4 text-center group hover:border-emerald-500/30 transition-colors">
                    <p className="text-[10px] font-bold text-muted-foreground dark:text-slate-500 uppercase tracking-widest mb-1">{t('trafficInterceptor.cpuUsage')}</p>
                    <p className="text-xl font-bold text-emerald-500/70 font-mono group-hover:text-emerald-400 transition-colors">
                        {(stats?.cpuUsage || 0).toFixed(1)}<span className="text-sm text-muted-foreground dark:text-slate-600 ml-1">%</span>
                    </p>
                </div>
            </div>
        </div>
    );
}
