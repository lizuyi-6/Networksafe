#!/usr/bin/env python3
"""Run strict JSON inference or score fixed AetherGuard test predictions."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

import torch
from peft import PeftModel
from sklearn.metrics import accuracy_score, f1_score, precision_recall_fscore_support
from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed


SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIRECTORY))

from detection_contract import parse_strict_json_object, serialize_json, validate_detection_output  # noqa: E402


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("model", "score", "combined"), default="model")
    parser.add_argument("--run-name", required=True, help="baseline, lora, rules, or combined")
    parser.add_argument("--model-name", default=None, help="Model ID or validated local snapshot path.")
    parser.add_argument("--adapter-path", type=Path, default=None)
    parser.add_argument(
        "--test-file",
        type=Path,
        default=repository_root() / "ml" / "data" / "processed" / "test.jsonl",
    )
    parser.add_argument("--prediction-input", type=Path, default=None, help="Existing JSONL for score mode.")
    parser.add_argument("--model-predictions", type=Path, default=None)
    parser.add_argument("--rule-predictions", type=Path, default=None)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    parser.add_argument("--max-input-length", type=int, default=1024)
    parser.add_argument("--max-samples", type=int, default=None)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as input_file:
        for line_number, raw_line in enumerate(input_file, start=1):
            if not raw_line.strip():
                continue
            try:
                records.append(json.loads(raw_line))
            except json.JSONDecodeError as decode_error:
                raise ValueError(f"invalid JSONL at {path}:{line_number}: {decode_error}") from decode_error
    return records


def load_fixed_test_records(test_path: Path, max_samples: int | None) -> list[dict[str, Any]]:
    records = load_jsonl(test_path)
    if max_samples is not None:
        records = records[:max_samples]
    if not records:
        raise ValueError(f"test dataset is empty: {test_path}")
    return records


def extract_expected_output(test_record: dict[str, Any]) -> dict[str, Any]:
    assistant_message = next(
        message for message in test_record["messages"] if message.get("role") == "assistant"
    )
    return parse_strict_json_object(assistant_message["content"])


def fallback_unknown_output(reasoning: str) -> dict[str, Any]:
    return {
        "verdict": "unknown",
        "confidence": 0.0,
        "attackFamily": "other",
        "severity": "medium",
        "reasoning": reasoning[:500],
        "evidence": [],
        "recommendedAction": "monitor",
    }


def build_quantization_config() -> BitsAndBytesConfig:
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )


def load_inference_model(model_name: str, adapter_path: Path | None) -> tuple[Any, Any]:
    tokenizer_reference = str(adapter_path.resolve()) if adapter_path else model_name
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_reference, use_fast=True, trust_remote_code=False)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"
    base_model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=build_quantization_config(),
        torch_dtype=torch.bfloat16,
        device_map={"": 0},
        trust_remote_code=False,
        low_cpu_mem_usage=True,
    )
    model = PeftModel.from_pretrained(base_model, str(adapter_path.resolve()), is_trainable=False) if adapter_path else base_model
    model.eval()
    model.config.use_cache = True
    return model, tokenizer


def run_model_inference(
    test_records: list[dict[str, Any]],
    model_name: str,
    adapter_path: Path | None,
    max_input_length: int,
    max_new_tokens: int,
    seed: int,
) -> tuple[list[dict[str, Any]], float]:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for model evaluation")
    set_seed(seed, deterministic=False)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    model, tokenizer = load_inference_model(model_name, adapter_path)
    prediction_records: list[dict[str, Any]] = []

    for test_record in tqdm(test_records, desc="inference", unit="sample"):
        prompt_messages = [
            message for message in test_record["messages"] if message.get("role") in {"system", "user"}
        ]
        model_inputs = tokenizer.apply_chat_template(
            prompt_messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
        )
        model_inputs = {
            input_name: input_tensor[:, -max_input_length:].to(model.device)
            for input_name, input_tensor in model_inputs.items()
        }
        torch.cuda.synchronize()
        inference_started_at = time.perf_counter()
        with torch.inference_mode():
            generated_token_ids = model.generate(
                **model_inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
                use_cache=True,
            )
        torch.cuda.synchronize()
        latency_milliseconds = (time.perf_counter() - inference_started_at) * 1000
        prompt_length = model_inputs["input_ids"].shape[1]
        raw_output = tokenizer.decode(
            generated_token_ids[0, prompt_length:],
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        ).strip()

        json_syntax_valid = False
        schema_valid = False
        validation_errors: list[str] = []
        try:
            parsed_output = parse_strict_json_object(raw_output)
            json_syntax_valid = True
            validation_errors = validate_detection_output(parsed_output)
            schema_valid = not validation_errors
        except (json.JSONDecodeError, TypeError, ValueError) as parse_error:
            parsed_output = None
            validation_errors = [f"{type(parse_error).__name__}: {parse_error}"]

        effective_prediction = (
            parsed_output
            if schema_valid and parsed_output is not None
            else fallback_unknown_output("模型输出无法通过严格 JSON Schema 验证，按 fail-safe 返回 unknown")
        )
        prediction_records.append(
            {
                "sampleId": test_record["sampleId"],
                "expected": extract_expected_output(test_record),
                "prediction": effective_prediction,
                "rawOutput": raw_output,
                "jsonSyntaxValid": json_syntax_valid,
                "schemaValid": schema_valid,
                "validationErrors": validation_errors,
                "latencyMs": latency_milliseconds,
                "metadata": test_record.get("metadata", {}),
                "inferenceMode": "lora" if adapter_path else "base_model",
                "modelInvoked": True,
            }
        )
    peak_gpu_memory_gib = torch.cuda.max_memory_allocated() / 1024**3
    return prediction_records, peak_gpu_memory_gib


def percentile(values: list[float], percentile_value: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = (len(sorted_values) - 1) * percentile_value
    lower_index = math.floor(index)
    upper_index = math.ceil(index)
    if lower_index == upper_index:
        return sorted_values[lower_index]
    interpolation = index - lower_index
    return sorted_values[lower_index] * (1 - interpolation) + sorted_values[upper_index] * interpolation


def calculate_category_breakdown(prediction_records: list[dict[str, Any]]) -> dict[str, Any]:
    records_by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for prediction_record in prediction_records:
        category = str(prediction_record.get("metadata", {}).get("labelCategory") or "unknown")
        records_by_category[category].append(prediction_record)
    breakdown: dict[str, Any] = {}
    for category, category_records in sorted(records_by_category.items()):
        correct_verdicts = sum(
            record["prediction"]["verdict"] == record["expected"]["verdict"]
            for record in category_records
        )
        breakdown[category] = {
            "count": len(category_records),
            "verdictAccuracy": correct_verdicts / len(category_records),
            "predictedVerdicts": dict(sorted(Counter(record["prediction"]["verdict"] for record in category_records).items())),
        }
    return breakdown


def calculate_family_breakdown(prediction_records: list[dict[str, Any]]) -> dict[str, Any]:
    records_by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for prediction_record in prediction_records:
        records_by_family[prediction_record["expected"]["attackFamily"]].append(prediction_record)
    breakdown: dict[str, Any] = {}
    for family, family_records in sorted(records_by_family.items()):
        correct = sum(
            record["prediction"]["attackFamily"] == record["expected"]["attackFamily"]
            for record in family_records
        )
        malicious_recall = sum(
            record["prediction"]["verdict"] == "malicious"
            for record in family_records
            if record["expected"]["verdict"] == "malicious"
        ) / max(1, sum(record["expected"]["verdict"] == "malicious" for record in family_records))
        breakdown[family] = {
            "count": len(family_records),
            "attackFamilyAccuracy": correct / len(family_records),
            "maliciousRecall": malicious_recall,
        }
    return breakdown


def calculate_metrics(
    prediction_records: list[dict[str, Any]], run_name: str, peak_gpu_memory_gib: float | None
) -> dict[str, Any]:
    expected_verdicts = [record["expected"]["verdict"] for record in prediction_records]
    predicted_verdicts = [record["prediction"]["verdict"] for record in prediction_records]
    expected_families = [record["expected"]["attackFamily"] for record in prediction_records]
    predicted_families = [record["prediction"]["attackFamily"] for record in prediction_records]
    expected_actions = [record["expected"]["recommendedAction"] for record in prediction_records]
    predicted_actions = [record["prediction"]["recommendedAction"] for record in prediction_records]
    expected_malicious = [verdict == "malicious" for verdict in expected_verdicts]
    predicted_malicious = [verdict == "malicious" for verdict in predicted_verdicts]
    malicious_precision, malicious_recall, malicious_f1, _support = precision_recall_fscore_support(
        expected_malicious,
        predicted_malicious,
        average="binary",
        zero_division=0,
    )
    safe_record_indexes = [
        index for index, expected_verdict in enumerate(expected_verdicts) if expected_verdict == "safe"
    ]
    false_positive_count = sum(
        predicted_verdicts[index] in {"suspicious", "malicious"} for index in safe_record_indexes
    )
    latencies = [float(record.get("latencyMs") or 0) for record in prediction_records]
    json_syntax_successes = sum(bool(record.get("jsonSyntaxValid")) for record in prediction_records)
    schema_successes = sum(bool(record.get("schemaValid")) for record in prediction_records)
    model_invocations = sum(bool(record.get("modelInvoked")) for record in prediction_records)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "runName": run_name,
        "sampleCount": len(prediction_records),
        "modelInvocationCount": model_invocations,
        "heuristicOnly": model_invocations == 0,
        "jsonSyntaxSuccessRate": json_syntax_successes / len(prediction_records),
        "schemaValidRate": schema_successes / len(prediction_records),
        "verdictAccuracy": accuracy_score(expected_verdicts, predicted_verdicts),
        "maliciousPrecision": malicious_precision,
        "maliciousRecall": malicious_recall,
        "maliciousF1": malicious_f1,
        "normalFalsePositiveRate": false_positive_count / max(1, len(safe_record_indexes)),
        "normalFalsePositiveCount": false_positive_count,
        "normalSampleCount": len(safe_record_indexes),
        "attackFamilyMacroF1": f1_score(
            expected_families,
            predicted_families,
            average="macro",
            zero_division=0,
        ),
        "recommendedActionAccuracy": accuracy_score(expected_actions, predicted_actions),
        "unknownUsageRate": sum(verdict == "unknown" for verdict in predicted_verdicts) / len(prediction_records),
        "averageLatencyMs": statistics.fmean(latencies),
        "p50LatencyMs": percentile(latencies, 0.50),
        "p95LatencyMs": percentile(latencies, 0.95),
        "peakGpuMemoryGiB": peak_gpu_memory_gib,
        "categoryBreakdown": calculate_category_breakdown(prediction_records),
        "familyBreakdown": calculate_family_breakdown(prediction_records),
    }


def combine_predictions(
    test_records: list[dict[str, Any]],
    model_predictions: list[dict[str, Any]],
    rule_predictions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    model_by_id = {record["sampleId"]: record for record in model_predictions}
    rules_by_id = {record["sampleId"]: record for record in rule_predictions}
    combined_records: list[dict[str, Any]] = []
    for test_record in test_records:
        sample_id = test_record["sampleId"]
        model_record = model_by_id.get(sample_id)
        rule_record = rules_by_id.get(sample_id)
        if model_record is None or rule_record is None:
            raise ValueError(f"missing model or rule prediction for sample {sample_id}")
        model_prediction = model_record["prediction"]
        rule_prediction = rule_record["prediction"]

        if rule_prediction["verdict"] == "malicious":
            effective_prediction = rule_prediction
            decision_source = "rule_block_guardrail"
        elif not model_record.get("schemaValid", False):
            effective_prediction = fallback_unknown_output("模型输出无效，组合策略按 fail-safe 返回 unknown")
            decision_source = "model_invalid_fail_safe"
        elif rule_prediction["verdict"] == "suspicious" and model_prediction["verdict"] == "safe":
            effective_prediction = rule_prediction
            decision_source = "rule_monitor_guardrail"
        else:
            effective_prediction = model_prediction
            decision_source = "model_with_rule_guardrail"

        combined_records.append(
            {
                "sampleId": sample_id,
                "expected": extract_expected_output(test_record),
                "prediction": effective_prediction,
                "rawOutput": model_record.get("rawOutput"),
                "jsonSyntaxValid": bool(model_record.get("jsonSyntaxValid")),
                "schemaValid": bool(model_record.get("schemaValid")),
                "validationErrors": model_record.get("validationErrors", []),
                "latencyMs": float(model_record.get("latencyMs") or 0) + float(rule_record.get("latencyMs") or 0),
                "metadata": test_record.get("metadata", {}),
                "inferenceMode": "rule_plus_lora",
                "decisionSource": decision_source,
                "modelInvoked": True,
            }
        )
    return combined_records


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output_file:
        for record in records:
            output_file.write(serialize_json(record))
            output_file.write("\n")


def write_results(run_name: str, prediction_records: list[dict[str, Any]], metrics: dict[str, Any]) -> None:
    reports_directory = repository_root() / "ml" / "reports"
    output_directory = repository_root() / "ml" / "output"
    reports_directory.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir(parents=True, exist_ok=True)
    metrics_path = reports_directory / f"{run_name}-metrics.json"
    report_path = reports_directory / f"{run_name}-report.md"
    predictions_path = output_directory / f"{run_name}-predictions.jsonl"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_jsonl(predictions_path, prediction_records)

    family_lines = "\n".join(
        f"- `{family}`: count={values['count']}, family accuracy={values['attackFamilyAccuracy']:.4f}, "
        f"malicious recall={values['maliciousRecall']:.4f}"
        for family, values in metrics["familyBreakdown"].items()
    )
    report_markdown = f"""# {run_name} 评估报告

