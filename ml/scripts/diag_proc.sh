#!/usr/bin/env bash
set +e
PID=$(pgrep -f 'evaluate_model.py' | head -1)
echo "PID=$PID"
if [ -z "$PID" ]; then
  echo "NOT_RUNNING"
  exit 0
fi
echo "--- status ---"
grep -E 'State|VmRSS|VmSize' /proc/$PID/status 2>/dev/null
echo "--- cpu ticks (utime stime) ---"
awk '{print "utime="$14" stime="$15}' /proc/$PID/stat 2>/dev/null
echo "--- io (read_bytes) ---"
cat /proc/$PID/io 2>/dev/null
echo "--- gpu ---"
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>/dev/null
