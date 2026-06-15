/**
 * AetherGuard CLI — AI-native command line that connects through the project's
 * core intelligence without requiring a running server or database.
 *
 * Design for AI consumption:
 *   - Structured JSON by default when stdout is piped (non-TTY) or when --json is
 *     passed, so an AI agent can parse every result deterministically.
 *   - Deterministic detection runs in-process against pure functions (no DB, no
 *     network), so `analyze` is instant and offline-callable.
 *   - --ai opts into the full Athens Academy multi-agent path and includes the
 *     per-layer cascadeTrace.
 *   - Stable exit codes: 0 ok, 1 detection-blocked/threat, 2 bad input, 3 runtime.
 *
 * Usage:
 *   aetherguard analyze --path "/search?q=UNION SELECT" --json
 *   echo '{"path":"/login","method":"POST","body":"admin' OR 1=1"}' | aetherguard analyze --input -
 *   aetherguard topology
 *   aetherguard detect-rules
 */

import { parseArgs } from 'util';
import { isatty } from 'tty';
import { createInterface } from 'readline';
import {
    buildSeedDetectionRules,
    evaluateDetectionRules,
    assessDetectionHeuristics,
    inferAttackFamily,
    type DetectionRequest,
    type DetectionChannel
} from '../services/detection-engine';

// CLI runs as a local dev/ops tool. Deep imports (audit logger, auth) require a few
// secrets to be present; provide safe local defaults when unset so commands work
// out-of-the-box without a .env. Never use these defaults in production.
function ensureCliEnvDefaults(): void {
    const defaults: Record<string, string> = {
        AUDIT_LOG_SECRET: 'aetherguard-cli-local-audit-secret-min-32-characters',
        JWT_SECRET: 'aetherguard-cli-local-jwt-secret-minimum-32-characters',
        DEVICE_COMMAND_SECRET: 'aetherguard-cli-local-device-cmd-secret-32',
        ALLOW_TEST_RUNTIME: 'true',
        // Keep stdout clean for AI/JSON consumers; the CLI writes human text and JSON to stdout,
        // so push logger output (which goes to stdout via console.info) down to error level.
        LOG_LEVEL: 'error'
    };
    for (const [key, value] of Object.entries(defaults)) {
        if (!process.env[key] && process.env.NODE_ENV !== 'production') {
            process.env[key] = value;
        }
    }
}
ensureCliEnvDefaults();
type OutputMode = 'json' | 'text';

function wantJson(argv: { json?: boolean }): boolean {
    return Boolean(argv.json) || !isatty(1);
}

function emit(mode: OutputMode, payload: unknown, pretty?: string): void {
    if (mode === 'json') {
        process.stdout.write(JSON.stringify(payload) + '\n');
    } else {
        process.stdout.write((pretty ?? JSON.stringify(payload, null, 2)) + '\n');
    }
}

function fail(mode: OutputMode, code: number, message: string): never {
    if (mode === 'json') {
        process.stdout.write(JSON.stringify({ error: message, code }) + '\n');
    } else {
        process.stderr.write(`error: ${message}\n`);
    }
    process.exit(code);
}

