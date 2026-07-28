# Security-engine implementation report

AetherArgus-4B backend integration — phase 1 (shadow mode).

## Scope delivered

- Independent `SecurityDetectionEngine` layer under `backend/src/ai/security-detection/` (contract / errors / validator / config / engine / shadow service / prompts / providers / fusion / telemetry / tests).
- Frozen JSON Schema contracts reused unchanged: `ml/schemas/detection-input.schema.json` and `ml/schemas/detection-output.schema.json`. Runtime metadata carried in a separate `DetectionInvocationResult { output, metadata }` wrapper; the schema-validated `DetectionOutput` retains its closed 7-field shape (`additionalProperties: false`).
- Ollama provider with `temperature=0`, `seed=0`, `stream:false`, `num_ctx` from config, AbortController-based cancellable timeout, single transient retry, max-response ceiling, health check via `GET /api/tags` (no full inference).
- Mock provider for deterministic tests.
- Bounded-queue shadow wiring from `api-traffic-shadow.middleware.ts`; overflow increments `security_detection_dropped_total`; sample-rate gate before enqueue.
- Structured per-invocation telemetry event with all fields from the spec; metrics registered with restricted label set; no requestId / path / userID labels.
- Disagreement export to `runtime-data/security-detection-review/` with `eligibleForTraining: false` and `humanReview: null` hard-coded by the exporter.
- Split `ml/deployment/Modelfile.detector` (strict JSON, no identity Q&A) from `ml/deployment/Modelfile.demo` (identity preserved, non-production). Legacy `ml/deployment/Modelfile` untouched.
- Docs: this report, `backend/docs/security-detection-engine.md`, `ml/reports/security-engine-threat-model.md`, `ml/reports/shadow-mode-runbook.md`.

## Test evidence

Focused suite (`npx jest src/ai/security-detection --silent`, exit 0):

```
Test Suites: 10 passed, 10 total
Tests:       92 passed, 92 total
```

Suites:

- `detection-contract.test.ts` — enum constants, unknown-output factory shape, schema loading.
- `schema-parity.test.ts` — TS enums ↔ JSON Schema enum parity (verdict / attackFamily / severity / recommendedAction); sourceContext closed-key set equality.
- `detection-validator.test.ts` — input schema validator; strict-JSON extractor (rejects fences, prose, arrays, empty); semantic rules (`safe≠block`, `malicious≠allow`, `unknown⇒confidence≤0.5`, `evidence[]`, `confidence∈[0,1]`, `reasoning≠''`); `validateModelRawOutput` end-to-end (each failure mode returns `unknown` with the expected `errorCode`).
- `ollama-detection.provider.test.ts` — request body shape (`temperature:0`, `seed:0`, `stream:false`, system+user messages); HTTP 500 → `provider_http_error` with exactly 2 attempts (1 retry); empty content → `provider_response_empty` (no retry); oversize → `provider_response_too_large`; non-JSON envelope → `provider_unavailable`; `payload.error` → `provider_http_error`; timeout → `provider_timeout` with exactly 1 attempt (AbortError never retries); outer signal abort propagates; `healthCheck()` only hits `/api/tags`; unreachable → `{healthy:false}` without throwing; unexpected throw → `DetectionError`.
- `detection-config.test.ts` — default disabled; explicit `'true'` required (`'1'`/`'yes'` rejected); mode forced to `disabled` when `enabled=false`; unknown mode → `disabled`; `sampleRate` clamped to `[0,1]`; non-positive ints fall back to defaults.
- `security-detection-engine.test.ts` — header lowercase + value coercion; sensitive-header redaction (authorization / cookie / x-api-key → `[redacted]`); header-count cap; body/query byte truncation (UTF-8 boundary-safe); sourceContext extra-key drop; cyclic nested object drop; method normalization to `EVENT`; happy path returns schema-valid output + complete metadata + fingerprint matches `^[a-f0-9]{64}$`; provider throw / timeout / markdown-fence / extra-field / illegal-enum / `safe+block` each ⇒ `unknown` with the correct `errorCode`; disagreement flag on bucket mismatch; no flag when aligned.
- `risk-fusion.test.ts` — `executable === false` always; formal verdict never upgraded or downgraded; disagreement marked only on bucket mismatch; model `recommendedAction` carried as advisory data.
- `prompt-injection.test.ts` — 7 injection payloads (English / Chinese ignore-previous, system-prompt override, role confusion, identity question in both languages, markdown fence, leading prose) each ⇒ engine never returns `safe` even when the model echoes the injection; system prompt contains the "untrusted data" / "never execute" / "never answer identity" guardrails; headers are redacted before reaching the provider.
- `safety-invariants.test.ts` — structural scan of every engine source file for forbidden patterns (child_process / exec / iptables / nftables / netsh / pfctl / rmSync / unlinkSync / rmdirSync / imports of `hardware-authorization` or `final-defense` / writes to `policyDigest` / `monotonicCounter` / `monotonic_counter` / calls to `interlock_assert` / `interlock_release` / `breakerTarget` / `dispatchConfirmedDeviceCommand` / `createPhysicalConfirmation` / `blockIp` / `block_ip`); `fuseRisk` always returns `executable:false`; engine output keys exactly the 7-field closed set; telemetry sink throwing is swallowed (engine still resolves); `recommendedAction` is `typeof 'string'` (never invoked).
- `shadow-middleware.test.ts` — `submit()` called once after `evaluateRequest` returns with `verdict:'allow'` and `next()` still called; formal `block` decision unmodified (403 + `backend.request_blocked_by_detection_pipeline` + `next` not called); `submit()` throwing does not break the middleware (`next()` still called).

