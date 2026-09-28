"""ownership 不变量：violation 与 satisfy 两侧 + 作用域（设计 §13.1）。

黄金 fixture 的原例（需求 §22）：``owner_only ∧ principal != owner`` ⇒ 违规；
``principal == owner`` ⇒ 不违规。
"""
from __future__ import annotations

import pytest

from security_world.invariants import (
    InvariantScope,
    build_invariant,
    evaluate_invariants,
    invariant_scope,
    partition,
    partition_is_complete,
)
from asw_worlds import (
    actor,
    evaluated,
    make_action,
    make_world,
    resource,
    role,
    run,
    world_with_full_evidence,
)

APPLIES_TO = ("read",)


def ownership_world(*, support_roles=(), extra_actors=(), extra_resources=()):
    return make_world(
        roles=(
            role("ROLE-CUSTOMER"),
            role("ROLE-SUPPORT"),
        ),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), tenant="TEN-001"),
            actor("ACT-002", roles=("ROLE-SUPPORT",), tenant="TEN-001"),
            actor("ACT-003", roles=("ROLE-SUPPORT",), tenant="TEN-002"),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), tenant="TEN-001"),
            *extra_actors,
        ),
        resources=(
            resource("RES-001", owner="ACT-001", tenant="TEN-001"),
            resource("RES-002", owner="ACT-004", tenant="TEN-001"),
            *extra_resources,
        ),
        invariants=(
            build_invariant(
                "ownership.owner_only",
                invariant_id="INV-OWNERSHIP-001",
                applies_to=APPLIES_TO,
                support_roles=support_roles,
                severity="critical",
                description="A resource read must be performed by its owner.",
            ),
        ),
    )


def verdict(world, action):
    return run(world_with_full_evidence(world, action), action)


# --------------------------------------------------------------------------- #
# satisfy 侧
# --------------------------------------------------------------------------- #
def test_owner_reading_own_resource_satisfies_the_invariant():
    world = ownership_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.EVALUATED
    assert results[0].satisfied is True
    assert results[0].violated is False
    output = verdict(world, action)
    assert output.satisfied_invariants == ("INV-OWNERSHIP-001",)
    assert output.violated_invariants == ()


def test_owner_only_without_support_roles_has_no_escape_branch():
    world = ownership_world()
    action = make_action("read", "ACT-002", resource_id="RES-001")  # 同租户 support
    assert evaluated(world, action)[0].satisfied is False


def test_same_tenant_support_agent_satisfies_when_configured():
    world = ownership_world(support_roles=("ROLE-SUPPORT",))
    action = make_action("read", "ACT-002", resource_id="RES-001")
    assert evaluated(world, action)[0].satisfied is True
    assert verdict(world, action).satisfied_invariants == ("INV-OWNERSHIP-001",)


# --------------------------------------------------------------------------- #
# violation 侧
# --------------------------------------------------------------------------- #
def test_other_customer_reading_someone_elses_resource_violates():
    world = ownership_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    results = evaluated(world, action)
    assert results[0].satisfied is False
    assert results[0].violated is True
    output = verdict(world, action)
    assert output.violated_invariants == ("INV-OWNERSHIP-001",)
    # 任一不变量被违反 ⇒ attack，且 severity 不参与聚合
    assert output.world_truth == "attack"


def test_cross_tenant_support_agent_violates_even_with_support_role():
    world = ownership_world(support_roles=("ROLE-SUPPORT",))
    action = make_action("read", "ACT-003", resource_id="RES-001")
    assert evaluated(world, action)[0].violated is True
    assert verdict(world, action).world_truth == "attack"


def test_severity_does_not_downgrade_a_violation():
    """B2：把 severity 标成 low 不会让违反不再产生 attack 标签。"""
    world = ownership_world()
    document = world.invariants[0].to_document()
    document["severity"] = "low"
    from asw_worlds import with_entities

    downgraded = with_entities(world, invariants=(document,))
    action = make_action("read", "ACT-004", resource_id="RES-001")
    output = verdict(downgraded, action)
    assert output.world_truth == "attack"
    assert output.violated_invariants == ("INV-OWNERSHIP-001",)


def test_owner_or_group_template():
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), groups=("G-ALPHA",)),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), groups=("G-BETA",)),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(
            build_invariant(
                "ownership.owner_or_group",
                invariant_id="INV-OWN-GROUP",
                applies_to=APPLIES_TO,
                groups=("G-ALPHA",),
            ),
        ),
    )
    assert evaluated(world, make_action("read", "ACT-001", resource_id="RES-001"))[0].satisfied is True
    assert evaluated(world, make_action("read", "ACT-004", resource_id="RES-001"))[0].violated is True


