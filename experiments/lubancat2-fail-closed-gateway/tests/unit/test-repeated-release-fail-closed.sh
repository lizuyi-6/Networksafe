#!/bin/bash
# Regression: replacing a released lease must close the gate if timer registration fails.
#
# The hardened gateway enforces an exact bridge topology before release:
# the configured UPLINK_IF must already be the sole bridge member while the
# gate is closed, and only SERVER_IF may join it when the gate opens. The fake
# environment below models that contract: usb2 is the persistent uplink bridge
# member, usb1 is the data-plane gate, and usb0 carries management.
set -Eeuo pipefail

EXPERIMENT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GATEWAY_SOURCE="$EXPERIMENT_ROOT/cat2/scripts/ag-cat2-gateway"
TEST_ROOT=$(mktemp -d)

cleanup() {
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT INT TERM

SYS_CLASS_NET="$TEST_ROOT/sys/class/net"
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/state" "$TEST_ROOT/timers"
mkdir -p "$SYS_CLASS_NET/usb0" "$SYS_CLASS_NET/usb1" "$SYS_CLASS_NET/br0"

cat > "$TEST_ROOT/config" <<'EOF'
SERVER_IF=usb1
UPLINK_IF=usb2
BRIDGE_IF=br0
DEFAULT_RELEASE_SECONDS=60
MAX_RELEASE_SECONDS=600
AG_ALLOW_TEST_FAILPOINTS=1
EOF

# usb2 is the persistent uplink bridge member. It is created up-front and only
# the SERVER_IF toggles on and off the bridge.
mkdir -p "$SYS_CLASS_NET/usb2/brport"
ln -sfn "$SYS_CLASS_NET/br0" "$SYS_CLASS_NET/usb2/master"

enslave_server() {
    mkdir -p "$SYS_CLASS_NET/usb1/brport"
    ln -sfn "$SYS_CLASS_NET/br0" "$SYS_CLASS_NET/usb1/master"
}

free_server() {
    rm -rf "$SYS_CLASS_NET/usb1/brport" "$SYS_CLASS_NET/usb1/master"
}

cat > "$TEST_ROOT/bin/ip" <<EOF
#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=\${AG_TEST_ROOT:?}
SYS_CLASS_NET="\$TEST_ROOT/sys/class/net"

if [[ "\$*" == "link show dev br0" || "\$*" == "-details link show" ]]; then
    [[ -d "\$SYS_CLASS_NET/br0" ]]
    exit 0
fi
if [[ "\$*" == "link add br0 type bridge" ]]; then
    mkdir -p "\$SYS_CLASS_NET/br0"
    exit 0
fi
if [[ "\$*" == "link set dev br0 up" || "\$*" == "link set br0 type bridge stp_state 0" ]]; then
    exit 0
fi
if [[ "\$*" == "addr show dev usb0" || "\$*" == "-o address show dev usb0" ]]; then
    printf '1: usb0    inet 192.168.100.2/24 scope global usb0\n'
    exit 0
fi
if [[ "\$*" == "link show dev usb1" ]]; then
    printf '2: usb1: <UP> mtu 1500 state UP\n'
    exit 0
fi
if [[ "\$*" == "link show dev usb2" ]]; then
    printf '3: usb2: <UP> mtu 1500 state UP\n'
    exit 0
fi
if [[ "\$*" == "link set dev usb1 up" || "\$*" == "link set dev usb2 up" ]]; then
    exit 0
fi
if [[ "\$*" == "link set dev usb1 master br0" ]]; then
    mkdir -p "\$SYS_CLASS_NET/usb1/brport"
    ln -sfn "\$SYS_CLASS_NET/br0" "\$SYS_CLASS_NET/usb1/master"
    exit 0
fi
if [[ "\$*" == "link set dev usb2 master br0" ]]; then
    exit 0
fi
if [[ "\$*" == "link set dev usb1 nomaster" ]]; then
    rm -rf "\$SYS_CLASS_NET/usb1/brport" "\$SYS_CLASS_NET/usb1/master"
    exit 0
fi
if [[ "\$*" == "link set dev usb2 nomaster" ]]; then
    exit 0
fi
exit 0
EOF

cat > "$TEST_ROOT/bin/bridge" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
if [[ "$*" == "link show dev usb1" && -d "$TEST_ROOT/sys/class/net/usb1/brport" ]]; then
    printf '2: usb1: <BROADCAST> state forwarding\n'
fi
if [[ "$*" == "link show dev usb2" && -d "$TEST_ROOT/sys/class/net/usb2/brport" ]]; then
    printf '3: usb2: <BROADCAST> state forwarding\n'
fi
EOF

cat > "$TEST_ROOT/bin/systemd-run" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
if [[ -e "$TEST_ROOT/fail-systemd-run" ]]; then
    exit 1
fi
for argument in "$@"; do
    case "$argument" in
        --unit=*)
            lease_unit=${argument#--unit=}
            : > "$TEST_ROOT/timers/${lease_unit}.timer"
            exit 0
            ;;
    esac
done
exit 2
EOF

cat > "$TEST_ROOT/bin/systemctl" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
command_name=${1:-}
shift || true
case "$command_name" in
    list-units)
        for timer_path in "$TEST_ROOT"/timers/*.timer; do
            [[ -e "$timer_path" ]] || continue
            printf '%s loaded active waiting test\n' "$(basename "$timer_path")"
        done
        ;;
    list-timers)
        requested_unit=${*: -1}
        requested_unit=${requested_unit%.timer}
        if [[ -e "$TEST_ROOT/timers/${requested_unit}.timer" ]]; then
            printf 'n/a n/a n/a n/a %s.timer %s.service\n' "$requested_unit" "$requested_unit"
        fi
        ;;
    is-active)
        [[ ${1:-} == --quiet ]] && shift
        [[ -e "$TEST_ROOT/timers/${1}" ]]
        ;;
    stop)
        for unit_name in "$@"; do
            rm -f "$TEST_ROOT/timers/$unit_name"
        done
        ;;
    reset-failed)
        exit 0
        ;;
esac
EOF

cat > "$TEST_ROOT/bin/logger" <<'EOF'
#!/bin/bash
exit 0
EOF

chmod +x "$TEST_ROOT/bin/"*

# The old vulnerable script did not have test adapters. Adapt only its temporary copy
# so this test can demonstrate the defect without touching the host network.
GATEWAY_UNDER_TEST="$GATEWAY_SOURCE"
if ! rg -q 'AG_GATEWAY_CONFIG' "$GATEWAY_SOURCE"; then
    GATEWAY_UNDER_TEST="$TEST_ROOT/ag-cat2-gateway-old"
    sed \
        -e 's|^PATH=.*|PATH="$AG_TEST_ROOT/bin:/usr/bin:/bin"|' \
        -e 's|^CONF=/etc/aetherguard-cat2.conf$|CONF="$AG_TEST_ROOT/config"|' \
        -e 's|^STATE_DIR=/run/aetherguard-cat2$|STATE_DIR="$AG_TEST_ROOT/state"|' \
        -e 's|/sys/class/net/|$AG_TEST_ROOT/sys/class/net/|g' \
        "$GATEWAY_SOURCE" > "$GATEWAY_UNDER_TEST"
    chmod +x "$GATEWAY_UNDER_TEST"
fi

run_gateway() {
    AG_TEST_MODE=1 \
    AG_TEST_ROOT="$TEST_ROOT" \
    AG_TEST_COMMAND_PATH="$TEST_ROOT/bin" \
    AG_GATEWAY_CONFIG="$TEST_ROOT/config" \
    AG_STATE_DIR="$TEST_ROOT/state" \
    AG_SYS_CLASS_NET="$TEST_ROOT/sys/class/net" \
        "$GATEWAY_UNDER_TEST" "$@"
}

run_gateway isolate >/dev/null
run_gateway release 30 >/dev/null

[[ -d "$SYS_CLASS_NET/usb1/brport" ]] || {
    echo "FAIL reason=INITIAL_RELEASE_DID_NOT_OPEN" >&2
    exit 1
}

touch "$TEST_ROOT/fail-systemd-run"
set +e
run_gateway release 60 >/dev/null 2>&1
release_exit_code=$?
set -e

[[ "$release_exit_code" -ne 0 ]] || {
    echo "FAIL reason=REPLACEMENT_REGISTRATION_FAILURE_RETURNED_ZERO" >&2
    exit 1
}

if [[ -d "$SYS_CLASS_NET/usb1/brport" ]]; then
    timer_count=$(find "$TEST_ROOT/timers" -maxdepth 1 -name '*.timer' -type f | wc -l)
    echo "FAIL reason=OPEN_WITHOUT_VALID_LEASE gate=open activeTimers=$timer_count" >&2
    exit 1
fi

echo "PASS reason=REPEATED_RELEASE_TIMER_REGISTRATION_FAILURE_CLOSED_GATE"
