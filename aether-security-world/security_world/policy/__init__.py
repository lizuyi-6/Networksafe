"""L2 语义引擎之一：Policy DSL 的 AST、求值器与策略匹配。

公共契约（设计 §15.3 的 L2 policy 部分）::

    Expr / parse_expr / eval_expr / static_refs / DslError
    EvalContext / Action
    PolicyDecision / decide_policy

本包**不** import ``security_world.invariants`` / ``oracle`` / ``evidence``
（那三层在 L2/L3 之上）；它只 import L1 ``security_world.model`` 与同层的
``security_world.workflows``（``policy → workflows``，无环）。

典型用法::

    from security_world.policy import Action, decide_policy, parse_expr
    from security_world.model import load_world

    world = load_world(path)
    action = Action.from_document(document)
    decision = decide_policy(world, action)
    assert decision.effect in ("allow", "deny")
"""
from __future__ import annotations

from .ast import (
    ALL_OPS,
    ARITY,
    BOOLEAN_OPS,
    COMPARISON_OPS,
    EVIDENCE_BRIDGE_OP,
    LINEAGE_OPS,
    LITERAL_OP,
    MAX_BOOLEAN_ARGS,
    MAX_EXPR_DEPTH,
    NODE_KEYS,
    OPS,
    ON_MISSING_VALUES,
    REF_OP,
    SCHEMA_ARITY_NOTE,
    SET_OPS,
    STATE_OPS,
    STRING_OPS,
    TEMPORAL_OPS,
    DslError,
    Expr,
)
from .context import (
    ACTION_KEYS,
    ACTION_REQUIRED,
    Action,
    ConditionContext,
    EvalContext,
    is_self_establishing_identity,
)
from .evaluator import (
    TRUSTED_ESTABLISHES,
    UNKNOWN,
    action_bindings_read,
    eval_expr,
    split_entity_path,
    static_refs,
)
from .matching import (
    CONDITION_OUTCOMES,
    PolicyDecision,
    decide_policy,
    decide_policy_traced,
    matched_policies,
)
from .parser import BRIDGE_FACT_PATTERN, parse_condition, parse_expr
from . import builders

__all__ = [
    # AST
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
    # 解析
    "BRIDGE_FACT_PATTERN",
    "parse_condition",
    "parse_expr",
    # 上下文
    "ACTION_KEYS",
    "ACTION_REQUIRED",
    "Action",
    "ConditionContext",
    "EvalContext",
    "is_self_establishing_identity",
    # 求值
    "TRUSTED_ESTABLISHES",
    "UNKNOWN",
    "action_bindings_read",
    "eval_expr",
    "split_entity_path",
    "static_refs",
    # 匹配
    "CONDITION_OUTCOMES",
    "PolicyDecision",
    "decide_policy",
    "decide_policy_traced",
    "matched_policies",
    # 文档构造器
    "builders",
]
