"""DSL 文档 → :class:`~security_world.policy.ast.Expr` 的严格解析器。

设计 §7.1 / §7.3：**未知 op / arity / 路径违规 ⇒ DslError**。解析器不做任何
"补一个合理值"的修复——一个能被静默修复的 DSL 文档，等于把标签权威从程序交给
写文档的人。

与 schema 的分工：``schemas/policy.schema.json`` 在**文档层`` 校验形状
（``oneOf`` + 正则），本模块在**语义层**校验（op 存在、arity 精确、``ref`` 路径
属于 §4.3 的三类视图之一、``establishing_evidence_exists`` 的参数是 ID 视图）。
两层都过才算可求值。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..model.refs import (
    ACTION_VIEW_PATTERN,
    CONTEXT_VIEW_PATTERN,
    ID_VIEW_PATTERN,
    classify_path,
)
from .ast import (
    ARITY,
    EVIDENCE_BRIDGE_OP,
    LITERAL_OP,
    MAX_EXPR_DEPTH,
    NODE_KEYS,
    OPS,
    REF_OP,
    DslError,
    Expr,
)

#: ``establishing_evidence_exists`` 的参数模式（与 schema 的 items.pattern 逐字一致：
#: 只接受 ID 视图——证据断言的正是 ID 视图路径，D3/B14）。
BRIDGE_FACT_PATTERN = ID_VIEW_PATTERN


def parse_expr(node: Any, *, where: str = "expr", _depth: int = 0) -> Expr:
    """把 DSL 文档解析成 AST。任何结构问题都抛 :class:`DslError`。

    参数
    ----
    node:
        DSL 文档（``Mapping``）。必须是 ``{"op": ...}`` 形态。
    where:
        错误信息里的位置前缀（递归时自动变成 ``expr.args[0]`` 这类）。
    """
    if _depth > MAX_EXPR_DEPTH:
        raise DslError(f"{where}: 表达式嵌套深度超过 {MAX_EXPR_DEPTH}（DSL 无循环，深层嵌套即病态文档）")
    if not isinstance(node, Mapping):
        raise DslError(f"{where}: DSL 节点必须是 object，得到 {type(node).__name__}")
    for key in node:
        if not isinstance(key, str):
            raise DslError(f"{where}: object 键必须是字符串，得到 {type(key).__name__}")

    op = node.get("op")
    if not isinstance(op, str) or not op:
        raise DslError(f"{where}: 缺少字符串 op")
    if op not in OPS:
        raise DslError(f"{where}: 未知 op {op!r}；27 个合法 op: {sorted(OPS)}")

    allowed = NODE_KEYS[op]
    unknown = sorted(key for key in node if key not in allowed)
    if unknown:
        raise DslError(f"{where}: {op} 节点出现未定义的键 {unknown}（additionalProperties: false）")

    if op == LITERAL_OP:
        if "value" not in node:
            raise DslError(f"{where}: lit 节点缺少 value")
        return Expr(op=LITERAL_OP, value=node["value"])

    if op == REF_OP:
        path = node.get("path")
        if not isinstance(path, str) or not path:
            raise DslError(f"{where}: ref 节点需要非空字符串 path")
        kind = classify_path(path)
        if kind == "invalid":
            raise DslError(
                f"{where}: ref 路径 {path!r} 不符合 §4.3 的任何一类视图"
                "（ID 视图 / action 绑定视图 / current_flow.*|current_time）"
            )
        on_missing = node.get("on_missing", "error")
        return Expr(op=REF_OP, path=path, on_missing=on_missing)

    if op == EVIDENCE_BRIDGE_OP:
        args = node.get("args")
        if isinstance(args, (str, bytes)) or not isinstance(args, Sequence):
            raise DslError(f"{where}: {EVIDENCE_BRIDGE_OP} 的 args 必须是数组")
        items = list(args)
        if len(items) != 1:
            raise DslError(f"{where}: {EVIDENCE_BRIDGE_OP} 恰好 1 个参数，得到 {len(items)} 个")
        fact_key = items[0]
        if not isinstance(fact_key, str) or not fact_key:
            raise DslError(f"{where}: {EVIDENCE_BRIDGE_OP} 的参数必须是非空字符串事实键")
        if not BRIDGE_FACT_PATTERN.match(fact_key):
            raise DslError(
                f"{where}: {EVIDENCE_BRIDGE_OP} 的事实键 {fact_key!r} 不是 ID 视图路径"
                "（证据 asserts_ref 与 decision_fact 共用同一命名空间，D3/B14）"
            )
        return Expr(op=EVIDENCE_BRIDGE_OP, value=fact_key)

    # 其余 op：args 是 Expr 数组
    args = node.get("args")
    if args is None:
        raise DslError(f"{where}: {op} 节点缺少 args")
    if isinstance(args, (str, bytes)) or not isinstance(args, Sequence):
        raise DslError(f"{where}: {op} 的 args 必须是数组，得到 {type(args).__name__}")
    items = list(args)
    low, high = ARITY[op]
    if not low <= len(items) <= high:
        raise DslError(f"{where}: {op} 需要 {low}..{high} 个参数，得到 {len(items)} 个")
    children = tuple(
        parse_expr(item, where=f"{where}.args[{index}]", _depth=_depth + 1)
        for index, item in enumerate(items)
    )
    return Expr(op=op, args=children)


def parse_condition(condition: Any, *, where: str = "condition") -> Expr:
    """:func:`parse_expr` 的语义化入口——policy condition / invariant expr 都用它。"""
    return parse_expr(condition, where=where)


__all__ = ["BRIDGE_FACT_PATTERN", "parse_condition", "parse_expr"]
