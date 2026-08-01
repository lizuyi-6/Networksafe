#!/bin/bash
# TEST C - timed release: gate opens, then PID1 expiry closes it WITHOUT any
# further userspace command. Measures releaseLatencyMs and expiryToIsolationMs.
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=c-timed-release
DURATION=${1:-60}

{
  echo "# TEST C timed release (${DURATION}s) $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ag_ssh "ag-cat2-gateway isolate"

  T0=$(date +%s%3N)
  ag_ssh "ag-cat2-gateway release $DURATION"
  # release latency: time until first upstream ping succeeds
  REL_LATENCY=""
  for i in $(seq 1 20); do
      if ping -I eno1 -c 1 -W 1 "$AG_UPLINK_TARGET" >/dev/null 2>&1; then
          REL_LATENCY=$(( $(date +%s%3N) - T0 )); break
      fi
  done
  echo "releaseLatencyMs=${REL_LATENCY:-FAILED}"
  ag_ssh "ag-cat2-gateway status"

  echo "## waiting for PID1 expiry (no isolate command will be sent)..."
  LAST_OK=""
  while :; do
      if ping -I eno1 -c 1 -W 1 "$AG_UPLINK_TARGET" >/dev/null 2>&1; then
          LAST_OK=$(date +%s%3N)
      else
          STATE=$(ag_gate_state)
          [ "$STATE" = "isolated" ] && break
      fi
      sleep 2
      [ $(( $(date +%s) - T0/1000 )) -gt $((DURATION + 90)) ] && { echo "FAIL: gate did not close"; break; }
  done
  T_CLOSED=$(date +%s%3N)
  echo "lastSuccessfulPacketMs=$LAST_OK"
  echo "expiryToIsolationMs=$((T_CLOSED - LAST_OK)) (approx, includes probe interval)"
  ag_ssh "ag-cat2-gateway status"
  ag_ssh "ag-cat2-gateway verify"
} 2>&1 | ag_log "$TEST_PREFIX"
