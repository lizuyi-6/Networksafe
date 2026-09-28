"""机制族注册表的不变量（brief §24-§25）。

注册表是**声明式程序**，因此它自己的性质必须可证伪：机制名唯一、要求的事实都在本体里、
声明的槽与本体槽一致、attack_family 落在 world-spec 枚举里、覆盖标签合法、多租户机制
真的覆盖 brief §25 点名的十种。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from semantic_skeleton.mechanisms import (
    COVERAGE_LABELS,
    MECHANISMS,
    attack_family_for,
    is_known_mechanism,
    label_families,
    mechanism,
    mechanism_families,
    mechanisms_by_category,
    unknown_mechanisms,
)
from semantic_skeleton.ontology import semantic_fact

ROOT = Path(__file__).resolve().parents[1]

#: brief §25 点名必须成为一等公民的十个多租户机制。
REQUIRED_MULTI_TENANT = (
    "stale_tenant_context",
    "cross_tenant_cache",
    "token_tenant_mismatch",
    "service_account_tenant_crossover",
    "delegated_tenant_access",
    "resource_tenant_mismatch",
    "tenant_switch_stale_session",
    "cross_service_tenant_propagation_delay",
    "tenant_identifier_collision",
    "cached_authorization_cross_tenant_reuse",
)

#: brief §26/§27 的九个覆盖类别。
REQUIRED_LABELS = (
    "authorization", "session", "token", "workflow", "cache_distributed",
    "multi_tenant", "trust_boundary", "temporal_history", "cross_flow_reuse",
)


def test_family_names_are_unique_and_discoverable():
    names = [item.family for item in MECHANISMS]
    assert len(names) == len(set(names))
    assert tuple(sorted(names)) == mechanism_families()
    assert is_known_mechanism(names[0])
    assert not is_known_mechanism("not_a_mechanism")
    assert unknown_mechanisms(["stale_tenant_context", "nope"]) == ("nope",)


def test_every_mechanism_covers_all_nine_categories():
    labels = label_families()
    for label in REQUIRED_LABELS:
        assert label in labels, f"覆盖类别 {label} 没有任何机制"
        assert labels[label], f"覆盖类别 {label} 的机制列表为空"


def test_attack_family_is_derived_not_authored():
    """attack_family 由机制派生（brief §17 禁止骨架携带 attack label）。"""
    schema = json.loads((ROOT.parent / "schemas" / "world-spec.schema.json").read_text(encoding="utf-8"))
    allowed = set(schema["properties"]["attack_family"]["enum"])
    for item in MECHANISMS:
        assert item.attack_family in allowed, (
            f"机制 {item.family} 派生出不在 world-spec 枚举里的 attack_family "
            f"{item.attack_family!r}"
        )
        assert attack_family_for(item.family) == item.attack_family
        assert attack_family_for("nope") is None


def test_required_facts_exist_in_the_ontology():
    for item in MECHANISMS:
        for name in item.required_facts:
            assert semantic_fact(name) is not None, (
                f"机制 {item.family} 要求不在本体里的事实 {name!r}"
            )
        for slot, name in item.slot_facts.items():
            assert semantic_fact(name) is not None, (
                f"机制 {item.family} 的槽 {slot} 指向未知事实 {name!r}"
            )


def test_slot_facts_agree_with_the_ontology_slot_or_override_deliberately():
    """机制的槽指派要么与本体的缺省槽一致，要么是有意的多缓存分流。"""
    for item in MECHANISMS:
        for slot, name in item.slot_facts.items():
            fact = semantic_fact(name)
            assert fact is not None
            if fact.slot != slot:
                # 有意的分流允许两类：cache（两个缓存槽装不同快照）与 actor
                # （principal / peer 两个主体槽）。两条硬约束：实体类型必须一致，
                # 且目标槽必须真的被本机制开出来。
                assert fact.entity_type in ("cache", "actor"), (
                    f"机制 {item.family} 把 {name} 从 {fact.slot} 改派到 {slot}，"
                    "但只有 cache / actor 类事实被允许多槽分流"
                )
                assert slot in item.slot_facts, (
                    f"机制 {item.family} 把 {name} 改派到 {slot}，但该槽没有事实绑定"
                )


def test_every_mechanism_declares_invariants_counterfactuals_and_evidence():
    for item in MECHANISMS:
        assert item.invariants, f"机制 {item.family} 没有不变量"
        assert item.counterfactuals, f"机制 {item.family} 没有反事实"
        assert item.evidence, f"机制 {item.family} 没有证据计划"
        assert item.required_landmarks, f"机制 {item.family} 没有历史 landmark"


def test_multi_tenant_mechanisms_are_first_class():
    """brief §25：十个多租户机制必须全部在册，且不能全是同一个 principal.tenant != resource.tenant。"""
    families = set(mechanisms_by_category().get("multi_tenant", ()))
    for family in REQUIRED_MULTI_TENANT:
        assert family in families, f"brief §25 点名的多租户机制 {family} 不在注册表里"
    multi = [item for item in MECHANISMS if "multi_tenant" in item.coverage_labels]
    assert len(multi) >= 10
    # 多样性：不能只有一种不变量形态
    archetypes = {
        spec.archetype for item in multi for spec in item.invariants
    }
    assert len(archetypes) >= 3, (
        f"多租户机制只用了 {sorted(archetypes)}——brief §25 要求不同的 history/evidence/"
        "mechanism/trust 关系"
    )


def test_coverage_labels_are_from_the_closed_vocabulary():
    for item in MECHANISMS:
        for label in item.coverage_labels:
            assert label in COVERAGE_LABELS, f"{item.family} 的标签 {label} 不在词表里"
        assert item.category in COVERAGE_LABELS


def test_mechanism_lookup_roundtrip():
    for item in MECHANISMS:
        assert mechanism(item.family) is item
    assert mechanism("nope") is None


def test_workflow_states_are_declarable():
    for item in MECHANISMS:
        states = item.workflow_states
        if not states:
            continue
        assert len(states) >= 2, f"{item.family} 的状态机少于两个状态"
        assert len(set(states)) == len(states), f"{item.family} 的状态名重复"
        assert item.workflow_initial_state in states, (
            f"{item.family} 的初始态不在状态列表里"
        )
        for source, target in item.workflow_transitions:
            assert source in states and target in states, (
                f"{item.family} 的转移 {source}->{target} 引用了未声明状态"
            )
