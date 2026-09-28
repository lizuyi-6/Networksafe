"""23 个人工测试世界（设计 §12.2 的 HC-001..HC-020 + 3 个掩蔽专用世界）。

覆盖矩阵（每个世界一个主测不变量 + 一个攻击族）::

    HC-001 e-commerce            ownership            idor_bola
    HC-002 e-commerce            workflow_transition  workflow_bypass
    HC-003 saas                  authorization        horizontal_privesc
    HC-004 iam_system            authorization        vertical_privesc
    HC-005 iam_system            session_revocation   revoked_session_reuse
    HC-006 hr_system             authentication_state session_after_account_disable
    HC-007 ticketing             token_lineage        cross_workflow_token_reuse
    HC-008 logistics             token_lineage        token_lineage_confusion
    HC-009 finance_workflow      one_time_token       one_time_token_reuse
    HC-010 cloud_storage         tenant_isolation     tenant_isolation_violation
    HC-011 code_hosting          privilege_version    stale_authorization
    HC-012 healthcare_workflow   session_revocation   session_after_password_reset
    HC-013 devops_platform       token_scope          scope_mismatch
    HC-014 api_marketplace       workflow_transition  invalid_state_transition
    HC-015 messaging             session_binding      cross_account_session_misuse
    HC-016 subscription_system   resource_state       repeated_operation
    HC-017 school_system         cross_tenant_isolation tenant_mismatch
    HC-018 crm                   privilege_version    privilege_version_mismatch
    HC-019 industrial_management temporal             stale_session_privilege
    HC-020 iot_management        token_lineage        cross_resource_token_reuse
    HC-021 api_marketplace       ownership            inconsistent_replicas（矛盾证据）
    HC-022 cloud_storage         ownership            stale_permission_cache（陈旧证据）
    HC-023 saas                  ownership            attacker_controlled（攻击者可控证据）

后三个世界**显式声明**退化证据，因此 base 的 ``world_truth`` 与
``observable_decision`` 刻意分歧——它们测的是"陈旧缓存说 owner=Alice、真值是 Bob"
这条 oracle 两趟设计的核心性质（设计 §8.2 最后一段）。

每个世界的最后一个 probe 是攻击动作（``hypotheses.attack_opportunities`` 引用它），
前面的是同一世界的合法动作。**预期是人写的常量**，不是跑 oracle 抄下来的。
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .handcrafted import (
    Expectation,
    ProbeAction,
    WorldDefinition,
    _decidable_pair,
)

# --------------------------------------------------------------------------- #
# 共用积木
# --------------------------------------------------------------------------- #


def _role(role_id: str, privileges: tuple[str, ...] = ()) -> dict[str, Any]:
    return {
        "role_id": role_id,
        "name": role_id.replace("ROLE-", "").replace("-", " ").title(),
        "privileges": list(privileges),
    }


def _actor(
    actor_id: str,
    *,
    roles: tuple[str, ...],
    tenant: str = "TEN-001",
    privileges: tuple[str, ...] = (),
    privilege_version: int = 0,
    authentication_state: str = "authenticated",
    actor_type: str = "user",
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "actor_id": actor_id,
        "actor_type": actor_type,
        "display_name": actor_id.replace("ACT-", "").title(),
        "identity": {
            "identity_id": actor_id.replace("ACT-", "ID-"),
            "email": f"{actor_id.lower()}@example.invalid",
            "verified": True,
        },
        "roles": list(roles),
        "tenant": tenant,
        "privileges": list(privileges),
        "authentication_state": authentication_state,
        "privilege_version": privilege_version,
    }
    return document


def _resource(
    resource_id: str,
    *,
    owner: str,
    resource_type: str,
    tenant: str = "TEN-001",
    state: str = "active",
    sensitivity: str = "confidential",
    attributes: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "resource_id": resource_id,
        "resource_type": resource_type,
        "display_name": f"{resource_type.title()} {resource_id}",
        "owner": owner,
        "tenant": tenant,
        "sensitivity": sensitivity,
        "state": state,
    }
    if attributes:
        document["attributes"] = dict(attributes)
    return document


def _session(
    session_id: str,
    *,
    principal: str,
    valid: bool = True,
    revoked: bool = False,
    expires_at: str = "2026-09-21T08:00:00Z",
    flow_id: str = "FLOW-READ",
    privilege_version: int = 0,
    revoked_at: str | None = None,
    revocation_reason: str | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "session_id": session_id,
        "principal": principal,
        "created_at": "2026-09-19T08:00:00Z",
        "authenticated_at": "2026-09-19T08:00:05Z",
        "auth_strength": "password_mfa",
        "valid": valid,
        "revoked": revoked,
        "expires_at": expires_at,
        "privilege_snapshot": {
            "roles": ["ROLE-CUSTOMER"],
            "privileges": ["order.read.own"],
            "privilege_version": privilege_version,
        },
        "flow_id": flow_id,
    }
    if revoked_at is not None:
        document["revoked_at"] = revoked_at
        document["revocation_reason"] = revocation_reason or "user_requested"
    return document


def _token(
    token_id: str,
    *,
    subject: str,
    flow_id: str = "FLOW-READ",
    scope: tuple[str, ...] = ("order.read.own",),
    one_time: bool = False,
    used: bool = False,
    parent_token: str | None = None,
    bound_resource: str | None = None,
    privilege_version: int = 0,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "token_id": token_id,
        "token_type": "one_time_code" if one_time else "access",
        "issuer": "auth.example.invalid",
        "subject": subject,
        "audience": ["api"],
        "scope": list(scope),
        "created_at": "2026-09-19T10:00:00Z",
        "expires_at": "2026-09-21T10:00:00Z",
        "one_time": one_time,
        "used": used,
        "parent_token": parent_token,
        "flow_id": flow_id,
        "privilege_version": privilege_version,
    }
    if bound_resource is not None:
        document["bound_resource"] = bound_resource
    return document


def _endpoint(path: str, method: str, operation: str, resource_type: str) -> dict[str, Any]:
    return {
        "path": path,
        "method": method,
        "operation": operation,
        "resource_type": resource_type,
        "auth_required": True,
    }


def _instance(instance_id: str, resource_id: str, current_state: str) -> dict[str, Any]:
    return {
        "instance_id": instance_id,
        "resource_id": resource_id,
        "current_state": current_state,
        "history": [
            {
                "from_state": "open",
                "to_state": current_state,
                "at": "2026-09-19T08:30:00Z",
                "actor_id": "ACT-001",
            }
        ],
    }


def _workflow(workflow_id: str, states: tuple[str, ...], instances: tuple[dict[str, Any], ...]) -> dict[str, Any]:
    transitions = [
        {"from_state": states[index], "to_state": states[index + 1]}
        for index in range(len(states) - 1)
    ]
    return {
        "workflow_id": workflow_id,
        "name": workflow_id.replace("WFL-", "").replace("-", " ").title(),
        "states": list(states),
        "initial_state": states[0],
        "transitions": transitions,
        "instances": [dict(item) for item in instances],
    }


def _eq(left: Mapping[str, Any], right: Mapping[str, Any]) -> dict[str, Any]:
    return {"op": "eq", "args": [dict(left), dict(right)]}


def _ref(path: str) -> dict[str, Any]:
    return {"op": "ref", "path": path}


def _lit(value: Any) -> dict[str, Any]:
    return {"op": "lit", "value": value}


def _service(service_id: str, service_type: str = "database") -> dict[str, Any]:
    return {
        "service_id": service_id,
        "service_type": service_type,
        "trust_boundary": "TB-CORE",
        "consistency_model": "strong",
    }


CUSTOMER_ROLE = _role("ROLE-CUSTOMER", ("order.read.own",))
SUPPORT_ROLE = _role("ROLE-SUPPORT", ("order.read.tenant",))
ADMIN_ROLE = _role("ROLE-ADMIN", ("iam.role.grant",))

#: 三个共用 actor：ACT-001 合法所有者、ACT-002 另一合法用户、ACT-003 攻击者（跨租户）。
VICTIM = _actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order.read.own",))
PEER = _actor("ACT-002", roles=("ROLE-CUSTOMER",), privileges=("order.read.own",))
ATTACKER = _actor("ACT-003", roles=("ROLE-CUSTOMER",), tenant="TEN-002", privileges=("order.read.own",))


def _probe(summary: str, expectation: Expectation, **binds: Any) -> ProbeAction:
    return ProbeAction(summary=summary, binds=dict(binds), expectation=expectation)


# --------------------------------------------------------------------------- #
# HC-001 .. HC-020
# --------------------------------------------------------------------------- #
def _hc001() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-ORDER-READ-OWNER",
        "INV-OWNERSHIP-001",
        "ownership",
        _eq(_ref("action.actor.actor_id"), _ref("action.resource.owner")),
        operation="read",
        resource_type="order",
        description="Reading an order requires the caller to be its owner.",
    )
    return WorldDefinition(
        number=1,
        domain="e-commerce",
        attack_family="idor_bola",
        title="Northwind Storefront API",
        description="A synthetic e-commerce order API. Customers read their own orders.",
        endpoints=(
            _endpoint("/api/orders/{order_id}", "GET", "read", "order"),
            _endpoint("/api/orders/{order_id}/refund", "POST", "refund", "order"),
        ),
        roles=(CUSTOMER_ROLE, SUPPORT_ROLE),
        actors=(VICTIM, ATTACKER),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="order"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        probes=(
            _probe(
                "Alice reads her own order 183.",
                Expectation("safe", "safe", "owner reads own resource"),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory (tenant TEN-002) reads Alice's order 183: owner mismatch.",
                Expectation("attack", "attack", "idor_bola: reader is not the owner"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-DB"),),
        notes="Reference-shaped IDOR world: one decisive ownership invariant, one flipping axis.",
    )


def _hc002() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-REFUND-PAID",
        "INV-WORKFLOW-001",
        "workflow_transition",
        {
            "op": "state_is",
            "args": [_ref("action.workflow_instance.current_state"), _lit("paid")],
        },
        operation="refund",
        resource_type="order",
        description="A refund requires the order workflow to be in 'paid'.",
    )
    return WorldDefinition(
        number=2,
        domain="e-commerce",
        attack_family="workflow_bypass",
        title="Northwind Refund Desk",
        description="A synthetic refund API gated on the order workflow state.",
        endpoints=(_endpoint("/api/orders/{order_id}/refund", "POST", "refund", "order"),),
        roles=(CUSTOMER_ROLE,),
        actors=(VICTIM, ATTACKER),
        resources=(
            _resource("RES-001", owner="ACT-003", resource_type="order"),
            _resource("RES-002", owner="ACT-001", resource_type="order"),
        ),
        policies=(policy,),
        invariants=(invariant,),
        workflows=(
            _workflow(
                "WFL-ORDER",
                ("created", "paid", "refunded"),
                (
                    _instance("WFI-001", "RES-001", "created"),
                    _instance("WFI-002", "RES-002", "paid"),
                ),
            ),
        ),
        critical_axes=(
            ("workflow_instance.WFI-001.current_state", "created", "paid"),
            ("workflow_instance.WFI-002.current_state", "paid", "created"),
        ),
        probes=(
            _probe(
                "Alice refunds her paid order.",
                Expectation("safe", "safe", "workflow state is paid"),
                operation="refund",
                actor="ACT-001",
                resource_id="RES-002",
                workflow_instance_id="WFI-002",
                flow_id="FLOW-REFUND",
            ),
            _probe(
                "Mallory refunds an order that is still 'created', skipping the payment step.",
                Expectation("attack", "attack", "workflow_bypass: invalid state transition"),
                operation="refund",
                actor="ACT-003",
                resource_id="RES-001",
                workflow_instance_id="WFI-001",
                flow_id="FLOW-REFUND",
            ),
        ),
        services=(_service("SVC-DB"),),
        notes="Workflow-gated refund: the attack is a state-machine bypass, not an ownership error.",
    )


def _hc003() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-DOC-READ-SUPPORT",
        "INV-AUTH-001",
        "authorization",
        {"op": "in", "args": [_ref("action.actor.roles"), _lit(["ROLE-SUPPORT"])]},
        operation="read",
        resource_type="file",
        description="Reading a shared document requires the support role.",
    )
    return WorldDefinition(
        number=3,
        domain="saas",
        attack_family="horizontal_privesc",
        title="Collab Docs API",
        description="A synthetic SaaS document API where only support agents may read shared docs.",
        endpoints=(_endpoint("/api/documents/{document_id}", "GET", "read", "document"),),
        roles=(CUSTOMER_ROLE, SUPPORT_ROLE),
        actors=(
            _actor("ACT-001", roles=("ROLE-SUPPORT",), privileges=("doc.read.any",)),
            ATTACKER,
        ),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="file"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(
            ("actor.ACT-003.roles", ["ROLE-CUSTOMER"], ["ROLE-SUPPORT"]),
            ("actor.ACT-001.roles", ["ROLE-SUPPORT"], ["ROLE-CUSTOMER"]),
        ),
        probes=(
            _probe(
                "Support agent Dana reads the shared document.",
                Expectation("safe", "safe", "actor holds ROLE-SUPPORT"),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Customer Mallory reads a shared document she has no role for.",
                Expectation("attack", "attack", "horizontal_privesc: missing role"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-DB"),),
        notes="Role-based authorization: the flipping axis is the actor's role set.",
    )


def _hc004() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-IAM-GRANT",
        "INV-AUTH-002",
        "authorization",
        {
            "op": "in",
            "args": [_ref("action.actor.privileges"), _lit(["iam.role.grant"])],
        },
        operation="grant_role",
        resource_type="secret",
        description="Granting a role requires the iam.role.grant privilege.",
    )
    return WorldDefinition(
        number=4,
        domain="iam_system",
        attack_family="vertical_privesc",
        title="IAM Role Grant API",
        description="A synthetic IAM API that grants roles to actors.",
        endpoints=(_endpoint("/api/iam/roles/{role_id}/grant", "POST", "grant_role", "role"),),
        roles=(CUSTOMER_ROLE, ADMIN_ROLE),
        actors=(
            _actor("ACT-001", roles=("ROLE-ADMIN",), privileges=("iam.role.grant",)),
            _actor("ACT-003", roles=("ROLE-CUSTOMER",), tenant="TEN-002", privileges=("profile.read",)),
        ),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="secret"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(
            ("actor.ACT-003.privileges", ["profile.read"], ["iam.role.grant"]),
            ("actor.ACT-001.privileges", ["iam.role.grant"], ["profile.read"]),
        ),
        probes=(
            _probe(
                "Admin Alice grants ROLE-SUPPORT.",
                Expectation("safe", "safe", "actor holds iam.role.grant"),
                operation="grant_role",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-GRANT",
            ),
            _probe(
                "Customer Mallory grants herself a role: vertical privilege escalation.",
                Expectation("attack", "attack", "vertical_privesc: missing privilege"),
                operation="grant_role",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-GRANT",
            ),
        ),
        services=(_service("SVC-IAM", "auth_provider"),),
        notes="Privilege-based authorization: the flipping axis is the actor's privilege list.",
    )


def _hc005() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-SESSION-NOT-REVOKED",
        "INV-SESSION-001",
        "session_revocation",
        _eq(_ref("action.session.revoked"), _lit(False)),
        operation="read",
        resource_type="order",
        description="No sensitive operation may ride a revoked session.",
    )
    return WorldDefinition(
        number=5,
        domain="iam_system",
        attack_family="revoked_session_reuse",
        title="Order Read Behind Session Auth",
        description="A synthetic API where every read must ride a live session.",
        endpoints=(_endpoint("/api/orders/{order_id}", "GET", "read", "order"),),
        roles=(CUSTOMER_ROLE,),
        actors=(VICTIM, ATTACKER),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="order"),),
        policies=(policy,),
        invariants=(invariant,),
        sessions=(
            _session("SES-001", principal="ACT-003"),
            _session(
                "SES-002",
                principal="ACT-003",
                valid=False,
                revoked=True,
                revoked_at="2026-09-19T09:30:00Z",
                revocation_reason="abuse_report",
            ),
        ),
        critical_axes=(
            ("session.SES-002.revoked", True, False),
            ("session.SES-001.revoked", False, True),
        ),
        probes=(
            _probe(
                "Mallory reads on her live session SES-001.",
                Expectation("safe", "safe", "session is not revoked"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reuses SES-002, revoked after an abuse report.",
                Expectation("attack", "attack", "revoked_session_reuse"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-002",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-AUTH", "auth_provider"),),
        notes="Session revocation: ownership is deliberately satisfied so only the session decides.",
    )


def _hc006() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-ACTOR-ENABLED",
        "INV-AUTHSTATE-001",
        "authentication_state",
        {"op": "ne", "args": [_ref("action.actor.authentication_state"), _lit("disabled")]},
        operation="read",
        resource_type="user_profile",
        description="A disabled account may not read employee records.",
    )
    return WorldDefinition(
        number=6,
        domain="hr_system",
        attack_family="session_after_account_disable",
        title="HR Employee Record API",
        description="A synthetic HR API serving employee records to enabled accounts.",
        endpoints=(
            _endpoint("/api/hr/employees/{employee_id}", "GET", "read", "employee_record"),
        ),
        roles=(_role("ROLE-EMPLOYEE", ("hr.read.own",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-EMPLOYEE",), privileges=("hr.read.own",)),
            _actor(
                "ACT-003",
                roles=("ROLE-EMPLOYEE",),
                tenant="TEN-002",
                privileges=("hr.read.own",),
                authentication_state="disabled",
                actor_type="attacker_controlled_account",
            ),
        ),
        resources=(
            _resource("RES-001", owner="ACT-001", resource_type="user_profile", sensitivity="restricted"),
        ),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(
            ("actor.ACT-003.authentication_state", "disabled", "authenticated"),
            ("actor.ACT-001.authentication_state", "authenticated", "disabled"),
        ),
        probes=(
            _probe(
                "Enabled employee Alice reads her own record.",
                Expectation("safe", "safe", "account is enabled"),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Disabled account Mallory still reads employee records.",
                Expectation("attack", "attack", "session_after_account_disable"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-HR", "database"),),
        notes="Authentication state gate: the actor's own state is the decisive variable.",
    )


def _hc007() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-TOKEN-FLOW",
        "INV-TOKEN-LINEAGE-001",
        "token_lineage",
        _eq(_ref("action.token.flow_id"), _ref("current_flow.flow_id")),
        operation="read",
        resource_type="ticket",
        description="A token may only be used inside the flow that issued it.",
    )
    return WorldDefinition(
        number=7,
        domain="ticketing",
        attack_family="cross_workflow_token_reuse",
        title="Ticket API With Flow-Scoped Tokens",
        description="A synthetic ticketing API whose tokens are scoped to one workflow.",
        endpoints=(_endpoint("/api/tickets/{ticket_id}", "GET", "read", "ticket"),),
        roles=(_role("ROLE-AGENT", ("ticket.read",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-AGENT",), privileges=("ticket.read",)),
            _actor("ACT-003", roles=("ROLE-AGENT",), tenant="TEN-002", privileges=("ticket.read",)),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="ticket"),),
        policies=(policy,),
        invariants=(invariant,),
        tokens=(
            _token("TOK-001", subject="ACT-003", flow_id="FLOW-PROFILE"),
            _token("TOK-002", subject="ACT-003", flow_id="FLOW-READ"),
        ),
        critical_axes=(
            ("token.TOK-001.flow_id", "FLOW-PROFILE", "FLOW-READ"),
            ("token.TOK-002.flow_id", "FLOW-READ", "FLOW-OTHER"),
        ),
        probes=(
            _probe(
                "Mallory reads a ticket with the token issued for the read flow.",
                Expectation("safe", "safe", "token flow matches the action flow"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-002",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reuses the profile-flow token TOK-001 on the read flow.",
                Expectation("attack", "attack", "cross_workflow_token_reuse"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-AUTH", "auth_provider"),),
        notes="Token lineage by flow: current_flow.flow_id comes from the action, not the token.",
    )


def _hc008() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-TOKEN-ROOT",
        "INV-TOKEN-LINEAGE-002",
        "token_lineage",
        {
            "op": "eq",
            "args": [
                {"op": "lineage_root", "args": [_ref("action.token.flow_id")]},
                _lit("FLOW-ROOT"),
            ],
        },
        operation="read",
        resource_type="database_record",
        description="A token must descend from the root flow FLOW-ROOT.",
    )
    return WorldDefinition(
        number=8,
        domain="logistics",
        attack_family="token_lineage_confusion",
        title="Shipment Tracking API",
        description="A synthetic logistics API whose tokens form a lineage tree per root flow.",
        endpoints=(_endpoint("/api/shipments/{shipment_id}", "GET", "read", "shipment"),),
        roles=(_role("ROLE-DISPATCH", ("shipment.read",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-DISPATCH",), privileges=("shipment.read",)),
            _actor(
                "ACT-003",
                roles=("ROLE-DISPATCH",),
                tenant="TEN-002",
                privileges=("shipment.read",),
            ),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="database_record"),),
        policies=(policy,),
        invariants=(invariant,),
        tokens=(
            _token("TOK-001", subject="ACT-003", flow_id="FLOW-ROOT"),
            _token("TOK-002", subject="ACT-003", flow_id="FLOW-LEAF", parent_token="TOK-001"),
            _token("TOK-003", subject="ACT-003", flow_id="FLOW-OTHER"),
            _token("TOK-004", subject="ACT-003", flow_id="FLOW-LEAF", parent_token="TOK-003"),
        ),
        critical_axes=(
            ("token.TOK-004.parent_token", "TOK-003", "TOK-001"),
            ("token.TOK-002.parent_token", "TOK-001", "TOK-003"),
        ),
        probes=(
            _probe(
                "Mallory reads a shipment with TOK-002, a child of the FLOW-ROOT token.",
                Expectation("safe", "safe", "lineage root is FLOW-ROOT"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-002",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads with TOK-004, which descends from the FLOW-OTHER root.",
                Expectation("attack", "attack", "token_lineage_confusion"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-004",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-AUTH", "auth_provider"),),
        notes="lineage_root resolves the root ancestor's flow_id; the flipping axis re-parents the token.",
    )


def _hc009() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-OT-UNUSED",
        "INV-ONE-TIME-001",
        "one_time_token",
        {
            "op": "or",
            "args": [
                _eq(_ref("action.token.one_time"), _lit(False)),
                _eq(_ref("action.token.used"), _lit(False)),
            ],
        },
        operation="refund",
        resource_type="invoice",
        description="A one-time token must not have been used before.",
    )
    workflow_invariant = {
        "invariant_id": "INV-WORKFLOW-002",
        "category": "workflow_transition",
        "applies_to": ["refund"],
        "severity": "high",
        "description": "A payout refund requires the payout workflow to be 'approved'.",
        "expr": {
            "op": "state_is",
            "args": [_ref("action.workflow_instance.current_state"), _lit("approved")],
        },
    }
    return WorldDefinition(
        number=9,
        domain="finance_workflow",
        attack_family="one_time_token_reuse",
        title="Payout Refund API",
        description="A synthetic finance API where refunds ride a one-time token.",
        endpoints=(_endpoint("/api/payouts/{payout_id}/refund", "POST", "refund", "payout"),),
        roles=(_role("ROLE-FINANCE", ("payout.refund",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-FINANCE",), privileges=("payout.refund",)),
            _actor(
                "ACT-003",
                roles=("ROLE-FINANCE",),
                tenant="TEN-002",
                privileges=("payout.refund",),
            ),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="invoice"),),
        policies=(policy,),
        invariants=(invariant, workflow_invariant),
        tokens=(
            _token("TOK-001", subject="ACT-003", flow_id="FLOW-REFUND", one_time=True, used=True),
            _token("TOK-002", subject="ACT-003", flow_id="FLOW-REFUND", one_time=True, used=False),
        ),
        workflows=(
            _workflow(
                "WFL-PAYOUT",
                ("requested", "approved", "refunded"),
                (_instance("WFI-001", "RES-001", "approved"),),
            ),
        ),
        critical_axes=(
            ("token.TOK-001.used", True, False),
            ("token.TOK-002.used", False, True),
        ),
        probes=(
            _probe(
                "Mallory refunds with the fresh one-time token TOK-002.",
                Expectation("safe", "safe", "one-time token is unused and workflow approved"),
                operation="refund",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-002",
                workflow_instance_id="WFI-001",
                flow_id="FLOW-REFUND",
            ),
            _probe(
                "Mallory replays the already-used one-time token TOK-001.",
                Expectation("attack", "attack", "one_time_token_reuse"),
                operation="refund",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-001",
                workflow_instance_id="WFI-001",
                flow_id="FLOW-REFUND",
            ),
        ),
        services=(_service("SVC-PAYMENTS", "payment_gateway"),),
        notes="Two invariants, only one violated: the workflow invariant stays satisfied so the flip is unambiguous.",
    )


def _hc010() -> WorldDefinition:
    """租户隔离：``actor.*.tenant`` 不在 L0 白名单，改用跨租户读取特权。

    决定 verdict 的状态变量是"攻击者手里有没有跨租户读取特权"——这是白名单里的
    ``actor.*.privileges``，且探针的取值域足够宽（3 个候选）。
    """
    policy, invariant = _decidable_pair(
        "POL-TENANT-MATCH",
        "INV-TENANT-001",
        "tenant_isolation",
        {
            "op": "in",
            "args": [
                _ref("action.actor.privileges"),
                _lit(["blob.read.cross_tenant"]),
            ],
        },
        operation="read",
        resource_type="file",
        description="Reading another tenant's blob requires the cross-tenant read privilege.",
    )
    return WorldDefinition(
        number=10,
        domain="cloud_storage",
        attack_family="tenant_isolation_violation",
        title="Object Store Read API",
        description="A synthetic object store where every blob belongs to one tenant and cross-tenant reads need an explicit privilege.",
        endpoints=(_endpoint("/api/blobs/{blob_id}", "GET", "read", "blob"),),
        roles=(_role("ROLE-TENANT-USER", ("blob.read",)),),
        actors=(
            _actor(
                "ACT-001",
                roles=("ROLE-TENANT-USER",),
                privileges=("blob.read", "blob.read.cross_tenant"),
            ),
            _actor(
                "ACT-003",
                roles=("ROLE-TENANT-USER",),
                tenant="TEN-002",
                privileges=("blob.read",),
            ),
        ),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="file"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(
            ("actor.ACT-003.privileges", ["blob.read"], ["blob.read.cross_tenant"]),
            (
                "actor.ACT-001.privileges",
                ["blob.read", "blob.read.cross_tenant"],
                ["blob.read"],
            ),
        ),
        probes=(
            _probe(
                "Alice reads a blob in her own tenant.",
                Expectation("safe", "safe", "same-tenant read needs no extra privilege"),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads a TEN-001 blob without the cross-tenant privilege.",
                Expectation("attack", "attack", "tenant_isolation_violation"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-OBJECTSTORE", "object_store"),),
        notes=(
            "Tenant isolation via a cross-tenant privilege: actor.*.tenant is NOT in the L0 "
            "critical_axes_whitelist, so the decisive variable is the privilege that gates "
            "the cross-tenant read."
        ),
    )


def _hc011() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-PRIVILEGE-VERSION",
        "INV-PRIVILEGE-VERSION-001",
        "privilege_version",
        _eq(
            _ref("action.session.privilege_snapshot.privilege_version"),
            _ref("action.actor.privilege_version"),
        ),
        operation="read",
        resource_type="file",
        description="A session's privilege snapshot must match the actor's live privilege version.",
    )
    return WorldDefinition(
        number=11,
        domain="code_hosting",
        attack_family="stale_authorization",
        title="Repository Read API",
        description="A synthetic code host where a session carries a privilege snapshot.",
        endpoints=(_endpoint("/api/repos/{repo_id}", "GET", "read", "repository"),),
        roles=(_role("ROLE-DEVELOPER", ("repo.read",)),),
        actors=(
            _actor("ACT-003", roles=("ROLE-DEVELOPER",), privileges=("repo.read",), privilege_version=2),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="file"),),
        policies=(policy,),
        invariants=(invariant,),
        sessions=(
            _session("SES-001", principal="ACT-003", privilege_version=0),
            _session("SES-002", principal="ACT-003", privilege_version=2),
        ),
        critical_axes=(
            ("session.SES-001.privilege_snapshot.privilege_version", 0, 2),
            ("session.SES-002.privilege_snapshot.privilege_version", 2, 0),
        ),
        probes=(
            _probe(
                "Mallory reads with the fresh session SES-002 (snapshot version 2).",
                Expectation("safe", "safe", "snapshot matches the live privilege version"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-002",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads with the stale session SES-001 (snapshot version 0).",
                Expectation("attack", "attack", "stale_authorization: privilege version mismatch"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-CODE", "database"),),
        notes="Privilege version: the session snapshot lags the actor's live version.",
    )


def _hc012() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-SESSION-LIVE",
        "INV-SESSION-002",
        "session_revocation",
        _eq(_ref("action.session.revoked"), _lit(False)),
        operation="read",
        resource_type="database_record",
        description="A revoked session may not read clinical notes.",
    )
    workflow_invariant = {
        "invariant_id": "INV-WORKFLOW-003",
        "category": "workflow_transition",
        "applies_to": ["read"],
        "severity": "high",
        "description": "Reading a clinical note requires the encounter workflow to be 'open'.",
        "expr": {
            "op": "state_is",
            "args": [_ref("action.workflow_instance.current_state"), _lit("open")],
        },
    }
    return WorldDefinition(
        number=12,
        domain="healthcare_workflow",
        attack_family="session_after_password_reset",
        title="Clinical Note API",
        description="A synthetic clinical API gated on both a live session and the encounter state.",
        endpoints=(
            _endpoint("/api/encounters/{encounter_id}/notes", "GET", "read", "clinical_note"),
        ),
        roles=(_role("ROLE-CLINICIAN", ("note.read",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-CLINICIAN",), privileges=("note.read",)),
            _actor(
                "ACT-003",
                roles=("ROLE-CLINICIAN",),
                tenant="TEN-002",
                privileges=("note.read",),
            ),
        ),
        resources=(
            _resource("RES-001", owner="ACT-001", resource_type="database_record", sensitivity="restricted"),
        ),
        policies=(policy,),
        invariants=(invariant, workflow_invariant),
        sessions=(
            _session("SES-001", principal="ACT-003"),
            _session(
                "SES-002",
                principal="ACT-003",
                valid=False,
                revoked=True,
                revoked_at="2026-09-19T09:00:00Z",
                revocation_reason="password_reset",
            ),
        ),
        workflows=(
            _workflow(
                "WFL-ENCOUNTER",
                ("open", "closed"),
                (_instance("WFI-001", "RES-001", "open"),),
            ),
        ),
        critical_axes=(
            ("session.SES-002.revoked", True, False),
            ("session.SES-001.revoked", False, True),
        ),
        probes=(
            _probe(
                "Mallory reads with her live session SES-001 on an open encounter.",
                Expectation("safe", "safe", "session live and encounter open"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-001",
                workflow_instance_id="WFI-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads with SES-002, revoked when the password was reset.",
                Expectation("attack", "attack", "session_after_password_reset"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-002",
                workflow_instance_id="WFI-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-EHR", "database"),),
        notes="Two invariants: the workflow one stays satisfied, so the session is the only deciding variable.",
    )


def _hc013() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-TOKEN-SCOPE",
        "INV-TOKEN-SCOPE-001",
        "token_scope",
        {
            "op": "intersects",
            "args": [_ref("action.token.scope"), _lit(["deploy.write"])],
        },
        operation="deploy",
        resource_type="cloud_resource",
        description="Deploying requires a token whose scope intersects deploy.write.",
    )
    return WorldDefinition(
        number=13,
        domain="devops_platform",
        attack_family="scope_mismatch",
        title="Pipeline Deploy API",
        description="A synthetic CI/CD API where deploys require a deploy.write-scoped token.",
        endpoints=(_endpoint("/api/pipelines/{pipeline_id}/deploy", "POST", "deploy", "pipeline"),),
        roles=(_role("ROLE-OPERATOR", ("pipeline.deploy",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-OPERATOR",), privileges=("pipeline.deploy",)),
            _actor(
                "ACT-003",
                roles=("ROLE-OPERATOR",),
                tenant="TEN-002",
                privileges=("pipeline.deploy",),
            ),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="cloud_resource"),),
        policies=(policy,),
        invariants=(invariant,),
        tokens=(
            _token("TOK-001", subject="ACT-003", flow_id="FLOW-DEPLOY", scope=("deploy.read",)),
            _token("TOK-002", subject="ACT-003", flow_id="FLOW-DEPLOY", scope=("deploy.write",)),
        ),
        critical_axes=(
            ("token.TOK-001.scope", ["deploy.read"], ["deploy.write"]),
            ("token.TOK-002.scope", ["deploy.write"], ["deploy.read"]),
        ),
        probes=(
            _probe(
                "Mallory deploys with the write-scoped token TOK-002.",
                Expectation("safe", "safe", "token scope covers deploy.write"),
                operation="deploy",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-002",
                flow_id="FLOW-DEPLOY",
            ),
            _probe(
                "Mallory deploys with the read-scoped token TOK-001.",
                Expectation("attack", "attack", "scope_mismatch"),
                operation="deploy",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-001",
                flow_id="FLOW-DEPLOY",
            ),
        ),
        services=(_service("SVC-CI", "queue"),),
        notes="Token scope: the flipping axis widens the token's scope.",
    )


def _hc014() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-PUBLISH-PUBLISHED",
        "INV-WORKFLOW-004",
        "workflow_transition",
        {
            "op": "state_is",
            "args": [_ref("action.workflow_instance.current_state"), _lit("reviewed")],
        },
        operation="publish",
        resource_type="cloud_resource",
        description="Publishing requires the product workflow to be 'reviewed'.",
    )
    return WorldDefinition(
        number=14,
        domain="api_marketplace",
        attack_family="invalid_state_transition",
        title="Marketplace Publish API",
        description="A synthetic API marketplace where publishing is a reviewed transition.",
        endpoints=(
            _endpoint("/api/products/{product_id}/publish", "POST", "publish", "api_product"),
        ),
        roles=(_role("ROLE-PUBLISHER", ("product.publish",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-PUBLISHER",), privileges=("product.publish",)),
            _actor(
                "ACT-003",
                roles=("ROLE-PUBLISHER",),
                tenant="TEN-002",
                privileges=("product.publish",),
            ),
        ),
        resources=(
            _resource("RES-001", owner="ACT-003", resource_type="cloud_resource"),
            _resource("RES-002", owner="ACT-001", resource_type="cloud_resource"),
        ),
        policies=(policy,),
        invariants=(invariant,),
        workflows=(
            _workflow(
                "WFL-PRODUCT",
                ("draft", "reviewed", "published"),
                (
                    _instance("WFI-001", "RES-001", "draft"),
                    _instance("WFI-002", "RES-002", "reviewed"),
                ),
            ),
        ),
        critical_axes=(
            ("workflow_instance.WFI-001.current_state", "draft", "reviewed"),
            ("workflow_instance.WFI-002.current_state", "reviewed", "draft"),
        ),
        probes=(
            _probe(
                "Alice publishes her reviewed product.",
                Expectation("safe", "safe", "workflow state is reviewed"),
                operation="publish",
                actor="ACT-001",
                resource_id="RES-002",
                workflow_instance_id="WFI-002",
                flow_id="FLOW-PUBLISH",
            ),
            _probe(
                "Mallory publishes a product straight out of draft.",
                Expectation("attack", "attack", "invalid_state_transition"),
                operation="publish",
                actor="ACT-003",
                resource_id="RES-001",
                workflow_instance_id="WFI-001",
                flow_id="FLOW-PUBLISH",
            ),
        ),
        services=(_service("SVC-MARKET", "database"),),
        notes="State-machine gate: the attack skips the review transition.",
    )


def _hc015() -> WorldDefinition:
    """跨账号 session 误用：可白名单化的关键轴是 session 的 privilege_version。

    ``session.*.principal`` 不在 L0 的 ``critical_axes_whitelist`` 里（改主体不是
    "改一个决定 verdict 的状态变量"的常规形态），因此这个世界用**会话特权版本**
    表达同一类攻击：Mallory 拿着 Alice 的会话，而会话快照还停在 Alice 提权前的版本。
    """
    policy, invariant = _decidable_pair(
        "POL-SESSION-PRIVILEGE",
        "INV-SESSION-BINDING-001",
        "session_binding",
        {
            "op": "and",
            "args": [
                _eq(_ref("action.session.principal"), _ref("action.actor.actor_id")),
                _eq(
                    _ref("action.session.privilege_snapshot.privilege_version"),
                    _ref("action.actor.privilege_version"),
                ),
            ],
        },
        operation="read",
        resource_type="message",
        description="A session may only be ridden by its own principal, with a current privilege snapshot.",
    )
    return WorldDefinition(
        number=15,
        domain="messaging",
        attack_family="cross_account_session_misuse",
        title="Message Read API",
        description="A synthetic messaging API where a session is bound to one principal and carries that principal's privilege snapshot.",
        endpoints=(_endpoint("/api/messages/{message_id}", "GET", "read", "message"),),
        roles=(_role("ROLE-USER", ("message.read.own",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-USER",), privileges=("message.read.own",), privilege_version=2),
            _actor(
                "ACT-003",
                roles=("ROLE-USER",),
                tenant="TEN-002",
                privileges=("message.read.own",),
                privilege_version=2,
            ),
        ),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="message"),),
        policies=(policy,),
        invariants=(invariant,),
        sessions=(
            _session("SES-001", principal="ACT-003", privilege_version=2),
            _session("SES-002", principal="ACT-003", privilege_version=0),
        ),
        critical_axes=(
            ("session.SES-002.privilege_snapshot.privilege_version", 0, 2),
            ("session.SES-001.privilege_snapshot.privilege_version", 2, 0),
        ),
        probes=(
            _probe(
                "Mallory reads on her own session SES-001 with a current privilege snapshot.",
                Expectation("safe", "safe", "session principal is the actor and the snapshot is current"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory rides the stale session SES-002, whose privilege snapshot predates her elevation.",
                Expectation("attack", "attack", "cross_account_session_misuse: stale session privilege"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-002",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-MSG", "queue"),),
        notes=(
            "Session binding: the invariant checks BOTH the principal and the privilege "
            "snapshot, so the whitelisted session privilege_version is the decisive axis."
        ),
    )


def _hc016() -> WorldDefinition:
    """重复操作：``resource.*.state`` 不在 L0 白名单里，改用一次性取消令牌。"""
    policy, invariant = _decidable_pair(
        "POL-CANCEL-ONE-TIME",
        "INV-ONE-TIME-002",
        "one_time_token",
        {
            "op": "or",
            "args": [
                _eq(_ref("action.token.one_time"), _lit(False)),
                _eq(_ref("action.token.used"), _lit(False)),
            ],
        },
        operation="cancel",
        resource_type="invoice",
        description="Cancelling a subscription requires an unused one-time cancellation token.",
    )
    return WorldDefinition(
        number=16,
        domain="subscription_system",
        attack_family="repeated_operation",
        title="Subscription Cancel API",
        description="A synthetic subscription API where cancelling is a one-way transition guarded by a one-time token.",
        endpoints=(
            _endpoint("/api/subscriptions/{subscription_id}/cancel", "POST", "cancel", "subscription"),
        ),
        roles=(_role("ROLE-SUBSCRIBER", ("subscription.cancel",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-SUBSCRIBER",), privileges=("subscription.cancel",)),
            _actor(
                "ACT-003",
                roles=("ROLE-SUBSCRIBER",),
                tenant="TEN-002",
                privileges=("subscription.cancel",),
            ),
        ),
        resources=(
            _resource("RES-001", owner="ACT-003", resource_type="invoice", state="cancelled"),
            _resource("RES-002", owner="ACT-001", resource_type="invoice", state="active"),
        ),
        policies=(policy,),
        invariants=(invariant,),
        tokens=(
            _token(
                "TOK-001",
                subject="ACT-003",
                flow_id="FLOW-CANCEL",
                scope=("subscription.cancel",),
                one_time=True,
                used=True,
            ),
            _token(
                "TOK-002",
                subject="ACT-003",
                flow_id="FLOW-CANCEL",
                scope=("subscription.cancel",),
                one_time=True,
                used=False,
            ),
        ),
        critical_axes=(
            ("token.TOK-001.used", True, False),
            ("token.TOK-002.used", False, True),
        ),
        probes=(
            _probe(
                "Alice cancels her subscription with a fresh one-time token.",
                Expectation("safe", "safe", "cancellation token is unused"),
                operation="cancel",
                actor="ACT-001",
                resource_id="RES-002",
                token_id="TOK-002",
                flow_id="FLOW-CANCEL",
            ),
            _probe(
                "Mallory cancels a subscription again with the token she already spent.",
                Expectation("attack", "attack", "repeated_operation: one-time token replay"),
                operation="cancel",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-001",
                flow_id="FLOW-CANCEL",
            ),
        ),
        services=(_service("SVC-BILLING", "payment_gateway"),),
        notes=(
            "Repeated irreversible operation: resource.*.state is not in the L0 "
            "critical_axes_whitelist, so the decisive variable is the one-time token."
        ),
    )


def _hc017() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-ASSIGNMENT-TENANT",
        "INV-CROSS-TENANT-001",
        "cross_tenant_isolation",
        {
            "op": "in",
            "args": [
                _ref("action.actor.privileges"),
                _lit(["assignment.submit.tenant001"]),
            ],
        },
        operation="submit",
        resource_type="database_record",
        description="Submitting to a tenant's assignment requires that tenant's submit privilege.",
    )
    filler = {
        "invariant_id": "INV-FILLER-OUT-OF-SCOPE",
        "category": "ownership",
        "applies_to": ["grade"],
        "severity": "low",
        "description": "Out-of-scope filler: never counted in satisfied or violated.",
        "expr": _eq(_ref("action.actor.actor_id"), _ref("action.actor.actor_id")),
    }
    return WorldDefinition(
        number=17,
        domain="school_system",
        attack_family="tenant_mismatch",
        title="Assignment Submission API",
        description="A synthetic school API where submissions are tenant-scoped.",
        endpoints=(
            _endpoint("/api/assignments/{assignment_id}/submit", "POST", "submit", "assignment"),
            _endpoint("/api/assignments/{assignment_id}/grade", "POST", "grade", "assignment"),
        ),
        roles=(
            _role("ROLE-STUDENT", ("assignment.submit.tenant001",)),
            _role("ROLE-TEACHER", ("assignment.grade",)),
        ),
        actors=(
            _actor(
                "ACT-001",
                roles=("ROLE-STUDENT",),
                privileges=("assignment.submit.tenant001",),
            ),
            _actor(
                "ACT-002",
                roles=("ROLE-STUDENT",),
                privileges=("assignment.submit.tenant001",),
            ),
            _actor(
                "ACT-003",
                roles=("ROLE-STUDENT",),
                tenant="TEN-002",
                privileges=("assignment.submit.tenant002",),
            ),
            _actor("ACT-004", roles=("ROLE-TEACHER",), privileges=("assignment.grade",)),
        ),
        resources=(
            _resource("RES-001", owner="ACT-001", resource_type="database_record"),
            _resource("RES-002", owner="ACT-002", resource_type="database_record"),
            _resource("RES-003", owner="ACT-004", resource_type="database_record"),
        ),
        policies=(policy,),
        invariants=(invariant, filler),
        critical_axes=(
            (
                "actor.ACT-003.privileges",
                ["assignment.submit.tenant002"],
                ["assignment.submit.tenant001"],
            ),
            (
                "actor.ACT-001.privileges",
                ["assignment.submit.tenant001"],
                ["assignment.submit.tenant002"],
            ),
        ),
        probes=(
            _probe(
                "Alice submits to her own tenant's assignment.",
                Expectation("safe", "safe", "tenant matches"),
                operation="submit",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-SUBMIT",
            ),
            _probe(
                "Mallory (tenant TEN-002) submits to a TEN-001 assignment.",
                Expectation("attack", "attack", "tenant_mismatch"),
                operation="submit",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-SUBMIT",
            ),
        ),
        services=(_service("SVC-SCHOOL", "database"),),
        notes=(
            "Carries one deliberately out-of-scope invariant: it must land in skipped, never "
            "satisfied. Tenant crossing is expressed as a tenant-scoped privilege because "
            "actor.*.tenant is not in the L0 critical_axes_whitelist."
        ),
    )


def _hc018() -> WorldDefinition:
    policy, invariant = _decidable_pair(
        "POL-CRM-PRIVILEGE-VERSION",
        "INV-PRIVILEGE-VERSION-002",
        "privilege_version",
        _eq(
            _ref("action.session.privilege_snapshot.privilege_version"),
            _ref("action.actor.privilege_version"),
        ),
        operation="update",
        resource_type="user_profile",
        description="Updating a contact requires the session snapshot to match the live privilege version.",
    )
    return WorldDefinition(
        number=18,
        domain="crm",
        attack_family="privilege_version_mismatch",
        title="CRM Contact Update API",
        description="A synthetic CRM API where sessions carry a privilege snapshot.",
        endpoints=(_endpoint("/api/contacts/{contact_id}", "PUT", "update", "contact"),),
        roles=(_role("ROLE-SALES", ("contact.update",)),),
        actors=(
            _actor("ACT-003", roles=("ROLE-SALES",), privileges=("contact.update",), privilege_version=3),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="user_profile"),),
        policies=(policy,),
        invariants=(invariant,),
        sessions=(
            _session("SES-001", principal="ACT-003", privilege_version=1),
            _session("SES-002", principal="ACT-003", privilege_version=3),
        ),
        critical_axes=(
            ("session.SES-001.privilege_snapshot.privilege_version", 1, 3),
            ("session.SES-002.privilege_snapshot.privilege_version", 3, 1),
        ),
        probes=(
            _probe(
                "Mallory updates with the fresh session SES-002 (snapshot version 3).",
                Expectation("safe", "safe", "snapshot matches the live privilege version"),
                operation="update",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-002",
                flow_id="FLOW-UPDATE",
            ),
            _probe(
                "Mallory updates with the stale session SES-001 (snapshot version 1).",
                Expectation("attack", "attack", "privilege_version_mismatch"),
                operation="update",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-001",
                flow_id="FLOW-UPDATE",
            ),
        ),
        services=(_service("SVC-CRM", "database"),),
        notes="Same invariant category as HC-011 but a different operation/resource type, so the structural dedup layer keeps them apart.",
    )


def _hc019() -> WorldDefinition:
    """会话特权陈旧：决定 verdict 的是权限缓存里的版本号。

    ``session.*.expires_at`` 不在 L0 白名单，因此这个世界用**权限缓存**表达同一类
    攻击：会话快照停在旧版本，而缓存里已经是新版本——``cache.*.cached_value`` 在
    白名单里，且为它准备两条缓存项让探针的取值域有两个候选。
    """
    policy, invariant = _decidable_pair(
        "POL-SESSION-PV-CACHE",
        "INV-STATE-FRESHNESS-001",
        "state_freshness",
        _eq(
            _ref("action.session.privilege_snapshot.privilege_version"),
            _ref("cache.CACHE-PV-001.cached_value"),
        ),
        operation="read",
        resource_type="database_record",
        description="A session's privilege snapshot must match the version in the permission cache.",
    )
    return WorldDefinition(
        number=19,
        domain="industrial_management",
        attack_family="stale_session_privilege",
        title="Sensor Reading API",
        description="A synthetic industrial API whose session privilege snapshot is checked against a permission cache.",
        endpoints=(
            _endpoint("/api/sensors/{sensor_id}/readings", "GET", "read", "sensor_reading"),
        ),
        roles=(_role("ROLE-OPERATOR", ("sensor.read",)),),
        actors=(
            _actor(
                "ACT-001",
                roles=("ROLE-OPERATOR",),
                privileges=("sensor.read",),
                privilege_version=0,
            ),
            _actor(
                "ACT-003",
                roles=("ROLE-OPERATOR",),
                tenant="TEN-002",
                privileges=("sensor.read",),
                privilege_version=2,
            ),
        ),
        resources=(_resource("RES-001", owner="ACT-003", resource_type="database_record"),),
        policies=(policy,),
        invariants=(invariant,),
        sessions=(
            _session("SES-001", principal="ACT-003", privilege_version=0),
            _session("SES-002", principal="ACT-003", privilege_version=2),
        ),
        caches=(
            {
                "cache_id": "CACHE-PV-001",
                "cached_subject": "actor.ACT-003.privilege_version",
                "cached_value": 2,
                "source_of_truth": "SVC-IAM",
                "fresh": True,
                "ttl_seconds": 60,
                "populated_at": "2026-09-20T07:55:00Z",
            },
            {
                "cache_id": "CACHE-PV-002",
                "cached_subject": "actor.ACT-001.privilege_version",
                "cached_value": 0,
                "source_of_truth": "SVC-IAM",
                "fresh": True,
                "ttl_seconds": 60,
                "populated_at": "2026-09-20T07:55:00Z",
            },
        ),
        critical_axes=(
            ("cache.CACHE-PV-001.cached_value", 2, 0),
            ("session.SES-002.privilege_snapshot.privilege_version", 2, 0),
        ),
        probes=(
            _probe(
                "Mallory reads with SES-002, whose snapshot matches the permission cache.",
                Expectation("safe", "safe", "session snapshot matches the cached privilege version"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-002",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads with SES-001, whose snapshot predates the cached privilege version.",
                Expectation("attack", "attack", "stale_session_privilege: snapshot lags the cache"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                session_id="SES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-IAM", "auth_provider"),),
        notes=(
            "State freshness through a permission cache: session.*.expires_at is not in the L0 "
            "critical_axes_whitelist, so the decisive variable is the cached privilege version "
            "the authorization decision reads."
        ),
    )


def _hc020() -> WorldDefinition:
    """跨资源令牌误用：``token.*.bound_resource`` 不在 L0 白名单，改用血缘深度。

    设备令牌必须是"根签发"的（深度 0）；攻击者拿着一张派生了两次的令牌去读别的
    设备，``token.*.parent_token`` 在白名单里，且 `lineage_depth` 正是引擎的血缘 op。
    """
    policy, invariant = _decidable_pair(
        "POL-TOKEN-LINEAGE-DEPTH",
        "INV-TOKEN-LINEAGE-003",
        "token_lineage",
        {
            "op": "le",
            "args": [
                {"op": "lineage_depth", "args": [_ref("action.token.flow_id")]},
                _lit(1),
            ],
        },
        operation="read",
        resource_type="cloud_resource",
        description="A device token may sit at most one level below its lineage root.",
    )
    return WorldDefinition(
        number=20,
        domain="iot_management",
        attack_family="cross_resource_token_reuse",
        title="Device Read API",
        description="A synthetic IoT API whose device tokens form a two-level lineage tree.",
        endpoints=(_endpoint("/api/devices/{device_id}", "GET", "read", "device"),),
        roles=(_role("ROLE-IOT-USER", ("device.read",)),),
        actors=(
            _actor("ACT-001", roles=("ROLE-IOT-USER",), privileges=("device.read",)),
            _actor(
                "ACT-003",
                roles=("ROLE-IOT-USER",),
                tenant="TEN-002",
                privileges=("device.read",),
            ),
        ),
        resources=(
            _resource("RES-001", owner="ACT-003", resource_type="cloud_resource"),
            _resource("RES-002", owner="ACT-003", resource_type="cloud_resource"),
        ),
        policies=(policy,),
        invariants=(invariant,),
        tokens=(
            _token("TOK-001", subject="ACT-003", flow_id="FLOW-IOT-ROOT"),
            _token("TOK-002", subject="ACT-003", flow_id="FLOW-IOT-LEAF", parent_token="TOK-001"),
            _token("TOK-003", subject="ACT-003", flow_id="FLOW-IOT-LEAF", parent_token="TOK-002"),
            _token("TOK-004", subject="ACT-003", flow_id="FLOW-IOT-LEAF", parent_token="TOK-001"),
        ),
        critical_axes=(
            ("token.TOK-003.parent_token", "TOK-002", None),
            ("token.TOK-002.parent_token", "TOK-001", "TOK-004"),
        ),
        probes=(
            _probe(
                "Mallory reads RES-002 with TOK-002, one level below the root.",
                Expectation("safe", "safe", "token lineage depth is 1"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-002",
                token_id="TOK-002",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads RES-001 with TOK-003, a twice-derived token.",
                Expectation("attack", "attack", "cross_resource_token_reuse: lineage too deep"),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                token_id="TOK-003",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-IOT", "object_store"),),
        notes=(
            "Token lineage by depth: token.*.bound_resource is not in the L0 "
            "critical_axes_whitelist, so the decisive axis re-parents the deep token to the root."
        ),
    )


# --------------------------------------------------------------------------- #
# HC-021 .. HC-023：显式声明退化证据的世界
# --------------------------------------------------------------------------- #
def _hc021() -> WorldDefinition:
    """矛盾证据：base 的 observable_decision 就是 insufficient_evidence。"""
    policy, invariant = _decidable_pair(
        "POL-ORDER-READ-OWNER-2",
        "INV-OWNERSHIP-002",
        "ownership",
        _eq(_ref("action.actor.actor_id"), _ref("action.resource.owner")),
        operation="read",
        resource_type="order",
        description="Reading an order requires the caller to be its owner.",
    )
    return WorldDefinition(
        number=21,
        domain="api_marketplace",
        attack_family="inconsistent_replicas",
        title="Order API With Replicated Ownership",
        description="A synthetic order API whose ownership is replicated across two stores that disagree.",
        endpoints=(_endpoint("/api/orders/{order_id}", "GET", "read", "order"),),
        roles=(CUSTOMER_ROLE, SUPPORT_ROLE),
        actors=(VICTIM, ATTACKER),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="order"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        probes=(
            _probe(
                "Alice reads her own order, but the two replicas disagree about the owner.",
                Expectation(
                    "safe",
                    "insufficient_evidence",
                    "world_truth is safe; the observable pass cannot establish the owner",
                ),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads Alice's order while the replicas disagree about the owner.",
                Expectation(
                    "attack",
                    "insufficient_evidence",
                    "the two-pass split: truth says attack, evidence says undecidable",
                ),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-DB"), _service("SVC-REPLICA", "cache")),
        extra_evidence=(
            {
                "evidence_id": "EV-REPLICA-001",
                "type": "derived_summary",
                "asserts_ref": "resource.RES-001.owner",
                "value": "ACT-003",
                "source": "replicated-cache",
                "provenance": "replicated_cache",
                "trust_level": "trusted",
                "timestamp": "2026-09-20T07:59:00Z",
                "freshness": "fresh",
                "attacker_controllable": False,
                "visible_in_observation": True,
                "contradicts": ["EV-000"],
                "notes": "Second replica disagrees with the system of record.",
            },
        ),
        notes="Declared contradiction: masking cannot create one, so the world declares it (design 9.4).",
    )


def _hc022() -> WorldDefinition:
    """陈旧证据 + requires_fresh 策略：base 的 observable 是 insufficient（stale）。"""
    policy, invariant = _decidable_pair(
        "POL-ORDER-READ-OWNER-3",
        "INV-OWNERSHIP-003",
        "ownership",
        _eq(_ref("action.actor.actor_id"), _ref("action.resource.owner")),
        operation="read",
        resource_type="order",
        requires_fresh=True,
        description="Reading an order requires the caller to be its owner, proven by fresh evidence.",
    )
    return WorldDefinition(
        number=22,
        domain="cloud_storage",
        attack_family="stale_permission_cache",
        title="Order API Behind A Stale Cache",
        description="A synthetic order API whose ownership evidence comes from a cache that has gone stale.",
        endpoints=(_endpoint("/api/orders/{order_id}", "GET", "read", "order"),),
        roles=(CUSTOMER_ROLE, SUPPORT_ROLE),
        actors=(VICTIM, ATTACKER),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="order"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        probes=(
            _probe(
                "Alice reads her own order, but the only ownership evidence is stale.",
                Expectation(
                    "safe",
                    "insufficient_evidence",
                    "truth is safe; the stale cache cannot establish the owner (requires_fresh)",
                ),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads Alice's order while the ownership evidence is stale.",
                Expectation(
                    "attack",
                    "insufficient_evidence",
                    "stale evidence hides a real attack from the observable pass",
                ),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        caches=(
            {
                "cache_id": "CACHE-OWN-001",
                "cached_subject": "resource.RES-001.owner",
                "cached_value": "ACT-001",
                "source_of_truth": "SVC-DB",
                "fresh": False,
                "ttl_seconds": 300,
                "populated_at": "2026-09-19T07:55:00Z",
            },
        ),
        services=(_service("SVC-DB"), _service("SVC-CACHE", "cache")),
        evidence_overrides={"resource.RES-001.owner": {"freshness": "stale"}},
        notes="Declared staleness: the policy carries requires_fresh, so a stale establishing item is not enough.",
    )


def _hc023() -> WorldDefinition:
    """攻击者可控证据：唯一可见的 establishing 项全部 attacker_controllable。"""
    policy, invariant = _decidable_pair(
        "POL-ORDER-READ-OWNER-4",
        "INV-OWNERSHIP-004",
        "ownership",
        _eq(_ref("action.actor.actor_id"), _ref("action.resource.owner")),
        operation="read",
        resource_type="order",
        description="Reading an order requires the caller to be its owner.",
    )
    return WorldDefinition(
        number=23,
        domain="saas",
        attack_family="idor_bola",
        title="Order API With Attacker-Controlled Ownership Header",
        description="A synthetic order API whose only ownership evidence is a client-supplied header.",
        endpoints=(_endpoint("/api/orders/{order_id}", "GET", "read", "order"),),
        roles=(CUSTOMER_ROLE, SUPPORT_ROLE),
        actors=(VICTIM, ATTACKER),
        resources=(_resource("RES-001", owner="ACT-001", resource_type="order"),),
        policies=(policy,),
        invariants=(invariant,),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        probes=(
            _probe(
                "Alice reads her own order, but the only ownership evidence is attacker-controllable.",
                Expectation(
                    "safe",
                    "insufficient_evidence",
                    "truth is safe; nothing trusted establishes the owner",
                ),
                operation="read",
                actor="ACT-001",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
            _probe(
                "Mallory reads Alice's order on the strength of a header she controls.",
                Expectation(
                    "attack",
                    "insufficient_evidence",
                    "attacker_controlled_only: the observable pass must abstain",
                ),
                operation="read",
                actor="ACT-003",
                resource_id="RES-001",
                flow_id="FLOW-READ",
            ),
        ),
        services=(_service("SVC-DB"),),
        evidence_overrides={
            "resource.RES-001.owner": {
                "trust_level": "untrusted",
                "attacker_controllable": True,
                "provenance": "client_supplied",
                "source": "user_supplied_header:X-Owner-Id",
            }
        },
        notes="Declared attacker control: trust_level and attacker_controllable are independent dimensions (design 6).",
    )


# --------------------------------------------------------------------------- #
# 注册表
# --------------------------------------------------------------------------- #
_BUILDERS = (
    _hc001,
    _hc002,
    _hc003,
    _hc004,
    _hc005,
    _hc006,
    _hc007,
    _hc008,
    _hc009,
    _hc010,
    _hc011,
    _hc012,
    _hc013,
    _hc014,
    _hc015,
    _hc016,
    _hc017,
    _hc018,
    _hc019,
    _hc020,
    _hc021,
    _hc022,
    _hc023,
)


def definitions() -> tuple[WorldDefinition, ...]:
    """全部人工世界定义（按编号排序，确定性）。"""
    return tuple(builder() for builder in _BUILDERS)


__all__ = ["definitions"]
