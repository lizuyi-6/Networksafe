"""策略匹配算法（设计 §7.3）。

```
1. 收集 action_pattern 匹配的 policy（operation 相等或 "*"，resource_type 相等或省略）
2. 按 (priority desc, is_default_rule asc, policy_id asc) 排序   # 确定性 tie-break
3. 取第一条 condition 求值为 true 的 policy，其 effect 即决策
4. 无匹配 ⇒ default_effect = deny（封闭世界，fail-closed）
```

REVISION 3（21-world 深审 P0-1）：排序键在 ``priority`` 与 ``policy_id`` 之间插入
``is_default_rule``。**为什么必须有这一位**：``lit(true)`` 的兜底 deny 规则
（``POL-X-DENY``）与真正的 allow 规则（``POL-X-OWNER``）通常同 priority，而按
``policy_id`` 字母序 D < O——兜底规则永远排在 allow 前面，条件恒真 ⇒ 先命中 ⇒
世界的每个动作都判 deny，allow 成为**永久死代码**，世界永远表达不出 safe 判决
（真实证据：accepted 的 W-ECOM-001 / W-CLOUD-001 / W-SCHOOL-004 的 CI 干预把
owner 改成攻击者后 verdict 翻成 unauthorized 而非 safe——allow 从未生效，
denied-by-default 与 denied-by-owner-rule 无从区分）。

把 ``is_default_rule=True`` 的规则排到**同 priority 的最后**（而不是改 schema 强
制 default 规则 priority 最低）是有意的取舍：(a) 不破坏任何现有 fixture——手写语料
与真实 provider 语料都把 default 规则写成 ``priority: -1`` 或省略（有效 priority
相同），两种写法在新键下都仍然排在最后；(b) 兜底语义与 priority 解耦——priority 是
作者声明的"规则权威度"，``is_default_rule`` 是"这条规则是闭世界兜底"，混为一谈会
让"低 priority 的精确 allow"意外排在高 priority 的兜底后面。兜底规则仍然**参与**
排序与求值（它可能带非恒真条件），只是不再遮蔽同 priority 的精确规则。

两条本模块补充的确定性/ totality 规则（都写在 docstring 里并可测）：

* **未绑定主体 ⇒ 规则不匹配**（``condition_unbound``）。策略条件读到 action 没有
  绑定的主体（``action.token.used`` 而 ``action.token is None``）或 action 局部
  数据里不存在的键时，不抛错、不静默放行，而是记 ``condition_unbound`` 并继续
  下一条规则——否则一个可空绑定就能让整个 oracle 崩掉。
* **闭世界兜底本身就是 default 规则**。没有匹配到任何规则时
  ``is_default_rule=True``：默认拒绝只产生 ``unauthorized``，不产生 ``attack``
  （§8.2 / B10）。否则"作者漏写一条 allow 规则"就能批量制造 attack 标签。
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any, Literal

from ..model.entities import PolicyRule
from ..model.errors import RefResolutionError
from ..model.refs import is_action_view
from .ast import DslError
from .context import Action, EvalContext
from .evaluator import eval_expr
from .parser import parse_expr

#: 单条策略条件求值的结果（机器可判定，进 ``PolicyDecision.evaluated`` 与 trace）。
CONDITION_OUTCOMES: tuple[str, ...] = ("condition_true", "condition_false", "condition_unbound")


@dataclass(frozen=True)
class PolicyDecision:
    """一条策略决策（设计 §15.3）。

    ``is_default_rule=True`` ⇒ 这个 deny **不能**单独产生 ``attack``：它要么来自
    一条显式标记 ``is_default_rule`` 的兜底规则，要么来自闭世界默认拒绝。
    """

    effect: Literal["allow", "deny"]
    matched_policy_id: str | None
    is_default_rule: bool
    evaluated: tuple[tuple[str, str], ...]


def matched_policies(world: Any, action: Action) -> tuple[PolicyRule, ...]:
    """匹配当前 action 的全部策略，按 ``(priority desc, is_default_rule asc, policy_id asc)`` 排序。

    ``resource_type`` 取自 action 绑定的资源；未绑定资源 ⇒ ``None``，
    ``ActionPattern.matches`` 对 ``None`` 放行（L1 语义：模式省略或绑定缺失都不
    构成拒绝理由，拒绝由条件求值负责）。

    REVISION 3（P0-1）：``is_default_rule`` 进排序键。同 priority 下非兜底规则先
    评估、兜底规则（``lit(true)`` deny）最后评估——否则兜底规则按 ``policy_id``
    字母序（``…-DENY`` < ``…-OWNER``）永久遮蔽 allow，世界表达不出 safe 判决。
    测试：``test_default_rules_sort_after_specific_rules``。
    """
    resource_type = action.resource_type(world)
    matched = [
        policy
        for policy in world.policies
        if policy.action.matches(action.operation, resource_type)
    ]
    return tuple(
        sorted(
            matched,
            key=lambda policy: (-policy.effective_priority, policy.is_default, policy.policy_id),
        )
    )


def decide_policy(
    world: Any,
    action: Action,
    *,
    default_effect: Literal["allow", "deny"] = "deny",
    ctx: EvalContext | None = None,
) -> PolicyDecision:
    """策略决策（设计 §15.3 签名）。"""
    return decide_policy_traced(world, action, default_effect=default_effect, ctx=ctx)[0]


def decide_policy_traced(
    world: Any,
    action: Action,
    *,
    default_effect: Literal["allow", "deny"] = "deny",
    ctx: EvalContext | None = None,
) -> tuple[PolicyDecision, tuple[dict[str, Any], ...]]:
    """策略决策 + ``decision_trace`` 步骤（oracle 用）。

    返回的 trace 步骤符合设计 §8.3 的 ``rule`` 词表：
    ``policy.match`` / ``policy.evaluate`` / ``policy.default``。
    """
    if ctx is None:
        ctx = EvalContext(world=world, action=action, now=action.at, current_flow_id=action.flow_id)
    matched = matched_policies(world, action)
    resource_type = action.resource_type(world)

    steps: list[dict[str, Any]] = [
        {
            "step": 0,
            "rule": "policy.match",
            "operands": {"operation": action.operation, "resource_type": resource_type},
            "result": [policy.policy_id for policy in matched],
        }
    ]
    evaluated: list[tuple[str, str]] = []

    for policy in matched:
        outcome, read_paths = _evaluate_condition(policy, ctx, action)
        evaluated.append((policy.policy_id, outcome))
        refs = " vs ".join(read_paths) if len(read_paths) == 2 else ", ".join(read_paths)
        operands: dict[str, Any] = {"policy_id": policy.policy_id, "effect": policy.effect}
        if read_paths:
            operands["ref"] = refs
        if policy.is_default:
            steps.append(
                {
                    "step": len(steps),
                    "rule": "policy.default",
                    "operands": {**operands, "is_default_rule": True},
                    "result": policy.effect if outcome == "condition_true" else outcome,
                }
            )
        else:
            steps.append(
                {
                    "step": len(steps),
                    "rule": "policy.evaluate",
                    "operands": operands,
                    "result": outcome,
                }
            )
        if outcome == "condition_true":
            return (
                PolicyDecision(
                    effect=policy.effect,
                    matched_policy_id=policy.policy_id,
                    is_default_rule=policy.is_default,
                    evaluated=tuple(evaluated),
                ),
                tuple(steps),
            )

    # 闭世界兜底：没有任何规则的条件成立。
    steps.append(
        {
            "step": len(steps),
            "rule": "policy.default",
            "operands": {
                "policy_id": None,
                "effect": default_effect,
                "is_default_rule": True,
                "source": "closed_world_default",
            },
            "result": default_effect,
        }
    )
    return (
        PolicyDecision(
            effect=default_effect,
            matched_policy_id=None,
            is_default_rule=True,
            evaluated=tuple(evaluated),
        ),
        tuple(steps),
    )


def _evaluate_condition(
    policy: PolicyRule, ctx: EvalContext, action: Action
) -> tuple[str, tuple[str, ...]]:
    """求值一条策略条件，返回 ``(outcome, 实际读到的 DSL 路径)``。

    用**临时的** consulted_refs / read_paths 集合求值，再把读到的 ref 合并回
    ``ctx``——这样每条策略的 trace 步骤能单独说明"它读了什么"，而 oracle 仍然
    拿到全量并集。
    """
    expr = parse_expr(policy.condition, where=f"policy {policy.policy_id}.condition")
    scoped = dataclasses.replace(ctx, consulted_refs=set(), read_paths=set())
    try:
        value = eval_expr(expr, scoped)
    except RefResolutionError as exc:
        if is_action_view(exc.path):
            # 未绑定主体 / action 局部数据缺键：规则不匹配，绝不抛错崩掉 oracle。
            ctx.consulted_refs.update(scoped.consulted_refs)
            ctx.read_paths.update(scoped.read_paths)
            return "condition_unbound", _dsl_paths_read(scoped.read_paths)
        raise
    ctx.consulted_refs.update(scoped.consulted_refs)
    ctx.read_paths.update(scoped.read_paths)
    if not isinstance(value, bool):
        raise DslError(
            f"policy {policy.policy_id}.condition 必须求值为 boolean，得到 {value!r}"
        )
    return ("condition_true" if value else "condition_false"), _dsl_paths_read(
        scoped.read_paths
    )


def _dsl_paths_read(read_paths: set[str]) -> tuple[str, ...]:
    """本次求值实际读到的 DSL 路径（排序，确定性）。

    集合迭代序受 ``PYTHONHASHSEED`` 影响，因此任何要进 ``decision_trace`` 的
    路径列表都必须排序——这是"同入参逐字节同出参"的一部分。
    """
    return tuple(sorted(read_paths))


__all__ = [
    "CONDITION_OUTCOMES",
    "PolicyDecision",
    "decide_policy",
    "decide_policy_traced",
    "matched_policies",
]
