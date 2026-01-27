import { useEffect, useState } from 'react';
import { Users, AlertTriangle, Cpu, HardDrive, Zap, Key, Plus, Copy, Trash2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { fetchAdminData } from '../services/api';

const SuperAdmin = () => {
    const { t } = useLanguage();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [keys] = useState([
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

    if (loading) return <div className="p-8 text-muted-foreground">{t('admin.loading')}</div>;
    if (!data) return <div className="p-8 text-muted-foreground">{t('admin.unavailable')}</div>;

    const { performance: perf, errors } = data;

    return (
        <div className="space-y-8 p-6">
            <h1 className="text-xl font-medium text-foreground">
                {t('admin.title')}
            </h1>

            {/* API Keys Section (New Request) */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30 flex justify-between items-center">
                    <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Key size={16} className="text-primary" />
                        {t('admin.api_keys_title')}
                    </h2>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-medium transition-colors">
                        <Plus size={14} />
                        {t('admin.create_key')}
                    </button>
                </div>
                <div className="p-6">
                    <div className="space-y-2">
                        {keys.map(key => (
                            <div key={key.id} className="flex items-center justify-between p-3 bg-muted/20 border border-border rounded hover:border-primary/50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                        <Key size={14} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{key.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">{key.prefix}••••••••••••••••</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                    <span>{t('admin.key_created')}: {key.created}</span>
                                    <span className="hidden md:inline">{t('admin.key_last_used')}: {key.lastUsed}</span>
                                    <div className="flex gap-1 ml-2">
                                        <button className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
                                            <Copy size={14} />
                                        </button>
                                        <button className="p-1.5 hover:bg-red-900/30 rounded text-muted-foreground hover:text-red-400 transition-colors">
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
                <div className="bg-card border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 border border-blue-500/20">
                        <Cpu size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{t('admin.server_cpu')}</p>
                        <p className="text-2xl font-medium text-foreground">{perf.server?.cpu?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="bg-card border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-purple-500/10 rounded-full text-purple-400 border border-purple-500/20">
                        <HardDrive size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{t('admin.memory')}</p>
                        <p className="text-2xl font-medium text-foreground">{perf.server?.memory?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="bg-card border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-green-500/10 rounded-full text-green-400 border border-green-500/20">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{t('admin.active_agents')}</p>
                        <p className="text-2xl font-medium text-foreground">{perf.clients?.total_agents ?? 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* User Error Log */}
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-border bg-muted/30">
                        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                            <AlertTriangle className="text-red-500" size={16} />
                            {t('admin.recent_errors')}
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-muted-foreground">
                            <thead className="text-muted-foreground bg-muted/30">
                                <tr>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_user')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_code')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_msg')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_time')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {errors.map((err: any, index: number) => (
                                    <tr key={`${err.userId}-${index}`} className="hover:bg-muted/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-primary">{err.userId}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[10px] border border-border">
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
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-border bg-muted/30">
                        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                            <Zap className="text-amber-500" size={16} />
                            {t('admin.client_perf')}
                        </h2>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-muted/20 rounded border border-border">
                                <p className="text-xs text-muted-foreground mb-2">{t('admin.avg_cpu')}</p>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-medium text-foreground">{perf.clients?.avg_cpu_overhead ?? 'N/A'}%</span>
                                    <span className="text-[10px] text-emerald-500 mb-1">{t('admin.low_impact')}</span>
                                </div>
                            </div>
                            <div className="p-4 bg-muted/20 rounded border border-border">
                                <p className="text-xs text-muted-foreground mb-2">{t('admin.avg_latency')}</p>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-medium text-foreground">{perf.clients?.avg_latency_added ?? 'N/A'}</span>
                                    <span className="text-[10px] text-emerald-500 mb-1">{t('admin.negligible')}</span>
                                </div>
                            </div>
                        </div>

                        <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">{t('admin.clients_summary')}</h3>
                        <div className="p-4 rounded bg-primary/5 border border-primary/10 text-center">
                            <p className="text-3xl font-bold text-primary">{perf.clients?.total_agents ?? 0}</p>
                            <p className="text-xs text-muted-foreground mt-1">{t('admin.connected_agents')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default SuperAdmin;
