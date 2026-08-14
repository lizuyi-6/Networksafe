"""Targeted smoke: only the cells that failed 100% in the prior diverse smoke
(hard_negative, unknown_insufficient, contrastive_member/safe). Validates the v0.3.1 prompt fix.
"""
from __future__ import annotations
import asyncio
import os
import shutil
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ml.data_pipeline.v03.orchestrator import Orchestrator
from ml.data_pipeline.v03.spec_planner import SpecPlanner
from ml.data_pipeline.v03 import config
from ml.data_pipeline.v03.quotas import cells


def _load_env_local() -> None:
    env_file = Path(__file__).resolve().parent / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


async def main() -> int:
    _load_env_local()
    if not os.environ.get("ARK_API_KEY"):
        print("ERROR: ARK_API_KEY not set", file=sys.stderr); return 2

    # Targeted cells: hard_negative (safe/benign), unknown_insufficient (unknown/benign),
    # contrastive_member with verdict safe (across several families). Balance across types so
    # the planner's cell order (60k sqli first) doesn't crowd any one out.
    wanted_gts = {"hard_negative", "unknown_insufficient"}
    per_type = 6  # 6 hard_neg + 6 unknown + contrastive_safe up to 6 -> ~18 specs
    planner = SpecPlanner()
    picked: list = []
    seen_pairs: set[str] = set()
    counts: dict[str, int] = {}
    for spec in planner:
        gt = spec.generationType
        if gt in wanted_gts:
            if counts.get(gt, 0) < per_type:
                picked.append(spec)
                counts[gt] = counts.get(gt, 0) + 1
        elif gt == "contrastive_member" and spec.verdict == "safe" and spec.pairId:
            if spec.attackFamily not in seen_pairs and counts.get("contrastive_safe", 0) < per_type:
                seen_pairs.add(spec.attackFamily)
                picked.append(spec)
                counts["contrastive_safe"] = counts.get("contrastive_safe", 0) + 1
        if all(counts.get(k, 0) >= per_type for k in ("hard_negative", "unknown_insufficient", "contrastive_safe")):
            break
    print(f"TARGETED SMOKE: {len(picked)} specs  counts={counts}")

    out_dir = config.RELEASES_DIR / "smoke_targeted"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    orch = Orchestrator(out_dir=out_dir, max_inflight=4)
    stats = await orch.run(picked, progress_every=3)

    print("\n=== TARGETED SMOKE STATS ===")
    for k, v in stats.__dict__.items():
        print(f"  {k}: {v}")
    ok, _ = orch.audit.verify_chain()
    print(f"audit chain ok: {ok}")

    recs = orch.load_accepted()
    print(f"\naccepted: {len(recs)}/{len(picked)}")
    from collections import Counter
    gv = Counter()
    for r in recs:
        gv[(r["spec"]["generationType"], r["groundTruth"]["verdict"])] += 1
    print("accepted by (genType, verdict):")
    for (g, v), n in sorted(gv.items()):
        print(f"  {g} / {v}: {n}")
    # show one accepted per genType
    seen_gt: set[str] = set()
    print("\n--- accepted samples ---")
    for r in recs:
        g = r["spec"]["generationType"]
        if g in seen_gt:
            continue
        seen_gt.add(g)
        di = r["detectionInput"]
        print(f"[{g}] {r['sampleId']} verdict={r['groundTruth']['verdict']} family={r['groundTruth']['attackFamily']}")
        print(f"  req: {di.get('method')} {di.get('path')} q={str(di.get('query'))[:60]}")
        print(f"  body[:70]={str(di.get('body'))[:70]}")
        print(f"  bothAgree={r['review']['bothAgree']} reasoning={r['detectionOutput']['reasoning'][:90]}")
    # show rejection reasons (from audit file)
    print("\n--- rejection reasons (from audit) ---")
    import json
    rj = Counter()
    audit_path = out_dir / "audit.jsonl"
    if audit_path.exists():
        for line in audit_path.open(encoding="utf-8"):
            e = json.loads(line)
            if e.get("event") == "reject":
                rr = e.get("rejectionReason") or ",".join(x.split(":")[0] for x in e.get("reasons", []))
                rj[(e.get("stage"), rr)] += 1
    for (st, rr), n in rj.most_common():
        print(f"  [{st}] {rr}: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
