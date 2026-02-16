import { useEffect, useMemo, useState } from 'react';
import { Users, AlertTriangle, Cpu, HardDrive, Zap, Key, Plus, Copy, Trash2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import {
    createAgentOnboardingCode,
    createAdminApiKey,
    deleteAdminApiKey,
    fetchAdminApiKeys,
    fetchAdminData,
    fetchAgentOnboardingCodes,
    fetchRegisteredAgents,
    revokeAgentCredential
} from '../services/api';
import { useDemo } from '../context/DemoContext';

interface ApiKey {
    id: string;
    name: string;
    prefix: string;
    created: string;
    lastUsed: string;
}

interface OnboardingCodeRow {
    id: string;
    status: 'active' | 'used' | 'expired' | 'revoked';
    expectedHostname: string | null;
    maxUses: number;
    usedCount: number;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    usedByAgentId: string | null;
}

interface AgentRow {
    agentId: string;
    hostname: string;
    platform: string;
    status: 'pending' | 'approved' | 'revoked';
    createdAt: string;
    lastSeenAt?: string;
}

const SuperAdmin = () => {
    const { t } = useLanguage();
    const { isDemoMode } = useDemo();

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [keys, setKeys] = useState<ApiKey[]>([]);

    const [onboardingHostname, setOnboardingHostname] = useState('protected-web-01');
    const [onboardingTtl, setOnboardingTtl] = useState('10');
    const [onboardingMaxUses, setOnboardingMaxUses] = useState('1');
    const [creatingCode, setCreatingCode] = useState(false);
    const [createdCode, setCreatedCode] = useState<string | null>(null);
    const [createdCodeExpireAt, setCreatedCodeExpireAt] = useState<string | null>(null);

    const [codes, setCodes] = useState<OnboardingCodeRow[]>([]);
    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [codesLoading, setCodesLoading] = useState(false);
    const [codeFilter, setCodeFilter] = useState<'all' | 'active' | 'used' | 'expired' | 'revoked'>('all');
    const [revokingAgentId, setRevokingAgentId] = useState<string | null>(null);
    const [onboardingError, setOnboardingError] = useState<string | null>(null);

    const [newKeyName, setNewKeyName] = useState('API Key');

    const loadOnboardingData = async () => {
        setCodesLoading(true);
        try {
            const [codeRows, agentRows] = await Promise.all([
                fetchAgentOnboardingCodes(codeFilter === 'all' ? undefined : codeFilter, 100),
                fetchRegisteredAgents()
            ]);
            setCodes(codeRows || []);
            setAgents(agentRows || []);
        } catch (e: any) {
            setOnboardingError(e.message || 'Failed to load onboarding data');
        } finally {
            setCodesLoading(false);
        }
    };

    useEffect(() => {
        const loadData = async () => {
            const result = await fetchAdminData();
            if (result) {
                setData(result);
            }
            setLoading(false);
        };
        loadData();

        const loadApiKeys = async () => {
            try {
                const rows = await fetchAdminApiKeys();
                setKeys(rows || []);
            } catch {
                setKeys([]);
            }
        };
        loadApiKeys();
    }, [isDemoMode]);

    const createKey = async () => {
        setOnboardingError(null);
        try {
            await createAdminApiKey(newKeyName || 'API Key');
            const rows = await fetchAdminApiKeys();
            setKeys(rows || []);
        } catch (e: any) {
            setOnboardingError(e.message || 'FG-ADMIN-APIKEY-CREATE');
        }
    };

    const removeKey = async (id: string) => {
        setOnboardingError(null);
        try {
            await deleteAdminApiKey(id);
            const rows = await fetchAdminApiKeys();
            setKeys(rows || []);
        } catch (e: any) {
            setOnboardingError(e.message || 'FG-ADMIN-APIKEY-DELETE');
        }
    };

    useEffect(() => {
        if (isDemoMode) return;
        loadOnboardingData();
    }, [isDemoMode, codeFilter]);

    const createCode = async () => {
        setOnboardingError(null);
        setCreatedCode(null);
        setCreatedCodeExpireAt(null);
        setCreatingCode(true);
        try {
            const response = await createAgentOnboardingCode({
                hostname: onboardingHostname.trim() || undefined,
                ttlMinutes: Number(onboardingTtl),
                maxUses: Number(onboardingMaxUses)
            });
            setCreatedCode(response?.data?.onboardingCode || null);
            setCreatedCodeExpireAt(response?.data?.expiresAt || null);
            await loadOnboardingData();
        } catch (e: any) {
            setOnboardingError(e.message || 'Failed to create onboarding code');
        } finally {
            setCreatingCode(false);
        }
    };

    const revokeAgent = async (agentId: string) => {
        setOnboardingError(null);
        setRevokingAgentId(agentId);
        try {
            await revokeAgentCredential(agentId, 'revoked-from-super-admin');
            await loadOnboardingData();
        } catch (e: any) {
            setOnboardingError(e.message || 'Failed to revoke agent');
        } finally {
            setRevokingAgentId(null);
        }
    };

    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // ignore
        }
    };

    const codeStatusStats = useMemo(() => {
        const map = { active: 0, used: 0, expired: 0, revoked: 0 };
        codes.forEach(c => {
            map[c.status] += 1;
        });
        return map;
    }, [codes]);

    if (loading) return <div className="p-8 text-muted-foreground">{t('admin.loading')}</div>;
    if (!data) return <div className="p-8 text-muted-foreground">{t('admin.unavailable')}</div>;

    const { performance: perf, errors } = data;

    return (
        <div className="space-y-8 p-6">
            <h1 className="text-xl font-medium text-foreground">
                {t('admin.title')}
            </h1>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30 flex justify-between items-center">
                    <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                        <ShieldCheck size={16} className="text-primary" />
                        Agent Onboarding
                    </h2>
                    <button
                        onClick={loadOnboardingData}
                        disabled={codesLoading || isDemoMode}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded text-xs font-medium transition-colors disabled:opacity-60"
                    >
                        <RefreshCw size={14} className={codesLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {onboardingError && (
                        <div className="p-3 rounded border border-red-500/30 text-red-300 bg-red-500/10 text-sm">
                            {onboardingError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <input
                            value={onboardingHostname}
                            onChange={(e) => setOnboardingHostname(e.target.value)}
                            placeholder="Hostname (optional)"
                            className="bg-muted/20 border border-border rounded px-3 py-2 text-sm text-foreground"
                        />
                        <input
                            value={onboardingTtl}
                            onChange={(e) => setOnboardingTtl(e.target.value)}
                            placeholder="TTL minutes"
                            className="bg-muted/20 border border-border rounded px-3 py-2 text-sm text-foreground"
                        />
                        <input
                            value={onboardingMaxUses}
                            onChange={(e) => setOnboardingMaxUses(e.target.value)}
                            placeholder="Max uses"
                            className="bg-muted/20 border border-border rounded px-3 py-2 text-sm text-foreground"
                        />
                        <button
                            onClick={createCode}
                            disabled={creatingCode || isDemoMode}
                            className="px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-sm font-medium disabled:opacity-60"
                        >
                            {creatingCode ? 'Creating...' : 'Generate Code'}
                        </button>
                    </div>

                    {createdCode && (
                        <div className="p-3 rounded border border-emerald-500/20 bg-emerald-500/10">
                            <div className="text-xs text-emerald-300 mb-1">One-time code (copy now):</div>
                            <div className="flex items-center gap-2">
                                <code className="text-sm text-emerald-200 break-all">{createdCode}</code>
                                <button
                                    onClick={() => copy(createdCode)}
                                    className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-200"
                                    title="Copy"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                            {createdCodeExpireAt && (
                                <div className="text-[11px] text-emerald-300/80 mt-1">
                                    expires at: {new Date(createdCodeExpireAt).toLocaleString()}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 rounded border border-border bg-muted/20 text-xs text-muted-foreground">active: <span className="text-foreground">{codeStatusStats.active}</span></div>
                        <div className="p-3 rounded border border-border bg-muted/20 text-xs text-muted-foreground">used: <span className="text-foreground">{codeStatusStats.used}</span></div>
                        <div className="p-3 rounded border border-border bg-muted/20 text-xs text-muted-foreground">expired: <span className="text-foreground">{codeStatusStats.expired}</span></div>
                        <div className="p-3 rounded border border-border bg-muted/20 text-xs text-muted-foreground">revoked: <span className="text-foreground">{codeStatusStats.revoked}</span></div>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Filter:</span>
                        <select
                            value={codeFilter}
                            onChange={(e) => setCodeFilter(e.target.value as any)}
                            className="bg-muted/20 border border-border rounded px-2 py-1 text-xs text-foreground"
                        >
                            <option value="all">all</option>
                            <option value="active">active</option>
                            <option value="used">used</option>
                            <option value="expired">expired</option>
                            <option value="revoked">revoked</option>
                        </select>
                    </div>

                    <div className="overflow-x-auto border border-border rounded">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/30 text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left">status</th>
                                    <th className="px-3 py-2 text-left">hostname</th>
                                    <th className="px-3 py-2 text-left">usage</th>
                                    <th className="px-3 py-2 text-left">expires</th>
                                    <th className="px-3 py-2 text-left">used agent</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {codes.map((c) => (
                                    <tr key={c.id} className="hover:bg-muted/30">
                                        <td className="px-3 py-2 text-foreground">{c.status}</td>
                                        <td className="px-3 py-2 text-foreground">{c.expectedHostname || '-'}</td>
                                        <td className="px-3 py-2 text-foreground">{c.usedCount}/{c.maxUses}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{new Date(c.expiresAt).toLocaleString()}</td>
                                        <td className="px-3 py-2 font-mono text-muted-foreground">{c.usedByAgentId || '-'}</td>
                                    </tr>
                                ))}
                                {codes.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-3 text-muted-foreground" colSpan={5}>No onboarding codes.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="overflow-x-auto border border-border rounded">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/30 text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left">agentId</th>
                                    <th className="px-3 py-2 text-left">hostname</th>
                                    <th className="px-3 py-2 text-left">platform</th>
                                    <th className="px-3 py-2 text-left">status</th>
                                    <th className="px-3 py-2 text-left">action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {agents.map((a) => (
                                    <tr key={a.agentId} className="hover:bg-muted/30">
                                        <td className="px-3 py-2 font-mono text-foreground">{a.agentId}</td>
                                        <td className="px-3 py-2 text-foreground">{a.hostname}</td>
                                        <td className="px-3 py-2 text-foreground">{a.platform}</td>
                                        <td className="px-3 py-2 text-foreground">{a.status}</td>
                                        <td className="px-3 py-2">
                                            <button
                                                onClick={() => revokeAgent(a.agentId)}
                                                disabled={a.status === 'revoked' || revokingAgentId === a.agentId}
                                                className="px-2 py-1 rounded bg-red-600/90 hover:bg-red-600 text-white text-[11px] disabled:opacity-50"
                                            >
                                                {revokingAgentId === a.agentId ? 'revoking...' : 'revoke'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {agents.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-3 text-muted-foreground" colSpan={5}>No registered agents.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/30 flex justify-between items-center">
                    <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Key size={16} className="text-primary" />
                        {t('admin.api_keys_title')}
                    </h2>
                    <button
                        onClick={createKey}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-medium transition-colors"
                    >
                        <Plus size={14} />
                        {t('admin.create_key')}
                    </button>
                </div>
                <div className="p-6">
                    <div className="mb-3 flex gap-2">
                        <input
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            className="px-3 py-2 text-xs border border-border rounded bg-muted/20 text-foreground"
                            placeholder="Key name"
                        />
                    </div>
                    <div className="space-y-2">
                        {keys.map(key => (
                            <div key={key.id} className="flex items-center justify-between p-3 bg-muted/20 border border-border rounded hover:border-primary/50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                        <Key size={14} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{key.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">{key.prefix}**************</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                    <span>{t('admin.key_created')}: {key.created}</span>
                                    <span className="hidden md:inline">{t('admin.key_last_used')}: {key.lastUsed}</span>
                                    <div className="flex gap-1 ml-2">
                                        <button className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
                                            <Copy size={14} />
                                        </button>
                                        <button
                                            onClick={() => removeKey(key.id)}
                                            className="p-1.5 hover:bg-red-900/30 rounded text-muted-foreground hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-card border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 border border-blue-500/20">
                        <Cpu size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{t('admin.server_cpu')}</p>
                        <p className="text-2xl font-medium text-foreground">{perf.server?.cpu?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="bg-card border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-purple-500/10 rounded-full text-purple-400 border border-purple-500/20">
                        <HardDrive size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{t('admin.memory')}</p>
                        <p className="text-2xl font-medium text-foreground">{perf.server?.memory?.toFixed(1) ?? 'N/A'}%</p>
                    </div>
                </div>
                <div className="bg-card border border-border p-6 rounded-lg flex items-center gap-4">
                    <div className="p-3 bg-green-500/10 rounded-full text-green-400 border border-green-500/20">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{t('admin.active_agents')}</p>
                        <p className="text-2xl font-medium text-foreground">{perf.clients?.total_agents ?? 'N/A'}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-border bg-muted/30">
                        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                            <AlertTriangle className="text-red-500" size={16} />
                            {t('admin.recent_errors')}
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-muted-foreground">
                            <thead className="text-muted-foreground bg-muted/30">
                                <tr>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_user')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_code')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_msg')}</th>
                                    <th className="px-4 py-3 font-medium">{t('admin.table_time')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {errors.map((err: any, index: number) => (
                                    <tr key={`${err.userId}-${index}`} className="hover:bg-muted/50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-primary">{err.userId}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[10px] border border-border">
                                                {err.errorCode}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-red-400/90">{err.message}</td>
                                        <td className="px-4 py-3 opacity-60">{new Date(err.timestamp).toLocaleTimeString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="p-4 border-b border-border bg-muted/30">
                        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                            <Zap className="text-amber-500" size={16} />
                            {t('admin.client_perf')}
                        </h2>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-muted/20 rounded border border-border">
                                <p className="text-xs text-muted-foreground mb-2">{t('admin.avg_cpu')}</p>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-medium text-foreground">{perf.clients?.avg_cpu_overhead ?? 'N/A'}%</span>
                                    <span className="text-[10px] text-emerald-500 mb-1">{t('admin.low_impact')}</span>
                                </div>
                            </div>
                            <div className="p-4 bg-muted/20 rounded border border-border">
                                <p className="text-xs text-muted-foreground mb-2">{t('admin.avg_latency')}</p>
                                <div className="flex items-end gap-2">
                                    <span className="text-2xl font-medium text-foreground">{perf.clients?.avg_latency_added ?? 'N/A'}</span>
                                    <span className="text-[10px] text-emerald-500 mb-1">{t('admin.negligible')}</span>
                                </div>
                            </div>
                        </div>

                        <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">{t('admin.clients_summary')}</h3>
                        <div className="p-4 rounded bg-primary/5 border border-primary/10 text-center">
                            <p className="text-3xl font-bold text-primary">{perf.clients?.total_agents ?? 0}</p>
                            <p className="text-xs text-muted-foreground mt-1">{t('admin.connected_agents')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SuperAdmin;
