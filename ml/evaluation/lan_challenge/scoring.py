#!/usr/bin/env python3
"""Reference-aware scoring helpers. Inference modules must not import this file."""

from __future__ import annotations

import hashlib
import json
import math
import statistics
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from scipy.stats import beta as scipy_beta
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

# Two-sided 95% normal quantile, kept symbolic (no Date/randomness).
_Z_95 = 1.959963984540054

EXPECTED_INPUT_SHA256 = "c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3"
EXPECTED_LABEL_SHA256 = "13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad"
VERDICT_LABELS = ["safe", "attack", "unknown"]
OUTPUT_FIELDS = {
    "verdict",
    "attackFamily",
    "recommendedAction",
    "contextSufficient",
    "confidence",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid JSONL at {path}:{line_number}") from error
    return rows


def load_references(path: Path) -> list[dict[str, Any]]:
    if sha256_file(path) != EXPECTED_LABEL_SHA256:
        raise ValueError("reference-label SHA-256 does not match locked protocol")
    rows = load_jsonl(path)
    if len(rows) != 413 or len({row["sampleId"] for row in rows}) != 413:
        raise ValueError("reference labels must contain 413 unique sampleIds")
    distribution = Counter(row["verdict"] for row in rows)
    if distribution != Counter({"safe": 209, "attack": 97, "unknown": 107}):
        raise ValueError(f"reference-label distribution changed: {dict(distribution)}")
    return rows


def load_predictions(path: Path, model_id: str) -> list[dict[str, Any]]:
    rows = load_jsonl(path)
    if len(rows) != 413:
        raise ValueError(f"{model_id}: expected 413 predictions, found {len(rows)}")
    sample_ids = [row.get("sampleId") for row in rows]
    if len(set(sample_ids)) != 413:
        raise ValueError(f"{model_id}: duplicate prediction sampleId")
    for row in rows:
        if row.get("modelId") != model_id:
            raise ValueError(f"{model_id}: mixed modelId in prediction file")
        if row.get("inputSha256") != EXPECTED_INPUT_SHA256:
            raise ValueError(f"{model_id}: input SHA mismatch")
        if row.get("parsed") is False and row.get("verdict") == "safe":
            raise ValueError(f"{model_id}: parse failure was repaired to safe")
    return rows


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    return float(np.quantile(np.asarray(values, dtype=float), quantile))


def clopper_pearson_interval(successes: int, trials: int, alpha: float = 0.05) -> list[float]:
    """Exact binomial (Clopper-Pearson) two-sided CI for a proportion successes/trials.

    Required so a zero-event FPR (e.g. 0/209) reports a non-degenerate upper bound
    instead of the bootstrap's [0,0]."""
    if trials <= 0:
        return [0.0, 1.0]
    successes = int(min(max(successes, 0), trials))
    lower = 0.0 if successes == 0 else float(scipy_beta.ppf(alpha / 2, successes, trials - successes + 1))
    upper = 1.0 if successes == trials else float(scipy_beta.ppf(1 - alpha / 2, successes + 1, trials - successes))
    return [lower, upper]


def wilson_interval(successes: int, trials: int, alpha: float = 0.05) -> list[float]:
    """Wilson score two-sided CI for a proportion successes/trials."""
    if trials <= 0:
        return [0.0, 1.0]
    successes = int(min(max(successes, 0), trials))
    phat = successes / trials
    denom = 1.0 + _Z_95 * _Z_95 / trials
    center = (phat + _Z_95 * _Z_95 / (2 * trials)) / denom
    half = _Z_95 * math.sqrt(phat * (1 - phat) / trials + _Z_95 * _Z_95 / (4 * trials * trials)) / denom
    return [max(0.0, center - half), min(1.0, center + half)]


def proportion_block(
    successes: int,
    trials: int,
    *,
    bootstrap95: list[float] | None = None,
) -> dict[str, Any]:
    """Unified interval reporting for a proportion metric.

    Point + Clopper-Pearson exact + Wilson score are computed here (deterministic,
    no resampling). The bootstrap95 slot is filled later by statistical-analysis.py
    from the 10k stratified resamples; scoring.py itself never bootstraps."""
    return {
        "pointEstimate": (successes / trials) if trials else 0.0,
        "numerator": int(successes),
        "denominator": int(trials),
        "clopperPearson95": clopper_pearson_interval(successes, trials),
        "wilson95": wilson_interval(successes, trials),
        "bootstrap95": bootstrap95,
    }


def classification_block(reference: list[str], predicted: list[str], labels: list[str]) -> dict[str, Any]:
    precision, recall, f1, support = precision_recall_fscore_support(
        reference, predicted, labels=labels, zero_division=0
    )
    macro_precision, macro_recall, macro_f1, _ = precision_recall_fscore_support(
        reference, predicted, labels=labels, average="macro", zero_division=0
    )
    weighted_f1 = f1_score(reference, predicted, labels=labels, average="weighted", zero_division=0)
    return {
        "accuracy": float(accuracy_score(reference, predicted)),
        "macroPrecision": float(macro_precision),
        "macroRecall": float(macro_recall),
        "macroF1": float(macro_f1),
        "weightedF1": float(weighted_f1),
        "perClass": {
            label: {
                "precision": float(precision[index]),
                "recall": float(recall[index]),
                "f1": float(f1[index]),
                "support": int(support[index]),
            }
            for index, label in enumerate(labels)
        },
        "confusionMatrix": {
            "labels": labels,
            "matrix": confusion_matrix(reference, predicted, labels=labels).astype(int).tolist(),
        },
    }


def binary_attack_block(reference: list[str], predicted: list[str]) -> dict[str, Any]:
    ref_binary = [value == "attack" for value in reference]
    pred_binary = [value == "attack" for value in predicted]
    precision, recall, f1, _ = precision_recall_fscore_support(
        ref_binary, pred_binary, average="binary", zero_division=0
    )
    return {
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "positiveSupport": int(sum(ref_binary)),
        "negativeSupport": int(len(ref_binary) - sum(ref_binary)),
    }


def subset_indexes(references: list[dict[str, Any]]) -> dict[str, list[int]]:
    subsets: dict[str, list[int]] = {
        "all_413": list(range(len(references))),
        "context_sufficient_true": [],
        "context_sufficient_false": [],
        "consensus": [],
        "model_adjudication": [],
        "safe": [],
        "attack": [],
        "unknown": [],
        "prompt_injection": [],
        "authorization": [],
        "idor_bola": [],
        "sqli": [],
        "xss": [],
        "command_injection": [],
        "path_traversal": [],
        "ssrf": [],
    }
    for index, row in enumerate(references):
        subsets[f"context_sufficient_{str(bool(row['contextSufficient'])).lower()}"].append(index)
        if row.get("resolutionType") == "consensus":
            subsets["consensus"].append(index)
        else:
            subsets["model_adjudication"].append(index)
        subsets[row["verdict"]].append(index)
        family = row.get("attackFamily")
        if family in subsets:
            subsets[family].append(index)
    return subsets


def calculate_metrics(
    predictions: list[dict[str, Any]],
    references: list[dict[str, Any]],
    *,
    model_id: str,
    performance_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    prediction_by_id = {row["sampleId"]: row for row in predictions}
    reference_ids = [row["sampleId"] for row in references]
    if set(prediction_by_id) != set(reference_ids):
        raise ValueError(f"{model_id}: prediction/reference sampleId mismatch")
    aligned_predictions = [prediction_by_id[sample_id] for sample_id in reference_ids]
    reference_verdicts = [row["verdict"] for row in references]
    predicted_verdicts = [row["verdict"] for row in aligned_predictions]
    verdict = classification_block(reference_verdicts, predicted_verdicts, VERDICT_LABELS)
    attack_all = binary_attack_block(reference_verdicts, predicted_verdicts)
    attack_safe_indexes = [
        index for index, value in enumerate(reference_verdicts) if value in {"attack", "safe"}
    ]
    attack_vs_safe = binary_attack_block(
        [reference_verdicts[index] for index in attack_safe_indexes],
        [predicted_verdicts[index] for index in attack_safe_indexes],
    )
    safe_indexes = [index for index, value in enumerate(reference_verdicts) if value == "safe"]
    safe_attack_count = sum(predicted_verdicts[index] == "attack" for index in safe_indexes)
    unknown_indexes = [index for index, value in enumerate(reference_verdicts) if value == "unknown"]
    unknown_predicted = [predicted_verdicts[index] for index in unknown_indexes]
    unknown_precision = verdict["perClass"]["unknown"]["precision"]
    unknown_recall = verdict["perClass"]["unknown"]["recall"]

    attack_indexes = [index for index, value in enumerate(reference_verdicts) if value == "attack"]
    reference_families = [references[index]["attackFamily"] for index in attack_indexes]
    predicted_families = [aligned_predictions[index]["attackFamily"] for index in attack_indexes]
    if any(value == "not_supported" for value in predicted_families):
        family: dict[str, Any] = {"status": "NOT_SUPPORTED"}
    else:
        # Family Macro-F1 label set = ONLY families present among reference-attack rows.
        # Predicted-only families (notably "none", which a model may emit on a reference
        # attack row) are NOT added to the macro denominator: sklearn counts such a
        # prediction as a false negative for the true reference family (so it is still
        # scored as wrong) without creating a support=0 reference class that would
        # artificially depress Macro-F1. See protocol-amendments.md (stat-issue-4.2).
        family_labels = sorted(set(reference_families))
        predicted_only_families = sorted(set(predicted_families) - set(reference_families))
        family = {
            "status": "SUCCESS",
            "labelSetPolicy": "reference_attack_families_only",
            **classification_block(reference_families, predicted_families, family_labels),
            "predictedOnlyFamilies": predicted_only_families,
            "predictedNoneOnAttackCount": int(sum(1 for value in predicted_families if value == "none")),
        }

    # Counts for unified proportion-interval reporting (Clopper-Pearson exact + Wilson +
    # bootstrap placeholder). Required so zero-event rates (e.g. safeFPR 0/209) report a
    # non-degenerate interval instead of bootstrap's [0,0]. See protocol-amendments.md
    # (stat-issue-4.1).
    total_count = len(aligned_predictions)
    verdict_correct = sum(1 for index in range(total_count) if predicted_verdicts[index] == reference_verdicts[index])
    attack_true_positive = sum(1 for index in attack_indexes if predicted_verdicts[index] == "attack")
    attack_false_negative = len(attack_indexes) - attack_true_positive
    attack_false_positive = sum(
        1
        for index in range(total_count)
        if reference_verdicts[index] != "attack" and predicted_verdicts[index] == "attack"
    )
    unknown_correct = sum(1 for index in unknown_indexes if predicted_verdicts[index] == "unknown")
    safe_fpr_block = proportion_block(safe_attack_count, len(safe_indexes))
    proportions = {
        "safeFPR": safe_fpr_block,
        "verdictAccuracy": proportion_block(verdict_correct, total_count),
        "attackRecall": proportion_block(attack_true_positive, attack_true_positive + attack_false_negative),
        "attackPrecision": proportion_block(attack_true_positive, attack_true_positive + attack_false_positive),
        "unknownAccuracy": proportion_block(unknown_correct, len(unknown_indexes)),
    }

    latencies = [float(row["latencyMs"]) for row in aligned_predictions if row.get("latencyMs") is not None]
    total_latency_seconds = sum(latencies) / 1000
    input_tokens = [row["inputTokenCount"] for row in aligned_predictions if isinstance(row.get("inputTokenCount"), int)]
    output_tokens = [row["outputTokenCount"] for row in aligned_predictions if isinstance(row.get("outputTokenCount"), int)]
    performance_metadata = performance_metadata or {}
    performance = {
        "p50LatencyMs": percentile(latencies, 0.50),
        "p95LatencyMs": percentile(latencies, 0.95),
        "p99LatencyMs": percentile(latencies, 0.99),
        "meanLatencyMs": statistics.fmean(latencies) if latencies else None,
        "samplesPerSecond": len(aligned_predictions) / total_latency_seconds if total_latency_seconds else None,
        "inputTokensPerSecond": sum(input_tokens) / total_latency_seconds if input_tokens and total_latency_seconds else None,
        "outputTokensPerSecond": sum(output_tokens) / total_latency_seconds if output_tokens and total_latency_seconds else None,
        "peakGpuMemoryMiB": performance_metadata.get("peakGpuMemoryMiB"),
        "peakHostMemoryMiB": performance_metadata.get("peakHostMemoryMiB"),
        "modelSizeBytes": performance_metadata.get("modelSizeBytes"),
        "modelSizeMeasurement": performance_metadata.get("modelSizeMeasurement"),
        "crossStackLatencyComparable": bool(performance_metadata.get("crossStackLatencyComparable", False)),
    }
    structured = {
        "jsonSyntaxSuccessRate": sum(bool(row.get("parsed")) for row in aligned_predictions) / len(aligned_predictions),
        "schemaValidRate": sum(bool(row.get("schemaValid")) for row in aligned_predictions) / len(aligned_predictions),
        "enumValidRate": sum(
            row.get("verdict") in VERDICT_LABELS
            and isinstance(row.get("attackFamily"), str)
            and isinstance(row.get("recommendedAction"), str)
            for row in aligned_predictions
        )
        / len(aligned_predictions),
        "completeFieldRate": sum(OUTPUT_FIELDS.issubset(row) for row in aligned_predictions)
        / len(aligned_predictions),
    }
    subsets: dict[str, Any] = {}
    for subset_name, indexes in subset_indexes(references).items():
        if not indexes:
            subsets[subset_name] = {"status": "NOT_AVAILABLE", "count": 0}
            continue
        subset_reference = [reference_verdicts[index] for index in indexes]
        subset_prediction = [predicted_verdicts[index] for index in indexes]
        block = classification_block(subset_reference, subset_prediction, VERDICT_LABELS)
        subset_safe = [index for index in indexes if reference_verdicts[index] == "safe"]
        subset_safe_fpr = (
            sum(predicted_verdicts[index] == "attack" for index in subset_safe) / len(subset_safe)
            if subset_safe
            else None
        )
        subsets[subset_name] = {
            "status": "SUCCESS",
            "count": len(indexes),
            "accuracy": block["accuracy"],
            "macroF1": block["macroF1"],
            "safeFPR": subset_safe_fpr,
        }
    return {
        "schemaVersion": 1,
        "modelId": model_id,
        "status": "SUCCESS",
        "sampleCount": len(aligned_predictions),
        "inputSha256": EXPECTED_INPUT_SHA256,
        "labelSha256": EXPECTED_LABEL_SHA256,
        "verdict": verdict,
        "attackDetectionAll": attack_all,
        "attackVsSafeOnly": attack_vs_safe,
        "safeFPR": {
            "rate": safe_fpr_block["pointEstimate"],
            "falsePositiveCount": safe_fpr_block["numerator"],
            "safeSupport": safe_fpr_block["denominator"],
            **safe_fpr_block,
        },
        "proportions": proportions,
        "unknown": {
            "accuracy": unknown_recall,
            "precision": unknown_precision,
            "recall": unknown_recall,
            "support": len(unknown_indexes),
            "toAttackRate": unknown_predicted.count("attack") / len(unknown_indexes),
            "toSafeRate": unknown_predicted.count("safe") / len(unknown_indexes),
        },
        "attackFamily": family,
        "structuredOutput": structured,
        "performance": performance,
        "subsets": subsets,
    }
