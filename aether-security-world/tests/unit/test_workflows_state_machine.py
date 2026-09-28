"""工作流状态机：allowed / forbidden / conditional transition（设计 §7.2 / §13.1）。

§15.3 的模块级签名 ``transition_allowed(workflow, instance_id, to_state, ctx)`` 与
世界级入口 ``WorkflowMachine`` 都测；条件迁移的条件在**同一个**求值上下文上求值，
因此它读到的 ref 也计入 ``consulted_facts``。
"""
from __future__ import annotations

import pytest

from security_world.model import Workflow
from security_world.policy import EvalContext, parse_expr
from security_world.workflows import (
    TRANSITION_REASONS,
    TransitionResult,
    WorkflowError,
    WorkflowMachine,
    find_workflow,
    state_is,
    transition_allowed,
    workflow_errors,
)
from asw_worlds import (
    NOW,
    actor,
    make_action,
    make_world,
    override,
    resource,
    transition,
    workflow,
    instance,
)

#: 条件迁移：只有 privilege_version == 0 的行动主体才能推进。
CONDITION = {
    "op": "eq",
    "args": [
        {"op": "ref", "path": "action.actor.privilege_version"},
        {"op": "lit", "value": 0},
    ],
}


def order_workflow(**kwargs) -> dict:
    return workflow(
        "WFL-ORDER",
        states=("created", "paid", "refund_pending", "refunded"),
        initial_state="created",
        transitions_=(
            transition("created", "paid"),
            transition("paid", "refund_pending"),
            transition("refund_pending", "refunded", reversible=False),
            transition("paid", "refunded", condition=CONDITION, required_privileges=("order:refund",)),
        ),
        instances=(
            instance("WFI-001", resource_id="RES-001", current_state="paid"),
            instance("WFI-002", resource_id="RES-001", current_state="refunded"),
        ),
        **kwargs,
    )


@pytest.fixture()
def world():
    return make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order:read",)),
            actor("ACT-002", roles=("ROLE-SUPPORT",), privileges=("order:refund",), privilege_version=0),
            actor("ACT-003", roles=("ROLE-SUPPORT",), privileges=("order:refund",), privilege_version=9),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        workflows=(order_workflow(),),
    )


@pytest.fixture()
def machine(world):
    return WorkflowMachine.from_world(world)


def ctx(world, action):
    return EvalContext(world=world, action=action, now=NOW, current_flow_id="FLOW-A")


# --------------------------------------------------------------------------- #
# state_is
# --------------------------------------------------------------------------- #
def test_state_is_true_for_the_current_state(machine):
    assert machine.state_is("WFI-001", "paid") is True
    assert machine.state_is("WFI-002", "refunded") is True


def test_state_is_false_for_another_state(machine):
    assert machine.state_is("WFI-001", "created") is False
    assert machine.state_is("WFI-001", "refunded") is False


def test_state_is_false_for_undeclared_state(machine):
    """与字符串相似度无关：未声明的态恒为 False（schema 的 $comment 逐字要求）。"""
    assert machine.state_is("WFI-001", "PAID") is False
    assert machine.state_is("WFI-001", "paid ") is False
    assert machine.state_is("WFI-001", "") is False


def test_state_is_false_for_unknown_instance(machine):
    assert machine.state_is("WFI-404", "paid") is False


def test_state_is_raises_for_unknown_instance_on_the_query_api(machine):
    with pytest.raises(WorkflowError):
        machine.current_state("WFI-404")
    with pytest.raises(WorkflowError):
        machine.workflow_of("WFI-404")


def test_module_level_state_is_takes_the_workflow_explicitly(world):
    order = find_workflow(world, "WFI-001")
    assert order is not None
    assert state_is(order, "WFI-001", "paid") is True
    assert state_is(order, "WFI-001", "created") is False


# --------------------------------------------------------------------------- #
# allowed / forbidden transition
# --------------------------------------------------------------------------- #
def test_allowed_transition(machine):
    result = machine.check_transition("WFI-001", "refund_pending")
    assert result.allowed is True
    assert result.reason == "allowed"
    assert result.from_state == "paid"
    assert result.to_state == "refund_pending"
    assert result.workflow_id == "WFL-ORDER"


