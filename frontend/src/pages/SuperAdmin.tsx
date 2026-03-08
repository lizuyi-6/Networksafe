import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Copy, Cpu, Download, FileSearch, HardDrive, Key, Plus, RefreshCw, ShieldCheck, Trash2, Users, Zap } from 'lucide-react';
import {
    createAdminApiKey,
    createAdminOversightExport,
    createAgentOnboardingCode,
    deleteAdminApiKey,
    fetchAdminApiKeys,
    fetchAdminData,
    fetchAdminOversightEvidence,
    fetchAdminOversightExport,
    fetchAdminOversightExports,
    fetchAdminOversightSummary,
    fetchAdminOversightTenants,
    fetchAdminOversightTimeline,
    fetchAdminOversightUserTimeline,
    fetchAdminUsersList,
    fetchAgentOnboardingCodes,
    fetchRegisteredAgents,
    isRequestAbortError,
    revokeAgentCredential,
    verifyAdminAuditLog,
} from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import StructuredDataView from '../components/StructuredDataView';

type Tab = 'overview' | 'timeline' | 'evidence' | 'exports';
type ApiKey = { id: string; name: string; prefix: string; created: string; lastUsed: string };
type CodeRow = { id: string; status: 'active' | 'used' | 'expired' | 'revoked'; expectedHostname: string | null; maxUses: number; usedCount: number; expiresAt: string; usedByAgentId: string | null };
type AgentRow = { agentId: string; hostname: string; platform: string; status: 'pending' | 'approved' | 'revoked' };

const parseTab = (value: string | null): Tab => (value === 'timeline' || value === 'evidence' || value === 'exports' ? value : 'overview');
const fmt = (value?: string | null) => {
    if (!value) return 'Not available';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};