function buildRequest(argv: Record<string, unknown>, fromStdin?: Partial<DetectionRequest>): DetectionRequest {
    const channel = (argv.channel as DetectionChannel) || 'http_api';
    const base: DetectionRequest = {
        tenantId: (argv.tenantId as string) || 'cli',
        channel,
        requestId: (argv.requestId as string) || `cli-${Date.now()}`,
        timestamp: new Date().toISOString(),
        sourceIp: (argv.sourceIp as string) || (fromStdin?.sourceIp as string) || '127.0.0.1',
        method: (argv.method as string) || (fromStdin?.method as string) || 'GET',
        path: (argv.path as string) || (fromStdin?.path as string) || '/',
        decodedPath: (argv.path as string) || (fromStdin?.decodedPath as string),
        query: (argv.query as string) || (fromStdin?.query as string),
        decodedQuery: (argv.query as string) || (fromStdin?.decodedQuery as string),
        parsedQuery: (argv.query as string) || (fromStdin?.parsedQuery as string),
        body: (argv.body as string) || (fromStdin?.body as string),
        normalizedBody: (argv.body as string) || (fromStdin?.normalizedBody as string),
        userAgent: (argv.userAgent as string) || (fromStdin?.userAgent as string) || 'aetherguard-cli',
        protocol: channel === 'packet' ? 'tcp' : 'http',
        headers: argv.headers ? JSON.parse(argv.headers as string) : (fromStdin?.headers || {}),
        metadata: {}
    };

    // If the path carries a query string and no explicit --query was given, split
    // it so rule matchers that inspect the query field still fire. This matches
    // how an AI agent would naturally pass a URL-ish path.
    if (!argv.query && !fromStdin?.query && base.path && base.path.includes('?')) {
        const [purePath, qs] = base.path.split('?');
        base.path = purePath;
        base.decodedPath = purePath;
        base.query = qs;
        base.decodedQuery = qs;
        base.parsedQuery = qs;
    }
    return base;
}

async function readStdinJson(): Promise<Partial<DetectionRequest> | undefined> {
    if (process.stdin.isTTY) return undefined;
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) lines.push(line);
    const text = lines.join('\n').trim();
    // Empty stdin is fine — fall back to argv defaults. Non-empty input that is
    // not valid JSON is a pipeline/CI error: silently treating it as a benign
    // default request would make a broken agent emit verdict:"allow" + exit 0.
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch (err: any) {
        throw Object.assign(new Error(`--input - received non-JSON stdin: ${err?.message || 'parse failed'}`), { code: 2, malformed: true });
    }
}

interface AnalyzeResult {
    requestId: string;
    verdict: 'allow' | 'block' | 'monitor';
    attackFamily: string;
    riskScore: number;
    matchedRules: { ruleId: string; name: string; action: string; severity: string }[];
    signals: { source: string; key: string; score: number; severity: string; description: string }[];
    decisionPath: 'deterministic';
    ai?: { cascadeTrace?: unknown[]; layersActivated: number[]; verdict: string; confidence: number; note?: string };
}

