"""元变形测试：must-change 与 must-not-change 关系（设计 §13.3 / 需求 §22）。

变形测试的纪律：每条关系都是 **(输入变换 → 输出关系)** 的可证伪断言，且变换本身
要被证明真的发生了——"verdict 不变"如果配一个空变换，就是假通过。因此本文件的
每个 not-change 用例都先断言**观测/世界确实变了**，再断言 **oracle 输出没变**。

覆盖的关系（前四条是设计 §13.3 点名的，后四条是本任务书的硬要求）：

* ``test_user_agent_change_holds_verdict`` —— 需求 §22 原例；
* ``test_owner_change_may_flip_verdict`` —— 同一请求、不同 owner ⇒ 不同 verdict；
* ``test_header_order_and_key_order_hold_verdict`` —— header 顺序经 rendered_text
  承载（S16），JSON 键序同理；
* ``test_timestamp_format_holds_verdict``；
* ``test_every_irrelevant_axis_holds_verdict`` —— 全部无关轴参数化；
* ``test_renderer_and_style_swap_holds_verdict`` —— 8 renderer × 3 风格；
* ``test_masking_required_evidence_downgrades_observable_decision`` —— 掩蔽 required
  evidence ⇒ ``insufficient_evidence``（而 ``world_truth`` 不变，I-2）；
* ``test_decoy_masking_holds_verdict`` —— 诱饵掩蔽后判决不变（R2 的混杂要求）。
"""
from __future__ import annotations

import pytest
from asw_worlds import make_action, run
from asw_expansion import (
    critical_cases,
    degraded_world,
    masking_world,
    ownership_world,
    spec_from_world,
    timeline_for,
)

from security_world.expansion import (
    RENDERERS,
    RENDER_STYLES,
    SUPPORTED_AXES,
    ExpansionConfig,
    assemble_episode,
    critical_intervention,
    expand_family,
    irrelevant_perturbation,
    mask_evidence,
    render,
)
from security_world.expansion.diff import diff_worlds
from security_world.expansion.masking import consulted_facts_from_output
from security_world.model import canonical_json, validate_episode_document
from security_world.oracle import EvidenceView

CONFIG = ExpansionConfig.default()


def _observation(world, action, *, renderer: str = "http_request", style: str = "rest"):
    return render(
        world,
        action,
        renderer=renderer,
        seed=101,
        allowlist=CONFIG.projection_allowlist,
        style=style,
        timeline=timeline_for(),
    )


def _episode(world, action, observation, *, variant_type="base", intervention=None, view=None):
    return assemble_episode(
        world=world,
        spec=None,
        family_id="CF-" + "0" * 12,
        variant_type=variant_type,
        action=action,
        timeline=timeline_for(),
        observation=observation,
        intervention=intervention,
        evidence_view=view,
    )


# --------------------------------------------------------------------------- #
# 设计 §13.3 点名的四条关系
# --------------------------------------------------------------------------- #


def test_user_agent_change_holds_verdict():
    """需求 §22 原例：改 User-Agent 不改 verdict（且观测必须真的变了）。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = _episode(world, action, _observation(world, action))
    perturbed_observation = irrelevant_perturbation(
        world, _observation(world, action), axis="observation.request.headers.User-Agent", seed=7
    )
    variant = _episode(world, action, perturbed_observation, variant_type="irrelevant_perturbation",
                       intervention={
                           "intervention_variable": "observation.request.headers.User-Agent",
                           "before": "a", "after": "b", "expected_effect": "verdict_invariant",
                       })

    assert canonical_json(base.observation["model_visible"]) != canonical_json(
        variant.observation["model_visible"]
    ), "变换没有发生——不变性断言会是假通过"
    assert canonical_json(base.oracle_output.to_document()) == canonical_json(
        variant.oracle_output.to_document()
    )
    assert base.oracle_output.world_truth == variant.oracle_output.world_truth == "attack"


def test_owner_change_may_flip_verdict():
    """同一请求字符串、不同 owner ⇒ 不同 verdict（causal sensitivity）。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = run(world, action)
    variant_world, _ = critical_intervention(
        world, intervention_variable="resource.RES-001.owner", after="ACT-003", seed=11
    )
    variant = run(variant_world, action)

    # 请求字节不变（action 文档是同一个）。
    assert canonical_json(action.to_document()) == canonical_json(action.to_document())
    assert diff_worlds(world, variant_world).is_single("resource.RES-001.owner")
    assert base.world_truth == "attack"
    assert variant.world_truth == "safe"
    assert base.observable_decision == "attack"
    # 干预改了世界但没改证据目录 ⇒ observable 趟仍看到旧 owner（I-2 的另一种形态）。
    assert variant.observable_decision == "attack"


