"""不变量 registry：可扩展的模板注册表 + ``build_invariant``。

扩展方式（设计 §7.4 的"20 类目录，Phase 1 实现 7 类"就是为了这个）::

    from security_world.invariants import InvariantTemplate, register_invariant

    register_invariant(InvariantTemplate(
        key="replay.nonce_unused",
        category="replay",
        summary="nonce 不得重复使用",
        build=lambda **_: {"op": "not_in", "args": [...]},
        bindings=("token",),
    ))

注册表是**进程内可变**的（``register_invariant`` 会改它），因此：

* 内置模板在 import 时一次性注册（本模块底部）；
* ``invariant_keys()`` 返回**排序后**的键——调用方不得依赖注册顺序；
* 重复键注册是 :class:`DslError`（静默覆盖会让"同一个 key 在不同进程里是不同
  性质"，那等于把标签权威交给 import 顺序）。
"""
from __future__ import annotations

from typing import Any

from ..model.entities import SEVERITIES, Invariant
from ..policy import DslError
from ..policy.parser import parse_expr
from .templates import TEMPLATES, InvariantTemplate, _coerce_params

#: 进程内注册表（``key -> template``）。
_REGISTRY: dict[str, InvariantTemplate] = {}


def register_invariant(template: InvariantTemplate) -> InvariantTemplate:
    """注册一个模板；重复键是 :class:`DslError`（不静默覆盖）。"""
    if not isinstance(template, InvariantTemplate):
        raise DslError(f"register_invariant 需要 InvariantTemplate，得到 {type(template).__name__}")
    if template.key in _REGISTRY:
        raise DslError(
            f"不变量模板键 {template.key!r} 已注册（category={_REGISTRY[template.key].category}）；"
            "重复注册会破坏'同一 key 同一性质'的跨进程稳定性"
        )
    if template.default_severity not in SEVERITIES:
        raise DslError(
            f"模板 {template.key} 的 default_severity 必须是 {list(SEVERITIES)} 之一，"
            f"得到 {template.default_severity!r}"
        )
    if not template.default_applies_to:
        raise DslError(f"模板 {template.key} 的 default_applies_to 不允许为空")
    # 构造期自校验：模板产出的 expr 必须是合法 DSL（模板 bug 在这里就炸）。
    probe = template.build_expr(**{name: _sample_value(name) for name in template.params})
    parse_expr(probe, where=f"template {template.key}")
    _REGISTRY[template.key] = template
    return template


def _sample_value(name: str) -> Any:
    """注册期探针用的占位参数（只为验证 expr 结构合法，绝不进任何世界）。"""
    if name in ("support_roles", "groups", "roles", "states"):
        return ("ROLE-PROBE",)
    if name == "max_depth":
        return 1
    return "PROBE"


def invariant_template(key: str) -> InvariantTemplate:
    """取一个模板；未知键抛 :class:`DslError`（并列出现有键）。"""
    try:
        return _REGISTRY[key]
    except KeyError:
        raise DslError(
            f"未知不变量模板 {key!r}；已注册: {list(invariant_keys())}"
        ) from None


def invariant_keys() -> tuple[str, ...]:
    """全部已注册键（排序，确定性）。"""
    return tuple(sorted(_REGISTRY))


def templates_by_category() -> dict[str, tuple[str, ...]]:
    """``category -> 排序后的模板键``（覆盖度自查用）。"""
    out: dict[str, set[str]] = {}
    for key, template in _REGISTRY.items():
        out.setdefault(template.category, set()).add(key)
    return {category: tuple(sorted(keys)) for category, keys in sorted(out.items())}


def build_invariant(
    key: str,
    *,
    invariant_id: str,
    applies_to: tuple[str, ...] | list[str] | None = None,
    severity: str | None = None,
    description: str | None = None,
    expected_violation_when: str | None = None,
    **params: Any,
) -> Invariant:
    """用模板构造一条 :class:`~security_world.model.entities.Invariant`。

    产出的 ``expr`` 一定过 :func:`parse_expr`——一个模板不可能产出求值器不认识的
    文档。``severity`` 只进报告字段，不参与 ``world_truth`` 聚合（B2）。
    """
    template = invariant_template(key)
    if not isinstance(invariant_id, str) or not invariant_id:
        raise DslError(f"invariant_id 必须是非空字符串，得到 {invariant_id!r}")
    unknown = sorted(name for name in params if name not in template.params)
    if unknown:
        raise DslError(
            f"模板 {key} 不接受参数 {unknown}；可用: {list(template.params)}"
            "（拼错的参数名会被静默丢掉，那等于悄悄换了一条不变量）"
        )
    resolved_applies_to = (
        tuple(template.default_applies_to) if applies_to is None else tuple(applies_to)
    )
    if not resolved_applies_to:
        raise DslError("applies_to 不允许为空")
    resolved_severity = template.default_severity if severity is None else severity
    if resolved_severity not in SEVERITIES:
        raise DslError(
            f"severity 必须是 {list(SEVERITIES)} 之一，得到 {resolved_severity!r}"
        )
    expr = template.build_expr(**_coerce_params(template, params))
    parse_expr(expr, where=f"invariant {invariant_id}.expr")
    document: dict[str, Any] = {
        "invariant_id": invariant_id,
        "category": template.category,
        "expr": expr,
        "severity": resolved_severity,
        "applies_to": list(resolved_applies_to),
    }
    if description is not None:
        document["description"] = description
    if expected_violation_when is not None:
        document["expected_violation_when"] = expected_violation_when
    return Invariant.from_document(document)


def build_library(keys: tuple[str, ...] | list[str], **shared: Any) -> tuple[Invariant, ...]:
    """一次构造多条不变量（``shared`` 里的 ``invariant_id`` / ``applies_to`` 等按序复用）。

    ``keys`` 里每一项可以是 ``"<template key>"`` 或
    ``"<template key>::<INV-ID>"``——后者同时指定不变量 id，测试里更省事。
    """
    out: list[Invariant] = []
    for index, entry in enumerate(keys):
        key, _, explicit_id = entry.partition("::")
        options = dict(shared)
        options.pop("invariant_id", None)
        invariant_id = explicit_id or options.pop("invariant_id_prefix", "INV") + f"-{index:03d}"
        out.append(build_invariant(key, invariant_id=invariant_id, **options))
    return tuple(out)


def registered_templates() -> tuple[InvariantTemplate, ...]:
    """全部模板（按 key 排序，确定性）。"""
    return tuple(_REGISTRY[key] for key in invariant_keys())


for _template in TEMPLATES:
    register_invariant(_template)
del _template


__all__ = [
    "build_invariant",
    "build_library",
    "invariant_keys",
    "invariant_template",
    "register_invariant",
    "registered_templates",
    "templates_by_category",
]
