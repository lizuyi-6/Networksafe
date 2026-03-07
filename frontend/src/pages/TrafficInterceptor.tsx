import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
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
    ShieldAlert,
} from 'lucide-react';
import {
    fetchTrafficStats,
    fetchActiveFlows,
    fetchProtocolDistribution,
    fetchThreatDetections,
} from '../services/api';
import type { TrafficStats, FlowInfo } from '../types/api';
import { useLiveMode } from '../context/LiveModeContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';

export default function TrafficInterceptor() {
    const { t } = useTranslation();
    const { liveModeEnabled } = useLiveMode();
    const [stats, setStats] = useState<TrafficStats | null>(null);
    const [flows, setFlows] = useState<FlowInfo[]>([]);
    const [protocols, setProtocols] = useState({ http: 0, https: 0, dns: 0, other: 0 });
    const [threats, setThreats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    useEffect(() => {
        loadData();

        if (autoRefresh && liveModeEnabled) {
            const interval = setInterval(loadData, 3000);
            return () => clearInterval(interval);
        }
    }, [autoRefresh, liveModeEnabled]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statsData, flowsData, protocolsData, threatsData] = await Promise.all([
                fetchTrafficStats(),
                fetchActiveFlows(),
                fetchProtocolDistribution(),
                fetchThreatDetections(),
            ]);

            if (statsData) setStats(statsData);
            if (flowsData) setFlows(flowsData);
            if (protocolsData) setProtocols(protocolsData);
            if (threatsData) setThreats(threatsData);
        } catch (e) {
            console.error('Traffic fetch error', e);
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

    const getSeverityText = (severity: string) => t(`trafficInterceptor.severities.${severity}`);

    return (
        <ConsolePage
            title={t('trafficInterceptor.title')}
            subtitle={t('trafficInterceptor.subtitle')}
            actions={
                <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-2 shadow-sm">
                    <label className="flex cursor-pointer items-center gap-2 px-3 text-sm font-medium text-foreground">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary/30"
                        />
                        {t('trafficInterceptor.autoRefresh')}
                    </label>
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        {t('trafficInterceptor.refresh')}
                    </button>
                </div>
            }
        >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <ConsoleStatCard icon={Activity} label={t('trafficInterceptor.packets')} value={stats?.packetsProcessed?.toLocaleString() || 0} hint="累计处理报文数" tone="primary" />
                <ConsoleStatCard icon={CheckCircle} label={t('trafficInterceptor.allowed')} value={stats?.packetsAllowed?.toLocaleString() || 0} hint="已通过检测链路" tone="success" />
                <ConsoleStatCard icon={XCircle} label={t('trafficInterceptor.blocked')} value={stats?.packetsBlocked?.toLocaleString() || 0} hint="已被主动拦截" tone="danger" />
                <ConsoleStatCard icon={Shield} label={t('trafficInterceptor.inspected')} value={stats?.packetsInspected?.toLocaleString() || 0} hint="已完成深度检查" tone="warning" />
                <ConsoleStatCard icon={Database} label={t('trafficInterceptor.bytes')} value={formatBytes(Number(stats?.bytesProcessed || 0))} hint="累计吞吐量" tone="neutral" />
                <ConsoleStatCard icon={Clock} label={t('trafficInterceptor.uptime')} value={formatUptime(stats?.uptime || 0)} hint="拦截器持续运行时长" tone="neutral" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-5">
                    <ConsolePanel title={t('trafficInterceptor.protocolDistribution')} subtitle="当前观测流量的协议分布" icon={Globe} iconTone="primary">
                        <div className="space-y-4">
                            {[
                                { name: 'HTTP', value: protocols.http, color: 'bg-blue-500' },
                                { name: 'HTTPS', value: protocols.https, color: 'bg-emerald-500' },
                                { name: 'DNS', value: protocols.dns, color: 'bg-amber-500' },
                                { name: t('trafficInterceptor.other'), value: protocols.other, color: 'bg-muted-foreground' },
                            ].map((protocol, index) => (
                                <div key={protocol.name}>
                                    <div className="mb-1.5 flex items-center justify-between text-sm">
                                        <span className="font-medium uppercase tracking-wide text-muted-foreground">{protocol.name}</span>
                                        <span className="font-mono text-foreground">{getProtocolPercentage(protocol.value)}%</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${getProtocolPercentage(protocol.value)}%` }}
                                            transition={{ duration: 0.8, delay: index * 0.08 }}
                                            className={`h-full ${protocol.color}`}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ConsolePanel>
                </div>

                <div className="lg:col-span-7">
                    <ConsolePanel title={t('trafficInterceptor.threatDetections')} subtitle="按风险等级汇总的最新检测计数" icon={ShieldAlert} iconTone="danger">
                        {threats.length > 0 ? (
                            <div className="space-y-2">
                                <AnimatePresence>
                                    {threats.slice(0, 5).map((threat, index) => (
                                        <motion.div
                                            key={`${threat.type}-${index}`}
                                            initial={{ opacity: 0, scale: 0.96 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ delay: index * 0.05 }}
                                            className="flex items-center justify-between rounded-lg border border-border bg-muted/15 p-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span
                                                    className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                                                        threat.severity === 'critical'
                                                            ? 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                            : threat.severity === 'high'
                                                              ? 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                                                              : threat.severity === 'medium'
                                                                ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                                                : 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                                    }`}
                                                >
                                                    {getSeverityText(threat.severity).toUpperCase()}
                                                </span>
                                                <span className="text-sm font-medium text-foreground">{threat.type}</span>
                                            </div>
                                            <span className="font-mono text-sm font-semibold text-foreground">{threat.count}</span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        ) : (
                            <ConsoleEmptyState title={t('trafficInterceptor.noThreats')} description="当前没有待处理的威胁检测结果。" />
                        )}
                    </ConsolePanel>
                </div>
            </div>

            <ConsolePanel
                title={t('trafficInterceptor.activeFlows')}
                subtitle="当前已纳入检测的连接"
                icon={Zap}
                iconTone="primary"
                headerAction={
                    <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {stats?.currentFlows || 0} {t('trafficInterceptor.connections')}
                    </span>
                }
            >
                {flows.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full whitespace-nowrap text-left text-sm">
                            <thead>
                                <tr className="border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground">
                                    <th className="px-4 py-3">{t('trafficInterceptor.source')}</th>
                                    <th className="px-4 py-3">{t('trafficInterceptor.destination')}</th>
                                    <th className="px-4 py-3">{t('trafficInterceptor.protocol')}</th>
                                    <th className="px-4 py-3">{t('trafficInterceptor.state')}</th>
                                    <th className="px-4 py-3 text-right">{t('trafficInterceptor.packets')}</th>
                                    <th className="px-4 py-3 text-right">{t('trafficInterceptor.bytes')}</th>
                                    <th className="px-4 py-3 text-right">详情</th>
                                </tr>
                            </thead>
                            <tbody>
                                <AnimatePresence>
                                    {flows.slice(0, 10).map((flow, index) => (
                                        <motion.tr
                                            key={flow.id}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.03 * index }}
                                            className="border-b border-border transition-colors hover:bg-muted/20"
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                                        <ArrowUpRight className="h-3 w-3" />
                                                    </div>
                                                    <span className="font-mono text-sm text-foreground">
                                                        {flow.sourceIP}
                                                        <span className="text-muted-foreground">:{flow.sourcePort}</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                                        <ArrowDownLeft className="h-3 w-3" />
                                                    </div>
                                                    <span className="font-mono text-sm text-foreground">
                                                        {flow.destIP}
                                                        <span className="text-muted-foreground">:{flow.destPort}</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={`rounded-md border px-2.5 py-1 text-[10px] font-bold tracking-widest ${
                                                        flow.protocol === 'tcp'
                                                            ? 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                                            : flow.protocol === 'udp'
                                                              ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                                                              : 'border-border bg-muted/40 text-muted-foreground'
                                                    }`}
                                                >
                                                    {flow.protocol.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="font-mono text-xs font-semibold text-muted-foreground">{flow.state}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-foreground">{(flow.packetCount ?? 0).toLocaleString()}</td>
                                            <td className="px-4 py-3 text-right font-mono font-bold text-muted-foreground">{formatBytes(flow.byteCount ?? 0)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <Link to={`/traffic/sessions/${flow.id}`} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30">
                                                    查看
                                                </Link>
                                            </td>
                                        </motion.tr>
                                    ))}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <ConsoleEmptyState title={t('trafficInterceptor.noFlows')} description="当前没有可供查看的活动连接。" />
                )}
            </ConsolePanel>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <ConsoleStatCard
                    icon={Clock}
                    label={t('trafficInterceptor.avgProcessingTime')}
                    value={
                        <>
                            {(stats?.avgProcessingTime || 0).toFixed(2)}
                            <span className="ml-1 text-base text-muted-foreground">ms</span>
                        </>
                    }
                    tone="neutral"
                />
                <ConsoleStatCard icon={XCircle} label={t('trafficInterceptor.droppedPackets')} value={stats?.droppedPackets?.toLocaleString() || 0} tone="danger" />
                <ConsoleStatCard icon={ShieldAlert} label={t('trafficInterceptor.bufferOverflows')} value={stats?.bufferOverflows?.toLocaleString() || 0} tone="warning" />
                <ConsoleStatCard
                    icon={Activity}
                    label={t('trafficInterceptor.cpuUsage')}
                    value={
                        <>
                            {(stats?.cpuUsage || 0).toFixed(1)}
                            <span className="ml-1 text-base text-muted-foreground">%</span>
                        </>
                    }
                    tone="success"
                />
            </div>
        </ConsolePage>
    );
}
