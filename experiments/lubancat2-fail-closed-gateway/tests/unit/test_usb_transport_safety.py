#!/usr/bin/env python3
"""Sandboxed preflight safety tests for Cat2 USB gadget setup."""

import os
import subprocess
import tempfile
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CAT2_SETUP_SCRIPT = os.path.join(EXPERIMENT_ROOT, "transport", "usb-rndis", "cat2-setup.sh")


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