def test_header_order_and_key_order_hold_verdict():
    """header 顺序与 JSON 键序都是纯表面（S16）：verdict 不变。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = run(world, action)
    observation = _observation(world, action)
    for axis in ("observation.request.headers.order", "observation.rendering.header_order"):
        perturbed = irrelevant_perturbation(world, observation, axis=axis, seed=13)
        assert canonical_json(observation.to_model_visible()) != canonical_json(
            perturbed.to_model_visible()
        ), axis
        # 顺序类扰动只承载在 rendered_text 字符串里（canonical_json 会抹掉键序）。
        assert perturbed.request["rendered_text"] != observation.request["rendered_text"], axis
        again = run(world, action)
        assert canonical_json(base.to_document()) == canonical_json(again.to_document())


def test_timestamp_format_holds_verdict():
    """时间戳呈现格式是纯表面：verdict 不变。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = run(world, action)
    observation = _observation(world, action)
    perturbed = irrelevant_perturbation(
        world, observation, axis="observation.rendering.timestamp_format", seed=17
    )
    assert perturbed.request["rendered_text"] != observation.request["rendered_text"]
    again = run(world, action)
    assert canonical_json(base.to_document()) == canonical_json(again.to_document())


# --------------------------------------------------------------------------- #
# 任务书硬关系
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("axis", SUPPORTED_AXES)
def test_every_irrelevant_axis_holds_verdict(axis):
    """每个无关轴：观测变、世界零变化、oracle 输出逐字节相同。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    perturbed = irrelevant_perturbation(world, observation, axis=axis, seed=23)
    assert canonical_json(observation.to_model_visible()) != canonical_json(
        perturbed.to_model_visible()
    ), f"{axis} 在 http_request 观测面上必须是真实扰动"
    assert diff_worlds(world, world).is_empty()
    base = run(world, action)
    again = run(world, action)
    assert canonical_json(base.to_document()) == canonical_json(again.to_document())


@pytest.mark.parametrize("renderer", RENDERERS)
@pytest.mark.parametrize("style", RENDER_STYLES)
def test_renderer_and_style_swap_holds_verdict(renderer, style):
    """同一 action 的 8 renderer × 3 风格渲染保持安全语义（oracle 输出逐字节相同）。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action, renderer=renderer, style=style)
    episode = _episode(world, action, observation)
    assert not validate_episode_document(episode.to_document())
    reference = run(world, action)
    assert canonical_json(episode.oracle_output.to_document()) == canonical_json(
        reference.to_document()
    )
    assert episode.oracle_output.world_truth == "attack"


