#!/usr/bin/env python3
"""Audit release counts, provenance, schemas, independent suites and acceptance gates."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from common import (
    audit_records,
    common_parser,
    count_distribution,
    emit_log,
    iter_jsonl,
    leakage_report,
    load_config,
    repository_root,
    resolve_path,
    write_json,
)
from generate_candidates import CORE_FAMILIES


RELEASE_FILES = {
    "train": "train.jsonl",
    "validation": "validation.jsonl",
    "test_closed": "test-closed.jsonl",
    "test_independent": "test-independent.jsonl",
}


def build_quality_report(
    split_records: dict[str, list[dict[str, Any]]],
    config: dict[str, Any],
) -> dict[str, Any]:
    all_records = [record for records in split_records.values() for record in records]
    audit = audit_records(all_records)
    independent = split_records["test_independent"]
    independent_family_counts = Counter(
        str(record["metadata"]["attackFamily"])
        for record in independent
        if record["metadata"]["labelCategory"] == "attack"
    )
    suite_counts = Counter(str(record["metadata"]["evaluationSuite"]) for record in independent)
    synthetic_count = sum(1 for record in all_records if record["metadata"]["synthetic"])
    human_review_count = sum(
        1 for record in all_records if record["metadata"]["reviewStatus"] == "manual_review"
    )
    minimums = config["minimum_family_targets"]
    family_counts = Counter(str(record["metadata"]["attackFamily"]) for record in all_records)
    dataset_gates = {
        "train_at_least_8000": len(split_records["train"]) >= 8000,
        "validation_at_least_1000": len(split_records["validation"]) >= 1000,
        "independent_test_at_least_1500": len(independent) >= 1500,
        "core_independent_family_each_at_least_100": all(
            independent_family_counts[family] >= 100 for family in CORE_FAMILIES
        ),
        "all_records_deterministically_valid": audit.rejected == 0,
        "family_minimums_met": all(family_counts[family] >= int(target) for family, target in minimums.items()),
    }
    return {
        "schemaVersion": 1,
        "datasetVersion": config["version"],
        "counts": {
            "bySplit": {name: len(records) for name, records in split_records.items()},
            "byCategory": count_distribution(all_records, "labelCategory"),
            "byAttackFamily": dict(sorted(family_counts.items())),
            "byProvenance": count_distribution(all_records, "provenance"),
            "bySourceDataset": count_distribution(all_records, "sourceDataset"),
            "byEncoding": count_distribution(all_records, "encoding"),
            "byEvaluationSuite": count_distribution(all_records, "evaluationSuite"),
            "independentAttackFamily": dict(sorted(independent_family_counts.items())),
            "independentSuites": dict(sorted(suite_counts.items())),
        },
        "quality": audit.as_dict(),
        "synthetic": {
            "count": synthetic_count,
            "ratio": round(synthetic_count / max(1, len(all_records)), 6),
        },
        "review": {
            "humanReviewed": human_review_count,
            "statement": "No human review is claimed. Deterministic rule review only.",
        },
        "realData": {
            "realNormalTest": 0,
            "authorizedRealAttackTest": 0,
            "statement": "No real production traffic or real authorized-range capture is included.",
        },
        "publicSources": {
            "derivedRecordCount": sum(
                1
                for record in all_records
                if record["metadata"]["provenance"] == "public_open_source_derived"
            ),
            "allowedSplits": ["train", "validation"],
            "upstreamEvaluationSplitsUsedForTraining": False,
            "statement": (
                "Public records are checksum-pinned, license-reviewed synthetic or contract-derived "
                "training inputs; they are not claimed as production traffic."
            ),
        },
        "datasetAcceptance": {
            "gates": dataset_gates,
            "passed": all(dataset_gates.values()),
        },
        "preview02Acceptance": {
            "passed": False,
            "reason": (
                "This delivery expands and audits data only. Model training, inference, quantization, "
                "prompt-injection obedience measurement, recall and false-positive gates were not run."
            ),
        },
    }


def render_quality_markdown(report: dict[str, Any]) -> str:
    counts = report["counts"]
    split_lines = "\n".join(f"- `{name}`: {count}" for name, count in counts["bySplit"].items())
    family_lines = "\n".join(
        f"- `{family}`: {count}" for family, count in counts["byAttackFamily"].items()
    )
    gate_lines = "\n".join(
        f"- {'PASS' if passed else 'FAIL'} — `{name}`"
        for name, passed in report["datasetAcceptance"]["gates"].items()
    )
    return f"""# AetherArgus dataset v0.2 quality report

## Actual release counts

{split_lines}

## Attack-family distribution

{family_lines}

## Provenance and review

- Synthetic ratio: `{report['synthetic']['ratio']:.2%}`.
- Human-reviewed samples: `{report['review']['humanReviewed']}`. No human review is claimed.
- Real normal test samples: `0`.
- Authorized real attack samples: `0`.
- Public open-source-derived training samples:
  `{report['publicSources']['derivedRecordCount']}`; restricted to train/validation.

## Dataset-only gates

{gate_lines}

Dataset-only acceptance: `{'PASS' if report['datasetAcceptance']['passed'] else 'FAIL'}`.

## Preview 0.2 status

`NOT EVALUATED / NOT PASSED`. This task did not train or run any model. Recall, FPR,
JSON success, Schema success under inference, latency, quantization, and prompt-injection
obedience therefore remain unmeasured.
"""


def main() -> int:
    parser = common_parser(__doc__ or "Audit v0.2 release")
    parser.add_argument("--release-dir", help="Release directory.")
    parser.add_argument("--output", help="Quality report JSON path.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    release_dir = resolve_path(root, arguments.release_dir or config["paths"]["release_dir"])
    split_records = {
        split_name: list(iter_jsonl(release_dir / filename))
        for split_name, filename in RELEASE_FILES.items()
    }
    report = build_quality_report(split_records, config)
    write_json(
        resolve_path(root, arguments.output or "ml/reports/dataset-v02-quality-report.json"),
        report,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log(
        "dataset_audit_complete",
        datasetAcceptance=report["datasetAcceptance"]["passed"],
        counts=report["counts"]["bySplit"],
    )
    return 0 if report["datasetAcceptance"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
