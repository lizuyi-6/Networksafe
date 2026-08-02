#!/bin/bash
# Converge recorded Cat2 USB objects to the verified management-only baseline.
set -Eeuo pipefail

[[ $(id -u) == 0 || "${AG_USB_TEST_MODE:-0}" == "1" ]] || {
    echo "FATAL: cat2-teardown.sh must run as root" >&2
    exit 2
}

GADGET_ROOT=${AG_USB_GADGET_ROOT:-/sys/kernel/config/usb_gadget/rockchip}
GADGET_CONFIG=${AG_USB_GADGET_CONFIG:-b.1}
SYS_CLASS_NET=${AG_SYS_CLASS_NET:-/sys/class/net}
MANAGEMENT_FUNCTION=${AG_MANAGEMENT_FUNCTION:-rndis.gs0}
MANAGEMENT_INTERFACE=${AG_MANAGEMENT_IF:-usb0}
MANAGEMENT_ADDRESS=${AG_MANAGEMENT_ADDRESS:-192.168.100.2/24}
SERVER_FUNCTION=rndis.usb1
UPLINK_FUNCTION=rndis.usb2
SERVER_INTERFACE=${AG_SERVER_IF:-usb1}
UPLINK_INTERFACE=${AG_UPLINK_IF:-usb2}
BRIDGE_INTERFACE=${AG_BRIDGE_IF:-agbr0}
SERVER_HOST_MAC=02:11:11:11:11:01
SERVER_DEVICE_MAC=02:11:11:11:11:02
UPLINK_HOST_MAC=02:22:22:22:22:01
UPLINK_DEVICE_MAC=02:22:22:22:22:02
STATE_DIRECTORY=${AG_USB_STATE_DIRECTORY:-/var/lib/aetherguard-cat2/usb-rndis}
STATE_FILE=$STATE_DIRECTORY/cat2-state
LOCK_FILE=$STATE_DIRECTORY/lifecycle.lock
ROLLBACK_UNIT=aetherguard-cat2-usb-auto-rollback
MANAGEMENT_REBOUND=false

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

verify_management_invariants() {
    local interface_mac function_mac expected_address expected_prefix
    [[ -d "$GADGET_ROOT/functions/$MANAGEMENT_FUNCTION" ]] || return 1
    [[ -d "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE" ]] || return 1
    [[ ! -d "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE/brport" ]] || return 1
    interface_mac=$(tr 'A-F' 'a-f' < "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE/address")
    function_mac=$(tr 'A-F' 'a-f' < "$GADGET_ROOT/functions/$MANAGEMENT_FUNCTION/dev_addr")
    [[ "$interface_mac" == "$function_mac" ]] || return 1
    expected_address=${MANAGEMENT_ADDRESS%/*}
    expected_prefix=${MANAGEMENT_ADDRESS#*/}
    ip -o address show dev "$MANAGEMENT_INTERFACE" 2>/dev/null \
        | awk '{print $4}' | awk -F/ -v address="$expected_address" -v prefix="$expected_prefix" \
            '$1 == address && $2 == prefix {found=1} END {exit !found}'
}

wait_for_management() {
    local attempt_number
    for attempt_number in $(seq 1 30); do
        verify_management_invariants && return 0
        sleep 1
    done
    return 1
}

verify_owned_function() {
    local function_name=$1 expected_host_mac=$2 expected_device_mac=$3
    [[ "$(<"$GADGET_ROOT/functions/$function_name/host_addr")" == "$expected_host_mac" ]] \
        && [[ "$(<"$GADGET_ROOT/functions/$function_name/dev_addr")" == "$expected_device_mac" ]]
}

remove_owned_link_if_present() {
    local link_name=$1 function_name=$2
    local link_path="$GADGET_ROOT/configs/$GADGET_CONFIG/$link_name"
    [[ -e "$link_path" || -L "$link_path" ]] || return 0
    [[ -L "$link_path" ]] || { echo "FATAL: owned link path became a non-symlink: $link_path" >&2; return 1; }
    # Configfs normalizes absolute symlink targets to relative ones, so
    # compare canonicalized paths on both sides.
    [[ "$(readlink -f "$link_path")" == "$(readlink -f "$GADGET_ROOT/functions/$function_name")" ]] || {
        echo "FATAL: $link_name no longer references the owned function" >&2
        return 1
    }
    rm -f "$link_path"
}

