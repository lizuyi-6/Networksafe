import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    Bot,
    CheckCircle2,
    Clock3,
    RefreshCw,
    Shield,
    ShieldAlert,
    XCircle
} from 'lucide-react';
import InputDialog from '../components/InputDialog';
import { useLanguage } from '../context/LanguageContext';
import { useLiveMode } from '../context/LiveModeContext';
import { ConsoleEmptyState, ConsolePage, ConsolePanel, ConsoleStatCard } from '../components/ConsolePrimitives';
import {
    approveRuleCandidate,
    fetchRuleCandidate,
    fetchRuleCandidates,
    fetchRuleEvents,
    fetchRules,
    isRequestAbortError,
    rejectRuleCandidate
} from '../services/api';
import type { DetectionEventRecord, RuleCandidateRecord, RuleRecord, RuleSummary } from '../types/api';

const emptySummary: RuleSummary = {
    totalRules: 0,
    activeRules: 0,
    pendingCandidates: 0,
    approvedCandidates: 0,
    rejectedCandidates: 0,
    ruleHitRate: 0,
    aiEscalationRate: 0,
    localModelHitRate: 0,
    avgProcessingTimeMs: 0,
    localAICount: 0,
    cloudAICount: 0,
    asyncReviewQueueDepth: 0,
    asyncReviewRunning: 0,
    asyncReviewCompleted: 0,
    asyncReviewFailed: 0,
    debateCompletionRate: 0,
    avgAsyncReviewLatencyMs: 0,
    classificationLevel: 'standard',
    blockingDiscussionCount: 0,
    blockingDiscussionFailClosed: 0,
    avgBlockingDiscussionLatencyMs: 0,
    topRules: []
};

const statusTone: Record<RuleCandidateRecord['status'], string> = {
    pending: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    approved: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    rejected: 'border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300'
};

const severityTone: Record<RuleRecord['severity'], string> = {
    critical: 'text-rose-600 dark:text-rose-300',
    high: 'text-orange-600 dark:text-orange-300',
    medium: 'text-amber-600 dark:text-amber-300',
    low: 'text-sky-600 dark:text-sky-300'
};

