"""骨架装载与 brief §17 禁止字段扫描。

§17 的禁止清单是**结构性**落地的：ID 形状、canonical fact path、hash、程序-owned 键
在装载期就被拒，而不是等到编译期才发现 LLM 把 ``ACT-001`` 写进了骨架。
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from semantic_skeleton.skeleton import (
    SkeletonRejected,
    forbidden_violations,
    load_skeleton,
    loads_skeleton,
    schema_violations,
)

ROOT = Path(__file__).resolve().parents[2]


def _valid() -> dict:
    path = Path(__file__).resolve().parents[1] / "fixtures" / "stale-tenant-context.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_fixture_skeleton_loads():
    skeleton = load_skeleton(_valid())
    assert skeleton.skeleton_id == "SK-FIXTURE-001"
    assert not schema_violations(skeleton.document)
    assert not forbidden_violations(skeleton.document)


def test_entity_id_shape_is_rejected():
    document = _valid()
    document["notes_for_compiler"] = ["actor ACT-001 must be the principal"]
    codes = {item.code for item in forbidden_violations(document)}
    assert "forbidden_id_shape" in codes


def test_canonical_fact_path_is_rejected():
    document = _valid()
    document["notes_for_compiler"] = ["the decisive path is actor.principal.tenant"]
    codes = {item.code for item in forbidden_violations(document)}
    assert "forbidden_fact_path" in codes


def test_hash_shaped_string_is_rejected():
    document = _valid()
    document["notes_for_compiler"] = ["a" * 64]
    codes = {item.code for item in forbidden_violations(document)}
    assert "forbidden_hash" in codes


def test_program_owned_keys_are_rejected():
    for key in ("world_id", "attack_family", "verdict", "split", "resource_states",
                "evidence", "provenance", "schema_version", "policies", "invariants"):
        document = _valid()
        document[key] = "anything"
        codes = {item.code for item in forbidden_violations(document)}
        assert "forbidden_field" in codes, f"键 {key} 没有被 §17 扫描拒掉"


def test_verdict_vocabulary_in_structured_fields_is_rejected():
    document = _valid()
    document["mechanism_family"] = "stale_tenant_context"
    document["counterfactuals"][0]["target_fact"] = "attack"
    codes = {item.code for item in forbidden_violations(document)}
    assert "forbidden_verdict_vocabulary" in codes


def test_verdict_vocabulary_in_prose_fields_is_allowed():
    """散文字段允许出现判决词——管渲染泄漏的是 G12，不是装载期。"""
    document = _valid()
    document["failure_mechanism"] = (
        "the world is expected to be an attack once the cache lags behind the tenant switch"
    )
    assert not forbidden_violations(document)


def test_semantic_expectation_enum_is_not_treated_as_a_leak():
    document = _valid()
    assert not forbidden_violations(document)
    for item in document["counterfactuals"]:
        assert item["semantic_expectation"] in {
            "violation_removed", "violation_created", "verdict_flip",
            "verdict_invariant", "observable_downgrade",
        }


def test_schema_violations_are_reported_with_paths():
    document = _valid()
    del document["history"]
    violations = schema_violations(document)
    assert violations
    assert all(item.code == "schema_violation" for item in violations)


def test_undecodable_json_is_rejected_without_repair():
    with pytest.raises(SkeletonRejected):
        loads_skeleton('{"skeleton_id": "SK-001", "truncated')


def test_unknown_mechanism_family_is_a_schema_level_rejection():
    document = _valid()
    document["mechanism_family"] = "Not_A_Mechanism"
    with pytest.raises(SkeletonRejected):
        load_skeleton(document)


def test_non_object_document_is_rejected():
    with pytest.raises(SkeletonRejected):
        load_skeleton(["not", "an", "object"])


def test_scan_is_deterministic():
    document = _valid()
    document["notes_for_compiler"] = ["actor ACT-001 and resource.RES-001.owner"]
    first = forbidden_violations(document)
    second = forbidden_violations(copy.deepcopy(document))
    assert [item.to_document() for item in first] == [item.to_document() for item in second]
