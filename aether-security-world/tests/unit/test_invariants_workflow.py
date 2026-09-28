"""workflow state 不变量：allowed / forbidden / conditional transition + 作用域。

设计 §13.1 的 ``test_invariants_workflow.py``。这里测的是**不变量层**的包装
（``workflow_state.*`` 模板）；状态机本身的判定见
``test_workflows_state_machine.py``。
"""
from __future__ import annotations

import pytest

from security_world.invariants import InvariantScope, build_invariant
from asw_worlds import (
    NOW,
    actor,
    evaluated,
    make_action,
    make_world,
    override,
    resource,
    role,
    run,
    transition,
    workflow,
    instance,
    world_with_full_evidence,
)

APPLIES_TO = ("refund",)


def order_workflow(*, condition=None, required_privileges=None, current_state="paid"):
    return workflow(
        "WFL-ORDER",
        states=("created", "paid", "refund_pending", "refunded"),
        initial_state="created",
        transitions_=(
            transition("created", "paid"),
            transition("paid", "refund_pending"),
            transition(
                "paid",
                "refunded",
                condition=condition,
                required_privileges=required_privileges,
            ),
        ),
        instances=(instance("WFI-001", resource_id="RES-001", current_state=current_state),),
    )


def workflow_world(invariant, *, workflow_document=None):
    return make_world(
        roles=(role("ROLE-CUSTOMER"), role("ROLE-SUPPORT", privileges=("order:refund",))),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order:read",)),
            actor("ACT-002", roles=("ROLE-SUPPORT",), privileges=("order:refund",), privilege_version=0),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        workflows=(workflow_document or order_workflow(),),
        invariants=invariant,
    )


def verdict(world, action):
    return run(world_with_full_evidence(world, action), action)


# --------------------------------------------------------------------------- #
# state_is
# --------------------------------------------------------------------------- #
STATE_INVARIANT = build_invariant(
    "workflow_state.state_is",
    invariant_id="INV-WORKFLOW-TRANSITION-001",
    applies_to=APPLIES_TO,
    state="paid",
    severity="critical",
)


def test_state_is_satisfied_in_the_required_state():
    world = workflow_world((STATE_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, action)[0].satisfied is True
    assert verdict(world, action).satisfied_invariants == ("INV-WORKFLOW-TRANSITION-001",)


def test_state_is_violated_in_another_state():
    world = workflow_world((STATE_INVARIANT,), workflow_document=order_workflow(current_state="refunded"))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    results = evaluated(world, action)
    assert results[0].violated is True
    output = verdict(world, action)
    assert output.world_truth == "attack"
    assert output.violated_invariants == ("INV-WORKFLOW-TRANSITION-001",)


def test_state_is_violated_in_a_state_the_machine_does_not_declare():
    """未声明的态恒为 False：与字符串相似度无关。"""
    world = workflow_world((STATE_INVARIANT,))
    document = world.invariants[0].to_document()
    document["expr"]["args"][1]["value"] = "PAID"
    from asw_worlds import with_entities

    renamed = with_entities(world, invariants=(document,))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(renamed, action)[0].violated is True


def test_state_in_accepts_several_states():
    world = workflow_world(
        (
            build_invariant(
                "workflow_state.state_in",
                invariant_id="INV-STATE-IN",
                applies_to=APPLIES_TO,
                states=("paid", "refund_pending"),
            ),
        )
    )
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, action)[0].satisfied is True
    other = workflow_world(
        (
            build_invariant(
                "workflow_state.state_in",
                invariant_id="INV-STATE-IN",
                applies_to=APPLIES_TO,
                states=("created", "refund_pending"),
            ),
        )
    )
    assert evaluated(other, action)[0].violated is True


# --------------------------------------------------------------------------- #
# transition_declared
# --------------------------------------------------------------------------- #
TRANSITION_INVARIANT = build_invariant(
    "workflow_state.transition_declared",
    invariant_id="INV-TRANSITION-DECLARED",
    applies_to=APPLIES_TO,
    to_state="refunded",
)


