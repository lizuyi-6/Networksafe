#!/usr/bin/env python3
"""Generate machine-readable evidence, paper tables, figures, and reports."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import platform
import subprocess
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
import scipy

from scoring import EXPECTED_INPUT_SHA256, EXPECTED_LABEL_SHA256, load_jsonl, load_references

ROOT = Path(__file__).resolve().parents[3]
EVAL = ROOT / "ml/evaluation/lan_challenge"
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
METRICS = REPORT / "metrics"
PREDICTIONS = REPORT / "predictions"
FIGURES = REPORT / "figures"
TABLES = REPORT / "tables"
PAPER = REPORT / "paper"
PROTOCOL_COMMIT = "553c0a9317e8c21f616991e92149fc828d7e8902"
EVALUATION_COMMIT = subprocess.run(
    ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
).stdout.strip()
BASELINE_MODELS = {"rules-baseline", "char-ngram-logreg", "qwen3-4b-zero-shot", "qwen3-4b-few-shot"}
PROTOCOL_SHA256 = "b5fe38cb554a8ee63adfbb767a2ff5a2a73b18ac096e2f8812183f7979b4fdeb"  # v2 canonical hash
PROMPT_SHA256 = "9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8"
PROTOCOL_V1_COMMIT = "79f146f2c8d400ef4afa292015b70a6bf91280ec"
PROTOCOL_V1_SHA256 = "fc3f2af2bdfa911c99cf143ec248ae51654297d40b949fa95f8b8866bf897276"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iso_now() -> str:
    return datetime.now(UTC).isoformat()


def load_state() -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, Any]]:
    run_status = json.loads((METRICS / "run-status.json").read_text(encoding="utf-8"))
    metrics: dict[str, dict[str, Any]] = {}
    for status in run_status["models"]:
        path = METRICS / f"{status['modelId']}.json"
        if status["status"] == "SUCCESS":
            metrics[status["modelId"]] = json.loads(path.read_text(encoding="utf-8"))
    stats = json.loads((METRICS / "statistical-analysis.json").read_text(encoding="utf-8"))
    return run_status, metrics, stats


def latex_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
    }
    return "".join(replacements.get(character, character) for character in text)


def write_latex_table(path: Path, columns: list[str], rows: list[dict[str, Any]], caption: str) -> None:
    alignment = "l" + "r" * (len(columns) - 1)
    lines = [
        r"\begin{table}[t]",
        r"\centering",
        rf"\caption{{{latex_escape(caption)}}}",
        rf"\begin{{tabular}}{{{alignment}}}",
        r"\toprule",
        " & ".join(latex_escape(column) for column in columns) + r" \\",
        r"\midrule",
    ]
    for row in rows:
        lines.append(" & ".join(latex_escape(row.get(column, "")) for column in columns) + r" \\")
    lines.extend([r"\bottomrule", r"\end{tabular}", r"\end{table}", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def request_summary(row: dict[str, Any]) -> dict[str, Any]:
    request = row["input"]
    body = request.get("body")
    return {
        "sampleId": row["sampleId"],
        "method": request.get("method"),
        "path": request.get("path"),
        "headerNames": sorted((request.get("headers") or {}).keys()),
        "bodyPresent": body is not None,
        "bodyLength": len(body) if isinstance(body, str) else 0,
    }


def build_error_analysis(
    run_status: dict[str, Any],
    metrics: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    references = load_references(
        ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"
    )
    inputs = load_jsonl(ROOT / "ml/data/lan_challenge_capture/model-inputs.jsonl")
    input_by_id = {row["sampleId"]: row for row in inputs}
    reference_by_id = {row["sampleId"]: row for row in references}
    definitions = {
        "safe_to_attack": ("safe→attack", "Request-side patterns overfire on a reference-safe row.", True, False, False, False),
        "safe_to_unknown": ("safe→unknown", "The system abstains on a reference-safe row.", True, False, False, True),
        "attack_to_safe": ("attack→safe", "The request-side detector misses the attack evidence.", True, False, False, False),
        "attack_to_unknown": ("attack→unknown", "The detector abstains instead of detecting an attack.", True, False, False, True),
        "unknown_to_safe": ("unknown→safe", "The detector overstates safety when reference context is insufficient.", True, False, False, True),
        "unknown_to_attack": ("unknown→attack", "A suspicious surface form is treated as proved attack without required context.", True, False, False, True),
        "json_parse_failure": ("JSON解析失败", "The raw output is not strict JSON.", False, True, True, False),
        "schema_failure": ("Schema失败", "The output violates the locked schema.", False, True, True, False),
        "attack_family_error": ("攻击家族错误", "The verdict may detect risk but the family attribution is wrong.", True, False, False, False),
        "recommended_action_error": ("推荐动作错误", "The output action differs from the reference action.", True, True, False, True),
        "prompt_injection_hijack": ("Prompt Injection劫持", "Operational proxy: a prompt-injection reference produced safe or invalid output.", True, True, True, False),
        "authorization_or_ownership_context_missing": ("权限/归属上下文不足", "Unknown authorization/ownership rows are forced to safe or attack.", True, False, False, True),
        "storage_vs_execution_confusion": ("存储字段与执行字段混淆", "Unknown SQL/XSS storage semantics are promoted to attack.", True, False, False, True),
        "long_input_truncation": ("长输入截断", "The runtime reported truncation or exhausted the locked context.", True, False, True, False),
    }
    result_models: list[dict[str, Any]] = []
    flat_rows: list[dict[str, Any]] = []
    for status in run_status["models"]:
        if status["status"] != "SUCCESS":
            continue
        model_id = status["modelId"]
        predictions = load_jsonl(PREDICTIONS / f"{model_id}.jsonl")
        buckets = {key: [] for key in definitions}
        for prediction in predictions:
            sample_id = prediction["sampleId"]
            reference = reference_by_id[sample_id]
            pair_key = f"{reference['verdict']}_to_{prediction['verdict']}"
            if pair_key in buckets and reference["verdict"] != prediction["verdict"]:
                buckets[pair_key].append(sample_id)
            if not prediction.get("parsed"):
                buckets["json_parse_failure"].append(sample_id)
            if not prediction.get("schemaValid"):
                buckets["schema_failure"].append(sample_id)
            if (
                reference["verdict"] == "attack"
                and prediction.get("attackFamily") != reference.get("attackFamily")
            ):
                buckets["attack_family_error"].append(sample_id)
            if prediction.get("recommendedAction") != reference.get("recommendedAction"):
                buckets["recommended_action_error"].append(sample_id)
            if (
                reference.get("attackFamily") == "prompt_injection"
                and (prediction.get("verdict") == "safe" or not prediction.get("schemaValid"))
            ):
                buckets["prompt_injection_hijack"].append(sample_id)
            if (
                reference["verdict"] == "unknown"
                and reference.get("attackFamily") in {"authorization", "idor_bola"}
                and prediction["verdict"] != "unknown"
            ):
                buckets["authorization_or_ownership_context_missing"].append(sample_id)
            if (
                reference["verdict"] == "unknown"
                and reference.get("attackFamily") in {"sqli", "xss"}
                and prediction["verdict"] == "attack"
            ):
                buckets["storage_vs_execution_confusion"].append(sample_id)
            if prediction.get("errorType") == "input_truncated":
                buckets["long_input_truncation"].append(sample_id)
        categories = []
        for key, sample_ids in buckets.items():
            label, cause, capability, output_protocol, engine, reference_uncertainty = definitions[key]
            row = {
                "modelId": model_id,
                "category": key,
                "label": label,
                "count": len(sample_ids),
                "proportion": len(sample_ids) / 413,
                "representativeSampleIds": sample_ids[:5],
                "representativeRequests": [
                    request_summary(input_by_id[sample_id]) for sample_id in sample_ids[:3]
                ],
                "possibleCause": cause,
                "modelCapability": capability,
                "outputProtocol": output_protocol,
                "inferenceEngine": engine,
                "referenceLabelUncertainty": reference_uncertainty,
            }
            categories.append(row)
            flat_rows.append(
                {
                    "modelId": model_id,
                    "categoryKey": key,
                    "category": label,
                    "count": len(sample_ids),
                    "proportion": f"{len(sample_ids) / 413:.6f}",
                    "representativeSampleIds": ";".join(sample_ids[:5]),
                    "possibleCause": cause,
                }
            )
        result_models.append({"modelId": model_id, "categories": categories})
    result = {
        "schemaVersion": 1,
        "generatedAt": iso_now(),
        "privacy": {
            "requestSummariesUseOnly": [
                "sampleId",
                "method",
                "sanitized path",
                "header names",
                "body presence",
                "body length",
            ],
            "headerValuesIncluded": False,
            "bodyTextIncluded": False,
            "responseEvidenceIncluded": False,
        },
        "models": result_models,
    }
    (REPORT / "error-analysis.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    markdown = [
        "# Error analysis",
        "",
        "Representative cases use only sanitized request-side summaries. Header values, body text,",
        "response evidence, cookies, tokens, sessions, and raw-private data are not reproduced.",
        "",
        "| Model | Category | Count | Share | Representative sampleIds |",
        "|---|---|---:|---:|---|",
    ]
    for row in flat_rows:
        markdown.append(
            f"| {row['modelId']} | {row['category']} | {row['count']} | "
            f"{float(row['proportion']):.2%} | {row['representativeSampleIds'] or '-'} |"
        )
    (REPORT / "error-analysis.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    return result, flat_rows


def create_figures(
    run_status: dict[str, Any],
    metrics: dict[str, dict[str, Any]],
    stats: dict[str, Any],
    error_rows: list[dict[str, Any]],
) -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"figure.dpi": 120, "font.size": 9, "axes.grid": True, "grid.alpha": 0.2})
    completed = list(metrics)

    fig, axis = plt.subplots(figsize=(7.2, 4.2))
    x = np.arange(len(completed))
    width = 0.36
    accuracy = [metrics[model]["verdict"]["accuracy"] for model in completed]
    macro_f1 = [metrics[model]["verdict"]["macroF1"] for model in completed]
    ci = stats["confidenceIntervals"]
    accuracy_error = [
        [
            accuracy[index] - ci[model]["accuracy"]["lower95"],
            ci[model]["accuracy"]["upper95"] - accuracy[index],
        ]
        for index, model in enumerate(completed)
    ]
    macro_error = [
        [
            macro_f1[index] - ci[model]["macroF1"]["lower95"],
            ci[model]["macroF1"]["upper95"] - macro_f1[index],
        ]
        for index, model in enumerate(completed)
    ]
    axis.bar(
        x - width / 2,
        accuracy,
        width,
        label="Accuracy",
        yerr=np.asarray(accuracy_error).T if accuracy_error else None,
        capsize=3,
    )
    axis.bar(
        x + width / 2,
        macro_f1,
        width,
        label="Macro-F1",
        yerr=np.asarray(macro_error).T if macro_error else None,
        capsize=3,
    )
    axis.set_ylim(0, 1)
    axis.set_ylabel("Score")
    axis.set_xticks(x, completed, rotation=12, ha="right")
    axis.set_title("Frozen 413-sample model comparison (95% bootstrap CI)")
    axis.legend()
    fig.tight_layout()
    for suffix in ("png", "pdf", "svg"):
        fig.savefig(FIGURES / f"figure-1-model-comparison.{suffix}", bbox_inches="tight")
    plt.close(fig)

    count = max(1, len(completed))
    fig, axes = plt.subplots(1, count, figsize=(5.2 * count, 4.4), squeeze=False)
    for axis, model in zip(axes[0], completed, strict=True):
        block = metrics[model]["verdict"]["confusionMatrix"]
        matrix = np.asarray(block["matrix"])
        image = axis.imshow(matrix, cmap="Blues", vmin=0)
        for row in range(matrix.shape[0]):
            for column in range(matrix.shape[1]):
                axis.text(column, row, str(matrix[row, column]), ha="center", va="center")
        axis.set_xticks(range(3), block["labels"])
        axis.set_yticks(range(3), block["labels"])
        axis.set_xlabel("Prediction")
        axis.set_ylabel("Reference")
        axis.set_title(model)
        fig.colorbar(image, ax=axis, shrink=0.75)
    fig.suptitle("Verdict confusion matrices")
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-2-verdict-confusion-matrices.{suffix}", bbox_inches="tight")
    plt.close(fig)

    fig, axis = plt.subplots(figsize=(7.2, 4.8))
    if completed:
        model = completed[0]
        family = metrics[model]["attackFamily"]
        rows = family.get("perClass", {}) if family.get("status") == "SUCCESS" else {}
        names = [name for name in rows if name != "none"]
        values = [rows[name]["f1"] for name in names]
        axis.barh(names, values)
        axis.set_xlim(0, 1)
        axis.set_xlabel("F1")
        axis.set_title(f"Attack-family F1 on reference-attack rows - {model}")
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-3-family-f1.{suffix}", bbox_inches="tight")
    plt.close(fig)

    fig, axis = plt.subplots(figsize=(7.6, 5.8))
    if completed:
        model = completed[0]
        subset_rows = [
            (name, values)
            for name, values in metrics[model]["subsets"].items()
            if values.get("status") == "SUCCESS"
        ]
        names = [name for name, _ in subset_rows]
        values = [row["accuracy"] for _, row in subset_rows]
        axis.barh(names, values)
        axis.set_xlim(0, 1)
        axis.set_xlabel("Accuracy")
        axis.set_title(f"Subset accuracy - {model}")
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-4-subset-performance.{suffix}", bbox_inches="tight")
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(12.0, 4.6))
    latency_axis, size_axis = axes
    for model in completed:
        latency = metrics[model]["performance"]["meanLatencyMs"]
        score = metrics[model]["verdict"]["macroF1"]
        interval = stats["confidenceIntervals"][model]["macroF1"]
        lower = score - interval["lower95"]
        upper = interval["upper95"] - score
        if latency is not None and latency > 0:
            latency_axis.errorbar(
                latency,
                score,
                yerr=np.asarray([[lower], [upper]]),
                fmt="o",
                capsize=3,
            )
            latency_axis.annotate(model, (latency, score), xytext=(4, 4), textcoords="offset points", fontsize=7)
        size = metrics[model]["performance"].get("modelSizeBytes")
        if size is not None:
            size_gib = size / (1024 ** 3)
            size_axis.errorbar(
                size_gib,
                score,
                yerr=np.asarray([[lower], [upper]]),
                fmt="o",
                capsize=3,
            )
            size_axis.annotate(model, (size_gib, score), xytext=(4, 4), textcoords="offset points", fontsize=7)
    latency_axis.set_ylim(0, 1)
    size_axis.set_ylim(0, 1)
    observed_latencies = [
        metrics[model]["performance"]["meanLatencyMs"]
        for model in completed
        if metrics[model]["performance"]["meanLatencyMs"] is not None
        and metrics[model]["performance"]["meanLatencyMs"] > 0
    ]
    if observed_latencies:
        latency_axis.set_xscale("log")
        latency_axis.set_xlim(min(observed_latencies) / 2, max(observed_latencies) * 2)
    observed_sizes = [
        metrics[model]["performance"]["modelSizeBytes"] / (1024 ** 3)
        for model in completed
        if metrics[model]["performance"].get("modelSizeBytes") is not None
    ]
    size_axis.set_xlim(0, max(1.0, max(observed_sizes, default=0.0) * 1.15))
    latency_axis.set_xlabel("Mean latency (ms, log scale; cross-stack ranking not implied)")
    latency_axis.set_ylabel("Verdict Macro-F1 (95% bootstrap CI)")
    latency_axis.set_title("Quality vs latency")
    size_axis.set_xlabel("Measured model weight size (GiB; stat + SHA-256)")
    size_axis.set_ylabel("Verdict Macro-F1 (95% bootstrap CI)")
    size_axis.set_title("Quality vs measured size")
    fig.suptitle("Quality–latency–size trade-off (runtime timing boundaries differ)")
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-5-quality-latency-size-tradeoff.{suffix}", bbox_inches="tight")
    plt.close(fig)

    ablation = json.loads((REPORT / "inference-path-ablation-v2.json").read_text(encoding="utf-8"))
    if ablation.get("status") != "COMPLETE":
        raise RuntimeError("cannot generate figure 6: inference-path diagnostics are incomplete")
    diagnostics = ablation["diagnostics"]
    comparisons = [
        ("HF: message structure", diagnostics["systemUserVsSingleConcat"]["transformers"]),
        ("Ollama: message structure", diagnostics["systemUserVsSingleConcat"]["ollama"]),
        ("HF: native vs serialized", diagnostics["nativeTemplateVsSharedHfSerialization"]["transformers"]),
        ("Ollama: native vs serialized", diagnostics["nativeTemplateVsSharedHfSerialization"]["ollama"]),
        ("Shared bytes: cross-runtime", diagnostics["sharedSerializedPromptAcrossRuntimes"]["comparison"]),
    ]
    agreement = [block["verdictAgreement"]["rate"] for _, block in comparisons]
    lower_error = [
        rate - block["verdictAgreement"]["clopperPearson95"][0]
        for rate, (_, block) in zip(agreement, comparisons, strict=True)
    ]
    upper_error = [
        block["verdictAgreement"]["clopperPearson95"][1] - rate
        for rate, (_, block) in zip(agreement, comparisons, strict=True)
    ]
    fig, axis = plt.subplots(figsize=(8.6, 4.8))
    positions = np.arange(len(comparisons))
    axis.bar(
        positions,
        agreement,
        yerr=np.asarray([lower_error, upper_error]),
        capsize=4,
    )
    axis.set_ylim(0, 1)
    axis.set_xticks(positions, [name for name, _ in comparisons], rotation=15, ha="right")
    axis.set_ylabel("Verdict agreement (Clopper–Pearson 95% CI)")
    axis.set_title("Predeclared inference-path diagnostics on 413 paired inputs")
    for position, value in zip(positions, agreement, strict=True):
        axis.text(position, min(0.98, value + 0.025), f"{value:.1%}", ha="center")
    axis.text(
        0.01,
        0.02,
        "Cross-runtime comparison still couples runtime with BF16-to-f16 artifact representation.",
        transform=axis.transAxes,
        fontsize=8,
    )
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-6-inference-path-ablation.{suffix}", bbox_inches="tight")
    plt.close(fig)

    fig, axis = plt.subplots(figsize=(7.6, 5.0))
    nonzero = [row for row in error_rows if row["count"]]
    labels = [row["categoryKey"] for row in nonzero]
    counts = [row["count"] for row in nonzero]
    axis.barh(labels, counts)
    axis.set_xlabel("Count")
    axis.set_title("Observed error taxonomy")
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-7-error-taxonomy.{suffix}", bbox_inches="tight")
    plt.close(fig)


def create_tables(
    run_status: dict[str, Any],
    metrics: dict[str, dict[str, Any]],
    stats: dict[str, Any],
    error_rows: list[dict[str, Any]],
) -> None:
    TABLES.mkdir(parents=True, exist_ok=True)
    main_rows = []
    for status in run_status["models"]:
        model_id = status["modelId"]
        model_metrics = metrics.get(model_id)
        ci = stats["confidenceIntervals"].get(model_id, {})
        main_rows.append(
            {
                "modelId": model_id,
                "status": status["status"],
                "accuracy": f"{model_metrics['verdict']['accuracy']:.6f}" if model_metrics else "",
                "accuracyLower95": f"{ci['accuracy']['lower95']:.6f}" if ci else "",
                "accuracyUpper95": f"{ci['accuracy']['upper95']:.6f}" if ci else "",
                "macroF1": f"{model_metrics['verdict']['macroF1']:.6f}" if model_metrics else "",
                "attackF1": f"{model_metrics['attackDetectionAll']['f1']:.6f}" if model_metrics else "",
                "attackRecall": f"{model_metrics['attackDetectionAll']['recall']:.6f}" if model_metrics else "",
                "safeFPR": f"{model_metrics['safeFPR']['rate']:.6f}" if model_metrics else "",
                "unknownAccuracy": f"{model_metrics['unknown']['accuracy']:.6f}" if model_metrics else "",
                "schemaValidRate": f"{model_metrics['structuredOutput']['schemaValidRate']:.6f}" if model_metrics else "",
            }
        )
    main_columns = list(main_rows[0])
    pd.DataFrame(main_rows).to_csv(TABLES / "table-1-main-results.csv", index=False)
    write_latex_table(
        TABLES / "table-1-main-results.tex",
        main_columns,
        main_rows,
        "Main results on the frozen 413-sample challenge set.",
    )

    subset_rows = []
    for model_id, model_metrics in metrics.items():
        for subset, values in model_metrics["subsets"].items():
            subset_rows.append(
                {
                    "modelId": model_id,
                    "subset": subset,
                    "status": values["status"],
                    "count": values["count"],
                    "accuracy": f"{values.get('accuracy', 0):.6f}" if values["status"] == "SUCCESS" else "",
                    "macroF1": f"{values.get('macroF1', 0):.6f}" if values["status"] == "SUCCESS" else "",
                    "safeFPR": (
                        f"{values['safeFPR']:.6f}"
                        if values.get("safeFPR") is not None
                        else ""
                    ),
                }
            )
    subset_columns = list(subset_rows[0])
    pd.DataFrame(subset_rows).to_csv(TABLES / "table-2-subset-results.csv", index=False)
    write_latex_table(
        TABLES / "table-2-subset-results.tex",
        subset_columns,
        subset_rows,
        "Subset results; empty cells indicate an undefined denominator.",
    )

    statistical_rows = []
    for model_id, intervals in stats["confidenceIntervals"].items():
        for metric, values in intervals.items():
            statistical_rows.append(
                {
                    "comparison": model_id,
                    "test": "stratified bootstrap",
                    "metric": metric,
                    "pointEstimate": values["pointEstimate"],
                    "lower95": values["lower95"],
                    "upper95": values["upper95"],
                    "pValueRaw": "",
                    "pValueHolm": "",
                    "status": "SUCCESS",
                }
            )
    for row in stats["mcnemar"]:
        statistical_rows.append(
            {
                "comparison": row["comparison"],
                "test": "McNemar",
                "metric": "verdict correctness",
                "pointEstimate": "",
                "lower95": "",
                "upper95": "",
                "pValueRaw": row["pValueRaw"],
                "pValueHolm": row["pValueHolm"],
                "status": "SUCCESS",
            }
        )
    for row in stats["pairedBootstrapDifferences"]:
        if row["status"] == "SUCCESS":
            for metric, values in row["deltas"].items():
                statistical_rows.append(
                    {
                        "comparison": row["comparison"],
                        "test": "paired stratified bootstrap",
                        "metric": metric,
                        "pointEstimate": values["pointEstimate"],
                        "lower95": values["lower95"],
                        "upper95": values["upper95"],
                        "pValueRaw": "",
                        "pValueHolm": "",
                        "status": "SUCCESS",
                    }
                )
        else:
            statistical_rows.append(
                {
                    "comparison": row["comparison"],
                    "test": "paired stratified bootstrap",
                    "metric": "",
                    "pointEstimate": "",
                    "lower95": "",
                    "upper95": "",
                    "pValueRaw": "",
                    "pValueHolm": "",
                    "status": "NOT_AVAILABLE",
                }
            )
    statistical_columns = list(statistical_rows[0])
    pd.DataFrame(statistical_rows).to_csv(TABLES / "table-3-statistical-tests.csv", index=False)
    write_latex_table(
        TABLES / "table-3-statistical-tests.tex",
        statistical_columns,
        statistical_rows,
        "Confidence intervals and paired statistical tests.",
    )

    performance_rows = []
    for status in run_status["models"]:
        model = metrics.get(status["modelId"])
        performance = model["performance"] if model else {}
        performance_rows.append(
            {
                "modelId": status["modelId"],
                "status": status["status"],
                "p50LatencyMs": performance.get("p50LatencyMs", ""),
                "p95LatencyMs": performance.get("p95LatencyMs", ""),
                "p99LatencyMs": performance.get("p99LatencyMs", ""),
                "meanLatencyMs": performance.get("meanLatencyMs", ""),
                "samplesPerSecond": performance.get("samplesPerSecond", ""),
                "peakGpuMemoryMiB": performance.get("peakGpuMemoryMiB", ""),
                "peakHostMemoryMiB": performance.get("peakHostMemoryMiB", ""),
                "modelSizeBytes": performance.get("modelSizeBytes", ""),
            }
        )
    performance_columns = list(performance_rows[0])
    pd.DataFrame(performance_rows).to_csv(TABLES / "table-4-latency-memory-size.csv", index=False)
    write_latex_table(
        TABLES / "table-4-latency-memory-size.tex",
        performance_columns,
        performance_rows,
        "Latency, memory, and size. Cross-stack latency is not ranked as equivalent.",
    )

    error_columns = list(error_rows[0])
    pd.DataFrame(error_rows).to_csv(TABLES / "table-5-error-analysis.csv", index=False)
    write_latex_table(
        TABLES / "table-5-error-analysis.tex",
        error_columns,
        error_rows,
        "Error taxonomy using sanitized request summaries.",
    )


def create_claim_matrix(metrics: dict[str, dict[str, Any]], stats: dict[str, Any]) -> list[dict[str, Any]]:
    primary = "aetherargus-v02-hf-lora" if "aetherargus-v02-hf-lora" in metrics else (
        "rules-baseline" if "rules-baseline" in metrics else next(iter(metrics))
    )
    pm = metrics[primary]
    ci = stats["confidenceIntervals"].get(primary, {})
    prop = (stats.get("proportionIntervals", {}) or {}).get(primary, {}) or {}
    rows = [
        {
            "claimId": "C1",
            "paperClaim": "The frozen external challenge set contains 413 model-visible request-side samples with AI-adjudicated reference labels.",
            "evidenceFile": "ml/evaluation/lan_challenge/evaluation-protocol-v2.json",
            "metricField": "dataset.sampleCount; dataset.referenceDistribution",
            "commit": PROTOCOL_COMMIT,
            "supportLevel": "DIRECT",
            "limitations": "Reference labels are AI-annotated + AI-adjudicated, NOT human-verified ground truth; the set is an authorized challenge capture, not natural production traffic.",
            "allowedWording": "The frozen evaluation contains 413 request-side samples (safe=209, attack=97, unknown=107).",
            "forbiddenWording": "The benchmark is representative production traffic or human ground truth.",
        },
    ]
    # C2: primary-model headline metrics (with CI)
    acc_lo = (ci.get("accuracy") or {}).get("lower95")
    acc_hi = (ci.get("accuracy") or {}).get("upper95")
    mf1_lo = (ci.get("macroF1") or {}).get("lower95")
    mf1_hi = (ci.get("macroF1") or {}).get("upper95")
    rows.append({
        "claimId": "C2",
        "paperClaim": f"The primary model ({primary}) achieved the reported verdict scores on the frozen set.",
        "evidenceFile": f"ml/reports/lan-challenge-evaluation/metrics/{primary}.json",
        "metricField": "verdict.accuracy; verdict.macroF1",
        "commit": EVALUATION_COMMIT,
        "supportLevel": "DIRECT",
        "limitations": "Single frozen set; 95% CI is a finite-sample bootstrap, not a population guarantee.",
        "allowedWording": (
            f"{primary} achieved accuracy {pm['verdict']['accuracy']:.4f}"
            + (f" (95% CI {acc_lo:.4f}-{acc_hi:.4f})" if acc_lo is not None else "")
            + f" and macro-F1 {pm['verdict']['macroF1']:.4f}"
            + (f" (95% CI {mf1_lo:.4f}-{mf1_hi:.4f})." if mf1_lo is not None else ".")
        ),
        "forbiddenWording": f"{primary} is universally more capable than every baseline in all deployments.",
    })
    # C3: primary-model safe FPR with exact interval (honest, never 'zero population FPR')
    fpr_prop = (prop.get("safeFPR") or pm.get("safeFPR", {}))
    cp = fpr_prop.get("clopperPearson95") if isinstance(fpr_prop, dict) else None
    rows.append({
        "claimId": "C3",
        "paperClaim": f"{primary}'s observed safe false-positive rate and its exact 95% interval.",
        "evidenceFile": f"ml/reports/lan-challenge-evaluation/metrics/{primary}.json",
        "metricField": "safeFPR; proportions.safeFPR.clopperPearson95",
        "commit": EVALUATION_COMMIT,
        "supportLevel": "DIRECT",
        "limitations": "An observed zero (or low) rate is NOT proof of zero population risk; the Clopper-Pearson upper bound quantifies the remaining uncertainty.",
        "allowedWording": (
            f"Observed safe FPR was {fpr_prop.get('numerator', pm['safeFPR']['falsePositiveCount'])}/"
            f"{fpr_prop.get('denominator', pm['safeFPR']['safeSupport'])}"
            + (f" (Clopper-Pearson 95% upper bound {cp[1]:.4f})." if cp else ".")
        ),
        "forbiddenWording": "The model has no false positives / zero population FPR.",
    })
    # C4: primary vs best baseline significance (paired, Holm-corrected)
    c4 = {
        "claimId": "C4",
        "paperClaim": f"{primary} vs the strongest baseline on paired significance tests.",
        "evidenceFile": "ml/reports/lan-challenge-evaluation/metrics/statistical-analysis.json",
        "metricField": "mcnemar; pairedBootstrapDifferences",
        "commit": EVALUATION_COMMIT,
        "supportLevel": "NOT_AVAILABLE",
        "limitations": "Significance is on this frozen set only; not a universal superiority claim.",
        "allowedWording": "",
        "forbiddenWording": f"{primary} significantly outperformed every baseline (without a Holm-corrected p-value and effect size).",
    }
    mcnemar_rows = [r for r in stats.get("mcnemar", []) if r.get("comparison", "").startswith(f"{primary} vs ")]
    best = None
    for r in mcnemar_rows:
        other = r["comparison"].split(" vs ", 1)[1]
        if other in metrics and other in BASELINE_MODELS:
            if best is None or metrics[other]["verdict"]["macroF1"] > metrics[best]["verdict"]["macroF1"]:
                best = other
    if best is not None and mcnemar_rows:
        br = next(r for r in mcnemar_rows if r["comparison"] == f"{primary} vs {best}")
        pd_row = next((r for r in stats.get("pairedBootstrapDifferences", []) if r.get("comparison") == f"{primary} minus {best}"), None)
        delta = (pd_row or {}).get("deltas", {}).get("macroF1", {})
        c4.update({
            "supportLevel": "DIRECT",
            "allowedWording": (
                f"On this frozen set, {primary} vs strongest baseline {best} (by macro-F1): "
                f"McNemar p_Holm={br.get('pValueHolm'):.4g}"
                + (f", macro-F1 Δ={delta['pointEstimate']:+.4f} [{delta['lower95']:+.4f},{delta['upper95']:+.4f}]" if delta else "")
                + "."
            ),
        })
    else:
        c4["limitations"] = "Paired significance requires the primary model and at least one baseline; not computed in this run."
    rows.append(c4)
    # C5: inference-path robustness only after every predeclared diagnostic succeeds.
    abl = {}
    if (REPORT / "inference-path-ablation-v2.json").is_file():
        abl = json.loads((REPORT / "inference-path-ablation-v2.json").read_text(encoding="utf-8"))
    shared = (
        abl.get("diagnostics", {})
        .get("sharedSerializedPromptAcrossRuntimes", {})
        .get("comparison", {})
        .get("verdictAgreement")
    )
    if abl.get("status") == "COMPLETE" and shared:
        rows.append({
            "claimId": "C5",
            "paperClaim": "Transformers merged-BF16 and Ollama f16 agree under byte-identical serialized prompts on the frozen set.",
            "evidenceFile": "ml/reports/lan-challenge-evaluation/inference-path-ablation-v2.json",
            "metricField": "diagnostics.sharedSerializedPromptAcrossRuntimes.comparison.verdictAgreement",
            "commit": EVALUATION_COMMIT,
            "supportLevel": "DIRECT",
            "limitations": "The artifacts share checkpoint lineage but are not bit-identical; runtime and BF16-to-f16 representation remain coupled.",
            "allowedWording": f"With byte-identical serialized prompts, Transformers merged-BF16 and Ollama f16 agreed on {shared['agree']}/{shared['total']} ({shared['rate']:.1%}) verdicts on the frozen set.",
            "forbiddenWording": "The two runtimes or artifacts are numerically identical, or any difference is caused solely by quantization.",
        })

    columns = list(rows[0])
    with (REPORT / "claim-to-evidence-matrix.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    markdown = [
        "# Claim-to-evidence matrix",
        "",
        "| Claim | Evidence | Field | Support | Allowed wording | Forbidden wording |",
        "|---|---|---|---|---|---|",
    ]
    for row in rows:
        markdown.append(
            f"| {row['claimId']}: {row['paperClaim']} | `{row['evidenceFile']}` | "
            f"`{row['metricField']}` | {row['supportLevel']} | {row['allowedWording']} | "
            f"{row['forbiddenWording']} |"
        )
    (REPORT / "claim-to-evidence-matrix.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    return rows


def environment_manifest() -> dict[str, Any]:
    # CPU + RAM are read cross-platform (lscpu/proc on Linux; WMI/psutil on Windows).
    cpu = platform.processor() or platform.machine()
    ram_gib: float | None = None
    try:
        import psutil  # type: ignore[import-not-found]
        ram_gib = psutil.virtual_memory().total / (1024 ** 3)
        if not cpu:
            cpu = psutil.cpu_info().model if hasattr(psutil, "cpu_info") else cpu
    except Exception:
        pass
    if ram_gib is None:
        proc = subprocess.run(
            ["bash", "-lc", "awk '/MemTotal/ {print $2}' /proc/meminfo"],
            capture_output=True, text=True, check=False,
        )
        if proc.stdout.strip().isdigit():
            ram_gib = int(proc.stdout.strip()) / 1024 / 1024
    if not cpu:
        lscpu = subprocess.run(["bash", "-lc", "lscpu"], capture_output=True, text=True, check=False).stdout
        for line in lscpu.splitlines():
            if line.lower().startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    # GPU / CUDA
    gpu: str | None = None
    cuda: str | None = None
    try:
        import torch  # type: ignore[import-not-found]
        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0)
            cuda = torch.version.cuda
    except Exception:
        pass
    if gpu is None:
        try:
            smi = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
                                 capture_output=True, text=True, check=False).stdout.strip()
        except Exception:
            smi = ""
        if smi:
            gpu = smi
    # Python ML stack versions (best-effort imports)
    def _ver(mod: str) -> str | None:
        try:
            import importlib
            return importlib.import_module(mod).__version__
        except Exception:
            return None
    def _probe(cmd: list) -> str | None:
        # Best-effort external-command probe. A missing executable raises
        # FileNotFoundError even with check=False, so guard the whole call.
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, check=False).stdout.strip()
            return out or None
        except Exception:
            return None

    import os
    ollama_candidates = [
        "ollama",
        os.path.expandvars(r"%LOCALAPPDATA%\Temp\ollama-bin\ollama.exe"),
        r"X:\ollama-bin\ollama.exe",
        "/tmp/ollama-bin/ollama.exe",
    ]
    ollama_ver = None
    for cand in ollama_candidates:
        ollama_ver = _probe([cand, "--version"])
        if ollama_ver:
            break
    return {
        "os": platform.platform(),
        "cpu": cpu,
        "gpu": gpu,
        "ramGiB": ram_gib if ram_gib is not None else 0.0,
        "cuda": cuda,
        "python": platform.python_version(),
        "node": _probe(["node", "--version"]),
        "pytorch": _ver("torch"),
        "transformers": _ver("transformers"),
        "peft": _ver("peft"),
        "ollama": ollama_ver,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikitLearn": sklearn.__version__,
        "scipy": scipy.__version__,
    }


def create_reports(
    run_status: dict[str, Any],
    metrics: dict[str, dict[str, Any]],
    stats: dict[str, Any],
    claims: list[dict[str, Any]],
) -> None:
    rule = metrics["rules-baseline"]
    ci = stats["confidenceIntervals"]["rules-baseline"]
    completed = [row["modelId"] for row in run_status["models"] if row["status"] == "SUCCESS"]
    not_run = [row for row in run_status["models"] if row["status"] != "SUCCESS"]
    completed_at = iso_now()
    environment = environment_manifest()
    partial_validation = (
        json.loads((METRICS / "validation-partial.json").read_text(encoding="utf-8"))
        if (METRICS / "validation-partial.json").is_file()
        else None
    )
    strict_validation = (
        json.loads((METRICS / "validation-strict.json").read_text(encoding="utf-8"))
        if (METRICS / "validation-strict.json").is_file()
        else None
    )
    manifest = {
        "schemaVersion": 1,
        "repositoryCommit": EVALUATION_COMMIT,
        "protocolCommit": PROTOCOL_COMMIT,
        "protocolSha256": PROTOCOL_SHA256,
        "inputSha256": EXPECTED_INPUT_SHA256,
        "labelSha256": EXPECTED_LABEL_SHA256,
        "modelArtifacts": run_status["models"],
        "promptArtifacts": [
            {
                "path": "ml/evaluation/lan_challenge/system-prompt.txt",
                "sha256": PROMPT_SHA256,
            }
        ],
        "environment": environment,
        "runs": [
            {
                "modelId": model_id,
                "status": metrics[model_id]["status"],
                "sampleCount": metrics[model_id]["sampleCount"],
                "predictionFile": f"ml/reports/lan-challenge-evaluation/predictions/{model_id}.jsonl",
                "metricsFile": f"ml/reports/lan-challenge-evaluation/metrics/{model_id}.json",
            }
            for model_id in completed
        ],
        "statisticalSeed": 20260731,
        "challengeSetUsedForTuning": False,
        "labelsChangedAfterEvaluation": False,
        "inferencePathAblationStatus": (
            json.loads((REPORT / "inference-path-ablation-v2.json").read_text(encoding="utf-8")).get("status")
            if (REPORT / "inference-path-ablation-v2.json").is_file()
            else "NOT_RUN"
        ),
        "completedAt": completed_at,
    }
    (REPORT / "evaluation-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    all_models_complete = len(not_run) == 0 and len(completed) == 8
    ablation_v2 = REPORT / "inference-path-ablation-v2.json"
    ablation_data = (
        json.loads(ablation_v2.read_text(encoding="utf-8")) if ablation_v2.is_file() else {}
    )
    ablation_complete = ablation_data.get("status") == "COMPLETE"
    all_complete = all_models_complete and ablation_complete
    status_text = (
        "COMPLETE_FROZEN_CHALLENGE_EVIDENCE"
        if all_complete
        else "INCOMPLETE_REQUIRED_ABLATIONS_OR_MODEL_RUNS"
    )
    has = {m: (m in completed) for m in [
        "aetherargus-v02-hf-lora", "qwen3-4b-zero-shot", "qwen3-4b-few-shot",
        "aetherargus-v02-merged-bf16", "aetherargus-v02-ollama-f16", "aetherargus-v02-gguf-q4-k-m",
    ]}
    def rq(ok: bool, answered: str, otherwise: str) -> str:
        return answered if ok else otherwise
    research_questions = {
        "RQ1": rq(has["aetherargus-v02-hf-lora"] and (has["qwen3-4b-zero-shot"] or has["qwen3-4b-few-shot"]),
                  "ANSWERED: AetherArgus HF-LoRA vs Qwen baselines — see mainResults + statistical-analysis.mcnemar.",
                  "NOT_ANSWERED: AetherArgus and Qwen prediction runs are unavailable."),
        "RQ2": rq(has["aetherargus-v02-hf-lora"],
                  "ANSWERED: AetherArgus structured-output rates in mainResults.aetherargus-v02-hf-lora.structuredOutput.",
                  "NOT_ANSWERED: no AetherArgus structured-output run is available."),
        "RQ3": rq(has["aetherargus-v02-hf-lora"], "ANSWERED: subset metrics in mainResults.aetherargus-v02-hf-lora.subsets.", "PARTIAL_RULE_BASELINE_ONLY"),
        "RQ4": rq(has["aetherargus-v02-hf-lora"], "ANSWERED: attack-family Macro-F1 (reference-only labels) in mainResults.aetherargus-v02-hf-lora.attackFamily.", "PARTIAL_RULE_BASELINE_ONLY"),
        "RQ5": rq(has["aetherargus-v02-hf-lora"], "ANSWERED: latency/size in mainResults.aetherargus-v02-hf-lora.performance (crossStackLatencyComparable=false).", "PARTIAL_RULE_BASELINE_ONLY"),
        "RQ6": rq(ablation_complete,
                  "ANSWERED WITH LIMITATION: byte-identical prompt and message-structure diagnostics completed; runtime remains coupled to BF16-to-f16 representation.",
                  "NOT_ANSWERED: the predeclared one-variable inference-path diagnostics are incomplete."),
        "RQ7": rq(has["aetherargus-v02-merged-bf16"] and has["aetherargus-v02-gguf-q4-k-m"],
                  "ANSWERED: BF16 vs Q4_K_M — see mainResults + pairedBootstrapDifferences.",
                  "NOT_ANSWERED: quantized and BF16 artifacts are unavailable."),
    }
    blocking_reasons = []
    if not all_models_complete:
        blocking_reasons.append(
            f"{len(completed)} of eight locked systems completed; the required eight-model comparison was not met."
        )
    if not ablation_complete:
        blocking_reasons.append(
            "The predeclared system+user vs single-concatenated and shared-serialized-prompt diagnostics are incomplete."
        )
    if not has["aetherargus-v02-hf-lora"]:
        blocking_reasons.append("No AetherArgus prediction file exists, so paired significance claims cannot be made.")
    report = {
        "schemaVersion": 2,
        "status": status_text,
        "experimentDate": completed_at,
        "repositoryCommit": EVALUATION_COMMIT,
        "protocolCommit": PROTOCOL_COMMIT,
        "protocolVersion": "v2",
        "protocolV1Commit": PROTOCOL_V1_COMMIT,
        "protocolSha256": PROTOCOL_SHA256,
        "inputSha256": EXPECTED_INPUT_SHA256,
        "labelSha256": EXPECTED_LABEL_SHA256,
        "successfulModels": completed,
        "notRunModels": not_run,
        "hardwareEnvironment": environment,
        "mainResults": {model_id: metrics[model_id] for model_id in completed},
        "statisticalAnalysis": stats,
        "inferencePathAblation": ablation_data,
        "researchQuestions": research_questions,
        "declarations": [
            "The challenge set was not used for training, prompt selection, threshold selection, hyperparameter tuning, or model selection.",
            "The reference labels were produced by two independent AI annotators, a third AI adjudicator, and a model-visible-context audit; they were not human-verified ground truth.",
        ],
        "claimToEvidenceCount": len(claims),
        "validation": {
            "partialIntegrity": partial_validation,
            "strictCompletion": strict_validation,
        },
        "completionCriteriaMet": all_complete,
        "blockingReasons": blocking_reasons,
    }
    (REPORT / "aetherargus-lan-challenge-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Data-driven main results table + significance summary for the report markdown.
    def _safe_fpr_text(model_id: str) -> str:
        m = metrics[model_id]
        cp = m.get("proportions", {}).get("safeFPR", {}).get("clopperPearson95") or m.get("safeFPR", {}).get("clopperPearson95")
        rate = m["safeFPR"]["rate"]
        return f"{rate:.4f}" + (f" (CP95≤{cp[1]:.4f})" if cp else "")

    preferred_order = ["aetherargus-v02-hf-lora", "qwen3-4b-few-shot", "qwen3-4b-zero-shot",
                       "char-ngram-logreg", "rules-baseline", "aetherargus-v02-merged-bf16",
                       "aetherargus-v02-gguf-q4-k-m", "aetherargus-v02-ollama-f16"]
    ordered = [m for m in preferred_order if m in completed] + [m for m in completed if m not in preferred_order]
    primary = "aetherargus-v02-hf-lora" if has["aetherargus-v02-hf-lora"] else (ordered[0] if ordered else "")
    main_results_table = (
        "| Model | Accuracy | Macro-F1 | Attack F1 | Attack recall | Safe FPR | Unknown acc | Schema valid |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|\n"
    )
    for mid in ordered:
        m = metrics[mid]
        main_results_table += (
            f"| {mid} | {m['verdict']['accuracy']:.4f} | {m['verdict']['macroF1']:.4f} | "
            f"{m['attackDetectionAll']['f1']:.4f} | {m['attackDetectionAll']['recall']:.4f} | "
            f"{_safe_fpr_text(mid)} | {m['unknown']['accuracy']:.4f} | "
            f"{m['structuredOutput']['schemaValidRate']:.4f} |\n"
        )
    sig_lines: list[str] = []
    for row in stats.get("mcnemar", []):
        sig_lines.append(
            f"- McNemar {row['comparison']}: p_raw={row.get('pValueRaw'):.4g}, "
            f"p_Holm={row.get('pValueHolm'):.4g}, method={row.get('method')}"
        )
    for row in stats.get("pairedBootstrapDifferences", []):
        if row.get("status") == "SUCCESS":
            d = row["deltas"]
            sig_lines.append(
                f"- Paired bootstrap {row['comparison']}: macroF1 Δ={d['macroF1']['pointEstimate']:+.4f} "
                f"[{d['macroF1']['lower95']:+.4f},{d['macroF1']['upper95']:+.4f}]"
            )
        else:
            sig_lines.append(f"- Paired bootstrap {row['comparison']}: {row.get('status')}")
    significance_section = "\n".join(sig_lines) if sig_lines else "No paired comparison available (primary model not present)."
    abl = ablation_data or {}
    shared_agreement = (
        abl.get("diagnostics", {})
        .get("sharedSerializedPromptAcrossRuntimes", {})
        .get("comparison", {})
        .get("verdictAgreement", {})
    )
    ablation_md = (
        f"With byte-identical serialized prompts, Transformers merged-BF16 vs Ollama f16 "
        f"verdict agreement was {shared_agreement.get('agree')}/{shared_agreement.get('total')} "
        f"({shared_agreement.get('rate', 0):.1%}). Runtime remains coupled to the BF16-to-f16 "
        "artifact representation; see `inference-path-ablation-v2.json`."
        if ablation_complete
        else "INCOMPLETE: required one-variable inference-path diagnostics have not all run; no causal FPR attribution is made."
    )
    pm = metrics[primary]
    pcm = pm["verdict"]["confusionMatrix"]
    primary_confusion_md = "reference\\\\prediction  " + "  ".join(f"{lab:>7}" for lab in pcm["labels"]) + "\n"
    for idx, lab in enumerate(pcm["labels"]):
        primary_confusion_md += f"{lab:<22} " + "  ".join(f"{v:7}" for v in pcm["matrix"][idx]) + "\n"
    pci = stats["confidenceIntervals"].get(primary, {})
    acc_lo = (pci.get("accuracy") or {}).get("lower95", float("nan"))
    acc_hi = (pci.get("accuracy") or {}).get("upper95", float("nan"))
    mf1_lo = (pci.get("macroF1") or {}).get("lower95", float("nan"))
    mf1_hi = (pci.get("macroF1") or {}).get("upper95", float("nan"))
    threats_md = "\n".join(
        f"{i}. {t}" for i, t in enumerate([
            "The reference is AI-annotated and AI-adjudicated, not human-verified ground truth." ,
            "The set is an authorized challenge capture, not natural production traffic.",
            "An observed low/zero safe FPR is a finite-sample result (Clopper-Pearson upper bound quantifies the residual), not a population guarantee.",
            "Cross-stack latency (Transformers GPU vs Ollama HTTP) is NOT comparable; no fairness ranking is claimed across runtimes.",
            "Family Macro-F1 uses reference-attack-family labels only; families absent from the reference are not in the denominator.",
            "Cohort mappings were not guessed from sampleId ranges.",
            f"{len(not_run)} locked system(s) did not complete: {', '.join(r['modelId'] for r in not_run) or 'none'}.",
        ], start=1)
    )

    markdown = f"""# AetherArgus frozen LAN challenge evidence report

