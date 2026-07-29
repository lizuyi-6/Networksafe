# VIguard (AetherGuard) Authorized LAN Live-Execution Challenge Set

**Dataset class:** Authorized LAN Live-Execution Challenge Set (live-captured synthetic attack-attempt benchmark).
**Date:** 2026-07-29 · **Target:** 192.168.3.140:5173 (AetherGuard; operator codename "VIguard")
**Scope:** authorized LAN testing on 192.168.3.140 only · sequential, <=2 req/s, concurrency 1

> **What this dataset is - and is not.** Every request was really sent to the authorized
> target and every retained sample captured a real response. However, the attack payloads
> were **pre-designed by the test plan** and the attack-intent labels come **primarily from
> that design**, not from naturally occurring traffic. `exploitConfirmed=0` and
> `canaryObserved=0` across the set. This is therefore **not** "real-world/production
> attack traffic", **not** a corpus of confirmed successful exploits, and it is
> **target-specific**. It is reserved as an **external independent challenge test set**
> (`split=external_challenge_test`, `eligibleForTraining=false`) and must **not** be used
> as training data. Human double-review has **not** been completed
> (`humanReviewed=false`, `reviewerCount=0`, `cohenKappa=null`).

## Target identification

"VIguard" appears nowhere in the codebase (3 case-insensitive grep variants, 0 matches). The live service at 192.168.3.140:5173 was identified as **AetherGuard** by: `<title>AetherGuard | 杭州视界奇点科技有限公司</title>`, `/aetherguard-logo-512.png`, Vite dev server, `GET /health -> 200 {"status":"ok"}`, and `GET /api/health -> 401 AUTH_TOKEN_MISSING` ({success,data,error} envelope). "VIguard" is the operator-assigned codename for this deployed AetherGuard instance.

## Credentials

Operator-provided dedicated test account (tenant_admin, starter). Password redacted everywhere; stored only in gitignored `raw-private/.test-creds.env`. The AetherGuard `.env` local admin account was NOT used (its nature vs the authorized target was unconfirmable). Login verified: HTTP 200 with httpOnly cookies.

## Sample counts

| Category | Count | Target |
|---|---|---|
| normal-traffic | 152 | >=150 |
| attack-traffic | 69 | >=40 |
| hard-negatives | 85 | >=80 |
| prompt-injection | 56 | >=50 |
| unknown-cases | 51 | >=50 |
| **total** | **413** | |

## Evidence view vs. model-benchmark view (input/labels/metadata isolation)

Three views of the same 413 samples exist and must not be conflated:

- **Evidence capture** (`*-traffic.jsonl`, `all-sanitized.jsonl`) retains request + response
  status/headers/body + latency + ground truth + execution evidence. It proves each request
  was really executed, but is **not** a valid model input.
- **Model benchmark** (`model-benchmark.jsonl`) is a **physically isolated** record:
  `{sampleId, input, labels, metadata}`. `input` holds ONLY pre-request, client-observable
  fields (method, path, request headers/body, authenticated flag, targetApplication) and is
  the ONLY object a model may read. `labels` (verdict, attackFamily, recommendedAction,
  contextSufficient, **requestIntent**, exploitOutcome, isHardNegative) and `metadata`
  (split, eligibleForTraining, ...) are scoring/audit data and must NEVER enter the model
  prompt. **`requestIntent` is a LABEL (derived from the capture verdict), NOT a model input.**
  The JSON Schema (`schema/benchmark-sample.schema.json`) rejects the legacy flat structure
  (top-level method/path/requestIntent) and rejects any label field placed inside `input`.
- **Process-level isolation files** (`model-inputs.jsonl` = sampleId+input ONLY;
  `model-labels.jsonl` = sampleId+labels+metadata) exist so an eval harness can feed the model
  process ONLY inputs and join predictions to labels via `sampleId` afterwards. `sampleId` is a
  join key, never a model feature. `build-model-input.js` is a whitelist prompt builder that
  reads ONLY `input.*` by explicit field name (no object spread) and fails closed if any label
  field appears in `input`.

