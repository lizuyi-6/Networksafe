import { useEffect, useState } from 'react';
import { fetchStats } from '../services/api';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from 'recharts';
import { Activity, Shield, Server, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
import { DashboardStats } from '../types/api';
import ErrorDisplay from '../components/ErrorDisplay';

const StatCard = ({ title, value, subtext, icon: Icon, color }: any) => (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6 relative overflow-hidden group"
    >
        <div className={`absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity ${color}`}>
            <Icon size={100} />
        </div>
        <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg bg-blue-50/50 ${color.replace('bg-', 'text-')} text-opacity-90`}>
                    <Icon size={20} />
                </div>
                <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
            </div>
            <p className="text-3xl font-bold text-gray-900 mt-4">{value}</p>
            <span className="text-gray-400 text-xs mt-1 block">{subtext}</span>
        </div>
    </motion.div>
);

const Dashboard = () => {
    const { t } = useLanguage();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadStats = async () => {
            try {
                const data = await fetchStats();
                setStats(data);
                setError(null);
            } catch (err: any) {
                console.error(err);
                setError(err.message || 'Failed to load data');
            }
        };

        loadStats();
        const interval = setInterval(loadStats, 2000);
        return () => clearInterval(interval);
    }, []);

    if (error) {
        return (
            <ErrorDisplay
                title="Error Loading Dashboard"
                message={error}
                onRetry={() => window.location.reload()}
            />
        );
    }

    if (!stats) return <div className="p-8 text-gray-500">Initializing Dashboard...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gradient">
                        {t('dashboard.title')}
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">{t('dashboard.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-xs font-medium animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    {t('dashboard.system_online')}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title={t('dashboard.total_requests')}
                    value={stats.totalRequests.toLocaleString()}
                    subtext={`+${stats.currentRPS} req/sec`}
                    icon={Activity}
                    color="bg-blue-500"
                />
                <StatCard
                    title={t('dashboard.threats_blocked')}
                    value={stats.blockedRequests.toLocaleString()}
                    subtext="Total Interventions"
                    icon={Shield}
                    color="bg-red-500"
                />
                <StatCard
                    title={t('dashboard.active_connections')}
                    value={stats.activeConnections}
                    subtext="Concurrent Users"
                    icon={Server}
                    color="bg-purple-500"
                />
                <StatCard
                    title={t('dashboard.success_rate')}
                    value={`${stats.successRate}%`}
                    subtext="Request Accuracy"
                    icon={Zap}
                    color="bg-green-500"
                />
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Traffic Chart */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-panel p-6 rounded-xl lg:col-span-2"
                >
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                        <Activity className="text-blue-400" size={18} />
                        {t('dashboard.traffic_overview')}
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats.history}>
                                <defs>
                                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="requests"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorRequests)"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="blocked"
                                    stroke="#ef4444"
                                    strokeWidth={2}
                                    fillOpacity={0}
                                    fill="transparent"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>

                {/* Threat Distribution */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="glass-panel p-6 rounded-xl"
                >
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                        <Shield className="text-red-400" size={18} />
                        {t('dashboard.threat_distribution')}
                    </h3>
                    <div className="h-[200px] w-full flex items-center justify-center relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.threats as any}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {stats.threats.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                                <span className="text-2xl font-bold text-white block">{stats.blockedRequests}</span>
                                <span className="text-xs text-slate-500">Threats</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-6 space-y-3">
                        {stats.threats.map((item: any) => (
                            <div key={item.name} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                                    <span className="text-gray-600">{item.name}</span>
                                </div>
                                <span className="font-mono text-gray-500">{item.value}%</span>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default Dashboard;
