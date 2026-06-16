import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    BrainCircuit,
    Cloud,
    Cpu,
    Gauge,
    GitBranch,
    Layers,
    Activity,
    X,
    Zap,
    Shield,
    Crosshair,
    Sparkles,
    ScrollText,
    RefreshCw,
    CircleDot
} from 'lucide-react';
import { ConsolePage } from '../components/ConsolePrimitives';
import { fetchMultiAgentTopology, type MultiAgentTopology, type MultiAgentLayerNode, type MultiAgentRoleNode, type MultiAgentCascadeTraceEntry } from '../services/api';

// ---------------------------------------------------------------------------
// Static fallback — mirrors the backend DEFAULT_CONFIG so the visualization
// always renders a faithful 7-layer map, even before the system reports in.
// ---------------------------------------------------------------------------

const FALLBACK_LAYERS: MultiAgentLayerNode[] = [
    { num: 1, key: 'l1_collaboration', name: 'Collaboration', enabled: true, priority: 1, timeout: 5000, maxConcurrency: 10, thinkingDepth: 'shallow', modelTier: 'local', activation: { always: true } },
    { num: 2, key: 'l2_rolePlaying', name: 'Role Playing', enabled: true, priority: 2, timeout: 10000, maxConcurrency: 3, thinkingDepth: 'standard', modelTier: 'local', activation: { requiresLayers: [1] } },
    { num: 3, key: 'l3_sceneTraversal', name: 'Scene Traversal', enabled: true, priority: 3, timeout: 5000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { requiresLayers: [2], minRiskScore: 0.4 } },
    { num: 4, key: 'l4_capability', name: 'Capability', enabled: true, priority: 4, timeout: 30000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { requiresLayers: [2], minRiskScore: 0.6 } },
    { num: 5, key: 'l5_debate', name: 'Debate', enabled: true, priority: 5, timeout: 60000, maxConcurrency: 3, thinkingDepth: 'deep', modelTier: 'cloud', activation: { requiresLayers: [2], requiresDebateTrigger: true } },
    { num: 6, key: 'l6_heterogeneous', name: 'Heterogeneous Model', enabled: true, priority: 6, timeout: 30000, maxConcurrency: 10, thinkingDepth: 'deliberative', modelTier: 'cloud', activation: { requiresLayers: [2], requiresEscalation: true } },
    { num: 7, key: 'l7_synthesis', name: 'Synthesis', enabled: true, priority: 7, timeout: 5000, maxConcurrency: 5, thinkingDepth: 'standard', activation: { always: true } }
];

const FALLBACK_ROLES: MultiAgentRoleNode[] = [
    { role: 'socrates', team: 'red', color: '#ef4444', name: 'Socrates', position: 'attack', capabilities: ['mutation', 'bypass_detection', 'attack_simulation'], layer: 2 },
    { role: 'plato', team: 'blue', color: '#3b82f6', name: 'Plato', position: 'defend', capabilities: ['schema_validation', 'compliance_check', 'pattern_matching'], layer: 2 },
    { role: 'aristotle', team: 'analyst', color: '#a855f7', name: 'Aristotle', position: 'analyze', capabilities: ['anomaly_detection', 'behavior_analysis', 'statistical_analysis'], layer: 2 },
    { role: 'arbitrator', team: 'arbitrator', color: '#f59e0b', name: 'Arbitrator', position: 'resolve', capabilities: ['debate_resolution', 'final_decision', 'policy_enforcement'], layer: 5 }
];

const DEPTH_META: Record<NonNullable<MultiAgentLayerNode['thinkingDepth']>, { label: string; color: string; glow: string; bars: number; blurb: string }> = {
    shallow: { label: 'Shallow', color: '#64748b', glow: 'rgba(100,116,139,0.45)', bars: 1, blurb: 'Fast triage. Cheap, high-throughput, low token budget.' },
    standard: { label: 'Standard', color: '#0ea5e9', glow: 'rgba(14,165,233,0.5)', bars: 2, blurb: 'Role-team reasoning at a balanced temperature / token budget.' },
    deep: { label: 'Deep', color: '#8b5cf6', glow: 'rgba(139,92,246,0.6)', bars: 3, blurb: 'Multi-round deliberation. Engaged only on disagreement.' },
    deliberative: { label: 'Deliberative', color: '#f43f5e', glow: 'rgba(244,63,94,0.65)', bars: 4, blurb: 'Slow, high-budget cloud reasoning. Reserved for the hardest calls.' }
};

