#!/usr/bin/env python3
"""Focused: inspect one train record's tokenization to debug the smoke failure."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from transformers import AutoTokenizer

ML = Path("/mnt/x/repos/Networksafe/ml")
MODEL = ML / "output" / "base-model"
OUT = ML / "logs" / "length_debug.txt"


def main() -> int:
    tok = AutoTokenizer.from_pretrained(str(MODEL), use_fast=True, trust_remote_code=False)
    lines = []
    lines.append(f"eos={tok.eos_token_id} pad={tok.pad_token_id}")

    train_path = ML / "data" / "processed" / "train.jsonl"
    records = [json.loads(l) for l in train_path.open(encoding="utf-8") if l.strip()][:16]
    for i, rec in enumerate(records):
        msgs = rec["messages"]
        prompt_msgs = msgs[:-1]
        # OLD (broken in transformers v5): apply_chat_template(tokenize=True) -> 2 tokens
        old_prompt = tok.apply_chat_template(prompt_msgs, tokenize=True, add_generation_prompt=True)
        # NEW (fixed): render text, then tokenize explicitly
        prompt_text = tok.apply_chat_template(prompt_msgs, tokenize=False, add_generation_prompt=True)
        full_text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        prompt_ids = tok(prompt_text, add_special_tokens=False)["input_ids"]
        full_ids = tok(full_text, add_special_tokens=False)["input_ids"]
        max_length = 768
        truncated = full_ids[:max_length]
        prompt_length = min(len(prompt_ids), len(truncated))
        labels = [-100] * prompt_length + truncated[prompt_length:]
        n_assistant = sum(1 for x in labels if x != -100)
        lines.append(
            f"rec{i} OLD_prompt_ids={len(old_prompt)} | NEW prompt_ids={len(prompt_ids)} full_ids={len(full_ids)} "
            f"prompt_length={prompt_length} assistant_tokens={n_assistant}"
        )
    # Also show the rendered text of rec0 prompt vs full tail
    rec0 = records[0]
    prompt_text = tok.apply_chat_template(rec0["messages"][:-1], tokenize=False, add_generation_prompt=True)
    full_text = tok.apply_chat_template(rec0["messages"], tokenize=False, add_generation_prompt=False)
    lines.append("=== rec0 prompt_text (last 200 chars) ===")
    lines.append(prompt_text[-200:])
    lines.append("=== rec0 full_text (last 200 chars) ===")
    lines.append(full_text[-200:])
    text = "\n".join(lines)
    OUT.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
