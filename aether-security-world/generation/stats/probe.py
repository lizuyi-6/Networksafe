"""Batch-size stability probe over recorded fixtures (design R6, §11.5).

Brief §7: "batch size 必须通过实际稳定性测试确定。如果一次生成太多导致 JSON 损坏 / world
重复 / 安全逻辑变浅 / schema violation，则降低 batch size."

:func:`probe_batch_stability` is the offline, deterministic version of that experiment:
for every recorded batch size it replays the fixture through the real parser and reports
the per-batch numbers a batch-size decision needs — JSON corruption (whole-batch frame
failures), duplicates, schema violations, and the resulting Generation Efficiency.

It performs no network I/O and no timing: the probe answers "which batch size produces
usable worlds per token", not "how fast is the provider".

Fixture naming: ``batch-<size:04d>[-<class>].json`` inside ``fixture_dir``. The class
suffix (``normal``, ``truncated``, ``illegal``, ``schema_invalid``, ...) labels what the
recording is meant to demonstrate; a bare ``batch-0008.json`` is class ``normal``.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Sequence

from ..parser import parse_world_specs
from ..step5.replay import load_recorded
from .efficiency import GenerationStats

_FIXTURE_NAME = re.compile(r"^batch-(\d{4})(?:-([a-z0-9_]+))?\.json$")


def _fixture_class(path: Path) -> str:
    match = _FIXTURE_NAME.match(path.name)
    if match is None or match.group(2) is None:
        return "normal"
    return match.group(2)


def probe_batch_stability(
    fixture_dir: Path | str,
    sizes: Sequence[int],
    *,
    generation_timestamp: str = "1970-01-01T00:00:00Z",
) -> list[dict]:
    """Replay every recorded fixture for ``sizes`` through the parser.

    Returns one dict per fixture file found (a batch size with several recorded classes
    yields several rows), ordered by ``(batch_size, fixture_class)``. A size with no
    fixture at all yields one row carrying ``error: "no_fixture_for_batch_size"`` — a
    missing recording is reported, never skipped silently.
    """
    directory = Path(fixture_dir)
    rows: list[dict] = []
    for size in sizes:
        if isinstance(size, bool) or not isinstance(size, int) or size < 1:
            raise ValueError(f"batch sizes must be integers >= 1, got {size!r}")
        paths = sorted(
            path for path in directory.glob(f"batch-{size:04d}*.json") if _FIXTURE_NAME.match(path.name)
        )
        if not paths:
            rows.append(
                {
                    "batch_size": size,
                    "fixture": None,
                    "fixture_class": None,
                    "error": "no_fixture_for_batch_size",
                }
            )
            continue
        for path in paths:
            rows.append(_probe_one(path, generation_timestamp=generation_timestamp))
    return rows


def _probe_one(path: Path, *, generation_timestamp: str) -> dict:
    recorded = load_recorded(path)
    raw = recorded.to_raw_generation()
    result = parse_world_specs(raw, generation_timestamp=generation_timestamp)
    stats: GenerationStats = result.stats
    row: dict[str, Any] = {
        "batch_size": recorded.batch_size,
        "fixture": path.name,
        "fixture_class": _fixture_class(path),
        "provider": recorded.provider,
        "model": recorded.model,
        "model_version": recorded.model_version,
        "prompt_version": recorded.prompt_version,
        "prompt_hash": recorded.prompt_hash,
        "recorded_at": recorded.recorded_at,
        "output_tokens": stats.output_tokens,
        "input_tokens": stats.input_tokens,
        "elements_decoded": stats.elements_decoded,
        "valid_worlds": stats.valid_worlds,
        "rejected_worlds": stats.rejected_worlds,
        "duplicate_world_ids": stats.duplicate_world_ids,
        "batch_rejected": stats.batch_rejected,
        "rejection_reasons": sorted({rejection.reason for rejection in result.rejections}),
        "valid_worlds_per_1k_tokens": (
            stats.valid_worlds_per_1k_tokens if stats.output_tokens > 0 else None
        ),
        "warnings": list(result.warnings),
    }
    return row


def efficiency_table(rows: Sequence[dict]) -> list[dict]:
    """Aggregate probe rows into the GE table a batch-size decision is made from."""
    table: list[dict] = []
    for row in rows:
        if row.get("error"):
            table.append({"batch_size": row["batch_size"], "error": row["error"]})
            continue
        table.append(
            {
                "batch_size": row["batch_size"],
                "fixture_class": row["fixture_class"],
                "output_tokens": row["output_tokens"],
                "valid_worlds": row["valid_worlds"],
                "rejected_worlds": row["rejected_worlds"],
                "duplicate_world_ids": row["duplicate_world_ids"],
                "batch_rejected": row["batch_rejected"],
                "valid_worlds_per_1k_tokens": row["valid_worlds_per_1k_tokens"],
            }
        )
    return table


def default_sizes() -> tuple[int, ...]:
    """Batch sizes ``configs/default.json`` asks the probe to cover."""
    config_path = Path(__file__).resolve().parents[2] / "configs" / "default.json"
    if not config_path.is_file():
        return (1, 2, 4, 8)
    generation = json.loads(config_path.read_text(encoding="utf-8")).get("generation", {})
    sizes = generation.get("batch_sizes_to_probe")
    if not isinstance(sizes, list) or not sizes:
        return (1, 2, 4, 8)
    return tuple(int(size) for size in sizes)


__all__ = [
    "default_sizes",
    "efficiency_table",
    "probe_batch_stability",
]
