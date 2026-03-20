import { useEffect, useState } from 'react';
import { Bell, BrainCircuit, Loader2, Plus, Save, Send, Settings2, Trash2, Waypoints } from 'lucide-react';
import { ConsolePanel } from './ConsolePrimitives';
import {
    NotificationChannelConfig,
    NotificationDelivery,
    PlatformConfigResponse,
    DeploymentTarget,
    fetchAIEndpoints,
    fetchNotificationDeliveries,
    fetchPlatformConfig,
    savePlatformConfig,
    testNotificationChannel
} from '../services/api';

type EndpointOption = { id: string; name: string; modelName: string; purpose?: 'hot_path' | 'deep_analysis' };

const targets: DeploymentTarget[] = ['nginx', 'apache', 'caddy', 'docker_compose', 'binary_agent', 'k8s_daemonset'];
const inputClassName = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none';
const labelClassName = 'mb-1 block text-xs font-medium text-muted-foreground';

const makeChannel = (): NotificationChannelConfig => ({
    id: `channel-${Date.now()}`,
    name: 'New channel',
    type: 'generic_webhook',
    enabled: true,
    target: '',
    minimumSeverity: 'high',
    headers: {},
    smtp: { host: '', port: 587, secure: false, username: '', password: '', from: '' }
});

