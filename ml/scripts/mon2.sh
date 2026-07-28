#!/usr/bin/env bash
sleep 28
ML=/mnt/x/repos/Networksafe/ml
echo "=== $(date -u +%H:%M:%S) orch steps ==="
grep -E 'STEP (START|END)|FAIL|COMPLETE|smoke winning' "$ML/logs/orchestrator.log" 2>/dev/null | tail -6
echo "=== train progress ==="
tail -c 180 "$ML/logs"/train-*.log 2>/dev/null | tr -d '\r' | tail -1 | grep -oE "[0-9]+/[0-9]+ \[.*it/s\]" | tail -1
echo "=== gpu ==="
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null
echo "=== key reports ==="
ls "$ML/reports/" 2>/dev/null | grep -E 'qlora-smoke|lora-metrics|combined-metrics|orchestrator-summary' | tr '\n' ' '; echo