def test_forbidden_transition_has_no_declared_edge(machine):
    result = machine.check_transition("WFI-001", "created")
    assert result.allowed is False
    assert result.reason == "no_declared_transition"


def test_forbidden_transition_to_undeclared_state(machine):
    result = machine.check_transition("WFI-001", "charged_back")
    assert result.allowed is False
    assert result.reason == "unknown_target_state"


def test_forbidden_transition_from_unknown_instance(machine):
    result = machine.check_transition("WFI-404", "paid")
    assert result.allowed is False
    assert result.reason == "unknown_instance"


def test_reversible_false_does_not_invent_a_reverse_edge(machine):
    """``reversible`` 是作者元数据，不生成反向边：安全 oracle 不允许"发明"许可。"""
    assert machine.check_transition("WFI-002", "refund_pending").allowed is False
    assert machine.check_transition("WFI-002", "paid").allowed is False


def test_transition_reasons_are_a_closed_vocabulary(machine):
    assert set(TRANSITION_REASONS) == {
        "allowed",
        "no_declared_transition",
        "condition_false",
        "missing_privilege",
        "unknown_instance",
        "unknown_target_state",
        "unknown_current_state",
    }
    for instance_id, to_state in (
        ("WFI-001", "refund_pending"),
        ("WFI-001", "created"),
        ("WFI-001", "nope"),
        ("WFI-404", "paid"),
    ):
        assert machine.check_transition(instance_id, to_state).reason in TRANSITION_REASONS


def test_module_level_transition_allowed(world):
    order = find_workflow(world, "WFI-001")
    assert transition_allowed(order, "WFI-001", "refund_pending") is True
    assert transition_allowed(order, "WFI-001", "created") is False


# --------------------------------------------------------------------------- #
# conditional transition
# --------------------------------------------------------------------------- #
def test_conditional_transition_allowed_when_condition_holds(world, machine):
    action = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    result = machine.check_transition("WFI-001", "refunded", ctx(world, action))
    assert result.allowed is True
    assert result.reason == "allowed"
    assert result.condition == CONDITION


def test_conditional_transition_forbidden_when_condition_fails(world, machine):
    action = make_action("refund", "ACT-003", resource_id="RES-001", workflow_instance_id="WFI-001")
    result = machine.check_transition("WFI-001", "refunded", ctx(world, action))
    assert result.allowed is False
    assert result.reason == "condition_false"


def test_conditional_transition_without_context_is_not_allowed(world, machine):
    """拿不到上下文就无法验证条件 ⇒ fail-closed（不因为"可能成立"而放行）。"""
    assert machine.transition_allowed("WFI-001", "refunded", None) is False


def test_conditional_transition_records_consulted_facts(world, machine):
    action = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    context = ctx(world, action)
    machine.transition_allowed("WFI-001", "refunded", context)
    # 条件读了 action.actor.privilege_version ⇒ 它是决策关键事实
    assert "actor.ACT-002.privilege_version" in context.consulted_refs


def test_conditional_transition_required_privileges(world, machine):
    """``paid -> refunded`` 同时要求 ``order:refund`` 权限。"""
    allowed = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert machine.transition_allowed("WFI-001", "refunded", ctx(world, allowed)) is True
    unprivileged = override(world, "actor.ACT-002.privileges", ["order:read"])
    action = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    result = machine.check_transition("WFI-001", "refunded", ctx(unprivileged, action))
    assert result.allowed is False
    assert result.reason == "missing_privilege"
    assert result.missing_privileges == ("order:refund",)


def test_privileges_may_come_from_a_role(world, machine):
    """角色权限也算有效权限（actor.privileges ∪ role.privileges）。"""
    from asw_worlds import role, with_entities

    with_role = with_entities(
        world,
        roles=(role("ROLE-CUSTOMER", privileges=("order:refund",)),),
    )
    action = make_action("refund", "ACT-001", resource_id="RES-001", workflow_instance_id="WFI-001")
    # ACT-001 privilege_version == 0 ⇒ 条件成立；order:refund 来自角色
    assert machine.transition_allowed("WFI-001", "refunded", ctx(with_role, action)) is True


