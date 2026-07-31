#!/usr/bin/env python3
"""Deterministically select few-shot examples for the v2 few-shot system.

Sources: ONLY ``ml/data/releases/v02/train.jsonl`` and ``validation.jsonl``. The challenge
set and challenge labels are never opened (the user-token headroom is a fixed conservative
constant, NOT measured from the challenge set). Selection is fully deterministic
(hash-based ordering + token-budget greedy, no RNG, no Date) so the frozen manifest is
reproducible with a fixed tokenizer.

Why a token budget: protocol v1/v2 lock ``maxContextTokens = 2048`` and ``run_transformers``
keeps the LAST 2048 tokens, so a few-shot prompt that overflows would silently drop the
system prompt. To honor the 2048 lock with NO deviation, the selected examples are sized so
that ``system_prompt + few_shot_examples + worst_case_user`` fits in 2048 for every input.

Coverage target: safe + unknown + >=3 attack families. Train ``metadata.verdict`` is
{malicious, safe, unknown}; we map malicious->attack, safe->safe, unknown->unknown so the
few-shot assistant responses teach the CHALLENGE 3-class schema. Only families in the
challenge enum are eligible for attack examples.

Outputs:
  - few-shot-examples-v2.json   (frozen manifest + examples)
  - few-shot-selection-report.json (rule, strata counts, token budget, SHA, coverage)
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from transformers import AutoTokenizer

SELECTION_SEED = 20260731
REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCES = [
    REPO_ROOT / "ml" / "data" / "releases" / "v02" / "train.jsonl",
    REPO_ROOT / "ml" / "data" / "releases" / "v02" / "validation.jsonl",
]
OUT_DIR = Path(__file__).resolve().parent
EXAMPLES_OUT = OUT_DIR / "few-shot-examples-v2.json"
REPORT_OUT = OUT_DIR / "few-shot-selection-report.json"
TOKENIZER_REF = REPO_ROOT / "ml" / "output" / "aetherargus-v02-lora"  # frozen tokenizer/config

# Budget. The locked context is 2048 and run_transformers keeps the LAST 2048 tokens, so a
# few-shot prompt that overflows would silently drop the system prompt. We size examples by
# their MEASURED marginal full-prompt cost (via apply_chat_template, includes per-message
# chat-template wrappers) so the full few-shot prompt fits 2048 for every input. The user
# allowance is a fixed conservative constant (NOT read from the challenge set): the worst
# challenge user content is 186 tokens; with its chat-template wrapper the full contribution
# is <195, so 200 is a safe ceiling.
SYSTEM_PROMET = (OUT_DIR / "system-prompt.txt").read_text(encoding="utf-8")
MAX_CONTEXT_TOKENS = 2048
SAFETY_CAP_TOKENS = 2000  # leave margin under the 2048 hard lock
USER_ALLOWANCE_TOKENS = 200  # fixed; covers worst-case user content + wrapper; NOT from challenge

CHALLENGE_FAMILIES = {
    "authorization", "idor_bola", "sqli", "xss", "command_injection", "path_traversal",
    "ssrf", "business_logic", "file_upload", "csrf", "cors", "prompt_injection",
    "authentication", "protocol_attack",
}
VERDICT_MAP = {"malicious": "attack", "safe": "safe", "unknown": "unknown"}


def order_key(sample_id: str) -> str:
    return hashlib.sha256(f"{SELECTION_SEED}:{sample_id}".encode("utf-8")).hexdigest()


def user_message_of(row: dict[str, Any]) -> str:
    for msg in row.get("messages", []):
        if msg.get("role") == "user":
            return msg.get("content", "")
    return ""


def synthesize_assistant(verdict: str, family: str) -> str:
    if verdict == "attack":
        action, confidence = "block", 5
    elif verdict == "unknown":
        action, confidence = "challenge", 2
    else:
        action, confidence = "allow", 4
    return json.dumps(
        {"verdict": verdict, "attackFamily": family if verdict == "attack" else "none",
         "recommendedAction": action, "contextSufficient": True, "confidence": confidence},
        ensure_ascii=False, separators=(",", ":"),
    )


def main() -> int:
    tokenizer = AutoTokenizer.from_pretrained(str(TOKENIZER_REF), trust_remote_code=False)

    def tok_len(text: str) -> int:
        return len(tokenizer(text, add_special_tokens=False)["input_ids"])

    def full_prompt_len(extra_messages: list[dict[str, str]], add_gen: bool) -> int:
        msgs = [{"role": "system", "content": SYSTEM_PROMET}] + extra_messages
        enc = tokenizer.apply_chat_template(msgs, tokenize=True, add_generation_prompt=add_gen, return_dict=True)
        return len(enc["input_ids"])

    system_base = full_prompt_len([], add_gen=True)
    # Marginal full-prompt cost of one (user, assistant) example turn pair (content + wrappers).
    def example_full_cost(candidate: dict[str, Any]) -> int:
        assistant = synthesize_assistant(candidate["verdict"], candidate["attackFamily"])
        return full_prompt_len(
            [{"role": "user", "content": candidate["userMessage"]}, {"role": "assistant", "content": assistant}],
            add_gen=False,
        ) - system_base

    strata: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for source in SOURCES:
        with source.open("r", encoding="utf-8") as stream:
            for line in stream:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                md = row.get("metadata", {})
                raw_verdict = md.get("verdict")
                if raw_verdict not in VERDICT_MAP:
                    continue
                verdict = VERDICT_MAP[raw_verdict]
                family = md.get("attackFamily", "other")
                sample_id = row.get("sampleId")
                user_msg = user_message_of(row)
                if not sample_id or not user_msg:
                    continue
                src = str(source.relative_to(REPO_ROOT)).replace("\\", "/")
                if verdict == "attack":
                    if family not in CHALLENGE_FAMILIES:
                        continue
                    strata[f"attack:{family}"].append({"sampleId": sample_id, "source": src, "verdict": verdict, "attackFamily": family, "userMessage": user_msg})
                elif verdict == "safe":
                    strata["safe"].append({"sampleId": sample_id, "source": src, "verdict": verdict, "attackFamily": "none", "userMessage": user_msg})
                else:
                    strata["unknown"].append({"sampleId": sample_id, "source": src, "verdict": verdict, "attackFamily": "none", "userMessage": user_msg})

    # Attach marginal full-prompt cost; deterministic order = cheapest first, then order_key.
    for stratum_name, candidates in strata.items():
        for candidate in candidates:
            candidate["tokenCost"] = example_full_cost(candidate)
        candidates.sort(key=lambda r: (r["tokenCost"], order_key(r["sampleId"])))

    def budget_left() -> int:
        return SAFETY_CAP_TOKENS - system_base - USER_ALLOWANCE_TOKENS - sum(c["tokenCost"] for c in selected)

    selection_log: dict[str, Any] = {"strataAvailableCounts": {k: len(v) for k, v in sorted(strata.items())}, "steps": [], "systemBaseTokens": system_base}
    selected: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    def take(stratum_name: str, require: bool) -> dict[str, Any] | None:
        for candidate in strata.get(stratum_name, []):
            if candidate["sampleId"] in used_ids:
                continue
            if candidate["tokenCost"] > budget_left():
                continue  # never exceed the fit budget
            selected.append(candidate)
            used_ids.add(candidate["sampleId"])
            selection_log["steps"].append({"stratum": stratum_name, "sampleId": candidate["sampleId"], "tokenCost": candidate["tokenCost"]})
            return candidate
        if require:
            raise RuntimeError(f"required stratum empty or over budget: {stratum_name}")
        return None

    # Phase 1 (coverage guarantees): 1 unknown, 1 safe, and 1 attack from EACH available family,
    # each only taken if it still fits the budget.
    take("unknown", require=True)
    take("safe", require=True)
    attack_strata = sorted(k for k in strata if k.startswith("attack:"))
    for stratum_name in attack_strata:
        take(stratum_name, require=False)

    # Phase 2 (budgeted fill): greedily add the globally-cheapest unused candidate while it fits,
    # preferring candidates that add a NEW attack family first.
    while True:
        if budget_left() <= 0:
            break
        pool = [c for s in strata.values() for c in s if c["sampleId"] not in used_ids]
        new_family = [c for c in pool if c["verdict"] == "attack" and c["attackFamily"] not in {x["attackFamily"] for x in selected if x["verdict"] == "attack"}]
        new_family.sort(key=lambda c: (c["tokenCost"], order_key(c["sampleId"])))
        added = False
        for candidate in new_family:
            if candidate["tokenCost"] <= budget_left():
                selected.append(candidate); used_ids.add(candidate["sampleId"])
                selection_log["steps"].append({"stratum": "fill:new-family", "sampleId": candidate["sampleId"], "tokenCost": candidate["tokenCost"]})
                added = True; break
        if added:
            continue
        pool.sort(key=lambda c: (c["tokenCost"], order_key(c["sampleId"])))
        for candidate in pool:
            if candidate["tokenCost"] <= budget_left():
                selected.append(candidate); used_ids.add(candidate["sampleId"])
                selection_log["steps"].append({"stratum": "fill:cheapest", "sampleId": candidate["sampleId"], "tokenCost": candidate["tokenCost"]})
                added = True; break
        if not added:
            break

    # Enforce invariants.
    attack_families = {c["attackFamily"] for c in selected if c["verdict"] == "attack"}
    if len(selected) < 6 or len(selected) > 12 or len(attack_families) < 3:
        raise RuntimeError(f"selection failed invariants: count={len(selected)} families={len(attack_families)} budget_left={budget_left()}")
    if not any(c["verdict"] == "safe" for c in selected) or not any(c["verdict"] == "unknown" for c in selected):
        raise RuntimeError("selection missing safe/unknown coverage")

    selected.sort(key=lambda r: (r["verdict"], r["attackFamily"], order_key(r["sampleId"])))
    examples = [{
        "sampleId": c["sampleId"], "sourceSplit": c["source"], "verdict": c["verdict"],
        "attackFamily": c["attackFamily"], "userMessage": c["userMessage"],
        "assistantResponse": synthesize_assistant(c["verdict"], c["attackFamily"]),
        "tokenCost": c["tokenCost"],
    } for c in selected]
    total_cost = sum(e["tokenCost"] for e in examples)

    payload = json.dumps(examples, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    examples_sha = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    manifest = {
        "schemaVersion": 2, "status": "AVAILABLE",
        "sourceSplits": [str(s.relative_to(REPO_ROOT)).replace("\\", "/") for s in SOURCES],
        "selectionSeed": SELECTION_SEED,
        "selectionRule": (
            f"train+val only; verdict malicious->attack/safe->safe/unknown->unknown; attack restricted "
            f"to challenge-enum families; deterministic order sha256(seed:sampleId) + measured-marginal-"
            f"full-prompt-cost greedy; sized so system+examples+worst-user <= {SAFETY_CAP_TOKENS} (lock 2048)."
        ),
        "challengeSetUsed": False, "challengeLabelsUsed": False,
        "maxContextTokens": MAX_CONTEXT_TOKENS,
        "tokenBudget": {"systemBaseTokens": system_base, "userAllowanceTokens": USER_ALLOWANCE_TOKENS, "safetyCapTokens": SAFETY_CAP_TOKENS, "examplesUsedTokens": total_cost},
        "sampleIds": [e["sampleId"] for e in examples],
        "examplesSha256": examples_sha,
        "examples": examples,
    }
    EXAMPLES_OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {
        "schemaVersion": 1, "selectionSeed": SELECTION_SEED,
        "sourcesScanned": manifest["sourceSplits"],
        "candidateCountsByStratum": selection_log["strataAvailableCounts"],
        "selectedCount": len(examples), "selectedSampleIds": manifest["sampleIds"],
        "examplesUsedTokens": total_cost,
        "tokenBudget": manifest["tokenBudget"],
        "coverage": {
            "safe": sum(1 for e in examples if e["verdict"] == "safe"),
            "attack": sum(1 for e in examples if e["verdict"] == "attack"),
            "unknown": sum(1 for e in examples if e["verdict"] == "unknown"),
            "attackFamiliesCovered": sorted(attack_families),
            "attackFamiliesCoveredCount": len(attack_families),
        },
        "examplesSha256": examples_sha,
        "challengeSetOpened": False,
        "determinism": "hash-based sha256(seed:sampleId) + measured-marginal-full-prompt-cost greedy; no RNG/Date; reproducible with fixed tokenizer",
    }
    REPORT_OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"examples": len(examples), "examplesSha256": examples_sha, "tokensUsed": total_cost, "coverage": report["coverage"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