recover_management_on_exit() {
    local teardown_exit_code=$?
    trap - EXIT HUP INT TERM
    if [[ "$MANAGEMENT_REBOUND" != "true" && -n "${original_udc:-}" ]]; then
        printf '%s\n' "$original_udc" > "$GADGET_ROOT/UDC" 2>/dev/null || true
    fi
    exit "$teardown_exit_code"
}

handle_teardown_signal() {
    exit "$1"
}

mkdir -p "$STATE_DIRECTORY"
chmod 0700 "$STATE_DIRECTORY"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -x 9

if [[ ! -e "$STATE_FILE" ]]; then
    for unexpected_path in \
        "$GADGET_ROOT/configs/$GADGET_CONFIG/f2" \
        "$GADGET_ROOT/configs/$GADGET_CONFIG/f3" \
        "$GADGET_ROOT/functions/$SERVER_FUNCTION" \
        "$GADGET_ROOT/functions/$UPLINK_FUNCTION" \
        "$SYS_CLASS_NET/$BRIDGE_INTERFACE"; do
        [[ ! -e "$unexpected_path" ]] || {
            echo "FATAL: object exists without owned state; refusing name-based deletion: $unexpected_path" >&2
            exit 1
        }
    done
    verify_management_invariants || { echo "FATAL: management-only baseline is invalid" >&2; exit 1; }
    echo "Cat2 USB RNDIS topology is already absent and management is verified"
    exit 0
fi

