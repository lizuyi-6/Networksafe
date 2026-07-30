# AetherArgus frozen LAN challenge evidence report

## 1. Experiment identity

- Date: `2026-07-30T16:53:32.415555+00:00`
- Evaluation code commit: `f6758075316425e6e2a5b4cbd1d9bebdc5cafd53`
- Protocol commit: `79f146f2c8d400ef4afa292015b70a6bf91280ec`
- Canonical protocol SHA-256: `fc3f2af2bdfa911c99cf143ec248ae51654297d40b949fa95f8b8866bf897276`
- Input SHA-256: `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- Label SHA-256: `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`
- Status: **INCOMPLETE_REQUIRED_MODEL_RUNS**
- Partial-artifact integrity validation: **21/21 passed**
- Strict completion validation: **20/21 passed**; required-model coverage failed

The challenge set was not used for training, prompt selection, threshold
selection, hyperparameter tuning, or model selection.

The reference labels were produced by two independent AI annotators, a third
AI adjudicator, and a model-visible-context audit; they were not human-verified
ground truth.

## 2. Hardware and software

- OS: `Linux-6.12.13-x86_64-with-glibc2.39`
- CPU: `AMD EPYC 9V74 80-Core Processor`
- RAM: `15.93 GiB`
- GPU / CUDA: unavailable
- Python: `3.12.13`
- Node: `v24.14.0`
- scikit-learn / SciPy: `1.8.0 / 1.17.0`
- Transformers / Ollama: unavailable

## 3. Models and artifact inventory

- Successful: rules-baseline
- Not run: char-ngram-logreg, qwen3-4b-zero-shot, qwen3-4b-few-shot, aetherargus-v02-hf-lora, aetherargus-v02-merged-bf16, aetherargus-v02-gguf-q4-k-m, aetherargus-v02-ollama-f16

The v02 train/validation JSONL, LoRA adapter, merged BF16, f16 GGUF, and Q4_K_M
GGUF are documented by the repository but are not committed or mounted in this
environment. The authenticated Hugging Face Jobs connector returned
`Tool hf_jobs not found`; no paid job was launched.

## 4. Prompt and evaluation method

All generative runs are locked to prompt SHA-256 `9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8`, context
length 2048, at most 320 output tokens, and deterministic decoding. No
generative run completed. The rule baseline ran in an isolated directory
containing only the frozen model input and label-blind inference code. Scoring
opened `final-labels.jsonl` only after 413 predictions were flushed and closed.

## 5. Main result

| Model | Accuracy | Macro-F1 | Attack F1 | Attack recall | Safe FPR | Unknown accuracy | Schema valid |
|---|---:|---:|---:|---:|---:|---:|---:|
| rules-baseline | 0.5690 | 0.3589 | 0.3355 | 0.2680 | 0.0000 | 0.0000 | 1.0000 |

Accuracy 95% CI: `0.5496`-
`0.5908`. Macro-F1 95% CI:
`0.3246`-`0.3929`.

This result does **not** answer whether AetherArgus outperforms Qwen or the
baselines. McNemar, paired bootstrap differences, and Holm-adjusted model
comparisons are unavailable because AetherArgus predictions do not exist.

## 6. Class balance and confusion

The rule baseline predicts no `unknown` rows. Its confusion matrix is:

```text
reference\prediction  safe  attack  unknown
safe                    209       0        0
attack                   71      26        0
unknown                  75      32        0
```

It obtains safe recall 1.0000 but attack recall 0.2680
and unknown recall 0.0000. The observed safe FPR is 0/209; this is not evidence
of zero population FPR.

## 7. Consensus and adjudication subsets

Machine-readable subset results are in `tables/table-2-subset-results.csv`.
Only the rule baseline is present, so RQ4 is partial and descriptive.

## 8. Statistical analysis

Each completed metric uses 10,000 reference-verdict-stratified bootstrap draws,
seed 20260731. Attack-F1 CI is
`0.2394`-`0.4286`; attack
recall CI is `0.1856`-
`0.3608`. No paired test is reported.

## 9. Inference-path ablation

**NOT_RUN.** Shared-weight BF16/f16/GGUF artifacts and an Ollama runtime are
unavailable. Historical metrics on other test sets were not substituted, so no
cause is assigned to context truncation, system prompt, chat template,
serialization, runtime, sampling, or quantization.

## 10. Quality-latency-size trade-off

Only CPU rule latency is measured. GPU memory, token throughput, model size,
and cross-stack model latency are `null`; no fairness ranking is claimed.

## 11. Error analysis

The dominant rule-baseline errors are attack→safe and forced decisions on
reference-unknown rows. Full counts, representative sampleIds, and sanitized
request summaries are in `error-analysis.json` and `table-5-error-analysis.csv`.

## 12. Threats and limitations

1. Seven locked systems did not run; the primary research questions remain open.
2. The reference is AI-annotated and AI-adjudicated, not human-verified ground truth.
3. The set is an authorized challenge capture, not natural production traffic.
4. Zero observed safe FPR for one rule baseline is not a population guarantee.
5. Rule latency is not comparable to missing GPU/Ollama latency.
6. Cohort mappings were not guessed from sampleId ranges.

## 13. Reproduction

```bash
python3 ml/evaluation/lan_challenge/run_rules_baseline.py \
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \
  --output ml/reports/lan-challenge-evaluation/predictions/rules-baseline.jsonl
python3 ml/evaluation/lan_challenge/score_predictions.py \
  --model-id rules-baseline \
  --predictions ml/reports/lan-challenge-evaluation/predictions/rules-baseline.jsonl \
  --labels ml/data/lan_challenge_capture/adjudication/final-labels.jsonl \
  --output ml/reports/lan-challenge-evaluation/metrics/rules-baseline.json
python3 ml/evaluation/lan_challenge/statistical-analysis.py \
  --labels ml/data/lan_challenge_capture/adjudication/final-labels.jsonl \
  --predictions-dir ml/reports/lan-challenge-evaluation/predictions \
  --run-status ml/reports/lan-challenge-evaluation/metrics/run-status.json \
  --output ml/reports/lan-challenge-evaluation/metrics/statistical-analysis.json
python3 ml/evaluation/lan_challenge/generate_evidence.py
python3 ml/evaluation/lan_challenge/validate-paper-evidence.py
```

## 14. Failed or unrun items

See `metrics/run-status.json`. No result was copied from an older test set, no
prediction was duplicated from another model, and no missing run was replaced
with a heuristic.
