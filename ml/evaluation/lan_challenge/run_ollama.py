#!/usr/bin/env python3
"""Resumable label-blind Ollama inference for frozen LAN inputs."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

from inference_common import (
    assert_complete,
    make_prediction_record,
    prepare_append_only_output,
    read_model_inputs,
    user_message,
    write_prediction,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--ollama-model", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--num-ctx", type=int, default=2048)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    arguments = parser.parse_args()
    rows = read_model_inputs(arguments.input)
    system_prompt = arguments.prompt.read_text(encoding="utf-8")
    output, completed = prepare_append_only_output(arguments.output, arguments.model_id)
    try:
        for row in rows:
            if row["sampleId"] in completed:
                continue
            payload = {
                "model": arguments.ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message(row["input"])},
                ],
                "stream": False,
                "options": {
                    "num_ctx": arguments.num_ctx,
                    "num_predict": arguments.max_new_tokens,
                    "temperature": 0,
                    "top_p": 1,
                    "top_k": 0,
                    "seed": 0,
                },
            }
            request = urllib.request.Request(
                arguments.base_url.rstrip("/") + "/api/chat",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            started = time.perf_counter()
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.loads(response.read().decode("utf-8"))
            raw_output = ((result.get("message") or {}).get("content") or "").strip()
            record = make_prediction_record(
                sample_id=row["sampleId"],
                model_id=arguments.model_id,
                raw_output=raw_output,
                latency_ms=(time.perf_counter() - started) * 1000,
                input_token_count=result.get("prompt_eval_count"),
                output_token_count=result.get("eval_count"),
            )
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