> **No-response leakage.** responseStatus, response headers/body, latencyMs, and executionEvidence
> appear ONLY in the evidence view - never in `input`. A model cannot read target-response
> features to guess labels.

## Body omission (two reasons; both fail-closed)

Bodies are omitted (set to `null` with `bodyOmitted=true`) for two distinct reasons, both
visible per-sample via `bodyOmittedReason` and summarized in the manifest `idMapping.bodiesOmittedReasonBreakdown`:

1. **`legacy_capture_truncated_before_complete_sanitization`** (partial-fragment-safe omission).
   The original capture truncated some response bodies to 4000 bytes BEFORE completing sanitization,
   which could split an identifier mid-value and leave a partial fragment. Because `raw-private/`
   holds no raw response bodies, those fragments cannot be recovered - they are **omitted, not
   guessed**. Any body that still contains a partial-identifier fragment (truncated UUID prefix,
   sensitive key + non-placeholder value, partial JWT, session/token key + long hex) is omitted.

2. **`legacy_capture_structurally_truncated`** (JSON structural break; new in v2.1).
   The same legacy pre-sanitization truncation could cut a JSON response body mid-string, breaking
   `JSON.parse`. The verifier's structural-integrity gate now fails closed if a response body
   marked complete (`bodyTruncated=false`, `bodyOmitted=false`) is JSON-shaped but does not parse;
   enrichment detects this at regeneration time and omits the body with this reason instead of
   leaving a structurally-broken body in the benchmark. The **true original size is preserved** via
   `capturedContentLengthHeader` (the captured Content-Length header) and `preOmissionRetainedBytes`
   (bytes of sanitized body held immediately before omission), so omission never resets the captured
   size evidence to 0.

72 sample(s) had body content omitted. Breakdown: {"legacy_capture_truncated_before_complete_sanitization":29,"legacy_capture_structurally_truncated":43}.
Of these, 29 have `preOmissionRetainedBytes=0` (historical damage from a prior NON-IDEMPOTENT enrich run that zeroed the retained-byte evidence after omitting the body; the original bodies are gone and the byte count is UNRECOVERABLE -- 0 here means UNKNOWN retained length, not a real 0-length body; the true original size is still available via `capturedContentLengthHeader`). The `legacy_capture_structurally_truncated` omissions retain non-zero `preOmissionRetainedBytes`/`originalBodyBytes`; the verifier now FAILS CLOSED if any structural omission reports 0 bytes (a real defect), while recording the partial-fragment 0-byte cases as `omittedBodiesWithUnknownRetainedLength` rather than treating 0 as a real body length. **Omission reason and byte evidence are now preserved across re-runs** (enrich.js `processBody` takes the full prior body-state; the idempotency tests in `test/run-tests.js` prove two/three consecutive runs produce byte-identical normalized output). The verifier fails closed (exit 1) if ANY residual partial fragment remains in committed data AND if any JSON-shaped response body marked complete fails to parse, so `privacyFindingCount` and `structuralErrorCount` both reaching 0 in `verification-report.json` are the gates, not the omission count.

## ID-mapping statistics (two explicitly-named metrics; same value everywhere)

The manifest, verification-report, and privacy-audit-report all carry the SAME `idMapping` (produced from one shared computation in `dataset-files.js`), so a given metric name has one value everywhere. There are TWO metrics with distinct meanings -- do not conflate them:

- **`canonicalEvidence`** scans only the five category evidence files (the source of truth). `uniqueInternalIdsMapped` = distinct captured identifiers; `totalMappedOccurrences` = their occurrences in the evidence itself.
- **`allCommittedViews`** scans every committed data view (5 evidence + all-sanitized + benchmark + model-inputs + model-labels + review-queue). `totalMappedOccurrences` here is the **CROSS-VIEW occurrence count of the SAME placeholders** across all committed files. The derived views re-project the same identifiers, so this is NOT the number of distinct identifiers -- it is a leak-audit coverage number.

`canonicalEvidence.uniqueInternalIdsMapped = 10` (distinct identifiers).
`canonicalEvidence.totalMappedOccurrences = 206` (occurrences in the evidence).
`allCommittedViews.totalMappedOccurrences = 688` (cross-view occurrences across all committed files; `688` is NOT "688 real identifiers").

