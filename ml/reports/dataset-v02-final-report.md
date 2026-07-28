# AetherArgus Preview 0.2 data-only delivery report

1. **Actual data counts**: train `14314`, validation
   `1752`, closed test
   `1236`, independent test
   `1750`.
2. **Source distribution**:
- `deterministic_synthetic_v02`: 13354
- `public_open_source_derived`: 5309
- `tracked_synthetic_security_corpus_v02_conversion`: 389
   Source datasets:
- `advanced_dataset`: 104
- `aetherargus-v02-deterministic`: 13354
- `complete_dataset`: 46
- `full_test_dataset`: 119
- `owasp-crs-regression`: 1935
- `s-labs-prompt-injection-train`: 2200
- `stripe-openapi`: 1174
- `zeroday_dataset`: 120
3. **Attack-family counts**:
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
4. **Synthetic ratio**: `100.00%`.
5. **Human-reviewed count**: `0`; no human review is claimed.
6. **Rejected samples**: deterministic review `0`;
   public-source filter/cap decisions:
   - `owasp-crs-regression`: `{"body_too_long":2,"family_cap":1724,"not_positive_expect_ids":1006,"unsupported_method":3}`
   - `s-labs-prompt-injection-train`: `{"class_cap":6829,"content_boundary":5,"duplicate_text":40,"injection_marker_missing":2007,"too_short":8}`
   - `stripe-openapi`: `{}`
   Exact details are recorded in the public-source audit; caps are selection decisions,
   not label-review failures.
7. **Duplicates removed**: `281`.
8. **Leakage result**: known group/hash/template leakage detected =
   `False`. Neural embedding was not available; lexical
   SimHash/MinHash/n-gram controls were run and the limitation is explicit.
9. **Actual trained model**: `N/A` — model training was intentionally out of scope.
10. **Best training configuration**: `N/A`.
11. **HF LoRA metrics**: `N/A`.
12. **GGUF metrics**: `N/A`.
13. **Best deployment version**: `N/A`.
14. **Remaining weak categories**: real normal traffic, real authorized attack capture,
    and human-reviewed ambiguous cases.
15. **Unobtained real data**: all real-normal and authorized real-attack suites.
16. **Preview 0.2 acceptance**: `NOT PASSED / NOT EVALUATED`; inference quality,
    recall, FPR, prompt-injection obedience, JSON success and quantization were not run.

The dataset-only acceptance gate is
`PASS`.