const PlatformCapabilitySettings = ({ endpointVersion = 0 }: { endpointVersion?: number }) => {
    const [config, setConfig] = useState<PlatformConfigResponse | null>(null);
    const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
    const [endpoints, setEndpoints] = useState<EndpointOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const [configData, deliveryData, endpointData] = await Promise.all([
                fetchPlatformConfig(),
                fetchNotificationDeliveries(12),
                fetchAIEndpoints()
            ]);
            setConfig(configData);
            setDeliveries(deliveryData);
            setEndpoints((endpointData || []).map((endpoint: any) => ({
                id: endpoint.id,
                name: endpoint.name,
                modelName: endpoint.modelName,
                purpose: endpoint.purpose
            })));
        } catch (e: any) {
            setError(e.message || 'FG-PLATFORM-CONTROL-LOAD');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [endpointVersion]);

    const updateConfig = (updater: (current: PlatformConfigResponse) => PlatformConfigResponse) => {
        setConfig((current) => (current ? updater(current) : current));
    };

    const updateChannel = (channelId: string, updater: (channel: NotificationChannelConfig) => NotificationChannelConfig) => {
        updateConfig((current) => ({
            ...current,
            notifications: {
                ...current.notifications,
                channels: current.notifications.channels.map((channel) => channel.id === channelId ? updater(channel) : channel)
            }
        }));
    };

    const handleSave = async () => {
        if (!config) {
            return;
        }
        setSaving(true);
        setError(null);
        setStatus(null);
        try {
            await savePlatformConfig(config);
            setStatus('Configuration saved');
            await load();
        } catch (e: any) {
            setError(e.message || 'FG-PLATFORM-CONTROL-SAVE');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async (channelId: string) => {
        setTestingChannelId(channelId);
        setError(null);
        setStatus(null);
        try {
            await testNotificationChannel(channelId);
            setStatus('Notification test sent');
            setDeliveries(await fetchNotificationDeliveries(12));
        } catch (e: any) {
            setError(e.message || 'FG-PLATFORM-CONTROL-TEST');
        } finally {
            setTestingChannelId(null);
        }
    };

    if (loading || !config) {
        return (
            <ConsolePanel title="Platform Control" subtitle="Loading control-plane settings" icon={Settings2} iconTone="primary">
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <Loader2 size={18} className="mr-2 animate-spin" />
                    Loading platform settings...
                </div>
            </ConsolePanel>
        );
    }

    const currentTemplate = config.deploymentDefaults.profileTemplates[config.deploymentDefaults.serverType];

    return (
        <div className="space-y-6">
            {(error || status) && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${error
                    ? 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    }`}>
                    {error || status}
                </div>
            )}

            <ConsolePanel
                title="Platform Control"
                subtitle="Guardrails, AI routing, deployment defaults and device gateway"
                icon={Settings2}
                iconTone="primary"
                headerAction={(
                    <button
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save
                    </button>
                )}
            >
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 text-sm font-semibold text-foreground">Traffic Guardrails</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Anti-bot enabled</label>
                                <select
                                    value={config.antiBot.enabled ? 'true' : 'false'}
                                    onChange={(event) => updateConfig((current) => ({ ...current, antiBot: { ...current.antiBot, enabled: event.target.value === 'true' } }))}
                                    className={inputClassName}
                                >
                                    <option value="true">Enabled</option>
                                    <option value="false">Disabled</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Requests per minute</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.rateLimit.requestsPerMinute}
                                    onChange={(event) => updateConfig((current) => ({ ...current, rateLimit: { ...current.rateLimit, requestsPerMinute: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Request threshold</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.antiBot.requestThreshold}
                                    onChange={(event) => updateConfig((current) => ({ ...current, antiBot: { ...current.antiBot, requestThreshold: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Fast request threshold</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.antiBot.fastRequestThreshold}
                                    onChange={(event) => updateConfig((current) => ({ ...current, antiBot: { ...current.antiBot, fastRequestThreshold: Number(event.target.value || 0) } }))}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                            <BrainCircuit size={16} className="text-primary" />
                            AI Routing
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Routing mode</label>
                                <select
                                    value={config.aiRouting.mode}
                                    onChange={(event) => updateConfig((current) => ({ ...current, aiRouting: { ...current.aiRouting, mode: event.target.value as PlatformConfigResponse['aiRouting']['mode'] } }))}
                                    className={inputClassName}
                                >
                                    <option value="cloud_only">cloud_only</option>
                                    <option value="local_preferred">local_preferred</option>
                                    <option value="local_only">local_only</option>
                                    <option value="hybrid_verify">hybrid_verify</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Privacy mode</label>
                                <select
                                    value={config.privacyMode}
                                    onChange={(event) => updateConfig((current) => ({ ...current, privacyMode: event.target.value as PlatformConfigResponse['privacyMode'] }))}
                                    className={inputClassName}
                                >
                                    <option value="off">off</option>
                                    <option value="strict">strict</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Local endpoint</label>
                                <select
                                    value={config.aiRouting.localEndpointId || ''}
                                    onChange={(event) => updateConfig((current) => ({ ...current, aiRouting: { ...current.aiRouting, localEndpointId: event.target.value || null } }))}
                                    className={inputClassName}
                                >
                                    <option value="">Not selected</option>
                                    {endpoints.map((endpoint) => (
                                        <option key={endpoint.id} value={endpoint.id}>{endpoint.name} ({endpoint.modelName})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Local hot-path endpoint</label>
                                <select
                                    value={config.aiRouting.localHotPathEndpointId || ''}
                                    onChange={(event) => updateConfig((current) => ({ ...current, aiRouting: { ...current.aiRouting, localHotPathEndpointId: event.target.value || null } }))}
                                    className={inputClassName}
                                >
                                    <option value="">Not selected</option>
                                    {endpoints.map((endpoint) => (
                                        <option key={endpoint.id} value={endpoint.id}>
                                            {endpoint.name} ({endpoint.modelName}){endpoint.purpose === 'hot_path' ? ' [hot_path]' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Cloud endpoint</label>
                                <select
                                    value={config.aiRouting.cloudEndpointId || ''}
                                    onChange={(event) => updateConfig((current) => ({ ...current, aiRouting: { ...current.aiRouting, cloudEndpointId: event.target.value || null } }))}
                                    className={inputClassName}
                                >
                                    <option value="">Platform default</option>
                                    {endpoints.map((endpoint) => (
                                        <option key={endpoint.id} value={endpoint.id}>{endpoint.name} ({endpoint.modelName})</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.aiRouting.fallbackAllowed}
                                    onChange={(event) => updateConfig((current) => ({ ...current, aiRouting: { ...current.aiRouting, fallbackAllowed: event.target.checked } }))}
                                />
                                Allow fallback
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.aiRouting.redactionEnabled}
                                    onChange={(event) => updateConfig((current) => ({ ...current, aiRouting: { ...current.aiRouting, redactionEnabled: event.target.checked } }))}
                                />
                                Cloud redaction
                            </label>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Waypoints size={16} className="text-primary" />
                            Detection Pipeline
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Rule-first mode</label>
                                <select
                                    value={config.detectionPipeline.ruleFirstEnabled ? 'true' : 'false'}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            ruleFirstEnabled: event.target.value === 'true'
                                        }
                                    }))}
                                    className={inputClassName}
                                >
                                    <option value="true">Enabled</option>
                                    <option value="false">Disabled</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>AI escalation mode</label>
                                <select
                                    value={config.detectionPipeline.aiEscalationMode}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            aiEscalationMode: event.target.value as PlatformConfigResponse['detectionPipeline']['aiEscalationMode']
                                        }
                                    }))}
                                    className={inputClassName}
                                >
                                    <option value="high_risk_allowed_only">high_risk_allowed_only</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Escalation threshold</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={config.detectionPipeline.aiEscalationThreshold}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            aiEscalationThreshold: Number(event.target.value || 0)
                                        }
                                    }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Candidate confidence</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={config.detectionPipeline.candidateMinConfidence}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            candidateMinConfidence: Number(event.target.value || 0)
                                        }
                                    }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Learning mode</label>
                                <select
                                    value={config.detectionPipeline.learningMode}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            learningMode: event.target.value as PlatformConfigResponse['detectionPipeline']['learningMode']
                                        }
                                    }))}
                                    className={inputClassName}
                                >
                                    <option value="malicious_review_queue">malicious_review_queue</option>
                                </select>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.detectionPipeline.enableHttpApi}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            enableHttpApi: event.target.checked
                                        }
                                    }))}
                                />
                                HTTP API
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.detectionPipeline.enablePacketInterceptor}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            enablePacketInterceptor: event.target.checked
                                        }
                                    }))}
                                />
                                Packet interceptor
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.detectionPipeline.enableAgentAsyncReview}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        detectionPipeline: {
                                            ...current.detectionPipeline,
                                            enableAgentAsyncReview: event.target.checked
                                        }
                                    }))}
                                />
                                Agent async review
                            </label>
                        </div>
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 text-sm font-semibold text-foreground">Audit Archive</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Audit bucket</label>
                                <input
                                    className={inputClassName}
                                    value={config.auditArchive.bucket}
                                    onChange={(event) => updateConfig((current) => ({ ...current, auditArchive: { ...current.auditArchive, bucket: event.target.value } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Retention days</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.auditArchive.retentionDays}
                                    onChange={(event) => updateConfig((current) => ({ ...current, auditArchive: { ...current.auditArchive, retentionDays: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Verify interval (min)</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.auditArchive.verifyIntervalMinutes}
                                    onChange={(event) => updateConfig((current) => ({ ...current, auditArchive: { ...current.auditArchive, verifyIntervalMinutes: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.auditArchive.objectLockRequired}
                                    onChange={(event) => updateConfig((current) => ({ ...current, auditArchive: { ...current.auditArchive, objectLockRequired: event.target.checked } }))}
                                />
                                Require object lock
                            </label>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 text-sm font-semibold text-foreground">Fastpath</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Base URL</label>
                                <input
                                    className={inputClassName}
                                    value={config.fastpath.baseUrl}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, baseUrl: event.target.value } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Transport</label>
                                <select
                                    className={inputClassName}
                                    value={config.fastpath.transport}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, transport: event.target.value as PlatformConfigResponse['fastpath']['transport'] } }))}
                                >
                                    <option value="tcp">tcp</option>
                                    <option value="unix">unix</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Timeout (ms)</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.fastpath.timeoutMs}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, timeoutMs: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Unix socket path</label>
                                <input
                                    className={inputClassName}
                                    value={config.fastpath.socketPath || ''}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, socketPath: event.target.value || null } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Config cache TTL (ms)</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.fastpath.configCacheTtlMs}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, configCacheTtlMs: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Shadow sample %</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.fastpath.trafficShadowSampleRatePct}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, trafficShadowSampleRatePct: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Max body bytes</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.fastpath.trafficMaxBodyBytes}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, trafficMaxBodyBytes: Number(event.target.value || 0) } }))}
                                />
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.fastpath.enabled}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, enabled: event.target.checked } }))}
                                />
                                Fastpath enabled
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.fastpath.fallbackEnabled}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, fallbackEnabled: event.target.checked } }))}
                                />
                                Allow fallback
                            </label>
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.fastpath.trafficShadowEnabled}
                                    onChange={(event) => updateConfig((current) => ({ ...current, fastpath: { ...current.fastpath, trafficShadowEnabled: event.target.checked } }))}
                                />
                                Traffic shadow
                            </label>
                        </div>
                    </div>
                </div>
            </ConsolePanel>

            <ConsolePanel
                title="Deployment, Device And Notifications"
                subtitle="Default rollout profile, device gateway aliases and external notification channels"
                icon={Waypoints}
                iconTone="neutral"
                headerAction={(
                    <button
                        onClick={() => updateConfig((current) => ({
                            ...current,
                            notifications: { ...current.notifications, channels: [...current.notifications.channels, makeChannel()] }
                        }))}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40"
                    >
                        <Plus size={16} />
                        Add channel
                    </button>
                )}
            >
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Waypoints size={16} className="text-primary" />
                            Deployment Defaults
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Default target</label>
                                <select
                                    value={config.deploymentDefaults.serverType}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deploymentDefaults: { ...current.deploymentDefaults, serverType: event.target.value as DeploymentTarget } }))}
                                    className={inputClassName}
                                >
                                    {targets.map((target) => <option key={target} value={target}>{target}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={labelClassName}>Upstream</label>
                                <input
                                    className={inputClassName}
                                    value={currentTemplate.upstream}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        deploymentDefaults: {
                                            ...current.deploymentDefaults,
                                            profileTemplates: {
                                                ...current.deploymentDefaults.profileTemplates,
                                                [current.deploymentDefaults.serverType]: {
                                                    ...current.deploymentDefaults.profileTemplates[current.deploymentDefaults.serverType],
                                                    upstream: event.target.value
                                                }
                                            }
                                        }
                                    }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Listen port</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={currentTemplate.port}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        deploymentDefaults: {
                                            ...current.deploymentDefaults,
                                            profileTemplates: {
                                                ...current.deploymentDefaults.profileTemplates,
                                                [current.deploymentDefaults.serverType]: {
                                                    ...current.deploymentDefaults.profileTemplates[current.deploymentDefaults.serverType],
                                                    port: Number(event.target.value || 0)
                                                }
                                            }
                                        }
                                    }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Server name</label>
                                <input
                                    className={inputClassName}
                                    value={currentTemplate.serverName}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        deploymentDefaults: {
                                            ...current.deploymentDefaults,
                                            profileTemplates: {
                                                ...current.deploymentDefaults.profileTemplates,
                                                [current.deploymentDefaults.serverType]: {
                                                    ...current.deploymentDefaults.profileTemplates[current.deploymentDefaults.serverType],
                                                    serverName: event.target.value
                                                }
                                            }
                                        }
                                    }))}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                        <div className="mb-4 text-sm font-semibold text-foreground">Device Gateway</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelClassName}>Primary path</label>
                                <input
                                    className={inputClassName}
                                    value={config.deviceGateway.primaryPath}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, primaryPath: event.target.value } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Aliases</label>
                                <input
                                    className={inputClassName}
                                    value={config.deviceGateway.aliases.join(', ')}
                                    onChange={(event) => updateConfig((current) => ({
                                        ...current,
                                        deviceGateway: {
                                            ...current.deviceGateway,
                                            aliases: event.target.value.split(',').map((item) => item.trim()).filter(Boolean)
                                        }
                                    }))} 
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Setup SSID</label>
                                <input
                                    className={inputClassName}
                                    value={config.deviceGateway.wifiSSID}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, wifiSSID: event.target.value } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Firmware host</label>
                                <input
                                    className={inputClassName}
                                    value={config.deviceGateway.firmwareLocalHost}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, firmwareLocalHost: event.target.value } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Local port</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.deviceGateway.localPort}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, localPort: Number(event.target.value || 0) } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Firmware channel</label>
                                <input
                                    className={inputClassName}
                                    value={config.deviceGateway.firmwareChannel}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, firmwareChannel: event.target.value } }))}
                                />
                            </div>
                            <div>
                                <label className={labelClassName}>Retention days</label>
                                <input
                                    className={inputClassName}
                                    type="number"
                                    value={config.deviceGateway.firmwareRetentionDays}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, firmwareRetentionDays: Number(event.target.value || 0) } }))}
                                />
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                <input
                                    type="checkbox"
                                    checked={config.deviceGateway.statusAliasEnabled}
                                    onChange={(event) => updateConfig((current) => ({ ...current, deviceGateway: { ...current.deviceGateway, statusAliasEnabled: event.target.checked } }))}
                                />
                                Enable `/ws/status` alias
                            </label>
                        </div>
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-4">
                    <div>
                        <label className={labelClassName}>Notifications enabled</label>
                        <select
                            value={config.notifications.enabled ? 'true' : 'false'}
                            onChange={(event) => updateConfig((current) => ({ ...current, notifications: { ...current.notifications, enabled: event.target.value === 'true' } }))}
                            className={inputClassName}
                        >
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelClassName}>Dedupe window (s)</label>
                        <input
                            className={inputClassName}
                            type="number"
                            value={config.notifications.dedupeWindowSeconds}
                            onChange={(event) => updateConfig((current) => ({ ...current, notifications: { ...current.notifications, dedupeWindowSeconds: Number(event.target.value || 0) } }))}
                        />
                    </div>
                    <div>
                        <label className={labelClassName}>Retry delays (s)</label>
                        <input
                            className={inputClassName}
                            value={config.notifications.retryDelaysSeconds.join(', ')}
                            onChange={(event) => updateConfig((current) => ({
                                ...current,
                                notifications: {
                                    ...current.notifications,
                                    retryDelaysSeconds: event.target.value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0)
                                }
                            }))}
                        />
                    </div>
                </div>

                <div className="mt-4 space-y-4">
                    {config.notifications.channels.length === 0 && (
                        <div className="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
                            No channels configured.
                        </div>
                    )}
                    {config.notifications.channels.map((channel) => (
                        <div key={channel.id} className="rounded-xl border border-border bg-muted/10 p-4">
                            <div className="grid grid-cols-4 gap-3">
                                <input className={inputClassName} value={channel.name} onChange={(event) => updateChannel(channel.id, (current) => ({ ...current, name: event.target.value }))} />
                                <select className={inputClassName} value={channel.type} onChange={(event) => updateChannel(channel.id, (current) => ({ ...current, type: event.target.value as NotificationChannelConfig['type'] }))}>
                                    <option value="generic_webhook">generic_webhook</option>
                                    <option value="slack_webhook">slack_webhook</option>
                                    <option value="smtp">smtp</option>
                                    <option value="email">email</option>
                                </select>
                                <select className={inputClassName} value={channel.minimumSeverity} onChange={(event) => updateChannel(channel.id, (current) => ({ ...current, minimumSeverity: event.target.value as NotificationChannelConfig['minimumSeverity'] }))}>
                                    <option value="low">low</option>
                                    <option value="medium">medium</option>
                                    <option value="high">high</option>
                                    <option value="critical">critical</option>
                                </select>
                                <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                                    <input type="checkbox" checked={channel.enabled} onChange={(event) => updateChannel(channel.id, (current) => ({ ...current, enabled: event.target.checked }))} />
                                    Enabled
                                </label>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <input
                                    className={inputClassName}
                                    value={channel.target}
                                    onChange={(event) => updateChannel(channel.id, (current) => ({ ...current, target: event.target.value }))}
                                    placeholder={channel.type === 'smtp' || channel.type === 'email' ? 'alerts@example.com' : 'https://hooks.example.com/...'}
                                />
                                {(channel.type === 'smtp' || channel.type === 'email') ? (
                                    <input
                                        className={inputClassName}
                                        value={channel.smtp.host}
                                        onChange={(event) => updateChannel(channel.id, (current) => ({ ...current, smtp: { ...current.smtp, host: event.target.value } }))}
                                        placeholder="SMTP host"
                                    />
                                ) : (
                                    <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                                        Webhook target
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 flex items-center justify-end gap-2">
                                <button
                                    onClick={() => void handleTest(channel.id)}
                                    disabled={testingChannelId === channel.id}
                                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-60"
                                >
                                    {testingChannelId === channel.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Test
                                </button>
                                <button
                                    onClick={() => updateConfig((current) => ({
                                        ...current,
                                        notifications: {
                                            ...current.notifications,
                                            channels: current.notifications.channels.filter((item) => item.id !== channel.id)
                                        }
                                    }))}
                                    className="inline-flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-300 hover:bg-rose-500/15"
                                >
                                    <Trash2 size={16} />
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-6 rounded-xl border border-border bg-muted/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Bell size={16} className="text-primary" />
                        Recent deliveries
                    </div>
                    <div className="space-y-2">
                        {deliveries.length === 0 && <div className="text-sm text-muted-foreground">No delivery records yet.</div>}
                        {deliveries.map((delivery) => (
                            <div key={delivery.id} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium text-foreground">{delivery.channelLabel}</div>
                                        <div className="text-xs text-muted-foreground">{delivery.target}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-medium text-foreground">{delivery.status}</div>
                                        <div className="text-xs text-muted-foreground">{new Date(delivery.createdAt).toLocaleString()}</div>
                                    </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                                    <span>Attempts: {delivery.attemptCount}</span>
                                    {delivery.nextAttemptAt && <span>Next retry: {new Date(delivery.nextAttemptAt).toLocaleString()}</span>}
                                    {delivery.terminalAt && <span>Terminal: {new Date(delivery.terminalAt).toLocaleString()}</span>}
                                </div>
                                {delivery.error && (
                                    <div className="mt-2 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-xs text-rose-600 dark:text-rose-300">
                                        {delivery.error}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </ConsolePanel>
        </div>
    );
};

export default PlatformCapabilitySettings;