const LAYER_DESC: Record<number, string> = {
    1: 'Classifies the attack family and routes traffic to the right specialist team.',
    2: 'Three philosopher-agents analyze in parallel from red / blue / analyst perspectives.',
    3: 'Reconstructs the cross-service attack narrative from distributed traces.',
    4: 'Safe, sandboxed tool execution when deeper investigation is required.',
    5: 'Agents argue round-by-round; the arbitrator resolves with a recorded verdict.',
    6: 'Local fast model vs. cloud authoritative model — real heterogeneous verification.',
    7: 'Case files, lessons, and self-evolving policy suggestions are synthesized.'
};

type Selection =
    | { kind: 'layer'; num: number }
    | { kind: 'role'; role: string };

type Telemetry = MultiAgentTopology['telemetry'] | null;

// Live "armed" hint per layer — derived only from real telemetry with a direct mapping.
function layerArmed(num: number, t: Telemetry): boolean {
    if (!t) return false;
    switch (num) {
        case 1:
        case 2:
            return true;
        case 3:
            return (t.synthesis?.totalCaseFiles ?? 0) > 0;
        case 4:
            return (t.blockingDiscussion?.count ?? 0) > 0;
        case 5:
            return (t.blockingDiscussion?.count ?? 0) > 0 || (t.asyncReview?.debateCompletionRate ?? 0) > 0;
        case 6:
            return (t.modelRouter?.cloud ?? 0) > 0 || (t.asyncReview?.disagreements ?? 0) > 0;
        case 7:
            return (t.synthesis?.totalCaseFiles ?? 0) > 0 || (t.synthesis?.totalLessons ?? 0) > 0;
        default:
            return false;
    }
}

const fmt = (n: unknown, suffix = ''): string => {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    return `${v.toLocaleString()}${suffix}`;
};
const pct = (n: unknown): string => {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    return `${(v * 100).toFixed(0)}%`;
};

