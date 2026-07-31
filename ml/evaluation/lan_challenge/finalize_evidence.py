#!/usr/bin/env python3
"""Strict post-inference orchestrator for the frozen LAN evidence package.

All primary and diagnostic prediction files must already contain 413 records. Model sizes
are reported only when measured from operator-supplied artifacts with filesystem stat and
SHA-256; unavailable sizes remain null and are never estimated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
EVAL = ROOT / "ml/evaluation/lan_challenge"
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
METRICS = REPORT / "metrics"
PREDICTIONS = REPORT / "predictions"
LABELS = ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"
PROTOCOL_V2_COMMIT = "553c0a9317e8c21f616991e92149fc828d7e8902"

REQUIRED_MODELS = [
    "rules-baseline",
    "char-ngram-logreg",
    "qwen3-4b-zero-shot",
    "qwen3-4b-few-shot",
    "aetherargus-v02-hf-lora",
    "aetherargus-v02-merged-bf16",
    "aetherargus-v02-gguf-q4-k-m",
    "aetherargus-v02-ollama-f16",
]

EXPECTED_ADAPTER_SHA256 = "3f786390b6dffb27ee6be9740acfb27b7961cd2c29da7bbbaab6f932d99aea2d"
EXPECTED_MERGE_MANIFEST_SHA256 = "c74bd457f21c83797dec3b22afbe1064e58a20237489f66c69bfd39280c1bd9b"
EXPECTED_Q4_SHA256 = "5d17d15ce0d19376ee0a18a700b6ac79b4e480f376c75f4cc465ec7c1b3aa8ed"
EXPECTED_F16_SHA256 = "7f134c21a1a685343573e313198b933f5ce5e78dc239635245aee24327a2ce48"
WEIGHT_SUFFIXES = {".safetensors", ".bin", ".pt", ".pth", ".gguf"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str]) -> None:
    print(f"\n$ {' '.join(command)}", flush=True)
    process = subprocess.run(command, cwd=ROOT, check=False)
    if process.returncode != 0:
        raise SystemExit(f"command failed (exit {process.returncode}): {' '.join(command)}")


def unavailable(reason: str, path: Path | None = None) -> tuple[None, dict[str, Any]]:
    measurement: dict[str, Any] = {"method": "not_available", "reason": reason}
    if path is not None:
        measurement["path"] = str(path)
    return None, measurement


def measure_file(path: Path | None, expected_sha256: str | None = None) -> tuple[int | None, dict[str, Any]]:
    if path is None:
        return unavailable("artifact path was not supplied")
    if not path.is_file():
        return unavailable("artifact file is unavailable on this operator", path)
    artifact_sha = sha256_file(path)
    if expected_sha256 is not None and artifact_sha != expected_sha256:
        raise SystemExit(f"frozen artifact SHA mismatch: {path}: {artifact_sha}")
    size = path.stat().st_size
    return size, {
        "method": "filesystem_stat",
        "scope": "single_file",
        "path": str(path),
        "artifactSha256": artifact_sha,
        "sizeBytes": size,
    }


def measure_weight_directory(path: Path | None) -> tuple[int | None, dict[str, Any]]:
    if path is None:
        return unavailable("artifact directory was not supplied")
    if not path.is_dir():
        return unavailable("artifact directory is unavailable on this operator", path)
    files = sorted(
        file
        for file in path.rglob("*")
        if file.is_file() and file.suffix.lower() in WEIGHT_SUFFIXES
        and "optimizer" not in file.name.lower()
    )
    if not files:
        return unavailable("no model weight files were found in the artifact directory", path)
    components = []
    total = 0
    for file in files:
        size = file.stat().st_size
        total += size
        components.append(
            {
                "relativePath": str(file.relative_to(path)).replace("\\", "/"),
                "sizeBytes": size,
                "sha256": sha256_file(file),
            }
        )
    canonical = json.dumps(components, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return total, {
        "method": "filesystem_stat",
        "scope": "weight_files_recursive",
        "path": str(path),
        "includedSuffixes": sorted(WEIGHT_SUFFIXES),
        "componentCount": len(components),
        "components": components,
        "artifactSha256": hashlib.sha256(canonical).hexdigest(),
        "sizeBytes": total,
    }


def combine_measurements(
    parts: list[tuple[int | None, dict[str, Any]]],
    *,
    description: str,
) -> tuple[int | None, dict[str, Any]]:
    if any(size is None for size, _ in parts):
        return unavailable(
            description + ": one or more component artifacts are unavailable"
        )
    components = [measurement for _, measurement in parts]
    total = sum(int(size) for size, _ in parts if size is not None)
    component_hashes = [component["artifactSha256"] for component in components]
    artifact_sha = hashlib.sha256("\n".join(component_hashes).encode("ascii")).hexdigest()
    return total, {
        "method": "filesystem_stat",
        "scope": "sum_of_measured_components",
        "description": description,
        "components": components,
        "artifactSha256": artifact_sha,
        "sizeBytes": total,
    }


def build_size_measurements(arguments: argparse.Namespace) -> dict[str, tuple[int | None, dict[str, Any]]]:
    base = measure_weight_directory(arguments.base_model_dir)
    adapter_file = arguments.adapter_dir / "adapter_model.safetensors"
    adapter = measure_file(adapter_file, EXPECTED_ADAPTER_SHA256)
    merged = measure_weight_directory(arguments.merged_model_dir)
    if merged[0] is not None:
        manifest = arguments.merged_model_dir / "merge-summary.json"
        if not manifest.is_file() or sha256_file(manifest) != EXPECTED_MERGE_MANIFEST_SHA256:
            raise SystemExit("merged-model manifest is missing or does not match protocol v2")
        merged[1]["provenanceManifestSha256"] = EXPECTED_MERGE_MANIFEST_SHA256
    q4 = measure_file(arguments.q4_gguf, EXPECTED_Q4_SHA256)
    f16 = measure_file(arguments.f16_gguf, EXPECTED_F16_SHA256)
    lora = combine_measurements([base, adapter], description="base weights plus LoRA adapter weights")
    measurements = {
        "rules-baseline": unavailable("rules baseline has no standalone model artifact"),
        "char-ngram-logreg": unavailable("classifier artifact was not persisted; size cannot be recovered reliably"),
        "qwen3-4b-zero-shot": base,
        "qwen3-4b-few-shot": base,
        "aetherargus-v02-hf-lora": lora,
        "aetherargus-v02-merged-bf16": merged,
        "aetherargus-v02-gguf-q4-k-m": q4,
        "aetherargus-v02-ollama-f16": f16,
    }
    if arguments.require_model_sizes:
        missing = [model_id for model_id, (size, _) in measurements.items() if size is None and model_id not in {"rules-baseline", "char-ngram-logreg"}]
        if missing:
            raise SystemExit("required model-size artifacts unavailable: " + ", ".join(missing))
    return measurements


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model-dir", type=Path)
    parser.add_argument("--adapter-dir", type=Path, default=ROOT / "ml/output/aetherargus-v02-lora")
    parser.add_argument("--merged-model-dir", type=Path, default=Path("D:/aetherargus-v02-merged"))
    parser.add_argument("--q4-gguf", type=Path, default=Path("D:/aetherargus-v02-gguf/aetherargus-v02-Q4_K_M.gguf"))
    parser.add_argument("--f16-gguf", type=Path, default=Path("D:/aetherargus-v02-gguf/aetherargus-v02-f16.gguf"))
    parser.add_argument("--require-model-sizes", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = parse_args()
    for model_id in REQUIRED_MODELS:
        prediction_path = PREDICTIONS / f"{model_id}.jsonl"
        if not prediction_path.is_file():
            raise SystemExit(f"missing prediction file: {prediction_path}")
        count = sum(1 for line in prediction_path.open(encoding="utf-8") if line.strip())
        if count != 413:
            raise SystemExit(f"{model_id}: expected 413 predictions, found {count}")
    print("all 8 primary prediction files present with 413 records each")

    # The scorer writes an INCOMPLETE report and exits non-zero if any predeclared
    # diagnostic prediction is missing. No final evidence package is generated then.
    run([sys.executable, str(EVAL / "run_ablation.py")])
    measurements = build_size_measurements(arguments)

    for model_id in REQUIRED_MODELS:
        size, measurement = measurements[model_id]
        performance_path = METRICS / f"{model_id}-performance.json"
        performance = {
            "modelSizeBytes": size,
            "modelSizeMeasurement": measurement,
            "peakGpuMemoryMiB": None,
            "peakHostMemoryMiB": None,
            "crossStackLatencyComparable": False,
        }
        performance_path.write_text(json.dumps(performance, indent=2) + "\n", encoding="utf-8")
        run(
            [
                sys.executable,
                str(EVAL / "score_predictions.py"),
                "--model-id",
                model_id,
                "--predictions",
                str(PREDICTIONS / f"{model_id}.jsonl"),
                "--labels",
                str(LABELS),
                "--output",
                str(METRICS / f"{model_id}.json"),
                "--performance-metadata",
                str(performance_path),
            ]
        )

    models = []
    for model_id in REQUIRED_MODELS:
        prediction_path = PREDICTIONS / f"{model_id}.jsonl"
        models.append(
            {
                "modelId": model_id,
                "status": "SUCCESS",
                "sampleCount": 413,
                "predictionFile": str(prediction_path.relative_to(ROOT)).replace("\\", "/"),
                "predictionSha256": sha256_file(prediction_path),
                "metricsFile": str((METRICS / f"{model_id}.json").relative_to(ROOT)).replace("\\", "/"),
            }
        )
    run_status = {
        "schemaVersion": 3,
        "protocolCommit": PROTOCOL_V2_COMMIT,
        "models": models,
    }
    (METRICS / "run-status.json").write_text(json.dumps(run_status, indent=2) + "\n", encoding="utf-8")

    run(
        [
            sys.executable,
            str(EVAL / "statistical-analysis.py"),
            "--labels",
            str(LABELS),
            "--predictions-dir",
            str(PREDICTIONS),
            "--run-status",
            str(METRICS / "run-status.json"),
            "--output",
            str(METRICS / "statistical-analysis.json"),
        ]
    )
    run([sys.executable, str(EVAL / "generate_evidence.py")])
    run([sys.executable, str(EVAL / "validate-paper-evidence.py")])
    print("\nFINALIZE_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
