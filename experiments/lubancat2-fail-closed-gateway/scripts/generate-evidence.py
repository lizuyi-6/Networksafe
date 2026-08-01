#!/usr/bin/env python3
"""Generate deterministic evidence metadata from one completed campaign."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath

import jsonschema


STATUS_VALUES = ("PASSED", "FAILED", "PARTIAL", "NOT_RUN", "BLOCKED")


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


def validate_schema(document, schema, document_label):
    schema_validator = jsonschema.Draft7Validator(
        schema,
        format_checker=jsonschema.FormatChecker(),
    )
    schema_errors = sorted(schema_validator.iter_errors(document), key=lambda error: list(error.path))
    if schema_errors:
        first_error = schema_errors[0]
        error_path = ".".join(str(path_part) for path_part in first_error.path) or "<root>"
        raise SystemExit(
            "%s schema error at %s: %s"
            % (document_label, error_path, first_error.message)
        )


def write_bytes_atomic(output_path, output_bytes):
    temporary_path = output_path.with_name(".%s.%d.tmp" % (output_path.name, os.getpid()))
    with temporary_path.open("xb") as temporary_file:
        temporary_file.write(output_bytes)
        temporary_file.flush()
        os.fsync(temporary_file.fileno())
    os.replace(temporary_path, output_path)
    directory_descriptor = os.open(
        output_path.parent,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
    )
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def write_json_atomic(output_path, document):
    encoded_document = (
        json.dumps(document, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    ).encode("ascii")
    write_bytes_atomic(output_path, encoded_document)


def calculate_file_digest(file_path):
    digest = hashlib.sha256()
    with file_path.open("rb") as input_file:
        for file_chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(file_chunk)
    return digest.hexdigest()


def load_completed_campaign(run_directory, run_id, campaign_schema=None):
    campaign_path = run_directory / "campaign.json"
    if not campaign_path.is_file():
        raise SystemExit("run lacks campaign.json: %s" % run_directory)
    campaign = read_json(campaign_path)
    if campaign_schema is not None:
        validate_schema(campaign, campaign_schema, "campaign")
    if campaign.get("resultKind") != "campaign" or campaign.get("schemaVersion") != 1:
        raise SystemExit("campaign metadata kind or version is invalid")
    if campaign.get("runId") != run_id:
        raise SystemExit("campaign runId does not match its directory")
    if campaign.get("complete") is not True or not campaign.get("finishedAt"):
        raise SystemExit("campaign is incomplete and cannot become primary")
    if campaign.get("sourceTreeDirty") is True:
        raise SystemExit("campaign records a dirty source tree and cannot become primary")
    deployment_artifacts = campaign.get("deploymentArtifacts", [])
    artifact_names = [artifact.get("name") for artifact in deployment_artifacts]
    artifact_repository_paths = [artifact.get("repositoryPath") for artifact in deployment_artifacts]
    artifact_remote_paths = [artifact.get("remotePath") for artifact in deployment_artifacts]
    for path_label, artifact_paths, must_be_absolute in (
        ("repository", artifact_repository_paths, False),
        ("remote", artifact_remote_paths, True),
    ):
        for artifact_path in artifact_paths:
            parsed_path = PurePosixPath(artifact_path)
            if parsed_path.is_absolute() is not must_be_absolute or ".." in parsed_path.parts:
                raise SystemExit("campaign artifact %s path is unsafe: %s" % (path_label, artifact_path))
    for identity_label, identity_values in (
        ("name", artifact_names),
        ("repository path", artifact_repository_paths),
        ("remote path", artifact_remote_paths),
    ):
        if len(identity_values) != len(set(identity_values)):
            raise SystemExit("campaign has duplicate artifact %s values" % identity_label)
    expected_tests = campaign.get("expectedTests")
    if not isinstance(expected_tests, list) or not expected_tests:
        raise SystemExit("campaign expectedTests is empty or invalid")
    expected_test_ids = [expected_test.get("testId") for expected_test in expected_tests]
    if any(not isinstance(test_id, str) or not test_id for test_id in expected_test_ids):
        raise SystemExit("campaign has an invalid expected test ID")
    if len(expected_test_ids) != len(set(expected_test_ids)):
        raise SystemExit("campaign has duplicate expected test IDs")
    return campaign


def load_test_results(run_directory, campaign, result_schema=None):
    result_paths = sorted(run_directory.glob("*.result.json"))
    if not result_paths:
        raise SystemExit("run has no committed test result JSON")

    test_results = []
    result_paths_by_test_id = {}
    for result_path in result_paths:
        test_result = read_json(result_path)
        if result_schema is not None:
            validate_schema(test_result, result_schema, str(result_path))
        test_id = test_result.get("testId")
        if test_result.get("resultKind") != "test-result":
            raise SystemExit("resultKind mismatch: %s" % result_path)
        if test_id in result_paths_by_test_id:
            raise SystemExit(
                "duplicate testId %s in %s and %s"
                % (test_id, result_paths_by_test_id[test_id], result_path)
            )
        expected_name = "%s.result.json" % test_id
        if result_path.name != expected_name:
            raise SystemExit(
                "result filename does not match testId: %s != %s"
                % (result_path.name, expected_name)
            )
        result_paths_by_test_id[test_id] = result_path
        test_results.append(test_result)

    expected_by_id = {
        expected_test["testId"]: expected_test for expected_test in campaign["expectedTests"]
    }
    if set(result_paths_by_test_id) != set(expected_by_id):
        missing_ids = sorted(set(expected_by_id) - set(result_paths_by_test_id))
        unexpected_ids = sorted(set(result_paths_by_test_id) - set(expected_by_id))
        raise SystemExit(
            "campaign result set mismatch missing=%s unexpected=%s"
            % (missing_ids, unexpected_ids)
        )
    for test_result in test_results:
        expected_test = expected_by_id[test_result["testId"]]
        if test_result.get("runId") != campaign["runId"]:
            raise SystemExit("result runId mismatch: %s" % test_result["testId"])
        if test_result.get("category") != expected_test.get("category"):
            raise SystemExit("result category mismatch: %s" % test_result["testId"])
        if test_result.get("gatewayCommit") != campaign.get("gatewayCommit"):
            raise SystemExit("result gateway commit mismatch: %s" % test_result["testId"])
        if test_result.get("transport") != campaign.get("transport"):
            raise SystemExit("result transport mismatch: %s" % test_result["testId"])
    return test_results


def build_summary(campaign, test_results):
    counts = {status: 0 for status in STATUS_VALUES}
    summary_tests = []
    for test_result in sorted(test_results, key=lambda result: result["testId"]):
        counts[test_result["status"]] += 1
        summary_tests.append(
            {
                "testId": test_result["testId"],
                "category": test_result["category"],
                "status": test_result["status"],
                "reasonCode": test_result["reasonCode"],
                "exitCode": test_result["exitCode"],
                "evidenceFiles": test_result["evidenceFiles"],
            }
        )
    return {
        "experiment": "aetherguard-cat2-fail-closed-gateway",
        "generatedAt": campaign["finishedAt"],
        "sourceRunId": campaign["runId"],
        "gatewayCommits": [campaign["gatewayCommit"]],
        "transports": [campaign["transport"]],
        "protectedEndpointScope": "single-path Linux network namespace",
        "evaluatedGatewayScope": "physically separate SBC gateway prototype using two logical USB RNDIS data interfaces",
        "counts": counts,
        "tests": summary_tests,
        "claimBoundaries": {
            "physicalEthernet": "NOT_RUN unless a dedicated result says otherwise",
            "physicalHostRoot": "NOT_RUN: the protected endpoint is a victim network namespace",
            "performance": "NOT_RUN unless dedicated measured results are present",
            "hardwareEnforcement": "NOT_CLAIMED: no relay, Secure Element, or Cat2-root resistance was evaluated",
            "reboot": "No persistent-topology claim unless dedicated reboot evidence is PASSED",
        },
    }


def collect_manifest_paths(experiment_root, run_directory, summary_path):
    manifest_paths = {
        raw_path for raw_path in run_directory.rglob("*") if raw_path.is_file()
    }
    manifest_paths.update(
        {
            summary_path,
            experiment_root / "schemas" / "test-result.schema.json",
            experiment_root / "schemas" / "campaign.schema.json",
            experiment_root / "schemas" / "gateway-status.schema.json",
            experiment_root / "schemas" / "traffic-observation.schema.json",
            experiment_root / "scripts" / "generate-evidence.py",
            experiment_root / "scripts" / "validate-results.py",
        }
    )
    return sorted(manifest_paths)


def build_manifest_entry(experiment_root, manifest_path, run_id):
    relative_path = manifest_path.relative_to(experiment_root).as_posix()
    primary_prefix = "results/raw/%s/" % run_id
    is_primary_evidence = relative_path.startswith(primary_prefix)
    return {
        "path": relative_path,
        "sha256": calculate_file_digest(manifest_path),
        "bytes": manifest_path.stat().st_size,
        "classification": "primary" if is_primary_evidence else "supporting",
        "primaryEvidence": is_primary_evidence,
        "note": "completed primary campaign" if is_primary_evidence else "validation input",
    }


def main():
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--run-id", required=True)
    arguments = argument_parser.parse_args()

    experiment_root = Path(__file__).resolve().parent.parent
    run_directory = experiment_root / "results" / "raw" / arguments.run_id
    if not run_directory.is_dir():
        raise SystemExit("run directory does not exist: %s" % run_directory)

    campaign_schema = read_json(experiment_root / "schemas" / "campaign.schema.json")
    result_schema = read_json(experiment_root / "schemas" / "test-result.schema.json")
    campaign = load_completed_campaign(run_directory, arguments.run_id, campaign_schema)
    test_results = load_test_results(run_directory, campaign, result_schema)
    summary_path = experiment_root / "results" / "normalized" / "summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(summary_path, build_summary(campaign, test_results))

    manifest_entries = [
        build_manifest_entry(experiment_root, manifest_path, arguments.run_id)
        for manifest_path in collect_manifest_paths(experiment_root, run_directory, summary_path)
    ]
    manifest_document = {
        "generatedAt": campaign["finishedAt"],
        "primaryRunId": arguments.run_id,
        "fileCount": len(manifest_entries),
        "files": manifest_entries,
    }
    manifest_path = experiment_root / "results" / "manifest.json"
    write_json_atomic(manifest_path, manifest_document)

    checksum_bytes = "".join(
        "%s  %s\n" % (manifest_entry["sha256"], manifest_entry["path"])
        for manifest_entry in manifest_entries
    ).encode("ascii")
    write_bytes_atomic(experiment_root / "results" / "SHA256SUMS", checksum_bytes)

    print(
        json.dumps(
            {
                "runId": arguments.run_id,
                "testCount": len(test_results),
                "manifestFileCount": len(manifest_entries),
                "summary": summary_path.relative_to(experiment_root).as_posix(),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
