import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Cpu, Globe } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { fetchDeviceEvents } from '../services/api';

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
    const { t, language, toggleLanguage } = useLanguage();

    const [device, setDevice] = useState<DeviceInfo | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const loadDevice = async () => {
        if (!id) return;
        try {
            const response = await fetch(`/api/devices/${encodeURIComponent(id)}`, { credentials: 'include' });
            if (!response.ok) throw new Error(`FG-DEVICE-DETAIL-${response.status}`);
            const data = await response.json();
            setDevice(data?.device || null);
        } catch (e: any) {
            setError(e.message || 'FG-DEVICE-DETAIL-ERR');
        }
    };

    const loadEvents = async () => {
        if (!id) return;
        try {
            const events = await fetchDeviceEvents(id, 80);
            const mapped = (events || []).map((ev: any) => {
                const ts = new Date(ev.timestamp).toLocaleTimeString('en-GB');
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

    return (
        <div className="bg-[#05080f] font-display text-slate-200 overflow-hidden h-screen w-full flex flex-col selection:bg-blue-500 selection:text-white relative">
            <header className="relative z-20 flex items-center justify-between px-6 py-3 bg-[#0b0f17]/80 backdrop-blur-md border-b border-white/10 shrink-0 h-16">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/devices')} className="p-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all">
                        <ArrowLeft size={20} className="text-slate-400" />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-white leading-none uppercase">FluxGuard <span className="text-xs text-slate-500 font-normal ml-2">{t('board.device_id')}: {id || t('board.unknown')}</span></h1>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${device?.isOnline ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-mono">{device?.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-6">
                    <div className="hidden lg:flex items-center gap-4 text-xs font-mono text-slate-400">
                        <div className="flex items-center gap-2"><Cpu size={14} /><span>CPU: {device?.status?.cpuUsage ?? 0}%</span></div>
                        <div className="flex items-center gap-2"><Activity size={14} /><span>RSSI: {device?.status?.wifiRssi ?? 0}dBm</span></div>
                    </div>
                    <div className="h-8 w-px bg-white/10"></div>
                    <button onClick={toggleLanguage} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-mono text-slate-300 transition-all">
                        <Globe size={12} />
                        {language === 'en' ? 'EN' : '中文'}
                    </button>
                </div>
            </header>

            <main className="relative z-10 flex-1 p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 overflow-hidden">
                <section className="lg:col-span-4 flex flex-col gap-4 h-full min-h-0">
                    <div className="flex justify-between items-end pb-2 border-b border-white/10">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Device Metrics</h2>
                        <span className="text-[10px] font-mono text-blue-500">Real Data</span>
                    </div>
                    <div className="bg-card/20 border border-white/10 rounded-lg p-4 space-y-3 text-sm">
                        <div className="flex justify-between"><span className="text-slate-400">Chip</span><span>{device?.chipModel || '-'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Version</span><span>{device?.version || '-'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Mode</span><span>{device?.mode || '-'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Memory</span><span>{device?.status?.memoryUsage ?? 0}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Free Heap</span><span>{device?.freeHeap ?? 0}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Last Heartbeat</span><span>{device?.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : '-'}</span></div>
                    </div>
                    {error && (
                        <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs">{error}</div>
                    )}
                </section>

                <section className="lg:col-span-8 flex flex-col h-full min-h-0">
                    <div className="flex justify-between items-end pb-2 border-b border-white/10">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Event Stream</h2>
                        <span className="text-[10px] font-mono text-slate-500">/api/devices/{id}/events</span>
                    </div>
                    <div className="flex-1 bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg overflow-hidden flex flex-col font-mono text-xs relative shadow-2xl">
                        <div className="bg-[#1c1f27] px-4 py-2 flex items-center gap-2 border-b border-white/5">
                            <div className="ml-auto text-[10px] text-slate-500">real-time event feed</div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 text-slate-300">
                            {logs.length > 0 ? logs.map((log, i) => (
                                <div key={i} className="flex gap-2"><span>{log}</span></div>
                            )) : (
                                <div className="opacity-60">No events available.</div>
                            )}
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
};

export default BoardStatus;