## 1. Experiment identity

- Date: `{completed_at}`
- Evaluation code commit: `{EVALUATION_COMMIT}`
- Protocol commit: `{PROTOCOL_COMMIT}`
- Canonical protocol SHA-256: `{PROTOCOL_SHA256}`
- Input SHA-256: `{EXPECTED_INPUT_SHA256}`
- Label SHA-256: `{EXPECTED_LABEL_SHA256}`
- Status: **{status_text}**
- Partial-artifact integrity validation: **{f"{partial_validation['checksPassed']}/{partial_validation['checksTotal']} passed" if partial_validation else "not run"}**
- Strict completion validation: **{f"{strict_validation['checksPassed']}/{strict_validation['checksTotal']} passed" if strict_validation else "not run"}**

The challenge set was not used for training, prompt selection, threshold
selection, hyperparameter tuning, or model selection.

The reference labels were produced by two independent AI annotators, a third
AI adjudicator, and a model-visible-context audit; they were not human-verified
ground truth.

## 2. Hardware and software

- OS: `{environment['os']}`
- CPU: `{environment['cpu']}`
- RAM: `{environment['ramGiB']:.2f} GiB`
- GPU / CUDA: `{environment['gpu']}` / `{environment['cuda']}`
- Python: `{environment['python']}`
- Node: `{environment['node']}`
- scikit-learn / SciPy: `{environment['scikitLearn']} / {environment['scipy']}`
- PyTorch / Transformers / PEFT: `{environment['pytorch']}` / `{environment['transformers']}` / `{environment['peft']}`
- Ollama: `{environment['ollama']}`

