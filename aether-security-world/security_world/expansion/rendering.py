"""观测渲染器：把 (world, action) 投影成 ``observation.model_visible``（设计 §5.2 / D2 / D7）。

**renderer 是单向投影**：它只读世界状态与 action 的请求面，从不调用 oracle、
从不读证据分类、从不把标签写进观测。oracle 也从不解析渲染文本（D2）——因此
``' OR 1=1`` 本身永远不足以定罪，同一请求字符串在不同世界状态下得到不同 verdict
是靠"世界声明"而不是"字符串匹配"（§8.5 / R8）。

8 种 renderer（``configs/default.json`` 的 ``rendering.renderers``，
``episode.schema.json`` 的 ``model_visible.renderer`` 枚举逐字一致）::

    structured_state      绑定实体 + current_state 的结构化投影
    http_request          原始 HTTP 请求面（header 顺序承载在 rendered_text，S16）
    reverse_proxy_log     反代访问日志行
    application_log       应用日志行
    audit_log             审计日志行
    api_gateway_record    网关结构化记录
    multi_event_trace     多事件轨迹（时间线 + 当前事件）
    mixed_evidence_bundle 请求 + 证据 + 时间线的混合束

**REST / GraphQL / RPC 三风格**（``style`` 参数）改写的只是请求面序列化
（method/path/body 包装），action 的结构化绑定（actor/resource/session/token/
workflow_instance/operation/flow_id）与 oracle 输入逐字节相同——因此同一 action 的
三种渲染保持安全语义不变，由 ``tests/metamorphic`` 断言。

**投影白名单**（B12）：``allowlist`` 来自 ``configs.rendering.projection_allowlist``；
渲染结果里出现禁止的 id 前缀（``POL-`` / ``INV-`` / ``OPP-`` / ``AXIS-``）或
attack_family 值模式即抛 :class:`RenderError`——越界投影即抛，不静默裁剪。
"""
from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, replace
from typing import Any

from ..model.canonical import canonical_json, stable_hash, to_plain_json
from ..model.clock import EPOCH, instant_delta_ms, is_valid_instant
from ..model.errors import RefResolutionError
from ..model.rng import validate_seed
from ..model.world import WorldInstance
from ..oracle import EvidenceView
from .errors import PerturbationError, RenderError

#: 8 种 renderer（与 configs / episode schema 同源）。
RENDERERS: tuple[str, ...] = (
    "structured_state",
    "http_request",
    "reverse_proxy_log",
    "application_log",
    "audit_log",
    "api_gateway_record",
    "multi_event_trace",
    "mixed_evidence_bundle",
)

#: 同一 action 的三种请求面序列化风格。
RENDER_STYLES: tuple[str, ...] = ("rest", "graphql", "rpc")

#: 时间戳呈现格式（无关轴 ``observation.rendering.timestamp_format`` 的取值域）。
TIMESTAMP_FORMATS: tuple[str, ...] = ("rfc3339", "rfc3339_offset", "iso_millis", "epoch_millis")

#: 展示名大小写（无关轴 ``observation.rendering.display_name_case`` 的取值域；
#: B9：``display_name`` 是实体字段即世界状态，因此大小写只能是 render-time 轴）。
DISPLAY_NAME_CASES: tuple[str, ...] = ("as_is", "upper", "lower", "title")

#: 模型可见侧的证据七键（设计 §5.2 / ``episode.schema.json`` 的 evidence_observation）。
EVIDENCE_OBSERVATION_KEYS: tuple[str, ...] = (
    "evidence_id",
    "type",
    "asserts_ref",
    "value",
    "source",
    "provenance",
    "timestamp",
)

#: 模型可见侧的事件投影键（``event_observation`` 闭集：无 causal_tag、无状态片段）。
EVENT_OBSERVATION_KEYS: tuple[str, ...] = (
    "event_id",
    "t_index",
    "at",
    "event_type",
    "actor_id",
    "summary",
    "endpoint",
    "outcome",
    "emitted_evidence",
)

