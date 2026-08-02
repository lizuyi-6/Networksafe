#!/usr/bin/env python3
"""Sandboxed preflight safety tests for Cat2 USB gadget setup."""

import os
import subprocess
import tempfile
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CAT2_SETUP_SCRIPT = os.path.join(EXPERIMENT_ROOT, "transport", "usb-rndis", "cat2-setup.sh")
CAT2_TEARDOWN_SCRIPT = os.path.join(EXPERIMENT_ROOT, "transport", "usb-rndis", "cat2-teardown.sh")


class Cat2UsbPreflightSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.gadget_root = os.path.join(self.test_root, "gadget")
        self.sys_class_net = os.path.join(self.test_root, "sys", "class", "net")
        self.state_directory = os.path.join(self.test_root, "state")
        self.bin_directory = os.path.join(self.test_root, "bin")
        self.ip_log_path = os.path.join(self.test_root, "ip.log")
        os.makedirs(os.path.join(self.gadget_root, "configs", "b.1"))
        os.makedirs(os.path.join(self.gadget_root, "functions", "rndis.gs0"))
        os.makedirs(os.path.join(self.sys_class_net, "usb0"))
        os.makedirs(self.bin_directory)
        with open(os.path.join(self.gadget_root, "UDC"), "w", encoding="ascii") as udc_file:
            udc_file.write("fake-udc\n")
        with open(
            os.path.join(self.gadget_root, "functions", "rndis.gs0", "dev_addr"),
            "w",
            encoding="ascii",
        ) as address_file:
            address_file.write("02:00:00:00:00:02\n")
        with open(os.path.join(self.sys_class_net, "usb0", "address"), "w", encoding="ascii") as address_file:
            address_file.write("02:00:00:00:00:02\n")
        os.symlink(
            os.path.join(self.gadget_root, "functions", "rndis.gs0"),
            os.path.join(self.gadget_root, "configs", "b.1", "f1"),
        )
        self.write_fake_ip()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_fake_ip(self):
        fake_ip_path = os.path.join(self.bin_directory, "ip")
        with open(fake_ip_path, "w", encoding="utf-8") as fake_ip_file:
            fake_ip_file.write(
                """#!/bin/bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "${AG_USB_TEST_IP_LOG:?}"
if [[ "$*" == "-o address show dev usb0" ]]; then
    printf '1: usb0 inet 192.168.100.2/24 scope global usb0\\n'
    exit 0
fi
if [[ "$*" == "-details link show" || "$*" == "address show" ]]; then
    exit 0
fi
exit 1
"""
            )
        os.chmod(fake_ip_path, 0o755)
        for command_name in ("systemd-run", "systemctl"):
            command_path = os.path.join(self.bin_directory, command_name)
            with open(command_path, "w", encoding="ascii") as command_file:
                command_file.write("#!/bin/bash\nexit 0\n")
            os.chmod(command_path, 0o755)
        rmdir_path = os.path.join(self.bin_directory, "rmdir")
        with open(rmdir_path, "w", encoding="utf-8") as rmdir_file:
            rmdir_file.write(
                """#!/bin/bash
# Model configfs semantics: rmdir on a gadget function directory removes the
# whole config item (attributes disappear with it). Real configfs rejects
# attribute files, so simulate item removal with rm -rf for the gadget tree.
for target in "$@"; do
    if [[ "$target" == *"/functions/"* || "$target" == *"/configs/"* ]]; then
        rm -rf "$target"
    else
        /bin/rmdir "$target"
    fi
done
"""
            )
        os.chmod(rmdir_path, 0o755)

    def environment(self):
        environment = os.environ.copy()
        environment.update(
            {
                "AG_USB_TEST_MODE": "1",
                "AG_USB_GADGET_ROOT": self.gadget_root,
                "AG_USB_GADGET_CONFIG": "b.1",
                "AG_SYS_CLASS_NET": self.sys_class_net,
                "AG_USB_STATE_DIRECTORY": self.state_directory,
                "AG_USB_TEST_IP_LOG": self.ip_log_path,
                "PATH": self.bin_directory + os.pathsep + environment["PATH"],
            }
        )
        return environment

    def run_setup(self):
        return subprocess.run(
            ["bash", CAT2_SETUP_SCRIPT],
            env=self.environment(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def assert_preflight_did_not_mutate_gadget(self, original_state_bytes=None):
        with open(os.path.join(self.gadget_root, "UDC"), "r", encoding="ascii") as udc_file:
            self.assertEqual(udc_file.read(), "fake-udc\n")
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "configs", "b.1", "f2")))
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "configs", "b.1", "f3")))
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "functions", "rndis.usb1")))
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "functions", "rndis.usb2")))
        if original_state_bytes is not None:
            with open(os.path.join(self.state_directory, "cat2-state"), "rb") as state_file:
                self.assertEqual(state_file.read(), original_state_bytes)
        if os.path.exists(self.ip_log_path):
            with open(self.ip_log_path, "r", encoding="utf-8") as ip_log_file:
                ip_commands = ip_log_file.read()
            self.assertNotIn("link set", ip_commands)
            self.assertNotIn("link add", ip_commands)
            self.assertNotIn("link delete", ip_commands)

    def test_invalid_active_state_never_unbinds_management(self):
        os.makedirs(self.state_directory)
        state_path = os.path.join(self.state_directory, "cat2-state")
        original_state_bytes = b"phase=active\n"
        with open(state_path, "wb") as state_file:
            state_file.write(original_state_bytes)
        setup_process = self.run_setup()
        self.assertNotEqual(setup_process.returncode, 0)
        self.assert_preflight_did_not_mutate_gadget(original_state_bytes)

    def test_preexisting_bridge_name_is_rejected_without_mutation(self):
        os.makedirs(os.path.join(self.sys_class_net, "agbr0"))
        setup_process = self.run_setup()
        self.assertNotEqual(setup_process.returncode, 0)
        self.assertIn("refusing to adopt", setup_process.stderr)
        self.assert_preflight_did_not_mutate_gadget()

    def test_management_preflight_failure_never_unbinds_udc(self):
        os.unlink(os.path.join(self.gadget_root, "configs", "b.1", "f1"))
        setup_process = self.run_setup()
        self.assertNotEqual(setup_process.returncode, 0)
        self.assertIn("management invariant failed", setup_process.stderr)
        self.assert_preflight_did_not_mutate_gadget()

    def test_failure_after_udc_unbind_restores_management_baseline(self):
        environment = self.environment()
        environment["AG_USB_TEST_FAILPOINT"] = "after_udc_unbind"
        setup_process = subprocess.run(
            ["bash", CAT2_SETUP_SCRIPT],
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertNotEqual(setup_process.returncode, 0)
        self.assertIn("INJECTED_USB_TEST_FAILURE", setup_process.stderr)
        self.assert_preflight_did_not_mutate_gadget()
        self.assertFalse(os.path.exists(os.path.join(self.state_directory, "cat2-state")))


class Cat2UsbTeardownSafetyTest(unittest.TestCase):
    """Full teardown-path regression: the two defects below were only observed
    on the live board (self-referencing local declaration crashing under
    set -u; configfs normalizing link targets to relative paths)."""

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.gadget_root = os.path.join(self.test_root, "gadget")
        self.sys_class_net = os.path.join(self.test_root, "sys", "class", "net")
        self.state_directory = os.path.join(self.test_root, "state")
        self.bin_directory = os.path.join(self.test_root, "bin")
        self.ip_log_path = os.path.join(self.test_root, "ip.log")
        config_directory = os.path.join(self.gadget_root, "configs", "b.1")
        os.makedirs(config_directory)
        os.makedirs(os.path.join(self.sys_class_net, "usb0"))
        os.makedirs(os.path.join(self.sys_class_net, "usb1"))
        os.makedirs(os.path.join(self.sys_class_net, "usb2"))
        os.makedirs(os.path.join(self.sys_class_net, "agbr0"))
        os.makedirs(self.bin_directory)
        os.makedirs(self.state_directory)
        with open(os.path.join(self.gadget_root, "UDC"), "w", encoding="ascii") as udc_file:
            udc_file.write("fake-udc\n")
        for function_name, device_mac in (
            ("rndis.gs0", "02:00:00:00:00:02"),
            ("rndis.usb1", "02:11:11:11:11:02"),
            ("rndis.usb2", "02:22:22:22:22:02"),
        ):
            function_directory = os.path.join(self.gadget_root, "functions", function_name)
            os.makedirs(function_directory)
            with open(os.path.join(function_directory, "dev_addr"), "w", encoding="ascii") as address_file:
                address_file.write(device_mac + "\n")
            host_mac = device_mac[:-1] + "1"
            with open(os.path.join(function_directory, "host_addr"), "w", encoding="ascii") as address_file:
                address_file.write(host_mac + "\n")
        for interface_name, device_mac in (
            ("usb0", "02:00:00:00:00:02"),
            ("usb1", "02:11:11:11:11:02"),
            ("usb2", "02:22:22:22:22:02"),
        ):
            with open(os.path.join(self.sys_class_net, interface_name, "address"), "w", encoding="ascii") as address_file:
                address_file.write(device_mac + "\n")
        # Configfs presents link targets as relative paths; model that exactly
        # so a bare readlink comparison would fail here the way it did on the
        # live gadget.
        os.symlink(
            os.path.relpath(
                os.path.join(self.gadget_root, "functions", "rndis.gs0"), config_directory
            ),
            os.path.join(config_directory, "f1"),
        )
        os.symlink(
            os.path.relpath(
                os.path.join(self.gadget_root, "functions", "rndis.usb1"), config_directory
            ),
            os.path.join(config_directory, "f2"),
        )
        os.symlink(
            os.path.relpath(
                os.path.join(self.gadget_root, "functions", "rndis.usb2"), config_directory
            ),
            os.path.join(config_directory, "f3"),
        )
        state_lines = [
            "phase=active",
            "gadgetRoot=" + self.gadget_root,
            "gadgetConfig=b.1",
            "managementFunction=rndis.gs0",
            "managementInterface=usb0",
            "managementAddress=192.168.100.2/24",
            "originalUdc=fake-udc",
            "createdServerFunction=true",
            "createdUplinkFunction=true",
            "createdServerLink=true",
            "createdUplinkLink=true",
            "createdBridge=true",
            "udcWasUnbound=false",
            "bridgeInterface=agbr0",
        ]
        with open(os.path.join(self.state_directory, "cat2-state"), "w", encoding="ascii") as state_file:
            state_file.write("\n".join(state_lines) + "\n")
        self.write_fake_commands()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_fake_commands(self):
        fake_ip_path = os.path.join(self.bin_directory, "ip")
        with open(fake_ip_path, "w", encoding="utf-8") as fake_ip_file:
            fake_ip_file.write(
                """#!/bin/bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "${AG_USB_TEST_IP_LOG:?}"
if [[ "$*" == "-o address show dev usb0" ]]; then
    printf '1: usb0 inet 192.168.100.2/24 scope global usb0\\n'
    exit 0
fi
if [[ "$*" == "-d link show dev agbr0" ]]; then
    printf '3: agbr0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DEFAULT group default\\n'
    printf '    link/ether 02:22:22:22:22:02 brd ff:ff:ff:ff:ff:ff promiscuity 0\\n'
    printf '    bridge forward_delay 1500\\n'
    exit 0
fi
if [[ "$*" == "link show dev agbr0" ]]; then
    printf '3: agbr0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN\\n'
    exit 0
fi
if [[ "$*" == "link delete dev agbr0 type bridge" ]]; then
    /bin/rmdir "${AG_SYS_CLASS_NET:?}/agbr0" 2>/dev/null || true
    exit 0
fi
if [[ "$*" == "link set dev usb1 nomaster" || "$*" == "link set dev usb2 nomaster" ]]; then
    exit 0
fi
exit 1
"""
            )
        os.chmod(fake_ip_path, 0o755)
        fake_gateway_path = os.path.join(self.bin_directory, "ag-cat2-gateway")
        with open(fake_gateway_path, "w", encoding="ascii") as gateway_file:
            gateway_file.write("#!/bin/bash\nexit 0\n")
        os.chmod(fake_gateway_path, 0o755)
        for command_name in ("systemd-run", "systemctl"):
            command_path = os.path.join(self.bin_directory, command_name)
            with open(command_path, "w", encoding="ascii") as command_file:
                command_file.write("#!/bin/bash\nexit 0\n")
            os.chmod(command_path, 0o755)
        rmdir_path = os.path.join(self.bin_directory, "rmdir")
        with open(rmdir_path, "w", encoding="utf-8") as rmdir_file:
            rmdir_file.write(
                """#!/bin/bash
# Model configfs semantics: rmdir on a gadget function directory removes the
# whole config item (attributes disappear with it).
for target in "$@"; do
    if [[ "$target" == *"/functions/"* || "$target" == *"/configs/"* ]]; then
        rm -rf "$target"
    else
        /bin/rmdir "$target"
    fi
done
"""
            )
        os.chmod(rmdir_path, 0o755)

    def environment(self):
        environment = os.environ.copy()
        environment.update(
            {
                "AG_USB_TEST_MODE": "1",
                "AG_USB_GADGET_ROOT": self.gadget_root,
                "AG_USB_GADGET_CONFIG": "b.1",
                "AG_SYS_CLASS_NET": self.sys_class_net,
                "AG_USB_STATE_DIRECTORY": self.state_directory,
                "AG_USB_TEST_IP_LOG": self.ip_log_path,
                "PATH": self.bin_directory + os.pathsep + environment["PATH"],
            }
        )
        return environment

    def test_full_teardown_converges_to_management_only_baseline(self):
        teardown_process = subprocess.run(
            ["bash", CAT2_TEARDOWN_SCRIPT],
            env=self.environment(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(
            teardown_process.returncode,
            0,
            "teardown failed: stdout=%s stderr=%s" % (teardown_process.stdout, teardown_process.stderr),
        )
        self.assertIn("teardown complete", teardown_process.stdout)
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "configs", "b.1", "f2")))
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "configs", "b.1", "f3")))
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "functions", "rndis.usb1")))
        self.assertFalse(os.path.exists(os.path.join(self.gadget_root, "functions", "rndis.usb2")))
        self.assertFalse(os.path.exists(os.path.join(self.sys_class_net, "agbr0")))
        self.assertFalse(os.path.exists(os.path.join(self.state_directory, "cat2-state")))
        # Management function, link, interface and UDC binding must survive.
        self.assertTrue(os.path.exists(os.path.join(self.gadget_root, "functions", "rndis.gs0")))
        self.assertTrue(os.path.exists(os.path.join(self.gadget_root, "configs", "b.1", "f1")))
        with open(os.path.join(self.gadget_root, "UDC"), "r", encoding="ascii") as udc_file:
            self.assertEqual(udc_file.read(), "fake-udc\n")


if __name__ == "__main__":
    unittest.main(verbosity=2)
