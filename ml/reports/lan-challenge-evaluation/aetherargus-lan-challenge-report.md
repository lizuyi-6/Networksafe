# AetherArgus frozen LAN challenge evidence report

## 1. Experiment identity

- Date: `2026-07-31T12:42:52.104104+00:00`
- Evaluation code commit: `9ebd1d2393efaf86b75adb3646c71e0727965768`
- Protocol commit: `553c0a9317e8c21f616991e92149fc828d7e8902`
- Canonical protocol SHA-256: `b5fe38cb554a8ee63adfbb767a2ff5a2a73b18ac096e2f8812183f7979b4fdeb`
- Input SHA-256: `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- Label SHA-256: `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`
- Status: **COMPLETE_FROZEN_CHALLENGE_EVIDENCE**
- Partial-artifact integrity validation: **0/27 passed**
- Strict completion validation: **25/27 passed**

The challenge set was not used for training, prompt selection, threshold
selection, hyperparameter tuning, or model selection.

The reference labels were produced by two independent AI annotators, a third
AI adjudicator, and a model-visible-context audit; they were not human-verified
ground truth.

## 2. Hardware and software

- OS: `Windows-11-10.0.26220-SP0`
- CPU: `Intel64 Family 6 Model 183 Stepping 1, GenuineIntel`
- RAM: `31.73 GiB`
- GPU / CUDA: `NVIDIA GeForce RTX 5070 Ti Laptop GPU` / `13.0`
- Python: `3.12.10`
- Node: `v24.13.1`
- scikit-learn / SciPy: `1.8.0 / 1.17.1`
- PyTorch / Transformers / PEFT: `2.12.0.dev20260223+cu130` / `5.2.0` / `0.20.0`
- Ollama: `ollama version is 0.32.5`

## 3. Models and artifact inventory

- Successful: rules-baseline, char-ngram-logreg, qwen3-4b-zero-shot, qwen3-4b-few-shot, aetherargus-v02-hf-lora, aetherargus-v02-merged-bf16, aetherargus-v02-gguf-q4-k-m, aetherargus-v02-ollama-f16
- Not run: none

All eight locked primary systems completed; all predeclared inference-path diagnostics also completed.

## 4. Prompt and evaluation method

All generative runs are locked to prompt SHA-256 `9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8`, context length 2048,
at most 320 output tokens, and deterministic decoding (temperature 0, greedy). Few-shot
examples (when used) are the frozen v2 manifest, sized to fit 2048. Each runner operates
label-blind in an isolated process; scoring opened `final-labels.jsonl` only after 413
predictions were flushed and closed. The rules-baseline runs the frozen repository detection
engine verbatim via an offline adapter (Option A provenance).

## 5. Main result

| Model | Accuracy | Macro-F1 | Attack F1 | Attack recall | Safe FPR | Unknown acc | Schema valid |
|---|---:|---:|---:|---:|---:|---:|---:|
| aetherargus-v02-hf-lora | 0.6150 | 0.4658 | 0.6692 | 0.9072 | 0.2057 (CP95≤0.2670) | 0.0000 | 1.0000 |
| qwen3-4b-few-shot | 0.5133 | 0.4114 | 0.4758 | 0.6082 | 0.2679 (CP95≤0.3334) | 0.0654 | 0.9976 |
| qwen3-4b-zero-shot | 0.5230 | 0.4175 | 0.4964 | 0.7113 | 0.3206 (CP95≤0.3885) | 0.0561 | 1.0000 |
| char-ngram-logreg | 0.2349 | 0.1273 | 0.3819 | 1.0000 | 1.0000 (CP95≤1.0000) | 0.0000 | 1.0000 |
| rules-baseline | 0.5206 | 0.2994 | 0.1606 | 0.1134 | 0.0144 (CP95≤0.0414) | 0.0187 | 1.0000 |
| aetherargus-v02-merged-bf16 | 0.6150 | 0.4661 | 0.6718 | 0.9072 | 0.2057 (CP95≤0.2670) | 0.0000 | 1.0000 |
| aetherargus-v02-gguf-q4-k-m | 0.6005 | 0.4559 | 0.6519 | 0.9072 | 0.2249 (CP95≤0.2876) | 0.0000 | 0.9952 |
| aetherargus-v02-ollama-f16 | 0.6150 | 0.4661 | 0.6718 | 0.9072 | 0.2057 (CP95≤0.2670) | 0.0000 | 1.0000 |


Primary model: `aetherargus-v02-hf-lora`. Safe FPR is shown with the Clopper-Pearson 95% upper bound
(where the rate is a zero-event proportion, e.g. 0/209, the exact interval replaces the
degenerate bootstrap `[0,0]`). Accuracy/Macro-F1 95% CIs are 10,000-draw
reference-verdict-stratified bootstrap (seed 20260731); see `metrics/statistical-analysis.json`.

### Significance (paired, Holm-Bonferroni corrected)

- McNemar aetherargus-v02-hf-lora vs rules-baseline: p_raw=0.0006118, p_Holm=0.002447, method=continuity_corrected_chi_square
- McNemar aetherargus-v02-hf-lora vs char-ngram-logreg: p_raw=4.267e-32, p_Holm=2.987e-31, method=continuity_corrected_chi_square
- McNemar aetherargus-v02-hf-lora vs qwen3-4b-zero-shot: p_raw=1.672e-07, p_Holm=8.358e-07, method=continuity_corrected_chi_square
- McNemar aetherargus-v02-hf-lora vs qwen3-4b-few-shot: p_raw=1.203e-07, p_Holm=7.217e-07, method=continuity_corrected_chi_square
- McNemar aetherargus-v02-hf-lora vs aetherargus-v02-merged-bf16: p_raw=1, p_Holm=1, method=exact_binomial
- McNemar aetherargus-v02-hf-lora vs aetherargus-v02-gguf-q4-k-m: p_raw=0.1796, p_Holm=0.5387, method=exact_binomial
- McNemar aetherargus-v02-hf-lora vs aetherargus-v02-ollama-f16: p_raw=1, p_Holm=1, method=exact_binomial
- Paired bootstrap aetherargus-v02-hf-lora minus qwen3-4b-zero-shot: macroF1 Δ=+0.0482 [+0.0113,+0.0835]
- Paired bootstrap aetherargus-v02-hf-lora minus qwen3-4b-few-shot: macroF1 Δ=+0.0544 [+0.0157,+0.0912]
- Paired bootstrap aetherargus-v02-hf-lora minus rules-baseline: macroF1 Δ=+0.1663 [+0.1262,+0.2065]
- Paired bootstrap aetherargus-v02-hf-lora minus char-ngram-logreg: macroF1 Δ=+0.3385 [+0.3141,+0.3622]
- Paired bootstrap aetherargus-v02-merged-bf16 minus aetherargus-v02-gguf-q4-k-m: macroF1 Δ=+0.0102 [-0.0043,+0.0249]
- Paired bootstrap aetherargus-v02-merged-bf16 minus aetherargus-v02-ollama-f16: macroF1 Δ=+0.0000 [+0.0000,+0.0000]

### Inference-path ablation

With byte-identical serialized prompts, Transformers merged-BF16 vs Ollama f16 verdict agreement was 413/413 (100.0%). Runtime remains coupled to the BF16-to-f16 artifact representation; see `inference-path-ablation-v2.json`.

## 6. Class balance and confusion (primary model `aetherargus-v02-hf-lora`)

```text
reference\\prediction     safe   attack  unknown
safe                       166       43        0
attack                       9       88        0
unknown                     72       35        0

