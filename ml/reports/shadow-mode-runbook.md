# Shadow-mode runbook

Operational guide for running AetherArgus in shadow mode.

## Enabling the engine

Set these in `backend/.env` (or process env), then restart the backend:

```
SECURITY_DETECTION_ENGINE_ENABLED=true
SECURITY_DETECTION_ENGINE_MODE=shadow
SECURITY_DETECTION_PROVIDER=ollama
SECURITY_DETECTION_MODEL=aetherargus-detector
SECURITY_DETECTION_MODEL_VERSION=Preview-0.1
SECURITY_DETECTION_OLLAMA_BASE_URL=http://127.0.0.1:11434
```

`SECURITY_DETECTION_ENGINE_ENABLED` must be the exact string `true`. `'1'`, `'yes'`, `'on'` are rejected — engine stays off. `mode` must be exactly `shadow`; anything else falls back to `disabled`.

Confirm the engine is up:

```
curl http://127.0.0.1:11434/api/tags    # model is listed
grep security_detection backend logs    # security_detection.invocation events appear
```

## Ollama model install

The engine expects the `aetherargus-detector` model built from `ml/deployment/Modelfile.detector`:

```bash
cd ml/deployment
ollama create aetherargus-detector -f Modelfile.detector
```

The demo Modelfile (`Modelfile.demo`) preserves the identity answer and is NOT for production traffic. The legacy combined `Modelfile` is left for backward compatibility; do not point the engine at it.

## Sampling & load control

Start conservative:

```
SECURITY_DETECTION_SAMPLE_RATE=0.05     # 5% of traffic
SECURITY_DETECTION_QUEUE_MAX_LENGTH=256
SECURITY_DETECTION_QUEUE_CONCURRENCY=2
SECURITY_DETECTION_TIMEOUT_MS=3000
```

Watch `security_detection_dropped_total` and `security_detection_queue_depth`. If dropped > 0 sustained, either reduce `sampleRate` or increase `queueConcurrency` (model throughput permitting).

## Metrics to watch

| Metric | Healthy sign | Action on anomaly |
|---|---|---|
| `security_detection_invocations_total` | rises with sampled traffic | if flat while traffic flows, check enabled + sample rate |
| `security_detection_success_total` / `invocations_total` | near 1.0 | drops ⇒ provider issue; see error_code labels |
| `security_detection_timeout_total` | low | spikes ⇒ model too slow; reduce `sampleRate` or raise `timeoutMs` |
| `security_detection_error_total{error_code=...}` | low | per-code investigation |
| `security_detection_schema_failure_total` | very low | spikes ⇒ model output drift; check Modelfile / model version |
| `security_detection_unknown_total` | low-moderate | sustained high ⇒ provider failing |
| `security_detection_disagreement_total` | non-zero is expected | very high ⇒ either rules too strict or model under-trained |
| `security_detection_dropped_total` | zero | non-zero ⇒ queue saturating |
| `security_detection_latency_ms` | p99 < timeoutMs | p99 hits timeout ⇒ model too slow for current SLA |

## Disagreement review

Files land in `backend/runtime-data/security-detection-review/<recordId>.json`. Each record:

```json
{
  "recordId": "uuid",
  "inputFingerprint": "sha256-hex",
  "redactedInput": { "method": "...", "path": "...", "queryLength": 0, "headerNames": [...], "bodyLength": 0, "sourceContext": {...}, "ruleSignals": [...] },
  "ruleDecision": { "verdict": "...", "matchedRuleIds": [...], "riskScore": 0, "decisionSource": "...", "aiVerdict": null },
  "modelDecision": { "output": {...}, "metadata": {...} },
  "finalDecision": { "verdict": "...", "executed": true, "note": "formal pipeline verdict executed; shadow output never overrides" },
  "humanReview": null,
  "eligibleForTraining": false
}
```

Review procedure:

1. Triage by `modelDecision.output.verdict` vs `ruleDecision.verdict`.
2. For each disagreement, manually classify: rule false positive / rule false negative / model false positive / model false negative / ambiguous.
3. Only after human sign-off, set `humanReview: { reviewer, reviewedAt, decision, notes }` and re-encode with `eligibleForTraining: true`. **The exporter never sets these itself.**
4. Move signed-off records to the dataset pipeline. Do not batch-promote without review.

## Failure responses

| Symptom | Likely cause | Action |
|---|---|---|
| `provider_unavailable` spikes | Ollama daemon down | `systemctl status ollama`; restart; check `SECURITY_DETECTION_OLLAMA_BASE_URL` |
| `provider_timeout` spikes | Model slow / box overloaded | Reduce `sampleRate`; increase `timeoutMs`; scale hardware |
| `provider_response_too_large` | Model returning verbose output | Verify using `Modelfile.detector`; check `SECURITY_DETECTION_MAX_RESPONSE_BYTES` |
| `output_json_invalid` spikes | Model wrapping JSON in markdown / prose | Verify Modelfile; re-train with strict-JSON examples |
| `output_schema_invalid` spikes | Extra fields / illegal enum | Check model version matches `Modelfile.detector` |
| `output_semantic_invalid` spikes | `safe+block` / `malicious+allow` / `unknown+confidence>0.5` | Model behavior bug; re-train |
| Engine produces zero invocations | Config not enabled / sample rate 0 | Check `SECURITY_DETECTION_ENGINE_ENABLED` is the string `true` |
| `security_detection_dropped_total` rising | Queue saturated | Reduce `sampleRate` or raise `queueConcurrency` |

## Disabling

```
SECURITY_DETECTION_ENGINE_ENABLED=false
# or just remove the variable
```

Restart. The shadow service's `submit()` becomes a no-op; zero invocations, zero queue work. The formal detection pipeline is unaffected either way.

## What shadow mode NEVER does

- Blocks a request based on the model.
- Modifies the formal `DetectionDecision`.
- Touches Final Defense, hardware authorization, `policyDigest`, monotonic counter, or interlock.
- Executes `recommendedAction`.
- Logs tokens / cookies / auth headers / passwords / API keys / PII / raw sensitive bodies.
- Uses `requestId`, `path`, or user IDs as metric labels.
- Auto-promotes review records to training data.

If any of these are observed, treat as a critical bug and disable the engine immediately.
