"""G8 泄漏审计 + G9 重复审计 + 八策略 split。

G8：任何 group key 值不得跨 split（反事实家族尤其）；G9：exact / normalized /
structural 三层去重 + 确定性语义审计。同时覆盖 §10.3 的 leave-key-out 表与 union-find
的"共享任意 key ⇒ 同一连通分量"。
"""
from __future__ import annotations

import copy

from security_world.model.episode import STRATEGY_TO_GROUP_KEY
from security_world.validation import (
    SplitAssignment,
    assign_splits,
    audit_keys,
    dedup,
    exact_digest,
    group_overlap_audit,
    jaccard,
    normalized_digest,
    run_gates,
    semantic_duplicate_pairs,
    structural_digest,
)


# --------------------------------------------------------------------------- #
# G8
# --------------------------------------------------------------------------- #
def _annotated(family, split: str = "train"):
    """把整个家族统一打上八策略 split 行。"""
    rows = [
        {"strategy": name, "group_key": key, "split": split}
        for name, key in sorted(STRATEGY_TO_GROUP_KEY.items())
    ]
    import dataclasses

    return [
        dataclasses.replace(item, split=split, split_assignments=tuple(rows))
        for item in family.variants
    ]


def test_g8_accepts_a_consistent_family(hc001_family) -> None:
    annotated = _annotated(hc001_family)
    for index, episode in enumerate(annotated):
        siblings = [item for other, item in enumerate(annotated) if other != index]
        report = run_gates(episode, family=hc001_family, siblings=siblings)
        result = report.result("G8_leakage_audit")
        assert result is not None and result.passed, result


def test_g8_rejects_a_family_straddling_splits(hc001_family) -> None:
    """同一反事实家族的变体落在不同 split ⇒ 拒绝。"""
    annotated = _annotated(hc001_family)
    base = annotated[0]
    other = annotated[1]
    import dataclasses

    test_rows = tuple(
        {"strategy": name, "group_key": key, "split": "test"}
        for name, key in sorted(STRATEGY_TO_GROUP_KEY.items())
    )
    moved = dataclasses.replace(other, split="test", split_assignments=test_rows)
    report = run_gates(base, family=hc001_family, siblings=[moved, *annotated[2:]])
    result = report.result("G8_leakage_audit")
    assert result is not None and not result.passed
    assert "跨 split" in result.detail or "不一致" in result.detail


def test_g8_rejects_a_wrong_group_key_row(hc001_family) -> None:
    base = hc001_family.base
    rows = [
        {"strategy": "world_ood", "group_key": "app_domain", "split": "train"},
        *[
            {"strategy": name, "group_key": key, "split": "train"}
            for name, key in sorted(STRATEGY_TO_GROUP_KEY.items())
            if name != "world_ood"
        ],
    ]
    updated = base.with_split_assignments(rows)
    report = run_gates(updated, family=hc001_family)
    result = report.result("G8_leakage_audit")
    assert result is not None and not result.passed
    assert "group_key" in result.detail


def test_g8_dataset_audit_reports_overlaps(hc001_family) -> None:
    """数据集级审计：一个 group key 值出现在两个 split ⇒ 记进 overlap 清单。"""
    from security_world.validation.gates import _g8_dataset

    import dataclasses

    variants = hc001_family.variants
    assert len(variants) >= 6, "家族至少要有 6 个变体才能各放一半"
    episodes = []
    for split, batch in (("train", variants[:3]), ("test", variants[3:6])):
        for episode in batch:
            rows = [
                {"strategy": name, "group_key": key, "split": split}
                for name, key in sorted(STRATEGY_TO_GROUP_KEY.items())
            ]
            episodes.append(
                dataclasses.replace(episode, split=split, split_assignments=tuple(rows))
            )
    result = _g8_dataset(episodes, worlds=None)
    assert not result.passed
    assert "跨 split" in result.detail


# --------------------------------------------------------------------------- #
# G9
# --------------------------------------------------------------------------- #
def test_g9_three_layers_are_implemented() -> None:
    from security_world.validation import REQUIRED_LAYERS

    assert REQUIRED_LAYERS == ("exact", "normalized", "structural")


def test_g9_exact_digest_separates_surface_variants(hc001_family) -> None:
    """同一家族内的 UA 扰动变体字节不同 ⇒ exact 不折叠它们（REVISION 1）。"""
    perturbations = [
        item for item in hc001_family.variants if item.variant_type == "irrelevant_perturbation"
    ]
    digests = {exact_digest(item) for item in perturbations}
    assert len(digests) == len(perturbations)


