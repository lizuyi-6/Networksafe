#!/bin/bash
set -Eeuo pipefail

[[ $(id -u) == 0 ]] || { echo "FATAL" >&2; exit 2; }

STATE_DIR=/var/lib/aetherguard-host-ethernet
STATE_FILE=$STATE_DIR/host-state
LOCK_FILE=$STATE_DIR/lifecycle.lock

VICTIM_NS=${AG_VICTIM_NS:-victim}
VICTIM_IF=agvictim0
UPLINK_IF=${AG_HOST_UPLINK_IF:-aguplink0}
HOST_BRIDGE=${AG_HOST_BRIDGE:-agbr0-host}

rm -f "$STATE_FILE" "$LOCK_FILE"

ip link set dev "$UPLINK_IF" nomaster 2>/dev/null || true
ip link del "$VICTIM_IF" 2>/dev/null || true
ip netns del "$VICTIM_NS" 2>/dev/null || true

echo "Host Ethernet teardown complete"
