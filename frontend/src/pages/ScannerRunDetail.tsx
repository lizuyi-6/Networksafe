import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Shield, Wrench } from 'lucide-react';
import { fetchScannerRunDetail } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const ScannerRunDetail = () => {
    const { t } = useLanguage();
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchScannerRunDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-SCAN-RUN-DETAIL'));
    }, [id]);

    const findings = detail?.result?.findings || [];
    const timeline = detail?.result?.timeline || [];

    return (
        <ConsolePage title={t('scanner.detailTitle')} subtitle={`查看任务 ${id} 的阶段、证据与修复建议`} actions={<Link to="/scanner" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />{t('scanner.backToCenter')}</Link>}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title={t('scanner.loading')} /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={t('scanner.summary')} subtitle={t('scanner.summarySubtitle')} icon={Activity} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('scanner.status')}: <span className="font-semibold text-foreground">{detail.summary?.status || '-'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('scanner.phase')}: <span className="font-semibold text-foreground">{detail.summary?.phase || '-'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('scanner.progress')}: <span className="font-semibold text-foreground">{detail.summary?.progress || 0}%</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">{t('scanner.error')}: <span className="font-semibold text-foreground">{detail.summary?.error || t('scanner.none')}</span></div>
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title={t('scanner.timelineTitle')} subtitle={t('scanner.timelineSubtitle')} icon={Activity} iconTone="neutral">
                            <div className="space-y-3">
                                {timeline.length > 0 ? timeline.map((item: any, index: number) => (
                                    <div key={`${item.eventType}-${index}`} className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div className="font-medium text-foreground">{item.eventType}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(item.payload || {}, null, 2)}</pre>
                                    </div>
                                )) : <ConsoleEmptyState title={t('scanner.noEvents')} />}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={t('scanner.findingsTitle')} subtitle={t('scanner.findingsSubtitle')} icon={Shield} iconTone="danger">
                            <div className="space-y-3">
                                {findings.length > 0 ? findings.map((finding: any) => (
                                    <div key={finding.findingId} className="rounded-lg border border-border bg-muted/15 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="font-medium text-foreground">{finding.title}</div>
                                                <div className="mt-1 text-xs text-muted-foreground">{finding.target}</div>
                                            </div>
                                            <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{finding.severity}</span>
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">{finding.description}</p>
                                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{JSON.stringify(finding.evidence || {}, null, 2)}</pre>
                                    </div>
                                )) : <ConsoleEmptyState title={t('scanner.noFindings')} description={t('scanner.noFindingsDesc')} />}
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title={t('scanner.remediation')} subtitle={t('scanner.remediationSubtitle')} icon={Wrench} iconTone="warning">
                            {findings.length > 0 ? findings.map((finding: any) => (
                                <pre key={`${finding.findingId}-remediation`} className="mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-xs text-muted-foreground">{JSON.stringify(finding.remediation || {}, null, 2)}</pre>
                            )) : <ConsoleEmptyState title={t('scanner.noRemediation')} />}
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default ScannerRunDetail;
