#!/usr/bin/env python3
"""Map approved public artifacts into provenance-rich AetherArgus candidate JSONL."""

from __future__ import annotations

from common import (
    common_parser,
    emit_log,
    load_config,
    repository_root,
    resolve_path,
    write_json,
    write_jsonl,
)
from public_source_adapters import generate_public_candidates


def main() -> int:
    parser = common_parser(__doc__ or "Import public sources")
    parser.add_argument(
        "--output",
        default="ml/data/candidates/v02/public-source-candidates.jsonl",
        help="Candidate JSONL output path.",
    )
    parser.add_argument(
        "--audit-output",
        default="ml/data/candidates/v02/public-source-adapter-audit.json",
        help="Structured adapter audit output path.",
    )
    parser.add_argument("--smoke", action="store_true", help="Emit at most the configured smoke count.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    seed = arguments.seed if arguments.seed is not None else int(config["seed"])
    records, audit = generate_public_candidates(root, config, seed, smoke=arguments.smoke)
    write_jsonl(
        resolve_path(root, arguments.output),
        records,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    write_json(
        resolve_path(root, arguments.audit_output),
        audit,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log(
        "public_source_import_complete",
        records=len(records),
        smoke=arguments.smoke,
        bySourceDataset=audit["bySourceDataset"],
        byCategory=audit["byCategory"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
