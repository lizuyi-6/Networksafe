"""关键变量反事实：只改一个决定 verdict 的状态变量（设计 §9.1 / §9.2 / R4）。

``critical_intervention`` 的契约（§15.3）::

    critical_intervention(world, *, intervention_variable, after, seed)
        -> tuple[WorldInstance, Intervention]

三条硬性质，逐条有测试钉死：

1. **单变量**：干预后 ``diff_worlds(base, variant).changed_paths ==
   (intervention_variable,)``（D4 机械断言，失败即
   ``InterventionError("not_single_variable")``，绝不静默接受）。
2. **必须真的改变状态**：``after`` 与现值规范化相等 ⇒
   ``InterventionError("no_op_intervention")``。一个什么都不改的"干预"
   会让 verdict_flip 测试变成假通过。
3. **预期先验且可证伪**（R4）：``expected_effect`` 只能由调用方从 spec 的
   ``hypotheses.expected_counterfactual_axes`` 带入（先验声明）；引擎只记录
   ``actual_effect``（由 base/variant 两个 oracle 输出算出），**永不反向改标签**。
   不符即 Gate 5 拒绝（``test_expected_effect_is_falsifiable`` 的负例构造）。

可干预的轴是"决定 verdict 的状态变量"：``resource.*.owner`` /
``actor.*.roles`` / ``actor.*.privileges`` / ``actor.*.privilege_version`` /
``actor.*.authentication_state`` / ``session.*.revoked`` / ``session.*.valid`` /
``session.*.privilege_snapshot.privilege_version`` / ``token.*.used`` /
``token.*.flow_id`` / ``token.*.parent_token`` / ``token.*.scope`` /
``workflow_instance.*.current_state`` / ``cache.*.cached_value`` /
``cache.*.fresh``（``configs/default.json`` 的 ``critical_axes_whitelist``；
请求字节永远不变——它由 action 决定，不在世界状态里）。
"""
from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..model.canonical import canonical_json
from ..model.config import axis_matches_whitelist
from ..model.errors import ModelError, RefResolutionError
from ..model.refs import is_id_view
from ..model.world import WorldInstance
from ..oracle import override_world_values
from .diff import diff_worlds
from .errors import InterventionError

#: ``episode.schema.json`` 的 ``intervention.expected_effect`` / ``actual_effect`` 枚举。
INTERVENTION_EFFECTS: tuple[str, ...] = (
    "verdict_flip",
    "verdict_invariant",
    "observable_downgrade",
)

#: 关键干预的期望效应（§9.1 家族表：critical_intervention ⇒ verdict_flip）。
CRITICAL_INTERVENTION_EFFECT = "verdict_flip"


@dataclass(frozen=True)
class Intervention:
    """一次单变量干预的记录（``episode.schema.json`` 的 ``intervention``）。"""

    intervention_variable: str
    before: Any
    after: Any
    expected_effect: str
    actual_effect: str | None = None

    def __post_init__(self) -> None:
        if self.expected_effect not in INTERVENTION_EFFECTS:
            raise InterventionError(
                "unknown_expected_effect",
                f"expected_effect 必须是 {INTERVENTION_EFFECTS} 之一，得到 {self.expected_effect!r}",
            )
        if self.actual_effect is not None and self.actual_effect not in INTERVENTION_EFFECTS:
            raise InterventionError(
                "unknown_actual_effect",
                f"actual_effect 必须是 {INTERVENTION_EFFECTS} 之一或 null，得到 {self.actual_effect!r}",
            )

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Intervention":
        if not isinstance(document, Mapping):
            raise InterventionError(
                "intervention_not_object", f"intervention 必须是 object，得到 {type(document).__name__}"
            )
        unknown = sorted(str(key) for key in document if key not in _INTERVENTION_KEYS)
        if unknown:
            raise InterventionError(
                "intervention_unknown_keys", f"intervention 出现 schema 未定义的键 {unknown}"
            )
        missing = sorted(key for key in _INTERVENTION_REQUIRED if key not in document)
        if missing:
            raise InterventionError("intervention_missing_keys", f"intervention 缺少必填键 {missing}")
        variable = document["intervention_variable"]
        if not isinstance(variable, str) or not variable:
            raise InterventionError(
                "intervention_variable_invalid", f"intervention_variable 必须是非空字符串: {variable!r}"
            )
        return cls(
            intervention_variable=variable,
            before=document["before"],
            after=document["after"],
            expected_effect=str(document["expected_effect"]),
            actual_effect=(
                None if document.get("actual_effect") is None else str(document["actual_effect"])
            ),
        )

    def to_document(self) -> dict[str, Any]:
        document: dict[str, Any] = {
            "intervention_variable": self.intervention_variable,
            "before": self.before,
            "after": self.after,
            "expected_effect": self.expected_effect,
        }
        if self.actual_effect is not None:
            document["actual_effect"] = self.actual_effect
        return document