const statusLabel: Record<string, string> = { active: 'Active', used: 'Used', expired: 'Expired', revoked: 'Revoked', pending: 'Pending', approved: 'Approved' };
const oversightCategories = [['all', 'All events'], ['auth', 'Authentication'], ['system', 'System'], ['scanner', 'Scanning'], ['alert', 'Alerts'], ['action', 'Actions'], ['validation', 'Validation'], ['deployment', 'Deployment']] as const;
const rangeOptions = [['1', '24 hours'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const;

const downloadText = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};

const OversightDetailView = ({ item }: { item: any }) => {
    if (!item) {
        return null;
    }

    return (
        <div className="space-y-4" data-testid="oversight-detail-panel">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Time</div>
                    <div className="mt-2 text-sm text-foreground">{fmt(item.timestamp || item.requestedAt || item.createdAt)}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Status</div>
                    <div className="mt-2 text-sm text-foreground">{item.status || item.integrity || 'Not available'}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Category</div>
                    <div className="mt-2 text-sm text-foreground">{item.category || 'Not available'}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Action</div>
                    <div className="mt-2 text-sm text-foreground">{item.action || item.id || 'Not available'}</div>
                </div>
            </div>

            {item.actor ? (
                <div className="rounded-lg border border-border bg-muted/10 p-4">
                    <div className="mb-3 text-sm font-medium text-foreground">Actor</div>
                    <StructuredDataView value={item.actor} emptyLabel="Actor unavailable" />
                </div>
            ) : null}

            {item.target ? (
                <div className="rounded-lg border border-border bg-muted/10 p-4">
                    <div className="mb-3 text-sm font-medium text-foreground">Target</div>
                    <StructuredDataView value={item.target} emptyLabel="Target unavailable" />
                </div>
            ) : null}

            <div className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="mb-3 text-sm font-medium text-foreground">Details</div>
                <StructuredDataView value={item.details || item} emptyLabel="No detail payload available" />
            </div>
        </div>
    );
};

export default function SuperAdmin() {
    const location = useLocation();
    const navigate = useNavigate();
    const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [codes, setCodes] = useState<CodeRow[]>([]);
    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [tenants, setTenants] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [timeline, setTimeline] = useState<any[]>([]);
    const [evidence, setEvidence] = useState<any[]>([]);
    const [exportsList, setExportsList] = useState<any[]>([]);
    const [integrity, setIntegrity] = useState<Record<string, string>>({});
    const [detail, setDetail] = useState<any>(null);

    const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get('tab')));
    const [tenantId, setTenantId] = useState(() => searchParams.get('tenant') || '');
    const [userId, setUserId] = useState(() => searchParams.get('user') || '');
    const [category, setCategory] = useState('all');
    const [range, setRange] = useState('7');
    const [keyName, setKeyName] = useState('Platform API Key');
    const [hostname, setHostname] = useState('protected-web-01');
    const [ttl, setTtl] = useState('10');
    const [maxUses, setMaxUses] = useState('1');
    const [createdCode, setCreatedCode] = useState<string | null>(null);
    const [createdCodeExpireAt, setCreatedCodeExpireAt] = useState<string | null>(null);

    const currentUsers = useMemo(() => users.filter((user) => !tenantId || user.tenant_id === tenantId), [users, tenantId]);

    const syncQuery = (nextTab = tab, nextTenant = tenantId, nextUser = userId) => {
        const params = new URLSearchParams(location.search);
        params.set('tab', nextTab);
        nextTenant ? params.set('tenant', nextTenant) : params.delete('tenant');
        nextUser ? params.set('user', nextUser) : params.delete('user');
        navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    };

    const applyOversightView = (nextTab = tab, nextTenant = tenantId, nextUser = userId) => {
        setTab(nextTab);
        setTenantId(nextTenant);
        setUserId(nextUser);
        setDetail(null);
        syncQuery(nextTab, nextTenant, nextUser);
    };

    const loadStatic = async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            const [adminData, apiKeys, codeRows, agentRows, userRows, tenantRows] = await Promise.all([
                fetchAdminData(signal),
                fetchAdminApiKeys(signal),
                fetchAgentOnboardingCodes(undefined, 100, signal),
                fetchRegisteredAgents(signal),
                fetchAdminUsersList(signal),
                fetchAdminOversightTenants(signal),
            ]);

            if (signal?.aborted) {
                return;
            }

            const queryTenant = new URLSearchParams(location.search).get('tenant');
            const queryUser = new URLSearchParams(location.search).get('user');
            const resolvedTenant =
                queryTenant ||
                userRows?.users?.find((user: any) => user.id === queryUser)?.tenant_id ||
                tenantRows?.[0]?.tenantId ||
                userRows?.users?.[0]?.tenant_id ||
                '';

            setData(adminData);
            setKeys(apiKeys || []);
            setCodes(codeRows || []);
            setAgents(agentRows || []);
            setUsers(userRows?.users || []);
            setTenants(tenantRows || []);
            setTenantId(resolvedTenant);

            if (!queryTenant && resolvedTenant) {
                syncQuery(parseTab(new URLSearchParams(location.search).get('tab')), resolvedTenant, queryUser || '');
            }
        } catch (err: any) {
            if (!isRequestAbortError(err, signal)) {
                setError(err?.message || 'Failed to load admin console data');
            }
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    };

    const loadOversight = async (signal?: AbortSignal) => {
        if (!tenantId) {
            return;
        }

        try {
            const now = new Date();
            const from = new Date(now.getTime() - Number(range) * 24 * 60 * 60 * 1000).toISOString();
            const filters = { tenantId, userId: userId || undefined, category, from, to: now.toISOString(), limit: 200 };
            const [summaryData, timelineData, evidenceData, exportData] = await Promise.all([
                fetchAdminOversightSummary(tenantId, userId || undefined, signal),
                userId
                    ? fetchAdminOversightUserTimeline(userId, { tenantId, category, from, to: now.toISOString(), limit: 200 }, signal)
                    : fetchAdminOversightTimeline(filters, signal),
                fetchAdminOversightEvidence(filters, signal),
                fetchAdminOversightExports(tenantId, signal),
            ]);

            if (signal?.aborted) {
                return;
            }

            setSummary(summaryData);
            setTimeline(timelineData || []);
            setEvidence(evidenceData || []);
            setExportsList(exportData || []);
            setError(null);
        } catch (err: any) {
            if (!isRequestAbortError(err, signal)) {
                setError(err?.message || 'Failed to load oversight data');
            }
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        void loadStatic(controller.signal);
        return () => controller.abort();
    }, []);
    useEffect(() => {
        const nextTab = parseTab(searchParams.get('tab'));
        const nextTenant = searchParams.get('tenant');
        const nextUser = searchParams.get('user') || '';
        const tabChanged = nextTab !== tab;
        const userChanged = nextUser !== userId;
        const tenantChanged = nextTenant !== null && nextTenant !== tenantId;
        if (tabChanged) setTab(nextTab);
        if (userChanged) setUserId(nextUser);
        if (tenantChanged) setTenantId(nextTenant || '');
        if (tabChanged || userChanged || tenantChanged) setDetail(null);
    }, [location.search]);
    useEffect(() => {
        const controller = new AbortController();
        void loadOversight(controller.signal);
        return () => controller.abort();
    }, [tenantId, userId, category, range, tab]);

    const copy = async (value: string) => navigator.clipboard.writeText(value).catch(() => setError('Failed to copy text'));
    const createKey = async () => { await createAdminApiKey(keyName); setKeys(await fetchAdminApiKeys()); };
    const removeKey = async (id: string) => { await deleteAdminApiKey(id); setKeys(await fetchAdminApiKeys()); };
    const createCode = async () => {
        const result = await createAgentOnboardingCode({ hostname, ttlMinutes: Number(ttl), maxUses: Number(maxUses) });
        setCreatedCode(result?.data?.onboardingCode || null);
        setCreatedCodeExpireAt(result?.data?.expiresAt || null);
        setCodes(await fetchAgentOnboardingCodes(undefined, 100));
    };
    const revoke = async (agentId: string) => { await revokeAgentCredential(agentId, 'revoked-from-super-admin'); setAgents(await fetchRegisteredAgents()); };
    const verify = async (logId: string) => {
        setIntegrity((state) => ({ ...state, [logId]: 'Verifying...' }));
        const result = await verifyAdminAuditLog(logId);
        setIntegrity((state) => ({ ...state, [logId]: result?.valid ? 'Valid' : 'Failed' }));
    };
    const buildExport = async (targetTenantId: string = tenantId, targetUserId: string = userId) => {
        const result = await createAdminOversightExport({ tenantId: targetTenantId, filters: { userId: targetUserId || undefined, category, range } });
        const record = result?.data || result;
        setExportsList((rows) => [record, ...rows.filter((item) => item.id !== record.id)]);
    };
    const downloadExport = async (record: any, format: 'json' | 'csv') => {
        if (!record) return;
        const detailed = record.jsonPayload && record.csvPayload ? record : await fetchAdminOversightExport(record.id);
        if (format === 'json' && detailed?.jsonPayload) downloadText(`tenant-${detailed.tenantId}.json`, detailed.jsonPayload, 'application/json;charset=utf-8');
        if (format === 'csv' && detailed?.csvPayload) downloadText(`tenant-${detailed.tenantId}.csv`, detailed.csvPayload, 'text/csv;charset=utf-8');
    };

    if (loading) return <div className="p-8 text-muted-foreground">Loading platform admin console...</div>;
    if (!data) return <div className="p-8 text-muted-foreground">Admin console is currently unavailable.</div>;

    const perf = data.performance || {};
    const errors = data.errors || [];

    return (
        <ConsolePage title="Platform Admin Console" subtitle="Tenant oversight, dispute evidence, onboarding credentials, and platform keys in one place.">
            {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ConsoleStatCard icon={Cpu} label="Backend CPU" value={`${perf.server?.cpu?.toFixed?.(1) ?? 'N/A'}%`} hint="Current platform CPU usage" tone="primary" />
                <ConsoleStatCard icon={HardDrive} label="Backend Memory" value={`${perf.server?.memory?.toFixed?.(1) ?? 'N/A'}%`} hint="Current platform memory usage" tone="warning" />
                <ConsoleStatCard icon={Users} label="Online Agents" value={perf.clients?.total_agents ?? 0} hint="Agents currently connected to the control plane" tone="success" />
            </div>

            <ConsolePanel title="Tenant Oversight" subtitle="Admin viewing and exporting are audited for dispute handling." icon={FileSearch} iconTone="warning" headerAction={<button onClick={() => buildExport()} disabled={!tenantId} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Download size={14} />Generate evidence pack</button>}>
                <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_160px_120px]">
                        <select value={tenantId} onChange={(event) => applyOversightView(tab, event.target.value, '')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{tenants.map((tenant) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.tenantName} ({tenant.userCount})</option>)}</select>
                        <select value={userId} onChange={(event) => applyOversightView(tab, tenantId, event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">All users</option>{currentUsers.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select>
                        <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{oversightCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                        <select value={range} onChange={(event) => setRange(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{rangeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                        <div className="flex gap-2">
                            <button onClick={() => void loadOversight()} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted/40">Refresh</button>
                            <Link data-testid="oversight-back-to-users" to="/super-admin" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted/40">Users</Link>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">{([['overview', 'Tenant Overview'], ['timeline', 'Timeline'], ['evidence', 'Evidence'], ['exports', 'Exports']] as Array<[Tab, string]>).map(([value, label]) => <button key={value} data-testid={`oversight-tab-${value}`} onClick={() => applyOversightView(value, tenantId, userId)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${tab === value ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</div>

                    {tab === 'overview' && <>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                            <ConsoleStatCard icon={AlertTriangle} label="Active Alerts" value={summary?.metrics?.activeAlerts ?? 0} hint="Currently unresolved or in-progress alerts" tone="danger" />
                            <ConsoleStatCard icon={ShieldCheck} label="Pending Actions" value={summary?.metrics?.pendingActions ?? 0} hint="Actions still waiting for execution or review" tone="warning" />
                            <ConsoleStatCard icon={Zap} label="Failed Validations" value={summary?.metrics?.failedValidations ?? 0} hint="Recent missed validation outcomes" tone="danger" />
                            <ConsoleStatCard icon={Users} label="Tenant Users" value={summary?.tenant?.userCount ?? 0} hint={`Last activity: ${fmt(summary?.tenant?.lastActiveAt)}`} tone="primary" />
                        </div>
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                            <ConsolePanel title="Tenant Directory" subtitle="Switch tenant context, open its timeline, or export a dispute pack.">
                                <div className="space-y-2">{tenants.map((tenant) => <div key={tenant.tenantId} className={`flex flex-col gap-3 rounded-xl border border-border px-4 py-3 md:flex-row md:items-center md:justify-between ${tenant.tenantId === tenantId ? 'bg-primary/5' : 'bg-muted/10'}`}><div><div className="text-sm font-medium text-foreground">{tenant.tenantName}</div><div className="text-xs text-muted-foreground">{tenant.tenantId} / High alerts {tenant.openHighAlerts} / Last active {fmt(tenant.lastActiveAt)}</div></div><div className="flex gap-2"><button data-testid={`oversight-tenant-timeline-${tenant.tenantId}`} onClick={() => applyOversightView('timeline', tenant.tenantId, '')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">View timeline</button><button onClick={() => buildExport(tenant.tenantId, '')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Export evidence</button></div></div>)}</div>
                            </ConsolePanel>
                            <ConsolePanel title="User Activity Entry Points" subtitle="Drill down from a tenant into a concrete user's activity timeline.">
                                <div className="space-y-2">{currentUsers.length === 0 ? <ConsoleEmptyState title="No users in the selected tenant" description="Switch tenant or open a specific user from the user management page." /> : currentUsers.map((user) => <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 px-4 py-3 md:flex-row md:items-center md:justify-between"><div><div className="text-sm font-medium text-foreground">{user.email}</div><div className="text-xs text-muted-foreground">{user.role} / {user.plan} / {user.status} / Last login {fmt(user.last_login)}</div></div><div className="flex gap-2"><button data-testid={`oversight-user-activity-${user.id}`} onClick={() => applyOversightView('timeline', user.tenant_id, user.id)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">View user activity</button><Link data-testid="oversight-back-to-users" to="/super-admin" className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Back to user management</Link></div></div>)}</div>
                            </ConsolePanel>
                        </div>
                    </>}

                    {tab === 'timeline' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                        <ConsolePanel title={userId ? 'User Activity Timeline' : 'Tenant Activity Timeline'} subtitle="Authentication, scans, alerts, actions, validation, and deployment events in one ordered stream.">
                            <div className="overflow-x-auto"><table data-testid="oversight-timeline-table" className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Details</th></tr></thead><tbody className="divide-y divide-border/50">{timeline.map((item) => <tr key={item.id}><td className="px-3 py-2 text-muted-foreground">{fmt(item.timestamp)}</td><td className="px-3 py-2 text-foreground">{item.category}</td><td className="px-3 py-2 text-foreground">{item.action}</td><td className="px-3 py-2 text-foreground">{item.status}</td><td className="px-3 py-2 text-muted-foreground">{item.actor?.email || item.actor?.id || 'system'}</td><td className="px-3 py-2"><button data-testid="oversight-timeline-detail" onClick={() => setDetail(item)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">View detail</button></td></tr>)}</tbody></table></div>
                        </ConsolePanel>
                        <ConsolePanel title="Event Detail" subtitle="Use this side panel to inspect the selected timeline event.">
                            {detail ? <OversightDetailView item={detail} /> : <ConsoleEmptyState title="Select a timeline event" description="Pick any row from the left table to inspect its details." />}
                        </ConsolePanel>
                    </div>}

                    {tab === 'evidence' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                        <ConsolePanel title="Evidence and Audit Logs" subtitle="Signed audit logs, context objects, and integrity checks for dispute handling.">
                            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Integrity</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-border/50">{evidence.map((item) => <tr key={item.logId}><td className="px-3 py-2 text-muted-foreground">{fmt(item.timestamp)}</td><td className="px-3 py-2 text-foreground">{item.action}</td><td className="px-3 py-2 text-muted-foreground">{item.actor?.email || item.actor?.id || 'system'}</td><td className="px-3 py-2 text-foreground">{item.status}</td><td className="px-3 py-2 text-foreground">{integrity[item.logId] || item.integrity}</td><td className="px-3 py-2"><div className="flex gap-2"><button onClick={() => verify(item.logId)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Verify</button><button onClick={() => setDetail(item)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">View detail</button></div></td></tr>)}</tbody></table></div>
                        </ConsolePanel>
                        <ConsolePanel title="Evidence Detail" subtitle="Raw evidence and audit context for the selected entry.">
                            {detail ? <OversightDetailView item={detail} /> : <ConsoleEmptyState title="Select an evidence row" description="Use the left table to inspect the signed log payload." />}
                        </ConsolePanel>
                    </div>}

                    {tab === 'exports' && <ConsolePanel title="Export History" subtitle="Every export retains the operator, time window, and the active filters.">{exportsList.length === 0 ? <ConsoleEmptyState title="No exports yet" description="Use the evidence pack button above to generate a tenant dispute bundle." /> : <div className="space-y-3">{exportsList.map((record) => <div key={record.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-sm font-medium text-foreground">{record.id}</div><div className="mt-1 text-xs text-muted-foreground">Tenant {record.tenantId} / {record.requestedBy} / {fmt(record.requestedAt)}</div></div><div className="flex gap-2"><button onClick={() => downloadExport(record, 'json')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Download JSON</button><button onClick={() => downloadExport(record, 'csv')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Download CSV</button></div></div>)}</div>}</ConsolePanel>}
                </div>
            </ConsolePanel>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <ConsolePanel title="Agent Onboarding" subtitle="Generate onboarding codes and keep registration and revocation history visible." icon={ShieldCheck} iconTone="primary" headerAction={<button onClick={() => void loadStatic()} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"><RefreshCw size={14} />Refresh</button>}>
                    <div className="space-y-5">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="Expected hostname" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /><input value={ttl} onChange={(event) => setTtl(event.target.value)} placeholder="TTL (minutes)" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /><input value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="Max uses" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /><button onClick={createCode} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Generate code</button></div>
                        {createdCode && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4"><div className="text-xs text-emerald-300">One-time onboarding code</div><div className="mt-2 flex items-center gap-2"><code className="break-all text-sm text-emerald-200">{createdCode}</code><button onClick={() => copy(createdCode)} className="rounded-md p-1.5 text-emerald-200 hover:bg-emerald-500/20"><Copy size={14} /></button></div><div className="mt-2 text-[11px] text-emerald-300/80">Expires at {fmt(createdCodeExpireAt)}</div></div>}
                        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Status</th><th className="px-3 py-2">Hostname</th><th className="px-3 py-2">Uses</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2">Agent</th></tr></thead><tbody className="divide-y divide-border/50">{codes.map((code) => <tr key={code.id}><td className="px-3 py-2 text-foreground">{statusLabel[code.status]}</td><td className="px-3 py-2 text-foreground">{code.expectedHostname || '-'}</td><td className="px-3 py-2 text-foreground">{code.usedCount}/{code.maxUses}</td><td className="px-3 py-2 text-muted-foreground">{fmt(code.expiresAt)}</td><td className="px-3 py-2 font-mono text-muted-foreground">{code.usedByAgentId || '-'}</td></tr>)}</tbody></table></div>
                        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Agent ID</th><th className="px-3 py-2">Hostname</th><th className="px-3 py-2">Platform</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Action</th></tr></thead><tbody className="divide-y divide-border/50">{agents.map((agent) => <tr key={agent.agentId}><td className="px-3 py-2 font-mono text-foreground">{agent.agentId}</td><td className="px-3 py-2 text-foreground">{agent.hostname}</td><td className="px-3 py-2 text-foreground">{agent.platform}</td><td className="px-3 py-2 text-foreground">{statusLabel[agent.status]}</td><td className="px-3 py-2"><button onClick={() => revoke(agent.agentId)} disabled={agent.status === 'revoked'} className="rounded-md bg-rose-600/90 px-2 py-1 text-xs text-white disabled:opacity-50">Revoke</button></td></tr>)}</tbody></table></div>
                    </div>
                </ConsolePanel>

                <div className="space-y-6">
                    <ConsolePanel title="Admin API Keys" subtitle="Platform automation and emergency operations credentials." icon={Key} iconTone="warning" headerAction={<button onClick={createKey} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"><Plus size={14} />Create key</button>}>
                        <div className="space-y-3"><input value={keyName} onChange={(event) => setKeyName(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder="Key name" />{keys.length === 0 ? <ConsoleEmptyState title="No admin API keys" description="Create a key to expose platform automation access." /> : keys.map((key) => <div key={key.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-medium text-foreground">{key.name}</div><div className="font-mono text-xs text-muted-foreground">{key.prefix}**************</div></div><div className="flex gap-1"><button onClick={() => copy(`${key.prefix}**************`)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Copy size={14} /></button><button onClick={() => removeKey(key.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={14} /></button></div></div><div className="text-xs text-muted-foreground">Created {fmt(key.created)} / Last used {key.lastUsed}</div></div>)}</div>
                    </ConsolePanel>
                    <ConsolePanel title="Recent Errors" subtitle="High-frequency failures help separate product disputes from platform instability." icon={AlertTriangle} iconTone="danger"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">User</th><th className="px-3 py-2">Error Code</th><th className="px-3 py-2">Message</th><th className="px-3 py-2">Time</th></tr></thead><tbody className="divide-y divide-border/50">{errors.map((item: any, index: number) => <tr key={`${item.userId}-${index}`}><td className="px-3 py-2 font-mono text-foreground">{item.userId}</td><td className="px-3 py-2"><span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{item.errorCode}</span></td><td className="px-3 py-2 text-rose-300">{item.message}</td><td className="px-3 py-2 text-muted-foreground">{fmt(item.timestamp)}</td></tr>)}</tbody></table></div></ConsolePanel>
                    <ConsolePanel title="Endpoint Performance" subtitle="Use these numbers to separate policy issues from platform overhead." icon={Zap} iconTone="success"><div className="grid grid-cols-2 gap-4"><div className="rounded-xl border border-border bg-muted/10 p-4"><div className="text-xs text-muted-foreground">Average CPU overhead</div><div className="mt-2 text-2xl font-semibold text-foreground">{perf.clients?.avg_cpu_overhead ?? 'N/A'}%</div></div><div className="rounded-xl border border-border bg-muted/10 p-4"><div className="text-xs text-muted-foreground">Average added latency</div><div className="mt-2 text-2xl font-semibold text-foreground">{perf.clients?.avg_latency_added ?? 'N/A'}</div></div></div></ConsolePanel>
                </div>
            </div>
        </ConsolePage>
    );
}
