# AetherArgus dataset v0.2 quality report

## Actual release counts

- `train`: 67
- `validation`: 4
- `test_closed`: 4
- `test_independent`: 25

## Attack-family distribution

- `api_abuse`: 4
- `authentication`: 5
- `automation`: 2
- `benign`: 24
- `business_logic`: 1
- `command_injection`: 2
- `deserialization`: 2
- `file_upload`: 4
- `other`: 18
- `path_traversal`: 4
- `protocol_attack`: 5
- `sqli`: 27
- `ssrf`: 1
- `xss`: 1

## Provenance and review

- Synthetic ratio: `100.00%`.
- Human-reviewed samples: `0`. No human review is claimed.
- Real normal test samples: `0`.
- Authorized real attack samples: `0`.
- Public open-source-derived training samples:
  `25`; restricted to train/validation.

## Dataset-only gates

- FAIL — `train_at_least_8000`
- FAIL — `validation_at_least_1000`
- FAIL — `independent_test_at_least_1500`
- FAIL — `core_independent_family_each_at_least_100`
- PASS — `all_records_deterministically_valid`
- FAIL — `family_minimums_met`

Dataset-only acceptance: `FAIL`.

## Preview 0.2 status

`NOT EVALUATED / NOT PASSED`. This task did not train or run any model. Recall, FPR,
JSON success, Schema success under inference, latency, quantization, and prompt-injection
obedience therefore remain unmeasured.
