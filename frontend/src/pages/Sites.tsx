import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, ArrowRight, RefreshCw } from 'lucide-react';
import { fetchSites } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const Sites = () => {
    const { t } = useLanguage();
    const [sites, setSites] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSites = async () => {
        setLoading(true);
        setError(null);
        try {
            setSites(await fetchSites());
        } catch (nextError: any) {
            setError(nextError?.message || 'FG-SITES-LIST');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadSites();
    }, []);

    return (
        <ConsolePage title={t('sites.title')} subtitle={t('sites.subtitle')}>
            <ConsolePanel title={t('sites.listTitle')} subtitle={t('sites.listSubtitle')} icon={Globe} iconTone="primary">
                {error ? (
                    <div data-testid="sites-error" role="alert" className="flex items-center justify-between gap-4 border-l-4 border-rose-500 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                        <span>{error}</span>
                        <button type="button" onClick={() => void loadSites()} className="shrink-0 rounded-md p-2 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300" title={t('common.refresh')}>
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                ) : loading ? (
                    <ConsoleEmptyState title={t('common.loading')} />
                ) : sites.length === 0 ? (
                    <ConsoleEmptyState title={t('sites.noSites')} />
                ) : (
                    <div className="space-y-3">
                        {sites.map((site: any) => (
                            <div key={site.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-4 transition-colors hover:bg-muted/25">
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm font-medium text-foreground">{site.domain}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{site.target}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`rounded border px-2 py-1 text-xs ${site.status === 'secure' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>{site.status?.toUpperCase() || 'UNKNOWN'}</span>
                                    <Link to={`/sites/${encodeURIComponent(site.id)}`} className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30">
                                        {t('sites.viewDetail')}
                                        <ArrowRight size={12} />
                                    </Link>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </ConsolePanel>
        </ConsolePage>
    );
};

export default Sites;
