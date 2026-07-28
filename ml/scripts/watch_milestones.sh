#!/usr/bin/env bash
# Append pipeline milestones to ml/logs/milestones.log as reports appear.
set +e
ML=/mnt/x/repos/Networksafe/ml
STA=$ML/logs/milestones.log
: > "$STA"   # reset
logm(){ echo "[$(date -u +%H:%M:%S)] $*" >> "$STA"; }
logm "watcher start"
declare -A SEEN
while true; do
  for f in baseline-metrics.json qlora-smoke-report.json lora-metrics.json combined-metrics.json orchestrator-summary.json; do
    p=$ML/reports/$f
    if [ -f "$p" ] && [ -z "${SEEN[$f]}" ]; then
      SEEN[$f]=1
      sz=$(stat -c %s "$p" 2>/dev/null)
      logm "MILESTONE report=$f bytes=$sz"
      # extra context per file
      case "$f" in
        baseline-metrics.json|lora-metrics.json)
          python3 - "$p" >> "$STA" 2>/dev/null <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print("  jsonSyntax=%.3f schemaValid=%.3f verdictAcc=%.3f malF1=%.3f macroF1=%.3f unknown=%.3f peakGiB=%s"%(
 m.get("jsonSyntaxSuccessRate"),m.get("schemaValidRate"),m.get("verdictAccuracy"),
 m.get("maliciousF1"),m.get("attackFamilyMacroF1"),m.get("unknownUsageRate"),m.get("peakGpuMemoryGiB")))
PY
          ;;
        qlora-smoke-report.json)
          python3 - "$p" >> "$STA" 2>/dev/null <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
a=r.get("successfulAttempt")
print("  smoke succeeded=%s winner=%s"%(r.get("succeeded"), a))
PY
          ;;
        orchestrator-summary.json)
          python3 - "$p" >> "$STA" 2>/dev/null <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
print("  status=%s steps=%s"%(s.get("status"),[(x.get('step'),x.get('status')) for x in s.get('steps',[])]))
PY
          break 2
          ;;
      esac
    fi
  done
  # periodic heartbeat with baseline/training progress
  b=$(tail -c 120 "$ML/logs/baseline.log" 2>/dev/null | tr -d '\r' | tail -1 | grep -oE '[0-9]+/120' | tail -1)
  t=$(tail -c 160 "$ML/logs"/train-*.log 2>/dev/null | tr -d '\r' | tail -1 | grep -oE '[0-9]+/[0-9]+ \[' | tail -1)
  gpu=$(nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null)
  logm "heartbeat baseline=$b train=$t gpu=$gpu"
  sleep 60
done
logm "watcher done"
