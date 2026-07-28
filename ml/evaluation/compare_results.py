#!/usr/bin/env python3
"""Compare base, LoRA, existing-rule, and rule-plus-LoRA evaluations."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


RUN_NAMES = ("baseline", "lora", "rules", "combined")
FOCUS_FAMILIES = (
    "ssrf",
    "authentication",
    "api_abuse",
    "path_traversal",
    "sqli",
    "xss",
    "command_injection",
)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl_by_id(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as input_file:
        for raw_line in input_file:
            if raw_line.strip():
                record = json.loads(raw_line)
                records[record["sampleId"]] = record
    return records


def format_metric_table(metrics_by_run: dict[str, dict[str, Any]]) -> str:
    metric_rows = (
        ("JSON syntax", "jsonSyntaxSuccessRate"),
        ("Schema valid", "schemaValidRate"),
        ("verdict accuracy", "verdictAccuracy"),
        ("malicious precision", "maliciousPrecision"),
        ("malicious recall", "maliciousRecall"),
        ("malicious F1", "maliciousF1"),
        ("normal FPR", "normalFalsePositiveRate"),
        ("attackFamily macro-F1", "attackFamilyMacroF1"),
        ("action accuracy", "recommendedActionAccuracy"),
        ("unknown usage", "unknownUsageRate"),
        ("p95 latency ms", "p95LatencyMs"),
        ("peak GPU GiB", "peakGpuMemoryGiB"),
    )
    table_lines = [
        "| Metric | Base | LoRA | Rules (heuristic) | Rules + LoRA |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for metric_label, metric_key in metric_rows:
        formatted_values = []
        for run_name in RUN_NAMES:
            metric_value = metrics_by_run[run_name].get(metric_key)
            formatted_values.append("N/A" if metric_value is None else f"{float(metric_value):.4f}")
        table_lines.append(f"| {metric_label} | " + " | ".join(formatted_values) + " |")
    return "\n".join(table_lines)


def main() -> int:
    reports_directory = repository_root() / "ml" / "reports"
    output_directory = repository_root() / "ml" / "output"
    metrics_by_run = {
        run_name: load_json(reports_directory / f"{run_name}-metrics.json")
        for run_name in RUN_NAMES
    }
    predictions_by_run = {
        run_name: load_jsonl_by_id(output_directory / f"{run_name}-predictions.jsonl")
        for run_name in RUN_NAMES
    }
    sample_id_sets = [set(predictions) for predictions in predictions_by_run.values()]
    if any(sample_ids != sample_id_sets[0] for sample_ids in sample_id_sets[1:]):
        raise ValueError("all comparison runs must use exactly the same fixed sample IDs")

    newly_detected_attacks = []
    new_false_positives = []
    corrected_false_positives = []
    for sample_id in sorted(sample_id_sets[0]):
        baseline_record = predictions_by_run["baseline"][sample_id]
        lora_record = predictions_by_run["lora"][sample_id]
        expected_verdict = lora_record["expected"]["verdict"]
        baseline_verdict = baseline_record["prediction"]["verdict"]
        lora_verdict = lora_record["prediction"]["verdict"]
        if expected_verdict == "malicious" and baseline_verdict != "malicious" and lora_verdict == "malicious":
            newly_detected_attacks.append(sample_id)
        if expected_verdict == "safe" and baseline_verdict == "safe" and lora_verdict in {"suspicious", "malicious"}:
            new_false_positives.append(sample_id)
        if expected_verdict == "safe" and baseline_verdict in {"suspicious", "malicious"} and lora_verdict == "safe":
            corrected_false_positives.append(sample_id)

    focus_lines = []
    for family in FOCUS_FAMILIES:
        family_values = []
        for run_name in RUN_NAMES:
            family_breakdown = metrics_by_run[run_name].get("familyBreakdown", {}).get(family)
            family_values.append(
                "N/A"
                if family_breakdown is None
                else f"recall={family_breakdown['maliciousRecall']:.3f}, familyAcc={family_breakdown['attackFamilyAccuracy']:.3f}"
            )
        focus_lines.append(
            f"- `{family}`: Base [{family_values[0]}]；LoRA [{family_values[1]}]；"
            f"Rules [{family_values[2]}]；Combined [{family_values[3]}]"
        )

    hard_negative_lines = []
    for run_name in RUN_NAMES:
        hard_negative_breakdown = metrics_by_run[run_name].get("categoryBreakdown", {}).get("hard_negative", {})
        hard_negative_lines.append(
            f"- `{run_name}`: count={hard_negative_breakdown.get('count', 0)}, "
            f"verdict accuracy={hard_negative_breakdown.get('verdictAccuracy', 0):.4f}, "
            f"predictions={hard_negative_breakdown.get('predictedVerdicts', {})}"
        )

    report = f"""# Baseline vs LoRA vs Rules

所有结果来自完全相同的固定 `ml/data/processed/test.jsonl`。`rules` 是现有
`detection-engine.ts` 规则与 heuristic 的实际执行结果，`modelInvocationCount=0`，不能解释为 AI 推理。

## 指标

{format_metric_table(metrics_by_run)}

## LoRA 相对基座的变化

- 新增正确检出的恶意样本：{len(newly_detected_attacks)}
- 新增误报：{len(new_false_positives)}
- 修复的基座误报：{len(corrected_false_positives)}
- 新增检出 sample IDs（最多 30）：`{newly_detected_attacks[:30]}`
- 新增误报 sample IDs（最多 30）：`{new_false_positives[:30]}`

## 重点攻击面

{chr(10).join(focus_lines)}

编码绕过主要分布在 `path_traversal`、`sqli`、`file_upload` 和 `other`，应结合
`familyBreakdown`、样本 metadata 的 `encoding` 以及 prediction JSONL 逐条复核。

## 正常与硬负样本

{chr(10).join(hard_negative_lines)}

## JSON 稳定性

- Base JSON / Schema：{metrics_by_run['baseline']['jsonSyntaxSuccessRate']:.4f} / {metrics_by_run['baseline']['schemaValidRate']:.4f}
- LoRA JSON / Schema：{metrics_by_run['lora']['jsonSyntaxSuccessRate']:.4f} / {metrics_by_run['lora']['schemaValidRate']:.4f}
- 组合策略保留规则 block guardrail；模型无效输出一律变为 unknown，不会变为 safe。

## 安全边界

LoRA 只提供安全判定建议，不直接执行高风险动作。现有规则引擎、Final Defense
硬件授权、policyDigest、monotonic counter 与 interlock fail-closed 链保持不变。
"""
    (reports_directory / "baseline-vs-lora.md").write_text(report, encoding="utf-8")
    comparison_data = {
        "sampleCount": len(sample_id_sets[0]),
        "newlyDetectedAttacks": newly_detected_attacks,
        "newFalsePositives": new_false_positives,
        "correctedFalsePositives": corrected_false_positives,
    }
    (reports_directory / "baseline-vs-lora.json").write_text(
        json.dumps(comparison_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(comparison_data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