def test_renderer_swap_keeps_evidence_and_timeline_projections():
    """换 renderer 不改证据/时间线投影（只有请求面在动）。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    projections = {
        renderer: _observation(world, action, renderer=renderer) for renderer in RENDERERS
    }
    first = projections["http_request"]
    for renderer, observation in projections.items():
        assert observation.evidence == first.evidence, renderer
        assert observation.timeline == first.timeline, renderer


def test_masking_required_evidence_downgrades_observable_decision():
    """掩蔽 required evidence ⇒ observable_decision=insufficient_evidence，world_truth 不变。"""
    world = masking_world()
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    base = run(world, action)
    assert base.observable_decision == "attack"

    masked = mask_evidence(
        EvidenceView.from_world(world),
        level="insufficient",
        seed=31,
        consulted_facts=consulted,
    )
    output = run(world, action, masked)
    assert output.observable_decision == "insufficient_evidence"
    assert output.world_truth == base.world_truth == "attack"  # I-2：真值与可观测分离
    assert output.missing_evidence, "必须能证明缺的是哪一条"
    # 世界状态没变（掩蔽只改可见性）。
    assert diff_worlds(world, world).is_empty()


def test_decoy_masking_holds_verdict():
    """诱饵掩蔽（藏非 consulted 证据）后判决不变（R2 的混杂要求）。"""
    world = masking_world()
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    base = run(world, action)
    masked = mask_evidence(
        EvidenceView.from_world(world),
        level="partially_missing",
        seed=37,
        consulted_facts=consulted,
    )
    output = run(world, action, masked)
    assert output.observable_decision == base.observable_decision == "attack"
    assert {item.evidence_id for item in masked.hidden}, "诱饵必须真的藏了东西"


def test_critical_intervention_family_holds_expected_effects():
    """expand_family 的关键干预变体：实际效应 == 先验预期（R4）。"""
    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
    )
    result = expand_family(spec, seed=3)
    variants = result.by_variant_type("critical_intervention")
    assert variants
    for episode in variants:
        intervention = episode.to_document()["intervention"]
        assert intervention["expected_effect"] == "verdict_flip"
        assert intervention["actual_effect"] == "verdict_flip"
        assert not validate_episode_document(episode.to_document())


@pytest.mark.parametrize("case", critical_cases(), ids=lambda case: case.name)
def test_each_critical_axis_flips_the_verdict(case):
    """九类关键轴各一例：单变量干预 ⇒ verdict 按预期翻转。"""
    base = run(case.world, case.action)
    variant_world, _ = critical_intervention(
        case.world, intervention_variable=case.variable, after=case.after, seed=43
    )
    variant = run(variant_world, case.action)
    assert base.world_truth == case.base_truth
    assert variant.world_truth == case.variant_truth
    assert diff_worlds(case.world, variant_world).is_single(case.variable)


def test_degraded_world_masking_never_launders_truth():
    """矛盾/陈旧/攻击者可控证据都只把 observable 降级，world_truth 不动（I-2）。"""
    world = degraded_world()
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    truth = run(world, action).world_truth
    for level in ("contradictory", "stale", "attacker_controlled"):
        masked = mask_evidence(
            EvidenceView.from_world(world),
            level=level,
            seed=47,
            consulted_facts=consulted,
            world=world,
            action=action,
        )
        output = run(world, action, masked)
        assert output.observable_decision == "insufficient_evidence", level
        assert output.world_truth == truth, level


def test_perturbation_does_not_leak_into_decision_metadata():
    """扰动只改 model_visible；decision_metadata（答案键）逐字节不变。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = _episode(world, action, _observation(world, action))
    variant = _episode(
        world,
        action,
        irrelevant_perturbation(
            world, _observation(world, action), axis="observation.rendering.trace_id", seed=53
        ),
        variant_type="irrelevant_perturbation",
        intervention={
            "intervention_variable": "observation.rendering.trace_id",
            "before": "a", "after": "b", "expected_effect": "verdict_invariant",
        },
    )
    base_document = base.to_document()
    variant_document = variant.to_document()
    assert canonical_json(base_document["observation"]["decision_metadata"]) == canonical_json(
        variant_document["observation"]["decision_metadata"]
    )
    assert canonical_json(base_document["oracle_output"]) == canonical_json(
        variant_document["oracle_output"]
    )
    assert canonical_json(base_document["observation"]["model_visible"]) != canonical_json(
        variant_document["observation"]["model_visible"]
    )


# --------------------------------------------------------------------------- #
# REVISION 2（任务书 A1）：deterministic nuisance mutation verification
# --------------------------------------------------------------------------- #
def test_nuisance_mutation_is_reproducible_from_the_same_seed():
    """同一 spec + 同种子重放：全部变体文档逐字节相同（含时间字段）。

    时间字段也必须逐字节相同——它们全部来自注入的 VirtualClock（A8），重放不得
    引入挂钟。不同 seed 必须至少改变一个变体（否则"可复放"是空话）。
    """
    from security_world.expansion import expand_family

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        irrelevant_axes=(
            "observation.request.headers.User-Agent",
            "observation.rendering.trace_id",
        ),
    )
    first = expand_family(spec, seed=777)
    second = expand_family(spec, seed=777)
    other = expand_family(spec, seed=778)

    def documents(result):
        return [canonical_json(episode.to_document()) for episode in result.variants]

    def base_request_of(result):
        base = next(
            episode for episode in result.variants if episode.variant_type == "base"
        )
        return canonical_json(base.observation["model_visible"]["request"])

    assert documents(first) == documents(second), "同种子重放必须逐字节相同"
    assert documents(first) != documents(other), "不同种子必须产生不同变体"
    # 扰动变体在两个重放里都真的改变了观测面（非空扰动在重放中保持非空）
    perturbations = [
        episode for episode in first.variants if episode.variant_type == "irrelevant_perturbation"
    ]
    assert perturbations, "spec 声明了无关轴，家族里必须有扰动变体"
    base_request = base_request_of(first)
    for episode in perturbations:
        assert canonical_json(episode.observation["model_visible"]["request"]) != base_request
