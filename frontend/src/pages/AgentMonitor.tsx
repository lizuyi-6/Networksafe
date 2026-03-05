import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
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
    Network
} from 'lucide-react';
import { fetchAgentSystemStats, fetchAgentHealth } from '../services/api';
import type { MultiAgentSystemStats, AgentHeartbeat } from '../types/api';

const AGENT_ROLES = {
    socrates: { name: 'Socrates', team: 'Red Team', teamKey: 'agentMonitor.redTeam', color: 'text-rose-500 dark:text-rose-400', bg: 'bg-rose-500/20', border: 'border-rose-500/30', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.3)]', icon: '🔴' },
    plato: { name: 'Plato', team: 'Blue Team', teamKey: 'agentMonitor.blueTeam', color: 'text-cyan-500 dark:text-cyan-400', bg: 'bg-cyan-500/20', border: 'border-cyan-500/30', glow: 'shadow-[0_0_15px_rgba(34,211,238,0.3)]', icon: '🔵' },
    aristotle: { name: 'Aristotle', team: 'Analyst', teamKey: 'agentMonitor.analyst', color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.3)]', icon: '🟢' },
    arbitrator: { name: 'Arbitrator', team: 'Decision', teamKey: 'agentMonitor.decision', color: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/30', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.3)]', icon: '🟣' }
};

