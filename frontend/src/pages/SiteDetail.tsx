import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Globe, Shield, Workflow } from 'lucide-react';
import { fetchSiteDetail } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

const SiteDetail = () => {
    const { id = '' } = useParams();
    const [detail, setDetail] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchSiteDetail(id)
            .then((response) => setDetail(response?.data || null))
            .catch((err: any) => setError(err.message || 'FG-SITE-DETAIL'));
    }, [id]);

    return (
        <ConsolePage title="站点详情" subtitle={`查看站点 ${id} 的暴露面、关联事件与安全上下文`} actions={<Link to="/sites" className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/30"><ArrowLeft size={14} />返回站点列表</Link>}>
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {!detail ? <ConsoleEmptyState title="正在加载站点详情" /> : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                    <div className="space-y-6 xl:col-span-4">
                        <ConsolePanel title={detail.domain || id} subtitle={detail.target} icon={Globe} iconTone="primary">
                            <div className="space-y-3 text-sm">
                                <div className="rounded-lg border border-border bg-muted/15 p-3">状态：<span className="font-semibold text-foreground">{detail.status || 'unknown'}</span></div>
                                <div className="rounded-lg border border-border bg-muted/15 p-3">目标：<span className="font-semibold text-foreground">{detail.target}</span></div>
                                {detail.securityOverview?.asset && <div className="rounded-lg border border-border bg-muted/15 p-3">风险分：<span className="font-semibold text-foreground">{detail.securityOverview.asset.riskScore}</span></div>}
                            </div>
                        </ConsolePanel>
                    </div>
                    <div className="space-y-6 xl:col-span-8">
                        <ConsolePanel title="关联告警" subtitle="与该站点相关的风险与事件" icon={Shield} iconTone="danger">
                            {(detail.relatedAlerts || detail.securityOverview?.alerts || []).length > 0 ? (
                                <div className="space-y-3">
                                    {(detail.relatedAlerts || detail.securityOverview?.alerts || []).map((item: any, index: number) => (
                                        <div key={item.id || item.alertId || index} className="rounded-lg border border-border bg-muted/15 p-4">
                                            <div className="font-medium text-foreground">{item.title}</div>
                                            <div className="mt-1 text-sm text-muted-foreground">{item.message || item.status}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : <ConsoleEmptyState title="暂无关联告警" />}
                        </ConsolePanel>
                        <ConsolePanel title="关联流量与暴露面" subtitle="最近关联的流量与资产上下文" icon={Workflow} iconTone="warning">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/15 p-3 text-xs text-muted-foreground">{JSON.stringify({ flows: detail.relatedFlows || [], overview: detail.securityOverview || null }, null, 2)}</pre>
                        </ConsolePanel>
                    </div>
                </div>
            )}
        </ConsolePage>
    );
};

export default SiteDetail;
