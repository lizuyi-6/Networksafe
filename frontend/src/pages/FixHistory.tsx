import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { ArrowRight, History } from 'lucide-react';
import { fetchFixHistory } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const FixHistory = () => {
    const { t } = useLanguage();
    const [rows, setRows] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchFixHistory(100);
            setRows(data || []);
        } catch (e: any) {
            setError(e.message || 'FG-FIX-HISTORY-LIST');
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    return (
        <ConsolePage title={t('fixHistory.title')} subtitle={t('fixHistory.subtitle')}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            <ConsolePanel title="修复记录" subtitle="点击按钮进入稳定详情页查看完整记录。" icon={History} iconTone="primary">
                {loading ? (
                    <ConsoleEmptyState title={t('fixHistory.loading')} />
                ) : rows.length === 0 ? (
                    <ConsoleEmptyState title={t('fixHistory.no_records')} />
                ) : (
                    <div className="space-y-3">
                        {rows.map((row) => (
                            <div key={row.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-4">
                                <div>
                                    <div className="break-all font-mono text-xs text-foreground">{row.id}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">{row.status} / {row.phase} / {row.progress}%</div>
                                    <div className="mt-1 text-[11px] text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</div>
                                </div>
                                <Link to={`/history/${row.id}`} className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30">
                                    {t('fixHistory.view_detail')}
                                    <ArrowRight size={12} />
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </ConsolePanel>
        </ConsolePage>
    );
};

export default FixHistory;
