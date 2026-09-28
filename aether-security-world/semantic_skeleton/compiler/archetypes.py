"""Phase 2A 的**不变量/策略原型库**（InvariantCompiler + PolicyCompiler 的表）。

原型（archetype）是一个**命名的安全性质**：它读哪些 canonical 路径、产出什么 DSL
表达式、属于哪个 category、要不要 ``requires_fresh``。骨架的
``security_invariants[].type`` 只能取这里的键；``rule`` 自由文本只进
``description``，**从不参与求值**——否则 LLM 的一段话就成了真值来源。

策略与不变量同源：ASW 的惯例是"决定性安全条件成立才放行"，因此每个原型同时给出
``invariant_expr`` 与 ``policy_condition``（多数情况下逐字相同）。两者分开是为了
让少数性质（如证据桥）能只进不变量——桥在策略里会把"不可信来源"变成一次非默认
deny，从而产出 ``attack``，而它本该产出 ``insufficient_evidence``。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from ..ontology import semantic_fact
from .errors import fail


@dataclass(frozen=True)
class ArchetypeResult:
    """一个原型的编译产物。"""

    category: str
    applies_to: tuple[str, ...]
    invariant_expr: dict[str, Any]
    policy_condition: dict[str, Any]
    description: str
    #: 这条不变量读到的 canonical 路径（审计/指纹用，也用于 consulted_facts 预期）。
    reads: tuple[str, ...] = ()
    #: 是否要求策略 ``requires_fresh``。
    requires_fresh: bool = False
    #: 需要世界声明的证据事实（语义事实名）。
    evidence_facts: tuple[str, ...] = ()
    #: 这条不变量是否需要证据桥（Observable 趟降级用）。
    needs_evidence_bridge: bool = False


@dataclass(frozen=True)
class Archetype:
    """一个可注册的不变量原型。"""

    key: str
    summary: str
    build: Callable[[Any, Mapping[str, Any]], ArchetypeResult]
    #: 该原型要求世界必须开出来的槽。
    required_slots: tuple[str, ...] = ()
    #: 该原型能接受的参数名（拼错的参数名必须炸，不能静默丢）。
    params: tuple[str, ...] = ()
    param_defaults: Mapping[str, Any] = field(default_factory=dict)


_REGISTRY: dict[str, Archetype] = {}


def register_archetype(archetype: Archetype) -> Archetype:
    if archetype.key in _REGISTRY:
        raise KeyError(f"原型 {archetype.key!r} 重复注册")
    _REGISTRY[archetype.key] = archetype
    return archetype


def archetype_keys() -> tuple[str, ...]:
    return tuple(sorted(_REGISTRY))


def get_archetype(key: str) -> Archetype:
    try:
        return _REGISTRY[key]
    except KeyError:
        raise fail(
            "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
            f"未知不变量原型 {key!r}；已注册: {list(archetype_keys())}",
        ) from None


# --------------------------------------------------------------------------- #
# DSL 构造（本地小包装；与 security_world.policy.builders 同语义）
# --------------------------------------------------------------------------- #
def _ref(path: str) -> dict[str, Any]:
    return {"op": "ref", "path": path}


def _lit(value: Any) -> dict[str, Any]:
    return {"op": "lit", "value": value}


def _eq(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {"op": "eq", "args": [left, right]}


def _or(*args: dict[str, Any]) -> dict[str, Any]:
    return {"op": "or", "args": list(args)}


def _and(*args: dict[str, Any]) -> dict[str, Any]:
    return {"op": "and", "args": list(args)}


def _not(value: dict[str, Any]) -> dict[str, Any]:
    return {"op": "not", "args": [value]}


def _in(needle: dict[str, Any], haystack: dict[str, Any]) -> dict[str, Any]:
    return {"op": "in", "args": [needle, haystack]}


def _intersects(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {"op": "intersects", "args": [left, right]}


def _subset(subset: dict[str, Any], superset: dict[str, Any]) -> dict[str, Any]:
    return {"op": "subset_of", "args": [subset, superset]}


def _contains(haystack: dict[str, Any], needle: dict[str, Any]) -> dict[str, Any]:
    return {"op": "contains", "args": [haystack, needle]}


def _after(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {"op": "after", "args": [left, right]}


def _before(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {"op": "before", "args": [left, right]}


def _state_is(instance_ref: str, state: str) -> dict[str, Any]:
    return {"op": "state_is", "args": [_ref(instance_ref), _lit(state)]}


def _transition_allowed(instance_ref: str, to_state: str) -> dict[str, Any]:
    return {"op": "transition_allowed", "args": [_ref(instance_ref), _lit(to_state)]}


def _lineage_root(token_ref: str) -> dict[str, Any]:
    return {"op": "lineage_root", "args": [_ref(token_ref)]}


def _bridge(fact_key: str) -> dict[str, Any]:
    return {"op": "establishing_evidence_exists", "args": [fact_key]}


def _path(plan: Any, fact_name: str) -> str:
    """语义事实 → canonical 路径（绑定失败即 UNKNOWN_SEMANTIC_FACT）。"""
    fact = semantic_fact(fact_name)
    if fact is None:
        raise fail(
            "facts", "UNKNOWN_SEMANTIC_FACT", "critical_facts",
            f"语义事实 {fact_name!r} 不在本体（semantic_skeleton/ontology.py）内",
        )
    resolved = plan.resolved_path(fact_name)
    if resolved is None:
        resolved = plan.bind(fact)
    return resolved


def _action_path(binding: str, field_path: str) -> str:
    return f"action.{binding}.{field_path}"


def _check_params(archetype: Archetype, params: Mapping[str, Any]) -> dict[str, Any]:
    unknown = sorted(name for name in params if name not in archetype.params)
    if unknown:
        raise fail(
            "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
            f"原型 {archetype.key!r} 不接受参数 {unknown}；可用: {list(archetype.params)}",
        )
    resolved = dict(archetype.param_defaults)
    resolved.update(params)
    missing = [name for name in archetype.params if name not in resolved]
    if missing:
        raise fail(
            "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
            f"原型 {archetype.key!r} 缺少参数 {missing}",
        )
    return resolved


def _require_slots(archetype: Archetype, plan: Any) -> None:
    missing = [slot for slot in archetype.required_slots if not plan.has_slot(slot)]
    if missing:
        raise fail(
            "entities", "MISSING_CRITICAL_FACT", "mechanism_family",
            f"原型 {archetype.key!r} 需要槽 {missing}，机制 "
            f"{plan.mechanism.family!r} 没有开出来",
        )


# --------------------------------------------------------------------------- #
# 原型定义
# --------------------------------------------------------------------------- #
def _build_ownership(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    actor_id = _path(plan, "authenticated_principal")
    owner = _path(plan, "resource_owner")
    expr = _eq(_ref(f"action.actor.actor_id"), _ref(f"resource.{owner.split('.')[1]}.owner"))
    expr = _eq(_ref("action.actor.actor_id"), _ref(owner))
    return ArchetypeResult(
        category="ownership",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="读/写资源的主体必须是属主。",
        reads=(actor_id, owner),
        evidence_facts=("resource_owner",),
    )


def _build_role_required(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    roles = tuple(str(item) for item in params["roles"])
    expr = _intersects(_ref("action.actor.roles"), _lit(list(roles)))
    return ArchetypeResult(
        category="authorization",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"主体必须持有角色之一: {', '.join(roles)}。",
        reads=(_path(plan, "current_role"),),
        evidence_facts=("current_role",),
    )


def _build_privilege_required(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    privilege = str(params["privilege"])
    expr = _in(_lit(privilege), _ref("action.actor.privileges"))
    return ArchetypeResult(
        category="authorization",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"主体必须直授权限 {privilege}。",
        reads=(_path(plan, "current_privileges"),),
        evidence_facts=("current_privileges",),
    )


def _build_owner_or_privileged(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    roles = tuple(str(item) for item in params["roles"])
    owner = _path(plan, "resource_owner")
    expr = _or(
        _eq(_ref("action.actor.actor_id"), _ref(owner)),
        _intersects(_ref("action.actor.roles"), _lit(list(roles))),
    )
    return ArchetypeResult(
        category="authorization",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="主体是属主或持有特权角色。",
        reads=(owner, _path(plan, "current_role")),
        evidence_facts=("resource_owner", "current_role"),
    )


def _build_session_not_revoked(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    expr = _eq(_ref("action.session.revoked"), _lit(False))
    return ArchetypeResult(
        category="session_revocation",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="不得骑已撤销的会话执行操作。",
        reads=(_path(plan, "session_revoked"),),
        evidence_facts=("session_revoked",),
    )


def _build_session_active(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    session = plan.id_for("acting_session")
    expr = _and(
        _eq(_ref("action.session.valid"), _lit(True)),
        _and(
            _eq(_ref("action.session.revoked"), _lit(False)),
            _after(_ref(f"session.{session}.expires_at"), _ref("current_time")),
        ),
    )
    return ArchetypeResult(
        category="session_revocation",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="会话必须有效、未撤销且未过期。",
        reads=(_path(plan, "session_valid"),),
        evidence_facts=("session_valid",),
    )


def _build_session_bound_to_principal(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    expr = _eq(_ref("action.session.principal"), _ref("action.actor.actor_id"))
    return ArchetypeResult(
        category="session_binding",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="会话主体必须正是行动主体。",
        reads=(_path(plan, "session_principal"),),
        evidence_facts=("session_principal",),
    )


def _build_authentication_state_required(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    state = str(params.get("state") or "authenticated")
    expr = _eq(_ref("action.actor.authentication_state"), _lit(state))
    return ArchetypeResult(
        category="authentication_state",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"主体认证状态必须为 {state}。",
        reads=(_path(plan, "authentication_state"),),
        evidence_facts=("authentication_state",),
    )


def _build_credential_active(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    credential = plan.id_for("credential")
    expr = _eq(_ref(f"credential.{credential}.status"), _lit("active"))
    return ArchetypeResult(
        category="authentication_state",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="凭据必须处于 active 状态。",
        reads=(_path(plan, "credential_status"),),
        evidence_facts=("credential_status",),
    )


def _build_one_time_token_unused(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    expr = _or(
        _eq(_ref("action.token.one_time"), _lit(False)),
        _eq(_ref("action.token.used"), _lit(False)),
    )
    return ArchetypeResult(
        category="one_time_token",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="一次性 token 不得已被使用过。",
        reads=(_path(plan, "token_used"),),
        evidence_facts=("token_used",),
    )


def _build_token_same_flow(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    expr = _eq(_ref("action.token.flow_id"), _ref("current_flow.flow_id"))
    return ArchetypeResult(
        category="token_lineage",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="token 只能在签发它的 flow 里使用。",
        reads=(_path(plan, "token_flow"),),
        evidence_facts=("token_flow",),
    )


def _build_token_scope_subset(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    required = tuple(str(item) for item in params["required_scope"])
    expr = _subset(_ref("action.token.scope"), _lit(list(required)))
    return ArchetypeResult(
        category="token_scope",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"token 范围必须覆盖 {', '.join(required)}。",
        reads=(_path(plan, "token_scope"),),
        evidence_facts=("token_scope",),
    )


def _build_token_scope_carries_tenant(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    tenant = _path(plan, "authenticated_tenant")
    expr = _contains(_ref("action.token.scope"), _ref(tenant))
    return ArchetypeResult(
        category="token_scope",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="token 的范围必须包含主体当前租户。",
        reads=(tenant, _path(plan, "token_scope")),
        evidence_facts=("token_scope", "authenticated_tenant"),
    )


def _build_token_audience_includes_service(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    service = plan.id_for("authority_service")
    expr = _intersects(_ref("action.token.audience"), _lit([service]))
    return ArchetypeResult(
        category="token_scope",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"token 的受众必须包含 {service}。",
        reads=(_path(plan, "token_audience"),),
        evidence_facts=("token_audience",),
    )


def _build_token_root_flow_is(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    flow = str(params["flow_id"])
    token = plan.id_for("acting_token")
    expr = _eq(_lineage_root(f"token.{token}.token_id"), _lit(flow))
    return ArchetypeResult(
        category="token_lineage",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"token 血缘根的 flow 必须是 {flow}。",
        reads=(_path(plan, "token_lineage"),),
        evidence_facts=("token_lineage",),
    )


def _build_token_privilege_version_matches_actor(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    actor = plan.id_for("principal")
    expr = _eq(
        _ref("action.token.privilege_version"),
        _ref(f"actor.{actor}.privilege_version"),
    )
    return ArchetypeResult(
        category="privilege_version",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="token 的权限版本必须等于主体当前权限版本。",
        reads=(_path(plan, "token_privilege_version"), _path(plan, "privilege_version")),
        evidence_facts=("token_privilege_version", "privilege_version"),
    )


def _build_token_bound_to_action_resource(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    token = plan.id_for("acting_token")
    expr = _eq(
        _ref(f"token.{token}.bound_resource"),
        _ref("action.resource.resource_id"),
    )
    return ArchetypeResult(
        category="cross_flow_isolation",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="token 必须绑定到本次行动的资源。",
        reads=(_path(plan, "token_bound_resource"),),
        evidence_facts=("token_bound_resource",),
    )


def _build_token_not_expired(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    token = plan.id_for("acting_token")
    expr = _after(_ref(f"token.{token}.expires_at"), _ref("current_time"))
    return ArchetypeResult(
        category="temporal",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="token 不得已过到期时刻。",
        reads=(_path(plan, "expiry_time"),),
        evidence_facts=("expiry_time",),
    )


def _build_session_privilege_version_matches_actor(
    plan: Any, params: Mapping[str, Any]
) -> ArchetypeResult:
    actor = plan.id_for("principal")
    expr = _eq(
        _ref("action.session.privilege_snapshot.privilege_version"),
        _ref(f"actor.{actor}.privilege_version"),
    )
    return ArchetypeResult(
        category="privilege_version",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="会话快照的权限版本必须等于主体当前权限版本。",
        reads=(
            _path(plan, "session_privilege_version"),
            _path(plan, "privilege_version"),
        ),
        evidence_facts=("session_privilege_version", "privilege_version"),
    )


def _build_workflow_state_in(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    states = tuple(str(item) for item in params["states"])
    instance = plan.id_for("workflow_instance")
    if len(states) == 1:
        expr = _state_is(f"workflow_instance.{instance}.current_state", states[0])
    else:
        expr = _or(
            *(
                _state_is(f"workflow_instance.{instance}.current_state", state)
                for state in states
            )
        )
    return ArchetypeResult(
        category="workflow_transition",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"工作流实例必须处于 {', '.join(states)} 之一。",
        reads=(_path(plan, "workflow_state"),),
        evidence_facts=("workflow_state",),
    )


def _build_workflow_transition_declared(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    to_state = str(params["to_state"])
    instance = plan.id_for("workflow_instance")
    expr = _transition_allowed(f"workflow_instance.{instance}.current_state", to_state)
    return ArchetypeResult(
        category="workflow_transition",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=f"到 {to_state} 的转移必须在状态机里声明。",
        reads=(_path(plan, "workflow_state"),),
        evidence_facts=("workflow_state",),
    )


def _build_tenant_isolation(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    authority = str(params.get("authority") or "actor")
    actor_tenant = _path(plan, "authenticated_tenant")
    if authority == "cache":
        cache = plan.id_for("cache_entry")
        authority_ref = _ref(f"cache.{cache}.cached_value")
        description = "主体当前租户必须等于授权缓存认定的租户。"
    else:
        authority_ref = _ref(_path(plan, "resource_tenant"))
        description = "主体当前租户必须等于资源所属租户。"
    expr = _eq(_ref("action.actor.tenant"), authority_ref)
    return ArchetypeResult(
        category="tenant_isolation",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=description,
        reads=(actor_tenant,),
        evidence_facts=("authenticated_tenant",),
    )


def _build_cache_matches_authority(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    """缓存值必须等于权威值。

    **缓存侧读语义事实解析出来的路径**，不写死 ``cache_entry``：一个机制可以同时开两个
    缓存槽（``cached_tenant`` 与 ``cached_privilege_version``），写死槽位会让两条不变量
    读到同一个 ``cached_value``——改一个值两条一起动，反事实于是翻转不了判决。
    """
    subject = str(params["subject"])
    # subject 决定权威侧读哪条路径
    if subject in ("privilege_version", "cached_privilege_version"):
        cached_fact = "cached_privilege_version"
        actor = plan.id_for("principal")
        authority = _ref(f"actor.{actor}.privilege_version")
        description = "权限缓存的版本必须等于主体当前的权威权限版本。"
        evidence = ("cached_privilege_version", "privilege_version")
    elif subject == "resource_owner":
        cached_fact = "cached_owner"
        authority = _ref(_path(plan, "resource_owner"))
        description = "属主缓存必须等于资源当前的权威属主。"
        evidence = ("cached_owner", "resource_owner")
    elif subject == "cached_policy_version":
        cached_fact = "cached_policy_version"
        authority = _ref(_path(plan, "current_policy_version"))
        description = "策略版本缓存必须等于权威策略版本。"
        evidence = ("cached_policy_version", "current_policy_version")
    elif subject == "cached_tenant_context_version":
        cached_fact = "cached_tenant_context_version"
        authority = _ref(_path(plan, "current_tenant_context_version"))
        description = "租户上下文版本缓存必须等于权威当前版本。"
        evidence = ("cached_tenant_context_version", "current_tenant_context_version")
    else:
        raise fail(
            "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
            f"cache_matches_authority 不支持 subject={subject!r}",
        )
    cached_value_path = _path(plan, cached_fact)
    expr = _eq(_ref(cached_value_path), authority)
    return ArchetypeResult(
        category="cache_consistency",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description=description,
        reads=(cached_value_path,),
        evidence_facts=evidence,
        requires_fresh=True,
    )


def _build_cache_not_stale_when_revoked(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    cache = plan.id_for("cache_entry")
    expr = _or(
        _eq(_ref("action.session.revoked"), _lit(False)),
        _eq(_ref(f"cache.{cache}.fresh"), _lit(False)),
    )
    return ArchetypeResult(
        category="cache_consistency",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="会话已撤销时缓存不得仍声称新鲜。",
        reads=(_path(plan, "cache_freshness"),),
        evidence_facts=("cache_freshness", "session_revoked"),
        requires_fresh=True,
    )


def _build_replicas_agree(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    first = plan.id_for("cache_entry")
    second = plan.id_for("second_cache")
    expr = _eq(_ref(f"cache.{first}.cached_value"), _ref(f"cache.{second}.cached_value"))
    return ArchetypeResult(
        category="cache_consistency",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="两个副本对同一份快照必须给出一致答案。",
        reads=(_path(plan, "cached_owner"),),
        evidence_facts=("cached_owner", "replica_cached_value"),
    )


def _build_revocation_before_use(plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    session = plan.id_for("acting_session")
    expr = _or(
        _eq(_ref("action.session.revoked"), _lit(False)),
        _after(_ref(f"session.{session}.revoked_at"), _ref("current_time")),
    )
    return ArchetypeResult(
        category="temporal",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        policy_condition=expr,
        description="已生效的撤销不得仍允许使用。",
        reads=(_path(plan, "revocation_time"),),
        evidence_facts=("revocation_time", "session_revoked"),
    )


def _build_decisive_fact_established_by_trusted_evidence(
    plan: Any, params: Mapping[str, Any]
) -> ArchetypeResult:
    fact_name = str(params["fact"])
    path = _path(plan, fact_name)
    expr = _bridge(path)
    return ArchetypeResult(
        category="trust_boundary",
        applies_to=(plan.primary_operation,),
        invariant_expr=expr,
        # 桥只进不变量：进策略会把"来源不可信"变成一次非默认 deny ⇒ attack，
        # 而它本该是 insufficient_evidence（证据桥的单向性）。
        policy_condition=_lit(True),
        description=f"决定性事实 {fact_name} 必须由可信证据建立。",
        reads=(path,),
        evidence_facts=(fact_name,),
        needs_evidence_bridge=True,
    )


# --------------------------------------------------------------------------- #
# 注册
# --------------------------------------------------------------------------- #
register_archetype(Archetype(
    key="ownership", summary="属主才可访问",
    build=_build_ownership, required_slots=("principal", "target_resource"),
))
register_archetype(Archetype(
    key="role_required", summary="必须持有指定角色",
    build=_build_role_required, required_slots=("principal",), params=("roles",),
))
register_archetype(Archetype(
    key="privilege_required", summary="必须直授指定权限",
    build=_build_privilege_required, required_slots=("principal",), params=("privilege",),
))
register_archetype(Archetype(
    key="owner_or_privileged", summary="属主或特权角色",
    build=_build_owner_or_privileged, required_slots=("principal", "target_resource"),
    params=("roles",),
))
register_archetype(Archetype(
    key="session_not_revoked", summary="会话未撤销",
    build=_build_session_not_revoked, required_slots=("acting_session",),
))
register_archetype(Archetype(
    key="session_active", summary="会话有效且未过期",
    build=_build_session_active, required_slots=("acting_session",),
))
register_archetype(Archetype(
    key="session_bound_to_principal", summary="会话主体即行动主体",
    build=_build_session_bound_to_principal, required_slots=("acting_session",),
))
register_archetype(Archetype(
    key="authentication_state_required", summary="认证状态达标",
    build=_build_authentication_state_required, required_slots=("principal",),
    params=("state",), param_defaults={"state": "authenticated"},
))
register_archetype(Archetype(
    key="credential_active", summary="凭据处于 active",
    build=_build_credential_active, required_slots=("credential",),
))
register_archetype(Archetype(
    key="one_time_token_unused", summary="一次性 token 未被使用",
    build=_build_one_time_token_unused, required_slots=("acting_token",),
))
register_archetype(Archetype(
    key="token_same_flow", summary="token 不得跨 flow 使用",
    build=_build_token_same_flow, required_slots=("acting_token",),
))
register_archetype(Archetype(
    key="token_scope_subset", summary="token 范围覆盖所需范围",
    build=_build_token_scope_subset, required_slots=("acting_token",),
    params=("required_scope",),
))
register_archetype(Archetype(
    key="token_scope_carries_tenant", summary="token 范围含当前租户",
    build=_build_token_scope_carries_tenant, required_slots=("acting_token", "principal"),
))
register_archetype(Archetype(
    key="token_audience_includes_service", summary="token 受众含接收服务",
    build=_build_token_audience_includes_service,
    required_slots=("acting_token", "authority_service"),
))
register_archetype(Archetype(
    key="token_root_flow_is", summary="token 血缘根 flow 是指定 flow",
    build=_build_token_root_flow_is, required_slots=("acting_token",),
    params=("flow_id",),
))
register_archetype(Archetype(
    key="token_privilege_version_matches_actor", summary="token 权限版本等于主体版本",
    build=_build_token_privilege_version_matches_actor,
    required_slots=("acting_token", "principal"),
))
register_archetype(Archetype(
    key="token_bound_to_action_resource", summary="token 绑定本次行动的资源",
    build=_build_token_bound_to_action_resource,
    required_slots=("acting_token", "target_resource"),
))
register_archetype(Archetype(
    key="token_not_expired", summary="token 未过期",
    build=_build_token_not_expired, required_slots=("acting_token",),
))
register_archetype(Archetype(
    key="session_privilege_version_matches_actor", summary="会话权限版本等于主体版本",
    build=_build_session_privilege_version_matches_actor,
    required_slots=("acting_session", "principal"),
))
register_archetype(Archetype(
    key="workflow_state_in", summary="工作流实例处于允许状态",
    build=_build_workflow_state_in, required_slots=("workflow_instance",),
    params=("states",),
))
register_archetype(Archetype(
    key="workflow_transition_declared", summary="转移在状态机里声明",
    build=_build_workflow_transition_declared, required_slots=("workflow_instance",),
    params=("to_state",),
))
register_archetype(Archetype(
    key="tenant_isolation", summary="主体租户与权威租户一致",
    build=_build_tenant_isolation, required_slots=("principal",),
    params=("authority",), param_defaults={"authority": "actor"},
))
register_archetype(Archetype(
    key="cache_matches_authority", summary="缓存值等于权威值",
    build=_build_cache_matches_authority, required_slots=("cache_entry",),
    params=("subject",),
))
register_archetype(Archetype(
    key="cache_not_stale_when_revoked", summary="撤销后缓存不得仍新鲜",
    build=_build_cache_not_stale_when_revoked,
    required_slots=("cache_entry", "acting_session"),
))
register_archetype(Archetype(
    key="replicas_agree", summary="副本一致",
    build=_build_replicas_agree, required_slots=("cache_entry", "second_cache"),
))
register_archetype(Archetype(
    key="revocation_before_use", summary="撤销生效后不得使用",
    build=_build_revocation_before_use, required_slots=("acting_session",),
))
register_archetype(Archetype(
    key="decisive_fact_established_by_trusted_evidence", summary="决定性事实由可信证据建立",
    build=_build_decisive_fact_established_by_trusted_evidence,
    required_slots=("principal",), params=("fact",),
))


def build_archetype(key: str, plan: Any, params: Mapping[str, Any]) -> ArchetypeResult:
    """按 key 编译一个原型（参数校验 + 槽校验都在内）。"""
    archetype = get_archetype(key)
    resolved = _check_params(archetype, params)
    _require_slots(archetype, plan)
    return archetype.build(plan, resolved)


__all__ = [
    "Archetype",
    "ArchetypeResult",
    "archetype_keys",
    "build_archetype",
    "get_archetype",
    "register_archetype",
]