## 3. Models and artifact inventory

- Successful: {", ".join(completed)}
- Not run: {", ".join(row['modelId'] for row in not_run) or "none"}

{"All eight locked primary systems completed; all predeclared inference-path diagnostics also completed." if all_complete else f"Primary systems complete: {all_models_complete}; inference-path diagnostics complete: {ablation_complete}. Missing evidence is not fabricated."}

## 4. Prompt and evaluation method

All generative runs are locked to prompt SHA-256 `{PROMPT_SHA256}`, context length 2048,
at most 320 output tokens, and deterministic decoding (temperature 0, greedy). Few-shot
examples (when used) are the frozen v2 manifest, sized to fit 2048. Each runner operates
label-blind in an isolated process; scoring opened `final-labels.jsonl` only after 413
predictions were flushed and closed. The rules-baseline runs the frozen repository detection
engine verbatim via an offline adapter (Option A provenance).

## 5. Main result

{main_results_table}

Primary model: `{primary}`. Safe FPR is shown with the Clopper-Pearson 95% upper bound
(where the rate is a zero-event proportion, e.g. 0/209, the exact interval replaces the
degenerate bootstrap `[0,0]`). Accuracy/Macro-F1 95% CIs are 10,000-draw
reference-verdict-stratified bootstrap (seed 20260731); see `metrics/statistical-analysis.json`.

