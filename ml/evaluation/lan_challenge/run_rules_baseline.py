#!/usr/bin/env python3
"""Formal ``rules-baseline`` runner.

Provenance (Option A): this baseline does NOT re-handle the repository's seed rules in
Python. It spawns the offline TypeScript adapter ``rules_engine_adapter.ts``, which imports
the FROZEN repository detection engine
(``backend/src/services/detection-engine.ts`` at ``SOURCE_COMMIT``) and runs
``buildSeedDetectionRules()`` + ``evaluateDetectionRules()`` verbatim on the frozen inputs.
The adapter is label-blind, DB-less, network-less, and never touches response-side data.

Verdict mapping (engine -> challenge), reflecting the engine's own behaviour:
  block  -> attack   (families sqli/xss/path_traversal/command_injection)
  monitor-> unknown  (review-tier only, e.g. ssrf/automation; engine escalated, did not block)
  none   -> safe

The broader post-hoc regex families (prompt_injection / protocol_attack / authentication /
file_upload / expanded xss-ssrf) are NOT part of this formal baseline; they live in the
separately-reported ``research-augmented-rules`` runner so no augmented rule masquerades as
a pre-existing repository seed rule.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from inference_common import (
    EXPECTED_INPUT_SHA256,
    assert_complete,
    make_prediction_record,
    prepare_append_only_output,
    read_model_inputs,
    write_prediction,
)

MODEL_ID = "rules-baseline"
SOURCE_COMMIT = "4359276fa9c6c0b56b168fc5c002e7e542fe30b3"
SOURCE_FILE = "backend/src/services/detection-engine.ts"
SOURCE_BLOB_SHA1 = "95654206590b7fb733d1425b280e7dfacc8c20ba"  # git blob at SOURCE_COMMIT == HEAD
ENGINE_FUNCTIONS = ["buildSeedDetectionRules", "evaluateDetectionRules"]

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER = Path(__file__).resolve().parent / "rules_engine_adapter.ts"
TS_NODE_BIN = REPO_ROOT / "backend" / "node_modules" / "ts-node" / "dist" / "bin.js"
BACKEND_TSCONFIG = REPO_ROOT / "backend" / "tsconfig.json"


def _peak_host_mib() -> float | None:
    try:
        import resource  # type: ignore[import-not-found]

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    except Exception:
        return None


def run_engine_adapter(input_path: Path) -> list[dict[str, Any]]:
    """Invoke the offline TS engine adapter once and return its per-sample records."""
    if not TS_NODE_BIN.exists():
        raise FileNotFoundError(f"ts-node not found at {TS_NODE_BIN}")
    node = shutil.which("node")
    if node is None:
        raise FileNotFoundError("node executable not on PATH")
    env = dict(os.environ)
    env["DISABLE_SEED_RULES"] = "false"  # neutralize the dev-mode seed disable guard
    env["NODE_ENV"] = "production"
    cmd = [
        node,
        str(TS_NODE_BIN),
        "--transpile-only",
        "--project",
        str(BACKEND_TSCONFIG),
        str(ADAPTER),
        "--input",
        str(input_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, check=False)
    if proc.returncode != 0:
        raise RuntimeError(
            f"rules_engine_adapter failed (exit {proc.returncode}):\n"
            f"stdout:\n{proc.stdout[:2000]}\nstderr:\n{proc.stderr[:2000]}"
        )
    records: list[dict[str, Any]] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        records.append(json.loads(line))
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    rows = read_model_inputs(arguments.input)
    output, completed = prepare_append_only_output(arguments.output, MODEL_ID)
    started = time.perf_counter()
    seed_rule_count: int | None = None
    try:
        adapter_rows = run_engine_adapter(arguments.input)
        adapter_by_id = {row["sampleId"]: row for row in adapter_rows}
        for row in rows:
            sample_id = row["sampleId"]
            if sample_id in completed:
                continue
            if sample_id not in adapter_by_id:
                raise RuntimeError(f"engine adapter produced no record for {sample_id}")
            adapter_row = adapter_by_id[sample_id]
            engine_meta = adapter_row.get("engineMeta", {})
            seed_rule_count = engine_meta.get("seedRuleCount", seed_rule_count)
            sample_started = time.perf_counter()
            record = make_prediction_record(
                sample_id=sample_id,
                model_id=MODEL_ID,
                raw_output=adapter_row["rawOutput"],
                latency_ms=(time.perf_counter() - sample_started) * 1000,
                input_token_count=None,
                output_token_count=None,
            )
            record["ruleSource"] = {
                "kind": "offline_detection_engine_adapter",
                "commit": SOURCE_COMMIT,
                "file": SOURCE_FILE,
                "blobSha1": SOURCE_BLOB_SHA1,
                "engineFunctions": ENGINE_FUNCTIONS,
                "seedRuleCount": seed_rule_count,
                "challengeResultUsed": False,
            }
            record["engineMeta"] = engine_meta
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    elapsed = time.perf_counter() - started
    summary = {
        "modelId": MODEL_ID,
        "status": "SUCCESS",
        "sampleCount": len(rows),
        "inputSha256": EXPECTED_INPUT_SHA256,
        "elapsedSeconds": elapsed,
        "samplesPerSecond": len(rows) / elapsed if elapsed else None,
        "peakHostMemoryMiB": _peak_host_mib(),
        "sourceCommit": SOURCE_COMMIT,
        "sourceFile": SOURCE_FILE,
        "sourceBlobSha1": SOURCE_BLOB_SHA1,
        "seedRuleCount": seed_rule_count,
        "adapter": "rules_engine_adapter.ts (offline, label-blind)",
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
