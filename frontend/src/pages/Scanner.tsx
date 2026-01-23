import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, Search, AlertTriangle, CheckCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';

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
            { msg: 'Reviewing authentication flow...', duration: 800, type: 'info' as const },
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

                // Add mock vulnerabilities
                setVulnerabilities([
                    { id: 1, name: 'Weak SSL Configuration', severity: 'Medium', description: 'TLS 1.0 is still enabled on the server.', status: 'Open' },
                    { id: 2, name: 'Missing Security Headers', severity: 'Low', description: 'X-Content-Type-Options header is not set.', status: 'Open' },
                ]);
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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gradient">
                        {t('scanner.title')}
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">{t('scanner.subtitle')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Control Panel */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="glass-panel p-8 rounded-xl flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden">
                        {/* Animated Shield in Background */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
                            <Shield size={300} />
                        </div>

                        {!isScanning && !scanComplete && (
                            <div className="text-center z-10">
                                <div className="mb-6 inline-flex p-6 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
                                    <Search size={48} />
                                </div>
                                <h2 className="text-2xl font-semibold text-gray-900 mb-2">{t('scanner.ready_title')}</h2>
                                <p className="text-gray-500 mb-8 max-w-md mx-auto">
                                    {t('scanner.ready_desc')}
                                </p>
                                <button
                                    onClick={startScan}
                                    className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all shadow-lg hover:shadow-blue-500/25 active:scale-95"
                                >
                                    {t('scanner.start_btn')}
                                </button>
                            </div>
                        )}

                        {isScanning && (
                            <div className="w-full max-w-lg z-10">
                                <div className="flex justify-between text-sm text-gray-500 mb-2">
                                    <span>{t('scanner.scanning')}</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progress}%` }}
                                        transition={{ duration: 0.5 }}
                                    />
                                </div>
                                <div className="mt-8 bg-black/50 rounded-lg p-4 font-mono text-xs text-green-400 h-48 overflow-y-auto border border-slate-800">
                                    {logs.map(log => (
                                        <div key={log.id} className="mb-1">
                                            <span className="opacity-50">[{log.timestamp}]</span>{' '}
                                            <span className={clsx(
                                                log.type === 'error' && 'text-red-400',
                                                log.type === 'warning' && 'text-yellow-400',
                                                log.type === 'success' && 'text-green-400'
                                            )}>{log.message}</span>
                                        </div>
                                    ))}
                                    <div className="animate-pulse">_</div>
                                </div>
                            </div>
                        )}

                        {scanComplete && (
                            <div className="text-center z-10">
                                <div className="mb-6 inline-flex p-4 rounded-full bg-green-500/10 border border-green-500/30 text-green-500">
                                    <CheckCircle size={48} />
                                </div>
                                <h2 className="text-2xl font-semibold text-gray-900 mb-2">{t('scanner.complete_title')}</h2>
                                <p className="text-gray-500 mb-8">
                                    {t('scanner.complete_desc')} {vulnerabilities.length} {t('scanner.issues')}
                                </p>
                                <button
                                    onClick={startScan}
                                    className="px-6 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-all border border-gray-200 shadow-sm"
                                >
                                    {t('scanner.new_scan_btn')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Results Panel */}
                <div className="glass-panel p-6 rounded-xl overflow-hidden">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <AlertTriangle className="text-yellow-500" size={18} />
                        {t('scanner.results_title')}
                    </h3>
                    <div className="space-y-3">
                        {vulnerabilities.length === 0 && !isScanning ? (
                            <p className="text-slate-500 text-center py-10 text-sm">{t('scanner.no_vulns')}</p>
                        ) : (
                            vulnerabilities.map(vuln => (
                                <div key={vuln.id} className="p-4 rounded-lg bg-white/50 border border-gray-200 flex flex-col gap-2 shadow-sm">
                                    <div className="flex justify-between items-start">
                                        <h4 className="font-medium text-gray-900">{vuln.name}</h4>
                                        <span className={clsx(
                                            "text-xs px-2 py-0.5 rounded border",
                                            vuln.severity === 'Critical' ? "bg-red-50 text-red-600 border-red-200" :
                                                vuln.severity === 'High' ? "bg-orange-50 text-orange-600 border-orange-200" :
                                                    vuln.severity === 'Medium' ? "bg-yellow-50 text-yellow-600 border-yellow-200" :
                                                        "bg-blue-50 text-blue-600 border-blue-200"
                                        )}>
                                            {vuln.severity}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500">{vuln.description}</p>
                                </div>
                            ))
                        )}
                        {scanComplete && vulnerabilities.length === 0 && (
                            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                                <p className="text-green-400 text-sm font-medium">{t('scanner.secure_title')}</p>
                                <p className="text-green-500/60 text-xs">{t('scanner.secure_desc')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Scanner;
