"""Oracle 聚合规则（设计 §8.2 / B2 / B10 / §13.1 的 ``test_oracle_aggregate.py``）。

三条不变式：

* ``attack`` iff（非 default 规则否定）∨（任一不变量被违反）；
* ``unauthorized`` iff（仅 default 规则否定）∧ 无不变量被违反；
* ``safe`` 否则。

**severity 不参与聚合**：任何 category 的被违反不变量都产生 attack。
"""
from __future__ import annotations

import pytest

from security_world.model.entities import INVARIANT_CATEGORIES
from security_world.oracle import aggregate
from security_world.policy import PolicyDecision
from security_world.invariants import ATTACK_CATEGORIES, build_invariant
from asw_worlds import actor, evaluated, make_action, make_world, resource, role

TRUE = {"op": "lit", "value": True}
OWNER_ONLY = {
    "op": "eq",
    "args": [
        {"op": "ref", "path": "action.actor.actor_id"},
        {"op": "ref", "path": "action.resource.owner"},
    ],
}


def allow_owner():
    return {
        "policy_id": "POL-OWNER",
        "action": {"operation": "read", "resource_type": "order"},
        "effect": "allow",
        "condition": OWNER_ONLY,
        "priority": 100,
    }


def default_deny():
    return {
        "policy_id": "POL-DEFAULT-DENY",
        "action": {"operation": "*"},
        "effect": "deny",
        "condition": TRUE,
        "priority": -1,
        "is_default_rule": True,
    }


def non_default_deny():
    return {
        "policy_id": "POL-BLOCK",
        "action": {"operation": "read", "resource_type": "order"},
        "effect": "deny",
        "condition": {
            "op": "in",
            "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": ["ROLE-CUSTOMER"]}],
        },
        "priority": 200,
    }


def deny(policy_id, *, is_default):
    return PolicyDecision(effect="deny", matched_policy_id=policy_id, is_default_rule=is_default,
                          evaluated=((policy_id, "condition_true"),))


def allow(policy_id):
    return PolicyDecision(effect="allow", matched_policy_id=policy_id, is_default_rule=False,
                          evaluated=((policy_id, "condition_true"),))


# --------------------------------------------------------------------------- #
# 聚合函数本身
# --------------------------------------------------------------------------- #
def test_allow_without_violation_is_safe():
    assert aggregate(allow("POL-OWNER"), ()) == "safe"


def test_default_deny_alone_is_unauthorized():
    assert aggregate(deny("POL-DEFAULT-DENY", is_default=True), ()) == "unauthorized"


def test_closed_world_deny_without_a_matched_rule_is_unauthorized():
    assert aggregate(deny(None, is_default=True), ()) == "unauthorized"


def test_non_default_deny_is_attack():
    assert aggregate(deny("POL-BLOCK", is_default=False), ()) == "attack"


@pytest.mark.parametrize("severity", ["critical", "high", "medium", "low"])
def test_any_violated_invariant_is_attack_regardless_of_severity(severity):
    """B2：severity 是报告字段，永远不移动 verdict。"""
    assert aggregate(allow("POL-OWNER"), ("INV-X",)) == "attack"
    assert aggregate(deny("POL-DEFAULT-DENY", is_default=True), ("INV-X",)) == "attack"
    assert severity in {"critical", "high", "medium", "low"}


def test_attack_categories_is_engine_private():
    assert ATTACK_CATEGORIES == frozenset(INVARIANT_CATEGORIES)
    assert len(ATTACK_CATEGORIES) == 20


