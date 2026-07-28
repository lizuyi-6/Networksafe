#!/usr/bin/env python3
"""Create group-aware development splits while preserving a sealed independent test."""

from __future__ import annotations

from common import (
    common_parser,
    emit_log,
    grouped_split,
    iter_jsonl,
    leakage_report,
    load_config,
    repository_root,
    resolve_path,
    write_json,
    write_jsonl,
)


def main() -> int:
    parser = common_parser(__doc__ or "Split grouped datasets")
    parser.add_argument("--development-input", required=True, help="Grouped development JSONL.")
    parser.add_argument("--independent-input", required=True, help="Sealed independent JSONL.")
    parser.add_argument("--release-dir", help="Release output directory.")
    parser.add_argument("--report", help="Leakage report JSON path.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    seed = arguments.seed if arguments.seed is not None else int(config["seed"])
    development = list(iter_jsonl(resolve_path(root, arguments.development_input)))
    independent = list(iter_jsonl(resolve_path(root, arguments.independent_input)))
    splits = grouped_split(development, config["split_ratios"], seed)
    for record in independent:
        record["metadata"]["split"] = "test_independent"
    all_splits = {**splits, "test_independent": independent}
    report = leakage_report(all_splits)
    release_dir = resolve_path(root, arguments.release_dir or config["paths"]["release_dir"])
    filenames = {
        "train": "train.jsonl",
        "validation": "validation.jsonl",
        "test_closed": "test-closed.jsonl",
        "test_independent": "test-independent.jsonl",
    }
    for split_name, records in all_splits.items():
        write_jsonl(
            release_dir / filenames[split_name],
            records,
            dry_run=arguments.dry_run,
            resume=arguments.resume,
        )
    write_json(
        resolve_path(root, arguments.report or "ml/reports/dataset-v02-leakage-report.json"),
        report,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log(
        "split_complete",
        counts={name: len(records) for name, records in all_splits.items()},
        leakageDetected=report["detected"],
    )
    return 1 if report["detected"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
