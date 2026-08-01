#!/bin/bash
# TEST B - isolation: NOTHING may traverse the Cat2 while state=isolated.
# Counts every escaped frame/byte on the Cat2 side (port counters) and every
# successful unauthorized connection on the host side.
set -u
. "$(dirname "$0")/../../lib/test-lib.sh"
TEST_PREFIX=b-isolation

{
  echo "# TEST B isolation $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  T0=$(date +%s%3N)
  ag_ssh "ag-cat2-gateway isolate"
  T1=$(date +%s%3N)
  echo "isolationActivationMs=$((T1-T0))"
  ag_ssh "ag-cat2-gateway status"

  echo "## Cat2 port counters BEFORE probes"
  ag_ssh "ip -s link show dev \$( . /etc/aetherguard-cat2.conf; echo \$SERVER_IF )" | tee /tmp/ag-cnt-before.txt

  UNAUTH=0
  probe() {  # probe <name> <command...>
      echo "## probe: $1"
      shift
      if timeout 6 "$@" >/dev/null 2>&1; then echo "ESCAPED: $1 succeeded"; UNAUTH=$((UNAUTH+1)); else echo "blocked: $1"; fi
  }

  probe "arp"        arping -I eno1 -c 3 -w 5 -f "$AG_UPLINK_TARGET"
  probe "icmp4"      ping -I eno1 -c 3 -W 2 "$AG_UPLINK_TARGET"
  probe "tcp53"      bash -c "echo > /dev/tcp/$AG_UPLINK_TARGET/53"
  probe "udp53"      dig +time=2 +tries=1 @"$AG_UPLINK_TARGET" example.com A
  probe "icmp6-ll"   ping -6 -c 2 -W 2 "fe80::1%eno1"
  probe "ndp"        ip -6 neigh show dev eno1
  probe "broadcast"  ping -c 2 -W 2 -b 255.255.255.255
  probe "multicast"  ping -c 2 -W 2 224.0.0.1

  echo "## raw ethernet injection attempt (requires root)"
  sudo -n python3 - <<'PY' || echo "raw socket probe skipped/failed (fine)"
import socket
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x88B5))
s.bind(("eno1", 0))
s.send(b"\xff"*6 + b"\x00\x68\xeb\x77\xc7\x4d" + b"\x88\xb5" + b"AETHERGUARD-PROBE" * 3)
print("raw frame sent (expect zero forwarded)")
PY

  echo "## Cat2 port counters AFTER probes"
  ag_ssh "ip -s link show dev \$( . /etc/aetherguard-cat2.conf; echo \$SERVER_IF )" | tee /tmp/ag-cnt-after.txt

  echo "## management plane still reachable from UPLINK side? (usb0 channel check)"
  ag_ssh "echo mgmt-ok && ag-cat2-gateway status | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"managementReachable\"])'"

  echo "unauthorizedConnectionSuccessCount=$UNAUTH"
} 2>&1 | ag_log "$TEST_PREFIX"
