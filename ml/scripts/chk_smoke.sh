#!/usr/bin/env bash
ML=/mnt/x/repos/Networksafe/ml
L=$(ls -t "$ML"/logs/smoke-2026*.log 2>/dev/null | head -1)
echo "LATEST_TRAIN_LOG=$L"
grep -E 'startup_evidence|all records lost|trainableParameters|Traceback|Error|trainer_metrics|epoch' "$L" 2>/dev/null | head -8
echo "--- train log tail ---"
tail -n 4 "$L" 2>/dev/null | tr -d '\r'
echo "--- newest smoke-adaptation log tail ---"
SA=$(ls -t "$ML"/logs/smoke-adaptation-*.log 2>/dev/null | head -1)
echo "SA=$SA"
tail -n 8 "$SA" 2>/dev/null | tr -d '\r'
echo "--- orch steps ---"
grep -E 'STEP (START|END)|FAIL|smoke winning|COMPLETE' "$ML/logs/orchestrator.log" 2>/dev/null | tail -5
echo "--- gpu ---"
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null

