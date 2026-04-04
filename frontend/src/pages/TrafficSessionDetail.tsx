import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Network, Shield } from 'lucide-react';
import { fetchTrafficSessionDetail } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const TrafficSessionDetail = () => {
    const { t } = useLanguage();
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTrafficSessionDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-TRAFFIC-SESSION-DETAIL'));
    }, [id]);

    const summary = detail?.summary;

    return (
        <ConsolePage
            title={t('traffic.detailTitle')}
            subtitle={`查看会话 ${id} 的上下文、元数据与时间线`}
            actions={
                <Link to="/traffic" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30">
                    <ArrowLeft size={14} />
                    {t('traffic.backToList')}
                </Link>
            }
        >
            {error && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>
            )}
            {!detail ? (
                <ConsoleEmptyState title={t('traffic.loading')} />
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={summary?.protocol?.toUpperCase() || 'SESSION'} subtitle={summary?.state} icon={Network} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{summary?.sourceIP}:{summary?.sourcePort}</div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{summary?.destIP}:{summary?.destPort}</div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('traffic.packets')}: <span className="font-semibold text-foreground">{summary?.packetCount || 0}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('traffic.bytes')}: <span className="font-semibold text-foreground">{summary?.byteCount || 0}</span></div>
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={t('traffic.timeline')} subtitle={t('traffic.timelineSubtitle')} icon={Activity} iconTone="neutral">
                            <div className="space-y-3">
                                {(detail.timeline || []).map((item: any, index: number) => (
                                    <div key={`${item.title}-${index}`} className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div className="font-medium text-foreground">{item.title}</div>
                                        <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>
                                        {item.timestamp && <div className="mt-1 text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</div>}
                                    </div>
                                ))}
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title={t('traffic.metadata')} subtitle={t('traffic.metadataSubtitle')} icon={Shield} iconTone="warning">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-xs text-muted-foreground">{JSON.stringify(detail.metadata || {}, null, 2)}</pre>
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default TrafficSessionDetail;
