#!/bin/bash
# Safely add two experiment RNDIS functions without adopting existing objects.
set -Eeuo pipefail

[[ $(id -u) == 0 || "${AG_USB_TEST_MODE:-0}" == "1" ]] || {
    echo "FATAL: cat2-setup.sh must run as root" >&2
    exit 2
}

SCRIPT_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
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
BACKUP_ROOT=$STATE_DIRECTORY/backups
AUTO_ROLLBACK_MINUTES=${AG_AUTO_ROLLBACK_MINUTES:-15}
ROLLBACK_UNIT=aetherguard-cat2-usb-auto-rollback

CREATED_SERVER_FUNCTION=false
CREATED_UPLINK_FUNCTION=false
CREATED_SERVER_LINK=false
CREATED_UPLINK_LINK=false
CREATED_BRIDGE=false
UDC_WAS_UNBOUND=false
ORIGINAL_UDC=
SETUP_COMMITTED=false
TRANSACTION_STARTED=false

management_function_is_linked() {
    local config_link linked_function management_link_count=0
    for config_link in "$GADGET_ROOT/configs/$GADGET_CONFIG"/*; do
        [[ -L "$config_link" ]] || continue
        linked_function=$(basename "$(readlink -f "$config_link")")
        [[ "$linked_function" == "$MANAGEMENT_FUNCTION" ]] \
            && management_link_count=$((management_link_count + 1))
    done
    [[ "$management_link_count" == 1 ]]
}

verify_management_invariants() {
    local interface_mac function_mac expected_address expected_prefix observed_address
    [[ -d "$GADGET_ROOT/functions/$MANAGEMENT_FUNCTION" ]] || return 1
    management_function_is_linked || return 1
    [[ -d "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE" ]] || return 1
    [[ ! -d "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE/brport" ]] || return 1
    interface_mac=$(tr 'A-F' 'a-f' < "$SYS_CLASS_NET/$MANAGEMENT_INTERFACE/address")
    function_mac=$(tr 'A-F' 'a-f' < "$GADGET_ROOT/functions/$MANAGEMENT_FUNCTION/dev_addr")
    [[ "$interface_mac" == "$function_mac" ]] || return 1
    expected_address=${MANAGEMENT_ADDRESS%/*}
    expected_prefix=${MANAGEMENT_ADDRESS#*/}
    observed_address=$(ip -o address show dev "$MANAGEMENT_INTERFACE" 2>/dev/null \
        | awk '{print $4}' | awk -F/ -v address="$expected_address" -v prefix="$expected_prefix" \
            '$1 == address && $2 == prefix {print $0}')
    [[ "$observed_address" == "$MANAGEMENT_ADDRESS" ]]
}

interface_has_expected_mac() {
    local interface_name=$1 expected_mac=$2
    [[ -r "$SYS_CLASS_NET/$interface_name/address" ]] || return 1
    [[ "$(tr 'A-F' 'a-f' < "$SYS_CLASS_NET/$interface_name/address")" == "$expected_mac" ]]
}

port_is_attached_to_bridge() {
    local interface_name=$1 bridge_name=$2
    [[ -e "$SYS_CLASS_NET/$interface_name/master" || -L "$SYS_CLASS_NET/$interface_name/master" ]] || return 1
    [[ "$(readlink -f "$SYS_CLASS_NET/$interface_name/master")" == "$(readlink -f "$SYS_CLASS_NET/$bridge_name")" ]]
}

bridge_has_exact_active_members() {
    local interface_path interface_name member_count=0
    for interface_path in "$SYS_CLASS_NET"/*; do
        [[ -d "$interface_path" ]] || continue
        interface_name=${interface_path##*/}
        if port_is_attached_to_bridge "$interface_name" "$BRIDGE_INTERFACE"; then
            [[ "$interface_name" == "$UPLINK_INTERFACE" ]] || return 1
            member_count=$((member_count + 1))
        fi
    done
    [[ "$member_count" == 1 ]]
}

