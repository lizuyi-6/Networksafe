# AetherArgus dataset v0.2 public-source audit

Public-derived candidates accepted after deterministic mapping: **100**.
Accepted after redaction, review, deduplication and cross-corpus checks:
**25**.

- Train: `24`.
- Validation: `1`.
- Public-derived test records: `0`.
- Cross-corpus duplicates removed: `0`.

## Accepted sources

| Source | Pinned revision | License | Allowed release splits |
| --- | --- | --- | --- |
| `owasp-crs-regression` | `76204946a679c0d5c634bd65e1d606f191ad756e` | `Apache-2.0` | train, validation |
| `s-labs-prompt-injection-train` | `002a9dd18514abd021869823d6b0429b38606d99` | `MIT` | train, validation |
| `stripe-openapi` | `6dfda253ec9229dd4d20e0cac3ec9b1ff31fac69` | `MIT` | train, validation |

## Adapter results

| Source | Selected | Rejected or capped |
| --- | ---: | --- |
| `owasp-crs-regression` | 205 | `{"body_too_long":2,"family_cap":3728,"not_positive_expect_ids":1006,"unsupported_method":3}` |
| `s-labs-prompt-injection-train` | 80 | `{"class_cap":8949,"content_boundary":5,"duplicate_text":40,"injection_marker_missing":2007,"too_short":8}` |
| `stripe-openapi` | 25 | `{}` |

## Excluded sources

| Source | Reason |
| --- | --- |
| `deepset-prompt-injections` | `license_metadata_conflict` |
| `csic-2010-http` | `upstream_dataset_has_no_stated_license` |
| `vnu-sqli-detection` | `mixed_and_partly_unclear_provenance` |
| `prodnull-prompt-injection-repo` | `gated_access_and_out_of_scope_attack_content` |

## Evidence boundary

- Only checksum-pinned artifacts from accepted sources are read.
- Public-derived records are restricted to `train` and `validation`.
- Upstream validation/test splits are not used as training input.
- OWASP CRS records are synthetic regression traffic, not production traffic.
- OpenAPI records are deterministic synthetic requests derived from a public contract.
- No human review by this project is claimed.
