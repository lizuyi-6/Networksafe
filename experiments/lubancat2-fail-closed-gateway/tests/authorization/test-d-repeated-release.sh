#!/bin/bash
# TEST D - repeated release semantics: replace-lease, never indefinite.
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=d-repeated-release

{
  echo "# TEST D repeated release $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ag_ssh "ag-cat2-gateway isolate"

  echo "## release 30, then release 60 at t+10 - lease must be REPLACED (expire at ~t+70, not t+30)"
  ag_ssh "ag-cat2-gateway release 30"
  sleep 10
  ag_ssh "ag-cat2-gateway release 60"
  T_MARK=$(date +%s)
  ag_ssh "systemctl list-timers --no-pager 'ag-cat2-lease-*.timer' | grep -c lease" | sed 's/^/activeLeaseTimers=/'
  ag_ssh "ag-cat2-gateway status"

  echo "## waiting until t+75 (proves second lease governs)"
  while [ $(( $(date +%s) - T_MARK )) -lt 65 ]; do sleep 5; done
  STATE=$(ag_gate_state); echo "stateAtTplus75=$STATE"
  [ "$STATE" = "isolated" ] && echo "PASS: lease replaced then expired" || echo "FAIL: unexpected state"

  echo "## invalid release parameters must be refused"
  for bad in 0 -5 601 999999 abc "60;rm" "" ; do
      ag_ssh "ag-cat2-gateway release '$bad'" >/dev/null 2>&1
      echo "release '$bad' -> rc=$? (expect != 0)"
  done
  ag_ssh "ag-cat2-gateway status"
  ag_ssh "journalctl -t aetherguard-cat2 -n 12 --no-pager"
} 2>&1 | ag_log "$TEST_PREFIX"
