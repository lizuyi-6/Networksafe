"""Policy DSL 的 AST / 解析器单元测试。

覆盖（设计 §13.1 的 ``test_policy_eval.py`` / ``test_policy_match.py`` 的 AST 半边）：

* op 目录**正好 27 个**，且与设计 §7.2 的表格逐类对得上；
* ``parse_expr`` 对未知 op / arity / 路径违规 / 未知键 / 深度过大全部抛 ``DslError``；
* ``Expr.to_document()`` 与 ``parse_expr`` 互为逆运算（round-trip）；
* 手工构造的畸形 ``Expr`` 在 ``__post_init__`` 就被拒。
"""
from __future__ import annotations

import pytest

from security_world.policy import (
    ALL_OPS,
    ARITY,
    BOOLEAN_OPS,
    COMPARISON_OPS,
    EVIDENCE_BRIDGE_OP,
    LINEAGE_OPS,
    MAX_EXPR_DEPTH,
    NODE_KEYS,
    OPS,
    ON_MISSING_VALUES,
    REF_OP,
    SET_OPS,
    STATE_OPS,
    STRING_OPS,
    TEMPORAL_OPS,
    DslError,
    Expr,
    parse_expr,
)

# --------------------------------------------------------------------------- #
# op 目录
# --------------------------------------------------------------------------- #
def test_op_catalog_has_exactly_27_ops():
    assert len(ALL_OPS) == 27, sorted(ALL_OPS)
    assert len(OPS) == 27
    assert len(ARITY) == 27
    assert len(NODE_KEYS) == 27


def test_op_catalog_matches_design_section_7_2_table():
    """设计 §7.2 的表格逐类落地（S23：曾写成 22 个 op）。"""
    assert COMPARISON_OPS == ("eq", "ne", "lt", "le", "gt", "ge")
    assert SET_OPS == ("in", "not_in", "subset_of", "intersects", "disjoint", "is_empty")
    assert BOOLEAN_OPS == ("and", "or", "not")
    assert STRING_OPS == ("contains", "not_contains")
    assert TEMPORAL_OPS == ("before", "after", "within")
    assert STATE_OPS == ("state_is", "transition_allowed")
    assert LINEAGE_OPS == ("lineage_depth", "lineage_root")
    assert EVIDENCE_BRIDGE_OP == "establishing_evidence_exists"
    # 字面/引用两类
    assert REF_OP in OPS and "lit" in OPS
    # 合计：2 + 6 + 6 + 3 + 2 + 3 + 2 + 2 + 1
    assert len(ALL_OPS) == 2 + 6 + 6 + 3 + 2 + 3 + 2 + 2 + 1


def test_every_op_has_an_arity_entry():
    for op in ALL_OPS:
        assert op in ARITY, op
        low, high = ARITY[op]
        assert 0 <= low <= high, op


# --------------------------------------------------------------------------- #
# 正常解析
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("op", sorted(OPS))
def test_parse_minimal_node_for_every_op(op):
    """每个 op 都有一个最小合法形态（arity 表与解析器一致）。"""
    low, _high = ARITY[op]
    if op == "lit":
        node = {"op": "lit", "value": 1}
    elif op == REF_OP:
        node = {"op": "ref", "path": "actor.ACT-001.actor_id"}
    elif op == EVIDENCE_BRIDGE_OP:
        node = {"op": EVIDENCE_BRIDGE_OP, "args": ["actor.ACT-001.actor_id"]}
    elif op == "within":
        node = {
            "op": "within",
            "args": [
                {"op": "ref", "path": "current_time"},
                {"op": "ref", "path": "current_time"},
                {"op": "lit", "value": 1000},
            ],
        }
    elif op in STATE_OPS:
        node = {
            "op": op,
            "args": [
                {"op": "ref", "path": "action.workflow_instance.current_state"},
                {"op": "lit", "value": "paid"},
            ],
        }
    elif op in LINEAGE_OPS:
        node = {"op": op, "args": [{"op": "ref", "path": "action.token.token_id"}]}
    else:
        args = [{"op": "lit", "value": index} for index in range(low)]
        node = {"op": op, "args": args}
    expr = parse_expr(node)
    assert expr.op == op
    assert len(expr.args) == low or op in ("lit", REF_OP, EVIDENCE_BRIDGE_OP)


def test_ref_accepts_all_three_views():
    for path in (
        "actor.ACT-001.identity.email",
        "resource.RES-001.owner",
        "action.resource.owner",
        "action.parameters.amount",
        "current_flow.flow_id",
        "current_time",
    ):
        assert parse_expr({"op": "ref", "path": path}).path == path


def test_ref_rejects_evidence_view_and_unknown_shapes():
    """B19：``evidence_view.*`` 已从 DSL 删除；只有三类视图。"""
    for path in (
        "evidence_view.EV-1.value",
        "evidence.EV-1.value",
        "actor.ACT-001",  # 缺字段段
        "bogus.ACT-001.owner",
        "",
    ):
        with pytest.raises(DslError):
            parse_expr({"op": "ref", "path": path})


