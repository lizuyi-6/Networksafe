#!/usr/bin/env python3
"""Resumable label-blind Ollama inference for frozen LAN inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path
from typing import Any

from inference_common import (
    assert_complete,
    make_prediction_record,
    prepare_append_only_output,
    read_model_inputs,
    user_message,
    write_prediction,
)


MESSAGE_MODES = ("system-user", "single-concatenated", "pre-serialized")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_serialized_prompts(path: Path | None, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if path is None:
        raise ValueError("--serialized-prompts is required for pre-serialized mode")
    prompts: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            sample_id = item.get("sampleId")
            serialized = item.get("serializedPrompt")
            if not isinstance(sample_id, str) or not isinstance(serialized, str):
                raise ValueError(f"invalid serialized prompt at line {line_number}")
            if sample_id in prompts:
                raise ValueError(f"duplicate serialized prompt sampleId: {sample_id}")
            if sha256_text(serialized) != item.get("serializedPromptSha256"):
                raise ValueError(f"serialized prompt SHA mismatch for {sample_id}")
            prompts[sample_id] = item
    expected_ids = {row["sampleId"] for row in rows}
    if set(prompts) != expected_ids:
        raise ValueError("serialized prompt sampleIds do not match frozen input sampleIds")
    return prompts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--ollama-model", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--message-mode", choices=MESSAGE_MODES, default="system-user")
    parser.add_argument("--serialized-prompts", type=Path)
    parser.add_argument("--num-ctx", type=int, default=2048)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    arguments = parser.parse_args()
    if arguments.message_mode != "pre-serialized" and arguments.serialized_prompts is not None:
        raise ValueError("--serialized-prompts is only valid in pre-serialized mode")

    rows = read_model_inputs(arguments.input)
    system_prompt = arguments.prompt.read_text(encoding="utf-8")
    system_prompt_sha = sha256_text(system_prompt)
    serialized_prompts = (
        load_serialized_prompts(arguments.serialized_prompts, rows)
        if arguments.message_mode == "pre-serialized"
        else {}
    )
    output, completed = prepare_append_only_output(arguments.output, arguments.model_id)
    try:
        for row in rows:
            sample_id = row["sampleId"]
            if sample_id in completed:
                continue
            serialized_prompt_sha: str | None = None
            options = {
                "num_ctx": arguments.num_ctx,
                "num_predict": arguments.max_new_tokens,
                "temperature": 0,
                "top_p": 1,
                "top_k": 0,
                "seed": 0,
            }
            if arguments.message_mode == "pre-serialized":
                prompt_row = serialized_prompts[sample_id]
                serialized_prompt_sha = prompt_row["serializedPromptSha256"]
                endpoint = "/api/generate"
                payload = {
                    "model": arguments.ollama_model,
                    "prompt": prompt_row["serializedPrompt"],
                    "raw": True,
                    "stream": False,
                    "options": options,
                }
            else:
                request_message = user_message(row["input"])
                if arguments.message_mode == "single-concatenated":
                    messages = [{"role": "user", "content": system_prompt.rstrip("\n") + "\n\n" + request_message}]
                else:
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": request_message},
                    ]
                endpoint = "/api/chat"
                payload = {
                    "model": arguments.ollama_model,
                    "messages": messages,
                    "stream": False,
                    "options": options,
                }
            request = urllib.request.Request(
                arguments.base_url.rstrip("/") + endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            started = time.perf_counter()
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.loads(response.read().decode("utf-8"))
            if arguments.message_mode == "pre-serialized":
                raw_output = (result.get("response") or "").strip()
            else:
                raw_output = ((result.get("message") or {}).get("content") or "").strip()
            record = make_prediction_record(
                sample_id=sample_id,
                model_id=arguments.model_id,
                raw_output=raw_output,
                latency_ms=(time.perf_counter() - started) * 1000,
                input_token_count=result.get("prompt_eval_count"),
                output_token_count=result.get("eval_count"),
            )
            record["messageMode"] = arguments.message_mode
            record["systemPromptSha256"] = system_prompt_sha
            if serialized_prompt_sha is not None:
                record["serializedPromptSha256"] = serialized_prompt_sha
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
