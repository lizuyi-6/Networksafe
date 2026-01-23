import { useEffect, useState } from 'react';
import { Users, AlertTriangle, Cpu, HardDrive, Zap, Key, Plus, Copy, Trash2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { fetchAdminData } from '../services/api';

const SuperAdmin = () => {
    const { t } = useLanguage();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [keys, setKeys] = useState([
        { id: 1, name: 'Prod API Key', prefix: 'sk_prod_', created: '2025-12-01', lastUsed: 'Just now' },
        { id: 2, name: 'Dev API Key', prefix: 'sk_test_', created: '2026-01-15', lastUsed: '2 days ago' },
    ]);

    useEffect(() => {
        const loadData = async () => {
            const result = await fetchAdminData();
            if (result) {
                setData(result);
            }
            setLoading(false);
        };
        loadData();
    }, []);

    if (loading) return <div className="p-8 text-zinc-500">{t('admin.loading')}</div>;
    if (!data) return <div className="p-8 text-zinc-500">{t('admin.unavailable')}</div>;

    const { performance: perf, errors } = data;

    return (
        <div className="space-y-8 p-6">
            <h1 className="text-xl font-medium text-zinc-100">
                {t('admin.title')}
            </h1>

            {/* API Keys Section (New Request) */}
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-black/20 flex justify-between items-center">
                    <h2 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                        <Key size={16} className="text-indigo-400" />
                        {t('admin.api_keys_title')}
                    </h2>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors">
                        <Plus size={14} />
                        {t('admin.create_key')}
                    </button>
                </div>
                <div className="p-6">
                    <div className="space-y-2">
                        {keys.map(key => (
                            <div key={key.id} className="flex items-center justify-between p-3 bg-black/20 border border-zinc-800 rounded hover:border-zinc-700 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-zinc-400">
                                        <Key size={14} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-zinc-200">{key.name}</p>
                                        <p className="text-xs text-zinc-500 font-mono">{key.prefix}••••••••••••••••</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-zinc-500">
                                    <span>{t('admin.key_created')}: {key.created}</span>
                                    <span className="hidden md:inline">{t('admin.key_last_used')}: {key.lastUsed}</span>
                                    <div className="flex gap-1 ml-2">
                                        <button className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors">
                                            <Copy size={14} />
                                        </button>
                                        <button className="p-1.5 hover:bg-red-900/30 rounded text-zinc-400 hover:text-red-400 transition-colors">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* System Performance Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-surface border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 border border-blue-500/20">
                        <Cpu size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-zinc-500 mb-1">{t('admin.server_cpu')}</p>
                        <p className="text-2xl font-medium text-zinc-100">{perf.server?.cpu?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="bg-surface border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-purple-500/10 rounded-full text-purple-400 border border-purple-500/20">
                        <HardDrive size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-zinc-500 mb-1">{t('admin.memory')}</p>
                        <p className="text-2xl font-medium text-zinc-100">{perf.server?.memory?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="bg-surface border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-green-500/10 rounded-full text-green-400 border border-green-500/20">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-zinc-500 mb-1">{t('admin.active_agents')}</p>
                        <p className="text-2xl font-medium text-zinc-100">{perf.clients?.total_agents ?? 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* User Error Log */}
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-border bg-black/20">
                        <h2 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                            <AlertTriangle className="text-red-500" size={16} />
                            {t('admin.recent_errors')}
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-zinc-500">
                            <thead className="text-zinc-400 bg-black/20">
                                <tr>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_user')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_code')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_msg')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_time')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/50">
                                {errors.map((err: any, index: number) => (
                                    <tr key={`${err.userId}-${index}`} className="hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-3 font-mono text-indigo-400">{err.userId}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">
                                                {err.errorCode}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-red-400/90">{err.message}</td>
                                        <td className="px-4 py-3 opacity-60">{new Date(err.timestamp).toLocaleTimeString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Client Performance Data */}
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-border bg-black/20">
                        <h2 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                            <Zap className="text-amber-500" size={16} />
                            {t('admin.client_perf')}
                        </h2>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-black/20 rounded border border-zinc-800">
                                <p className="text-xs text-zinc-500 mb-2">{t('admin.avg_cpu')}</p>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-medium text-zinc-200">{perf.clients?.avg_cpu_overhead ?? 'N/A'}%</span>
                                    <span className="text-[10px] text-emerald-500 mb-1">{t('admin.low_impact')}</span>
                                </div>
                            </div>
                            <div className="p-4 bg-black/20 rounded border border-zinc-800">
                                <p className="text-xs text-zinc-500 mb-2">{t('admin.avg_latency')}</p>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-medium text-zinc-200">{perf.clients?.avg_latency_added ?? 'N/A'}</span>
                                    <span className="text-[10px] text-emerald-500 mb-1">{t('admin.negligible')}</span>
                                </div>
                            </div>
                        </div>

                        <h3 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">{t('admin.clients_summary')}</h3>
                        <div className="p-4 rounded bg-indigo-500/5 border border-indigo-500/10 text-center">
                            <p className="text-3xl font-bold text-indigo-400">{perf.clients?.total_agents ?? 0}</p>
                            <p className="text-xs text-zinc-500 mt-1">{t('admin.connected_agents')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default SuperAdmin;
