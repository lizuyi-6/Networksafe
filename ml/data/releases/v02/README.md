# AetherArgus dataset v0.2 release

The JSONL files in this directory are reproducible generated artifacts and are not
stored in ordinary Git history. Build them from the repository root:

```bash
python ml/data_pipeline/build_release.py --smoke
python -m unittest discover -s ml/data_pipeline/tests -v
python ml/data_pipeline/build_release.py
```

The tracked `manifest.json` and `independent-seal.json` record counts, hashes,
provenance, acceptance gates and the sealed-test commitment.

Validated data-only counts for seed `20260728`:

- Train: 9,535
- Validation: 1,306
- Synthetic closed test: 1,153
- Independent synthetic test: 1,750

No real traffic, human labels, model training, inference result, or quantization
result is included or claimed.