async function cmdAnalyze(argv: Record<string, unknown>): Promise<number> {
    const mode: OutputMode = wantJson(argv) ? 'json' : 'text';
    let stdinInput: Partial<DetectionRequest> | undefined;
    if (argv.input === '-' || argv.stdin) {
        try {
            stdinInput = await readStdinJson();
        } catch (err: any) {
            // Malformed stdin JSON must NOT fall through to defaults (that would
            // silently classify a broken request as verdict:"allow"). Exit 2.
            fail(mode, err?.code ?? 2, err?.message ?? 'Invalid --input JSON');
        }
    }
    let request: DetectionRequest;
    try {
        request = buildRequest(argv, stdinInput);
    } catch {
        fail(mode, 2, 'Invalid request — check --headers JSON or --input JSON');
    }

    const rules = buildSeedDetectionRules();
    const ruleEval = evaluateDetectionRules(request, rules);
    const heuristic = assessDetectionHeuristics(request);
    const combinedSignals = [...ruleEval.signals, ...heuristic.signals];
    const riskScore = Math.max(ruleEval.riskScore, heuristic.riskScore);
    const attackFamily = inferAttackFamily(request, combinedSignals);
    const verdict: AnalyzeResult['verdict'] =
        ruleEval.ruleVerdict === 'block' ? 'block'
        : riskScore >= 0.6 ? 'monitor'
        : 'allow';

    const result: AnalyzeResult = {
        requestId: request.requestId,
        verdict,
        attackFamily,
        riskScore: Number(riskScore.toFixed(4)),
        matchedRules: ruleEval.matchedRules.map((m) => ({
            ruleId: m.rule.ruleId,
            name: m.rule.name,
            action: m.rule.action,
            severity: m.rule.severity
        })),
        signals: combinedSignals.map((s) => ({
            source: s.source, key: s.key, score: Number(s.score.toFixed(4)),
            severity: s.severity, description: s.description
        })),
        decisionPath: 'deterministic'
    };

    // --force-debate implies --ai per the help text ("Force a multi-agent debate
    // (implies --ai)"); without this, passing only --force-debate silently skipped
    // the multi-agent path and emitted no ai/cascadeTrace.
    if (argv.ai || argv.forceDebate || argv['force-debate']) {
        try {
            const { createMultiAgentSystem } = await import('../ai-agents');
            const system = createMultiAgentSystem();
            await system.initialize();
            const decision = await system.analyze({
                id: request.requestId,
                timestamp: new Date(request.timestamp),
                sourceIP: request.sourceIp || 'unknown',
                method: request.method || 'GET',
                path: request.path || '/',
                headers: request.headers || {},
                body: request.body || '',
                queryParams: {},
                tenantId: request.tenantId,
                analysisPurpose: 'primary',
                forceDebate: Boolean(argv.forceDebate)
            });
            result.ai = {
                verdict: decision.verdict,
                confidence: Number(decision.confidence.toFixed(4)),
                layersActivated: decision.layersActivated,
                cascadeTrace: decision.cascadeTrace || []
            };
        } catch (err: any) {
            result.ai = { layersActivated: [], verdict: 'unavailable', confidence: 0, note: `multi-agent unavailable: ${err?.message || 'unknown'}` } as any;
        }
    }

    const pretty = [
        `AetherGuard analysis — ${request.requestId}`,
        `  verdict:      ${result.verdict}`,
        `  attackFamily: ${result.attackFamily}`,
        `  riskScore:    ${result.riskScore}`,
        `  matchedRules: ${result.matchedRules.length}`,
        `  signals:      ${result.signals.length}`,
        result.ai ? `  AI verdict:   ${result.ai.verdict} (layers ${result.ai.layersActivated.join(',')})` : '  AI:          pass --ai to include the multi-agent cascade trace'
    ].join('\n');
    emit(mode, result, pretty);

    // Exit non-zero on a real threat so AI agents / CI can branch on it.
    return result.verdict === 'block' ? 1 : 0;
}

async function cmdTopology(argv: Record<string, unknown>): Promise<number> {
    const mode: OutputMode = wantJson(argv) ? 'json' : 'text';
    try {
        const { createMultiAgentSystem } = await import('../ai-agents');
        const system = createMultiAgentSystem();
        const cfg = system.getConfig();
        const L = cfg.layers;
        const layers = [
            { num: 1, name: 'Collaboration', ...L.l1_collaboration },
            { num: 2, name: 'Role Playing', ...L.l2_rolePlaying },
            { num: 3, name: 'Scene Traversal', ...L.l3_sceneTraversal },
            { num: 4, name: 'Capability', ...L.l4_capability },
            { num: 5, name: 'Debate', ...L.l5_debate },
            { num: 6, name: 'Heterogeneous Model', ...L.l6_heterogeneous },
            { num: 7, name: 'Synthesis', ...L.l7_synthesis }
        ];
        const payload = {
            experimentMode: cfg.experimentMode,
            thresholds: cfg.thresholds,
            models: { local: cfg.models.local.model, cloud: cfg.models.cloud.model },
            layers,
            roles: ['socrates', 'plato', 'aristotle', 'arbitrator']
        };
        emit(mode, payload);
        return 0;
    } catch (err: any) {
        fail(mode, 3, `topology failed: ${err?.message || 'unknown'}`);
    }
}

function cmdDetectRules(argv: Record<string, unknown>): number {
    const mode: OutputMode = wantJson(argv) ? 'json' : 'text';
    const rules = buildSeedDetectionRules().map((r) => ({
        ruleId: r.ruleId, name: r.name, scope: r.scope,
        attackFamily: r.attackFamily, action: r.action, severity: r.severity
    }));
    emit(mode, { count: rules.length, rules });
    return 0;
}

// ---------------------------------------------------------------------------
// HTTP client mode — for stateful commands (audit / deploy / scan) that operate
// against a running control plane. Configured via AETHERGUARD_URL + a bearer
// token (AETHERGUARD_TOKEN) or cookie (AETHERGUARD_COOKIE).
// ---------------------------------------------------------------------------