export default function AgentMonitor() {
    const { t } = useTranslation();
    const [stats, setStats] = useState<MultiAgentSystemStats | null>(null);
    const [health, setHealth] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const LAYER_INFO = [
        { id: 1, nameKey: 'agentMonitor.layers.collaboration', icon: Users },
        { id: 2, nameKey: 'agentMonitor.layers.rolePlaying', icon: Brain },
        { id: 3, nameKey: 'agentMonitor.layers.sceneTraversal', icon: Network },
        { id: 4, nameKey: 'agentMonitor.layers.capability', icon: Zap },
        { id: 5, nameKey: 'agentMonitor.layers.debate', icon: MessageSquare },
        { id: 6, nameKey: 'agentMonitor.layers.heterogeneous', icon: Activity },
        { id: 7, nameKey: 'agentMonitor.layers.synthesis', icon: ShieldAlert }
    ];

    useEffect(() => {
        loadData();

        if (autoRefresh) {
            const interval = setInterval(loadData, 5000);
            return () => clearInterval(interval);
        }
    }, [autoRefresh]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statsData, healthData] = await Promise.all([
                fetchAgentSystemStats(),
                fetchAgentHealth()
            ]);
            setStats(statsData);
            setHealth(healthData);
        } catch (e) {
            console.error("Failed to load agent data", e);
        }
        setLoading(false);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'healthy': return 'text-emerald-500 dark:text-emerald-400';
            case 'degraded': return 'text-amber-500 dark:text-amber-400';
            case 'unhealthy': return 'text-rose-500 dark:text-rose-400';
            default: return 'text-muted-foreground';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'healthy': return <CheckCircle className="w-6 h-6 text-emerald-500 dark:text-emerald-400" drop-shadow="0 0 10px rgba(16,185,129,0.5)" />;
            case 'degraded': return <AlertTriangle className="w-6 h-6 text-amber-500 dark:text-amber-400" drop-shadow="0 0 10px rgba(245,158,11,0.5)" />;
            case 'unhealthy': return <XCircle className="w-6 h-6 text-rose-500 dark:text-rose-400" drop-shadow="0 0 10px rgba(244,63,94,0.5)" />;
            default: return <Activity className="w-6 h-6 text-muted-foreground" />;
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'healthy': return t('agentMonitor.healthy');
            case 'degraded': return t('agentMonitor.degraded');
            case 'unhealthy': return t('agentMonitor.unhealthy');
            default: return t('agentMonitor.unknown');
        }
    };

    return (
        <div className="p-6 md:p-8 space-y-8 relative min-h-screen pb-12 overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none -z-10">
                <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 blur-[150px] animate-blob" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-600/10 blur-[150px] animate-blob animation-delay-2000" />
                <div className="absolute top-[40%] left-[40%] w-[30%] h-[30%] rounded-full bg-emerald-600/5 blur-[120px] animate-blob animation-delay-4000" />

                {/* Cyber grid background */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.05)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
            </div>

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-500/20 border border-purple-500/30 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.3)] backdrop-blur-md dark:bg-purple-500/20 dark:border-purple-500/30">
                        <Brain className="w-10 h-10 text-purple-500 dark:text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-foreground tracking-tight">{t('agentMonitor.title')}</h1>
                        <p className="text-muted-foreground mt-1 font-medium">{t('agentMonitor.subtitle')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4 bg-card/50 backdrop-blur-md p-2 rounded-xl border border-border">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer px-3">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="w-4 h-4 rounded bg-background border-border text-purple-500 focus:ring-purple-500/50"
                        />
                        {t('agentMonitor.autoRefresh')}
                    </label>
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg hover:from-purple-500 hover:to-indigo-500 transition-all text-white font-medium shadow-[0_0_15px_rgba(147,51,234,0.4)]"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {t('agentMonitor.refresh')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 shadow-lg relative overflow-hidden group"
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-black/5 to-transparent pointer-events-none dark:from-white/5" />
                    <div className="flex items-center justify-between relative z-10 mb-4">
                        <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.systemHealth')}</span>
                        <div className="p-2 rounded-lg bg-muted/50 border border-border/50 group-hover:bg-muted transition-colors">
                            {getStatusIcon(health?.status || 'unknown')}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 relative z-10 mt-1">
                        <div className="flex items-end gap-3">
                            <p className={`text-4xl font-black ${getStatusColor(health?.status || 'unknown')} tracking-tighter`}>
                                {getStatusText(health?.status || 'unknown').toUpperCase()}
                            </p>
                            {health?.status === 'healthy' && (
                                <span className="flex h-3 w-3 relative mb-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                                </span>
                            )}
                        </div>
                        {health?.details && Object.keys(health.details).length > 0 && health.status !== 'healthy' && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="mt-2 text-xs font-mono bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-300 p-2 rounded-lg"
                            >
                                {Object.entries(health.details).map(([key, value]) => (
                                    <div key={key} className="truncate">
                                        <span className="font-bold opacity-75">{key}:</span> {String(value)}
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 shadow-lg relative overflow-hidden group"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full" />
                    <div className="flex items-center gap-3 text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4 relative z-10">
                        <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-500 dark:text-cyan-400 group-hover:scale-110 transition-transform">
                            <Users className="w-5 h-5" />
                        </div>
                        {t('agentMonitor.activeAgents')}
                    </div>
                    <p className="text-4xl font-black text-foreground tracking-tighter relative z-10">
                        {stats?.orchestrator.registeredAgents || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 shadow-lg relative overflow-hidden group"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-3xl rounded-full" />
                    <div className="flex items-center gap-3 text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4 relative z-10">
                        <div className="p-2 rounded-lg bg-purple-500/20 text-purple-500 dark:text-purple-400 group-hover:scale-110 transition-transform">
                            <MessageSquare className="w-5 h-5" />
                        </div>
                        {t('agentMonitor.queueSize')}
                    </div>
                    <p className="text-4xl font-black text-foreground tracking-tighter relative z-10">
                        {stats?.messageBus.queueSize || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 shadow-lg relative overflow-hidden group"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-3xl rounded-full" />
                    <div className="flex items-center gap-3 text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4 relative z-10">
                        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 dark:text-amber-400 group-hover:scale-110 transition-transform">
                            <BarChart3 className="w-5 h-5" />
                        </div>
                        {t('agentMonitor.caseFiles')}
                    </div>
                    <p className="text-4xl font-black text-foreground tracking-tighter relative z-10">
                        {stats?.synthesis.totalCaseFiles || 0}
                    </p>
                </motion.div>
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 }}
                className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-8 shadow-lg relative overflow-hidden text-center"
            >
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent pointer-events-none" />
                <h2 className="text-xl font-bold text-foreground mb-8 flex items-center justify-center gap-3 relative z-10">
                    <div className="p-2 rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                        <Zap className="w-6 h-6" />
                    </div>
                    {t('agentMonitor.layerArchitecture')}
                </h2>

                <div className="flex flex-col md:flex-row items-center justify-between gap-4 relative z-10">
                    {/* Layer Connection Line */}
                    <div className="hidden md:block absolute top-1/2 left-10 right-10 h-1 bg-muted -z-10 transform -translate-y-1/2">
                        <div className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-rose-500 opacity-50 w-full animate-pulse"></div>
                    </div>

                    {LAYER_INFO.map((layer, index) => {
                        const Icon = layer.icon;
                        return (
                            <motion.div
                                key={layer.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 + (index * 0.1) }}
                                whileHover={{ y: -5, scale: 1.05 }}
                                className="w-full md:w-auto flex-1 bg-card/80 rounded-xl p-4 border border-border hover:border-indigo-500/50 transition-all shadow-lg group relative"
                            >
                                <div className="absolute -inset-0.5 bg-gradient-to-b from-indigo-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-xl blur" />
                                <div className="relative z-10 flex flex-col items-center">
                                    <div className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center mb-3 group-hover:bg-indigo-500/20 group-hover:border-indigo-500/40 transition-colors group-hover:text-indigo-400 text-muted-foreground">
                                        <Icon size={18} />
                                    </div>
                                    <div className="text-2xl font-black text-foreground tracking-tighter mb-1">L{layer.id}</div>
                                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center h-8 flex items-center justify-center leading-tight">{t(layer.nameKey)}</div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                    className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 md:p-8 shadow-lg relative overflow-hidden"
                >
                    <div className="absolute -left-10 -top-10 w-40 h-40 bg-cyan-500/10 blur-3xl rounded-full" />
                    <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3 relative z-10">
                        <div className="p-2 rounded-full bg-cyan-500/20 text-cyan-500 dark:text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                            <Users className="w-6 h-6" />
                        </div>
                        {t('agentMonitor.agentHeartbeats')}
                    </h2>

                    <div className="space-y-4 relative z-10">
                        {stats?.agents?.map((agent: AgentHeartbeat, index: number) => {
                            const roleInfo = AGENT_ROLES[agent.role as keyof typeof AGENT_ROLES] ||
                                { name: agent.role, team: 'Unknown', teamKey: 'agentMonitor.unknown', color: 'text-muted-foreground', bg: 'bg-muted/20', border: 'border-border/30', glow: '', icon: '⚪' };

                            return (
                                <motion.div
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.6 + (index * 0.1) }}
                                    key={agent.agentId}
                                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-card/50 rounded-xl border ${roleInfo.border} hover:bg-muted/30 transition-colors group relative overflow-hidden`}
                                >
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${roleInfo.bg} opacity-50`} />

                                    <div className="flex items-center gap-4 mb-4 sm:mb-0 ml-2">
                                        <div className={`w-12 h-12 rounded-xl ${roleInfo.bg} ${roleInfo.border} border flex items-center justify-center text-2xl group-hover:scale-110 transition-transform ${roleInfo.glow}`}>
                                            {roleInfo.icon}
                                        </div>
                                        <div>
                                            <p className={`font-bold text-lg ${roleInfo.color} tracking-tight`}>
                                                {roleInfo.name}
                                            </p>
                                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">{t(roleInfo.teamKey)}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8 px-2 sm:px-0 bg-muted/50 sm:bg-transparent rounded-lg p-3 sm:p-0">
                                        <div className="text-center">
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{t('agentMonitor.tasks')}</p>
                                            <div className="flex items-center gap-1.5 justify-center">
                                                <p className="text-xl font-bold text-foreground font-mono">{agent.tasksCompleted}</p>
                                                {agent.status === 'healthy' && (
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{t('agentMonitor.latency')}</p>
                                            <p className="text-xl font-bold text-foreground font-mono">{agent.responseTime}<span className="text-xs text-muted-foreground ml-0.5">ms</span></p>
                                        </div>
                                        <div className="text-center hidden sm:block">
                                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{t('agentMonitor.status')}</p>
                                            <p className={`text-sm font-bold uppercase ${getStatusColor(agent.status)}`}>
                                                {agent.status}
                                            </p>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        }) || (
                                <div className="text-center text-muted-foreground py-10 font-bold border border-dashed border-border rounded-xl bg-card/30">
                                    {t('agentMonitor.noAgents')}
                                </div>
                            )}
                    </div>
                </motion.div>

                <div className="space-y-6 flex flex-col">
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 }}
                        className="bg-card/40 backdrop-blur-xl border border-border rounded-2xl p-6 md:p-8 shadow-lg relative overflow-hidden flex-1"
                    >
                        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-emerald-500/10 blur-3xl rounded-full" />
                        <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-3 relative z-10">
                            <div className="p-2 rounded-full bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                <TrendingUp className="w-6 h-6" />
                            </div>
                            {t('agentMonitor.synthesisStats')}
                        </h2>

                        <div className="space-y-3 relative z-10">
                            <div className="flex justify-between items-center p-4 bg-card/50 rounded-xl border border-border/50 hover:border-emerald-500/30 transition-colors">
                                <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.totalCaseFiles')}</span>
                                <span className="text-2xl font-black text-foreground font-mono">
                                    {stats?.synthesis.totalCaseFiles || 0}
                                </span>
                            </div>
                            <div className="flex justify-between items-center p-4 bg-card/50 rounded-xl border border-border/50 hover:border-emerald-500/30 transition-colors">
                                <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.lessonsLearned')}</span>
                                <span className="text-2xl font-black text-foreground font-mono">
                                    {stats?.synthesis.totalLessons || 0}
                                </span>
                            </div>
                            <div className="flex justify-between items-center p-4 bg-card/50 rounded-xl border border-border/50 hover:border-emerald-500/30 transition-colors">
                                <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.policyUpdates')}</span>
                                <span className="text-2xl font-black text-foreground font-mono">
                                    {stats?.synthesis.totalPolicyUpdates || 0}
                                </span>
                            </div>

                            {stats?.synthesis.topPatterns && stats.synthesis.topPatterns.length > 0 && (
                                <div className="mt-6 pt-6 border-t border-border">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">{t('agentMonitor.topPatterns')}</p>
                                    <div className="space-y-2">
                                        {stats.synthesis.topPatterns.slice(0, 5).map((pattern, i) => (
                                            <div
                                                key={i}
                                                className="flex justify-between items-center p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg group"
                                            >
                                                <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-300 truncate pr-4">
                                                    {pattern.pattern}
                                                </span>
                                                <span className="text-xs font-bold text-indigo-500 dark:text-indigo-400 bg-indigo-500/20 px-2 py-1 rounded">
                                                    {pattern.frequency}x
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                className="bg-card/40 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-6 md:p-8 shadow-[0_0_30px_rgba(99,102,241,0.15)] relative overflow-hidden"
            >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-purple-500/5 to-cyan-500/5 pointer-events-none" />
                <h2 className="text-xl font-bold text-foreground mb-6 flex items-center justify-center md:justify-start gap-3 relative z-10">
                    <div className="p-2 rounded-full bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                        <Clock className="w-6 h-6" />
                    </div>
                    {t('agentMonitor.messageBusStats')}
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
                    <div className="text-center p-6 bg-card/60 rounded-xl border border-border/50 hover:border-indigo-500/30 hover:bg-muted/80 transition-all group">
                        <p className="text-4xl font-black text-foreground font-mono mb-2 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                            {stats?.messageBus.queueSize || 0}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.queueSize')}</p>
                    </div>
                    <div className="text-center p-6 bg-card/60 rounded-xl border border-border/50 hover:border-purple-500/30 hover:bg-muted/80 transition-all group">
                        <p className="text-4xl font-black text-foreground font-mono mb-2 group-hover:text-purple-500 dark:group-hover:text-purple-400 transition-colors">
                            {stats?.messageBus.subscriptionCount || 0}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.subscriptions')}</p>
                    </div>
                    <div className="text-center p-6 bg-card/60 rounded-xl border border-border/50 hover:border-rose-500/30 hover:bg-muted/80 transition-all group">
                        <p className="text-4xl font-black text-foreground font-mono mb-2 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-colors">
                            {stats?.messageBus.pendingRequests || 0}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.pendingRequests')}</p>
                    </div>
                    <div className="text-center p-6 bg-card/60 rounded-xl border border-border/50 hover:border-cyan-500/30 hover:bg-muted/80 transition-all group">
                        <p className="text-4xl font-black text-foreground font-mono mb-2 group-hover:text-cyan-500 dark:group-hover:text-cyan-400 transition-colors">
                            {stats?.orchestrator.activeTasks || 0}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t('agentMonitor.activeTasks')}</p>
                    </div>
                </div>
            </motion.div>

        </div>
    );
}
