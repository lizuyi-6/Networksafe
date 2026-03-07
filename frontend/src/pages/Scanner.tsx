import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle, Globe, History, Server, Shield, StopCircle, Wrench } from 'lucide-react';
import { clsx } from 'clsx';
import { cancelScanTask, createScanRemediationAction, createScanTask, fetchScanHistory, fetchScanTask, fetchScanTaskResults } from '../services/api';
import { useWebSocket } from '../context/WebSocketContext';
import { useLiveMode } from '../context/LiveModeContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import type { ScanAssetGroup, SecurityFinding } from '../types/api';

type ScanHistoryItem = {
    id: string;
    status: string;
    phase: string;
    progress: number;
    createdAt: string;
    completedAt?: string;
};

type ScanResultPayload = {
    data?: {
        findings?: SecurityFinding[];
        assetGroups?: ScanAssetGroup[];
        timeline?: { eventType: string; payload: Record<string, any>; createdAt: string }[];
        summary?: Record<string, any>;
        urlFindings?: any[];
        hostFindings?: any[];
        nucleiFindings?: any[];
    };
};

const STATUS_LABELS: Record<string, string> = {
    idle: '空闲',
    pending: '排队中',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
};

const PHASE_LABELS: Record<string, string> = {
    queued: '等待执行',
    'url-scan': 'Web 指纹与 TLS',
    'host-scan': '主机与服务',
    'nuclei-scan': '模板验证',
    finalizing: '结果归档',
    done: '已结束'
};

const severityTone: Record<string, string> = {
    critical: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    low: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
};

function normalizeLegacyFindings(data: NonNullable<ScanResultPayload['data']>): SecurityFinding[] {
    const merged = [...(data.urlFindings || []), ...(data.hostFindings || []), ...(data.nucleiFindings || [])];
    return merged.map((finding: any, index) => ({
        findingId: `legacy-${index}`,
        assetId: undefined,
        sourceType: 'scanner',
        sourceRef: '',
        target: finding.target || 'unknown',
        category: finding.sourceEngine || 'scanner',
        severity: finding.severity || 'medium',
        status: 'open',
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence || {},
        remediation: {},
        occurrenceCount: 1,
        firstSeenAt: finding.createdAt || new Date().toISOString(),
        lastSeenAt: finding.createdAt || new Date().toISOString()
    }));
}

