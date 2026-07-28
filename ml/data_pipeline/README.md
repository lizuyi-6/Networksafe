# AetherArgus dataset v0.2 pipeline

This directory builds a data-only AetherArgus v0.2 release. It does not train,
merge, quantize, publish, or connect a model to `backend/src/`.

## Safety and evidence boundary

- Existing `backend/test-data/aetherguard-security-dataset/` data remains read-only
  and is described as synthetic.
- Deterministic candidates use only reserved test domains, localhost, private
  addresses, link-local metadata addresses, and RFC documentation ranges.
- No API keys, cookies, customer identifiers, malware, persistence code,
  credential-stealing code, public targets, or real exploitation chains are used.
- No human review, real traffic, model review, or model metric is claimed unless an
  actual artifact is supplied.
- The independent synthetic test is generated and sealed before development
  candidates are generated. Its records are never inputs to development generation.
- Public sources are checksum-pinned, license-reviewed, and restricted to
  `train`/`validation`. Their upstream validation/test splits are not used for
  training, and the public-source cache is ignored by Git.
- `detection-input.schema.json` and `detection-output.schema.json` are consumed as
  immutable contracts. This pipeline does not change them.

## Reproducible commands

From the repository root:

```bash
python ml/data_pipeline/build_release.py --help

# Review the fetch plan, then download the three approved pinned artifacts
python ml/data_pipeline/fetch_public_sources.py --dry-run
python ml/data_pipeline/fetch_public_sources.py

# Public-source-only 100-record adapter gate
python ml/data_pipeline/import_public_sources.py --smoke

# Plan only; writes nothing
python ml/data_pipeline/build_release.py --dry-run --smoke

# Required 100-record smoke gate
python ml/data_pipeline/build_release.py --smoke
python -m unittest discover -s ml/data_pipeline/tests -v

# Full data-only release
python ml/data_pipeline/build_release.py
```

Every entry-point accepts `--config`, `--seed`, `--resume`, `--dry-run`, and
`--help`. Stage scripts also accept explicit input/output paths. Outputs are
write-once: an existing file is never overwritten. `--resume` only reuses an
existing output when its bytes are identical to the reproducible result.

## Stages

1. `generate_candidates.py` creates the sealed independent pool first and the
   development pool second. Each generated sample records generator, prompt version,
   source seed, transformations, generation type, timestamp, and pending review state.
2. `import_external_candidates.py` imports already authorized JSONL without inventing
   provenance. Real data must be explicitly marked `authorized_sanitized_real`.
3. `fetch_public_sources.py` downloads only accepted registry entries and verifies
   byte length plus SHA-256. `import_public_sources.py` maps the pinned OWASP CRS,
   prompt-injection training split, and OpenAPI contract into synthetic HTTP records.
   Sources with unclear, conflicting, gated, or out-of-scope terms remain excluded.
4. `redact_sensitive_data.py` replaces credential-like values, public targets, and
   non-reserved domains in a copied output.
5. `validate_schema.py`, `validate_labels.py`, and `validate_evidence.py` enforce the
   fixed contract and deterministic consistency rules.
6. `review_candidates.py` writes immutable review decisions. It never silently edits
   labels. Reviewer disagreement or suggested relabeling is queued.
7. `deduplicate.py` removes exact and normalized duplicates.
8. `semantic_deduplicate.py` assigns conservative lexical clusters using SimHash,
   MinHash and character n-gram vectors. It does not claim a neural embedding run.
9. `assign_groups.py` binds template, CVE, generator, prompt and semantic provenance
   into leakage groups.
10. `split_dataset.py` performs group-aware development splitting and preserves the
   separately sealed independent test.
11. `audit_dataset.py` checks counts, schemas, provenance, suites and dataset-only
    gates.
12. `build_release.py` orchestrates all stages and writes manifests and reports.

## Generated data policy

The large JSONL candidates, review queues and release files are reproducible build
artifacts and are ignored by Git. The following small evidence files are tracked:

- `ml/data/releases/v02/manifest.json`
- `ml/data/releases/v02/independent-seal.json`
- `ml/data/manifests/dataset-v02-manifest.json`
- `ml/data/manifests/dataset-v02-source-registry.json`
- `ml/reports/dataset-v02-*.md`
- `ml/reports/dataset-v02-*.json`

The source registry itself is tracked at
`ml/data_pipeline/configs/public-sources-v01.yaml`; downloaded archives, CSV files,
OpenAPI documents, candidates, and full release JSONL remain ignored.

## Public-source boundary

- OWASP CRS: positive `expect_ids` request stages only; `no_expect_ids` is not
  treated as proof of a benign label.
- S-Labs prompt-injection dataset: only the upstream `train` split is eligible.
  A deterministic content-boundary filter rejects malware, credential-harvesting,
  persistence, exfiltration, and executable downloader patterns.
- Stripe OpenAPI: methods, paths, and parameter schemas seed realistic payment and
  account request shapes. Generated values use reserved domains and redacted
  credentials. These records are contract-derived synthetic traffic.
- CSIC 2010, VNU-SQLi, deepset prompt-injections, and the gated prodnull corpus are
  recorded as excluded with reasons in the source registry and audit report.

## Independent suites

The independent synthetic set includes:

- `authorized_attack_test` (synthetic, reserved targets only)
- `independent_synthetic_normal`
- `independent_hard_negative`
- `prompt_injection_test`
- `long_input_test`
- `independent_unknown`

`Real Normal Test` and real `Authorized Attack Test` remain empty until authorized,
sanitized artifacts are provided. The manifest reports both counts as zero.

## Optional independent model review

`review_candidates.py --review-decisions reviewer.jsonl` accepts only:

```json
{
  "sampleId": "v02-dev-...",
  "decision": {
    "accepted": false,
    "problems": ["标签与请求内容矛盾"],
    "suggestedLabel": null,
    "needsManualReview": true
  }
}
```

The reviewer output cannot replace sample content. Disagreement goes to
`ml/data/review_queue/v02/`.
