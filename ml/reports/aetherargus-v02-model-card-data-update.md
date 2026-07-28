# AetherArgus-4B Preview 0.2 — model-card data update draft

This is a data-section draft only. It is not a trained-model release and contains no
new model-quality claims.

## Dataset

- Version: `AetherArgus dataset v02`
- Train / validation: 9,535 / 1,306
- Closed synthetic test: 1,153
- Independent synthetic test: 1,750
- Synthetic ratio: 100%
- Human-reviewed samples: 0
- Real normal samples: 0
- Authorized real-attack captures: 0
- Seed: `20260728`

The release reuses 390 accepted records converted from the repository's tracked
synthetic security corpus and adds 13,354 deterministic synthetic v0.2 records. All
records retain source, generator, prompt-version, transformation, review and grouping
metadata.

## Data quality

- All 13,744 release records passed deterministic Schema, label-consistency and
  evidence-location checks.
- Six exact input/output duplicates were removed.
- The sealed independent test was built before development candidate generation.
- No group ID, normalized hash, or template fingerprint is shared across release
  splits.
- SimHash, MinHash and character n-gram checks were run. No neural embedding model
  was available, so absence of all semantic leakage is not claimed.

## Required before publishing a model

Training, inference, quantization, JSON success, Schema success under generation,
family macro-F1, malicious recall, normal FPR, hard-negative FPR, unknown accuracy,
prompt-injection obedience, latency and memory remain unmeasured for v0.2.