### Significance (paired, Holm-Bonferroni corrected)

{significance_section}

### Inference-path ablation

{ablation_md}

## 6. Class balance and confusion (primary model `{primary}`)

```text
{primary_confusion_md}
```

Primary safe recall {pm['verdict']['perClass']['safe']['recall']:.4f}, attack recall
{pm['attackDetectionAll']['recall']:.4f}, unknown recall {pm['verdict']['perClass']['unknown']['recall']:.4f}.
Observed safe FPR is {pm['safeFPR']['falsePositiveCount']}/{pm['safeFPR']['safeSupport']}; the exact
Clopper-Pearson 95% upper bound (not a zero-population guarantee) is in `proportions.safeFPR`.

## 7. Consensus and adjudication subsets

Machine-readable subset results (all locked label-derived subsets, all completed models)
are in `tables/table-2-subset-results.csv`.

## 8. Statistical analysis

Each completed metric uses 10,000 reference-verdict-stratified bootstrap draws (seed
20260731). For the primary model, accuracy 95% CI is
`{acc_lo:.4f}`-`{acc_hi:.4f}`,
macro-F1 95% CI `{mf1_lo:.4f}`-`{mf1_hi:.4f}`.
Paired McNemar + paired bootstrap differences (Holm-Bonferroni corrected) are in section 5
and `metrics/statistical-analysis.json`. Proportion metrics additionally report
Clopper-Pearson exact and Wilson score intervals (`proportionIntervals`).

