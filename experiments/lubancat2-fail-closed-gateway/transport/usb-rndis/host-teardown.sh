#!/bin/bash
# Restore only fixed-MAC host data interfaces recorded by host-setup.sh.
set -Eeuo pipefail

[[ $(id -u) == 0 || "${AG_USB_TEST_MODE:-0}" == "1" ]] || {
    echo "FATAL: host-teardown.sh must run as root" >&2
    exit 2
}

SYS_CLASS_NET=${AG_SYS_CLASS_NET:-/sys/class/net}
VICTIM_INTERFACE=agvictim0
UPLINK_INTERFACE=aguplink0
SERVER_HOST_MAC=02:11:11:11:11:01
UPLINK_HOST_MAC=02:22:22:22:22:01
STATE_DIRECTORY=${AG_USB_HOST_STATE_DIRECTORY:-/var/lib/aetherguard-usb-rndis}
STATE_FILE=$STATE_DIRECTORY/host-state
LOCK_FILE=$STATE_DIRECTORY/lifecycle.lock
ROLLBACK_UNIT=aetherguard-host-usb-auto-rollback

state_value() {
    local state_key=$1
    awk -F= -v expected_key="$state_key" '$1 == expected_key {print substr($0, index($0, "=") + 1)}' "$STATE_FILE"
}

require_unique_state_value() {
    local state_key=$1 state_values
    state_values=$(state_value "$state_key")
    [[ -n "$state_values" && "$state_values" != *$'\n'* ]] || {
        echo "FATAL: missing or duplicate state key $state_key" >&2
        return 1
    }
    printf '%s\n' "$state_values"
}

interface_has_expected_mac() {
    local interface_name=$1 expected_mac=$2
    [[ -r "$SYS_CLASS_NET/$interface_name/address" ]] || return 1
    [[ "$(tr 'A-F' 'a-f' < "$SYS_CLASS_NET/$interface_name/address")" == "$expected_mac" ]]
}

namespace_has_expected_victim() {
    local namespace_name=$1 non_loopback_count victim_mac
    ip netns exec "$namespace_name" ip link show dev "$VICTIM_INTERFACE" >/dev/null 2>&1 || return 1
    non_loopback_count=$(ip netns exec "$namespace_name" ip -o link show \
        | awk -F': ' '$2 != "lo" {count += 1} END {print count + 0}')
    victim_mac=$(ip netns exec "$namespace_name" cat "/sys/class/net/$VICTIM_INTERFACE/address")
    [[ "$non_loopback_count" == "1" && "$victim_mac" == "$SERVER_HOST_MAC" ]]
}

restore_managed_state() {
    local interface_name=$1 original_managed_state=$2
    command -v nmcli >/dev/null 2>&1 || return 0
    case "$original_managed_state" in
        yes|true) nmcli device set "$interface_name" managed yes ;;
        no|false) nmcli device set "$interface_name" managed no ;;
        unavailable) return 0 ;;
        unknown)
            # Setup could not observe the original NM state (transient lookup
            # failure). Restoring a guessed state would be worse than leaving
            # the current one, so skip NM restoration but do not block the
            # rest of the teardown.
            echo "WARNING: original NetworkManager state was not recorded for $interface_name; leaving current NM state unchanged" >&2
            return 0 ;;
        *) echo "FATAL: unsafe recorded NetworkManager state: $original_managed_state" >&2; return 1 ;;
    esac
}

mkdir -p "$STATE_DIRECTORY"
chmod 0700 "$STATE_DIRECTORY"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -x 9

if [[ ! -e "$STATE_FILE" ]]; then
    if [[ -e "$SYS_CLASS_NET/$VICTIM_INTERFACE" || -e "$SYS_CLASS_NET/$UPLINK_INTERFACE" ]] \
        || ip netns list | awk '{print $1}' | awk '$1 == "victim" {found=1} END {exit !found}'; then
        echo "FATAL: experiment names exist without owned state; refusing destructive cleanup" >&2
        exit 1
    fi
    echo "Host USB RNDIS topology has no owned objects"
    exit 0
fi

