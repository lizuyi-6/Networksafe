"""v0.3 full dataset generation run. Drives the DeficitScheduler to fill every quota cell to
its target accepted count. Resumable: re-running picks up from the audit log.

Usage: py -3 run_full.py [max_inflight] [oversample] [target_scale]
  max_inflight default 32
  oversample default 1.6  (observed accept rate ~69%; 1.6x covers det+adjudicator rejects)
  target_scale default 1.0 (full 300k target)

Output: ml/data/releases/v03/ (canonical v03 release dir; audit.jsonl + accepted/shard-*.jsonl).
On completion (or after max_waves), run `py -3 finalize.py` to write manifest + report.
"""
from __future__ import annotations
import asyncio
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
# at module-import time (module-level int(os.environ.get(...))). If .env.local loads after the
# import, the concurrency values in .env.local are silently ignored (latent bug). Loading here
# makes .env.local the single source of truth for both credentials AND concurrency tuning.
_load_env_local()

from ml.data_pipeline.v03.orchestrator import Orchestrator
from ml.data_pipeline.v03.spec_planner import SpecPlanner
from ml.data_pipeline.v03.scheduler import DeficitScheduler
from ml.data_pipeline.v03 import config, finalize


async def main() -> int:
    _load_env_local()
    if not (os.environ.get("ARK_API_KEY") or os.environ.get("STEPFUN_API_KEY")):
        print("ERROR: ARK_API_KEY/STEPFUN_API_KEY not set (load .env.local or export it)", file=sys.stderr)
        return 2
    max_inflight = int(sys.argv[1]) if len(sys.argv) > 1 else 32
    oversample = float(sys.argv[2]) if len(sys.argv) > 2 else 1.6
    target_scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

    out_dir = config.RELEASES_DIR
    orch = Orchestrator(out_dir=out_dir, max_inflight=max_inflight)
    sch = DeficitScheduler(orch, SpecPlanner(), max_waves=20, oversample=oversample,
                           target_scale=target_scale, progress_every=500)
    total_target = sum(sch.targets.values())
    print(f"FULL RUN: target={total_target} accepted  max_inflight={max_inflight}  "
          f"oversample={oversample}  target_scale={target_scale}", flush=True)
    print(f"  gen_conc={config.GENERATOR_CONCURRENCY} rev_conc={config.REVIEWER_CONCURRENCY} "
          f"adj_conc={config.ADJUDICATOR_CONCURRENCY}  out_dir={out_dir}", flush=True)

    t0 = time.time()
    rep = await sch.run()
    elapsed = time.time() - t0
    stats = rep.final_stats
    print(f"\n=== FULL RUN REPORT ({elapsed:.0f}s = {elapsed/3600:.1f}h) ===", flush=True)
    for k, v in stats.__dict__.items():
        print(f"  {k}: {v}", flush=True)
    print(f"  waves_run: {rep.waves_run}", flush=True)
    print(f"  total_specs_generated: {rep.total_specs_generated}", flush=True)
    ok, _ = orch.audit.verify_chain()
    print(f"  audit_chain_ok: {ok}", flush=True)
    rem = sum(rep.remaining_deficit.values())
    print(f"  remaining_deficit: {rem}/{total_target}", flush=True)

    # auto-finalize: write manifest + report with whatever was accepted
    try:
        fin = finalize.finalize(out_dir)
        mp = finalize.write_manifest(fin, out_dir)
        rp = finalize.write_report_md(fin, out_dir)
        print(f"  manifest: {mp}", flush=True)
        print(f"  report: {rp}", flush=True)
        print(f"  acceptedCount: {fin['acceptedCount']}  exact_dups: {fin['exactDuplicates']}  "
              f"label_mismatches: {fin['immutableLabelMismatches']}", flush=True)
    except Exception as e:
        print(f"  finalize failed: {type(e).__name__}:{e}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
