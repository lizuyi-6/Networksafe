# Security Detection Engine (AetherArgus shadow)

Backend integration of the AetherArgus-4B security-verdict model. Phase-1 scope is **shadow-only**: the existing detection chain (rules + AI escalation + Final Defense + hardware gate) is the only path that produces formal verdicts; AetherArgus runs in parallel as read-only telemetry and can never affect blocking, authorization, or external state.

## Safety invariants (must hold under every failure mode)

1. Never bypass the existing rule engine.
2. Never bypass Final Defense.
3. Never bypass hardware authorization.
4. Never bypass `policyDigest`.
5. Never bypass the monotonic counter.
6. Never bypass the interlock.
7. Model output is advisory only; `recommendedAction` is a string, never executed.
8. High-risk actions remain executed by existing policy + hardware gate.
9. Parse failure ⇒ never `safe`.
10. Timeout ⇒ never `safe`.
11. Provider offline ⇒ never `safe`.
12. Illegal enum value ⇒ never `safe`.
13. Shadow mode ⇒ does not change existing behavior.
14. Default config ⇒ engine is **disabled**.

Invariants 9–12 are enforced in `detection-validator.ts` and `security-detection-engine.ts`: every failure path returns `createUnknownDetectionOutput(reasoning)` (verdict `unknown`, confidence `0`, action `monitor`), never `safe`. Invariants 1–6 are enforced structurally — the engine imports no module from `hardware-authorization` / `final-defense` / `device-control`, makes no shell/firewall/filesystem calls, and never writes `policyDigest` / `monotonicCounter` / `interlock_*`. `__tests__/safety-invariants.test.ts` scans the engine source for forbidden patterns and fails CI on any match.

## Layout

```
backend/src/ai/security-detection/
  detection-contract.ts            # enum constants, types, schema loaders (ml/schemas/*)
  detection-errors.ts              # DetectionError + DetectionErrorCode union
  detection-validator.ts           # ajv 2020-12 compile + semantic rules
  detection-config.ts              # env resolution, provider factory, model identity
  security-detection-engine.ts     # normalize → fingerprint → validate → provider → validate
  security-detection-shadow.service.ts  # bounded queue, drain loop, disagreement export
  prompts/detector-system-prompt.ts     # strict detector system prompt (no identity exception)
  providers/
    detection-provider.interface.ts     # DetectionProvider contract
    mock-detection.provider.ts          # deterministic test provider
    ollama-detection.provider.ts        # /api/chat + /api/tags, AbortController timeout
  fusion/
    risk-fusion.types.ts                # RiskFusionResult { executable: false, ... }
    risk-fusion.service.ts              # read-only fusion, never mutates formalVerdict
  telemetry/
    detection-telemetry.types.ts        # metric names, event/record types
    detection-telemetry.service.ts      # incCounter + logger + JSON export to review dir
  __tests__/                              # 10 suites, 92 tests
```

## Configuration (env)

