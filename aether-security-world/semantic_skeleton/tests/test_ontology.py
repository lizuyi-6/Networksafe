"""语义事实本体的不变量（brief §22）。

本体是 LLM 唯一被允许使用的安全语义变量表，因此它自己的性质必须是可断言的：
名字唯一、槽合法、轴模式命中 Phase 2A 白名单、观测表面事实永远不当关键轴。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from semantic_skeleton.ontology import (
    FACTS,
    SLOTS,
    SURFACE_AXIS_PATHS,
    axis_capable_facts,
    fact_names,
    groups_summary,
    is_known_fact,
    semantic_fact,
    surface_axis_path,
    surface_facts,
    unknown_facts,
)
from semantic_skeleton.vocabularies import (
    ACTOR_TYPES,
    RESOURCE_TYPES,
    SERVICE_TYPES,
    actor_type,
    resource_type,
    service_type,
    unknown_actor_types,
    unknown_resource_types,
    unknown_service_types,
    vocabulary_summary,
)

ROOT = Path(__file__).resolve().parents[2]


def test_fact_names_are_unique():
    names = [fact.name for fact in FACTS]
    assert len(names) == len(set(names)), "语义事实名必须唯一"
    assert tuple(sorted(names)) == fact_names()


def test_every_fact_has_a_declared_slot_and_group():
    for fact in FACTS:
        assert fact.slot in SLOTS, f"{fact.name} 的槽 {fact.slot!r} 不在 SLOTS"
        assert fact.group, f"{fact.name} 没有分组"
        assert fact.value_kind, f"{fact.name} 没有取值种类"
        assert fact.field_path, f"{fact.name} 没有字段路径"


def test_every_axis_pattern_matches_the_phase2a_whitelist():
    """axis_pattern 必须命中 Phase 2A 的 critical_axes_whitelist，否则编译期拒收。"""
    config = json.loads((ROOT / "configs" / "phase2a.json").read_text(encoding="utf-8"))
    whitelist = config["expansion"]["critical_axes_whitelist"]
    import fnmatch

    for fact in FACTS:
        if not fact.axis_pattern:
            continue
        assert any(
            fnmatch.fnmatchcase(fact.axis_pattern, pattern) for pattern in whitelist
        ), f"{fact.name} 的轴模式 {fact.axis_pattern!r} 不在 Phase 2A 白名单里"


def test_surface_facts_are_never_axis_capable():
    """观测表面事实永远不能当关键轴：扰动它们会改观测而不是世界状态。"""
    for name in surface_facts():
        fact = semantic_fact(name)
        assert fact is not None
        assert not fact.axis_pattern, f"表面事实 {name} 不该有 axis_pattern"
        assert name not in axis_capable_facts()


def test_every_surface_fact_maps_to_a_supported_perturbation_axis():
    from security_world.expansion.perturbation import SUPPORTED_AXES

    for name in surface_facts():
        path = surface_axis_path(name)
        assert path is not None, f"表面事实 {name} 没有轴路径"
        assert path in SUPPORTED_AXES, (
            f"表面事实 {name} 映射到 {path!r}，而扰动引擎没实现它"
            "（会得到 unsupported_axis，无关变体被静默丢掉）"
        )


def test_surface_axis_paths_are_injective():
    paths = [SURFACE_AXIS_PATHS[name] for name in surface_facts()]
    assert len(paths) == len(set(paths)), "两个表面事实不得映射到同一条观测轴"


def test_unknown_facts_detection():
    assert unknown_facts(["authenticated_tenant", "not_a_fact"]) == ("not_a_fact",)
    assert unknown_facts("a string is not a list") == ()
    assert unknown_facts(None) == ()
    assert is_known_fact("authenticated_tenant")
    assert not is_known_fact("authenticated_tennant")


def test_groups_summary_covers_every_fact():
    summary = groups_summary()
    covered = {name for names in summary.values() for name in names}
    assert covered == set(fact_names())


# --------------------------------------------------------------------------- #
# 语义类型词表
# --------------------------------------------------------------------------- #
def test_vocabularies_map_into_the_schema_enums():
    from security_world.model.entities import (
        ACTOR_TYPES as SCHEMA_ACTOR_TYPES,
        RESOURCE_TYPES as SCHEMA_RESOURCE_TYPES,
        SERVICE_TYPES as SCHEMA_SERVICE_TYPES,
    )

    for semantic, schema in ACTOR_TYPES.items():
        assert schema in SCHEMA_ACTOR_TYPES, f"{semantic} -> {schema} 不是合法 actor_type"
    for semantic, schema in RESOURCE_TYPES.items():
        assert schema in SCHEMA_RESOURCE_TYPES, f"{semantic} -> {schema} 不是合法 resource_type"
    for semantic, schema in SERVICE_TYPES.items():
        assert schema in SCHEMA_SERVICE_TYPES, f"{semantic} -> {schema} 不是合法 service_type"


def test_vocabulary_lookups_and_unknown_detection():
    assert actor_type("ordinary_user") == "user"
    assert actor_type("nope") is None
    assert resource_type("invoice") == "invoice"
    assert service_type("identity_service") == "auth_provider"
    assert unknown_actor_types(["ordinary_user", "nope"]) == ("nope",)
    assert unknown_resource_types(["invoice"]) == ()
    assert unknown_service_types(["identity_service", "ghost"]) == ("ghost",)
    summary = vocabulary_summary()
    assert set(summary) == {"actor_types", "resource_types", "service_types"}
