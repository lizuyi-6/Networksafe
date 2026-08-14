"""Long-running health monitor for the v0.3 dataset run. Polls every 60s and EXITS (prints
a report) when one of these fires:
  - process `pid` is dead (crash/reboot) -> re-launch run_full.py to resume
  - 429/RateLimit count spikes (+>20 in 60s) -> back off concurrency
  - accept count hits the next milestone (every 5000) -> progress check-in
  - `max_minutes` elapsed (default 25) -> periodic check-in
Prints a clean status snapshot. No API calls; reads audit.jsonl + stderr log only.

Usage: py -3 monitor_run.py <pid> [max_minutes] [milestone_step]
"""
from __future__ import annotations
import sys, time, subprocess, json
from pathlib import Path

# SECURITY FIX (audit 2026-08, ML-007): was a hardcoded r"X:\repos\Networksafe\..." machine
# path; derive from this file's location (ml/data_pipeline/v03/ -> ml/ -> releases dir).
V03 = Path(__file__).resolve().parents[2] / "data" / "releases" / "v03"
AUDIT = V03 / "audit.jsonl"
STDERR = V03 / "run-full.stderr.log"
STDOUT = V03 / "run-full.stdout.log"


def _count(path: Path, needle: str) -> int:
    if not path.exists():
        return 0
    n = 0
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if needle in line:
                    n += 1
    except Exception:
        pass
    return n


def _proc_alive(pid: int) -> bool:
    try:
        r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"],
                           capture_output=True, text=True, timeout=10)
        return str(pid) in r.stdout
    except Exception:
        return False


def main() -> int:
    pid = int(sys.argv[1])
    max_minutes = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    milestone_step = int(sys.argv[3]) if len(sys.argv) > 3 else 5000
    deadline = time.time() + max_minutes * 60
    last_accepts = _count(AUDIT, '"event": "accept"')
    last_429 = _count(STDERR, "429") + _count(STDERR, "RateLimitError")
    last_timeouts = _count(STDERR, "APITimeoutError")
    next_milestone = ((last_accepts // milestone_step) + 1) * milestone_step
    print(f"monitor: pid={pid} start_accepts={last_accepts} next_milestone={next_milestone} "
          f"max_minutes={max_minutes}", flush=True)
    while time.time() < deadline:
        time.sleep(60)
        if not _proc_alive(pid):
            print(f"FIRED: process {pid} DEAD", flush=True)
            break
        accepts = _count(AUDIT, '"event": "accept"')
        cur_429 = _count(STDERR, "429") + _count(STDERR, "RateLimitError")
        cur_to = _count(STDERR, "APITimeoutError")
        if accepts >= next_milestone:
            print(f"FIRED: milestone {next_milestone} reached (accepts={accepts})", flush=True)
            break
        if (cur_429 - last_429) > 20:
            print(f"FIRED: 429 spike +{cur_429 - last_429} in 60s (total {cur_429})", flush=True)
            break
        last_accepts = accepts
        last_429 = cur_429
        last_timeouts = cur_to
    # final snapshot
    accepts = _count(AUDIT, '"event": "accept"')
    total = _count(AUDIT, '"event":')
    rejects = _count(AUDIT, '"event": "reject"')
    errors = _count(AUDIT, '"event": "error"')
    cur_429 = _count(STDERR, "429") + _count(STDERR, "RateLimitError")
    cur_to = _count(STDERR, "APITimeoutError")
    alive = _proc_alive(pid)
    print(f"=== snapshot ===", flush=True)
    print(f"proc_alive={alive} (pid={pid})", flush=True)
    print(f"accepts={accepts} rejects={rejects} errors={errors} total_events={total}", flush=True)
    print(f"429s={cur_429} timeouts={cur_to}", flush=True)
    if total > 0:
        print(f"accept_rate={accepts}/{total}={accepts*100//total}%", flush=True)
    # shard count + total bytes
    shards = list((V03 / "accepted").glob("shard-*.jsonl")) if (V03 / "accepted").exists() else []
    total_bytes = sum(s.stat().st_size for s in shards)
    print(f"shards={len(shards)} total_bytes={total_bytes:,} ({total_bytes/1e6:.1f}MB)", flush=True)
    print(f"--- stdout tail ---", flush=True)
    if STDOUT.exists():
        lines = STDOUT.read_text(encoding="utf-8", errors="replace").splitlines()
        for ln in lines[-6:]:
            print(ln, flush=True)
    print(f"--- stderr tail ---", flush=True)
    if STDERR.exists():
        lines = STDERR.read_text(encoding="utf-8", errors="replace").splitlines()
        for ln in lines[-8:]:
            print(ln, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