#: 默认 User-Agent（合成客户端；扰动静止池见 :data:`USER_AGENTS`）。
DEFAULT_USER_AGENT = "aetherguard-synthetic-client/0.1"

#: 默认展示语言（扰动池见 ``perturbation.DISPLAY_LOCALES``）。
DEFAULT_DISPLAY_LOCALE = "en-US"

#: User-Agent 扰动池：全部是合成字符串，与 verdict 无关（G11 特征之一）。
USER_AGENTS: tuple[str, ...] = (
    DEFAULT_USER_AGENT,
    "curl/8.4.0 (synthetic-client)",
    "python-requests/2.32.3 (synthetic-client)",
    "synthetic-browser/0.1 (research-fixture)",
)

#: 合成反代日志里的客户端地址（TEST-NET-3 文档段，非真实主机）。
PROXY_CLIENT_ADDRESS = "203.0.113.7"

#: 结构化请求面的键（``model_visible.request``，additionalProperties: false）。
_REQUEST_KEYS: tuple[str, ...] = ("method", "path", "query", "headers", "body", "rendered_text")

#: 逻辑 header 的固定顺序（``Date`` / ``traceparent`` 的值在渲染期生成）。
_BASE_HEADER_ORDER: tuple[str, ...] = (
    "Host",
    "User-Agent",
    "X-Request-Id",
    "X-Actor-Display-Name",
    "Date",
    "traceparent",
)

#: header 行正则（``rendering.header_order`` 轴重排 rendered_text 用）。
_HEADER_LINE = re.compile(r"^[A-Za-z0-9-]+: ")


# --------------------------------------------------------------------------- #
# Observation
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Observation:
    """``observation.model_visible`` 的内存形态（设计 §15.3）。

    ``surface`` 是**渲染期旋钮**（风格、header 顺序、trace id、时间戳格式、展示名
    大小写、以及 structured_state 的状态投影）。它**不是** model_visible 的一部分
    （``to_model_visible()`` 只产五个闭集键），存在的唯一理由是让
    :func:`security_world.expansion.perturbation.irrelevant_perturbation` 能
    **保质地重渲染**——对 rendered_text 做字符串手术会悄悄漂移，重渲染不会。
    """

    renderer: str
    current_time: str
    request: Mapping[str, Any]
    evidence: tuple[dict[str, Any], ...]
    timeline: tuple[dict[str, Any], ...]
    surface: Mapping[str, Any] | None = None

    def to_model_visible(self) -> dict[str, Any]:
        """``observation.model_visible`` 文档（闭集五键，可过 episode schema）。"""
        return {
            "renderer": self.renderer,
            "current_time": self.current_time,
            "request": to_plain_json(dict(self.request)),
            "evidence": [to_plain_json(dict(item)) for item in self.evidence],
            "timeline": [to_plain_json(dict(item)) for item in self.timeline],
        }


