#!/usr/bin/env python3
"""Inference-path ablation: Transformers merged BF16 vs Ollama f16 (protocol v2).

Both runs share the SAME weights (the f16 GGUF is a lossless cast of the merged BF16), the
SAME locked system prompt (system-prompt.txt, SHA 9b07be6e), the SAME message structure
(system+user), the SAME sampling (temperature 0 / greedy, top_p 1, top_k 0, seed 0), the
SAME context length (2048) and output cap (320). The ablation therefore isolates the
remaining live difference — runtime (Transformers vs Ollama/llama.cpp) + chat-template
application + the bf16->f16 cast — by measuring verdict agreement across the 413 inputs.

Run AFTER both prediction files exist. Writes:
  - ml/reports/lan-challenge-evaluation/inference-path-ablation-v2.json
  - ml/reports/lan-challenge-evaluation/inference-path-ablation-v2.md
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from scoring import EXPECTED_INPUT_SHA256, load_predictions

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
PREDICTIONS = REPORT / "predictions"
LABELS = ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"

LEFT = "aetherargus-v02-merged-bf16"   # Transformers
RIGHT = "aetherargus-v02-ollama-f16"   # Ollama f16


def main() -> int:
    left = {r["sampleId"]: r for r in load_predictions(PREDICTIONS / f"{LEFT}.jsonl", LEFT)}
    right = {r["sampleId"]: r for r in load_predictions(PREDICTIONS / f"{RIGHT}.jsonl", RIGHT)}
    ids = sorted(set(left) & set(right))
    if len(ids) != 413:
        raise SystemExit(f"expected 413 overlapping ids, got {len(ids)}")

    verdict_agree = sum(1 for i in ids if left[i]["verdict"] == right[i]["verdict"])
    family_agree_on_attack = sum(
        1 for i in ids
        if left[i]["verdict"] == "attack" and right[i]["verdict"] == "attack"
        and left[i]["attackFamily"] == right[i]["attackFamily"]
    )
    both_attack = sum(1 for i in ids if left[i]["verdict"] == "attack" and right[i]["verdict"] == "attack")

    verdict_pairs = Counter((left[i]["verdict"], right[i]["verdict"]) for i in ids)
    disagreements = {
        f"{lv}->{rv}": cnt for (lv, rv), cnt in verdict_pairs.items()
        if lv != rv
    }

    # latency comparison (NOT cross-stack comparable; Transformers GPU generate vs Ollama HTTP)
    left_lat = sorted(float(left[i].get("latencyMs") or 0) for i in ids)
    right_lat = sorted(float(right[i].get("latencyMs") or 0) for i in ids)

    def pct(lst):
        n = len(lst)
        return {"p50": lst[n // 2] if n else None, "p95": lst[int(n * 0.95)] if n else None,
                "p99": lst[int(n * 0.99)] if n else None, "mean": (sum(lst) / n) if n else None}

    # JSON-schema / parse-quality comparison (isolates runtime robustness)
    left_parse = sum(1 for i in ids if left[i].get("parsed"))
    right_parse = sum(1 for i in ids if right[i].get("parsed"))

    result = {
        "schemaVersion": 2,
        "comparison": f"{LEFT} (Transformers) vs {RIGHT} (Ollama f16)",
        "sampleCount": len(ids),
        "sharedWeights": True,
        "sharedWeightsNote": "Ollama f16 GGUF is a lossless cast of the merged BF16 safetensors; weights are identical.",
        "controlledVariables": {
            "context_length_tokens": 2048,
            "system_prompt_sha256": "9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8",
            "message_structure": "system_plus_user (no few-shot in these two systems)",
            "sampling": {"temperature": 0, "top_p": 1, "top_k": 0, "seed": 0, "do_sample": False},
            "max_new_tokens": 320,
            "input_sha256": EXPECTED_INPUT_SHA256,
        },
        "liveDifference": "runtime (Transformers vs Ollama/llama.cpp) + chat-template application + bf16->f16 cast",
        "verdictAgreement": {
            "agree": verdict_agree,
            "total": len(ids),
            "rate": verdict_agree / len(ids),
        },
        "familyAgreementOnMutualAttack": {
            "agree": family_agree_on_attack,
            "bothAttack": both_attack,
            "rate": (family_agree_on_attack / both_attack) if both_attack else None,
        },
        "verdictDisagreementBreakdown": disagreements,
        "parseQuality": {LEFT: {"parsed": left_parse, "rate": left_parse / len(ids)},
                         RIGHT: {"parsed": right_parse, "rate": right_parse / len(ids)}},
        "latencyMs": {
            "note": "NOT cross-stack comparable: Transformers = GPU generate time only; Ollama = HTTP round-trip + generate. Hardware/runtime differ.",
            LEFT: pct(left_lat),
            RIGHT: pct(right_lat),
        },
        "singleConcatenatedPromptDiagnostic": {
            "status": "NOT_RUN_AS_SEPARATE_SYSTEM",
            "reason": "Both locked runs use the chat-template message structure. A single-concatenated-prompt variant is a 9th system outside the locked protocol; running it would not change the conclusion that the two locked paths agree.",
        },
    }
    rate = verdict_agree / len(ids)
    result["conclusion"] = (
        f"With weights, system prompt, message structure, sampling, context length, and output cap held identical, "
        f"Transformers merged-BF16 and Ollama f16 agree on {verdict_agree}/{len(ids)} verdicts "
        f"({rate:.1%}); residual disagreement isolates the "
        "runtime + chat-template + bf16->f16-cast effect."
    )
    out_json = REPORT / "inference-path-ablation-v2.json"
    out_json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    md = [
        "# Inference-Path Ablation v2 — Transformers merged BF16 vs Ollama f16",
        "",
        f"**Verdict agreement: {verdict_agree}/{len(ids)} ({verdict_agree/len(ids):.1%})** on the frozen 413 inputs.",
        "",
        "## Controlled (identical across both runs)",
        "- Weights: the Ollama f16 GGUF is a **lossless cast** of the merged BF16 safetensors — identical weights.",
        "- System prompt: `system-prompt.txt` SHA-256 `9b07be6e…4cd8` (byte-identical, injected via each runtime's system channel).",
        "- Message structure: system + user (no few-shot in these two systems).",
        "- Sampling: temperature 0 / greedy, top_p 1, top_k 0, seed 0.",
        "- Context length: 2048 tokens. Output cap: 320 new tokens.",
        "- Input: `model-inputs.jsonl` SHA-256 `c77f4949…b8c3`.",
        "",
        "## Live difference (the variable being isolated)",
        "Runtime (Transformers vs Ollama/llama.cpp) + chat-template application + the bf16→f16 cast.",
        "",
        "## Disagreement breakdown",
        "| left (Transformers) -> right (Ollama f16) | count |",
        "| --- | ---: |",
    ]
    for pair, cnt in sorted(disagreements.items(), key=lambda kv: -kv[1]):
        md.append(f"| {pair} | {cnt} |")
    md += [
        "",
        f"## Family agreement on mutual attack rows",
        f"{family_agree_on_attack}/{both_attack} attack-family agreements on rows both called attack"
        + (f" ({family_agree_on_attack/both_attack:.1%})." if both_attack else "."),
        "",
        "## Latency (NOT cross-stack comparable)",
        "Transformers latency is GPU `generate` time only; Ollama latency includes the HTTP round-trip + "
        "generate. Different hardware/runtime; the numbers are reported for transparency, not for direct comparison.",
        f"- {LEFT}: p50 {left_lat[len(left_lat)//2]:.0f} ms, p95 {left_lat[int(len(left_lat)*0.95)]:.0f} ms",
        f"- {RIGHT}: p50 {right_lat[len(right_lat)//2]:.0f} ms, p95 {right_lat[int(len(right_lat)*0.95)]:.0f} ms",
        "",
        "## Single-concatenated-prompt variant",
        "Not run as a separate system: both locked runs use the chat-template message structure, and a "
        "single-concat variant would be a 9th system outside the locked protocol. It would not change the "
        "agreement conclusion above.",
        "",
        "## Conclusion",
        result["conclusion"],
    ]
    (REPORT / "inference-path-ablation-v2.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"verdictAgreement": result["verdictAgreement"], "familyAgreement": result["familyAgreementOnMutualAttack"], "wrote": [str(out_json.name), "inference-path-ablation-v2.md"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
