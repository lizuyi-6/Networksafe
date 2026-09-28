"""Phase 2A 的**语义事实本体**（brief §22）：LLM 唯一被允许使用的安全语义变量表。

设计原则（brief §63）：如果一个字段可以由程序可靠推导，就不要让 LLM 生成它。
语义骨架里的 ``critical_facts`` / ``required_evidence`` / ``counterfactuals[].target_fact``
全部只能是本表里的名字。名字到 canonical fact path 的映射是**确定性**的，由
:mod:`semantic_skeleton.compiler.facts` 的 :class:`FactBinder` 完成。

每个条目回答四个问题：

* 它挂在**哪一类实体**上（``entity_type``）；
* 在这类实体上是**哪个字段**（``field_path``，相对实体根）；
* 它占世界里的**哪个角色位**（``slot``）——同一类实体可能出现多个实例
  （两个 session、三个 actor），编译器靠 slot 决定这个语义事实落在哪个实例上；
* 它能**不能当反事实轴**（``axis_pattern``，必须命中 Phase 2A 配置的
  ``critical_axes_whitelist``，否则编译期拒绝而不是运行期静默跳过）。

未知名字不是编译失败：生成器可以提 ``new_semantic_fact_candidates``，该骨架进
quarantine，直到人工/agent 扩展本表 + 编译器 + 测试（brief §23）。**不允许**
偷偷动态改变生产 schema。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

#: 实体类型（与 ``world.schema.json`` 的 ID 视图前缀一致）。
ENTITY_TYPES: tuple[str, ...] = (
    "actor", "resource", "session", "token", "workflow_instance",
    "cache", "service", "credential", "trust_boundary", "role",
)

#: 角色位：同一语义事实在不同世界里落在不同的具体实例上，slot 是那唯一的锚。
#: ``principal``        —— 发起决策的主体 actor
#: ``peer``             —— 同一世界里的另一个 actor（水平越权的对照方）
#: ``target_resource``  —— 决策作用的目标 resource
#: ``acting_session``   —— 决策骑的 session
#: ``acting_token``     —— 决策骑的 token
#: ``lineage_parent``   —— acting_token 的父 token
#: ``workflow_instance``—— 决策作用的工作流实例
#: ``cache_entry``      —— 世界里的（主）cache 条目
#: ``second_cache``     —— 世界里的第二个 cache 条目（副本分歧类）
#: ``authority_service``—— 权威服务（system of record）
#: ``credential``       —— principal 的凭据
#: ``boundary``         —— 信任边界
SLOTS: tuple[str, ...] = (
    "principal", "peer", "target_resource", "acting_session", "acting_token",
    "lineage_parent", "workflow_instance", "cache_entry", "second_cache",
    "authority_service", "credential", "boundary", "surface",
)

#: 语义分组（brief §22 的分组名 + Phase 2A 新增的观测表面分组）。
FACT_GROUPS: tuple[str, ...] = (
    "identity", "resource", "session", "token", "workflow",
    "cache", "temporal", "trust", "surface",
)


@dataclass(frozen=True)
class SemanticFact:
    """一个语义事实的定义。"""

    name: str
    group: str
    entity_type: str
    field_path: str
    slot: str
    #: 取值种类（编译器据此生成"另一个合法取值"做反事实）。
    value_kind: str
    #: 命中 critical_axes_whitelist 的模式（空串表示不能当轴）。
    axis_pattern: str = ""
    #: 人读说明（只进文档与 skeleton 记录，不进世界）。
    summary: str = ""

    def path_for(self, entity_id: str) -> str:
        """给定实体 id，产出 canonical ID 视图路径。"""
        return f"{self.entity_type}.{entity_id}.{self.field_path}"


# --------------------------------------------------------------------------- #
# Identity
# --------------------------------------------------------------------------- #
_IDENTITY: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="authenticated_principal", group="identity", entity_type="actor",
        field_path="actor_id", slot="principal", value_kind="actor_id",
        summary="发起决策的主体是谁（属主比较的一方）",
    ),
    SemanticFact(
        name="peer_principal", group="identity", entity_type="actor",
        field_path="actor_id", slot="peer", value_kind="actor_id",
        summary="同一世界里的对照主体（水平越权的另一方）",
    ),
    SemanticFact(
        name="authenticated_tenant", group="identity", entity_type="actor",
        field_path="tenant", slot="principal", value_kind="tenant",
        axis_pattern="actor.*.tenant",
        summary="主体当前认证所在的租户",
    ),
    SemanticFact(
        name="current_role", group="identity", entity_type="actor",
        field_path="roles", slot="principal", value_kind="role_list",
        axis_pattern="actor.*.roles",
        summary="主体当前持有的角色集合",
    ),
    SemanticFact(
        name="current_privileges", group="identity", entity_type="actor",
        field_path="privileges", slot="principal", value_kind="string_list",
        axis_pattern="actor.*.privileges",
        summary="主体当前直授的权限集合",
    ),
    SemanticFact(
        name="privilege_version", group="identity", entity_type="actor",
        field_path="privilege_version", slot="principal", value_kind="integer",
        axis_pattern="actor.*.privilege_version",
        summary="主体权限的权威版本号",
    ),
    SemanticFact(
        name="authentication_state", group="identity", entity_type="actor",
        field_path="authentication_state", slot="principal", value_kind="auth_state",
        axis_pattern="actor.*.authentication_state",
        summary="主体的认证状态",
    ),
    SemanticFact(
        name="identity_verified", group="identity", entity_type="actor",
        field_path="identity.verified", slot="principal", value_kind="boolean",
        summary="主体身份是否已验证",
    ),
    SemanticFact(
        name="credential_status", group="identity", entity_type="credential",
        field_path="status", slot="credential", value_kind="credential_status",
        axis_pattern="credential.*.status",
        summary="主体凭据的状态（active/revoked/rotated/expired）",
    ),
)

# --------------------------------------------------------------------------- #
# Resource
# --------------------------------------------------------------------------- #
_RESOURCE: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="resource_owner", group="resource", entity_type="resource",
        field_path="owner", slot="target_resource", value_kind="actor_ref",
        axis_pattern="resource.*.owner",
        summary="资源的属主（ground truth 的单点归属）",
    ),
    SemanticFact(
        name="resource_tenant", group="resource", entity_type="resource",
        field_path="tenant", slot="target_resource", value_kind="tenant",
        axis_pattern="resource.*.tenant",
        summary="资源所属租户",
    ),
    SemanticFact(
        name="resource_state", group="resource", entity_type="resource",
        field_path="state", slot="target_resource", value_kind="resource_state",
        axis_pattern="resource.*.state",
        summary="资源自身的生命周期状态",
    ),
    SemanticFact(
        name="resource_sensitivity", group="resource", entity_type="resource",
        field_path="sensitivity", slot="target_resource", value_kind="sensitivity",
        summary="资源敏感级别",
    ),
    SemanticFact(
        name="resource_type", group="resource", entity_type="resource",
        field_path="resource_type", slot="target_resource", value_kind="string",
        summary="资源类型",
    ),
)

# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #
_SESSION: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="session_principal", group="session", entity_type="session",
        field_path="principal", slot="acting_session", value_kind="actor_ref",
        axis_pattern="session.*.principal",
        summary="会话绑定的主体",
    ),
    SemanticFact(
        name="session_revoked", group="session", entity_type="session",
        field_path="revoked", slot="acting_session", value_kind="boolean",
        axis_pattern="session.*.revoked",
        summary="会话是否已撤销",
    ),
    SemanticFact(
        name="session_valid", group="session", entity_type="session",
        field_path="valid", slot="acting_session", value_kind="boolean",
        axis_pattern="session.*.valid",
        summary="会话是否有效",
    ),
    SemanticFact(
        name="session_privilege_version", group="session", entity_type="session",
        field_path="privilege_snapshot.privilege_version", slot="acting_session",
        value_kind="integer", axis_pattern="session.*.privilege_snapshot.privilege_version",
        summary="会话建立时快照的权限版本",
    ),
    SemanticFact(
        name="session_auth_strength", group="session", entity_type="session",
        field_path="auth_strength", slot="acting_session", value_kind="auth_strength",
        summary="会话的认证强度",
    ),
    SemanticFact(
        name="session_expiry", group="session", entity_type="session",
        field_path="expires_at", slot="acting_session", value_kind="timestamp",
        summary="会话到期时刻",
    ),
    SemanticFact(
        name="mfa_state", group="session", entity_type="actor",
        field_path="authentication_state", slot="principal", value_kind="auth_state",
        axis_pattern="actor.*.authentication_state",
        summary="多因素认证的推进状态（mfa_pending / mfa_complete）",
    ),
)

# --------------------------------------------------------------------------- #
# Token
# --------------------------------------------------------------------------- #
_TOKEN: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="token_subject", group="token", entity_type="token",
        field_path="subject", slot="acting_token", value_kind="actor_ref",
        summary="token 声明的主题",
    ),
    SemanticFact(
        name="token_scope", group="token", entity_type="token",
        field_path="scope", slot="acting_token", value_kind="string_list",
        axis_pattern="token.*.scope",
        summary="token 的授权范围",
    ),
    SemanticFact(
        name="token_audience", group="token", entity_type="token",
        field_path="audience", slot="acting_token", value_kind="string_list",
        axis_pattern="token.*.audience",
        summary="token 的受众",
    ),
    SemanticFact(
        name="token_flow", group="token", entity_type="token",
        field_path="flow_id", slot="acting_token", value_kind="string",
        axis_pattern="token.*.flow_id",
        summary="token 签发时所属的 flow",
    ),
    SemanticFact(
        name="token_used", group="token", entity_type="token",
        field_path="used", slot="acting_token", value_kind="boolean",
        axis_pattern="token.*.used",
        summary="token 是否已被使用过",
    ),
    SemanticFact(
        name="token_one_time", group="token", entity_type="token",
        field_path="one_time", slot="acting_token", value_kind="boolean",
        axis_pattern="token.*.one_time",
        summary="token 是否一次性",
    ),
    SemanticFact(
        name="token_lineage", group="token", entity_type="token",
        field_path="parent_token", slot="acting_token", value_kind="token_ref",
        axis_pattern="token.*.parent_token",
        summary="token 的父 token（血缘链上一环）",
    ),
    SemanticFact(
        name="token_lineage_root_flow", group="token", entity_type="token",
        field_path="flow_id", slot="lineage_parent", value_kind="string",
        axis_pattern="token.*.flow_id",
        summary="token 血缘根的 flow",
    ),
    SemanticFact(
        name="token_expiry", group="token", entity_type="token",
        field_path="expires_at", slot="acting_token", value_kind="timestamp",
        axis_pattern="token.*.expires_at",
        summary="token 到期时刻",
    ),
    SemanticFact(
        name="token_privilege_version", group="token", entity_type="token",
        field_path="privilege_version", slot="acting_token", value_kind="integer",
        axis_pattern="token.*.privilege_version",
        summary="token 签发时的权限版本",
    ),
    SemanticFact(
        name="token_bound_resource", group="token", entity_type="token",
        field_path="bound_resource", slot="acting_token", value_kind="resource_ref",
        axis_pattern="token.*.bound_resource",
        summary="token 绑定的资源（跨资源重用防护）",
    ),
)

# --------------------------------------------------------------------------- #
# Workflow
# --------------------------------------------------------------------------- #
_WORKFLOW: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="workflow_state", group="workflow", entity_type="workflow_instance",
        field_path="current_state", slot="workflow_instance", value_kind="workflow_state",
        axis_pattern="workflow_instance.*.current_state",
        summary="工作流实例的当前状态",
    ),
    SemanticFact(
        name="approval_state", group="workflow", entity_type="workflow_instance",
        field_path="current_state", slot="workflow_instance", value_kind="workflow_state",
        axis_pattern="workflow_instance.*.current_state",
        summary="审批是否已完成（由工作流状态承载）",
    ),
    SemanticFact(
        name="transition_target_state", group="workflow", entity_type="workflow_instance",
        field_path="current_state", slot="workflow_instance", value_kind="workflow_state",
        axis_pattern="workflow_instance.*.current_state",
        summary="这次转移想要到达的状态",
    ),
    SemanticFact(
        name="workflow_instance_id", group="workflow", entity_type="workflow_instance",
        field_path="instance_id", slot="workflow_instance", value_kind="string",
        summary="工作流实例标识",
    ),
)

# --------------------------------------------------------------------------- #
# Cache / distributed
# --------------------------------------------------------------------------- #
_CACHE: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="cached_role", group="cache", entity_type="cache",
        field_path="cached_value", slot="cache_entry", value_kind="role_list",
        axis_pattern="cache.*.cached_value",
        summary="缓存里的一份角色快照",
    ),
    SemanticFact(
        name="cached_tenant", group="cache", entity_type="cache",
        field_path="cached_value", slot="cache_entry", value_kind="tenant",
        axis_pattern="cache.*.cached_value",
        summary="缓存里的一份租户快照",
    ),
    SemanticFact(
        name="cached_owner", group="cache", entity_type="cache",
        field_path="cached_value", slot="cache_entry", value_kind="actor_ref",
        axis_pattern="cache.*.cached_value",
        summary="缓存里的一份属主快照",
    ),
    SemanticFact(
        name="cached_policy_version", group="cache", entity_type="cache",
        field_path="cached_value", slot="cache_entry", value_kind="integer",
        axis_pattern="cache.*.cached_value",
        summary="缓存里的策略版本",
    ),
    SemanticFact(
        name="cached_privilege_version", group="cache", entity_type="cache",
        field_path="cached_value", slot="cache_entry", value_kind="integer",
        axis_pattern="cache.*.cached_value",
        summary="缓存里的权限版本",
    ),
    SemanticFact(
        name="cached_tenant_context_version", group="cache", entity_type="cache",
        field_path="cached_value", slot="cache_entry", value_kind="integer",
        axis_pattern="cache.*.cached_value",
        summary="租户上下文版本（授权缓存新鲜度的判据）",
    ),
    SemanticFact(
        name="current_tenant_context_version", group="cache", entity_type="cache",
        field_path="cached_value", slot="second_cache", value_kind="integer",
        axis_pattern="cache.*.cached_value",
        summary="权威的当前租户上下文版本",
    ),
    SemanticFact(
        name="current_policy_version", group="cache", entity_type="cache",
        field_path="cached_value", slot="second_cache", value_kind="integer",
        axis_pattern="cache.*.cached_value",
        summary="权威的当前策略版本",
    ),
    SemanticFact(
        name="cache_freshness", group="cache", entity_type="cache",
        field_path="fresh", slot="cache_entry", value_kind="boolean",
        axis_pattern="cache.*.fresh",
        summary="缓存条目是否被标记为新鲜",
    ),
    SemanticFact(
        name="cache_source_of_truth", group="cache", entity_type="cache",
        field_path="source_of_truth", slot="cache_entry", value_kind="string",
        summary="缓存条目声称的权威来源",
    ),
    SemanticFact(
        name="replica_cached_value", group="cache", entity_type="cache",
        field_path="cached_value", slot="second_cache", value_kind="actor_ref",
        axis_pattern="cache.*.cached_value",
        summary="另一个副本上的同一份快照",
    ),
)

# --------------------------------------------------------------------------- #
# Temporal
# --------------------------------------------------------------------------- #
_TEMPORAL: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="current_time", group="temporal", entity_type="service",
        field_path="service_id", slot="authority_service", value_kind="timestamp",
        summary="虚拟时钟的当前时刻（编译器映射为 current_time 上下文路径）",
    ),
    SemanticFact(
        name="revocation_time", group="temporal", entity_type="session",
        field_path="revoked_at", slot="acting_session", value_kind="timestamp",
        axis_pattern="session.*.revoked_at",
        summary="撤销发生的时刻",
    ),
    SemanticFact(
        name="issue_time", group="temporal", entity_type="token",
        field_path="created_at", slot="acting_token", value_kind="timestamp",
        axis_pattern="token.*.created_at",
        summary="签发时刻",
    ),
    SemanticFact(
        name="expiry_time", group="temporal", entity_type="token",
        field_path="expires_at", slot="acting_token", value_kind="timestamp",
        axis_pattern="token.*.expires_at",
        summary="到期时刻",
    ),
    SemanticFact(
        name="cache_populated_at", group="temporal", entity_type="cache",
        field_path="populated_at", slot="cache_entry", value_kind="timestamp",
        axis_pattern="cache.*.populated_at",
        summary="缓存条目填充时刻",
    ),
)

# --------------------------------------------------------------------------- #
# Trust
# --------------------------------------------------------------------------- #
_TRUST: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="source_trust", group="trust", entity_type="service",
        field_path="service_id", slot="authority_service", value_kind="trust_level",
        summary="证据来源的信任级别（由 TrustCompiler 决定，不由 LLM 标注）",
    ),
    SemanticFact(
        name="authority_source", group="trust", entity_type="service",
        field_path="service_id", slot="authority_service", value_kind="string",
        summary="哪个服务是某事实的权威来源",
    ),
    SemanticFact(
        name="service_trust_boundary", group="trust", entity_type="service",
        field_path="trust_boundary", slot="authority_service", value_kind="string",
        summary="服务所属的信任边界",
    ),
    SemanticFact(
        name="service_consistency", group="trust", entity_type="service",
        field_path="consistency_model", slot="authority_service", value_kind="consistency",
        summary="服务的一致性模型（strong/eventual/read_your_writes/causal）",
    ),
    SemanticFact(
        name="boundary_crossing_requirement", group="trust", entity_type="trust_boundary",
        field_path="crossing_requires", slot="boundary", value_kind="string_list",
        summary="跨越信任边界需要满足的条件",
    ),
    SemanticFact(
        name="signature_valid", group="trust", entity_type="service",
        field_path="service_id", slot="authority_service", value_kind="boolean",
        summary="跨边界携带的签名是否有效（由 TrustCompiler 置位）",
    ),
)


# --------------------------------------------------------------------------- #
# Observation surface（无关事实；永远不进世界状态）
# --------------------------------------------------------------------------- #
#: 观测表面事实：它们**不是**世界状态，因此永远不能当关键轴。骨架用它们声明
#: "这些东西变了判决也不能变"（brief §15），编译器把它们映射到
#: ``observation.(request|rendering).*`` 的固定轴集合（B9：无关轴必须是观测表面路径，
#: 改了世界状态的"无关"轴会让 Gate 6 永假）。
_SURFACE: tuple[SemanticFact, ...] = (
    SemanticFact(
        name="request_trace_id", group="surface", entity_type="observation",
        field_path="request.headers.X-Request-Id", slot="surface", value_kind="string",
        summary="请求追踪标识（纯观测表面）",
    ),
    SemanticFact(
        name="user_agent", group="surface", entity_type="observation",
        field_path="request.headers.User-Agent", slot="surface", value_kind="string",
        summary="客户端 User-Agent（纯观测表面）",
    ),
    SemanticFact(
        name="display_locale", group="surface", entity_type="observation",
        field_path="request.headers.Accept-Language", slot="surface", value_kind="string",
        summary="展示语言（纯观测表面）",
    ),
    SemanticFact(
        name="request_header_order", group="surface", entity_type="observation",
        field_path="request.headers.order", slot="surface", value_kind="string_list",
        summary="请求 header 的行序（纯观测表面）",
    ),
    SemanticFact(
        name="rendering_trace_id", group="surface", entity_type="observation",
        field_path="rendering.trace_id", slot="surface", value_kind="string",
        summary="渲染期 trace id（纯观测表面）",
    ),
    SemanticFact(
        name="timestamp_format", group="surface", entity_type="observation",
        field_path="rendering.timestamp_format", slot="surface", value_kind="string",
        summary="时间戳展示格式（纯观测表面）",
    ),
    SemanticFact(
        name="display_name_case", group="surface", entity_type="observation",
        field_path="rendering.display_name_case", slot="surface", value_kind="string",
        summary="展示名大小写（纯观测表面）",
    ),
)

#: 语义事实名 → 观测表面轴路径（编译器按此表落地，确定性）。
SURFACE_AXIS_PATHS: Mapping[str, str] = {
    "request_trace_id": "observation.request.headers.X-Request-Id",
    "user_agent": "observation.request.headers.User-Agent",
    "display_locale": "observation.request.headers.Accept-Language",
    "request_header_order": "observation.request.headers.order",
    "rendering_trace_id": "observation.rendering.trace_id",
    "timestamp_format": "observation.rendering.timestamp_format",
    "display_name_case": "observation.rendering.display_name_case",
}


#: 全部语义事实（按分组顺序，确定性）。
FACTS: tuple[SemanticFact, ...] = (
    _IDENTITY + _RESOURCE + _SESSION + _TOKEN + _WORKFLOW + _CACHE + _TEMPORAL + _TRUST + _SURFACE
)

#: 名字 -> 定义。
_BY_NAME: Mapping[str, SemanticFact] = {fact.name: fact for fact in FACTS}


def fact_names() -> tuple[str, ...]:
    """全部语义事实名（排序，确定性）。"""
    return tuple(sorted(_BY_NAME))


def fact_names_by_group(group: str) -> tuple[str, ...]:
    """某一分组的语义事实名（排序）。"""
    return tuple(sorted(name for name, fact in _BY_NAME.items() if fact.group == group))


def semantic_fact(name: str) -> SemanticFact | None:
    """取一个语义事实定义；未知返回 ``None``（由调用方决定 quarantine 而不是崩）。"""
    return _BY_NAME.get(name)


def is_known_fact(name: str) -> bool:
    return name in _BY_NAME


def axis_capable_facts() -> tuple[str, ...]:
    """可以当反事实轴的语义事实（``axis_pattern`` 非空）。"""
    return tuple(sorted(name for name, fact in _BY_NAME.items() if fact.axis_pattern))


def surface_facts() -> tuple[str, ...]:
    """观测表面事实（只能当无关轴）。"""
    return tuple(sorted(name for name, fact in _BY_NAME.items() if fact.group == "surface"))


def surface_axis_path(name: str) -> str | None:
    """观测表面事实 → 固定轴路径。"""
    return SURFACE_AXIS_PATHS.get(name)


def unknown_facts(names: object) -> tuple[str, ...]:
    """挑出一批名字里不在本体内的（保序去重）。"""
    if isinstance(names, str) or not isinstance(names, (list, tuple, set)):
        return ()
    seen: set[str] = set()
    out: list[str] = []
    for item in names:
        name = str(item)
        if name in seen:
            continue
        seen.add(name)
        if not is_known_fact(name):
            out.append(name)
    return tuple(out)


def groups_summary() -> dict[str, tuple[str, ...]]:
    """``group -> 事实名``（prompt 与测试共用的紧凑摘要）。"""
    out: dict[str, set[str]] = {}
    for fact in FACTS:
        out.setdefault(fact.group, set()).add(fact.name)
    return {group: tuple(sorted(names)) for group, names in sorted(out.items())}


__all__ = [
    "ENTITY_TYPES",
    "FACTS",
    "FACT_GROUPS",
    "SLOTS",
    "SURFACE_AXIS_PATHS",
    "SemanticFact",
    "axis_capable_facts",
    "fact_names",
    "fact_names_by_group",
    "groups_summary",
    "is_known_fact",
    "semantic_fact",
    "surface_axis_path",
    "surface_facts",
    "unknown_facts",
]
