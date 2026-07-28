#!/usr/bin/env python3
"""Inspect the active ML environment and write reproducible reports."""

from __future__ import annotations

import importlib
import json
import platform
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PACKAGE_NAMES = (
    "torch",
    "bitsandbytes",
    "transformers",
    "peft",
    "trl",
    "datasets",
)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def run_command(command: list[str]) -> dict[str, Any]:
    executable = shutil.which(command[0])
    if executable is None:
        return {"available": False, "command": command, "stdout": "", "stderr": "not found", "returnCode": None}
    completed_process = subprocess.run(
        [executable, *command[1:]],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return {
        "available": True,
        "command": command,
        "stdout": completed_process.stdout.strip(),
        "stderr": completed_process.stderr.strip(),
        "returnCode": completed_process.returncode,
    }


def inspect_packages() -> dict[str, Any]:
    package_results: dict[str, Any] = {}
    for package_name in PACKAGE_NAMES:
        try:
            imported_package = importlib.import_module(package_name)
            package_results[package_name] = {
                "imported": True,
                "version": getattr(imported_package, "__version__", "unknown"),
            }
        except Exception as import_error:  # The report must capture binary loader failures too.
            package_results[package_name] = {
                "imported": False,
                "version": None,
                "error": f"{type(import_error).__name__}: {import_error}",
            }
    return package_results


def inspect_torch() -> dict[str, Any]:
    try:
        import torch
    except Exception as import_error:
        return {
            "imported": False,
            "error": f"{type(import_error).__name__}: {import_error}",
            "cudaAvailable": False,
        }

    torch_result: dict[str, Any] = {
        "imported": True,
        "version": torch.__version__,
        "cudaAvailable": torch.cuda.is_available(),
        "cudaRuntime": torch.version.cuda,
    }
    if not torch.cuda.is_available():
        return torch_result

    device_properties = torch.cuda.get_device_properties(0)
    torch_result.update(
        {
            "deviceName": torch.cuda.get_device_name(0),
            "deviceCapability": list(torch.cuda.get_device_capability(0)),
            "totalMemoryBytes": device_properties.total_memory,
            "totalMemoryGiB": device_properties.total_memory / 1024**3,
            "supportedArchitectures": torch.cuda.get_arch_list(),
        }
    )
    try:
        first_tensor = torch.arange(8, device="cuda", dtype=torch.float32)
        second_tensor = first_tensor.square().sum()
        torch.cuda.synchronize()
        torch_result["minimalCudaOperation"] = {
            "succeeded": True,
            "result": float(second_tensor.item()),
        }
    except Exception as cuda_error:
        torch_result["minimalCudaOperation"] = {
            "succeeded": False,
            "error": f"{type(cuda_error).__name__}: {cuda_error}",
        }
    return torch_result


def build_report() -> dict[str, Any]:
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "platform": platform.platform(),
            "isWsl": "microsoft" in platform.release().lower(),
        },
        "python": {
            "version": platform.python_version(),
            "executable": sys.executable,
            "implementation": platform.python_implementation(),
        },
        "commands": {
            "nvidiaSmi": run_command(
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.total,memory.free,driver_version",
                    "--format=csv,noheader,nounits",
                ]
            ),
            "nvcc": run_command(["nvcc", "--version"]),
            "pip": run_command([sys.executable, "-m", "pip", "--version"]),
        },
        "packages": inspect_packages(),
        "torch": inspect_torch(),
    }


def write_reports(report: dict[str, Any]) -> None:
    reports_directory = repository_root() / "ml" / "reports"
    reports_directory.mkdir(parents=True, exist_ok=True)
    json_report_path = reports_directory / "environment-report.json"
    markdown_report_path = reports_directory / "environment-report.md"
    json_report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    torch_report = report["torch"]
    package_lines = "\n".join(
        f"- `{package_name}`: "
        + (
            f"{package_result['version']}（导入成功）"
            if package_result["imported"]
            else f"导入失败：`{package_result.get('error')}`"
        )
        for package_name, package_result in report["packages"].items()
    )
    nvidia_smi_result = report["commands"]["nvidiaSmi"]
    nvcc_result = report["commands"]["nvcc"]
    markdown_report = f"""# AetherGuard ML 环境报告

生成时间：`{report['generatedAt']}`

## 运行环境

- 系统：`{report['platform']['platform']}`
- WSL：`{report['platform']['isWsl']}`
- Python：`{report['python']['version']}`
- Python executable：`{report['python']['executable']}`

## NVIDIA / CUDA

- `nvidia-smi` 可用：`{nvidia_smi_result['available']}`
- GPU 查询：`{nvidia_smi_result['stdout'] or nvidia_smi_result['stderr']}`
- `nvcc` 可用：`{nvcc_result['available']}`
- 说明：pip 安装的 PyTorch 与 bitsandbytes 使用自带 CUDA runtime，QLoRA 不要求本机安装 `nvcc`。
- PyTorch：`{torch_report.get('version')}`
- PyTorch CUDA runtime：`{torch_report.get('cudaRuntime')}`
- `torch.cuda.is_available()`：`{torch_report.get('cudaAvailable')}`
- GPU：`{torch_report.get('deviceName')}`
- Compute capability：`{torch_report.get('deviceCapability')}`
- 显存：`{torch_report.get('totalMemoryGiB')}` GiB
- 最小 CUDA 张量运算：`{torch_report.get('minimalCudaOperation')}`

## 关键依赖导入

{package_lines}

## 兼容性结论

RTX 5070 Ti Laptop GPU 属于 Blackwell `sm_120`。本环境要求 PyTorch 2.7 或更高且使用
CUDA 12.8 或更高构建；bitsandbytes 使用包含 `sm120` 的 Linux x86-64 CUDA
12.8+ 官方 wheel。最终是否可用以上面的实际 CUDA 张量运算与依赖导入结果为准。
"""
    markdown_report_path.write_text(markdown_report, encoding="utf-8")


def main() -> int:
    report = build_report()
    write_reports(report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    torch_report = report["torch"]
    cuda_operation = torch_report.get("minimalCudaOperation", {})
    package_imports_succeeded = all(
        package_result["imported"] for package_result in report["packages"].values()
    )
    return 0 if torch_report.get("cudaAvailable") and cuda_operation.get("succeeded") and package_imports_succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())
