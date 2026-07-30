#!/usr/bin/env python3
"""Fail-closed validation of the frozen LAN challenge evidence package."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable

from scoring import (
    EXPECTED_INPUT_SHA256,
    EXPECTED_LABEL_SHA256,
    calculate_metrics,
    load_jsonl,
    load_predictions,
    load_references,
    sha256_file,
)

ROOT = Path(__file__).resolve().parents[3]
EVAL = ROOT / "ml/evaluation/lan_challenge"
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
METRICS = REPORT / "metrics"
PREDICTIONS = REPORT / "predictions"
EXPECTED_A_SHA256 = "381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662"
EXPECTED_B_SHA256 = "9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357"
INFERENCE_FILES = [
    EVAL / "inference_common.py",
    EVAL / "run_rules_baseline.py",
    EVAL / "run_char_ngram.py",
    EVAL / "run_transformers.py",
    EVAL / "run_ollama.py",
]


def close(left: float | None, right: float | None, tolerance: float = 1e-12) -> bool:
    if left is None or right is None:
        return left is right
    return abs(float(left) - float(right)) <= tolerance


def protocol_hash() -> str:
    protocol = json.loads((EVAL / "evaluation-protocol.json").read_text(encoding="utf-8"))
    protocol["protocolSha256"] = ""
    canonical = json.dumps(protocol, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((canonical + "\n").encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--allow-not-run",
        action="store_true",
        help="Validate integrity of completed runs while retaining explicit NOT_RUN records.",
    )
    arguments = parser.parse_args()
    checks: list[dict[str, Any]] = []

    def check(name: str, condition: bool, detail: str) -> None:
        checks.append({"name": name, "passed": bool(condition), "detail": detail})

    input_path = ROOT / "ml/data/lan_challenge_capture/model-inputs.jsonl"
    label_path = ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"
    inputs = load_jsonl(input_path)
    references = load_references(label_path)
    run_status = json.loads((METRICS / "run-status.json").read_text(encoding="utf-8"))
    successful = [row for row in run_status["models"] if row["status"] == "SUCCESS"]
    not_run = [row for row in run_status["models"] if row["status"] == "NOT_RUN"]

    check(
        "1_input_exactly_413",
        len(inputs) == 413
        and len({row["sampleId"] for row in inputs}) == 413
        and sha256_file(input_path) == EXPECTED_INPUT_SHA256,
        f"rows={len(inputs)} sha256={sha256_file(input_path)}",
    )
    check(
        "2_labels_exactly_413",
        len(references) == 413 and sha256_file(label_path) == EXPECTED_LABEL_SHA256,
        f"rows={len(references)} sha256={sha256_file(label_path)}",
    )

    predictions_by_model: dict[str, list[dict[str, Any]]] = {}
    prediction_coverage_ok = True
    duplicate_free = True
    for row in successful:
        model_id = row["modelId"]
        predictions = load_predictions(PREDICTIONS / f"{model_id}.jsonl", model_id)
        predictions_by_model[model_id] = predictions
        ids = [prediction["sampleId"] for prediction in predictions]
        prediction_coverage_ok &= len(ids) == 413 and set(ids) == {
            reference["sampleId"] for reference in references
        }
        duplicate_free &= len(ids) == len(set(ids))
    strict_completion = len(successful) == len(run_status["models"]) and len(successful) >= 4
    check(
        "3_each_model_covers_413",
        prediction_coverage_ok and (arguments.allow_not_run or strict_completion),
        (
            f"successful={len(successful)} notRun={len(not_run)}; "
            + ("partial validation allowed" if arguments.allow_not_run else "strict mode requires all locked runs")
        ),
    )
    check("4_no_duplicate_or_missing_ids", duplicate_free and prediction_coverage_ok, "sampleId sets aligned")

    banned_inference_terms = [
        "final-labels",
        "adjudication.jsonl",
        "agreement-report",
        "context-visibility-audit",
        "model-a-annotations",
        "model-b-annotations",
        "model-labels.jsonl",
        "responseStatus",
        "responseBody",
        "raw-private",
        "from scoring import",
        "import scoring",
    ]
    inference_text = "\n".join(path.read_text(encoding="utf-8") for path in INFERENCE_FILES)
    found_banned = [term for term in banned_inference_terms if term in inference_text]
    check(
        "5_inference_scoring_process_isolation",
        not found_banned,
        f"banned references found={found_banned}",
    )
    check(
        "6_same_input_sha_for_all_models",
        all(
            prediction.get("inputSha256") == EXPECTED_INPUT_SHA256
            for rows in predictions_by_model.values()
            for prediction in rows
        ),
        EXPECTED_INPUT_SHA256,
    )

    metrics_recomputed = True
    recomputed_details = []
    for model_id, predictions in predictions_by_model.items():
        stored = json.loads((METRICS / f"{model_id}.json").read_text(encoding="utf-8"))
        recalculated = calculate_metrics(predictions, references, model_id=model_id)
        fields: list[tuple[Callable[[dict[str, Any]], Any], str]] = [
            (lambda value: value["verdict"]["accuracy"], "verdict.accuracy"),
            (lambda value: value["verdict"]["macroF1"], "verdict.macroF1"),
            (lambda value: value["attackDetectionAll"]["f1"], "attackDetectionAll.f1"),
            (lambda value: value["safeFPR"]["rate"], "safeFPR.rate"),
            (lambda value: value["unknown"]["accuracy"], "unknown.accuracy"),
        ]
        for accessor, name in fields:
            ok = close(accessor(stored), accessor(recalculated))
            metrics_recomputed &= ok
            if not ok:
                recomputed_details.append(f"{model_id}:{name}")
    check("7_metrics_recompute_exactly", metrics_recomputed, f"mismatches={recomputed_details}")

    main_table = list(
        csv.DictReader((REPORT / "tables/table-1-main-results.csv").open(encoding="utf-8"))
    )
    table_ok = True
    for row in main_table:
        if row["status"] != "SUCCESS":
            continue
        model = json.loads((METRICS / f"{row['modelId']}.json").read_text(encoding="utf-8"))
        table_ok &= close(float(row["accuracy"]), model["verdict"]["accuracy"], 5e-7)
        table_ok &= close(float(row["macroF1"]), model["verdict"]["macroF1"], 5e-7)
    expected_figures = [
        "figure-1-model-comparison.png",
        "figure-1-model-comparison.pdf",
        "figure-1-model-comparison.svg",
        *[
            f"figure-{index}-{name}.{suffix}"
            for index, name in [
                (2, "verdict-confusion-matrices"),
                (3, "family-f1"),
                (4, "subset-performance"),
                (5, "quality-latency-size-tradeoff"),
                (6, "inference-path-ablation"),
                (7, "error-taxonomy"),
            ]
            for suffix in ("png", "pdf")
        ],
    ]
    table_ok &= all((REPORT / "figures" / name).is_file() for name in expected_figures)
    check("8_figures_tables_match_metrics", table_ok, "main CSV values and required figure files")

    stats = json.loads((METRICS / "statistical-analysis.json").read_text(encoding="utf-8"))
    check(
        "9_bootstrap_seed_fixed",
        stats["bootstrapSeed"] == 20260731 and stats["bootstrapIterations"] == 10000,
        f"seed={stats['bootstrapSeed']} iterations={stats['bootstrapIterations']}",
    )
    paired_ok = all(
        row.get("status") in {"SUCCESS", "NOT_AVAILABLE"}
        for row in stats["pairedBootstrapDifferences"]
    )
    check("10_statistical_tests_are_paired", paired_ok, "paired comparison status recorded")

    protocol = json.loads((EVAL / "evaluation-protocol.json").read_text(encoding="utf-8"))
    manifest = json.loads((REPORT / "evaluation-manifest.json").read_text(encoding="utf-8"))
    check(
        "11_challenge_not_used_for_tuning",
        protocol["challengeSetUsedForTuning"] is False
        and manifest["challengeSetUsedForTuning"] is False,
        "both protocol and manifest are false",
    )
    unknown_consistent = all(
        close(
            model["unknown"]["accuracy"],
            model["verdict"]["perClass"]["unknown"]["recall"],
        )
        for model in (
            json.loads((METRICS / f"{row['modelId']}.json").read_text(encoding="utf-8"))
            for row in successful
        )
    )
    check("12_unknown_handling_consistent", unknown_consistent, "unknown accuracy equals class recall")
    check(
        "13_parse_failures_never_become_safe",
        all(
            not (prediction.get("parsed") is False and prediction.get("verdict") == "safe")
            for rows in predictions_by_model.values()
            for prediction in rows
        ),
        "all parse failures remain fail-safe unknown",
    )
    check(
        "14_no_response_side_evidence",
        "responseStatus" not in inference_text
        and "responseBody" not in inference_text
        and protocol["leakageControls"]["responseSideEvidenceAllowed"] is False,
        "static inference scan and locked protocol",
    )
    check(
        "15_final_labels_unchanged",
        sha256_file(label_path) == EXPECTED_LABEL_SHA256,
        sha256_file(label_path),
    )
    a_path = ROOT / "ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl"
    b_path = ROOT / "ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl"
    check(
        "16_ab_annotations_unchanged",
        sha256_file(a_path) == EXPECTED_A_SHA256 and sha256_file(b_path) == EXPECTED_B_SHA256,
        f"A={sha256_file(a_path)} B={sha256_file(b_path)}",
    )
    inventory = json.loads((REPORT / "artifact-inventory.json").read_text(encoding="utf-8"))
    check(
        "17_training_data_unchanged",
        inventory["trainingDataModified"] is False
        and inventory["allowedChangedPrefixes"]
        == ["ml/evaluation/lan_challenge/", "ml/reports/lan-challenge-evaluation/"],
        "commit scope excludes ml/data/releases and production paths",
    )
    privacy_pattern = re.compile(
        r"(?:Cookie\s*:|Authorization\s*:|accessToken|refreshToken|sessionId|raw-private)",
        re.IGNORECASE,
    )
    privacy_hits = []
    for model_id, rows in predictions_by_model.items():
        for row in rows:
            if privacy_pattern.search(str(row.get("rawOutput") or "")):
                privacy_hits.append(f"{model_id}:{row['sampleId']}")
    check("18_prediction_privacy_scan", not privacy_hits, f"hits={privacy_hits[:5]}")
    adjudication_manifest = json.loads(
        (
            ROOT
            / "ml/data/lan_challenge_capture/adjudication/final-labels-manifest.json"
        ).read_text(encoding="utf-8")
    )
    check(
        "19_human_review_still_false",
        adjudication_manifest["humanReviewed"] is False
        and adjudication_manifest["reviewerCount"] == 0,
        f"humanReviewed={adjudication_manifest['humanReviewed']} reviewerCount={adjudication_manifest['reviewerCount']}",
    )
    claims = list(
        csv.DictReader((REPORT / "claim-to-evidence-matrix.csv").open(encoding="utf-8"))
    )
    report_json = json.loads(
        (REPORT / "aetherargus-lan-challenge-report.json").read_text(encoding="utf-8")
    )
    claim_ok = bool(claims) and report_json["claimToEvidenceCount"] == len(claims)
    for row in claims:
        claim_ok &= (ROOT / row["evidenceFile"]).is_file()
        claim_ok &= bool(row["metricField"] and row["allowedWording"] and row["forbiddenWording"])
    check("20_all_claims_have_evidence", claim_ok, f"claims={len(claims)}")
    check(
        "protocol_canonical_hash",
        protocol_hash() == protocol["protocolSha256"],
        f"computed={protocol_hash()} recorded={protocol['protocolSha256']}",
    )

    failed = [row for row in checks if not row["passed"]]
    result = {
        "schemaVersion": 1,
        "mode": "allow-not-run" if arguments.allow_not_run else "strict",
        "checksPassed": len(checks) - len(failed),
        "checksTotal": len(checks),
        "failed": failed,
        "checks": checks,
    }
    output_path = METRICS / (
        "validation-partial.json" if arguments.allow_not_run else "validation-strict.json"
    )
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "mode": result["mode"],
                "checksPassed": result["checksPassed"],
                "checksTotal": result["checksTotal"],
                "failedChecks": [row["name"] for row in failed],
            },
            indent=2,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
