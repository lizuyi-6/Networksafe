#!/usr/bin/env bash
set +e
ML=/mnt/x/repos/Networksafe/ml
echo "=== orchestrator.log tail ==="
tail -n 25 "$ML/logs/orchestrator.log" 2>/dev/null
echo
echo "=== reports present ==="
ls -1 "$ML/reports/" 2>/dev/null | grep -E 'baseline-metrics|rules-metrics|qlora-smoke|lora-metrics|combined-metrics|orchestrator-summary' || echo "(none of the key reports yet)"
echo
echo "=== baseline progress ==="
tail -c 120 "$ML/logs/baseline.log" 2>/dev/null | tr -d '\r' | tail -1 | grep -oE '[0-9]+/120' | tail -1
echo "=== gpu ==="
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null
