#!/bin/bash
# TEST A - open-bridge baseline connectivity through the Cat2.
# Run from the PROTECTED HOST while the gate is manually held open
# (ag-cat2-gateway release 600, cancelled at the end by isolate).
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=a-baseline

{
  echo "# TEST A baseline $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ag_ssh "ag-cat2-gateway release 600" || { echo "FATAL: cannot open gate"; exit 1; }

  echo "## DHCP on wired interface"
  sudo -n nmcli device reapply eno1 2>/dev/null || sudo -n dhclient -v eno1 2>&1 | tail -5
  ip -4 addr show dev eno1 | grep inet || echo "FAIL: no IPv4 on eno1"

  echo "## ARP upstream"
  arping -I eno1 -c 3 -w 5 "$AG_UPLINK_TARGET" 2>&1 | tail -3

  echo "## ICMP upstream"
  ping -I eno1 -c 5 -W 2 "$AG_UPLINK_TARGET" | tail -3

  echo "## TCP connect upstream:53"
  timeout 5 bash -c "echo > /dev/tcp/$AG_UPLINK_TARGET/53" && echo TCP-OK || echo TCP-FAIL

  echo "## UDP probe upstream:53 (dig)"
  dig +time=3 +tries=1 @"$AG_UPLINK_TARGET" example.com A +short 2>&1 | head -3 || true

  echo "## DNS via system resolver"
  getent hosts example.com 2>&1 | head -2 || true

  echo "## IPv6 (if upstream offers it)"
  ip -6 addr show dev eno1 | grep -v fe80 | grep inet6 || echo "no global IPv6 (may be expected)"
  ping -6 -c 2 -W 2 "$AG_UPLINK_TARGET" 2>&1 | tail -2 || true

  echo "## latency stats"
  ping -I eno1 -c 20 -i 0.2 -W 2 "$AG_UPLINK_TARGET" | tail -2

  ag_ssh "ag-cat2-gateway isolate"
} 2>&1 | ag_log "$TEST_PREFIX"
