# Inference-Path Ablation v2

**Status: INCOMPLETE.** The required one-variable diagnostics have not all been run.

Missing prediction files:

- `ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-merged-bf16-single-concat.jsonl`
- `ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-ollama-f16-single-concat.jsonl`
- `ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-merged-bf16-hf-serialized.jsonl`
- `ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-ollama-f16-hf-serialized.jsonl`

Run the locked commands in `inference-path-ablation-plan.md`, then rerun `python ml/evaluation/lan_challenge/run_ablation.py`. No causal conclusion about the historical FPR difference is permitted while this report is incomplete.
