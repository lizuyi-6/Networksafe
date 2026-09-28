"""Phase 2B split 工具的回归（brief §43-§49）。

钉死四件事：union 约束（同 family 的 world 不许跨 split）、component 完整性（一个
component 的所有 world 同 split）、确定性（同输入同输出）、mechanism_ood 组合优先
且 train 不得缺机制。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from analysis.phase2b_split import (
    SPLITS,
    UNION_KEYS,
    assign_splits,
    audit,
    build_components,
)

ROOT = Path(__file__).resolve().parents[2]


def _synthetic_worlds(count: int = 24) -> list[dict]:
    """确定性合成语料：按 (i % 4) 分组共享 world_family，mechanism 每 3 个一轮。"""
    worlds = []
    for i in range(count):
        worlds.append({
            "world_id": f"W-{i:04d}",
            "mechanism_family": ["alpha_mech", "beta_mech", "gamma_mech"][i % 3],
            "world_family_id": f"WF-{i % 4}",
            "counterfactual_family_id": f"CF-{i}",
            "workflow_family_id": f"WK-{i % 2}",
            "policy_family_id": f"POL-{i % 5}",
            "invariant_family_id": f"INV-{i % 3}",
        })
    return worlds


def _synthetic_episodes(worlds: list[dict]) -> list[dict]:
    episodes = []
    for world in worlds:
        for variant in ("base", "critical_intervention"):
            episodes.append({
                "episode_id": f"EP-{world['world_id']}-{variant}",
                "world_id": world["world_id"],
                "variant_type": variant,
            })
    return episodes


@pytest.fixture(scope="module")
def split_result():
    worlds = _synthetic_worlds()
    episodes = _synthetic_episodes(worlds)
    return assign_splits(worlds, episodes), worlds, episodes


def test_every_episode_is_assigned(split_result):
    result, _worlds, episodes = split_result
    assert len(result["episode_split"]) == len(episodes)
    for episode in episodes:
        assert episode["episode_id"] in result["episode_split"]


def test_union_constraints_are_respected(split_result):
    """共享任一 family key 的 world 必须在同一 split（brief §44）。"""
    result, worlds, _episodes = split_result
    assignment = result["assignment"]
    for key in UNION_KEYS:
        by_value: dict[str, set[str]] = {}
        for world in worlds:
            by_value.setdefault(str(world[key]), set()).add(assignment[world["world_id"]])
        for value, splits in by_value.items():
            assert len(splits) == 1, f"{key}={value} 跨 split: {sorted(splits)}"


def test_components_are_whole(split_result):
    """一个 component 的所有 world 同 split。"""
    result, _worlds, _episodes = split_result
    assignment = result["assignment"]
    for component in result["components"]:
        splits = {assignment[world_id] for world_id in component}
        assert len(splits) == 1, f"component {component} 被拆到 {sorted(splits)}"


def test_split_assignment_is_deterministic():
    worlds = _synthetic_worlds()
    episodes = _synthetic_episodes(worlds)
    first = assign_splits(worlds, episodes)
    second = assign_splits(worlds, episodes)
    assert first["assignment"] == second["assignment"]
    assert first["episode_split"] == second["episode_split"]


def test_no_episode_leaks_across_splits(split_result):
    """同一 world 的 base / critical 变体必须在同一 split（brief §43 的主判据）。"""
    result, _worlds, _episodes = split_result
    seen: dict[str, str] = {}
    for episode_id, split in result["episode_split"].items():
        world_id = episode_id.rsplit("-", 1)[0].replace("EP-", "W-")
        if world_id in seen:
            assert seen[world_id] == split, f"{world_id} 跨 split"
        seen[world_id] = split


def test_train_keeps_every_mechanism(split_result):
    """brief §49：train 必须仍见到每种 mechanism（组合 OOD，不是新机制 OOD）。"""
    result, worlds, _episodes = split_result
    assert result["missing_train_mechanisms"] == []
    train_mechanisms = {
        str(({w["world_id"]: w for w in worlds}[wid] or {}).get("mechanism_family"))
        for wid, split in result["assignment"].items() if split == "train"
    }
    all_mechanisms = {str(w.get("mechanism_family")) for w in worlds}
    assert train_mechanisms == all_mechanisms


def test_audit_reports_zero_conflicts_for_a_valid_assignment(split_result):
    result, worlds, episodes = split_result
    worlds_by_id = {str(w.get("world_id")): w for w in worlds}
    report = audit(result, worlds, worlds_by_id)
    assert report["conflict_count"] == 0
    assert sum(report["worlds_by_split"].values()) == len(worlds)


def test_all_five_splits_exist():
    assert SPLITS == ("train", "iid_dev", "world_ood", "workflow_ood", "mechanism_ood")


def test_production_split_manifest_has_no_cross_split_conflicts():
    """真实 502-world 语料的 split manifest（若有）必须 0 冲突。"""
    manifest_path = ROOT / "releases-staging" / "splits" / "split-manifest.json"
    if not manifest_path.is_file():
        pytest.skip("production split 尚未构建")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["split_leakage_audit"]["cross_split_family_conflicts"] == 0
    assert manifest["missing_train_mechanisms"] == []
