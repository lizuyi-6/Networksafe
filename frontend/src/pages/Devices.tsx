import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import {
    Cpu, HardDrive, Wifi, WifiOff, Radio,
    RefreshCw, Terminal, Power, Settings,
    Server, Activity, Shield, Globe, Zap, ChevronRight
} from 'lucide-react';

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
}

const DeviceCard = ({
    device,
    onCommand,
    onSelect,
    isSelected
}: {
    device: Device;
    onCommand: (cmd: string) => void;
    onSelect: () => void;
    isSelected: boolean;
}) => {
    const { t } = useLanguage();
    return (
        <div
            onClick={onSelect}
            className={`bg-card border rounded-xl p-5 shadow-sm transition-all cursor-pointer hover:shadow-md ${
                isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/30'
            }`}
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${device.isOnline
                        ? device.mode === 'online'
                            ? 'bg-blue-500/10 text-blue-500'
                            : 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-muted text-muted-foreground'}`}>
                        <Radio size={20} />
                    </div>
                    <div>
                        <div className="font-semibold text-foreground">{device.deviceId}</div>
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
                        <><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground"></span> Disconnected</>
                    )}
                </div>
            </div>

            {device.status && device.isOnline && (
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

            <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-muted-foreground">{t('devices.connected_agents')}</span>
                <span className="font-medium text-foreground flex items-center gap-1"><Server size={14} className="text-primary" />{device.connectedAgents.length}</span>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={(e) => { e.stopPropagation(); onCommand('collect'); }}
                    disabled={!device.isOnline}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <Zap size={12} /> Collect
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onCommand('reboot'); }}
                    disabled={!device.isOnline}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    <Power size={12} />
                </button>
                <button
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-all"
                >
                    <Settings size={12} />
                </button>
                <div onClick={(e) => e.stopPropagation()} className="ml-auto">
                    <a href={`/devices/board-status/${device.deviceId}`} className="px-3 py-2 text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-all flex items-center gap-1">
                        <Activity size={12} /> View Status
                    </a>
                </div>
            </div>
        </div>
    );
};

const Devices = () => {
    const { t } = useLanguage();
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchDevices = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/devices', { credentials: 'include' });
            if (!response.ok) throw new Error(`FG-DEVICES-LIST-${response.status}`);
            const data = await response.json();
            setDevices(data.devices || []);
        } catch (e: any) {
            console.error('Failed to fetch devices:', e);
            setError(e.message || 'FG-DEVICES-LIST-ERR');
            setDevices([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        const interval = setInterval(fetchDevices, 10000);
        return () => clearInterval(interval);
    }, []);

    const sendCommand = async (deviceId: string, command: string) => {
        setError(null);
        try {
            const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/cmd`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command })
            });
            if (!response.ok) throw new Error(`FG-DEVICE-CMD-${response.status}`);
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-CMD-ERR');
        }
    };

    const selectedDeviceData = devices.find(d => d.deviceId === selectedDevice);
    const onlineCount = devices.filter(d => d.isOnline).length;
    const cloudCount = devices.filter(d => d.isOnline && d.mode === 'online').length;

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">{t('devices.title')}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{t('devices.title')}</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={fetchDevices} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border text-foreground rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all shadow-sm">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

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
                    <div className="flex items-center gap-3 mb-2"><div className="p-2 bg-orange-500/10 text-orange-500 rounded-lg"><Server size={18} /></div><span className="text-sm font-medium text-muted-foreground">{t('devices.total_agents')}</span></div>
                    <div className="text-3xl font-bold text-foreground">{devices.reduce((acc, d) => acc + d.connectedAgents.length, 0)}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-5"><h3 className="font-semibold text-foreground flex items-center gap-2"><Radio size={16} className="text-primary" /> Edge Gateways</h3></div>
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading gateways...</div>
                        ) : devices.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border/50">{t('devices.no_gateways')}</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {devices.map(device => (
                                    <DeviceCard key={device.deviceId} device={device} onCommand={(cmd) => sendCommand(device.deviceId, cmd)} onSelect={() => setSelectedDevice(device.deviceId)} isSelected={selectedDevice === device.deviceId} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-6">
                    {selectedDeviceData ? (
                        <>
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Terminal size={16} className="text-primary" /> Device Details</h3>
                                <dl className="space-y-3 text-sm">
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.device_id')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.deviceId}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.chip_model')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.chipModel}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.flash_size')}</dt><dd className="font-medium text-foreground">{(selectedDeviceData.flashSize / 1024 / 1024).toFixed(0)} MB</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.free_heap')}</dt><dd className="font-medium text-foreground">{(selectedDeviceData.freeHeap / 1024).toFixed(0)} KB</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.sdk_version')}</dt><dd className="font-medium text-foreground">{selectedDeviceData.sdkVersion}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">{t('devices.last_heartbeat')}</dt><dd className="font-medium text-foreground">{new Date(selectedDeviceData.lastHeartbeat).toLocaleTimeString()}</dd></div>
                                </dl>
                            </div>
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Server size={16} className="text-primary" /> Connected Agents</h3>
                                {selectedDeviceData.connectedAgents.length > 0 ? (
                                    <ul className="space-y-2">
                                        {selectedDeviceData.connectedAgents.map(agent => (
                                            <li key={agent} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg"><span className="text-sm font-medium text-foreground">{agent}</span><ChevronRight size={16} className="text-muted-foreground" /></li>
                                        ))}
                                    </ul>
                                ) : <p className="text-sm text-muted-foreground text-center py-4">{t('devices.no_agents')}</p>}
                            </div>
                        </>
                    ) : (
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm text-center py-12"><Shield size={32} className="mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">{t('devices.select_device')}</p></div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Devices;
