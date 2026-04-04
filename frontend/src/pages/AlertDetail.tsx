import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { AlertTriangle, ArrowLeft, Clock, Shield } from 'lucide-react';
import { fetchAlertDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const AlertDetail = () => {
    const { id = '' } = useParams();
    const { t } = useLanguage();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAlertDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-ALERT-DETAIL'));
    }, [id]);

    return (
        <ConsolePage
            title={t('alertDetail.page_title')}
            subtitle={t('alertDetail.page_subtitle').replace('{id}', id)}
            actions={<Link to="/alerts" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />{t('alertDetail.back')}</Link>}
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? (
                <ConsoleEmptyState title={t('alertDetail.loading')} />
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={detail.summary?.title || id} subtitle={detail.summary?.message} icon={AlertTriangle} iconTone="danger">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">{t('alertDetail.severity_level')}</div><div className="mt-1 font-semibold text-foreground">{detail.summary?.severity}</div></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">{t('alertDetail.status')}</div><div className="mt-1 font-semibold text-foreground">{detail.summary?.status}</div></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">{t('alertDetail.source')}</div><div className="mt-1 font-semibold text-foreground">{detail.summary?.source}</div></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">{t('alertDetail.time')}</div><div className="mt-1 font-semibold text-foreground">{new Date(detail.summary?.timestamp || Date.now()).toLocaleString()}</div></div>
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title={t('alertDetail.evidence')} subtitle={t('alertDetail.findings_subtitle')} icon={Shield} iconTone="warning">
                            <div className="space-y-4">
                                {(detail.evidence || []).length > 0 ? (detail.evidence || []).map((item: any) => (
                                    <div key={item.findingId} className="rounded-lg border border-border bg-muted/15 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="font-medium text-foreground">{item.title}</div>
                                            <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{item.severity}</span>
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{JSON.stringify(item.evidence || {}, null, 2)}</pre>
                                    </div>
                                )) : <ConsoleEmptyState title={t('alertDetail.no_evidence')} description={t('alertDetail.findings_desc')} />}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={t('alertDetail.timeline')} subtitle={t('alertDetail.context')} icon={Clock} iconTone="neutral">
                            <div className="space-y-3">
                                {(detail.timeline || []).map((item: any, index: number) => (
                                    <div key={`${item.title}-${index}`} className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div className="font-medium text-foreground">{item.title}</div>
                                        {item.description && <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>}
                                        {item.timestamp && <div className="mt-1 text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</div>}
                                    </div>
                                ))}
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title={t('alertDetail.actions')} subtitle={t('alertDetail.actions_subtitle')} icon={Shield} iconTone="primary">
                            {(detail.relatedActions || []).length > 0 ? (
                                <div className="space-y-3">
                                    {(detail.relatedActions || []).map((action: any) => (
                                        <div key={action.actionId} className="rounded-lg border border-border bg-muted/15 p-3 text-sm">
                                            <div className="font-medium text-foreground">{action.title}</div>
                                            <div className="mt-1 text-muted-foreground">{action.status} · {action.operator}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title={t('alertDetail.no_actions')} description={t('alertDetail.actions_desc')} />}
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default AlertDetail;
