#!/usr/bin/env python3
"""Run ordered 4B QLoRA smoke attempts and record every memory adjustment."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-name", required=True, help="Validated local 4B model snapshot path.")
    parser.add_argument(
        "--config",
        type=Path,
        default=repository_root() / "ml" / "configs" / "qwen3-4b-qlora.yaml",
    )
    return parser.parse_args()


def run_attempt(
    python_executable: str,
    train_script: Path,
    config_path: Path,
    model_name: str,
    output_directory: Path,
    attempt: dict[str, Any],
    log_path: Path,
) -> dict[str, Any]:
    command = [
        python_executable,
        str(train_script),
        "--config",
        str(config_path),
        "--model-name",
        model_name,
        "--output-dir",
        str(output_directory),
        "--smoke-test",
        "--smoke-steps",
        "3",
        "--max-length",
        str(attempt["maxLength"]),
        "--lora-r",
        str(attempt["loraR"]),
        "--lora-alpha",
        str(attempt["loraAlpha"]),
        "--eval-steps",
        str(attempt["evalSteps"]),
    ]
    started_at = datetime.now(UTC)
    collected_output: list[str] = []
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(f"\n=== attempt {attempt['name']} ===\n")
        log_file.write("command=" + json.dumps(command, ensure_ascii=False) + "\n")
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert process.stdout is not None
        for output_line in process.stdout:
            print(output_line, end="", flush=True)
            log_file.write(output_line)
            log_file.flush()
            collected_output.append(output_line)
        return_code = process.wait()
    completed_at = datetime.now(UTC)
    combined_output = "".join(collected_output)
    out_of_memory = "out of memory" in combined_output.lower() or "cuda oom" in combined_output.lower()
    summary_path = output_directory / "training-summary.json"
    training_summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else None
    return {
        **attempt,
        "startedAt": started_at.isoformat(),
        "completedAt": completed_at.isoformat(),
        "elapsedSeconds": (completed_at - started_at).total_seconds(),
        "returnCode": return_code,
        "outOfMemory": out_of_memory,
        "outputDirectory": str(output_directory),
        "trainingSummary": training_summary,
    }


def main() -> int:
    arguments = parse_arguments()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    smoke_root = repository_root() / "ml" / "output" / "smoke-test" / timestamp
    smoke_root.mkdir(parents=True, exist_ok=False)
    logs_directory = repository_root() / "ml" / "logs"
    logs_directory.mkdir(parents=True, exist_ok=True)
    log_path = logs_directory / f"smoke-adaptation-{timestamp}.log"
    report_directory = repository_root() / "ml" / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)

    attempts = [
        {
            "name": "4b_initial",
            "maxLength": 768,
            "loraR": 8,
            "loraAlpha": 16,
            "evalSteps": 2,
            "changeFromPrevious": "initial requested configuration",
        },
        {
            "name": "4b_length_512",
            "maxLength": 512,
            "loraR": 8,
            "loraAlpha": 16,
            "evalSteps": 2,
            "changeFromPrevious": "max_length 768 -> 512",
        },
        {
            "name": "4b_lora_r_4",
            "maxLength": 512,
            "loraR": 4,
            "loraAlpha": 16,
            "evalSteps": 2,
            "changeFromPrevious": "lora_r 8 -> 4",
        },
        {
            "name": "4b_lora_alpha_8",
            "maxLength": 512,
            "loraR": 4,
            "loraAlpha": 8,
            "evalSteps": 2,
            "changeFromPrevious": "lora_alpha 16 -> 8",
        },
        {
            "name": "4b_eval_frequency_reduced",
            "maxLength": 512,
            "loraR": 4,
            "loraAlpha": 8,
            "evalSteps": 3,
            "changeFromPrevious": "eval frequency reduced; eval batch remains 1",
        },
    ]
    attempt_results: list[dict[str, Any]] = []
    successful_attempt: dict[str, Any] | None = None
    train_script = repository_root() / "ml" / "training" / "train_qlora.py"
    for attempt_index, attempt in enumerate(attempts, start=1):
        output_directory = smoke_root / f"attempt-{attempt_index}-{attempt['name']}"
        attempt_result = run_attempt(
            sys.executable,
            train_script,
            arguments.config.resolve(),
            arguments.model_name,
            output_directory,
            attempt,
            log_path,
        )
        attempt_results.append(attempt_result)
        if attempt_result["returnCode"] == 0:
            successful_attempt = attempt_result
            break
        if not attempt_result["outOfMemory"]:
            break

    report = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "model": "Qwen/Qwen3-4B-Instruct-2507",
        "localModelPath": arguments.model_name,
        "smokeRoot": str(smoke_root),
        "logPath": str(log_path),
        "attempts": attempt_results,
        "succeeded": successful_attempt is not None,
        "successfulAttempt": successful_attempt,
        "generationDuringEvaluation": False,
        "evalBatchSize": 1,
        "trainBatchSize": 1,
        "gradientCheckpointing": True,
        "fallbackRequired": successful_attempt is None,
    }
    json_report_path = report_directory / "qlora-smoke-report.json"
    json_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    attempt_lines = "\n".join(
        f"- `{result['name']}`: exit={result['returnCode']}, OOM={result['outOfMemory']}, "
        f"elapsed={result['elapsedSeconds']:.1f}s, change={result['changeFromPrevious']}"
        for result in attempt_results
    )
    successful_description = (
        f"4B smoke test 成功，配置为 max_length={successful_attempt['maxLength']}、"
        f"LoRA r={successful_attempt['loraR']}、alpha={successful_attempt['loraAlpha']}。"
        if successful_attempt
        else "4B 在有序调整后仍失败，才允许进入 1.7B 降级流程。"
    )
    markdown_report = f"""# QLoRA 显存适配 Smoke Test

生成时间：`{report['generatedAt']}`

{successful_description}

## 尝试记录

{attempt_lines}

训练和验证 batch size 均为 1，梯度检查点已启用。训练期验证只计算 loss，未执行生成式
评估，因此“关闭训练过程中的生成式评估”从首轮即满足，不作为伪造的 OOM 调整步骤。
完整日志：`{log_path}`。
"""
    (report_directory / "qlora-smoke-report.md").write_text(markdown_report, encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if successful_attempt else 1


if __name__ == "__main__":
    raise SystemExit(main())
