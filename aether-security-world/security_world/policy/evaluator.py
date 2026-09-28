"""27 个 op 的求值器：纯函数、无 IO、无随机、无证据值读取。

三条硬规则（设计 §7.1 / §8.1 / §3 D6）：

1. **纯函数。** ``eval_expr(expr, ctx)`` 只读 ``ctx.world`` / ``ctx.action`` /
   ``ctx.evidence_view``，不写世界、不写时钟、不写随机源。求值前后世界的
   ``canonical_json`` 逐字节相同（``test_no_path_mutation``）。
2. **无隐式类型转换。** ``eq`` 是类型严格的（``lit 1`` != ``lit true``，
   ``lit 1`` != ``lit 1.0``）；不可比较的操作数类型抛 :class:`DslError` 而不是
   猜一个顺序。数据工厂最怕"字符串被悄悄转成数字"。
3. **``establishing_evidence_exists`` 是唯一单向桥。** 它只回答"有没有一条
   trusted/semi_trusted 的可见证据断言这个事实键"；它永远不读证据的**值**，
   因此永远不能把 verdict 变成 ``attack``，只能让它变成 ``insufficient_evidence``
   （B19 / §7.2）。truth 趟（``ctx.evidence_view is None``）它恒为 ``True``——
   ``world_truth`` 在完整世界上计算，与证据无关。

``on_missing="unknown"`` 的语义：解析不到的 ref 求值为 :data:`UNKNOWN` 而不是抛错，
而 **UNKNOWN 永不放行**——任何布尔 op 见到 UNKNOWN 都返回 ``False``（``or`` 仍会
因另一个操作数为真而放行）。这是 fail-closed：一个建立不起来的事实不能授权。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..model.canonical import canonical_json
from ..model.clock import compare_instants, is_valid_instant, is_within
from ..model.errors import ModelError, RefResolutionError
from ..model.refs import (
    ACTION_LOCAL_VIEWS,
    ENTITY_TYPES,
    classify_path,
    expand_action_view,
    is_action_view,
    is_context_view,
    is_id_view,
    parse_action_view,
    try_expand_action_view,
)
from ..workflows import WorkflowMachine
from .ast import (
    BOOLEAN_OPS,
    COMPARISON_OPS,
    EVIDENCE_BRIDGE_OP,
    LITERAL_OP,
    LINEAGE_OPS,
    MAX_EXPR_DEPTH,
    REF_OP,
    SET_OPS,
    STATE_OPS,
    STRING_OPS,
    TEMPORAL_OPS,
    DslError,
    Expr,
)
from .context import EvalContext

#: 能建立决策关键事实的信任集（设计 §7.2 / S17；与 ``configs/default.json`` 的
#: ``evidence_masking.trusted_establishes`` 同源）。
TRUSTED_ESTABLISHES: frozenset[str] = frozenset({"trusted", "semi_trusted"})


class _Unknown:
    """``on_missing="unknown"`` 的哨兵值。

    故意**不**实现 ``__bool__``：任何把 UNKNOWN 当布尔用的代码路径都必须显式处理它，
    而不是被 Python 的真值规则悄悄变成 ``False``/``True``。
    """

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return "<unknown>"


#: 求值器内部的"未建立"哨兵（不是 JSON 值，永不进 decision_trace）。
UNKNOWN = _Unknown()


# --------------------------------------------------------------------------- #
# 公共入口
# --------------------------------------------------------------------------- #
def eval_expr(expr: Expr, ctx: EvalContext) -> Any:
    """求值一条 AST，返回任意 JSON 值（布尔 op 返回 ``bool``）。

    短路分支的子表达式**不会被求值**，因此它们读到的 ref 也不会进
    ``ctx.consulted_refs``（§8.2 / B3：consulted_facts 是动态集合）。
    """
    if not isinstance(expr, Expr):
        raise DslError(f"eval_expr 需要 Expr，得到 {type(expr).__name__}")
    if not isinstance(ctx, EvalContext):
        raise DslError(f"eval_expr 需要 EvalContext，得到 {type(ctx).__name__}")
    machine = WorkflowMachine.from_world(ctx.world)
    return _eval(expr, ctx, machine, 0)


def static_refs(expr: Expr) -> frozenset[str]:
    """expr 里出现的全部 ``ref`` 路径（**静态**闭包，不求值）。

    用于 Gate 3 的非空洞性探针（§8.4：从 ref 的声明域采样）与编译期可解析性检查。
    **不含** ``establishing_evidence_exists`` 的事实键——那条键指向证据视图，
    没有"声明域"可采样，探针世界也无法覆盖它。
    """
    if not isinstance(expr, Expr):
        raise DslError(f"static_refs 需要 Expr，得到 {type(expr).__name__}")
    paths: set[str] = set()
    for node in expr.walk():
        if node.op == REF_OP and node.path is not None:
            paths.add(node.path)
    return frozenset(paths)


def action_bindings_read(expr: Expr) -> frozenset[str]:
    """expr 读到的 action 实体绑定（``actor`` / ``resource`` / ... ）。

    不变量作用域判定用：绑定为 ``None`` ⇒ ``skipped_unbound_subject``（§7.4 / B16），
    绝不静默判成满足。
    """
    if not isinstance(expr, Expr):
        raise DslError(f"action_bindings_read 需要 Expr，得到 {type(expr).__name__}")
    bindings: set[str] = set()
    for node in expr.walk():
        if node.op != REF_OP or node.path is None or not is_action_view(node.path):
            continue
        binding, _fields = parse_action_view(node.path)
        if binding not in ACTION_LOCAL_VIEWS:
            bindings.add(binding)
    return frozenset(bindings)


# --------------------------------------------------------------------------- #
# 分发
# --------------------------------------------------------------------------- #
def _eval(expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> Any:
    if depth > MAX_EXPR_DEPTH:
        raise DslError(f"表达式嵌套深度超过 {MAX_EXPR_DEPTH}（求值期防线）")
    op = expr.op
    if op == LITERAL_OP:
        return expr.value
    if op == REF_OP:
        return _resolve_ref(expr, ctx)
    if op in BOOLEAN_OPS:
        return _eval_boolean(op, expr, ctx, machine, depth)
    if op in COMPARISON_OPS:
        left, right = _eval_two(expr, ctx, machine, depth)
        return _compare(op, left, right)
    if op in SET_OPS:
        return _eval_set(op, expr, ctx, machine, depth)
    if op in STRING_OPS:
        return _eval_string(op, expr, ctx, machine, depth)
    if op in TEMPORAL_OPS:
        return _eval_temporal(op, expr, ctx, machine, depth)
    if op in STATE_OPS:
        return _eval_state(op, expr, ctx, machine, depth)
    if op in LINEAGE_OPS:
        return _eval_lineage(op, expr, ctx, machine, depth)
    if op == EVIDENCE_BRIDGE_OP:
        return _eval_bridge(expr, ctx)
    raise DslError(f"未实现求值的 op {op!r}")  # pragma: no cover - ARITY/OPS 已拦


def _eval_args(expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> tuple[Any, ...]:
    return tuple(_eval(child, ctx, machine, depth + 1) for child in expr.args)


def _eval_two(expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> tuple[Any, Any]:
    values = _eval_args(expr, ctx, machine, depth)
    return values[0], values[1]


# --------------------------------------------------------------------------- #
# ref 解析
# --------------------------------------------------------------------------- #
def _resolve_ref(expr: Expr, ctx: EvalContext) -> Any:
    path = expr.path
    assert path is not None  # Expr.__post_init__ 保证
    kind = classify_path(path)
    if kind == "invalid":  # pragma: no cover - parse_expr 已拦
        raise DslError(f"ref 路径 {path!r} 不符合 §4.3 的任何一类视图")
    ctx.record_read(path)

    try:
        return _resolve_ref_value(path, kind, ctx)
    except RefResolutionError:
        if expr.on_missing == "unknown":
            return UNKNOWN
        raise


def _resolve_ref_value(path: str, kind: str, ctx: EvalContext) -> Any:
    if kind == "context":
        return _resolve_context(path, ctx)

    if kind == "action_view":
        binding, fields = parse_action_view(path)
        if binding in ACTION_LOCAL_VIEWS:
            container = ctx.action.parameters if binding == "parameters" else ctx.action.request
            if ctx.action is None:  # pragma: no cover - 防御
                raise DslError("action 局部视图需要 action")
            current: Any = container
            walked: list[str] = []
            for segment in fields:
                walked.append(segment)
                if isinstance(current, Mapping) and segment in current:
                    current = current[segment]
                    continue
                raise RefResolutionError(
                    path,
                    "unbound_subject",
                    detail=(
                        f"action.{binding} 没有字段 {'.'.join(walked)!r}"
                        "（动作局部数据缺键按未绑定处理：fail-closed，规则不匹配）"
                    ),
                )
            return current
        if ctx.action is None:
            raise DslError(f"action 绑定视图 {path!r} 需要 ctx.action")
        expanded = expand_action_view(path, ctx.action)  # 未绑定 ⇒ unbound_subject
        ctx.record_ref(expanded, ctx.action)
        return _resolve_world_path(ctx, expanded)

    # ID 视图
    ctx.record_ref(path, ctx.action)
    return _resolve_world_path(ctx, path)


def _resolve_world_path(ctx: EvalContext, path: str) -> Any:
    """解析一条 ID 视图路径（action 视图已展开成实例路径）。

    悬空引用（``unknown_entity_id`` / ``not_an_id_view`` / ...）是引用完整性违规，
    **硬失败**。**字段缺失**（``unknown_field``：实体存在但没有这个可选字段）不是悬空
    引用——编译期已经挡掉"任何实体都没有这个字段"的拼写错误
    （``compile._check_ref_path``），运行期剩下的只是"这个实体没有声明该可选字段"
    （L1 的 ``to_document`` 还会把空集合整个丢掉，于是"声明成空"与"没声明"在注册表
    里不可分辨）。此时按 :data:`UNKNOWN` 处理：UNKNOWN 永不放行 ⇒ fail-closed，
    且 ``or(owner, groups)`` 这种表达式仍能因另一个分支为真而满足——比"整条不变量
    判违反"或"崩掉 oracle"都更接近真实语义。
    """
    try:
        return ctx.world.resolve(path)
    except RefResolutionError as exc:
        if exc.reason == "unknown_field":
            return UNKNOWN
        raise


def _resolve_context(path: str, ctx: EvalContext) -> Any:
    """context 视图：虚拟时钟与当前 flow（都不是世界事实，不进 consulted_facts）。"""
    if path == "current_time":
        if ctx.now:
            return ctx.now
        if ctx.action is not None and ctx.action.at:
            return ctx.action.at
        raise DslError("current_time 需要 VirtualClock（ctx.now 或 action.at）")
    if is_context_view(path) and path.startswith("current_flow."):
        field = path.split(".", 1)[1]
        if field == "flow_id":
            if ctx.current_flow_id:
                return ctx.current_flow_id
            if ctx.action is not None:
                return ctx.action.flow_id
            raise DslError("current_flow.flow_id 需要 ctx.current_flow_id 或 action.flow_id")
        raise RefResolutionError(
            path, "unknown_field", detail=f"context 视图只支持 current_flow.flow_id，得到 {field!r}"
        )
    raise DslError(f"不支持的 context 视图 {path!r}")  # pragma: no cover - classify 已拦


# --------------------------------------------------------------------------- #
# 布尔（短路）
# --------------------------------------------------------------------------- #
def _eval_boolean(op: str, expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> bool:
    if op == "and":
        for child in expr.args:
            value = _as_bool(_eval(child, ctx, machine, depth + 1), child)
            if value is UNKNOWN or not value:
                return False
        return True
    if op == "or":
        for child in expr.args:
            value = _as_bool(_eval(child, ctx, machine, depth + 1), child)
            if value is True:
                return True
        return False
    # not
    value = _as_bool(_eval(expr.args[0], ctx, machine, depth + 1), expr.args[0])
    if value is UNKNOWN:
        return False
    return not value


def _as_bool(value: Any, node: Expr) -> Any:
    if value is UNKNOWN:
        return UNKNOWN
    if isinstance(value, bool):
        return value
    raise DslError(
        f"{node.op}: 布尔 op 的操作数必须求值为 boolean，得到 {type(value).__name__}: {value!r}"
    )


# --------------------------------------------------------------------------- #
# 比较
# --------------------------------------------------------------------------- #
def _compare(op: str, left: Any, right: Any) -> bool:
    if left is UNKNOWN or right is UNKNOWN:
        return False
    if op == "eq":
        return _strict_equal(left, right)
    if op == "ne":
        return not _strict_equal(left, right)
    ordered_left, ordered_right = _ordered_pair(left, right, op)
    if op == "lt":
        return ordered_left < ordered_right
    if op == "le":
        return ordered_left <= ordered_right
    if op == "gt":
        return ordered_left > ordered_right
    return ordered_left >= ordered_right


def _strict_equal(left: Any, right: Any) -> bool:
    """类型严格的深度相等。

    ``type(a) is type(b)`` 挡掉 ``1 == True`` / ``1 == 1.0``；
    ``canonical_json`` 做深度比较，因此 ``[true] != [1]``（json 文本不同）。
    """
    if type(left) is not type(right):
        return False
    try:
        return canonical_json(left) == canonical_json(right)
    except ModelError as exc:
        raise DslError(f"eq 的操作数无法规范化序列化: {exc}") from exc


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _ordered_pair(left: Any, right: Any, op: str) -> tuple[Any, Any]:
    """可排序的操作数对：双数字 ⇒ 数值序；双字符串 ⇒ 字典序；否则 :class:`DslError`。"""
    if _is_number(left) and _is_number(right):
        return left, right
    if isinstance(left, str) and isinstance(right, str):
        return left, right
    raise DslError(
        f"{op}: 操作数不可比较（{type(left).__name__} vs {type(right).__name__}）；"
        "DSL 不做隐式类型转换，时间比较请用 before/after/within"
    )


# --------------------------------------------------------------------------- #
# 集合
# --------------------------------------------------------------------------- #
def _eval_set(op: str, expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> bool:
    if op == "is_empty":
        value = _eval(expr.args[0], ctx, machine, depth + 1)
        if value is UNKNOWN:
            return False
        return _is_empty(value)
    left, right = _eval_two(expr, ctx, machine, depth)
    if left is UNKNOWN or right is UNKNOWN:
        return False
    if op == "in":
        return _shares_element(left, right, expr)
    if op == "not_in":
        return not _shares_element(left, right, expr)
    haystack = _as_sequence(right, expr)
    needle_seq = _as_sequence(left, expr)
    if op == "subset_of":
        return all(any(_strict_equal(item, other) for other in haystack) for item in needle_seq)
    if op == "intersects":
        return any(any(_strict_equal(item, other) for other in haystack) for item in needle_seq)
    # disjoint
    return not any(any(_strict_equal(item, other) for other in haystack) for item in needle_seq)


def _shares_element(left: Any, right: Any, node: Expr) -> bool:
    """``in(a, b)``：a 与 b 有共同元素（标量按单元素集合处理）。

    黄金 fixture 的写法是 ``in(action.actor.roles, lit ["ROLE-SUPPORT"])``——两个都是
    数组，语义是"交集非空"（"主体持有其中之一"）；而模板
    ``authorization.privilege_required`` 的写法是 ``in(lit "order:refund",
    action.actor.privileges)``——一个是标量，语义是经典成员判定。两种写法都必须
    成立，因此这里按"至少一方是数组 ⇒ 求共同元素"统一，两个操作数都不是数组时抛
    :class:`DslError`（不猜）。

    字符串**不**当集合：子串判定属于 ``contains``，否则 ``in("a", "abc")`` 会悄悄
    变成字符包含，与 ``contains`` 语义重叠。
    """
    left_is_seq = isinstance(left, (list, tuple))
    right_is_seq = isinstance(right, (list, tuple))
    if left_is_seq and right_is_seq:
        return any(_strict_equal(a, b) for a in left for b in right)
    if left_is_seq:
        return any(_strict_equal(right, item) for item in left)
    if right_is_seq:
        return any(_strict_equal(left, item) for item in right)
    raise DslError(
        f"in: 需要至少一个数组操作数，得到 ({type(left).__name__}, {type(right).__name__})"
    )


def _as_sequence(value: Any, node: Expr) -> Sequence[Any]:
    if isinstance(value, (list, tuple)):
        return value
    raise DslError(
        f"{node.op}: 需要数组操作数，得到 {type(value).__name__}: {value!r}"
        "（BNF 不支持下标访问，集合 op 只接受整个数组字段）"
    )


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (str, list, tuple, Mapping)):
        return len(value) == 0
    raise DslError(f"is_empty: 需要字符串/数组/object/null，得到 {type(value).__name__}")


# --------------------------------------------------------------------------- #
# 字符串
# --------------------------------------------------------------------------- #
def _eval_string(op: str, expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> bool:
    left, right = _eval_two(expr, ctx, machine, depth)
    if left is UNKNOWN or right is UNKNOWN:
        return False
    contained = _contains(left, right)
    return contained if op == "contains" else not contained


def _contains(haystack: Any, needle: Any) -> bool:
    """字符串 ⇒ 子串；数组 ⇒ 成员（严格相等）；其余组合抛 :class:`DslError`。"""
    if isinstance(haystack, str) and isinstance(needle, str):
        return needle in haystack
    if isinstance(haystack, (list, tuple)):
        return any(_strict_equal(needle, item) for item in haystack)
    raise DslError(
        f"contains: 需要 (string, string) 或 (array, scalar)，得到 "
        f"({type(haystack).__name__}, {type(needle).__name__})"
    )


# --------------------------------------------------------------------------- #
# 时间（虚拟时钟）
# --------------------------------------------------------------------------- #
def _eval_temporal(op: str, expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> bool:
    values = _eval_args(expr, ctx, machine, depth)
    if any(value is UNKNOWN for value in values):
        return False
    if op == "within":
        window = values[2]
        if isinstance(window, bool) or not isinstance(window, int):
            raise DslError(f"within: 窗口必须是非负整数毫秒，得到 {window!r}")
        start, end = _as_instant(values[0], "within"), _as_instant(values[1], "within")
        return is_within(start, end, window)
    start, end = _as_instant(values[0], op), _as_instant(values[1], op)
    order = compare_instants(start, end)
    return order < 0 if op == "before" else order > 0


def _as_instant(value: Any, op: str) -> str:
    if not is_valid_instant(value):
        raise DslError(f"{op}: 需要 VirtualClock 时间戳（^YYYY-MM-DDThh:mm:ss[.f]Z$），得到 {value!r}")
    return value


# --------------------------------------------------------------------------- #
# 状态机
# --------------------------------------------------------------------------- #
def _eval_state(op: str, expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> bool:
    if ctx.action is None:
        raise DslError(f"{op} 需要 action 绑定（从绑定实例取当前态）")
    instance_value = _eval(expr.args[0], ctx, machine, depth + 1)
    state_value = _eval(expr.args[1], ctx, machine, depth + 1)
    if instance_value is UNKNOWN or state_value is UNKNOWN:
        return False
    instance_id = _workflow_instance_id(expr.args[0], instance_value, ctx)
    if not isinstance(state_value, str) or not state_value:
        raise DslError(f"{op}: 第二个参数必须是非空状态名字符串，得到 {state_value!r}")
    if op == "state_is":
        return machine.state_is(instance_id, state_value)
    return machine.transition_allowed(instance_id, state_value, ctx)


def _workflow_instance_id(node: Expr, value: Any, ctx: EvalContext) -> str:
    """从 ``state_is`` / ``transition_allowed`` 的第一个参数取出 workflow_instance id。

    优先按**路径**取（``token.TOK-001.scope`` 这种"ref 指向某实体"的写法不会因为
    字段值恰好是 id 而被误用），取不到再退回求值结果（``action.token.token_id``
    求值出来就是 id 本身）。
    """
    if node.op == REF_OP and node.path is not None:
        path = node.path
        if is_action_view(path):
            expanded = try_expand_action_view(path, ctx.action) if ctx.action is not None else None
            if expanded is None:
                raise RefResolutionError(
                    path, "unbound_subject", detail="action.workflow_instance 未绑定"
                )
            path = expanded
        if is_id_view(path):
            entity_type, entity_id, _fields = split_entity_path(path, ctx.world)
            if entity_type != "workflow_instance":
                raise DslError(
                    f"状态机 op 的第一个参数必须指向 workflow_instance，得到 {entity_type!r}"
                )
            return entity_id
    if isinstance(value, str) and value:
        return value
    raise DslError(f"状态机 op 的第一个参数无法解析成 workflow_instance id: {value!r}")


# --------------------------------------------------------------------------- #
# 血缘
# --------------------------------------------------------------------------- #
def _eval_lineage(op: str, expr: Expr, ctx: EvalContext, machine: WorkflowMachine, depth: int) -> Any:
    token_value = _eval(expr.args[0], ctx, machine, depth + 1)
    if token_value is UNKNOWN:
        return 0 if op == "lineage_depth" else ""
    token_id = _token_id(expr.args[0], token_value, ctx)
    chain = _token_chain(token_id, ctx)
    if op == "lineage_depth":
        return len(chain) - 1
    # lineage_root = **根祖先的 flow_id**（设计 §7.2），不是根祖先的 id。
    return ctx.world.resolve(f"token.{chain[-1]}.flow_id")


def _token_id(node: Expr, value: Any, ctx: EvalContext) -> str:
    if node.op == REF_OP and node.path is not None:
        path = node.path
        if is_action_view(path):
            expanded = try_expand_action_view(path, ctx.action) if ctx.action is not None else None
            if expanded is None:
                raise RefResolutionError(path, "unbound_subject", detail="action.token 未绑定")
            path = expanded
        if is_id_view(path):
            entity_type, entity_id, _fields = split_entity_path(path, ctx.world)
            if entity_type != "token":
                raise DslError(f"血缘 op 的参数必须指向 token，得到 {entity_type!r}")
            return entity_id
    if isinstance(value, str) and value:
        return value
    raise DslError(f"血缘 op 的参数无法解析成 token id: {value!r}")


def _token_chain(token_id: str, ctx: EvalContext) -> tuple[str, ...]:
    """从 ``token_id`` 沿 ``parent_token`` 上溯到根，返回 id 链（含自身）。

    编译期已拒环（``token_cycle_errors``），这里仍做有界防御：一个环就让
    ``lineage_depth`` / ``lineage_root`` 变成非全函数，比抛错危险得多。
    """
    tokens = {token.token_id: token for token in ctx.world.tokens}
    if token_id not in tokens:
        raise RefResolutionError(
            f"token.{token_id}", "unknown_entity_id", detail=f"tokens 集合里没有 {token_id!r}"
        )
    chain: list[str] = [token_id]
    seen = {token_id}
    current = tokens[token_id]
    while current.parent_token is not None:
        parent_id = current.parent_token
        if parent_id in seen:
            raise DslError(f"token {token_id} 的 parent_token 链上存在环（{parent_id!r}）")
        if parent_id not in tokens:
            raise RefResolutionError(
                f"token.{parent_id}", "unknown_entity_id", detail=f"parent_token 悬空: {parent_id!r}"
            )
        seen.add(parent_id)
        chain.append(parent_id)
        current = tokens[parent_id]
        if len(chain) > len(tokens) + 1:  # pragma: no cover - 环已被上面拦下
            raise DslError("parent_token 链长度超过 token 总数（疑似环）")
    return tuple(chain)


# --------------------------------------------------------------------------- #
# 证据桥（单向）
# --------------------------------------------------------------------------- #
def _eval_bridge(expr: Expr, ctx: EvalContext) -> bool:
    """``establishing_evidence_exists(fact_key)``。

    * truth 趟（``evidence_view is None``）恒为 ``True``：``world_truth`` 只依赖
      世界状态，证据掩蔽不得移动它。
    * observable 趟：至少一条**可见**证据断言该事实键且 ``trust_level`` 属于
      ``TRUSTED_ESTABLISHES = {trusted, semi_trusted}``。

    事实键计入 ``consulted_refs``：决策确实依赖"这条证据是否存在"，因此它也必须
    通过充分性检查——桥返回 ``False`` 时该事实不可建立，verdict 只能降级成
    ``insufficient_evidence``，永远不会变成 ``attack``（单向性）。
    """
    fact_key = expr.value
    assert isinstance(fact_key, str)
    ctx.consulted_refs.add(fact_key)
    view = ctx.evidence_view
    if view is None:
        return True
    return any(item.trust_level in TRUSTED_ESTABLISHES for item in view.asserting(fact_key))


# --------------------------------------------------------------------------- #
# 路径切分（id 段允许含 "."，必须最长匹配）
# --------------------------------------------------------------------------- #
def split_entity_path(path: str, world: Any) -> tuple[str, str, tuple[str, ...]]:
    """把 ID 视图路径切成 ``(entity_type, entity_id, fields)``。

    schema 的 id 模式允许出现 ``.``，纯正则贪婪匹配会切错
    （``actor.ACT-001.identity.email`` 的 id 段会被误切成 ``ACT-001.identity``），
    因此与 :meth:`ReferenceRegistry.resolve` 用同一套**最长匹配**规则。
    """
    kind = classify_path(path)
    if kind != "id_view":
        raise DslError(f"{path!r} 不是 ID 视图路径（{kind}）")
    segments = path.split(".")
    entity_type = segments[0]
    if entity_type not in ENTITY_TYPES:  # pragma: no cover - 模式已约束
        raise DslError(f"{entity_type!r} 不是实体类型")
    for end in range(len(segments) - 1, 1, -1):
        candidate = ".".join(segments[1:end])
        if world.registry.has_entity(entity_type, candidate):
            return entity_type, candidate, tuple(segments[end:])
    raise RefResolutionError(
        path,
        "unknown_entity_id",
        detail=f"{entity_type} 集合里没有 {'.'.join(segments[1:])!r}（悬空引用）",
    )


__all__ = [
    "TRUSTED_ESTABLISHES",
    "UNKNOWN",
    "action_bindings_read",
    "eval_expr",
    "split_entity_path",
    "static_refs",
]
