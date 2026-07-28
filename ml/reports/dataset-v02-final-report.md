# AetherArgus Preview 0.2 data-only delivery report

1. **Actual data counts**: train `9535`, validation
   `1306`, closed test
   `1153`, independent test
   `1750`.
2. **Source distribution**:
- `deterministic_synthetic_v02`: 13354
- `tracked_synthetic_security_corpus_v02_conversion`: 390
3. **Attack-family counts**:
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
4. **Synthetic ratio**: `100.00%`.
5. **Human-reviewed count**: `0`; no human review is claimed.
6. **Rejected samples**: deterministic review `0`;
   reasons are recorded in the generated review queue.
7. **Duplicates removed**: `6`.
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
