"""观测渲染器：8 种 renderer × 三风格的 golden 结构 + 投影白名单（设计 §5.2 / B12）。

每个 renderer 断言同一组结构契约（M2 exit criteria 的"8 个 renderer golden"在
单元层的形态）：``model_visible`` 是闭集五键、``request`` 必含 method/path、
``rendered_text`` 非空且承载该 renderer 的特征、证据是七键投影、时间线无
``causal_tag``。完整 episode 再过 ``episode.schema.json``（见
``test_expansion_episode.py``）。

投影白名单（B12）用**敌对世界**证明：世界字段里出现 attack_family 值或
``POL-``/``INV-`` 前缀时渲染必须抛 :class:`RenderError`，而不是静默裁剪。
"""
from __future__ import annotations

import pytest
from asw_worlds import make_action, with_entities
from asw_expansion import ownership_world, timeline_for

from security_world.expansion import (
    RENDERERS,
    RENDER_STYLES,
    RenderError,
    Observation,
    format_timestamp,
    project_event,
    project_evidence,
    render,
)
from security_world.expansion.config import ExpansionConfig
from security_world.model import canonical_json
from security_world.model.events import Event

ALL_RENDERERS = list(RENDERERS)
ALL_STYLES = list(RENDER_STYLES)

#: 每个 renderer 的 rendered_text 必须出现的特征串（证明渲染的真是那一层）。
RENDERER_SIGNATURES: dict[str, tuple[str, ...]] = {
    "structured_state": ('"state"', '"current_state"'),
    "http_request": ("HTTP/1.1", "Host:"),
    "reverse_proxy_log": ("HTTP/1.1", "request_id="),
    "application_log": ("INFO", "operation="),
    "audit_log": ("audit at=", "operation="),
    "api_gateway_record": ('"trace_id"', '"http"'),
    "multi_event_trace": ('"events"', '"current_event"'),
    "mixed_evidence_bundle": ('"evidence"', '"timeline"'),
}


def _render(renderer: str, *, style: str = "rest", world=None, action=None, **kwargs):
    config = ExpansionConfig.default()
    world = world if world is not None else ownership_world()
    action = action if action is not None else make_action("read", "ACT-003", resource_id="RES-001")
    return render(
        world,
        action,
        renderer=renderer,
        seed=64,
        allowlist=config.projection_allowlist,
        style=style,
        timeline=timeline_for(),
        **kwargs,
    )


@pytest.mark.parametrize("renderer", ALL_RENDERERS)
def test_renderer_model_visible_shape(renderer):
    observation = _render(renderer)
    document = observation.to_model_visible()
    assert set(document) == {"renderer", "current_time", "request", "evidence", "timeline"}
    assert document["renderer"] == renderer
    assert set(document["request"]) >= {"method", "path", "rendered_text"}
    assert document["request"]["method"] in (
        "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
    )
    assert document["request"]["path"].startswith("/")
    text = document["request"]["rendered_text"]
    assert isinstance(text, str) and text
    for signature in RENDERER_SIGNATURES[renderer]:
        assert signature in text, f"{renderer} 的 rendered_text 缺少特征 {signature!r}"


@pytest.mark.parametrize("renderer", ALL_RENDERERS)
def test_renderer_projection_is_deterministic(renderer):
    first = _render(renderer)
    second = _render(renderer)
    assert canonical_json(first.to_model_visible()) == canonical_json(second.to_model_visible())


@pytest.mark.parametrize("renderer", ALL_RENDERERS)
def test_renderer_evidence_is_seven_key_projection(renderer):
    world = ownership_world()
    observation = _render(renderer, world=world)
    visible = [item for item in world.evidence if item.visible_in_observation]
    assert len(observation.evidence) == len(visible)
    for projected, item in zip(observation.evidence, visible):
        assert set(projected) == {
            "evidence_id", "type", "asserts_ref", "value", "source", "provenance", "timestamp",
        }
        assert projected["evidence_id"] == item.evidence_id
        # 模型侧看不到 oracle 的分类结论（D7）。
        assert "trust_level" not in projected
        assert "freshness" not in projected
        assert "attacker_controllable" not in projected
        assert "visible_in_observation" not in projected


