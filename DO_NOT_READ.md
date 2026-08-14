# AetherArgus Do-Not-Read Registry (v2)

> **Purpose:** Every AetherArgus v0.3 generator / blind-reviewer / adjudicator subagent prompt MUST embed the
> "PASTE INTO AGENT PROMPTS" block below verbatim. These paths contain SEALED independent-test sample
> content, sealed-sample-derived content, or legacy-corpus payloads that could bias generation. Reading
> them risks training-data contamination and is forbidden by mission §58 (no sealed test content as
> generation seed / few-shot / review example).
>
> **Source:** repo-auditor contamination-boundary verification (2026-08-07). v2 - supersedes v1 at
> `ml/data_pipeline/v03/DO_NOT_READ.md` (v1 missed `ml/evaluation/lan_challenge/**`, the v0.2 sealed
> test splits on disk, `aetherargus-lan-challenge-report.json`, and the `raw-private/` credentials callout).
>
> **CI guard limitation:** `scripts/guards/check-training-leak-challenge-capture.mjs` enforces
> committed-artifact leakage checks but does NOT block agent runtime file reads - hence this registry
> as the process control. The CI guard is necessary but not sufficient.
>
> **Default posture:** If a file's sealed status is unclear, DO NOT READ IT - flag and ask. Conservative
> default is do-not-read.

---

## SEALED - must NOT read sample contents

### S1. External challenge test set (tracked sanitized + gitignored credentials)

- `ml/data/lan_challenge_capture/**` - external independent challenge test set.
  - 413 samples, `eligibleForTraining=false`, `split=external_challenge_test`, own schema (families
    `auth_bypass`/`idor`/`csrf`/`cors_misconfig` NOT in v0.2 taxonomy). CI-enforced by
    `scripts/guards/check-training-leak-challenge-capture.mjs`.
  - Sealed sanitized sample JSONL: `all-sanitized.jsonl`, `attack-traffic.jsonl`, `hard-negatives.jsonl`,
    `model-benchmark.jsonl`, `model-inputs.jsonl`, `model-labels.jsonl`, `normal-traffic.jsonl`,
    `prompt-injection.jsonl`, `unknown-cases.jsonl`, `review-queue.jsonl`.
  - Per-sample adjudication/annotations: `adjudication/*.jsonl`,
    `adjudication/decisions/batch-01..08.jsonl`, `adjudication/consensus.jsonl`,
    `adjudication/final-labels.jsonl`, `adjudication/disagreement-queue.jsonl`,
    `annotations/model-a-annotations.jsonl`, `annotations/model-b-annotations.jsonl`.
  - **CREDENTIALS (gitignored, never read or commit)**: `raw-private/.id-salt`,
    `raw-private/.test-creds.env`, `raw-private/cookies.jar`. The `lan_challenge_capture/**` wildcard
    covers this, but it is called out explicitly here due to severity (credential exposure, not just
    test contamination).

### S2. v0.2 sealed independent test splits (gitignored, ON DISK)

- `ml/data/releases/v02/test-closed.jsonl` (4.9MB, 1,236 sealed samples)
- `ml/data/releases/v02/test-independent.jsonl` (7.5MB, 1,750 sealed samples)
- `ml/data/releases/v02-smoke/test-closed.jsonl` (13.5KB, smoke variant)
- `ml/data/releases/v02-smoke/test-independent.jsonl` (88KB, smoke variant)
- **Pattern for future v0.3 sealed set**: `ml/data/releases/*/test-closed.jsonl` +
  `ml/data/releases/*/test-independent.jsonl`.
- Note: `ml/data/releases/*/independent-seal.json` (~400 bytes) is seal METADATA
  (recordsSha256/sourceSampleIdsSha256/templateFingerprintsSha256), NOT sample content - safe to read
  for seal verification. `train.jsonl`/`validation.jsonl` in the same dirs are NOT sealed (training data).

### S3. Evaluation harness for sealed challenge set (HIGHEST RISK - git-tracked, 33 files)

