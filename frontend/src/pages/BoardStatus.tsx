import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Cpu, Globe } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const BoardStatus = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t, language, toggleLanguage } = useLanguage();
    const [isArmed, setIsArmed] = useState(true);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [currentTime, setCurrentTime] = useState(new Date());

    // Initial logs depend on language, but we set them once. 
    // Ideally, we might want to clear/reset logs on language change or just append new ones in correct lang.
    // For simplicity, we restart logs when language changes to match the locale.
    const [logs, setLogs] = useState<string[]>([]);

    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setLogs([
            `[14:02:11] ${t('board.log_init')}`,
            `[14:02:12] ${t('board.log_handshake')}`,
            `[14:02:13] ${t('board.log_token')}`,
            `[14:02:15] ${t('board.log_check')}`,
            `[14:02:18] ${t('board.log_warn')}`,
            `[14:02:18] ${t('board.log_stabilized')}`,
            `[14:02:25] ${t('board.log_poll')}`,
        ]);
    }, [language, t]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // Simulate incoming logs
    useEffect(() => {
        const interval = setInterval(() => {
            const timestamp = new Date().toLocaleTimeString('en-GB');
            const suffix = Math.random().toString(36).substr(2, 3).toUpperCase();
            const msg = language === 'en'
                ? `ESP32 Heartbeat >> NODE_${suffix}`
                : `ESP32 心跳包 >> NODE_${suffix}`;

            const newLog = `[${timestamp}] ${msg}`;
            setLogs(prev => [...prev.slice(-20), newLog]);
        }, 3000);
        return () => clearInterval(interval);
    }, [language]);

    const toggleBreaker = () => {
        setIsArmed(!isArmed);
        const timestamp = new Date().toLocaleTimeString('en-GB');
        const status = !isArmed
            ? (language === 'en' ? 'ARMED' : '已连通')
            : (language === 'en' ? 'DISENGAGED' : '已断开');

        const label = language === 'en' ? 'PHYSICAL BREAKER' : '物理断路器';
        setLogs(prev => [...prev, `[${timestamp}] ${label}: ${status}`]);
    };

    return (
        <div className="bg-[#05080f] font-display text-slate-200 overflow-hidden h-screen w-full flex flex-col selection:bg-blue-500 selection:text-white relative">
            {/* Background Effects */}
            <div className="fixed inset-0 w-full h-full z-0 pointer-events-none filter blur-[100px] opacity-20 bg-blue-900/10"></div>
            <div className="fixed inset-0 z-0 bg-gradient-to-t from-[#05080f] via-transparent to-[#05080f]/80 pointer-events-none"></div>
            <div className="fixed inset-0 z-50 pointer-events-none crt-scanline opacity-20"></div>

            {/* Header */}
            <header className="relative z-20 flex items-center justify-between px-6 py-3 bg-[#0b0f17]/80 backdrop-blur-md border-b border-white/10 shrink-0 h-16">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/devices')} className="p-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all">
                        <ArrowLeft size={20} className="text-slate-400" />
                    </button>
                    <div className="text-blue-500 p-1.5 rounded bg-blue-500/10 border border-blue-500/20">
                        <span className="material-symbols-outlined text-2xl">shield_lock</span>
                    </div>
                    <div>
                        {/* Logo / Title - Keeping "FluxGuard" static as requested */}
                        <h1 className="text-lg font-bold tracking-tight text-white leading-none uppercase">FluxGuard <span className="text-xs text-slate-500 font-normal ml-2">{t('board.device_id')}: {id || t('board.unknown')}</span></h1>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-mono">{t('board.system_nominal')}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-6">
                    <div className="hidden lg:flex items-center gap-4 text-xs font-mono text-slate-400">
                        <div className="flex items-center gap-2">
                            <Cpu size={14} />
                            <span>CPU: 12%</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Activity size={14} />
                            <span>NET: 4.2TB/s</span>
                        </div>
                    </div>
                    <div className="h-8 w-px bg-white/10"></div>
                    <div className="flex items-center gap-3">
                        {/* Language Switcher */}
                        <button
                            onClick={toggleLanguage}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-mono text-slate-300 transition-all"
                        >
                            <Globe size={12} />
                            {language === 'en' ? 'EN' : '中文'}
                        </button>

                        <div className="text-right hidden sm:block">
                            <div className="text-xs text-white font-bold">{t('board.admin_console')}</div>
                            <div className="text-[10px] text-slate-500">{t('board.security_level')} 5</div>
                        </div>
                        <div className="w-8 h-8 rounded bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 flex items-center justify-center">
                            <span className="material-symbols-outlined text-sm">person</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 overflow-hidden">

                {/* Left Column: Server Topology */}
                <section className="lg:col-span-3 flex flex-col gap-4 h-full min-h-0">
                    <div className="flex justify-between items-end pb-2 border-b border-white/10">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">{t('board.topology')}</h2>
                        <span className="text-[10px] font-mono text-blue-500">{t('board.live_map')}</span>
                    </div>
                    <div className="flex-1 glass-panel rounded-lg p-1 overflow-hidden flex flex-col relative group">
                        <div className="absolute top-4 right-4 flex flex-col gap-1 z-20">
                            <div className="flex items-center gap-2 bg-black/60 px-2 py-1 rounded text-[10px] font-mono backdrop-blur-sm border border-white/5">
                                <span className="w-2 h-2 bg-emerald-500 rounded-[1px]"></span> {t('board.optimal')}
                            </div>
                            <div className="flex items-center gap-2 bg-black/60 px-2 py-1 rounded text-[10px] font-mono backdrop-blur-sm border border-white/5">
                                <span className="w-2 h-2 bg-amber-500 rounded-[1px]"></span> {t('board.warn')}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6">
                            {/* Cluster Alpha */}
                            <div>
                                <div className="flex justify-between text-xs font-mono text-slate-400 mb-2">
                                    <span>CLUSTER_ALPHA</span>
                                    <span>99.8%</span>
                                </div>
                                <div className="grid grid-cols-6 gap-1">
                                    {[...Array(14)].map((_, i) => (
                                        <div key={i} className="aspect-square bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-400 transition-colors cursor-crosshair"></div>
                                    ))}
                                    <div className="col-span-2 row-span-2 bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-emerald-500/50 text-sm">hub</span>
                                    </div>
                                    {[...Array(7)].map((_, i) => (
                                        <div key={`post-${i}`} className="aspect-square bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-400 transition-colors cursor-crosshair"></div>
                                    ))}
                                </div>
                            </div>

                            {/* Cluster Beta */}
                            <div>
                                <div className="flex justify-between text-xs font-mono text-slate-400 mb-2">
                                    <span>CLUSTER_BETA</span>
                                    <span className="text-amber-500">84.2%</span>
                                </div>
                                <div className="grid grid-cols-8 gap-px bg-black/40 p-1 rounded border border-white/5">
                                    {[...Array(32)].map((_, i) => {
                                        const isWarn = i === 13 || i === 22;
                                        return (
                                            <div key={i} className={`h-3 ${isWarn ? 'bg-amber-500 animate-pulse shadow-glow-yellow' : 'bg-emerald-900/80'}`}></div>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Cluster Gamma */}
                            <div>
                                <div className="flex justify-between text-xs font-mono text-slate-400 mb-2">
                                    <span>CLUSTER_GAMMA</span>
                                    <span>100%</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {[...Array(9)].map((_, i) => (
                                        <div key={i} className="w-8 h-8 bg-blue-500/20 border border-blue-400/30 rounded-sm"></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Middle Column: Metrics & Breaker */}
                <section className="lg:col-span-5 flex flex-col gap-6 h-full">
                    {/* Top Metrics */}
                    <div className="grid grid-cols-3 gap-4 h-24">
                        <div className="glass-panel rounded-lg p-3 flex flex-col justify-between">
                            <span className="text-[10px] text-slate-500 font-mono uppercase">{t('board.load_balance')}</span>
                            <div className="flex items-end gap-1 h-8">
                                <div className="w-1 bg-blue-500/40 h-[40%]"></div>
                                <div className="w-1 bg-blue-500/60 h-[70%]"></div>
                                <div className="w-1 bg-blue-500 h-[50%]"></div>
                                <div className="w-1 bg-blue-500 h-[80%]"></div>
                                <div className="w-1 bg-blue-500 h-[60%]"></div>
                            </div>
                            <span className="text-lg font-bold text-white">42%</span>
                        </div>
                        <div className="glass-panel rounded-lg p-3 flex flex-col justify-between relative overflow-hidden">
                            <span className="text-[10px] text-slate-500 font-mono uppercase">{t('board.core_temp')}</span>
                            <div className="absolute right-0 bottom-0 w-16 h-16 bg-gradient-to-tl from-emerald-500/20 to-transparent rounded-full blur-xl"></div>
                            <span className="text-lg font-bold text-emerald-400">38°C</span>
                            <div className="w-full bg-slate-700/50 h-1 rounded-full overflow-hidden">
                                <div className="bg-emerald-500 w-[38%] h-full"></div>
                            </div>
                        </div>
                        <div className="glass-panel rounded-lg p-3 flex flex-col justify-between">
                            <span className="text-[10px] text-slate-500 font-mono uppercase">{t('board.active_threads')}</span>
                            <span className="text-lg font-bold text-white">8,921</span>
                            <span className="text-[10px] text-emerald-400">{t('board.vs_avg')}</span>
                        </div>
                    </div>

                    {/* Physical Breaker */}
                    <div className="flex-1 bg-gradient-to-b from-[#1a1f2e] to-[#0d1118] border border-white/10 rounded-xl shadow-2xl relative flex flex-col items-center justify-center p-8 overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-full hazard-stripe opacity-[0.03]"></div>
                        {/* Screws */}
                        <div className="absolute top-4 left-4 w-3 h-3 rounded-full bg-[#2a303e] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] border border-black/50"></div>
                        <div className="absolute top-4 right-4 w-3 h-3 rounded-full bg-[#2a303e] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] border border-black/50"></div>
                        <div className="absolute bottom-4 left-4 w-3 h-3 rounded-full bg-[#2a303e] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] border border-black/50"></div>
                        <div className="absolute bottom-4 right-4 w-3 h-3 rounded-full bg-[#2a303e] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] border border-black/50"></div>

                        <div className="text-center mb-8 relative z-10">
                            <h2 className="text-2xl font-black text-slate-600 tracking-[0.2em] uppercase drop-shadow-md">{t('board.physical_breaker')}</h2>
                            <p className="text-[10px] text-slate-500 font-mono mt-1">{t('board.emergency_desc')}</p>
                        </div>

                        {/* Breaker Switch */}
                        <div className="relative w-40 h-72 bg-[#080a0f] rounded-2xl border-4 border-[#282e39] shadow-inner-heavy flex justify-center p-4">
                            <div className="absolute inset-y-8 left-1/2 w-4 bg-[#151922] -translate-x-1/2 rounded-full shadow-[inset_0_0_10px_black]"></div>

                            <MotionWrapper isArmed={isArmed} toggle={toggleBreaker} language={language} t={t} />

                        </div>

                        <div className="mt-12 flex items-center gap-4">
                            <div className={`px-4 py-2 border rounded font-mono text-xs tracking-wider flex items-center gap-2 transition-all ${isArmed ? 'bg-emerald-900/20 border-emerald-500/20 text-emerald-400' : 'bg-red-900/20 border-red-500/20 text-red-500'}`}>
                                <span className="material-symbols-outlined text-sm">{isArmed ? 'lock' : 'lock_open'}</span>
                                {isArmed ? t('board.bridge_connected') : t('board.bridge_disconnected')}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Right Column: Event Stream */}
                <section className="lg:col-span-4 flex flex-col h-full min-h-0">
                    <div className="flex justify-between items-end pb-2 border-b border-white/10">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">{t('board.event_stream')}</h2>
                        <span className="text-[10px] font-mono text-slate-500">{t('board.tailing')}</span>
                    </div>
                    <div className="flex-1 bg-black/80 backdrop-blur-xl border border-white/10 rounded-lg overflow-hidden flex flex-col font-mono text-xs relative shadow-2xl">
                        <div className="bg-[#1c1f27] px-4 py-2 flex items-center gap-2 border-b border-white/5">
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50"></div>
                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                                <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50"></div>
                            </div>
                            <div className="ml-auto text-[10px] text-slate-500">/var/log/fluxguard/bridge.log</div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 scrollbar-hide text-slate-300">
                            <div className="opacity-50 border-b border-slate-800 pb-2 mb-2">
                                <span className="text-blue-400">Systemd</span> {t('board.systemd_init')}<br />
                                {t('board.service_pid')}
                            </div>
                            {logs.map((log, i) => (
                                <div key={i} className={`flex gap-2 ${log.includes('WARN') || log.includes('警告') ? 'text-amber-500' : log.includes('SUCCESS') || log.includes('成功') || log.includes('Handshake') || log.includes('握手') || log.includes('连通') || log.includes('ARMED') ? 'text-emerald-400' : 'text-slate-300'}`}>
                                    <span>{log}</span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                            <div className="mt-2 text-blue-500 animate-pulse font-bold">_</div>
                        </div>
                        <div className="p-2 border-t border-white/5 bg-[#12161f] flex justify-between text-[10px] text-slate-500">
                            <span>{t('board.buffer')}: 24KB</span>
                            <span>{t('board.encryption')}: AES-256</span>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
};

// Internal component to handle the breaker switch animation logic simply with styles for now
const MotionWrapper = ({ isArmed, toggle, language, t }: { isArmed: boolean, toggle: () => void, language: string, t: any }) => {
    return (
        <div
            onClick={toggle}
            className={`relative z-10 w-full h-32 bg-gradient-to-b from-slate-600 via-slate-700 to-slate-800 rounded-lg border-t border-slate-500/50 shadow-[0_10px_25px_rgba(0,0,0,0.8)] cursor-pointer hover:brightness-110 transition-all duration-300 ease-spring ${isArmed ? 'mt-0' : 'mt-32'}`}
        >
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex flex-col justify-between h-16 opacity-30">
                {[...Array(5)].map((_, i) => <div key={i} className="h-0.5 w-full bg-black"></div>)}
            </div>
            <div className={`absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow-glow-green transition-colors ${isArmed ? 'bg-emerald-500' : 'bg-red-500'}`}></div>

            {isArmed && <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-xs font-bold text-emerald-500 tracking-widest shadow-glow-green">{t('board.status_locked')}</div>}
            {!isArmed && <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-xs font-bold text-red-900 tracking-widest opacity-50">{t('board.status_disengage')}</div>}
        </div>
    )
}

export default BoardStatus;
