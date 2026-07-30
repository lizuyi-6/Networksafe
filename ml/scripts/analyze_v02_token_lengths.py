#!/usr/bin/env python3
"""Token-length analysis for the AetherArgus v0.2 train/validation splits.

Uses the real Qwen3-4B-Instruct-2507 tokenizer and chat template (same
return_dict=True path as training) so the numbers reflect what the trainer
actually feeds the model. Writes JSON + Markdown reports and does not truncate.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parents[2]
BASE_MODEL = ROOT / "ml" / "output" / "base-model"
SPLITS = {
    "train": ROOT / "ml" / "data" / "releases" / "v02" / "train.jsonl",
    "validation": ROOT / "ml" / "data" / "releases" / "v02" / "validation.jsonl",
}


def percentile(ordered: list[int], fraction: float) -> int:
    if not ordered:
        return 0
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return ordered[index]


def stats(lengths: list[int]) -> dict:
    ordered = sorted(lengths)
    n = len(ordered)
    if n == 0:
        return {"count": 0}
    return {
        "count": n,
        "min": ordered[0],
        "mean": round(sum(ordered) / n, 2),
        "median": percentile(ordered, 0.50),
        "p90": percentile(ordered, 0.90),
        "p95": percentile(ordered, 0.95),
        "p99": percentile(ordered, 0.99),
        "max": ordered[-1],
        "over512": round(sum(1 for v in ordered if v > 512) / n, 4),
        "over768": round(sum(1 for v in ordered if v > 768) / n, 4),
        "over1024": round(sum(1 for v in ordered if v > 1024) / n, 4),
        "over1536": round(sum(1 for v in ordered if v > 1536) / n, 4),
    }


def message_token_length(tokenizer, messages: list[dict]) -> int:
    encoded = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=False,
        return_tensors="pt",
        return_dict=True,
    )
    return int(encoded["input_ids"][0].shape[0])


def main() -> int:
    tokenizer = AutoTokenizer.from_pretrained(str(BASE_MODEL), use_fast=True, trust_remote_code=False)
    report = {"tokenizer": "Qwen/Qwen3-4B-Instruct-2507 (local base-model)", "splits": {}}
    for split_name, path in SPLITS.items():
        full_lengths: list[int] = []
        assistant_lengths: list[int] = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                messages = record["messages"]
                full_lengths.append(message_token_length(tokenizer, messages))
                prompt = messages[:-1]
                prompt_len = message_token_length_prompt(tokenizer, prompt)
                assistant_lengths.append(full_lengths[-1] - prompt_len)
        report["splits"][split_name] = {
            "full": stats(full_lengths),
            "assistant": stats(assistant_lengths),
        }
        print(split_name, "full:", report["splits"][split_name]["full"], flush=True)

    out_json = ROOT / "ml" / "reports" / "aetherargus-v02-token-length-analysis.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = ["# AetherArgus v0.2 Token 长度分析", ""]
    lines.append("- tokenizer: Qwen3-4B-Instruct-2507（本地 base-model）+ chat template（return_dict）")
    lines.append("")
    for split_name, payload in report["splits"].items():
        full = payload["full"]
        lines.append("## %s（count=%d）" % (split_name, full["count"]))
        lines.append("")
        lines.append("| 指标 | 值 |")
        lines.append("|---|---|")
        for key in ("min", "mean", "median", "p90", "p95", "p99", "max"):
            lines.append("| %s | %s |" % (key, full[key]))
        lines.append("| >512 | %.4f |" % full["over512"])
        lines.append("| >768 | %.4f |" % full["over768"])
        lines.append("| >1024 | %.4f |" % full["over1024"])
        lines.append("| >1536 | %.4f |" % full["over1536"])
        lines.append("")
    out_md = ROOT / "ml" / "reports" / "aetherargus-v02-token-length-analysis.md"
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("WROTE", out_json.name, "and", out_md.name)
    return 0


def message_token_length_prompt(tokenizer, prompt_messages: list[dict]) -> int:
    encoded = tokenizer.apply_chat_template(
        prompt_messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=True,
    )
    return int(encoded["input_ids"][0].shape[0])


if __name__ == "__main__":
    sys.exit(main())