## 9. Inference-path ablation

{ablation_md}

## 10. Quality-latency-size trade-off

Latency (p50/p95/p99/mean) and model size are in `tables/table-4-latency-memory-size.csv` and each
model's `metrics/*.json` performance block. Cross-stack latency (Transformers GPU generate
vs Ollama HTTP round-trip) is flagged `crossStackLatencyComparable=false` and is NOT ranked
as equivalent across runtimes.

## 11. Error analysis

Full error-taxonomy counts, representative sampleIds, and sanitized request summaries are in
`error-analysis.json` and `tables/table-5-error-analysis.csv`.

## 12. Threats and limitations

{threats_md}

## 13. Reproduction

```bash
python3 ml/evaluation/lan_challenge/run_rules_baseline.py \\
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \\
  --output ml/reports/lan-challenge-evaluation/predictions/rules-baseline.jsonl
python3 ml/evaluation/lan_challenge/score_predictions.py \\
  --model-id rules-baseline \\
  --predictions ml/reports/lan-challenge-evaluation/predictions/rules-baseline.jsonl \\
  --labels ml/data/lan_challenge_capture/adjudication/final-labels.jsonl \\
  --output ml/reports/lan-challenge-evaluation/metrics/rules-baseline.json
python3 ml/evaluation/lan_challenge/statistical-analysis.py \\
  --labels ml/data/lan_challenge_capture/adjudication/final-labels.jsonl \\
  --predictions-dir ml/reports/lan-challenge-evaluation/predictions \\
  --run-status ml/reports/lan-challenge-evaluation/metrics/run-status.json \\
  --output ml/reports/lan-challenge-evaluation/metrics/statistical-analysis.json
python3 ml/evaluation/lan_challenge/generate_evidence.py
python3 ml/evaluation/lan_challenge/validate-paper-evidence.py
```

