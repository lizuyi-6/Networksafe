"""证据掩蔽：7 个 level 按 §9.4 映射的确定期望 + "藏掉 required evidence ⇒ insufficient"。

任务书的硬要求单独钉死：**mask 掉 required evidence 必须得到
``observable_decision == "insufficient_evidence"``**——oracle 是唯一判官，测试直接
跑 oracle，不相信掩蔽器自己的说法。

``contradictory`` / ``stale`` / ``attacker_controlled`` 三个 level 只能由**世界目录
声明**构造（掩蔽只改可见性，藏不出矛盾、造不出陈旧），因此用
:func:`degraded_world`；世界支撑不了请求的 level 时必须抛 :class:`MaskingError`
并带 reason code，绝不悄悄降级。
"""
from __future__ import annotations

import pytest
from asw_worlds import make_action, run, with_entities
from asw_expansion import degraded_world, ev, masking_world

from security_world.expansion import (
    MASKING_LEVELS,
    MaskingError,
    classify_evidence_level,
    consulted_facts_from_output,
    mask_evidence,
)
from security_world.oracle import EvidenceView, build_fact_table, run_oracle
from security_world.expansion.masking import _mirror_fact_table
from security_world.model import canonical_json


def _masking_setup():
    world = masking_world()
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    base = run(world, action)
    consulted = consulted_facts_from_output(base)
    view = EvidenceView.from_world(world)
    return world, action, base, consulted, view


def _degraded_setup():
    world = degraded_world()
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    base = run(world, action)
    consulted = consulted_facts_from_output(base)
    view = EvidenceView.from_world(world)
    return world, action, base, consulted, view


# --------------------------------------------------------------------------- #
# consulted_facts 的来源：oracle 求值期动态集合
# --------------------------------------------------------------------------- #


def test_consulted_facts_come_from_dynamic_oracle_trace():
    """consulted_facts 取自 decision_trace 的 evidence.sufficiency 步骤（B3）。"""
    world, action, base, consulted, _view = _masking_setup()
    assert consulted == frozenset({"resource.RES-001.owner", "session.SES-001.revoked"})
    # 自建立身份字段（action.actor.actor_id）不在集合里。
    assert "actor.ACT-003.actor_id" not in consulted


def test_consulted_facts_from_output_missing_step_is_empty():
    class _Bare:
        decision_trace = ()

    assert consulted_facts_from_output(_Bare()) == frozenset()


def test_consulted_facts_from_output_malformed_rejected():
    class _Bad:
        decision_trace = (
            {"rule": "evidence.sufficiency", "operands": {"consulted_facts": {"a": 1}}},
        )

    with pytest.raises(MaskingError) as excinfo:
        consulted_facts_from_output(_Bad())
    assert excinfo.value.reason_code == "consulted_facts_malformed"


# --------------------------------------------------------------------------- #
# 任务书硬要求：mask 掉 required evidence ⇒ insufficient_evidence
# --------------------------------------------------------------------------- #


def test_masking_required_evidence_yields_insufficient_evidence():
    world, action, base, consulted, view = _masking_setup()
    assert base.observable_decision == "attack"  # base 可判定
    masked = mask_evidence(view, level="insufficient", seed=17, consulted_facts=consulted)
    hidden_ids = {item.evidence_id for item in masked.hidden}
    # H(f) == ∅：被选中的 consulted 事实一条可见证据都不剩。
    emptied = [
        fact
        for fact in consulted
        if not any(item.asserts_ref == fact for item in masked.visible)
    ]
    assert emptied, "insufficient 掩蔽必须清空至少一个 consulted 事实的可见证据"
    assert all(
        item.evidence_id in hidden_ids for item in view.visible if item.asserts_ref == emptied[0]
    )
    output = run_oracle(world, action, masked)
    assert output.observable_decision == "insufficient_evidence"
    assert output.world_truth == "attack"  # 真值不受掩蔽影响（I-2）
    reasons = {entry["decision_fact"]: entry["reason"] for entry in output.missing_evidence}
    assert reasons[emptied[0]] == "not_rendered"
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "insufficient"


def test_masking_is_seed_deterministic():
    world, action, _base, consulted, view = _masking_setup()
    first = mask_evidence(view, level="insufficient", seed=23, consulted_facts=consulted)
    second = mask_evidence(view, level="insufficient", seed=23, consulted_facts=consulted)
    assert canonical_json(first.view_id("W", "A")) == canonical_json(second.view_id("W", "A"))


