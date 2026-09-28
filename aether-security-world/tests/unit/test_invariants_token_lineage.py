"""token lineage 不变量：flow 不匹配、``lineage_depth``、``lineage_root``、环拒绝、一次性 token。

设计 §13.1 的 ``test_invariants_token_lineage.py`` 覆盖面。
"""
from __future__ import annotations

import pytest

from security_world.invariants import InvariantScope, build_invariant
from asw_worlds import (
    actor,
    evaluated,
    make_action,
    make_world,
    override,
    resource,
    run,
    token,
    world_with_full_evidence,
)

APPLIES_TO = ("refund",)


def lineage_world(*, extra_tokens=()):
    return make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        tokens=(
            token("TOK-001", subject="ACT-001", flow_id="FLOW-A"),                    # 根
            token("TOK-002", subject="ACT-001", flow_id="FLOW-B", parent_token="TOK-001"),
            token("TOK-003", subject="ACT-001", flow_id="FLOW-A", parent_token="TOK-002"),
            token("TOK-004", subject="ACT-004", flow_id="FLOW-A"),                    # 别人的 token
            *extra_tokens,
        ),
        invariants=(
            build_invariant(
                "token_lineage.same_flow",
                invariant_id="INV-TOKEN-LINEAGE-001",
                applies_to=APPLIES_TO,
                severity="critical",
            ),
        ),
    )


def verdict(world, action):
    return run(world_with_full_evidence(world, action), action)


# --------------------------------------------------------------------------- #
# same_flow
# --------------------------------------------------------------------------- #
def test_token_used_in_its_own_flow_satisfies():
    world = lineage_world()
    action = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-A")
    assert evaluated(world, action)[0].satisfied is True


def test_token_presented_to_another_flow_violates():
    world = lineage_world()
    action = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-B")
    results = evaluated(world, action)
    assert results[0].violated is True
    output = verdict(world, action)
    assert output.world_truth == "attack"
    assert output.violated_invariants == ("INV-TOKEN-LINEAGE-001",)


def test_current_flow_comes_from_the_action_not_from_a_global():
    """``current_flow.flow_id`` 由 ctx 提供（缺省回落到 ``action.flow_id``）。"""
    world = lineage_world()
    same = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-A")
    assert evaluated(world, same)[0].satisfied is True
    other = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-Z")
    assert evaluated(world, other)[0].violated is True


# --------------------------------------------------------------------------- #
# lineage_depth / lineage_root
# --------------------------------------------------------------------------- #
def test_lineage_depth_counts_ancestors():
    world = lineage_world()
    depths = {}
    for token_id in ("TOK-001", "TOK-002", "TOK-003"):
        action = make_action("refund", "ACT-001", resource_id="RES-001", token_id=token_id,
                             flow_id="FLOW-A")
        depths[token_id] = _depth(world, action)
    assert depths == {"TOK-001": 0, "TOK-002": 1, "TOK-003": 2}


def _depth(world, action):
    from security_world.policy import EvalContext, eval_expr, parse_expr

    document = {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.token.token_id"}]}
    return eval_expr(parse_expr(document), EvalContext(world=world, action=action, now="2026-09-20T08:00:00Z"))


def test_lineage_root_is_the_root_ancestors_flow_id():
    """设计 §7.2：``lineage_root`` 返回**根祖先的 flow_id**，不是根祖先的 id。"""
    world = lineage_world()
    from security_world.policy import EvalContext, eval_expr, parse_expr

    document = {"op": "lineage_root", "args": [{"op": "ref", "path": "action.token.token_id"}]}
    for token_id, expected in (("TOK-001", "FLOW-A"), ("TOK-002", "FLOW-A"), ("TOK-003", "FLOW-A")):
        action = make_action("refund", "ACT-001", resource_id="RES-001", token_id=token_id,
                             flow_id="FLOW-A")
        assert eval_expr(parse_expr(document), EvalContext(world=world, action=action, now="2026-09-20T08:00:00Z")) == expected


def test_lineage_depth_at_most_template():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        tokens=(
            token("TOK-001", subject="ACT-001", flow_id="FLOW-A"),
            token("TOK-002", subject="ACT-001", flow_id="FLOW-A", parent_token="TOK-001"),
        ),
        invariants=(
            build_invariant(
                "token_lineage.depth_at_most",
                invariant_id="INV-TOKEN-DEPTH",
                applies_to=APPLIES_TO,
                max_depth=1,
            ),
        ),
    )
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001"))[
        0
    ].satisfied is True
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-002"))[
        0
    ].satisfied is True
    deeper = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        tokens=(
            token("TOK-001", subject="ACT-001", flow_id="FLOW-A"),
            token("TOK-002", subject="ACT-001", flow_id="FLOW-A", parent_token="TOK-001"),
            token("TOK-003", subject="ACT-001", flow_id="FLOW-A", parent_token="TOK-002"),
        ),
        invariants=(
            build_invariant(
                "token_lineage.depth_at_most",
                invariant_id="INV-TOKEN-DEPTH",
                applies_to=APPLIES_TO,
                max_depth=1,
            ),
        ),
    )
    assert evaluated(deeper, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-003"))[
        0
    ].violated is True


