#!/usr/bin/env python3
"""Regression tests for immutable campaign aggregation and validation."""

import json
import os
import shutil
import struct
import subprocess
import tempfile
import unittest


EXPERIMENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class ResultPipelineTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.test_experiment_root = self.temporary_directory.name
        self.scripts_directory = os.path.join(self.test_experiment_root, "scripts")
        self.schemas_directory = os.path.join(self.test_experiment_root, "schemas")
        self.run_id = "20990101T000000Z-fixture"
        self.run_directory = os.path.join(
            self.test_experiment_root,
            "results",
            "raw",
            self.run_id,
        )
        os.makedirs(self.scripts_directory)
        os.makedirs(self.schemas_directory)
        os.makedirs(self.run_directory)
        os.makedirs(os.path.join(self.test_experiment_root, "results", "normalized"))

        for script_name in ("generate-evidence.py", "validate-results.py"):
            shutil.copy2(
                os.path.join(EXPERIMENT_ROOT, "scripts", script_name),
                os.path.join(self.scripts_directory, script_name),
            )
        for schema_name in (
            "test-result.schema.json",
            "campaign.schema.json",
            "gateway-status.schema.json",
            "traffic-observation.schema.json",
        ):
            shutil.copy2(
                os.path.join(EXPERIMENT_ROOT, "schemas", schema_name),
                os.path.join(self.schemas_directory, schema_name),
            )
        self.write_campaign(complete=True)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_campaign(self, complete, **overrides):
        campaign = {
            "resultKind": "campaign",
            "schemaVersion": 1,
            "runId": self.run_id,
            "startedAt": "2099-01-01T00:00:00Z",
            "finishedAt": "2099-01-01T00:00:02Z" if complete else None,
            "complete": complete,
            "gatewayCommit": "a" * 40,
            "transport": "usb-rndis",
            "expectedTests": [{"testId": "sample-test", "category": "isolation"}],
        }
        campaign.update(overrides)
        with open(os.path.join(self.run_directory, "campaign.json"), "w", encoding="utf-8") as campaign_file:
            json.dump(campaign, campaign_file, indent=2, sort_keys=True)
            campaign_file.write("\n")

    def build_result(self, **overrides):
        result = {
            "resultKind": "test-result",
            "schemaVersion": 2,
            "runId": self.run_id,
            "testId": "sample-test",
            "category": "isolation",
            "trafficProfile": "ISOLATED_NEGATIVE_WITH_CONTROL",
            "status": "PASSED",
            "transport": "usb-rndis",
            "gatewayCommit": "a" * 40,
            "cat2Hostname": "lubancat",
            "protectedEndpoint": "netns:victim/agvictim0",
            "serverInterface": "usb1",
            "uplinkInterface": "usb2",
            "managementInterface": "usb0",
            "captureInterface": "usb2",
            "stateBefore": "isolated",
            "stateAfter": "isolated",
            "startedAt": "2099-01-01T00:00:00Z",
            "finishedAt": "2099-01-01T00:00:01Z",
            "command": "run sample probe",
            "exitCode": 0,
            "expected": "no packet escape",
            "observed": "no packet escape",
            "passed": True,
            "unauthorizedConnections": 0,
            "escapedPackets": 0,
            "escapedBytes": 0,
            "uplinkObservedPackets": 0,
            "probeCommandExecuted": True,
            "probeReachedUpstream": False,
            "packetObservedOnUplink": False,
            "releaseLatencyMs": None,
            "isolationLatencyMs": 1.0,
            "managementAvailable": True,
            "cleanupAttempted": True,
            "cleanupSucceeded": True,
            "cleanupDetails": "gateway isolated",
            "reasonCode": "NO_ESCAPE",
            "evidenceFiles": [
                "results/raw/%s/sample-test.txt" % self.run_id,
                "results/raw/%s/evidence/sample-test-positive-control.pcap" % self.run_id,
                "results/raw/%s/evidence/sample-test-positive-control.pcap.txt" % self.run_id,
                "results/raw/%s/evidence/sample-test-positive-control-server.txt" % self.run_id,
                "results/raw/%s/evidence/sample-test-positive-control.observation.json" % self.run_id,
                "results/raw/%s/evidence/sample-test-isolated.pcap" % self.run_id,
                "results/raw/%s/evidence/sample-test-isolated.pcap.txt" % self.run_id,
                "results/raw/%s/evidence/sample-test-isolated-server.txt" % self.run_id,
                "results/raw/%s/evidence/sample-test-isolated.observation.json" % self.run_id,
            ],
            "trafficObservations": [
                "results/raw/%s/evidence/sample-test-positive-control.observation.json" % self.run_id,
                "results/raw/%s/evidence/sample-test-isolated.observation.json" % self.run_id,
            ],
            "notes": ["fixture"],
        }
        result.update(overrides)
        return result

    def write_result(self, result, result_name="sample-test.result.json"):
        with open(os.path.join(self.run_directory, "sample-test.txt"), "w", encoding="utf-8") as text_file:
            text_file.write("raw evidence\n")
        evidence_directory = os.path.join(self.run_directory, "evidence")
        os.makedirs(evidence_directory, exist_ok=True)
        self.write_traffic_observation(
            evidence_directory,
            phase_name="positive-control",
            expectation="RELEASED_REACHABLE",
            marker="AGPROBE-fixture-positive",
            include_packet=True,
        )
        self.write_traffic_observation(
            evidence_directory,
            phase_name="isolated",
            expectation="ISOLATED_BLOCKED",
            marker="AGPROBE-fixture-negative",
            include_packet=False,
        )
        with open(os.path.join(self.run_directory, result_name), "w", encoding="utf-8") as json_file:
            json.dump(result, json_file, indent=2, sort_keys=True)
            json_file.write("\n")

    def write_traffic_observation(
        self,
        evidence_directory,
        phase_name,
        expectation,
        marker,
        include_packet,
    ):
        pcap_name = "sample-test-%s.pcap" % phase_name
        pcap_text_name = "%s.txt" % pcap_name
        server_log_name = "sample-test-%s-server.txt" % phase_name
        observation_name = "sample-test-%s.observation.json" % phase_name
        pcap_path = os.path.join(evidence_directory, pcap_name)
        packet_bytes = b""
        if include_packet:
            packet_bytes = (
                b"\xff\xff\xff\xff\xff\xff"
                b"\x02\x11\x11\x11\x11\x01"
                b"\x88\xb5"
                + marker.encode("ascii")
            )
        pcap_bytes = struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
        if packet_bytes:
            pcap_bytes += struct.pack("<IIII", 1, 0, len(packet_bytes), len(packet_bytes))
            pcap_bytes += packet_bytes
        with open(pcap_path, "wb") as pcap_file:
            pcap_file.write(pcap_bytes)
        with open(os.path.join(evidence_directory, pcap_text_name), "w", encoding="ascii") as pcap_text_file:
            if include_packet:
                pcap_text_file.write("decoded packet %s\n" % marker)
        with open(os.path.join(evidence_directory, server_log_name), "w", encoding="ascii") as server_log_file:
            if include_packet:
                server_log_file.write("TCP fixture %s\n" % marker)

        evidence_prefix = "results/raw/%s/evidence" % self.run_id
        observation = {
            "resultKind": "traffic-observation",
            "schemaVersion": 1,
            "runId": self.run_id,
            "testId": "sample-test",
            "phase": phase_name,
            "expectation": expectation,
            "marker": marker,
            "source": {
                "namespace": "victim",
                "interface": "agvictim0",
                "mac": "02:11:11:11:11:01",
            },
            "capture": {
                "interface": "usb2",
                "uplinkInterface": "usb2",
                "ready": True,
                "exitCode": 124,
                "packetCount": 1 if include_packet else 0,
                "byteCount": len(packet_bytes),
                "markerCount": 1 if include_packet else 0,
                "pcapPath": "%s/%s" % (evidence_prefix, pcap_name),
                "textPath": "%s/%s" % (evidence_prefix, pcap_text_name),
            },
            "server": {
                "ready": True,
                "exitCode": 0,
                "markerCount": 1 if include_packet else 0,
                "logPath": "%s/%s" % (evidence_prefix, server_log_name),
            },
        }
        with open(os.path.join(evidence_directory, observation_name), "w", encoding="utf-8") as observation_file:
            json.dump(observation, observation_file, indent=2, sort_keys=True)
            observation_file.write("\n")

    def generate(self):
        return subprocess.run(
            [
                "python3",
                os.path.join(self.scripts_directory, "generate-evidence.py"),
                "--run-id",
                self.run_id,
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def validate(self):
        return subprocess.run(
            [
                "python3",
                os.path.join(self.scripts_directory, "validate-results.py"),
                "--run-id",
                self.run_id,
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def read_derived_bytes(self):
        derived_paths = (
            os.path.join(self.test_experiment_root, "results", "normalized", "summary.json"),
            os.path.join(self.test_experiment_root, "results", "manifest.json"),
            os.path.join(self.test_experiment_root, "results", "SHA256SUMS"),
        )
        derivative_bytes = []
        for derived_path in derived_paths:
            with open(derived_path, "rb") as derived_file:
                derivative_bytes.append(derived_file.read())
        return tuple(derivative_bytes)

    def test_generation_and_validation_are_byte_reproducible(self):
        self.write_result(self.build_result())
        auxiliary_path = os.path.join(self.run_directory, "authorization-document.json")
        with open(auxiliary_path, "w", encoding="utf-8") as auxiliary_file:
            json.dump({"payload": "not a test result"}, auxiliary_file)

        first_generation = self.generate()
        self.assertEqual(first_generation.returncode, 0, first_generation.stderr)
        first_derivatives = self.read_derived_bytes()
        second_generation = self.generate()
        self.assertEqual(second_generation.returncode, 0, second_generation.stderr)
        self.assertEqual(self.read_derived_bytes(), first_derivatives)

        validation_process = self.validate()
        self.assertEqual(validation_process.returncode, 0, validation_process.stderr)
        with open(
            os.path.join(self.test_experiment_root, "results", "normalized", "summary.json"),
            "r",
            encoding="utf-8",
        ) as summary_file:
            summary = json.load(summary_file)
        self.assertEqual(
            summary["counts"],
            {"PASSED": 1, "FAILED": 0, "PARTIAL": 0, "NOT_RUN": 0, "BLOCKED": 0},
        )

    def test_incomplete_campaign_cannot_be_generated(self):
        self.write_result(self.build_result())
        self.write_campaign(complete=False)
        generation_process = self.generate()
        self.assertNotEqual(generation_process.returncode, 0)
        self.assertIn("incomplete", generation_process.stderr)

    def test_campaign_schema_and_identity_errors_are_rejected(self):
        self.write_result(self.build_result())

        self.write_campaign(complete=True, unexpectedField="not allowed")
        unexpected_field_process = self.generate()
        self.assertNotEqual(unexpected_field_process.returncode, 0)
        self.assertIn("schema error", unexpected_field_process.stderr)

        self.write_campaign(
            complete=True,
            expectedTests=[
                {"testId": "sample-test", "category": "isolation"},
                {"testId": "sample-test", "category": "fault"},
            ],
        )
        duplicate_expected_id_process = self.generate()
        self.assertNotEqual(duplicate_expected_id_process.returncode, 0)
        self.assertIn("duplicate expected test IDs", duplicate_expected_id_process.stderr)

        self.write_campaign(complete=True, runId="different-run")
        run_id_mismatch_process = self.generate()
        self.assertNotEqual(run_id_mismatch_process.returncode, 0)
        self.assertIn("runId does not match", run_id_mismatch_process.stderr)

    def test_duplicate_test_id_and_filename_mismatch_are_rejected(self):
        self.write_result(self.build_result())
        self.write_result(self.build_result(), result_name="z-duplicate.result.json")
        duplicate_process = self.generate()
        self.assertNotEqual(duplicate_process.returncode, 0)
        self.assertIn("duplicate testId", duplicate_process.stderr)

    def test_validator_rejects_false_pass_and_escaped_packets(self):
        self.write_result(
            self.build_result(
                exitCode=0,
                passed=True,
                status="FAILED",
                escapedPackets=2,
                escapedBytes=128,
            )
        )
        self.assertEqual(self.generate().returncode, 0)
        validation_process = self.validate()
        self.assertNotEqual(validation_process.returncode, 0)
        self.assertIn("FAILED cannot have exitCode=0", validation_process.stderr)

    def test_validator_recomputes_observation_from_pcap_and_server_log(self):
        self.write_result(self.build_result())
        self.assertEqual(self.generate().returncode, 0)
        observation_path = os.path.join(
            self.run_directory,
            "evidence",
            "sample-test-positive-control.observation.json",
        )
        with open(observation_path, "r", encoding="utf-8") as observation_file:
            observation = json.load(observation_file)
        observation["capture"]["markerCount"] = 0
        observation["server"]["markerCount"] = 0
        with open(observation_path, "w", encoding="utf-8") as observation_file:
            json.dump(observation, observation_file, indent=2, sort_keys=True)
            observation_file.write("\n")

        validation_process = self.validate()
        self.assertNotEqual(validation_process.returncode, 0)
        self.assertIn("pcap markerCount is not recomputable", validation_process.stderr)
        self.assertIn("server markerCount is not recomputable", validation_process.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