# --------------------------------------------------------------------------- #
# 七个 level 的确定期望（§9.4 / configs.level_to_hidden_set）
# --------------------------------------------------------------------------- #


def test_complete_hides_nothing():
    world, action, _base, consulted, view = _masking_setup()
    masked = mask_evidence(view, level="complete", seed=1, consulted_facts=consulted)
    assert {item.evidence_id for item in masked.visible} == {
        item.evidence_id for item in view.visible
    }
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "complete"
    assert run_oracle(world, action, masked).observable_decision == "attack"


def test_minimally_sufficient_keeps_exactly_one_establishing_item():
    world, action, _base, consulted, view = _masking_setup()
    masked = mask_evidence(view, level="minimally_sufficient", seed=1, consulted_facts=consulted)
    by_fact: dict[str, list] = {}
    for item in masked.visible:
        by_fact.setdefault(item.asserts_ref, []).append(item)
    for fact in consulted:
        assert len(by_fact[fact]) == 1, fact
        assert by_fact[fact][0].trust_level in ("trusted", "semi_trusted")
    # 其余全隐藏（含非 consulted 的 EV-NC 与 untrusted 的 EV-OWN-U）。
    assert {item.evidence_id for item in masked.hidden} >= {"EV-NC", "EV-OWN-U"}
    output = run_oracle(world, action, masked)
    assert output.observable_decision == "attack"  # 最少证据仍可判定
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "minimally_sufficient"


def test_partially_missing_is_a_decoy_that_holds_the_verdict():
    world, action, base, consulted, view = _masking_setup()
    masked = mask_evidence(view, level="partially_missing", seed=1, consulted_facts=consulted)
    hidden = {item.evidence_id for item in masked.hidden}
    assert "EV-NC" in hidden  # 藏的是非 consulted 证据
    for fact in consulted:
        assert any(
            item.asserts_ref == fact and item.trust_level in ("trusted", "semi_trusted")
            for item in masked.visible
        ), fact
    output = run_oracle(world, action, masked)
    assert output.observable_decision == base.observable_decision == "attack"
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "partially_missing"


def test_contradictory_level_requires_world_declared_contradiction():
    world, action, _base, consulted, view = _degraded_setup()
    masked = mask_evidence(view, level="contradictory", seed=1, consulted_facts=consulted)
    output = run_oracle(world, action, masked)
    assert output.observable_decision == "insufficient_evidence"
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "contradictory"


def test_contradictory_level_rejected_when_world_is_consistent():
    _world, _action, _base, consulted, view = _masking_setup()
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="contradictory", seed=1, consulted_facts=consulted)
    assert excinfo.value.reason_code == "level_rule_not_achieved"


def test_stale_level_requires_stale_evidence_and_requires_fresh_policy():
    world, action, _base, consulted, view = _degraded_setup()
    masked = mask_evidence(
        view, level="stale", seed=1, consulted_facts=consulted, world=world, action=action
    )
    # fresh 的 establishing 项被藏掉，只剩 stale 的 EV-OWN-B。
    assert "EV-OWN-A" in {item.evidence_id for item in masked.hidden}
    output = run_oracle(world, action, masked)
    assert output.observable_decision == "insufficient_evidence"
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "stale"


def test_stale_level_rejected_without_requires_fresh_policy():
    world = degraded_world()
    world = with_entities(world, policies=(dict(world.policies[0].to_document(), requires_fresh=False),))
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    view = EvidenceView.from_world(world)
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="stale", seed=1, consulted_facts=consulted, world=world, action=action)
    assert excinfo.value.reason_code == "no_requires_fresh_policy"


def test_stale_level_rejected_when_world_declares_no_stale_evidence():
    _world, _action, _base, consulted, view = _masking_setup()
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="stale", seed=1, consulted_facts=consulted)
    assert excinfo.value.reason_code == "world_declares_no_stale_evidence"


def test_attacker_controlled_level():
    world, action, _base, consulted, view = _degraded_setup()
    masked = mask_evidence(view, level="attacker_controlled", seed=1, consulted_facts=consulted)
    remaining = [item for item in masked.visible if item.asserts_ref == "resource.RES-001.owner"]
    assert remaining and all(item.attacker_controllable for item in remaining)
    output = run_oracle(world, action, masked)
    assert output.observable_decision == "insufficient_evidence"
    assert classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    ) == "attacker_controlled"


