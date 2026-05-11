import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useLiveMode } from '../context/LiveModeContext';
import {
    Cpu, HardDrive, Wifi, WifiOff, Radio, RefreshCw, Terminal, Power, Settings, X,
    Server, Activity, Shield, Globe, Zap, ChevronRight, Save, RotateCcw, History, CheckCircle2
} from 'lucide-react';
import { fetchDeviceConfig, fetchDevicesList, fetchSystemBadges, isRequestAbortError, saveDeviceConfig, sendDeviceCommand } from '../services/api';

interface DeviceCommandRecord {
    id: string;
    deviceId: string;
    command: string;
    status: 'queued' | 'completed' | 'failed';
    message: string;
    executedBy: string;
    createdAt: string;
    completedAt?: string;
}

interface DeviceConfig {
    displayName: string;
    group: string;
    site: string;
    networkProfile: string;
    scanProfile: string;
    notes: string;
    commandPermissions: string[];
    tags: string[];
    updatedAt?: string;
}

interface Device {
    deviceId: string;
    version: string;
    chipModel: string;
    flashSize: number;
    freeHeap: number;
    sdkVersion: string;
    mode: 'online' | 'offline';
    isOnline: boolean;
    lastHeartbeat: string;
    connectedAgents: string[];
    config?: DeviceConfig;
    latestCommand?: DeviceCommandRecord | null;
    status?: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
        wifiRssi: number;
    };
    systemInfo?: {
        hostname: string;
        os: string;
        kernel: string;
        arch: string;
    };
    securitySummary?: {
        asset?: {
            riskScore?: number;
            findingsOpen?: number;
            alertsOpen?: number;
        } | null;
        findings?: { title: string; severity: string }[];
        alerts?: { title: string; status: string }[];
        actions?: { title: string; status: string }[];
        latestCommand?: DeviceCommandRecord | null;
    };
}

const defaultConfig = (device: Device): DeviceConfig => ({
    displayName: device.config?.displayName || device.deviceId,
    group: device.config?.group || 'default',
    site: device.config?.site || device.systemInfo?.hostname || 'unassigned',
    networkProfile: device.config?.networkProfile || 'cloud-mesh',
    scanProfile: device.config?.scanProfile || 'balanced',
    notes: device.config?.notes || '',
    commandPermissions: device.config?.commandPermissions || [
        'collect',
        'reboot',
        'sync-config',
        'ota_update',
        'deploy_bundle',
        'host_install',
        'host_remove',
        'recovery_flash',
        'factory_reset',
        'diagnostic_unlock',
        'wipe_data',
        'critical_config_change'
    ],
    tags: device.config?.tags || []
});

const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : '--');