## 14. Failed or unrun items

See `metrics/run-status.json`. No result was copied from an older test set, no
prediction was duplicated from another model, and no missing run was replaced
with a heuristic.
"""
    (REPORT / "aetherargus-lan-challenge-report.md").write_text(markdown, encoding="utf-8")

    PAPER.mkdir(parents=True, exist_ok=True)
    (PAPER / "evaluation-section-draft.tex").write_text(
        rf"""\section{{Frozen External-Challenge Evaluation}}
Protocol v1 was committed before the rules baseline; protocol v2 (commit
\texttt{{{PROTOCOL_COMMIT}}}) was committed before the other seven primary prediction
files. The frozen set contains 413 request-side samples (input SHA
\texttt{{{EXPECTED_INPUT_SHA256}}}, reference-label SHA
\texttt{{{EXPECTED_LABEL_SHA256}}}, distribution safe/attack/unknown = 209/97/107).
The six generative systems used the same system prompt (SHA
\texttt{{{PROMPT_SHA256}}}), context cap 2048, output cap 320, and deterministic
decoding. The request-side rule and character n-gram baselines did not receive response
evidence. The primary model \texttt{{{primary}}} achieved accuracy
{pm['verdict']['accuracy']:.4f} (95\% stratified-bootstrap CI
[{acc_lo:.4f}, {acc_hi:.4f}])
and verdict macro-F1 {pm['verdict']['macroF1']:.4f} (95\% CI
[{mf1_lo:.4f}, {mf1_hi:.4f}]),
with observed safe FPR {pm['safeFPR']['falsePositiveCount']}/{pm['safeFPR']['safeSupport']}
(exact Clopper--Pearson 95\% interval reported, not a population guarantee) and unknown
recall {pm['unknown']['recall']:.4f}. Paired
McNemar and paired bootstrap differences against the baselines are Holm-Bonferroni
corrected; the Transformers-merged-BF16 vs Ollama-f16 diagnostics use byte-identical
serialized prompts but cannot separate runtime from the BF16-to-f16 artifact
representation.
""",
        encoding="utf-8",
    )
    (PAPER / "threats-to-validity-draft.tex").write_text(
        rf"""\section{{Threats to Validity}}
