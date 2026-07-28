#!/usr/bin/env python3
"""Remove exact and normalized duplicates while preserving the original JSONL."""

from __future__ import annotations

from common import (
    add_io_arguments,
    common_parser,
    emit_log,
    exact_deduplicate,
    iter_jsonl,
    load_config,
    repository_root,
    resolve_path,
    stable_hash,
    write_json,
    write_jsonl,
)


def deduplicate_records(records: list[dict]) -> tuple[list[dict], list[dict]]:
    exact_kept, exact_rejected = exact_deduplicate(records)
    # Normalized-equivalent carrier/encoding variants are intentional training
    # examples. Retain them, but bind them into the same group so they cannot
    # cross release splits. Only byte-level input/output duplicates are removed.
    for record in exact_kept:
        metadata = record["metadata"]
        metadata["normalizedDuplicateGroup"] = stable_hash(
            f"{metadata['attackFamily']}|{metadata['normalizedHash']}"
        )
    return exact_kept, exact_rejected


def main() -> int:
    parser = common_parser(__doc__ or "Deduplicate candidates")
    add_io_arguments(parser)
    parser.add_argument("--report", help="Duplicate report JSON path.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    load_config(arguments.config, root)
    if not arguments.input or not arguments.output:
        parser.error("--input and --output are required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    kept, rejected = deduplicate_records(records)
    write_jsonl(resolve_path(root, arguments.output), kept, dry_run=arguments.dry_run, resume=arguments.resume)
    write_json(
        resolve_path(root, arguments.report or "ml/reports/dataset-v02-duplicates.json"),
        {"input": len(records), "output": len(kept), "removed": len(rejected), "rejected": rejected},
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log("deduplication_complete", input=len(records), output=len(kept), removed=len(rejected))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
