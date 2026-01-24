/**
 * Devices 管理页面
 * 
 * 功能：
 * - 显示所有 ESP32 硬件网关
 * - 设备状态监控（在线/离线，联网/离线模式）
 * - 查看关联的 Agents
 * - 发送远程命令
 */

import { useEffect, useState } from 'react';
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

// 设备卡片组件
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
    return (
        <div
            onClick={onSelect}
            className={`bg-card border rounded-xl p-5 shadow-sm transition-all cursor-pointer hover:shadow-md ${isSelected
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/30'
                }`}
        >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${device.isOnline
                            ? device.mode === 'online'
                                ? 'bg-blue-500/10 text-blue-500'
                                : 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                        <Radio size={20} />
                    </div>
                    <div>
                        <div className="font-semibold text-foreground">{device.deviceId}</div>
                        <div className="text-xs text-muted-foreground">{device.chipModel} v{device.version}</div>
                    </div>
                </div>

                {/* Status Badge */}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${device.isOnline
                        ? device.mode === 'online'
                            ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                            : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}>
                    {device.isOnline ? (
                        device.mode === 'online' ? (
                            <>
                                <Wifi size={12} /> Cloud
                            </>
                        ) : (
                            <>
                                <WifiOff size={12} /> Offline
                            </>
                        )
                    ) : (
                        <>
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground"></span>
                            Disconnected
                        </>
                    )}
                </div>
            </div>

            {/* Stats */}
            {device.status && device.isOnline && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                        <Cpu size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">{device.status.cpuUsage}%</div>
                        <div className="text-xxs text-muted-foreground">CPU</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                        <HardDrive size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">{device.status.memoryUsage.toFixed(0)}%</div>
                        <div className="text-xxs text-muted-foreground">Memory</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                        <Activity size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">{device.status.wifiRssi}dBm</div>
                        <div className="text-xxs text-muted-foreground">Signal</div>
                    </div>
                </div>
            )}

            {/* Connected Agents */}
            <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-muted-foreground">Connected Agents</span>
                <span className="font-medium text-foreground flex items-center gap-1">
                    <Server size={14} className="text-primary" />
                    {device.connectedAgents.length}
                </span>
            </div>

            {/* Actions */}
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
                    onClick={(e) => { e.stopPropagation(); }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-all"
                >
                    <Settings size={12} />
                </button>
            </div>
        </div>
    );
};