function apiUrl(): string {
    const base = process.env.AETHERGUARD_URL || process.env.AETHERGUARD_API_URL || 'http://localhost:3005';
    return base.replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = process.env.AETHERGUARD_TOKEN || process.env.AETHERGUARD_API_KEY;
    if (token) headers['authorization'] = `Bearer ${token}`;
    const cookie = process.env.AETHERGUARD_COOKIE;
    if (cookie) headers['cookie'] = cookie;
    return headers;
}

async function apiGet(path: string): Promise<any> {
    const res = await fetch(`${apiUrl()}${path}`, { headers: { ...authHeaders(), accept: 'application/json' } });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    if (!res.ok) {
        const code = res.status === 401 || res.status === 403 ? 2 : 3;
        throw Object.assign(new Error(`HTTP ${res.status}: ${json?.error || json?.message || text.slice(0, 160)}`), { code, status: res.status });
    }
    return json?.data !== undefined ? json.data : json;
}

async function requireServer(argv: Record<string, unknown>): Promise<void> {
    if (argv['check-server'] === false) return;
    try {
        await fetch(`${apiUrl()}/health`, { signal: AbortSignal.timeout(3000) });
    } catch {
        throw Object.assign(new Error(`control plane not reachable at ${apiUrl()} — set AETHERGUARD_URL (and AETHERGUARD_TOKEN)`), { code: 3 });
    }
}
/**
 * Stream-mode classification for AI agents. Reads newline-delimited JSON request
 * objects from stdin, classifies each one in-process against the pure detection
 * core, and writes one JSON-line verdict per input line to stdout. No DB, no
 * network, no server — so an agent can bulk-classify a traffic feed instantly.
 *
 * Exit code reflects the worst verdict seen: 0 if all allow, 1 if any block.
 * Pass --summary to emit only an aggregate summary object instead of per-line.
 */
async function cmdPipe(argv: Record<string, unknown>): Promise<number> {
    const rules = buildSeedDetectionRules();
    const summarize = Boolean(argv.summary);
    let processed = 0;
    let blocked = 0;
    let monitored = 0;
    let worst = 0;

    const rl = createInterface({ input: process.stdin });
    for await (const raw of rl) {
        const line = raw.trim();
        if (!line) continue;
        let parsed: Partial<DetectionRequest>;
        try {
            parsed = JSON.parse(line);
        } catch {
            process.stdout.write(JSON.stringify({ error: 'invalid_json', line: line.slice(0, 120) }) + '\n');
            worst = Math.max(worst, 2);
            continue;
        }
        const request = buildRequest({ channel: parsed.channel as DetectionChannel }, parsed);
        const ruleEval = evaluateDetectionRules(request, rules);
        const heuristic = assessDetectionHeuristics(request);
        const riskScore = Math.max(ruleEval.riskScore, heuristic.riskScore);
        const attackFamily = inferAttackFamily(request, [...ruleEval.signals, ...heuristic.signals]);
        const verdict = ruleEval.ruleVerdict === 'block' ? 'block' : riskScore >= 0.6 ? 'monitor' : 'allow';
        processed += 1;
        if (verdict === 'block') { blocked += 1; worst = Math.max(worst, 1); }
        else if (verdict === 'monitor') monitored += 1;

        if (!summarize) {
            process.stdout.write(JSON.stringify({
                requestId: request.requestId,
                path: request.path,
                verdict,
                attackFamily,
                riskScore: Number(riskScore.toFixed(4)),
                matchedRules: ruleEval.matchedRules.length,
                signals: ruleEval.signals.length + heuristic.signals.length
            }) + '\n');
        }
    }

    if (summarize || processed === 0) {
        process.stdout.write(JSON.stringify({ processed, blocked, monitored, allowed: processed - blocked - monitored }) + '\n');
    }
    return worst;
}

