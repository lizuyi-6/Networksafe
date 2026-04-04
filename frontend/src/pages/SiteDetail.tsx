import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Globe, Shield, Workflow } from 'lucide-react';
import { fetchSiteDetail } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';
import StructuredDataView from '../components/StructuredDataView';

const formatBytes = (value?: number) => {
    if (!value) return '0 B';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
};

const SiteDetail = () => {
    const { t } = useLanguage();
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchSiteDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-SITE-DETAIL'));
    }, [id]);

    return (
        <ConsolePage title={t('sites.detailTitle')} subtitle={t('siteDetail.page_subtitle').replace('{id}', id)} actions={<Link to="/sites" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />{t('sites.backToList')}</Link>}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title={t('sites.loading')} /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={detail.domain || id} subtitle={detail.target} icon={Globe} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('siteDetail.status')}：<span className="font-semibold text-foreground">{detail.status || 'unknown'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('siteDetail.target')}：<span className="font-semibold text-foreground">{detail.target}</span></div>
                                {detail.securityOverview?.asset && <div className="rounded-lg border border-border bg-muted/15 p-3">{t('siteDetail.risk_score')}：<span className="font-semibold text-foreground">{detail.securityOverview.asset.riskScore}</span></div>}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={t('sites.relatedAlerts')} subtitle={t('sites.relatedAlertsSubtitle')} icon={Shield} iconTone="danger">
                            {(detail.relatedAlerts || detail.securityOverview?.alerts || []).length > 0 ? (
                                <div className="space-y-3">
                                    {(detail.relatedAlerts || detail.securityOverview?.alerts || []).map((item: any, index: number) => (
                                        <div key={item.id || item.alertId || index} className="rounded-lg border border-border bg-muted/15 p-4">
                                            <div className="font-medium text-foreground">{item.title}</div>
                                            <div className="mt-1 text-sm text-muted-foreground">{item.message || item.status}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title={t('sites.noRelatedAlerts')} />}
                        </ConsolePanel>
                        <ConsolePanel title={t('sites.relatedTraffic')} subtitle={t('sites.relatedTrafficSubtitle')} icon={Workflow} iconTone="warning">
                            <div className="space-y-4">
                                {(detail.relatedFlows || []).length > 0 ? (
                                    <div className="space-y-3">
                                        {(detail.relatedFlows || []).map((flow: any) => (
                                            <div key={flow.id} className="rounded-lg border border-border bg-muted/15 p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <div>
                                                        <div className="font-medium text-foreground">
                                                            {flow.sourceIP}:{flow.sourcePort} → {flow.destIP}:{flow.destPort}
                                                        </div>
                                                        <div className="mt-1 text-xs text-muted-foreground">
                                                            {String(flow.protocol || '').toUpperCase()} · {flow.state || 'unknown'}
                                                        </div>
                                                    </div>
                                                    <div className="text-right text-xs text-muted-foreground">
                                                        <div>{t('siteDetail.packets')} {flow.packetCount ?? 0}</div>
                                                        <div>{t('siteDetail.traffic')} {formatBytes(flow.byteCount)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <ConsoleEmptyState title={t('sites.noRelatedFlows')} description={t('sites.noRelatedFlowsDesc')} />
                                )}

                                {detail.securityOverview ? (
                                    <div className="rounded-lg border border-border bg-muted/15 p-4">
                                        <div className="mb-3 text-sm font-medium text-foreground">{t('sites.securityOverview')}</div>
                                        <StructuredDataView value={detail.securityOverview} emptyLabel={t('sites.noData')} />
                                    </div>
                                ) : null}
                            </div>
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default SiteDetail;
