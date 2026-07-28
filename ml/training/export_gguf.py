#!/usr/bin/env python3
"""Convert a merged Hugging Face model to llama.cpp GGUF and Q4_K_M."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llama-cpp", type=Path, required=True)
    parser.add_argument(
        "--merged-model",
        type=Path,
        default=repository_root() / "ml" / "output" / "aetherargus-merged",
    )
    parser.add_argument(
        "--f16-output",
        type=Path,
        default=repository_root() / "ml" / "output" / "aetherargus-f16.gguf",
    )
    parser.add_argument(
        "--q4-output",
        type=Path,
        default=repository_root() / "ml" / "output" / "aetherargus-q4_k_m.gguf",
    )
    return parser.parse_args()


def run_checked(command: list[str]) -> None:
    print("command=" + json.dumps(command, ensure_ascii=False), flush=True)
    completed_process = subprocess.run(command, check=False)
    if completed_process.returncode != 0:
        raise RuntimeError(f"command failed with exit {completed_process.returncode}: {command}")


def require_nonempty_file(path: Path) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"expected non-empty file was not produced: {path}")


def main() -> int:
    arguments = parse_arguments()
    llama_cpp_directory = arguments.llama_cpp.resolve()
    merged_model_directory = arguments.merged_model.resolve()
    conversion_script = llama_cpp_directory / "convert_hf_to_gguf.py"
    quantizer_candidates = (
        llama_cpp_directory / "build" / "bin" / "llama-quantize",
        llama_cpp_directory / "build" / "bin" / "quantize",
    )
    quantizer_path = next((candidate for candidate in quantizer_candidates if candidate.is_file()), None)
    if not conversion_script.is_file():
        raise FileNotFoundError(f"llama.cpp conversion script not found: {conversion_script}")
    if quantizer_path is None:
        raise FileNotFoundError("llama.cpp quantizer was not built")
    if not (merged_model_directory / "config.json").is_file():
        raise FileNotFoundError(f"merged model is incomplete: {merged_model_directory}")

    f16_output = arguments.f16_output.resolve()
    q4_output = arguments.q4_output.resolve()
    f16_output.parent.mkdir(parents=True, exist_ok=True)
    if not f16_output.exists():
        run_checked(
            [
                sys.executable,
                str(conversion_script),
                str(merged_model_directory),
                "--outfile",
                str(f16_output),
                "--outtype",
                "f16",
            ]
        )
    require_nonempty_file(f16_output)
    if not q4_output.exists():
        run_checked([str(quantizer_path), str(f16_output), str(q4_output), "Q4_K_M"])
    require_nonempty_file(q4_output)

    summary = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "llamaCppDirectory": str(llama_cpp_directory),
        "mergedModel": str(merged_model_directory),
        "f16Output": str(f16_output),
        "f16Bytes": f16_output.stat().st_size,
        "q4Output": str(q4_output),
        "q4Bytes": q4_output.stat().st_size,
        "quantization": "Q4_K_M",
    }
    reports_directory = repository_root() / "ml" / "reports"
    reports_directory.mkdir(parents=True, exist_ok=True)
    (reports_directory / "gguf-export-report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (reports_directory / "gguf-export-report.md").write_text(
        f"""# GGUF 导出报告

- 合并模型：`{merged_model_directory}`
- llama.cpp：`{llama_cpp_directory}`
- F16 GGUF：`{f16_output}` ({summary['f16Bytes']} bytes)
- Q4_K_M GGUF：`{q4_output}` ({summary['q4Bytes']} bytes)
- Ollama Modelfile：`ml/deployment/Modelfile`

脚本不会覆盖已存在的 GGUF；存在时验证文件非空后复用。
""",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
