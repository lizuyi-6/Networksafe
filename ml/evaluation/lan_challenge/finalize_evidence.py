#!/usr/bin/env python3
"""Post-inference orchestrator: score all 8 prediction files, rebuild run-status.json
(protocol v2), run statistical analysis, then regenerate all evidence artifacts.

Run AFTER every prediction file has 413 records. Idempotent: re-scores and regenerates.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVAL = ROOT / "ml/evaluation/lan_challenge"
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
METRICS = REPORT / "metrics"
PREDICTIONS = REPORT / "predictions"
LABELS = ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"
PROTOCOL_V2_COMMIT = "553c0a9"

REQUIRED_MODELS = [
    "rules-baseline", "char-ngram-logreg", "qwen3-4b-zero-shot", "qwen3-4b-few-shot",
    "aetherargus-v02-hf-lora", "aetherargus-v02-merged-bf16",
    "aetherargus-v02-gguf-q4-k-m", "aetherargus-v02-ollama-f16",
]

# Approximate deployed footprint per system (bytes), for the performance block.
# Latency is NOT cross-stack comparable (Transformers GPU generate vs Ollama HTTP round-trip).
MODEL_SIZE_BYTES = {
    "rules-baseline": None,
    "char-ngram-logreg": None,
    "qwen3-4b-zero-shot": 8_044_986_000,
    "qwen3-4b-few-shot": 8_044_986_000,
    "aetherargus-v02-hf-lora": 8_044_986_000 + 132_187_888,
    "aetherargus-v02-merged-bf16": 8_044_986_000,
    "aetherargus-v02-gguf-q4-k-m": 2_497_278_752,
    "aetherargus-v02-ollama-f16": 8_051_283_232,
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str]) -> None:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    proc = subprocess.run(cmd, cwd=ROOT)
    if proc.returncode != 0:
        raise SystemExit(f"command failed (exit {proc.returncode}): {' '.join(cmd)}")


def main() -> int:
    # 0. sanity: every prediction file must have 413 records
    for model_id in REQUIRED_MODELS:
        p = PREDICTIONS / f"{model_id}.jsonl"
        if not p.is_file():
            raise SystemExit(f"missing prediction file: {p}")
        n = sum(1 for _ in p.open(encoding="utf-8"))
        if n != 413:
            raise SystemExit(f"{model_id}: expected 413 predictions, found {n}")
    print("all 8 prediction files present with 413 records each")

    # 1. score each model
    for model_id in REQUIRED_MODELS:
        perf_path = METRICS / f"{model_id}-performance.json"
        perf = {
            "modelSizeBytes": MODEL_SIZE_BYTES[model_id],
            "peakGpuMemoryMiB": None,
            "crossStackLatencyComparable": False,
        }
        perf_path.write_text(json.dumps(perf, indent=2) + "\n", encoding="utf-8")
        run([
            sys.executable, str(EVAL / "score_predictions.py"),
            "--model-id", model_id,
            "--predictions", str(PREDICTIONS / f"{model_id}.jsonl"),
            "--labels", str(LABELS),
            "--output", str(METRICS / f"{model_id}.json"),
            "--performance-metadata", str(perf_path),
        ])

    # 2. rebuild run-status.json (schemaVersion 2, protocol v2)
    models = []
    for model_id in REQUIRED_MODELS:
        p = PREDICTIONS / f"{model_id}.jsonl"
        models.append({
            "modelId": model_id,
            "status": "SUCCESS",
            "sampleCount": 413,
            "predictionFile": str(p.relative_to(ROOT)).replace("\\", "/"),
            "predictionSha256": sha256_file(p),
            "metricsFile": str((METRICS / f"{model_id}.json").relative_to(ROOT)).replace("\\", "/"),
        })
    run_status = {"schemaVersion": 2, "protocolCommit": PROTOCOL_V2_COMMIT, "models": models}
    (METRICS / "run-status.json").write_text(json.dumps(run_status, indent=2) + "\n", encoding="utf-8")
    print(f"wrote run-status.json with {len(models)} SUCCESS models")

    # 3. statistical analysis
    run([
        sys.executable, str(EVAL / "statistical-analysis.py"),
        "--labels", str(LABELS),
        "--predictions-dir", str(PREDICTIONS),
        "--run-status", str(METRICS / "run-status.json"),
        "--output", str(METRICS / "statistical-analysis.json"),
    ])

    # 4. regenerate evidence (figures, tables, reports, manifest, inventory)
    run([sys.executable, str(EVAL / "generate_evidence.py")])

    print("\nFINALIZE_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
