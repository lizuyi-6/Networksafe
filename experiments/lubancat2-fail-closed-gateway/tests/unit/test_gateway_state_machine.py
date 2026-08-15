#!/usr/bin/env python3
"""Sandboxed state-machine tests for ag-cat2-gateway."""

import hashlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GATEWAY_SCRIPT = os.path.join(EXPERIMENT_ROOT, "cat2", "scripts", "ag-cat2-gateway")


class GatewayStateMachineTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.bin_directory = os.path.join(self.test_root, "bin")
        self.state_directory = os.path.join(self.test_root, "state")
        self.sys_class_net = os.path.join(self.test_root, "sys", "class", "net")
        self.timer_directory = os.path.join(self.test_root, "timers")
        self.config_path = os.path.join(self.test_root, "gateway.conf")
        os.makedirs(self.bin_directory)
        os.makedirs(self.state_directory)
        os.makedirs(self.timer_directory)
        for interface_name in ("usb0", "usb1", "usb2", "br0"):
            os.makedirs(os.path.join(self.sys_class_net, interface_name))
        self.attach_interface_to_bridge("usb2")
        self.write_config()
        self.write_fake_commands()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_config(self, additional_lines=None):
        config_lines = [
            "SERVER_IF=usb1",
            "UPLINK_IF=usb2",
            "BRIDGE_IF=br0",
            "DEFAULT_RELEASE_SECONDS=60",
            "MAX_RELEASE_SECONDS=600",
            "AG_MANAGEMENT_IF=usb0",
            "AG_MANAGEMENT_ADDRESS=192.168.100.2/24",
            "AG_ALLOW_TEST_FAILPOINTS=1",
        ]
        if additional_lines:
            config_lines.extend(additional_lines)
        with open(self.config_path, "w", encoding="ascii") as config_file:
            config_file.write("\n".join(config_lines) + "\n")

    def write_executable(self, command_name, command_source):
        command_path = os.path.join(self.bin_directory, command_name)
        with open(command_path, "w", encoding="utf-8") as command_file:
            command_file.write(command_source)
        os.chmod(command_path, 0o755)

    def write_fake_commands(self):
        self.write_executable(
            "ip",
            r'''#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
SYS_CLASS_NET="$TEST_ROOT/sys/class/net"

if [[ "$*" == "link show dev br0" ]]; then
    [[ -d "$SYS_CLASS_NET/br0" ]]
    exit
fi
if [[ "$1" == "link" && "$2" == "show" && "$3" == "dev" && "$#" == "4" ]]; then
    [[ -d "$SYS_CLASS_NET/$4" ]]
    exit
fi
if [[ "$*" == "link add br0 type bridge" ]]; then
    mkdir -p "$SYS_CLASS_NET/br0"
    exit 0
fi
if [[ "$1" == "link" && "$2" == "add" && "$4" == "type" && "$5" == "bridge" && "$#" == "5" ]]; then
    mkdir -p "$SYS_CLASS_NET/$3"
    exit 0
fi
if [[ "$*" == "addr show dev usb0" || "$*" == "-o address show dev usb0" ]]; then
    printf '1: usb0 inet 192.168.100.2/24 scope global usb0\n'
    exit 0
fi
if [[ "$*" == "link show dev usb1" ]]; then
    printf '2: usb1: <UP> mtu 1500 state UP\n'
    exit 0
fi
if [[ "$*" == "link set dev br0 up" || "$*" == "link set br0 type bridge stp_state 0" || "$*" == "link set dev usb1 up" ]]; then
    exit 0
fi
if [[ "$1" == "link" && "$2" == "set" && "$3" == "dev" && "$5" == "up" && "$#" == "5" ]]; then
    exit 0
fi
if [[ "$1" == "link" && "$2" == "set" && "$4" == "type" && "$5" == "bridge" && "$6" == "stp_state" && "$#" == "7" ]]; then
    exit 0
fi
if [[ "$*" == "link set dev usb1 master br0" ]]; then
    [[ ! -e "$TEST_ROOT/fail-gate-open" ]] || exit 1
    mkdir -p "$SYS_CLASS_NET/usb1/brport"
    ln -sfn "$SYS_CLASS_NET/br0" "$SYS_CLASS_NET/usb1/master"
    exit 0
fi
if [[ "$*" == "link set dev usb1 nomaster" ]]; then
    [[ ! -e "$TEST_ROOT/fail-gate-close" ]] || exit 1
    rm -rf "$SYS_CLASS_NET/usb1/brport" "$SYS_CLASS_NET/usb1/master"
    exit 0
fi
if [[ "$*" == "link set dev usb3 nomaster" ]]; then
    rm -rf "$SYS_CLASS_NET/usb3/brport" "$SYS_CLASS_NET/usb3/master"
    exit 0
fi
if [[ "$*" == link*dev*nomaster ]]; then
    member_interface=$(echo "$*" | sed -n 's/^link set dev \([^ ]*\) nomaster$/\1/p')
    if [[ -n "$member_interface" ]]; then
        rm -rf "$SYS_CLASS_NET/$member_interface/brport" "$SYS_CLASS_NET/$member_interface/master"
        exit 0
    fi
fi
if [[ "$*" == "-br link" || "$*" == "-br addr" || "$*" == "route" ]]; then
    exit 0
fi
exit 0
''',
        )
        self.write_executable(
            "bridge",
            r'''#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
if [[ "$*" == "link show dev usb1" && -d "$TEST_ROOT/sys/class/net/usb1/brport" ]]; then
    printf '2: usb1: <BROADCAST> state forwarding\n'
fi
exit 0
''',
        )
        self.write_executable(
            "systemd-run",
            r'''#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
printf '%s\n' "$*" > "$TEST_ROOT/systemd-run-arguments"
if [[ -e "$TEST_ROOT/systemd-run-delay" ]]; then
    sleep "$(cat "$TEST_ROOT/systemd-run-delay")"
fi
[[ ! -e "$TEST_ROOT/fail-systemd-run" ]] || exit 1
for argument in "$@"; do
    case "$argument" in
        --unit=*)
            timer_unit=${argument#--unit=}
            printf 'active\n' > "$TEST_ROOT/timers/${timer_unit}.timer"
            exit 0
            ;;
    esac
done
exit 2
''',
        )
        self.write_executable(
            "systemctl",
            r'''#!/bin/bash
set -Eeuo pipefail
TEST_ROOT=${AG_TEST_ROOT:?}
command_name=${1:-}
shift || true
case "$command_name" in
    list-units)
        active_only=false
        for argument in "$@"; do
            [[ "$argument" == "--state=active" ]] && active_only=true
        done
        for timer_path in "$TEST_ROOT"/timers/*.timer; do
            [[ -e "$timer_path" ]] || continue
            timer_state=$(cat "$timer_path")
            if [[ "$active_only" == "true" && "$timer_state" != "active" ]]; then
                continue
            fi
            printf '%s loaded %s waiting test\n' "$(basename "$timer_path")" "$timer_state"
        done
        ;;
    list-timers)
        for timer_path in "$TEST_ROOT"/timers/*.timer; do
            [[ -e "$timer_path" ]] || continue
            printf 'n/a n/a n/a n/a %s test.service\n' "$(basename "$timer_path")"
        done
        ;;
    is-active)
        [[ ${1:-} == --quiet ]] && shift
        [[ -e "$TEST_ROOT/timers/${1}" ]] && [[ $(cat "$TEST_ROOT/timers/${1}") == active ]]
        ;;
    stop)
        for unit_name in "$@"; do
            rm -f "$TEST_ROOT/timers/$unit_name"
        done
        ;;
    reset-failed)
        exit 0
        ;;
    status)
        exit 0
        ;;
esac
''',
        )
        self.write_executable("logger", "#!/bin/bash\nexit 0\n")
        self.write_executable("journalctl", "#!/bin/bash\nexit 0\n")

    def gateway_environment(self, **overrides):
        environment = os.environ.copy()
        environment.update(
            {
                "AG_TEST_MODE": "1",
                "AG_TEST_ROOT": self.test_root,
                "AG_TEST_COMMAND_PATH": self.bin_directory,
                "AG_GATEWAY_CONFIG": self.config_path,
                "AG_STATE_DIR": self.state_directory,
                "AG_SYS_CLASS_NET": self.sys_class_net,
                "AG_GATEWAY_EXECUTABLE": GATEWAY_SCRIPT,
            }
        )
        environment.update(overrides)
        return environment

    def run_gateway(self, *arguments, check=False, **environment_overrides):
        return subprocess.run(
            [GATEWAY_SCRIPT] + list(arguments),
            env=self.gateway_environment(**environment_overrides),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
        )

    def start_gateway(self, *arguments, **environment_overrides):
        return subprocess.Popen(
            [GATEWAY_SCRIPT] + list(arguments),
            env=self.gateway_environment(**environment_overrides),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def attach_interface_to_bridge(self, interface_name):
        interface_path = os.path.join(self.sys_class_net, interface_name)
        bridge_path = os.path.join(self.sys_class_net, "br0")
        os.makedirs(os.path.join(interface_path, "brport"), exist_ok=True)
        master_path = os.path.join(interface_path, "master")
        if os.path.lexists(master_path):
            os.unlink(master_path)
        os.symlink(bridge_path, master_path)

    def detach_server_interface(self):
        shutil.rmtree(os.path.join(self.sys_class_net, "usb1", "brport"), ignore_errors=True)
        master_path = os.path.join(self.sys_class_net, "usb1", "master")
        if os.path.lexists(master_path):
            os.unlink(master_path)

    def gate_is_open(self):
        return os.path.isdir(os.path.join(self.sys_class_net, "usb1", "brport"))

    def active_timer_paths(self):
        return sorted(
            os.path.join(self.timer_directory, file_name)
            for file_name in os.listdir(self.timer_directory)
            if file_name.endswith(".timer")
        )

    def read_lease_state(self):
        state_path = os.path.join(self.state_directory, "active-lease")
        state = {}
        with open(state_path, "r", encoding="ascii") as state_file:
            for state_line in state_file:
                state_key, state_value = state_line.rstrip("\n").split("=", 1)
                state[state_key] = state_value
        return state

    def read_status(self):
        status_process = self.run_gateway("status", check=True)
        return json.loads(status_process.stdout)

    def assert_isolated_without_lease(self):
        self.assertFalse(self.gate_is_open())
        self.assertEqual(self.active_timer_paths(), [])
        self.assertFalse(os.path.exists(os.path.join(self.state_directory, "active-lease")))

    def owned_topology_path(self):
        return os.path.join(self.state_directory, "owned-topology")

    def read_owned_topology(self):
        topology = {}
        topology_path = self.owned_topology_path()
        with open(topology_path, "r", encoding="ascii") as topology_file:
            for topology_line in topology_file:
                topology_key, topology_value = topology_line.rstrip("\n").split("=", 1)
                topology[topology_key] = topology_value
        return topology

    def bridge_member_is_attached(self, interface_name):
        return os.path.isdir(os.path.join(self.sys_class_net, interface_name, "brport"))

    def assert_exact_closed_topology(self):
        for interface_name in os.listdir(self.sys_class_net):
            master_path = os.path.join(self.sys_class_net, interface_name, "master")
            resolved_master = None
            if os.path.lexists(master_path):
                resolved_master = os.readlink(master_path)
            if resolved_master is not None and resolved_master.endswith("/br0"):
                self.assertEqual(
                    interface_name, "usb2",
                    "only UPLINK_IF may remain in the data bridge, found %s" % interface_name,
                )

    def test_normal_release_commits_one_identified_active_lease(self):
        release_process = self.run_gateway("release", "60")
        self.assertEqual(release_process.returncode, 0, release_process.stderr)
        self.assertTrue(self.gate_is_open())
        lease_state = self.read_lease_state()
        self.assertEqual(lease_state["phase"], "active")
        self.assertEqual(lease_state["timerUnit"], "ag-cat2-lease-" + lease_state["leaseId"])
        self.assertEqual(len(self.active_timer_paths()), 1)
        status = self.read_status()
        self.assertEqual(status["state"], "released")
        self.assertEqual(status["activeLeaseTimerCount"], 1)
        with open(os.path.join(self.test_root, "systemd-run-arguments"), "r", encoding="utf-8") as arguments_file:
            systemd_run_arguments = arguments_file.read()
        self.assertIn("--timer-property=AccuracySec=1us", systemd_run_arguments)
        self.assertIn("--timer-property=WakeSystem=yes", systemd_run_arguments)
        self.assertIn("--property=Restart=on-failure", systemd_run_arguments)
        self.assertIn("--property=RestartSec=1s", systemd_run_arguments)
        self.assertIn("--property=StartLimitIntervalSec=0", systemd_run_arguments)

    def test_authorized_release_is_bound_to_locked_config_snapshot(self):
        with open(self.config_path, "rb") as config_file:
            policy_digest = hashlib.sha256(config_file.read()).hexdigest()
        far_future_expires_at = str(int(time.time()) + 600)
        release_process = self.run_gateway(
            "release-authorized",
            "60",
            far_future_expires_at,
            policy_digest,
            "cat2-gateway-01",
            "usb1",
            "usb2",
        )
        self.assertEqual(release_process.returncode, 0, release_process.stderr)
        self.assertTrue(self.gate_is_open())

        self.assertEqual(self.run_gateway("isolate").returncode, 0)
        with open(self.config_path, "a", encoding="ascii") as config_file:
            config_file.write("# atomic replacement simulation\n")
        rejected_process = self.run_gateway(
            "release-authorized",
            "60",
            far_future_expires_at,
            policy_digest,
            "cat2-gateway-01",
            "usb1",
            "usb2",
        )
        self.assertEqual(rejected_process.returncode, 2)
        self.assert_isolated_without_lease()

    def test_authorized_release_with_expired_expires_at_is_refused_under_lock(self):
        # The gateway must recompute the effective authorization lifetime after
        # it holds the transition lock. An expiresAtEpoch that is already in the
        # past must be refused with the gate isolated, no timer and no lease,
        # even though the requested duration was valid.
        with open(self.config_path, "rb") as config_file:
            policy_digest = hashlib.sha256(config_file.read()).hexdigest()
        past_expires_at = str(int(time.time()) - 1)
        refused_process = self.run_gateway(
            "release-authorized",
            "60",
            past_expires_at,
            policy_digest,
            "cat2-gateway-01",
            "usb1",
            "usb2",
        )
        self.assertNotEqual(refused_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_authorized_release_shrinks_duration_to_expires_at_window(self):
        # When expiresAt is closer than the requested duration, the effective
        # lease lifetime is the smaller window, recomputed under the lock.
        with open(self.config_path, "rb") as config_file:
            policy_digest = hashlib.sha256(config_file.read()).hexdigest()
        short_expires_at = str(int(time.time()) + 5)
        release_process = self.run_gateway(
            "release-authorized",
            "60",
            short_expires_at,
            policy_digest,
            "cat2-gateway-01",
            "usb1",
            "usb2",
        )
        self.assertEqual(release_process.returncode, 0, release_process.stderr)
        self.assertTrue(self.gate_is_open())
        lease_state = self.read_lease_state()
        # The persisted expiry epoch must equal the signed expiresAtEpoch, not
        # now+requestedDuration.
        self.assertEqual(lease_state["expiresAtEpoch"], short_expires_at)
        self.run_gateway("isolate")

    def test_authorized_release_rejects_non_canonical_expires_at(self):
        with open(self.config_path, "rb") as config_file:
            policy_digest = hashlib.sha256(config_file.read()).hexdigest()
        for invalid_expires_at in ("1700000060.0", "-1", "0", "08", "1e3", "true"):
            with self.subTest(invalid_expires_at=invalid_expires_at):
                refused_process = self.run_gateway(
                    "release-authorized",
                    "60",
                    invalid_expires_at,
                    policy_digest,
                    "cat2-gateway-01",
                    "usb1",
                    "usb2",
                )
                self.assertEqual(refused_process.returncode, 2)
                self.assert_isolated_without_lease()

    def test_authorization_expires_while_waiting_for_transition_lock_must_not_open_gate(self):
        # Deterministic lock-synchronization test (no timing race): the test
        # holds the transition lock so the gateway cannot proceed past the
        # dispatch until the lock is released. By then the signed expiresAt is
        # in the past, so the locked re-check must refuse and leave the gate
        # isolated with no timer and no lease.
        import fcntl
        with open(self.config_path, "rb") as config_file:
            policy_digest = hashlib.sha256(config_file.read()).hexdigest()
        lock_path = os.path.join(self.state_directory, "transition.lock")
        with open(lock_path, "w") as lock_holder_file:
            lock_holder_file.write("")
            fcntl.flock(lock_holder_file, fcntl.LOCK_EX)
            near_future_expires_at = str(int(time.time()) + 2)
            gateway_process = self.start_gateway(
                "release-authorized",
                "60",
                near_future_expires_at,
                policy_digest,
                "cat2-gateway-01",
                "usb1",
                "usb2",
            )
            # Wait until the authorization window has elapsed while the gateway
            # is blocked on the lock. Because the gateway holds no lock yet, it
            # cannot open the gate during this interval.
            time.sleep(3)
            self.assertTrue(gateway_process.poll() is None, "gateway must block on the held lock")
            fcntl.flock(lock_holder_file, fcntl.LOCK_UN)
        gateway_process.communicate(timeout=10)
        self.assertNotEqual(gateway_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_release_refuses_missing_uplink_or_unexpected_bridge_member(self):
        uplink_master_path = os.path.join(self.sys_class_net, "usb2", "master")
        os.unlink(uplink_master_path)
        shutil.rmtree(os.path.join(self.sys_class_net, "usb2", "brport"))
        missing_uplink_process = self.run_gateway("release", "60")
        self.assertNotEqual(missing_uplink_process.returncode, 0)
        self.assert_isolated_without_lease()

        self.attach_interface_to_bridge("usb2")
        os.makedirs(os.path.join(self.sys_class_net, "rogue0"))
        self.attach_interface_to_bridge("rogue0")
        rogue_member_process = self.run_gateway("release", "60")
        self.assertNotEqual(rogue_member_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_repeated_release_replaces_lease_with_exactly_one_timer(self):
        self.assertEqual(self.run_gateway("release", "30").returncode, 0)
        first_lease_id = self.read_lease_state()["leaseId"]
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        second_lease_id = self.read_lease_state()["leaseId"]
        self.assertNotEqual(first_lease_id, second_lease_id)
        self.assertEqual(len(self.active_timer_paths()), 1)
        self.assertTrue(self.active_timer_paths()[0].endswith(second_lease_id + ".timer"))

    def test_all_returning_release_failpoints_end_isolated(self):
        failpoints = [
            "after_gate_close",
            "after_old_timer_cancel",
            "timer_register_failure",
            "after_timer_register",
            "timer_visibility_failure",
            "before_gate_open",
            "gate_open_failure",
            "after_gate_open",
        ]
        for failpoint_name in failpoints:
            with self.subTest(failpoint_name=failpoint_name):
                self.assertEqual(self.run_gateway("release", "60").returncode, 0)
                failure_process = self.run_gateway(
                    "release",
                    "60",
                    AG_TEST_FAILPOINT=failpoint_name,
                )
                self.assertNotEqual(failure_process.returncode, 0)
                self.assert_isolated_without_lease()

    def test_real_systemd_run_failure_during_repeated_release_closes_gate(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        open(os.path.join(self.test_root, "fail-systemd-run"), "w").close()
        failure_process = self.run_gateway("release", "60")
        self.assertNotEqual(failure_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_gate_open_failure_cancels_timer_and_clears_state(self):
        open(os.path.join(self.test_root, "fail-gate-open"), "w").close()
        failure_process = self.run_gateway("release", "60")
        self.assertNotEqual(failure_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_repeated_release_close_failure_preserves_existing_lease_bound(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        original_lease_state = self.read_lease_state()
        original_timer_paths = self.active_timer_paths()
        close_failure_path = os.path.join(self.test_root, "fail-gate-close")
        open(close_failure_path, "w").close()
        replacement_process = self.run_gateway("release", "60")
        self.assertNotEqual(replacement_process.returncode, 0)
        self.assertTrue(self.gate_is_open())
        self.assertEqual(self.read_lease_state(), original_lease_state)
        self.assertEqual(self.active_timer_paths(), original_timer_paths)

        isolate_process = self.run_gateway("isolate")
        self.assertNotEqual(isolate_process.returncode, 0)
        self.assertEqual(self.active_timer_paths(), original_timer_paths)
        os.unlink(close_failure_path)
        self.assertEqual(self.run_gateway("isolate").returncode, 0)
        self.assert_isolated_without_lease()

    def test_kill_after_old_timer_cancel_is_already_isolated(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        killed_process = self.run_gateway(
            "release",
            "60",
            AG_TEST_FAILPOINT="after_old_timer_cancel",
            AG_TEST_FAILPOINT_ACTION="kill",
        )
        self.assertEqual(killed_process.returncode, -signal.SIGKILL)
        self.assert_isolated_without_lease()

    def test_kill_after_timer_register_leaves_closed_gate_and_reconcile_cleans_timer(self):
        killed_process = self.run_gateway(
            "release",
            "60",
            AG_TEST_FAILPOINT="after_timer_register",
            AG_TEST_FAILPOINT_ACTION="kill",
        )
        self.assertEqual(killed_process.returncode, -signal.SIGKILL)
        self.assertFalse(self.gate_is_open())
        self.assertEqual(len(self.active_timer_paths()), 1)
        self.assertEqual(self.run_gateway("reconcile").returncode, 0)
        self.assert_isolated_without_lease()

    def test_kill_after_gate_open_is_closed_by_reconcile(self):
        killed_process = self.run_gateway(
            "release",
            "60",
            AG_TEST_FAILPOINT="after_gate_open",
            AG_TEST_FAILPOINT_ACTION="kill",
        )
        self.assertEqual(killed_process.returncode, -signal.SIGKILL)
        self.assertTrue(self.gate_is_open())
        self.assertEqual(self.read_lease_state()["phase"], "prepared")
        reconcile_process = self.run_gateway("reconcile")
        self.assertNotEqual(reconcile_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_open_without_state_is_closed_by_reconcile_and_verify(self):
        self.attach_interface_to_bridge("usb1")
        reconcile_process = self.run_gateway("reconcile")
        self.assertNotEqual(reconcile_process.returncode, 0)
        self.assert_isolated_without_lease()

        self.attach_interface_to_bridge("usb1")
        verify_process = self.run_gateway("verify")
        self.assertNotEqual(verify_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_malformed_and_expired_state_are_closed_by_reconcile(self):
        state_path = os.path.join(self.state_directory, "active-lease")
        for state_contents in ("not=valid\n", None):
            with self.subTest(state_contents=state_contents):
                self.attach_interface_to_bridge("usb1")
                if state_contents is not None:
                    with open(state_path, "w", encoding="ascii") as state_file:
                        state_file.write(state_contents)
                else:
                    lease_id = "a" * 32
                    with open(state_path, "w", encoding="ascii") as state_file:
                        state_file.write("leaseId=%s\n" % lease_id)
                        state_file.write("timerUnit=ag-cat2-lease-%s\n" % lease_id)
                        state_file.write("expiresAtEpoch=1\n")
                        state_file.write("phase=active\n")
                        state_file.write("serverInterface=usb1\n")
                        state_file.write("uplinkInterface=usb2\n")
                        state_file.write("bridgeInterface=br0\n")
                    with open(os.path.join(self.timer_directory, "ag-cat2-lease-%s.timer" % lease_id), "w") as timer_file:
                        timer_file.write("active\n")
                self.assertNotEqual(self.run_gateway("reconcile").returncode, 0)
                self.assert_isolated_without_lease()

    def test_stale_expiry_token_does_not_close_new_valid_lease(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        active_lease_id = self.read_lease_state()["leaseId"]
        stale_lease_id = "f" * 32
        self.assertNotEqual(stale_lease_id, active_lease_id)
        stale_expiry_process = self.run_gateway("_expire", stale_lease_id)
        self.assertEqual(stale_expiry_process.returncode, 0)
        self.assertTrue(self.gate_is_open())
        self.assertEqual(self.read_status()["state"], "released")

        active_expiry_process = self.run_gateway("_expire", active_lease_id)
        self.assertEqual(active_expiry_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_expiry_close_failure_is_nonzero_and_reconcile_retries_close(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        active_lease_id = self.read_lease_state()["leaseId"]
        for timer_path in self.active_timer_paths():
            os.unlink(timer_path)
        close_failure_path = os.path.join(self.test_root, "fail-gate-close")
        open(close_failure_path, "w").close()
        expiry_process = self.run_gateway("_expire", active_lease_id)
        self.assertNotEqual(expiry_process.returncode, 0)
        self.assertTrue(self.gate_is_open())
        os.unlink(close_failure_path)
        self.assertNotEqual(self.run_gateway("reconcile").returncode, 0)
        self.assert_isolated_without_lease()

    def test_concurrent_releases_are_serialized_and_leave_one_lease(self):
        with open(os.path.join(self.test_root, "systemd-run-delay"), "w") as delay_file:
            delay_file.write("0.2\n")
        first_process = self.start_gateway("release", "60")
        time.sleep(0.05)
        second_process = self.start_gateway("release", "60")
        first_process.communicate(timeout=10)
        second_process.communicate(timeout=10)
        self.assertEqual(first_process.returncode, 0)
        self.assertEqual(second_process.returncode, 0)
        self.assertTrue(self.gate_is_open())
        self.assertEqual(len(self.active_timer_paths()), 1)
        self.assertEqual(self.read_status()["state"], "released")

    def test_concurrent_isolate_waits_for_release_then_wins(self):
        with open(os.path.join(self.test_root, "systemd-run-delay"), "w") as delay_file:
            delay_file.write("0.2\n")
        release_process = self.start_gateway("release", "60")
        time.sleep(0.05)
        isolate_process = self.start_gateway("isolate")
        release_process.communicate(timeout=10)
        isolate_process.communicate(timeout=10)
        self.assertEqual(release_process.returncode, 0)
        self.assertEqual(isolate_process.returncode, 0)
        self.assert_isolated_without_lease()

    def test_old_expiry_racing_new_release_cannot_close_new_lease(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        old_lease_id = self.read_lease_state()["leaseId"]
        with open(os.path.join(self.test_root, "systemd-run-delay"), "w") as delay_file:
            delay_file.write("0.2\n")
        replacement_process = self.start_gateway("release", "60")
        time.sleep(0.05)
        old_expiry_process = self.start_gateway("_expire", old_lease_id)
        replacement_process.communicate(timeout=10)
        old_expiry_process.communicate(timeout=10)
        self.assertEqual(replacement_process.returncode, 0)
        self.assertEqual(old_expiry_process.returncode, 0)
        self.assertTrue(self.gate_is_open())
        self.assertNotEqual(self.read_lease_state()["leaseId"], old_lease_id)
        self.assertEqual(self.read_status()["state"], "released")

    def test_invalid_duration_forms_and_extra_arguments_are_refused(self):
        for invalid_arguments in (
            ("release", ""),
            ("release", "0"),
            ("release", "08"),
            ("release", "601"),
            ("release", "1.5"),
            ("release", "60", "extra"),
        ):
            with self.subTest(invalid_arguments=invalid_arguments):
                self.assertEqual(self.run_gateway(*invalid_arguments).returncode, 2)
                self.assert_isolated_without_lease()

    def test_invalid_config_attempts_emergency_isolation(self):
        self.attach_interface_to_bridge("usb1")
        with open(self.config_path, "a", encoding="ascii") as config_file:
            config_file.write("INVALID LINE\n")
        status_process = self.run_gateway("status")
        self.assertEqual(status_process.returncode, 2)
        self.assertFalse(self.gate_is_open())

    def test_config_change_closes_recorded_released_interface(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        os.makedirs(os.path.join(self.sys_class_net, "usb3"))
        with open(self.config_path, "r", encoding="ascii") as config_file:
            config_text = config_file.read()
        with open(self.config_path, "w", encoding="ascii") as config_file:
            config_file.write(config_text.replace("SERVER_IF=usb1", "SERVER_IF=usb3"))
        reconcile_process = self.run_gateway("reconcile")
        self.assertNotEqual(reconcile_process.returncode, 0)
        self.assertFalse(self.gate_is_open())
        self.assertEqual(self.active_timer_paths(), [])

    def test_duplicate_config_key_emergency_closes_recorded_interface(self):
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        with open(self.config_path, "a", encoding="ascii") as config_file:
            config_file.write("SERVER_IF=usb3\n")
        status_process = self.run_gateway("status")
        self.assertEqual(status_process.returncode, 2)
        self.assertFalse(self.gate_is_open())

    def test_invalid_config_isolation_waits_for_inflight_release(self):
        with open(os.path.join(self.test_root, "systemd-run-delay"), "w") as delay_file:
            delay_file.write("0.3\n")
        release_process = self.start_gateway("release", "60")
        systemd_arguments_path = os.path.join(self.test_root, "systemd-run-arguments")
        for _attempt_number in range(100):
            if os.path.exists(systemd_arguments_path):
                break
            time.sleep(0.01)
        self.assertTrue(os.path.exists(systemd_arguments_path), "release did not reach timer registration")

        with open(self.config_path, "a", encoding="ascii") as config_file:
            config_file.write("INVALID LINE\n")
        invalid_config_process = self.start_gateway("status")
        release_process.communicate(timeout=10)
        invalid_config_process.communicate(timeout=10)

        self.assertEqual(release_process.returncode, 0)
        self.assertEqual(invalid_config_process.returncode, 2)
        self.assertFalse(self.gate_is_open())

    def test_boot_state_without_data_bridge_isolates_without_fault(self):
        # At boot, before the runtime USB transport creates agbr0/usb1/usb2,
        # the data bridge is absent. That is trivially isolated (no forwarding
        # path), so isolate/reconcile must succeed and persist the owned
        # topology rather than faulting on a missing uplink port. This is the
        # real systemd-service start condition caught by hardware testing.
        shutil.rmtree(os.path.join(self.sys_class_net, "br0"), ignore_errors=True)
        uplink_master = os.path.join(self.sys_class_net, "usb2", "master")
        if os.path.lexists(uplink_master):
            os.unlink(uplink_master)
        shutil.rmtree(os.path.join(self.sys_class_net, "usb2", "brport"), ignore_errors=True)
        isolate_process = self.run_gateway("isolate")
        self.assertEqual(isolate_process.returncode, 0, isolate_process.stderr)
        reconcile_process = self.run_gateway("reconcile")
        self.assertEqual(reconcile_process.returncode, 0, reconcile_process.stderr)
        topology = self.read_owned_topology()
        self.assertEqual(topology["serverInterface"], "usb1")
        self.assertEqual(topology["uplinkInterface"], "usb2")

    def test_rogue_bridge_member_must_be_removed_or_fault(self):
        os.makedirs(os.path.join(self.sys_class_net, "rogue0"))
        self.attach_interface_to_bridge("rogue0")
        reconcile_process = self.run_gateway("reconcile")
        self.assertEqual(reconcile_process.returncode, 0, reconcile_process.stderr)
        self.assertFalse(self.bridge_member_is_attached("rogue0"))
        self.assert_exact_closed_topology()
        self.assertTrue(self.bridge_member_is_attached("usb2"))
        topology = self.read_owned_topology()
        self.assertEqual(topology["serverInterface"], "usb1")
        self.assertEqual(topology["uplinkInterface"], "usb2")

    def test_old_server_interface_after_config_change_must_not_remain_forwarding(self):
        # After SERVER_IF changes, the old gate interface must be detached from
        # the data bridge; only the new UPLINK_IF may remain.
        self.assertEqual(self.run_gateway("release", "60").returncode, 0)
        self.assertTrue(self.bridge_member_is_attached("usb1"))
        os.makedirs(os.path.join(self.sys_class_net, "usb3"))
        with open(self.config_path, "r", encoding="ascii") as config_file:
            config_text = config_file.read()
        with open(self.config_path, "w", encoding="ascii") as config_file:
            config_file.write(config_text.replace("SERVER_IF=usb1", "SERVER_IF=usb3"))
        reconcile_process = self.run_gateway("reconcile")
        self.assertNotEqual(reconcile_process.returncode, 0)
        self.assertFalse(self.bridge_member_is_attached("usb1"))
        self.assertFalse(self.gate_is_open())
        self.assertEqual(self.active_timer_paths(), [])
        self.assert_exact_closed_topology()

    def test_missing_lease_state_must_not_hide_old_open_gate(self):
        # Volatile lease state is lost on reboot, but an old SERVER_IF left in
        # the bridge must still be detected and removed by reconcile via the
        # authoritative bridge membership scan, independent of lease state.
        self.attach_interface_to_bridge("usb1")
        self.assertFalse(os.path.exists(os.path.join(self.state_directory, "active-lease")))
        reconcile_process = self.run_gateway("reconcile")
        self.assertNotEqual(reconcile_process.returncode, 0)
        self.assertFalse(self.bridge_member_is_attached("usb1"))
        self.assert_isolated_without_lease()

    def test_bridge_interface_change_must_cleanup_recorded_old_gate(self):
        # When BRIDGE_IF changes, the owned-topology record is updated and the
        # new data bridge converges to the exact closed member set {UPLINK_IF}.
        # The recorded old gate interface must not keep forwarding on the
        # abandoned bridge; reconcile_owned_topology_drift detaches it.
        self.assertEqual(self.run_gateway("isolate").returncode, 0)
        original_topology = self.read_owned_topology()
        self.assertEqual(original_topology["bridgeInterface"], "br0")
        self.assertEqual(original_topology["serverInterface"], "usb1")
        # Move the uplink to a new bridge and edit the config; leave the old
        # recorded gate (usb1) detached so the convergence is a clean isolated
        # transition on the new bridge.
        os.makedirs(os.path.join(self.sys_class_net, "br1"))
        uplink_master = os.path.join(self.sys_class_net, "usb2", "master")
        os.unlink(uplink_master)
        os.symlink(os.path.join(self.sys_class_net, "br1"), uplink_master)
        with open(self.config_path, "r", encoding="ascii") as config_file:
            config_text = config_file.read()
        with open(self.config_path, "w", encoding="ascii") as config_file:
            config_file.write(config_text.replace("BRIDGE_IF=br0", "BRIDGE_IF=br1"))
        reconcile_process = self.run_gateway("reconcile")
        self.assertEqual(reconcile_process.returncode, 0, reconcile_process.stderr)
        # The old gate must not be forwarding on the old bridge.
        self.assertFalse(self.bridge_member_is_attached("usb1"))
        topology = self.read_owned_topology()
        self.assertEqual(topology["bridgeInterface"], "br1")
        self.assertEqual(topology["serverInterface"], "usb1")
        self.assertEqual(topology["uplinkInterface"], "usb2")

    def test_malformed_owned_topology_must_fail_closed(self):
        # A malformed owned-topology record is treated as fail-closed: the
        # current bridge is forced to the exact closed topology and the record
        # is overwritten, rather than trusting the corrupt state.
        topology_path = self.owned_topology_path()
        os.makedirs(os.path.dirname(topology_path), exist_ok=True)
        with open(topology_path, "w", encoding="ascii") as topology_file:
            topology_file.write("garbage=no-newline-valid=but=bad=record\n")
        os.makedirs(os.path.join(self.sys_class_net, "rogue1"))
        self.attach_interface_to_bridge("rogue1")
        reconcile_process = self.run_gateway("reconcile")
        self.assertEqual(reconcile_process.returncode, 0, reconcile_process.stderr)
        self.assertFalse(self.bridge_member_is_attached("rogue1"))
        self.assert_exact_closed_topology()
        topology = self.read_owned_topology()
        self.assertEqual(topology["serverInterface"], "usb1")

    def test_symlink_owned_topology_must_be_rejected(self):
        # A symlinked owned-topology must never be followed; it is rejected and
        # the gateway fail-closes the current bridge, then writes a fresh
        # regular file.
        topology_path = self.owned_topology_path()
        os.makedirs(os.path.dirname(topology_path), exist_ok=True)
        symlink_target = os.path.join(self.state_directory, "evil-topology")
        with open(symlink_target, "w", encoding="ascii") as target_file:
            target_file.write("serverInterface=evil\n")
        os.symlink(symlink_target, topology_path)
        reconcile_process = self.run_gateway("reconcile")
        self.assertEqual(reconcile_process.returncode, 0, reconcile_process.stderr)
        self.assertFalse(os.path.islink(topology_path))
        self.assertTrue(os.path.isfile(topology_path))
        topology = self.read_owned_topology()
        self.assertEqual(topology["serverInterface"], "usb1")
        self.assertEqual(topology["uplinkInterface"], "usb2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