[[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { echo "FATAL: state is not a regular file" >&2; exit 1; }
[[ "$(require_unique_state_value gadgetRoot)" == "$GADGET_ROOT" ]] || exit 1
[[ "$(require_unique_state_value gadgetConfig)" == "$GADGET_CONFIG" ]] || exit 1
[[ "$(require_unique_state_value managementFunction)" == "$MANAGEMENT_FUNCTION" ]] || exit 1
[[ "$(require_unique_state_value managementInterface)" == "$MANAGEMENT_INTERFACE" ]] || exit 1
[[ "$(require_unique_state_value managementAddress)" == "$MANAGEMENT_ADDRESS" ]] || exit 1
[[ "$(require_unique_state_value bridgeInterface)" == "$BRIDGE_INTERFACE" ]] || exit 1
original_udc=$(require_unique_state_value originalUdc)
[[ "$original_udc" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "FATAL: original UDC is invalid" >&2; exit 1; }

created_server_function=$(require_unique_state_value createdServerFunction)
created_uplink_function=$(require_unique_state_value createdUplinkFunction)
created_server_link=$(require_unique_state_value createdServerLink)
created_uplink_link=$(require_unique_state_value createdUplinkLink)
created_bridge=$(require_unique_state_value createdBridge)
for boolean_value in "$created_server_function" "$created_uplink_function" "$created_server_link" \
    "$created_uplink_link" "$created_bridge"; do
    [[ "$boolean_value" == "true" || "$boolean_value" == "false" ]] || {
        echo "FATAL: malformed ownership boolean" >&2
        exit 1
    }
done
[[ "$created_server_function" == "true" || ! -e "$GADGET_ROOT/functions/$SERVER_FUNCTION" ]] \
    || { echo "FATAL: server function exists without ownership intent" >&2; exit 1; }
[[ "$created_uplink_function" == "true" || ! -e "$GADGET_ROOT/functions/$UPLINK_FUNCTION" ]] \
    || { echo "FATAL: uplink function exists without ownership intent" >&2; exit 1; }
[[ "$created_server_link" == "true" || ! -e "$GADGET_ROOT/configs/$GADGET_CONFIG/f2" ]] \
    || { echo "FATAL: f2 exists without ownership intent" >&2; exit 1; }
[[ "$created_uplink_link" == "true" || ! -e "$GADGET_ROOT/configs/$GADGET_CONFIG/f3" ]] \
    || { echo "FATAL: f3 exists without ownership intent" >&2; exit 1; }
[[ "$created_bridge" == "true" || ! -e "$SYS_CLASS_NET/$BRIDGE_INTERFACE" ]] \
    || { echo "FATAL: bridge exists without ownership intent" >&2; exit 1; }

trap recover_management_on_exit EXIT
trap 'handle_teardown_signal 129' HUP
trap 'handle_teardown_signal 130' INT
trap 'handle_teardown_signal 143' TERM

if command -v ag-cat2-gateway >/dev/null 2>&1; then
    ag-cat2-gateway isolate
fi
if interface_has_expected_mac "$SERVER_INTERFACE" "$SERVER_DEVICE_MAC"; then
    ip link set dev "$SERVER_INTERFACE" nomaster 2>/dev/null || true
elif [[ -e "$SYS_CLASS_NET/$SERVER_INTERFACE" ]]; then
    echo "FATAL: server interface identity changed" >&2
    exit 1
fi
if interface_has_expected_mac "$UPLINK_INTERFACE" "$UPLINK_DEVICE_MAC"; then
    ip link set dev "$UPLINK_INTERFACE" nomaster 2>/dev/null || true
elif [[ -e "$SYS_CLASS_NET/$UPLINK_INTERFACE" ]]; then
    echo "FATAL: uplink interface identity changed" >&2
    exit 1
fi
if [[ "$created_bridge" == "true" && -e "$SYS_CLASS_NET/$BRIDGE_INTERFACE" ]]; then
    ip -d link show dev "$BRIDGE_INTERFACE" | awk '/bridge/ {found=1} END {exit !found}' \
        || { echo "FATAL: bridge name now refers to a different link type" >&2; exit 1; }
    ip link delete dev "$BRIDGE_INTERFACE" type bridge
fi

current_udc=$(tr -d '\n' < "$GADGET_ROOT/UDC")
[[ -z "$current_udc" || "$current_udc" == "$original_udc" ]] || {
    echo "FATAL: gadget is bound to an unexpected UDC" >&2
    exit 1
}
# Vendor kernel quirk: a zero-byte write (": >") is treated as a soft
# no-op-ish detach; a newline write performs the full USB disconnect
# that makes the next bind re-create the rndis net devices.
printf '\n' > "$GADGET_ROOT/UDC"
remove_owned_link_if_present f2 "$SERVER_FUNCTION"
remove_owned_link_if_present f3 "$UPLINK_FUNCTION"
if [[ "$created_server_function" == "true" && -d "$GADGET_ROOT/functions/$SERVER_FUNCTION" ]]; then
    verify_owned_function "$SERVER_FUNCTION" "$SERVER_HOST_MAC" "$SERVER_DEVICE_MAC" \
        || { echo "FATAL: server function identity changed" >&2; exit 1; }
    rmdir "$GADGET_ROOT/functions/$SERVER_FUNCTION"
fi
if [[ "$created_uplink_function" == "true" && -d "$GADGET_ROOT/functions/$UPLINK_FUNCTION" ]]; then
    verify_owned_function "$UPLINK_FUNCTION" "$UPLINK_HOST_MAC" "$UPLINK_DEVICE_MAC" \
        || { echo "FATAL: uplink function identity changed" >&2; exit 1; }
    rmdir "$GADGET_ROOT/functions/$UPLINK_FUNCTION"
fi
if ! printf '%s\n' "$original_udc" > "$GADGET_ROOT/UDC" 2>/dev/null; then
    # The vendor kernel may auto-rebind the gadget first; wait for it.
    rebind_attempt=0
    while (( rebind_attempt < 15 )); do
        if [[ -n "$(cat "$GADGET_ROOT/UDC" 2>/dev/null)" ]]; then
            break
        fi
        sleep 1
        rebind_attempt=$((rebind_attempt + 1))
    done
    [[ -n "$(cat "$GADGET_ROOT/UDC" 2>/dev/null)" ]] || {
        echo "FATAL: gadget did not re-bind after teardown" >&2
        exit 1
    }
fi
wait_for_management || { echo "FATAL: usb0 management did not recover" >&2; exit 1; }
MANAGEMENT_REBOUND=true

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
systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
echo "Cat2 USB RNDIS teardown complete; usb0 management verified"
