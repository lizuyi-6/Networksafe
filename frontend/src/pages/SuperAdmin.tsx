import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Copy, Cpu, Download, FileSearch, HardDrive, Key, Plus, RefreshCw, ShieldCheck, Trash2, Users, Zap, Megaphone, Edit2, Send, Archive } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
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
    fetchAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    publishAnnouncement,
    archiveAnnouncement,
} from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import StructuredDataView from '../components/StructuredDataView';

type Tab = 'overview' | 'timeline' | 'evidence' | 'exports' | 'announcements';
type ApiKey = { id: string; name: string; prefix: string; created: string; lastUsed: string };
type CodeRow = { id: string; status: 'active' | 'used' | 'expired' | 'revoked'; expectedHostname: string | null; maxUses: number; usedCount: number; expiresAt: string; usedByAgentId: string | null };
type AgentRow = { agentId: string; hostname: string; platform: string; status: 'pending' | 'approved' | 'revoked' };
type AnnouncementRow = { id: string; title: string; content: string; type: string; status: string; published_at: string | null; expires_at: string | null; created_at: string; created_by_email?: string };

const parseTab = (value: string | null): Tab => (value === 'timeline' || value === 'evidence' || value === 'exports' || value === 'announcements' ? value : 'overview');
const fmt = (value?: string | null, t?: (key: string) => string) => {
    if (!value) return t ? t('superAdmin.not_available') : 'Not available';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};
const statusLabelKeys: Record<string, string> = { active: 'superAdmin.status_active', used: 'superAdmin.status_used', expired: 'superAdmin.status_expired', revoked: 'superAdmin.status_revoked', pending: 'superAdmin.status_pending', approved: 'superAdmin.status_approved' };
const oversightCategoryKeys = [['all', 'superAdmin.category_all'], ['auth', 'superAdmin.category_auth'], ['system', 'superAdmin.category_system'], ['scanner', 'superAdmin.category_scanner'], ['alert', 'superAdmin.category_alert'], ['action', 'superAdmin.category_action'], ['validation', 'superAdmin.category_validation'], ['deployment', 'superAdmin.category_deployment']] as const;
const rangeOptionKeys = [['1', 'superAdmin.range_24h'], ['7', 'superAdmin.range_7d'], ['30', 'superAdmin.range_30d'], ['90', 'superAdmin.range_90d']] as const;

const downloadText = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};

const OversightDetailView = ({ item, t }: { item: any; t: (key: string) => string }) => {
    if (!item) {
        return null;
    }

    return (
        <div className="space-y-4" data-testid="oversight-detail-panel">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('superAdmin.detail_time')}</div>
                    <div className="mt-2 text-sm text-foreground">{fmt(item.timestamp || item.requestedAt || item.createdAt, t)}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('superAdmin.detail_status')}</div>
                    <div className="mt-2 text-sm text-foreground">{item.status || item.integrity || t('superAdmin.not_available')}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('superAdmin.detail_category')}</div>
                    <div className="mt-2 text-sm text-foreground">{item.category || t('superAdmin.not_available')}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('superAdmin.detail_action')}</div>
                    <div className="mt-2 text-sm text-foreground">{item.action || item.id || t('superAdmin.not_available')}</div>
                </div>
            </div>

            {item.actor ? (
                <div className="rounded-lg border border-border bg-muted/10 p-4">
                    <div className="mb-3 text-sm font-medium text-foreground">{t('superAdmin.detail_actor')}</div>
                    <StructuredDataView value={item.actor} emptyLabel={t('superAdmin.actor_unavailable')} />
                </div>
            ) : null}

            {item.target ? (
                <div className="rounded-lg border border-border bg-muted/10 p-4">
                    <div className="mb-3 text-sm font-medium text-foreground">{t('superAdmin.detail_target')}</div>
                    <StructuredDataView value={item.target} emptyLabel={t('superAdmin.target_unavailable')} />
                </div>
            ) : null}

            <div className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="mb-3 text-sm font-medium text-foreground">{t('superAdmin.detail_details')}</div>
                <StructuredDataView value={item.details || item} emptyLabel={t('superAdmin.no_detail_payload')} />
            </div>
        </div>
    );
};

