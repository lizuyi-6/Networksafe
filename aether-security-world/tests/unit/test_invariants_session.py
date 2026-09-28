"""session validity 不变量：revoked / valid=false / 过期 / 认证状态 / 会话嫁接。

设计 §7.4 的 ``session_validity`` 是 ``session_revocation`` + ``authentication_state``
（+ 本模块的 ``session_binding``）三类的合称；schema 枚举里没有
``session_validity``，模板逐条落到具体 category 上。
"""
from __future__ import annotations

import pytest

from security_world.invariants import InvariantScope, build_invariant
from asw_worlds import (
    EXPIRED_AT,
    NOW,
    actor,
    evaluated,
    make_action,
    make_world,
    override,
    resource,
    run,
    session,
    world_with_full_evidence,
)

APPLIES_TO = ("read", "refund")


def session_world(*, sessions=(), extra_actors=()):
    return make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), authentication_state="authenticated"),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), authentication_state="unauthenticated"),
            actor("ACT-005", roles=("ROLE-CUSTOMER",), authentication_state="password_reset_pending"),
            *extra_actors,
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        sessions=(
            session("SES-001", principal="ACT-001"),                       # 健康
            session("SES-002", principal="ACT-001", revoked=True, revoked_at=NOW),
            session("SES-003", principal="ACT-001", valid=False),
            session("SES-004", principal="ACT-001", expires_at=EXPIRED_AT),
            session("SES-005", principal="ACT-004"),                       # 主体是 ACT-004
            *sessions,
        ),
        invariants=(
            build_invariant(
                "session_validity.active",
                invariant_id="INV-SESSION-ACTIVE",
                applies_to=APPLIES_TO,
                severity="critical",
            ),
        ),
    )


def verdict(world, action):
    return run(world_with_full_evidence(world, action), action)


# --------------------------------------------------------------------------- #
# session_validity.active
# --------------------------------------------------------------------------- #
def test_healthy_session_satisfies():
    world = session_world()
    action = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-001")
    assert evaluated(world, action)[0].satisfied is True
    assert verdict(world, action).satisfied_invariants == ("INV-SESSION-ACTIVE",)


def test_revoked_session_violates():
    world = session_world()
    action = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-002")
    results = evaluated(world, action)
    assert results[0].violated is True
    output = verdict(world, action)
    assert output.world_truth == "attack"
    assert output.violated_invariants == ("INV-SESSION-ACTIVE",)


def test_invalid_session_violates():
    world = session_world()
    action = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-003")
    assert evaluated(world, action)[0].violated is True


def test_expired_session_violates_on_the_virtual_clock():
    """过期判断在虚拟时钟上：``after(session.expires_at, current_time)``。"""
    world = session_world()
    action = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-004", at=NOW)
    assert evaluated(world, action)[0].violated is True
    # 动作发生在过期之前 ⇒ 满足
    earlier = make_action(
        "read", "ACT-001", resource_id="RES-001", session_id="SES-004", at="2026-09-18T08:00:00Z"
    )
    assert evaluated(world, earlier)[0].satisfied is True


def test_session_validity_expression_shape():
    """``and(eq(valid,true), and(eq(revoked,false), after(expires_at, now)))``。"""
    world = session_world()
    document = world.invariants[0].to_document()["expr"]
    assert document["op"] == "and"
    outer = document["args"]
    assert outer[0]["op"] == "eq" and outer[0]["args"][0]["path"] == "action.session.valid"
    assert outer[1]["op"] == "and"
    inner = outer[1]["args"]
    assert inner[0]["args"][0]["path"] == "action.session.revoked"
    assert inner[1]["op"] == "after"
    assert inner[1]["args"][0]["path"] == "action.session.expires_at"
    assert inner[1]["args"][1]["path"] == "current_time"


# --------------------------------------------------------------------------- #
# session_validity.authenticated
# --------------------------------------------------------------------------- #
def test_authentication_state_required():
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), authentication_state="authenticated"),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), authentication_state="unauthenticated"),
            actor("ACT-005", roles=("ROLE-CUSTOMER",), authentication_state="password_reset_pending"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(
            build_invariant(
                "session_validity.authenticated",
                invariant_id="INV-AUTH-STATE",
                applies_to=APPLIES_TO,
            ),
        ),
    )
    assert evaluated(world, make_action("read", "ACT-001", resource_id="RES-001"))[0].satisfied is True
    assert evaluated(world, make_action("read", "ACT-004", resource_id="RES-001"))[0].violated is True
    assert evaluated(world, make_action("read", "ACT-005", resource_id="RES-001"))[0].violated is True