# --------------------------------------------------------------------------- #
# 主入口
# --------------------------------------------------------------------------- #
def render(
    world: WorldInstance,
    action: Any,
    *,
    renderer: str,
    seed: int,
    allowlist: Mapping[str, Any] | None = None,
    style: str = "rest",
    evidence_view: Any = None,
    timeline: tuple[Any, ...] = (),
    current_time: str | None = None,
) -> Observation:
    """把 (world, action) 投影成一次观测（纯函数：无随机漂移、无挂钟、无 IO）。

    ``evidence_view`` 缺省用世界自己的可见性（``world.evidence[].
    visible_in_observation`` 是权威，S7）；掩蔽变体传入掩蔽后的视图。
    ``timeline`` 是 episode 的事件序列（``Event`` 或文档），投影时去掉
    ``causal_tag`` 与状态片段——"哪段历史要紧"是决策元数据，不是观察（D7）。
    """
    if renderer not in RENDERERS:
        raise RenderError("unknown_renderer", f"renderer 必须是 {RENDERERS} 之一，得到 {renderer!r}")
    if style not in RENDER_STYLES:
        raise RenderError("unknown_style", f"style 必须是 {RENDER_STYLES} 之一，得到 {style!r}")
    validate_seed(seed)
    if not isinstance(world, WorldInstance):
        raise RenderError("world_not_instance", f"world 必须是 WorldInstance，得到 {type(world).__name__}")
    resolved_time = action.at if current_time is None else current_time
    if not is_valid_instant(resolved_time):
        raise RenderError("invalid_current_time", f"current_time 不是合法 VirtualClock 时刻: {resolved_time!r}")

    view = evidence_view if evidence_view is not None else EvidenceView.from_world(world)
    if not hasattr(view, "visible"):
        raise RenderError("evidence_view_without_visible", "evidence_view 必须提供 visible 元组")
    evidence_obs = project_evidence(tuple(view.visible), resolved_time)
    timeline_obs = tuple(project_event(item) for item in timeline)

    surface = _build_surface(
        world,
        action,
        renderer=renderer,
        style=style,
        seed=seed,
        current_time=resolved_time,
        timeline_obs=timeline_obs,
        evidence_obs=evidence_obs,
    )
    request_doc = request_document(surface)
    projection_guard(request_doc, allowlist)
    if renderer == "structured_state":
        _check_world_side(surface.get("state") or {}, allowlist)
    return Observation(
        renderer=renderer,
        current_time=resolved_time,
        request=request_doc,
        evidence=evidence_obs,
        timeline=timeline_obs,
        surface=surface,
    )


def rerender(observation: Observation, *, allowlist: Mapping[str, Any] | None = None) -> Observation:
    """用观测自己的 ``surface`` 重渲染（扰动后保持 rendered_text 与结构一致）。"""
    surface = observation.surface
    if surface is None:
        raise PerturbationError(
            "observation_without_surface",
            "观测缺少渲染表面（surface），无法保质地重渲染；"
            "请用 security_world.expansion.render 构造观测",
        )
    request_doc = request_document(surface)
    if allowlist:
        projection_guard(request_doc, allowlist)
    return replace(observation, request=request_doc)


# --------------------------------------------------------------------------- #
# 表面构造
# --------------------------------------------------------------------------- #
def _build_surface(
    world: WorldInstance,
    action: Any,
    *,
    renderer: str,
    style: str,
    seed: int,
    current_time: str,
    timeline_obs: tuple[dict[str, Any], ...],
    evidence_obs: tuple[dict[str, Any], ...],
) -> dict[str, Any]:
    request = dict(getattr(action, "request", None) or {})
    endpoint = _endpoint_for(world, action)
    method = str(request.get("method") or (endpoint.method if endpoint is not None else "GET"))
    path = str(request.get("path") or _rendered_path(endpoint, action))
    resource_type = None
    if action.resource is not None:
        try:
            resource_type = action.resource_type(world)
        except RefResolutionError:
            resource_type = None
    validate_seed(seed)  # 渲染本身无随机选择；seed 只用于可复算的 trace_id 派生
    trace_id = "trace-" + stable_hash([action.action_id, "trace"])[:16]
    headers = _logical_headers(request.get("headers"), world, action)
    header_order = [name for name in _BASE_HEADER_ORDER if name in headers or name in ("Date", "traceparent")]
    for name in headers:
        if name not in header_order:
            header_order.append(name)
    surface: dict[str, Any] = {
        "renderer": renderer,
        "style": style,
        "current_time": current_time,
        "operation": action.operation,
        "actor": action.actor,
        "resource": action.resource,
        "session": action.session,
        "token": action.token,
        "workflow_instance": action.workflow_instance,
        "resource_type": resource_type,
        "method": method,
        "path": path,
        "query": dict(request.get("query") or {}),
        "headers": headers,
        "header_order": header_order,
        "text_header_order": list(header_order),
        "body": request.get("body"),
        "host": _host(world),
        "trace_id": trace_id,
        "request_id": str(headers.get("X-Request-Id", action.action_id)),
        "timestamp_format": "rfc3339",
        "display_name_case": "as_is",
        "display_name": _display_name(world, action),
        "parameters": dict(getattr(action, "parameters", None) or {}),
    }
    if renderer == "structured_state":
        surface["state"] = _project_state(world, action)
    if renderer in ("multi_event_trace", "mixed_evidence_bundle"):
        surface["timeline"] = [dict(item) for item in timeline_obs]
    if renderer == "mixed_evidence_bundle":
        surface["evidence"] = [dict(item) for item in evidence_obs]
    return surface


