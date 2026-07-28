#!/usr/bin/env python3
"""Review candidates without silently relabeling or mutating original inputs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from common import (
    add_io_arguments,
    common_parser,
    emit_log,
    iter_jsonl,
    load_config,
    repository_root,
    resolve_path,
    validate_record,
    write_jsonl,
)


REVIEW_FIELDS = {"accepted", "problems", "suggestedLabel", "needsManualReview"}


def deterministic_decision(record: dict[str, Any]) -> dict[str, Any]:
    problems = validate_record(record)
    return {
        "accepted": not problems,
        "problems": problems,
        "suggestedLabel": None,
        "needsManualReview": bool(problems),
    }


def load_external_decisions(path: Path) -> dict[str, dict[str, Any]]:
    decisions: dict[str, dict[str, Any]] = {}
    for row in iter_jsonl(path):
        sample_id = row.get("sampleId")
        decision = row.get("decision")
        if not isinstance(sample_id, str) or not isinstance(decision, dict):
            raise ValueError("external review row must contain sampleId and decision")
        if set(decision) != REVIEW_FIELDS:
            raise ValueError(f"invalid review fields for {sample_id}")
        if not isinstance(decision["accepted"], bool) or not isinstance(decision["problems"], list):
            raise ValueError(f"invalid review types for {sample_id}")
        if not isinstance(decision["needsManualReview"], bool):
            raise ValueError(f"invalid manual-review flag for {sample_id}")
        decisions[sample_id] = decision
    return decisions


def review_records(
    records: list[dict[str, Any]],
    external: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    queue: list[dict[str, Any]] = []
    for source_record in records:
        sample_id = str(source_record.get("sampleId"))
        deterministic = deterministic_decision(source_record)
        reviewer = external.get(sample_id) if external is not None else None
        disagreement = reviewer is not None and reviewer["accepted"] != deterministic["accepted"]
        needs_manual = (
            deterministic["needsManualReview"]
            or bool(reviewer and reviewer["needsManualReview"])
            or bool(reviewer and reviewer["suggestedLabel"] is not None)
            or disagreement
        )
        accepted_by_all = deterministic["accepted"] and (reviewer is None or reviewer["accepted"]) and not needs_manual
        problems = list(deterministic["problems"])
        if reviewer:
            problems.extend(str(problem) for problem in reviewer["problems"])
        if disagreement:
            problems.append("deterministic_and_external_reviewer_disagree")
        decision = {
            "sampleId": sample_id,
            "decision": {
                "accepted": accepted_by_all,
                "problems": sorted(set(problems)),
                "suggestedLabel": reviewer["suggestedLabel"] if reviewer else None,
                "needsManualReview": needs_manual,
            },
            "reviewers": ["deterministic-v02"] + (["external-independent-reviewer"] if reviewer else []),
        }
        decisions.append(decision)
        if accepted_by_all:
            record = json.loads(json.dumps(source_record, ensure_ascii=False))
            record["metadata"]["reviewStatus"] = "rules_accepted"
            accepted.append(record)
        else:
            queue.append({"record": source_record, **decision})
    return accepted, decisions, queue


def main() -> int:
    parser = common_parser(__doc__ or "Review candidates")
    add_io_arguments(parser)
    parser.add_argument(
        "--review-decisions",
        help="Optional independent reviewer JSONL. The reviewer may accept/reject but never edits samples.",
    )
    parser.add_argument("--decisions-output", help="Review decisions JSONL path.")
    parser.add_argument("--queue-output", help="Manual review queue JSONL path.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    if not arguments.input or not arguments.output:
        parser.error("--input and --output are required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    external = (
        load_external_decisions(resolve_path(root, arguments.review_decisions))
        if arguments.review_decisions
        else None
    )
    accepted, decisions, queue = review_records(records, external)
    queue_path = resolve_path(
        root,
        arguments.queue_output or f"{config['paths']['review_queue']}/review-queue.jsonl",
    )
    decisions_path = resolve_path(
        root,
        arguments.decisions_output or f"{config['paths']['review_queue']}/review-decisions.jsonl",
    )
    write_jsonl(resolve_path(root, arguments.output), accepted, dry_run=arguments.dry_run, resume=arguments.resume)
    write_jsonl(decisions_path, decisions, dry_run=arguments.dry_run, resume=arguments.resume)
    write_jsonl(queue_path, queue, dry_run=arguments.dry_run, resume=arguments.resume)
    emit_log("review_complete", total=len(records), accepted=len(accepted), queued=len(queue))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
