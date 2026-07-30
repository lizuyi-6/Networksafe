#!/usr/bin/env bash
set -euo pipefail
cd /mnt/x/repos/Networksafe
PY=ml/.venv/bin/python
TEST=ml/data/releases/v02/test-independent.jsonl
GGUF=/mnt/d/aetherargus-v02-gguf
REPORTS=ml/reports

for q in q4_k_m q5_k_m q6_k q8_0 f16; do
  METRICS="$REPORTS/gguf-$q-independent-metrics.json"
  if [ -f "$METRICS" ]; then
    echo "=================== SKIP $q (metrics exist) ==================="
    continue
  fi
  echo "=================== EVAL $q ==================="
  PREDS="$GGUF/preds-indep-$q.jsonl"
  "$PY" ml/evaluation/evaluate_ollama.py \
    --model "aetherargus-v02-$q" \
    --test-file "$TEST" \
    --output "$PREDS" \
    --inference-mode "ollama_gguf_$q" 2>&1 | tail -3
  echo "--- score $q ---"
  "$PY" ml/evaluation/evaluate_model.py \
    --mode score \
    --run-name "gguf-$q-independent" \
    --test-file "$TEST" \
    --prediction-input "$PREDS" 2>&1 | tail -40
  echo "=================== DONE $q ==================="
done
echo "ALL_EVALS_COMPLETE"
