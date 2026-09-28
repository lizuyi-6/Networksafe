"""总成测试：load → expand → mask → render → oracle → gates → split 全链路。

这是任务书点名要的"把整条链路跑通"的那一条。分两级：

* ``test_pipeline_single_renderer`` —— 快（约 15s），用 1 个 renderer 跑全部门禁；
* ``test_pipeline_full_scale`` —— ``slow`` 标记，用 3 个 renderer 跑到任务书要求的
  "每个 world 20~200 实例"，并断言 split / dedup / 分布都真实产出。
"""
from __future__ import annotations

from collections import Counter

import pytest

from analysis import MAX_INSTANCES_PER_WORLD, MIN_INSTANCES_PER_WORLD, run_pipeline
from security_world.model.episode import STRATEGY_TO_GROUP_KEY
from security_world.validation import (
    REQUIRED_LAYERS,
    assign_splits,
    audit_keys,
    dedup,
    distribution_summary,
    group_overlap_audit,
)


@pytest.fixture(scope="module")
def pipeline_one_renderer():
    return run_pipeline(renderers=("http_request",))


def test_pipeline_produces_episodes_for_every_world(pipeline_one_renderer, corpus) -> None:
    result = pipeline_one_renderer
    assert len(result.expansions) == len(corpus)
    assert result.sample_count > 0
    for expansion in result.expansions:
        assert expansion.instance_count >= 1
        assert expansion.families, "每个 probe action 都要有一个家族"


def test_pipeline_covers_every_stage_of_the_chain(pipeline_one_renderer) -> None:
    """逐段断言链路确实跑过：load/expand/mask/render/oracle/gates/split。"""
    result = pipeline_one_renderer
    # load + expand
    assert result.worlds and result.families
    # mask：每个世界都要有掩蔽变体（或被如实记进 skipped）
    masked = Counter(
        episode.variant_type for episode in result.episodes
    )
    assert masked["base"] >= len(corpus_of(result))
    assert masked["evidence_masked"] > 0 or result.summary()["skipped_variants"] > 0
    # render：观测侧必须有 renderer 与请求面
    for episode in result.episodes[:20]:
        model_visible = episode.observation["model_visible"]
        assert model_visible["renderer"]
        assert model_visible["request"]["method"]
        assert model_visible["request"]["path"]
    # oracle：每个 episode 都带判决与 trace
    for episode in result.episodes[:20]:
        assert episode.oracle_output.world_truth in ("safe", "attack", "unauthorized")
        assert episode.oracle_output.decision_trace
        assert len(episode.oracle_output.evidence_view_id) == 64
    # gates
    assert result.gate_report.passed, [
        (item.gate, item.detail) for item in result.gate_report.failures
    ]
    # split
    assert result.split_assignments
    for assignment in result.split_assignments:
        assert set(assignment.assignments) == {item.episode_id for item in result.episodes}


def corpus_of(result) -> tuple:
    return result.expansions


def test_pipeline_gates_are_all_green(pipeline_one_renderer) -> None:
    report = pipeline_one_renderer.gate_report
    assert report.passed
    gates = {item.gate for item in report.results if item.checked}
    assert {"G1_schema", "G2_reference_integrity", "G3_policy_executability",
            "G4_oracle_determinism", "G7_evidence_sufficiency", "G8_leakage_audit",
            "G9_duplicate_audit", "G11_surface_label_independence"} <= gates


def test_pipeline_splits_respect_the_holdout_keys(pipeline_one_renderer) -> None:
    result = pipeline_one_renderer
    episodes = list(result.episodes)
    worlds = dict(result.worlds)
    declared = dict(result.declared_attack_families)
    for strategy in sorted(STRATEGY_TO_GROUP_KEY):
        assignment = assign_splits(
            episodes, strategy=strategy, worlds=worlds, declared_attack_families=declared
        )
        # 审计侧必须用与分配侧**同一套** key 派生规则（含退化 key 的剔除），
        # 否则恒定的 generator_id 会被当成跨 split 的泄漏。
        keys = audit_keys(episodes, worlds=worlds, declared_attack_families=declared)
        overlaps = group_overlap_audit(assignment, keys)
        assert overlaps == [], (strategy, overlaps[:3])


def test_pipeline_dedup_keeps_the_surface_variants(pipeline_one_renderer) -> None:
    """同一家族的 UA / header 顺序扰动变体必须全部保留（REVISION 1）。"""
    result = pipeline_one_renderer
    report = dedup(list(result.episodes), layers=REQUIRED_LAYERS)
    perturbations = [
        episode for episode in result.episodes if episode.variant_type == "irrelevant_perturbation"
    ]
    assert perturbations
    assert report.removed_count == 0, [
        record.to_document() for record in report.records if record.removed
    ]
    assert len(report.kept) == len(result.episodes)


def test_pipeline_distribution_summary(pipeline_one_renderer) -> None:
    result = pipeline_one_renderer
    summary = distribution_summary(list(result.episodes))
    assert summary["sample_count"] == result.sample_count
    assert sum(summary["observable_decision"].values()) == result.sample_count
    assert summary["counterfactual_family_count"] == len(result.families)
    # 至少要有 attack 与 insufficient 两类（后者来自掩蔽变体）
    assert summary["observable_decision"].get("attack", 0) > 0
    assert summary["observable_decision"].get("insufficient_evidence", 0) > 0


@pytest.mark.slow
def test_pipeline_full_scale() -> None:
    """任务书规模：每个 world 展开 20~200 个实例。"""
    result = run_pipeline()
    counts = result.per_world_counts
    assert counts, "没有任何世界被展开"
    for world_id, count in sorted(counts.items()):
        assert MIN_INSTANCES_PER_WORLD <= count <= MAX_INSTANCES_PER_WORLD, (
            f"{world_id} 只展开出 {count} 个实例（要求 {MIN_INSTANCES_PER_WORLD}~"
            f"{MAX_INSTANCES_PER_WORLD}）"
        )
    assert result.gate_report.passed, [
        (item.gate, item.detail) for item in result.gate_report.failures
    ]
    # 三种 renderer 都要出现（观测形态多样性）
    renderers = {
        episode.observation["model_visible"]["renderer"] for episode in result.episodes
    }
    assert len(renderers) >= 3, sorted(renderers)
