#!/usr/bin/env python3
"""Evaluate the GGUF/Ollama deployment artifact on the fixed AetherGuard test set.

Runs real inference through the Ollama HTTP API (model must already be created
from `ml/deployment/Modelfile`), then scores predictions with the SAME strict
JSON/Schema contract and metric definitions used by `evaluate_model.py`, so the
result is directly comparable to the baseline / LoRA runs. Emits a predictions
JSONL that is consumed via `evaluate_model.py --mode score`.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

EVALUATION_DIRECTORY = Path(__file__).resolve().parent
SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"
for candidate in (str(EVALUATION_DIRECTORY), str(SCRIPTS_DIRECTORY)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from detection_contract import parse_strict_json_object, validate_detection_output  # noqa: E402
from evaluate_model import (  # noqa: E402
    extract_expected_output,
    fallback_unknown_output,
    load_fixed_test_records,
    repository_root,
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="aetherargus")
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument(
        "--test-file",
        type=Path,
        default=repository_root() / "ml" / "data" / "processed" / "test.jsonl",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository_root() / "ml" / "output" / "ollama-predictions.jsonl",
    )
    parser.add_argument("--max-samples", type=int, default=None)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    parser.add_argument("--request-timeout", type=int, default=180)
    parser.add_argument(
        "--inference-mode",
        default="ollama_gguf",
        help="Label recorded per prediction (e.g. ollama_gguf_q4_k_m); reflect the actual quant.",
    )
    return parser.parse_args()


def call_ollama_chat(
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
    max_new_tokens: int,
    request_timeout: int,
) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0,
            "num_predict": max_new_tokens,
            "stop": ["<|im_end|>", "<|endoftext|>"],
        },
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=request_timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    arguments = parse_arguments()
    test_records = load_fixed_test_records(arguments.test_file.resolve(), arguments.max_samples)

    output_path = arguments.output
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Sample-level crash recovery: reload already-computed predictions and skip
    # their sampleIds. Inference is deterministic (temperature 0), so a resumed
    # prediction is identical to a fresh one — this only adds restart tolerance.
    done_sample_ids: set[str] = set()
    if output_path.is_file():
        recovered: list[str] = []
        with output_path.open("r", encoding="utf-8") as existing:
            for line in existing:
                line = line.strip()
                if not line:
                    continue
                try:
                    sample_id = json.loads(line)["sampleId"]
                except (json.JSONDecodeError, KeyError):
                    continue  # drop truncated/partial line from an interrupted write
                if sample_id in done_sample_ids:
                    continue  # drop duplicate
                done_sample_ids.add(sample_id)
                recovered.append(line)
        # Rewrite the file with only valid, deduplicated lines so scoring never
        # trips over a partial final line left by a mid-write kill.
        with output_path.open("w", encoding="utf-8") as rewritten:
            for line in recovered:
                rewritten.write(line + "\n")
        print(f"resume: {len(done_sample_ids)} predictions already present", flush=True)

    pending_records = [r for r in test_records if r["sampleId"] not in done_sample_ids]
    output_file = output_path.open("a", encoding="utf-8")

    for index, test_record in enumerate(pending_records, start=1):
        prompt_messages = [
            {"role": message["role"], "content": message["content"]}
            for message in test_record["messages"]
            if message.get("role") in {"system", "user"}
        ]
        started_at = time.perf_counter()
        model_invoked = True
        raw_output = ""
        try:
            ollama_response = call_ollama_chat(
                arguments.base_url,
                arguments.model,
                prompt_messages,
                arguments.max_new_tokens,
                arguments.request_timeout,
            )
            raw_output = (ollama_response.get("message") or {}).get("content", "").strip()
        except Exception as invocation_error:  # noqa: BLE001 - record, never fake safe
            model_invoked = False
            raw_output = f"__OLLAMA_INVOCATION_ERROR__: {type(invocation_error).__name__}: {invocation_error}"
        latency_milliseconds = (time.perf_counter() - started_at) * 1000

        json_syntax_valid = False
        schema_valid = False
        validation_errors: list[str] = []
        parsed_output = None
        if model_invoked:
            try:
                parsed_output = parse_strict_json_object(raw_output)
                json_syntax_valid = True
                validation_errors = validate_detection_output(parsed_output)
                schema_valid = not validation_errors
            except (json.JSONDecodeError, TypeError, ValueError) as parse_error:
                parsed_output = None
                validation_errors = [f"{type(parse_error).__name__}: {parse_error}"]
        else:
            validation_errors = ["ollama_invocation_failed"]

        effective_prediction = (
            parsed_output
            if schema_valid and parsed_output is not None
            else fallback_unknown_output("Ollama 输出无法通过严格 JSON Schema 验证，按 fail-safe 返回 unknown")
        )
        prediction_record = {
            "sampleId": test_record["sampleId"],
            "expected": extract_expected_output(test_record),
            "prediction": effective_prediction,
            "rawOutput": raw_output,
            "jsonSyntaxValid": json_syntax_valid,
            "schemaValid": schema_valid,
            "validationErrors": validation_errors,
            "latencyMs": latency_milliseconds,
            "metadata": test_record.get("metadata", {}),
            "inferenceMode": arguments.inference_mode,
            "modelInvoked": model_invoked,
        }
        output_file.write(json.dumps(prediction_record, ensure_ascii=False) + "\n")
        output_file.flush()
        if index % 10 == 0 or index == len(pending_records):
            print(f"progress {index}/{len(pending_records)} (total done {len(done_sample_ids) + index}/{len(test_records)})", flush=True)

    output_file.close()
    print(f"wrote predictions to {output_path} ({len(pending_records)} new, {len(test_records)} total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
