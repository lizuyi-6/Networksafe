"""v0.3 async pipeline orchestrator.

Per-spec flow:
  spec -> generate(+det-check, retry) -> exact-dedup -> 2 blind reviews (concurrent)
        -> adjudicate -> near-dedup (pair-aware) -> ACCEPT (shard write) / REJECT (audit)

Resumable: on startup, scans the audit log for terminal sampleIds and skips them.
Concurrency: asyncio queue + workers, with per-stage semaphores bounding LLM calls.
Tamper-evident: every outcome appended to AuditLog (sha256 chain).
No secrets persisted: det-check guarantees no keys/real-targets in detectionInput; the API
key lives only in env (provider.py) and never enters a record.
"""
from __future__ import annotations
import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from . import config, quotas
from .spec_planner import SpecPlanner
from .generator import Generator
from .reviewer import Reviewer
from .adjudicator import Adjudicator
from .dedup import ExactDeduper, NearDeduper
from .audit import AuditLog
from .generation_spec import GenerationSpec
from . import quality_gates

PROMPT_VERSION = config.PROMPT_VERSION  # re-exported for backwards-compat imports
_DATASET_VERSION = config.DATASET_VERSION


@dataclass
class Stats:
    planned: int = 0
    processed: int = 0
    skipped_done: int = 0
    skipped_cell_full: int = 0
    accepted: int = 0
    rejected_det: int = 0
    rejected_exact_dup: int = 0
    rejected_adjudicator: int = 0
    rejected_near_dup: int = 0
    rejected_review_error: int = 0
    errors: int = 0
    llm_calls: int = 0
    llm_latency: float = 0.0


def _strip_reviewer(r: dict) -> dict:
    if not isinstance(r, dict):
        return {"error": "non_dict_review"}
    return {k: v for k, v in r.items() if not k.startswith("_")}


def _reviewer_agrees(review: dict, spec_dict: dict) -> bool:
    """Reviewer agrees with ground truth on verdict+family+action."""
    if not isinstance(review, dict) or review.get("error"):
        return False
    return (review.get("verdict") == spec_dict.get("verdict")
            and review.get("attackFamily") == spec_dict.get("attackFamily")
            and review.get("recommendedAction") == spec_dict.get("recommendedAction"))


def build_record(spec: GenerationSpec, candidate: dict, review_a: dict, review_b: dict,
                 decision: dict, gen_attempts: int, gen_latency: float) -> dict:
    spec_dict = spec.to_dict()
    ra, rb = _strip_reviewer(review_a), _strip_reviewer(review_b)
    agree_a = _reviewer_agrees(review_a, spec_dict)
    agree_b = _reviewer_agrees(review_b, spec_dict)
    return {
        "sampleId": spec.sampleId,
        "pairId": spec.pairId,
        "specHash": spec.specHash,
        "datasetVersion": _DATASET_VERSION,
        "detectionInput": candidate["detectionInput"],
        "detectionOutput": candidate["detectionOutput"],
        "groundTruth": spec.immutable_labels(),
        "spec": spec_dict,
        "provenance": {
            "datasetVersion": _DATASET_VERSION,
            "synthetic": True,
            "generationType": spec.generationType,
            "generatorModel": _model_of("generator"),
            "generatorPromptVersion": PROMPT_VERSION,
            "generatorAttempts": gen_attempts,
            "generatorLatency": round(gen_latency, 3),
            "reviewModels": [_model_of("reviewer"), _model_of("reviewer")],
            "reviewerPromptVersion": PROMPT_VERSION,
            "adjudicatorModel": _model_of("adjudicator"),
            "adjudicatorPromptVersion": PROMPT_VERSION,
            "adjudicationDecision": decision.get("decision"),
            "adjudicationReason": decision.get("reason", ""),
            "rejectionReason": decision.get("rejectionReason"),
            "encoding": spec.encoding,
            "humanReviewCount": 0,
        },
        "review": {
            "reviewerA": ra,
            "reviewerB": rb,
            "reviewerAAgrees": agree_a,
            "reviewerBAgrees": agree_b,
            "bothAgree": agree_a and agree_b,
        },
    }