def test_declared_transition_satisfies():
    world = workflow_world((TRANSITION_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, action)[0].satisfied is True


def test_undeclared_transition_violates():
    world = workflow_world((TRANSITION_INVARIANT,), workflow_document=order_workflow(current_state="refunded"))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    results = evaluated(world, action)
    assert results[0].violated is True
    assert verdict(world, action).world_truth == "attack"


def test_conditional_transition_satisfies_only_when_the_condition_holds():
    condition = {
        "op": "eq",
        "args": [
            {"op": "ref", "path": "action.actor.privilege_version"},
            {"op": "lit", "value": 0},
        ],
    }
    world = workflow_world(
        (TRANSITION_INVARIANT,),
        workflow_document=order_workflow(condition=condition),
    )
    allowed = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, allowed)[0].satisfied is True

    bumped = override(world, "actor.ACT-002.privilege_version", 7)
    assert evaluated(bumped, allowed)[0].violated is True


def test_conditional_transition_without_context_fails_closed():
    """条件不可验证 ⇒ 不允许（不是"可能成立所以放行"）。"""
    from security_world.workflows import WorkflowMachine

    world = workflow_world((TRANSITION_INVARIANT,))
    machine = WorkflowMachine.from_world(world)
    # paid -> refunded 在 order_workflow 里是无条件声明的
    assert machine.transition_allowed("WFI-001", "refunded", None) is True
    conditional = workflow_world(
        (TRANSITION_INVARIANT,),
        workflow_document=order_workflow(
            condition={
                "op": "eq",
                "args": [{"op": "ref", "path": "action.actor.privilege_version"}, {"op": "lit", "value": 0}],
            }
        ),
    )
    assert WorkflowMachine.from_world(conditional).transition_allowed("WFI-001", "refunded", None) is False


def test_required_privileges_gate_the_transition():
    world = workflow_world(
        (TRANSITION_INVARIANT,),
        workflow_document=order_workflow(required_privileges=("order:refund",)),
    )
    privileged = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, privileged)[0].satisfied is True
    unprivileged = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, unprivileged)[0].violated is True


def test_transition_declared_reads_the_instances_current_state():
    """``from_state`` 取绑定实例的当前态，不作为第三参传入（S3）。"""
    world = workflow_world((TRANSITION_INVARIANT,))
    document = world.invariants[0].to_document()["expr"]
    assert document["op"] == "transition_allowed"
    assert len(document["args"]) == 2
    assert document["args"][0]["path"] == "action.workflow_instance.current_state"


# --------------------------------------------------------------------------- #
# 作用域
# --------------------------------------------------------------------------- #
def test_workflow_invariants_are_skipped_without_a_binding():
    world = workflow_world((STATE_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001")
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.SKIPPED_UNBOUND_SUBJECT
    output = verdict(world, action)
    assert output.skipped_invariants == (
        {"invariant_id": "INV-WORKFLOW-TRANSITION-001", "reason": "unbound_subject"},
    )


def test_workflow_invariants_are_skipped_for_other_operations():
    world = workflow_world((STATE_INVARIANT,))
    action = make_action("read", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, action)[0].scope is InvariantScope.SKIPPED_OUT_OF_SCOPE


def test_instance_current_state_change_flips_the_verdict():
    world = workflow_world((STATE_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert evaluated(world, action)[0].satisfied is True
    moved = override(world, "workflow_instance.WFI-001.current_state", "refund_pending")
    assert evaluated(moved, action)[0].violated is True


def test_workflow_invariants_consult_the_instance_state_fact():
    from security_world.policy import EvalContext, eval_expr, parse_expr

    world = workflow_world((STATE_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    context = EvalContext(world=world, action=action, now=NOW, current_flow_id="FLOW-A")
    eval_expr(parse_expr(world.invariants[0].to_document()["expr"]), context)
    assert "workflow_instance.WFI-001.current_state" in context.consulted_refs
