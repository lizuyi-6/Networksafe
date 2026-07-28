#!/usr/bin/env python3
"""Import authorized external candidate JSONL without inventing provenance or labels."""

from __future__ import annotations

import json
from pathlib import Path

from common import (
    add_io_arguments,
    common_parser,
    emit_log,
    iter_jsonl,
    load_config,
    refresh_record_hashes,
    repository_root,
    resolve_path,
    validate_record,
    write_jsonl,
)
from redact_sensitive_data import redact_records


ALLOWED_PROVENANCE = {
    "synthetic_external",
    "authorized_lab",
    "authorized_sanitized_real",
    "external_unverified",
}


def main() -> int:
    parser = common_parser(__doc__ or "Import external candidates")
    add_io_arguments(parser)
    parser.add_argument(
        "--provenance",
        default="external_unverified",
        choices=sorted(ALLOWED_PROVENANCE),
        help="Truthful source classification; real data must already be authorized and sanitized.",
    )
    parser.add_argument("--source-name", required=True, help="Non-sensitive source or collection identifier.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    if not arguments.input or not arguments.output:
        parser.error("--input and --output are required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    imported = []
    rejected = 0
    for index, source_record in enumerate(records):
        record = json.loads(json.dumps(source_record, ensure_ascii=False))
        if validate_record(record):
            rejected += 1
            continue
        metadata = record["metadata"]
        metadata["provenance"] = arguments.provenance
        metadata["sourceDataset"] = arguments.source_name
        metadata["sourceFile"] = "external-import"
        metadata["synthetic"] = arguments.provenance != "authorized_sanitized_real"
        metadata["reviewStatus"] = "pending"
        metadata["generatorModel"] = metadata.get("generatorModel") or "external-unknown"
        metadata["generatorPromptVersion"] = metadata.get("generatorPromptVersion") or "external-unknown"
        metadata["datasetVersion"] = config["version"]
        metadata["sourceSampleId"] = metadata.get("sourceSampleId") or f"external-{index:08d}"
        imported.append(refresh_record_hashes(record))
    imported, replacements = redact_records(imported)
    write_jsonl(resolve_path(root, arguments.output), imported, dry_run=arguments.dry_run, resume=arguments.resume)
    emit_log(
        "external_import_complete",
        input=len(records),
        output=len(imported),
        rejected=rejected,
        redactions=replacements,
        provenance=arguments.provenance,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
