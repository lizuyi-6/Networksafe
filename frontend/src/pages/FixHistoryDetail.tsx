import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { ArrowLeft, History, Wrench } from 'lucide-react';
import { fetchFixHistoryDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';
import StructuredDataView from '../components/StructuredDataView';

const FixHistoryDetail = () => {
    const { t } = useLanguage();
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchFixHistoryDetail(id)
            .then((response) => setDetail(response || null))
            .catch((err: any) => setError(err.message || 'FG-HISTORY-DETAIL'));
    }, [id]);

    return (
        <ConsolePage title={t('fixHistoryDetail.title')} subtitle={t('fixHistoryDetail.page_subtitle', { id })} actions={<Link to="/history" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />{t('fixHistoryDetail.back')}</Link>}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title={t('fixHistoryDetail.loading')} /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={detail.id} subtitle={t('fixHistoryDetail.task_summary')} icon={History} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('fixHistoryDetail.status')}: <span className="font-semibold text-foreground">{detail.status}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('fixHistoryDetail.phase')}: <span className="font-semibold text-foreground">{detail.phase}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('fixHistoryDetail.progress')}: <span className="font-semibold text-foreground">{detail.progress}%</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('fixHistoryDetail.error')}: <span className="font-semibold text-foreground">{detail.error || t('fixHistoryDetail.none')}</span></div>
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={t('fixHistoryDetail.summary')} subtitle={t('fixHistoryDetail.stats')} icon={Wrench} iconTone="warning">
                            <StructuredDataView value={detail.summary || {}} emptyLabel={t('fixHistoryDetail.remediation')} />
                        </ConsolePanel>
                        <ConsolePanel title={t('fixHistoryDetail.findings')} subtitle={t('fixHistoryDetail.remediation_subtitle')} icon={History} iconTone="neutral">
                            {(detail.findings || []).length > 0 ? (
                                <div className="space-y-3">
                                    {(detail.findings || []).map((finding: any, index: number) => (
                                        <div key={`${finding.title}-${index}`} className="rounded-lg border border-border bg-muted/15 p-4">
                                            <div className="font-medium text-foreground">{finding.title}</div>
                                            <div className="mt-1 text-sm text-muted-foreground">{finding.description}</div>
                                            <div className="mt-2 text-xs text-muted-foreground">{finding.target_type} · {finding.target} · {finding.severity}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title={t('fixHistoryDetail.no_findings')} />}
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default FixHistoryDetail;
