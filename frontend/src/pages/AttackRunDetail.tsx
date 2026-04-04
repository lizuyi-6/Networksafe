import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Shield, TerminalSquare } from 'lucide-react';
import { fetchAttackRunDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';
import { useLanguage } from '../context/LanguageContext';

const AttackRunDetail = () => {
    const { t } = useLanguage();
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAttackRunDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-ATTACK-RUN-DETAIL'));
    }, [id]);

    const summary = detail?.summary;
    const result = detail?.result;
    const aiAnalysis = result?.aiAnalysis || summary?.results?.[0]?.aiAnalysis;

    return (
        <ConsolePage
            title={t('attackRunDetail.page_title')}
            subtitle={t('attackRunDetail.page_subtitle', { id })}
            actions={
                <Link
                    to="/attack-sim"
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"
                >
                    <ArrowLeft size={14} />
                    {t('attackRunDetail.back_to_simulator')}
                </Link>
            }
        >
            {error && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
                    {error}
                </div>
            )}
            {!detail ? (
                <ConsoleEmptyState title={t('attackRunDetail.loading')} />
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel
                            title={summary?.attackName || t('attackRunDetail.attack_run')}
                            subtitle={summary?.category || 'simulation'}
                            icon={Shield}
                            iconTone="danger"
                        >
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    {t('attackRunDetail.verdict')}:{' '}
                                    <span className="font-semibold text-foreground">
                                        {summary?.verdict || `${summary?.blocked}/${summary?.total}`}
                                    </span>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    {t('attackRunDetail.started')}:{' '}
                                    <span className="font-semibold text-foreground">
                                        {new Date(summary?.startedAt || summary?.startTime || Date.now()).toLocaleString()}
                                    </span>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    {t('attackRunDetail.completed')}:{' '}
                                    <span className="font-semibold text-foreground">
                                        {new Date(summary?.completedAt || summary?.endTime || Date.now()).toLocaleString()}
                                    </span>
                                </div>
                                {aiAnalysis && (
                                    <div className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div>
                                            {t('attackRunDetail.ai_route')}:{' '}
                                            <span className="font-semibold text-foreground">
                                                {aiAnalysis.route || t('attackRunDetail.unknown')}
                                            </span>
                                        </div>
                                        {aiAnalysis.provider && (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {t('attackRunDetail.provider')}: {aiAnalysis.provider}
                                            </div>
                                        )}
                                        {aiAnalysis.model && (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {t('attackRunDetail.model')}: {aiAnalysis.model}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel
                            title={t('attackRunDetail.timeline')}
                            subtitle={t('attackRunDetail.timeline_subtitle')}
                            icon={TerminalSquare}
                            iconTone="primary"
                        >
                            <div className="space-y-3">
                                {(detail.timeline || []).map((item: any, index: number) => (
                                    <div key={`${item.title}-${index}`} className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div className="font-medium text-foreground">{item.title}</div>
                                        {item.description && (
                                            <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>
                                        )}
                                        {item.timestamp && (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {new Date(item.timestamp).toLocaleString()}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ConsolePanel>
                        <ConsolePanel
                            title={t('attackRunDetail.result_payload')}
                            subtitle={t('attackRunDetail.result_payload_subtitle')}
                            icon={Shield}
                            iconTone="warning"
                        >
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-xs text-muted-foreground">
                                {JSON.stringify(result || {}, null, 2)}
                            </pre>
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default AttackRunDetail;
