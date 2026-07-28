#!/usr/bin/env bash
# Wait for the baseline evaluation to produce baseline-metrics.json, then report.
set +e
METRICS="/mnt/x/repos/Networksafe/ml/reports/baseline-metrics.json"
LOG="/mnt/x/repos/Networksafe/ml/logs/baseline.log"
MAX_WAIT=2400  # 40 minutes
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  if [ -f "$METRICS" ]; then
    echo "=== BASELINE COMPLETE after ${ELAPSED}s ==="
    echo "--- last inference line ---"
    tail -c 200 "$LOG" 2>/dev/null | tr -d '\r' | tail -1
    echo "--- metrics (key fields) ---"
    python3 -c "
import json,sys
m=json.load(open('$METRICS'))
for k in ['sampleCount','jsonSyntaxSuccessRate','schemaValidRate','verdictAccuracy','maliciousPrecision','maliciousRecall','maliciousF1','normalFalsePositiveRate','attackFamilyMacroF1','recommendedActionAccuracy','unknownUsageRate','averageLatencyMs','p95LatencyMs','peakGpuMemoryGiB']:
    print(f'{k}={m.get(k)}')
" 2>/dev/null || cat "$METRICS"
    exit 0
  fi
  sleep 30
  ELAPSED=$((ELAPSED+30))
  # progress heartbeat
  LAST=$(tail -c 120 "$LOG" 2>/dev/null | tr -d '\r' | tail -1 | grep -oE '[0-9]+/120' | tail -1)
  echo "wait ${ELAPSED}s ... inference at ${LAST:-?}"
done
echo "=== TIMEOUT after ${MAX_WAIT}s, metrics not produced ==="
tail -c 300 "$LOG" 2>/dev/null | tr -d '\r' | tail -3
exit 1
