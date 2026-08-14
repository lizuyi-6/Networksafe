"""Live smoke test: process N specs end-to-end through the real Ark provider.

Usage:
    ARK_API_KEY must be set in the environment (mission §43: key from env, never a file).
    py -3 ml/data_pipeline/v03/run_smoke.py [N]   # default N=5

Validates the full chain: spec -> generate(+det-check) -> 2 blind reviews -> adjudicate
-> dedup -> accept/reject -> shard write -> audit chain. Prints stats + the first accepted
record + audit-chain verification + gate evaluation.
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
from pathlib import Path

# allow running as a script: add repo root to sys.path
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from ml.data_pipeline.v03.orchestrator import Orchestrator
from ml.data_pipeline.v03.spec_planner import SpecPlanner
from ml.data_pipeline.v03 import config


async def main() -> int:
    if not os.environ.get("ARK_API_KEY"):
        print("ERROR: ARK_API_KEY not set in environment (mission §43). Set it before running.", file=sys.stderr)
        return 2
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    specs = list(SpecPlanner())[:n]
    print(f"SMOKE: processing {len(specs)} specs with live Ark glm-5.2 provider")
    print(f"  first spec: {specs[0].sampleId} {specs[0].verdict}/{specs[0].attackFamily}/{specs[0].generationType}")

    out_dir = config.RELEASES_DIR / "smoke"
    # fresh smoke dir (clear previous smoke artifacts)
    import shutil
    if out_dir.exists():
        shutil.rmtree(out_dir)

    orch = Orchestrator(out_dir=out_dir, max_inflight=4)
    stats = await orch.run(specs, progress_every=1)

    print("\n=== SMOKE STATS ===")
    for k, v in stats.__dict__.items():
        print(f"  {k}: {v}")

    ok, viols = orch.audit.verify_chain()
    print(f"\naudit chain: entries={orch.audit.count()} ok={ok} violations={len(viols)}")
    if viols:
        for v in viols[:5]:
            print(f"  - {v}")

    recs = orch.load_accepted()
    print(f"\naccepted records: {len(recs)}")
    for r in recs[:2]:
        print(f"\n  --- {r['sampleId']} ---")
        print(f"  verdict={r['groundTruth']['verdict']} family={r['groundTruth']['attackFamily']} "
              f"action={r['groundTruth']['recommendedAction']} severity={r['groundTruth']['severity']}")
        print(f"  genType={r['spec']['generationType']} pairId={r['pairId'] or '-'}")
        print(f"  bothAgree={r['review']['bothAgree']} A={r['review']['reviewerAAgrees']} B={r['review']['reviewerBAgrees']}")
        di = r["detectionInput"]
        print(f"  req: {di.get('method')} {di.get('path')} q={str(di.get('query'))[:60]}")
        print(f"  body[:80]: {str(di.get('body'))[:80]}")
        print(f"  out reasoning: {r['detectionOutput']['reasoning'][:120]}")
        print(f"  adjudication: {r['provenance']['adjudicationDecision']} ({r['provenance']['adjudicationReason'][:60]})")
        # sanity: immutable labels in record match spec
        gt = r["groundTruth"]
        spec_gt = {f: r["spec"][f] for f in ("verdict", "attackFamily", "severity", "recommendedAction")}
        print(f"  immutable labels match spec: {gt == spec_gt}")

    rep = orch.evaluate_gates()
    print(f"\nquality gates all_pass (expected False for tiny N): {rep['all_pass']}")
    print(f"  total={rep['total']} verdict={rep['verdict']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
