import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History, Wrench } from 'lucide-react';
import { fetchFixHistoryDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';
import StructuredDataView from '../components/StructuredDataView';

const FixHistoryDetail = () => {
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchFixHistoryDetail(id)
            .then((response) => setDetail(response || null))
            .catch((err: any) => setError(err.message || 'FG-HISTORY-DETAIL'));
    }, [id]);

    return (
        <ConsolePage title="修复记录详情" subtitle={`查看记录 ${id} 的状态、阶段与发现项`} actions={<Link to="/history" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />返回修复历史</Link>}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title="正在加载修复记录" /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={detail.id} subtitle="任务摘要" icon={History} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">状态：<span className="font-semibold text-foreground">{detail.status}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">阶段：<span className="font-semibold text-foreground">{detail.phase}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">进度：<span className="font-semibold text-foreground">{detail.progress}%</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">错误：<span className="font-semibold text-foreground">{detail.error || '无'}</span></div>
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title="修复摘要" subtitle="结果统计与剩余工作" icon={Wrench} iconTone="warning">
                            <StructuredDataView value={detail.summary || {}} emptyLabel="暂无修复摘要" />
                        </ConsolePanel>
                        <ConsolePanel title="发现项" subtitle="本次记录关联的风险与修复对象" icon={History} iconTone="neutral">
                            {(detail.findings || []).length > 0 ? (
                                <div className="space-y-3">
                                    {(detail.findings || []).map((finding: any, index: number) => (
                                        <div key={`${finding.title}-${index}`} className="rounded-lg border border-border bg-muted/15 p-4">
                                            <div className="font-medium text-foreground">{finding.title}</div>
                                            <div className="mt-1 text-sm text-muted-foreground">{finding.description}</div>
                                            <div className="mt-2 text-xs text-muted-foreground">{finding.target_type} · {finding.target} · {finding.severity}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title="暂无关联发现项" />}
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default FixHistoryDetail;
