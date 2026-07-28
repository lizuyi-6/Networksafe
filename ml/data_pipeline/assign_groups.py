#!/usr/bin/env python3
"""Assign leakage groups from template, CVE, source and prompt provenance."""

from __future__ import annotations

from common import (
    add_io_arguments,
    assign_group_ids,
    common_parser,
    emit_log,
    iter_jsonl,
    load_config,
    repository_root,
    resolve_path,
    write_jsonl,
)


def main() -> int:
    parser = common_parser(__doc__ or "Assign leakage groups")
    add_io_arguments(parser)
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    seed = arguments.seed if arguments.seed is not None else int(config["seed"])
    if not arguments.input or not arguments.output:
        parser.error("--input and --output are required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    grouped = assign_group_ids(records, seed)
    write_jsonl(resolve_path(root, arguments.output), grouped, dry_run=arguments.dry_run, resume=arguments.resume)
    emit_log(
        "group_assignment_complete",
        input=len(records),
        groups=len({record["metadata"]["groupId"] for record in grouped}),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