- `ml/evaluation/lan_challenge/**` - 33 git-tracked files (`git ls-files` confirmed), evaluation harness
  for the sealed challenge set. 31 files matched sealed-sample indicators (sampleId, attack payloads,
  prompt-injection phrases). **This is the most serious contamination risk** - tracked, committed, and
  the filenames are natural targets for a generator seeking "format examples."
- **HIGHEST RISK - direct contamination vector**:
  - `ml/evaluation/lan_challenge/few-shot-examples-v2.json` (10KB, git-tracked via
    `git ls-files --error-unmatch`) - few-shot = likely sealed sample INPUTS. A generator reading this
    for "format" would ingest sealed test content directly.
  - `ml/evaluation/lan_challenge/few-shot-examples.json` (461B, git-tracked).
- Other sealed-derived files in this subtree:
  - `system-prompt.txt` (1185B)
  - `generate_evidence.py` (66KB), `scoring.py`, `select_few_shot_examples.py`
  - `run_ablation.py`, `run_char_ngram.py`, `run_ollama.py`, `run_research_augmented_rules.py`,
    `run_rules_baseline.py`, `run_transformers.py` (6 runners)
  - `validate-paper-evidence.py` (29KB), `finalize_evidence.py`
  - `evaluation-protocol{,-v2}.{json,md}`, `inference-path-ablation{,-plan,-amendments}.{json,md}`,
    `rules-baseline-manifest.{json,md}`, `few-shot-selection-report.json`
  - `inference_common.py`, `prepare_ablation_prompts.py`, `protocol-amendments.md`,
    `generate_rules_manifest.ts`, `rules_engine_adapter.ts`, `score_predictions.py`,
    `statistical-analysis.py`
- **NEEDS SEALED-TEST-AUTHORITY VERIFICATION (flagged)**: `few-shot-examples-v2.json` and
  `few-shot-examples.json` MIGHT be synthetic (not sealed). Repo-auditor did NOT read content
  (sealed-test rule); classification is by filename/location + indicator grep. **Safe default =
  do-not-read until verified.** If a sealed-test authority verifies they are synthetic, they may be
  moved to the SAFE list. Until then, treat as sealed.
- `ml/evaluation/` top-level (5 git-tracked files, outside `lan_challenge/`): `evaluate_model.py` (27KB),
  `compare_results.py`, `evaluate_ollama.py`, `evaluate_rules.ts`, `test_evaluator_guards.py` - matched
  sealed indicators; likely general evaluators but in a sealed-derived context. Lower risk; treat as
  do-not-read-by-default.

### S4. Sealed-sample-derived tracked reports

- `ml/reports/lan-challenge-evaluation/aetherargus-lan-challenge-report.json` (5600+ lines; verified
  contains `sampleId` + `verdict`/`attackFamily`/`recommendedAction` - per-sample prediction data).
- `ml/reports/lan-challenge-evaluation/error-analysis.json` (sealed-sample request PATHS, not just
  sampleIds; e.g. `:86` `/api/alerts?search=169.254.169.254`, `:137`
  `/api/devices?search='%20OR%20'1'%3D'1`, `:447` `/api/agents?search=Ignore%20all%20previous...`).
- `ml/reports/lan-challenge-evaluation/predictions/**/*.jsonl` (per-sample model predictions on sealed
  samples; 11 prediction files + 4 ablation predictions).
- `ml/reports/lan-challenge-evaluation/metrics/**/*.json` (per-sample scoring detail, contains
  verdict/attackFamily; 9 metric files).
- `ml/reports/lan-challenge-evaluation/tables/**` (per-sample detail CSV/TEX).
- `ml/reports/lan-challenge-evaluation/figures/**` (visual, sealed-derived; PDF/PNG/SVG).
- `ml/reports/lan-challenge-evaluation/paper/**/*.tex` (paper drafts quoting samples).

### S5. Unverified-but-likely-aggregate lan-challenge-evaluation files (conservative default: do-not-read)

The following files in `ml/reports/lan-challenge-evaluation/` showed NO per-sample sealed indicators
(no `sampleId`, no `verdict`/`attackFamily`/`recommendedAction`) in a targeted grep, and are likely
aggregate/structural/metadata. Repo-auditor did NOT do line-by-line verification. **Conservative default
= do-not-read** (they are in a sealed-derived directory). A sealed-test authority may reclassify as SAFE
after verification:
- `artifact-inventory.json`
- `claim-to-evidence-matrix.csv`, `claim-to-evidence-matrix.md`
- `evaluation-manifest.json`
- `inference-path-ablation-v2.json`, `inference-path-ablation-v2.md`
- `pull-request-provenance.json`