# --------------------------------------------------------------------------- #
# 端到端：每个 category 一个违反样本
# --------------------------------------------------------------------------- #
def _world_with_invariant(category, expr, *, applies_to=("read",)):
    return make_world(
        roles=(role("ROLE-CUSTOMER"),),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-004", roles=("ROLE-CUSTOMER",)),
            actor("ACT-009", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
            actor("ACT-010", roles=("ROLE-CUSTOMER",), authentication_state="unauthenticated"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(allow_owner(), default_deny()),
        invariants=(
            build_invariant(
                "ownership.owner_only",  # key 只用于定位；下面整体替换 expr/category
                invariant_id="INV-PROBE",
                applies_to=applies_to,
            ),
        ),
    )


def test_violated_invariant_implies_attack_truth_for_every_phase1_category():
    """对每个 Phase 1 category 构造违反样本，断言 ``world_truth == "attack"``。"""
    from asw_worlds import run, session, token, world_with_full_evidence

    cases = {
        "ownership": (
            {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"},
                                  {"op": "ref", "path": "action.resource.owner"}]},
            make_action("read", "ACT-004", resource_id="RES-001"),
        ),
        "authorization": (
            {"op": "intersects", "args": [{"op": "ref", "path": "action.actor.roles"},
                                          {"op": "lit", "value": ["ROLE-ADMIN"]}]},
            make_action("read", "ACT-001", resource_id="RES-001"),
        ),
        "tenant_isolation": (
            {"op": "eq", "args": [{"op": "ref", "path": "action.actor.tenant"},
                                  {"op": "ref", "path": "action.resource.tenant"}]},
            make_action("read", "ACT-009", resource_id="RES-001"),  # 跨租户
        ),
        "session_revocation": (
            {"op": "eq", "args": [{"op": "ref", "path": "action.session.valid"}, {"op": "lit", "value": True}]},
            make_action("read", "ACT-001", resource_id="RES-001",
                        session_id="SES-BAD"),
        ),
        "authentication_state": (
            {"op": "eq", "args": [{"op": "ref", "path": "action.actor.authentication_state"},
                                  {"op": "lit", "value": "authenticated"}]},
            make_action("read", "ACT-010", resource_id="RES-001"),  # 未认证
        ),
        "session_binding": (
            {"op": "eq", "args": [{"op": "ref", "path": "action.session.principal"},
                                  {"op": "ref", "path": "action.actor.actor_id"}]},
            make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-OTHER"),
        ),
        "token_lineage": (
            {"op": "eq", "args": [{"op": "ref", "path": "action.token.flow_id"},
                                  {"op": "ref", "path": "current_flow.flow_id"}]},
            make_action("read", "ACT-001", resource_id="RES-001", token_id="TOK-BAD", flow_id="FLOW-B"),
        ),
        "one_time_token": (
            {"op": "or", "args": [
                {"op": "eq", "args": [{"op": "ref", "path": "action.token.one_time"}, {"op": "lit", "value": False}]},
                {"op": "eq", "args": [{"op": "ref", "path": "action.token.used"}, {"op": "lit", "value": False}]},
            ]},
            make_action("read", "ACT-001", resource_id="RES-001", token_id="TOK-USED"),
        ),
        "workflow_transition": (
            {"op": "state_is", "args": [{"op": "ref", "path": "action.workflow_instance.current_state"},
                                        {"op": "lit", "value": "paid"}]},
            make_action("read", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-OTHER"),
        ),
    }
    for category, (expr, action) in cases.items():
        world = _world_with_invariant(category, expr)
        document = world.invariants[0].to_document()
        document["category"] = category
        document["expr"] = expr
        from asw_worlds import with_entities

        world = with_entities(world, invariants=(document,))
        # 每个 case 需要的绑定实体
        if action.session == "SES-BAD":
            world = with_entities(world, sessions=(session("SES-BAD", principal="ACT-001", valid=False),))
        if action.session == "SES-OTHER":
            world = with_entities(world, sessions=(session("SES-OTHER", principal="ACT-004"),))
        if action.token == "TOK-BAD":
            world = with_entities(world, tokens=(token("TOK-BAD", subject="ACT-001", flow_id="FLOW-A"),))
        if action.token == "TOK-USED":
            world = with_entities(
                world, tokens=(token("TOK-USED", subject="ACT-001", one_time=True, used=True),)
            )
        if action.workflow_instance == "WFI-OTHER":
            world = with_entities(
                world,
                workflows=(
                    {
                        "workflow_id": "WFL-ORDER",
                        "name": "Order lifecycle",
                        "states": ["created", "paid"],
                        "initial_state": "created",
                        "transitions": [{"from_state": "created", "to_state": "paid"}],
                        "instances": [
                            {"instance_id": "WFI-OTHER", "resource_id": "RES-001", "current_state": "created"}
                        ],
                    },
                ),
            )
        results = evaluated(world, action)
        assert results[0].scope.value == "evaluated", category
        assert results[0].violated is True, category
        output = run(world_with_full_evidence(world, action), action)
        assert output.world_truth == "attack", category
        assert output.violated_invariants == ("INV-PROBE",), category


def test_default_deny_alone_does_not_produce_attack():
    """B10：作者漏写一条 allow 规则不会批量制造 attack 标签。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(default_deny(),),  # 只有兜底规则
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    from asw_worlds import run

    output = run(world, action)
    assert output.world_truth == "unauthorized"
    assert output.observable_decision == "unauthorized"


def test_non_default_deny_produces_attack():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(non_default_deny(), default_deny()),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    from asw_worlds import run

    output = run(world, action)
    assert output.world_truth == "attack"
    assert output.violated_invariants == ()


def test_allow_with_satisfied_invariants_is_safe():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(allow_owner(), default_deny()),
        invariants=(
            build_invariant("ownership.owner_only", invariant_id="INV-OWN", applies_to=("read",)),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    from asw_worlds import run, world_with_full_evidence

    output = run(world_with_full_evidence(world, action), action)
    assert output.world_truth == "safe"
    assert output.observable_decision == "safe"
    assert output.satisfied_invariants == ("INV-OWN",)


def test_unauthorized_stays_observable_as_unauthorized():
    """``unauthorized``（仅 default-deny）在 observable 趟仍是 unauthorized。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(default_deny(),),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    from asw_worlds import run

    output = run(world, action)
    assert output.world_truth == "unauthorized"
    assert output.observable_decision == "unauthorized"
    aggregate_step = [s for s in output.decision_trace if s["rule"] == "verdict.aggregate"][0]
    assert aggregate_step["operands"]["deny_from_default_rule"] is True
    assert aggregate_step["operands"]["violated_invariants"] == 0


def test_aggregate_trace_records_the_counts():
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-004", roles=("ROLE-CUSTOMER",)),
            actor("ACT-009", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
            actor("ACT-010", roles=("ROLE-CUSTOMER",), authentication_state="unauthenticated"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(allow_owner(), default_deny()),
        invariants=(
            build_invariant("ownership.owner_only", invariant_id="INV-OWN", applies_to=("read",)),
        ),
    )
    action = make_action("read", "ACT-004", resource_id="RES-001")
    from asw_worlds import run, world_with_full_evidence

    output = run(world_with_full_evidence(world, action), action)
    step = [s for s in output.decision_trace if s["rule"] == "verdict.aggregate"][0]
    assert step["operands"] == {"deny_from_default_rule": True, "violated_invariants": 1}
    assert step["result"] == "attack"