def test_conditional_transition_with_a_broken_condition_is_not_allowed(world, machine):
    from asw_worlds import with_entities

    broken = with_entities(
        world,
        workflows=(
            workflow(
                "WFL-ORDER",
                states=("created", "paid"),
                initial_state="created",
                transitions_=(
                    transition("created", "paid"),
                    transition("paid", "created", condition={"op": "ref", "path": "resource.RES-404.owner"}),
                ),
                instances=(instance("WFI-001", resource_id="RES-001", current_state="paid"),),
            ),
        ),
    )
    action = make_action("refund", "ACT-002", resource_id="RES-001", workflow_instance_id="WFI-001")
    assert WorkflowMachine.from_world(broken).transition_allowed("WFI-001", "created", ctx(broken, action)) is False


# --------------------------------------------------------------------------- #
# 结构自检
# --------------------------------------------------------------------------- #
def test_workflow_errors_detects_undeclared_states():
    broken = make_world(
        resources=(resource("RES-001", owner="ACT-001"),),
        workflows=(
            workflow(
                "WFL-BROKEN",
                states=("alpha", "beta"),  # minItems 2
                initial_state="gamma",  # 不在 states 里
                transitions_=(transition("alpha", "delta"),),  # delta 不在 states 里
                instances=(instance("WFI-001", resource_id="RES-001", current_state="zeta"),),
            ),
        ),
    )
    reasons = {reason for reason, _detail in workflow_errors(broken)}
    assert reasons == {"state_mismatch"}
    assert len(workflow_errors(broken)) == 3


def test_workflow_errors_is_empty_for_a_consistent_world(world):
    assert workflow_errors(world) == ()


def test_machine_rejects_duplicate_instance_ids():
    """同一 instance_id 出现在两个 workflow 里 ⇒ 构造期拒绝。

    （不走 ``make_world``：L1 的 ``collect_entities`` 已经先拒了这种情况，
    这里直接测 ``WorkflowMachine`` 自己的防线。）
    """
    from security_world.model.entities import Workflow, WorkflowInstance

    def machine_workflow(workflow_id: str, state: str) -> Workflow:
        return Workflow.from_document(
            workflow(
                workflow_id,
                states=("alpha", "beta"),
                initial_state="alpha",
                transitions_=(transition("alpha", "beta"),),
                instances=(instance("WFI-001", resource_id="RES-001", current_state=state),),
            )
        )

    with pytest.raises(WorkflowError):
        WorkflowMachine((machine_workflow("WFL-A", "alpha"), machine_workflow("WFL-B", "beta")))
    # 正常构造不受影响
    machine = WorkflowMachine((machine_workflow("WFL-A", "alpha"),))
    assert machine.instance_ids() == ("WFI-001",)
    assert machine.state_is("WFI-001", "alpha") is True
    assert isinstance(machine_workflow("WFL-A", "alpha").instances[0], WorkflowInstance)


def test_machine_instance_ids_are_sorted(machine):
    assert machine.instance_ids() == ("WFI-001", "WFI-002")
    assert machine.has_instance("WFI-001") is True
    assert machine.has_instance("WFI-404") is False


def test_transition_result_to_document_is_json_plain(machine):
    document = machine.check_transition("WFI-001", "refunded").to_document()
    assert document["allowed"] is False
    assert document["reason"] == "condition_false"
    assert isinstance(document["missing_privileges"], list)


def test_declared_transitions_and_transitions_from(machine, world):
    order = find_workflow(world, "WFI-001")
    edges = machine.declared_transitions(order, "paid", "refunded")
    assert len(edges) == 1
    assert machine.transitions_from(order, "paid") == tuple(
        t for t in order.transitions if t.from_state == "paid"
    )
    assert all(edge.from_state == "paid" and edge.to_state == "refunded" for edge in edges)
