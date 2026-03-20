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
    avgProcessingTimeMs: 0,
    localAICount: 0,
    cloudAICount: 0,
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

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const formatJson = (value: unknown) => JSON.stringify(value || {}, null, 2);

const Rules = () => {
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

    const handleApproval = async () => {
        if (!selectedCandidate) {
            return;
        }

        const reason = window.prompt('Approval note (optional)', selectedCandidate.reviewReason || '');
        if (reason === null) {
            return;
        }

        try {
            setActionError(null);
            const result = await approveRuleCandidate(selectedCandidate.candidateId, reason || undefined);
            if (result.sync && selectedCandidate.channel === 'agent') {
                setSyncMessage(`Agent sync ${result.sync.succeeded}/${result.sync.attempted} succeeded.`);
            } else {
                setSyncMessage('Candidate approved and rule set refreshed.');
            }
            await loadPage();
            const detail = await fetchRuleCandidate(selectedCandidate.candidateId);
            setSelectedCandidate(detail);
        } catch (nextError: any) {
            setActionError(nextError?.message || 'FG-RULE-CANDIDATE-APPROVE');
        }
    };

    const handleReject = async () => {
        if (!selectedCandidate) {
            return;
        }

        const reason = window.prompt('Rejection note (optional)', selectedCandidate.reviewReason || '');
        if (reason === null) {
            return;
        }

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
        <ConsolePage
            title="Rule Operations"
            subtitle="Rule-first detection, AI escalation, candidate review, and delivery telemetry in one admin console."
            actions={(
                <div className="flex flex-wrap items-center gap-2">
                    <Link
                        to="/alerts"
                        className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
                    >
                        Open Alerts
                    </Link>
                    <button
                        onClick={() => void refreshAll()}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            )}
        >
            {error && <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}
            {actionError && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{actionError}</div>}
            {syncMessage && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{syncMessage}</div>}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ConsoleStatCard icon={Shield} label="Active Rules" value={summary.activeRules} hint={`${summary.totalRules} total`} tone="primary" />
                <ConsoleStatCard icon={Bot} label="Pending Candidates" value={summary.pendingCandidates} hint={`${summary.approvedCandidates} approved / ${summary.rejectedCandidates} rejected`} tone="warning" />
                <ConsoleStatCard icon={Activity} label="Rule Hit Rate" value={formatPercent(summary.ruleHitRate)} hint={`AI escalation ${formatPercent(summary.aiEscalationRate)}`} tone="success" />
                <ConsoleStatCard icon={Clock3} label="Average Detection Time" value={`${summary.avgProcessingTimeMs.toFixed(1)} ms`} hint="Across recent detection events" tone="neutral" />
                <ConsoleStatCard icon={Bot} label="Local AI Calls" value={summary.localAICount} hint={`Cloud ${summary.cloudAICount}`} tone="primary" />
                <ConsoleStatCard icon={ShieldAlert} label="Top Rule Hits" value={summary.topRules[0]?.hitCount || 0} hint={summary.topRules[0]?.name || 'No recent hits'} tone="danger" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="space-y-6 xl:col-span-7">
                    <ConsolePanel
                        title="Rule Candidates"
                        subtitle="Review AI-learned malicious patterns before they are promoted into active rules."
                        icon={Bot}
                        iconTone="warning"
                        headerAction={(
                            <div className="flex flex-wrap gap-2">
                                {(['all', 'pending', 'approved', 'rejected'] as const).map((value) => (
                                    <button
                                        key={value}
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
                                    value={familyFilter}
                                    onChange={(event) => setFamilyFilter(event.target.value as typeof familyFilter)}
                                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground"
                                >
                                    <option value="all">all families</option>
                                    {attackFamilies.map((family) => (
                                        <option key={family} value={family}>{family}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    >
                        {loading && candidates.length === 0 ? (
                            <div className="text-sm text-muted-foreground">Loading rule candidates...</div>
                        ) : filteredCandidates.length === 0 ? (
                            <ConsoleEmptyState title="No candidates match the current filters." description="AI-learned candidates will appear here after high-risk allowed traffic is escalated and judged malicious." />
                        ) : (
                            <div className="space-y-3">
                                {filteredCandidates.map((candidate) => {
                                    const selected = candidate.candidateId === selectedCandidateId;
                                    return (
                                        <button
                                            key={candidate.candidateId}
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
                                                        <span>{candidate.sampleCount} samples</span>
                                                        <span>{(candidate.aiConfidence * 100).toFixed(0)}% AI confidence</span>
                                                    </div>
                                                </div>
                                                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase ${statusTone[candidate.status]}`}>
                                                    {candidate.status}
                                                </span>
                                            </div>
                                            <div className="mt-3 text-xs text-muted-foreground">
                                                Updated {new Date(candidate.updatedAt).toLocaleString()}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </ConsolePanel>

                    <ConsolePanel
                        title="Candidate Detail"
                        subtitle="Matcher, latest evidence, AI reasoning, and review history for the selected candidate."
                        icon={ShieldAlert}
                        iconTone="danger"
                        headerAction={selectedCandidate ? (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => void handleApproval()}
                                    disabled={selectedCandidate.status === 'approved'}
                                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <CheckCircle2 size={14} />
                                    Approve
                                </button>
                                <button
                                    onClick={() => void handleReject()}
                                    disabled={selectedCandidate.status === 'rejected'}
                                    className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <XCircle size={14} />
                                    Reject
                                </button>
                            </div>
                        ) : undefined}
                    >
                        {!selectedCandidate ? (
                            <ConsoleEmptyState title="Select a candidate to inspect matcher and evidence." description="The detail panel keeps approval and rejection on the same page so the review loop stays short." />
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidate</div>
                                        <div className="mt-2 text-base font-semibold text-foreground">{selectedCandidate.name}</div>
                                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                                            <div>Channel: <span className="font-medium text-foreground">{selectedCandidate.channel}</span></div>
                                            <div>Attack family: <span className="font-medium text-foreground">{selectedCandidate.attackFamily}</span></div>
                                            <div>AI confidence: <span className="font-medium text-foreground">{(selectedCandidate.aiConfidence * 100).toFixed(1)}%</span></div>
                                            <div>Samples: <span className="font-medium text-foreground">{selectedCandidate.sampleCount}</span></div>
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review History</div>
                                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                                            <div>Status: <span className="font-medium text-foreground">{selectedCandidate.status}</span></div>
                                            <div>Created: <span className="font-medium text-foreground">{new Date(selectedCandidate.createdAt).toLocaleString()}</span></div>
                                            <div>Updated: <span className="font-medium text-foreground">{new Date(selectedCandidate.updatedAt).toLocaleString()}</span></div>
                                            <div>Reviewed by: <span className="font-medium text-foreground">{selectedCandidate.reviewedBy || '-'}</span></div>
                                            <div>Reviewed at: <span className="font-medium text-foreground">{selectedCandidate.reviewedAt ? new Date(selectedCandidate.reviewedAt).toLocaleString() : '-'}</span></div>
                                            <div>Review note: <span className="font-medium text-foreground">{selectedCandidate.reviewReason || '-'}</span></div>
                                            <div>Approved rule: <span className="font-medium text-foreground">{selectedCandidate.approvedRuleId || '-'}</span></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-xl border border-border bg-muted/10 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Reasoning</div>
                                    <p className="mt-2 text-sm leading-6 text-foreground">{selectedCandidate.reasoning}</p>
                                </div>
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matcher</div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{formatJson(selectedCandidate.matcher)}</pre>
                                    </div>
                                    <div className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest Evidence</div>
                                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">{formatJson(selectedCandidate.latestEvidence)}</pre>
                                    </div>
                                </div>
                            </div>
                        )}
                    </ConsolePanel>
                </div>

                <div className="space-y-6 xl:col-span-5">
                    <ConsolePanel
                        title="Active Rules"
                        subtitle="Approved candidate rules sit here alongside seed and dynamic rules already active in the pipeline."
                        icon={Shield}
                        iconTone="primary"
                    >
                        {activeRules.length === 0 ? (
                            <ConsoleEmptyState title="No active rules available." description="Approved and seed rules will appear here once the detection pipeline has been initialized." />
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
                                                    <span>priority {rule.priority}</span>
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
                        title="Recent Detection Events"
                        subtitle="Use the event stream to verify the full loop: rule hit, AI escalation, candidate generation, and operator decision."
                        icon={Activity}
                        iconTone="success"
                    >
                        {events.length === 0 ? (
                            <ConsoleEmptyState title="No detection events yet." description="Events are recorded when rules match, AI review is triggered, or candidates are generated." />
                        ) : (
                            <div className="space-y-3">
                                {events.map((event) => (
                                    <div key={event.detectionEventId} className="rounded-xl border border-border bg-muted/10 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-semibold text-foreground">{event.channel} / {event.verdict}</div>
                                                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                    <span>{event.attackFamily}</span>
                                                    <span>risk {event.riskScore.toFixed(2)}</span>
                                                    <span>{event.processingTimeMs} ms</span>
                                                    <span>{event.escalatedToAI ? 'AI escalated' : 'Rules only'}</span>
                                                </div>
                                            </div>
                                            <div className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</div>
                                        </div>
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            Source: <span className="font-medium text-foreground">{event.decisionSource}</span>
                                            {event.candidateId && <span> | Candidate {event.candidateId}</span>}
                                            {event.aiVerdict && <span> | AI {event.aiVerdict} {(event.aiConfidence || 0) * 100 >= 0 ? `(${((event.aiConfidence || 0) * 100).toFixed(0)}%)` : ''}</span>}
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
    );
};

export default Rules;
