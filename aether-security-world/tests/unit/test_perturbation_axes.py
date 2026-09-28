"""无关扰动轴：每个轴必须改变观测、绝不触碰世界状态（设计 §9.2 / B9）。

对 :data:`SUPPORTED_AXES` 的每个轴断言三件事：

1. **观测真的变了**——``canonical_json(model_visible)`` 前后不同（引擎自己也挡
   no-op 扰动：一个什么都不改的"扰动"会让 verdict_invariant 测试假通过）；
2. **世界零变化**——``diff_worlds(world, world).is_empty()``（世界是 frozen
   dataclass，函数也只读它）；
3. **verdict 不变**——同一 (world, action, evidence_view) 的 oracle 输出逐字节
   相同（充分性判定的 metamorphic 版本见 ``tests/metamorphic``）。
"""
from __future__ import annotations

import pytest
from asw_worlds import make_action, run
from asw_expansion import ownership_world, timeline_for

from security_world.expansion import (
    SUPPORTED_AXES,
    Observation,
    PerturbationError,
    axis_change,
    irrelevant_perturbation,
    render,
)
from security_world.expansion.config import ExpansionConfig
from security_world.expansion.diff import diff_worlds
from security_world.model import canonical_json


def _observation(world, action, *, renderer: str = "http_request"):
    config = ExpansionConfig.default()
    return render(
        world,
        action,
        renderer=renderer,
        seed=41,
        allowlist=config.projection_allowlist,
        timeline=timeline_for(),
    )


@pytest.mark.parametrize("axis", SUPPORTED_AXES)
def test_axis_changes_observation_but_not_world(axis):
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    perturbed = irrelevant_perturbation(world, observation, axis=axis, seed=7)

    before = canonical_json(observation.to_model_visible())
    after = canonical_json(perturbed.to_model_visible())
    assert before != after, f"轴 {axis} 没有改变观测"
    assert diff_worlds(world, world).is_empty()
    # 证据与时间线投影不随表面扰动变化（只有 request 面在动）。
    assert perturbed.evidence == observation.evidence
    assert perturbed.timeline == observation.timeline
    assert perturbed.renderer == observation.renderer
    assert perturbed.current_time == observation.current_time


@pytest.mark.parametrize("axis", SUPPORTED_AXES)
def test_axis_holds_verdict(axis):
    """同一 (world, action, view) ⇒ oracle 输出逐字节相同（verdict 不变）。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    base = run(world, action)
    irrelevant_perturbation(world, _observation(world, action), axis=axis, seed=7)
    again = run(world, action)
    assert canonical_json(base.to_document()) == canonical_json(again.to_document())


@pytest.mark.parametrize("axis", SUPPORTED_AXES)
def test_axis_is_deterministic(axis):
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    first = irrelevant_perturbation(world, observation, axis=axis, seed=99)
    second = irrelevant_perturbation(world, observation, axis=axis, seed=99)
    assert canonical_json(first.to_model_visible()) == canonical_json(second.to_model_visible())


#: 渲染出的文本中带有完整 header 集合的渲染器——顺序类轴（``headers.order`` /
#: ``rendering.header_order``）只在这些渲染器上真实可观测。日志/轨迹类渲染器
#: 按格式只暴露少量 header（UA 等），这是 8 种 renderer 的表面差异，不是缺陷。
HEADER_CARRYING_RENDERERS = frozenset({
    "structured_state",
    "http_request",
    "api_gateway_record",
    "mixed_evidence_bundle",
})

#: 只在 header 承载面上可观测的轴。
HEADER_ORDER_AXES = frozenset({
    "observation.request.headers.order",
    "observation.rendering.header_order",
})


@pytest.mark.parametrize(
    "renderer",
    [
        "structured_state",
        "http_request",
        "reverse_proxy_log",
        "application_log",
        "audit_log",
        "api_gateway_record",
        "multi_event_trace",
        "mixed_evidence_bundle",
    ],
)
@pytest.mark.parametrize("axis", SUPPORTED_AXES)
def test_axis_is_never_a_silent_noop(renderer, axis):
    """每个 (renderer, axis) 组合：要么真的改变观测，要么显式报错——绝不静默空扰动。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action, renderer=renderer)
    before = canonical_json(observation.to_model_visible())
    try:
        perturbed = irrelevant_perturbation(world, observation, axis=axis, seed=5)
    except PerturbationError as exc:
        # 顺序类轴在不承载 header 的渲染器上必须显式失败，而不是静默通过。
        assert axis in HEADER_ORDER_AXES and renderer not in HEADER_CARRYING_RENDERERS, (
            f"{renderer} + {axis} 意外失败: {exc.reason_code}"
        )
        assert exc.reason_code == "no_op_perturbation"
        return
    assert canonical_json(perturbed.to_model_visible()) != before