@pytest.mark.parametrize("renderer", ALL_RENDERERS)
def test_renderer_timeline_drops_causal_tag(renderer):
    observation = _render(renderer)
    assert len(observation.timeline) == 2
    for event in observation.timeline:
        assert "causal_tag" not in event
        assert "state_before" not in event
        assert "state_after" not in event
        assert {"event_id", "t_index", "at", "event_type", "actor_id"} <= set(event)


def test_unknown_renderer_rejected():
    with pytest.raises(RenderError) as excinfo:
        _render("soc_console")
    assert excinfo.value.reason_code == "unknown_renderer"


def test_unknown_style_rejected():
    with pytest.raises(RenderError) as excinfo:
        _render("http_request", style="soap")
    assert excinfo.value.reason_code == "unknown_style"


# --------------------------------------------------------------------------- #
# REST / GraphQL / RPC：同一 action 的三种序列化
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("style", ALL_STYLES)
def test_styles_share_security_semantics(style):
    """三风格只改请求面序列化；证据/时间线投影与 oracle 判决完全相同。"""
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = _render("http_request", style=style, world=world, action=action)
    from asw_worlds import run

    output = run(world, action)
    assert output.world_truth == "attack"
    assert observation.evidence == _render("http_request", style="rest", world=world, action=action).evidence
    assert observation.timeline == _render("http_request", style="rest", world=world, action=action).timeline
    # 端点模板是 /api/{operation}：REST 用模板渲染，GraphQL/RPC 换成协议入口。
    assert observation.request["path"] in ("/api/read", "/graphql", "/rpc/read")


def test_styles_produce_distinct_request_surfaces():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    surfaces = {
        style: _render("http_request", style=style, world=world, action=action).request
        for style in ALL_STYLES
    }
    assert len({canonical_json(surface) for surface in surfaces.values()}) == len(ALL_STYLES)
    assert surfaces["graphql"]["body"]["operationName"] == "read"
    assert surfaces["rpc"]["body"]["jsonrpc"] == "2.0"
    assert surfaces["rpc"]["body"]["method"] == "read"


# --------------------------------------------------------------------------- #
# 投影白名单（B12）
# --------------------------------------------------------------------------- #


def test_projection_allowlist_rejects_attack_family_value():
    world = with_entities(
        ownership_world(),
        resources=(
            {
                "resource_id": "RES-001",
                "resource_type": "order",
                "owner": "ACT-001",
                "tenant": "TEN-001",
                "sensitivity": "confidential",
                "state": "active",
                "attributes": {"note": "idor_bola"},
            },
        ),
    )
    action = make_action("read", "ACT-003", resource_id="RES-001")
    with pytest.raises(RenderError) as excinfo:
        _render("structured_state", world=world, action=action)
    assert excinfo.value.reason_code == "projection_forbidden"


def test_projection_allowlist_rejects_forbidden_id_prefix():
    world = with_entities(
        ownership_world(),
        actors=(
            {
                "actor_id": "ACT-003",
                "actor_type": "user",
                "identity": {"identity_id": "ID-003", "verified": True},
                "roles": ["ROLE-CUSTOMER"],
                "tenant": "TEN-002",
                "authentication_state": "authenticated",
                "attributes": {"note": "see INV-OWNERSHIP-001"},
            },
            {
                "actor_id": "ACT-001",
                "actor_type": "user",
                "identity": {"identity_id": "ID-001", "verified": True},
                "roles": ["ROLE-CUSTOMER"],
                "tenant": "TEN-001",
                "authentication_state": "authenticated",
            },
        ),
    )
    action = make_action("read", "ACT-003", resource_id="RES-001")
    with pytest.raises(RenderError) as excinfo:
        _render("structured_state", world=world, action=action)
    assert excinfo.value.reason_code == "projection_forbidden"