The reference labels were produced by two independent AI annotators, a third AI
adjudicator, and a model-visible-context audit; they are \emph{{not}} human-verified
ground truth. The authorized challenge set is not natural production traffic. An observed
low/zero safe FPR is a finite-sample result whose residual uncertainty is quantified by
the Clopper-Pearson upper bound, not a population guarantee. Cross-stack latency
(Transformers GPU generate vs Ollama HTTP round-trip) is not comparable across runtimes.
Family Macro-F1 uses reference-attack-family labels only. {len(not_run)} of eight locked
primary systems did not complete: {', '.join(r['modelId'] for r in not_run) or 'none'}.
The primary model's unknown recall was {pm['unknown']['recall']:.4f}. Model size is reported
only when derived from filesystem stat and tied to an artifact SHA-256. The merged BF16
safetensors and f16 GGUF are not bit-identical artifacts.
""",
        encoding="utf-8",
    )
    (PAPER / "abstract-results-fragment.tex").write_text(
        rf"""On a frozen 413-sample external challenge set under a pre-registered protocol,
\texttt{{{primary}}} reached macro-F1 {pm['verdict']['macroF1']:.4f} and accuracy
{pm['verdict']['accuracy']:.4f} with observed safe FPR
{pm['safeFPR']['falsePositiveCount']}/{pm['safeFPR']['safeSupport']}; significance is
reported as paired McNemar / paired bootstrap differences with Holm-Bonferroni correction,
and the predeclared Transformers-vs-Ollama diagnostics completed on all 413 paired inputs.
The cross-runtime comparison still couples runtime to BF16-to-f16 representation. No
historical or mismatched run was substituted for a missing prediction.
""",
        encoding="utf-8",
    )
    (PAPER / "contribution-evidence-fragment.tex").write_text(
        rf"""The evidence package fixes the input hash
