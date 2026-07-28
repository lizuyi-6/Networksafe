# AetherArgus-4B Preview 0.2 — model-card data update draft

This is a data-section draft only. It is not a trained-model release and contains no
new model-quality claims.

## Dataset

- Version: `AetherArgus dataset v02`
- Train / validation: 14,314 / 1,752
- Closed synthetic test: 1,236
- Independent synthetic test: 1,750
- Synthetic ratio: 100%
- Human-reviewed samples: 0
- Real normal samples: 0
- Authorized real-attack captures: 0
- Seed: `20260728`

The 19,052-record release contains 13,354 deterministic v0.2 records, 389 accepted
records converted from the repository's tracked synthetic security corpus, and 5,309
public open-source-derived records. The public-derived portion uses checksum-pinned
OWASP CRS regression requests, the MIT-licensed S-Labs training split, and the
MIT-licensed Stripe OpenAPI contract. All of these records remain synthetic or
contract-derived; none is described as production traffic.

Public-derived records are restricted to train/validation. Upstream validation/test
splits are not used for training, and the separately sealed independent test is not
passed to the public-source adapters.

## Data quality

- All 19,052 release records passed deterministic Schema, label-consistency and
  evidence-location checks.
- 281 exact or normalized input/output duplicates were removed after stricter network
  redaction and public-source mapping.
- 5,096 credential or non-reserved network-indicator replacements were applied.
- The sealed independent test was built before development candidate generation.
- No group ID, normalized hash, or template fingerprint is shared across release
  splits.
- SimHash, MinHash and character n-gram checks were run. No neural embedding model
  was available, so absence of all semantic leakage is not claimed.

## Required before publishing a model

Training, inference, quantization, JSON success, Schema success under generation,
family macro-F1, malicious recall, normal FPR, hard-negative FPR, unknown accuracy,
prompt-injection obedience, latency and memory remain unmeasured for v0.2.
