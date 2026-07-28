#!/usr/bin/env python3
"""Validate strict user/assistant JSON and the immutable detection schemas."""

from __future__ import annotations

from common import (
    add_io_arguments,
    common_parser,
    emit_log,
    iter_jsonl,
    load_config,
    parse_record,
    repository_root,
    resolve_path,
    validate_input,
    validate_metadata,
    validate_output,
    write_json,
)


def schema_problems(record: dict) -> list[str]:
    try:
        detection_input, detection_output = parse_record(record)
    except ValueError as error:
        return [str(error)]
    return (
        validate_input(detection_input)
        + validate_output(detection_output)
        + validate_metadata(record.get("metadata"))
    )


def validate_records(records: list[dict]) -> tuple[list[dict], list[dict]]:
    accepted = []
    rejected = []
    for record in records:
        problems = schema_problems(record)
        if problems:
            rejected.append({"sampleId": record.get("sampleId"), "problems": problems})
        else:
            accepted.append(record)
    return accepted, rejected


def main() -> int:
    parser = common_parser(__doc__ or "Validate candidate schemas")
    add_io_arguments(parser)
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    load_config(arguments.config, root)
    if not arguments.input:
        parser.error("--input is required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    accepted, rejected = validate_records(records)
    report_path = resolve_path(root, arguments.output or "ml/reports/dataset-v02-schema-validation.json")
    write_json(
        report_path,
        {"total": len(records), "accepted": len(accepted), "rejected": len(rejected), "problems": rejected},
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log("schema_validation_complete", total=len(records), accepted=len(accepted), rejected=len(rejected))
    return 1 if rejected else 0


if __name__ == "__main__":
    raise SystemExit(main())
