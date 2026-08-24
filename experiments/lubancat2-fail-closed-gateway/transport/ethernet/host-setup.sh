#!/bin/bash
set -Eeuo pipefail

[[ $(id -u) == 0 ]] || { echo "FATAL: root required" >&2; exit 2; }
[[ "${AG_EXPERIMENT_MODE:-0}" == "1" ]] || { echo "FATAL: AG_EXPERIMENT_MODE=1" >&2; exit 2; }

MGMT_IF=${AG_HOST_MGMT_IF:-enx866d35078167}
MGMT_ADDR=${AG_HOST_MGMT_ADDRESS:-192.168.100.1/24}
CAT2_MGMT_ADDR=${AG_CAT2_MGMT_ADDRESS:-192.168.100.2}
UPLINK_IF=${AG_HOST_UPLINK_IF:-aguplink0}
VICTIM_NS=${AG_VICTIM_NS:-victim}
VICTIM_IF=agvictim0
VICTIM_ADDR=${AG_VICTIM_ADDRESS:-10.99.0.2/24}
UPLINK_ADDR=${AG_HOST_UPLINK_ADDRESS:-10.99.0.1/24}
HOST_PHYSICAL=${AG_HOST_PHYSICAL_UPLINK:-eno1}
HOST_BRIDGE=${AG_HOST_BRIDGE:-agbr0-host}

STATE_DIR=/var/lib/aetherguard-host-ethernet
STATE_FILE=$STATE_DIR/host-state
LOCK_FILE=$STATE_DIR/lifecycle.lock

ping -I "$MGMT_IF" -c 1 -W 3 "$CAT2_MGMT_ADDR" >/dev/null 2>&1 || {
    echo "FATAL: LubanCat-2 not reachable" >&2; exit 1; }

mkdir -p "$STATE_DIR"
chmod 0700 "$STATE_DIR"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -x 9

[[ ! -e "$STATE_FILE" ]] || { echo "FATAL: state exists" >&2; exit 1; }

# Victim namespace
ip netns add "$VICTIM_NS" || { echo "FATAL: ns exists" >&2; exit 1; }

# veth pair
ip link add "$VICTIM_IF" type veth peer name "$UPLINK_IF" || { echo "FATAL: veth fail" >&2; exit 1; }

# Victim config
ip link set "$VICTIM_IF" netns "$VICTIM_NS"
ip netns exec "$VICTIM_NS" ip link set lo up
ip netns exec "$VICTIM_NS" ip link set "$VICTIM_IF" address 02:11:11:11:11:01
ip netns exec "$VICTIM_NS" ip address add "$VICTIM_ADDR" dev "$VICTIM_IF"
ip netns exec "$VICTIM_NS" ip link set "$VICTIM_IF" up
GW=${UPLINK_ADDR%/*}
ip netns exec "$VICTIM_NS" ip route add default via "$GW" dev "$VICTIM_IF"

# Host uplink iface
ip link set "$UPLINK_IF" address 02:22:22:22:22:01
ip address add "$UPLINK_ADDR" dev "$UPLINK_IF"
ip link set "$UPLINK_IF" up

# Host bridge for L2 to LubanCat-2
ip link add "$HOST_BRIDGE" type bridge 2>/dev/null || true
ip link set "$HOST_BRIDGE" type bridge stp_state 0 forward_delay 0
ip link set dev "$HOST_BRIDGE" up
ip link set dev "$UPLINK_IF" master "$HOST_BRIDGE"
Experimental: skip eno1 master to avoid disrupting active NetworkManager connection
# ip link set dev "$HOST_PHYSICAL" master "$HOST_BRIDGE"

sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf."$HOST_BRIDGE".proxy_arp=1 >/dev/null 2>&1 || true

# Disable WiFi bypass
nmcli device disconnect wlo1 2>/dev/null || true

cat > "$STATE_FILE" <<EOF
phase=active
victimNamespace=$VICTIM_NS
victimInterface=$VICTIM_IF
uplinkInterface=$UPLINK_IF
hostBridge=$HOST_BRIDGE
victimAddress=$VICTIM_ADDR
uplinkAddress=$UPLINK_ADDR
EOF
chmod 0600 "$STATE_FILE"

echo "Host Ethernet setup: victim=$VICTIM_NS ($VICTIM_ADDR) uplink=$UPLINK_IF ($UPLINK_ADDR)"
