import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { Activity, ArrowLeft, Scan, Server, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { fetchAgentDetail, triggerAgentScan } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const AgentDetail = () => {
    const { t } = useLanguage();
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const response = await fetchAgentDetail(id);
            setDetail(response?.data || null);
        } catch (err: any) {
            setError(err.message || 'FG-AGENT-DETAIL');
        }
    };

    useEffect(() => {
        void load();
    }, [id]);

    const summary = detail?.summary;

    return (
        <ConsolePage title="智能体详情" subtitle={`查看智能体 ${id} 的健康、能力与事件`} actions={<div className="flex gap-2"><Link to="/agents" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />返回智能体</Link><button onClick={async () => { try { const response = await triggerAgentScan(id); setMessage(response?.message || 'Scan queued'); await load(); } catch (err: any) { setError(err.message || 'FG-AGENT-SCAN'); } }} disabled={!summary?.isOnline} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Scan size={14} />发起扫描</button></div>}>
            {message && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-300">{message}</div>}
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title="正在加载智能体详情" /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={summary?.hostname || summary?.agentId} subtitle={summary?.agentId} icon={Server} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="flex items-center gap-2 text-foreground">{summary?.isOnline ? <Wifi size={14} className="text-emerald-500" /> : <WifiOff size={14} className="text-rose-500" />}{summary?.isOnline ? '在线' : '离线'}</div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">平台：<span className="font-semibold text-foreground">{summary?.platform || '-'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">最近心跳：<span className="font-semibold text-foreground">{summary?.lastHeartbeat ? new Date(summary.lastHeartbeat).toLocaleString() : '-'}</span></div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-lg border border-border bg-muted/15 p-3"><div className="text-xs text-muted-foreground">CPU</div><div className="mt-1 font-semibold text-foreground">{summary?.status?.cpuUsage ?? '--'}%</div></div>
                                    <div className="rounded-lg border border-border bg-muted/15 p-3"><div className="text-xs text-muted-foreground">内存</div><div className="mt-1 font-semibold text-foreground">{summary?.status?.memoryUsage ?? '--'}%</div></div>
                                </div>
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title="运行能力" subtitle="版本、架构与资源描述" icon={Activity} iconTone="warning">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-xs text-muted-foreground">{JSON.stringify(detail.capabilities || {}, null, 2)}</pre>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={t('agentDetail.recent_threats')} subtitle="与该智能体关联的安全事件" icon={ShieldAlert} iconTone="danger">
                            {(detail.recentThreats || []).length > 0 ? (
                                <div className="space-y-3">
                                    {detail.recentThreats.map((item: any, index: number) => (
                                        <div key={item.id || index} className="rounded-lg border border-border bg-muted/15 p-4">
                                            <div className="font-medium text-foreground">{item.title || '安全事件'}</div>
                                            <div className="mt-1 text-sm text-muted-foreground">{item.message}</div>
                                            <div className="mt-2 text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title={t('agentDetail.no_threats')} description="扫描和策略命中后，这里会显示与该智能体相关的事件。" />}
                        </ConsolePanel>
                        <ConsolePanel title={t('agentDetail.status_timeline')} subtitle="心跳和运行态变化" icon={Activity} iconTone="neutral">
                            <div className="space-y-3">
                                {(detail.timeline || []).map((item: any, index: number) => (
                                    <div key={`${item.title}-${index}`} className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div className="font-medium text-foreground">{item.title}</div>
                                        {item.description && <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>}
                                        {item.timestamp && <div className="mt-1 text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</div>}
                                    </div>
                                ))}
                            </div>
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default AgentDetail;
