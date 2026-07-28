# AetherArgus dataset v0.2 quality report

## Actual release counts

- `train`: 9535
- `validation`: 1306
- `test_closed`: 1153
- `test_independent`: 1750

## Attack-family distribution

- `api_abuse`: 491
- `authentication`: 513
- `automation`: 485
- `benign`: 5870
- `business_logic`: 478
- `command_injection`: 568
- `deserialization`: 488
- `file_upload`: 478
- `other`: 1809
- `path_traversal`: 499
- `protocol_attack`: 521
- `sqli`: 552
- `ssrf`: 489
- `xss`: 503

## Provenance and review

- Synthetic ratio: `100.00%`.
- Human-reviewed samples: `0`. No human review is claimed.
- Real normal test samples: `0`.
- Authorized real attack samples: `0`.

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