@pytest.mark.parametrize("renderer", sorted(HEADER_CARRYING_RENDERERS))
@pytest.mark.parametrize("axis", sorted(HEADER_ORDER_AXES))
def test_header_order_axes_effective_on_header_carrying_renderers(renderer, axis):
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action, renderer=renderer)
    perturbed = irrelevant_perturbation(world, observation, axis=axis, seed=5)
    assert canonical_json(observation.to_model_visible()) != canonical_json(
        perturbed.to_model_visible()
    ), f"{renderer} + {axis} 是空扰动"


def test_world_state_path_axis_rejected():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    with pytest.raises(PerturbationError) as excinfo:
        irrelevant_perturbation(world, observation, axis="resource.RES-001.owner", seed=1)
    assert excinfo.value.reason_code == "axis_not_observation_path"


def test_unsupported_but_wellshaped_axis_rejected():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    with pytest.raises(PerturbationError) as excinfo:
        irrelevant_perturbation(world, observation, axis="observation.request.headers.Cookie", seed=1)
    assert excinfo.value.reason_code == "unsupported_axis"


@pytest.mark.parametrize("axis", ["observation.request", "observation.", "observation.request."])
def test_malformed_axis_rejected(axis):
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    with pytest.raises(PerturbationError) as excinfo:
        irrelevant_perturbation(world, observation, axis=axis, seed=1)
    assert excinfo.value.reason_code == "axis_not_observation_path"


def test_observation_without_surface_rejected():
    world = ownership_world()
    bare = Observation(
        renderer="http_request",
        current_time="2026-09-20T08:00:00Z",
        request={"method": "GET", "path": "/api/read"},
        evidence=(),
        timeline=(),
        surface=None,
    )
    with pytest.raises(PerturbationError) as excinfo:
        irrelevant_perturbation(world, bare, axis="observation.request.headers.User-Agent", seed=1)
    assert excinfo.value.reason_code == "observation_without_surface"


def test_axis_change_reports_before_and_after():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    axis = "observation.request.headers.User-Agent"
    perturbed = irrelevant_perturbation(world, observation, axis=axis, seed=13)
    change = axis_change(axis, observation.surface or {}, perturbed.surface or {})
    assert change.axis == axis
    assert change.before != change.after
    assert change.before == observation.request["headers"]["User-Agent"]
    assert change.after == perturbed.request["headers"]["User-Agent"]


def test_header_order_axis_only_reorders_rendered_text():
    """``rendering.header_order`` 只改文本行序，结构化 header 键序不变。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    perturbed = irrelevant_perturbation(
        world, observation, axis="observation.rendering.header_order", seed=3
    )
    assert list(perturbed.request["headers"]) == list(observation.request["headers"])
    assert perturbed.request["rendered_text"] != observation.request["rendered_text"]


def test_structured_key_order_axis_changes_structured_order():
    """``request.headers.order`` 改结构化键序（并同源改文本行序）。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _observation(world, action)
    perturbed = irrelevant_perturbation(
        world, observation, axis="observation.request.headers.order", seed=3
    )
    assert sorted(perturbed.request["headers"]) == sorted(observation.request["headers"])
    assert list(perturbed.request["headers"]) != list(observation.request["headers"])