生成时间：`{metrics['generatedAt']}`

## 核心指标

- 样本数：{metrics['sampleCount']}
- 真正模型调用数：{metrics['modelInvocationCount']}
- heuristic only：{metrics['heuristicOnly']}
- JSON 语法成功率：{metrics['jsonSyntaxSuccessRate']:.4f}
- Schema 合法率：{metrics['schemaValidRate']:.4f}
- verdict accuracy：{metrics['verdictAccuracy']:.4f}
- 恶意 precision / recall / F1：{metrics['maliciousPrecision']:.4f} / {metrics['maliciousRecall']:.4f} / {metrics['maliciousF1']:.4f}
- 正常请求误报率：{metrics['normalFalsePositiveRate']:.4f} ({metrics['normalFalsePositiveCount']}/{metrics['normalSampleCount']})
- attackFamily macro-F1：{metrics['attackFamilyMacroF1']:.4f}
- recommendedAction accuracy：{metrics['recommendedActionAccuracy']:.4f}
- unknown 使用率：{metrics['unknownUsageRate']:.4f}
- 平均 / p50 / p95 延迟：{metrics['averageLatencyMs']:.2f} / {metrics['p50LatencyMs']:.2f} / {metrics['p95LatencyMs']:.2f} ms
- 显存峰值：{metrics['peakGpuMemoryGiB']} GiB

