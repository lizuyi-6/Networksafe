#!/usr/bin/env python3
"""Test return_tensors='pt' chat-template path for correctness AND speed."""
from __future__ import annotations

import json
import time
from pathlib import Path

from transformers import AutoTokenizer

ML = Path("/mnt/x/repos/Networksafe/ml")
MODEL = ML / "output" / "base-model"
OUT = ML / "logs" / "pt_path_test.txt"


def main() -> int:
    tok = AutoTokenizer.from_pretrained(str(MODEL), use_fast=True, trust_remote_code=False)
    lines = [f"eos={tok.eos_token_id}"]
    train_path = ML / "data" / "processed" / "train.jsonl"
    records = [json.loads(l) for l in train_path.open(encoding="utf-8") if l.strip()][:16]

    # Test 1: return_tensors='pt' WITHOUT return_dict
    t0 = time.perf_counter()
    rows = []
    for rec in records:
        msgs = rec["messages"]
        p = tok.apply_chat_template(msgs[:-1], tokenize=True, add_generation_prompt=True, return_tensors="pt")
        f = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=False, return_tensors="pt")
        # p, f are tensors (1, L); get lengths
        plen = int(p.shape[-1]) if hasattr(p, "shape") else len(p)
        flen = int(f.shape[-1]) if hasattr(f, "shape") else len(f)
        rows.append((plen, flen))
    dt1 = time.perf_counter() - t0
    lines.append(f"return_tensors='pt' (no dict): {dt1:.2f}s for 16 records; first rows (plen,flen)={rows[:4]}")
    lines.append(f"  plen range {min(r[0] for r in rows)}-{max(r[0] for r in rows)}, flen range {min(r[1] for r in rows)}-{max(r[1] for r in rows)}")

    # Test 2: return_tensors='pt' WITH return_dict=True
    t0 = time.perf_counter()
    rows2 = []
    for rec in records:
        msgs = rec["messages"]
        p = tok.apply_chat_template(msgs[:-1], tokenize=True, add_generation_prompt=True, return_tensors="pt", return_dict=True)
        f = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=False, return_tensors="pt", return_dict=True)
        plen = int(p["input_ids"].shape[-1])
        flen = int(f["input_ids"].shape[-1])
        rows2.append((plen, flen))
    dt2 = time.perf_counter() - t0
    lines.append(f"return_tensors='pt' return_dict=True: {dt2:.2f}s for 16 records; first rows={rows2[:4]}")

    text = "\n".join(lines)
    OUT.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