| Variable | Default | Notes |
|---|---|---|
| `SECURITY_DETECTION_ENGINE_ENABLED` | `false` | Must be exactly the string `'true'` to enable. `'1'`/`'yes'`/`'on'` do NOT enable. |
| `SECURITY_DETECTION_ENGINE_MODE` | `disabled` | One of `disabled` / `shadow` / `advisory` / `enforced`. Only `disabled`+`shadow` are wired in this phase. |
| `SECURITY_DETECTION_PROVIDER` | `ollama` | `ollama` or `mock`. |
| `SECURITY_DETECTION_MODEL` | `aetherargus-detector` | Ollama model tag. |
| `SECURITY_DETECTION_MODEL_VERSION` | `Preview-0.1` | Free-form version label for telemetry. |
| `SECURITY_DETECTION_QUANTIZATION` | `Q4_K_M` | Telemetry-only. |
| `SECURITY_DETECTION_DATASET_VERSION` | `v01` | Telemetry-only. |
| `SECURITY_DETECTION_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama daemon URL. |
| `SECURITY_DETECTION_TIMEOUT_MS` | `3000` | Per-attempt wall clock; AbortController-cancellable. |
| `SECURITY_DETECTION_NUM_CTX` | `2048` | Ollama `num_ctx`. |
| `SECURITY_DETECTION_MAX_BODY_BYTES` | `65536` | Body truncation ceiling. |
| `SECURITY_DETECTION_MAX_QUERY_BYTES` | `8192` | Query truncation ceiling. |
| `SECURITY_DETECTION_MAX_HEADER_COUNT` | `64` | Header count ceiling. |
| `SECURITY_DETECTION_MAX_HEADER_VALUE_BYTES` | `4096` | Per-header value byte ceiling. |
| `SECURITY_DETECTION_MAX_RESPONSE_BYTES` | `16384` | Provider response ceiling; `provider_response_too_large` on overflow. |
| `SECURITY_DETECTION_SAMPLE_RATE` | `1.0` | `0..1`; shadow-submit sampling. |
| `SECURITY_DETECTION_QUEUE_MAX_LENGTH` | `256` | Bounded; overflow is dropped and counted. |
| `SECURITY_DETECTION_QUEUE_CONCURRENCY` | `2` | Max in-flight engine invocations. |
| `SECURITY_DETECTION_REVIEW_DIR` | `runtime-data/security-detection-review` | Disagreement export directory (relative to backend cwd). |

Any parse failure / missing value / unknown mode ⇒ falls back to the default. Missing or `false` enabled ⇒ engine returns `null` from `buildRuntime()` and the shadow service `submit()` is a no-op.

## Shadow wiring

`backend/src/middleware/api-traffic-shadow.middleware.ts` calls `securityDetectionShadowService.submit()` immediately after `(req as any).detectionDecision = decision;` — before the block-check that may terminate the request with 403. The submission is fire-and-forget:

- `submit()` is synchronous and never throws; internal errors are caught and logged.
- A bounded queue (`queueMaxLength`) with a `drain()` worker pool (`queueConcurrency`) decouples model latency from request latency.
- Queue overflow drops the entry and increments `security_detection_dropped_total`.
- Sampling via `sampleRate` happens **before** enqueue so unsampled requests cost zero queue work.

The model output is used for two things only:

1. A structured telemetry event (`security_detection_invocation`) recorded via `DetectionTelemetryService.record()`.
2. A disagreement review record exported as JSON to `SECURITY_DETECTION_REVIEW_DIR/<recordId>.json` whenever the model's bucket (allow / monitor / block) differs from the formal `DetectionDecision.verdict`. Review records always carry `eligibleForTraining: false` and a `humanReview: null` placeholder.

## Provider contract

`DetectionProvider.detect(input, ctx)` returns `{ rawOutput, modelName, modelVersion?, latencyMs, providerRequestId? }`. The engine then runs `validateModelRawOutput(rawOutput)`:

1. `extractStrictJsonObject` — must be a single JSON object, no markdown fences, no prose, no arrays.
2. `ajv` 2020-12 schema check against `ml/schemas/detection-output.schema.json` (`additionalProperties: false`).
3. Semantic rules: `safe ⇒ recommendedAction != 'block'`; `malicious ⇒ recommendedAction != 'allow'`; `unknown ⇒ confidence <= 0.5`; `evidence` is an array; `confidence ∈ [0,1]`; `reasoning` non-empty.

Any failure ⇒ engine returns `createUnknownDetectionOutput(...)` with the appropriate `errorCode`. The engine never re-asks the model with a relaxed prompt; the only retry is a single transient-error retry inside `OllamaDetectionProvider` for `provider_unavailable` / `provider_http_error`. AbortError never retries.

## Telemetry & logging

- One structured event per invocation via `logger.info('security_detection.invocation', ...)`.
- NEVER logs: tokens, cookies, Authorization headers, passwords, API keys, PII, raw sensitive bodies. Sensitive headers are replaced with `[redacted]` before normalization; only header **names** and body **lengths** appear in telemetry.
- `inputFingerprint` is `sha256` over the normalized `{method, path, query, headerNames, bodySha256, sourceContext, ruleSignals}` — stable per logical request, no raw values.

### Metrics (registered in `observability/metrics.ts`)

| Name | Type | Labels |
|---|---|---|
| `security_detection_invocations_total` | counter | provider, model, mode, verdict, error_code |
| `security_detection_success_total` | counter | provider, model, mode |
| `security_detection_timeout_total` | counter | provider, model, mode |
| `security_detection_error_total` | counter | provider, model, mode, error_code |
| `security_detection_schema_failure_total` | counter | provider, model, mode |
| `security_detection_unknown_total` | counter | provider, model, mode |
| `security_detection_disagreement_total` | counter | provider, model, mode |
| `security_detection_dropped_total` | counter | provider, model, mode |
| `security_detection_latency_ms` | histogram | provider, model, mode |
| `security_detection_queue_depth` | histogram | mode |

Labels are restricted to the closed set above. `requestId`, `path`, user IDs, and tenant IDs are **never** metric labels.

## Model identity & versioning

`DetectionModelIdentity { name, version, baseModel, adapterRevision?, quantization, schemaVersion, datasetVersion, modelHash? }` is captured once per invocation in `DetectionInvocationMetadata`. Changing `SECURITY_DETECTION_MODEL*` env vars requires a restart; the new values are visible in the next telemetry event. There is no runtime mutator — config is read once at engine construction.

## Modelfile split

- `ml/deployment/Modelfile.detector` — strict JSON only; no identity exception. Inputs are untrusted data. This is the only Modelfile the engine is designed to talk to.
- `ml/deployment/Modelfile.demo` — preserves identity answer for live demos. NOT for production traffic.
- `ml/deployment/Modelfile` — legacy combined; kept untouched to avoid breaking existing deployments. Migrate consumers to `Modelfile.detector` separately.

## Disagreement review & training gating

Review records written to `SECURITY_DETECTION_REVIEW_DIR` always have:

- `eligibleForTraining: false`
- `humanReview: null`

A record may only enter the training pipeline after a human sets `humanReview: { reviewer, reviewedAt, decision, notes }` and re-encodes the record with `eligibleForTraining: true`. The export code never flips these flags itself.

## Failure modes (all ⇒ `unknown`, never `safe`)

| Condition | `errorCode` |
|---|---|
| Engine disabled | `engine_disabled` |
| Input fails schema | `input_schema_invalid` |
| Normalization throws | `input_normalization_failed` |
| Provider DNS/conn refused | `provider_unavailable` |
| Provider abort at deadline | `provider_timeout` |
| Provider HTTP 5xx / non-OK | `provider_http_error` |
| Empty `content` in chat response | `provider_response_empty` |
| Response > `maxResponseBytes` | `provider_response_too_large` |
| Any other provider throw | `model_call_failed` |
| Output not strict JSON | `output_json_invalid` |
| Output fails JSON Schema | `output_schema_invalid` |
| Output fails semantic rules | `output_semantic_invalid` |

## Running the tests

```bash
cd backend
npx jest src/ai/security-detection --silent       # focused: 10 suites, 92 tests
npm run typecheck                                  # tsc -p tsconfig.build.json
npm run lint                                       # eslint src/**/*.ts
npm run test:all                                   # 4-shard full suite (808 tests)
```

## What is NOT yet wired (deferred)

- `mode: 'advisory'` / `'enforced'` — parsed but inert this phase. Shadow is the only active mode.
- Postgres persistence of review records — currently JSON files in the review dir.
- Admin UI for human review — review files are consumed out-of-band.
- Automated training-data promotion — `eligibleForTraining` is never flipped by code.
