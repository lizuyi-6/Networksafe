import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { fetchFixHistory, fetchFixHistoryDetail } from '../services/api';

const FixHistory = () => {
    const { t } = useLanguage();
    const [rows, setRows] = useState<any[]>([]);
    const [selected, setSelected] = useState<any | null>(null);
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

    const openDetail = async (id: string) => {
        try {
            const detail = await fetchFixHistoryDetail(id);
            setSelected(detail);
        } catch (e: any) {
            setError(e.message || 'FG-FIX-HISTORY-DETAIL');
        }
    };

    useEffect(() => {
        load();
    }, []);

    return (
        <div className="space-y-6 p-6">
            <h1 className="text-xl font-medium text-foreground">{t('history.title')}</h1>

            {error && <div className="p-3 rounded border border-red-500/30 text-red-300 bg-red-500/10 text-sm">{error}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4">
                    {loading ? (
                        <div className="text-muted-foreground">Loading...</div>
                    ) : rows.length === 0 ? (
                        <div className="text-muted-foreground">No history records.</div>
                    ) : (
                        <div className="space-y-2">
                            {rows.map((row) => (
                                <button
                                    key={row.id}
                                    onClick={() => openDetail(row.id)}
                                    className="w-full text-left p-3 rounded border border-border hover:border-primary/40 bg-muted/20"
                                >
                                    <div className="font-mono text-xs text-foreground break-all">{row.id}</div>
                                    <div className="text-xs text-muted-foreground mt-1">{row.status} / {row.phase} / {row.progress}%</div>
                                    <div className="text-[11px] text-muted-foreground mt-1">{new Date(row.createdAt).toLocaleString()}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="font-medium text-foreground mb-3">Detail</h3>
                    {selected ? (
                        <div className="space-y-2 text-xs">
                            <div><span className="text-muted-foreground">id:</span> <span className="font-mono break-all">{selected.id}</span></div>
                            <div><span className="text-muted-foreground">status:</span> {selected.status}</div>
                            <div><span className="text-muted-foreground">phase:</span> {selected.phase}</div>
                            <div><span className="text-muted-foreground">progress:</span> {selected.progress}%</div>
                            <div><span className="text-muted-foreground">error:</span> {selected.error || '-'}</div>
                            <div><span className="text-muted-foreground">findings:</span> {(selected.findings || []).length}</div>
                        </div>
                    ) : (
                        <div className="text-xs text-muted-foreground">Select one record to view detail.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FixHistory;