def test_lineage_cycles_are_rejected():
    """编译期已拒环（``token_cycle_errors``）；求值期仍有界防御。"""
    world = lineage_world()
    cyclic = override(world, "token.TOK-001.parent_token", "TOK-003")
    action = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-A")
    with pytest.raises(Exception):
        _depth(cyclic, action)


def test_dangling_parent_token_is_a_hard_failure():
    world = lineage_world()
    dangling = override(world, "token.TOK-002.parent_token", "TOK-404")
    action = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-002", flow_id="FLOW-B")
    with pytest.raises(Exception) as excinfo:
        _depth(dangling, action)
    assert excinfo.value.reason == "unknown_entity_id"


# --------------------------------------------------------------------------- #
# subject_matches_principal / one_time_token
# --------------------------------------------------------------------------- #
def test_token_subject_must_match_the_principal():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        tokens=(
            token("TOK-001", subject="ACT-001", flow_id="FLOW-A"),
            token("TOK-004", subject="ACT-004", flow_id="FLOW-A"),
        ),
        invariants=(
            build_invariant(
                "token_lineage.subject_matches_principal",
                invariant_id="INV-TOKEN-SUBJECT",
                applies_to=APPLIES_TO,
            ),
        ),
    )
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001"))[
        0
    ].satisfied is True
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-004"))[
        0
    ].violated is True


def test_one_time_token_must_be_unused():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        tokens=(
            token("TOK-001", subject="ACT-001", flow_id="FLOW-A", one_time=True, used=False),
            token("TOK-002", subject="ACT-001", flow_id="FLOW-A", one_time=True, used=True),
            token("TOK-003", subject="ACT-001", flow_id="FLOW-A", one_time=False, used=True),
        ),
        invariants=(
            build_invariant(
                "one_time_token.unused",
                invariant_id="INV-ONE-TIME-TOKEN-001",
                applies_to=APPLIES_TO,
                severity="critical",
            ),
        ),
    )
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001"))[
        0
    ].satisfied is True
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-002"))[
        0
    ].violated is True
    # 非一次性 token 已使用不算违规
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-003"))[
        0
    ].satisfied is True


# --------------------------------------------------------------------------- #
# 作用域
# --------------------------------------------------------------------------- #
def test_token_invariants_are_skipped_without_a_token_binding():
    world = lineage_world()
    action = make_action("refund", "ACT-001", resource_id="RES-001")
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.SKIPPED_UNBOUND_SUBJECT
    output = verdict(world, action)
    assert output.skipped_invariants == (
        {"invariant_id": "INV-TOKEN-LINEAGE-001", "reason": "unbound_subject"},
    )
    # 未绑定 ⇒ 不算满足，也不制造 attack
    assert output.world_truth != "attack"


def test_token_invariants_are_skipped_for_other_operations():
    world = lineage_world()
    action = make_action("read", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-B")
    assert evaluated(world, action)[0].scope is InvariantScope.SKIPPED_OUT_OF_SCOPE


def test_consulted_facts_include_the_flow_but_not_the_token_identity():
    """``current_flow.flow_id`` 是 context 视图（action 自带的 flow），不是世界事实。"""
    from security_world.policy import EvalContext, eval_expr, parse_expr

    world = lineage_world()
    action = make_action("refund", "ACT-001", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-B")
    context = EvalContext(world=world, action=action, now="2026-09-20T08:00:00Z",
                          current_flow_id="FLOW-B")
    document = world.invariants[0].to_document()["expr"]
    eval_expr(parse_expr(document), context)
    assert "token.TOK-001.flow_id" in context.consulted_refs
    assert "current_flow.flow_id" in context.read_paths
    assert "current_flow.flow_id" not in context.consulted_refs