// 主页面组件
const Devices = () => {
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

    // 模拟数据
    useEffect(() => {
        const mockDevices: Device[] = [
            {
                deviceId: 'ESP32-001',
                version: '1.0.0',
                chipModel: 'ESP32-WROOM-32',
                flashSize: 4194304,
                freeHeap: 180000,
                sdkVersion: 'v4.4.4',
                mode: 'online',
                isOnline: true,
                lastHeartbeat: new Date().toISOString(),
                connectedAgents: ['web-server-01', 'db-server-01', 'api-gateway'],
                status: {
                    cpuUsage: 23,
                    memoryUsage: 45,
                    uptime: 86400,
                    wifiRssi: -65,
                },
                systemInfo: {
                    hostname: 'gateway-1',
                    os: 'FreeRTOS',
                    kernel: 'ESP-IDF 4.4',
                    arch: 'Xtensa LX6',
                },
            },
            {
                deviceId: 'ESP32-002',
                version: '1.0.0',
                chipModel: 'ESP32-S3-WROOM-1',
                flashSize: 8388608,
                freeHeap: 220000,
                sdkVersion: 'v5.0.1',
                mode: 'offline',
                isOnline: true,
                lastHeartbeat: new Date().toISOString(),
                connectedAgents: ['prod-server-01'],
                status: {
                    cpuUsage: 15,
                    memoryUsage: 32,
                    uptime: 172800,
                    wifiRssi: -58,
                },
            },
            {
                deviceId: 'ESP32-003',
                version: '0.9.5',
                chipModel: 'ESP32-C3-MINI-1',
                flashSize: 4194304,
                freeHeap: 0,
                sdkVersion: 'v4.4.2',
                mode: 'online',
                isOnline: false,
                lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
                connectedAgents: [],
            },
        ];

        setTimeout(() => {
            setDevices(mockDevices);
            setLoading(false);
        }, 500);
    }, []);

    const fetchDevices = async () => {
        setLoading(true);
        // 实际 API 调用
        // const response = await fetch('/api/devices');
        // const data = await response.json();
        // setDevices(data.devices);
        setTimeout(() => setLoading(false), 500);
    };

    const sendCommand = async (deviceId: string, command: string) => {
        console.log(`Sending command "${command}" to ${deviceId}`);
        // 实际 API 调用
        // await fetch(`/api/devices/${deviceId}/cmd`, {
        //     method: 'POST',
        //     body: JSON.stringify({ command }),
        // });
    };

    const selectedDeviceData = devices.find(d => d.deviceId === selectedDevice);
    const onlineCount = devices.filter(d => d.isOnline).length;
    const cloudCount = devices.filter(d => d.isOnline && d.mode === 'online').length;

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Hardware Gateway Management</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Manage ESP32 edge gateways and their connected agents
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={fetchDevices}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border text-foreground rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all shadow-sm"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all">
                        <Radio size={14} /> Register Device
                    </button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg">
                            <Radio size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Total Gateways</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">{devices.length}</div>
                </div>

                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                            <Wifi size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Online</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">{onlineCount}</div>
                </div>

                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                            <Globe size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Cloud Mode</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">{cloudCount}</div>
                </div>

                <div className="bg-gradient-to-br from-card to-muted/20 border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-orange-500/10 text-orange-500 rounded-lg">
                            <Server size={18} />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">Total Agents</span>
                    </div>
                    <div className="text-3xl font-bold text-foreground">
                        {devices.reduce((acc, d) => acc + d.connectedAgents.length, 0)}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Device Grid */}
                <div className="lg:col-span-2">
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="font-semibold text-foreground flex items-center gap-2">
                                <Radio size={16} className="text-primary" /> Edge Gateways
                            </h3>
                            <div className="flex gap-2 text-xs">
                                <span className="px-2 py-1 bg-muted rounded cursor-pointer hover:text-primary transition-colors">All</span>
                                <span className="px-2 py-1 bg-transparent text-muted-foreground cursor-pointer hover:text-primary transition-colors">Online</span>
                                <span className="px-2 py-1 bg-transparent text-muted-foreground cursor-pointer hover:text-primary transition-colors">Offline</span>
                            </div>
                        </div>

                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading gateways...</div>
                        ) : devices.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border/50">
                                <Radio size={32} className="mx-auto mb-3 text-muted-foreground" />
                                <p className="mb-2">No gateways registered</p>
                                <p className="text-xs">Flash an ESP32 with the FluxGuard firmware to get started</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {devices.map(device => (
                                    <DeviceCard
                                        key={device.deviceId}
                                        device={device}
                                        onCommand={(cmd) => sendCommand(device.deviceId, cmd)}
                                        onSelect={() => setSelectedDevice(device.deviceId)}
                                        isSelected={selectedDevice === device.deviceId}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Details Panel */}
                <div className="space-y-6">
                    {selectedDeviceData ? (
                        <>
                            {/* Device Details */}
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                                    <Terminal size={16} className="text-primary" /> Device Details
                                </h3>
                                <dl className="space-y-3 text-sm">
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">Device ID</dt>
                                        <dd className="font-medium text-foreground">{selectedDeviceData.deviceId}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">Chip Model</dt>
                                        <dd className="font-medium text-foreground">{selectedDeviceData.chipModel}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">Flash Size</dt>
                                        <dd className="font-medium text-foreground">{(selectedDeviceData.flashSize / 1024 / 1024).toFixed(0)} MB</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">Free Heap</dt>
                                        <dd className="font-medium text-foreground">{(selectedDeviceData.freeHeap / 1024).toFixed(0)} KB</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">SDK Version</dt>
                                        <dd className="font-medium text-foreground">{selectedDeviceData.sdkVersion}</dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-muted-foreground">Last Heartbeat</dt>
                                        <dd className="font-medium text-foreground">
                                            {new Date(selectedDeviceData.lastHeartbeat).toLocaleTimeString()}
                                        </dd>
                                    </div>
                                </dl>
                            </div>

                            {/* Connected Agents */}
                            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                                <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                                    <Server size={16} className="text-primary" /> Connected Agents
                                </h3>
                                {selectedDeviceData.connectedAgents.length > 0 ? (
                                    <ul className="space-y-2">
                                        {selectedDeviceData.connectedAgents.map(agent => (
                                            <li key={agent} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                                                <span className="text-sm font-medium text-foreground">{agent}</span>
                                                <ChevronRight size={16} className="text-muted-foreground" />
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-4">No agents connected</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm text-center py-12">
                            <Shield size={32} className="mx-auto mb-3 text-muted-foreground" />
                            <p className="text-muted-foreground">Select a device to view details</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Devices;
