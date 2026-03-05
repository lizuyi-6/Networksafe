import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Shield, StopCircle, Activity, Globe, Server, History } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';
import { cancelScanTask, createScanTask, fetchScanHistory, fetchScanTask, fetchScanTaskResults } from '../services/api';
import { useWebSocket } from '../context/WebSocketContext';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface Finding {
    target: string;
    severity: Severity;
    title: string;
    description: string;
    sourceEngine: string;
    createdAt: string;
}

interface ScanHistoryItem {
    id: string;
    status: string;
    phase: string;
    progress: number;
    createdAt: string;
    completedAt?: string;
}

const Scanner = () => {
    const { t } = useLanguage();
    const { subscribe, connected } = useWebSocket();

    const [taskId, setTaskId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('idle');
    const [phase, setPhase] = useState<string>('queued');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [urlFindings, setUrlFindings] = useState<Finding[]>([]);
    const [hostFindings, setHostFindings] = useState<Finding[]>([]);
    const [nucleiFindings, setNucleiFindings] = useState<Finding[]>([]);
    const [urls, setUrls] = useState('');
    const [includeSystem, setIncludeSystem] = useState(true);
    const [includeWeb, setIncludeWeb] = useState(true);
    const [includePorts, setIncludePorts] = useState(true);
    const [history, setHistory] = useState<ScanHistoryItem[]>([]);

    const logRef = useRef<HTMLDivElement>(null);

    const isRunning = status === 'pending' || status === 'running';

    const addLog = (message: string) => {
        const ts = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, `[${ts}] ${message}`]);
    };

    const loadResult = async (id: string) => {
        try {
            const response = await fetchScanTaskResults(id);
            const data = response?.data || {};
            setUrlFindings(data.urlFindings || []);
            setHostFindings(data.hostFindings || []);
            setNucleiFindings(data.nucleiFindings || []);
        } catch (e) {
            console.error(e);
        }
    };

    const loadHistory = async () => {
        try {
            const rows = await fetchScanHistory(20);
            setHistory(rows || []);
        } catch {
            setHistory([]);
        }
    };

    const loadTaskFromHistory = async (id: string) => {
        try {
            const taskResponse = await fetchScanTask(id);
            const task = taskResponse?.data;
            setTaskId(id);
            setStatus(task?.status || 'idle');
            setPhase(task?.phase || 'queued');
            setProgress(task?.progress || 0);
            setError(task?.error || null);
            await loadResult(id);
            addLog(`Loaded task ${id} from history`);
        } catch (e: any) {
            setError(e.message || 'Failed to load history task');
        }
    };

    useEffect(() => {
        loadHistory();
    }, []);

    useEffect(() => {
        if (!taskId) return;
        const timer = setInterval(async () => {
            try {
                const response = await fetchScanTask(taskId);
                const d = response?.data;
                setStatus(d?.status || 'idle');
                setPhase(d?.phase || 'queued');
                setProgress(d?.progress || 0);
                if (d?.status === 'completed' || d?.status === 'failed' || d?.status === 'cancelled') {
                    await loadResult(taskId);
                    await loadHistory();
                }
            } catch {
                // ignore; ws may still update
            }
        }, 3000);
        return () => clearInterval(timer);
    }, [taskId]);

    useEffect(() => {
        const unsub = subscribe('*', (evt: any) => {
            const event = evt.event as string;
            const payload = evt.payload || {};
            const incomingTaskId = evt.taskId;
            if (!taskId || incomingTaskId !== taskId) return;

            if (event === 'scanner:task:started') {
                setStatus('running');
                setPhase(payload.phase || 'url-scan');
                setProgress(payload.progress ?? 0);
                addLog('Scan task started');
            }
            if (event === 'scanner:task:phase') {
                setPhase(payload.phase || 'queued');
                if (typeof payload.progress === 'number') setProgress(payload.progress);
                addLog(`Phase changed: ${payload.phase}`);
            }
            if (event === 'scanner:task:progress') {
                if (typeof payload.progress === 'number') setProgress(payload.progress);
            }
            if (event === 'scanner:task:log') {
                addLog(payload.message || 'task log');
            }
            if (event === 'scanner:task:completed') {
                setStatus('completed');
                setPhase('done');
                setProgress(100);
                addLog('Scan completed');
                loadResult(taskId);
                loadHistory();
            }
            if (event === 'scanner:task:failed') {
                setStatus('failed');
                setPhase('done');
                setProgress(100);
                setError(payload.error || 'Scan failed');
                addLog(`Scan failed: ${payload.error || 'unknown'}`);
                loadHistory();
            }
            if (event === 'scanner:task:cancelled') {
                setStatus('cancelled');
                setPhase('done');
                setProgress(100);
                addLog('Scan cancelled');
                loadHistory();
            }
        });
        return () => unsub();
    }, [subscribe, taskId]);

    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    const summary = useMemo(() => {
        const all = [...urlFindings, ...hostFindings, ...nucleiFindings];
        return {
            total: all.length,
            critical: all.filter(f => f.severity === 'critical').length,
            high: all.filter(f => f.severity === 'high').length,
            medium: all.filter(f => f.severity === 'medium').length,
            low: all.filter(f => f.severity === 'low').length
        };
    }, [urlFindings, hostFindings, nucleiFindings]);

    const startScan = async () => {
        setError(null);
        setLogs([]);
        setUrlFindings([]);
        setHostFindings([]);
        setNucleiFindings([]);
        setProgress(0);
        setStatus('pending');
        setPhase('queued');

        const urlList = urls
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);

        try {
            const response = await createScanTask({
                enginePolicy: 'opt_then_nuclei',
                targets: {
                    urls: urlList,
                    host: {
                        mode: 'local',
                        includeSystem,
                        includeWeb,
                        includePorts
                    }
                }
            });
            const id = response?.data?.taskId;
            setTaskId(id);
            addLog(`Task created: ${id}`);
            loadHistory();
        } catch (e: any) {
            setStatus('failed');
            setError(e.message || 'Failed to create scan task');
        }
    };

    const stopScan = async () => {
        if (!taskId) return;
        try {
            await cancelScanTask(taskId);
            addLog('Cancellation requested');
            loadHistory();
        } catch (e: any) {
            setError(e.message || 'Failed to cancel task');
        }
    };

    const renderFindingCard = (f: Finding, idx: number) => (
        <div key={`${f.target}-${f.title}-${idx}`} className="p-3 rounded bg-muted/20 border border-border flex flex-col gap-2 hover:border-border/80 transition-colors">
            <div className="flex justify-between items-start gap-2">
                <h4 className="text-sm font-medium text-foreground">{f.title}</h4>
                <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider',
                    f.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        f.severity === 'high' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                            f.severity === 'medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-blue-500/10 text-blue-400 border-blue-500/20'
                )}>
                    {f.severity}
                </span>
            </div>
            <p className="text-xs text-muted-foreground">{f.description}</p>
            <div className="text-[10px] text-muted-foreground">
                target: <span className="font-mono">{f.target}</span> | engine: {f.sourceEngine}
            </div>
        </div>
    );

    return (
        <div className="space-y-6 p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-xl font-medium text-foreground">{t('scanner.title')}</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Live scan tasks with URL + host analysis ({connected ? 'WS connected' : 'polling fallback'})
                    </p>
                </div>
                <div className="flex gap-2">
                    {isRunning ? (
                        <button
                            onClick={stopScan}
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium flex items-center gap-2"
                        >
                            <StopCircle size={16} /> Cancel
                        </button>
                    ) : (
                        <button
                            onClick={startScan}
                            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-sm font-medium"
                        >
                            Start Real Scan
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="p-3 rounded border border-red-500/30 text-red-300 bg-red-500/10 text-sm">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="bg-card border border-border rounded-lg p-4">
                    <div className="text-xs text-muted-foreground">{t('scanner.task')}</div>
                    <div className="text-sm text-foreground font-mono mt-1 break-all">{taskId || '-'}</div>
                </div>
                <div className="bg-card border border-border rounded-lg p-4">
                    <div className="text-xs text-muted-foreground">Status / Phase</div>
                    <div className="text-sm text-foreground mt-1">{status} / {phase}</div>
                </div>
                <div className="bg-card border border-border rounded-lg p-4">
                    <div className="text-xs text-muted-foreground">{t('scanner.progress')}</div>
                    <div className="text-sm text-foreground mt-1">{progress}%</div>
                </div>
                <div className="bg-card border border-border rounded-lg p-4">
                    <div className="text-xs text-muted-foreground">{t('scanner.findings')}</div>
                    <div className="text-sm text-foreground mt-1">{summary.total} (C:{summary.critical} H:{summary.high} M:{summary.medium} L:{summary.low})</div>
                </div>
            </div>

            <div className="bg-card border border-border p-5 rounded-lg">
                <div className="flex items-center gap-2 mb-3 text-foreground text-sm font-medium">
                    <Activity size={16} /> Scan Inputs
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-muted-foreground">URL targets (one per line)</label>
                        <textarea
                            value={urls}
                            onChange={e => setUrls(e.target.value)}
                            rows={5}
                            className="w-full mt-2 bg-muted/20 border border-border rounded px-3 py-2 text-foreground text-sm font-mono"
                        />
                    </div>
                    <div className="space-y-3">
                        <div className="text-xs text-muted-foreground">{t('scanner.host_scan_toggles')}</div>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={includeSystem} onChange={e => setIncludeSystem(e.target.checked)} />
                            Include system checks
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={includeWeb} onChange={e => setIncludeWeb(e.target.checked)} />
                            Include web server checks
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={includePorts} onChange={e => setIncludePorts(e.target.checked)} />
                            Include port checks
                        </label>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="bg-card border border-border p-4 rounded-lg">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-foreground">
                        <Globe size={16} /> URL Findings
                    </h3>
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                        {urlFindings.length === 0 && <p className="text-xs text-muted-foreground">No URL findings.</p>}
                        {urlFindings.map(renderFindingCard)}
                    </div>
                </div>

                <div className="bg-card border border-border p-4 rounded-lg">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-foreground">
                        <Server size={16} /> Host Findings
                    </h3>
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                        {hostFindings.length === 0 && <p className="text-xs text-muted-foreground">No host findings.</p>}
                        {hostFindings.map(renderFindingCard)}
                    </div>
                </div>

                <div className="bg-card border border-border p-4 rounded-lg">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-foreground">
                        <Shield size={16} /> Nuclei Findings
                    </h3>
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                        {nucleiFindings.length === 0 && <p className="text-xs text-muted-foreground">No nuclei findings.</p>}
                        {nucleiFindings.map(renderFindingCard)}
                    </div>
                </div>

                <div className="bg-card border border-border p-4 rounded-lg">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-foreground">
                        <History size={16} /> Scan History
                    </h3>
                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                        {history.length === 0 && <p className="text-xs text-muted-foreground">No scan history.</p>}
                        {history.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => loadTaskFromHistory(item.id)}
                                className="w-full text-left p-3 rounded bg-muted/20 border border-border hover:border-border/80 transition-colors"
                            >
                                <div className="text-xs text-foreground font-mono truncate">{item.id}</div>
                                <div className="text-[11px] text-muted-foreground mt-1">
                                    {item.status} / {item.phase} / {item.progress}%
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1">
                                    {new Date(item.createdAt).toLocaleString()}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border p-4 rounded-lg">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-foreground">
                    <AlertTriangle size={16} /> Task Timeline
                </h3>
                <div ref={logRef} className="max-h-44 overflow-y-auto font-mono text-xs bg-muted/20 border border-border rounded p-3">
                    {logs.length === 0 && <div className="text-muted-foreground">No logs yet.</div>}
                    {logs.map((log, idx) => (
                        <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-emerald-400 mb-1">
                            {log}
                        </motion.div>
                    ))}
                </div>
                {!isRunning && taskId && status === 'completed' && (
                    <div className="mt-3 p-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center gap-2">
                        <CheckCircle size={16} /> Scan completed with {summary.total} findings.
                    </div>
                )}
            </div>
        </div>
    );
};

export default Scanner;
