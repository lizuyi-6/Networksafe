#!/bin/bash
# cat2-ethernet-setup.sh
set -Eeuo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE_DIR=/var/lib/aetherguard-cat2/ethernet
STATE_FILE=$STATE_DIR/cat2-state
LOCK_FILE=$STATE_DIR/lifecycle.lock
BACKUP_DIR=$STATE_DIR/backups
ROLLBACK_UNIT=aetherguard-cat2-ethernet-rollback

SERVER_IF=${AG_SERVER_IF:-eth0}
UPLINK_IF=${AG_UPLINK_IF:-eth1}
BRIDGE_IF=${AG_BRIDGE_IF:-agbr0}
MGMT_IF=${AG_MANAGEMENT_IF:-usb0}
MGMT_ADDR=${AG_MANAGEMENT_ADDRESS:-192.168.100.2/24}
CONFIG_REMOTE=${AG_GATEWAY_CONFIG_REMOTE:-/etc/aetherguard-cat2.conf}

CREATED_BRIDGE=false
SETUP_COMMITTED=false
TRANSACTION_STARTED=false

mkdir -p "$STATE_DIR" "$BACKUP_DIR"
chmod 0700 "$STATE_DIR" "$BACKUP_DIR"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -x 9

if [[ -f "$STATE_FILE" ]]; then
    phase=$(grep '^phase=' "$STATE_FILE" | cut -d= -f2)
    [[ "$phase" == "active" ]] || { echo "FATAL: incomplete state" >&2; exit 1; }
    echo "Cat2 Ethernet topology already active"
    exit 0
fi

# Pre-flight
[[ -d "/sys/class/net/$MGMT_IF" ]] || { echo "FATAL: $MGMT_IF missing" >&2; exit 1; }
[[ ! -d "/sys/class/net/$MGMT_IF/brport" ]] || { echo "FATAL: $MGMT_IF in bridge!" >&2; exit 1; }
mgmt_ip=$(ip -o -4 address show dev "$MGMT_IF" 2>/dev/null | awk '{print $4}' | head -1)
[[ "$mgmt_ip" == "$MGMT_ADDR" ]] || { echo "FATAL: mgmt addr mismatch" >&2; exit 1; }
[[ -d "/sys/class/net/$UPLINK_IF" ]] || { echo "FATAL: $UPLINK_IF missing" >&2; exit 1; }
uplink_carrier=$(cat "/sys/class/net/$UPLINK_IF/carrier" 2>/dev/null || echo 0)
[[ "$uplink_carrier" == "1" ]] || { echo "FATAL: $UPLINK_IF no carrier" >&2; exit 1; }
uplink_speed=$(cat "/sys/class/net/$UPLINK_IF/speed" 2>/dev/null || echo unknown)
echo "INFO: $UPLINK_IF carrier=yes speed=${uplink_speed}Mb/s"

# Configure eth0
if [[ -d "/sys/class/net/$SERVER_IF" ]]; then
    SERVER_ADDR=$(grep '^AG_SERVER_ADDRESS=' "$CONFIG_REMOTE" 2>/dev/null | cut -d= -f2 || echo "10.99.0.3/24")
    if ! ip -o -4 address show dev "$SERVER_IF" 2>/dev/null | grep -q "$SERVER_ADDR"; then
        ip address add "$SERVER_ADDR" dev "$SERVER_IF" 2>/dev/null || true
    fi
    ip link set dev "$SERVER_IF" up 2>/dev/null || true
fi

ip -details link show > "$BACKUP_DIR/ip-link-before.txt" 2>/dev/null || true
TRANSACTION_STARTED=true
trap 'rollback_setup $?' EXIT
trap 'exit 1' HUP INT TERM

if ! ip link show dev "$BRIDGE_IF" >/dev/null 2>&1; then
    ip link add "$BRIDGE_IF" type bridge
    CREATED_BRIDGE=true
fi
ip link set "$BRIDGE_IF" type bridge stp_state 0 forward_delay 0
ip link set dev "$BRIDGE_IF" up

# Exact closed topology: only UPLINK_IF
for member in /sys/class/net/*/brport; do
    [[ -L "$member" ]] || continue
    iface=$(basename "$(dirname "$member")")
    master=$(readlink -f "$member" 2>/dev/null || echo "")
    [[ "$master" == *"/$BRIDGE_IF" ]] || continue
    [[ "$iface" == "$UPLINK_IF" ]] && continue
    echo "INFO: removing unexpected member $iface"
    ip link set dev "$iface" nomaster 2>/dev/null || true
done

ip link set dev "$UPLINK_IF" up
if ! ip link show dev "$UPLINK_IF" 2>/dev/null | grep -q "master $BRIDGE_IF"; then
    ip link set dev "$UPLINK_IF" master "$BRIDGE_IF"
fi
if [[ -d "/sys/class/net/$SERVER_IF/brport" ]]; then
    ip link set dev "$SERVER_IF" nomaster
fi
ip link set dev "$SERVER_IF" up 2>/dev/null || true

members=$(bridge link show 2>/dev/null | grep "master $BRIDGE_IF" | awk '{print $NF}' | sort)
[[ "$members" == "$UPLINK_IF" ]] || { echo "FATAL: members=$members" >&2; exit 1; }

ag-cat2-gateway isolate || { echo "FATAL: isolate failed" >&2; exit 1; }
ag-cat2-gateway reconcile || { echo "FATAL: reconcile failed" >&2; exit 1; }

cat > "$STATE_FILE" <<INNEREOF
phase=active
bridgeInterface=$BRIDGE_IF
serverInterface=$SERVER_IF
uplinkInterface=$UPLINK_IF
managementInterface=$MGMT_IF
managementAddress=$MGMT_ADDR
createdBridge=$CREATED_BRIDGE
uplinkSpeed=${uplink_speed}
INNEREOF
chmod 0600 "$STATE_FILE"

SETUP_COMMITTED=true
systemd-run --unit="$ROLLBACK_UNIT" --on-active="${AUTO_ROLLBACK_MINUTES}m" --collect \
    env AG_SERVER_IF="$SERVER_IF" AG_UPLINK_IF="$UPLINK_IF" AG_BRIDGE_IF="$BRIDGE_IF" \
    AG_MANAGEMENT_IF="$MGMT_IF" AG_MANAGEMENT_ADDRESS="$MGMT_ADDR" \
    AG_GATEWAY_CONFIG_REMOTE="$CONFIG_REMOTE" \
    "$SCRIPT_DIR/cat2-teardown.sh" >/dev/null 2>&1 || true

echo "Cat2 Ethernet setup complete: $BRIDGE_IF={$UPLINK_IF} $SERVER_IF isolated"

rollback_setup() {
    trap - EXIT HUP INT TERM
    [[ "$TRANSACTION_STARTED" == "true" && "$SETUP_COMMITTED" != "true" ]] || return "$1"
    echo "ROLLBACK" >&2
    if [[ -d "/sys/class/net/$SERVER_IF/brport" ]]; then
        ip link set dev "$SERVER_IF" nomaster 2>/dev/null || true
    fi
    if [[ "$CREATED_BRIDGE" == "true" ]] && ip link show dev "$BRIDGE_IF" >/dev/null 2>&1; then
        ip link delete dev "$BRIDGE_IF" type bridge 2>/dev/null || true
    fi
    rm -f "$STATE_FILE"
    exit "$1"
}
