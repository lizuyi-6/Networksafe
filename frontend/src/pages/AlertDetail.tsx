import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock, Shield } from 'lucide-react';
import { fetchAlertDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const AlertDetail = () => {
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchAlertDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-ALERT-DETAIL'));
    }, [id]);

    return (
        <ConsolePage
            title="告警详情"
            subtitle={`查看告警 ${id} 的证据、时间线与关联对象`}
            actions={<Link to="/alerts" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />返回告警中心</Link>}
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? (
                <ConsoleEmptyState title="正在加载告警详情" />
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title={detail.summary?.title || id} subtitle={detail.summary?.message} icon={AlertTriangle} iconTone="danger">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">严重级别</div><div className="mt-1 font-semibold text-foreground">{detail.summary?.severity}</div></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">状态</div><div className="mt-1 font-semibold text-foreground">{detail.summary?.status}</div></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">来源</div><div className="mt-1 font-semibold text-foreground">{detail.summary?.source}</div></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-4 text-sm"><div className="text-xs text-muted-foreground">时间</div><div className="mt-1 font-semibold text-foreground">{new Date(detail.summary?.timestamp || Date.now()).toLocaleString()}</div></div>
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title="证据与关联扫描" subtitle="与本次告警相关的发现、扫描与流量会话" icon={Shield} iconTone="warning">
                            <div className="space-y-4">
                                {(detail.evidence || []).length > 0 ? (detail.evidence || []).map((item: any) => (
                                    <div key={item.findingId} className="rounded-lg border border-border bg-muted/15 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="font-medium text-foreground">{item.title}</div>
                                            <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{item.severity}</span>
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{JSON.stringify(item.evidence || {}, null, 2)}</pre>
                                    </div>
                                )) : <ConsoleEmptyState title="暂无结构化证据" description="后续扫描、验证和流量事件会在这里聚合。" />}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title="时间线" subtitle="告警状态与调查上下文" icon={Clock} iconTone="neutral">
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
                        <ConsolePanel title="关联动作" subtitle="已创建的调查与处置动作" icon={Shield} iconTone="primary">
                            {(detail.relatedActions || []).length > 0 ? (
                                <div className="space-y-3">
                                    {(detail.relatedActions || []).map((action: any) => (
                                        <div key={action.actionId} className="rounded-lg border border-border bg-muted/15 p-3 text-sm">
                                            <div className="font-medium text-foreground">{action.title}</div>
                                            <div className="mt-1 text-muted-foreground">{action.status} · {action.operator}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title="暂无关联动作" description="从扫描和告警页创建处置动作后，这里会显示执行记录。" />}
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default AlertDetail;
