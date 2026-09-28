"""DSL 文档构造器（不变量模板与测试共用）。

每个构造器都**自校验**：先把文档喂给 :func:`parse_expr`，再返回
``expr.to_document()``。因此一个模板不可能产出一个"看着像 DSL 但求值器不认识"
的文档——模板 bug 在构造期就炸，而不是在 oracle 里变成一个静默的错误 verdict。
"""
from __future__ import annotations

from typing import Any

from .ast import (
    EVIDENCE_BRIDGE_OP,
    LITERAL_OP,
    REF_OP,
    DslError,
    Expr,
)
from .parser import parse_expr


def _checked(document: dict[str, Any], *, where: str) -> dict[str, Any]:
    return parse_expr(document, where=where).to_document()


def ref_expr(path: str, *, on_missing: str = "error") -> dict[str, Any]:
    """``{"op":"ref","path":...}``。"""
    document: dict[str, Any] = {"op": REF_OP, "path": path}
    if on_missing != "error":
        document["on_missing"] = on_missing
    return _checked(document, where="ref_expr")


def lit_expr(value: Any) -> dict[str, Any]:
    """``{"op":"lit","value":...}``（必须是普通 JSON）。"""
    return _checked({"op": LITERAL_OP, "value": value}, where="lit_expr")


def _binary(op: str, left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _checked({"op": op, "args": [left, right]}, where=op)


def eq_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("eq", left, right)


def ne_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("ne", left, right)


def lt_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("lt", left, right)


def le_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("le", left, right)


def gt_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("gt", left, right)


def ge_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("ge", left, right)


def in_expr(needle: dict[str, Any], haystack: dict[str, Any]) -> dict[str, Any]:
    return _binary("in", needle, haystack)


def not_in_expr(needle: dict[str, Any], haystack: dict[str, Any]) -> dict[str, Any]:
    return _binary("not_in", needle, haystack)


def contains_expr(haystack: dict[str, Any], needle: dict[str, Any]) -> dict[str, Any]:
    return _binary("contains", haystack, needle)


def not_contains_expr(haystack: dict[str, Any], needle: dict[str, Any]) -> dict[str, Any]:
    return _binary("not_contains", haystack, needle)


def subset_of_expr(subset: dict[str, Any], superset: dict[str, Any]) -> dict[str, Any]:
    return _binary("subset_of", subset, superset)


def intersects_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("intersects", left, right)


def disjoint_expr(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return _binary("disjoint", left, right)


def is_empty_expr(value: dict[str, Any]) -> dict[str, Any]:
    return _checked({"op": "is_empty", "args": [value]}, where="is_empty_expr")


def and_expr(*args: dict[str, Any]) -> dict[str, Any]:
    if not 1 <= len(args) <= 16:
        raise DslError(f"and_expr 需要 1..16 个参数，得到 {len(args)} 个")
    return _checked({"op": "and", "args": list(args)}, where="and_expr")


def or_expr(*args: dict[str, Any]) -> dict[str, Any]:
    if not 1 <= len(args) <= 16:
        raise DslError(f"or_expr 需要 1..16 个参数，得到 {len(args)} 个")
    return _checked({"op": "or", "args": list(args)}, where="or_expr")


def not_expr(value: dict[str, Any]) -> dict[str, Any]:
    return _checked({"op": "not", "args": [value]}, where="not_expr")


def before_expr(start: dict[str, Any], end: dict[str, Any]) -> dict[str, Any]:
    return _binary("before", start, end)


def after_expr(start: dict[str, Any], end: dict[str, Any]) -> dict[str, Any]:
    return _binary("after", start, end)


def within_expr(start: dict[str, Any], end: dict[str, Any], window_ms: int) -> dict[str, Any]:
    return _checked(
        {"op": "within", "args": [start, end, lit_expr(window_ms)]}, where="within_expr"
    )


def state_is_expr(instance_ref: str, state: str) -> dict[str, Any]:
    """``state_is(<workflow_instance ref>, 'PAID')``——恰好 2 参。"""
    return _checked(
        {"op": "state_is", "args": [ref_expr(instance_ref), lit_expr(state)]},
        where="state_is_expr",
    )


def transition_allowed_expr(instance_ref: str, to_state: str) -> dict[str, Any]:
    """``transition_allowed(<workflow_instance ref>, 'PAID')``——恰好 2 参。

    ``from_state`` 取绑定实例的**当前态**，不作为第三参传入（S3）。
    """
    return _checked(
        {"op": "transition_allowed", "args": [ref_expr(instance_ref), lit_expr(to_state)]},
        where="transition_allowed_expr",
    )


def lineage_depth_expr(token_ref: str) -> dict[str, Any]:
    return _checked(
        {"op": "lineage_depth", "args": [ref_expr(token_ref)]}, where="lineage_depth_expr"
    )


def lineage_root_expr(token_ref: str) -> dict[str, Any]:
    return _checked(
        {"op": "lineage_root", "args": [ref_expr(token_ref)]}, where="lineage_root_expr"
    )


def establishing_evidence_exists_expr(fact_key: str) -> dict[str, Any]:
    """唯一的证据桥（单向：只能把 verdict 降级成 insufficient_evidence）。"""
    return _checked(
        {"op": EVIDENCE_BRIDGE_OP, "args": [fact_key]}, where="establishing_evidence_exists_expr"
    )


__all__ = [
    "after_expr",
    "and_expr",
    "before_expr",
    "contains_expr",
    "disjoint_expr",
    "eq_expr",
    "establishing_evidence_exists_expr",
    "ge_expr",
    "gt_expr",
    "in_expr",
    "intersects_expr",
    "is_empty_expr",
    "le_expr",
    "lineage_depth_expr",
    "lineage_root_expr",
    "lit_expr",
    "lt_expr",
    "ne_expr",
    "not_contains_expr",
    "not_expr",
    "not_in_expr",
    "or_expr",
    "ref_expr",
    "state_is_expr",
    "subset_of_expr",
    "transition_allowed_expr",
    "within_expr",
]
