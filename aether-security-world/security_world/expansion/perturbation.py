"""无关扰动：改表面，**世界状态零变化**（设计 §9.1 / §9.2 / B9 / S16）。

``irrelevant_perturbation`` 的契约（§15.3）::

    irrelevant_perturbation(world, observation, *, axis, seed) -> Observation
    # 只允许 observation.* 轴；不得改动世界状态

三条硬性质：

1. **轴必须是 observation 表面路径**（``^observation\\.(request|rendering)\\..*``，
   schema 同款模式）。扰动世界状态（例如 ``display_name`` 本身）会让 Gate 6 的
   ``changed_paths == ()`` 永假——B9 因此把 ``display_name.case`` 改成
   render-time-only 轴 ``observation.rendering.display_name_case``。
2. **必须真的改变观测**：扰动前后 ``canonical_json(model_visible)`` 逐字节相同
   即抛 :class:`PerturbationError`（``no_op_perturbation``）。一个什么都不改的
   "扰动"会把"verdict 不变"的变形测试变成假通过——比没有测试更坏。
3. **世界零变化**：函数只读 ``world``（frozen dataclass 也改不了），返回新观测；
   ``diff_worlds(base, variant).is_empty()`` 由测试机械断言。

支持的轴（``configs/default.json`` 的 ``expansion.irrelevant_axes``）::

    observation.request.headers.User-Agent      UA 字符串（G11 特征）
    observation.request.headers.X-Request-Id    请求 id（G11 特征）
    observation.request.headers.order           结构化 header 键序
    observation.rendering.header_order          rendered_text 里的 header 行序（S16）
    observation.rendering.trace_id              合成 trace id（G11 特征）
    observation.rendering.timestamp_format      时间戳呈现格式（G11 特征）
    observation.rendering.display_name_case     展示名大小写（B9：render-time-only）
"""
from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..model.canonical import canonical_json, stable_hash
from ..model.rng import derive_seed, make_rng, shuffled, validate_seed
from ..model.world import WorldInstance
from .errors import PerturbationError
from .rendering import (
    DISPLAY_NAME_CASES,
    TIMESTAMP_FORMATS,
    USER_AGENTS,
    Observation,
    apply_display_case,
    format_timestamp,
    rerender,
)

#: 无关轴的形状（与 ``world-spec.schema.json`` 的 ``irrelevant_state_variables`` 模式一致）。
IRRELEVANT_AXIS_PATTERN = re.compile(r"^observation\.(request|rendering)\.[A-Za-z0-9_][A-Za-z0-9_.\-]*$")

#: 本引擎实现的无关轴全集（不在表里的轴报 ``unsupported_axis``，绝不静默 no-op）。
SUPPORTED_AXES: tuple[str, ...] = (
    "observation.request.headers.User-Agent",
    "observation.request.headers.X-Request-Id",
    "observation.request.headers.Accept-Language",
    "observation.request.headers.order",
    "observation.rendering.header_order",
    "observation.rendering.trace_id",
    "observation.rendering.timestamp_format",
    "observation.rendering.display_name_case",
)

#: 每个无关轴的期望效应（§9.1 家族表：irrelevant_perturbation ⇒ verdict_invariant）。
IRRELEVANT_PERTURBATION_EFFECT = "verdict_invariant"


@dataclass(frozen=True)
class Perturbation:
    """一次无关扰动的记录（assemble_episode 的 intervention 负载）。"""

    axis: str
    before: Any
    after: Any

    def to_document(self) -> dict[str, Any]:
        return {"axis": self.axis, "before": self.before, "after": self.after}