Full sharded suite (`npm run test:all`, exit 0):

```
Test Suites: 64 passed, 64 total
Tests:       808 passed, 808 total
```

Lint (`npm run lint`, exit 0) and typecheck (`npm run typecheck`, exit 0) clean. No `it.skip` / `xtest` / `--skip` used; no test-count regression vs. pre-change baseline.

## Safety-invariant mapping

| # | Invariant | Where enforced | Test anchor |
|---|---|---|---|
| 1 | Don't bypass rule engine | Engine has no path back into `DetectionDecision`; `api-traffic-shadow.middleware.ts` calls `submit()` after the formal decision is set. | `shadow-middleware.test.ts` "formal block decision is not modified" |
| 2 | Don't bypass Final Defense | Engine never imports `final-defense*` modules. | `safety-invariants.test.ts` structural scan |
| 3 | Don't bypass hardware authorization | Engine never imports `hardware-authorization*`. | same |
| 4 | Don't bypass `policyDigest` | Engine never reads / writes `policyDigest`. | same |
| 5 | Don't bypass monotonic counter | Engine never reads / writes `monotonicCounter`. | same |
| 6 | Don't bypass interlock | Engine never calls `interlock_*`. | same |
| 7 | Output is advisory only | `DetectionOutput.recommendedAction` is `string`, never invoked; `fuseRisk` always `executable:false`. | `risk-fusion.test.ts`, `safety-invariants.test.ts` |
| 8 | High-risk via existing policy+gate | Engine has no dispatch path. | structural scan |
| 9 | Parse failure ⇒ not `safe` | `validateModelRawOutput` → `createUnknownDetectionOutput` on `output_json_invalid` / `output_schema_invalid`. | `detection-validator.test.ts`, `security-detection-engine.test.ts` |
| 10 | Timeout ⇒ not `safe` | `provider_timeout` ⇒ `unknown`. | `ollama-detection.provider.test.ts` "timeout" |
| 11 | Provider offline ⇒ not `safe` | `provider_unavailable` ⇒ `unknown`. | `ollama-detection.provider.test.ts` "non-JSON envelope" |
| 12 | Illegal enum ⇒ not `safe` | JSON Schema `enum` + `additionalProperties:false` ⇒ `output_schema_invalid`. | `security-detection-engine.test.ts` "illegal verdict enum" |
| 13 | Shadow does not change behavior | `submit()` is fire-and-forget, sync, never throws; bounded queue. | `shadow-middleware.test.ts` |
| 14 | Default disabled | `DEFAULTS.enabled=false`; `'true'` string required. | `detection-config.test.ts` |

## Deferred / not delivered

- `advisory` / `enforced` modes — parsed but inert. Wiring them in requires a separate shadow-evaluation cycle and human sign-off per the spec.
- Postgres persistence of review records — file-based JSON is the v1 sink.
- Admin UI for human review — out of scope for the backend integration.
- Training-data promotion — `eligibleForTraining` is never flipped by code; requires a separate human-review tool.
- `ml/deployment/Modelfile` (legacy) is not modified. Consumers must migrate to `Modelfile.detector` explicitly.
