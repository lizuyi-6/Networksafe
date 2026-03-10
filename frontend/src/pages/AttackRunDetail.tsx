import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Shield, TerminalSquare } from 'lucide-react';
import { fetchAttackRunDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const AttackRunDetail = () => {
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
            title="Attack Run Detail"
            subtitle={`Inspect run ${id} and its decision trail`}
            actions={
                <Link
                    to="/attack-sim"
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"
                >
                    <ArrowLeft size={14} />
                    Back to Attack Simulator
                </Link>
            }
        >
            {error && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
                    {error}
                </div>
            )}
            {!detail ? (
                <ConsoleEmptyState title="Loading attack run detail" />
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel
                            title={summary?.attackName || 'Attack Run'}
                            subtitle={summary?.category || 'simulation'}
                            icon={Shield}
                            iconTone="danger"
                        >
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    Verdict:{' '}
                                    <span className="font-semibold text-foreground">
                                        {summary?.verdict || `${summary?.blocked}/${summary?.total}`}
                                    </span>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    Started:{' '}
                                    <span className="font-semibold text-foreground">
                                        {new Date(summary?.startedAt || summary?.startTime || Date.now()).toLocaleString()}
                                    </span>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    Completed:{' '}
                                    <span className="font-semibold text-foreground">
                                        {new Date(summary?.completedAt || summary?.endTime || Date.now()).toLocaleString()}
                                    </span>
                                </div>
                                {aiAnalysis && (
                                    <div className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div>
                                            AI route:{' '}
                                            <span className="font-semibold text-foreground">
                                                {aiAnalysis.route || 'unknown'}
                                            </span>
                                        </div>
                                        {aiAnalysis.provider && (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                Provider: {aiAnalysis.provider}
                                            </div>
                                        )}
                                        {aiAnalysis.model && (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                Model: {aiAnalysis.model}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel
                            title="Execution Timeline"
                            subtitle="Run start, completion, and correlated events"
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
                            title="Result Payload"
                            subtitle="Raw decision and correlated context"
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