async function cmdAudit(argv: Record<string, unknown>): Promise<number> {
    const mode: OutputMode = wantJson(argv) ? 'json' : 'text';
    const qs = new URLSearchParams();
    for (const k of ['category', 'status', 'actorId', 'targetId', 'tenantId']) {
        const v = argv[k];
        if (typeof v === 'string' && v) qs.set(k, v);
    }
    qs.set('limit', String(argv.limit ?? 25));
    qs.set('page', String(argv.page ?? 1));
    try {
        // requireServer must run INSIDE the try so a downed control plane yields
        // a JSON {error} on stdout (--json) rather than a non-JSON fatal: line.
        await requireServer(argv);
        const data = await apiGet(`/api/admin/audit/logs?${qs}`);
        const logs = Array.isArray(data) ? data : (data?.logs || data?.items || []);
        const rows = (logs as any[]).map((e) => ({
            id: e.id, timestamp: e.timestamp, severity: e.severity, category: e.category,
            eventType: e.eventType, action: e.action, status: e.status,
            actor: e.actor?.id, target: e.target?.id
        }));
        emit(mode, { count: rows.length, logs: rows });
        return 0;
    } catch (err: any) {
        fail(mode, err?.code ?? 3, `audit failed: ${err?.message || 'unknown'}`);
    }
}

async function cmdDeploy(argv: Record<string, unknown>): Promise<number> {
    const mode: OutputMode = wantJson(argv) ? 'json' : 'text';
    try {
        await requireServer(argv);
        if (argv.create) {
            const body = {
                serverType: argv['server-type'] ?? argv.serverType,
                requestType: argv['request-type'] ?? argv.requestType ?? 'install',
                profile: argv.profile ? JSON.parse(argv.profile as string) : {}
            };
            // Check HTTP status like apiGet() does: a 403/500 must surface as a
            // failure, not be emitted as if the deploy succeeded.
            const res = await fetch(`${apiUrl()}/api/deployment-runs`, {
                method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
            });
            const text = await res.text();
            let json: any = null;
            try { json = JSON.parse(text); } catch { /* keep text */ }
            if (!res.ok) {
                const code = res.status === 401 || res.status === 403 ? 2 : 3;
                throw Object.assign(new Error(`HTTP ${res.status}: ${json?.error || json?.message || text.slice(0, 160)}`), { code, status: res.status });
            }
            emit(mode, json?.data !== undefined ? json.data : json);
        } else {
            const data = await apiGet('/api/deployment-runs');
            const runs = Array.isArray(data) ? data : (data?.runs || []);
            emit(mode, { count: (runs as any[]).length, runs });
        }
        return 0;
    } catch (err: any) {
        fail(mode, err?.code ?? 3, `deploy failed: ${err?.message || 'unknown'}`);
    }
}

async function cmdScan(argv: Record<string, unknown>): Promise<number> {
    const mode: OutputMode = wantJson(argv) ? 'json' : 'text';
    try {
        await requireServer(argv);
        const data = await apiGet('/api/scanner');
        const scans = Array.isArray(data) ? data : (data?.scans || data?.items || data || []);
        const rows = (scans as any[]).map((s) => ({
            id: s.id ?? s.scanId, target: s.target ?? s.url, status: s.status,
            severity: s.severity, createdAt: s.createdAt ?? s.created_at
        }));
        emit(mode, { count: rows.length, scans: rows });
        return 0;
    } catch (err: any) {
        fail(mode, err?.code ?? 3, `scan failed: ${err?.message || 'unknown'}`);
    }
}

