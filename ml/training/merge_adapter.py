#!/usr/bin/env python3
"""Merge a validated LoRA adapter into its base model and smoke-test reload."""

from __future__ import annotations

import argparse
import gc
import json
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import psutil
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-model", required=True, help="Validated local base-model snapshot.")
    parser.add_argument(
        "--adapter-path",
        type=Path,
        default=repository_root() / "ml" / "output" / "aetherargus-lora",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repository_root() / "ml" / "output" / "aetherargus-merged",
    )
    parser.add_argument("--smoke-samples", type=int, default=20)
    parser.add_argument(
        "--test-file",
        type=Path,
        default=None,
        help="Test JSONL forwarded to evaluate_model.py; falls back to its default.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-input-length", type=int, default=1024)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    return parser.parse_args()


def ensure_output_is_new(output_directory: Path) -> None:
    if output_directory.exists() and any(output_directory.iterdir()):
        raise FileExistsError(
            f"refusing to overwrite non-empty merged model directory: {output_directory}"
        )
    output_directory.mkdir(parents=True, exist_ok=True)


def resident_memory_gib() -> float:
    return psutil.Process().memory_info().rss / 1024**3


def main() -> int:
    arguments = parse_arguments()
    adapter_path = arguments.adapter_path.resolve()
    output_directory = arguments.output_dir.resolve()
    if not (adapter_path / "adapter_model.safetensors").is_file():
        raise FileNotFoundError(f"adapter_model.safetensors not found in {adapter_path}")
    if not (adapter_path / "adapter_config.json").is_file():
        raise FileNotFoundError(f"adapter_config.json not found in {adapter_path}")
    ensure_output_is_new(output_directory)

    started_at = datetime.now(UTC)
    started_timer = time.perf_counter()
    memory_samples = [resident_memory_gib()]
    tokenizer = AutoTokenizer.from_pretrained(str(adapter_path), use_fast=True, trust_remote_code=False)
    base_model = AutoModelForCausalLM.from_pretrained(
        arguments.base_model,
        torch_dtype=torch.bfloat16,
        device_map={"": "cpu"},
        low_cpu_mem_usage=True,
        trust_remote_code=False,
    )
    memory_samples.append(resident_memory_gib())
    adapter_model = PeftModel.from_pretrained(base_model, str(adapter_path), is_trainable=False)
    merged_model = adapter_model.merge_and_unload(safe_merge=True)
    memory_samples.append(resident_memory_gib())
    merged_model.config.use_cache = True
    merged_model.save_pretrained(
        str(output_directory),
        safe_serialization=True,
        max_shard_size="4GB",
    )
    tokenizer.save_pretrained(str(output_directory))
    memory_samples.append(resident_memory_gib())

    required_files = {
        "config": (output_directory / "config.json").is_file(),
        "tokenizer": (output_directory / "tokenizer_config.json").is_file(),
        "weightIndexOrSingleShard": (
            (output_directory / "model.safetensors.index.json").is_file()
            or (output_directory / "model.safetensors").is_file()
        ),
    }
    if not all(required_files.values()):
        raise RuntimeError(f"merged model is incomplete: {required_files}")

    del merged_model
    del adapter_model
    del base_model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    evaluation_script = repository_root() / "ml" / "evaluation" / "evaluate_model.py"
    smoke_command = [
        sys.executable,
        str(evaluation_script),
        "--mode",
        "model",
        "--run-name",
        "merged-smoke",
        "--model-name",
        str(output_directory),
        "--max-samples",
        str(arguments.smoke_samples),
        "--seed",
        str(arguments.seed),
        "--max-input-length",
        str(arguments.max_input_length),
        "--max-new-tokens",
        str(arguments.max_new_tokens),
    ]
    if arguments.test_file is not None:
        smoke_command.extend(["--test-file", str(arguments.test_file)])
    completed_smoke_test = subprocess.run(smoke_command, check=False)
    if completed_smoke_test.returncode != 0:
        raise RuntimeError(f"merged-model reload smoke test failed with exit {completed_smoke_test.returncode}")
    smoke_metrics_path = repository_root() / "ml" / "reports" / "merged-smoke-metrics.json"
    smoke_metrics = json.loads(smoke_metrics_path.read_text(encoding="utf-8"))
    if smoke_metrics.get("sampleCount") != arguments.smoke_samples:
        raise RuntimeError("merged-model smoke test did not evaluate the requested fixed sample count")

    completed_at = datetime.now(UTC)
    summary = {
        "startedAt": started_at.isoformat(),
        "completedAt": completed_at.isoformat(),
        "elapsedSeconds": time.perf_counter() - started_timer,
        "baseModel": arguments.base_model,
        "adapterPath": str(adapter_path),
        "outputDirectory": str(output_directory),
        "mergeDevice": "cpu",
        "peakObservedProcessRssGiB": max(memory_samples),
        "requiredFiles": required_files,
        "smokeSamples": arguments.smoke_samples,
        "smokeMetrics": smoke_metrics,
    }
    (output_directory / "merge-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report_directory = repository_root() / "ml" / "reports"
    (report_directory / "merge-report.md").write_text(
        f"""# LoRA 合并报告

- 基座模型：`{arguments.base_model}`
- Adapter：`{adapter_path}`
- 合并模型：`{output_directory}`
- 合并设备：CPU
- 观测到的进程 RSS 峰值：{summary['peakObservedProcessRssGiB']:.2f} GiB
- 固定样本重载 smoke test：{arguments.smoke_samples} 条，完整执行成功
- smoke Schema 合法率：{smoke_metrics['schemaValidRate']:.4f}

脚本拒绝覆盖非空输出目录；合并权重使用 safetensors，并在释放 CPU 模型后以 4-bit GPU
方式重新加载固定测试样本。
""",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