def _logical_headers(provided: Any, world: WorldInstance, action: Any) -> dict[str, str]:
    """逻辑 header（``Date`` / ``traceparent`` 在渲染期生成，不在这里）。"""
    headers: dict[str, str] = {}
    if isinstance(provided, Mapping):
        for key, value in provided.items():
            headers[str(key)] = _header_text(value)
    headers.setdefault("Host", _host(world))
    headers.setdefault("User-Agent", DEFAULT_USER_AGENT)
    headers.setdefault("X-Request-Id", str(action.action_id))
    # 展示语言 header 恒存在：让 observation.request.headers.Accept-Language 轴
    # （Phase 2A 语义本体里的 ``display_locale``）对每种 renderer 都真实可观测。
    headers.setdefault("Accept-Language", DEFAULT_DISPLAY_LOCALE)
    # 展示名 header 恒存在：让 observation.rendering.display_name_case 轴对每种
    # renderer 都真实可观测（一个什么都不改的"扰动"会让不变性测试假通过）。
    headers["X-Actor-Display-Name"] = _display_name(world, action)
    return headers


def _header_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return canonical_json(value)


def _endpoint_for(world: WorldInstance, action: Any) -> Any:
    candidates = [ep for ep in world.application.endpoints if ep.operation == action.operation]
    if not candidates:
        return None
    if action.resource is not None:
        try:
            resource_type = action.resource_type(world)
        except RefResolutionError:
            resource_type = None
        for endpoint in candidates:
            if endpoint.resource_type == resource_type:
                return endpoint
    return candidates[0]


def _rendered_path(endpoint: Any, action: Any) -> str:
    if endpoint is None:
        return f"/api/{action.operation}"
    path = endpoint.path
    if action.resource is not None:
        path = re.sub(r"\{[^{}]+\}", action.resource, path)
    return path


def _host(world: WorldInstance) -> str:
    name = str(getattr(world.application, "name", "") or "synthetic-app")
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "synthetic-app"
    return f"api.{slug}.example.invalid"


def _display_name(world: WorldInstance, action: Any) -> str:
    path = f"actor.{action.actor}.display_name"
    try:
        value = world.resolve(path)
    except RefResolutionError:
        return str(action.actor)
    if isinstance(value, str) and value:
        return value
    return str(action.actor)


# --------------------------------------------------------------------------- #
# 请求面与 rendered_text
# --------------------------------------------------------------------------- #
def _request_fields(surface: Mapping[str, Any], *, header_order: Any = None) -> dict[str, Any]:
    """风格的请求面（不含 ``rendered_text``，避免自引用）。

    ``header_order`` 给出时按该顺序产 header——``rendered_text`` 用它承载
    ``observation.rendering.header_order`` 轴（只改文本行序），而
    ``model_visible.request.headers`` 始终按结构化的 ``surface["header_order"]``。
    """
    style = surface["style"]
    if style == "rest":
        return {
            "method": surface["method"],
            "path": surface["path"],
            "query": dict(surface["query"]),
            "headers": _final_headers(surface, header_order),
            "body": to_plain_json(surface["body"]) if surface["body"] is not None else None,
        }
    if style == "graphql":
        return {
            "method": "POST",
            "path": "/graphql",
            "query": {},
            "headers": _final_headers(surface, header_order),
            "body": {
                "query": _graphql_document(surface),
                "operationName": surface["operation"],
                "variables": to_plain_json(dict(surface["parameters"])),
            },
        }
    return {
        "method": "POST",
        "path": f"/rpc/{surface['operation']}",
        "query": {},
        "headers": _final_headers(surface, header_order),
        "body": {
            "jsonrpc": "2.0",
            "id": surface["trace_id"],
            "method": surface["operation"],
            "params": to_plain_json(dict(surface["parameters"])),
        },
    }