const HELP = `AetherGuard CLI — AI-native security intelligence

Commands:
  analyze        Run a request through detection (deterministic; --ai for multi-agent cascade)
  topology       Emit the 7-layer Athens Academy topology as JSON
  detect-rules   List the built-in detection rules
  pipe           Stream-classify newline-JSON requests from stdin (JSONL out)
  audit          List audit logs from a running control plane (HTTP mode)
  deploy         List / create deployment runs (HTTP mode)
  scan           List scan tasks (HTTP mode)
  help           Show this help
  version        Print version

analyze options:
  --path <p>          Request path (use quotes for query strings)
  --method <m>        HTTP method (default GET)
  --body <b>          Request body
  --query <q>         Query string
  --channel <c>       http_api | packet | agent (default http_api)
  --source-ip <ip>    Source IP
  --headers <json>    Headers as a JSON object string
  --input -           Read full request JSON from stdin
  --ai                Also run the multi-agent system and include cascadeTrace
  --force-debate      Force a multi-agent debate (implies --ai)
  --json              Force JSON output (default when piped)

Output:
  Verdict exit code: 0 = allow/monitor, 1 = block (threat), 2 = bad input, 3 = runtime error.
  JSON is emitted by default when stdout is not a TTY, so AI agents can pipe commands directly.

Examples:
  aetherguard analyze --path "/search?q=UNION SELECT password" --json
  echo '{"path":"/login","method":"POST","body":"admin\\' OR 1=1"}' | aetherguard analyze --input -
  aetherguard analyze --path "/api/run" --body "cmd; cat /etc/passwd" --ai
  aetherguard topology

Stream (AI-native bulk classify):
  cat traffic.ndjson | aetherguard pipe            # one JSONL verdict per line
  cat traffic.ndjson | aetherguard pipe --summary  # aggregate counts

HTTP mode (stateful commands talk to a running control plane):
  Set AETHERGUARD_URL (default http://localhost:3005) and AETHERGUARD_TOKEN or AETHERGUARD_COOKIE.
  aetherguard audit --category auth --json
  aetherguard deploy --json
  aetherguard deploy --create --server-type binary_agent --profile '{"serverName":"edge-1"}'
  aetherguard scan --json`;

async function main(): Promise<void> {
    const [, , subcommand, ...rest] = process.argv;
    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        process.stdout.write(HELP + '\n');
        return;
    }
    if (subcommand === 'version' || subcommand === '--version' || subcommand === '-v') {
        process.stdout.write('aetherguard-cli 1.0.0\n');
        return;
    }

    try {
        const { values } = parseArgs({
            options: {
                path: { type: 'string' },
                method: { type: 'string' },
                body: { type: 'string' },
                query: { type: 'string' },
                channel: { type: 'string' },
                'source-ip': { type: 'string' },
                sourceIp: { type: 'string' },
                headers: { type: 'string' },
                input: { type: 'string' },
                stdin: { type: 'boolean' },
                ai: { type: 'boolean' },
                'force-debate': { type: 'boolean' },
                forceDebate: { type: 'boolean' },
                json: { type: 'boolean' },
                summary: { type: 'boolean' },
                'check-server': { type: 'boolean' },
                limit: { type: 'string' },
                page: { type: 'string' },
                category: { type: 'string' },
                status: { type: 'string' },
                actorId: { type: 'string' },
                targetId: { type: 'string' },
                create: { type: 'boolean' },
                'server-type': { type: 'string' },
                serverType: { type: 'string' },
                'request-type': { type: 'string' },
                requestType: { type: 'string' },
                profile: { type: 'string' },
                tenantId: { type: 'string' },
                requestId: { type: 'string' }
            },
            allowPositionals: true,
            args: rest
        });
        const argv: Record<string, unknown> = {
            ...values,
            sourceIp: values['source-ip'] ?? values.sourceIp,
            forceDebate: values['force-debate'] ?? values.forceDebate
        };

        let code: number;
        switch (subcommand) {
            case 'analyze':
                code = await cmdAnalyze(argv);
                break;
            case 'topology':
                code = await cmdTopology(argv);
                break;
            case 'detect-rules':
                code = cmdDetectRules(argv);
                break;
            case 'pipe':
                code = await cmdPipe(argv);
                break;
            case 'audit':
                code = await cmdAudit(argv);
                break;
            case 'deploy':
                code = await cmdDeploy(argv);
                break;
            case 'scan':
                code = await cmdScan(argv);
                break;
            default:
                process.stderr.write(`Unknown command: ${subcommand}\n\n${HELP}\n`);
                code = 2;
        }
        process.exit(code);
    } catch (err: any) {
        process.stderr.write(`fatal: ${err?.message || 'unknown error'}\n`);
        process.exit(3);
    }
}

void main();
