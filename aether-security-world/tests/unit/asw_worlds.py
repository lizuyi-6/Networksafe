"""共享的测试世界构造器（Agent B/C 的单元测试共用）。

设计原则：测试世界**必须过 schema**——一个不合法的世界文档会让
``WorldInstance.from_document`` 在测试里炸出一个与断言无关的错误，于是"测试通过"
变成"测试根本没跑到这里"。因此 :func:`make_world` 默认用
``security_world.model.validate_document(doc, "world")`` 校验，不合法就带着错误
清单抛 :class:`AssertionError`。

所有 id 都符合 ``schemas/world.schema.json`` 的前缀模式（``ACT-`` / ``RES-`` /
``SES-`` / ``TOK-`` / ``WFL-`` / ``WFI-`` / ``FLOW-`` / ``TEN-`` / ``ROLE-`` /
``POL-`` / ``INV-`` / ``EV-``）。
"""
from __future__ import annotations

import copy
from typing import Any

from security_world.model import WorldInstance, validate_document
from security_world.model.canonical import stable_hash

#: 测试默认虚拟时刻（世界时间是声明出来的，不是读出来的）。
NOW = "2026-09-20T08:00:00Z"
LATER = "2026-09-20T09:00:00Z"
EXPIRED_AT = "2026-09-19T08:00:00Z"

DEFAULT_ENDPOINTS: tuple[tuple[str, str, str], ...] = (
    ("read", "order", "GET"),
    ("refund", "order", "POST"),
    ("write", "order", "PUT"),
    ("delete", "file", "DELETE"),
)

#: 闭世界兜底策略（``world.schema.json`` 的 ``policies`` minItems=1；每个世界都该有）。
DEFAULT_DENY_POLICY: dict[str, Any] = {
    "policy_id": "POL-DEFAULT-DENY",
    "description": "Closed-world default: no matching allow means deny.",
    "action": {"operation": "*"},
    "effect": "deny",
    "condition": {"op": "lit", "value": True},
    "priority": -1,
    "is_default_rule": True,
}

#: 占位不变量：``applies_to`` 用一个永不出现的 operation，因此它恒为
#: ``skipped_out_of_scope``——既不进 satisfied 也不进 violated，测试断言不被污染
#: （``invariants`` minItems=1 要求至少有一条）。
FILLER_INVARIANT: dict[str, Any] = {
    "invariant_id": "INV-FILLER",
    "category": "ownership",
    "applies_to": ["__no_such_operation__"],
    "severity": "low",
    "description": "Schema filler: always out of scope, never counted.",
    "expr": {
        "op": "eq",
        "args": [
            {"op": "ref", "path": "action.actor.actor_id"},
            {"op": "ref", "path": "action.actor.actor_id"},
        ],
    },
}



# --------------------------------------------------------------------------- #
# 实体构造器
# --------------------------------------------------------------------------- #
def actor(
    actor_id: str,
    *,
    roles: tuple[str, ...] = (),
    tenant: str | None = "TEN-001",
    authentication_state: str = "authenticated",
    privileges: tuple[str, ...] | None = None,
    privilege_version: int = 0,
    groups: tuple[str, ...] | None = None,
    actor_type: str = "user",
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "actor_id": actor_id,
        "actor_type": actor_type,
        "identity": {"identity_id": actor_id.replace("ACT-", "ID-"), "verified": True},
        "roles": list(roles),
        "tenant": tenant,
        "authentication_state": authentication_state,
        "privilege_version": privilege_version,
    }
    if privileges is not None:
        document["privileges"] = list(privileges)
    if groups is not None:
        document["groups"] = list(groups)
    return document


def role(role_id: str, *, privileges: tuple[str, ...] = (), name: str | None = None) -> dict[str, Any]:
    return {
        "role_id": role_id,
        "name": name or role_id.replace("ROLE-", "").replace("-", " ").title(),
        "privileges": list(privileges),
    }


def resource(
    resource_id: str,
    *,
    owner: str,
    resource_type: str = "order",
    tenant: str | None = "TEN-001",
    sensitivity: str = "confidential",
    state: str = "active",
) -> dict[str, Any]:
    return {
        "resource_id": resource_id,
        "resource_type": resource_type,
        "owner": owner,
        "tenant": tenant,
        "sensitivity": sensitivity,
        "state": state,
    }