# --------------------------------------------------------------------------- #
# 作用域
# --------------------------------------------------------------------------- #
def test_operation_not_in_applies_to_is_skipped_out_of_scope():
    world = ownership_world()
    action = make_action("refund", "ACT-004", resource_id="RES-001")
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.SKIPPED_OUT_OF_SCOPE
    assert results[0].satisfied is False
    assert results[0].trace[0]["rule"] == "invariant.skip"
    assert results[0].trace[0]["result"] == "skipped_out_of_scope"
    output = verdict(world, action)
    assert output.satisfied_invariants == ()
    assert output.violated_invariants == ()
    assert output.skipped_invariants == ({"invariant_id": "INV-OWNERSHIP-001", "reason": "out_of_scope"},)


def test_unbound_resource_is_skipped_unbound_subject():
    world = ownership_world()
    action = make_action("read", "ACT-001")  # 没有 resource 绑定
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.SKIPPED_UNBOUND_SUBJECT
    assert results[0].trace[0]["result"] == "skipped_unbound_subject"
    output = verdict(world, action)
    assert output.skipped_invariants == (
        {"invariant_id": "INV-OWNERSHIP-001", "reason": "unbound_subject"},
    )
    # 未绑定 ⇒ 既不满足也不违反
    assert output.world_truth != "attack"


def test_star_applies_to_evaluates_against_actual_bindings():
    """``["*"]`` 的语义是对 action 实际绑定的实体求值（B16）。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(
            build_invariant("ownership.owner_only", invariant_id="INV-STAR", applies_to=("*",)),
        ),
    )
    assert invariant_scope(world.invariants[0], make_action("read", "ACT-004", resource_id="RES-001")) is (
        InvariantScope.EVALUATED
    )
    assert invariant_scope(world.invariants[0], make_action("read", "ACT-004")) is (
        InvariantScope.SKIPPED_UNBOUND_SUBJECT
    )


def test_partition_is_complete_and_disjoint():
    world = ownership_world(
        support_roles=("ROLE-SUPPORT",),
        extra_actors=(actor("ACT-005", roles=("ROLE-CUSTOMER",), tenant="TEN-003"),),
    )
    from asw_worlds import with_entities

    multi = with_entities(
        world,
        invariants=(
            build_invariant("ownership.owner_only", invariant_id="INV-A", applies_to=APPLIES_TO),
            build_invariant("ownership.owner_or_group", invariant_id="INV-B", applies_to=("refund",),
                            groups=("G-ALPHA",)),
            build_invariant("ownership.owner_only", invariant_id="INV-C", applies_to=("*",)),
        ),
    )
    for action in (
        make_action("read", "ACT-004", resource_id="RES-001"),
        make_action("refund", "ACT-004", resource_id="RES-001"),
        make_action("read", "ACT-001", resource_id="RES-001"),
    ):
        results = evaluated(multi, action)
        assert partition_is_complete(results, multi)
        violated, satisfied, skipped = partition(results)
        assert len(violated) + len(satisfied) + len(skipped) == len(multi.invariants)
        assert not (set(violated) & set(satisfied))
        assert not (set(violated) & {item["invariant_id"] for item in skipped})


def test_results_follow_world_document_order():
    world = ownership_world()
    from asw_worlds import with_entities

    multi = with_entities(
        world,
        invariants=(
            build_invariant("ownership.owner_only", invariant_id="INV-Z", applies_to=APPLIES_TO),
            build_invariant("ownership.owner_only", invariant_id="INV-A", applies_to=APPLIES_TO),
        ),
    )
    results = evaluated(multi, make_action("read", "ACT-004", resource_id="RES-001"))
    assert [result.invariant_id for result in results] == ["INV-Z", "INV-A"]


def test_evaluate_invariants_returns_one_result_per_invariant():
    world = ownership_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    assert len(evaluated(world, action)) == len(world.invariants)


@pytest.mark.parametrize(
    "actor_id,expected",
    [
        ("ACT-001", True),   # 属主
        ("ACT-002", False),  # 同租户 support 但未配逃生分支
        ("ACT-003", False),  # 跨租户 support
        ("ACT-004", False),  # 另一个客户
    ],
)
def test_owner_only_matrix(actor_id, expected):
    world = ownership_world()
    action = make_action("read", actor_id, resource_id="RES-001")
    assert evaluated(world, action)[0].satisfied is expected