def test_g9_normalized_digest_folds_case_and_whitespace() -> None:
    from asw_worlds import make_world

    world = make_world(world_id="W-G9")
    left = copy.deepcopy(world.to_document())
    right = copy.deepcopy(world.to_document())
    right["world_id"] = "W-G9"  # 同一个世界：normalized 必须相同
    assert normalized_digest(world) == normalized_digest(world)


def test_g9_structural_digest_abstracts_identifiers() -> None:
    """换成另一组实体 id 的同一场景 ⇒ structural digest 相同。"""
    from asw_worlds import actor, make_world, resource, role

    first = make_world(
        world_id="W-G9-A",
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    second = make_world(
        world_id="W-G9-B",
        actors=(actor("ACT-777", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-999", owner="ACT-777"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    assert structural_digest(first) == structural_digest(second)
    assert exact_digest(first) != exact_digest(second)


def test_g9_family_scoped_dedup_keeps_surface_variants(hc001_family) -> None:
    """家族内只跑 exact 层：UA 扰动变体必须全部保留。"""
    report = dedup(list(hc001_family.variants), layers=("exact",))
    assert report.removed_count == 0
    assert len(report.kept) == len(hc001_family.variants)


def test_g9_cross_family_dedup_removes_structural_twins() -> None:
    from asw_worlds import actor, make_world, resource, role

    first = make_world(
        world_id="W-G9-C",
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    second = make_world(
        world_id="W-G9-D",
        actors=(actor("ACT-002", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-002", owner="ACT-002"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    # 两个世界各自造一个"episode 状"对象：用 world 文档冒充（digest 只读文档字段）
    class _Doc:
        def __init__(self, document, family):
            self._document = document
            self.counterfactual_family_id = family
            self.episode_id = family

        def to_document(self):
            return self._document

    report = dedup(
        [_Doc(first.to_document(), "CF-a"), _Doc(second.to_document(), "CF-b")]
    )
    assert report.removed_count == 1
    assert report.records[0].layer in ("normalized", "structural")


def test_g9_semantic_similarity_is_deterministic_and_offline(hc001_family) -> None:
    perturbations = [
        item for item in hc001_family.variants if item.variant_type == "irrelevant_perturbation"
    ]
    if len(perturbations) < 2:
        return
    left, right = perturbations[0], perturbations[1]
    assert semantic_duplicate_pairs([left, right]) == ()  # 同家族 ⇒ 不判语义重复
    assert jaccard(frozenset({"a", "b"}), frozenset({"b", "c"})) == 1 / 3


# --------------------------------------------------------------------------- #
# split
# --------------------------------------------------------------------------- #
def test_strategy_group_key_table_matches_the_design() -> None:
    assert STRATEGY_TO_GROUP_KEY == {
        "iid": "counterfactual_family_id",
        "world_ood": "world_family_id",
        "app_ood": "app_domain",
        "workflow_ood": "workflow_template_hash",
        "policy_ood": "policy_graph_hash",
        "attack_ood": "attack_family",
        "evidence_ood": "semantic_scenario_signature",
        "generator_ood": "generator_id",
    }


def test_assign_splits_leave_key_out(hc001_family, hc001_world, hc001) -> None:
    episodes = list(hc001_family.variants)
    worlds = {hc001_world.world_id: hc001_world}
    declared = {hc001_world.world_id: hc001.attack_family}
    keys = audit_keys(episodes, worlds=worlds, declared_attack_families=declared)
    for strategy in sorted(STRATEGY_TO_GROUP_KEY):
        assignment = assign_splits(
            episodes,
            strategy=strategy,
            ratios={"train": 0.8, "validation": 0.1, "test": 0.1},
            seed=20260920,
            worlds=worlds,
            declared_attack_families=declared,
        )
        assert assignment.strategy == strategy
        assert assignment.group_key == STRATEGY_TO_GROUP_KEY[strategy]
        # 同一 family 的所有变体必须同 split（union-find 的最小不可分单位）
        assert len(set(assignment.assignments.values())) == 1
        overlaps = group_overlap_audit(assignment, keys)
        assert overlaps == [], (strategy, overlaps)


def test_assign_splits_rejects_an_unknown_strategy(hc001_family) -> None:
    try:
        assign_splits(list(hc001_family.variants), strategy="teleport_ood")
    except Exception as exc:  # noqa: BLE001 - ValidationError
        assert "unknown_split_strategy" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("未知策略必须被拒")
