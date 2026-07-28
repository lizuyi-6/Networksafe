#!/usr/bin/env bash
set +e
METRICS="/mnt/x/repos/Networksafe/ml/reports/baseline-metrics.json"
LOG="/mnt/x/repos/Networksafe/ml/logs/baseline.log"
if [ -f "$METRICS" ]; then
  echo "BASELINE_DONE"
  python3 - "$METRICS" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
keys = ["sampleCount","jsonSyntaxSuccessRate","schemaValidRate","verdictAccuracy",
        "maliciousPrecision","maliciousRecall","maliciousF1","normalFalsePositiveRate",
        "attackFamilyMacroF1","recommendedActionAccuracy","unknownUsageRate",
        "averageLatencyMs","p95LatencyMs","peakGpuMemoryGiB"]
for k in keys:
    print(k, "=", m.get(k))
PY
else
  echo "STILL_RUNNING"
  tail -c 150 "$LOG" 2>/dev/null | tr -d '\r' | tail -1 | grep -oE '[0-9]+/120' | tail -1
fi
