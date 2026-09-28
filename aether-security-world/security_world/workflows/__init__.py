"""``security_world.workflows`` 的公共契约（设计 §15.3 的 L2 workflows 部分）。

本包**不** import ``security_world.policy``：条件迁移的条件文档通过
:class:`~security_world.policy.context.ConditionContext` 协议求值（鸭子类型），
因此 L2 内部只有 ``policy → workflows`` 一条边，没有环
（``tests/test_import_boundaries.py`` 会静态断言）。
"""
from __future__ import annotations

from .machine import (
    TRANSITION_REASONS,
    TransitionResult,
    WorkflowError,
    WorkflowMachine,
    find_workflow,
    state_is,
    transition_allowed,
    workflow_errors,
)

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
