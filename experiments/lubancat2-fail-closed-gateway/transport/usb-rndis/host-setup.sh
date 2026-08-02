#!/bin/bash
# Build a local-only victim/upstream topology without global forwarding or NAT.
set -Eeuo pipefail

[[ $(id -u) == 0 || "${AG_USB_TEST_MODE:-0}" == "1" ]] || {
    echo "FATAL: host-setup.sh must run as root" >&2
    exit 2
}
[[ "${AG_EXPERIMENT_MODE:-0}" == "1" ]] || {
    echo "FATAL: set AG_EXPERIMENT_MODE=1 explicitly" >&2
    exit 2
}

SCRIPT_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SYS_CLASS_NET=${AG_SYS_CLASS_NET:-/sys/class/net}
VICTIM_NAMESPACE=${AG_VICTIM_NETNS:-victim}
VICTIM_INTERFACE=agvictim0
UPLINK_INTERFACE=aguplink0
VICTIM_ADDRESS=${AG_VICTIM_ADDRESS:-10.99.0.2/24}
UPLINK_ADDRESS=${AG_LOCAL_UPLINK_ADDRESS:-10.99.0.1/24}
UPLINK_GATEWAY=${UPLINK_ADDRESS%/*}
VICTIM_IPV6_ADDRESS=${AG_VICTIM_IPV6_ADDRESS:-fd42:ae7e:6a7d::2/64}
UPLINK_IPV6_ADDRESS=${AG_UPLINK_IPV6_ADDRESS:-fd42:ae7e:6a7d::1/64}
MANAGEMENT_ADDRESS=${AG_HOST_MANAGEMENT_ADDRESS:-192.168.100.1/24}
CAT2_MANAGEMENT_ADDRESS=${AG_CAT2_MANAGEMENT_ADDRESS:-192.168.100.2}
SERVER_HOST_MAC=02:11:11:11:11:01
UPLINK_HOST_MAC=02:22:22:22:22:01
STATE_DIRECTORY=${AG_USB_HOST_STATE_DIRECTORY:-/var/lib/aetherguard-usb-rndis}
STATE_FILE=$STATE_DIRECTORY/host-state
LOCK_FILE=$STATE_DIRECTORY/lifecycle.lock
AUTO_ROLLBACK_MINUTES=${AG_AUTO_ROLLBACK_MINUTES:-30}
ROLLBACK_UNIT=aetherguard-host-usb-auto-rollback

SETUP_COMMITTED=false
TRANSACTION_STARTED=false
ORIGINAL_VICTIM_INTERFACE=
ORIGINAL_UPLINK_INTERFACE=
VICTIM_WAS_MANAGED=unknown
UPLINK_WAS_MANAGED=unknown
INTEND_VICTIM_RENAME=false
INTEND_UPLINK_RENAME=false
INTEND_NAMESPACE=false
INTEND_VICTIM_MOVE=false
INTEND_VICTIM_ADDRESS=false
INTEND_VICTIM_IPV6_ADDRESS=false
INTEND_VICTIM_ROUTE=false
INTEND_UPLINK_ADDRESS=false
INTEND_UPLINK_IPV6_ADDRESS=false

discover_interface_by_mac() {
    local expected_mac=$1 address_path interface_name discovered_interface=
    for address_path in "$SYS_CLASS_NET"/*/address; do
        [[ -r "$address_path" ]] || continue
        if [[ "$(tr 'A-F' 'a-f' < "$address_path")" == "$expected_mac" ]]; then
            interface_name=$(basename "$(dirname "$address_path")")
            [[ -z "$discovered_interface" ]] || {
                echo "FATAL: multiple interfaces use MAC $expected_mac" >&2
                return 1
            }
            discovered_interface=$interface_name
        fi
    done
    [[ -n "$discovered_interface" ]] || return 1
    printf '%s\n' "$discovered_interface"
}

discover_management_interface() {
    local expected_address=${MANAGEMENT_ADDRESS%/*} expected_prefix=${MANAGEMENT_ADDRESS#*/}
    ip -o -4 address show | awk -F'[ /]+' -v address="$expected_address" -v prefix="$expected_prefix" \
        '$4 == address && $5 == prefix {print $2}'
}

network_manager_managed_state() {
    local interface_name=$1 lookup_attempt managed_state
    if ! command -v nmcli >/dev/null 2>&1; then
        printf 'unavailable\n'
        return 0
    fi
    # Freshly enumerated RNDIS interfaces can take a moment to appear in
    # NetworkManager's device list; retry briefly before giving up.
    for lookup_attempt in 1 2 3 4 5; do
        managed_state=$(nmcli -g GENERAL.MANAGED device show "$interface_name" 2>/dev/null \
            | tr '[:upper:]' '[:lower:]')
        case "$managed_state" in
            yes|no|true|false) printf '%s\n' "$managed_state"; return 0 ;;
        esac
        sleep 1
    done
    printf 'unknown\n'
}

