# AetherArgus dataset v0.2 leakage report

Known leakage detected: `NO`.

| Pair | Shared groups | Shared normalized hashes | Shared templates | Detected |
| --- | ---: | ---: | ---: | --- |
| `train_vs_validation` | 0 | 0 | 0 | NO |
| `train_vs_test_closed` | 0 | 0 | 0 | NO |
| `train_vs_test_independent` | 0 | 0 | 0 | NO |
| `validation_vs_test_closed` | 0 | 0 | 0 | NO |
| `validation_vs_test_independent` | 0 | 0 | 0 | NO |
| `test_closed_vs_test_independent` | 0 | 0 | 0 | NO |

## Checks

- normalized SHA-256
- template fingerprint
- source-seed group
- CVE group
- generator model and prompt version group
- 64-bit SimHash retained per sample
- 24-permutation MinHash retained per sample
- character n-gram hashing vectors (non-neural fallback)

## Limitations

- No neural embedding model was available in this execution environment.
- SimHash/MinHash are lexical similarity controls and do not prove absence of all semantic leakage.