const Scanner = () => {
    const { subscribe, connected } = useWebSocket();
    const { liveModeEnabled } = useLiveMode();

    const [taskId, setTaskId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('idle');
    const [phase, setPhase] = useState<string>('queued');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [urls, setUrls] = useState('');
    const [includeSystem, setIncludeSystem] = useState(true);
    const [includeWeb, setIncludeWeb] = useState(true);
    const [includePorts, setIncludePorts] = useState(true);
    const [history, setHistory] = useState<ScanHistoryItem[]>([]);
    const [findings, setFindings] = useState<SecurityFinding[]>([]);
    const [assetGroups, setAssetGroups] = useState<ScanAssetGroup[]>([]);
    const [timeline, setTimeline] = useState<Array<{ eventType: string; payload: Record<string, any>; createdAt: string }>>([]);
    const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    const logRef = useRef<HTMLDivElement>(null);
    const isRunning = status === 'pending' || status === 'running';

    const selectedFinding = useMemo(
        () => findings.find((item) => item.findingId === selectedFindingId) || findings[0] || null,
        [findings, selectedFindingId]
    );

    const summary = useMemo(() => {
        return findings.reduce(
            (acc, finding) => {
                acc.total += 1;
                acc[finding.severity] += 1;
                return acc;
            },
            { total: 0, critical: 0, high: 0, medium: 0, low: 0 }
        );
    }, [findings]);

    const addLog = (message: string) => {
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
    };

    const loadHistory = async () => {
        try {
            const rows = await fetchScanHistory(20);
            setHistory(rows || []);
        } catch {
            setHistory([]);
        }
    };

    const loadResults = async (id: string) => {
        const response = await fetchScanTaskResults(id);
        const data = response?.data || {};
        const nextFindings: SecurityFinding[] = data.findings || normalizeLegacyFindings(data);
        setFindings(nextFindings);
        setAssetGroups(
            data.assetGroups ||
                nextFindings.reduce((groups: ScanAssetGroup[], finding: SecurityFinding) => {
                    const existing = groups.find((group) => group.target === finding.target);
                    if (existing) {
                        existing.findings.push(finding);
                        existing.severities[finding.severity] = (existing.severities[finding.severity] || 0) + 1;
                        return groups;
                    }
                    groups.push({
                        assetId: finding.assetId,
                        target: finding.target,
                        category: finding.category,
                        findings: [finding],
                        severities: { [finding.severity]: 1 }
                    });
                    return groups;
                }, [])
        );
        setTimeline(data.timeline || []);
        setSelectedFindingId((current) => current || nextFindings[0]?.findingId || null);
    };

    const loadTask = async (id: string) => {
        const response = await fetchScanTask(id);
        const task = response?.data;
        setTaskId(id);
        setStatus(task?.status || 'idle');
        setPhase(task?.phase || 'queued');
        setProgress(task?.progress || 0);
        setError(task?.error || null);
        await loadResults(id);
    };

    useEffect(() => {
        loadHistory();
    }, []);

    useEffect(() => {
        if (!taskId) return;
        if (!liveModeEnabled) {
            return;
        }
        const timer = setInterval(async () => {
            try {
                const response = await fetchScanTask(taskId);
                const task = response?.data;
                setStatus(task?.status || 'idle');
                setPhase(task?.phase || 'queued');
                setProgress(task?.progress || 0);
                if (task?.error) {
                    setError(task.error);
                }
                if (task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled') {
                    await loadResults(taskId);
                    await loadHistory();
                }
            } catch {
                // Keep websocket as the primary update source when polling fails.
            }
        }, 3000);
        return () => clearInterval(timer);
    }, [liveModeEnabled, taskId]);

    useEffect(() => {
        const unsubscribe = subscribe('*', (evt: any) => {
            if (!taskId || evt.taskId !== taskId) return;

            if (evt.event === 'scanner:task:started') {
                setStatus('running');
                setPhase(evt.payload?.phase || 'url-scan');
                setProgress(evt.payload?.progress ?? 0);
                addLog('扫描任务已启动');
            }

            if (evt.event === 'scanner:task:phase') {
                setPhase(evt.payload?.phase || 'queued');
                if (typeof evt.payload?.progress === 'number') {
                    setProgress(evt.payload.progress);
                }
                addLog(`进入阶段：${PHASE_LABELS[evt.payload?.phase] || evt.payload?.phase}`);
            }

            if (evt.event === 'scanner:task:progress' && typeof evt.payload?.progress === 'number') {
                setProgress(evt.payload.progress);
            }

            if (evt.event === 'scanner:task:log') {
                addLog(evt.payload?.message || '收到任务日志');
            }

            if (evt.event === 'scanner:task:completed') {
                setStatus('completed');
                setPhase('done');
                setProgress(100);
                addLog('扫描任务已完成');
                void loadResults(taskId);
                void loadHistory();
            }

            if (evt.event === 'scanner:task:failed') {
                setStatus('failed');
                setPhase('done');
                setProgress(100);
                setError(evt.payload?.error || '扫描失败');
                addLog(`扫描失败：${evt.payload?.error || '未知错误'}`);
                void loadHistory();
            }

            if (evt.event === 'scanner:task:cancelled') {
                setStatus('cancelled');
                setPhase('done');
                setProgress(100);
                addLog('扫描任务已取消');
                void loadHistory();
            }
        });
        return () => unsubscribe();
    }, [subscribe, taskId]);

    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    const startScan = async () => {
        setError(null);
        setActionMessage(null);
        setLogs([]);
        setFindings([]);
        setAssetGroups([]);
        setTimeline([]);
        setProgress(0);
        setStatus('pending');
        setPhase('queued');

        const urlList = urls
            .split('\n')
            .map((value) => value.trim())
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
            addLog(`已创建任务 ${id}`);
            await loadHistory();
        } catch (scanError: any) {
            setStatus('failed');
            setError(scanError.message || '创建扫描任务失败');
        }
    };

    const stopScan = async () => {
        if (!taskId) return;
        try {
            await cancelScanTask(taskId);
            addLog('已请求取消当前任务');
        } catch (scanError: any) {
            setError(scanError.message || '取消任务失败');
        }
    };

    const createAction = async () => {
        if (!selectedFinding?.findingId || selectedFinding.findingId.startsWith('legacy-')) {
            setActionMessage('当前发现项没有可创建的处置动作。');
            return;
        }

        try {
            const response = await createScanRemediationAction(selectedFinding.findingId);
            setActionMessage(`已创建处置动作：${response?.data?.title || '待处理修复任务'}`);
        } catch (actionError: any) {
            setActionMessage(actionError.message || '创建处置动作失败');
        }
    };

    return (
        <ConsolePage
            title="扫描中心"
            subtitle={`统一管理扫描任务、资产证据与处置建议${connected ? '，WebSocket 已连接' : '，当前使用轮询回退'}`}
            actions={
                <div className="flex gap-2">
                    {isRunning ? (
                        <button
                            onClick={stopScan}
                            className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
                        >
                            <StopCircle size={16} />
                            取消任务
                        </button>
                    ) : (
                        <button
                            onClick={startScan}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                            启动扫描
                        </button>
                    )}
                </div>
            }
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ConsoleStatCard icon={History} label="当前任务" value={taskId || '-'} hint="最近一次加载或执行的扫描任务" tone="neutral" />
                <ConsoleStatCard icon={Activity} label="任务状态" value={`${STATUS_LABELS[status] || status} / ${PHASE_LABELS[phase] || phase}`} hint="实时阶段与任务状态" tone="primary" />
                <ConsoleStatCard icon={CheckCircle} label="执行进度" value={`${progress}%`} hint="任务阶段推进情况" tone="warning" />
                <ConsoleStatCard icon={AlertTriangle} label="发现总数" value={summary.total} hint={`Critical ${summary.critical} · High ${summary.high} · Medium ${summary.medium} · Low ${summary.low}`} tone="danger" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-5">
                    <ConsolePanel title="扫描输入" subtitle="保留现有入口，但把结果深化为资产、证据与处置闭环" icon={Globe} iconTone="primary">
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-muted-foreground">URL 目标（每行一个）</label>
                                <textarea
                                    value={urls}
                                    onChange={(event) => setUrls(event.target.value)}
                                    rows={6}
                                    className="mt-2 w-full rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm text-foreground"
                                    placeholder="https://example.com&#10;https://api.example.com"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="text-xs text-muted-foreground">本机扫描范围</div>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="checkbox" checked={includeSystem} onChange={(event) => setIncludeSystem(event.target.checked)} />
                                    系统基线与主机状态
                                </label>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="checkbox" checked={includeWeb} onChange={(event) => setIncludeWeb(event.target.checked)} />
                                    Web 服务指纹与配置
                                </label>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="checkbox" checked={includePorts} onChange={(event) => setIncludePorts(event.target.checked)} />
                                    端口暴露与服务探测
                                </label>
                            </div>
                        </div>
                    </ConsolePanel>
                </div>

                <div className="xl:col-span-7">
                    <ConsolePanel title="任务历史" subtitle="保留原来的历史区块，但支持重新载入完整证据" icon={History} iconTone="neutral">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {history.length === 0 && <ConsoleEmptyState title="暂无扫描任务" description="执行一次扫描后，这里会保留最近任务与执行进度。" />}
                            {history.map((item) => (
                                <div key={item.id} className="rounded-lg border border-border bg-muted/15 p-3 transition-colors hover:border-border/80 hover:bg-muted/20">
                                    <button onClick={() => void loadTask(item.id)} className="w-full text-left">
                                        <div className="truncate font-mono text-xs text-foreground">{item.id}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {STATUS_LABELS[item.status] || item.status} / {PHASE_LABELS[item.phase] || item.phase} / {item.progress}%
                                        </div>
                                        <div className="mt-2 text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString('zh-CN')}</div>
                                    </button>
                                    <div className="mt-3 flex justify-end">
                                        <Link to={`/scanner/runs/${item.id}`} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30">
                                            查看详情
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ConsolePanel>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-4">
                    <ConsolePanel title="资产视角" subtitle="按目标聚合风险，快速判断优先级" icon={Server} iconTone="warning">
                        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                            {assetGroups.length === 0 && <ConsoleEmptyState title="暂无资产结果" description="任务完成后，这里会显示按资产聚合的风险分布。" />}
                            {assetGroups.map((group) => (
                                <button
                                    key={`${group.target}-${group.assetId || 'na'}`}
                                    onClick={() => setSelectedFindingId(group.findings[0]?.findingId || null)}
                                    className="w-full rounded-lg border border-border bg-muted/15 p-3 text-left transition-colors hover:border-border/80"
                                >
                                    <div className="font-medium text-foreground">{group.target}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">{group.category}</div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {Object.entries(group.severities).map(([key, value]) => (
                                            <span key={key} className={clsx('rounded border px-2 py-0.5 text-[10px] font-semibold uppercase', severityTone[key] || severityTone.medium)}>
                                                {key} {value}
                                            </span>
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </ConsolePanel>
                </div>

                <div className="xl:col-span-4">
                    <ConsolePanel title="发现列表" subtitle="当前任务中所有可追踪的发现项" icon={Shield} iconTone="danger">
                        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                            {findings.length === 0 && <ConsoleEmptyState title="暂无发现项" description="完成扫描后，这里会显示按严重级别排序的发现项。" />}
                            {findings.map((finding) => (
                                <button
                                    key={finding.findingId}
                                    onClick={() => setSelectedFindingId(finding.findingId)}
                                    className={clsx(
                                        'w-full rounded-lg border p-3 text-left transition-colors',
                                        selectedFinding?.findingId === finding.findingId ? 'border-primary bg-primary/5' : 'border-border bg-muted/15 hover:border-border/80'
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="font-medium text-foreground">{finding.title}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">{finding.target}</div>
                                        </div>
                                        <span className={clsx('rounded border px-2 py-0.5 text-[10px] font-semibold uppercase', severityTone[finding.severity])}>
                                            {finding.severity}
                                        </span>
                                    </div>
                                    <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">{finding.description}</div>
                                </button>
                            ))}
                        </div>
                    </ConsolePanel>
                </div>

                <div className="xl:col-span-4">
                    <ConsolePanel
                        title="证据与处置"
                        subtitle="在原页面里补齐证据展开、处置建议和动作创建"
                        icon={Wrench}
                        iconTone="primary"
                        headerAction={
                            <button
                                onClick={createAction}
                                disabled={!selectedFinding}
                                className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                创建处置动作
                            </button>
                        }
                    >
                        {!selectedFinding ? (
                            <ConsoleEmptyState title="选择一个发现项" description="点击左侧发现项后，这里会展开证据与修复建议。" />
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-semibold text-foreground">{selectedFinding.title}</h3>
                                        <span className={clsx('rounded border px-2 py-0.5 text-[10px] font-semibold uppercase', severityTone[selectedFinding.severity])}>
                                            {selectedFinding.severity}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm text-muted-foreground">{selectedFinding.description}</p>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    <div className="text-xs font-semibold text-foreground">证据</div>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                                        {JSON.stringify(selectedFinding.evidence || {}, null, 2)}
                                    </pre>
                                </div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">
                                    <div className="text-xs font-semibold text-foreground">处置建议</div>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                                        {JSON.stringify(selectedFinding.remediation || {}, null, 2)}
                                    </pre>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    状态：{selectedFinding.status} · 最近出现：{new Date(selectedFinding.lastSeenAt).toLocaleString('zh-CN')}
                                </div>
                                {actionMessage && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-300">{actionMessage}</div>}
                            </div>
                        )}
                    </ConsolePanel>
                </div>
            </div>

            <ConsolePanel title="任务时间线" subtitle="保留实时日志区，但同时展示结构化阶段事件" icon={Activity} iconTone="warning">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div ref={logRef} className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/15 p-3 font-mono text-xs">
                        {logs.length === 0 ? <div className="text-muted-foreground">暂无任务日志。</div> : logs.map((log, index) => <div key={`${log}-${index}`} className="mb-1 text-emerald-600 dark:text-emerald-400">{log}</div>)}
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/15 p-3 text-xs">
                        {timeline.length === 0 ? (
                            <div className="text-muted-foreground">暂无结构化时间线。</div>
                        ) : (
                            timeline.map((item, index) => (
                                <div key={`${item.eventType}-${index}`} className="mb-3 rounded-lg border border-border bg-background/60 p-3">
                                    <div className="font-medium text-foreground">{item.eventType}</div>
                                    <div className="mt-1 text-muted-foreground">{new Date(item.createdAt).toLocaleString('zh-CN')}</div>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                                        {JSON.stringify(item.payload || {}, null, 2)}
                                    </pre>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </ConsolePanel>
        </ConsolePage>
    );
};

export default Scanner;
