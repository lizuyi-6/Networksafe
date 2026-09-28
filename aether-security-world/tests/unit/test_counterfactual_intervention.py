"""关键变量干预：只改一个决定 verdict 的状态变量，verdict 必须按先验预期翻转。

覆盖任务书要求的九类轴（owner / role / permission / workflow state / token lineage /
token used / session revoked / privilege version / tenant），每类一个场景：
base=attack ⇒ 干预后 safe，且 ``diff_worlds`` 机械证明只有那一条路径变了。

同时钉死 R4 的可证伪性：``expected_effect`` 是**先验**声明，引擎只回填
``actual_effect``；两者不符时引擎记录差异（Gate 5 之后拒绝），**绝不反向改标签**。
"""
from __future__ import annotations

import pytest
from asw_worlds import make_action, run
from asw_expansion import critical_cases, ownership_world

from security_world.expansion import (
    Intervention,
    InterventionError,
    critical_intervention,
    effect_matches,
    evaluate_intervention_effect,
    with_actual_effect,
)
from security_world.expansion.diff import diff_worlds
from security_world.model import canonical_json
from security_world.model.config import FALLBACK_CRITICAL_AXES_WHITELIST


@pytest.mark.parametrize("case", critical_cases(), ids=lambda case: case.name)
def test_single_variable_intervention_flips_verdict(case):
    """九类关键轴各一例：base=attack，单变量干预后 verdict 翻转。"""
    base = run(case.world, case.action)
    assert base.world_truth == case.base_truth, case.name

    whitelist = FALLBACK_CRITICAL_AXES_WHITELIST if case.whitelisted else None
    variant, intervention = critical_intervention(
        case.world,
        intervention_variable=case.variable,
        after=case.after,
        seed=101,
        whitelist=whitelist,
    )
    # D4：机械证明只改了一个变量。
    diff = diff_worlds(case.world, variant)
    assert diff.changed_paths == (case.variable,), case.name
    assert diff.is_single(case.variable)

    # 干预记录：before 是干预前的真值，after 是写入值。
    assert intervention.intervention_variable == case.variable
    assert canonical_json(intervention.before) == canonical_json(case.world.resolve(case.variable))
    assert canonical_json(intervention.after) == canonical_json(case.after)
    assert intervention.expected_effect == "verdict_flip"
    assert intervention.actual_effect is None  # 由 Gate 5 之前回填

    # verdict 必须真的翻转（不是"看起来能翻转"）。
    flipped = run(variant, case.action)
    assert flipped.world_truth == case.variant_truth, case.name
    effect = evaluate_intervention_effect(base, flipped)
    assert effect == "verdict_flip"
    assert effect_matches(intervention, effect)


@pytest.mark.parametrize("case", critical_cases(), ids=lambda case: case.name)
def test_intervention_is_deterministic(case):
    first, first_record = critical_intervention(
        case.world, intervention_variable=case.variable, after=case.after, seed=202
    )
    second, second_record = critical_intervention(
        case.world, intervention_variable=case.variable, after=case.after, seed=202
    )
    assert canonical_json(first.to_document()) == canonical_json(second.to_document())
    assert canonical_json(first_record.to_document()) == canonical_json(second_record.to_document())


def test_effect_classification_invariant_when_truth_unchanged():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = run(world, action)
    # 干预一个**不影响 verdict** 的变量：tenant 不在 owner-only 的读路径上。
    variant, _ = critical_intervention(
        world, intervention_variable="actor.ACT-001.tenant", after="TEN-009", seed=1
    )
    after = run(variant, action)
    assert base.world_truth == after.world_truth == "attack"
    assert evaluate_intervention_effect(base, after) == "verdict_invariant"


def test_no_op_intervention_rejected():
    world = ownership_world()
    with pytest.raises(InterventionError) as excinfo:
        critical_intervention(
            world, intervention_variable="resource.RES-001.owner", after="ACT-001", seed=1
        )
    assert excinfo.value.reason_code == "no_op_intervention"


def test_action_view_path_rejected():
    world = ownership_world()
    with pytest.raises(InterventionError) as excinfo:
        critical_intervention(
            world, intervention_variable="action.resource.owner", after="ACT-003", seed=1
        )
    assert excinfo.value.reason_code == "path_not_id_view"