## 家族明细

{family_lines}

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `{predictions_path}`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
"""
    report_path.write_text(report_markdown, encoding="utf-8")


def main() -> int:
    arguments = parse_arguments()
    test_records = load_fixed_test_records(arguments.test_file.resolve(), arguments.max_samples)
    peak_gpu_memory_gib: float | None = None
    if arguments.mode == "model":
        if not arguments.model_name:
            raise ValueError("--model-name is required in model mode")
        prediction_records, peak_gpu_memory_gib = run_model_inference(
            test_records,
            arguments.model_name,
            arguments.adapter_path,
            arguments.max_input_length,
            arguments.max_new_tokens,
            arguments.seed,
        )
    elif arguments.mode == "score":
        if arguments.prediction_input is None:
            raise ValueError("--prediction-input is required in score mode")
        prediction_records = load_jsonl(arguments.prediction_input.resolve())
        selected_sample_ids = {record["sampleId"] for record in test_records}
        prediction_records = [
            prediction_record
            for prediction_record in prediction_records
            if prediction_record.get("sampleId") in selected_sample_ids
        ]
    else:
        if arguments.model_predictions is None or arguments.rule_predictions is None:
            raise ValueError("--model-predictions and --rule-predictions are required in combined mode")
        prediction_records = combine_predictions(
            test_records,
            load_jsonl(arguments.model_predictions.resolve()),
            load_jsonl(arguments.rule_predictions.resolve()),
        )
        model_metrics_path = repository_root() / "ml" / "reports" / "lora-metrics.json"
        if model_metrics_path.is_file():
            peak_gpu_memory_gib = json.loads(model_metrics_path.read_text(encoding="utf-8")).get("peakGpuMemoryGiB")

    if len(prediction_records) != len(test_records):
        raise ValueError(
            f"prediction count {len(prediction_records)} does not match test count {len(test_records)}"
        )
    metrics = calculate_metrics(prediction_records, arguments.run_name, peak_gpu_memory_gib)
    write_results(arguments.run_name, prediction_records, metrics)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
