"""Phase 3 dummy dry-run over the real frozen release (master brief §45 + §35).

- Renders every episode of every split in both views (m1 / m2) through
  RENDERER-V1 and runs the §35 leakage audit on the real data (blocker == 0).
- Runs the five dummy predictors through the full pipeline (predictions file ->
  metrics -> world-cluster bootstrap) on iid-dev.
- Emits DRY-RUN-REPORT.json; exit 2 on any blocker or pipeline failure.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

from . import metrics as M
from .bootstrap import bootstrap_ci
from .contract import FINAL_EVAL_SPLITS, IID_DEV, TRAIN
from .dummy_models import AlwaysAttack, AlwaysInsufficient, AlwaysSafe, OracleEcho, RandomVerdict
from .loader import load_release, make_samples
from .renderer import audit_prompt_leakage


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bootstrap-n", type=int, default=2000)
    args = ap.parse_args()

    t0 = time.time()
    report: dict = {"dry_run": True, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    # ---- §35 leakage audit over ALL splits, both views, real data ----
    # render-audit mode: generator-ood is audited for renderer leakage but is
    # NEVER model-evaluated in this master run (brief §23/§64).
    leakage = {}
    for split in (TRAIN, IID_DEV) + FINAL_EVAL_SPLITS:
        episodes = load_release(args.release_dir, (split,), mode="render_audit")
        worst = []
        for method in ("m1-ordinary-sft", "m2-stateful-sft"):
            hits_total = 0
            offenders = []
            for ep in episodes:
                from .renderer import build_prompt
                hits = audit_prompt_leakage(build_prompt(method, ep))
                if hits:
                    hits_total += 1
                    if len(offenders) < 3:
                        offenders.append({"episode_id": ep["episode_id"], "hits": hits[:5]})
            leakage[f"{split}:{method}"] = {
                "n": len(episodes), "prompts_with_blockers": hits_total,
                "blocker": hits_total == 0, "offenders": offenders,
            }
            print(f"[leakage] {split}:{method} n={len(episodes)} blockers={hits_total}", flush=True)
    report["leakage_audit"] = leakage
    all_clean = all(v["blocker"] for v in leakage.values())

    # ---- §45 dummy pipeline on iid-dev ----
    episodes = load_release(args.release_dir, (IID_DEV,))
    samples_m2 = make_samples(episodes, "m2-stateful-sft")
    dummy_results = {}
    for cls in (AlwaysSafe, AlwaysAttack, AlwaysInsufficient, RandomVerdict, OracleEcho):
        dummy = cls(seed=20260921) if cls is RandomVerdict else cls()
        preds = dummy.predict_batch(samples_m2)
        m = M.compute_metrics(samples_m2, preds)
        ci = bootstrap_ci(samples_m2, preds, lambda mm: mm["accuracy"],
                          cluster_key="world_id", n_resamples=args.bootstrap_n,
                          seed=20260921)
        dummy_results[dummy.name] = {
            "accuracy": m["accuracy"],
            "P1": m["P1_observable_decision_macro_f1"],
            "P4": m["P4_evidence_sufficiency_accuracy"],
            "attack_recall": m["attack_recall"]["value"],
            "safe_fpr": m["safe_fpr"]["value"],
            "bootstrap_accuracy_ci95": [ci.get("ci95_low"), ci.get("ci95_high")],
        }
        print(f"[dummy] {dummy.name}: acc={m['accuracy']} P1={m['P1_observable_decision_macro_f1']}", flush=True)
    report["dummy_pipeline_iid_dev"] = {
        "n_samples": len(samples_m2), "n_worlds": len({s.world_id for s in samples_m2}),
        "results": dummy_results,
    }
    echo = dummy_results[OracleEcho.name]
    report["oracle_echo_sanity"] = {
        "P1": echo["P1"], "pass": echo["P1"] == 1.0,
        "note": "Oracle Echo must score P1=1.0; pipeline-only, never a baseline",
    }

    report["all_pass"] = bool(all_clean and report["oracle_echo_sanity"]["pass"])
    report["seconds"] = round(time.time() - t0, 1)
    report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print("DRY_RUN_ALL_PASS=" + ("YES" if report["all_pass"] else "NO"), flush=True)
    print("report -> " + args.out, flush=True)
    return 0 if report["all_pass"] else 2


if __name__ == "__main__":
    sys.exit(main())