### S6. NOT sealed but generator-biasing

- `ml/reports/repository-inspection.md` - embeds legacy training-corpus payloads (e.g. `:63`
  `' UNION SELECT table_name FROM information_schema.tables--`, `:79` references 770 redacted
  password/token/email/Bearer replacements). Could bias an LLM generator if read as a pattern source.
  The spec, not the legacy corpus, drives realization.

---

## SAFE - aggregate-only, MAY be read for curriculum / gap analysis

- `ml/reports/lan-challenge-evaluation/aetherargus-lan-challenge-report.md` (verified: no sealed-sample
  indicators; aggregate prose).
- `ml/reports/lan-challenge-evaluation/error-analysis.md` (verified: sampleIds only; header disclaims
  body/header-values/cookies).
- `ml/reports/dataset-v02-quality-report.md` + `dataset-v02-quality-report.json` (v0.2 distribution
  stats; all gates PASSED; total 19,052 = train 14,314 / val 1,752 / test_closed 1,236 /
  test_independent 1,750).
- `ml/reports/dataset-v02-gap-analysis.md` + `dataset-v02-gap-analysis.json`.
- `ml/reports/dataset-v02-leakage-report.md` + `.json` (+ smoke variants) - aggregate leakage stats
  across splits (groupId/normalizedHash/templateFingerprint), not sample content.
- `ml/configs/aetherargus-v02-acceptance-gates.json` (8 locked model-eval thresholds).
- `ml/data/manifests/**` (aggregate manifest metadata: `dataset-manifest.json`,
  `dataset-v02-manifest.json`, `dataset-v02-source-registry.json` - not samples).
- `ml/schemas/detection-input.schema.json` + `ml/schemas/detection-output.schema.json` (the immutable
  input/output contracts).
- `ml/data_pipeline/*.py` + `ml/data_pipeline/configs/dataset-v02.yaml` (v0.2 generator/dedup source
  code - the SPEC, not sealed samples).
- `ml/data/lan_challenge_capture/schema/*.schema.json` (the challenge set's own schemas - safe for
  schema understanding, not sample content).
- `ml/data/lan_challenge_capture/dataset-manifest.json` + `README.md` (aggregate manifest: 413 samples,
  eligibleForTraining=false).
- v0.2 aggregate evaluation/training/model-card/final/release-checklist/quantization reports under
  `ml/reports/` (e.g. `aetherargus-v02-{evaluation,final,training,release-checklist,quantization}-*`,
  `dataset-v02-final-report.*`, `*-token-length-analysis.*`, `model-download-report.md`,
  `environment-report.*`, `baseline-report.md`, `integration-plan.md`, etc.). These are aggregate
  performance/stats reports, not sample content.
- `*-independent-*` / `*-closed-*` metrics/reports under `ml/reports/` (e.g.
  `lora-v02-independent-metrics.json`, `merged-v02-closed-report.md`, `gguf-*-independent-*`) -
  aggregate performance metrics ON the sealed test splits (accuracy/F1), not sample content. Reading
  them tells you model performance, not sealed sample inputs.

---

## PASTE INTO AGENT PROMPTS