#: ``episode.schema.json`` 的 intervention 键集（additionalProperties: false）。
_INTERVENTION_KEYS: frozenset[str] = frozenset(
    {"intervention_variable", "before", "after", "expected_effect", "actual_effect"}
)
_INTERVENTION_REQUIRED: tuple[str, ...] = (
    "intervention_variable",
    "before",
    "after",
    "expected_effect",
)


def critical_intervention(
    world: WorldInstance,
    *,
    intervention_variable: str,
    after: Any,
    seed: int,
    expected_effect: str = CRITICAL_INTERVENTION_EFFECT,
    whitelist: tuple[str, ...] | None = None,
) -> tuple[WorldInstance, Intervention]:
    """把**恰好一个** ID 视图状态路径改成 ``after``，返回新世界与干预记录。

    ``seed`` 参与本函数的确定性（同一 ``(world, variable, after, seed)`` 永远
    得到同一结果）；当前实现不引入随机选择，保留参数是为契约兼容与未来
    "多个候选 after 值"的确定性抽样。

    ``whitelist`` 给出时按 ``configs/default.json`` 的
    ``expansion.critical_axes_whitelist``（段式 glob）校验该轴；省略则不校验
    （编译期 Gate 2 已经断言过 spec 侧的白名单 membership）。
    """
    if not isinstance(world, WorldInstance):
        raise InterventionError(
            "world_not_instance", f"world 必须是 WorldInstance，得到 {type(world).__name__}"
        )
    if not is_id_view(intervention_variable):
        raise InterventionError(
            "path_not_id_view",
            f"intervention_variable 必须是 ID 视图路径（§4.3 BNF），得到 {intervention_variable!r}",
        )
    if not world.contains(intervention_variable):
        raise InterventionError(
            "path_unresolvable",
            f"路径在本世界不可解析: {intervention_variable!r}（悬空引用或未知字段）",
        )
    if whitelist is not None and not axis_matches_whitelist(intervention_variable, tuple(whitelist)):
        raise InterventionError(
            "axis_not_in_whitelist",
            f"轴 {intervention_variable!r} 不匹配 critical_axes_whitelist 的任何 glob",
        )
    before = world.resolve(intervention_variable)
    if canonical_json(before) == canonical_json(after):
        raise InterventionError(
            "no_op_intervention",
            f"{intervention_variable!r} 的现值与 after 相同（{canonical_json(before)}）："
            "干预必须改变状态，否则 verdict_flip 无从谈起",
        )
    try:
        variant = override_world_values(world, {intervention_variable: after})
    except (ModelError, RefResolutionError) as exc:
        raise InterventionError(
            "override_rejected", f"覆盖 {intervention_variable!r} 被拒: {exc}"
        ) from exc
    diff = diff_worlds(world, variant)
    if not diff.is_single(intervention_variable):
        raise InterventionError(
            "not_single_variable",
            f"干预后 changed_paths={list(diff.changed_paths)}，期望恰好 "
            f"[{intervention_variable!r}]（D4 单变量机械断言）",
        )
    intervention = Intervention(
        intervention_variable=intervention_variable,
        before=before,
        after=after,
        expected_effect=expected_effect,
    )
    return variant, intervention


def evaluate_intervention_effect(base_output: Any, variant_output: Any) -> str:
    """由 base/variant 两个 oracle 输出算出干预的**实际**效应（§9.3）。

    只比 ``world_truth``：observable 趟的差异是证据效应（归
    ``evidence_masked`` 变体的 ``observable_downgrade``），不是状态效应。
    """
    base_truth = _world_truth_of(base_output, "base_output")
    variant_truth = _world_truth_of(variant_output, "variant_output")
    return "verdict_flip" if base_truth != variant_truth else "verdict_invariant"


def with_actual_effect(intervention: Intervention, actual_effect: str) -> Intervention:
    """返回填好 ``actual_effect`` 的新记录（原记录不变；Gate 5 之后才填）。"""
    if actual_effect not in INTERVENTION_EFFECTS:
        raise InterventionError(
            "unknown_actual_effect",
            f"actual_effect 必须是 {INTERVENTION_EFFECTS} 之一，得到 {actual_effect!r}",
        )
    return dataclasses.replace(intervention, actual_effect=actual_effect)


def effect_matches(intervention: Intervention, actual_effect: str) -> bool:
    """先验预期与实际效应是否一致（Gate 5 的判定原语；不一致 ⇒ 拒绝，不改标签）。"""
    return intervention.expected_effect == actual_effect


def _world_truth_of(output: Any, where: str) -> str:
    truth = getattr(output, "world_truth", None)
    if truth is None and isinstance(output, Mapping):
        truth = output.get("world_truth")
    if truth not in ("safe", "attack", "unauthorized"):
        raise InterventionError(
            "oracle_output_without_world_truth",
            f"{where} 必须提供 world_truth（safe/attack/unauthorized），得到 {truth!r}",
        )
    return str(truth)


__all__ = [
    "CRITICAL_INTERVENTION_EFFECT",
    "INTERVENTION_EFFECTS",
    "Intervention",
    "critical_intervention",
    "effect_matches",
    "evaluate_intervention_effect",
    "with_actual_effect",
]