def request_document(surface: Mapping[str, Any]) -> dict[str, Any]:
    """``model_visible.request`` 文档（六个键，含 ``rendered_text``）。"""
    fields = _request_fields(surface)
    document = {
        "method": fields["method"],
        "path": fields["path"],
        "query": fields["query"],
        "headers": fields["headers"],
        "body": fields["body"],
        "rendered_text": rendered_text(surface),
    }
    return {key: to_plain_json(value) for key, value in document.items()}


def _final_headers(surface: Mapping[str, Any], order: Any = None) -> dict[str, str]:
    """按 header 顺序产出最终 header（``Date`` / ``traceparent`` 渲染期生成）。"""
    headers: dict[str, str] = {}
    for name in (order if order is not None else surface["header_order"]):
        if name == "Date":
            headers[name] = format_timestamp(surface["current_time"], surface["timestamp_format"])
        elif name == "traceparent":
            headers[name] = f"00-{surface['trace_id']}-01"
        elif name == "X-Actor-Display-Name" and name in surface["headers"]:
            # 展示名 header 跟随 display_name_case 轴（否则该轴对 http_request 是空扰动）。
            headers[name] = apply_display_case(surface["headers"][name], surface["display_name_case"])
        elif name in surface["headers"]:
            headers[name] = surface["headers"][name]
    return headers


def _text_header_order(surface: Mapping[str, Any]) -> Any:
    """rendered_text 使用的 header 行序（缺省与结构化顺序同源）。"""
    return surface.get("text_header_order") or surface["header_order"]


def _ordered_json(value: Any) -> str:
    """顺序保持的紧凑 JSON——``rendered_text`` 是"模型看到的精确字节"。

    与 :func:`canonical_json` 的区别只有一件事：**不排序键**。header 顺序 /
    JSON 键序扰动必须真实出现在 rendered_text 里（S16：JSON object 的键序会被
    canonical_json 抹掉，所以顺序类无关轴由 rendered_text 承载）。插入序本身是
    确定性的（渲染路径固定），因此这不影响"同入参同字节"。
    """
    return json.dumps(to_plain_json(value), ensure_ascii=False, separators=(",", ":"), sort_keys=False)


def _graphql_document(surface: Mapping[str, Any]) -> str:
    operation = re.sub(r"[^A-Za-z0-9_]", "", str(surface["operation"])) or "Operation"
    field = re.sub(r"[^A-Za-z0-9_]", "", str(surface.get("resource_type") or "resource"))
    return f"query {operation[:1].upper()}{operation[1:]} {{ {field} {{ id }} }}"


