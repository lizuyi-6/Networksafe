import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    Network,
    Activity,
    Shield,
    AlertTriangle,
    ArrowUpRight,
    ArrowDownLeft,
    Globe,
    Zap,
    Clock,
    Database,
    RefreshCw,
    XCircle,
    CheckCircle
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

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Network className="w-8 h-8 text-cyan-400" />
                        {t('trafficInterceptor.title')}
                    </h1>
                    <p className="text-gray-400 mt-1">{t('trafficInterceptor.subtitle')}</p>
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-gray-400">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="rounded bg-gray-800 border-gray-700"
                        />
                        {t('trafficInterceptor.autoRefresh')}
                    </label>
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 rounded-lg hover:bg-cyan-500 transition-colors text-white"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {t('trafficInterceptor.refresh')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-gray-400">
                        <Activity className="w-4 h-4" />
                        {t('trafficInterceptor.packets')}
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">
                        {stats?.packetsProcessed?.toLocaleString() || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        {t('trafficInterceptor.allowed')}
                    </div>
                    <p className="text-2xl font-bold text-green-400 mt-2">
                        {stats?.packetsAllowed?.toLocaleString() || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-red-400">
                        <XCircle className="w-4 h-4" />
                        {t('trafficInterceptor.blocked')}
                    </div>
                    <p className="text-2xl font-bold text-red-400 mt-2">
                        {stats?.packetsBlocked?.toLocaleString() || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-yellow-400">
                        <Shield className="w-4 h-4" />
                        {t('trafficInterceptor.inspected')}
                    </div>
                    <p className="text-2xl font-bold text-yellow-400 mt-2">
                        {stats?.packetsInspected?.toLocaleString() || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-gray-400">
                        <Database className="w-4 h-4" />
                        {t('trafficInterceptor.bytes')}
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">
                        {formatBytes(Number(stats?.bytesProcessed || 0))}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-gray-400">
                        <Clock className="w-4 h-4" />
                        {t('trafficInterceptor.uptime')}
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">
                        {formatUptime(stats?.uptime || 0)}
                    </p>
                </motion.div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Globe className="w-5 h-5 text-blue-400" />
                        {t('trafficInterceptor.protocolDistribution')}
                    </h2>
                    <div className="space-y-4">
                        {[
                            { name: 'HTTP', value: protocols.http, color: 'bg-blue-500' },
                            { name: 'HTTPS', value: protocols.https, color: 'bg-green-500' },
                            { name: 'DNS', value: protocols.dns, color: 'bg-yellow-500' },
                            { name: t('trafficInterceptor.other'), value: protocols.other, color: 'bg-gray-500' }
                        ].map((protocol) => (
                            <div key={protocol.name}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-400">{protocol.name}</span>
                                    <span className="text-white">{getProtocolPercentage(protocol.value)}%</span>
                                </div>
                                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${getProtocolPercentage(protocol.value)}%` }}
                                        className={`h-full ${protocol.color}`}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        {t('trafficInterceptor.threatDetections')}
                    </h2>
                    {threats.length > 0 ? (
                        <div className="space-y-3">
                            {threats.slice(0, 5).map((threat, i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                                            threat.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                                            threat.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                            threat.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-blue-500/20 text-blue-400'
                                        }`}>
                                            {getSeverityText(threat.severity).toUpperCase()}
                                        </span>
                                        <span className="text-white">{threat.type}</span>
                                    </div>
                                    <span className="text-gray-400">{threat.count}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-gray-500 py-8">
                            {t('trafficInterceptor.noThreats')}
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Zap className="w-5 h-5 text-yellow-400" />
                        {t('trafficInterceptor.activeFlows')}
                    </h2>
                    <span className="text-sm text-gray-400">
                        {stats?.currentFlows || 0} {t('trafficInterceptor.connections')}
                    </span>
                </div>
                
                {flows.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-gray-400 border-b border-gray-700">
                                    <th className="text-left py-2 px-3">{t('trafficInterceptor.source')}</th>
                                    <th className="text-left py-2 px-3">{t('trafficInterceptor.destination')}</th>
                                    <th className="text-left py-2 px-3">{t('trafficInterceptor.protocol')}</th>
                                    <th className="text-left py-2 px-3">{t('trafficInterceptor.state')}</th>
                                    <th className="text-right py-2 px-3">{t('trafficInterceptor.packets')}</th>
                                    <th className="text-right py-2 px-3">{t('trafficInterceptor.bytes')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {flows.slice(0, 10).map((flow) => (
                                    <tr key={flow.id} className="border-b border-gray-700/50 hover:bg-gray-800/50">
                                        <td className="py-2 px-3">
                                            <div className="flex items-center gap-2">
                                                <ArrowUpRight className="w-4 h-4 text-green-400" />
                                                <span className="text-white">
                                                    {flow.sourceIP}:{flow.sourcePort}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-2 px-3">
                                            <div className="flex items-center gap-2">
                                                <ArrowDownLeft className="w-4 h-4 text-blue-400" />
                                                <span className="text-white">
                                                    {flow.destIP}:{flow.destPort}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-2 px-3">
                                            <span className={`px-2 py-1 rounded text-xs ${
                                                flow.protocol === 'tcp' ? 'bg-blue-500/20 text-blue-400' :
                                                flow.protocol === 'udp' ? 'bg-green-500/20 text-green-400' :
                                                'bg-gray-500/20 text-gray-400'
                                            }`}>
                                                {flow.protocol.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="py-2 px-3">
                                            <span className="text-gray-300">{flow.state}</span>
                                        </td>
                                        <td className="py-2 px-3 text-right text-white">
                                            {(flow.packetCount ?? 0).toLocaleString()}
                                        </td>
                                        <td className="py-2 px-3 text-right text-white">
                                            {formatBytes(flow.byteCount ?? 0)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center text-gray-500 py-8">
                        {t('trafficInterceptor.noFlows')}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4 text-center">
                    <p className="text-gray-400 text-sm">{t('trafficInterceptor.avgProcessingTime')}</p>
                    <p className="text-xl font-bold text-white mt-1">
                        {(stats?.avgProcessingTime || 0).toFixed(2)}ms
                    </p>
                </div>
                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4 text-center">
                    <p className="text-gray-400 text-sm">{t('trafficInterceptor.droppedPackets')}</p>
                    <p className="text-xl font-bold text-red-400 mt-1">
                        {stats?.droppedPackets?.toLocaleString() || 0}
                    </p>
                </div>
                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4 text-center">
                    <p className="text-gray-400 text-sm">{t('trafficInterceptor.bufferOverflows')}</p>
                    <p className="text-xl font-bold text-yellow-400 mt-1">
                        {stats?.bufferOverflows?.toLocaleString() || 0}
                    </p>
                </div>
                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4 text-center">
                    <p className="text-gray-400 text-sm">{t('trafficInterceptor.cpuUsage')}</p>
                    <p className="text-xl font-bold text-white mt-1">
                        {(stats?.cpuUsage || 0).toFixed(1)}%
                    </p>
                </div>
            </div>
        </div>
    );
}
