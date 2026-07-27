import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useLiveMode } from '../context/LiveModeContext';
import { AlertTriangle, Clock, Cpu, HardDrive, RefreshCw, Scan, Server, Wifi, WifiOff } from 'lucide-react';
import { fetchAgentsList, fetchRecentAgentThreats, triggerAgentScan } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import { motion, Variants } from 'framer-motion';

interface Agent {
    agentId: string;
    hostname: string;
    platform: string;
    isOnline: boolean;
    lastHeartbeat: string;
    status?: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
    };
}

const staggerContainer: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariant: Variants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const Agents = () => {
    const { liveModeEnabled } = useLiveMode();
    const { t } = useLanguage();

    const formatUptime = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}${t('agents.day')} ${hours}${t('agents.hour')}`;
        if (hours > 0) return `${hours}${t('agents.hour')} ${mins}${t('agents.minute')}`;
        return `${mins}${t('agents.minute')}`;
    };

    const [agents, setAgents] = useState<Agent[]>([]);
    const [threats, setThreats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    const fetchAgents = async () => {
        try {
            const data = await fetchAgentsList();
            setAgents(data?.agents || []);
        } catch (e: any) {
            setAgents([]);
            setError(e.message || 'FG-AGENTS-LIST-ERR');
        } finally {
            setLoading(false);
        }
    };

    const fetchThreats = async () => {
        try {
            const rows = await fetchRecentAgentThreats(50);
            setThreats(rows || []);
        } catch (e: any) {
            setThreats([]);
            setError(e.message || 'FG-AGENTS-THREATS-ERR');
        }
    };

    const triggerScan = async (agentId: string) => {
        try {
            const response = await triggerAgentScan(agentId);
            setActionMessage(response?.message || `Scan queued for ${agentId}`);
            await fetchThreats();
        } catch (e: any) {
            setError(e.message || 'FG-AGENT-SCAN');
        }
    };

    useEffect(() => {
        fetchAgents();
        fetchThreats();
        if (!liveModeEnabled) {
            return;
        }
        const interval = setInterval(() => {
            fetchAgents();
            fetchThreats();
        }, 10000);
        return () => clearInterval(interval);
    }, [liveModeEnabled]);

    const onlineCount = agents.filter((a) => a.isOnline).length;

    return (
        <ConsolePage
            title={t('agents.page_title')}
            subtitle={t('agents.page_subtitle')}
            actions={<button data-testid="agents-refresh" onClick={() => { fetchAgents(); fetchThreats(); }} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{t('agents.refresh')}</button>}
        >
            {actionMessage && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-300">{actionMessage}</motion.div>}
            {error && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</motion.div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={Server} label={t('agents.total_agents')} value={agents.length} hint={t('agents.total_agents_hint')} tone="primary" />
                <ConsoleStatCard icon={Wifi} label={t('agents.online_nodes')} value={onlineCount} hint={t('agents.online_hint')} tone="success" />
                <ConsoleStatCard icon={AlertTriangle} label={t('agents.recent_threats')} value={threats.length} hint={t('agents.threats_hint')} tone="danger" />
                <ConsoleStatCard icon={Clock} label={t('agents.online_rate')} value={`${Math.round((onlineCount / (agents.length || 1)) * 100)}%`} hint={t('agents.online_rate_hint')} tone="warning" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                    <ConsolePanel title={t('agents.fleet')} subtitle={t('agents.fleet_subtitle')} icon={Server} iconTone="primary">
                        {loading ? (
                            <ConsoleEmptyState title={t('agents.loading_agents')} />
                        ) : agents.length === 0 ? (
                            <ConsoleEmptyState title={t('agents.no_agents_display')} />
                        ) : (
                            <motion.div
                                variants={staggerContainer}
                                initial="hidden"
                                animate="visible"
                                className="grid grid-cols-1 gap-4 md:grid-cols-2"
                            >
                                {agents.map((agent) => (
                                    <motion.div
                                        variants={itemVariant}
                                        whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                        key={agent.agentId}
                                        className="rounded-xl border border-border bg-muted/15 p-5 transition-shadow hover:shadow-lg hover:border-primary/50 group"
                                    >
                                        <div className="mb-4 flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`rounded-lg p-2 transition-colors ${agent.isOnline ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/25' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 group-hover:bg-rose-500/25'}`}>
                                                    <Server size={20} />
                                                </div>
                                                <div>
                                                    <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">{agent.hostname || agent.agentId}</h3>
                                                    <p className="font-mono text-xs text-muted-foreground">{agent.agentId}</p>
                                                </div>
                                            </div>
                                            <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${agent.isOnline ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                                                {agent.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                                                {agent.isOnline ? t('agents.online') : t('agents.offline')}
                                            </span>
                                        </div>

                                        <div className="mb-4 grid grid-cols-3 gap-4">
                                            <div className="rounded-lg bg-card p-2 text-center border border-border/50 group-hover:border-primary/20 transition-colors"><Cpu size={14} className="mx-auto mb-1 text-muted-foreground" /><div className="text-sm font-medium text-foreground">{agent.status?.cpuUsage ?? '--'}%</div><div className="text-[11px] text-muted-foreground">{t('agents.cpu')}</div></div>
                                            <div className="rounded-lg bg-card p-2 text-center border border-border/50 group-hover:border-primary/20 transition-colors"><HardDrive size={14} className="mx-auto mb-1 text-muted-foreground" /><div className="text-sm font-medium text-foreground">{agent.status?.memoryUsage ?? '--'}%</div><div className="text-[11px] text-muted-foreground">{t('agents.memory')}</div></div>
                                            <div className="rounded-lg bg-card p-2 text-center border border-border/50 group-hover:border-primary/20 transition-colors"><Clock size={14} className="mx-auto mb-1 text-muted-foreground" /><div className="text-sm font-medium text-foreground">{agent.status?.uptime ? formatUptime(agent.status.uptime) : '--'}</div><div className="text-[11px] text-muted-foreground">{t('agents.uptime_label')}</div></div>
                                        </div>

                                        <div className="flex gap-2">
                                            <button data-testid={`agent-scan-${agent.agentId}`} onClick={() => triggerScan(agent.agentId)} disabled={!agent.isOnline} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"><Scan size={14} />{t('agents.initiate_scan')}</button>
                                            <Link data-testid={`agent-detail-${agent.agentId}`} to={`/agents/${encodeURIComponent(agent.agentId)}`} className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-all hover:bg-muted/50 hover:border-primary/30">{t('agents.view_detail')}</Link>
                                        </div>
                                    </motion.div>
                                ))}
                            </motion.div>
                        )}
                    </ConsolePanel>
                </div>

                <ConsolePanel title={t('agents.threat_panel')} subtitle={t('agents.threat_panel_subtitle')} icon={AlertTriangle} iconTone="warning">
                    <motion.div
                        variants={staggerContainer}
                        initial="hidden"
                        animate="visible"
                        className="space-y-3"
                    >
                        {threats.length > 0 ? threats.map((event: any, idx: number) => (
                            <motion.div
                                variants={itemVariant}
                                whileHover={{ scale: 1.02 }}
                                key={event.id || idx}
                                className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 transition-colors hover:bg-amber-500/20 cursor-default"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                                        <span className="text-sm font-medium text-foreground">{event.title || t('agents.security_event')}</span>
                                    </div>
                                    <span className="text-[11px] font-bold uppercase text-amber-600 dark:text-amber-400">{event.severity || 'medium'}</span>
                                </div>
                                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                    <div>{event.message || '-'}</div>
                                    <div>{t('agents.source_label')}: {event.source || '-'}</div>
                                    <div>{t('agents.time_label')}: {event.timestamp ? new Date(event.timestamp).toLocaleString() : '-'}</div>
                                </div>
                            </motion.div>
                        )) : <ConsoleEmptyState title={t('agents.no_active_threats')} description={t('agents.no_threats_desc')} />}
                    </motion.div>
                </ConsolePanel>
            </div>
        </ConsolePage>
    );
};

export default Agents;