def rendered_text(surface: Mapping[str, Any]) -> str:
    """按 renderer 产出模型看到的**精确字节**（header 顺序承载在这里，S16）。"""
    renderer = surface["renderer"]
    fields = _request_fields(surface)
    # 文本里的 header 行序可以独立于结构化键序（rendering.header_order 轴）。
    text_fields = _request_fields(surface, header_order=_text_header_order(surface))
    timestamp = format_timestamp(surface["current_time"], surface["timestamp_format"])
    display = apply_display_case(str(surface["display_name"]), surface["display_name_case"])
    if renderer == "structured_state":
        return _ordered_json(
            {
                "request": text_fields,
                "state": _apply_case_deep(surface.get("state") or {}, surface["display_name_case"]),
                "trace_id": surface["trace_id"],
            }
        )
    if renderer == "http_request":
        return _http_request_text(surface, text_fields)
    if renderer == "reverse_proxy_log":
        return (
            f"{PROXY_CLIENT_ADDRESS} - - [{timestamp}] "
            f"\"{text_fields['method']} {text_fields['path']}{_query_string(text_fields['query'])} HTTP/1.1\" "
            f"- - \"-\" \"{surface['headers'].get('User-Agent', DEFAULT_USER_AGENT)}\" "
            f"request_id={surface['request_id']} trace_id={surface['trace_id']} "
            f"actor=\"{display}\""
        )
    if renderer == "application_log":
        return "\n".join(
            [
                f"{timestamp} INFO  application: handling request "
                f"request_id={surface['request_id']} trace_id={surface['trace_id']} "
                f"operation={surface['operation']} actor={surface['actor']} "
                f"resource={surface['resource']} session={surface['session']} "
                f"actor_display={display}",
                f"{timestamp} INFO  application: request completed "
                f"request_id={surface['request_id']} outcome=unknown",
            ]
        )
    if renderer == "audit_log":
        return (
            f"audit at={timestamp} actor={surface['actor']} actor_display={display} "
            f"operation={surface['operation']} resource={surface['resource']} "
            f"session={surface['session']} token={surface['token']} "
            f"workflow_instance={surface['workflow_instance']} outcome=unknown "
            f"request_id={surface['request_id']} trace_id={surface['trace_id']}"
        )
    if renderer == "api_gateway_record":
        return _ordered_json(
            {
                "request_id": surface["request_id"],
                "trace_id": surface["trace_id"],
                "timestamp": timestamp,
                "http": {
                    "method": text_fields["method"],
                    "path": text_fields["path"],
                    "query": text_fields["query"],
                    "headers": text_fields["headers"],
                },
                "body": text_fields["body"],
                "operation": surface["operation"],
                "actor": surface["actor"],
                "actor_display": display,
                "resource": surface["resource"],
                "session": surface["session"],
                "token": surface["token"],
                "workflow_instance": surface["workflow_instance"],
                "outcome": "unknown",
            }
        )
    if renderer == "multi_event_trace":
        return _ordered_json(
            {
                "trace_id": surface["trace_id"],
                "events": list(surface.get("timeline") or []),
                "current_event": {
                    "at": timestamp,
                    "event_type": "request",
                    "actor_id": surface["actor"],
                    "actor_display": display,
                    "endpoint": {"method": text_fields["method"], "path": text_fields["path"]},
                    "outcome": "unknown",
                    "request_id": surface["request_id"],
                },
            }
        )
    if renderer == "mixed_evidence_bundle":
        return _ordered_json(
            {
                "request": text_fields,
                "evidence": list(surface.get("evidence") or []),
                "timeline": list(surface.get("timeline") or []),
                "trace_id": surface["trace_id"],
                "actor_display": display,
            }
        )
    raise RenderError("unknown_renderer", f"renderer 不在词表里: {renderer!r}")  # pragma: no cover


def _http_request_text(surface: Mapping[str, Any], fields: Mapping[str, Any]) -> str:
    lines = [f"{fields['method']} {fields['path']}{_query_string(fields['query'])} HTTP/1.1"]
    for name in _text_header_order(surface):
        if name in fields["headers"]:
            lines.append(f"{name}: {fields['headers'][name]}")
    text = "\n".join(lines) + "\n"
    body = fields["body"]
    if body is not None:
        text += "\n" + (body if isinstance(body, str) else canonical_json(body))
    return text


def _query_string(query: Mapping[str, Any]) -> str:
    if not query:
        return ""
    parts = []
    for key, value in query.items():
        parts.append(f"{key}={value if isinstance(value, str) else canonical_json(value)}")
    return "?" + "&".join(parts)