```
DO NOT READ the following paths (sealed independent-test content, sealed-sample-derived content, or
legacy-corpus payloads; reading them is training-data contamination, forbidden by mission §58):

SEALED TEST SAMPLES:
- ml/data/lan_challenge_capture/** (sealed external challenge test set; especially *.jsonl;
  raw-private/ = CREDENTIALS: .id-salt, .test-creds.env, cookies.jar)
- ml/data/releases/*/test-closed.jsonl + test-independent.jsonl (v0.2 sealed test splits; gitignored
  but on disk; pattern covers future v0.3 sealed set)

SEALED-DERIVED EVALUATION + REPORTS (git-tracked):
- ml/evaluation/lan_challenge/** (HIGHEST RISK - 33 git-tracked files; especially
  few-shot-examples*.json = likely sealed sample inputs = DIRECT contamination vector)
- ml/evaluation/{evaluate_model.py, compare_results.py, evaluate_ollama.py, evaluate_rules.ts,
  test_evaluator_guards.py} (top-level eval scripts, sealed-derived context)
- ml/reports/lan-challenge-evaluation/aetherargus-lan-challenge-report.json (per-sample predictions)
- ml/reports/lan-challenge-evaluation/error-analysis.json (sealed request paths)
- ml/reports/lan-challenge-evaluation/{predictions,metrics,tables,figures,paper}/**

GENERATOR-BIASING (not sealed, but could bias generation):
- ml/reports/repository-inspection.md (legacy training-corpus payloads)

CONSERVATIVE DEFAULT (sealed-derived dir, unverified - do-not-read until cleared):
- ml/reports/lan-challenge-evaluation/{artifact-inventory.json, claim-to-evidence-matrix.*,
  evaluation-manifest.json, inference-path-ablation-v2.*, pull-request-provenance.json}

You MAY read aggregate-only reports for distribution/gap statistics:
- ml/reports/lan-challenge-evaluation/{aetherargus-lan-challenge-report.md, error-analysis.md}
- ml/reports/dataset-v02-{quality-report,gap-analysis,leakage-report}.{md,json}
- ml/configs/aetherargus-v02-acceptance-gates.json
- ml/data/manifests/**, ml/schemas/*.schema.json
- ml/data_pipeline/*.py + configs/dataset-v02.yaml (v0.2 spec source, NOT sealed)
- ml/data/lan_challenge_capture/{dataset-manifest.json, README.md, schema/*.schema.json}
- v0.2 aggregate reports under ml/reports/ (evaluation/training/model-card/final/release-checklist/
  quantization/token-length/leakage/baseline) - aggregate stats, not sample content
- *-independent-* / *-closed-* metrics/reports under ml/reports/ - aggregate performance on sealed
  test splits (accuracy/F1), not sample inputs

If a file's status is unclear, DO NOT READ IT - flag and ask. The CI guard
(check-training-leak-challenge-capture.mjs) catches committed-artifact leakage but does NOT block
runtime file reads; this registry is the process control.
```

---

## Verification provenance

- Compiled by repo-auditor on 2026-08-07 via read-only sweep: Grep `files_with_matches` + `content`
  for indicator lines, PowerShell directory listings, `git ls-files` for tracked status,
  `git ls-files --error-unmatch` for specific files.
- Sealed-sample CONTENT was NOT read (mission constraint). Classification is by path, filename,
  indicator-grep match, and git-tracked status.
- `few-shot-examples-v2.json` tracked-status confirmed via `git ls-files --error-unmatch` (exit 0).
- v0.2 sealed split on-disk presence confirmed via PowerShell listing of `ml/data/releases/v02/` and
  `ml/data/releases/v02-smoke/`.
- `ml/evaluation/lan_challenge/**` file count = 33 git-tracked files (`git ls-files` confirmed).
- Indicator grep pattern (case-insensitive):
  `union select|information_schema|<script|onerror=|javascript:|cookie:|authorization:|bearer |
  169\.254|/api/(alerts|logs|devices|agents|admin)/|drop table|ignore (all|previous) instructions|
  reveal your system prompt|disregard the above|change the verdict|or '1'='1|sampleId`.
- SAFE-list files verified to exist via `Get-ChildItem` of `ml/reports/` and `ml/configs/` on
  2026-08-07.

## Supersedes

- `ml/data_pipeline/v03/DO_NOT_READ.md` (v1). v1 missed: `ml/evaluation/lan_challenge/**` (S3 - the
  highest-risk finding), `ml/data/releases/*/test-{closed,independent}.jsonl` (S2),
  `ml/reports/lan-challenge-evaluation/aetherargus-lan-challenge-report.json` (S4), and the
  `raw-private/` credentials callout (S1). Team-lead should update or remove the v1 file at
  `ml/data_pipeline/v03/DO_NOT_READ.md` to avoid divergence; the canonical registry is now this file
  at the repo root.
