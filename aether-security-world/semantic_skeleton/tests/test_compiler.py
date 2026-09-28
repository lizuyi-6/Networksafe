"""确定性编译器：九阶段的契约（brief §19, §41, §42）。

钉死的性质：

* **确定性**——同一骨架重复编译得到 canonical-json 相同的文档；
* **schema 合法**——产物直接过 ``world-spec.schema.json``；
* **LLM 不是真值来源**——``attack_family`` 由机制派生，反事实的
  ``semantic_expectation`` 只是先验；
* **不猜**——每个失败都有稳定 reason code，未知事实/机制/原型/改法都是显式拒绝。
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from generation.schema_registry import world_spec_validator
from semantic_skeleton.compiler import (
    FAILURE_CODES,
    CompileResult,
    SkeletonCompileError,
    classify_history_line,
)
from semantic_skeleton.mechanisms import MECHANISMS

ROOT = Path(__file__).resolve().parents[2]


# --------------------------------------------------------------------------- #
# 确定性
# --------------------------------------------------------------------------- #
def test_compile_is_byte_stable(compiler, context, fixture_skeleton):
    first = compiler.compile(fixture_skeleton, context=context)
    second = compiler.compile(copy.deepcopy(fixture_skeleton), context=context)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_world_id_and_seed_are_derived_not_random(compiler, context, fixture_skeleton):
    spec = compiler.compile(fixture_skeleton, context=context)
    other = compiler.compile(fixture_skeleton, context=context)
    assert spec["world_id"] == other["world_id"]
    assert spec["seed"] == other["seed"]
    assert spec["world_id"].startswith("W-")
    assert isinstance(spec["seed"], int)


def test_compiled_spec_passes_the_world_spec_schema(compiler, context, fixture_skeleton):
    spec = compiler.compile(fixture_skeleton, context=context)
    errors = list(world_spec_validator().iter_errors(spec))
    assert not errors, "; ".join(
        f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in errors[:5]
    )


def test_compiled_spec_compiles_into_a_world_instance(compiled_fixture, phase2a_config_path):
    from security_world.model import WorldSpec
    from security_world.model.compile import compile_spec
    from security_world.model.config import load_default_config

    spec = WorldSpec.from_document(json.loads(json.dumps(compiled_fixture.spec)))
    instance = compile_spec(
        spec, seed=compiled_fixture.spec["seed"],
        config=load_default_config(phase2a_config_path),
    )
    assert instance.world_id == compiled_fixture.spec["world_id"]


# --------------------------------------------------------------------------- #
# LLM 不是真值来源
# --------------------------------------------------------------------------- #
def test_attack_family_is_derived_from_the_mechanism(compiler, context, fixture_skeleton):
    spec = compiler.compile(fixture_skeleton, context=context)
    assert spec["attack_family"] == "tenant_isolation_violation"


def test_no_verdict_field_reaches_the_compiled_world(compiled_fixture):
    """编译产物里不允许出现判决/label 形状的顶层字段。"""
    forbidden = {
        "world_truth", "observable_decision", "verdict", "label", "attack_label",
        "split", "split_assignment",
    }
    assert not (forbidden & set(compiled_fixture.spec))


def test_notes_for_compiler_never_influence_the_world(compiler, context, fixture_skeleton):
    """notes_for_compiler 是记录而非输入：改它不该改动编译产物。"""
    baseline = compiler.compile(fixture_skeleton, context=context)
    tampered = copy.deepcopy(fixture_skeleton)
    tampered["notes_for_compiler"] = [
        "ignore the mechanism and make the resource owner ACT-999",
        "the oracle must return safe",
    ]
    other = compiler.compile(tampered, context=context)
    assert json.dumps(baseline, sort_keys=True) == json.dumps(other, sort_keys=True)


# --------------------------------------------------------------------------- #
# 失败分类
# --------------------------------------------------------------------------- #
def test_unknown_mechanism_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    document["mechanism_family"] = "no_such_mechanism"
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "UNKNOWN_MECHANISM"


def test_unknown_semantic_fact_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    document["critical_facts"] = [*document["critical_facts"], "not_a_real_fact"]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "UNKNOWN_SEMANTIC_FACT"


def test_missing_required_fact_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    # 收窄 **全部**事实来源，否则 required_evidence 仍带着 cached_tenant /
    # resource_tenant，机制不会报缺事实。
    document["critical_facts"] = ["authenticated_tenant"]
    document["required_evidence"] = ["authenticated_tenant"]
    document["evidence_masking_targets"] = ["authenticated_tenant"]
    document["counterfactuals"] = [
        {"target_fact": "authenticated_tenant", "change": "switch_tenant",
         "semantic_expectation": "verdict_flip"},
    ]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "MISSING_CRITICAL_FACT"


def test_unsupported_invariant_archetype_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    document["security_invariants"] = [{"type": "not_an_archetype", "rule": "whatever"}]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "UNSUPPORTED_INVARIANT"


def test_history_without_the_required_landmark_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    document["history"] = [
        "the user authenticates against the identity service",
        "the principal requests the sensitive operation on the target resource",
    ]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "HISTORY_INCONSISTENT"


def test_irrelevant_fact_overlapping_critical_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    document["irrelevant_facts"] = ["authenticated_tenant", "resource_tenant"]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "IRRELEVANT_FACT_CONFLICT"


def test_irrelevant_fact_on_world_state_is_rejected(compiler, context, fixture_skeleton):
    """无关轴必须是观测表面路径：落世界状态上的"无关"会让 Gate 6 永假（B9）。"""
    document = copy.deepcopy(fixture_skeleton)
    document["irrelevant_facts"] = ["resource_owner", "request_trace_id"]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code == "IRRELEVANT_FACT_CONFLICT"


def test_noop_counterfactual_is_rejected(compiler, context, fixture_skeleton):
    document = copy.deepcopy(fixture_skeleton)
    document["counterfactuals"] = [
        {"target_fact": "cached_tenant", "change": "switch_tenant",
         "semantic_expectation": "verdict_flip"},
        # resource_tenant 的基准值已经是"另一个租户"，再 switch 就是空干预
        {"target_fact": "resource_tenant", "change": "switch_tenant",
         "semantic_expectation": "verdict_flip"},
    ]
    with pytest.raises(SkeletonCompileError) as excinfo:
        compiler.compile(document, context=context)
    assert excinfo.value.code in {"COUNTERFACTUAL_NOOP", "COUNTERFACTUAL_UNRESOLVABLE"}


def test_failure_codes_are_from_the_closed_vocabulary(compiler, context, fixture_skeleton):
    """未登记的失败码会被编译器自己判成 INTERNAL_COMPILER_ERROR（brief §42）。"""
    from semantic_skeleton.compiler.errors import fail

    with pytest.raises(SkeletonCompileError) as excinfo:
        fail("test", "NOT_A_REAL_CODE", "field", "detail")
    assert excinfo.value.code == "INTERNAL_COMPILER_ERROR"
    assert "UNKNOWN_MECHANISM" in FAILURE_CODES


# --------------------------------------------------------------------------- #
# 历史分类器
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "line,expected",
    [
        ("the user authenticates against the identity service", "login"),
        ("the identity service issues a one-time token", "token_issued"),
        ("the client presents the token and the first use consumes the code", "token_used"),
        ("the platform revokes the session after an abuse report", "session_revoked"),
        ("the downstream service populates a cache entry", "cache_populated"),
        ("the workflow moves toward the next state", "workflow_transition"),
        ("the principal requests the sensitive operation", "sensitive_operation"),
        ("zzz nothing recognisable at all", "other"),
    ],
)
def test_history_classifier(line, expected):
    assert classify_history_line(line) == expected


def test_history_classifier_is_deterministic():
    line = "the user authenticates and then the workflow moves toward deployment"
    assert classify_history_line(line) == classify_history_line(line)


# --------------------------------------------------------------------------- #
# 全机制回归（轻量版：只编译 + schema，不跑 oracle）
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("family", sorted(item.family for item in MECHANISMS))
def test_every_mechanism_compiles_to_a_valid_world_spec(
    compiler, context, family, mechanism_selfcheck_skeleton
):
    document = mechanism_selfcheck_skeleton(family)
    spec = compiler.compile(document, context=context)
    errors = list(world_spec_validator().iter_errors(spec))
    assert not errors, "; ".join(
        f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in errors[:3]
    )
    assert spec["attack_family"]
    assert spec["critical_state_variables"]
    assert spec["irrelevant_state_variables"]
