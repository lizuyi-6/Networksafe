"""工作流子包的内部类型（避免 ``machine.py`` 与 ``policy.context`` 互相 import）。

:class:`ConditionContext` 是"能求值一条 DSL 条件文档"的最小协议。
``security_world.policy.context.EvalContext`` 实现它；本包只面向协议编程。
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ConditionContext(Protocol):
    """能求值 DSL 条件文档的上下文（工作流条件迁移的唯一入口）。"""

    action: Any
    world: Any

    def evaluate_condition(self, document: Mapping[str, Any]) -> bool:  # pragma: no cover
        ...


__all__ = ["ConditionContext"]