def irrelevant_perturbation(
    world: WorldInstance,
    observation: Observation,
    *,
    axis: str,
    seed: int,
) -> Observation:
    """对观测施加**一个**无关轴扰动，返回新观测（世界状态不变）。

    ``seed`` 决定多个候选值之间的确定性选择（同一 ``(axis, seed, surface)`` 永远
    得到同一结果；不同 seed 得到不同候选，用于同族多变体）。
    """
    if not isinstance(world, WorldInstance):
        raise PerturbationError(
            "world_not_instance", f"world 必须是 WorldInstance，得到 {type(world).__name__}"
        )
    validate_seed(seed)
    if not isinstance(axis, str) or not IRRELEVANT_AXIS_PATTERN.match(axis):
        raise PerturbationError(
            "axis_not_observation_path",
            f"无关轴必须是 observation.(request|rendering).* 表面路径，得到 {axis!r}"
            "（扰动世界状态会让 Gate 6 的 changed_paths == () 永假，B9）",
        )
    if axis not in SUPPORTED_AXES:
        raise PerturbationError(
            "unsupported_axis",
            f"轴 {axis!r} 形状合法但本引擎未实现；不提供静默 no-op 扰动"
            f"（已实现: {list(SUPPORTED_AXES)}）",
        )
    surface = observation.surface
    if surface is None:
        raise PerturbationError(
            "observation_without_surface",
            "观测缺少渲染表面（surface）；请用 security_world.expansion.render 构造观测",
        )
    before = canonical_json(observation.to_model_visible())
    # 深拷贝：surface 里有嵌套 dict/list，浅拷贝会把扰动写回调用方的观测
    #（同一个观测被两个轴连续扰动时互相污染）。
    mutated = _apply_axis(copy.deepcopy(dict(surface)), axis, seed)
    perturbed = rerender(
        Observation(
            renderer=observation.renderer,
            current_time=observation.current_time,
            request=observation.request,
            evidence=observation.evidence,
            timeline=observation.timeline,
            surface=mutated,
        )
    )
    after = canonical_json(perturbed.to_model_visible())
    if before == after:
        raise PerturbationError(
            "no_op_perturbation",
            f"轴 {axis!r} 没有改变 model_visible 的任何字节——"
            "一个空扰动会让 verdict_invariant 测试假通过",
        )
    return perturbed


def axis_change(axis: str, before_surface: Mapping, after_surface: Mapping) -> Perturbation:
    """提取某轴扰动前后的取值（供 intervention 记录使用）。"""
    if axis == "observation.request.headers.User-Agent":
        return Perturbation(
            axis, before_surface["headers"].get("User-Agent"), after_surface["headers"].get("User-Agent")
        )
    if axis == "observation.request.headers.X-Request-Id":
        return Perturbation(
            axis,
            before_surface["headers"].get("X-Request-Id"),
            after_surface["headers"].get("X-Request-Id"),
        )
    if axis == "observation.request.headers.Accept-Language":
        return Perturbation(
            axis,
            before_surface["headers"].get("Accept-Language"),
            after_surface["headers"].get("Accept-Language"),
        )
    if axis == "observation.request.headers.order":
        return Perturbation(axis, list(before_surface["header_order"]), list(after_surface["header_order"]))
    if axis == "observation.rendering.header_order":
        return Perturbation(
            axis,
            list(before_surface.get("text_header_order") or ()),
            list(after_surface.get("text_header_order") or ()),
        )
    if axis == "observation.rendering.trace_id":
        return Perturbation(axis, before_surface["trace_id"], after_surface["trace_id"])
    if axis == "observation.rendering.timestamp_format":
        return Perturbation(
            axis, before_surface["timestamp_format"], after_surface["timestamp_format"]
        )
    if axis == "observation.rendering.display_name_case":
        return Perturbation(
            axis, before_surface["display_name_case"], after_surface["display_name_case"]
        )
    raise PerturbationError("unsupported_axis", f"轴 {axis!r} 未实现")


# --------------------------------------------------------------------------- #
# 各轴变换
# --------------------------------------------------------------------------- #
#: 重排尝试上限：``rng.sample`` 有 1/n! 的概率给出恒等置换，那会让轴变成空扰动；
#: 有界重试保持确定性（rng 由 seed 派生），试满仍恒等就诚实地报错。
_PERMUTE_ATTEMPTS = 8


