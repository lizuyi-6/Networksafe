#!/usr/bin/env python3
"""Sandboxed tests for fail-closed Cat2 backup verification and restore."""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKUP_SCRIPT = os.path.join(EXPERIMENT_ROOT, "cat2", "scripts", "ag-cat2-backup.sh")
ROLLBACK_SCRIPT = os.path.join(
    EXPERIMENT_ROOT,
    "cat2",
    "rollback",
    "aetherguard-network-rollback.sh",
)


class RollbackIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.source_root = os.path.join(self.test_root, "source")
        self.target_root = os.path.join(self.test_root, "target")
        self.backup_root = os.path.join(self.test_root, "backups")
        self.bin_directory = os.path.join(self.test_root, "bin")
        self.sys_class_net = os.path.join(self.test_root, "sys", "class", "net")
        self.gateway_call_log = os.path.join(self.test_root, "gateway-calls.txt")
        self.rollback_log = os.path.join(self.test_root, "rollback.log")
        os.makedirs(os.path.join(self.source_root, "etc"), exist_ok=True)
        os.makedirs(os.path.join(self.source_root, "usr", "local", "sbin"), exist_ok=True)
        os.makedirs(os.path.join(self.target_root, "etc"), exist_ok=True)
        os.makedirs(os.path.join(self.target_root, "usr", "local", "sbin"), exist_ok=True)
        os.makedirs(os.path.join(self.sys_class_net, "usb0"), exist_ok=True)
        os.makedirs(self.bin_directory)

        self.write_text(
            os.path.join(self.source_root, "etc", "aetherguard-cat2.conf"),
            "SERVER_IF=usb1\n",
        )
        self.write_text(
            os.path.join(self.source_root, "usr", "local", "sbin", "ag-cat2-gateway"),
            "original gateway\n",
        )
        self.write_fake_commands()
        backup_process = self.run_backup()
        self.assertEqual(backup_process.returncode, 0, backup_process.stderr)
        self.backup_path = backup_process.stdout.strip().splitlines()[-1]

    def tearDown(self):
        self.temporary_directory.cleanup()

    @staticmethod
    def write_text(file_path, file_contents):
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="ascii") as output_file:
            output_file.write(file_contents)

    def write_fake_commands(self):
        command_sources = {
            "ip": """#!/bin/bash
if [[ "${1:-}" == "-j" ]]; then printf '[]\\n'; exit 0; fi
if [[ "${1:-}" == "-o" && "${2:-}" == "-4" ]]; then
    printf '1: usb0    inet 192.168.100.2/24 scope global usb0\\n'
    exit 0
fi
if [[ "${1:-}" == "link" && "${2:-}" == "set" ]]; then exit 0; fi
exit 1
""",
            "bridge": "#!/bin/bash\nexit 0\n",
            "nmcli": "#!/bin/bash\nexit 0\n",
            "systemctl": """#!/bin/bash
case "${1:-}" in
    is-active) [[ "${2:-}" == "--quiet" ]] || printf 'active\\n'; exit 0 ;;
    is-enabled) printf 'disabled\\n'; exit 1 ;;
    list-units) exit 0 ;;
    stop|daemon-reload) exit 0 ;;
esac
exit 0
""",
            "logger": "#!/bin/bash\nexit 0\n",
            "ag-cat2-gateway": """#!/bin/bash
printf '%s\\n' "$*" >> "$AG_GATEWAY_CALL_LOG"
if [[ "${1:-}" == "isolate" ]]; then exit "${AG_GATEWAY_ISOLATE_EXIT_CODE:-0}"; fi
exit 0
""",
        }
        for command_name, command_source in command_sources.items():
            command_path = os.path.join(self.bin_directory, command_name)
            self.write_text(command_path, command_source)
            os.chmod(command_path, 0o755)

    def command_environment(self):
        environment = os.environ.copy()
        environment.update(
            {
                "AG_COMMAND_PATH": self.bin_directory + os.pathsep + "/usr/bin:/bin",
                "AG_BACKUP_ROOT": self.backup_root,
                "AG_BACKUP_SOURCE_ROOT": self.source_root,
                "AG_ROLLBACK_TARGET_ROOT": self.target_root,
                "AG_ROLLBACK_LOG_PATH": self.rollback_log,
                "AG_GATEWAY_CALL_LOG": self.gateway_call_log,
                "AG_GATEWAY_CONFIG_PATH": os.path.join(
                    self.target_root,
                    "etc",
                    "aetherguard-cat2.conf",
                ),
                "AG_SYS_CLASS_NET": self.sys_class_net,
                "AG_USB_STATE_PATH": os.path.join(self.test_root, "missing-usb-state"),
            }
        )
        return environment

    def run_backup(self):
        return subprocess.run(
            ["bash", BACKUP_SCRIPT],
            env=self.command_environment(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def run_rollback(self, backup_path=None, restore_files=False, environment_updates=None):
        environment = self.command_environment()
        environment["AG_RESTORE_BACKUP_FILES"] = "1" if restore_files else "0"
        if environment_updates:
            environment.update(environment_updates)
        return subprocess.run(
            ["bash", ROLLBACK_SCRIPT, backup_path or self.backup_path],
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def rewrite_checksums(self):
        checksum_entries = []
        for directory_path, directory_names, file_names in os.walk(self.backup_path):
            directory_names.sort()
            for directory_name in directory_names:
                directory_entry_path = os.path.join(directory_path, directory_name)
                if os.path.islink(directory_entry_path):
                    relative_path = os.path.relpath(directory_entry_path, self.backup_path)
                    link_bytes = os.readlink(directory_entry_path).encode("utf-8")
                    checksum_entries.append((relative_path, hashlib.sha256(link_bytes).hexdigest()))
            for file_name in sorted(file_names):
                if file_name in ("SHA256SUMS", "COMPLETE"):
                    continue
                file_path = os.path.join(directory_path, file_name)
                relative_path = os.path.relpath(file_path, self.backup_path)
                if os.path.islink(file_path):
                    file_bytes = os.readlink(file_path).encode("utf-8")
                else:
                    with open(file_path, "rb") as input_file:
                        file_bytes = input_file.read()
                checksum_entries.append((relative_path, hashlib.sha256(file_bytes).hexdigest()))
        with open(os.path.join(self.backup_path, "SHA256SUMS"), "w", encoding="ascii") as checksum_file:
            for relative_path, checksum_digest in checksum_entries:
                checksum_file.write("%s  %s\n" % (checksum_digest, relative_path))

    def assert_gateway_was_not_called(self):
        self.assertFalse(os.path.exists(self.gateway_call_log))

    def test_exact_owned_file_restore_and_absent_file_removal(self):
        target_config_path = os.path.join(self.target_root, "etc", "aetherguard-cat2.conf")
        absent_authorizer_path = os.path.join(
            self.target_root,
            "usr",
            "local",
            "sbin",
            "ag-auth-verify.py",
        )
        self.write_text(target_config_path, "SERVER_IF=rogue0\n")
        self.write_text(absent_authorizer_path, "new deployment file\n")

        rollback_process = self.run_rollback(restore_files=True)
        self.assertEqual(rollback_process.returncode, 0, rollback_process.stderr)
        with open(target_config_path, "r", encoding="ascii") as config_file:
            self.assertEqual(config_file.read(), "SERVER_IF=usb1\n")
        self.assertFalse(os.path.lexists(absent_authorizer_path))
        with open(self.gateway_call_log, "r", encoding="ascii") as gateway_log:
            self.assertEqual(gateway_log.read().splitlines(), ["isolate"])

    def test_checksum_corruption_fails_before_gate_mutation(self):
        payload_config_path = os.path.join(
            self.backup_path,
            "payload",
            "etc",
            "aetherguard-cat2.conf",
        )
        self.write_text(payload_config_path, "SERVER_IF=corrupted0\n")

        rollback_process = self.run_rollback()
        self.assertNotEqual(rollback_process.returncode, 0)
        self.assertIn("checksum mismatch", rollback_process.stderr)
        self.assert_gateway_was_not_called()

    def test_missing_complete_and_symlinked_manifest_are_rejected(self):
        os.unlink(os.path.join(self.backup_path, "COMPLETE"))
        incomplete_process = self.run_rollback()
        self.assertNotEqual(incomplete_process.returncode, 0)
        self.assertIn("BACKUP_NOT_COMPLETE", incomplete_process.stdout)
        self.assert_gateway_was_not_called()

        self.write_text(os.path.join(self.backup_path, "COMPLETE"), "complete\n")
        manifest_path = os.path.join(self.backup_path, "manifest.json")
        manifest_copy_path = os.path.join(self.test_root, "manifest-copy.json")
        shutil.copy2(manifest_path, manifest_copy_path)
        os.unlink(manifest_path)
        os.symlink(manifest_copy_path, manifest_path)
        symlink_process = self.run_rollback()
        self.assertNotEqual(symlink_process.returncode, 0)
        self.assertIn("BACKUP_MANIFEST_MISSING", symlink_process.stdout)
        self.assert_gateway_was_not_called()

    def test_duplicate_checksum_and_path_escape_are_rejected(self):
        checksum_path = os.path.join(self.backup_path, "SHA256SUMS")
        with open(checksum_path, "r", encoding="ascii") as checksum_file:
            first_checksum_line = checksum_file.readline()
        with open(checksum_path, "a", encoding="ascii") as checksum_file:
            checksum_file.write(first_checksum_line)
        duplicate_process = self.run_rollback()
        self.assertNotEqual(duplicate_process.returncode, 0)
        self.assertIn("duplicate checksum path", duplicate_process.stderr)
        self.assert_gateway_was_not_called()

        self.rewrite_checksums()
        with open(checksum_path, "a", encoding="ascii") as checksum_file:
            checksum_file.write("%s  ../outside\n" % ("0" * 64))
        escape_process = self.run_rollback()
        self.assertNotEqual(escape_process.returncode, 0)
        self.assertIn("checksum path escapes backup", escape_process.stderr)
        self.assert_gateway_was_not_called()

    def test_self_consistent_non_whitelisted_manifest_is_rejected(self):
        manifest_path = os.path.join(self.backup_path, "manifest.json")
        with open(manifest_path, "r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        malicious_entry = next(
            inventory_entry
            for inventory_entry in manifest["inventory"]
            if inventory_entry["source"] == "/etc/nftables.conf"
        )
        malicious_entry.update(
            {
                "source": "/etc/passwd",
                "archivePath": "payload/etc/passwd",
                "restorable": True,
            }
        )
        with open(manifest_path, "w", encoding="utf-8") as manifest_file:
            json.dump(manifest, manifest_file, indent=2, sort_keys=True)
            manifest_file.write("\n")
        self.rewrite_checksums()

        rollback_process = self.run_rollback()
        self.assertNotEqual(rollback_process.returncode, 0)
        self.assertIn("outside the exact inventory", rollback_process.stderr)
        self.assert_gateway_was_not_called()

    def test_backup_path_escape_and_unavailable_isolation_are_fatal(self):
        outside_backup_path = os.path.join(self.test_root, "outside-backup")
        os.makedirs(outside_backup_path)
        escape_process = self.run_rollback(backup_path=outside_backup_path)
        self.assertNotEqual(escape_process.returncode, 0)
        self.assertIn("BACKUP_PATH_INVALID", escape_process.stdout)
        self.assert_gateway_was_not_called()

        os.unlink(os.path.join(self.bin_directory, "ag-cat2-gateway"))
        isolation_process = self.run_rollback(
            environment_updates={
                "AG_GATEWAY_CONFIG_PATH": os.path.join(self.test_root, "missing-config"),
            }
        )
        self.assertNotEqual(isolation_process.returncode, 0)
        self.assertIn("SERVER_INTERFACE_UNAVAILABLE", isolation_process.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