export default function SuperAdmin() {
    const { t } = useLanguage();
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

    // Announcements state
    const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
    const [editingAnnouncement, setEditingAnnouncement] = useState<AnnouncementRow | null>(null);
    const [announcementForm, setAnnouncementForm] = useState({ title: '', content: '', type: 'info', expiresAt: '' });

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
                setError(err?.message || t('superAdmin.error_load_admin'));
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
                setError(err?.message || t('superAdmin.error_load_oversight'));
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

    // Load announcements when tab is announcements
    useEffect(() => {
        if (tab !== 'announcements') return;
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetchAnnouncements(controller.signal);
                setAnnouncements(res || []);
            } catch (e) {
                if (!isRequestAbortError(e, controller.signal)) {
                    setError(t('announcement.load_failed'));
                }
            }
        })();
        return () => controller.abort();
    }, [tab]);

    const copy = async (value: string) => navigator.clipboard.writeText(value).catch(() => setError(t('superAdmin.error_copy')));
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
        setIntegrity((state) => ({ ...state, [logId]: t('superAdmin.verifying') }));
        const result = await verifyAdminAuditLog(logId);
        setIntegrity((state) => ({ ...state, [logId]: result?.valid ? t('superAdmin.valid') : t('superAdmin.failed') }));
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

    if (loading) return <div className="p-8 text-muted-foreground">{t('superAdmin.loading')}</div>;
    if (!data) return <div className="p-8 text-muted-foreground">{t('superAdmin.unavailable')}</div>;

    const perf = data.performance || {};
    const errors = data.errors || [];

    return (
        <ConsolePage title={t('superAdmin.page_title')} subtitle={t('superAdmin.page_subtitle')}>
            {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ConsoleStatCard icon={Cpu} label={t('superAdmin.backend_cpu')} value={`${perf.server?.cpu?.toFixed?.(1) ?? 'N/A'}%`} hint={t('superAdmin.cpu_hint')} tone="primary" />
                <ConsoleStatCard icon={HardDrive} label={t('superAdmin.backend_memory')} value={`${perf.server?.memory?.toFixed?.(1) ?? 'N/A'}%`} hint={t('superAdmin.memory_hint')} tone="warning" />
                <ConsoleStatCard icon={Users} label={t('superAdmin.online_agents')} value={perf.clients?.total_agents ?? 0} hint={t('superAdmin.agents_hint')} tone="success" />
            </div>

            <ConsolePanel title={t('superAdmin.tenant_oversight')} subtitle={t('superAdmin.tenant_oversight_subtitle')} icon={FileSearch} iconTone="warning" headerAction={<button onClick={() => buildExport()} disabled={!tenantId} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Download size={14} />{t('superAdmin.generate_evidence_pack')}</button>}>
                <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_160px_120px]">
                        <select value={tenantId} onChange={(event) => applyOversightView(tab, event.target.value, '')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{tenants.map((tenant) => <option key={tenant.tenantId} value={tenant.tenantId}>{tenant.tenantName} ({tenant.userCount})</option>)}</select>
                        <select value={userId} onChange={(event) => applyOversightView(tab, tenantId, event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">{t('superAdmin.all_users')}</option>{currentUsers.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select>
                        <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{oversightCategoryKeys.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select>
                        <select value={range} onChange={(event) => setRange(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{rangeOptionKeys.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select>
                        <div className="flex gap-2">
                            <button onClick={() => void loadOversight()} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted/40">{t('superAdmin.refresh')}</button>
                            <Link data-testid="oversight-back-to-users" to="/super-admin" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted/40">{t('superAdmin.users')}</Link>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">{([['overview', t('superAdmin.tab_overview')], ['timeline', t('superAdmin.tab_timeline')], ['evidence', t('superAdmin.tab_evidence')], ['exports', t('superAdmin.tab_exports')], ['announcements', t('superAdmin.tab_announcements')]] as Array<[Tab, string]>).map(([value, label]) => <button key={value} data-testid={`oversight-tab-${value}`} onClick={() => applyOversightView(value, tenantId, userId)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${tab === value ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</div>

                    {tab === 'overview' && <>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                            <ConsoleStatCard icon={AlertTriangle} label={t('superAdmin.active_alerts')} value={summary?.metrics?.activeAlerts ?? 0} hint={t('superAdmin.active_alerts_hint')} tone="danger" />
                            <ConsoleStatCard icon={ShieldCheck} label={t('superAdmin.pending_actions')} value={summary?.metrics?.pendingActions ?? 0} hint={t('superAdmin.pending_actions_hint')} tone="warning" />
                            <ConsoleStatCard icon={Zap} label={t('superAdmin.failed_validations')} value={summary?.metrics?.failedValidations ?? 0} hint={t('superAdmin.failed_validations_hint')} tone="danger" />
                            <ConsoleStatCard icon={Users} label={t('superAdmin.tenant_users')} value={summary?.tenant?.userCount ?? 0} hint={t('superAdmin.last_activity') + ': ' + fmt(summary?.tenant?.lastActiveAt, t)} tone="primary" />
                        </div>
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                            <ConsolePanel title={t('superAdmin.tenant_directory')} subtitle={t('superAdmin.tenant_directory_subtitle')}>
                                <div className="space-y-2">{tenants.map((tenant) => <div key={tenant.tenantId} className={`flex flex-col gap-3 rounded-xl border border-border px-4 py-3 md:flex-row md:items-center md:justify-between ${tenant.tenantId === tenantId ? 'bg-primary/5' : 'bg-muted/10'}`}><div><div className="text-sm font-medium text-foreground">{tenant.tenantName}</div><div className="text-xs text-muted-foreground">{tenant.tenantId} / {t('superAdmin.high_alerts')} {tenant.openHighAlerts} / {t('superAdmin.last_active')} {fmt(tenant.lastActiveAt, t)}</div></div><div className="flex gap-2"><button data-testid={`oversight-tenant-timeline-${tenant.tenantId}`} onClick={() => applyOversightView('timeline', tenant.tenantId, '')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.view_timeline')}</button><button onClick={() => buildExport(tenant.tenantId, '')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.export_evidence')}</button></div></div>)}</div>
                            </ConsolePanel>
                            <ConsolePanel title={t('superAdmin.user_activity_entry')} subtitle={t('superAdmin.user_activity_subtitle')}>
                                <div className="space-y-2">{currentUsers.length === 0 ? <ConsoleEmptyState title={t('superAdmin.no_users_tenant')} description={t('superAdmin.no_users_tenant_desc')} /> : currentUsers.map((user) => <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 px-4 py-3 md:flex-row md:items-center md:justify-between"><div><div className="text-sm font-medium text-foreground">{user.email}</div><div className="text-xs text-muted-foreground">{user.role} / {user.plan} / {user.status} / {t('superAdmin.last_login')} {fmt(user.last_login, t)}</div></div><div className="flex gap-2"><button data-testid={`oversight-user-activity-${user.id}`} onClick={() => applyOversightView('timeline', user.tenant_id, user.id)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.view_user_activity')}</button><Link data-testid="oversight-back-to-users" to="/super-admin" className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.back_to_user_mgmt')}</Link></div></div>)}</div>
                            </ConsolePanel>
                        </div>
                    </>}

                    {tab === 'timeline' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                        <ConsolePanel title={userId ? t('superAdmin.user_activity_timeline') : t('superAdmin.tenant_activity_timeline')} subtitle={t('superAdmin.timeline_subtitle')}>
                            <div className="overflow-x-auto"><table data-testid="oversight-timeline-table" className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">{t('superAdmin.col_time')}</th><th className="px-3 py-2">{t('superAdmin.col_category')}</th><th className="px-3 py-2">{t('superAdmin.col_action')}</th><th className="px-3 py-2">{t('superAdmin.col_status')}</th><th className="px-3 py-2">{t('superAdmin.col_actor')}</th><th className="px-3 py-2">{t('superAdmin.col_details')}</th></tr></thead><tbody className="divide-y divide-border/50">{timeline.map((item) => <tr key={item.id}><td className="px-3 py-2 text-muted-foreground">{fmt(item.timestamp, t)}</td><td className="px-3 py-2 text-foreground">{item.category}</td><td className="px-3 py-2 text-foreground">{item.action}</td><td className="px-3 py-2 text-foreground">{item.status}</td><td className="px-3 py-2 text-muted-foreground">{item.actor?.email || item.actor?.id || t('superAdmin.system')}</td><td className="px-3 py-2"><button data-testid="oversight-timeline-detail" onClick={() => setDetail(item)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.view_detail')}</button></td></tr>)}</tbody></table></div>
                        </ConsolePanel>
                        <ConsolePanel title={t('superAdmin.event_detail')} subtitle={t('superAdmin.event_detail_subtitle')}>
                            {detail ? <OversightDetailView item={detail} t={t} /> : <ConsoleEmptyState title={t('superAdmin.select_timeline_event')} description={t('superAdmin.select_timeline_event_desc')} />}
                        </ConsolePanel>
                    </div>}

                    {tab === 'evidence' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
                        <ConsolePanel title={t('superAdmin.evidence_audit_logs')} subtitle={t('superAdmin.evidence_subtitle')}>
                            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">{t('superAdmin.col_time')}</th><th className="px-3 py-2">{t('superAdmin.col_action')}</th><th className="px-3 py-2">{t('superAdmin.col_actor')}</th><th className="px-3 py-2">{t('superAdmin.col_status')}</th><th className="px-3 py-2">{t('superAdmin.col_integrity')}</th><th className="px-3 py-2">{t('superAdmin.col_actions')}</th></tr></thead><tbody className="divide-y divide-border/50">{evidence.map((item) => <tr key={item.logId}><td className="px-3 py-2 text-muted-foreground">{fmt(item.timestamp, t)}</td><td className="px-3 py-2 text-foreground">{item.action}</td><td className="px-3 py-2 text-muted-foreground">{item.actor?.email || item.actor?.id || t('superAdmin.system')}</td><td className="px-3 py-2 text-foreground">{item.status}</td><td className="px-3 py-2 text-foreground">{integrity[item.logId] || item.integrity}</td><td className="px-3 py-2"><div className="flex gap-2"><button onClick={() => verify(item.logId)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.verify')}</button><button onClick={() => setDetail(item)} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.view_detail')}</button></div></td></tr>)}</tbody></table></div>
                        </ConsolePanel>
                        <ConsolePanel title={t('superAdmin.evidence_detail')} subtitle={t('superAdmin.evidence_detail_subtitle')}>
                            {detail ? <OversightDetailView item={detail} t={t} /> : <ConsoleEmptyState title={t('superAdmin.select_evidence_row')} description={t('superAdmin.select_evidence_desc')} />}
                        </ConsolePanel>
                    </div>}

                    {tab === 'exports' && <ConsolePanel title={t('superAdmin.export_history')} subtitle={t('superAdmin.export_history_subtitle')}>{exportsList.length === 0 ? <ConsoleEmptyState title={t('superAdmin.no_exports')} description={t('superAdmin.no_exports_desc')} /> : <div className="space-y-3">{exportsList.map((record) => <div key={record.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-sm font-medium text-foreground">{record.id}</div><div className="mt-1 text-xs text-muted-foreground">{t('superAdmin.tenant')} {record.tenantId} / {record.requestedBy} / {fmt(record.requestedAt, t)}</div></div><div className="flex gap-2"><button onClick={() => downloadExport(record, 'json')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.download_json')}</button><button onClick={() => downloadExport(record, 'csv')} className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">{t('superAdmin.download_csv')}</button></div></div>)}</div>}</ConsolePanel>}

                    {tab === 'announcements' && <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <ConsolePanel title={t('announcement.list_title')} subtitle={t('announcement.list_subtitle')} icon={Megaphone} iconTone="primary" headerAction={<button onClick={() => { setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', type: 'info', expiresAt: '' }); }} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"><Plus size={14} />{t('announcement.create')}</button>}>
                            {announcements.length === 0 ? <ConsoleEmptyState title={t('announcement.no_announcements')} description={t('announcement.no_announcements_desc')} /> : <div className="space-y-3">{announcements.map((a) => <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${a.type === 'critical' ? 'bg-red-500/20 text-red-400' : a.type === 'warning' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'}`}>{a.type}</span><span className={`px-2 py-0.5 rounded text-xs font-medium ${a.status === 'published' ? 'bg-emerald-500/20 text-emerald-400' : a.status === 'archived' ? 'bg-gray-500/20 text-gray-400' : 'bg-muted text-muted-foreground'}`}>{a.status}</span></div><div className="mt-1 text-sm font-medium text-foreground">{a.title}</div><div className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.content}</div></div><div className="flex gap-1"><button onClick={() => { setEditingAnnouncement(a); setAnnouncementForm({ title: a.title, content: a.content, type: a.type, expiresAt: a.expires_at || '' }); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Edit2 size={14} /></button>{a.status === 'draft' && <button onClick={async () => { await publishAnnouncement(a.id); const res = await fetchAnnouncements(); setAnnouncements(res || []); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"><Send size={14} /></button>}{a.status === 'published' && <button onClick={async () => { await archiveAnnouncement(a.id); const res = await fetchAnnouncements(); setAnnouncements(res || []); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Archive size={14} /></button>}<button onClick={async () => { await deleteAnnouncement(a.id); const res = await fetchAnnouncements(); setAnnouncements(res || []); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={14} /></button></div></div><div className="text-xs text-muted-foreground">{t('announcement.created')} {fmt(a.created_at, t)} / {a.published_at ? `${t('announcement.published')} ${fmt(a.published_at, t)}` : ''} / {a.expires_at ? `${t('announcement.expires')} ${fmt(a.expires_at, t)}` : ''}</div></div>)}</div>}
                        </ConsolePanel>
                        <ConsolePanel title={editingAnnouncement ? t('announcement.edit_title') : t('announcement.create_title')} subtitle={editingAnnouncement ? t('announcement.edit_subtitle') : t('announcement.create_subtitle')}>
                            <div className="space-y-4">
                                <div><label className="text-xs text-muted-foreground">{t('announcement.title_label')}</label><input value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder={t('announcement.title_placeholder')} /></div>
                                <div><label className="text-xs text-muted-foreground">{t('announcement.content_label')}</label><textarea value={announcementForm.content} onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground min-h-[100px]" placeholder={t('announcement.content_placeholder')} /></div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="text-xs text-muted-foreground">{t('announcement.type_label')}</label><select value={announcementForm.type} onChange={(e) => setAnnouncementForm({ ...announcementForm, type: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="info">{t('announcement.type_info')}</option><option value="warning">{t('announcement.type_warning')}</option><option value="critical">{t('announcement.type_critical')}</option></select></div>
                                    <div><label className="text-xs text-muted-foreground">{t('announcement.expires_label')}</label><input type="datetime-local" value={announcementForm.expiresAt} onChange={(e) => setAnnouncementForm({ ...announcementForm, expiresAt: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /></div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={async () => { if (!announcementForm.title || !announcementForm.content) return; if (editingAnnouncement) { await updateAnnouncement(editingAnnouncement.id, announcementForm); } else { await createAnnouncement(announcementForm); } const res = await fetchAnnouncements(); setAnnouncements(res || []); setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', type: 'info', expiresAt: '' }); }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{editingAnnouncement ? t('announcement.update') : t('announcement.create')}</button>
                                    {editingAnnouncement && <button onClick={() => { setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', type: 'info', expiresAt: '' }); }} className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground">{t('announcement.cancel')}</button>}
                                </div>
                            </div>
                        </ConsolePanel>
                    </div>}
                </div>
            </ConsolePanel>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <ConsolePanel title={t('superAdmin.agent_onboarding')} subtitle={t('superAdmin.agent_onboarding_subtitle')} icon={ShieldCheck} iconTone="primary" headerAction={<button onClick={() => void loadStatic()} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"><RefreshCw size={14} />{t('superAdmin.refresh')}</button>}>
                    <div className="space-y-5">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder={t('superAdmin.expected_hostname')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /><input value={ttl} onChange={(event) => setTtl(event.target.value)} placeholder={t('superAdmin.ttl_minutes')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /><input value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder={t('superAdmin.max_uses')} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /><button onClick={createCode} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{t('superAdmin.generate_code')}</button></div>
                        {createdCode && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4"><div className="text-xs text-emerald-300">{t('superAdmin.onboarding_code')}</div><div className="mt-2 flex items-center gap-2"><code className="break-all text-sm text-emerald-200">{createdCode}</code><button onClick={() => copy(createdCode)} className="rounded-md p-1.5 text-emerald-200 hover:bg-emerald-500/20"><Copy size={14} /></button></div><div className="mt-2 text-[11px] text-emerald-300/80">{t('superAdmin.expires_at')} {fmt(createdCodeExpireAt, t)}</div></div>}
                        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">{t('superAdmin.col_status')}</th><th className="px-3 py-2">{t('superAdmin.col_hostname')}</th><th className="px-3 py-2">{t('superAdmin.col_uses')}</th><th className="px-3 py-2">{t('superAdmin.col_expires')}</th><th className="px-3 py-2">{t('superAdmin.col_agent')}</th></tr></thead><tbody className="divide-y divide-border/50">{codes.map((code) => <tr key={code.id}><td className="px-3 py-2 text-foreground">{t(statusLabelKeys[code.status])}</td><td className="px-3 py-2 text-foreground">{code.expectedHostname || '-'}</td><td className="px-3 py-2 text-foreground">{code.usedCount}/{code.maxUses}</td><td className="px-3 py-2 text-muted-foreground">{fmt(code.expiresAt, t)}</td><td className="px-3 py-2 font-mono text-muted-foreground">{code.usedByAgentId || '-'}</td></tr>)}</tbody></table></div>
                        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">{t('superAdmin.col_agent_id')}</th><th className="px-3 py-2">{t('superAdmin.col_hostname')}</th><th className="px-3 py-2">{t('superAdmin.col_platform')}</th><th className="px-3 py-2">{t('superAdmin.col_status')}</th><th className="px-3 py-2">{t('superAdmin.col_action')}</th></tr></thead><tbody className="divide-y divide-border/50">{agents.map((agent) => <tr key={agent.agentId}><td className="px-3 py-2 font-mono text-foreground">{agent.agentId}</td><td className="px-3 py-2 text-foreground">{agent.hostname}</td><td className="px-3 py-2 text-foreground">{agent.platform}</td><td className="px-3 py-2 text-foreground">{t(statusLabelKeys[agent.status])}</td><td className="px-3 py-2"><button onClick={() => revoke(agent.agentId)} disabled={agent.status === 'revoked'} className="rounded-md bg-rose-600/90 px-2 py-1 text-xs text-white disabled:opacity-50">{t('superAdmin.revoke')}</button></td></tr>)}</tbody></table></div>
                    </div>
                </ConsolePanel>

                <div className="space-y-6">
                    <ConsolePanel title={t('superAdmin.admin_api_keys')} subtitle={t('superAdmin.admin_api_keys_subtitle')} icon={Key} iconTone="warning" headerAction={<button onClick={createKey} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"><Plus size={14} />{t('superAdmin.create_key')}</button>}>
                        <div className="space-y-3"><input value={keyName} onChange={(event) => setKeyName(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" placeholder={t('superAdmin.key_name')} />{keys.length === 0 ? <ConsoleEmptyState title={t('superAdmin.no_api_keys')} description={t('superAdmin.no_api_keys_desc')} /> : keys.map((key) => <div key={key.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-medium text-foreground">{key.name}</div><div className="font-mono text-xs text-muted-foreground">{key.prefix}**************</div></div><div className="flex gap-1"><button onClick={() => copy(`${key.prefix}**************`)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Copy size={14} /></button><button onClick={() => removeKey(key.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={14} /></button></div></div><div className="text-xs text-muted-foreground">{t('superAdmin.created')} {fmt(key.created, t)} / {t('superAdmin.last_used')} {key.lastUsed}</div></div>)}</div>
                    </ConsolePanel>
                    <ConsolePanel title={t('superAdmin.recent_errors')} subtitle={t('superAdmin.recent_errors_subtitle')} icon={AlertTriangle} iconTone="danger"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">{t('superAdmin.col_user')}</th><th className="px-3 py-2">{t('superAdmin.col_error_code')}</th><th className="px-3 py-2">{t('superAdmin.col_message')}</th><th className="px-3 py-2">{t('superAdmin.col_time')}</th></tr></thead><tbody className="divide-y divide-border/50">{errors.map((item: any, index: number) => <tr key={`${item.userId}-${index}`}><td className="px-3 py-2 font-mono text-foreground">{item.userId}</td><td className="px-3 py-2"><span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{item.errorCode}</span></td><td className="px-3 py-2 text-rose-300">{item.message}</td><td className="px-3 py-2 text-muted-foreground">{fmt(item.timestamp, t)}</td></tr>)}</tbody></table></div></ConsolePanel>
                    <ConsolePanel title={t('superAdmin.endpoint_performance')} subtitle={t('superAdmin.endpoint_performance_subtitle')} icon={Zap} iconTone="success"><div className="grid grid-cols-2 gap-4"><div className="rounded-xl border border-border bg-muted/10 p-4"><div className="text-xs text-muted-foreground">{t('superAdmin.avg_cpu_overhead')}</div><div className="mt-2 text-2xl font-semibold text-foreground">{perf.clients?.avg_cpu_overhead ?? 'N/A'}%</div></div><div className="rounded-xl border border-border bg-muted/10 p-4"><div className="text-xs text-muted-foreground">{t('superAdmin.avg_added_latency')}</div><div className="mt-2 text-2xl font-semibold text-foreground">{perf.clients?.avg_latency_added ?? 'N/A'}</div></div></div></ConsolePanel>
                </div>
            </div>
        </ConsolePage>
    );
}
