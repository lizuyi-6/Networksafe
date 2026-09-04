"""Scale test: run the DeficitScheduler with a small target_scale to validate quota-filling
across ALL cell types AND measure throughput at production concurrency.

Usage: py -3 run_scale_test.py [target_scale] [max_inflight]
  target_scale default 0.02 (-> ~6000 target specs, enough to fill most cells >=1)
  max_inflight default 16
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


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


# MUST load .env.local BEFORE importing config: config.py reads ARK_GENERATOR_CONCURRENCY etc.
# at module-import time. Same single-source-of-truth contract as run_full.py.
_load_env_local()

from ml.data_pipeline.v03.orchestrator import Orchestrator
from ml.data_pipeline.v03.spec_planner import SpecPlanner
from ml.data_pipeline.v03.scheduler import DeficitScheduler
from ml.data_pipeline.v03 import config


async def main() -> int:
    _load_env_local()
    if not (os.environ.get("ARK_API_KEY") or os.environ.get("STEPFUN_API_KEY")):
        print("ERROR: ARK_API_KEY/STEPFUN_API_KEY not set", file=sys.stderr); return 2
    scale = float(sys.argv[1]) if len(sys.argv) > 1 else 0.02
    max_inflight = int(sys.argv[2]) if len(sys.argv) > 2 else 16

    out_dir = config.RELEASES_DIR / "scale_test"
    if out_dir.exists():
        import shutil; shutil.rmtree(out_dir)
    orch = Orchestrator(out_dir=out_dir, max_inflight=max_inflight)
    sch = DeficitScheduler(orch, SpecPlanner(), max_waves=6, oversample=2.0,
                           target_scale=scale, progress_every=50)
    total_target = sum(sch.targets.values())
    print(f"SCALE TEST: target_scale={scale} -> total_target={total_target}  "
          f"max_inflight={max_inflight}  gen_conc={config.GENERATOR_CONCURRENCY}  "
          f"rev_conc={config.REVIEWER_CONCURRENCY}  adj_conc={config.ADJUDICATOR_CONCURRENCY}")

    t0 = time.time()
    report = await sch.run()
    elapsed = time.time() - t0
    stats = report.final_stats

    print(f"\n=== SCALE TEST REPORT ({elapsed:.1f}s) ===")
    for k, v in stats.__dict__.items():
        print(f"  {k}: {v}")
    print(f"  waves_run: {report.waves_run}")
    print(f"  total_specs_generated: {report.total_specs_generated}")
    acc = stats.accepted
    rate = acc / elapsed if elapsed > 0 else 0
    print(f"  accept_rate: {acc}/{stats.processed} = {acc/stats.processed*100:.1f}%" if stats.processed else "  accept_rate: n/a")
    print(f"  throughput: {rate:.3f} accepted/s  ({rate*3600:.0f}/hr)")
    # extrapolate to 300k
    if rate > 0:
        eta_300k = 300_000 / rate
        print(f"  ETA to 300k accepted at this rate: {eta_300k/3600:.1f} hr ({eta_300k/86400:.1f} days)")
    ok, _ = orch.audit.verify_chain()
    print(f"  audit_chain_ok: {ok}")

    # deficit remaining
    rem = report.remaining_deficit
    total_rem = sum(rem.values())
    print(f"  remaining_deficit: {total_rem}/{total_target}")
    if rem:
        print("  top deficit cells:")
        for k, n in sorted(rem.items(), key=lambda x: -x[1])[:8]:
            print(f"    {k}: {n}")

    # gate eval
    recs = orch.load_accepted()
    gates = orch.evaluate_gates()
    print(f"\n  accepted records: {len(recs)}")
    print("  gate summary (partial - small scale):")
    for gname, gval in gates.items():
        if isinstance(gval, dict):
            print(f"    {gname}: {gval}")
        else:
            print(f"    {gname}: {gval}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
