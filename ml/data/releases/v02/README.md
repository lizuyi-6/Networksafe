# AetherArgus dataset v0.2 release

The JSONL files in this directory are reproducible generated artifacts and are not
stored in ordinary Git history. Build them from the repository root:

```bash
python ml/data_pipeline/fetch_public_sources.py --dry-run
python ml/data_pipeline/fetch_public_sources.py
python ml/data_pipeline/fetch_public_sources.py --resume
python ml/data_pipeline/build_release.py --smoke
python -m unittest discover -s ml/data_pipeline/tests -v
python ml/data_pipeline/build_release.py
python ml/data_pipeline/audit_dataset.py --dry-run
```

The tracked `manifest.json` and `independent-seal.json` record counts, hashes,
provenance, acceptance gates and the sealed-test commitment.

Validated data-only counts for seed `20260728`:

- Train: 14,314
- Validation: 1,752
- Synthetic closed test: 1,236
- Independent synthetic test: 1,750

No real traffic, human labels, model training, inference result, or quantization
result is included or claimed.