const MultiAgentTopologyPage = () => {
    const [topology, setTopology] = useState<MultiAgentTopology | null>(null);
    const [loading, setLoading] = useState(true);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [lastFetch, setLastFetch] = useState<Date | null>(null);

    const load = useCallback(async () => {
        const data = await fetchMultiAgentTopology();
        if (data) {
            setTopology(data);
            setLastFetch(new Date());
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, 5000);
        return () => clearInterval(id);
    }, [load]);

    const layers = topology?.layers?.length ? topology.layers : FALLBACK_LAYERS;
    const roles = topology?.roles?.length ? topology.roles : FALLBACK_ROLES;
    const telemetry = topology?.telemetry ?? null;
    const initialized = topology?.initialized ?? false;

    const selectedLayer = selection?.kind === 'layer' ? layers.find((l) => l.num === selection.num) ?? null : null;
    const selectedRole = selection?.kind === 'role' ? roles.find((r) => r.role === selection.role) ?? null : null;

    return (
        <ConsolePage
            title="Athens Academy — 7-Layer Cognition Topology"
            subtitle="Each stratum is an agent team with its own thinking depth and activation gate. Click any layer or agent node to inspect its live audit trail."
            actions={
                <button
                    onClick={load}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            }
        >
            <style>{`
                @keyframes ag-flow { 0% { transform: translateY(-8px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(22px); opacity: 0; } }
                @keyframes ag-pulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
                .ag-spine-dot { animation: ag-flow 1.8s linear infinite; }
                .ag-pulse { animation: ag-pulse 2.4s ease-in-out infinite; }
            `}</style>

            {/* System status strip */}
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
                <StatusPill ok={initialized} label={initialized ? 'Multi-Agent System Online' : 'System Initializing / Offline'} />
                <MetaPill icon={<GitBranch size={12} />} label={`Mode: ${topology?.experimentMode ?? 'multi_agent_with_debate'}`} />
                {topology?.models && <MetaPill icon={<Cpu size={12} />} label={`Local: ${topology.models.local}`} />}
                {topology?.models && <MetaPill icon={<Cloud size={12} />} label={`Cloud: ${topology.models.cloud}`} />}
                {telemetry?.aiLayer?.degraded && (
                    <MetaPill icon={<Shield size={12} />} label={`AI Layer: ${telemetry.aiLayer.mode ?? 'degraded'}`} />
                )}
                {lastFetch && <MetaPill icon={<CircleDot size={12} />} label={`Updated ${lastFetch.toLocaleTimeString()}`} />}
            </div>

            <RecentCascadeStrip entry={topology?.recentCascadeTraces?.[0]} />

            <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
                {/* The cascade */}
                <div className="relative rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-950/60 p-5">
                    <motion.div
                        initial="hidden"
                        animate="visible"
                        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
                        className="relative"
                    >
                        {layers.map((layer, idx) => {
                            const depth = DEPTH_META[layer.thinkingDepth ?? 'standard'];
                            const armed = layerArmed(layer.num, telemetry);
                            const layerRoles = roles.filter((r) => r.layer === layer.num);
                            const isSelected = selection?.kind === 'layer' && selection.num === layer.num;
                            return (
                                <div key={layer.key}>
                                    <LayerStratum
                                        layer={layer}
                                        depth={depth}
                                        armed={armed}
                                        selected={isSelected}
                                        onSelect={() => setSelection({ kind: 'layer', num: layer.num })}
                                        roles={layerRoles}
                                        onSelectRole={(role) => setSelection({ kind: 'role', role })}
                                        selectedRole={selection?.kind === 'role' ? selection.role : undefined}
                                    />
                                    {idx < layers.length - 1 && <Connector active={armed} />}
                                </div>
                            );
                        })}
                    </motion.div>
                </div>

                {/* Audit rail (desktop) */}
                <div className="hidden lg:block">
                    <AuditRail
                        selection={selection}
                        layer={selectedLayer}
                        role={selectedRole}
                        telemetry={telemetry}
                        topology={topology}
                        onClear={() => setSelection(null)}
                    />
                </div>
            </div>

            {/* Audit drawer (mobile / overlay) */}
            <AnimatePresence>
                {selection && (
                    <motion.div
                        className="fixed inset-0 z-40 lg:hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelection(null)}
                    >
                        <div className="absolute inset-0 bg-black/60" />
                        <motion.div
                            className="absolute right-0 top-0 h-full w-[88%] max-w-sm overflow-y-auto bg-slate-950 p-5"
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <AuditRail
                                selection={selection}
                                layer={selectedLayer}
                                role={selectedRole}
                                telemetry={telemetry}
                                topology={topology}
                                onClear={() => setSelection(null)}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </ConsolePage>
    );
};

// ---------------------------------------------------------------------------
// Layer stratum
// ---------------------------------------------------------------------------

const LayerStratum = ({
    layer,
    depth,
    armed,
    selected,
    onSelect,
    roles,
    onSelectRole,
    selectedRole
}: {
    layer: MultiAgentLayerNode;
    depth: typeof DEPTH_META[keyof typeof DEPTH_META];
    armed: boolean;
    selected: boolean;
    onSelect: () => void;
    roles: MultiAgentRoleNode[];
    onSelectRole: (role: string) => void;
    selectedRole?: string;
}) => {
    return (
        <motion.div
            variants={{ hidden: { opacity: 0, x: -18 }, visible: { opacity: 1, x: 0, transition: { duration: 0.35 } } }}
            whileHover={{ scale: 1.005 }}
            data-testid={`cognition-layer-${layer.num}`}
            onClick={onSelect}
            className={`group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition-colors ${
                selected ? 'border-slate-400 bg-slate-800/80' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'
            }`}
            style={{ boxShadow: selected ? `0 0 0 1px ${depth.color}55, 0 0 28px ${depth.glow}` : undefined }}
        >
            {/* depth glow wash */}
            <div
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-20 blur-3xl"
                style={{ background: depth.color }}
            />

            <div className="relative flex items-start gap-4">
                {/* layer number + depth meter */}
                <div className="flex flex-col items-center gap-2">
                    <div
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-sm font-bold text-white"
                        style={{ background: `linear-gradient(135deg, ${depth.color}, ${depth.color}99)`, boxShadow: `0 0 16px ${depth.glow}` }}
                    >
                        L{layer.num}
                    </div>
                    <DepthMeter bars={depth.bars} color={depth.color} />
                </div>

                {/* body */}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{layer.name}</h3>
                        <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ background: `${depth.color}22`, color: depth.color, border: `1px solid ${depth.color}55` }}
                        >
                            {depth.label} think
                        </span>
                        {layer.modelTier && <TierBadge tier={layer.modelTier} />}
                        <ArmedDot armed={armed} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{LAYER_DESC[layer.num]}</p>

                    {/* activation chips */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <ActivationChips layer={layer} />
                    </div>

                    {/* role nodes */}
                    {roles.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {roles.map((r) => (
                                <RoleNode
                                    key={r.role}
                                    role={r}
                                    selected={selectedRole === r.role}
                                    onSelect={(e) => {
                                        e.stopPropagation();
                                        onSelectRole(r.role);
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

const DepthMeter = ({ bars, color }: { bars: number; color: string }) => (
    <div className="flex gap-0.5">
        {[1, 2, 3, 4].map((b) => (
            <div
                key={b}
                className="h-3 w-1 rounded-full"
                style={{ background: b <= bars ? color : 'rgba(148,163,184,0.2)' }}
            />
        ))}
    </div>
);

const TierBadge = ({ tier }: { tier: 'local' | 'cloud' | 'hybrid' }) => {
    const map = {
        local: { icon: <Cpu size={11} />, label: 'local', color: '#22c55e' },
        cloud: { icon: <Cloud size={11} />, label: 'cloud', color: '#38bdf8' },
        hybrid: { icon: <GitBranch size={11} />, label: 'hybrid', color: '#a78bfa' }
    } as const;
    const m = map[tier];
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300" style={{ color: m.color }}>
            {m.icon} {m.label}
        </span>
    );
};

const ArmedDot = ({ armed }: { armed: boolean }) => (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
        <span
            className={`h-1.5 w-1.5 rounded-full ${armed ? 'ag-pulse' : ''}`}
            style={{ background: armed ? '#22c55e' : '#475569' }}
        />
        {armed ? 'active' : 'idle'}
    </span>
);

const ActivationChips = ({ layer }: { layer: MultiAgentLayerNode }) => {
    const a = layer.activation;
    if (!a) return null;
    const chips: string[] = [];
    if (a.always) chips.push('always-on');
    if (typeof a.minRiskScore === 'number') chips.push(`risk ≥ ${a.minRiskScore}`);
    if (typeof a.maxPrimaryConfidence === 'number') chips.push(`conf < ${a.maxPrimaryConfidence}`);
    if (typeof a.minPrimaryConfidence === 'number') chips.push(`conf ≥ ${a.minPrimaryConfidence}`);
    if (a.requiresDebateTrigger) chips.push('on debate');
    if (a.requiresEscalation) chips.push('on escalation');
    if (a.requiresLayers?.length) chips.push(`after L${a.requiresLayers.join(',')}`);
    return (
        <>
            {chips.map((c) => (
                <span key={c} className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400">{c}</span>
            ))}
        </>
    );
};

const RoleNode = ({
    role,
    selected,
    onSelect
}: {
    role: MultiAgentRoleNode;
    selected: boolean;
    onSelect: (e: MouseEvent) => void;
}) => (
    <motion.button
        type="button"
        data-testid={`cognition-role-${role.role}`}
        onClick={onSelect}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
        className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors ${
            selected ? 'border-slate-300 bg-slate-800' : 'border-slate-700 bg-slate-900 hover:border-slate-500'
        }`}
    >
        <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: role.color, boxShadow: `0 0 10px ${role.color}88` }}
        >
            {role.name[0]}
        </span>
        <span className="text-slate-200">{role.name}</span>
        <span className="text-[10px] uppercase text-slate-500">{role.position}</span>
    </motion.button>
);

const Connector = ({ active }: { active: boolean }) => (
    <div className="relative flex h-6 items-center justify-center">
        <div className="h-full w-px bg-gradient-to-b from-slate-700 to-slate-800" />
        {active && (
            <>
                <span className="ag-spine-dot absolute h-1.5 w-1.5 rounded-full bg-sky-400" style={{ animationDelay: '0s' }} />
                <span className="ag-spine-dot absolute h-1.5 w-1.5 rounded-full bg-sky-400" style={{ animationDelay: '0.9s' }} />
            </>
        )}
    </div>
);

// ---------------------------------------------------------------------------
// Audit rail
// ---------------------------------------------------------------------------

const AuditRail = ({
    selection,
    layer,
    role,
    telemetry,
    topology,
    onClear
}: {
    selection: Selection | null;
    layer: MultiAgentLayerNode | null;
    role: MultiAgentRoleNode | null;
    telemetry: Telemetry;
    topology: MultiAgentTopology | null;
    onClear: () => void;
}) => {
    return (
        <div data-testid="cognition-audit-rail" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <ScrollText size={15} className="text-sky-400" /> Audit Trail
                </div>
                {selection && (
                    <button onClick={onClear} className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
                        <X size={15} />
                    </button>
                )}
            </div>

            {!selection && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Crosshair size={28} className="mb-3 text-slate-600" />
                    <p className="text-sm text-slate-400">Select a layer or agent node to inspect its live audit data.</p>
                </div>
            )}

            {selection?.kind === 'layer' && layer && <LayerAudit layer={layer} telemetry={telemetry} />}
            {selection?.kind === 'role' && role && <RoleAudit role={role} telemetry={telemetry} topology={topology} />}
        </div>
    );
};

const SectionTitle = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
    <div className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {icon} {children}
    </div>
);

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
        <div className="text-[10px] uppercase text-slate-500">{label}</div>
        <div className="text-base font-semibold" style={{ color: accent ?? '#e2e8f0' }}>{value}</div>
    </div>
);

const LayerAudit = ({ layer, telemetry }: { layer: MultiAgentLayerNode; telemetry: Telemetry }) => {
    const depth = DEPTH_META[layer.thinkingDepth ?? 'standard'];
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: depth.color }}>
                    L{layer.num}
                </div>
                <div>
                    <div className="text-sm font-semibold text-slate-100">{layer.name}</div>
                    <div className="text-[11px]" style={{ color: depth.color }}>{depth.label} thinking · {layer.modelTier ?? 'n/a'} tier</div>
                </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">{depth.blurb}</p>

            <SectionTitle icon={<Layers size={12} />}>Layer Config</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
                <Stat label="Priority" value={String(layer.priority)} />
                <Stat label="Concurrency" value={String(layer.maxConcurrency)} />
                <Stat label="Timeout" value={`${layer.timeout}ms`} />
                <Stat label="Token Budget" value={layer.thinkingDepth === 'shallow' ? '400' : layer.thinkingDepth === 'standard' ? '1000' : layer.thinkingDepth === 'deep' ? '2000' : '4000'} accent={depth.color} />
            </div>

            <SectionTitle icon={<Activity size={12} />}>Live Telemetry</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
                {layer.num === 1 && (
                    <>
                        <Stat label="Active Tasks" value={fmt(telemetry?.orchestrator?.activeTasks)} />
                        <Stat label="Routed Agents" value={fmt(telemetry?.orchestrator?.registeredAgents)} />
                        <Stat label="Bus Queue" value={fmt(telemetry?.messageBus?.queueSize)} />
                        <Stat label="Pending Req" value={fmt(telemetry?.messageBus?.pendingRequests)} />
                    </>
                )}
                {layer.num === 2 && (
                    <>
                        <Stat label="Token Budget" value="1000 / role" accent={depth.color} />
                        <Stat label="Temperature" value="0.3" accent={depth.color} />
                        <Stat label="Teams" value="red · blue · analyst" />
                        <Stat label="Roles Active" value={fmt(telemetry?.orchestrator?.registeredAgents)} />
                    </>
                )}
                {layer.num === 3 && (
                    <>
                        <Stat label="Case Files" value={fmt(telemetry?.synthesis?.totalCaseFiles)} />
                        <Stat label="Min Risk Gate" value={String(layer.activation?.minRiskScore ?? '—')} />
                    </>
                )}
                {layer.num === 4 && (
                    <>
                        <Stat label="Blocking Reviews" value={fmt(telemetry?.blockingDiscussion?.count)} />
                        <Stat label="Min Risk Gate" value={String(layer.activation?.minRiskScore ?? '—')} />
                    </>
                )}
                {layer.num === 5 && (
                    <>
                        <Stat label="Blocking Debates" value={fmt(telemetry?.blockingDiscussion?.count)} />
                        <Stat label="Fail-Closed" value={fmt(telemetry?.blockingDiscussion?.failClosed)} accent="#f43f5e" />
                        <Stat label="Debate Rate" value={pct(telemetry?.asyncReview?.debateCompletionRate)} accent={depth.color} />
                        <Stat label="Avg Debate ms" value={fmt(telemetry?.blockingDiscussion?.avgLatencyMs, 'ms')} />
                    </>
                )}
                {layer.num === 6 && (
                    <>
                        <Stat label="Cloud Calls" value={fmt(telemetry?.modelRouter?.cloud)} accent="#38bdf8" />
                        <Stat label="Local Calls" value={fmt(telemetry?.modelRouter?.local)} accent="#22c55e" />
                        <Stat label="Local Ratio" value={pct(telemetry?.modelRouter?.localRatio)} />
                        <Stat label="Avg Cloud ms" value={fmt(telemetry?.modelRouter?.avgCloudLatency, 'ms')} />
                        <Stat label="Disagreements" value={fmt(telemetry?.asyncReview?.disagreements)} accent="#f59e0b" />
                        <Stat label="Disagree Rate" value={pct(telemetry?.asyncReview?.disagreementRate)} accent="#f59e0b" />
                    </>
                )}
                {layer.num === 7 && (
                    <>
                        <Stat label="Case Files" value={fmt(telemetry?.synthesis?.totalCaseFiles)} accent={depth.color} />
                        <Stat label="Lessons" value={fmt(telemetry?.synthesis?.totalLessons)} />
                        <Stat label="Policy Updates" value={fmt(telemetry?.synthesis?.totalPolicyUpdates)} />
                        <Stat label="Avg Review ms" value={fmt(telemetry?.asyncReview?.avgLatencyMs, 'ms')} />
                    </>
                )}
            </div>

            {layer.num === 7 && telemetry?.synthesis?.topPatterns && telemetry.synthesis.topPatterns.length > 0 && (
                <>
                    <SectionTitle icon={<Sparkles size={12} />}>Top Attack Patterns</SectionTitle>
                    <div className="space-y-1">
                        {telemetry.synthesis.topPatterns.slice(0, 5).map((p) => (
                            <div key={p.pattern} className="flex items-center justify-between rounded bg-slate-950/50 px-2 py-1 text-xs">
                                <span className="text-slate-300">{p.pattern}</span>
                                <span className="text-slate-500">×{p.frequency}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </motion.div>
    );
};

const RoleAudit = ({
    role,
    telemetry,
    topology
}: {
    role: MultiAgentRoleNode;
    telemetry: Telemetry;
    topology: MultiAgentTopology | null;
}) => {
    const positionBlurb: Record<string, string> = {
        attack: 'Red team. Mutates payloads and probes for bypasses — argues the threat is real.',
        defend: 'Blue team. Validates against schema and policy — argues the request is compliant.',
        analyze: 'Analyst. Weighs behavioral and statistical anomaly — the neutral evidence reader.',
        resolve: 'Arbitrator. Resolves the debate, records the final verdict and voting record.'
    };
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: role.color, boxShadow: `0 0 14px ${role.color}88` }}>
                    {role.name[0]}
                </div>
                <div>
                    <div className="text-sm font-semibold text-slate-100">{role.name}</div>
                    <div className="text-[11px] uppercase" style={{ color: role.color }}>{role.team} team · {role.position}</div>
                </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">{positionBlurb[role.position] ?? ''}</p>

            <SectionTitle icon={<BrainCircuit size={12} />}>Capabilities</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
                {role.capabilities.map((c) => (
                    <span key={c} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{c}</span>
                ))}
            </div>

            <SectionTitle icon={<Shield size={12} />}>Decision Thresholds</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
                <Stat label="Debate Trigger" value={pct(topology?.thresholds?.debateTrigger)} />
                <Stat label="Debate Diverge" value={pct(topology?.thresholds?.debateDivergence)} />
                <Stat label="Cloud Escalation" value={pct(topology?.thresholds?.cloudEscalation)} accent="#38bdf8" />
                <Stat label="Auto-Block" value={pct(topology?.thresholds?.autoBlock)} accent="#f43f5e" />
            </div>

            {role.role === 'arbitrator' ? (
                <>
                    <SectionTitle icon={<Gauge size={12} />}>Arbitration Audit</SectionTitle>
                    <div className="grid grid-cols-2 gap-2">
                        <Stat label="Debates Run" value={fmt(telemetry?.blockingDiscussion?.count)} accent="#f59e0b" />
                        <Stat label="Fail-Closed" value={fmt(telemetry?.blockingDiscussion?.failClosed)} accent="#f43f5e" />
                        <Stat label="Avg Resolve ms" value={fmt(telemetry?.blockingDiscussion?.avgLatencyMs, 'ms')} />
                        <Stat label="Debate Rate" value={pct(telemetry?.asyncReview?.debateCompletionRate)} />
                    </div>
                </>
            ) : (
                <>
                    <SectionTitle icon={<Zap size={12} />}>Student / Teacher Loop</SectionTitle>
                    <div className="grid grid-cols-2 gap-2">
                        <Stat label="Cloud Verifications" value={fmt(telemetry?.modelRouter?.cloud)} accent="#38bdf8" />
                        <Stat label="Disagreements" value={fmt(telemetry?.asyncReview?.disagreements)} accent="#f59e0b" />
                        <Stat label="Disagree Rate" value={pct(telemetry?.asyncReview?.disagreementRate)} accent="#f59e0b" />
                        <Stat label="Completed Reviews" value={fmt(telemetry?.asyncReview?.completed)} />
                    </div>
                </>
            )}
        </motion.div>
    );
};

// ---------------------------------------------------------------------------
// Recent cascade execution strip — shows the last real decision's per-layer trace
// ---------------------------------------------------------------------------

const RecentCascadeStrip = ({ entry }: { entry?: MultiAgentCascadeTraceEntry }) => {
    if (!entry) return null;
    const verdictColor = entry.verdict === 'block' ? '#f43f5e' : entry.verdict === 'monitor' ? '#f59e0b' : entry.verdict === 'challenge' ? '#a855f7' : '#22c55e';
    return (
        <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <Activity size={13} className="text-sky-400" /> Last Cascade Execution
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span>req {entry.requestId.slice(0, 10)}</span>
                    <span className="rounded-full px-2 py-0.5 font-medium" style={{ background: `${verdictColor}22`, color: verdictColor }}>{entry.verdict}</span>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
            </div>
            <div className="flex flex-wrap items-stretch gap-1.5">
                {entry.traces.map((t, i) => (
                    <div key={t.layer} className="flex items-stretch gap-1.5">
                        <div
                            className={`flex min-w-[92px] flex-col justify-between rounded-lg border p-2 ${t.activated ? 'border-slate-600 bg-slate-800/70' : 'border-slate-800 bg-slate-950/40 opacity-60'}`}
                            title={t.note}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-200">L{t.layer}</span>
                                {t.activated ? (
                                    <span className="h-1.5 w-1.5 rounded-full ag-pulse" style={{ background: '#22c55e' }} />
                                ) : (
                                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#475569' }} />
                                )}
                            </div>
                            <div className="text-[9px] uppercase text-slate-500">{t.activated ? 'active' : 'dormant'}</div>
                            {t.latencyMs ? <div className="text-[10px] text-sky-300">{t.latencyMs}ms</div> : <div className="text-[10px] text-transparent">·</div>}
                        </div>
                        {i < entry.traces.length - 1 && <div className="mt-5 h-px w-2 self-center bg-slate-700" />}
                    </div>
                ))}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Small status pills
// ---------------------------------------------------------------------------

const StatusPill = ({ ok, label }: { ok: boolean; label: string }) => (
    <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
        style={{
            background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(244,63,94,0.12)',
            color: ok ? '#22c55e' : '#f43f5e',
            border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(244,63,94,0.3)'}`
        }}
    >
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'ag-pulse' : ''}`} style={{ background: ok ? '#22c55e' : '#f43f5e' }} />
        {label}
    </span>
);

const MetaPill = ({ icon, label }: { icon: ReactNode; label: string }) => (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-400">
        {icon} {label}
    </span>
);

export default MultiAgentTopologyPage;