def _model_of(role: str) -> str:
    """Best-effort model name for provenance (does NOT touch the key)."""
    import os
    return os.environ.get(f"ARK_MODEL_{role.upper()}") or os.environ.get("ARK_MODEL", "glm-5.2")


class ShardWriter:
    """Append accepted records to sharded JSONL (roll at SHARD_MAX)."""

    def __init__(self, base_dir: Path, shard_max: int = config.SHARD_MAX):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.shard_max = shard_max
        self._shard_idx = self._last_shard_idx()
        self._count = self._count_in(self._shard_path(self._shard_idx))
        self._fh = open(self._shard_path(self._shard_idx), "a", encoding="utf-8")

    def _shard_path(self, idx: int) -> Path:
        return self.base_dir / f"shard-{idx:05d}.jsonl"

    def _last_shard_idx(self) -> int:
        existing = sorted(self.base_dir.glob("shard-*.jsonl"))
        if not existing:
            return 0
        m = re.search(r"shard-(\d+)", existing[-1].name)
        return int(m.group(1)) if m else 0

    def _count_in(self, path: Path) -> int:
        if not path.exists():
            return 0
        n = 0
        with path.open("r", encoding="utf-8") as f:
            for _ in f:
                n += 1
        return n

    def write(self, record: dict) -> None:
        if self._count >= self.shard_max:
            self._fh.close()
            self._shard_idx += 1
            self._count = 0
            self._fh = open(self._shard_path(self._shard_idx), "a", encoding="utf-8")
        self._fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._fh.flush()
        self._count += 1

    def close(self) -> None:
        if self._fh:
            self._fh.close()
            self._fh = None


