"""World/family cluster bootstrap for Phase 3 (master brief §40/§41).

Episodes are not independent samples; confidence intervals must be computed by
cluster resampling over world_id (or attack_family), never row bootstrap.
Paired differences between two prediction sets reuse identical resample indices.
"""
from __future__ import annotations

import random
from collections import defaultdict
from typing import Any, Callable

from .metrics import compute_metrics

RESAMPLE_COUNTS = (2000, 5000, 10000)


def _clusters(rows: list[dict[str, Any]], cluster_key: str) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        out[r[cluster_key]].append(r)
    return dict(out)


def bootstrap_ci(
    samples: list[Any],
    predictions: list[dict[str, Any]],
    metric: Callable[[dict[str, Any]], float],
    cluster_key: str = "world_id",
    n_resamples: int = 2000,
    seed: int = 20260921,
) -> dict[str, Any]:
    """metric: maps the metrics dict -> the scalar to bootstrap (e.g. lambda m:
    m["P1_observable_decision_macro_f1"])."""
    by_id = {p["episode_id"]: p for p in predictions}
    rows = []
    for sample in samples:
        pred = by_id[sample.episode_id]
        rows.append({
            "episode_id": sample.episode_id,
            "world_id": sample.world_id,
            "attack_family": sample.attack_family,
            "gt_verdict": sample.oracle_decision,
            "oracle_decision": sample.oracle_decision,
            "pred_verdict": pred["pred_verdict"],
            "pred_attack_family": pred.get("pred_attack_family"),
            "parse_ok": pred["parse_ok"],
            "schema_ok": pred["schema_ok"],
            "group_key": sample.group_key,
            "variant_type": sample.variant_type,
            "availability": sample.evidence_availability,
            "evidence_availability": sample.evidence_availability,
        })
    clusters = _clusters(rows, cluster_key)
    keys = sorted(clusters)
    rng = random.Random(seed)
    vals = []
    for _ in range(n_resamples):
        picked = [rng.choice(keys) for _ in range(len(keys))]
        resampled = [dict(r) for k in picked for r in clusters[k]]
        # episode ids only feed the metrics grouping; keep them unique per draw
        for i, r in enumerate(resampled):
            r["episode_id"] = f"boot-{i}"
        m = compute_metrics(_FakeSamples(resampled), resampled)
        v = metric(m)
        if v is not None:
            vals.append(v)
    if not vals:
        return {"n_resamples": 0}
    vals.sort()
    lo = vals[int(0.025 * len(vals))]
    hi = vals[min(len(vals) - 1, int(0.975 * len(vals)))]
    point = metric(compute_metrics(samples, predictions))
    return {
        "point": point,
        "ci95_low": lo,
        "ci95_high": hi,
        "n_resamples": len(vals),
        "cluster_key": cluster_key,
        "seed": seed,
    }


def paired_bootstrap_diff(
    samples_a: list[Any],
    predictions_a: list[dict[str, Any]],
    samples_b: list[Any],
    predictions_b: list[dict[str, Any]],
    metric: Callable[[dict[str, Any]], float],
    cluster_key: str = "world_id",
    n_resamples: int = 2000,
    seed: int = 20260921,
) -> dict[str, Any]:
    """Paired cluster bootstrap of metric(A) - metric(B) with shared indices."""
    if len(predictions_a) != len(predictions_b):
        raise ValueError("paired bootstrap requires aligned prediction sets")
    by_a = {p["episode_id"]: p for p in predictions_a}
    by_b = {p["episode_id"]: p for p in predictions_b}
    if set(by_a) != set(by_b):
        raise ValueError("paired bootstrap requires identical episode coverage")

    rows_a, rows_b = [], []
    for sample in samples_a:
        pa, pb = by_a[sample.episode_id], by_b[sample.episode_id]
        base = {
            "world_id": sample.world_id,
            "attack_family": sample.attack_family,
            "gt_verdict": sample.oracle_decision,
            "oracle_decision": sample.oracle_decision,
            "group_key": sample.group_key,
            "variant_type": sample.variant_type,
            "availability": sample.evidence_availability,
            "evidence_availability": sample.evidence_availability,
        }
        rows_a.append({**base, "episode_id": sample.episode_id,
                       "pred_verdict": pa["pred_verdict"],
                       "pred_attack_family": pa.get("pred_attack_family"),
                       "parse_ok": pa["parse_ok"], "schema_ok": pa["schema_ok"],
                       "evidence_availability": sample.evidence_availability})
        rows_b.append({**base, "episode_id": sample.episode_id,
                       "pred_verdict": pb["pred_verdict"],
                       "pred_attack_family": pb.get("pred_attack_family"),
                       "parse_ok": pb["parse_ok"], "schema_ok": pb["schema_ok"],
                       "evidence_availability": sample.evidence_availability})

    clusters_a = _clusters(rows_a, cluster_key)
    clusters_b = _clusters(rows_b, cluster_key)
    if set(clusters_a) != set(clusters_b):
        raise ValueError("cluster sets differ between prediction sets")
    keys = sorted(clusters_a)
    rng = random.Random(seed)
    diffs = []
    for _ in range(n_resamples):
        picked = [rng.choice(keys) for _ in range(len(keys))]
        ra = [dict(r) for k in picked for r in clusters_a[k]]
        rb = [dict(r) for k in picked for r in clusters_b[k]]
        for i, (x, y) in enumerate(zip(ra, rb)):
            x["episode_id"] = y["episode_id"] = f"boot-{i}"
        va = metric(compute_metrics(_FakeSamples(ra), ra))
        vb = metric(compute_metrics(_FakeSamples(rb), rb))
        if va is not None and vb is not None:
            diffs.append(va - vb)
    if not diffs:
        return {"n_resamples": 0}
    diffs.sort()
    point_a = metric(compute_metrics(samples_a, predictions_a))
    point_b = metric(compute_metrics(samples_b, predictions_b))
    return {
        "diff_point": (point_a - point_b) if point_a is not None and point_b is not None else None,
        "ci95_low": diffs[int(0.025 * len(diffs))],
        "ci95_high": diffs[min(len(diffs) - 1, int(0.975 * len(diffs)))],
        "n_resamples": len(diffs),
        "cluster_key": cluster_key,
        "seed": seed,
    }


class _FakeSamples(list):
    """Minimal stand-in exposing the attributes compute_metrics reads."""

    def __init__(self, rows: list[dict[str, Any]]):
        super().__init__(rows)

    def __iter__(self):
        return iter(_RowProxy(r) for r in list.__iter__(self))


class _RowProxy:
    __slots__ = ("_r",)

    def __init__(self, r: dict[str, Any]):
        self._r = r

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        try:
            return self._r[name]
        except KeyError as exc:  # pragma: no cover
            raise AttributeError(name) from exc
