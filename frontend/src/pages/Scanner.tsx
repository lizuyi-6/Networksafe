import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, Search, AlertTriangle, CheckCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';
import { fetchScannerResults } from '../services/api';

interface ScanLog {
    id: number;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    timestamp: string;
}

interface Vulnerability {
    id: number;
    name: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    description: string;
    status: 'Open' | 'Fixed';
}

const Scanner = () => {
    const { t } = useLanguage();
    const [isScanning, setIsScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState<ScanLog[]>([]);
    const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
    const logIdRef = useRef(0);

    const addLog = (message: string, type: ScanLog['type'] = 'info') => {
        const newLog: ScanLog = {
            id: logIdRef.current++,
            message,
            type,
            timestamp: new Date().toLocaleTimeString(),
        };
        setLogs(prev => [...prev, newLog]);
    };

    const startScan = () => {
        setIsScanning(true);
        setScanComplete(false);
        setProgress(0);
        setLogs([]);
        setVulnerabilities([]);

        const steps = [
            { msg: 'Initializing scanner engine...', duration: 500, type: 'info' as const },
            { msg: 'Checking SSL/TLS configuration...', duration: 800, type: 'info' as const },
            { msg: 'Analyzing HTTP headers...', duration: 600, type: 'info' as const },
            { msg: 'Scanning for XSS vulnerabilities...', duration: 1000, type: 'info' as const },
            { msg: 'Checking SQL injection vectors...', duration: 900, type: 'info' as const },
            { msg: 'Validating CORS policies...', duration: 700, type: 'info' as const },
            { msg: 'Checking rate limiting...', duration: 500, type: 'success' as const },
            { msg: 'Finalizing report...', duration: 400, type: 'success' as const },
        ];

        let currentStep = 0;
        const runStep = () => {
            if (currentStep >= steps.length) {
                setIsScanning(false);
                setScanComplete(true);
                setProgress(100);
                addLog('Scan complete!', 'success');

                // Use API to get results (mock or real)
                fetchScannerResults().then(results => {
                    setVulnerabilities(results as any);
                });
                return;
            }

            const step = steps[currentStep];
            addLog(step.msg, step.type);
            setProgress(((currentStep + 1) / steps.length) * 100);
            currentStep++;

            setTimeout(runStep, step.duration);
        };

        setTimeout(runStep, 300);
    };

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-medium text-zinc-100">
                        {t('scanner.title')}
                    </h1>
                    <p className="text-zinc-500 text-sm mt-1">{t('scanner.subtitle')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Control Panel */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-surface border border-border p-8 rounded-lg flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden">
                        {/* Animated Shield in Background */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02]">
                            <Shield size={300} className="text-zinc-100" />
                        </div>

                        {!isScanning && !scanComplete && (
                            <div className="text-center z-10">
                                <div className="mb-6 inline-flex p-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                                    <Search size={48} />
                                </div>
                                <h2 className="text-xl font-medium text-zinc-200 mb-2">{t('scanner.ready_title')}</h2>
                                <p className="text-zinc-500 mb-8 max-w-md mx-auto text-sm">
                                    {t('scanner.ready_desc')}
                                </p>
                                <button
                                    onClick={startScan}
                                    className="px-8 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-all shadow-lg hover:shadow-indigo-500/20"
                                >
                                    {t('scanner.start_btn')}
                                </button>
                            </div>
                        )}

                        {isScanning && (
                            <div className="w-full max-w-lg z-10">
                                <div className="flex justify-between text-xs text-zinc-400 mb-2 font-mono">
                                    <span>{t('scanner.scanning')}</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                                    <motion.div
                                        className="h-full bg-indigo-500"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progress}%` }}
                                        transition={{ duration: 0.5 }}
                                    />
                                </div>
                                <div className="mt-8 bg-black/40 rounded p-4 font-mono text-xs text-emerald-400 h-48 overflow-y-auto border border-white/5 scrollbar-hide">
                                    {logs.map(log => (
                                        <div key={log.id} className="mb-1">
                                            <span className="opacity-50">[{log.timestamp}]</span>{' '}
                                            <span className={clsx(
                                                log.type === 'error' && 'text-red-400',
                                                log.type === 'warning' && 'text-amber-400',
                                                log.type === 'success' && 'text-emerald-400'
                                            )}>{log.message}</span>
                                        </div>
                                    ))}
                                    <div className="animate-pulse">_</div>
                                </div>
                            </div>
                        )}

                        {scanComplete && (
                            <div className="text-center z-10">
                                <div className="mb-6 inline-flex p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                                    <CheckCircle size={48} />
                                </div>
                                <h2 className="text-xl font-medium text-zinc-200 mb-2">{t('scanner.complete_title')}</h2>
                                <p className="text-zinc-500 mb-8 text-sm">
                                    {t('scanner.complete_desc')} <span className="text-zinc-300 font-bold">{vulnerabilities.length}</span> {t('scanner.issues')}
                                </p>
                                <button
                                    onClick={startScan}
                                    className="px-6 py-2 bg-white/5 hover:bg-white/10 text-zinc-200 rounded font-medium transition-all border border-white/10"
                                >
                                    {t('scanner.new_scan_btn')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Results Panel */}
                <div className="bg-surface border border-border p-6 rounded-lg overflow-hidden h-full">
                    <h3 className="text-sm font-medium mb-4 flex items-center gap-2 text-zinc-200">
                        <AlertTriangle className="text-amber-500" size={16} />
                        {t('scanner.results_title')}
                    </h3>
                    <div className="space-y-3">
                        {vulnerabilities.length === 0 && !isScanning ? (
                            <p className="text-zinc-600 text-center py-10 text-xs">{t('scanner.no_vulns')}</p>
                        ) : (
                            vulnerabilities.map(vuln => (
                                <div key={vuln.id} className="p-3 rounded bg-black/20 border border-white/5 flex flex-col gap-2 hover:border-zinc-700 transition-colors">
                                    <div className="flex justify-between items-start">
                                        <h4 className="text-sm font-medium text-zinc-200">{vuln.name}</h4>
                                        <span className={clsx(
                                            "text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider",
                                            vuln.severity === 'Critical' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                                                vuln.severity === 'High' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                                                    vuln.severity === 'Medium' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                        "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                        )}>
                                            {vuln.severity}
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-500">{vuln.description}</p>
                                </div>
                            ))
                        )}
                        {scanComplete && vulnerabilities.length === 0 && (
                            <div className="p-4 rounded bg-emerald-500/5 border border-emerald-500/10 text-center">
                                <p className="text-emerald-400 text-sm font-medium">{t('scanner.secure_title')}</p>
                                <p className="text-emerald-500/60 text-xs">{t('scanner.secure_desc')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
export default Scanner;