# --------------------------------------------------------------------------- #
# 时间戳与展示名格式
# --------------------------------------------------------------------------- #
def format_timestamp(instant: str, timestamp_format: str) -> str:
    """按格式呈现 VirtualClock 时刻（``epoch_millis`` 相对 VirtualClock EPOCH）。

    纯表面变换：任何格式下时刻都相同，因此它永远不可能改变 verdict。
    """
    if timestamp_format not in TIMESTAMP_FORMATS:
        raise RenderError(
            "unknown_timestamp_format",
            f"timestamp_format 必须是 {TIMESTAMP_FORMATS} 之一，得到 {timestamp_format!r}",
        )
    if not is_valid_instant(instant):
        raise RenderError("invalid_instant", f"不是合法 VirtualClock 时刻: {instant!r}")
    if timestamp_format == "rfc3339":
        return instant
    if timestamp_format == "rfc3339_offset":
        return instant[:-1] + "+00:00"
    if timestamp_format == "iso_millis":
        return instant[:-1] + ".000Z"
    return str(instant_delta_ms(instant, EPOCH))


def apply_display_case(text: str, display_name_case: str) -> str:
    """展示名大小写变换（B9：display_name 是实体字段，大小写只能是 render-time 轴）。"""
    if display_name_case == "as_is":
        return text
    if display_name_case == "upper":
        return text.upper()
    if display_name_case == "lower":
        return text.lower()
    if display_name_case == "title":
        return text.title()
    raise RenderError(
        "unknown_display_name_case",
        f"display_name_case 必须是 {DISPLAY_NAME_CASES} 之一，得到 {display_name_case!r}",
    )


def _apply_case_deep(value: Any, display_name_case: str) -> Any:
    if display_name_case == "as_is":
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        return {
            key: (apply_display_case(item, display_name_case) if key == "display_name" else _apply_case_deep(item, display_name_case))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_apply_case_deep(item, display_name_case) for item in value]
    return value


# --------------------------------------------------------------------------- #
# 投影（证据七键 / 事件观察 / 结构化状态）
# --------------------------------------------------------------------------- #
def project_evidence(items: tuple[Any, ...], current_time: str) -> tuple[dict[str, Any], ...]:
    """证据的七键投影（§5.2 / conftest 的 ``model_visible_boundary`` 同款规则）。

    可见证据缺 ``timestamp`` 即抛：``evidence_observation`` 七键全必填，缺了就只能
    伪造一个时间戳或产出一个过不了 schema 的 episode——两者都不可接受。
    """
    del current_time  # 投影只用证据自带的时间戳；freshness 由模型对 current_time 推
    out: list[dict[str, Any]] = []
    for item in items:
        document = item.to_document() if hasattr(item, "to_document") else dict(item)
        if document.get("timestamp") is None:
            raise RenderError(
                "visible_evidence_missing_timestamp",
                f"可见证据 {document.get('evidence_id')!r} 缺少 timestamp，"
                "而 evidence_observation 七键投影要求它（补上时间戳，不要伪造）",
            )
        out.append({key: to_plain_json(document[key]) for key in EVIDENCE_OBSERVATION_KEYS})
    return tuple(out)


def project_event(item: Any) -> dict[str, Any]:
    """事件观察投影：去掉 ``causal_tag`` / ``state_before`` / ``state_after``（D7）。"""
    document = item.to_document() if hasattr(item, "to_document") else dict(item)
    return {key: to_plain_json(document[key]) for key in EVENT_OBSERVATION_KEYS if key in document}


