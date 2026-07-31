#!/usr/bin/env python3
"""Prepare label-blind, byte-identical prompts for cross-runtime diagnostics.

The output contains sanitized challenge inputs serialized with the Transformers chat
template. It is a local intermediate and MUST NOT be committed. Inference processes
consume it without reading labels; the scorer reads labels only after predictions exist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from transformers import AutoTokenizer

from inference_common import read_model_inputs, user_message


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tokenizer", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    rows = read_model_inputs(arguments.input)
    system_prompt = arguments.prompt.read_text(encoding="utf-8")
    system_prompt_sha = sha256_text(system_prompt)
    tokenizer = AutoTokenizer.from_pretrained(
        arguments.tokenizer,
        revision=arguments.revision,
        trust_remote_code=False,
    )

    completed: dict[str, dict[str, object]] = {}
    if arguments.output.exists():
        with arguments.output.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                if not line.strip():
                    continue
                item = json.loads(line)
                sample_id = item.get("sampleId")
                serialized = item.get("serializedPrompt")
                if not isinstance(sample_id, str) or not isinstance(serialized, str):
                    raise ValueError(f"invalid existing prompt at line {line_number}")
                if sample_id in completed:
                    raise ValueError(f"duplicate existing prompt sampleId: {sample_id}")
                if sha256_text(serialized) != item.get("serializedPromptSha256"):
                    raise ValueError(f"existing prompt SHA mismatch for {sample_id}")
                if item.get("systemPromptSha256") != system_prompt_sha:
                    raise ValueError("existing prompt file used a different system prompt")
                completed[sample_id] = item

    expected_ids = {row["sampleId"] for row in rows}
    if not set(completed).issubset(expected_ids):
        raise ValueError("existing prompt file contains sampleIds outside the frozen input")
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("a", encoding="utf-8", buffering=1) as output:
        for row in rows:
            sample_id = row["sampleId"]
            if sample_id in completed:
                continue
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message(row["input"])},
            ]
            serialized = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
            if not isinstance(serialized, str):
                raise TypeError("tokenizer.apply_chat_template did not return text")
            item = {
                "schemaVersion": 1,
                "sampleId": sample_id,
                "serialization": "transformers.tokenizer.apply_chat_template",
                "systemPromptSha256": system_prompt_sha,
                "serializedPromptSha256": sha256_text(serialized),
                "serializedPrompt": serialized,
            }
            output.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
            output.flush()

    with arguments.output.open("r", encoding="utf-8") as stream:
        final_ids = {json.loads(line)["sampleId"] for line in stream if line.strip()}
    if final_ids != expected_ids:
        raise RuntimeError(f"expected {len(expected_ids)} serialized prompts, found {len(final_ids)}")
    print(
        json.dumps(
            {
                "status": "SUCCESS",
                "sampleCount": len(final_ids),
                "output": str(arguments.output),
                "warning": "LOCAL INTERMEDIATE: contains serialized model inputs; do not commit",
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
