#!/bin/bash
set -Eeuo pipefail

STATE_DIR=/var/lib/aetherguard-cat2/ethernet
STATE_FILE=$STATE_DIR/cat2-state
LOCK_FILE=$STATE_DIR/lifecycle.lock

SERVER_IF=${AG_SERVER_IF:-eth0}
UPLINK_IF=${AG_UPLINK_IF:-eth1}
BRIDGE_IF=${AG_BRIDGE_IF:-agbr0}
CREATED_BRIDGE=false

if [[ -f "$STATE_FILE" ]]; then
    CREATED_BRIDGE=$(grep '^createdBridge=' "$STATE_FILE" | cut -d= -f2 || echo false)
    rm -f "$STATE_FILE"
fi
rm -f "$LOCK_FILE"

if [[ -d "/sys/class/net/$SERVER_IF/brport" ]]; then
    ip link set dev "$SERVER_IF" nomaster 2>/dev/null || true
fi

if [[ "$CREATED_BRIDGE" == "true" ]] && ip link show dev "$BRIDGE_IF" >/dev/null 2>&1; then
    ip link delete dev "$BRIDGE_IF" type bridge 2>/dev/null || true
fi

# Ensure management interface never in any bridge
if [[ -d "/sys/class/net/usb0/brport" ]]; then
    ip link set dev usb0 nomaster 2>/dev/null || true
fi

echo "Cat2 Ethernet teardown complete"
