#!/usr/bin/env python3
"""Sandboxed tests for immutable Cat2 backup construction."""

import json
import os
import subprocess
import tempfile
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BACKUP_SCRIPT = os.path.join(EXPERIMENT_ROOT, "cat2", "scripts", "ag-cat2-backup.sh")


class BackupIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.source_root = os.path.join(self.test_root, "source")
        self.backup_root = os.path.join(self.test_root, "backups")
        self.bin_directory = os.path.join(self.test_root, "bin")
        os.makedirs(os.path.join(self.source_root, "etc", "systemd", "system"))
        os.makedirs(os.path.join(self.source_root, "usr", "local", "sbin"))
        os.makedirs(self.bin_directory)
        with open(os.path.join(self.source_root, "etc", "aetherguard-cat2.conf"), "w", encoding="ascii") as config_file:
            config_file.write("SERVER_IF=usb1\n")
        with open(os.path.join(self.source_root, "usr", "local", "sbin", "ag-cat2-gateway"), "w", encoding="ascii") as gateway_file:
            gateway_file.write("fixture gateway\n")
        self.write_fake_commands()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_fake_commands(self):
        command_sources = {
            "ip": """#!/bin/bash
if [[ "$1" == "-j" ]]; then printf '[]\\n'; exit 0; fi
exit 1
""",
            "bridge": "#!/bin/bash\nexit 0\n",
            "systemctl": """#!/bin/bash
case "${1:-}" in
    is-active) printf 'active\\n'; exit 0 ;;
    is-enabled) printf 'disabled\\n'; exit 1 ;;
esac
exit 0
""",
            "logger": "#!/bin/bash\nexit 0\n",
        }
        for command_name, command_source in command_sources.items():
            command_path = os.path.join(self.bin_directory, command_name)
            with open(command_path, "w", encoding="ascii") as command_file:
                command_file.write(command_source)
            os.chmod(command_path, 0o755)

    def run_backup(self):
        environment = os.environ.copy()
        environment.update(
            {
                "AG_BACKUP_ROOT": self.backup_root,
                "AG_BACKUP_SOURCE_ROOT": self.source_root,
                "AG_COMMAND_PATH": self.bin_directory + os.pathsep + environment["PATH"],
            }
        )
        return subprocess.run(
            ["bash", BACKUP_SCRIPT],
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def test_two_immediate_backups_are_unique_complete_and_checksummed(self):
        first_backup = self.run_backup()
        second_backup = self.run_backup()
        self.assertEqual(first_backup.returncode, 0, first_backup.stderr)
        self.assertEqual(second_backup.returncode, 0, second_backup.stderr)
        first_path = first_backup.stdout.strip().splitlines()[-1]
        second_path = second_backup.stdout.strip().splitlines()[-1]
        self.assertNotEqual(first_path, second_path)

        for backup_path in (first_path, second_path):
            self.assertTrue(os.path.isfile(os.path.join(backup_path, "COMPLETE")))
            self.assertTrue(os.path.isfile(os.path.join(backup_path, "SHA256SUMS")))
            with open(os.path.join(backup_path, "manifest.json"), "r", encoding="utf-8") as manifest_file:
                manifest = json.load(manifest_file)
            self.assertTrue(manifest["complete"])
            config_entry = next(
                entry for entry in manifest["inventory"]
                if entry["source"] == "/etc/aetherguard-cat2.conf"
            )
            self.assertEqual(config_entry["archivePath"], "payload/etc/aetherguard-cat2.conf")
            self.assertTrue(config_entry["restorable"])
            self.assertTrue(os.path.isfile(os.path.join(backup_path, config_entry["archivePath"])))

    def test_copy_failure_never_publishes_complete_backup(self):
        failing_cp_path = os.path.join(self.bin_directory, "cp")
        with open(failing_cp_path, "w", encoding="ascii") as failing_cp_file:
            failing_cp_file.write("#!/bin/bash\nexit 1\n")
        os.chmod(failing_cp_path, 0o755)
        backup_process = self.run_backup()
        self.assertNotEqual(backup_process.returncode, 0)
        if os.path.isdir(self.backup_root):
            published_entries = [
                entry_name for entry_name in os.listdir(self.backup_root)
                if not entry_name.startswith(".")
            ]
            self.assertEqual(published_entries, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