def _project_state(world: WorldInstance, action: Any) -> dict[str, Any]:
    """structured_state 的世界侧投影：只含白名单集合（B12）。"""
    document = world.to_document()

    def find(collection: str, id_field: str, entity_id: str) -> dict[str, Any] | None:
        for item in document.get(collection) or ():
            if item.get(id_field) == entity_id:
                return dict(item)
        return None

    state: dict[str, Any] = {}
    bindings: tuple[tuple[str, str, str], ...] = (
        ("actor", "actors", "actor_id"),
        ("resource", "resources", "resource_id"),
        ("session", "sessions", "session_id"),
        ("token", "tokens", "token_id"),
    )
    for binding, collection, id_field in bindings:
        entity_id = getattr(action, binding, None)
        if entity_id is None:
            continue
        found = find(collection, id_field, entity_id)
        if found is not None:
            state[collection] = [found]
    if action.workflow_instance is not None:
        for workflow in document.get("workflows") or ():
            if any(
                instance.get("instance_id") == action.workflow_instance
                for instance in workflow.get("instances") or ()
            ):
                state["workflows"] = [dict(workflow)]
                break
    if state.get("actors"):
        role_ids = set(state["actors"][0].get("roles") or ())
        roles = [dict(item) for item in document.get("roles") or () if item.get("role_id") in role_ids]
        if roles:
            state["roles"] = roles
    state["current_state"] = dict(document.get("current_state") or {})
    state["state_history"] = [dict(item) for item in document.get("state_history") or ()]
    return state


# --------------------------------------------------------------------------- #
# 投影白名单（B12）
# --------------------------------------------------------------------------- #
def projection_guard(document: Any, allowlist: Mapping[str, Any] | None) -> None:
    """渲染结果越界即抛（禁止 id 前缀 / attack_family 值模式）。"""
    if not allowlist:
        return
    prefixes = tuple(str(item) for item in (allowlist.get("forbidden_id_prefixes") or ()) if item)
    patterns = []
    for pattern in allowlist.get("forbidden_value_patterns") or ():
        body = str(pattern)
        if body.startswith("^"):
            body = body[1:]
        if body.endswith("$"):
            body = body[:-1]
        if body:
            patterns.append(re.compile(body))
    for where, text in _iter_strings(document):
        for prefix in prefixes:
            if prefix in text:
                raise RenderError(
                    "projection_forbidden",
                    f"渲染结果 {where} 含禁止的 id 前缀 {prefix!r}（B12 投影白名单）",
                )
        for regex in patterns:
            if regex.search(text):
                raise RenderError(
                    "projection_forbidden",
                    f"渲染结果 {where} 命中禁止的值模式 {regex.pattern!r}（B12 投影白名单）",
                )


def _check_world_side(structure: Mapping[str, Any], allowlist: Mapping[str, Any] | None) -> None:
    """世界侧投影的集合键必须在 ``world_side_allowed`` 内、不与 forbidden 相交。"""
    if not allowlist or not isinstance(structure, Mapping):
        return
    forbidden = {str(item) for item in (allowlist.get("world_side_forbidden") or ())}
    allowed = {str(item) for item in (allowlist.get("world_side_allowed") or ())}
    keys = {str(key) for key in structure}
    bad = sorted(keys & forbidden)
    if bad:
        raise RenderError("projection_forbidden", f"世界侧投影含禁止集合键 {bad}（B12）")
    if allowed and not keys <= allowed:
        raise RenderError(
            "projection_forbidden",
            f"世界侧投影含白名单外集合键 {sorted(keys - allowed)}（B12）",
        )


def _iter_strings(document: Any, where: str = "<root>") -> Iterator[tuple[str, str]]:
    """遍历文档里全部字符串（键与值），产出 ``(json 路径, 文本)``。"""
    if isinstance(document, Mapping):
        for key, value in document.items():
            key_where = f"{where}/{key}"
            yield key_where, str(key)
            yield from _iter_strings(value, key_where)
    elif isinstance(document, (list, tuple)):
        for index, value in enumerate(document):
            yield from _iter_strings(value, f"{where}[{index}]")
    elif isinstance(document, str):
        yield where, document


__all__ = [
    "DEFAULT_USER_AGENT",
    "DISPLAY_NAME_CASES",
    "EVIDENCE_OBSERVATION_KEYS",
    "EVENT_OBSERVATION_KEYS",
    "Observation",
    "RENDERERS",
    "RENDER_STYLES",
    "TIMESTAMP_FORMATS",
    "USER_AGENTS",
    "apply_display_case",
    "format_timestamp",
    "project_event",
    "project_evidence",
    "projection_guard",
    "render",
    "rendered_text",
    "request_document",
    "rerender",
]