verify_active_topology() {
    verify_management_invariants \
        && [[ -d "$GADGET_ROOT/functions/$SERVER_FUNCTION" ]] \
        && [[ -d "$GADGET_ROOT/functions/$UPLINK_FUNCTION" ]] \
        && [[ "$(<"$GADGET_ROOT/functions/$SERVER_FUNCTION/host_addr")" == "$SERVER_HOST_MAC" ]] \
        && [[ "$(<"$GADGET_ROOT/functions/$SERVER_FUNCTION/dev_addr")" == "$SERVER_DEVICE_MAC" ]] \
        && [[ "$(<"$GADGET_ROOT/functions/$UPLINK_FUNCTION/host_addr")" == "$UPLINK_HOST_MAC" ]] \
        && [[ "$(<"$GADGET_ROOT/functions/$UPLINK_FUNCTION/dev_addr")" == "$UPLINK_DEVICE_MAC" ]] \
        && [[ "$(readlink -f "$GADGET_ROOT/configs/$GADGET_CONFIG/f2")" == "$(readlink -f "$GADGET_ROOT/functions/$SERVER_FUNCTION")" ]] \
        && [[ "$(readlink -f "$GADGET_ROOT/configs/$GADGET_CONFIG/f3")" == "$(readlink -f "$GADGET_ROOT/functions/$UPLINK_FUNCTION")" ]] \
        && interface_has_expected_mac "$SERVER_INTERFACE" "$SERVER_DEVICE_MAC" \
        && interface_has_expected_mac "$UPLINK_INTERFACE" "$UPLINK_DEVICE_MAC" \
        && ip -d link show dev "$BRIDGE_INTERFACE" 2>/dev/null | awk '/bridge/ {found=1} END {exit !found}' \
        && [[ ! -d "$SYS_CLASS_NET/$SERVER_INTERFACE/brport" ]] \
        && bridge_has_exact_active_members
}

wait_for_interface() {
    local interface_name=$1 attempt_number
    for attempt_number in $(seq 1 30); do
        [[ -d "$SYS_CLASS_NET/$interface_name" ]] && return 0
        sleep 1
    done
    return 1
}