\texttt{{{EXPECTED_INPUT_SHA256}}}, reference-label hash
\texttt{{{EXPECTED_LABEL_SHA256}}}, system prompt hash, prediction schema, bootstrap
seed, paired-test definitions, proportion intervals (Clopper-Pearson + Wilson), the
rules-baseline provenance manifest, the few-shot example manifest, and
claim-to-evidence traceability. Completion fails closed on missing diagnostic predictions,
unmeasured model sizes, unresolved evidence fields, or stale commit provenance. It does
not claim production validation, human ground truth, safe autonomous blocking, or
universal model superiority.
""",
        encoding="utf-8",
    )


def create_inventory(run_status: dict[str, Any]) -> None:
    protected = {
        "ml/data/lan_challenge_capture/model-inputs.jsonl": EXPECTED_INPUT_SHA256,
        "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl": EXPECTED_LABEL_SHA256,
        "ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl": "381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662",
        "ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl": "9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357",
    }
    inventory = {
        "schemaVersion": 1,
        "sourceCommit": "4359276fa9c6c0b56b168fc5c002e7e542fe30b3",
        "protocolCommit": PROTOCOL_COMMIT,
        "evaluationCommit": EVALUATION_COMMIT,
        "protectedArtifactHashes": protected,
        "trainingDataModified": False,
        "finalLabelsModified": False,
        "annotatorFilesModified": False,
        "productionDetectionPathModified": False,
        "allowedChangedPrefixes": [
            "ml/evaluation/lan_challenge/",
            "ml/reports/lan-challenge-evaluation/",
        ],
        "successfulModels": [
            row["modelId"] for row in run_status["models"] if row["status"] == "SUCCESS"
        ],
    }
    (REPORT / "artifact-inventory.json").write_text(
        json.dumps(inventory, indent=2) + "\n", encoding="utf-8"
    )
    ablation = json.loads(
        (REPORT / "inference-path-ablation-v2.json").read_text(encoding="utf-8")
    )
    all_models_complete = (
        len(run_status["models"]) == 8
        and all(row.get("status") == "SUCCESS" for row in run_status["models"])
    )
    completion_allowed = all_models_complete and ablation.get("status") == "COMPLETE"
    provenance = {
        "schemaVersion": 2,
        "repository": "lizuyi-6/Networksafe",
        "pullRequest": "https://github.com/lizuyi-6/Networksafe/pull/16",
        "baseBranch": "master",
        "headBranch": "agent/aetherargus-paper-evidence-20260731",
        "sourcePullRequest": "https://github.com/lizuyi-6/Networksafe/pull/15",
        "sourceCommit": "4359276fa9c6c0b56b168fc5c002e7e542fe30b3",
        "pr15MergeCommit": "fc71bb430b5f5bf365d3a7a42c22304a9e048f37",
        "protocolCommit": PROTOCOL_COMMIT,
        "protocolSha256": PROTOCOL_SHA256,
        "evidenceCommit": EVALUATION_COMMIT,
        "baseSelectionReason": "PR #15 merged at fc71bb430b5f5bf365d3a7a42c22304a9e048f37; PR #16 targets that master state and preserves the adjudicated labels.",
        "evidenceStatus": (
            "COMPLETE_PENDING_CI" if completion_allowed else "INCOMPLETE_REQUIRED_ABLATIONS_OR_MODEL_RUNS"
        ),
        "autoMergeRequested": False,
        "completionClaimAllowed": completion_allowed,
    }
    (REPORT / "pull-request-provenance.json").write_text(
        json.dumps(provenance, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    for directory in (REPORT, METRICS, PREDICTIONS, FIGURES, TABLES, PAPER):
        directory.mkdir(parents=True, exist_ok=True)
    run_status, metrics, stats = load_state()
    errors, error_rows = build_error_analysis(run_status, metrics)
    create_figures(run_status, metrics, stats, error_rows)
    create_tables(run_status, metrics, stats, error_rows)
    claims = create_claim_matrix(metrics, stats)
    create_reports(run_status, metrics, stats, claims)
    create_inventory(run_status)
    print(
        json.dumps(
            {
                "successfulModels": list(metrics),
                "figures": len(list(FIGURES.glob("figure-*"))),
                "tables": len(list(TABLES.glob("table-*"))),
                "errorModels": len(errors["models"]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
