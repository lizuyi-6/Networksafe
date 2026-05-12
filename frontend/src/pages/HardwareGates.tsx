import { FormEvent, useEffect, useState } from 'react';
import { Cpu, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import { enrollHardwareGate, fetchHardwareGates, type HardwareGateRecord } from '../services/api';

const statusClass = (status: string) => {
    if (status === 'online') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    if (status === 'revoked') return 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400';
    return 'border-border bg-muted/30 text-muted-foreground';
};

const HardwareGates = () => {
    const [gates, setGates] = useState<HardwareGateRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        gateId: '',
        displayName: '',
        publicKeyPem: '',
        algorithm: 'ECDSA_P256_SHA256'
    });

    const load = async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            setGates(await fetchHardwareGates(signal));
        } catch (err: any) {
            if (!signal?.aborted) setError(err?.message || 'FG-HARDWARE-GATES-ERR');
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await enrollHardwareGate({
                gateId: form.gateId.trim(),
                displayName: form.displayName.trim() || undefined,
                publicKeyPem: form.publicKeyPem.trim(),
                algorithm: form.algorithm.trim() || undefined,
                metadata: { enrolledFrom: 'enterprise-console' }
            });
            setForm({ gateId: '', displayName: '', publicKeyPem: '', algorithm: 'ECDSA_P256_SHA256' });
            await load();
        } catch (err: any) {
            setError(err?.message || 'FG-HARDWARE-GATE-ENROLL-ERR');
        } finally {
            setSaving(false);
        }
    };

    const onlineCount = gates.filter((gate) => gate.status === 'online').length;

    return (
        <ConsolePage
            title="Gate Management"
            subtitle="Production hardware gates for serial deployment confirmation."
            actions={
                <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            }
        >
            {error && <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ConsoleStatCard icon={ShieldCheck} label="Enrolled Gates" value={gates.length} hint="Tenant-scoped physical gates" />
                <ConsoleStatCard icon={Cpu} label="Online" value={onlineCount} hint="Ready to receive confirmation sessions" tone="success" />
                <ConsoleStatCard icon={Plus} label="Protocol" value="v1" hint="USB-TTL serial deployer authority" tone="neutral" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
                <ConsolePanel title="Hardware Gates" subtitle="Experimental websocket devices stay separate from production gates." icon={ShieldCheck}>
                    {gates.length === 0 && !loading ? (
                        <ConsoleEmptyState title="No gates enrolled" description="Enroll an ESP32 serial gate before approving deployment runs." />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th className="py-2 pr-4">Gate</th>
                                        <th className="py-2 pr-4">Status</th>
                                        <th className="py-2 pr-4">Algorithm</th>
                                        <th className="py-2 pr-4">Last Seen</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {gates.map((gate) => (
                                        <tr key={gate.gateId}>
                                            <td className="py-3 pr-4">
                                                <div className="font-medium text-foreground">{gate.displayName || gate.gateId}</div>
                                                <div className="font-mono text-xs text-muted-foreground">{gate.gateId}</div>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusClass(gate.status)}`}>{gate.status}</span>
                                            </td>
                                            <td className="py-3 pr-4 text-muted-foreground">{gate.algorithm}</td>
                                            <td className="py-3 pr-4 text-muted-foreground">{gate.lastSeenAt ? new Date(gate.lastSeenAt).toLocaleString() : '--'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </ConsolePanel>

                <ConsolePanel title="Enroll Gate" subtitle="Paste the ESP32 public key exported during gate provisioning." icon={Plus}>
                    <form onSubmit={submit} className="space-y-4">
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Gate ID</span>
                            <input value={form.gateId} onChange={(e) => setForm({ ...form, gateId: e.target.value })} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
                        </label>
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Display Name</span>
                            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
                        </label>
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Algorithm</span>
                            <input value={form.algorithm} onChange={(e) => setForm({ ...form, algorithm: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
                        </label>
                        <label className="block space-y-2 text-sm">
                            <span className="text-muted-foreground">Public Key PEM</span>
                            <textarea value={form.publicKeyPem} onChange={(e) => setForm({ ...form, publicKeyPem: e.target.value })} required rows={8} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground" />
                        </label>
                        <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                            <Plus size={14} />
                            {saving ? 'Enrolling...' : 'Enroll Gate'}
                        </button>
                    </form>
                </ConsolePanel>
            </div>
        </ConsolePage>
    );
};

export default HardwareGates;