write_state() {
    local state_phase=$1
    python3 - "$STATE_FILE" "$state_phase" "$GADGET_ROOT" "$GADGET_CONFIG" \
        "$MANAGEMENT_FUNCTION" "$MANAGEMENT_INTERFACE" "$MANAGEMENT_ADDRESS" "$ORIGINAL_UDC" \
        "$CREATED_SERVER_FUNCTION" "$CREATED_UPLINK_FUNCTION" "$CREATED_SERVER_LINK" \
        "$CREATED_UPLINK_LINK" "$CREATED_BRIDGE" "$UDC_WAS_UNBOUND" "$BRIDGE_INTERFACE" <<'PYEOF'
import os
import sys
import tempfile

(state_path, phase, gadget_root, gadget_config, management_function,
 management_interface, management_address, original_udc, created_server_function,
 created_uplink_function, created_server_link, created_uplink_link, created_bridge,
 udc_was_unbound, bridge_interface) = sys.argv[1:16]
state_directory = os.path.dirname(state_path)
file_descriptor, temporary_path = tempfile.mkstemp(prefix=".cat2-state.", dir=state_directory)
try:
    os.fchmod(file_descriptor, 0o600)
    values = (
        ("phase", phase),
        ("gadgetRoot", gadget_root),
        ("gadgetConfig", gadget_config),
        ("managementFunction", management_function),
        ("managementInterface", management_interface),
        ("managementAddress", management_address),
        ("originalUdc", original_udc),
        ("createdServerFunction", created_server_function),
        ("createdUplinkFunction", created_uplink_function),
        ("createdServerLink", created_server_link),
        ("createdUplinkLink", created_uplink_link),
        ("createdBridge", created_bridge),
        ("udcWasUnbound", udc_was_unbound),
        ("bridgeInterface", bridge_interface),
    )
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

arm_rollback_watchdog() {
    [[ "$AUTO_ROLLBACK_MINUTES" =~ ^[1-9][0-9]*$ ]] || return 1
    systemd-run --unit="$ROLLBACK_UNIT" --on-active="${AUTO_ROLLBACK_MINUTES}m" --collect \
        env AG_USB_GADGET_ROOT="$GADGET_ROOT" AG_USB_GADGET_CONFIG="$GADGET_CONFIG" \
        AG_MANAGEMENT_FUNCTION="$MANAGEMENT_FUNCTION" AG_MANAGEMENT_IF="$MANAGEMENT_INTERFACE" \
        AG_MANAGEMENT_ADDRESS="$MANAGEMENT_ADDRESS" AG_SERVER_IF="$SERVER_INTERFACE" \
        AG_UPLINK_IF="$UPLINK_INTERFACE" AG_BRIDGE_IF="$BRIDGE_INTERFACE" \
        AG_USB_STATE_DIRECTORY="$STATE_DIRECTORY" "$SCRIPT_DIRECTORY/cat2-teardown.sh" >/dev/null
}

rollback_setup() {
    local original_exit_code=$1 rollback_failed=0
    trap - EXIT HUP INT TERM
    [[ "$TRANSACTION_STARTED" == "true" && "$SETUP_COMMITTED" != "true" ]] || exit "$original_exit_code"
    set +e
    echo "ROLLBACK: reverting the recorded Cat2 USB transaction" >&2
    if interface_has_expected_mac "$SERVER_INTERFACE" "$SERVER_DEVICE_MAC"; then
        ip link set dev "$SERVER_INTERFACE" nomaster 2>/dev/null || rollback_failed=1
    fi
    if [[ "$CREATED_BRIDGE" == "true" ]] && ip link show dev "$BRIDGE_INTERFACE" >/dev/null 2>&1; then
        ip link delete dev "$BRIDGE_INTERFACE" type bridge || rollback_failed=1
    fi
    if [[ "$UDC_WAS_UNBOUND" == "true" || "$CREATED_SERVER_LINK" == "true" || "$CREATED_UPLINK_LINK" == "true" ]]; then
        # Vendor kernel quirk: a zero-byte write (": >") is treated as a soft
        # no-op-ish detach; a newline write performs the full USB disconnect
        # that makes the next bind re-create the rndis net devices.
        printf '\n' > "$GADGET_ROOT/UDC" || rollback_failed=1
        UDC_WAS_UNBOUND=true
    fi
    [[ "$CREATED_SERVER_LINK" != "true" || ! -e "$GADGET_ROOT/configs/$GADGET_CONFIG/f2" ]] \
        || rm -f "$GADGET_ROOT/configs/$GADGET_CONFIG/f2" || rollback_failed=1
    [[ "$CREATED_UPLINK_LINK" != "true" || ! -e "$GADGET_ROOT/configs/$GADGET_CONFIG/f3" ]] \
        || rm -f "$GADGET_ROOT/configs/$GADGET_CONFIG/f3" || rollback_failed=1
    [[ "$CREATED_SERVER_FUNCTION" != "true" || ! -d "$GADGET_ROOT/functions/$SERVER_FUNCTION" ]] \
        || rmdir "$GADGET_ROOT/functions/$SERVER_FUNCTION" || rollback_failed=1
    [[ "$CREATED_UPLINK_FUNCTION" != "true" || ! -d "$GADGET_ROOT/functions/$UPLINK_FUNCTION" ]] \
        || rmdir "$GADGET_ROOT/functions/$UPLINK_FUNCTION" || rollback_failed=1
    if [[ -n "$ORIGINAL_UDC" ]]; then
        if ! printf '%s\n' "$ORIGINAL_UDC" > "$GADGET_ROOT/UDC" 2>/dev/null; then
            # The vendor kernel may auto-rebind the gadget first; wait for it.
            rebound=false
            for rebind_attempt in $(seq 1 15); do
                if [[ -n "$(cat "$GADGET_ROOT/UDC" 2>/dev/null)" ]]; then
                    rebound=true
                    break
                fi
                sleep 1
            done
            [[ "$rebound" == "true" ]] || rollback_failed=1
        fi
        UDC_WAS_UNBOUND=false
    fi
    if (( rollback_failed == 0 )) && verify_management_invariants; then
        rm -f "$STATE_FILE"
        systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
    else
        write_state recovery-required 2>/dev/null || true
        original_exit_code=1
    fi
    exit "$original_exit_code"
}

handle_setup_signal() {
    local signal_exit_code=$1
    exit "$signal_exit_code"
}

maybe_inject_usb_test_failure() {
    local failpoint_name=$1
    [[ "${AG_USB_TEST_FAILPOINT:-}" == "$failpoint_name" ]] || return 0
    [[ "${AG_USB_TEST_MODE:-0}" == "1" ]] || return 1
    echo "INJECTED_USB_TEST_FAILURE failpoint=$failpoint_name" >&2
    return 97
}

mkdir -p "$STATE_DIRECTORY" "$BACKUP_ROOT"
chmod 0700 "$STATE_DIRECTORY" "$BACKUP_ROOT"
touch "$LOCK_FILE"
chmod 0600 "$LOCK_FILE"
exec 9>"$LOCK_FILE"
flock -x 9

[[ -d "$GADGET_ROOT/configs/$GADGET_CONFIG" ]] || { echo "FATAL: gadget config missing" >&2; exit 2; }
if [[ -e "$STATE_FILE" ]]; then
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { echo "FATAL: owned state is not a regular file" >&2; exit 1; }
    if awk -F= '$1 == "phase" && $2 == "active" {found=1} END {exit !found}' "$STATE_FILE"; then
        verify_active_topology || { echo "FATAL: active state does not match the complete topology" >&2; exit 1; }
        echo "Cat2 USB RNDIS topology is already active and fully verified"
        exit 0
    fi
    echo "FATAL: incomplete owned state exists; run cat2-teardown.sh to recover" >&2
    exit 1
fi

# All checks above and below this point are read-only. A failure cannot unbind
# the gadget or detach any interface because the transaction trap is not armed.
verify_management_invariants || { echo "FATAL: management invariant failed before setup" >&2; exit 1; }
ORIGINAL_UDC=$(tr -d '\n' < "$GADGET_ROOT/UDC")
[[ "$ORIGINAL_UDC" =~ ^[A-Za-z0-9_.:-]+$ ]] || { echo "FATAL: gadget is not bound to one safe UDC" >&2; exit 1; }
for unowned_path in \
    "$GADGET_ROOT/configs/$GADGET_CONFIG/f2" \
    "$GADGET_ROOT/configs/$GADGET_CONFIG/f3" \
    "$GADGET_ROOT/functions/$SERVER_FUNCTION" \
    "$GADGET_ROOT/functions/$UPLINK_FUNCTION" \
    "$SYS_CLASS_NET/$SERVER_INTERFACE" \
    "$SYS_CLASS_NET/$UPLINK_INTERFACE" \
    "$SYS_CLASS_NET/$BRIDGE_INTERFACE"; do
    [[ ! -e "$unowned_path" ]] || { echo "FATAL: refusing to adopt pre-existing object $unowned_path" >&2; exit 1; }
done

backup_directory=$(mktemp -d "$BACKUP_ROOT/baseline.XXXXXXXX")
chmod 0700 "$backup_directory"
ip -details link show > "$backup_directory/ip-link.txt"
ip address show > "$backup_directory/ip-address.txt"
for config_link in "$GADGET_ROOT/configs/$GADGET_CONFIG"/*; do
    [[ -L "$config_link" ]] || continue
    printf '%s -> %s\n' "$config_link" "$(readlink "$config_link")"
done > "$backup_directory/config-links.txt"

write_state prepared
arm_rollback_watchdog
TRANSACTION_STARTED=true
trap 'rollback_setup $?' EXIT
trap 'handle_setup_signal 129' HUP
trap 'handle_setup_signal 130' INT
trap 'handle_setup_signal 143' TERM

# Create the experiment functions and config links BEFORE unbinding the UDC.
# This mirrors the sequence proven on the real Cat2 (kernel 4.19 vendor
# DWC3): functions created while the gadget is still bound survive the
# unbind/rebind cycle; creating them after unbind makes the rebind fail
# with EBUSY ("Device or resource busy").
CREATED_SERVER_FUNCTION=true
write_state prepared
mkdir "$GADGET_ROOT/functions/$SERVER_FUNCTION"
printf '%s\n' "$SERVER_HOST_MAC" > "$GADGET_ROOT/functions/$SERVER_FUNCTION/host_addr"
printf '%s\n' "$SERVER_DEVICE_MAC" > "$GADGET_ROOT/functions/$SERVER_FUNCTION/dev_addr"

CREATED_UPLINK_FUNCTION=true
write_state prepared
mkdir "$GADGET_ROOT/functions/$UPLINK_FUNCTION"
printf '%s\n' "$UPLINK_HOST_MAC" > "$GADGET_ROOT/functions/$UPLINK_FUNCTION/host_addr"
printf '%s\n' "$UPLINK_DEVICE_MAC" > "$GADGET_ROOT/functions/$UPLINK_FUNCTION/dev_addr"

CREATED_SERVER_LINK=true
write_state prepared
ln -s "$GADGET_ROOT/functions/$SERVER_FUNCTION" "$GADGET_ROOT/configs/$GADGET_CONFIG/f2"
CREATED_UPLINK_LINK=true
write_state prepared
ln -s "$GADGET_ROOT/functions/$UPLINK_FUNCTION" "$GADGET_ROOT/configs/$GADGET_CONFIG/f3"

UDC_WAS_UNBOUND=true
write_state prepared
printf '\n' > "$GADGET_ROOT/UDC"
maybe_inject_usb_test_failure after_udc_unbind

# The vendor kernel (4.19 DWC3) auto-rebinds the gadget ~1-2s after unbind.
# A manual rebind write races that automatic re-bind and fails with EBUSY
# ("Device or resource busy"), so poll for the automatic re-bind instead;
# an explicit rebind is only a bounded fallback.
rebound=false
sleep 2
for rebind_attempt in $(seq 1 30); do
    if [[ -n "$(cat "$GADGET_ROOT/UDC" 2>/dev/null)" ]]; then
        rebound=true
        break
    fi
    sleep 1
done
if [[ "$rebound" != "true" ]]; then
    printf '%s\n' "$ORIGINAL_UDC" > "$GADGET_ROOT/UDC" 2>/dev/null || true
    sleep 2
fi
UDC_WAS_UNBOUND=false
write_state prepared
wait_for_interface "$MANAGEMENT_INTERFACE" || { echo "FATAL: management interface did not return" >&2; exit 1; }
wait_for_interface "$SERVER_INTERFACE" || { echo "FATAL: server interface did not appear" >&2; exit 1; }
wait_for_interface "$UPLINK_INTERFACE" || { echo "FATAL: uplink interface did not appear" >&2; exit 1; }
verify_management_invariants || { echo "FATAL: management invariant failed after gadget rebind" >&2; exit 1; }
interface_has_expected_mac "$SERVER_INTERFACE" "$SERVER_DEVICE_MAC" || exit 1
interface_has_expected_mac "$UPLINK_INTERFACE" "$UPLINK_DEVICE_MAC" || exit 1

CREATED_BRIDGE=true
write_state prepared
ip link add "$BRIDGE_INTERFACE" type bridge
ip link set "$BRIDGE_INTERFACE" type bridge stp_state 0
ip link set dev "$BRIDGE_INTERFACE" up
ip link set dev "$SERVER_INTERFACE" up
ip link set dev "$UPLINK_INTERFACE" up
ip link set dev "$UPLINK_INTERFACE" master "$BRIDGE_INTERFACE"

verify_active_topology || { echo "FATAL: completed topology failed exact verification" >&2; exit 1; }
write_state active
SETUP_COMMITTED=true
echo "Cat2 USB RNDIS setup complete; usb0 verified; server isolated; watchdog armed"
