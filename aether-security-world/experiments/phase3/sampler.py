"""M3 family-aware sampler (master brief §37).

Batches are assembled from counterfactual groups so that base / critical /
irrelevant members of the same (split, cf_family, world_id) group land in the
same effective batch window. Deterministic under a fixed seed. Train split only
(§49); mixed-base groups are flagged so the CFC flip objective skips them (§29).
"""
from __future__ import annotations

import random
from typing import Any

from . import contract
from .loader import CFGroupAcc, Sample


def group_samples(samples: list[Sample]) -> dict[tuple[str, str, str], list[Sample]]:
    grouped: dict[tuple[str, str, str], list[Sample]] = {}
    for sample in samples:
        grouped.setdefault(sample.group_key, []).append(sample)
    for members in grouped.values():
        members.sort(key=lambda s: (s.variant_type, s.episode_id))
    return grouped


def plan_batches(
    samples: list[Sample],
    effective_batch: int,
    seed: int,
    mixed_groups: set[tuple[str, str, str]] | None = None,
) -> tuple[list[list[Sample]], dict[tuple[str, str, str], bool]]:
    """Return (batches, pair_eligible) where batches is a deterministic list of
    batches covering every sample exactly once, and pair_eligible[g] says whether
    group g may participate in the CFC flip objective (clean single-axis only).
    """
    if mixed_groups is None:
        mixed_groups = set()
    grouped = group_samples(samples)
    group_keys = sorted(grouped)  # deterministic group order before seeding
    rng = random.Random(seed)
    rng.shuffle(group_keys)

    # packing: walk group chunks in order, fill fixed-size batches; a group
    # larger than the batch splits deterministically, group members stay
    # contiguous within the stream.
    batches: list[list[Sample]] = []
    current: list[Sample] = []
    for key in group_keys:
        members = grouped[key]
        for sample in members:
            if len(current) == effective_batch:
                batches.append(current)
                current = []
            current.append(sample)
    if current:
        batches.append(current)

    pair_eligible = {key: key not in mixed_groups for key in grouped}
    return batches, pair_eligible


def validate_no_cross_split(samples: list[Sample]) -> None:
    """Sampler preflight (§61): a group must never span splits."""
    seen: dict[tuple[str, str], set[str]] = {}
    for sample in samples:
        key = (sample.cf_family, sample.world_id)
        seen.setdefault(key, set()).add(sample.split)
    offenders = {k: v for k, v in seen.items() if len(v) > 1}
    if offenders:
        raise RuntimeError(f"cross-split counterfactual groups: {sorted(offenders)[:3]}")


def assert_train_only(samples: list[Sample]) -> None:
    for sample in samples:
        contract.assert_split_allowed(sample.split, "param_update")
