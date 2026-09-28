"""Agent D（``security_world/expansion``）的共享测试构造器。

与 ``asw_worlds.py``（Agent B/C 共用）的分工：那个模块提供"过 schema 的世界积木"，
本模块提供**展开层测试专用**的世界与 spec 场景——

* :func:`ownership_world` —— owner-only 世界：base=attack，把 owner 改成读者即 safe
  （§9.1 的 AXIS-001 形态，diff/干预/渲染/元变形测试共用）；
* :func:`masking_world` —— 带非 consulted 证据的充分世界（掩蔽 level 测试用）；
* :func:`degraded_world` —— 世界目录**声明**矛盾/陈旧/攻击者可控证据的世界
  （掩蔽只能隐藏、不能制造，所以这三个 level 只能靠声明构造）；
* :func:`critical_cases` —— 九类"决定 verdict 的状态变量"各一个翻转场景
  （owner / role / permission / workflow state / token lineage / token used /
  session revoked / privilege version / tenant，即任务书要求逐类覆盖的轴）；
* :func:`spec_from_world` —— 把世界文档升级成合法 WorldSpec（补假设块与
  episode_templates；假设块是 R4 的**先验**预期， Gate 5 据此证伪）。

所有世界都过 ``world.schema.json`` / ``world-spec.schema.json``（构造即校验），
证据一律带 ``timestamp``——``episode.schema.json`` 的 ``evidence_observation``
七键投影要求它，缺了渲染器只能硬失败（见 ``rendering.project_evidence``）。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from asw_worlds import (
    NOW,
    actor,
    evidence,
    instance,
    make_action,
    make_world,
    resource,
    role,
    session,
    token,
    transition,
    workflow,
)

from security_world.model import WorldSpec, validate_document
from security_world.model.events import Event

# --------------------------------------------------------------------------- #
# 证据助手（asw_worlds.evidence 不带 timestamp，这里补上）
# --------------------------------------------------------------------------- #


def ev(evidence_id: str, asserts_ref: str, value: Any, **kwargs: Any) -> dict[str, Any]:
    """带 timestamp 的证据（``evidence_observation`` 七键投影要求 timestamp）。"""
    document = evidence(evidence_id, asserts_ref, value, **kwargs)
    document.setdefault("timestamp", NOW)
    return document


# --------------------------------------------------------------------------- #
# 策略 / 不变量积木
# --------------------------------------------------------------------------- #


def allow_policy(policy_id: str, condition: dict[str, Any], *, operation: str = "read",
                 resource_type: str = "order", requires_fresh: bool | None = None) -> dict[str, Any]:
    document: dict[str, Any] = {
        "policy_id": policy_id,
        "description": f"synthetic allow policy {policy_id}",
        "action": {"operation": operation, "resource_type": resource_type},
        "effect": "allow",
        "condition": condition,
        "priority": 100,
    }
    if requires_fresh is not None:
        document["requires_fresh"] = requires_fresh
    return document


def invariant(invariant_id: str, category: str, expr: dict[str, Any],
              *, applies_to: tuple[str, ...] = ("read",)) -> dict[str, Any]:
    return {
        "invariant_id": invariant_id,
        "category": category,
        "applies_to": list(applies_to),
        "severity": "critical",
        "description": f"synthetic invariant {invariant_id}",
        "expr": expr,
    }


def eq(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {"op": "eq", "args": [left, right]}


def ref(path: str) -> dict[str, Any]:
    return {"op": "ref", "path": path}


def lit(value: Any) -> dict[str, Any]:
    return {"op": "lit", "value": value}


def state_is(path: str, state: str) -> dict[str, Any]:
    return {"op": "state_is", "args": [ref(path), lit(state)]}


def owner_only_pair() -> tuple[dict[str, Any], dict[str, Any]]:
    """owner-only 读策略 + ownership 不变量（条件同源：干预后两者同时翻转）。"""
    condition = eq(ref("action.actor.actor_id"), ref("action.resource.owner"))
    return (
        allow_policy("POL-OWNER", condition),
        invariant("INV-OWNERSHIP-001", "ownership", condition),
    )


# --------------------------------------------------------------------------- #
# 场景世界
# --------------------------------------------------------------------------- #


def ownership_world(*, world_id: str = "W-900001", with_evidence: bool = True) -> Any:
    """ACT-003 读 ACT-001 的订单：owner 不匹配 ⇒ attack；owner 改成 ACT-003 ⇒ safe。"""
    policy, ownership = owner_only_pair()
    evidence_items: tuple[dict[str, Any], ...] = ()
    if with_evidence:
        evidence_items = (
            ev("EV-OWN", "resource.RES-001.owner", "ACT-001"),
            ev("EV-NC", "actor.ACT-001.tenant", "TEN-001"),
        )
    return make_world(
        world_id=world_id,
        policies=(policy,),
        invariants=(ownership,),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-003", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
        evidence_items=evidence_items,
    )


def masking_world(*, world_id: str = "W-900002") -> Any:
    """充分世界：每个 consulted 事实都有 establishing 证据 + 一条非 consulted 证据。

    consulted = {resource.RES-001.owner, session.SES-001.revoked}（ownership 不变量 +
    session 不变量各读一个）：

    * ``EV-OWN`` trusted ⇒ owner 事实的 establishing 项；
    * ``EV-OWN-U`` untrusted ⇒ owner 事实的**额外**可见项（让 partially_missing 的
      判定与 minimally_sufficient 区分开：藏掉非 consulted 项后可见集不是最小集）；
    * ``EV-NC`` 断言一个没人 consult 的事实——诱饵掩蔽（partially_missing）只能藏它。
    """
    policy, ownership = owner_only_pair()
    session_invariant = invariant(
        "INV-SESSION-001",
        "session_revocation",
        eq(ref("action.session.revoked"), lit(False)),
    )
    return make_world(
        world_id=world_id,
        policies=(policy,),
        invariants=(ownership, session_invariant),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-003", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        sessions=(session("SES-001", principal="ACT-003"),),
        roles=(role("ROLE-CUSTOMER"),),
        evidence_items=(
            ev("EV-OWN", "resource.RES-001.owner", "ACT-001"),
            ev("EV-OWN-U", "resource.RES-001.owner", "ACT-009", trust_level="untrusted"),
            ev("EV-SESS", "session.SES-001.revoked", False),
            ev("EV-NC", "actor.ACT-001.tenant", "TEN-001"),
        ),
    )


def degraded_world(*, world_id: str = "W-900003") -> Any:
    """世界**声明**矛盾 / 陈旧 / 攻击者可控证据的世界（掩蔽造不出这三类）。

    * ``EV-OWN-A`` trusted+fresh / ``EV-OWN-B`` trusted+stale，同事实取值不同
      ⇒ contradictory；藏掉 fresh 的那条只剩 stale ⇒ stale（配 requires_fresh 策略）；
    * ``EV-OWN-C`` untrusted + attacker_controllable ⇒ 藏掉另两条即
      attacker_controlled。
    """
    policy, ownership = owner_only_pair()
    policy = dict(policy, requires_fresh=True)
    session_invariant = invariant(
        "INV-SESSION-001",
        "session_revocation",
        eq(ref("action.session.revoked"), lit(False)),
    )
    return make_world(
        world_id=world_id,
        policies=(policy,),
        invariants=(ownership, session_invariant),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-003", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        sessions=(session("SES-001", principal="ACT-003"),),
        roles=(role("ROLE-CUSTOMER"),),
        evidence_items=(
            ev("EV-OWN-A", "resource.RES-001.owner", "ACT-001"),
            ev("EV-OWN-B", "resource.RES-001.owner", "ACT-002", freshness="stale"),
            ev(
                "EV-OWN-C",
                "resource.RES-001.owner",
                "ACT-003",
                trust_level="untrusted",
                attacker_controllable=True,
            ),
            ev("EV-SESS", "session.SES-001.revoked", False),
            ev("EV-NC", "actor.ACT-001.tenant", "TEN-001"),
        ),
    )


# --------------------------------------------------------------------------- #
# 九类关键轴：每个场景 base=attack，单变量干预后 safe
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class CriticalCase:
    """一个"改一个变量必须翻转 verdict"的场景。"""

    name: str
    variable: str
    after: Any
    world: Any
    action: Any
    base_truth: str = "attack"
    variant_truth: str = "safe"
    #: 该轴是否在 ``configs/default.json`` 的 ``critical_axes_whitelist`` 里。
    #: ``tenant`` 不在（白名单只有 ``actor.*.{roles,privileges,authentication_state,
    #: privilege_version}``）——它仍是决定 verdict 的状态变量，但 spec 声明它为
    #: critical 轴会被编译期 Gate 2 拒（``axis_not_in_whitelist``）。测试因此只在
    #: ``whitelisted=True`` 的用例上校验白名单。
    whitelisted: bool = True


def _read_action(**binds: Any) -> Any:
    document = {"operation": "read", "actor": "ACT-003", "flow_id": "FLOW-READ"}
    document.update(binds)
    return make_action("read", "ACT-003", **binds)


def critical_cases() -> tuple[CriticalCase, ...]:
    """九类决定 verdict 的状态变量（任务书逐类覆盖）。"""
    cases: list[CriticalCase] = []

    # 1. owner
    world = ownership_world(world_id="W-AX-OWNER")
    cases.append(
        CriticalCase(
            name="owner",
            variable="resource.RES-001.owner",
            after="ACT-003",
            world=world,
            action=_read_action(resource_id="RES-001"),
        )
    )

    # 2. role
    role_condition = {
        "op": "in",
        "args": [ref("action.actor.roles"), lit(["ROLE-SUPPORT"])],
    }
    world = make_world(
        world_id="W-AX-ROLE",
        policies=(allow_policy("POL-SUPPORT", role_condition),),
        invariants=(invariant("INV-AUTH-001", "authorization", role_condition),),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-003", roles=("ROLE-CUSTOMER",)),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"), role("ROLE-SUPPORT")),
    )
    cases.append(
        CriticalCase(
            name="role",
            variable="actor.ACT-003.roles",
            after=["ROLE-SUPPORT"],
            world=world,
            action=_read_action(resource_id="RES-001"),
        )
    )

    # 3. permission（actor.privileges 必须非空——L1 的 to_document 会丢空集合）
    permission_condition = {
        "op": "in",
        "args": [ref("action.actor.privileges"), lit(["order.read.any"])],
    }
    world = make_world(
        world_id="W-AX-PERM",
        policies=(allow_policy("POL-PRIV", permission_condition),),
        invariants=(invariant("INV-AUTH-002", "authorization", permission_condition),),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order.read.any",)),
            actor("ACT-003", roles=("ROLE-CUSTOMER",), privileges=("order.read.own",)),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="permission",
            variable="actor.ACT-003.privileges",
            after=["order.read.any"],
            world=world,
            action=_read_action(resource_id="RES-001"),
        )
    )

    # 4. workflow state
    workflow_condition = state_is("action.workflow_instance.current_state", "paid")
    world = make_world(
        world_id="W-AX-WFL",
        policies=(allow_policy("POL-REFUND", workflow_condition, operation="refund"),),
        invariants=(
            invariant("INV-WFL-001", "workflow_transition", workflow_condition, applies_to=("refund",)),
        ),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-003"),),
        workflows=(
            workflow(
                "WFL-ORDER",
                states=("created", "paid", "refunded"),
                initial_state="created",
                transitions_=(transition("created", "paid"), transition("paid", "refunded")),
                instances=(instance("WFI-001", resource_id="RES-001", current_state="created"),),
            ),
        ),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="workflow_state",
            variable="workflow_instance.WFI-001.current_state",
            after="paid",
            world=world,
            action=make_action("refund", "ACT-003", resource_id="RES-001",
                               workflow_instance_id="WFI-001", flow_id="FLOW-REFUND"),
        )
    )

    # 5. token lineage（token.flow_id 与 current_flow.flow_id 不一致）
    lineage_condition = eq(ref("action.token.flow_id"), ref("current_flow.flow_id"))
    world = make_world(
        world_id="W-AX-LINEAGE",
        policies=(allow_policy("POL-TOKEN", lineage_condition),),
        invariants=(invariant("INV-TOKEN-001", "token_lineage", lineage_condition),),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-003"),),
        tokens=(token("TOK-001", subject="ACT-003", flow_id="FLOW-OTHER"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="token_lineage",
            variable="token.TOK-001.flow_id",
            after="FLOW-READ",
            world=world,
            # current_flow.flow_id 取自 action.flow_id：base 时 FLOW-READ != FLOW-OTHER。
            action=make_action("read", "ACT-003", resource_id="RES-001", token_id="TOK-001", flow_id="FLOW-READ"),
        )
    )

    # 6. token used（one_time 令牌已用过）
    used_condition = eq(ref("action.token.used"), lit(False))
    world = make_world(
        world_id="W-AX-USED",
        policies=(allow_policy("POL-OT", used_condition),),
        invariants=(invariant("INV-OT-001", "one_time_token", used_condition),),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-003"),),
        tokens=(token("TOK-002", subject="ACT-003", one_time=True, used=True),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="token_used",
            variable="token.TOK-002.used",
            after=False,
            world=world,
            action=make_action("read", "ACT-003", resource_id="RES-001", token_id="TOK-002"),
        )
    )

    # 7. session revoked
    revoked_condition = eq(ref("action.session.revoked"), lit(False))
    world = make_world(
        world_id="W-AX-REVOKED",
        policies=(allow_policy("POL-SESS", revoked_condition),),
        invariants=(invariant("INV-SESS-001", "session_revocation", revoked_condition),),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-003"),),
        sessions=(session("SES-001", principal="ACT-003", revoked=True, valid=False),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="session_revoked",
            variable="session.SES-001.revoked",
            after=False,
            world=world,
            action=make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001"),
        )
    )

    # 8. privilege version（session 快照落后于 actor 现版本）
    privilege_condition = eq(
        ref("action.session.privilege_snapshot.privilege_version"),
        ref("action.actor.privilege_version"),
    )
    world = make_world(
        world_id="W-AX-PV",
        policies=(allow_policy("POL-PV", privilege_condition),),
        invariants=(invariant("INV-PV-001", "privilege_version", privilege_condition),),
        actors=(
            actor("ACT-003", roles=("ROLE-CUSTOMER",), privilege_version=2),
        ),
        resources=(resource("RES-001", owner="ACT-003"),),
        sessions=(session("SES-001", principal="ACT-003", privilege_version=0),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="privilege_version",
            variable="session.SES-001.privilege_snapshot.privilege_version",
            after=2,
            world=world,
            action=make_action("read", "ACT-003", resource_id="RES-001", session_id="SES-001"),
        )
    )

    # 9. tenant
    tenant_condition = eq(ref("action.actor.tenant"), ref("action.resource.tenant"))
    world = make_world(
        world_id="W-AX-TENANT",
        policies=(allow_policy("POL-TENANT", tenant_condition),),
        invariants=(invariant("INV-TENANT-001", "tenant_isolation", tenant_condition),),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-003", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    cases.append(
        CriticalCase(
            name="tenant",
            variable="actor.ACT-003.tenant",
            after="TEN-001",
            world=world,
            action=_read_action(resource_id="RES-001"),
            whitelisted=False,  # actor.*.tenant 不在 L0 白名单里（见 CriticalCase 注释）
        )
    )
    return tuple(cases)


# --------------------------------------------------------------------------- #
# spec / timeline 构造
# --------------------------------------------------------------------------- #


def spec_from_world(
    world: Any,
    *,
    critical_axes: tuple[tuple[str, Any, Any], ...] = (),
    irrelevant_axes: tuple[str, ...] = (),
    attack_family: str = "idor_bola",
) -> WorldSpec:
    """把世界文档升级成合法 WorldSpec（假设块是先验预期，R4）。

    ``critical_axes`` 的每个元素是 ``(variable, before, after)``——它们成为
    ``hypotheses.expected_counterfactual_axes``，即"先验声明、可证伪"的预期；
    ``before`` 与世界现值不符的轴会被 ``expand_family`` 记入 skipped 而不是悄悄改写。
    """
    document = copy.deepcopy(world.to_document())
    document.pop("world_family_id", None)
    document.pop("compile", None)
    document["attack_family"] = attack_family
    document["critical_state_variables"] = [axis[0] for axis in critical_axes]
    # schema 要求 irrelevant_state_variables 非空：缺省给一个 UA 轴（测试关心别的
    # 属性时不必每次显式列无关轴）。
    document["irrelevant_state_variables"] = list(
        irrelevant_axes or ("observation.request.headers.User-Agent",)
    )
    document["hypotheses"] = {
        "attack_opportunities": [
            {
                "opportunity_id": "OPP-001",
                "attack_family": attack_family,
                "target_operation": "read",
                "hypothesized_verdict": "attack",
                "rationale": "synthetic smoke hypothesis",
            }
        ],
        "expected_counterfactual_axes": [
            {
                "axis_id": f"AXIS-{index:03d}",
                "variable": variable,
                "kind": "critical",
                "before": before,
                "after": after,
                "expected_effect": "verdict_flip",
                "rationale": "synthetic prior expectation",
            }
            for index, (variable, before, after) in enumerate(critical_axes, start=1)
        ]
        + [
            {
                "axis_id": f"AXIS-IR-{index:03d}",
                "variable": axis,
                "kind": "irrelevant",
                "before": "before",
                "after": "after",
                "expected_effect": "verdict_invariant",
                "rationale": "surface-only axis",
            }
            for index, axis in enumerate(irrelevant_axes, start=1)
        ],
    }
    document["episode_templates"] = [
        {
            "template_id": "TPL-001",
            "decision_event_index": 1,
            "events": [
                {
                    "event_type": "login",
                    "actor_id": "ACT-003",
                    "t_offset_ms": 0,
                    "causal_tag": "relevant",
                    "summary": "Mallory logs in.",
                },
                {
                    "event_type": "request",
                    "actor_id": "ACT-003",
                    "t_offset_ms": 60000,
                    "causal_tag": "relevant",
                    "summary": "Mallory reads order 183.",
                    "binds": {"resource_id": "RES-001", "operation": "read", "flow_id": "FLOW-READ"},
                },
            ],
        }
    ]
    errors = validate_document(document, "world-spec")
    assert not errors, "spec_from_world 构造的 spec 未通过 schema:\n  - " + "\n  - ".join(errors)
    return WorldSpec.from_document(document)


def timeline_for(actor_id: str = "ACT-003", *, operation: str = "read") -> tuple[Event, ...]:
    """两事件时间线（login + decision request），决策事件在 index 1。"""
    events = [
        Event.from_document(
            {
                "event_id": "EVT-000",
                "t_index": 0,
                "at": "2026-09-19T08:00:00Z",
                "event_type": "login",
                "actor_id": actor_id,
                "summary": "principal logs in",
                "causal_tag": "relevant",
                "outcome": "success",
            }
        ),
        Event.from_document(
            {
                "event_id": "EVT-001",
                "t_index": 1,
                "at": NOW,
                "event_type": "request",
                "actor_id": actor_id,
                "summary": f"principal performs {operation}",
                "causal_tag": "relevant",
                "endpoint": {"method": "GET", "path": "/api/orders/183"},
                "outcome": "unknown",
            }
        ),
    ]
    return tuple(events)


__all__ = [
    "CriticalCase",
    "allow_policy",
    "critical_cases",
    "degraded_world",
    "eq",
    "ev",
    "invariant",
    "lit",
    "masking_world",
    "ownership_world",
    "ref",
    "spec_from_world",
    "state_is",
    "timeline_for",
]
