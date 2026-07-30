#!/usr/bin/env python3
"""Resumable label-blind Transformers inference for frozen LAN inputs."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed

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
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-context", type=int, default=2048)
    parser.add_argument("--max-new-tokens", type=int, default=320)
    arguments = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for the locked Transformers runs")
    if arguments.adapter is not None and not arguments.adapter.is_dir():
        raise FileNotFoundError(f"adapter not found: {arguments.adapter}")
    rows = read_model_inputs(arguments.input)
    system_prompt = arguments.prompt.read_text(encoding="utf-8")
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
            if row["sampleId"] in completed:
                continue
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message(row["input"])},
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
                sample_id=row["sampleId"],
                model_id=arguments.model_id,
                raw_output=raw_output,
                latency_ms=(time.perf_counter() - started) * 1000,
                input_token_count=prompt_tokens,
                output_token_count=len(output_ids),
            )
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
