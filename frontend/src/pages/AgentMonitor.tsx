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
    Clock
} from 'lucide-react';
import { fetchAgentSystemStats, fetchAgentHealth } from '../services/api';
import type { MultiAgentSystemStats, AgentHeartbeat } from '../types/api';

const AGENT_ROLES = {
    socrates: { name: 'Socrates', team: 'Red Team', teamKey: 'agentMonitor.redTeam', color: 'text-red-400', icon: '🔴' },
    plato: { name: 'Plato', team: 'Blue Team', teamKey: 'agentMonitor.blueTeam', color: 'text-blue-400', icon: '🔵' },
    aristotle: { name: 'Aristotle', team: 'Analyst', teamKey: 'agentMonitor.analyst', color: 'text-green-400', icon: '🟢' },
    arbitrator: { name: 'Arbitrator', team: 'Decision', teamKey: 'agentMonitor.decision', color: 'text-purple-400', icon: '🟣' }
};

export default function AgentMonitor() {
    const { t } = useTranslation();
    const [stats, setStats] = useState<MultiAgentSystemStats | null>(null);
    const [health, setHealth] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const LAYER_INFO = [
        { id: 1, nameKey: 'agentMonitor.layers.collaboration' },
        { id: 2, nameKey: 'agentMonitor.layers.rolePlaying' },
        { id: 3, nameKey: 'agentMonitor.layers.sceneTraversal' },
        { id: 4, nameKey: 'agentMonitor.layers.capability' },
        { id: 5, nameKey: 'agentMonitor.layers.debate' },
        { id: 6, nameKey: 'agentMonitor.layers.heterogeneous' },
        { id: 7, nameKey: 'agentMonitor.layers.synthesis' }
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
        const [statsData, healthData] = await Promise.all([
            fetchAgentSystemStats(),
            fetchAgentHealth()
        ]);
        setStats(statsData);
        setHealth(healthData);
        setLoading(false);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'healthy': return 'text-green-400';
            case 'degraded': return 'text-yellow-400';
            case 'unhealthy': return 'text-red-400';
            default: return 'text-gray-400';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'healthy': return <CheckCircle className="w-5 h-5 text-green-400" />;
            case 'degraded': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
            case 'unhealthy': return <XCircle className="w-5 h-5 text-red-400" />;
            default: return <Activity className="w-5 h-5 text-gray-400" />;
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
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Brain className="w-8 h-8 text-purple-400" />
                        {t('agentMonitor.title')}
                    </h1>
                    <p className="text-gray-400 mt-1">{t('agentMonitor.subtitle')}</p>
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-gray-400">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="rounded bg-gray-800 border-gray-700"
                        />
                        {t('agentMonitor.autoRefresh')}
                    </label>
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-500 transition-colors text-white"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {t('agentMonitor.refresh')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-gray-400">{t('agentMonitor.systemHealth')}</span>
                        {getStatusIcon(health?.status || 'unknown')}
                    </div>
                    <p className={`text-2xl font-bold mt-2 ${getStatusColor(health?.status || 'unknown')}`}>
                        {getStatusText(health?.status || 'unknown').toUpperCase()}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-gray-400">
                        <Users className="w-4 h-4" />
                        {t('agentMonitor.activeAgents')}
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">
                        {stats?.orchestrator.registeredAgents || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-gray-400">
                        <MessageSquare className="w-4 h-4" />
                        {t('agentMonitor.queueSize')}
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">
                        {stats?.messageBus.queueSize || 0}
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-4"
                >
                    <div className="flex items-center gap-2 text-gray-400">
                        <BarChart3 className="w-4 h-4" />
                        {t('agentMonitor.caseFiles')}
                    </div>
                    <p className="text-2xl font-bold text-white mt-2">
                        {stats?.synthesis.totalCaseFiles || 0}
                    </p>
                </motion.div>
            </div>

            <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    {t('agentMonitor.layerArchitecture')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                    {LAYER_INFO.map((layer, index) => (
                        <motion.div
                            key={layer.id}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.1 }}
                            className="bg-gray-800/50 rounded-lg p-3 text-center border border-gray-700/50 hover:border-purple-500/50 transition-colors"
                        >
                            <div className="text-2xl font-bold text-purple-400 mb-1">L{layer.id}</div>
                            <div className="text-xs text-gray-400">{t(layer.nameKey)}</div>
                        </motion.div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-400" />
                        {t('agentMonitor.agentHeartbeats')}
                    </h2>
                    <div className="space-y-3">
                        {stats?.agents?.map((agent: AgentHeartbeat) => {
                            const roleInfo = AGENT_ROLES[agent.role as keyof typeof AGENT_ROLES] || 
                                { name: agent.role, team: 'Unknown', teamKey: 'agentMonitor.unknown', color: 'text-gray-400', icon: '⚪' };
                            
                            return (
                                <div
                                    key={agent.agentId}
                                    className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl">{roleInfo.icon}</span>
                                        <div>
                                            <p className={`font-medium ${roleInfo.color}`}>
                                                {roleInfo.name}
                                            </p>
                                            <p className="text-xs text-gray-500">{t(roleInfo.teamKey)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm">
                                        <div className="text-center">
                                            <p className="text-gray-400">{t('agentMonitor.tasks')}</p>
                                            <p className="text-white">{agent.tasksCompleted}</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-gray-400">{t('agentMonitor.latency')}</p>
                                            <p className="text-white">{agent.responseTime}ms</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-gray-400">{t('agentMonitor.status')}</p>
                                            <p className={getStatusColor(agent.status)}>
                                                {agent.status}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        }) || (
                            <div className="text-center text-gray-500 py-8">
                                {t('agentMonitor.noAgents')}
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-400" />
                        {t('agentMonitor.synthesisStats')}
                    </h2>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                            <span className="text-gray-400">{t('agentMonitor.totalCaseFiles')}</span>
                            <span className="text-white font-bold">
                                {stats?.synthesis.totalCaseFiles || 0}
                            </span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                            <span className="text-gray-400">{t('agentMonitor.lessonsLearned')}</span>
                            <span className="text-white font-bold">
                                {stats?.synthesis.totalLessons || 0}
                            </span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                            <span className="text-gray-400">{t('agentMonitor.policyUpdates')}</span>
                            <span className="text-white font-bold">
                                {stats?.synthesis.totalPolicyUpdates || 0}
                            </span>
                        </div>
                        
                        {stats?.synthesis.topPatterns && stats.synthesis.topPatterns.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm text-gray-400 mb-2">{t('agentMonitor.topPatterns')}</p>
                                <div className="space-y-2">
                                    {stats.synthesis.topPatterns.slice(0, 5).map((pattern, i) => (
                                        <div
                                            key={i}
                                            className="flex justify-between items-center text-sm p-2 bg-gray-800/30 rounded"
                                        >
                                            <span className="text-gray-300 truncate">
                                                {pattern.pattern}
                                            </span>
                                            <span className="text-purple-400">
                                                {pattern.frequency}x
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-cyan-400" />
                    {t('agentMonitor.messageBusStats')}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-gray-800/50 rounded-lg">
                        <p className="text-3xl font-bold text-white">
                            {stats?.messageBus.queueSize || 0}
                        </p>
                        <p className="text-sm text-gray-400">{t('agentMonitor.queueSize')}</p>
                    </div>
                    <div className="text-center p-4 bg-gray-800/50 rounded-lg">
                        <p className="text-3xl font-bold text-white">
                            {stats?.messageBus.subscriptionCount || 0}
                        </p>
                        <p className="text-sm text-gray-400">{t('agentMonitor.subscriptions')}</p>
                    </div>
                    <div className="text-center p-4 bg-gray-800/50 rounded-lg">
                        <p className="text-3xl font-bold text-white">
                            {stats?.messageBus.pendingRequests || 0}
                        </p>
                        <p className="text-sm text-gray-400">{t('agentMonitor.pendingRequests')}</p>
                    </div>
                    <div className="text-center p-4 bg-gray-800/50 rounded-lg">
                        <p className="text-3xl font-bold text-white">
                            {stats?.orchestrator.activeTasks || 0}
                        </p>
                        <p className="text-sm text-gray-400">{t('agentMonitor.activeTasks')}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
