#!/usr/bin/env python3
"""Diagnose chat-template prompt token lengths to pick a correct max_length."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from transformers import AutoTokenizer

ML = Path("/mnt/x/repos/Networksafe/ml")
MODEL = ML / "output" / "base-model"

sys.path.insert(0, str(ML / "scripts"))
from detection_contract import SYSTEM_PROMPT  # noqa: E402


def prompt_token_len(tokenizer, messages_with_assistant):
    prompt_messages = messages_with_assistant[:-1]  # system + user
    ids = tokenizer.apply_chat_template(prompt_messages, tokenize=True, add_generation_prompt=True)
    return len(ids)


def full_token_len(tokenizer, messages_with_assistant):
    ids = tokenizer.apply_chat_template(messages_with_assistant, tokenize=True, add_generation_prompt=False)
    return len(ids)


def main() -> int:
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL), use_fast=True, trust_remote_code=False)
    print(f"tokenizer loaded, eos={tokenizer.eos_token_id}")
    # measure system prompt alone
    sys_ids = tokenizer.apply_chat_template(
        [{"role": "system", "content": SYSTEM_PROMPT}], tokenize=True, add_generation_prompt=False
    )
    print(f"system-only template tokens: {len(sys_ids)}")
    sys_plus_gen = tokenizer.apply_chat_template(
        [{"role": "system", "content": SYSTEM_PROMPT}], tokenize=True, add_generation_prompt=True
    )
    print(f"system + generation_prompt tokens: {len(sys_plus_gen)}")

    for split in ("train", "validation", "test"):
        path = ML / "data" / "processed" / f"{split}.jsonl"
        prompt_lens = []
        full_lens = []
        with path.open(encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                prompt_lens.append(prompt_token_len(tokenizer, rec["messages"]))
                full_lens.append(full_token_len(tokenizer, rec["messages"]))
        prompt_lens.sort()
        full_lens.sort()
        n = len(prompt_lens)

        def pct(arr, p):
            return arr[min(int(p * n), n - 1)]

        over_768 = sum(1 for x in prompt_lens if x >= 768)
        over_1024 = sum(1 for x in prompt_lens if x >= 1024)
        over_1280 = sum(1 for x in prompt_lens if x >= 1280)
        print(
            f"\n{split}: n={n} prompt tokens min={prompt_lens[0]} p50={pct(prompt_lens,0.5)} "
            f"p95={pct(prompt_lens,0.95)} max={prompt_lens[-1]} | full max={full_lens[-1]}"
        )
        print(f"  prompt>=768: {over_768}  >=1024: {over_1024}  >=1280: {over_1280}")
        # assistant tokens surviving at various max_length
        for ml in (768, 1024, 1280, 1536):
            surviving = sum(1 for p, fu in zip(prompt_lens, full_lens) if ml > p)
            print(f"  max_length={ml}: records with >0 assistant tokens = {surviving}/{n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
