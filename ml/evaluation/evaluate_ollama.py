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
    write_jsonl,
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
    prediction_records: list[dict[str, Any]] = []

    for index, test_record in enumerate(test_records, start=1):
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
                "inferenceMode": "ollama_gguf_q4_k_m",
                "modelInvoked": model_invoked,
            }
        )
        if index % 10 == 0 or index == len(test_records):
            print(f"progress {index}/{len(test_records)}", flush=True)

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(arguments.output, prediction_records)
    print(f"wrote {len(prediction_records)} predictions to {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
