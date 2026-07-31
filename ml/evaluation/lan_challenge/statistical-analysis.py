#!/usr/bin/env python3
"""Locked bootstrap, McNemar, paired-delta, and multiplicity analysis."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import binomtest, chi2

from scoring import load_predictions, load_references, proportion_block

BOOTSTRAP_ITERATIONS = 10_000
BOOTSTRAP_SEED = 20260731
VERDICTS = ["safe", "attack", "unknown"]


def confusion(reference: np.ndarray, predicted: np.ndarray, labels: list[str]) -> np.ndarray:
    matrix = np.zeros((len(labels), len(labels)), dtype=int)
    indexes = {value: index for index, value in enumerate(labels)}
    for expected, observed in zip(reference, predicted, strict=True):
        if expected in indexes and observed in indexes:
            matrix[indexes[expected], indexes[observed]] += 1
    return matrix


def f1_from_matrix(matrix: np.ndarray) -> np.ndarray:
    tp = np.diag(matrix).astype(float)
    precision_denominator = matrix.sum(axis=0)
    recall_denominator = matrix.sum(axis=1)
    precision = np.divide(
        tp, precision_denominator, out=np.zeros_like(tp), where=precision_denominator != 0
    )
    recall = np.divide(tp, recall_denominator, out=np.zeros_like(tp), where=recall_denominator != 0)
    return np.divide(
        2 * precision * recall,
        precision + recall,
        out=np.zeros_like(tp),
        where=(precision + recall) != 0,
    )


def macro_f1_over_reference_labels(reference: np.ndarray, predicted: np.ndarray, labels: list[str]) -> float:
    """Macro-F1 averaged over reference-present labels only, matching sklearn semantics.

    A prediction outside ``labels`` (notably family "none" on a reference attack row) is
    counted as a false negative for the true reference family (so it is still wrong) but
    adds no support=0 reference class to the macro denominator. See protocol-amendments.md
    (stat-issue-4.2)."""
    if not labels:
        return 0.0
    scores: list[float] = []
    for label in labels:
        tp = float(np.sum((reference == label) & (predicted == label)))
        ref_support = float(np.sum(reference == label))
        pred_support = float(np.sum(predicted == label))
        precision = tp / pred_support if pred_support else 0.0
        recall = tp / ref_support if ref_support else 0.0
        scores.append(2 * precision * recall / (precision + recall) if (precision + recall) else 0.0)
    return float(np.mean(scores))


def proportion_counts(reference: np.ndarray, predicted: np.ndarray) -> dict[str, tuple[int, int]]:
    """(successes, trials) for every proportion metric, for exact/Wilson intervals."""
    attack_mask = reference == "attack"
    safe_mask = reference == "safe"
    unknown_mask = reference == "unknown"
    attack_tp = int(np.sum(attack_mask & (predicted == "attack")))
    attack_fn = int(np.sum(attack_mask) - attack_tp)
    attack_fp = int(np.sum(~attack_mask & (predicted == "attack")))
    safe_fp = int(np.sum(safe_mask & (predicted == "attack")))
    unknown_correct = int(np.sum(unknown_mask & (predicted == "unknown")))
    correct = int(np.sum(reference == predicted))
    return {
        "safeFPR": (safe_fp, int(np.sum(safe_mask))),
        "verdictAccuracy": (correct, int(reference.size)),
        "attackRecall": (attack_tp, attack_tp + attack_fn),
        "attackPrecision": (attack_tp, attack_tp + attack_fp),
        "unknownAccuracy": (unknown_correct, int(np.sum(unknown_mask))),
    }


def metric_vector(
    reference: np.ndarray,
    predicted: np.ndarray,
    reference_families: np.ndarray,
    predicted_families: np.ndarray,
) -> dict[str, float | None]:
    matrix = confusion(reference, predicted, VERDICTS)
    attack_index = VERDICTS.index("attack")
    safe_index = VERDICTS.index("safe")
    unknown_index = VERDICTS.index("unknown")
    tp = float(matrix[attack_index, attack_index])
    fp = float(matrix[:, attack_index].sum() - tp)
    fn = float(matrix[attack_index, :].sum() - tp)
    attack_precision = tp / (tp + fp) if tp + fp else 0.0
    attack_recall = tp / (tp + fn) if tp + fn else 0.0
    attack_f1 = (
        2 * attack_precision * attack_recall / (attack_precision + attack_recall)
        if attack_precision + attack_recall
        else 0.0
    )
    family_mask = reference == "attack"
    family_reference = reference_families[family_mask]
    family_prediction = predicted_families[family_mask]
    if len(family_reference) and not np.any(family_prediction == "not_supported"):
        family_labels = sorted(set(family_reference.tolist()))
        family_macro_f1: float | None = macro_f1_over_reference_labels(
            family_reference, family_prediction, family_labels
        )
    else:
        family_macro_f1 = None
    return {
        "accuracy": float(np.mean(reference == predicted)),
        "macroF1": float(np.mean(f1_from_matrix(matrix))),
        "attackF1": attack_f1,
        "attackRecall": attack_recall,
        "attackPrecision": attack_precision,
        "safeFPR": float(matrix[safe_index, attack_index] / max(1, matrix[safe_index, :].sum())),
        "unknownAccuracy": float(
            matrix[unknown_index, unknown_index] / max(1, matrix[unknown_index, :].sum())
        ),
        "attackFamilyMacroF1": family_macro_f1,
    }


def stratified_bootstrap_indexes(reference: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    parts = []
    for label in VERDICTS:
        indexes = np.flatnonzero(reference == label)
        parts.append(rng.choice(indexes, size=len(indexes), replace=True))
    return np.concatenate(parts)


def interval(point: float | None, values: list[float]) -> dict[str, Any]:
    if point is None or not values:
        return {"pointEstimate": point, "lower95": None, "upper95": None}
    return {
        "pointEstimate": point,
        "lower95": float(np.quantile(values, 0.025)),
        "upper95": float(np.quantile(values, 0.975)),
    }


def bootstrap_model(
    reference: np.ndarray,
    predicted: np.ndarray,
    reference_families: np.ndarray,
    predicted_families: np.ndarray,
) -> dict[str, Any]:
    point = metric_vector(reference, predicted, reference_families, predicted_families)
    samples: dict[str, list[float]] = {name: [] for name in point}
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    for _ in range(BOOTSTRAP_ITERATIONS):
        indexes = stratified_bootstrap_indexes(reference, rng)
        values = metric_vector(
            reference[indexes],
            predicted[indexes],
            reference_families[indexes],
            predicted_families[indexes],
        )
        for name, value in values.items():
            if value is not None:
                samples[name].append(value)
    confidence_intervals = {name: interval(value, samples[name]) for name, value in point.items()}
    # Unified proportion intervals: deterministic Clopper-Pearson exact + Wilson score
    # over the full-sample counts, plus bootstrap95 from the 10k stratified resamples.
    counts = proportion_counts(reference, predicted)
    proportion_names = ["safeFPR", "verdictAccuracy", "attackRecall", "attackPrecision", "unknownAccuracy"]
    proportion_intervals: dict[str, Any] = {}
    for name in proportion_names:
        successes, trials = counts[name]
        bootstrap_draws = samples.get(name, [])
        bootstrap95 = (
            [float(np.quantile(bootstrap_draws, 0.025)), float(np.quantile(bootstrap_draws, 0.975))]
            if bootstrap_draws
            else None
        )
        proportion_intervals[name] = proportion_block(successes, trials, bootstrap95=bootstrap95)
    return {"confidenceIntervals": confidence_intervals, "proportionIntervals": proportion_intervals}


def mcnemar(reference: np.ndarray, baseline: np.ndarray, aetherargus: np.ndarray) -> dict[str, Any]:
    baseline_correct = baseline == reference
    aetherargus_correct = aetherargus == reference
    n01 = int(np.sum(~baseline_correct & aetherargus_correct))
    n10 = int(np.sum(baseline_correct & ~aetherargus_correct))
    discordant = n01 + n10
    if discordant < 25:
        p_value = float(binomtest(min(n01, n10), n=discordant, p=0.5).pvalue) if discordant else 1.0
        method = "exact_binomial"
        statistic = None
    else:
        statistic = (abs(n01 - n10) - 1) ** 2 / discordant
        p_value = float(chi2.sf(statistic, 1))
        method = "continuity_corrected_chi_square"
    return {
        "n01BaselineWrongAetherargusCorrect": n01,
        "n10BaselineCorrectAetherargusWrong": n10,
        "method": method,
        "statistic": statistic,
        "pValueRaw": p_value,
    }


def paired_delta(
    reference: np.ndarray,
    left: np.ndarray,
    right: np.ndarray,
    reference_families: np.ndarray,
    left_families: np.ndarray,
    right_families: np.ndarray,
) -> dict[str, Any]:
    left_point = metric_vector(reference, left, reference_families, left_families)
    right_point = metric_vector(reference, right, reference_families, right_families)
    names = ["macroF1", "attackF1", "safeFPR", "unknownAccuracy"]
    draws = {name: [] for name in names}
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    for _ in range(BOOTSTRAP_ITERATIONS):
        indexes = stratified_bootstrap_indexes(reference, rng)
        left_values = metric_vector(
            reference[indexes], left[indexes], reference_families[indexes], left_families[indexes]
        )
        right_values = metric_vector(
            reference[indexes], right[indexes], reference_families[indexes], right_families[indexes]
        )
        for name in names:
            draws[name].append(float(left_values[name]) - float(right_values[name]))
    return {
        name: interval(float(left_point[name]) - float(right_point[name]), draws[name])
        for name in names
    }


def holm_bonferroni(rows: list[dict[str, Any]]) -> None:
    ordered = sorted(enumerate(rows), key=lambda pair: pair[1]["pValueRaw"])
    running = 0.0
    count = len(rows)
    for rank, (original_index, row) in enumerate(ordered):
        adjusted = min(1.0, (count - rank) * row["pValueRaw"])
        running = max(running, adjusted)
        rows[original_index]["pValueHolm"] = running


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--predictions-dir", type=Path, required=True)
    parser.add_argument("--run-status", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    references = load_references(arguments.labels)
    reference = np.asarray([row["verdict"] for row in references], dtype=object)
    reference_families = np.asarray([row["attackFamily"] for row in references], dtype=object)
    reference_ids = [row["sampleId"] for row in references]
    statuses = json.loads(arguments.run_status.read_text(encoding="utf-8"))["models"]
    predictions: dict[str, np.ndarray] = {}
    families: dict[str, np.ndarray] = {}
    confidence_intervals: dict[str, Any] = {}
    proportion_intervals: dict[str, Any] = {}
    for status in statuses:
        if status["status"] != "SUCCESS":
            continue
        model_id = status["modelId"]
        rows = load_predictions(arguments.predictions_dir / f"{model_id}.jsonl", model_id)
        by_id = {row["sampleId"]: row for row in rows}
        predictions[model_id] = np.asarray([by_id[sample_id]["verdict"] for sample_id in reference_ids])
        families[model_id] = np.asarray(
            [by_id[sample_id]["attackFamily"] for sample_id in reference_ids], dtype=object
        )
        boot = bootstrap_model(reference, predictions[model_id], reference_families, families[model_id])
        confidence_intervals[model_id] = boot["confidenceIntervals"]
        proportion_intervals[model_id] = boot["proportionIntervals"]

    primary = "aetherargus-v02-hf-lora"
    mcnemar_rows: list[dict[str, Any]] = []
    if primary in predictions:
        for model_id, values in predictions.items():
            if model_id == primary:
                continue
            row = {"comparison": f"{primary} vs {model_id}", **mcnemar(reference, values, predictions[primary])}
            mcnemar_rows.append(row)
        holm_bonferroni(mcnemar_rows)

    requested_pairs = [
        (primary, "qwen3-4b-zero-shot"),
        (primary, "qwen3-4b-few-shot"),
        (primary, "rules-baseline"),
        (primary, "char-ngram-logreg"),
        ("aetherargus-v02-merged-bf16", "aetherargus-v02-gguf-q4-k-m"),
        ("aetherargus-v02-merged-bf16", "aetherargus-v02-ollama-f16"),
    ]
    paired: list[dict[str, Any]] = []
    for left, right in requested_pairs:
        if left not in predictions or right not in predictions:
            paired.append(
                {
                    "comparison": f"{left} minus {right}",
                    "status": "NOT_AVAILABLE",
                    "reason": "one or both prediction files were not produced",
                }
            )
            continue
        paired.append(
            {
                "comparison": f"{left} minus {right}",
                "status": "SUCCESS",
                "deltas": paired_delta(
                    reference,
                    predictions[left],
                    predictions[right],
                    reference_families,
                    families[left],
                    families[right],
                ),
            }
        )
    result = {
        "schemaVersion": 1,
        "bootstrapIterations": BOOTSTRAP_ITERATIONS,
        "bootstrapSeed": BOOTSTRAP_SEED,
        "stratifiedBy": "reference_verdict",
        "confidenceIntervals": confidence_intervals,
        "proportionIntervals": proportion_intervals,
        "mcnemar": mcnemar_rows,
        "pairedBootstrapDifferences": paired,
        "multipleComparisonCorrection": "Holm-Bonferroni",
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"modelsBootstrapped": sorted(predictions), "mcnemarComparisons": len(mcnemar_rows)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
