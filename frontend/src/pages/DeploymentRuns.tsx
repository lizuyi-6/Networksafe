import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Play, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import {
    approveDeploymentRun,
    createDeploymentRun,
    fetchDeploymentHelpers,
    fetchDeploymentRuns,
    fetchHardwareGates,
    type DeploymentHelperRecord,
    type DeploymentRunRecord,
    type DeploymentTarget,
    type HardwareGateRecord
} from '../services/api';

const statusTone = (status: string) => {
    if (['completed', 'approved', 'backup_completed'].includes(status)) return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (['failed', 'rolled_back'].includes(status)) return 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    if (status.includes('pending')) return 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    return 'border-border bg-muted/30 text-muted-foreground';
};

const defaultProfile = {
    serverName: 'pilot-host.local',
    port: 8080,
    upstream: 'http://backend:3005',
    rateLimit: 100,
    image: 'ghcr.io/aetherguard/agent:latest'
};

const DeploymentRuns = () => {
    const [runs, setRuns] = useState<DeploymentRunRecord[]>([]);
    const [helpers, setHelpers] = useState<DeploymentHelperRecord[]>([]);
    const [gates, setGates] = useState<HardwareGateRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyRunId, setBusyRunId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        helperId: '',
        gateId: '',
        requestType: 'install' as 'install' | 'remove',
        serverType: 'docker_compose' as DeploymentTarget,
        profileJson: JSON.stringify(defaultProfile, null, 2)
    });

    const load = async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            const [nextRuns, nextHelpers, nextGates] = await Promise.all([
                fetchDeploymentRuns(signal),
                fetchDeploymentHelpers(signal),
                fetchHardwareGates(signal)
            ]);
            setRuns(nextRuns);
            setHelpers(nextHelpers);
            setGates(nextGates);
            setForm((current) => ({
                ...current,
                helperId: current.helperId || nextHelpers[0]?.helperId || '',
                gateId: current.gateId || nextGates[0]?.gateId || ''
            }));
        } catch (err: any) {
            if (!signal?.aborted) setError(err?.message || 'FG-DEPLOYMENT-RUNS-ERR');
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, []);

    const createRun = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setCreating(true);
        setError(null);
        try {
            const profile = JSON.parse(form.profileJson);
            await createDeploymentRun({
                helperId: form.helperId,
                gateId: form.gateId,
                requestType: form.requestType,
                serverType: form.serverType,
                profile
            });
            await load();
        } catch (err: any) {
            setError(err?.message || 'FG-DEPLOYMENT-RUN-CREATE-ERR');
        } finally {
            setCreating(false);
        }
    };

    const approve = async (runId: string) => {
        setBusyRunId(runId);
        setError(null);
        try {
            await approveDeploymentRun(runId);
            await load();
        } catch (err: any) {
            setError(err?.message || 'FG-DEPLOYMENT-RUN-APPROVE-ERR');
        } finally {
            setBusyRunId(null);
        }
    };

    const readyForApproval = useMemo(() => runs.filter((run) => run.status === 'backup_completed').length, [runs]);

    return (
        <ConsolePage
            testId="deployment-runs-page"
            title="Deployment Runs"
            subtitle="Signed bundle execution through helper attestation and serial hardware confirmation."
            actions={
                <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            }
        >
            {error && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <ConsoleStatCard icon={Play} label="Runs" value={runs.length} hint="Tenant-scoped deployment records" />
                <ConsoleStatCard icon={Server} label="Helpers" value={helpers.length} hint="Registered Linux serial helpers" tone="neutral" />
                <ConsoleStatCard icon={ShieldCheck} label="Gates" value={gates.length} hint="Enrolled physical gates" tone="success" />
                <ConsoleStatCard icon={CheckCircle2} label="Awaiting Approval" value={readyForApproval} hint="Backup completed before approval" tone="warning" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
                <ConsolePanel title="Run Timeline" subtitle="Only approved runs are available to serial helpers for install/remove execution." icon={Play}>
                    {runs.length === 0 && !loading ? (
                        <ConsoleEmptyState title="No deployment runs" description="Create a run after at least one helper and one gate are registered." />
                    ) : (
                        <div className="space-y-3">
                            {runs.map((run) => (
                                <div key={run.id} className="rounded-lg border border-border bg-muted/10 p-4">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-mono text-sm font-semibold text-foreground">{run.id.slice(0, 8)}</span>
                                                <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusTone(run.status)}`}>{run.status}</span>
                                                <span className="rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground">{run.requestType}</span>
                                            </div>
                                            <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                                                <div>Helper: <span className="font-mono text-foreground">{run.helperId}</span></div>
                                                <div>Gate: <span className="font-mono text-foreground">{run.gateId}</span></div>
                                                <div>Bundle: <span className="font-mono text-foreground">{run.checksumShortCode}</span></div>
                                                <div>Updated: {new Date(run.updatedAt).toLocaleString()}</div>
                                            </div>
                                            {run.lastError && <div className="mt-2 text-xs text-rose-500">{run.lastError}</div>}
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <Link to={`/deployment-evidence?runId=${encodeURIComponent(run.id)}`} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/40">
                                                Evidence
                                            </Link>
                                            <button
                                                onClick={() => void approve(run.id)}
                                                disabled={busyRunId === run.id || run.status !== 'backup_completed'}
                                                className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {busyRunId === run.id ? 'Approving...' : 'Approve'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ConsolePanel>

                <ConsolePanel title="Create Run" subtitle="The helper must complete BACKUP before hardware approval is allowed." icon={Server}>
                    <form onSubmit={createRun} className="space-y-4">
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Helper</span>
                            <select value={form.helperId} onChange={(e) => setForm({ ...form, helperId: e.target.value })} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                                <option value="">Select helper</option>
                                {helpers.map((helper) => <option key={helper.helperId} value={helper.helperId}>{helper.helperId} ({helper.status})</option>)}
                            </select>
                        </label>
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Gate</span>
                            <select value={form.gateId} onChange={(e) => setForm({ ...form, gateId: e.target.value })} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                                <option value="">Select gate</option>
                                {gates.map((gate) => <option key={gate.gateId} value={gate.gateId}>{gate.displayName || gate.gateId} ({gate.status})</option>)}
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block space-y-2 text-sm">
                                <span className="text-muted-foreground">Action</span>
                                <select value={form.requestType} onChange={(e) => setForm({ ...form, requestType: e.target.value as 'install' | 'remove' })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                                    <option value="install">install</option>
                                    <option value="remove">remove</option>
                                </select>
                            </label>
                            <label className="block space-y-2 text-sm">
                                <span className="text-muted-foreground">Target</span>
                                <select value={form.serverType} onChange={(e) => setForm({ ...form, serverType: e.target.value as DeploymentTarget })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                                    <option value="docker_compose">docker_compose</option>
                                    <option value="nginx">nginx</option>
                                    <option value="apache">apache</option>
                                    <option value="caddy">caddy</option>
                                    <option value="binary_agent">binary_agent</option>
                                </select>
                            </label>
                        </div>
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Profile JSON</span>
                            <textarea value={form.profileJson} onChange={(e) => setForm({ ...form, profileJson: e.target.value })} rows={11} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground" />
                        </label>
                        <button disabled={creating || !form.helperId || !form.gateId} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                            <Play size={14} />
                            {creating ? 'Creating...' : 'Create Run'}
                        </button>
                    </form>
                </ConsolePanel>
            </div>
        </ConsolePage>
    );
};

export default DeploymentRuns;
