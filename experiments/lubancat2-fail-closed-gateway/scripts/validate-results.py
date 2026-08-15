#!/usr/bin/env python3
"""Validate one completed Cat2 campaign and all deterministic derivatives."""

import argparse
import importlib.util
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

import jsonschema


NON_PASS_EXIT_CODES = {"PARTIAL": 3, "NOT_RUN": 4, "BLOCKED": 5}
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
# Set in main(): when True (inside a git work tree) evidence must be tracked.
_GIT_TRACKING_ENABLED = False


def is_inside_git_repository(experiment_root):
    try:
        completed_process = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(experiment_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed_process.returncode == 0 and completed_process.stdout.strip() == "true"


def evidence_is_git_tracked(experiment_root, relative_path_text):
    # Primary evidence, traffic-observation pcaps and result-referenced evidence
    # must be committed, not merely present on a developer's working tree. A
    # clean checkout must reproduce validation, so an untracked local file is a
    # hard failure (EVIDENCE_NOT_GIT_TRACKED), never a warning.
    try:
        completed_process = subprocess.run(
            ["git", "ls-files", "--error-unmatch", relative_path_text],
            cwd=str(experiment_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("git tracking check failed for %s: %s" % (relative_path_text, error))
    return completed_process.returncode == 0


class ValidationFailures:
    def __init__(self):
        self.messages = []

    def require(self, condition, message):
        if not condition:
            self.messages.append(message)

    def fail(self, message):
        self.messages.append(message)


def reject_duplicate_object_keys(object_pairs):
    parsed_object = {}
    for object_key, object_value in object_pairs:
        if object_key in parsed_object:
            raise ValueError("duplicate JSON object key: %s" % object_key)
        parsed_object[object_key] = object_value
    return parsed_object


def reject_nonstandard_json_constant(constant_text):
    raise ValueError("non-standard JSON constant: %s" % constant_text)


def read_json(json_path):
    with json_path.open("r", encoding="utf-8") as json_file:
        return json.load(
            json_file,
            object_pairs_hook=reject_duplicate_object_keys,
            parse_constant=reject_nonstandard_json_constant,
        )


def load_generator_module(script_path):
    module_spec = importlib.util.spec_from_file_location("ag_evidence_generator", script_path)
    generator_module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(generator_module)
    return generator_module


def resolve_primary_evidence_file(
    experiment_root,
    run_directory,
    evidence_path_text,
    evidence_label,
    failures,
):
    if not isinstance(evidence_path_text, str) or not evidence_path_text:
        failures.fail("%s: evidence path is not a non-empty string" % evidence_label)
        return None
    relative_path = Path(evidence_path_text)
    if relative_path.is_absolute():
        failures.fail("%s: absolute evidence path is forbidden: %s" % (evidence_label, evidence_path_text))
        return None
    evidence_path = experiment_root / relative_path
    try:
        resolved_path = evidence_path.resolve(strict=True)
        resolved_path.relative_to(experiment_root.resolve())
        resolved_path.relative_to(run_directory.resolve())
    except (OSError, ValueError):
        failures.fail("%s: evidence path escapes or is missing: %s" % (evidence_label, evidence_path_text))
        return None
    if evidence_path.is_symlink() or not evidence_path.is_file():
        failures.fail("%s: evidence path is not a regular non-symlink file: %s" % (evidence_label, evidence_path_text))
        return None
    # Version-control integrity: a local-only file is not acceptable evidence.
    # The validator must fail with EVIDENCE_NOT_GIT_TRACKED so a clean checkout
    # can reproduce the verdict instead of silently depending on ignored files.
    if _GIT_TRACKING_ENABLED and not evidence_is_git_tracked(experiment_root, evidence_path_text):
        failures.fail(
            "EVIDENCE_NOT_GIT_TRACKED %s: %s" % (evidence_label, evidence_path_text)
        )
        return None
    return evidence_path


def read_classic_pcap_metrics(pcap_path, marker_bytes):
    pcap_bytes = pcap_path.read_bytes()
    endianness_by_magic = {
        b"\xa1\xb2\xc3\xd4": ">",
        b"\xd4\xc3\xb2\xa1": "<",
        b"\xa1\xb2\x3c\x4d": ">",
        b"\x4d\x3c\xb2\xa1": "<",
    }
    if len(pcap_bytes) < 24 or pcap_bytes[:4] not in endianness_by_magic:
        raise ValueError("not a complete classic pcap file")
    endianness = endianness_by_magic[pcap_bytes[:4]]
    major_version, minor_version = struct.unpack_from(endianness + "HH", pcap_bytes, 4)
    if (major_version, minor_version) != (2, 4):
        raise ValueError("unsupported pcap version")

    packet_count = 0
    captured_byte_count = 0
    marker_count = 0
    record_offset = 24
    while record_offset < len(pcap_bytes):
        if len(pcap_bytes) - record_offset < 16:
            raise ValueError("truncated pcap packet header")
        _, _, included_length, original_length = struct.unpack_from(
            endianness + "IIII", pcap_bytes, record_offset
        )
        record_offset += 16
        if included_length > original_length or included_length > 64 * 1024 * 1024:
            raise ValueError("invalid pcap packet length")
        if len(pcap_bytes) - record_offset < included_length:
            raise ValueError("truncated pcap packet payload")
        packet_bytes = pcap_bytes[record_offset:record_offset + included_length]
        marker_count += packet_bytes.count(marker_bytes)
        record_offset += included_length
        packet_count += 1
        captured_byte_count += original_length
    return packet_count, captured_byte_count, marker_count


def validate_traffic_observations(
    experiment_root,
    run_directory,
    result_path,
    result,
    observation_schema_validator,
    failures,
):
    result_label = result_path.relative_to(experiment_root).as_posix()
    evidence_file_values = result.get("evidenceFiles", [])
    evidence_files = set(evidence_file_values) if isinstance(evidence_file_values, list) else set()
    observation_path_values = result.get("trafficObservations", [])
    observation_paths = observation_path_values if isinstance(observation_path_values, list) else []
    observed_expectations = []
    observed_phases = set()

    for observation_path_text in observation_paths:
        observation_label = "%s traffic observation %s" % (result_label, observation_path_text)
        failures.require(
            observation_path_text in evidence_files,
            "%s: observation is not listed in evidenceFiles" % observation_label,
        )
        observation_path = resolve_primary_evidence_file(
            experiment_root,
            run_directory,
            observation_path_text,
            observation_label,
            failures,
        )
        if observation_path is None:
            continue
        try:
            observation = read_json(observation_path)
        except (OSError, ValueError) as error:
            failures.fail("%s: invalid JSON: %s" % (observation_label, error))
            continue
        if not isinstance(observation, dict):
            failures.fail("%s: observation root is not an object" % observation_label)
            continue
        for schema_error in sorted(
            observation_schema_validator.iter_errors(observation),
            key=lambda error: list(error.path),
        ):
            failures.fail(
                "%s: schema error at %s: %s"
                % (
                    observation_label,
                    ".".join(str(path_part) for path_part in schema_error.path) or "<root>",
                    schema_error.message,
                )
            )

        phase_name = observation.get("phase")
        expectation = observation.get("expectation")
        observed_expectations.append(expectation if isinstance(expectation, str) else "<invalid>")
        if isinstance(phase_name, str):
            failures.require(
                phase_name not in observed_phases,
                "%s: duplicate phase %s" % (result_label, phase_name),
            )
            observed_phases.add(phase_name)
        failures.require(observation.get("runId") == result.get("runId"), "%s: runId mismatch" % observation_label)
        failures.require(observation.get("testId") == result.get("testId"), "%s: testId mismatch" % observation_label)
        failures.require(
            observation_path.name == "%s-%s.observation.json" % (result.get("testId"), phase_name),
            "%s: filename does not bind testId and phase" % observation_label,
        )

        capture_value = observation.get("capture", {})
        server_value = observation.get("server", {})
        capture = capture_value if isinstance(capture_value, dict) else {}
        server = server_value if isinstance(server_value, dict) else {}
        failures.require(capture.get("interface") == result.get("captureInterface"), "%s: capture interface mismatch" % observation_label)
        failures.require(capture.get("uplinkInterface") == result.get("uplinkInterface"), "%s: UPLINK_IF mismatch" % observation_label)
        failures.require(capture.get("ready") is True, "%s: capture readiness was not observed" % observation_label)
        failures.require(capture.get("exitCode") == 124, "%s: capture did not end by the expected timeout" % observation_label)
        failures.require(server.get("ready") is True, "%s: server readiness was not observed" % observation_label)
        failures.require(server.get("exitCode") == 0, "%s: marker server exited unsuccessfully" % observation_label)

        internal_paths = {
            "pcap": capture.get("pcapPath"),
            "pcap text": capture.get("textPath"),
            "server log": server.get("logPath"),
        }
        resolved_internal_paths = {}
        for internal_label, internal_path_text in internal_paths.items():
            failures.require(
                internal_path_text in evidence_files,
                "%s: %s is not listed in evidenceFiles" % (observation_label, internal_label),
            )
            resolved_internal_paths[internal_label] = resolve_primary_evidence_file(
                experiment_root,
                run_directory,
                internal_path_text,
                "%s %s" % (observation_label, internal_label),
                failures,
            )
        if any(path is None for path in resolved_internal_paths.values()):
            continue

        marker = observation.get("marker")
        if not isinstance(marker, str):
            continue
        try:
            marker_bytes = marker.encode("ascii")
            recomputed_packet_count, recomputed_byte_count, recomputed_capture_marker_count = read_classic_pcap_metrics(
                resolved_internal_paths["pcap"], marker_bytes
            )
            server_bytes = resolved_internal_paths["server log"].read_bytes()
            recomputed_server_marker_count = server_bytes.count(marker_bytes)
        except (OSError, UnicodeError, ValueError) as error:
            failures.fail("%s: cannot recompute traffic evidence: %s" % (observation_label, error))
            continue

        failures.require(capture.get("packetCount") == recomputed_packet_count, "%s: pcap packetCount is not recomputable" % observation_label)
        failures.require(capture.get("byteCount") == recomputed_byte_count, "%s: pcap byteCount is not recomputable" % observation_label)
        failures.require(capture.get("markerCount") == recomputed_capture_marker_count, "%s: pcap markerCount is not recomputable" % observation_label)
        failures.require(server.get("markerCount") == recomputed_server_marker_count, "%s: server markerCount is not recomputable" % observation_label)

        if expectation == "RELEASED_REACHABLE":
            failures.require(recomputed_packet_count > 0, "%s: released pcap is empty" % observation_label)
            failures.require(recomputed_capture_marker_count > 0, "%s: released marker is absent from pcap packet bytes" % observation_label)
            failures.require(recomputed_server_marker_count > 0, "%s: released marker is absent from server log" % observation_label)
        elif expectation == "ISOLATED_BLOCKED":
            failures.require(recomputed_packet_count == 0, "%s: isolated pcap contains victim packets" % observation_label)
            failures.require(recomputed_byte_count == 0, "%s: isolated pcap contains victim bytes" % observation_label)
            failures.require(recomputed_capture_marker_count == 0, "%s: isolated marker is present in pcap" % observation_label)
            failures.require(recomputed_server_marker_count == 0, "%s: isolated marker reached server" % observation_label)

    expected_expectations_by_profile = {
        "NONE": [],
        "RELEASE_POSITIVE": ["RELEASED_REACHABLE"],
        "ISOLATED_NEGATIVE_WITH_CONTROL": ["ISOLATED_BLOCKED", "RELEASED_REACHABLE"],
        "RELEASE_THEN_ISOLATED": ["ISOLATED_BLOCKED", "RELEASED_REACHABLE"],
    }
    if result.get("status") == "PASSED":
        expected_expectations = expected_expectations_by_profile.get(result.get("trafficProfile"), [])
        failures.require(
            sorted(observed_expectations) == sorted(expected_expectations),
            "%s: traffic observation phases do not satisfy profile %s"
            % (result_label, result.get("trafficProfile")),
        )


def validate_result_semantics(
    experiment_root,
    run_directory,
    result_path,
    result,
    observation_schema_validator,
    failures,
):
    result_label = result_path.relative_to(experiment_root).as_posix()
    failures.require(result.get("runId") == result_path.parent.name, "%s: runId mismatch" % result_label)
    failures.require(
        result_path.name == "%s.result.json" % result.get("testId"),
        "%s: filename does not match testId" % result_label,
    )
    expected_text_path = result_path.with_name("%s.txt" % result.get("testId"))
    failures.require(expected_text_path.is_file(), "%s: matching plaintext result is missing" % result_label)

    result_status = result.get("status")
    result_exit_code = result.get("exitCode")
    result_passed = result.get("passed")
    if result_status == "PASSED":
        failures.require(result_exit_code == 0, "%s: PASSED must have exitCode=0" % result_label)
        failures.require(result_passed is True, "%s: PASSED must have passed=true" % result_label)
        failures.require(result.get("cleanupSucceeded") is True, "%s: PASSED cleanup must succeed" % result_label)
        failures.require(result.get("stateAfter") == "isolated", "%s: PASSED must finish isolated" % result_label)
        failures.require(result.get("managementAvailable") is True, "%s: PASSED must retain management" % result_label)
    elif result_status == "FAILED":
        failures.require(result_exit_code != 0, "%s: FAILED cannot have exitCode=0" % result_label)
        failures.require(result_passed is False, "%s: FAILED must have passed=false" % result_label)
    elif result_status in NON_PASS_EXIT_CODES:
        failures.require(
            result_exit_code == NON_PASS_EXIT_CODES[result_status],
            "%s: %s must have exitCode=%d"
            % (result_label, result_status, NON_PASS_EXIT_CODES[result_status]),
        )
        failures.require(result_passed is False, "%s: %s must have passed=false" % (result_label, result_status))

    if result_status == "PASSED":
        failures.require(
            result.get("unauthorizedConnections") == 0,
            "%s: PASSED has unauthorized connections" % result_label,
        )
        failures.require(result.get("escapedPackets") == 0, "%s: PASSED has escaped packets" % result_label)
        failures.require(result.get("escapedBytes") == 0, "%s: PASSED has escaped bytes" % result_label)
        failures.require(
            result.get("protectedEndpoint") == "netns:victim/agvictim0",
            "%s: protected endpoint is not exact victim/agvictim0 scope" % result_label,
        )
        failures.require(
            result.get("captureInterface") == result.get("uplinkInterface"),
            "%s: capture interface differs from UPLINK_IF" % result_label,
        )

    evidence_files = result.get("evidenceFiles", [])
    if result_status == "PASSED":
        failures.require(bool(evidence_files), "%s: PASSED lacks evidence" % result_label)
    for evidence_path_text in evidence_files:
        resolve_primary_evidence_file(
            experiment_root,
            run_directory,
            evidence_path_text,
            result_label,
            failures,
        )

    if result_status == "PASSED":
        traffic_profile = result.get("trafficProfile")
        if traffic_profile == "RELEASE_POSITIVE":
            failures.require(result.get("probeCommandExecuted") is True, "%s: release probe was not executed" % result_label)
            failures.require(result.get("probeReachedUpstream") is True, "%s: released marker did not reach upstream" % result_label)
            failures.require(result.get("packetObservedOnUplink") is True, "%s: released marker was not observed on UPLINK" % result_label)
            failures.require(result.get("uplinkObservedPackets", 0) > 0, "%s: released UPLINK packet count is zero" % result_label)
        elif traffic_profile == "ISOLATED_NEGATIVE_WITH_CONTROL":
            failures.require(result.get("probeCommandExecuted") is True, "%s: isolated probe was not executed" % result_label)
            failures.require(result.get("probeReachedUpstream") is False, "%s: isolated marker reached upstream" % result_label)
            failures.require(result.get("packetObservedOnUplink") is False, "%s: isolated packet appeared on UPLINK" % result_label)
            failures.require(result.get("uplinkObservedPackets") == 0, "%s: isolated UPLINK packet count is nonzero" % result_label)
            failures.require(
                any("positive-control" in evidence_path for evidence_path in evidence_files),
                "%s: isolated verdict lacks same-observer positive control evidence" % result_label,
            )
        elif traffic_profile == "RELEASE_THEN_ISOLATED":
            failures.require(result.get("probeCommandExecuted") is True, "%s: timed probe was not executed" % result_label)
            failures.require(result.get("probeReachedUpstream") is False, "%s: final isolated marker reached upstream" % result_label)
            failures.require(result.get("packetObservedOnUplink") is False, "%s: final isolated packet appeared on UPLINK" % result_label)
            failures.require(result.get("uplinkObservedPackets", 0) > 0, "%s: released phase lacks positive UPLINK evidence" % result_label)
            failures.require(
                any("during" in evidence_path or "positive-control" in evidence_path for evidence_path in evidence_files),
                "%s: released phase evidence is missing" % result_label,
            )
        elif traffic_profile == "NONE":
            failures.require(result.get("probeCommandExecuted") is False, "%s: NONE profile records an executed probe" % result_label)
            failures.require(result.get("probeReachedUpstream") is None, "%s: NONE profile fabricates upstream reachability" % result_label)
            failures.require(result.get("packetObservedOnUplink") is None, "%s: NONE profile fabricates UPLINK observation" % result_label)
            failures.require(result.get("uplinkObservedPackets") == 0, "%s: NONE profile has UPLINK packets" % result_label)

    validate_traffic_observations(
        experiment_root,
        run_directory,
        result_path,
        result,
        observation_schema_validator,
        failures,
    )


def validate_summary(generator_module, campaign, test_results, summary, failures):
    expected_summary = generator_module.build_summary(campaign, test_results)
    failures.require(summary == expected_summary, "summary is not the deterministic campaign derivative")


def validate_manifest_and_checksums(
    generator_module,
    experiment_root,
    run_directory,
    run_id,
    manifest,
    checksum_lines,
    failures,
):
    summary_path = experiment_root / "results" / "normalized" / "summary.json"
    expected_entries = [
        generator_module.build_manifest_entry(experiment_root, manifest_path, run_id)
        for manifest_path in generator_module.collect_manifest_paths(
            experiment_root,
            run_directory,
            summary_path,
        )
    ]
    expected_manifest = {
        "generatedAt": read_json(run_directory / "campaign.json")["finishedAt"],
        "primaryRunId": run_id,
        "fileCount": len(expected_entries),
        "files": expected_entries,
    }
    failures.require(manifest == expected_manifest, "manifest is not the exact deterministic file inventory")

    parsed_checksum_lines = []
    observed_paths = set()
    for line_number, checksum_line in enumerate(checksum_lines, start=1):
        if not checksum_line.strip():
            continue
        try:
            checksum_digest, checksum_path = checksum_line.rstrip("\n").split("  ", 1)
        except ValueError:
            failures.fail("SHA256SUMS:%d malformed line" % line_number)
            continue
        failures.require(
            bool(SHA256_PATTERN.fullmatch(checksum_digest)),
            "SHA256SUMS:%d invalid digest" % line_number,
        )
        failures.require(checksum_path not in observed_paths, "SHA256SUMS duplicate path: %s" % checksum_path)
        observed_paths.add(checksum_path)
        parsed_checksum_lines.append((checksum_digest, checksum_path))
    expected_checksum_lines = [
        (manifest_entry["sha256"], manifest_entry["path"])
        for manifest_entry in expected_entries
    ]
    failures.require(
        parsed_checksum_lines == expected_checksum_lines,
        "SHA256SUMS is not the ordered deterministic manifest projection",
    )

    primary_prefix = "results/raw/%s/" % run_id
    for manifest_entry in manifest.get("files", []):
        path_is_primary = manifest_entry.get("path", "").startswith(primary_prefix)
        failures.require(
            manifest_entry.get("primaryEvidence") is path_is_primary,
            "manifest primaryEvidence is not derived from primaryRunId: %s" % manifest_entry.get("path"),
        )
        failures.require(
            manifest_entry.get("classification") == ("primary" if path_is_primary else "supporting"),
            "manifest classification is not path-derived: %s" % manifest_entry.get("path"),
        )
        # Every primary-evidence manifest entry must be tracked by git (when
        # running inside a work tree) so the manifest cannot reference an
        # ignored, developer-local file.
        if path_is_primary and _GIT_TRACKING_ENABLED:
            manifest_path_text = manifest_entry.get("path", "")
            if manifest_path_text and not evidence_is_git_tracked(experiment_root, manifest_path_text):
                failures.fail(
                    "EVIDENCE_NOT_GIT_TRACKED manifest primary evidence: %s" % manifest_path_text
                )


def main():
    global _GIT_TRACKING_ENABLED
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--run-id", help="must equal manifest.primaryRunId when supplied")
    arguments = argument_parser.parse_args()

    experiment_root = Path(__file__).resolve().parent.parent
    _GIT_TRACKING_ENABLED = is_inside_git_repository(experiment_root)
    failures = ValidationFailures()
    generator_module = load_generator_module(experiment_root / "scripts" / "generate-evidence.py")
    try:
        result_schema = read_json(experiment_root / "schemas" / "test-result.schema.json")
        campaign_schema = read_json(experiment_root / "schemas" / "campaign.schema.json")
        observation_schema = read_json(experiment_root / "schemas" / "traffic-observation.schema.json")
        manifest = read_json(experiment_root / "results" / "manifest.json")
        summary = read_json(experiment_root / "results" / "normalized" / "summary.json")
    except (OSError, ValueError) as error:
        print("VALIDATION_FAILED unable to load metadata: %s" % error, file=sys.stderr)
        return 1

    manifest_run_id = manifest.get("primaryRunId")
    run_id = arguments.run_id or manifest_run_id
    failures.require(run_id == manifest_run_id, "requested runId differs from manifest.primaryRunId")
    run_directory = experiment_root / "results" / "raw" / str(run_id)
    failures.require(run_directory.is_dir(), "primary run directory does not exist: %s" % run_id)

    try:
        campaign = generator_module.load_completed_campaign(
            run_directory,
            str(run_id),
            campaign_schema,
        )
        test_results = generator_module.load_test_results(
            run_directory,
            campaign,
            result_schema,
        )
    except (OSError, ValueError, SystemExit) as error:
        failures.fail("campaign/result inventory invalid: %s" % error)
        campaign = None
        test_results = []

    schema_validator = jsonschema.Draft7Validator(
        result_schema,
        format_checker=jsonschema.FormatChecker(),
    )
    observation_schema_validator = jsonschema.Draft7Validator(
        observation_schema,
        format_checker=jsonschema.FormatChecker(),
    )
    result_paths = sorted(run_directory.glob("*.result.json")) if run_directory.is_dir() else []
    seen_test_ids = set()
    for result_path in result_paths:
        try:
            result = read_json(result_path)
        except (OSError, ValueError) as error:
            failures.fail("%s: invalid JSON: %s" % (result_path, error))
            continue
        if not isinstance(result, dict):
            failures.fail("%s: result root is not an object" % result_path)
            continue
        test_id = result.get("testId")
        failures.require(test_id not in seen_test_ids, "duplicate testId: %s" % test_id)
        seen_test_ids.add(test_id)
        for schema_error in sorted(schema_validator.iter_errors(result), key=lambda error: list(error.path)):
            failures.fail(
                "%s: schema error at %s: %s"
                % (
                    result_path.relative_to(experiment_root),
                    ".".join(str(path_part) for path_part in schema_error.path) or "<root>",
                    schema_error.message,
                )
            )
        validate_result_semantics(
            experiment_root,
            run_directory,
            result_path,
            result,
            observation_schema_validator,
            failures,
        )

    if campaign is not None:
        validate_summary(generator_module, campaign, test_results, summary, failures)

    checksums_path = experiment_root / "results" / "SHA256SUMS"
    try:
        checksum_lines = checksums_path.read_text(encoding="ascii").splitlines(keepends=True)
    except OSError as error:
        failures.fail("cannot read SHA256SUMS: %s" % error)
        checksum_lines = []
    if run_directory.is_dir():
        validate_manifest_and_checksums(
            generator_module,
            experiment_root,
            run_directory,
            str(run_id),
            manifest,
            checksum_lines,
            failures,
        )

    if failures.messages:
        for failure_message in failures.messages:
            print("VALIDATION_FAILED %s" % failure_message, file=sys.stderr)
        print("VALIDATION_FAILED count=%d" % len(failures.messages), file=sys.stderr)
        return 1

    print(
        "VALIDATION_PASSED runId=%s testResults=%d manifestFiles=%d"
        % (run_id, len(test_results), manifest.get("fileCount"))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