def session(
    session_id: str,
    *,
    principal: str,
    valid: bool = True,
    revoked: bool = False,
    expires_at: str = "2026-09-21T08:00:00Z",
    flow_id: str = "FLOW-A",
    privilege_version: int = 0,
    auth_strength: str = "password",
    revoked_at: str | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "session_id": session_id,
        "principal": principal,
        "created_at": "2026-09-20T07:00:00Z",
        "authenticated_at": "2026-09-20T07:00:00Z",
        "auth_strength": auth_strength,
        "valid": valid,
        "revoked": revoked,
        "expires_at": expires_at,
        "privilege_snapshot": {"roles": [], "privileges": [], "privilege_version": privilege_version},
        "flow_id": flow_id,
    }
    if revoked_at is not None:
        document["revoked_at"] = revoked_at
        document["revocation_reason"] = "user_requested"
    return document


def token(
    token_id: str,
    *,
    subject: str,
    flow_id: str = "FLOW-A",
    one_time: bool = False,
    used: bool = False,
    parent_token: str | None = None,
    privilege_version: int = 0,
    scope: tuple[str, ...] = ("read",),
    audience: tuple[str, ...] = ("api",),
    token_type: str | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "token_id": token_id,
        "issuer": "auth.example.invalid",
        "subject": subject,
        "audience": list(audience),
        "scope": list(scope),
        "created_at": "2026-09-20T07:30:00Z",
        "expires_at": "2026-09-21T07:30:00Z",
        "one_time": one_time,
        "used": used,
        "parent_token": parent_token,
        "flow_id": flow_id,
        "privilege_version": privilege_version,
    }
    if token_type is not None:
        document["token_type"] = token_type
    return document


