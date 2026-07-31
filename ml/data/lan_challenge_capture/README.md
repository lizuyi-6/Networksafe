# VIguard (AetherGuard) — Authorized LAN Live-Execution Challenge Set

**Dataset class:** *Authorized LAN Live-Execution Challenge Set* — a live-captured synthetic attack-attempt benchmark. It is an **external independent challenge test set** for the AetherArgus work, **not** training data.

## Read this first: what the labels mean

- Every request was really sent to the authorized target and every retained sample captured a response.
- The attack payloads were pre-designed by the test plan. This is not real-world, production, or naturally occurring attack traffic.
- `exploitConfirmed=0` and `canaryObserved=0`: no payload is confirmed to have succeeded. A failed exploit can still be a malicious attempt.
- The set is target-specific and not eligible for training (`split=external_challenge_test`, `eligibleForTraining=false`).
- The model-facing reference labels were produced through dual-AI annotation, third-AI adjudication, and a model-visible-context audit.
- A complete confidential blind human review was subsequently conducted outside the public repository. It covered **413/413** samples, found **0** disagreements, and required **0** label changes.
- Reviewer identities, reviewer count, worksheets, and raw materials are retained in a restricted environment. The public repository contains a SHA-bound operator attestation at `human-review/human-review-attestation.json`.
- The final-label SHA-256 remains `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`.

## Three views — do not conflate input, labels, and metadata

`model-benchmark.jsonl` is split into three isolated sections, exactly one of which a model may see:

```text
model-benchmark.jsonl
├── input       ← the only model-visible part
├── labels      ← scoring only; must not enter the prompt
└── metadata    ← governance only; must not enter the prompt
```

`requestIntent`, `exploitOutcome`, `verdict`, `attackFamily`, `recommendedAction`, `contextSufficient`, and `isHardNegative` are labels, not pre-request client-observable fields.

| View | Files | Contents | Use |
|---|---|---|---|
| Evidence capture | category JSONL files and `all-sanitized.jsonl` | request + response evidence + collection metadata | Proves execution; not valid model input. |
| Full benchmark bundle | `model-benchmark.jsonl` | input + labels + metadata | Canonical joined record; never feed the whole bundle to a model. |
| Process-isolated views | `model-inputs.jsonl`, `model-labels.jsonl` | input alone vs labels + metadata | Recommended inference/scoring isolation. |

`verify.js` enforces this separation and fails if labels or post-response fields appear in the model-input view.

## Privacy sanitization

`sanitize.js` recursively redacts sensitive keys and scans string content for embedded identifiers. Session IDs, user IDs, tenant IDs, finding IDs, UUIDs, and related values are replaced with stable, non-reversible HMAC-SHA256 placeholders using a dataset-local secret salt in `raw-private/.id-salt`, which is gitignored and never committed.

`privacy-audit-report.json` records residual privacy findings and should remain at zero.

## Regenerate and validate offline

```bash
cd ml/data/lan_challenge_capture
node enrich.js
node finalize.js
node verify.js
node test/run-tests.js

cd ../../..
node ml/data/lan_challenge_capture/adjudication/build-manifest.js
node ml/data/lan_challenge_capture/adjudication/build-report.js
node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js
node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js
```

These commands are offline and do not contact the target.

## Training-leak protection

`scripts/guards/check-training-leak-challenge-capture.mjs`, wired into release guards and CI, fails if any `viguard-lan-*` sample appears in training/release artifacts, if files outside this directory reference the challenge data as a training source, or if any challenge sample is marked training-eligible.

## Human-review terminology

Allowed:

> confidentially human-reviewed reference labels

> AI-assisted reference labels subsequently confirmed through confidential blind human review

Not allowed:

> publicly reproducible raw human annotations

> infallible objective ground truth

> representative natural production traffic

The human-review attestation is post-evaluation. Because the final-label file remained byte-identical, model predictions and scoring did not require rerunning.

## Files

See `dataset-manifest.json` for capture-level counts and metadata, `adjudication/final-labels-manifest.json` for label provenance, and `human-review/` for the public confidential-review attestation.
