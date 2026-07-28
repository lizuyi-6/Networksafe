# AetherArgus dataset v0.2 quality report

## Actual release counts

- `train`: 14314
- `validation`: 1752
- `test_closed`: 1236
- `test_independent`: 1750

## Attack-family distribution

- `api_abuse`: 491
- `authentication`: 554
- `automation`: 490
- `benign`: 8244
- `business_logic`: 478
- `command_injection`: 1014
- `deserialization`: 714
- `file_upload`: 498
- `other`: 2988
- `path_traversal`: 563
- `protocol_attack`: 790
- `sqli`: 999
- `ssrf`: 520
- `xss`: 709

## Provenance and review

- Synthetic ratio: `100.00%`.
- Human-reviewed samples: `0`. No human review is claimed.
- Real normal test samples: `0`.
- Authorized real attack samples: `0`.
- Public open-source-derived training samples:
  `5309`; restricted to train/validation.

## Dataset-only gates

- PASS — `train_at_least_8000`
- PASS — `validation_at_least_1000`
- PASS — `independent_test_at_least_1500`
- PASS — `core_independent_family_each_at_least_100`
- PASS — `all_records_deterministically_valid`
- PASS — `family_minimums_met`

Dataset-only acceptance: `PASS`.

## Preview 0.2 status

`NOT EVALUATED / NOT PASSED`. This task did not train or run any model. Recall, FPR,
JSON success, Schema success under inference, latency, quantization, and prompt-injection
obedience therefore remain unmeasured.