def _apply_axis(surface: dict, axis: str, seed: int) -> dict:
    rng = make_rng(derive_seed(validate_seed(seed), "perturb", axis))
    if axis == "observation.request.headers.User-Agent":
        current = surface["headers"].get("User-Agent")
        surface["headers"]["User-Agent"] = _pick_other(USER_AGENTS, current, rng)
        return surface
    if axis == "observation.request.headers.X-Request-Id":
        current = surface["headers"].get("X-Request-Id")
        candidates = tuple(
            f"req-{index:04d}-{suffix}" for index, suffix in enumerate(_REQUEST_ID_SUFFIXES)
        )
        surface["headers"]["X-Request-Id"] = _pick_other(candidates, current, rng)
        surface["request_id"] = surface["headers"]["X-Request-Id"]
        return surface
    if axis == "observation.request.headers.Accept-Language":
        current = surface["headers"].get("Accept-Language")
        surface["headers"]["Accept-Language"] = _pick_other(DISPLAY_LOCALES, current, rng)
        return surface
    if axis == "observation.request.headers.order":
        order = _permute(tuple(surface["header_order"]), rng)
        surface["header_order"] = list(order)
        # 结构化键序与文本行序同源：该轴同时改变两者（与 rendering.header_order 的
        # "只改文本"区分开）。
        surface["text_header_order"] = list(order)
        return surface
    if axis == "observation.rendering.header_order":
        surface["text_header_order"] = list(
            _permute(tuple(surface.get("text_header_order") or surface["header_order"]), rng)
        )
        return surface
    if axis == "observation.rendering.trace_id":
        current = surface["trace_id"]
        surface["trace_id"] = _pick_other(_trace_ids(current), current, rng)
        return surface
    if axis == "observation.rendering.timestamp_format":
        # 只选**真的会改变呈现**的格式：display/timestamp 这类循环轴如果只看"下一个"
        # 就可能落到一个渲染后与现值相同的取值上（例如全大写的展示名 upper 后不变）。
        current = surface["timestamp_format"]
        rendered_now = format_timestamp(surface["current_time"], current)
        options = [
            (candidate, format_timestamp(surface["current_time"], candidate))
            for candidate in TIMESTAMP_FORMATS
        ]
        surface["timestamp_format"] = _pick_effective(options, rendered_now, rng, axis)
        return surface
    if axis == "observation.rendering.display_name_case":
        current = surface["display_name_case"]
        display = str(surface["display_name"])
        options = [
            (candidate, apply_display_case(display, candidate)) for candidate in DISPLAY_NAME_CASES
        ]
        surface["display_name_case"] = _pick_effective(
            options, apply_display_case(display, current), rng, axis
        )
        return surface
    raise PerturbationError("unsupported_axis", f"轴 {axis!r} 未实现")  # pragma: no cover


#: 展示语言扰动池（无关轴 ``observation.request.headers.Accept-Language`` 的取值域；
#: Phase 2A 的语义本体用 ``display_locale`` 指代它——一个纯观测表面的装饰性字段）。
DISPLAY_LOCALES: tuple[str, ...] = ("en-US", "zh-CN", "ja-JP", "de-DE", "fr-FR")

#: X-Request-Id 扰动池（合成请求 id；G11 特征之一）。
_REQUEST_ID_SUFFIXES: tuple[str, ...] = ("alpha", "bravo", "charlie", "delta")


def _trace_ids(current: str) -> tuple[str, ...]:
    base = current.split("-", 1)[1] if "-" in current else current
    return (
        f"trace-{base}",
        f"trace-{_mix(base, 'x')}",
        f"trace-{_mix(base, 'y')}",
        f"trace-{_mix(base, 'z')}",
    )


def _mix(text: str, salt: str) -> str:
    return stable_hash([text, salt])[:16]


def _pick_other(candidates: tuple[str, ...], current: object, rng) -> str:
    options = tuple(item for item in candidates if item != current)
    if not options:
        raise PerturbationError(
            "no_alternative_value", f"候选池里没有与现值 {current!r} 不同的取值"
        )
    return options[rng.randrange(len(options))]


def _pick_effective(options: list[tuple[str, str]], current_value: str, rng, axis: str) -> str:
    """只在"渲染后确实不同"的候选里选（循环轴防 no-op）。"""
    candidates = [option for option, rendered in options if rendered != current_value]
    if not candidates:
        raise PerturbationError(
            "no_op_perturbation",
            f"轴 {axis!r} 的每个候选渲染后都与现值相同（{current_value!r}）——空扰动",
        )
    return candidates[rng.randrange(len(candidates))]


def _permute(items: tuple[str, ...], rng) -> tuple[str, ...]:
    if len(items) < 2:
        raise PerturbationError("no_op_perturbation", "可重排项不足两个，重排必然空操作")
    original = tuple(items)
    for _attempt in range(_PERMUTE_ATTEMPTS):
        candidate = shuffled(original, rng)
        if candidate != original:
            return candidate
    raise PerturbationError(
        "no_op_perturbation",
        f"{_PERMUTE_ATTEMPTS} 次重排都得到原顺序（{list(original)}）——空扰动",
    )


__all__ = [
    "IRRELEVANT_AXIS_PATTERN",
    "IRRELEVANT_PERTURBATION_EFFECT",
    "Perturbation",
    "SUPPORTED_AXES",
    "axis_change",
    "irrelevant_perturbation",
]