const DeviceCard = ({
    device,
    onCommand,
    onOpenSettings,
    onSelect,
    isSelected,
    commandBusy
}: {
    device: Device;
    onCommand: (cmd: string) => void;
    onOpenSettings: () => void;
    onSelect: () => void;
    isSelected: boolean;
    commandBusy?: string | null;
}) => {
    const { t } = useLanguage();
    const latestCommand = device.latestCommand || device.securitySummary?.latestCommand || null;

    return (
        <div
            onClick={onSelect}
            className={`bg-card border rounded-xl p-5 shadow-sm transition-all cursor-pointer hover:shadow-md ${
                isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/30'
            }`}
        >
            <div className="flex justify-between items-start mb-4 gap-3">
                <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${device.isOnline
                        ? device.mode === 'online'
                            ? 'bg-blue-500/10 text-blue-500'
                            : 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-muted text-muted-foreground'}`}>
                        <Radio size={20} />
                    </div>
                    <div>
                        <div className="font-semibold text-foreground">{device.config?.displayName || device.deviceId}</div>
                        <div className="text-xs text-muted-foreground">{device.chipModel} v{device.version}</div>
                    </div>
                </div>

                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${device.isOnline
                    ? device.mode === 'online'
                        ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                        : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                    : 'bg-muted text-muted-foreground border border-border'}`}>
                    {device.isOnline ? (
                        device.mode === 'online' ? <><Wifi size={12} /> {t('devices.cloud_mode')}</> : <><WifiOff size={12} /> {t('devices.no_agents')}</>
                    ) : (
                        <><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground"></span> {t('devices.disconnected')}</>
                    )}
                </div>
            </div>

            {device.status && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                        <Cpu size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">{device.status.cpuUsage}%</div>
                        <div className="text-xxs text-muted-foreground">{t('devices.cpu')}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                        <HardDrive size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">{device.status.memoryUsage.toFixed(0)}%</div>
                        <div className="text-xxs text-muted-foreground">{t('devices.memory')}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                        <Activity size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">{device.status.wifiRssi}dBm</div>
                        <div className="text-xxs text-muted-foreground">{t('devices.signal')}</div>
                    </div>
                </div>
            )}

            <div className="mb-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('devices.connected_agents')}</span>
                    <span className="font-medium text-foreground flex items-center gap-1"><Server size={14} className="text-primary" />{device.connectedAgents.length}</span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t('devices.risk')}</span>
                    <span className="font-medium text-foreground">{device.securitySummary?.asset?.riskScore || 0}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                    {t('devices.latest_action')}: <span className="text-foreground">{latestCommand?.command || t('devices.none')}</span>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={(e) => { e.stopPropagation(); onCommand('collect'); }}
                    disabled={!device.isOnline || commandBusy === 'collect'}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <Zap size={12} /> {commandBusy === 'collect' ? t('devices.running') : t('devices.collect')}
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onCommand('reboot'); }}
                    disabled={!device.isOnline || commandBusy === 'reboot'}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <Power size={12} />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-all"
                >
                    <Settings size={12} />
                </button>
                <div onClick={(e) => e.stopPropagation()} className="ml-auto">
                    <Link to={`/devices/board-status/${device.deviceId}`} className="px-3 py-2 text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-all flex items-center gap-1">
                        <Activity size={12} /> {t('devices.view_status')}
                    </Link>
                </div>
            </div>
        </div>
    );
};

const Devices = () => {
    const { t } = useLanguage();
    const { liveModeEnabled } = useLiveMode();
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsDeviceId, setSettingsDeviceId] = useState<string | null>(null);
    const [configDraft, setConfigDraft] = useState<DeviceConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);
    const [commandHistory, setCommandHistory] = useState<DeviceCommandRecord[]>([]);
    const [commandBusyByDevice, setCommandBusyByDevice] = useState<Record<string, string | null>>({});
    const [platformBadges, setPlatformBadges] = useState({ agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 });

    const fetchDevices = async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            const [data, badges] = await Promise.all([
                fetchDevicesList(signal),
                fetchSystemBadges(signal),
            ]);
            if (signal?.aborted) {
                return;
            }
            const nextDevices = data.devices || [];
            setDevices(nextDevices);
            setPlatformBadges(badges);
            setSelectedDevice((current) => current && nextDevices.some((device: Device) => device.deviceId === current) ? current : nextDevices[0]?.deviceId || null);
        } catch (e: any) {
            if (!isRequestAbortError(e, signal)) {
                setError(e.message || 'FG-DEVICES-LIST-ERR');
                setDevices([]);
            }
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    };

    const loadDeviceConfig = async (deviceId: string) => {
        setConfigLoading(true);
        try {
            const response = await fetchDeviceConfig(deviceId);
            setConfigDraft(response?.config || null);
            setCommandHistory(response?.commandHistory || []);
            setError(null);
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-CONFIG-ERR');
        } finally {
            setConfigLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        void fetchDevices(controller.signal);
        return () => controller.abort();
    }, []);

    useEffect(() => {
        let disposed = false;
        let controller: AbortController | null = null;

        if (!liveModeEnabled) {
            return;
        }

        const refresh = async () => {
            const nextController = new AbortController();
            controller?.abort();
            controller = nextController;
            await fetchDevices(nextController.signal);
        };

        const interval = setInterval(() => {
            if (!disposed) {
                void refresh();
            }
        }, 10000);

        return () => {
            disposed = true;
            controller?.abort();
            clearInterval(interval);
        };
    }, [liveModeEnabled]);

    const openSettings = async (device: Device) => {
        setSelectedDevice(device.deviceId);
        setSettingsDeviceId(device.deviceId);
        setSettingsOpen(true);
        setConfigDraft(defaultConfig(device));
        await loadDeviceConfig(device.deviceId);
    };

    const closeSettings = () => {
        setSettingsOpen(false);
        setSettingsDeviceId(null);
        setConfigDraft(null);
        setCommandHistory([]);
    };

    const sendCommand = async (deviceId: string, command: string) => {
        setError(null);
        setActionMessage(null);
        setCommandBusyByDevice((current) => ({ ...current, [deviceId]: command }));
        try {
            const response = await sendDeviceCommand(deviceId, command);
            setActionMessage(
                response.status === 'approval_required'
                    ? `${response.message || `Command ${command} is waiting for hardware confirmation.`}${response.confirmationSessionId ? ` (${response.confirmationSessionId})` : ''}`
                    : response.message || `Command ${command} completed`
            );
            await fetchDevices();
            if (settingsOpen && settingsDeviceId === deviceId) {
                await loadDeviceConfig(deviceId);
            }
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-CMD-ERR');
        } finally {
            setCommandBusyByDevice((current) => ({ ...current, [deviceId]: null }));
        }
    };

    const saveSettings = async () => {
        if (!settingsDeviceId || !configDraft) {
            return;
        }

        setConfigSaving(true);
        setError(null);
        try {
            const response = await saveDeviceConfig(settingsDeviceId, configDraft);
            setConfigDraft(response?.config || configDraft);
            setCommandHistory(response?.commandHistory || []);
            setActionMessage(t('devices.config_saved'));
            await fetchDevices();
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-SAVE-ERR');
        } finally {
            setConfigSaving(false);
        }
    };

    const selectedDeviceData = devices.find((device) => device.deviceId === selectedDevice) || null;
    const activeConfigDevice = devices.find((device) => device.deviceId === settingsDeviceId) || null;

    const onlineCount = devices.filter((device) => device.isOnline).length;
    const cloudCount = devices.filter((device) => device.isOnline && device.mode === 'online').length;
    const findingsOpen = devices.reduce((sum, device) => sum + (device.securitySummary?.asset?.findingsOpen || 0), 0);
    const recentActions = useMemo(
        () => devices.filter((device) => device.latestCommand || device.securitySummary?.latestCommand).length,
        [devices]
    );

    return (
        <div className="relative p-6 space-y-6 max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">{t('devices.title')}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{t('devices.page_subtitle')}</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={() => void fetchDevices()} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border text-foreground rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all shadow-sm">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('devices.refresh')}
                    </button>
                </div>
            </div>

            {actionMessage && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
                    <CheckCircle2 size={16} />
                    <span>{actionMessage}</span>
                </div>
            )}

            {error && <div className="p-3 rounded border border-red-500/30 text-red-300 bg-red-500/10 text-sm">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-primary/10 text-primary rounded-lg"><Radio size={18} /></div><span className="text-sm font-medium text-muted-foreground">{t('devices.total_gateways')}</span></div>
                    <div className="text-3xl font-bold text-foreground">{devices.length}</div>
                </div>
                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg"><Wifi size={18} /></div><span className="text-sm font-medium text-muted-foreground">{t('devices.online')}</span></div>
                    <div className="text-3xl font-bold text-foreground">{onlineCount}</div>
                </div>
                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg"><Globe size={18} /></div><span className="text-sm font-medium text-muted-foreground">{t('devices.cloud_mode')}</span></div>
                    <div className="text-3xl font-bold text-foreground">{cloudCount}</div>
                </div>
                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-orange-500/10 text-orange-500 rounded-lg"><Shield size={18} /></div><span className="text-sm font-medium text-muted-foreground">{t('devices.open_findings_actions')}</span></div>
                    <div className="text-3xl font-bold text-foreground">{findingsOpen} / {recentActions}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-5"><h3 className="font-semibold text-foreground flex items-center gap-2"><Radio size={16} className="text-primary" /> {t('devices.edge_gateways')}</h3></div>
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">{t('devices.loading_gateways')}</div>
                        ) : devices.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 px-6 py-8">
                                <div className="text-center">
                                    <div className="text-base font-medium text-foreground">{t('devices.no_gateways')}</div>
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        {t('devices.no_device_desc')}
                                    </p>
                                </div>
                                <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                                    <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                                        <div className="text-xs text-muted-foreground">{t('devices.online_agents')}</div>
                                        <div className="mt-1 text-2xl font-semibold text-foreground">{platformBadges.agentMonitor || platformBadges.agents}</div>
                                    </div>
                                    <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                                        <div className="text-xs text-muted-foreground">{t('devices.active_alerts')}</div>
                                        <div className="mt-1 text-2xl font-semibold text-foreground">{platformBadges.alerts}</div>
                                    </div>
                                    <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                                        <div className="text-xs text-muted-foreground">{t('devices.running_scans')}</div>
                                        <div className="mt-1 text-2xl font-semibold text-foreground">{platformBadges.scanner}</div>
                                    </div>
                                </div>
                                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                                    <Link
                                        to="/deploy"
                                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                                    >
                                        <Server size={14} />
                                        {t('devices.view_deploy')}
                                    </Link>
                                    <button
                                        onClick={() => void fetchDevices()}
                                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                                    >
                                        <RefreshCw size={14} />
                                        {t('devices.recheck')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {devices.map((device) => (
                                    <DeviceCard
                                        key={device.deviceId}
                                        device={device}
                                        onCommand={(cmd) => sendCommand(device.deviceId, cmd)}
                                        onOpenSettings={() => void openSettings(device)}
                                        onSelect={() => setSelectedDevice(device.deviceId)}
                                        isSelected={selectedDevice === device.deviceId}
                                        commandBusy={commandBusyByDevice[device.deviceId] || null}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-6">
                    {selectedDeviceData ? (
                        <>
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-semibold text-foreground flex items-center gap-2"><Terminal size={16} className="text-primary" /> {t('devices.device_details')}</h3>
                                    <button onClick={() => void openSettings(selectedDeviceData)} className="rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40">
                                        {t('devices.edit_config')}
                                    </button>
                                </div>
                                <dl className="space-y-3 text-sm">
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.device_id')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.deviceId}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.display_name')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.config?.displayName || selectedDeviceData.deviceId}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.group')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.config?.group || '--'}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.site')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.config?.site || '--'}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.chip_model')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.chipModel}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.flash_size')}</dt><dd className="font-medium text-foreground">{(selectedDeviceData.flashSize / 1024 / 1024).toFixed(0)} MB</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.free_heap')}</dt><dd className="font-medium text-foreground">{(selectedDeviceData.freeHeap / 1024).toFixed(0)} KB</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.sdk_version')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.sdkVersion}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.last_heartbeat')}</dt><dd className="font-medium text-foreground">{new Date(selectedDeviceData.lastHeartbeat).toLocaleTimeString()}</dd></div>
                                </dl>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><History size={16} className="text-primary" /> {t('devices.latest_command')}</h3>
                                {(selectedDeviceData.latestCommand || selectedDeviceData.securitySummary?.latestCommand) ? (
                                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                                        <div className="font-medium text-foreground">{(selectedDeviceData.latestCommand || selectedDeviceData.securitySummary?.latestCommand)?.command}</div>
                                        <div className="mt-1 text-muted-foreground">{(selectedDeviceData.latestCommand || selectedDeviceData.securitySummary?.latestCommand)?.message}</div>
                                        <div className="mt-2 text-xs text-muted-foreground">{formatDateTime((selectedDeviceData.latestCommand || selectedDeviceData.securitySummary?.latestCommand)?.createdAt)}</div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-4">{t('devices.no_commands_yet')}</p>
                                )}
                            </div>
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Server size={16} className="text-primary" /> {t('devices.connected_agents')}</h3>
                                {selectedDeviceData.connectedAgents.length > 0 ? (
                                    <ul className="space-y-2">
                                        {selectedDeviceData.connectedAgents.map((agent) => (
                                            <li key={agent} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg"><span className="text-sm font-medium text-foreground">{agent}</span><ChevronRight size={16} className="text-muted-foreground" /></li>
                                        ))}
                                    </ul>
                                ) : <p className="text-sm text-muted-foreground text-center py-4">{t('devices.no_agents')}</p>}
                            </div>
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Shield size={16} className="text-primary" /> {t('devices.security_context')}</h3>
                                {selectedDeviceData.securitySummary?.asset ? (
                                    <div className="space-y-3 text-sm">
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="rounded-lg bg-muted/30 p-3 text-center">
                                                <div className="text-xs text-muted-foreground">{t('devices.risk')}</div>
                                                <div className="mt-1 text-lg font-semibold text-foreground">{selectedDeviceData.securitySummary.asset.riskScore || 0}</div>
                                            </div>
                                            <div className="rounded-lg bg-muted/30 p-3 text-center">
                                                <div className="text-xs text-muted-foreground">{t('devices.findings')}</div>
                                                <div className="mt-1 text-lg font-semibold text-foreground">{selectedDeviceData.securitySummary.asset.findingsOpen || 0}</div>
                                            </div>
                                            <div className="rounded-lg bg-muted/30 p-3 text-center">
                                                <div className="text-xs text-muted-foreground">{t('devices.alerts')}</div>
                                                <div className="mt-1 text-lg font-semibold text-foreground">{selectedDeviceData.securitySummary.asset.alertsOpen || 0}</div>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('devices.recent_findings')}</div>
                                            {(selectedDeviceData.securitySummary.findings || []).slice(0, 3).map((finding) => (
                                                <div key={`${finding.title}-${finding.severity}`} className="mb-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                                                    <div className="text-sm font-medium text-foreground">{finding.title}</div>
                                                    <div className="text-xs text-muted-foreground">{finding.severity}</div>
                                                </div>
                                            ))}
                                            {(selectedDeviceData.securitySummary.findings || []).length === 0 && <div className="text-xs text-muted-foreground">{t('devices.no_linked_findings')}</div>}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-4">{t('devices.no_security_asset')}</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm text-center py-12"><Shield size={32} className="mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">{t('devices.select_device')}</p></div>
                    )}
                </div>
            </div>

            {settingsOpen && activeConfigDevice && (
                <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]">
                    <div className="absolute inset-y-0 right-0 w-full max-w-xl border-l border-border bg-background shadow-2xl">
                        <div className="flex h-full flex-col">
                            <div className="flex items-center justify-between border-b border-border px-6 py-4">
                                <div>
                                    <div className="text-lg font-semibold text-foreground">{t('devices.device_settings')}</div>
                                    <div className="text-sm text-muted-foreground">{activeConfigDevice.deviceId}</div>
                                </div>
                                <button onClick={closeSettings} className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted/20 hover:text-foreground">
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                                {configLoading || !configDraft ? (
                                    <div className="text-sm text-muted-foreground">{t('devices.loading_config')}</div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <label className="space-y-2 text-sm"><span className="text-muted-foreground">{t('devices.display_name')}</span><input value={configDraft.displayName} onChange={(e) => setConfigDraft({ ...configDraft, displayName: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                            <label className="space-y-2 text-sm"><span className="text-muted-foreground">{t('devices.group')}</span><input value={configDraft.group} onChange={(e) => setConfigDraft({ ...configDraft, group: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                            <label className="space-y-2 text-sm"><span className="text-muted-foreground">{t('devices.site')}</span><input value={configDraft.site} onChange={(e) => setConfigDraft({ ...configDraft, site: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                            <label className="space-y-2 text-sm"><span className="text-muted-foreground">{t('devices.network_profile')}</span><input value={configDraft.networkProfile} onChange={(e) => setConfigDraft({ ...configDraft, networkProfile: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                            <label className="space-y-2 text-sm"><span className="text-muted-foreground">{t('devices.scan_profile')}</span><input value={configDraft.scanProfile} onChange={(e) => setConfigDraft({ ...configDraft, scanProfile: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                            <label className="space-y-2 text-sm"><span className="text-muted-foreground">{t('devices.allowed_commands')}</span><input value={configDraft.commandPermissions.join(', ')} onChange={(e) => setConfigDraft({ ...configDraft, commandPermissions: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                        </div>

                                        <label className="space-y-2 text-sm block"><span className="text-muted-foreground">{t('devices.tags')}</span><input value={configDraft.tags.join(', ')} onChange={(e) => setConfigDraft({ ...configDraft, tags: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>
                                        <label className="space-y-2 text-sm block"><span className="text-muted-foreground">{t('devices.notes')}</span><textarea value={configDraft.notes} onChange={(e) => setConfigDraft({ ...configDraft, notes: e.target.value })} rows={4} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground" /></label>

                                        <div className="rounded-xl border border-border bg-muted/20 p-4">
                                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"><History size={14} className="text-primary" /> {t('devices.recent_command_history')}</div>
                                            <div className="space-y-2">
                                                {commandHistory.length === 0 ? (
                                                    <div className="text-sm text-muted-foreground">{t('devices.no_command_history')}</div>
                                                ) : (
                                                    commandHistory.map((entry) => (
                                                        <div key={entry.id} className="rounded-lg border border-border bg-card px-3 py-2">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="text-sm font-medium text-foreground">{entry.command}</div>
                                                                <div className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</div>
                                                            </div>
                                                            <div className="mt-1 text-xs text-muted-foreground">{entry.message}</div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="border-t border-border px-6 py-4">
                                <div className="flex items-center justify-between gap-3">
                                    <button onClick={() => activeConfigDevice && setConfigDraft(defaultConfig(activeConfigDevice))} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20">
                                        <RotateCcw size={14} /> {t('devices.reset')}
                                    </button>
                                    <div className="flex gap-3">
                                        <button onClick={closeSettings} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20">{t('devices.cancel')}</button>
                                        <button onClick={saveSettings} disabled={configSaving || !configDraft} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                            <Save size={14} /> {configSaving ? t('devices.saving') : t('devices.save')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Devices;