const safeNumber = (value: unknown, fallback: number = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const formatPercent = (value: unknown) => `${(safeNumber(value) * 100).toFixed(1)}%`;

const formatMs = (value: unknown) => `${safeNumber(value).toFixed(1)} ms`;

const formatJson = (value: unknown) => JSON.stringify(value || {}, null, 2);

const Rules = () => {
    const { t } = useLanguage();
    const { liveModeEnabled } = useLiveMode();
    const [summary, setSummary] = useState<RuleSummary>(emptySummary);
    const [rules, setRules] = useState<RuleRecord[]>([]);
    const [candidates, setCandidates] = useState<RuleCandidateRecord[]>([]);
    const [events, setEvents] = useState<DetectionEventRecord[]>([]);
    const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
    const [selectedCandidate, setSelectedCandidate] = useState<RuleCandidateRecord | null>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | RuleCandidateRecord['status']>('all');
    const [channelFilter, setChannelFilter] = useState<'all' | RuleCandidateRecord['channel']>('all');
    const [familyFilter, setFamilyFilter] = useState<'all' | RuleCandidateRecord['attackFamily']>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);

    const loadPage = async (signal?: AbortSignal) => {
        try {
            const [rulesPayload, candidatesPayload, eventsPayload] = await Promise.all([
                fetchRules(undefined, signal),
                fetchRuleCandidates(undefined, signal),
                fetchRuleEvents({ limit: 30 }, signal)
            ]);

            if (signal?.aborted) {
                return;
            }

            setRules(rulesPayload.rules || []);
            setSummary(rulesPayload.summary || emptySummary);
            setCandidates(candidatesPayload || []);
            setEvents(eventsPayload || []);
            setError(null);
        } catch (nextError: any) {
            if (!isRequestAbortError(nextError, signal)) {
                setError(nextError?.message || 'FG-RULES-PAGE');
            }
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        let disposed = false;
        let controller: AbortController | null = null;

        const refresh = async () => {
            const nextController = new AbortController();
            controller?.abort();
            controller = nextController;
            await loadPage(nextController.signal);
        };

        void refresh();

        if (!liveModeEnabled) {
            return () => {
                disposed = true;
                controller?.abort();
            };
        }

        const interval = window.setInterval(() => {
            if (!disposed) {
                void refresh();
            }
        }, 8000);

        return () => {
            disposed = true;
            controller?.abort();
            window.clearInterval(interval);
        };
    }, [liveModeEnabled]);

    const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
        if (statusFilter !== 'all' && candidate.status !== statusFilter) {
            return false;
        }
        if (channelFilter !== 'all' && candidate.channel !== channelFilter) {
            return false;
        }
        if (familyFilter !== 'all' && candidate.attackFamily !== familyFilter) {
            return false;
        }
        return true;
    }), [candidates, statusFilter, channelFilter, familyFilter]);

    const attackFamilies = useMemo(() => Array.from(new Set(candidates.map((candidate) => candidate.attackFamily))), [candidates]);

    useEffect(() => {
        if (filteredCandidates.length === 0) {
            setSelectedCandidateId(null);
            setSelectedCandidate(null);
            return;
        }

        const stillVisible = filteredCandidates.some((candidate) => candidate.candidateId === selectedCandidateId);
        if (!stillVisible) {
            setSelectedCandidateId(filteredCandidates[0].candidateId);
        }
    }, [filteredCandidates, selectedCandidateId]);

    useEffect(() => {
        if (!selectedCandidateId) {
            setSelectedCandidate(null);
            return;
        }

        const controller = new AbortController();
        fetchRuleCandidate(selectedCandidateId, controller.signal)
            .then((candidate) => {
                if (!controller.signal.aborted) {
                    setSelectedCandidate(candidate);
                }
            })
            .catch((nextError) => {
                if (!isRequestAbortError(nextError, controller.signal)) {
                    setActionError((nextError as Error)?.message || 'FG-RULE-CANDIDATE-DETAIL');
                }
            });

        return () => controller.abort();
    }, [selectedCandidateId]);

    const refreshAll = async () => {
        setLoading(true);
        await loadPage();
    };

    const [showApproveDialog, setShowApproveDialog] = useState(false);
    const [showRejectDialog, setShowRejectDialog] = useState(false);

    const handleApproval = () => {
        if (!selectedCandidate) return;
        setShowApproveDialog(true);
    };

    const submitApproval = async (reason: string) => {
        if (!selectedCandidate) return;
        setShowApproveDialog(false);
        try {
            setActionError(null);
            const result = await approveRuleCandidate(selectedCandidate.candidateId, reason || undefined);
            if (result.sync && selectedCandidate.channel === 'agent') {
                setSyncMessage(t('rules.agent_sync_message', { succeeded: result.sync.succeeded, attempted: result.sync.attempted }));
            } else {
                setSyncMessage(t('rules.approved_sync_message'));
            }
            await loadPage();
            const detail = await fetchRuleCandidate(selectedCandidate.candidateId);
            setSelectedCandidate(detail);
        } catch (nextError: any) {
            setActionError(nextError?.message || 'FG-RULE-CANDIDATE-APPROVE');
        }
    };

    const handleReject = () => {
        if (!selectedCandidate) return;
        setShowRejectDialog(true);
    };

    const submitReject = async (reason: string) => {
        if (!selectedCandidate) return;
        setShowRejectDialog(false);
        try {
            setActionError(null);
            setSyncMessage(null);
            await rejectRuleCandidate(selectedCandidate.candidateId, reason || undefined);
            await loadPage();
            const detail = await fetchRuleCandidate(selectedCandidate.candidateId);
            setSelectedCandidate(detail);
        } catch (nextError: any) {
            setActionError(nextError?.message || 'FG-RULE-CANDIDATE-REJECT');
        }
    };

    const activeRules = useMemo(() => rules.filter((rule) => rule.enabled), [rules]);

    return (
        <>
        <InputDialog
            open={showApproveDialog}
            title={t('rules.approve')}
            label={t('rules.approval_note_prompt')}
            defaultValue={selectedCandidate?.reviewReason || ''}
            confirmLabel={t('rules.approve')}
            cancelLabel={t('rules.cancel') || 'Cancel'}
            onConfirm={(reason) => void submitApproval(reason)}
            onCancel={() => setShowApproveDialog(false)}
        />
        <InputDialog
            open={showRejectDialog}
            title={t('rules.reject')}
            label={t('rules.rejection_note_prompt')}
            defaultValue={selectedCandidate?.reviewReason || ''}
            confirmLabel={t('rules.reject')}
            cancelLabel={t('rules.cancel') || 'Cancel'}
            onConfirm={(reason) => void submitReject(reason)}
            onCancel={() => setShowRejectDialog(false)}
        />
        <ConsolePage
            title={t('rules.page_title')}
            subtitle={t('rules.page_subtitle')}
            actions={(
                <div className="flex flex-wrap items-center gap-2">
                    <Link
                        to="/alerts"
                        className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
                    >
                        {t('rules.open_alerts')}
                    </Link>
                    <button
                        data-testid="rules-refresh"
                        onClick={() => void refreshAll()}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        <RefreshCw size={14} />
                        {t('rules.refresh')}
                    </button>
                </div>
            )}
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {actionError && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{actionError}</div>}
            {syncMessage && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{syncMessage}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ConsoleStatCard icon={Shield} label={t('rules.active_rules')} value={summary.activeRules} hint={t('rules.total_hint', { count: summary.totalRules })} tone="primary" />
                <ConsoleStatCard icon={Bot} label={t('rules.pending_candidates')} value={summary.pendingCandidates} hint={t('rules.candidates_hint', { approved: summary.approvedCandidates, rejected: summary.rejectedCandidates })} tone="warning" />
                <ConsoleStatCard icon={Activity} label={t('rules.hit_rate')} value={formatPercent(summary.ruleHitRate)} hint={t('rules.ai_escalation_hint', { rate: formatPercent(summary.aiEscalationRate) })} tone="success" />
                <ConsoleStatCard icon={Clock3} label={t('rules.avg_detection_time')} value={formatMs(summary.avgProcessingTimeMs)} hint={t('rules.across_recent_events')} tone="neutral" />
                <ConsoleStatCard icon={Bot} label={t('rules.local_ai_calls')} value={summary.localAICount} hint={`local hit ${formatPercent(summary.localModelHitRate)} / cloud ${summary.cloudAICount}`} tone="primary" />
                <ConsoleStatCard icon={ShieldAlert} label="Async Reviews" value={safeNumber(summary.asyncReviewQueueDepth)} hint={`done ${safeNumber(summary.asyncReviewCompleted)}, failed ${safeNumber(summary.asyncReviewFailed)}`} tone="warning" />
                <ConsoleStatCard icon={Bot} label="Debate Completion" value={formatPercent(summary.debateCompletionRate)} hint={`${formatMs(summary.avgAsyncReviewLatencyMs)} async avg`} tone="neutral" />
                <ConsoleStatCard icon={ShieldAlert} label="Blocking Discussion" value={safeNumber(summary.blockingDiscussionCount)} hint={`${summary.classificationLevel || 'standard'} · fail-closed ${safeNumber(summary.blockingDiscussionFailClosed)} · ${formatMs(summary.avgBlockingDiscussionLatencyMs)}`} tone="danger" />
                <ConsoleStatCard icon={ShieldAlert} label={t('rules.top_rule_hits')} value={summary.topRules[0]?.hitCount || 0} hint={summary.topRules[0]?.name || t('rules.no_recent_hits')} tone="danger" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="space-y-6 xl:col-span-7">
                    <ConsolePanel
                        title={t('rules.rule_candidates')}
                        subtitle={t('rules.rule_candidates_subtitle')}
                        icon={Bot}
                        iconTone="warning"
                        headerAction={(
                            <div className="flex flex-wrap gap-2">
                                {(['all', 'pending', 'approved', 'rejected'] as const).map((value) => (
                                    <button
                                        key={value}
                                        data-testid={`rules-status-${value}`}
                                        onClick={() => setStatusFilter(value)}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                            statusFilter === value
                                                ? 'border border-primary bg-primary text-primary-foreground'
                                                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {value}
                                    </button>
                                ))}
                                {(['all', 'http_api', 'packet', 'agent'] as const).map((value) => (
                                    <button
                                        key={value}
                                        data-testid={`rules-channel-${value}`}
                                        onClick={() => setChannelFilter(value)}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                            channelFilter === value
                                                ? 'border border-primary bg-primary text-primary-foreground'
                                                : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {value}
                                    </button>
                                ))}
                                <select
                                    data-testid="rules-family-filter"
                                    value={familyFilter}
                                    onChange={(event) => setFamilyFilter(event.target.value as typeof familyFilter)}
                                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground"
                                >
                                    <option value="all">{t('rules.all_families')}</option>
                                    {attackFamilies.map((family) => (
                                        <option key={family} value={family}>{family}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    >
                        {loading && candidates.length === 0 ? (
                            <div className="text-sm text-muted-foreground">{t('rules.loading_candidates')}</div>
                        ) : filteredCandidates.length === 0 ? (
                            <ConsoleEmptyState title={t('rules.no_candidates_title')} description={t('rules.no_candidates_desc')} />
                        ) : (
                            <div className="space-y-3">
                                {filteredCandidates.map((candidate) => {
                                    const selected = candidate.candidateId === selectedCandidateId;
                                    return (
                                        <button
                                            key={candidate.candidateId}
                                            data-testid={`rules-candidate-${candidate.candidateId}`}
                                            type="button"
                                            onClick={() => setSelectedCandidateId(candidate.candidateId)}
                                            className={`w-full rounded-xl border p-4 text-left transition-colors ${
                                                selected
                                                    ? 'border-primary bg-primary/5'
                                                    : 'border-border bg-muted/10 hover:bg-muted/20'
                                            }`}
                                        >
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-semibold text-foreground">{candidate.name}</div>
                                                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                        <span>{candidate.channel}</span>
                                                        <span>{candidate.attackFamily}</span>
                                                        <span>{t('rules.samples_count', { count: candidate.sampleCount })}</span>
                                                        <span>{t('rules.ai_confidence', { value: (safeNumber(candidate.aiConfidence) * 100).toFixed(0) })}</span>
                                                    </div>
                                                </div>
                                                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase ${statusTone[candidate.status]}`}>
                                                    {candidate.status}
                                                </span>
                                            </div>
                                            <div className="mt-3 text-xs text-muted-foreground">
                                                {t('rules.updated')} {new Date(candidate.updatedAt).toLocaleString()}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </ConsolePanel>

                    <ConsolePanel
                        title={t('rules.candidate_detail')}
                        subtitle={t('rules.candidate_detail_subtitle')}
                        icon={ShieldAlert}
                        iconTone="danger"
                        headerAction={selectedCandidate ? (
                            <div className="flex gap-2">
                                <button
                                    data-testid="rules-approve-candidate"
                                    onClick={() => void handleApproval()}
                                    disabled={selectedCandidate.status === 'approved'}
                                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <CheckCircle2 size={14} />
                                    {t('rules.approve')}
                                </button>
                                <button
                                    data-testid="rules-reject-candidate"
                                    onClick={() => void handleReject()}
                                    disabled={selectedCandidate.status === 'rejected'}
                                    className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <XCircle size={14} />
                                    {t('rules.reject')}
                                </button>
                            </div>
                        ) : undefined}
                    >
                        {!selectedCandidate ? (
                            <ConsoleEmptyState title={t('rules.select_candidate_title')} description={t('rules.select_candidate_desc')} />
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rules.candidate')}</div>
                                        <div className="mt-2 text-base font-semibold text-foreground">{selectedCandidate.name}</div>
                                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                                            <div>{t('rules.channel')}: <span className="font-medium text-foreground">{selectedCandidate.channel}</span></div>
                                            <div>{t('rules.attack_family')}: <span className="font-medium text-foreground">{selectedCandidate.attackFamily}</span></div>
                                            <div>{t('rules.ai_confidence_label')}: <span className="font-medium text-foreground">{formatPercent(selectedCandidate.aiConfidence)}</span></div>
                                            <div>{t('rules.samples')}: <span className="font-medium text-foreground">{selectedCandidate.sampleCount}</span></div>
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rules.review_history')}</div>
                                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                                            <div>{t('rules.status')}: <span className="font-medium text-foreground">{selectedCandidate.status}</span></div>
                                            <div>{t('rules.created')}: <span className="font-medium text-foreground">{new Date(selectedCandidate.createdAt).toLocaleString()}</span></div>
                                            <div>{t('rules.updated_label')}: <span className="font-medium text-foreground">{new Date(selectedCandidate.updatedAt).toLocaleString()}</span></div>
                                            <div>{t('rules.reviewed_by')}: <span className="font-medium text-foreground">{selectedCandidate.reviewedBy || '-'}</span></div>
                                            <div>{t('rules.reviewed_at')}: <span className="font-medium text-foreground">{selectedCandidate.reviewedAt ? new Date(selectedCandidate.reviewedAt).toLocaleString() : '-'}</span></div>
                                            <div>{t('rules.review_note')}: <span className="font-medium text-foreground">{selectedCandidate.reviewReason || '-'}</span></div>
                                            <div>{t('rules.approved_rule')}: <span className="font-medium text-foreground">{selectedCandidate.approvedRuleId || '-'}</span></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-xl border border-border bg-muted/10 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rules.ai_reasoning')}</div>
                                    <p className="mt-2 text-sm leading-6 text-foreground">{selectedCandidate.reasoning}</p>
                                </div>
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rules.matcher')}</div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{formatJson(selectedCandidate.matcher)}</pre>
                                    </div>
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('rules.latest_evidence')}</div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{formatJson(selectedCandidate.latestEvidence)}</pre>
                                    </div>
                                </div>
                            </div>
                        )}
                    </ConsolePanel>
                </div>

                <div className="space-y-6 xl:col-span-5">
                    <ConsolePanel
                        title={t('rules.active_rules_panel')}
                        subtitle={t('rules.active_rules_subtitle')}
                        icon={Shield}
                        iconTone="primary"
                    >
                        {activeRules.length === 0 ? (
                            <ConsoleEmptyState title={t('rules.no_active_rules_title')} description={t('rules.no_active_rules_desc')} />
                        ) : (
                            <div className="space-y-3">
                                {activeRules.slice(0, 12).map((rule) => (
                                    <div key={rule.ruleId} className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-semibold text-foreground">{rule.name}</div>
                                                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                    <span>{rule.scope}</span>
                                                    <span>{rule.action}</span>
                                                    <span>{rule.source}</span>
                                                    <span>{t('rules.priority', { value: rule.priority })}</span>
                                                </div>
                                            </div>
                                            <span className={`text-xs font-semibold uppercase ${severityTone[rule.severity]}`}>{rule.severity}</span>
                                        </div>
                                        {rule.description && <p className="mt-2 text-sm text-muted-foreground">{rule.description}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </ConsolePanel>

                    <ConsolePanel
                        title={t('rules.recent_events')}
                        subtitle={t('rules.recent_events_subtitle')}
                        icon={Activity}
                        iconTone="success"
                    >
                        {events.length === 0 ? (
                            <ConsoleEmptyState title={t('rules.no_events_title')} description={t('rules.no_events_desc')} />
                        ) : (
                            <div className="space-y-3">
                                {events.map((event) => (
                                    <div key={event.detectionEventId} className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-semibold text-foreground">{event.channel} / {event.verdict}</div>
                                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                <span>{event.attackFamily}</span>
                                                <span>{t('rules.risk_score', { value: safeNumber(event.riskScore).toFixed(2) })}</span>
                                                <span>{event.processingTimeMs} ms</span>
                                                <span>{event.blockingDiscussion ? `${event.discussionStatus || 'blocking'} review` : event.queuedForAsyncReview ? 'async review queued' : event.escalatedToAI ? t('rules.ai_escalated') : t('rules.rules_only')}</span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</div>
                                    </div>
                                    <div className="mt-2 text-xs text-muted-foreground">
                                            {t('rules.source')}: <span className="font-medium text-foreground">{event.decisionSource}</span>
                                            {event.candidateId && <span> | {t('rules.candidate')} {event.candidateId}</span>}
                                            {event.aiVerdict && <span> | AI {event.aiVerdict} {(event.aiConfidence || 0) * 100 >= 0 ? `(${((event.aiConfidence || 0) * 100).toFixed(0)}%)` : ''}</span>}
                                            {event.classificationLevel && <span> | {event.classificationLevel}</span>}
                                            {event.blockingDiscussion && <span> | {event.discussionLatencyMs || 0} ms</span>}
                                        </div>
                                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{formatJson(event.requestSnapshot)}</pre>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ConsolePanel>
                </div>
            </div>
        </ConsolePage>
        </>
    );
};

export default Rules;