def test_attacker_controlled_level_rejected_without_attacker_evidence():
    _world, _action, _base, consulted, view = _masking_setup()
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="attacker_controlled", seed=1, consulted_facts=consulted)
    assert excinfo.value.reason_code == "world_declares_no_attacker_controllable_evidence"


def test_minimally_sufficient_rejected_when_fact_has_no_establishing_evidence():
    """某 consulted 事实没有任何 establishing 可见证据 ⇒ 最小充分不可构造。"""
    world = masking_world()
    world = with_entities(
        world,
        evidence=(
            ev("EV-SESS", "session.SES-001.revoked", False),
            ev("EV-NC", "actor.ACT-001.tenant", "TEN-001"),
        ),
    )
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    view = EvidenceView.from_world(world)
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="minimally_sufficient", seed=1, consulted_facts=consulted)
    assert excinfo.value.reason_code == "consulted_fact_without_establishing_evidence"


def test_partially_missing_rejected_without_non_consulted_evidence():
    world = masking_world()
    world = with_entities(
        world,
        evidence=(
            ev("EV-OWN", "resource.RES-001.owner", "ACT-001"),
            ev("EV-SESS", "session.SES-001.revoked", False),
        ),
    )
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    view = EvidenceView.from_world(world)
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="partially_missing", seed=1, consulted_facts=consulted)
    assert excinfo.value.reason_code == "no_non_consulted_evidence"


# --------------------------------------------------------------------------- #
# 输入校验与视图卫生
# --------------------------------------------------------------------------- #


def test_unknown_level_rejected():
    _world, _action, _base, consulted, view = _masking_setup()
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="everything", seed=1, consulted_facts=consulted)
    assert excinfo.value.reason_code == "unknown_level"
    assert set(MASKING_LEVELS) == {
        "complete",
        "partially_missing",
        "minimally_sufficient",
        "insufficient",
        "contradictory",
        "stale",
        "attacker_controlled",
    }


@pytest.mark.parametrize("bad", [None, "resource.RES-001.owner", ("",), (1,)])
def test_invalid_consulted_facts_rejected(bad):
    _world, _action, _base, _consulted, view = _masking_setup()
    with pytest.raises(MaskingError) as excinfo:
        mask_evidence(view, level="complete", seed=1, consulted_facts=bad)
    assert excinfo.value.reason_code == "invalid_consulted_facts"


def test_mask_does_not_mutate_input_view_and_flips_flags():
    _world, _action, _base, consulted, view = _masking_setup()
    before_visible = [item.evidence_id for item in view.visible]
    before_hidden = [item.evidence_id for item in view.hidden]
    masked = mask_evidence(view, level="minimally_sufficient", seed=1, consulted_facts=consulted)
    assert [item.evidence_id for item in view.visible] == before_visible
    assert [item.evidence_id for item in view.hidden] == before_hidden
    # S7：隐藏项的权威 flag 被改写为 false，可见项为 true。
    assert all(item.visible_in_observation for item in masked.visible)
    assert all(not item.visible_in_observation for item in masked.hidden)


def test_mirror_fact_table_agrees_with_oracle():
    """镜像事实表与 L3 的 build_fact_table 逐字节一致（防 L3 演进后静默漂移）。"""
    world, action, _base, consulted, view = _masking_setup()
    from security_world.oracle import TRUSTED_ESTABLISHES

    authoritative = build_fact_table(world, action, view, consulted_facts=consulted)
    mirrored = _mirror_fact_table(
        view, consulted, TRUSTED_ESTABLISHES, requires_fresh=False
    )
    assert canonical_json(authoritative) == canonical_json(mirrored)


def test_classify_prefers_downgrade_over_hiding_shape():
    """有事实建不起来时，level 反映证据问题，而不是"藏了什么"。"""
    world, action, _base, consulted, view = _masking_setup()
    masked = mask_evidence(view, level="insufficient", seed=1, consulted_facts=consulted)
    # 即使隐藏集合形状像 minimally_sufficient，insufficient 优先。
    label = classify_evidence_level(
        masked, baseline=view, consulted_facts=consulted, world=world, action=action
    )
    assert label == "insufficient"
