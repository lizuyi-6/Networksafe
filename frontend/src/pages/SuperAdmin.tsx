import React, { useEffect, useState } from 'react';
import { Activity, Users, AlertTriangle, Cpu, HardDrive, Zap } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const SuperAdmin = () => {
    const { t } = useLanguage();
    const [errors, setErrors] = useState<any[]>([]);
    const [perf, setPerf] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const errRes = await fetch('/api/admin/errors');
                const perfRes = await fetch('/api/admin/performance');

                if (!errRes.ok || !perfRes.ok) {
                    throw new Error('Failed to fetch admin data');
                }

                setErrors(await errRes.json());
                setPerf(await perfRes.json());
                setFetchError(null);
            } catch (e: any) {
                console.error("Failed to fetch admin data:", e);
                setFetchError(e.message || 'Failed to fetch data');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    if (loading) return <div className="p-8 text-gray-500">Loading Admin Panel...</div>;

    if (fetchError) {
        return (
            <div className="p-8 flex flex-col items-center justify-center text-red-500">
                <p className="text-xl font-bold mb-2">Error Loading Admin Panel</p>
                <p className="text-sm font-mono bg-red-50 p-3 rounded border border-red-100">{fetchError}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (!perf) return <div className="p-8 text-gray-500">No data available</div>;

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold text-gradient">
                {t('admin.title')}
            </h1>

            {/* Top Stats - Server Performance */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-panel p-6 rounded-xl flex items-center gap-4">
                    <div className="p-3 bg-blue-50 rounded-full text-blue-600">
                        <Cpu size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">{t('admin.server_cpu')}</p>
                        <p className="text-2xl font-bold text-gray-900">{perf.server?.cpu?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="glass-panel p-6 rounded-xl flex items-center gap-4">
                    <div className="p-3 bg-purple-50 rounded-full text-purple-600">
                        <HardDrive size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">{t('admin.memory')}</p>
                        <p className="text-2xl font-bold text-gray-900">{perf.server?.memory?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="glass-panel p-6 rounded-xl flex items-center gap-4">
                    <div className="p-3 bg-green-50 rounded-full text-green-600">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">{t('admin.active_agents')}</p>
                        <p className="text-2xl font-bold text-gray-900">{perf.clients?.total_agents ?? 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* User Error Log */}
                <div className="glass-panel p-6 rounded-xl">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <AlertTriangle className="text-red-500" size={20} />
                        {t('admin.recent_errors')}
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-gray-500">
                            <thead className="text-gray-700 border-b border-gray-200">
                                <tr>
                                    <th className="pb-3">User ID</th>
                                    <th className="pb-3">Error Code</th>
                                    <th className="pb-3">Message</th>
                                    <th className="pb-3">Time</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {errors.map((err, index) => (
                                    <tr key={`${err.userId}-${index}`} className="hover:bg-gray-50 transition-colors">
                                        <td className="py-3 font-mono text-blue-600">{err.userId}</td>
                                        <td className="py-3">
                                            <span className="px-2 py-1 rounded bg-gray-100 text-gray-600 font-mono text-xs border border-gray-200">
                                                {err.errorCode}
                                            </span>
                                        </td>
                                        <td className="py-3 text-red-600">{err.message}</td>
                                        <td className="py-3 opacity-60">{new Date(err.timestamp).toLocaleTimeString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Client Performance Data */}
                <div className="glass-panel p-6 rounded-xl">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Zap className="text-yellow-500" size={20} />
                        Client Performance Overhead
                    </h2>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500">Avg CPU Overhead</p>
                            <div className="flex items-end gap-2">
                                <span className="text-2xl font-bold text-gray-900">{perf.clients?.avg_cpu_overhead ?? 'N/A'}%</span>
                                <span className="text-xs text-green-600 mb-1">Low Impact</span>
                            </div>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                            <p className="text-xs text-gray-500">Avg Added Latency</p>
                            <div className="flex items-end gap-2">
                                <span className="text-2xl font-bold text-gray-900">{perf.clients?.avg_latency_added ?? 'N/A'}</span>
                                <span className="text-xs text-green-600 mb-1">Negligible</span>
                            </div>
                        </div>
                    </div>

                    <h3 className="text-sm font-medium text-gray-700 mb-3">Active Clients Summary</h3>
                    <div className="p-4 rounded-lg bg-blue-50 border border-blue-100 text-center">
                        <p className="text-3xl font-bold text-blue-600">{perf.clients?.total_agents ?? 0}</p>
                        <p className="text-sm text-gray-500 mt-1">Connected Agents</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SuperAdmin;