class Orchestrator:
    def __init__(
        self,
        generator: Generator | None = None,
        reviewer_a: Reviewer | None = None,
        reviewer_b: Reviewer | None = None,
        adjudicator: Adjudicator | None = None,
        out_dir: Path | None = None,
        near_dup_threshold: float = 0.7,
        max_inflight: int = config.MAX_INFLIGHT,
    ):
        # LLM components are lazily constructed only if ARK_API_KEY is set; this lets the
        # orchestrator be imported and structurally tested without credentials.
        self.generator = generator
        self.reviewer_a = reviewer_a
        self.reviewer_b = reviewer_b
        self.adjudicator = adjudicator

        self.out_dir = Path(out_dir) if out_dir else config.RELEASES_DIR
        self.accepted_dir = self.out_dir / "accepted"
        self.exact = ExactDeduper()
        self.near = NearDeduper(threshold=near_dup_threshold)
        self.audit = AuditLog(self.out_dir / "audit.jsonl")
        self.writer = ShardWriter(self.accepted_dir)

        self.sem_gen = asyncio.Semaphore(config.GENERATOR_CONCURRENCY)
        self.sem_rev = asyncio.Semaphore(config.REVIEWER_CONCURRENCY)
        self.sem_adj = asyncio.Semaphore(config.ADJUDICATOR_CONCURRENCY)
        self._max_inflight = max_inflight
        self.sem_inflight = asyncio.Semaphore(max_inflight)

        self.stats = Stats()
        self._accepted_cell: dict[str, int] = {}
        self._cell_targets: dict[str, int] = {}
        self._processed: set[str] = self._load_processed()
        self._accepted_cell = self._load_accepted_cell()

    def _load_accepted_cell(self) -> dict[str, int]:
        """Resume: rebuild per-cell accepted counts from the audit log's accept events.
        Counterpart to _load_processed - _processed skips re-work, this restores the deficit
        accounting so the scheduler knows which cells are still under target after a crash."""
        counts: dict[str, int] = {}
        if not self.audit.path.exists():
            return counts
        try:
            with self.audit.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    if obj.get("event") != "accept":
                        continue
                    key = "|".join(str(obj.get(k, "")) for k in
                                   ("verdict", "attackFamily", "generationType", "promptInjectionPresent"))
                    counts[key] = counts.get(key, 0) + 1
        except Exception:
            pass
        return counts

    def _load_processed(self) -> set[str]:
        """Resume: collect sampleIds that already have a terminal audit event."""
        done: set[str] = set()
        if not self.audit.path.exists():
            return done
        try:
            with self.audit.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    ev = obj.get("event")
                    sid = obj.get("sampleId")
                    if ev in ("accept", "reject") and sid:
                        done.add(sid)
        except Exception:
            pass
        return done

    def _ensure_llm(self) -> None:
        if self.generator is None:
            self.generator = Generator()
        if self.reviewer_a is None:
            self.reviewer_a = Reviewer("A")
        if self.reviewer_b is None:
            # second reviewer with a distinct label; same provider config (could be a different
            # model via ARK_MODEL_REVIEWER env, or the same - both are 'reviewer' role)
            self.reviewer_b = Reviewer("B")
        if self.adjudicator is None:
            self.adjudicator = Adjudicator()

    # ---- main entry ----

    async def run(self, specs: Iterable[GenerationSpec], cell_targets: dict[str, int] | None = None,
                  progress_every: int = 100) -> Stats:
        self._ensure_llm()
        self._cell_targets = cell_targets or {}

        queue: asyncio.Queue = asyncio.Queue(maxsize=self._max_inflight * 4)
        results: list = []

        async def produce():
            for spec in specs:
                self.stats.planned += 1
                if spec.sampleId in self._processed:
                    self.stats.skipped_done += 1
                    continue
                # skip if this cell already hit target (deficit-aware: don't over-generate).
                # Only TARGETED cells (key in cell_targets) can be skipped - untargeted cells
                # (e.g. contrastive partners whose cell key isn't a quota target) always process.
                key = self._cell_key(spec)
                if (self._cell_targets and key in self._cell_targets
                        and self._accepted_cell.get(key, 0) >= self._cell_targets[key]):
                    self.stats.skipped_cell_full += 1
                    continue
                await queue.put(spec)
            for _ in range(self._max_inflight):
                await queue.put(None)

        async def worker():
            while True:
                spec = await queue.get()
                if spec is None:
                    queue.task_done()
                    return
                try:
                    outcome = await self._process_one(spec)
                    self._record_outcome(spec, outcome)
                except Exception as e:
                    self.stats.errors += 1
                    self.audit.append(event="error", sampleId=spec.sampleId,
                                      error=f"{type(e).__name__}:{str(e)[:160]}")
                finally:
                    queue.task_done()
                    if self.stats.processed % progress_every == 0 and self.stats.processed > 0:
                        self._persist_progress()

        workers = [asyncio.create_task(worker()) for _ in range(self._max_inflight)]
        await produce()
        await asyncio.gather(*workers)
        self._persist_progress()
        self.writer.close()
        return self.stats

    def _cell_key(self, spec: GenerationSpec) -> str:
        return f"{spec.verdict}|{spec.attackFamily}|{spec.generationType}|{spec.promptInjectionPresent}"

    def _record_outcome(self, spec: GenerationSpec, outcome: tuple[str, dict | None]):
        kind, detail = outcome
        self.stats.processed += 1
        self._processed.add(spec.sampleId)
        if kind == "accepted":
            self.stats.accepted += 1
            key = self._cell_key(spec)
            self._accepted_cell[key] = self._accepted_cell.get(key, 0) + 1
        elif kind == "rejected_det":
            self.stats.rejected_det += 1
        elif kind == "rejected_exact_dup":
            self.stats.rejected_exact_dup += 1
        elif kind == "rejected_adjudicator":
            self.stats.rejected_adjudicator += 1
        elif kind == "rejected_near_dup":
            self.stats.rejected_near_dup += 1
        elif kind == "rejected_review_error":
            self.stats.rejected_review_error += 1

    async def _process_one(self, spec: GenerationSpec) -> tuple[str, dict | None]:
        spec_dict = spec.to_dict()

        # 1. generate (with det-check retry)
        async with self.sem_gen:
            gen = await self.generator.generate(spec)
        self.stats.llm_calls += gen.attempts
        self.stats.llm_latency += gen.latency
        if not gen.ok:
            self.audit.append(
                event="reject", sampleId=spec.sampleId, stage="det_check",
                attempts=gen.attempts, error=gen.error or "",
                reasons=gen.det_check.reasons,
            )
            return ("rejected_det", {"reasons": gen.det_check.reasons, "error": gen.error})

        candidate = gen.candidate
        di = candidate["detectionInput"]

        # 2. exact dedup
        if not self.exact.check_and_add(di):
            self.audit.append(event="reject", sampleId=spec.sampleId, stage="exact_dup")
            return ("rejected_exact_dup", None)

        # 3. two blind reviews (concurrent)
        async def _rev(reviewer, sem):
            async with sem:
                return await reviewer.review(di)
        review_a, review_b = await asyncio.gather(
            _rev(self.reviewer_a, self.sem_rev),
            _rev(self.reviewer_b, self.sem_rev),
        )
        self.stats.llm_calls += 2
        if not isinstance(review_a, dict) or review_a.get("error") or \
           not isinstance(review_b, dict) or review_b.get("error"):
            self.audit.append(
                event="reject", sampleId=spec.sampleId, stage="review_error",
                errA=str(review_a)[:200], errB=str(review_b)[:200],
            )
            return ("rejected_review_error", None)

        # 4. adjudicate
        async with self.sem_adj:
            decision = await self.adjudicator.adjudicate(spec_dict, candidate, review_a, review_b)
        if decision.get("llm_called", True):
            self.stats.llm_calls += 1
        if decision.get("decision") != "ACCEPT":
            self.audit.append(
                event="reject", sampleId=spec.sampleId, stage="adjudicator",
                decision=decision.get("decision"),
                reason=decision.get("reason", ""),
                rejectionReason=decision.get("rejectionReason"),
            )
            return ("rejected_adjudicator", decision)

        # 5. near-dedup (pair-aware)
        if not self.near.add(spec.sampleId, di, pair_id=spec.pairId):
            self.audit.append(event="reject", sampleId=spec.sampleId, stage="near_dup")
            return ("rejected_near_dup", None)

        # 6. ACCEPT
        record = build_record(spec, candidate, review_a, review_b, decision,
                               gen.attempts, gen.latency)
        self.writer.write(record)
        self.audit.append(
            event="accept", sampleId=spec.sampleId, specHash=spec.specHash,
            pairId=spec.pairId, verdict=spec.verdict, attackFamily=spec.attackFamily,
            generationType=spec.generationType, promptInjectionPresent=spec.promptInjectionPresent,
            reviewerAAgrees=_reviewer_agrees(review_a, spec_dict),
            reviewerBAgrees=_reviewer_agrees(review_b, spec_dict),
        )
        return ("accepted", record)

    def _persist_progress(self) -> None:
        config.QUOTA_PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
        prog = {
            "stats": {k: v for k, v in self.stats.__dict__.items()},
            "accepted_cell": self._accepted_cell,
            "ts": int(time.time()),
        }
        config.QUOTA_PROGRESS_PATH.write_text(json.dumps(prog, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- finalization ----

    def load_accepted(self) -> list[dict]:
        records: list[dict] = []
        for shard in sorted(self.accepted_dir.glob("shard-*.jsonl")):
            with shard.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        records.append(json.loads(line))
        return records

    def evaluate_gates(self) -> dict:
        records = self.load_accepted()
        return quality_gates.evaluate(records)


__all__ = ["Orchestrator", "Stats", "ShardWriter", "build_record", "PROMPT_VERSION"]
