"""Deterministic loader for the ASW v0.1 release (master brief §36).

Same release hash + config + seed must produce the same sample order. Metadata
never enters the model input (the renderer only consumes model_visible).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Iterator

from . import contract
from .contract import Variant, assert_split_allowed
from .renderer import build_prompt, target_for, target_text

SUPPORTED_SPLITS = ("train", "iid-dev", "world-ood", "mechanism-ood", "generator-ood", "workflow-ood")


@dataclass
class Sample:
    episode_id: str
    world_id: str
    split: str
    variant_type: str
    cf_family: str
    group_key: tuple[str, str, str]  # (split, cf_family, world_id)
    prompt: str
    target_text: str
    target: dict[str, str]
    oracle_decision: str
    attack_family: str
    evidence_availability: str
    chat_prompt: str  # system + "\n\n" + user body (rendered at load time)


@dataclass
class CFGroupIndex:
    groups: dict[tuple[str, str, str], "CFGroupAcc"] = field(default_factory=dict)

    def add(self, episode: dict[str, Any]) -> None:
        key = (episode["_split"], episode["counterfactual_family_id"], episode["world_id"])
        self.groups.setdefault(key, CFGroupAcc(key)).episodes.append(episode)


@dataclass
class CFGroupAcc:
    key: tuple[str, str, str]
    episodes: list[dict[str, Any]] = field(default_factory=list)

    def base_invariants(self) -> set[str]:
        out = set()
        for ep in self.episodes:
            if ep["variant_type"] == Variant.BASE.value:
                out.update(ep["oracle_output"].get("violated_invariants") or [])
        return out

    def critical_axis_drift(self) -> int:
        """Max |violated(base) Δ violated(critical)| across the group's critical
        episodes. 1 == clean single-axis; anything else == mixed/multi-axis."""
        base = self.base_invariants()
        worst = 0
        for ep in self.episodes:
            if ep["variant_type"] == Variant.CRITICAL.value:
                viol = set(ep["oracle_output"].get("violated_invariants") or [])
                worst = max(worst, len(viol.symmetric_difference(base)))
        return worst

    def mixed_base(self) -> bool:
        """Mixed-base group (episode-level frozen caliber): any critical episode
        whose violated_invariants symmetric-difference against the group's base
        union is NOT exactly 1 axis. On the asw-v0.1 train release this set is
        EMPTY (11160/11160 critical episodes have |delta|==1); the release
        counterfactual audit's '11 mixed-base axes' are a world-level narrative
        and have no episode-group-level counterpart here. Kept as a guard: any
        future release with non-single-axis criticals is excluded from L_flip
        (§29: mixed-base must not masquerade as single-variable)."""
        return self.critical_axis_drift() != 1


def _iter_split(release_dir: str, split: str) -> Iterator[dict[str, Any]]:
    path = os.path.join(release_dir, "episodes", f"{split}.jsonl")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                episode = json.loads(line)
                episode["_split"] = split
                yield episode


def load_release(release_dir: str, splits: tuple[str, ...], mode: str = "usage") -> list[dict[str, Any]]:
    """Read raw episodes from the frozen release (file order is deterministic).

    mode="usage" enforces the data usage policy per split. mode="render_audit"
    skips policy assertions - it is for the §35 renderer leakage audit, which
    must cover every split (including sealed generator-ood) WITHOUT running any
    model evaluation on them.
    """
    episodes: list[dict[str, Any]] = []
    for split in splits:
        if mode == "usage":
            assert_split_allowed(split, "final_evaluation" if split != contract.TRAIN else "param_update")
        elif mode != "render_audit":
            raise ValueError(f"unknown load mode: {mode}")
        episodes.extend(_iter_split(release_dir, split))
    return episodes


def make_sample(episode: dict[str, Any], method: str) -> Sample:
    prompt = build_prompt(method, episode)
    target = target_for(episode)
    group_key = (episode["_split"], episode["counterfactual_family_id"], episode["world_id"])
    return Sample(
        episode_id=episode["episode_id"],
        world_id=episode["world_id"],
        split=episode["_split"],
        variant_type=episode["variant_type"],
        cf_family=episode["counterfactual_family_id"],
        group_key=group_key,
        prompt=prompt,
        target_text=target_text(target),
        target=target,
        oracle_decision=episode["oracle_output"]["observable_decision"],
        attack_family=episode["group_keys"].get("attack_family") or contract.FAMILY_NONE,
        evidence_availability=episode["observation"]["decision_metadata"].get(
            "evidence_availability_level", ""),
        chat_prompt=prompt,
    )


def make_samples(episodes: list[dict[str, Any]], method: str) -> list[Sample]:
    return [make_sample(ep, method) for ep in episodes]


def build_group_index(episodes: list[dict[str, Any]]) -> dict[tuple[str, str, str], CFGroupAcc]:
    index: dict[tuple[str, str, str], CFGroupAcc] = {}
    for episode in episodes:
        key = (episode["_split"], episode["counterfactual_family_id"], episode["world_id"])
        index.setdefault(key, CFGroupAcc(key)).episodes.append(episode)
    return index


def split_mixed_groups(index: dict[tuple[str, str, str], CFGroupAcc]) -> set[tuple[str, str, str]]:
    """Group-level mixed-base set (critical axis drift != 1). Frozen caliber for
    the M3 objective exclusion; counts recorded in the protocol freeze."""
    return {key for key, group in index.items() if group.mixed_base()}