def test_authentication_state_accepts_a_custom_requirement():
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), authentication_state="mfa_pending"),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), authentication_state="authenticated"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(
            build_invariant(
                "session_validity.authenticated",
                invariant_id="INV-AUTH-STATE",
                applies_to=APPLIES_TO,
                state="mfa_pending",
            ),
        ),
    )
    assert evaluated(world, make_action("read", "ACT-001", resource_id="RES-001"))[0].satisfied is True
    assert evaluated(world, make_action("read", "ACT-004", resource_id="RES-001"))[0].violated is True


# --------------------------------------------------------------------------- #
# session_validity.bound_to_principal
# --------------------------------------------------------------------------- #
def test_session_bound_to_principal():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        sessions=(
            session("SES-001", principal="ACT-001"),
            session("SES-005", principal="ACT-004"),
        ),
        invariants=(
            build_invariant(
                "session_validity.bound_to_principal",
                invariant_id="INV-SESSION-BINDING",
                applies_to=APPLIES_TO,
                severity="critical",
            ),
        ),
    )
    # 会话主体正是行动主体 ⇒ 满足
    assert evaluated(world, make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-001"))[
        0
    ].satisfied is True
    # 拿着别人的会话行动 ⇒ 违反（会话嫁接）
    hijack = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-005")
    assert evaluated(world, hijack)[0].violated is True
    assert verdict(world, hijack).world_truth == "attack"


# --------------------------------------------------------------------------- #
# 作用域
# --------------------------------------------------------------------------- #
def test_session_invariants_are_skipped_without_a_session_binding():
    world = session_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")  # 无 session 绑定
    results = evaluated(world, action)
    assert results[0].scope is InvariantScope.SKIPPED_UNBOUND_SUBJECT
    # reason 在 operands 里；result 是 "skipped_" + reason
    assert results[0].trace[0]["operands"]["reason"] == "unbound_subject"
    assert results[0].trace[0]["result"] == "skipped_unbound_subject"
    output = verdict(world, action)
    assert output.skipped_invariants == (
        {"invariant_id": "INV-SESSION-ACTIVE", "reason": "unbound_subject"},
    )


def test_session_invariants_are_skipped_for_other_operations():
    world = session_world()
    action = make_action("refund", "ACT-001", resource_id="RES-001", session_id="SES-002")
    # refund 在 applies_to 里 ⇒ 仍要求值（这里是违反）
    assert evaluated(world, action)[0].violated is True
    other = make_action("write", "ACT-001", resource_id="RES-001", session_id="SES-002")
    assert evaluated(world, other)[0].scope is InvariantScope.SKIPPED_OUT_OF_SCOPE


def test_revoked_at_is_recorded_but_not_required_for_the_verdict():
    """``revoked_at`` 只是审计信息；判定只看 ``revoked`` / ``valid`` / ``expires_at``。"""
    world = session_world()
    action = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-002")
    document = world.sessions[1].to_document()
    assert document["revoked_at"] == NOW
    assert document["revocation_reason"] == "user_requested"
    assert evaluated(world, action)[0].violated is True


def test_all_session_states_covered():
    """每个会话状态各有一条 satisfy/violation 断言（设计 §13.1 的覆盖面）。"""
    world = session_world()
    cases = {
        "SES-001": True,   # valid + not revoked + not expired
        "SES-002": False,  # revoked
        "SES-003": False,  # valid == false
        "SES-004": False,  # expired
    }
    for session_id, expected in cases.items():
        action = make_action("read", "ACT-001", resource_id="RES-001", session_id=session_id)
        assert evaluated(world, action)[0].satisfied is expected, session_id


def test_password_reset_session_violates_when_required_state_is_authenticated():
    world = session_world(
        extra_actors=(actor("ACT-006", roles=("ROLE-CUSTOMER",), authentication_state="mfa_complete"),),
    )
    from asw_worlds import with_entities

    combined = with_entities(
        world,
        invariants=(
            build_invariant("session_validity.active", invariant_id="INV-SESSION-ACTIVE",
                            applies_to=APPLIES_TO),
            build_invariant("session_validity.authenticated", invariant_id="INV-AUTH-STATE",
                            applies_to=APPLIES_TO),
        ),
    )
    action = make_action("read", "ACT-005", resource_id="RES-001", session_id="SES-001")
    results = {result.invariant_id: result for result in evaluated(combined, action)}
    assert results["INV-SESSION-ACTIVE"].satisfied is True
    assert results["INV-AUTH-STATE"].violated is True


def test_overriding_a_session_flag_flips_the_verdict():
    world = session_world()
    healthy = make_action("read", "ACT-001", resource_id="RES-001", session_id="SES-001")
    assert evaluated(world, healthy)[0].satisfied is True
    revoked_world = override(world, "session.SES-001.revoked", True)
    assert evaluated(revoked_world, healthy)[0].violated is True
