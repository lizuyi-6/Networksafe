#!/usr/bin/env python3
"""Apply deterministic verdict/family/severity/action consistency checks."""

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
    validate_label_consistency,
    write_json,
)


def label_problems(record: dict) -> list[str]:
    try:
        _detection_input, detection_output = parse_record(record)
    except ValueError as error:
        return [str(error)]
    return validate_label_consistency(detection_output)


def main() -> int:
    parser = common_parser(__doc__ or "Validate labels")
    add_io_arguments(parser)
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    load_config(arguments.config, root)
    if not arguments.input:
        parser.error("--input is required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    rejected = [
        {"sampleId": record.get("sampleId"), "problems": problems}
        for record in records
        if (problems := label_problems(record))
    ]
    write_json(
        resolve_path(root, arguments.output or "ml/reports/dataset-v02-label-validation.json"),
        {"total": len(records), "accepted": len(records) - len(rejected), "rejected": len(rejected), "problems": rejected},
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log("label_validation_complete", total=len(records), rejected=len(rejected))
    return 1 if rejected else 0


if __name__ == "__main__":
    raise SystemExit(main())
