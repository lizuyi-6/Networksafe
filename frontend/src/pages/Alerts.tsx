import { useEffect, useState } from 'react';
import { Bell, AlertTriangle, ShieldAlert, AlertCircle, CheckCircle, Clock, XCircle, Filter } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { fetchAlerts } from '../services/api';
import { motion } from 'framer-motion';

const Alerts = () => {
    const { t } = useLanguage();
    const [alerts, setAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        const loadData = async () => {
            const data = await fetchAlerts();
            setAlerts(data);
            setLoading(false);
        };
        loadData();
    }, []);

    const getSeverityColor = (severity: string) => {
        switch (severity.toLowerCase()) {
            case 'critical': return 'text-red-500 bg-red-500/10 border-red-500/20';
            case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
            case 'medium': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            default: return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'security': return <ShieldAlert size={18} />;
            case 'system': return <AlertCircle size={18} />;
            case 'performance': return <AlertTriangle size={18} />;
            default: return <Bell size={18} />;
        }
    };

    const filteredAlerts = filter === 'all' ? alerts : alerts.filter(a => a.severity.toLowerCase() === filter);

    if (loading) return <div className="p-8 text-zinc-500">{t('alerts.loading')}</div>;

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-medium text-zinc-100">{t('nav.alerts')}</h1>
                    <p className="text-sm text-zinc-500 mt-1">{t('alerts.subtitle')}</p>
                </div>
                <div className="flex gap-2">
                    {['all', 'critical', 'high', 'medium'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${filter === f
                                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            {f === 'all' ? t('alerts.filter_all') :
                                f === 'critical' ? t('alerts.filter_critical') :
                                    f === 'high' ? t('alerts.filter_high') :
                                        t('alerts.filter_medium')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="divide-y divide-zinc-800/50">
                    {filteredAlerts.length === 0 ? (
                        <div className="p-12 text-center text-zinc-500">
                            <CheckCircle size={48} className="mx-auto mb-4 text-emerald-500/20" />
                            <p>{t('alerts.no_alerts')}</p>
                        </div>
                    ) : (
                        filteredAlerts.map((alert, index) => (
                            <motion.div
                                key={alert.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className="p-4 hover:bg-white/5 transition-colors flex items-start gap-4 group"
                            >
                                <div className={`mt-1 p-2 rounded-lg ${getSeverityColor(alert.severity)} shrink-0`}>
                                    {getIcon(alert.type)}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="text-sm font-medium text-zinc-200 group-hover:text-indigo-400 transition-colors">
                                            {alert.title}
                                        </h3>
                                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} />
                                                {alert.time}
                                            </span>
                                            {alert.status === 'active' && (
                                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20 uppercase text-[10px] tracking-wider font-bold">
                                                    {t('alerts.status_active')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-sm text-zinc-400 leading-relaxed">
                                        {alert.message}
                                    </p>
                                    <div className="mt-2 flex items-center gap-4 text-xs font-mono text-zinc-600">
                                        <span>{t('alerts.source')}: {alert.source}</span>
                                        <span>{t('alerts.id')}: {alert.id}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200" title="Acknowledge">
                                        <CheckCircle size={16} />
                                    </button>
                                    <button className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-zinc-200" title="Dismiss">
                                        <XCircle size={16} />
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
export default Alerts;
