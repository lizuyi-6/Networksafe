# VIguard (AetherGuard) — Authorized LAN Live-Execution Challenge Set

**Dataset class:** *Authorized LAN Live-Execution Challenge Set* — a *live-captured synthetic
attack-attempt benchmark*. It is an **external independent challenge test set** for the
AetherArgus work, **not** training data.

## Read this first: what the labels mean

- Every request was **really sent** to the authorized target (`192.168.3.140:5173`) and every
  retained sample **really captured a response** (`responseActuallyReceived`, 0 connection
  failures in the final set).
- The attack payloads were **pre-designed by the test plan** and the attack-intent labels come
  **primarily from that design**. This is **not** "real-world / production / naturally-occurring
  attack traffic".
- `exploitConfirmed = 0` and `canaryObserved = 0` across the whole set: **no** payload is
  confirmed to have succeeded. A failed exploit is still a malicious *attempt*
  (`requestIntent=malicious_attempt`, `exploitOutcome=not_confirmed`) — it is **not** relabeled
  benign.
- The set is **target-specific** (`targetSpecific=true`) and **not eligible for training**
  (`split=external_challenge_test`, `eligibleForTraining=false`).
- Human double-review has **not** been completed: `humanReviewed=false`, `reviewerCount=0`,
  `interAnnotatorAgreement=null`, `cohenKappa=null`, `adjudicatedSamples=0`. See
  `review-guidelines.md` for the workflow that must run before any of those change.

## Three views – do not conflate (input / labels / metadata isolation)

`model-benchmark.jsonl` is the full bundle. It is split into three strictly-isolated sections,
exactly one of which a model is ever allowed to see:

```
model-benchmark.jsonl
├── input       ← the ONLY part a model may see (method, path, headers, body, sourceContext)
├── labels      ← scoring only; MUST NOT enter the prompt (verdict, attackFamily, requestIntent, …)
└── metadata    ← governance only; MUST NOT enter the prompt (split, eligibleForTraining, humanReviewed, …)
```

`requestIntent`, `exploitOutcome`, `verdict`, `attackFamily`, `recommendedAction`,
`contextSufficient`, and `isHardNegative` are **labels** (they encode the attack-intent design
and the scoring target), **not** pre-request client-observable fields. Conflating them with
`input` is exactly the label-leakage this dataset was restructured to prevent.

| View | Files | Contents | Use |
|---|---|---|---|
| **Evidence capture** | `normal-traffic.jsonl`, `attack-traffic.jsonl`, `hard-negatives.jsonl`, `prompt-injection.jsonl`, `unknown-cases.jsonl`, `all-sanitized.jsonl` | request + response status/headers/body + latency + groundTruth + executionEvidence | Proves each request was really executed. **Not a valid model input.** |
| **Model benchmark (full bundle)** | `model-benchmark.jsonl` | `input` + `labels` + `metadata` (joined by `sampleId`) | The canonical record. **Never feed the whole bundle to a model** – it contains labels. |
| **Process-isolated splits** | `model-inputs.jsonl` (=`sampleId`+`input`), `model-labels.jsonl` (=`sampleId`+`labels`+`metadata`) | input alone vs. labels+metadata alone | **Recommended:** the model process reads `model-inputs.jsonl`; the scoring process reads `model-labels.jsonl`; results are joined by `sampleId`. This physically prevents a label from reaching the prompt. |

`verify.js` enforces this isolation: `requestIntent` and every other label field is absent from
`input`, and any post-response or label field appearing in the model-input view fails the
benchmark-leak gate (see `WB1`-`WB4`, `ML1`-`ML4` in `test/run-tests.js`).

## Privacy sanitization

`sanitize.js` performs (1) recursive key-based redaction of sensitive fields (case-insensitive:
password/secret/token/cookie/authorization/sessionId/tenantId/userId/email/findingId/…) and
(2) string-level matching so the same identifiers are caught when embedded inside a
stringified-JSON body. Internal identifiers (sessionId/userId/tenantId/findingId/UUID) are
replaced with **stable, non-reversible placeholders** (e.g. `[RESOURCE_ID_4F91A2C8]`) via
HMAC-SHA256 keyed by a dataset-local salt in `raw-private/.id-salt` (gitignored; never
committed). The same real id always maps to the same placeholder within this dataset
(entity consistency) but the mapping is neither reversible nor cross-dataset stable.
`privacy-audit-report.json` records the method and per-category residual findings (should be 0).

## Regenerate + validate (offline; does not contact the target)

```bash
cd ml/data/lan_challenge_capture
node enrich.js      # re-sanitize + enrich (requestIntent/exploitOutcome/datasetMetadata), rebuild all-sanitized + model-benchmark + review-queue
node finalize.js    # regenerate dataset-manifest.json + collection-report.md + findings.json + pii-redaction-report.json
node verify.js      # fail-closed: JSON Schema (draft 2020-12) + semantic + privacy + benchmark-leak + manifest checks; exit != 0 on any failure
node test/run-tests.js   # fail-closed suite (prints `passed/total`); covers verify.js + sanitizer + salt isolation + safe-truncation boundaries
```

`verify.js` returns a **non-zero exit code** on: unparseable JSON, schema error, semantic
error, duplicate sampleId, any red-line privacy finding (sessionId token / JWT / cookie /
authorization / raw UUID / real email / tenant value / windows user path), any post-response
field in the benchmark, manifest/actual count mismatch, or `all-sanitized.jsonl` ≠ union of
the category files.

## Training-leak protection

`scripts/guards/check-training-leak-challenge-capture.mjs` (wired into `npm run
check:release-guards`, which runs in CI) fails if any `viguard-lan-*` sampleId appears in a
training/release/manifest artifact, if any file outside this directory references it as a data
source, or if any sample is marked `eligibleForTraining=true` / a non-challenge split.

## Files

See `dataset-manifest.json` for authoritative counts and dataset metadata. Operator action
required after any rotation of the capture: **invalidate all sessions for the dedicated test
account** (the captured evidence references session identifiers that, while now placeholder-
mapped, were issued to that account).
