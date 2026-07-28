#!/usr/bin/env python3
"""Orchestrate the remaining AetherGuard ML pipeline after the baseline starts.

Steps (each logged, stops on critical failure):
  1. wait for baseline-metrics.json
  2. rules score (CPU)
  3. QLoRA smoke adaptation (GPU) -> parse winning config
  4. full QLoRA training with winning config (GPU, long)
  5. LoRA evaluation on the fixed test set (GPU)
  6. combined (rules + LoRA) evaluation (CPU score)
  7. merge adapter into base model (GPU/CPU)
  8. write orchestrator summary

Run inside the ml venv. All artifacts land under ml/. Logs under ml/logs/orchestrator.log.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ML = Path("/mnt/x/repos/Networksafe/ml")
MODEL = ML / "output" / "base-model"
REPORTS = ML / "reports"
OUTPUT = ML / "output"
LOG = ML / "logs" / "orchestrator.log"
PYTHON = str(ML / ".venv" / "bin" / "python")


def log(message: str) -> None:
    line = f"[{datetime.now(UTC).isoformat(timespec='seconds')}] {message}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def run(step_name: str, command: list[str], timeout: int | None = None) -> tuple[int, str]:
    log(f"STEP START: {step_name}")
    log("command: " + " ".join(command))
    try:
        result = subprocess.run(
            command,
            cwd=str(ML),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        log(f"STEP TIMEOUT: {step_name} after {timeout}s")
        return 124, str(exc)
    combined = (result.stdout or "") + (result.stderr or "")
    # stream a tail to the log for visibility
    tail = "\n".join(combined.splitlines()[-60:])
    if tail:
        log(f"--- {step_name} output tail ---\n{tail}")
    status = "OK" if result.returncode == 0 else f"FAIL(rc={result.returncode})"
    log(f"STEP END: {step_name} -> {status}")
    return result.returncode, combined


def wait_for_file(path: Path, description: str, max_seconds: int = 3600) -> bool:
    log(f"WAIT: {description} ({path})")
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        if path.is_file() and path.stat().st_size > 0:
            log(f"WAIT DONE: {description}")
            return True
        time.sleep(30)
    log(f"WAIT TIMEOUT: {description}")
    return False


def parse_smoke_winning_config() -> dict | None:
    report_path = REPORTS / "qlora-smoke-report.json"
    if not report_path.is_file():
        return None
    report = json.loads(report_path.read_text(encoding="utf-8"))
    attempt = report.get("successfulAttempt")
    if not attempt:
        return None
    return {
        "maxLength": attempt["maxLength"],
        "loraR": attempt["loraR"],
        "loraAlpha": attempt["loraAlpha"],
    }


def main() -> int:
    summary: dict = {"startedAt": datetime.now(UTC).isoformat(), "steps": []}
    LOG.write_text("", encoding="utf-8")  # reset
    log("ORCHESTRATOR START")

    # 1. wait for baseline
    if not wait_for_file(REPORTS / "baseline-metrics.json", "baseline metrics", 3600):
        summary["steps"].append({"step": "baseline_wait", "status": "TIMEOUT"})
        _finish(summary, failed=True)
        return 1
    summary["steps"].append({"step": "baseline_wait", "status": "OK"})

    # 2. rules score (GPU is now free after baseline)
    rc, _ = run(
        "rules_score",
        [PYTHON, "evaluation/evaluate_model.py", "--mode", "score",
         "--run-name", "rules",
         "--prediction-input", str(OUTPUT / "rules-predictions.jsonl")],
        timeout=600,
    )
    summary["steps"].append({"step": "rules_score", "status": "OK" if rc == 0 else "FAIL", "rc": rc})
    if rc != 0:
        _finish(summary, failed=True)
        return 1

    # 3. smoke adaptation
    rc, _ = run(
        "smoke_adaptation",
        [PYTHON, "training/run_smoke_adaptation.py", "--model-name", str(MODEL)],
        timeout=3600,
    )
    summary["steps"].append({"step": "smoke_adaptation", "status": "OK" if rc == 0 else "FAIL", "rc": rc})
    if rc != 0:
        _finish(summary, failed=True)
        return 1

    winning = parse_smoke_winning_config()
    if not winning:
        log("FAIL: no successful smoke attempt; not proceeding to full training")
        summary["steps"].append({"step": "parse_smoke", "status": "NO_WINNER"})
        _finish(summary, failed=True)
        return 1
    log(f"smoke winning config: {winning}")
    summary["smokeWinningConfig"] = winning

    # 4. full training with winning config
    train_cmd = [
        PYTHON, "training/train_qlora.py",
        "--config", str(ML / "configs" / "qwen3-4b-qlora.yaml"),
        "--model-name", str(MODEL),
        "--max-length", str(winning["maxLength"]),
        "--lora-r", str(winning["loraR"]),
        "--lora-alpha", str(winning["loraAlpha"]),
    ]
    rc, _ = run("full_training", train_cmd, timeout=21600)  # 6h ceiling
    summary["steps"].append({"step": "full_training", "status": "OK" if rc == 0 else "FAIL", "rc": rc})
    if rc != 0:
        _finish(summary, failed=True)
        return 1

    adapter_path = OUTPUT / "aetherargus-lora"
    # 5. LoRA evaluation
    rc, _ = run(
        "lora_eval",
        [PYTHON, "evaluation/evaluate_model.py", "--mode", "model",
         "--run-name", "lora",
         "--model-name", str(MODEL),
         "--adapter-path", str(adapter_path),
         "--max-input-length", "1024", "--max-new-tokens", "320", "--seed", "42"],
        timeout=7200,
    )
    summary["steps"].append({"step": "lora_eval", "status": "OK" if rc == 0 else "FAIL", "rc": rc})
    if rc != 0:
        _finish(summary, failed=True)
        return 1

    # 6. combined (rules + LoRA)
    rc, _ = run(
        "combined_eval",
        [PYTHON, "evaluation/evaluate_model.py", "--mode", "combined",
         "--run-name", "combined",
         "--model-predictions", str(OUTPUT / "lora-predictions.jsonl"),
         "--rule-predictions", str(OUTPUT / "rules-predictions.jsonl")],
        timeout=600,
    )
    summary["steps"].append({"step": "combined_eval", "status": "OK" if rc == 0 else "FAIL", "rc": rc})

    # 7. merge adapter
    rc, _ = run(
        "merge_adapter",
        [PYTHON, "training/merge_adapter.py",
         "--base-model", str(MODEL),
         "--adapter-path", str(adapter_path),
         "--output-dir", str(OUTPUT / "aetherargus-merged")],
        timeout=7200,
    )
    summary["steps"].append({"step": "merge_adapter", "status": "OK" if rc == 0 else "FAIL", "rc": rc})

    _finish(summary, failed=False)
    return 0


def _finish(summary: dict, failed: bool) -> None:
    summary["finishedAt"] = datetime.now(UTC).isoformat()
    summary["status"] = "FAILED" if failed else "COMPLETE"
    path = REPORTS / "orchestrator-summary.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"ORCHESTRATOR {summary['status']} -> {path}")


if __name__ == "__main__":
    raise SystemExit(main())