require_pristine_data_interface() {
    local interface_name=$1 active_connection
    [[ ! -e "$SYS_CLASS_NET/$interface_name/master" ]] || return 1
    [[ -z "$(ip -o address show dev "$interface_name")" ]] || return 1
    if command -v nmcli >/dev/null 2>&1; then
        active_connection=$(nmcli -g GENERAL.CONNECTION device show "$interface_name" 2>/dev/null || true)
        [[ -z "$active_connection" || "$active_connection" == "--" ]] || return 1
    fi
}

write_state() {
    local phase=$1
    python3 - "$STATE_FILE" "$phase" "$VICTIM_NAMESPACE" "$ORIGINAL_VICTIM_INTERFACE" \
        "$ORIGINAL_UPLINK_INTERFACE" "$VICTIM_WAS_MANAGED" "$UPLINK_WAS_MANAGED" \
        "$INTEND_VICTIM_RENAME" "$INTEND_UPLINK_RENAME" "$INTEND_NAMESPACE" \
        "$INTEND_VICTIM_MOVE" "$INTEND_VICTIM_ADDRESS" "$INTEND_VICTIM_IPV6_ADDRESS" \
        "$INTEND_VICTIM_ROUTE" "$INTEND_UPLINK_ADDRESS" "$INTEND_UPLINK_IPV6_ADDRESS" \
        "$VICTIM_ADDRESS" "$VICTIM_IPV6_ADDRESS" "$UPLINK_ADDRESS" "$UPLINK_IPV6_ADDRESS" <<'PYEOF'
import os
import sys
import tempfile

(state_path, phase, victim_namespace, original_victim_interface,
 original_uplink_interface, victim_was_managed, uplink_was_managed,
 intend_victim_rename, intend_uplink_rename, intend_namespace, intend_victim_move,
 intend_victim_address, intend_victim_ipv6_address, intend_victim_route,
 intend_uplink_address, intend_uplink_ipv6_address, victim_address,
 victim_ipv6_address, uplink_address, uplink_ipv6_address) = sys.argv[1:21]
values = (
    ("phase", phase),
    ("victimNamespace", victim_namespace),
    ("originalVictimInterface", original_victim_interface),
    ("originalUplinkInterface", original_uplink_interface),
    ("victimWasManaged", victim_was_managed),
    ("uplinkWasManaged", uplink_was_managed),
    ("intendVictimRename", intend_victim_rename),
    ("intendUplinkRename", intend_uplink_rename),
    ("intendNamespace", intend_namespace),
    ("intendVictimMove", intend_victim_move),
    ("intendVictimAddress", intend_victim_address),
    ("intendVictimIpv6Address", intend_victim_ipv6_address),
    ("intendVictimRoute", intend_victim_route),
    ("intendUplinkAddress", intend_uplink_address),
    ("intendUplinkIpv6Address", intend_uplink_ipv6_address),
    ("victimAddress", victim_address),
    ("victimIpv6Address", victim_ipv6_address),
    ("uplinkAddress", uplink_address),
    ("uplinkIpv6Address", uplink_ipv6_address),
)
state_directory = os.path.dirname(state_path)
file_descriptor, temporary_path = tempfile.mkstemp(prefix=".host-state.", dir=state_directory)
try:
    os.fchmod(file_descriptor, 0o600)
    with os.fdopen(file_descriptor, "w", encoding="ascii") as state_file:
        for state_key, state_value in values:
            state_file.write("%s=%s\n" % (state_key, state_value))
        state_file.flush()
        os.fsync(state_file.fileno())
    os.replace(temporary_path, state_path)
    directory_descriptor = os.open(state_directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
except Exception:
    try:
        os.close(file_descriptor)
    except OSError:
        pass
    try:
        os.unlink(temporary_path)
    except OSError:
        pass
    raise
PYEOF
}

verify_active_topology() {
    local victim_non_loopback_count victim_mac uplink_mac
    victim_non_loopback_count=$(ip netns exec "$VICTIM_NAMESPACE" ip -o link show \
        | awk -F': ' '$2 != "lo" {count += 1} END {print count + 0}')
    victim_mac=$(ip netns exec "$VICTIM_NAMESPACE" cat "/sys/class/net/$VICTIM_INTERFACE/address")
    uplink_mac=$(<"$SYS_CLASS_NET/$UPLINK_INTERFACE/address")
    [[ "$victim_non_loopback_count" == "1" ]] \
        && [[ "$victim_mac" == "$SERVER_HOST_MAC" ]] \
        && [[ "$uplink_mac" == "$UPLINK_HOST_MAC" ]] \
        && ip netns exec "$VICTIM_NAMESPACE" ip -o address show dev "$VICTIM_INTERFACE" | awk -v expected="$VICTIM_ADDRESS" '$4 == expected {found=1} END {exit !found}' \
        && ip netns exec "$VICTIM_NAMESPACE" ip -o -6 address show dev "$VICTIM_INTERFACE" | awk -v expected="$VICTIM_IPV6_ADDRESS" '$4 == expected {found=1} END {exit !found}' \
        && [[ "$(ip netns exec "$VICTIM_NAMESPACE" ip -o route show default | awk '{print $5}')" == "$VICTIM_INTERFACE" ]] \
        && ip -o address show dev "$UPLINK_INTERFACE" | awk -v expected="$UPLINK_ADDRESS" '$4 == expected {found=1} END {exit !found}' \
        && ip -o -6 address show dev "$UPLINK_INTERFACE" | awk -v expected="$UPLINK_IPV6_ADDRESS" '$4 == expected {found=1} END {exit !found}'
}

arm_rollback_watchdog() {
    [[ "$AUTO_ROLLBACK_MINUTES" =~ ^[1-9][0-9]*$ ]] || return 1
    systemd-run --unit="$ROLLBACK_UNIT" --on-active="${AUTO_ROLLBACK_MINUTES}m" --collect \
        env AG_EXPERIMENT_MODE=1 AG_USB_HOST_STATE_DIRECTORY="$STATE_DIRECTORY" \
        AG_SYS_CLASS_NET="$SYS_CLASS_NET" "$SCRIPT_DIRECTORY/host-teardown.sh" >/dev/null
}

rollback_setup() {
    local original_exit_code=$1
    trap - EXIT HUP INT TERM
    if [[ "$TRANSACTION_STARTED" == "true" && "$SETUP_COMMITTED" != "true" ]]; then
        echo "ROLLBACK: invoking locked host teardown for the recorded transaction" >&2
        exec 9>&-
        AG_EXPERIMENT_MODE=1 AG_USB_HOST_STATE_DIRECTORY="$STATE_DIRECTORY" \
            AG_SYS_CLASS_NET="$SYS_CLASS_NET" "$SCRIPT_DIRECTORY/host-teardown.sh" \
            || original_exit_code=1
    fi
    exit "$original_exit_code"
}

handle_setup_signal() {
    exit "$1"
}

mkdir -p "$STATE_DIRECTORY"
chmod 0700 "$STATE_DIRECTORY"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -x 9

if [[ -e "$STATE_FILE" ]]; then
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { echo "FATAL: host state is not a regular file" >&2; exit 1; }
    if awk -F= '$1 == "phase" && $2 == "active" {found=1} END {exit !found}' "$STATE_FILE"; then
        verify_active_topology || { echo "FATAL: active host state failed exact verification" >&2; exit 1; }
        echo "Host USB RNDIS topology is already active and fully verified"
        exit 0
    fi
    echo "FATAL: incomplete host state exists; run host-teardown.sh" >&2
    exit 1
fi

management_interface=$(discover_management_interface)
[[ -n "$management_interface" && "$management_interface" != *$'\n'* ]] || {
    echo "FATAL: expected exactly one management interface with $MANAGEMENT_ADDRESS" >&2
    exit 1
}
ping -I "$management_interface" -c 1 -W 2 "$CAT2_MANAGEMENT_ADDRESS" >/dev/null || {
    echo "FATAL: Cat2 usb0 management is not reachable before host changes" >&2
    exit 1
}

ORIGINAL_VICTIM_INTERFACE=$(discover_interface_by_mac "$SERVER_HOST_MAC") \
    || { echo "FATAL: server RNDIS host interface was not found" >&2; exit 1; }
ORIGINAL_UPLINK_INTERFACE=$(discover_interface_by_mac "$UPLINK_HOST_MAC") \
    || { echo "FATAL: uplink RNDIS host interface was not found" >&2; exit 1; }
[[ "$ORIGINAL_VICTIM_INTERFACE" != "$management_interface" ]] || exit 1
[[ "$ORIGINAL_UPLINK_INTERFACE" != "$management_interface" ]] || exit 1
[[ "$ORIGINAL_VICTIM_INTERFACE" != "$ORIGINAL_UPLINK_INTERFACE" ]] || exit 1
require_pristine_data_interface "$ORIGINAL_VICTIM_INTERFACE" \
    || { echo "FATAL: server RNDIS interface is not pristine" >&2; exit 1; }
require_pristine_data_interface "$ORIGINAL_UPLINK_INTERFACE" \
    || { echo "FATAL: uplink RNDIS interface is not pristine" >&2; exit 1; }

if [[ "$ORIGINAL_VICTIM_INTERFACE" != "$VICTIM_INTERFACE" ]]; then
    [[ ! -e "$SYS_CLASS_NET/$VICTIM_INTERFACE" ]] || { echo "FATAL: target name $VICTIM_INTERFACE is occupied" >&2; exit 1; }
fi
if [[ "$ORIGINAL_UPLINK_INTERFACE" != "$UPLINK_INTERFACE" ]]; then
    [[ ! -e "$SYS_CLASS_NET/$UPLINK_INTERFACE" ]] || { echo "FATAL: target name $UPLINK_INTERFACE is occupied" >&2; exit 1; }
fi
ip netns list | awk '{print $1}' | awk -v expected="$VICTIM_NAMESPACE" '$1 == expected {found=1} END {exit found ? 0 : 1}' \
    && { echo "FATAL: namespace $VICTIM_NAMESPACE already exists without owned state" >&2; exit 1; } || true

VICTIM_WAS_MANAGED=$(network_manager_managed_state "$ORIGINAL_VICTIM_INTERFACE")
UPLINK_WAS_MANAGED=$(network_manager_managed_state "$ORIGINAL_UPLINK_INTERFACE")
write_state prepared
arm_rollback_watchdog
TRANSACTION_STARTED=true
trap 'rollback_setup $?' EXIT
trap 'handle_setup_signal 129' HUP
trap 'handle_setup_signal 130' INT
trap 'handle_setup_signal 143' TERM

if command -v nmcli >/dev/null 2>&1; then
    nmcli device set "$ORIGINAL_VICTIM_INTERFACE" managed no
    nmcli device set "$ORIGINAL_UPLINK_INTERFACE" managed no
fi
ip link set dev "$ORIGINAL_VICTIM_INTERFACE" down
ip link set dev "$ORIGINAL_UPLINK_INTERFACE" down

INTEND_VICTIM_RENAME=true
write_state prepared
[[ "$ORIGINAL_VICTIM_INTERFACE" == "$VICTIM_INTERFACE" ]] \
    || ip link set dev "$ORIGINAL_VICTIM_INTERFACE" name "$VICTIM_INTERFACE"
INTEND_UPLINK_RENAME=true
write_state prepared
[[ "$ORIGINAL_UPLINK_INTERFACE" == "$UPLINK_INTERFACE" ]] \
    || ip link set dev "$ORIGINAL_UPLINK_INTERFACE" name "$UPLINK_INTERFACE"

INTEND_NAMESPACE=true
write_state prepared
ip netns add "$VICTIM_NAMESPACE"
INTEND_VICTIM_MOVE=true
write_state prepared
ip link set dev "$VICTIM_INTERFACE" netns "$VICTIM_NAMESPACE"
ip netns exec "$VICTIM_NAMESPACE" ip link set dev lo up
ip netns exec "$VICTIM_NAMESPACE" ip link set dev "$VICTIM_INTERFACE" up
INTEND_VICTIM_ADDRESS=true
write_state prepared
ip netns exec "$VICTIM_NAMESPACE" ip address add "$VICTIM_ADDRESS" dev "$VICTIM_INTERFACE"
INTEND_VICTIM_IPV6_ADDRESS=true
write_state prepared
ip netns exec "$VICTIM_NAMESPACE" ip -6 address add "$VICTIM_IPV6_ADDRESS" dev "$VICTIM_INTERFACE"
INTEND_VICTIM_ROUTE=true
write_state prepared
ip netns exec "$VICTIM_NAMESPACE" ip route add default via "$UPLINK_GATEWAY" dev "$VICTIM_INTERFACE"

ip link set dev "$UPLINK_INTERFACE" up
INTEND_UPLINK_ADDRESS=true
write_state prepared
ip address add "$UPLINK_ADDRESS" dev "$UPLINK_INTERFACE"
INTEND_UPLINK_IPV6_ADDRESS=true
write_state prepared
ip -6 address add "$UPLINK_IPV6_ADDRESS" dev "$UPLINK_INTERFACE"

verify_active_topology || { echo "FATAL: completed host topology failed exact verification" >&2; exit 1; }
ping -I "$management_interface" -c 1 -W 2 "$CAT2_MANAGEMENT_ADDRESS" >/dev/null
write_state active
SETUP_COMMITTED=true
echo "Host USB RNDIS setup complete; local-only upstream active; no forwarding, NAT, or firewall changes"
