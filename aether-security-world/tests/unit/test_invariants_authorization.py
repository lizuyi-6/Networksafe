"""authorization 不变量：水平/垂直越权的 violation 与 satisfy 两侧（设计 §13.1）。

三个模板分别覆盖：

* ``authorization.privilege_required`` —— 直授权限（垂直越权）；
* ``authorization.role_required`` —— RBAC 角色（垂直越权）；
* ``authorization.owner_or_privileged`` —— 属主或特权角色（水平+垂直越权）。
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
    resource,
    role,
    run,
    world_with_full_evidence,
)


def auth_world(invariant, *, extra_actors=()):
    return make_world(
        roles=(
            role("ROLE-CUSTOMER"),
            role("ROLE-SUPPORT", privileges=("order:refund",)),
            role("ROLE-ADMIN"),
        ),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order:read",)),
            actor("ACT-002", roles=("ROLE-SUPPORT",), privileges=("order:refund", "order:read")),
            actor("ACT-003", roles=("ROLE-ADMIN",), privileges=()),
            *extra_actors,
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=invariant,
    )


def verdict(world, action):
    return run(world_with_full_evidence(world, action), action)


# --------------------------------------------------------------------------- #
# privilege_required（垂直越权）
# --------------------------------------------------------------------------- #
PRIVILEGE_INVARIANT = build_invariant(
    "authorization.privilege_required",
    invariant_id="INV-AUTH-PRIV",
    applies_to=("refund",),
    privilege="order:refund",
    severity="critical",
)


def test_privilege_required_satisfied_by_direct_grant():
    world = auth_world((PRIVILEGE_INVARIANT,))
    action = make_action("refund", "ACT-002", resource_id="RES-001")
    assert evaluated(world, action)[0].satisfied is True
    assert verdict(world, action).satisfied_invariants == ("INV-AUTH-PRIV",)


def test_privilege_required_violated_without_the_privilege():
    world = auth_world((PRIVILEGE_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001")  # 只有 order:read
    assert evaluated(world, action)[0].violated is True
    output = verdict(world, action)
    assert output.world_truth == "attack"
    assert output.violated_invariants == ("INV-AUTH-PRIV",)


def test_privilege_required_does_not_accept_a_role_privilege_transitively():
    """角色权限不属于"直授"——这是 privilege_required 与 role_required 的区别。"""
    world = auth_world((PRIVILEGE_INVARIANT,))
    action = make_action("refund", "ACT-003", resource_id="RES-001")  # ADMIN 角色无直授权限
    assert evaluated(world, action)[0].violated is True


# --------------------------------------------------------------------------- #
# role_required（RBAC）
# --------------------------------------------------------------------------- #
ROLE_INVARIANT = build_invariant(
    "authorization.role_required",
    invariant_id="INV-AUTH-ROLE",
    applies_to=("refund",),
    roles=("ROLE-SUPPORT", "ROLE-ADMIN"),
)


def test_role_required_satisfied_by_one_of_the_roles():
    world = auth_world((ROLE_INVARIANT,))
    assert evaluated(world, make_action("refund", "ACT-002", resource_id="RES-001"))[0].satisfied is True


def test_role_required_violated_without_any_of_the_roles():
    world = auth_world((ROLE_INVARIANT,))
    action = make_action("refund", "ACT-001", resource_id="RES-001")
    assert evaluated(world, action)[0].violated is True
    assert verdict(world, action).world_truth == "attack"


def test_role_required_rejects_role_names_instead_of_ids():
    """S6：``actor.roles`` 存 role_id；用 name 比对的策略恒为 False（黄金 fixture 曾踩）。"""
    world = auth_world((ROLE_INVARIANT,))
    action = make_action("refund", "ACT-002", resource_id="RES-001")
    document = world.invariants[0].to_document()
    document["expr"]["args"][1]["value"] = ["Support"]  # name，不是 ROLE-SUPPORT
    from asw_worlds import with_entities

    renamed = with_entities(world, invariants=(document,))
    assert evaluated(renamed, action)[0].violated is True


# --------------------------------------------------------------------------- #
# owner_or_privileged（水平 + 垂直）
# --------------------------------------------------------------------------- #
OWNER_OR_PRIVILEGED = build_invariant(
    "authorization.owner_or_privileged",
    invariant_id="INV-AUTH-OWNER-OR-PRIV",
    applies_to=("write",),
    roles=("ROLE-ADMIN",),
)


def test_owner_or_privileged_satisfied_by_the_owner():
    world = auth_world((OWNER_OR_PRIVILEGED,))
    action = make_action("write", "ACT-001", resource_id="RES-001")
    assert evaluated(world, action)[0].satisfied is True


def test_owner_or_privileged_satisfied_by_a_privileged_role():
    world = auth_world((OWNER_OR_PRIVILEGED,))
    action = make_action("write", "ACT-003", resource_id="RES-001")
    assert evaluated(world, action)[0].satisfied is True


def test_owner_or_privileged_violated_by_a_lateral_user():
    """水平越权：另一个普通用户写别人的资源。"""
    world = auth_world(
        (OWNER_OR_PRIVILEGED,),
        extra_actors=(actor("ACT-004", roles=("ROLE-CUSTOMER",), privileges=("order:read",)),),
    )
    action = make_action("write", "ACT-004", resource_id="RES-001")
    assert evaluated(world, action)[0].violated is True
    output = verdict(world, action)
    assert output.world_truth == "attack"


# --------------------------------------------------------------------------- #
# 作用域
# --------------------------------------------------------------------------- #
def test_authorization_invariant_is_skipped_for_other_operations():
    world = auth_world((PRIVILEGE_INVARIANT,))
    action = make_action("read", "ACT-001", resource_id="RES-001")
    assert evaluated(world, action)[0].scope is InvariantScope.SKIPPED_OUT_OF_SCOPE


def test_authorization_invariant_is_skipped_without_a_resource_binding():
    world = auth_world((OWNER_OR_PRIVILEGED,))
    action = make_action("write", "ACT-004")  # 没有 resource 绑定
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.SKIPPED_UNBOUND_SUBJECT


def test_actor_without_privileges_field_violates_fail_closed():
    """没有 ``privileges`` 字段的 actor ⇒ UNKNOWN ⇒ 不放行 ⇒ 违反（fail-closed）。

    不是崩溃，也不是"跳过"：一个没有权限声明的主体不可能满足"必须具备某权限"。
    """
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order:refund",)),
            actor("ACT-004", roles=("ROLE-CUSTOMER",)),  # 没有 privileges 字段
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(PRIVILEGE_INVARIANT,),
    )
    assert evaluated(world, make_action("refund", "ACT-001", resource_id="RES-001"))[0].satisfied is True
    assert evaluated(world, make_action("refund", "ACT-004", resource_id="RES-001"))[0].violated is True


def test_acl_matching_is_not_expressible_in_the_dsl():
    """如实边界：``resource.acl`` 是数组而 BNF 没有下标语法，ACL 授权无法表达。

    因此授权类模板走"角色 / 直授权限 / 属主"三条可表达路径；想要 ACL 匹配的世界
    只能把授权信息提到可标量化的字段上（例如 ``resource.attributes.acl_owner``）。
    """
    from security_world.policy import UNKNOWN, EvalContext, eval_expr, parse_expr

    world = auth_world((OWNER_OR_PRIVILEGED,))
    action = make_action("write", "ACT-004", resource_id="RES-001")
    context = EvalContext(world=world, action=action, now=NOW)

    # 本世界的 resource 没有声明 acl ⇒ 读成 UNKNOWN（fail-closed），不崩
    assert eval_expr(parse_expr({"op": "ref", "path": "action.resource.acl"}), context) is UNKNOWN
    # 于是"ACL 里是否有人"这类比较恒为 False：DSL 无法表达条目级 ACL 授权
    document = {
        "op": "contains",
        "args": [{"op": "ref", "path": "action.resource.acl"}, {"op": "lit", "value": "ACT-001"}],
    }
    assert eval_expr(parse_expr(document), context) is False
    # 即使声明了 acl，DSL 也只能整数组比较，做不到"grantee==actor 且 permission==read"
    from asw_worlds import resource as make_resource
    from asw_worlds import with_entities

    with_acl = with_entities(
        world,
        resources=(
            {
                "resource_id": "RES-001",
                "resource_type": "order",
                "owner": "ACT-001",
                "tenant": "TEN-001",
                "sensitivity": "confidential",
                "state": "active",
                "acl": [{"grantee": "ACT-004", "grantee_type": "actor", "permissions": ["read"]}],
            },
        ),
    )
    acl_context = EvalContext(world=with_acl, action=action, now=NOW)
    assert eval_expr(parse_expr({"op": "ref", "path": "action.resource.acl"}), acl_context) == [
        {"grantee": "ACT-004", "grantee_type": "actor", "permissions": ["read"]}
    ]
