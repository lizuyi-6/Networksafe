#!/bin/bash
# perf-plan.sh - performance comparison harness.
# Requires THREE machines for the full matrix:
#   1) direct connection (no Cat2)               - needs the upstream test peer
#   2) Cat2 open bridge baseline                 - needs upstream peer
#   3) Cat2 fail-closed gate, state=released     - needs upstream peer
#   4) Cat2 isolated (control: expect ~0 throughput)
# With only two machines present, items 1-3 are marked NOT_RUN and this script
# prints the exact commands to run later. Item 4 can run any time.
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=g-performance
IPERF_PEER=${IPERF_PEER:-192.168.3.1}   # must run: iperf3 -s  (on upstream test machine)
RUNS=5

have_peer() { ping -c 1 -W 2 "$IPERF_PEER" >/dev/null 2>&1 && nc -z -w 2 "$IPERF_PEER" 5201 2>/dev/null; }

{
  echo "# PERFORMANCE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! have_peer; then
      echo "NOT_RUN: no iperf3 peer at $IPERF_PEER:5201 (third machine / router with iperf3 required)"
      echo "To run later:"
      echo "  1) upstream machine: iperf3 -s"
      echo "  2) direct baseline:  plug protected host DIRECTLY into upstream, then:"
      echo "     for i in 1..$RUNS: iperf3 -c $IPERF_PEER -t 10 -J > direct-\$i.json"
      echo "  3) via Cat2 open bridge (release 600): same command -> bridged-\$i.json"
      echo "  4) via Cat2 gate released:             same command -> gate-released-\$i.json"
      echo "  5) UDP: add -u -b 500M --get-server-output"
      echo "  6) latency: ping -c 100 -i 0.1 -> p50/p95/p99"
      exit 3
  fi

  for mode in gate-released isolated; do
      case $mode in
          gate-released) ag_ssh "ag-cat2-gateway release 600" ;;
          isolated)      ag_ssh "ag-cat2-gateway isolate" ;;
      esac
      for i in $(seq 1 $RUNS); do
          echo "## $mode run $i"
          iperf3 -c "$IPERF_PEER" -t 10 -J 2>/dev/null > "$AG_RUN_DIR/perf-$mode-$i.json" || echo '{"error":"iperf3 failed"}' > "$AG_RUN_DIR/perf-$mode-$i.json"
          ping -I eno1 -c 50 -i 0.1 -W 1 "$IPERF_PEER" 2>/dev/null | tail -2
          ag_ssh "cat /proc/loadavg; grep -E 'softirq|cpu' /proc/stat | head -2; ip -s link show dev \$( . /etc/aetherguard-cat2.conf; echo \$SERVER_IF ) | sed -n '4,7p'"
      done
  done
  ag_ssh "ag-cat2-gateway isolate"
} 2>&1 | ag_log "$TEST_PREFIX"