```

Primary safe recall 0.7943, attack recall
0.9072, unknown recall 0.0000.
Observed safe FPR is 43/209; the exact
Clopper-Pearson 95% upper bound (not a zero-population guarantee) is in `proportions.safeFPR`.

## 7. Consensus and adjudication subsets

Machine-readable subset results (all locked label-derived subsets, all completed models)
are in `tables/table-2-subset-results.csv`.

## 8. Statistical analysis

Each completed metric uses 10,000 reference-verdict-stratified bootstrap draws (seed
20260731). For the primary model, accuracy 95% CI is
`0.5835`-`0.6441`,
macro-F1 95% CI `0.4415`-`0.4894`.
Paired McNemar + paired bootstrap differences (Holm-Bonferroni corrected) are in section 5
and `metrics/statistical-analysis.json`. Proportion metrics additionally report
Clopper-Pearson exact and Wilson score intervals (`proportionIntervals`).

## 9. Inference-path ablation

With byte-identical serialized prompts, Transformers merged-BF16 vs Ollama f16 verdict agreement was 413/413 (100.0%). Runtime remains coupled to the BF16-to-f16 artifact representation; see `inference-path-ablation-v2.json`.

## 10. Quality-latency-size trade-off

Latency (p50/p95/p99/mean) and model size are in `tables/table-4-latency-memory-size.csv` and each
model's `metrics/*.json` performance block. Cross-stack latency (Transformers GPU generate
vs Ollama HTTP round-trip) is flagged `crossStackLatencyComparable=false` and is NOT ranked
as equivalent across runtimes. The rules baseline p50
(`9.99999e-05` ms) measures only an
in-process adapter call; the Qwen few-shot p95
(`259882.680` ms) is retained as an
observed outlier that requires investigation. Model size is included only when its
performance block contains filesystem-stat and artifact-SHA provenance.

## 11. Error analysis

Full error-taxonomy counts, representative sampleIds, and sanitized request summaries are in
`error-analysis.json` and `tables/table-5-error-analysis.csv`.

## 12. Threats and limitations

1. The reference is AI-annotated and AI-adjudicated, not human-verified ground truth.
2. The set is an authorized challenge capture, not natural production traffic.
3. An observed low/zero safe FPR is a finite-sample result (Clopper-Pearson upper bound quantifies the residual), not a population guarantee.
4. Cross-stack latency (Transformers GPU vs Ollama HTTP) is NOT comparable; no fairness ranking is claimed across runtimes.
5. The rules baseline p50 (9.99999e-05 ms) is an in-process adapter timing, while Qwen few-shot p95 (259882.680 ms) is an observed outlier; both require their stated timing boundaries and are not a fair speed ranking.
6. Family Macro-F1 uses reference-attack-family labels only; families absent from the reference are not in the denominator.
7. Cohort mappings were not guessed from sampleId ranges.
8. 0 locked system(s) did not complete: none.

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
