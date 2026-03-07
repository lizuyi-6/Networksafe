import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, ArrowRight } from 'lucide-react';
import { fetchSites } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const Sites = () => {
    const [sites, setSites] = useState<any[]>([]);

    useEffect(() => {
        fetchSites().then((data) => setSites(data)).catch(console.error);
    }, []);

    return (
        <ConsolePage title="站点资产" subtitle="统一查看受保护站点、目标地址与当前防护状态。">
            <ConsolePanel title="站点列表" subtitle="支持直接进入站点详情页查看暴露面和关联安全上下文。" icon={Globe} iconTone="primary">
                {sites.length === 0 ? (
                    <ConsoleEmptyState title="当前没有可展示的站点配置" />
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
                                    <Link to={`/sites/${site.id}`} className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30">
                                        查看详情
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
