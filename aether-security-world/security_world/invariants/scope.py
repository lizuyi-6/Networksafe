"""不变量的作用域判定与求值（设计 §7.4 / §8.2 truth 趟）。

三条不变式（``test_invariant_scope_never_silently_skipped`` 逐条断言）：

1. **三分划完备**：``violated ∪ satisfied ∪ skipped == world.invariants``——
   每条不变量都必须出现在某一类里，绝不静默消失。
2. **三分划不交**：同一条不变量不会同时进两类。
3. **越界不计满足**：``applies_to`` 不含该 operation ⇒ ``skipped_out_of_scope``；
   读到的 action 绑定为 ``None`` ⇒ ``skipped_unbound_subject``。两者都进 trace，
   都不进 ``satisfied_invariants``（B17：黄金 fixture 曾把越界不变量记成 satisfied）。

``severity`` **只进报告**：任何被违反的安全不变量都是 attack（B2）。
``ATTACK_CATEGORIES`` 是引擎私有常量且等于全部 20 类，不随作者输入变化。
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from enum import Enum
from typing import Any

from ..model.entities import INVARIANT_CATEGORIES, Invariant
from ..model.errors import RefResolutionError
from ..model.refs import is_action_view, try_expand_action_view
# 跨包只经包级公共 API（设计 §15.2 硬规则 1：禁止深导入）。
from ..policy import (
    EvalContext,
    action_bindings_read,
    eval_expr,
    is_self_establishing_identity,
    matched_policies,
    parse_expr,
    static_refs,
)

#: 引擎私有常量：被违反的安全不变量就是攻击，与 category 无关（§8.2 / B2）。
#: 取值来自 ``schemas/policy.schema.json`` 的 20 类枚举（L1 的唯一权威表）。
ATTACK_CATEGORIES: frozenset[str] = frozenset(INVARIANT_CATEGORIES)


class InvariantScope(Enum):
    """一条不变量在这次求值里的作用域。"""

    #: 在作用域内且主体已绑定，已求值。
    EVALUATED = "evaluated"
    #: ``applies_to`` 不含该 operation。
    SKIPPED_OUT_OF_SCOPE = "out_of_scope"
    #: 在作用域内，但 expr 读到的 action 绑定为 ``None``。
    SKIPPED_UNBOUND_SUBJECT = "unbound_subject"


@dataclass(frozen=True)
class InvariantResult:
    """一条不变量的求值结果（设计 §15.3）。"""

    invariant_id: str
    category: str
    severity: str  # 只进报告，不参与聚合
    scope: InvariantScope
    satisfied: bool
    trace: tuple[dict[str, Any], ...]

    @property
    def skipped(self) -> bool:
        return self.scope is not InvariantScope.EVALUATED

    @property
    def violated(self) -> bool:
        return self.scope is InvariantScope.EVALUATED and not self.satisfied

    def to_document(self) -> dict[str, Any]:
        return {
            "invariant_id": self.invariant_id,
            "category": self.category,
            "severity": self.severity,
            "scope": self.scope.value,
            "satisfied": self.satisfied,
            "trace": [dict(step) for step in self.trace],
        }


def invariant_scope(invariant: Invariant, action: Any, world: Any = None) -> InvariantScope:
    """不变量对这次 action 的作用域（不求值）。

    ``["*"]`` 的语义是"对该 action **实际绑定的实体**求值"（B16）：未绑定即
    ``skipped_unbound_subject``，绝不静默判成满足。

    ``world`` 给出时额外做一步**可解析性探测**：action 视图展开成实例路径后必须
    能在本世界解析。这一步挡的是"可选字段在不同实体上不全"——``action.actor.groups``
    对有没有 ``groups`` 的 actor 是两条不同的路，编译期只要求"某类实体里至少一个有
    该字段"（``compile.py`` 的 ``_check_ref_path``），运行期才可能踩到没有的那个。
    这类路径按未绑定主体跳过，而不是让 oracle 抛一个 ``unknown_field`` 崩掉。
    """
    if not invariant.applies_to_operation(action.operation):
        return InvariantScope.SKIPPED_OUT_OF_SCOPE
    if unbound_bindings(invariant, action, world):
        return InvariantScope.SKIPPED_UNBOUND_SUBJECT
    return InvariantScope.EVALUATED


def unbound_bindings(invariant: Invariant, action: Any, world: Any = None) -> tuple[str, ...]:
    """invariant.expr 读到、但 action 没有绑定的实体绑定（排序）。

    ``world`` 参数保留给调用方一致性（本函数不需要它）：**字段缺失不算未绑定主体**——
    求值器对 ID 视图的 ``unknown_field`` 返回 UNKNOWN（fail-closed），于是
    ``or(owner, groups)`` 仍能因属主分支为真而满足，整条不变量不会被误判成越界。
    """
    expr = parse_expr(invariant.expr, where=f"invariant {invariant.invariant_id}.expr")
    bindings = action_bindings_read(expr)
    return tuple(sorted(binding for binding in bindings if not action.is_bound(binding)))


def evaluate_invariants(
    world: Any,
    action: Any,
    *,
    ctx: EvalContext | None = None,
    step_offset: int = 0,
) -> tuple[InvariantResult, ...]:
    """按 ``world.invariants`` 的文档顺序求值全部不变量。

    ``ctx`` 由调用方（oracle）提供时，求值读到的 ref 会累积进
    ``ctx.consulted_refs``—— consulted_facts 是**跨规则的全集**，不是每条
    不变量各算一套。

    保证：返回值的个数 == ``len(world.invariants)``，且三分划完备、两两不交。
    """
    if ctx is None:
        ctx = EvalContext(world=world, action=action, now=action.at, current_flow_id=action.flow_id)
    results: list[InvariantResult] = []
    step = step_offset
    for invariant in world.invariants:
        scope = invariant_scope(invariant, action, world)
        if scope is InvariantScope.SKIPPED_OUT_OF_SCOPE:
            reason = "out_of_scope"
        elif scope is InvariantScope.SKIPPED_UNBOUND_SUBJECT:
            reason = "unbound_subject"
        else:
            reason = ""
        if scope is not InvariantScope.EVALUATED:
            trace_step = {
                "step": step,
                "rule": "invariant.skip",
                "operands": {"invariant_id": invariant.invariant_id, "reason": reason},
                "result": f"skipped_{reason}",
            }
            results.append(
                InvariantResult(
                    invariant_id=invariant.invariant_id,
                    category=invariant.category,
                    severity=invariant.severity,
                    scope=scope,
                    satisfied=False,
                    trace=(trace_step,),
                )
            )
            step += 1
            continue

        expr = parse_expr(invariant.expr, where=f"invariant {invariant.invariant_id}.expr")
        scoped = dataclasses.replace(ctx, consulted_refs=set(), read_paths=set())
        try:
            value = eval_expr(expr, scoped)
        except RefResolutionError as exc:
            if not is_action_view(exc.path):
                raise
            # 防御性兜底：静态作用域判定漏掉的 action 视图缺键（例如条件迁移的
            # condition 里读了未绑定主体）。按未绑定跳过，绝不静默判成满足。
            ctx.consulted_refs.update(scoped.consulted_refs)
            ctx.read_paths.update(scoped.read_paths)
            trace_step = {
                "step": step,
                "rule": "invariant.skip",
                "operands": {
                    "invariant_id": invariant.invariant_id,
                    "reason": "unbound_subject",
                },
                "result": "skipped_unbound_subject",
            }
            results.append(
                InvariantResult(
                    invariant_id=invariant.invariant_id,
                    category=invariant.category,
                    severity=invariant.severity,
                    scope=InvariantScope.SKIPPED_UNBOUND_SUBJECT,
                    satisfied=False,
                    trace=(trace_step,),
                )
            )
            step += 1
            continue
        if not isinstance(value, bool):
            raise ValueError(
                f"invariant {invariant.invariant_id}.expr 必须求值为 boolean，得到 {value!r}"
            )
        ctx.consulted_refs.update(scoped.consulted_refs)
        ctx.read_paths.update(scoped.read_paths)
        trace_step = {
            "step": step,
            "rule": "invariant.evaluate",
            "operands": {
                "invariant_id": invariant.invariant_id,
                "applies_to": list(invariant.applies_to),
            },
            "result": "satisfied" if value else "violated",
        }
        results.append(
            InvariantResult(
                invariant_id=invariant.invariant_id,
                category=invariant.category,
                severity=invariant.severity,
                scope=InvariantScope.EVALUATED,
                satisfied=value,
                trace=(trace_step,),
            )
        )
        step += 1
    return tuple(results)


def partition(
    results: tuple[InvariantResult, ...],
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[dict[str, str], ...]]:
    """``(violated, satisfied, skipped)``，顺序即求值顺序（确定性）。"""
    violated = tuple(r.invariant_id for r in results if r.violated)
    satisfied = tuple(r.invariant_id for r in results if r.scope is InvariantScope.EVALUATED and r.satisfied)
    skipped = tuple(
        {"invariant_id": r.invariant_id, "reason": r.scope.value}
        for r in results
        if r.skipped
    )
    return violated, satisfied, skipped


def partition_is_complete(results: tuple[InvariantResult, ...], world: Any) -> bool:
    """三分划完备且不交（oracle 输出的可断言性质，B17）。"""
    violated, satisfied, skipped = partition(results)
    universe = {invariant.invariant_id for invariant in world.invariants}
    collected = list(violated) + list(satisfied) + [item["invariant_id"] for item in skipped]
    return len(collected) == len(set(collected)) and set(collected) == universe


def decision_facts(world: Any, action: Any) -> frozenset[str]:
    """这次决策可能依赖的**世界事实**（ID 视图路径，action 视图已展开）。

    静态闭包：匹配当前 action 的全部策略 + 作用域内的全部不变量读到的 ref，
    展开成实例路径后去掉"action 绑定自身的身份字段"（由 action 文档建立）。

    与 oracle 的动态 ``consulted_facts`` 的关系：这是**过近似**（含被短路分支
    读到的 ref），供 masking / Gate 7 规划隐藏集合用；判决用的充分性判定必须用
    动态集合（§8.2 / B3）。两者共用同一套"自建立绑定"规则，因此命名空间一致。
    """
    paths: set[str] = set()

    def collect(condition: Any, where: str) -> None:
        for path in static_refs(parse_expr(condition, where=where)):
            if is_action_view(path):
                expanded = try_expand_action_view(path, action)
                if expanded is None:
                    continue
                paths.add(expanded)
            else:
                paths.add(path)

    for policy in matched_policies(world, action):
        collect(policy.condition, f"policy {policy.policy_id}.condition")
    for invariant in world.invariants:
        if invariant_scope(invariant, action, world) is not InvariantScope.EVALUATED:
            continue
        collect(invariant.expr, f"invariant {invariant.invariant_id}.expr")

    # 与动态 consulted_refs 同一套规则：绑定自身的身份字段不是"需要证据的事实"。
    return frozenset(
        path for path in paths if not is_self_establishing_identity(path, action)
    )


__all__ = [
    "ATTACK_CATEGORIES",
    "InvariantResult",
    "InvariantScope",
    "decision_facts",
    "evaluate_invariants",
    "invariant_scope",
    "partition",
    "partition_is_complete",
    "unbound_bindings",
]
