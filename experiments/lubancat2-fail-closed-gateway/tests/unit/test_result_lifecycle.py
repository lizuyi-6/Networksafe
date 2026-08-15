#!/usr/bin/env python3
"""Ordinary-Linux tests for cleanup-first immutable result publication."""

import hashlib
import json
import os
import subprocess
import tempfile
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEST_LIBRARY = os.path.join(EXPERIMENT_ROOT, "lib", "test-lib.sh")


class ResultLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_root = self.temporary_directory.name
        self.run_id = "20990101T000000Z-lifecycle"
        self.run_directory = os.path.join(self.test_root, "results", "raw", self.run_id)
        self.environment = os.environ.copy()
        self.environment.update(
            {
                "AG_ROOT": self.test_root,
                "AG_RUN_ID": self.run_id,
                "AG_RUN_DIR": self.run_directory,
                "AG_GATEWAY_COMMIT": "a" * 40,
                "AG_CLEANUP_GATEWAY": "1",
            }
        )

    def tearDown(self):
        self.temporary_directory.cleanup()

    def run_fixture(self, test_body, cleanup_succeeds=True):
        cleanup_exit_code = 0 if cleanup_succeeds else 1
        gate_state = "isolated" if cleanup_succeeds else "released"
        fixture_source = """
set -Eeuo pipefail
. %s
ag_ssh() {
    if [[ "$*" == "hostname" ]]; then printf 'fixture-cat2\\n'; return 0; fi
    if [[ "$*" == "ag-cat2-gateway isolate" ]]; then return %d; fi
    if [[ "$*" == "ag-cat2-gateway status" ]]; then
        printf '{"state":"%s"}\\n'
        return 0
    fi
    return 0
}
ag_management_available() { return 0; }
ag_begin_test "lifecycle-test" "fault" "fixture lifecycle command"
%s
""" % (
            subprocess.list2cmdline([TEST_LIBRARY]),
            cleanup_exit_code,
            gate_state,
            test_body,
        )
        return subprocess.run(
            ["bash", "-c", fixture_source],
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def read_result(self):
        result_path = os.path.join(self.run_directory, "lifecycle-test.result.json")
        with open(result_path, "r", encoding="utf-8") as result_file:
            return json.load(result_file)

    def digest_result_pair(self):
        digests = []
        for result_name in ("lifecycle-test.txt", "lifecycle-test.result.json"):
            with open(os.path.join(self.run_directory, result_name), "rb") as result_file:
                digests.append(hashlib.sha256(result_file.read()).hexdigest())
        return tuple(digests)

    def test_requested_pass_is_published_only_after_successful_cleanup(self):
        process = self.run_fixture(
            'ag_finish_test PASSED 0 FIXTURE_PASSED "safe cleanup" "cleanup completed"',
            cleanup_succeeds=True,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        result = self.read_result()
        self.assertEqual(result["status"], "PASSED")
        self.assertTrue(result["cleanupAttempted"])
        self.assertTrue(result["cleanupSucceeded"])
        self.assertEqual(result["stateAfter"], "isolated")

    def test_cleanup_failure_downgrades_requested_pass(self):
        process = self.run_fixture(
            'ag_finish_test PASSED 0 FIXTURE_PASSED "safe cleanup" "assertions passed"',
            cleanup_succeeds=False,
        )
        self.assertNotEqual(process.returncode, 0)
        result = self.read_result()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["reasonCode"], "CLEANUP_FAILED")
        self.assertFalse(result["cleanupSucceeded"])

    def test_pipeline_failure_cannot_become_passed(self):
        process = self.run_fixture("false | true", cleanup_succeeds=True)
        self.assertNotEqual(process.returncode, 0)
        result = self.read_result()
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["reasonCode"], "UNHANDLED_TEST_EXIT")

    def test_published_pair_is_immutable(self):
        first_process = self.run_fixture(
            'ag_finish_test PASSED 0 FIXTURE_PASSED "immutable pair" "first publication"',
            cleanup_succeeds=True,
        )
        self.assertEqual(first_process.returncode, 0, first_process.stderr)
        original_digests = self.digest_result_pair()
        second_process = self.run_fixture(
            'ag_finish_test PASSED 0 FIXTURE_PASSED "immutable pair" "second publication"',
            cleanup_succeeds=True,
        )
        self.assertNotEqual(second_process.returncode, 0)
        self.assertEqual(self.digest_result_pair(), original_digests)


if __name__ == "__main__":
    unittest.main(verbosity=2)