def test_structured_state_projects_only_whitelisted_collections():
    observation = _render("structured_state")
    surface = observation.surface or {}
    allowed = set(ExpansionConfig.default().projection_allowlist["world_side_allowed"])
    assert set(surface["state"]) <= allowed
    assert "actors" in surface["state"] and "current_state" in surface["state"]


# --------------------------------------------------------------------------- #
# 投影助手与时间戳格式
# --------------------------------------------------------------------------- #


def test_project_evidence_requires_timestamp():
    item = {
        "evidence_id": "EV-1",
        "type": "log_line",
        "asserts_ref": "resource.RES-001.owner",
        "value": "ACT-001",
        "source": "src",
        "provenance": "system_of_record",
        "trust_level": "trusted",
        "freshness": "fresh",
        "attacker_controllable": False,
        "visible_in_observation": True,
    }
    with pytest.raises(RenderError) as excinfo:
        project_evidence((item,), "2026-09-20T08:00:00Z")
    assert excinfo.value.reason_code == "visible_evidence_missing_timestamp"


def test_project_event_strips_decision_metadata():
    event = Event.from_document(
        {
            "event_id": "EVT-000",
            "t_index": 0,
            "at": "2026-09-20T08:00:00Z",
            "event_type": "request",
            "actor_id": "ACT-003",
            "causal_tag": "relevant",
            "state_before": {"actor_states": {"ACT-003": {"roles": ["ROLE-CUSTOMER"]}}},
            "state_after": {"actor_states": {"ACT-003": {"roles": ["ROLE-SUPPORT"]}}},
        }
    )
    projected = project_event(event)
    assert "causal_tag" not in projected
    assert "state_before" not in projected and "state_after" not in projected


@pytest.mark.parametrize(
    "timestamp_format",
    ["rfc3339", "rfc3339_offset", "iso_millis", "epoch_millis"],
)
def test_timestamp_formats_are_pure_surface_transforms(timestamp_format):
    rendered = format_timestamp("2026-09-20T08:00:00Z", timestamp_format)
    assert isinstance(rendered, str) and rendered
    if timestamp_format == "rfc3339":
        assert rendered == "2026-09-20T08:00:00Z"
    if timestamp_format == "rfc3339_offset":
        assert rendered == "2026-09-20T08:00:00+00:00"
    if timestamp_format == "iso_millis":
        assert rendered == "2026-09-20T08:00:00.000Z"
    if timestamp_format == "epoch_millis":
        assert rendered.isdigit()


def test_timestamp_format_rejects_unknown_format_and_bad_instant():
    with pytest.raises(RenderError):
        format_timestamp("2026-09-20T08:00:00Z", "rfc2822")
    with pytest.raises(RenderError):
        format_timestamp("not-an-instant", "rfc3339")


def test_masked_view_projects_only_visible_evidence():
    from asw_expansion import masking_world
    from security_world.expansion import mask_evidence
    from security_world.expansion import consulted_facts_from_output
    from security_world.oracle import EvidenceView
    from asw_worlds import run

    world = masking_world()
    action = make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001")
    consulted = consulted_facts_from_output(run(world, action))
    masked = mask_evidence(
        EvidenceView.from_world(world), level="insufficient", seed=1, consulted_facts=consulted
    )
    observation = _render("mixed_evidence_bundle", world=world, action=action)
    masked_observation = render(
        world,
        action,
        renderer="mixed_evidence_bundle",
        seed=64,
        allowlist=ExpansionConfig.default().projection_allowlist,
        evidence_view=masked,
        timeline=timeline_for(),
    )
    visible_ids = {item.evidence_id for item in masked.visible}
    assert {item["evidence_id"] for item in masked_observation.evidence} == visible_ids
    assert len(masked_observation.evidence) < len(observation.evidence)


def test_observation_without_surface_cannot_rerender():
    bare = Observation(
        renderer="http_request",
        current_time="2026-09-20T08:00:00Z",
        request={"method": "GET", "path": "/api/read"},
        evidence=(),
        timeline=(),
    )
    from security_world.expansion import rerender

    with pytest.raises(Exception) as excinfo:
        rerender(bare)
    assert getattr(excinfo.value, "reason_code", "") == "observation_without_surface"
