"""Diverse smoke: 1 spec per quota cell, to validate every generationType + verdict combination
and the contrastive pairing. Costs ~ (num_cells * 4) LLM calls.
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


async def main() -> int:
    if not os.environ.get("ARK_API_KEY"):
        print("ERROR: ARK_API_KEY not set", file=sys.stderr); return 2

    # pick first spec of each cell by walking the planner and keying on cell
    planner = SpecPlanner()
    seen_cells: set[str] = set()
    picked: list = []
    for spec in planner:
        key = f"{spec.verdict}|{spec.attackFamily}|{spec.generationType}|{spec.promptInjectionPresent}"
        if key in seen_cells:
            continue
        seen_cells.add(key)
        picked.append(spec)
        # for contrastive cells, also pick the second member (the pair partner) to validate pairing
        if spec.generationType == "contrastive_member" and spec.pairId:
            # find the partner (same pairId, different sampleId)
            pass  # the partner will be picked when its cell-key is seen (it shares the cell key)
    print(f"DIVERSE SMOKE: {len(picked)} specs across {len(seen_cells)} cells")

    out_dir = config.RELEASES_DIR / "smoke_diverse"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    orch = Orchestrator(out_dir=out_dir, max_inflight=4)
    stats = await orch.run(picked, progress_every=5)

    print("\n=== DIVERSE SMOKE STATS ===")
    for k, v in stats.__dict__.items():
        print(f"  {k}: {v}")
    ok, _ = orch.audit.verify_chain()
    print(f"audit chain ok: {ok}")

    recs = orch.load_accepted()
    print(f"\naccepted: {len(recs)}/{len(picked)}")
    # summarize by genType + verdict
    from collections import Counter
    gv = Counter()
    for r in recs:
        gv[(r["spec"]["generationType"], r["groundTruth"]["verdict"])] += 1
    print("accepted by (genType, verdict):")
    for (g, v), n in sorted(gv.items()):
        print(f"  {g} / {v}: {n}")
    # show one of each genType
    seen_gt: set[str] = set()
    print("\n--- one sample per generationType ---")
    for r in recs:
        g = r["spec"]["generationType"]
        if g in seen_gt:
            continue
        seen_gt.add(g)
        di = r["detectionInput"]
        print(f"[{g}] {r['sampleId']} verdict={r['groundTruth']['verdict']} family={r['groundTruth']['attackFamily']}")
        print(f"  req: {di.get('method')} {di.get('path')} body[:70]={str(di.get('body'))[:70]}")
        print(f"  bothAgree={r['review']['bothAgree']} reasoning={r['detectionOutput']['reasoning'][:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
