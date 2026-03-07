import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Clock3, Cpu, MemoryStick, Router } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { fetchDeviceDetail, fetchDeviceEvents } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';

interface DeviceInfo {
    deviceId: string;
    version: string;
    chipModel: string;
    freeHeap: number;
    mode: 'online' | 'offline';
    isOnline: boolean;
    lastHeartbeat: string;
    status?: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
        wifiRssi: number;
    };
}

const BoardStatus = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t } = useLanguage();

    const [device, setDevice] = useState<DeviceInfo | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const loadDevice = async () => {
        if (!id) return;
        try {
            const data = await fetchDeviceDetail(id);
            setDevice(data?.device || null);
            setError(null);
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-DETAIL-ERR');
        }
    };

    const loadEvents = async () => {
        if (!id) return;
        try {
            const events = await fetchDeviceEvents(id, 80);
            const mapped = (events || []).map((ev: any) => {
                const ts = new Date(ev.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
                return `[${ts}] ${ev.type}: ${JSON.stringify(ev.payload || {})}`;
            });
            setLogs(mapped);
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-EVENTS-ERR');
        }
    };

    useEffect(() => {
        loadDevice();
        loadEvents();
        const interval = setInterval(() => {
            loadDevice();
            loadEvents();
        }, 5000);
        return () => clearInterval(interval);
    }, [id]);

    const uptimeText = useMemo(() => {
        const uptime = device?.status?.uptime ?? 0;
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }, [device?.status?.uptime]);

    return (
        <ConsolePage
            title={device?.deviceId || id || t('board.unknown')}
            subtitle={`${t('board.device_id')}: ${id || t('board.unknown')}`}
            actions={
                <>
                    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
                        <span className={`h-2 w-2 rounded-full ${device?.isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span className={device?.isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                            {device?.isOnline ? '在线' : '离线'}
                        </span>
                    </div>
                    <button
                        onClick={() => navigate('/devices')}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
                    >
                        <ArrowLeft size={14} />
                        返回设备列表
                    </button>
                </>
            }
        >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={Cpu} label="CPU" value={`${device?.status?.cpuUsage ?? 0}%`} hint={device?.chipModel || '-'} tone="primary" />
                <ConsoleStatCard
                    icon={MemoryStick}
                    label={t('board.memory')}
                    value={`${device?.status?.memoryUsage ?? 0}%`}
                    hint={`${t('board.free_heap')}: ${device?.freeHeap ?? 0}`}
                    tone="warning"
                />
                <ConsoleStatCard
                    icon={Activity}
                    label="Wi-Fi RSSI"
                    value={`${device?.status?.wifiRssi ?? 0} dBm`}
                    hint={t('board.last_heartbeat')}
                    tone={device?.isOnline ? 'success' : 'danger'}
                />
                <ConsoleStatCard
                    icon={Clock3}
                    label="Uptime"
                    value={uptimeText}
                    hint={device?.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : '-'}
                    tone="neutral"
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-4">
                    <ConsolePanel title={t('board.device_metrics')} subtitle="网关运行时指标" icon={Router} iconTone="primary">
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                                <span className="text-muted-foreground">{t('board.chip')}</span>
                                <span className="font-medium text-foreground">{device?.chipModel || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                                <span className="text-muted-foreground">{t('board.version')}</span>
                                <span className="font-medium text-foreground">{device?.version || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                                <span className="text-muted-foreground">{t('board.mode')}</span>
                                <span className="font-medium text-foreground">{device?.mode || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
                                <span className="text-muted-foreground">{t('board.last_heartbeat')}</span>
                                <span className="text-right font-medium text-foreground">
                                    {device?.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : '-'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">{t('board.real_data')}</span>
                                <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    /api/devices/{id}
                                </span>
                            </div>
                        </div>

                        {error && (
                            <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
                                {error}
                            </div>
                        )}
                    </ConsolePanel>
                </div>

                <div className="lg:col-span-8">
                    <ConsolePanel
                        title={t('board.event_stream')}
                        subtitle="设备最近事件流"
                        icon={Activity}
                        iconTone="warning"
                        headerAction={<span className="text-xs text-muted-foreground">/api/devices/{id}/events</span>}
                    >
                        <div className="rounded-xl border border-border bg-muted/20">
                            <div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">实时事件流</span>
                                <span>最近 80 条</span>
                            </div>
                            <div className="max-h-[560px] overflow-y-auto px-4 py-4">
                                {logs.length > 0 ? (
                                    <div className="space-y-2 font-mono text-xs leading-6 text-foreground">
                                        {logs.map((log, index) => (
                                            <div key={`${log}-${index}`} className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                                                {log}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <ConsoleEmptyState title="暂无事件" description="设备上报遥测后，这里会显示事件消息。" />
                                )}
                            </div>
                        </div>
                    </ConsolePanel>
                </div>
            </div>
        </ConsolePage>
    );
};

export default BoardStatus;
