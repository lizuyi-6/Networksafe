import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Shield, Wrench } from 'lucide-react';
import { fetchScannerRunDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const ScannerRunDetail = () => {
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchScannerRunDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-SCAN-RUN-DETAIL'));
    }, [id]);

    const findings = detail?.result?.findings || [];
    const timeline = detail?.result?.timeline || [];

    return (
        <ConsolePage title="扫描任务详情" subtitle={`查看任务 ${id} 的阶段、证据与修复建议`} actions={<Link to="/scanner" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />返回扫描中心</Link>}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title="正在加载扫描详情" /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title="任务摘要" subtitle="当前状态与执行阶段" icon={Activity} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">状态：<span className="font-semibold text-foreground">{detail.summary?.status || '-'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">阶段：<span className="font-semibold text-foreground">{detail.summary?.phase || '-'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">进度：<span className="font-semibold text-foreground">{detail.summary?.progress || 0}%</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">错误：<span className="font-semibold text-foreground">{detail.summary?.error || '无'}</span></div>
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title="任务时间线" subtitle="阶段与结构化事件" icon={Activity} iconTone="neutral">
                            <div className="space-y-3">
                                {timeline.length > 0 ? timeline.map((item: any, index: number) => (
                                    <div key={`${item.eventType}-${index}`} className="rounded-lg border border-border bg-muted/15 p-3">
                                        <div className="font-medium text-foreground">{item.eventType}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(item.payload || {}, null, 2)}</pre>
                                    </div>
                                )) : <ConsoleEmptyState title="暂无结构化事件" />}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title="发现项" subtitle="任务产生的结构化安全发现" icon={Shield} iconTone="danger">
                            <div className="space-y-3">
                                {findings.length > 0 ? findings.map((finding: any) => (
                                    <div key={finding.findingId} className="rounded-lg border border-border bg-muted/15 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="font-medium text-foreground">{finding.title}</div>
                                                <div className="mt-1 text-xs text-muted-foreground">{finding.target}</div>
                                            </div>
                                            <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{finding.severity}</span>
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">{finding.description}</p>
                                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{JSON.stringify(finding.evidence || {}, null, 2)}</pre>
                                    </div>
                                )) : <ConsoleEmptyState title="暂无发现项" description="任务完成并产生命中后，这里会显示证据与风险摘要。" />}
                            </div>
                        </ConsolePanel>
                        <ConsolePanel title="修复建议" subtitle="从证据和规则链路归纳的处置建议" icon={Wrench} iconTone="warning">
                            {findings.length > 0 ? findings.map((finding: any) => (
                                <pre key={`${finding.findingId}-remediation`} className="mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-xs text-muted-foreground">{JSON.stringify(finding.remediation || {}, null, 2)}</pre>
                            )) : <ConsoleEmptyState title="暂无处置建议" />}
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default ScannerRunDetail;
