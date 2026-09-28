"""L2 语义引擎之二：安全不变量库与 registry。

公共契约（设计 §15.3 的 L2 invariants 部分）::

    InvariantScope / InvariantResult / ATTACK_CATEGORIES
    evaluate_invariants / decision_facts
    InvariantTemplate / register_invariant / build_invariant / invariant_keys

分层纪律：本包 import L1 ``security_world.model`` 与同层
``security_world.policy``（``invariants → policy``，与 ``policy → workflows``
共同构成 L2 内部的 DAG，无环）；**不** import ``oracle`` / ``evidence``。

``evaluate_invariants`` 是 truth 趟的引擎：它在完整世界上求值，产出
``violated ∪ satisfied ∪ skipped == world.invariants`` 的三分划（B17）。
observable 趟由 ``security_world.oracle`` 用**同一套规则**在"已建立事实表"上
重跑——那时它调用的是本包的同一入口，只是换一个被覆盖过的世界。
"""
from __future__ import annotations

from ..policy import (
    EvalContext,
    action_bindings_read,
    eval_expr,
    is_self_establishing_identity,
    matched_policies,
    parse_expr,
    static_refs,
)
from .registry import (
    build_invariant,
    build_library,
    invariant_keys,
    invariant_template,
    register_invariant,
    registered_templates,
    templates_by_category,
)
from .scope import (
    ATTACK_CATEGORIES,
    InvariantResult,
    InvariantScope,
    decision_facts,
    evaluate_invariants,
    invariant_scope,
    partition,
    partition_is_complete,
    unbound_bindings,
)
from .templates import TEMPLATES, InvariantTemplate

__all__ = [
    # 求值与作用域
    "ATTACK_CATEGORIES",
    "InvariantResult",
    "InvariantScope",
    "decision_facts",
    "evaluate_invariants",
    "invariant_scope",
    "partition",
    "partition_is_complete",
    "unbound_bindings",
    # registry
    "TEMPLATES",
    "InvariantTemplate",
    "build_invariant",
    "build_library",
    "invariant_keys",
    "invariant_template",
    "register_invariant",
    "registered_templates",
    "templates_by_category",
    # 从 policy 转手导出（调用方只需要一个 import 路径）
    "EvalContext",
    "action_bindings_read",
    "eval_expr",
    "is_self_establishing_identity",
    "matched_policies",
    "parse_expr",
    "static_refs",
]
