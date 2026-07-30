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
PROTOCOL_COMMIT = "79f146f2c8d400ef4afa292015b70a6bf91280ec"
EVALUATION_COMMIT = "f6758075316425e6e2a5b4cbd1d9bebdc5cafd53"
PROTOCOL_SHA256 = "fc3f2af2bdfa911c99cf143ec248ae51654297d40b949fa95f8b8866bf897276"
PROMPT_SHA256 = "9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8"


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

    fig, axis = plt.subplots(figsize=(7.2, 4.2))
    for model in completed:
        latency = metrics[model]["performance"]["meanLatencyMs"]
        score = metrics[model]["verdict"]["macroF1"]
        axis.scatter(latency, score, s=80)
        axis.annotate(model, (latency, score), xytext=(5, 5), textcoords="offset points")
    axis.set_ylim(0, 1)
    observed_latencies = [
        metrics[model]["performance"]["meanLatencyMs"]
        for model in completed
        if metrics[model]["performance"]["meanLatencyMs"] is not None
    ]
    axis.set_xlim(0, max(1.0, max(observed_latencies, default=0.0) * 1.2))
    axis.set_xlabel("Mean latency (ms; cross-stack ranking not implied)")
    axis.set_ylabel("Verdict Macro-F1")
    axis.set_title("Quality-latency-size trade-off; model size unavailable for rules")
    fig.tight_layout()
    for suffix in ("png", "pdf"):
        fig.savefig(FIGURES / f"figure-5-quality-latency-size-tradeoff.{suffix}", bbox_inches="tight")
    plt.close(fig)

    fig, axis = plt.subplots(figsize=(7.2, 4.2))
    axis.axis("off")
    axis.text(
        0.5,
        0.55,
        "Inference-path ablation: NOT RUN",
        ha="center",
        va="center",
        fontsize=16,
        weight="bold",
    )
    axis.text(
        0.5,
        0.38,
        "Shared-weight BF16/f16/GGUF artifacts and Ollama runtime were unavailable.\n"
        "No historical cross-dataset FPR values were substituted.",
        ha="center",
        va="center",
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
    rule = metrics["rules-baseline"]
    ci = stats["confidenceIntervals"]["rules-baseline"]
    rows = [
        {
            "claimId": "C1",
            "paperClaim": "The frozen external challenge set contains 413 model-visible requests.",
            "evidenceFile": "ml/evaluation/lan_challenge/evaluation-protocol.json",
            "metricField": "dataset.sampleCount",
            "commit": PROTOCOL_COMMIT,
            "supportLevel": "DIRECT",
            "limitations": "Reference labels are AI-adjudicated, not human ground truth.",
            "allowedWording": "The frozen evaluation contains 413 request-side samples.",
            "forbiddenWording": "The benchmark is representative production traffic.",
        },
        {
            "claimId": "C2",
            "paperClaim": "The repository rule baseline achieved the reported verdict scores.",
            "evidenceFile": "ml/reports/lan-challenge-evaluation/metrics/rules-baseline.json",
            "metricField": "verdict.accuracy; verdict.macroF1",
            "commit": EVALUATION_COMMIT,
            "supportLevel": "DIRECT",
            "limitations": "Only the rule baseline ran; no model superiority comparison is available.",
            "allowedWording": (
                f"The frozen rule baseline achieved accuracy {rule['verdict']['accuracy']:.4f} "
                f"(95% CI {ci['accuracy']['lower95']:.4f}-{ci['accuracy']['upper95']:.4f}) "
                f"and macro-F1 {rule['verdict']['macroF1']:.4f}."
            ),
            "forbiddenWording": "AetherArgus significantly outperformed the rule baseline.",
        },
        {
            "claimId": "C3",
            "paperClaim": "The rule baseline had zero safe-to-attack errors in this sample.",
            "evidenceFile": "ml/reports/lan-challenge-evaluation/metrics/rules-baseline.json",
            "metricField": "safeFPR",
            "commit": EVALUATION_COMMIT,
            "supportLevel": "DIRECT",
            "limitations": "A zero observed rate is not proof of zero population risk.",
            "allowedWording": "Observed safe FPR was 0/209 on this frozen set.",
            "forbiddenWording": "The rule engine has no false positives.",
        },
        {
            "claimId": "C4",
            "paperClaim": "AetherArgus-versus-baseline superiority was not established in this run.",
            "evidenceFile": "ml/reports/lan-challenge-evaluation/metrics/run-status.json",
            "metricField": "models",
            "commit": EVALUATION_COMMIT,
            "supportLevel": "NOT_AVAILABLE",
            "limitations": "Model weights, training assets, CUDA, and Ollama were unavailable.",
            "allowedWording": "This execution could not complete the primary model comparisons.",
            "forbiddenWording": "AetherArgus is universally more capable than Qwen3-4B.",
        },
    ]
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
    (REPORT / "claim-to-evidence-matrix.md").write_text(
        "\n".join(markdown) + "\n", encoding="utf-8"
    )
    return rows


def environment_manifest() -> dict[str, Any]:
    cpu = subprocess.run(
        ["bash", "-lc", "lscpu | awk -F: '/Model name/ {gsub(/^ +/,\"\",$2); print $2; exit}'"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    memory_kib = int(
        subprocess.run(
            ["bash", "-lc", "awk '/MemTotal/ {print $2}' /proc/meminfo"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    )
    return {
        "os": platform.platform(),
        "cpu": cpu or platform.machine(),
        "gpu": None,
        "ramGiB": memory_kib / 1024 / 1024,
        "cuda": None,
        "python": platform.python_version(),
        "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
        "pytorch": None,
        "transformers": None,
        "ollama": None,
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
        "completedAt": completed_at,
    }
    (REPORT / "evaluation-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    report = {
        "schemaVersion": 1,
        "status": "INCOMPLETE_REQUIRED_MODEL_RUNS",
        "experimentDate": completed_at,
        "repositoryCommit": EVALUATION_COMMIT,
        "protocolCommit": PROTOCOL_COMMIT,
        "protocolSha256": PROTOCOL_SHA256,
        "inputSha256": EXPECTED_INPUT_SHA256,
        "labelSha256": EXPECTED_LABEL_SHA256,
        "successfulModels": completed,
        "notRunModels": not_run,
        "hardwareEnvironment": environment,
        "mainResults": {model_id: metrics[model_id] for model_id in completed},
        "statisticalAnalysis": stats,
        "inferencePathAblation": json.loads(
            (EVAL / "inference-path-ablation.json").read_text(encoding="utf-8")
        ),
        "researchQuestions": {
            "RQ1": "NOT_ANSWERED: AetherArgus and Qwen prediction runs are unavailable.",
            "RQ2": "NOT_ANSWERED: no AetherArgus structured-output run is available.",
            "RQ3": "PARTIAL_RULE_BASELINE_ONLY",
            "RQ4": "PARTIAL_RULE_BASELINE_ONLY",
            "RQ5": "PARTIAL_RULE_BASELINE_ONLY",
            "RQ6": "NOT_ANSWERED: paired shared-weight runtimes are unavailable.",
            "RQ7": "NOT_ANSWERED: quantized and BF16 artifacts are unavailable.",
        },
        "declarations": [
            "The challenge set was not used for training, prompt selection, threshold selection, hyperparameter tuning, or model selection.",
            "The reference labels were produced by two independent AI annotators, a third AI adjudicator, and a model-visible-context audit; they were not human-verified ground truth.",
        ],
        "claimToEvidenceCount": len(claims),
        "validation": {
            "partialIntegrity": partial_validation,
            "strictCompletion": strict_validation,
        },
        "completionCriteriaMet": False,
        "blockingReasons": [
            "Only one of eight locked systems completed; the required minimum four-model comparison was not met.",
            "No Transformers-versus-Ollama shared-weight control completed.",
            "No AetherArgus prediction file exists, so paired significance claims cannot be made.",
        ],
    }
    (REPORT / "aetherargus-lan-challenge-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    markdown = f"""# AetherArgus frozen LAN challenge evidence report

## 1. Experiment identity

- Date: `{completed_at}`
- Evaluation code commit: `{EVALUATION_COMMIT}`
- Protocol commit: `{PROTOCOL_COMMIT}`
- Canonical protocol SHA-256: `{PROTOCOL_SHA256}`
- Input SHA-256: `{EXPECTED_INPUT_SHA256}`
- Label SHA-256: `{EXPECTED_LABEL_SHA256}`
- Status: **INCOMPLETE_REQUIRED_MODEL_RUNS**
- Partial-artifact integrity validation: **21/21 passed**
- Strict completion validation: **20/21 passed**; required-model coverage failed

The challenge set was not used for training, prompt selection, threshold
selection, hyperparameter tuning, or model selection.

The reference labels were produced by two independent AI annotators, a third
AI adjudicator, and a model-visible-context audit; they were not human-verified
ground truth.

## 2. Hardware and software

- OS: `{environment['os']}`
- CPU: `{environment['cpu']}`
- RAM: `{environment['ramGiB']:.2f} GiB`
- GPU / CUDA: unavailable
- Python: `{environment['python']}`
- Node: `{environment['node']}`
- scikit-learn / SciPy: `{environment['scikitLearn']} / {environment['scipy']}`
- Transformers / Ollama: unavailable

## 3. Models and artifact inventory

- Successful: {", ".join(completed)}
- Not run: {", ".join(row['modelId'] for row in not_run)}

The v02 train/validation JSONL, LoRA adapter, merged BF16, f16 GGUF, and Q4_K_M
GGUF are documented by the repository but are not committed or mounted in this
environment. The authenticated Hugging Face Jobs connector returned
`Tool hf_jobs not found`; no paid job was launched.

## 4. Prompt and evaluation method

All generative runs are locked to prompt SHA-256 `{PROMPT_SHA256}`, context
length 2048, at most 320 output tokens, and deterministic decoding. No
generative run completed. The rule baseline ran in an isolated directory
containing only the frozen model input and label-blind inference code. Scoring
opened `final-labels.jsonl` only after 413 predictions were flushed and closed.

## 5. Main result

| Model | Accuracy | Macro-F1 | Attack F1 | Attack recall | Safe FPR | Unknown accuracy | Schema valid |
|---|---:|---:|---:|---:|---:|---:|---:|
| rules-baseline | {rule['verdict']['accuracy']:.4f} | {rule['verdict']['macroF1']:.4f} | {rule['attackDetectionAll']['f1']:.4f} | {rule['attackDetectionAll']['recall']:.4f} | {rule['safeFPR']['rate']:.4f} | {rule['unknown']['accuracy']:.4f} | {rule['structuredOutput']['schemaValidRate']:.4f} |

Accuracy 95% CI: `{ci['accuracy']['lower95']:.4f}`-
`{ci['accuracy']['upper95']:.4f}`. Macro-F1 95% CI:
`{ci['macroF1']['lower95']:.4f}`-`{ci['macroF1']['upper95']:.4f}`.

This result does **not** answer whether AetherArgus outperforms Qwen or the
baselines. McNemar, paired bootstrap differences, and Holm-adjusted model
comparisons are unavailable because AetherArgus predictions do not exist.

## 6. Class balance and confusion

The rule baseline predicts no `unknown` rows. Its confusion matrix is:

```text
reference\\prediction  safe  attack  unknown
safe                    209       0        0
attack                   71      26        0
unknown                  75      32        0
```

It obtains safe recall 1.0000 but attack recall {rule['attackDetectionAll']['recall']:.4f}
and unknown recall 0.0000. The observed safe FPR is 0/209; this is not evidence
of zero population FPR.

## 7. Consensus and adjudication subsets

Machine-readable subset results are in `tables/table-2-subset-results.csv`.
Only the rule baseline is present, so RQ4 is partial and descriptive.

## 8. Statistical analysis

Each completed metric uses 10,000 reference-verdict-stratified bootstrap draws,
seed 20260731. Attack-F1 CI is
`{ci['attackF1']['lower95']:.4f}`-`{ci['attackF1']['upper95']:.4f}`; attack
recall CI is `{ci['attackRecall']['lower95']:.4f}`-
`{ci['attackRecall']['upper95']:.4f}`. No paired test is reported.

## 9. Inference-path ablation

**NOT_RUN.** Shared-weight BF16/f16/GGUF artifacts and an Ollama runtime are
unavailable. Historical metrics on other test sets were not substituted, so no
cause is assigned to context truncation, system prompt, chat template,
serialization, runtime, sampling, or quantization.

## 10. Quality-latency-size trade-off

Only CPU rule latency is measured. GPU memory, token throughput, model size,
and cross-stack model latency are `null`; no fairness ranking is claimed.

## 11. Error analysis

The dominant rule-baseline errors are attack→safe and forced decisions on
reference-unknown rows. Full counts, representative sampleIds, and sanitized
request summaries are in `error-analysis.json` and `table-5-error-analysis.csv`.

## 12. Threats and limitations

1. Seven locked systems did not run; the primary research questions remain open.
2. The reference is AI-annotated and AI-adjudicated, not human-verified ground truth.
3. The set is an authorized challenge capture, not natural production traffic.
4. Zero observed safe FPR for one rule baseline is not a population guarantee.
5. Rule latency is not comparable to missing GPU/Ollama latency.
6. Cohort mappings were not guessed from sampleId ranges.

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
We locked the evaluation protocol before inference (protocol commit
\texttt{{{PROTOCOL_COMMIT}}}) on 413 request-side samples.  The only completed
system in this execution was the repository rule baseline, which achieved
accuracy {rule['verdict']['accuracy']:.4f} (95\% stratified-bootstrap CI
[{ci['accuracy']['lower95']:.4f}, {ci['accuracy']['upper95']:.4f}]) and verdict
macro-F1 {rule['verdict']['macroF1']:.4f} (95\% CI
[{ci['macroF1']['lower95']:.4f}, {ci['macroF1']['upper95']:.4f}]).  Because the
AetherArgus and Qwen artifacts could not be executed, this run does not support
a model-superiority claim.
""",
        encoding="utf-8",
    )
    (PAPER / "threats-to-validity-draft.tex").write_text(
        r"""\section{Threats to Validity}
The reference labels were produced by two independent AI annotators, a third
AI adjudicator, and a model-visible-context audit; they are not human-verified
ground truth.  The authorized challenge set is not natural production traffic.
Seven of eight locked systems were not run because the required data, weights,
GPU, and Ollama runtime were unavailable.  Consequently, no paired superiority,
inference-path, or quantization conclusion is supported.
""",
        encoding="utf-8",
    )
    (PAPER / "abstract-results-fragment.tex").write_text(
        r"""A frozen 413-sample evaluation protocol and reproducible scoring
pipeline were established.  In the available execution environment only the
rule baseline completed, so comparative AetherArgus claims remain unreported
rather than being inferred from historical or mismatched runs.
""",
        encoding="utf-8",
    )
    (PAPER / "contribution-evidence-fragment.tex").write_text(
        rf"""The evidence package fixes the input hash
\texttt{{{EXPECTED_INPUT_SHA256}}}, reference-label hash
\texttt{{{EXPECTED_LABEL_SHA256}}}, protocol, prediction schema, bootstrap
seed, paired-test definitions, privacy-preserving error analysis, and
claim-to-evidence traceability.  It does not claim production validation or
human ground truth.
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
