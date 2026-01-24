import { useEffect, useState } from 'react';
import { fetchSites } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

const Sites = () => {
    const { t } = useLanguage();
    const [sites, setSites] = useState<any[]>([]);

    useEffect(() => {
        fetchSites().then(data => setSites(data)).catch(console.error);
    }, []);

    return (
        <div className="space-y-6 p-6">
            <h1 className="text-xl font-medium text-foreground">{t('sites.title')}</h1>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30">
                    <h2 className="text-sm font-medium text-foreground">{t('sites.protected_domains')}</h2>
                </div>
                <div className="p-6">
                    {sites.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">{t('sites.no_sites')}</p>
                    ) : (
                        <div className="space-y-3">
                            {sites.map((site: any) => (
                                <div key={site.id} className="flex justify-between items-center p-4 bg-muted/20 border border-border rounded hover:border-primary/50 transition-colors">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm font-medium text-foreground">{site.domain}</span>
                                        <span className="text-xs text-muted-foreground font-mono">{site.target}</span>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded border ${site.status === 'secure'
                                        ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400'
                                        : 'text-amber-600 bg-amber-500/10 border-amber-500/20 dark:text-amber-400'
                                        }`}>
                                        {site.status?.toUpperCase() || 'UNKNOWN'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
export default Sites;
