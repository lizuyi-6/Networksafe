import { useState } from 'react';
import { Code, Shield, Zap } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ConsolePanel, ConsoleEmptyState } from '../ConsolePrimitives';
import { TabButton } from './TabButton';
import type { DashboardSecuritySummary } from '../../types/api';

interface SecurityOpsPanelProps {
    rules: { totalRules: number; topRules: any[] };
    actions: DashboardSecuritySummary['recentActions'];
    validations: DashboardSecuritySummary['recentValidations'];
    emptyRulesDescription: string;
}

export const SecurityOpsPanel = ({ rules, actions, validations, emptyRulesDescription }: SecurityOpsPanelProps) => {
    const { t } = useLanguage();
    const [tab, setTab] = useState<'rules' | 'actions'>('rules');

    return (
        <ConsolePanel
            title={t('dashboard.security_ops')}
            subtitle={t('dashboard.active_rules_subtitle')}
            icon={Shield}
            iconTone="primary"
        >
            {/* Tab switcher */}
            <div className="mb-4 flex gap-1 rounded-lg bg-muted p-0.5">
                <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>
                    {t('dashboard.tab_rules')} ({rules.totalRules})
                </TabButton>
                <TabButton active={tab === 'actions'} onClick={() => setTab('actions')}>
                    {t('dashboard.tab_actions')}
                </TabButton>
            </div>

            {tab === 'rules' ? (
                <div className="space-y-3">
                    {(rules.topRules || []).length > 0 ? (
                        (rules.topRules || []).slice(0, 5).map((rule: any) => (
                            <div
                                key={rule.id}
                                className="flex items-center justify-between rounded-xl border border-border bg-muted/15 p-3 transition-colors hover:bg-muted/25"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                                        <Code size={16} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-foreground">
                                            {rule.name || rule.id}
                                        </div>
                                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                            {t('dashboard.severity_level', { level: rule.severity || 'unknown' })}
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-md border border-primary/15 bg-primary/10 px-2 py-1 font-mono text-sm font-semibold text-primary">
                                    {rule.count || 0}
                                </div>
                            </div>
                        ))
                    ) : (
                        <ConsoleEmptyState title={t('dashboard.no_rules')} description={emptyRulesDescription} />
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {(actions || []).length > 0 || (validations || []).length > 0 ? (
                        <>
                            {(actions || []).slice(0, 3).map((action) => (
                                <div key={action.actionId} className="rounded-xl border border-border bg-muted/15 p-3">
                                    <div className="flex items-center gap-2">
                                        <Zap size={14} className="text-amber-500" />
                                        <span className="text-sm font-semibold text-foreground">{action.title}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{action.status}</span>
                                        <span>{new Date(action.updatedAt || action.createdAt).toLocaleString()}</span>
                                    </div>
                                </div>
                            ))}
                            {(validations || []).slice(0, 2).map((validation) => (
                                <div key={validation.validationRunId} className="rounded-xl border border-border bg-muted/15 p-3">
                                    <div className="flex items-center gap-2">
                                        <Shield size={14} className="text-emerald-500" />
                                        <span className="text-sm font-semibold text-foreground">{validation.attackName}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{validation.verdict}</span>
                                        <span>{new Date(validation.completedAt).toLocaleString()}</span>
                                    </div>
                                </div>
                            ))}
                        </>
                    ) : (
                        <ConsoleEmptyState title={t('dashboard.no_recent_actions')} description={t('dashboard.no_recent_actions_desc')} />
                    )}
                </div>
            )}
        </ConsolePanel>
    );
};