def transition(
    from_state: str,
    to_state: str,
    *,
    condition: dict[str, Any] | None = None,
    required_privileges: tuple[str, ...] | None = None,
    reversible: bool | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {"from_state": from_state, "to_state": to_state}
    if condition is not None:
        document["condition"] = condition
    if required_privileges is not None:
        document["required_privileges"] = list(required_privileges)
    if reversible is not None:
        document["reversible"] = reversible
    return document


def workflow(
    workflow_id: str,
    *,
    states: tuple[str, ...],
    initial_state: str,
    transitions_: tuple[dict[str, Any], ...] = (),
    instances: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    return {
        "workflow_id": workflow_id,
        "name": workflow_id.replace("WFL-", "").replace("-", " ").title(),
        "states": list(states),
        "initial_state": initial_state,
        "transitions": [_as_document(item) for item in transitions_],
        "instances": [_as_document(item) for item in instances],
    }


def instance(
    instance_id: str,
    *,
    resource_id: str,
    current_state: str,
    history: tuple[dict[str, Any], ...] = (),
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "instance_id": instance_id,
        "resource_id": resource_id,
        "current_state": current_state,
    }
    if history:
        document["history"] = [_as_document(item) for item in history]
    return document


def evidence(
    evidence_id: str,
    asserts_ref: str,
    value: Any,
    *,
    trust_level: str = "trusted",
    visible: bool = True,
    attacker_controllable: bool = False,
    freshness: str = "fresh",
    evidence_type: str = "log_line",
    provenance: str = "system_of_record",
) -> dict[str, Any]:
    return {
        "evidence_id": evidence_id,
        "type": evidence_type,
        "asserts_ref": asserts_ref,
        "value": value,
        "source": "test-source",
        "provenance": provenance,
        "trust_level": trust_level,
        "freshness": freshness,
        "attacker_controllable": attacker_controllable,
        "visible_in_observation": visible,
    }


#: 占位证据：断言一个"自建立"事实（action 绑定自身的身份字段），因此它永不进
#: consulted_facts，不影响任何充分性判定（``evidence`` minItems=1 要求至少有一条）。
FILLER_EVIDENCE: dict[str, Any] = {
    "evidence_id": "EV-FILLER",
    "type": "identity_claim",
    "asserts_ref": "actor.ACT-001.actor_id",
    "value": "ACT-001",
    "source": "test-source",
    "provenance": "system_of_record",
    "trust_level": "trusted",
    "freshness": "fresh",
    "attacker_controllable": False,
    "visible_in_observation": True,
}


# --------------------------------------------------------------------------- #
# 世界构造
# --------------------------------------------------------------------------- #
def _as_document(item: Any) -> dict[str, Any]:
    """测试构造器既收 dict 也收 L1 文档对象（``Invariant`` / ``PolicyRule`` ...）。"""
    to_document = getattr(item, "to_document", None)
    if callable(to_document):
        return dict(to_document())
    return dict(item)


def make_world(
    *,
    world_id: str = "W-001",
    policies: tuple[dict[str, Any], ...] = (),
    invariants: tuple[dict[str, Any], ...] = (),
    actors: tuple[dict[str, Any], ...] = (),
    resources: tuple[dict[str, Any], ...] = (),
    sessions: tuple[dict[str, Any], ...] = (),
    tokens: tuple[dict[str, Any], ...] = (),
    workflows: tuple[dict[str, Any], ...] = (),
    evidence_items: tuple[dict[str, Any], ...] = (),
    roles: tuple[dict[str, Any], ...] = (),
    endpoints: tuple[tuple[str, str, str], ...] = DEFAULT_ENDPOINTS,
    application_domain: str = "e-commerce",
    validate: bool = True,
) -> WorldInstance:
    """构造一个过 schema 的世界。"""
    resolved_actors = actors or (
        actor("ACT-001", roles=("ROLE-CUSTOMER",), privileges=("order:read",)),
    )
    resolved_resources = resources or (resource("RES-001", owner="ACT-001"),)
    resolved_workflows = workflows or (
        workflow(
            "WFL-ORDER",
            states=("created", "paid", "refunded"),
            initial_state="created",
            transitions_=(transition("created", "paid"), transition("paid", "refunded")),
            instances=(
                instance("WFI-001", resource_id="RES-001", current_state="paid"),
            ),
        ),
    )
    document: dict[str, Any] = {
        "schema_version": "0.1",
        "world_id": world_id,
        "world_family_id": "WF-" + stable_hash({"world_id": world_id})[:12],
        "application_domain": application_domain,
        "seed": 1,
        "provenance": {
            "origin": "handcrafted",
            "generator_model": "test-fixture",
            "generator_model_version": "0.0.0",
            "prompt_version": "0.1",
            "prompt_hash": "0" * 64,
            "generation_timestamp": NOW,
        },
        "compile": {
            "compiler_version": "0.1.0",
            "source_spec_id": world_id,
            "derived_world_family_id": True,
            "dropped_hypothesis_fields": [],
            "reason_codes": [],
        },
        "application": {
            "name": "Test Application",
            "description": "Synthetic world for unit tests.",
            "endpoints": [
                {"path": f"/api/{operation}", "method": method, "operation": operation,
                 "resource_type": resource_type}
                for operation, resource_type, method in endpoints
            ],
        },
        "roles": [_as_document(item) for item in (roles or (role("ROLE-CUSTOMER"),))],
        "actors": [_as_document(item) for item in resolved_actors],
        "resources": [_as_document(item) for item in resolved_resources],
        "sessions": [_as_document(item) for item in sessions],
        "tokens": [_as_document(item) for item in tokens],
        "workflows": [_as_document(item) for item in resolved_workflows],
        "policies": [_as_document(item) for item in (policies or (DEFAULT_DENY_POLICY,))],
        "invariants": [_as_document(item) for item in (invariants or (FILLER_INVARIANT,))],
        "state_history": [
            {"snapshot_id": "SNAP-000", "at": "2026-09-19T08:00:00Z", "label": "before"}
        ],
        "current_state": {"snapshot_id": "SNAP-001", "at": NOW, "label": "current"},
        "evidence": [_as_document(item) for item in (evidence_items or (FILLER_EVIDENCE,))],
    }
    if validate:
        errors = validate_document(document, "world")
        assert not errors, "测试世界未通过 world.schema.json:\n  - " + "\n  - ".join(errors)
    return WorldInstance.from_document(document)


def make_action(
    operation: str,
    actor_id: str,
    *,
    resource_id: str | None = None,
    session_id: str | None = None,
    token_id: str | None = None,
    workflow_instance_id: str | None = None,
    flow_id: str = "FLOW-A",
    at: str = NOW,
    parameters: dict[str, Any] | None = None,
    request: dict[str, Any] | None = None,
    action_id: str = "ACTN-000001-000",
) -> Any:
    """构造一个 :class:`~security_world.policy.Action`（过 action schema）。"""
    from security_world.model import validate_action_document
    from security_world.policy import Action

    document: dict[str, Any] = {
        "action_id": action_id,
        "operation": operation,
        "actor": actor_id,
        "flow_id": flow_id,
        "at": at,
    }
    for key, value in (
        ("resource", resource_id),
        ("session", session_id),
        ("token", token_id),
        ("workflow_instance", workflow_instance_id),
    ):
        if value is not None:
            document[key] = value
    if parameters is not None:
        document["parameters"] = dict(parameters)
    if request is not None:
        document["request"] = dict(request)
    errors = validate_action_document(document)
    assert not errors, "测试 action 未通过 action.schema.json:\n  - " + "\n  - ".join(errors)
    return Action.from_document(document)


# --------------------------------------------------------------------------- #
# 变形助手
# --------------------------------------------------------------------------- #
def override(world: WorldInstance, path: str, value: Any) -> WorldInstance:
    """把世界里的一个 ID 视图路径改成新值，返回新世界（原世界不变）。"""
    from security_world.oracle import override_world_values

    return override_world_values(world, {path: value})


def with_entities(world: WorldInstance, **collections: Any) -> WorldInstance:
    """整体替换某些实体集合（``actors=`` / ``resources=`` / ...），返回新世界。"""
    document = copy.deepcopy(world.to_document())
    mapping = {
        "actors": "actors",
        "resources": "resources",
        "sessions": "sessions",
        "tokens": "tokens",
        "workflows": "workflows",
        "policies": "policies",
        "invariants": "invariants",
        "evidence": "evidence",
        "roles": "roles",
    }
    for name, items in collections.items():
        if name not in mapping:
            raise KeyError(f"with_entities 不认识的集合 {name!r}；可用: {sorted(mapping)}")
        document[mapping[name]] = [copy.deepcopy(_as_document(item)) for item in items]
    return WorldInstance.from_document(document)


def view_of(world: WorldInstance, *, visible: tuple[str, ...] | None = None):
    """构造 :class:`~security_world.oracle.EvidenceView`。

    ``visible=None`` ⇒ 按 ``world.evidence[].visible_in_observation``（权威字段）。
    ``visible=("EV-1", ...)`` ⇒ 只让这些 id 可见（构造掩蔽场景用）。
    """
    from security_world.model.entities import EvidenceItem
    from security_world.oracle import EvidenceView

    if visible is None:
        return EvidenceView.from_world(world)
    allowed = set(visible)
    visible_items: list[EvidenceItem] = []
    hidden_items: list[EvidenceItem] = []
    for item in world.evidence:
        if item.evidence_id in allowed:
            visible_items.append(
                EvidenceItem.from_document({**item.to_document(), "visible_in_observation": True})
            )
        else:
            hidden_items.append(
                EvidenceItem.from_document({**item.to_document(), "visible_in_observation": False})
            )
    return EvidenceView(visible=tuple(visible_items), hidden=tuple(hidden_items))


def run(world: WorldInstance, action: Any, view: Any = None, *, notes: str = ""):
    """跑 oracle 的便捷入口（默认用世界的全部可见证据）。"""
    from security_world.oracle import run_oracle

    return run_oracle(world, action, view if view is not None else view_of(world), notes=notes)


def full_evidence(world: WorldInstance, action: Any, *, prefix: str = "EV") -> tuple[dict[str, Any], ...]:
    """为这次决策可能依赖的每个事实生成一条 trusted/visible/fresh 的证据。

    用于让 observable 趟**可判定**（``sufficient``），从而测试能专心断言 truth 趟的
    结论；需要测 ``insufficient_evidence`` 的测试用 ``view_of(world, visible=(...))``
    把证据藏起来。
    """
    from security_world.invariants import decision_facts

    items = [FILLER_EVIDENCE]
    index = 0
    for fact in sorted(decision_facts(world, action)):
        if not world.contains(fact):
            # 该实体没有这个可选字段（求值期按 UNKNOWN 处理）；没有值可断言就跳过
            continue
        items.append(evidence(f"{prefix}-{index:03d}", fact, world.resolve(fact)))
        index += 1
    return tuple(items)


def world_with_full_evidence(world: WorldInstance, action: Any) -> WorldInstance:
    """把 ``full_evidence`` 装回世界（替换整个 evidence 集合）。"""
    return with_entities(world, evidence=full_evidence(world, action))


def evaluated(world: WorldInstance, action: Any):
    """直接跑不变量求值（truth 趟），返回 ``InvariantResult`` 元组。"""
    from security_world.invariants import evaluate_invariants

    return evaluate_invariants(world, action)


__all__ = [
    "DEFAULT_DENY_POLICY",
    "DEFAULT_ENDPOINTS",
    "EXPIRED_AT",
    "FILLER_EVIDENCE",
    "FILLER_INVARIANT",
    "LATER",
    "NOW",
    "actor",
    "evidence",
    "evaluated",
    "full_evidence",
    "instance",
    "make_action",
    "make_world",
    "override",
    "resource",
    "role",
    "run",
    "session",
    "token",
    "transition",
    "view_of",
    "with_entities",
    "workflow",
    "world_with_full_evidence",
]
