"""Token profile + context audit for Phase 3 (master brief §30-§33).

Runs on the node (CPU-only) with the frozen Qwen3.8-27B tokenizer while the GPU
is busy with the sealed evaluation. For every split x view (m1/m2):
  - input / target / total token stats P50 P75 P90 P95 P99 MAX (§30)
  - for each candidate ctx in 512/1024/2048/4096 (§31):
      truncation rate, completion truncation, zero-supervision count (§32),
      critical evidence loss (§33)
Also records the M3 counterfactual group algebra (group counts, mixed-base
groups under the frozen decision-flip caliber) for the protocol freeze.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time

MODEL_PATH = "/data/models/Qwen3.8-27B"

CANDIDATE_CTX = (512, 1024, 2048, 4096)
SPLITS = ("train", "iid-dev", "world-ood", "mechanism-ood", "generator-ood")
METHODS = ("m1-ordinary-sft", "m2-stateful-sft")


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(round((p / 100.0) * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def main() -> int:
    import sys
    sys.path.insert(0, "/data/projects/phase3pkg")

    from experiments.phase3.loader import _iter_split, build_group_index, make_samples, split_mixed_groups
    from experiments.phase3.renderer import build_prompt, target_text, target_for
    from transformers import AutoTokenizer

    ap = argparse.ArgumentParser()
    ap.add_argument("--release-dir", default="/data/datasets/asw-v0.1")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(MODEL_PATH)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    report = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "profiles": {}}

    for split in SPLITS:
        for method in METHODS:
            input_lens, target_lens, total_lens = [], [], []
            zs = {ctx: 0 for ctx in CANDIDATE_CTX}
            trunc = {ctx: 0 for ctx in CANDIDATE_CTX}
            completion_trunc = {ctx: 0 for ctx in CANDIDATE_CTX}
            crit_loss = {ctx: 0 for ctx in CANDIDATE_CTX}
            crit_den = {ctx: 0 for ctx in CANDIDATE_CTX}
            n = 0
            t0 = time.time()
            for ep in _iter_split(args.release_dir, split):
                sample = make_samples([ep], method)[0]
                # token accounting on system+user+assistant shape used in training
                prompt_ids = tok(sample.chat_prompt, add_special_tokens=False)["input_ids"]
                target_ids = tok(sample.target_text, add_special_tokens=False)["input_ids"]
                # template overhead (chat markers) measured once per sample cheaply:
                total = len(prompt_ids) + len(target_ids) + 8  # +8 chat marker allowance
                input_lens.append(len(prompt_ids))
                target_lens.append(len(target_ids))
                total_lens.append(total)
                n += 1
                evidence_ids = [
                    e.get("evidence_id") for e in ep["observation"]["model_visible"].get("evidence", [])
                ]
                sufficient = ep["observation"]["decision_metadata"].get(
                    "evidence_availability_level", "") in ("complete", "minimally_sufficient")
                decided = ep["oracle_output"]["observable_decision"] != "insufficient_evidence"
                for ctx in CANDIDATE_CTX:
                    kept = total if total <= ctx else ctx
                    if total > ctx:
                        trunc[ctx] += 1
                        # right-truncation hits the target suffix first; a fully
                        # consumed target is a zero-supervision sample (§32 hard fail)
                        if kept <= len(prompt_ids):
                            zs[ctx] += 1
                        else:
                            completion_trunc[ctx] += 1
                    if sufficient and decided and len(evidence_ids):
                        crit_den[ctx] += 1
                        # EVIDENCE section is rendered last: right-truncation
                        # kills it first. The last evidence id must survive the
                        # kept token budget (character-budget approximation with
                        # a +200 char margin against tokenization drift).
                        last_ev_marker = f"id={evidence_ids[-1]}"
                        input_kept = min(len(prompt_ids), max(0, kept - len(target_ids)))
                        kept_chars = len(sample.chat_prompt) * input_kept // max(1, len(prompt_ids))
                        if last_ev_marker not in sample.chat_prompt[:kept_chars + 200]:
                            crit_loss[ctx] += 1
                if n % 5000 == 0:
                    print(f"[profile] {split}:{method} n={n} elapsed={time.time()-t0:.0f}s", flush=True)

            sv = sorted(input_lens)
            st = sorted(target_lens)
            sx = sorted(total_lens)
            profile = {
                "n": n,
                "input_tokens": {p: pct(sv, p) for p in (50, 75, 90, 95, 99)},
                "input_max": sv[-1] if sv else None,
                "target_tokens": {p: pct(st, p) for p in (50, 75, 90, 95, 99)},
                "target_max": st[-1] if st else None,
                "total_tokens": {p: pct(sx, p) for p in (50, 75, 90, 95, 99)},
                "total_max": sx[-1] if sx else None,
                "context_audit": {
                    str(ctx): {
                        "truncation_rate": round(trunc[ctx] / n, 4) if n else None,
                        "zero_supervision": zs[ctx],
                        "critical_evidence_loss": crit_loss[ctx],
                        "critical_evidence_denominator": crit_den[ctx],
                    }
                    for ctx in CANDIDATE_CTX
                },
            }
            report["profiles"][f"{split}:{method}"] = profile
            print(f"[done] {split}:{method} n={n} total_p99={profile['total_tokens'][99]}", flush=True)

    # ---- M3 group algebra on train ----
    eps = list(_iter_split(args.release_dir, "train"))
    index = build_group_index(eps)
    mixed = split_mixed_groups(index)
    delta_hist = {}
    dec_flip = 0
    for key, g in index.items():
        base_v = set()
        base_dec = None
        for ep in g.episodes:
            if ep["variant_type"] == "base":
                base_v |= set(ep["oracle_output"].get("violated_invariants") or [])
                base_dec = ep["oracle_output"]["observable_decision"]
        for ep in g.episodes:
            if ep["variant_type"] == "critical_intervention":
                v = set(ep["oracle_output"].get("violated_invariants") or [])
                d = len(v ^ base_v)
                delta_hist[d] = delta_hist.get(d, 0) + 1
                if ep["oracle_output"]["observable_decision"] != base_dec:
                    dec_flip += 1
    report["m3_group_algebra"] = {
        "split": "train",
        "groups": len(index),
        "mixed_base_groups_violated_delta_caliber": len(mixed),
        "critical_symmetric_delta_histogram": delta_hist,
        "critical_decision_flips": dec_flip,
        "note": "mixed-base = a group with any critical episode whose violated_invariants symmetric-difference vs base != 1; excluded from L_flip. The release audit's 11 mixed-base axes are world-level narrative with no episode-group counterpart.",
    }
    print(f"[m3] train groups={len(index)} mixed={len(mixed)}", flush=True)

    report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print("CONTEXT_AUDIT_DONE -> " + args.out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
