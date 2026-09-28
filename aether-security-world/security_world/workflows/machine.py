"""工作流状态机：``allowed`` / ``forbidden`` / ``conditional`` 三类转移的判定。

设计 §7.2 的两个状态机 op（``state_is`` / ``transition_allowed``）都在这里求值，
且**恰好 2 参**：``from_state`` 取绑定实例的**当前态**，不作为第三参传入
（schema 的 ``two_args`` 逐字这么约束，S3 修订过元数注释）。

四条落地规则：

1. **边只由 ``workflows[].transitions[]`` 声明。** ``reversible`` 是作者元数据，
   **不**生成反向边——否则 ``created→paid`` 会被一个缺省字段悄悄变成双向，
   而安全 oracle 不允许"发明"一条没声明的许可。
2. **条件迁移**：转移声明了 ``condition``（DSL 文档）时，只有该条件求值为 true
   才算允许。条件用**同一个**求值上下文求值，因此它读到的 ref 也计入
   ``consulted_facts``。
3. **``required_privileges``**：转移声明了必需权限时，行动主体（``action.actor``
   的直授权限 ∪ 其角色的权限）必须全部具备；拿不到主体（无 action）即不允许
   （fail-closed）。
4. **未知实例 / 未声明状态 ⇒ 不允许**，并给出机器可判定的 reason，绝不静默放行。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ..model.entities import Workflow, WorkflowInstance, WorkflowTransition
from ..model.errors import ModelError, RefResolutionError
from ..model.refs import ActionLike
from .types import ConditionContext


class WorkflowError(ModelError):
    """工作流状态机的确定性错误（未知实例、环、状态不一致）。"""


#: 转移判定结果的原因码（机器可判定，不是自然语言）。
TRANSITION_REASONS: tuple[str, ...] = (
    "allowed",
    "no_declared_transition",
    "condition_false",
    "missing_privilege",
    "unknown_instance",
    "unknown_target_state",
    "unknown_current_state",
)


@dataclass(frozen=True)
class TransitionResult:
    """一次转移判定的完整解释（可追溯，供 decision_trace 与单元测试断言）。"""

    allowed: bool
    reason: str
    workflow_id: str | None = None
    instance_id: str = ""
    from_state: str = ""
    to_state: str = ""
    condition: Mapping[str, Any] | None = None
    missing_privileges: tuple[str, ...] = ()

    def to_document(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "workflow_id": self.workflow_id,
            "instance_id": self.instance_id,
            "from_state": self.from_state,
            "to_state": self.to_state,
            "missing_privileges": list(self.missing_privileges),
        }


class WorkflowMachine:
    """一个世界的全部工作流状态机（``instance_id -> (workflow, instance)``）。

    构造是纯函数式的：只读世界，不缓存任何跨调用状态（确定性优先）。
    """

    __slots__ = ("_instances", "_workflows")

    def __init__(self, workflows: Sequence[Workflow]) -> None:
        index: dict[str, tuple[Workflow, WorkflowInstance]] = {}
        for workflow in workflows:
            for instance in workflow.instances:
                if instance.instance_id in index:
                    raise WorkflowError(
                        f"workflow_instance {instance.instance_id!r} 在多个 workflow 中重复"
                    )
                index[instance.instance_id] = (workflow, instance)
        self._workflows: tuple[Workflow, ...] = tuple(workflows)
        self._instances: dict[str, tuple[Workflow, WorkflowInstance]] = index

    @classmethod
    def from_world(cls, world: Any) -> "WorkflowMachine":
        """从 :class:`~security_world.model.world.WorldInstance` 构造。"""
        return cls(getattr(world, "workflows", ()))

    # -- 查询 --------------------------------------------------------------- #
    @property
    def workflows(self) -> tuple[Workflow, ...]:
        return self._workflows

    def instance_ids(self) -> tuple[str, ...]:
        """全部实例 id（排序，确定性）。"""
        return tuple(sorted(self._instances))

    def has_instance(self, instance_id: str) -> bool:
        return instance_id in self._instances

    def workflow_of(self, instance_id: str) -> Workflow:
        """实例所属的 workflow；未知实例抛 :class:`WorkflowError`。"""
        entry = self._instances.get(instance_id)
        if entry is None:
            raise WorkflowError(f"未知 workflow_instance {instance_id!r}")
        return entry[0]

    def instance(self, instance_id: str) -> WorkflowInstance:
        entry = self._instances.get(instance_id)
        if entry is None:
            raise WorkflowError(f"未知 workflow_instance {instance_id!r}")
        return entry[1]

    def current_state(self, instance_id: str) -> str:
        return self.instance(instance_id).current_state

    # -- 状态机判定 --------------------------------------------------------- #
    def states(self, instance_id: str) -> tuple[str, ...]:
        return self.workflow_of(instance_id).states

    def state_is(self, instance_id: str, state: str) -> bool:
        """实例当前态是否**正是** ``state``（且该态在机器里声明过）。

        与字符串相似度无关：先要求 ``state`` 是声明态，再要求当前态等于它。
        """
        entry = self._instances.get(instance_id)
        if entry is None:
            return False
        workflow, instance = entry
        if state not in workflow.states:
            return False
        return instance.current_state == state

    def declared_transitions(
        self, workflow: Workflow, from_state: str, to_state: str
    ) -> tuple[WorkflowTransition, ...]:
        """从 ``from_state`` 到 ``to_state`` 的全部声明边（同起终点的多条都算）。"""
        return tuple(
            transition
            for transition in workflow.transitions
            if transition.from_state == from_state and transition.to_state == to_state
        )

    def transitions_from(self, workflow: Workflow, state: str) -> tuple[WorkflowTransition, ...]:
        return tuple(t for t in workflow.transitions if t.from_state == state)

    def check_transition(
        self,
        instance_id: str,
        to_state: str,
        ctx: ConditionContext | None = None,
    ) -> TransitionResult:
        """判定"从实例当前态到 ``to_state``"是否允许，并给出 reason。"""
        entry = self._instances.get(instance_id)
        if entry is None:
            return TransitionResult(
                allowed=False,
                reason="unknown_instance",
                instance_id=instance_id,
                to_state=to_state,
            )
        workflow, instance = entry
        from_state = instance.current_state
        if to_state not in workflow.states:
            return TransitionResult(
                allowed=False,
                reason="unknown_target_state",
                workflow_id=workflow.workflow_id,
                instance_id=instance_id,
                from_state=from_state,
                to_state=to_state,
            )
        if from_state not in workflow.states:
            return TransitionResult(
                allowed=False,
                reason="unknown_current_state",
                workflow_id=workflow.workflow_id,
                instance_id=instance_id,
                from_state=from_state,
                to_state=to_state,
            )
        edges = self.declared_transitions(workflow, from_state, to_state)
        if not edges:
            return TransitionResult(
                allowed=False,
                reason="no_declared_transition",
                workflow_id=workflow.workflow_id,
                instance_id=instance_id,
                from_state=from_state,
                to_state=to_state,
            )
        # 同起终点可能声明多条边：任一条满足"条件成立 ∧ 权限具备"即允许
        # （多条边是"或"语义；取第一条可用的边作为解释，确定性 tie-break = 声明顺序）。
        fallback: TransitionResult | None = None
        for edge in edges:
            if edge.condition is not None:
                if ctx is None or not _condition_holds(edge, ctx):
                    fallback = fallback or TransitionResult(
                        allowed=False,
                        reason="condition_false",
                        workflow_id=workflow.workflow_id,
                        instance_id=instance_id,
                        from_state=from_state,
                        to_state=to_state,
                        condition=edge.condition,
                    )
                    continue
            missing = _missing_privileges(edge, ctx)
            if missing:
                fallback = fallback or TransitionResult(
                    allowed=False,
                    reason="missing_privilege",
                    workflow_id=workflow.workflow_id,
                    instance_id=instance_id,
                    from_state=from_state,
                    to_state=to_state,
                    missing_privileges=missing,
                )
                continue
            return TransitionResult(
                allowed=True,
                reason="allowed",
                workflow_id=workflow.workflow_id,
                instance_id=instance_id,
                from_state=from_state,
                to_state=to_state,
                condition=edge.condition,
            )
        assert fallback is not None  # edges 非空 ⇒ 必有 fallback
        return fallback

    def transition_allowed(
        self, instance_id: str, to_state: str, ctx: ConditionContext | None = None
    ) -> bool:
        return self.check_transition(instance_id, to_state, ctx).allowed


# --------------------------------------------------------------------------- #
# 条件与权限
# --------------------------------------------------------------------------- #
def _condition_holds(edge: WorkflowTransition, ctx: ConditionContext) -> bool:
    """条件迁移的条件求值。

    条件不是布尔（例如求值成一个字符串）时**不允许**——fail-closed，且不让一个
    畸形的条件文档悄悄放行危险转移。
    """
    assert edge.condition is not None
    try:
        return bool(ctx.evaluate_condition(edge.condition))
    except Exception as exc:  # noqa: BLE001 - 条件不可求值 ⇒ 不放行
        if isinstance(exc, (ModelError, ValueError)):
            return False
        raise
    return False  # pragma: no cover - 不可达


def _missing_privileges(
    edge: WorkflowTransition, ctx: ConditionContext | None
) -> tuple[str, ...]:
    """转移要求而行动主体不具备的权限（空 tuple = 全部具备/未要求）。"""
    required = edge.required_privileges
    if not required:
        return ()
    action = getattr(ctx, "action", None)
    if action is None:
        return tuple(required)  # 没有主体就无法验证 ⇒ fail-closed
    held = _effective_privileges(action, getattr(ctx, "world", None))
    return tuple(privilege for privilege in required if privilege not in held)


def _effective_privileges(action: ActionLike, world: Any) -> frozenset[str]:
    """行动主体的有效权限：直授 ``actor.privileges`` ∪ 各 ``role.privileges``。"""
    held: set[str] = set()
    actor_id = getattr(action, "actor", None)
    if world is None or not actor_id:
        return frozenset(held)
    try:
        document = world.registry.entity_document("actor", actor_id)
    except (RefResolutionError, AttributeError):
        return frozenset(held)
    if not isinstance(document, Mapping):
        return frozenset(held)
    privileges = document.get("privileges") or ()
    if isinstance(privileges, (list, tuple)):
        held.update(str(item) for item in privileges)
    roles = document.get("roles") or ()
    if isinstance(roles, (list, tuple)):
        for role_id in roles:
            try:
                role = world.registry.entity_document("role", role_id)
            except (RefResolutionError, AttributeError):
                continue
            if not isinstance(role, Mapping):
                continue
            role_privileges = role.get("privileges") or ()
            if isinstance(role_privileges, (list, tuple)):
                held.update(str(item) for item in role_privileges)
    return frozenset(held)


# --------------------------------------------------------------------------- #
# §15.3 的模块级签名
# --------------------------------------------------------------------------- #
def state_is(workflow: Workflow, instance_id: str, state: str) -> bool:
    """实例当前态是否正是 ``state``（§15.3 签名：显式给 workflow）。"""
    machine = WorkflowMachine((workflow,))
    return machine.state_is(instance_id, state)


def transition_allowed(
    workflow: Workflow,
    instance_id: str,
    to_state: str,
    ctx: ConditionContext | None = None,
) -> bool:
    """从实例**当前态**到 ``to_state`` 是否允许（§15.3 签名：显式给 workflow）。

    ``from_state`` 不作为参数传入——它取绑定实例的当前态（S3 修订）。
    """
    machine = WorkflowMachine((workflow,))
    return machine.transition_allowed(instance_id, to_state, ctx)


def find_workflow(world: Any, instance_id: str) -> Workflow | None:
    """``instance_id`` 所属的 workflow；找不到返回 ``None``（查询用，不求值）。"""
    for workflow in getattr(world, "workflows", ()):
        for instance in workflow.instances:
            if instance.instance_id == instance_id:
                return workflow
    return None


def workflow_errors(world: Any) -> tuple[tuple[str, str], ...]:
    """状态机的结构自检（供 Gate 2 复用）：重复实例 id / 起终态未声明。

    ``(reason_code, detail)`` 元组；空元组表示结构自洽。
    """
    errors: list[tuple[str, str]] = []
    seen: set[str] = set()
    for workflow in getattr(world, "workflows", ()):
        declared = set(workflow.states)
        if workflow.initial_state not in declared:
            errors.append(
                (
                    "state_mismatch",
                    f"workflow {workflow.workflow_id}.initial_state "
                    f"{workflow.initial_state!r} 不在 states 内",
                )
            )
        for transition in workflow.transitions:
            for role, state in (("from_state", transition.from_state), ("to_state", transition.to_state)):
                if state not in declared:
                    errors.append(
                        (
                            "state_mismatch",
                            f"workflow {workflow.workflow_id} 的转移 "
                            f"{transition.from_state}->{transition.to_state} 的 {role} "
                            f"{state!r} 不在 states 内",
                        )
                    )
        for instance in workflow.instances:
            if instance.instance_id in seen:
                errors.append(
                    (
                        "state_mismatch",
                        f"workflow_instance {instance.instance_id!r} 在多个 workflow 中重复",
                    )
                )
            seen.add(instance.instance_id)
            if instance.current_state not in declared:
                errors.append(
                    (
                        "state_mismatch",
                        f"workflow_instance {instance.instance_id}.current_state "
                        f"{instance.current_state!r} 不在 workflow {workflow.workflow_id} 的 states 内",
                    )
                )
    return tuple(errors)


__all__ = [
    "TRANSITION_REASONS",
    "TransitionResult",
    "WorkflowError",
    "WorkflowMachine",
    "find_workflow",
    "state_is",
    "transition_allowed",
    "workflow_errors",
]