## Response status distribution (real responses only; 0 connection-failed samples)

| Status | Count |
|---|---|
| HTTP 200 | 191 |
| HTTP 404 | 119 |
| HTTP 403 | 80 |
| HTTP 401 | 12 |
| HTTP 500 | 10 |
| HTTP 400 | 1 |

## Attack family distribution (pre-designed intent labels)

| Family | Count |
|---|---|
| prompt_injection | 56 |
| sqli | 15 |
| xss | 10 |
| path_traversal | 9 |
| command_injection | 8 |
| ssrf | 6 |
| idor | 6 |
| auth_bypass | 3 |
| privilege_escalation | 3 |
| api_abuse | 3 |
| malicious_upload | 2 |
| business_logic | 2 |
| csrf | 1 |
| cors_misconfig | 1 |

## Reality guarantees

Every one of the 413 samples is a real HTTP request to 192.168.3.140:5173 with a real response captured (0 connection failures). No fabricated requests or responses. Credentials/tokens redacted. No real PII (synthetic TEST_PERSON_/AETHER_CANARY markers only). No destructive actions (no DELETE, no real drops; POSTs targeted non-existent test UUIDs or reversible test data). Only 192.168.3.140 was contacted; the only other host involved was the local echo listener on 192.168.3.107 (SSRF canary), which is the authorized test machine. Because payloads and intent labels are pre-designed, "real" here means "really executed", **not** "naturally occurring".

## Key findings

1. **Auth enforced** on all /api endpoints (401 for missing/malformed/forged JWT).
2. **No injection canary observed**: 0 exploits confirmed across 69 attack samples; payloads rejected by validation/parameterized queries for the tested inputs. This does **not** prove the attack classes are impossible in general.
3. **No SSRF**: echo listener received 0 fetches.
4. **FND-004 - availability anomalies observed (needs-investigation)**: during sequential requests at concurrency 1 / ~1.8 req/s the client observed repeated authenticated-session invalidation and at least one period of connection failure; the harness re-authenticated automatically. **Root cause is unconfirmed** - no server-side PID, restart counter, OOM log, memory telemetry, or stack trace was collected. Do **not** attribute to crash/restart/OOM/concurrency without inspecting backend process logs, systemd/Docker restart counters, memory telemetry, and OOM-killer logs.

## Unverified scope (本轮未覆盖范围)

- Only port 5173 exposed (80/443/3000/3001/5000/8000/8080/8443 probed -> no response); the API is reachable only via the 5173 Vite proxy. Direct backend/Postgres/Redis not touched.
- exploitConfirmed=false means the app rejected the payload for the tested input - it does NOT prove the attack class is impossible in general.
- No real data exfiltration attempted (per scope); SQLi/IDOR used non-existent test UUIDs, not real records.
- Not tested: websockets (Socket.IO agent gateway), hardware-authorization/final-defense dangerous actions, file-upload binary parsing, OIDC flows.
- Ground truth is collector-assigned from the test design; **independent human adjudication has not been performed** (see review-guidelines.md / review-queue.jsonl).
- 72 sample body(ies) were omitted (partial-identifier fragments that could not be recovered, and JSON-structural-truncation breaks); those samples retain status/headers/groundTruth and the true original size (capturedContentLengthHeader) but have body=null. 29 of those have preOmissionRetainedBytes=0 (unrecoverable historical byte-evidence damage; the original size is still known via capturedContentLengthHeader). This reduces response-body coverage for those samples.

## Outputs

See `dataset-manifest.json` for file list/counts and dataset metadata. `verification-report.json` has fail-closed schema/semantic/privacy validation results; `privacy-audit-report.json` has the leak-audit categories. `raw-private/` is gitignored (holds creds + raw cookies + id-mapping salt); only sanitized JSONL/JSON/MD may be committed.

## Operator reminder

Invalidate all sessions for the dedicated test account used during capture (cookies/tokens were captured into the dataset and then redacted, but the live sessions on the target should be revoked).