[[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { echo "FATAL: host state is not a regular file" >&2; exit 1; }
victim_namespace=$(require_unique_state_value victimNamespace)
original_victim_interface=$(require_unique_state_value originalVictimInterface)
original_uplink_interface=$(require_unique_state_value originalUplinkInterface)
victim_was_managed=$(require_unique_state_value victimWasManaged)
uplink_was_managed=$(require_unique_state_value uplinkWasManaged)
victim_address=$(require_unique_state_value victimAddress)
victim_ipv6_address=$(require_unique_state_value victimIpv6Address)
uplink_address=$(require_unique_state_value uplinkAddress)
uplink_ipv6_address=$(require_unique_state_value uplinkIpv6Address)
intend_victim_rename=$(require_unique_state_value intendVictimRename)
intend_uplink_rename=$(require_unique_state_value intendUplinkRename)
intend_namespace=$(require_unique_state_value intendNamespace)
intend_victim_move=$(require_unique_state_value intendVictimMove)
intend_victim_address=$(require_unique_state_value intendVictimAddress)
intend_victim_ipv6_address=$(require_unique_state_value intendVictimIpv6Address)
intend_victim_route=$(require_unique_state_value intendVictimRoute)
intend_uplink_address=$(require_unique_state_value intendUplinkAddress)
intend_uplink_ipv6_address=$(require_unique_state_value intendUplinkIpv6Address)

for identifier_value in "$victim_namespace" "$original_victim_interface" "$original_uplink_interface"; do
    [[ "$identifier_value" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "FATAL: malformed identifier state" >&2; exit 1; }
done
for boolean_value in "$intend_victim_rename" "$intend_uplink_rename" "$intend_namespace" \
    "$intend_victim_move" "$intend_victim_address" "$intend_victim_ipv6_address" \
    "$intend_victim_route" "$intend_uplink_address" "$intend_uplink_ipv6_address"; do
    [[ "$boolean_value" == "true" || "$boolean_value" == "false" ]] \
        || { echo "FATAL: malformed ownership intent" >&2; exit 1; }
done

if ip netns list | awk '{print $1}' | awk -v expected="$victim_namespace" '$1 == expected {found=1} END {exit !found}'; then
    if namespace_has_expected_victim "$victim_namespace"; then
        [[ "$intend_victim_route" != "true" ]] \
            || ip netns exec "$victim_namespace" ip route del default 2>/dev/null || true
        [[ "$intend_victim_ipv6_address" != "true" ]] \
            || ip netns exec "$victim_namespace" ip -6 address del "$victim_ipv6_address" dev "$VICTIM_INTERFACE" 2>/dev/null || true
        [[ "$intend_victim_address" != "true" ]] \
            || ip netns exec "$victim_namespace" ip address del "$victim_address" dev "$VICTIM_INTERFACE" 2>/dev/null || true
        ip netns exec "$victim_namespace" ip link set dev "$VICTIM_INTERFACE" down
        ip netns exec "$victim_namespace" ip link set dev "$VICTIM_INTERFACE" netns 1
    else
        namespace_non_loopback_count=$(ip netns exec "$victim_namespace" ip -o link show \
            | awk -F': ' '$2 != "lo" {count += 1} END {print count + 0}')
        [[ "$namespace_non_loopback_count" == "0" ]] \
            || { echo "FATAL: victim namespace contains an unexpected interface" >&2; exit 1; }
    fi
    [[ "$intend_namespace" != "true" ]] || ip netns delete "$victim_namespace"
elif [[ "$intend_namespace" != "true" ]]; then
    :
fi

if [[ -e "$SYS_CLASS_NET/$UPLINK_INTERFACE" ]]; then
    interface_has_expected_mac "$UPLINK_INTERFACE" "$UPLINK_HOST_MAC" \
        || { echo "FATAL: uplink interface identity changed" >&2; exit 1; }
    [[ "$intend_uplink_ipv6_address" != "true" ]] \
        || ip -6 address del "$uplink_ipv6_address" dev "$UPLINK_INTERFACE" 2>/dev/null || true
    [[ "$intend_uplink_address" != "true" ]] \
        || ip address del "$uplink_address" dev "$UPLINK_INTERFACE" 2>/dev/null || true
    ip link set dev "$UPLINK_INTERFACE" down
fi
if [[ -e "$SYS_CLASS_NET/$VICTIM_INTERFACE" ]]; then
    interface_has_expected_mac "$VICTIM_INTERFACE" "$SERVER_HOST_MAC" \
        || { echo "FATAL: victim interface identity changed" >&2; exit 1; }
    ip link set dev "$VICTIM_INTERFACE" down
fi

if [[ "$intend_victim_rename" == "true" && "$VICTIM_INTERFACE" != "$original_victim_interface" ]] \
    && [[ -e "$SYS_CLASS_NET/$VICTIM_INTERFACE" ]]; then
    [[ ! -e "$SYS_CLASS_NET/$original_victim_interface" ]] \
        || { echo "FATAL: original victim interface name is occupied" >&2; exit 1; }
    ip link set dev "$VICTIM_INTERFACE" name "$original_victim_interface"
fi
if [[ "$intend_uplink_rename" == "true" && "$UPLINK_INTERFACE" != "$original_uplink_interface" ]] \
    && [[ -e "$SYS_CLASS_NET/$UPLINK_INTERFACE" ]]; then
    [[ ! -e "$SYS_CLASS_NET/$original_uplink_interface" ]] \
        || { echo "FATAL: original uplink interface name is occupied" >&2; exit 1; }
    ip link set dev "$UPLINK_INTERFACE" name "$original_uplink_interface"
fi

if [[ -e "$SYS_CLASS_NET/$original_victim_interface" ]]; then
    interface_has_expected_mac "$original_victim_interface" "$SERVER_HOST_MAC" || exit 1
    restore_managed_state "$original_victim_interface" "$victim_was_managed"
fi
if [[ -e "$SYS_CLASS_NET/$original_uplink_interface" ]]; then
    interface_has_expected_mac "$original_uplink_interface" "$UPLINK_HOST_MAC" || exit 1
    restore_managed_state "$original_uplink_interface" "$uplink_was_managed"
fi

systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
rm -f "$STATE_FILE"
python3 - "$STATE_DIRECTORY" <<'PYEOF'
import os
import sys

directory_descriptor = os.open(sys.argv[1], os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
try:
    os.fsync(directory_descriptor)
finally:
    os.close(directory_descriptor)
PYEOF
echo "Host USB RNDIS teardown complete; no global forwarding, NAT, firewall, or VPN state changed"
