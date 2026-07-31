#!/usr/bin/env python3
"""Resumable label-blind Transformers inference for frozen LAN inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed

from inference_common import (
    assert_complete,
    EXPECTED_INPUT_SHA256,
    make_prediction_record,
    prepare_append_only_output,
    read_model_inputs,
    user_message,
    write_prediction,
)


MESSAGE_MODES = ("system-user", "single-concatenated", "pre-serialized")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_serialized_prompts(
    path: Path | None,
    rows: list[dict[str, Any]],
    expected_system_prompt_sha: str,
) -> dict[str, dict[str, Any]]:
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
            if item.get("systemPromptSha256") != expected_system_prompt_sha:
                raise ValueError(f"serialized prompt used a different system prompt for {sample_id}")
            if item.get("inputSha256") != EXPECTED_INPUT_SHA256:
                raise ValueError(f"serialized prompt used a different frozen input for {sample_id}")
            prompts[sample_id] = item
    expected_ids = {row["sampleId"] for row in rows}
    if set(prompts) != expected_ids:
        raise ValueError("serialized prompt sampleIds do not match frozen input sampleIds")
    return prompts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--few-shot", type=Path, help="few-shot-examples-v2.json manifest; prepends frozen example turns")
    parser.add_argument("--message-mode", choices=MESSAGE_MODES, default="system-user")
    parser.add_argument("--serialized-prompts", type=Path)
    parser.add_argument("--max-context", type=int, default=2048)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    arguments = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the locked Transformers runs")
    if arguments.adapter is not None and not arguments.adapter.is_dir():
        raise FileNotFoundError(f"adapter not found: {arguments.adapter}")
    if arguments.message_mode != "system-user" and arguments.few_shot is not None:
        raise ValueError("few-shot turns are only supported in system-user mode")
    if arguments.message_mode != "pre-serialized" and arguments.serialized_prompts is not None:
        raise ValueError("--serialized-prompts is only valid in pre-serialized mode")

    rows = read_model_inputs(arguments.input)
    system_prompt = arguments.prompt.read_text(encoding="utf-8")
    system_prompt_sha = sha256_text(system_prompt)
    serialized_prompts = (
        load_serialized_prompts(arguments.serialized_prompts, rows, system_prompt_sha)
        if arguments.message_mode == "pre-serialized"
        else {}
    )
    few_shot_turns: list[dict[str, str]] = []
    few_shot_sha: str | None = None
    if arguments.few_shot is not None:
        manifest = json.loads(arguments.few_shot.read_text(encoding="utf-8"))
        if manifest.get("status") != "AVAILABLE":
            raise RuntimeError(f"few-shot manifest not AVAILABLE: {manifest.get('status')}")
        few_shot_sha = manifest.get("examplesSha256")
        for example in manifest["examples"]:
            few_shot_turns.append({"role": "user", "content": example["userMessage"]})
            few_shot_turns.append({"role": "assistant", "content": example["assistantResponse"]})

    tokenizer_reference = str(arguments.adapter) if arguments.adapter else arguments.model
    tokenizer = AutoTokenizer.from_pretrained(
        tokenizer_reference,
        revision=None if arguments.adapter else arguments.revision,
        trust_remote_code=False,
    )
    model = AutoModelForCausalLM.from_pretrained(
        arguments.model,
        revision=arguments.revision,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=False,
    )
    if arguments.adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, str(arguments.adapter), is_trainable=False)
    model.eval()
    set_seed(0)
    output, completed = prepare_append_only_output(arguments.output, arguments.model_id)
    try:
        for row in rows:
            sample_id = row["sampleId"]
            if sample_id in completed:
                continue
            serialized_prompt_sha: str | None = None
            if arguments.message_mode == "pre-serialized":
                prompt_row = serialized_prompts[sample_id]
                serialized_prompt = prompt_row["serializedPrompt"]
                serialized_prompt_sha = prompt_row["serializedPromptSha256"]
                inputs = tokenizer(
                    serialized_prompt,
                    add_special_tokens=False,
                    return_tensors="pt",
                )
            else:
                request_message = user_message(row["input"])
                if arguments.message_mode == "single-concatenated":
                    messages = [{"role": "user", "content": system_prompt.rstrip("\n") + "\n\n" + request_message}]
                else:
                    messages = [
                        {"role": "system", "content": system_prompt},
                        *few_shot_turns,
                        {"role": "user", "content": request_message},
                    ]
                inputs = tokenizer.apply_chat_template(
                    messages,
                    tokenize=True,
                    add_generation_prompt=True,
                    return_tensors="pt",
                    return_dict=True,
                )
            inputs = {name: value[:, -arguments.max_context :].to(model.device) for name, value in inputs.items()}
            torch.cuda.synchronize()
            started = time.perf_counter()
            with torch.inference_mode():
                generated = model.generate(
                    **inputs,
                    max_new_tokens=arguments.max_new_tokens,
                    do_sample=False,
                    temperature=None,
                    top_p=None,
                    top_k=None,
                    pad_token_id=tokenizer.eos_token_id,
                )
            torch.cuda.synchronize()
            prompt_tokens = inputs["input_ids"].shape[1]
            output_ids = generated[0, prompt_tokens:]
            raw_output = tokenizer.decode(output_ids, skip_special_tokens=True).strip()
            record = make_prediction_record(
                sample_id=sample_id,
                model_id=arguments.model_id,
                raw_output=raw_output,
                latency_ms=(time.perf_counter() - started) * 1000,
                input_token_count=prompt_tokens,
                output_token_count=len(output_ids),
            )
            record["messageMode"] = arguments.message_mode
            record["systemPromptSha256"] = system_prompt_sha
            if serialized_prompt_sha is not None:
                record["serializedPromptSha256"] = serialized_prompt_sha
            if few_shot_sha is not None:
                record["fewShotExamplesSha256"] = few_shot_sha
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