def test_parse_expr_rejects_unknown_op_and_keys():
    with pytest.raises(DslError):
        parse_expr({"op": "eval", "args": []})
    with pytest.raises(DslError):
        parse_expr({"op": "eq", "args": [{"op": "lit", "value": 1}], "junk": 1})
    with pytest.raises(DslError):
        parse_expr({"op": "ref", "path": "current_time", "junk": 1})


def test_parse_expr_rejects_wrong_arity():
    with pytest.raises(DslError):
        parse_expr({"op": "eq", "args": [{"op": "lit", "value": 1}]})
    with pytest.raises(DslError):
        parse_expr({"op": "not", "args": [{"op": "lit", "value": True}, {"op": "lit", "value": False}]})
    with pytest.raises(DslError):
        parse_expr({"op": "within", "args": [{"op": "lit", "value": 1}, {"op": "lit", "value": 2}]})
    with pytest.raises(DslError):
        parse_expr({"op": "and", "args": [{"op": "lit", "value": True}] * 17})


def test_parse_expr_rejects_non_object_and_non_mapping_args():
    with pytest.raises(DslError):
        parse_expr("eq")
    with pytest.raises(DslError):
        parse_expr({"op": "and", "args": "lit"})


def test_bridge_op_requires_id_view_fact_key():
    assert parse_expr({"op": EVIDENCE_BRIDGE_OP, "args": ["resource.RES-001.owner"]}).value == (
        "resource.RES-001.owner"
    )
    for bad in ("resource.RES-001", "action.resource.owner", "current_time", 5, ""):
        with pytest.raises(DslError):
            parse_expr({"op": EVIDENCE_BRIDGE_OP, "args": [bad]})


def test_parse_expr_rejects_deeply_nested_document():
    node: dict = {"op": "lit", "value": True}
    for _ in range(MAX_EXPR_DEPTH + 5):
        node = {"op": "not", "args": [node]}
    with pytest.raises(DslError):
        parse_expr(node)


def test_lit_rejects_non_json_values():
    for bad in (float("nan"), float("inf"), {1: "x"}, object()):
        with pytest.raises(DslError):
            parse_expr({"op": "lit", "value": bad})


# --------------------------------------------------------------------------- #
# round-trip 与 Expr 自身不变式
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "document",
    [
        {"op": "lit", "value": "x"},
        {"op": "lit", "value": [1, 2, {"a": True}]},
        {"op": "ref", "path": "action.actor.roles"},
        {"op": "ref", "path": "actor.ACT-001.tenant", "on_missing": "unknown"},
        {"op": "eq", "args": [{"op": "ref", "path": "current_time"}, {"op": "lit", "value": 3}]},
        {
            "op": "and",
            "args": [
                {"op": "in", "args": [{"op": "ref", "path": "action.actor.roles"},
                                      {"op": "lit", "value": ["ROLE-A"]}]},
                {"op": "not", "args": [{"op": "is_empty", "args": [{"op": "ref", "path": "action.actor.groups"}]}]},
            ],
        },
        {"op": EVIDENCE_BRIDGE_OP, "args": ["session.SES-001.valid"]},
        {"op": "within", "args": [{"op": "ref", "path": "current_time"},
                                  {"op": "ref", "path": "current_time"},
                                  {"op": "lit", "value": 500}]},
    ],
)
def test_document_ast_round_trip(document):
    assert parse_expr(document).to_document() == document


def test_expr_rejects_hand_built_malformed_nodes():
    with pytest.raises(DslError):
        Expr(op="nope")
    with pytest.raises(DslError):
        Expr(op="eq", args=(Expr(op="lit", value=1),))
    with pytest.raises(DslError):
        Expr(op="ref")
    with pytest.raises(DslError):
        Expr(op="eq", args=(Expr(op="lit", value=1), Expr(op="lit", value=2)), path="current_time")
    with pytest.raises(DslError):
        Expr(op="eq", args=(Expr(op="lit", value=1), Expr(op="lit", value=2)), value=1)
    with pytest.raises(DslError):
        Expr(op="ref", path="current_time", on_missing="guess")


def test_on_missing_default_and_allowed_values():
    assert parse_expr({"op": "ref", "path": "current_time"}).on_missing == "error"
    assert ON_MISSING_VALUES == ("error", "unknown")
    for value in ON_MISSING_VALUES:
        assert parse_expr({"op": "ref", "path": "current_time", "on_missing": value}).on_missing == value


def test_walk_is_pre_order_and_includes_self():
    expr = parse_expr(
        {
            "op": "and",
            "args": [
                {"op": "eq", "args": [{"op": "lit", "value": 1}, {"op": "lit", "value": 2}]},
                {"op": "not", "args": [{"op": "lit", "value": False}]},
            ],
        }
    )
    ops = [node.op for node in expr.walk()]
    assert ops == ["and", "eq", "lit", "lit", "not", "lit"]
    assert expr.children == expr.args
