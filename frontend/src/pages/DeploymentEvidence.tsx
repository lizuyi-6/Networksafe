import { FormEvent, useEffect, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';
import { fetchDeploymentEvidence, fetchDeploymentRuns, type DeploymentEvidenceResponse, type DeploymentRunRecord } from '../services/api';

const DeploymentEvidence = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [runs, setRuns] = useState<DeploymentRunRecord[]>([]);
    const [selectedRunId, setSelectedRunId] = useState(searchParams.get('runId') || '');
    const [evidence, setEvidence] = useState<DeploymentEvidenceResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadRuns = async (signal?: AbortSignal) => {
        try {
            const nextRuns = await fetchDeploymentRuns(signal);
            setRuns(nextRuns);
            setSelectedRunId((current) => current || nextRuns.find((run) => run.evidenceStatus === 'ready')?.id || nextRuns[0]?.id || '');
        } catch (err: any) {
            if (!signal?.aborted) setError(err?.message || 'FG-DEPLOYMENT-RUNS-ERR');
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        void loadRuns(controller.signal);
        return () => controller.abort();
    }, []);

    const loadEvidence = async (runId = selectedRunId) => {
        if (!runId) return;
        setLoading(true);
        setError(null);
        try {
            setEvidence(await fetchDeploymentEvidence(runId));
            setSearchParams({ runId });
        } catch (err: any) {
            setEvidence(null);
            setError(err?.message || 'FG-DEPLOYMENT-EVIDENCE-ERR');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedRunId) void loadEvidence(selectedRunId);
    }, [selectedRunId]);

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void loadEvidence();
    };

    const downloadJson = () => {
        if (!evidence) return;
        const blob = new Blob([JSON.stringify(evidence.payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `aetherguard-evidence-${evidence.run.id}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <ConsolePage
            testId="deployment-evidence-page"
            title="Evidence"
            subtitle="Immutable deployment evidence packs generated after helper execution."
            actions={
                <button onClick={() => void loadEvidence()} disabled={!selectedRunId || loading} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-60">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            }
        >
            {error && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

            <ConsolePanel title="Evidence Lookup" subtitle="Evidence is keyed by deployment run." icon={FileText}>
                <form onSubmit={submit} className="flex flex-col gap-3 md:flex-row md:items-end">
                    <label className="block flex-1 space-y-2 text-sm">
                        <span className="text-muted-foreground">Deployment Run</span>
                        <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                            <option value="">Select run</option>
                            {runs.map((run) => (
                                <option key={run.id} value={run.id}>{run.id.slice(0, 8)} - {run.status} - {run.evidenceStatus}</option>
                            ))}
                        </select>
                    </label>
                    <button disabled={!selectedRunId || loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                        <FileText size={14} />
                        Load
                    </button>
                    <button type="button" onClick={downloadJson} disabled={!evidence} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-60">
                        <Download size={14} />
                        Export JSON
                    </button>
                </form>
            </ConsolePanel>

            <ConsolePanel title="Evidence Pack" subtitle={evidence ? `Run ${evidence.run.id}` : undefined} icon={FileText}>
                {!evidence ? (
                    <ConsoleEmptyState title="No evidence loaded" description="Completed or failed helper execution creates an evidence pack." />
                ) : (
                    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
                        <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-4 text-sm">
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Status</span><span className="font-medium text-foreground">{evidence.run.status}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Evidence</span><span className="font-medium text-foreground">{evidence.run.evidenceStatus}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Bundle</span><span className="font-mono text-foreground">{evidence.run.checksumShortCode}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Helper</span><span className="font-mono text-foreground">{evidence.run.helperId}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Gate</span><span className="font-mono text-foreground">{evidence.run.gateId}</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Artifact</span><span className="truncate font-mono text-foreground">{evidence.run.evidenceArtifactRef || '--'}</span></div>
                        </div>
                        <pre className="max-h-[640px] overflow-auto rounded-lg border border-border bg-background p-4 text-xs text-foreground">
                            {JSON.stringify(evidence.payload, null, 2)}
                        </pre>
                    </div>
                )}
            </ConsolePanel>
        </ConsolePage>
    );
};

export default DeploymentEvidence;
