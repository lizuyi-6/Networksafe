"""v0.3 deficit scheduler: drives the orchestrator in waves until every quota cell hits its
accepted-count target.

Why: per-cell accept rate is ~50-60% (det-check + adjudicator rejections are *correct* quality
gates, not bugs). To land 300k ACCEPTED samples we must OVERSAMPLE each cell. The scheduler:
  1. computes per-cell deficit = target - accepted (from the orchestrator's _accepted_cell, which
     is itself rebuilt from the audit log on resume);
  2. generates a fresh wave of specs for deficit cells via SpecPlanner.specs_for_cell with an
     advancing start_i (so each wave yields NEW context-axis combinations, not replays);
  3. feeds the wave to orchestrator.run(cell_targets=...), which skips already-full cells;
  4. repeats until all cells meet target OR max_waves / a global attempt budget is exhausted.

Contrastive cells generate COMPLETE pairs (both members) per deficit unit, so pair completeness
is preserved across waves; partner members land in derived (untargeted) cells and are processed
freely.

No LLM lives here - this is pure scheduling over the program-owned quota matrix and the
orchestrator's observed accept counts. Resumable: orchestrator state is audit-derived.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from typing import Iterator

from . import config, quotas
from .orchestrator import Orchestrator, Stats
from .spec_planner import SpecPlanner


def _cell_key(verdict: str, family: str, gtype: str, inj: bool) -> str:
    return f"{verdict}|{family}|{gtype}|{inj}"


@dataclass
class SchedulerReport:
    waves_run: int = 0
    total_specs_generated: int = 0
    final_stats: Stats | None = None
    remaining_deficit: dict[str, int] = field(default_factory=dict)
    targets: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "wavesRun": self.waves_run,
            "totalSpecsGenerated": self.total_specs_generated,
            "finalStats": self.final_stats.__dict__ if self.final_stats else {},
            "remainingDeficit": self.remaining_deficit,
            "targets": self.targets,
        }


class DeficitScheduler:
    def __init__(
        self,
        orchestrator: Orchestrator,
        planner: SpecPlanner | None = None,
        max_waves: int = 12,
        oversample: float = 2.0,
        max_oversample_total: int | None = None,
        progress_every: int = 200,
        target_scale: float = 1.0,
    ):
        self.orch = orchestrator
        self.planner = planner or SpecPlanner()
        self.max_waves = max_waves
        self.oversample = oversample
        self.max_oversample_total = max_oversample_total
        self.progress_every = progress_every
        # cell targets straight from the program-owned quota matrix (optionally scaled for testing)
        self.targets: dict[str, int] = {}
        for c in quotas.cells():
            k = _cell_key(c["verdict"], c["attackFamily"], c["generationType"], c["promptInjectionPresent"])
            cnt = max(1, int(c["count"] * target_scale)) if target_scale <= 1.0 else c["count"]
            self.targets[k] = self.targets.get(k, 0) + cnt
        # per-cell axis offset so each wave advances context axes (fresh diversity)
        self._cell_offset: dict[str, int] = {}
        for k, t in self.targets.items():
            self._cell_offset[k] = t  # wave-0 starts where the initial expansion would END

    def _accepted_counts(self) -> dict[str, int]:
        # orchestrator._accepted_cell is rebuilt from audit on init and updated live in-run
        return dict(self.orch._accepted_cell)

    def _compute_deficit(self) -> dict[str, int]:
        acc = self._accepted_counts()
        deficit: dict[str, int] = {}
        for k, target in self.targets.items():
            remaining = target - acc.get(k, 0)
            if remaining > 0:
                deficit[k] = remaining
        return deficit

    def _parse_cell_key(self, key: str) -> tuple[str, str, str, bool]:
        v, f, g, inj = key.split("|")
        return v, f, g, inj == "True"

    def _generate_wave(self, deficit: dict[str, int]) -> list:
        per_cell: list[list] = []
        for key, remaining in deficit.items():
            verdict, family, gtype, inj = self._parse_cell_key(key)
            # oversample to compensate for expected rejection
            n = int(remaining * self.oversample)
            if n < 1:
                n = 1
            start_i = self._cell_offset.get(key, 0)
            wave_specs = list(self.planner.specs_for_cell(verdict, family, gtype, inj, n, start_i))
            self._cell_offset[key] = start_i + n
            per_cell.append(wave_specs)
        # Round-robin interleave: feed a MIX of cells to the queue (not all of cell A then cell B).
        # Why: the orchestrator's producer iterates specs in order and the queue is bounded, so a
        # grouped wave would serialize cells (all malicious sqli first, ... unknown last). That
        # makes every shard homogeneous AND - critically - a partial run (early termination / stall)
        # leaves a SKEWED dataset: only the first-listed cells filled, later verdicts empty. Round-
        # robin guarantees every shard is diverse and a partial run leaves a PROPORTIONAL dataset
        # across all verdict/family cells. Deterministic (no shuffle) so resume is reproducible.
        # Contrastive pairIds are preserved regardless of order: pair-aware near-dedup exempts
        # same pairId, and both pair members are still generated within the same wave.
        specs: list = []
        idx = 0
        while any(idx < len(c) for c in per_cell):
            for c in per_cell:
                if idx < len(c):
                    specs.append(c[idx])
            idx += 1
        return specs

    async def run(self) -> SchedulerReport:
        report = SchedulerReport(targets=dict(self.targets))
        total_generated = 0
        for wave in range(self.max_waves):
            deficit = self._compute_deficit()
            if not deficit:
                report.waves_run = wave
                break
            wave_specs = self._generate_wave(deficit)
            if not wave_specs:
                report.waves_run = wave
                break
            total_generated += len(wave_specs)
            # cap total oversample budget if set
            if self.max_oversample_total is not None and total_generated > self.max_oversample_total:
                # trim this wave to the remaining budget
                remaining_budget = self.max_oversample_total - (total_generated - len(wave_specs))
                wave_specs = wave_specs[:max(0, remaining_budget)]
                total_generated = (total_generated - len(wave_specs)) + len(wave_specs)
                if not wave_specs:
                    report.waves_run = wave
                    break
            # only targeted cells get a cap (partners process freely)
            cell_targets = {k: t for k, t in self.targets.items()}
            stats = await self.orch.run(wave_specs, cell_targets=cell_targets,
                                        progress_every=self.progress_every)
            report.waves_run = wave + 1
            # stop if the wave produced zero accepts DESPITE processing new specs (stalled -
            # prompt/generator issue, or rate-limit starvation). A wave that only skipped
            # already-processed specs (resume case, processed==0) is NOT a stall - continue.
            if wave >= 1 and stats.accepted == 0 and stats.processed > 0:
                break
        report.total_specs_generated = total_generated
        report.final_stats = self.orch.stats
        report.remaining_deficit = self._compute_deficit()
        return report


__all__ = ["DeficitScheduler", "SchedulerReport"]