def test_unresolvable_path_rejected():
    world = ownership_world()
    with pytest.raises(InterventionError) as excinfo:
        critical_intervention(
            world, intervention_variable="resource.RES-404.owner", after="ACT-003", seed=1
        )
    assert excinfo.value.reason_code == "path_unresolvable"


def test_whitelist_enforced_when_provided():
    world = ownership_world()
    with pytest.raises(InterventionError) as excinfo:
        critical_intervention(
            world,
            intervention_variable="actor.ACT-001.tenant",
            after="TEN-002",
            seed=1,
            whitelist=FALLBACK_CRITICAL_AXES_WHITELIST,
        )
    assert excinfo.value.reason_code == "axis_not_in_whitelist"


def test_whitelisted_axis_accepted():
    world = ownership_world()
    variant, _ = critical_intervention(
        world,
        intervention_variable="resource.RES-001.owner",
        after="ACT-003",
        seed=1,
        whitelist=FALLBACK_CRITICAL_AXES_WHITELIST,
    )
    assert diff_worlds(world, variant).is_single("resource.RES-001.owner")


def test_tenant_axis_is_decision_critical_but_not_in_l0_whitelist():
    """如实记录的契约缺口：``actor.*.tenant`` 决定 verdict，却不在 L0 白名单里。

    后果：spec 把 ``actor.ACT-003.tenant`` 声明为 critical 轴会被编译期 Gate 2 拒
    （``axis_not_in_whitelist``），因此该轴在**规范管线**里不可用；引擎本身
    （不给 whitelist）允许它。这里同时钉住两边的事实，防止以后有人以为是实现漏洞。
    """
    world = ownership_world()
    # 引擎侧：不给 whitelist 时 tenant 干预正常翻转 verdict。
    variant, _ = critical_intervention(
        world, intervention_variable="actor.ACT-003.tenant", after="TEN-001", seed=1
    )
    action = make_action("read", "ACT-003", resource_id="RES-001")
    # 注意：owner-only 世界里 tenant 不进读路径，verdict 不变（attack → attack）。
    assert run(variant, action).world_truth == run(world, action).world_truth == "attack"
    # 配置侧：白名单确实不含 actor.*.tenant。
    from security_world.model.config import axis_matches_whitelist

    assert not axis_matches_whitelist("actor.ACT-003.tenant", FALLBACK_CRITICAL_AXES_WHITELIST)
    with pytest.raises(InterventionError) as excinfo:
        critical_intervention(
            world,
            intervention_variable="actor.ACT-003.tenant",
            after="TEN-001",
            seed=1,
            whitelist=FALLBACK_CRITICAL_AXES_WHITELIST,
        )
    assert excinfo.value.reason_code == "axis_not_in_whitelist"


def test_with_actual_effect_and_effect_matches():
    record = Intervention(
        intervention_variable="resource.RES-001.owner",
        before="ACT-001",
        after="ACT-003",
        expected_effect="verdict_flip",
    )
    filled = with_actual_effect(record, "verdict_flip")
    assert filled.actual_effect == "verdict_flip"
    assert record.actual_effect is None  # 原记录不变
    assert effect_matches(filled, "verdict_flip")
    assert not effect_matches(filled, "verdict_invariant")
    assert Intervention.from_document(filled.to_document()) == filled


def test_intervention_rejects_unknown_effects():
    with pytest.raises(InterventionError):
        Intervention(
            intervention_variable="resource.RES-001.owner",
            before="ACT-001",
            after="ACT-003",
            expected_effect="verdict_maybe",
        )
    record = Intervention(
        intervention_variable="resource.RES-001.owner",
        before="ACT-001",
        after="ACT-003",
        expected_effect="verdict_flip",
    )
    with pytest.raises(InterventionError):
        with_actual_effect(record, "not_an_effect")


def test_evaluate_effect_rejects_output_without_world_truth():
    with pytest.raises(InterventionError) as excinfo:
        evaluate_intervention_effect({"observable_decision": "safe"}, {"world_truth": "safe"})
    assert excinfo.value.reason_code == "oracle_output_without_world_truth"
