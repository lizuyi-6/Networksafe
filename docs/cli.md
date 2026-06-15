# AetherGuard CLI — AI-Native Command Line

> Entry: `backend/src/cli/aetherguard.ts` · Binary: `aetherguard` (via `package.json` bin) · npm script: `npm run cli`

A command-line interface that connects **through** the project's core intelligence — detection, the Athens Academy 7-layer cascade, topology, and rules — **without requiring a running server or database**. It is designed first for AI consumers (LLM agents, CI, automation) and second for humans.

## Why it's AI-native

- **Structured JSON by default when piped.** When stdout is not a TTY (i.e. any AI agent / pipe / CI capture), output is a single JSON object on stdout — no banners, no progress noise. Pass `--json` to force it in a TTY.
- **Stable exit codes an agent can branch on:** `0` allow/monitor · `1` block (threat) · `2` bad input · `3` runtime error.
- **In-process detection.** The deterministic path runs pure functions (`evaluateDetectionRules` + `assessDetectionHeuristics`) — no DB, no network, instant and offline. An AI agent can classify a request in milliseconds.
- **Full cascade on demand.** `--ai` instantiates the multi-agent system and includes the per-layer `cascadeTrace` (which layers activated, their thinking depth, latency, and outcome).
- **stdin-friendly.** `--input -` reads a request JSON from stdin, so an agent can pipe a request straight in.

## Install / run

```bash
cd backend
npm run build                       # produces dist/cli/aetherguard.js
node dist/cli/aetherguard.js <command> [opts]      # production path (purest stdout)

# or during development (note: ts-node-dev prints a startup line to stdout):
npm run cli -- <command> [opts]
```

Local dev secrets are auto-provided by the CLI (audit/jwt defaults) so commands work out-of-the-box; these defaults are **never** applied when `NODE_ENV=production`.

## Commands

### `analyze` — classify a request

```bash
aetherguard analyze --path "/login" --method POST --body "admin' OR 1=1--" --json
echo '{"path":"/login","method":"POST","body":"x"}' | aetherguard analyze --input -
aetherguard analyze --path "/api/run" --body "cmd; cat /etc/passwd" --ai
```

Options: `--path`, `--method`, `--body`, `--query`, `--channel http_api|packet|agent`, `--source-ip`, `--headers '<json>'`, `--input -` (stdin), `--ai`, `--force-debate`, `--json`, `--tenant-id`, `--request-id`.

A `?`-query embedded in `--path` is auto-split into the `query` field so query matchers still fire.

Output (JSON):
```json
{
  "requestId": "cli-...",
  "verdict": "block",
  "attackFamily": "sqli",
  "riskScore": 0.85,
  "matchedRules": [{ "ruleId": "...", "name": "...", "action": "block", "severity": "high" }],
  "signals": [{ "source": "rule", "key": "...", "score": 0.85, "severity": "high", "description": "..." }],
  "decisionPath": "deterministic",
  "ai": {
    "verdict": "monitor",
    "confidence": 0.56,
    "layersActivated": [1, 2, 3, 6, 7],
    "cascadeTrace": [{ "layer": 1, "name": "Collaboration", "activated": true, "thinkingDepth": "shallow", "note": "..." }, ...]
  }
}
```

The `ai` block is only present with `--ai`. The deterministic verdict comes from the rule guardrail + heuristics (the 0%-FPR core); `--ai` adds the multi-agent verdict and the per-layer execution trace.

### `topology` — the 7-layer Athens Academy map

Emits the live layer config (thinking depth, activation gates, model tier), thresholds, and models as JSON — the same shape the `/cognition` visualization consumes.

### `detect-rules` — built-in rule catalogue

Lists the seed detection rules (id, name, scope, attack family, action, severity).

### `pipe` — stream-classify a traffic feed (AI-native)

Reads newline-delimited JSON requests from stdin, classifies each in-process against the pure detection core, and writes one JSON-line verdict per input line. No DB, no network — bulk-classify a traffic feed instantly. Exit code reflects the worst verdict seen (`0` all allow, `1` any block).

```bash
cat traffic.ndjson | aetherguard pipe                 # one verdict per line
cat traffic.ndjson | aetherguard pipe --summary       # {processed,blocked,monitored,allowed}
```

Output per line: `{requestId, path, verdict, attackFamily, riskScore, matchedRules, signals}`.

### HTTP-mode commands (stateful): `audit` · `deploy` · `scan`

These operate against a **running control plane** (they need DB/server state, unlike the in-process commands above). Configure:

- `AETHERGUARD_URL` — control plane base (default `http://localhost:3005`)
- `AETHERGUARD_TOKEN` (bearer) or `AETHERGUARD_COOKIE` — auth

```bash
aetherguard audit --category auth --json                    # list audit logs
aetherguard deploy --json                                   # list deployment runs
aetherguard deploy --create --server-type binary_agent --profile '{"serverName":"edge-1"}'
aetherguard scan --json                                     # list scan tasks
```

`audit` options: `--category`, `--status`, `--actor-id`, `--target-id`, `--limit`, `--page`.

### `help` / `version`

Self-describing.

## AI-agent integration patterns

```bash
# Branch on threat in a pipeline
aetherguard analyze --input - --json <<<'{"path":"/x","body":"<script>"}' \
  && echo SAFE || echo BLOCKED

# Feed the cascade trace to another agent for triage
aetherguard analyze --path "$REQ" --ai --json | llm 'summarize the activation trace and recommend allow/block'
```

## Testing

`src/__tests__/cli/aetherguard.test.ts` spawns the compiled CLI and asserts the AI-native contract (pure JSON stdout, exit codes, verdict correctness, query auto-split, topology shape, bad-input handling). Run after `npm run build`:

```bash
npm run build && npx jest src/__tests__/cli/aetherguard.test.ts
```
