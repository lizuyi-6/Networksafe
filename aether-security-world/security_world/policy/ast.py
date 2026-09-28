"""Policy / Invariant DSL 的 AST 与 op 目录（设计 §7.1 / §7.2）。

v0.1 是一个**封闭的、无副作用的、可静态分析的表达式 AST**：无循环、无函数定义、
无 import、无 IO、无字符串插值路径、**无证据值读取**，共 **27 个 op**。

每个 op 的语义落在 :mod:`security_world.policy.evaluator`；本模块只负责：

* op 目录（:data:`OPS`，正好 27 个，由测试逐字钉死）；
* 每个 op 的 arity 与允许的节点键（:data:`ARITY` / :data:`NODE_KEYS`）；
* AST 节点 :class:`Expr` 自身的结构不变式（``__post_init__`` 里校验，
  所以一个手工构造的 ``Expr`` 也不可能畸形的）。

``establishing_evidence_exists`` 的参数是**字符串事实键**而不是子表达式
（``schemas/policy.schema.json`` 的 ``$defs.expr`` 逐字这么写），因此它存放在
:attr:`Expr.value` 里而不是 :attr:`Expr.args`——``args`` 的元素类型统一是 ``Expr``。
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from ..model.errors import ModelError

#: DSL 错误：未知 op、arity 不符、路径违规、操作数类型不匹配。
#:
#: 继承 :class:`~security_world.model.errors.ModelError`（它本身是 ``ValueError``），
#: 因此 ``except ValueError`` / ``except ModelError`` 的既有写法都继续工作，
#: 而 ``except DslError`` 仍能单独捕获 DSL 特有的错误。
class DslError(ModelError):
    """DSL 文档或求值错误（确定性、可预期）。"""


# --------------------------------------------------------------------------- #
# op 目录
# --------------------------------------------------------------------------- #
LITERAL_OP = "lit"
REF_OP = "ref"
EVIDENCE_BRIDGE_OP = "establishing_evidence_exists"

#: 比较类（设计 §7.2 表格第 3 行）。
COMPARISON_OPS: tuple[str, ...] = ("eq", "ne", "lt", "le", "gt", "ge")
#: 集合类。
SET_OPS: tuple[str, ...] = ("in", "not_in", "subset_of", "intersects", "disjoint", "is_empty")
#: 布尔类（短路求值）。
BOOLEAN_OPS: tuple[str, ...] = ("and", "or", "not")
#: 字符串类。
STRING_OPS: tuple[str, ...] = ("contains", "not_contains")
#: 时间类（均在虚拟时钟上）。
TEMPORAL_OPS: tuple[str, ...] = ("before", "after", "within")
#: 状态机类（均恰好 2 参：``from_state`` 取绑定实例的当前态）。
STATE_OPS: tuple[str, ...] = ("state_is", "transition_allowed")
#: 血缘类（编译期拒环，故为全函数）。
LINEAGE_OPS: tuple[str, ...] = ("lineage_depth", "lineage_root")

#: 全部 27 个 op，按设计 §7.2 表格的类别顺序书写（顺序即文档顺序，便于对表）。
ALL_OPS: tuple[str, ...] = (
    LITERAL_OP,
    REF_OP,
    *COMPARISON_OPS,
    *SET_OPS,
    *BOOLEAN_OPS,
    *STRING_OPS,
    *TEMPORAL_OPS,
    *STATE_OPS,
    *LINEAGE_OPS,
    EVIDENCE_BRIDGE_OP,
)

#: op 集合（frozenset，成员判定用）。
OPS: frozenset[str] = frozenset(ALL_OPS)

#: 每个 op 的 args 个数区间 ``(min, max)``（按 op 精确化；见 :data:`SCHEMA_ARITY_NOTE`）。
ARITY: dict[str, tuple[int, int]] = {
    LITERAL_OP: (0, 0),
    REF_OP: (0, 0),
    "eq": (2, 2),
    "ne": (2, 2),
    "lt": (2, 2),
    "le": (2, 2),
    "gt": (2, 2),
    "ge": (2, 2),
    "in": (2, 2),
    "not_in": (2, 2),
    "subset_of": (2, 2),
    "intersects": (2, 2),
    "disjoint": (2, 2),
    "is_empty": (1, 1),
    "and": (1, 16),
    "or": (1, 16),
    "not": (1, 1),
    "contains": (2, 2),
    "not_contains": (2, 2),
    "before": (2, 2),
    "after": (2, 2),
    "within": (3, 3),
    "state_is": (2, 2),
    "transition_allowed": (2, 2),
    "lineage_depth": (1, 1),
    "lineage_root": (1, 1),
    EVIDENCE_BRIDGE_OP: (0, 0),
}

#: 每个 op 允许出现的节点键（对应 schema 的 ``additionalProperties: false``）。
NODE_KEYS: dict[str, frozenset[str]] = {
    LITERAL_OP: frozenset({"op", "value"}),
    REF_OP: frozenset({"op", "path", "on_missing"}),
    EVIDENCE_BRIDGE_OP: frozenset({"op", "args"}),
}
for _op in ALL_OPS:
    NODE_KEYS.setdefault(_op, frozenset({"op", "args"}))

#: ``ref`` 节点的 ``on_missing`` 取值（schema default = ``"error"``）。
ON_MISSING_VALUES: tuple[str, ...] = ("error", "unknown")

#: 表达式嵌套深度上限。超过即 :class:`DslError`——DSL 无循环，深层嵌套只可能
#: 是病态文档，而递归求值不该成为栈溢出 DoS。
MAX_EXPR_DEPTH = 64

#: ``and`` / ``or`` 的最大参数个数（与 schema 的 ``maxItems: 16`` 一致）。
MAX_BOOLEAN_ARGS = 16

#: schema 把 ``before`` / ``after`` / ``within`` 的 arity 写成同一个 2..3 的并集
#: （一个 ``oneOf`` 分支表达不了 per-op arity）。:func:`parse_expr` 按 op 精确化：
#: ``before`` / ``after`` 恰好 2 参，``within`` 恰好 3 参。精确化只会拒掉 schema
#: 允许但语义不完整的文档，不会放行语义错误的文档。
SCHEMA_ARITY_NOTE = (
    "schemas/policy.schema.json 对 before/after/within 共用 minItems=2,maxItems=3；"
    "parse_expr 精确化为 before/after=2 参、within=3 参"
)


@dataclass(frozen=True)
class Expr:
    """DSL AST 节点。``op`` 是判别式（27 个取值之一）。

    字段语义（设计 §15.3）::

        op          判别式
        args        子表达式（``and`` / ``or`` / ``not`` / 比较 / 集合 / 时间 / 状态 / 血缘）
        path        ``ref`` 的世界路径（ID 视图 / action 绑定视图 / context 视图）
        value       ``lit`` 的字面量；``establishing_evidence_exists`` 的事实键字符串
        on_missing  ``ref`` 专用：``"error"``（默认，解析失败即抛）或 ``"unknown"``

    ``on_missing`` 与把证据桥的事实键放进 ``value`` 是对 §15.3 四字段契约的**新增**
    （都是带默认值的追加字段，不改变既有四个字段的位置与语义）：前者是 schema 里
    真实存在的属性，后者是因为 schema 规定该 op 的参数是字符串而非子表达式。
    """

    op: str
    args: tuple["Expr", ...] = ()
    path: str | None = None
    value: Any = None
    on_missing: str = "error"

    def __post_init__(self) -> None:
        if not isinstance(self.op, str) or self.op not in OPS:
            raise DslError(f"未知 op {self.op!r}；27 个合法 op: {sorted(OPS)}")
        raw_args = self.args
        if isinstance(raw_args, Expr):  # 单个子节点不当成序列
            raise DslError(f"{self.op}: args 必须是 Expr 数组，得到单个 Expr")
        if raw_args is None:
            raw_args = ()
        if isinstance(raw_args, (str, bytes)) or not isinstance(raw_args, Sequence):
            raise DslError(f"{self.op}: args 必须是数组，得到 {type(raw_args).__name__}")
        args = tuple(raw_args)
        for index, item in enumerate(args):
            if not isinstance(item, Expr):
                raise DslError(f"{self.op}.args[{index}]: 需要 Expr，得到 {type(item).__name__}")
        object.__setattr__(self, "args", args)

        low, high = ARITY[self.op]
        if not low <= len(args) <= high:
            raise DslError(
                f"{self.op}: 需要 {low}..{high} 个参数，得到 {len(args)} 个"
                + (f"（{SCHEMA_ARITY_NOTE}）" if self.op in TEMPORAL_OPS else "")
            )

        if self.op == REF_OP:
            if not isinstance(self.path, str) or not self.path:
                raise DslError("ref 节点需要非空字符串 path")
            if self.on_missing not in ON_MISSING_VALUES:
                raise DslError(
                    f"ref.on_missing 必须是 {list(ON_MISSING_VALUES)} 之一，得到 {self.on_missing!r}"
                )
        else:
            if self.path is not None:
                raise DslError(f"{self.op}: 只有 ref 节点可以有 path")
            if self.on_missing != "error":
                raise DslError(f"{self.op}: 只有 ref 节点可以有 on_missing")

        if self.op == LITERAL_OP:
            _require_json_value(self.value, "lit.value")
        elif self.op == EVIDENCE_BRIDGE_OP:
            if not isinstance(self.value, str) or not self.value:
                raise DslError(
                    f"{EVIDENCE_BRIDGE_OP}: 需要非空字符串事实键（存放在 value，不是 args）"
                )
        elif self.value is not None:
            raise DslError(f"{self.op}: 只有 lit / {EVIDENCE_BRIDGE_OP} 可以有 value")

    # -- 结构查询 ----------------------------------------------------------- #
    @property
    def children(self) -> tuple["Expr", ...]:
        """子表达式（空 tuple 表示叶子）。"""
        return self.args

    def walk(self) -> tuple["Expr", ...]:
        """自身 + 全部后代，前序且确定（文档顺序）。"""
        out: list[Expr] = [self]
        for child in self.args:
            out.extend(child.walk())
        return tuple(out)

    def to_document(self) -> dict[str, Any]:
        """还原成 DSL 文档（``parse_expr(expr.to_document()) == expr``）。"""
        if self.op == LITERAL_OP:
            return {"op": "lit", "value": self.value}
        if self.op == REF_OP:
            document: dict[str, Any] = {"op": "ref", "path": self.path}
            if self.on_missing != "error":
                document["on_missing"] = self.on_missing
            return document
        if self.op == EVIDENCE_BRIDGE_OP:
            return {"op": EVIDENCE_BRIDGE_OP, "args": [self.value]}
        return {"op": self.op, "args": [child.to_document() for child in self.args]}

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        if self.op == REF_OP:
            return f"Expr(ref {self.path!r})"
        if self.op == LITERAL_OP:
            return f"Expr(lit {self.value!r})"
        if self.op == EVIDENCE_BRIDGE_OP:
            return f"Expr({EVIDENCE_BRIDGE_OP} {self.value!r})"
        return f"Expr({self.op} {len(self.args)} args)"


def _require_json_value(value: Any, where: str) -> None:
    """``lit`` 的值必须是普通 JSON（拒绝 NaN / 非字符串键 / 自定义对象）。

    与 :func:`security_world.model.canonical.canonical_json` 的拒绝集保持一致：
    一个字面量如果不能被规范化序列化，它就不可能参与确定性求值。
    """
    if value is None or isinstance(value, (bool, int, str)):
        return
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise DslError(f"{where}: 拒绝非有限浮点数 {value!r}")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise DslError(f"{where}: object 键必须是字符串，得到 {type(key).__name__}")
            _require_json_value(item, f"{where}.{key}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _require_json_value(item, f"{where}[{index}]")
        return
    raise DslError(f"{where}: 不是普通 JSON 值（{type(value).__name__}）")


__all__ = [
    "ALL_OPS",
    "ARITY",
    "BOOLEAN_OPS",
    "COMPARISON_OPS",
    "EVIDENCE_BRIDGE_OP",
    "LINEAGE_OPS",
    "LITERAL_OP",
    "MAX_BOOLEAN_ARGS",
    "MAX_EXPR_DEPTH",
    "NODE_KEYS",
    "OPS",
    "ON_MISSING_VALUES",
    "REF_OP",
    "SCHEMA_ARITY_NOTE",
    "SET_OPS",
    "STATE_OPS",
    "STRING_OPS",
    "TEMPORAL_OPS",
    "DslError",
    "Expr",
]
