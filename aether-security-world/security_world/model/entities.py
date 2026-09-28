"""世界文档里的全部实体与文档块的**类型化内存形态**。

设计 §3 D6：frozen dataclass + 显式校验，不用 pydantic 隐式 coerce。因此每个
``from_document`` 都逐字段做严格类型判定，``bool`` 不当 ``int``、``None`` 不当
缺省、数组不当字符串、未知键直接抛错。

**这些数据类不包含任何行为**：求值在 L2（``policy`` / ``invariants`` /
``workflows``），证据充分性在 L3（``evidence`` / ``oracle``）。L1 只负责
"世界长什么样"，这样"读状态"与"读结论"在代码层面就是分开的（D2）。

命名说明：字段名与 schema 的 ``properties`` **逐字一致**（包括 ``type`` 这种
会遮蔽内置名的字段），否则 ``to_document()`` 的往返契约就要靠一张映射表维持，
而映射表正是静默丢字段的地方。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .documents import (
    Document,
    put_if_present,
    require_bool,
    require_bool_or_none,
    require_enum,
    require_fields,
    require_int_or_none,
    require_mapping,
    require_non_empty_str,
    require_non_negative_int,
    require_non_negative_int_or_none,
    require_object,
    require_object_or_none,
    require_str_or_none,
    require_str_tuple,
    require_str_tuple_or_none,
    require_value,
)
from .errors import ModelError

# --------------------------------------------------------------------------- #
# 枚举（与 schemas 逐字一致；唯一权威，供测试与 Gate 复用）
# --------------------------------------------------------------------------- #
ACTOR_TYPES: tuple[str, ...] = (
    "user",
    "administrator",
    "support_agent",
    "merchant",
    "service_account",
    "attacker_controlled_account",
    "anonymous_principal",
    "backend_service",
)
RESOURCE_TYPES: tuple[str, ...] = (
    "file",
    "order",
    "invoice",
    "message",
    "ticket",
    "secret",
    "api_key",
    "user_profile",
    "database_record",
    "cloud_resource",
)
SENSITIVITIES: tuple[str, ...] = ("public", "internal", "confidential", "restricted")
AUTHENTICATION_STATES: tuple[str, ...] = (
    "unauthenticated",
    "authenticated",
    "mfa_pending",
    "mfa_complete",
    "disabled",
    "locked",
    "password_reset_pending",
)
AUTH_STRENGTHS: tuple[str, ...] = (
    "none",
    "password",
    "password_mfa",
    "passkey",
    "hardware_token",
    "service_credential",
)
TOKEN_TYPES: tuple[str, ...] = (
    "access",
    "refresh",
    "id",
    "one_time_code",
    "reset_token",
    "invitation",
    "csrf",
    "api_key",
    "session_binding",
)
CREDENTIAL_TYPES: tuple[str, ...] = (
    "password",
    "passkey",
    "totp_secret",
    "api_key",
    "client_secret",
    "signing_key",
)
CREDENTIAL_STATUSES: tuple[str, ...] = ("active", "rotated", "revoked", "compromised", "expired")
SERVICE_TYPES: tuple[str, ...] = (
    "database",
    "cache",
    "queue",
    "object_store",
    "auth_provider",
    "payment_gateway",
    "llm_service",
    "webhook",
)
CONSISTENCY_MODELS: tuple[str, ...] = ("strong", "eventual", "read_your_writes", "causal")
SINK_KINDS: tuple[str, ...] = (
    "sql",
    "shell",
    "path",
    "html",
    "ssrf",
    "deserialization",
    "llm_prompt",
)
GRANTEE_TYPES: tuple[str, ...] = ("actor", "role", "group", "tenant", "public")
EVIDENCE_TYPES: tuple[str, ...] = (
    "identity_claim",
    "ownership_record",
    "policy_document",
    "session_record",
    "token_claim",
    "audit_log_entry",
    "cache_entry",
    "log_line",
    "http_header",
    "http_parameter",
    "request_body_field",
    "service_metadata",
    "derived_summary",
    "classifier_output",
    "human_attestation",
)
EVIDENCE_PROVENANCES: tuple[str, ...] = (
    "system_of_record",
    "replicated_cache",
    "client_supplied",
    "log_pipeline",
    "llm_derived",
    "heuristic_classifier",
    "human_attested",
)
#: 能"建立"决策关键事实的 trust_level（设计 §6 / §7.2，与 configs/default.json 同源）。
TRUSTED_ESTABLISHES: tuple[str, ...] = ("trusted", "semi_trusted")
TRUST_LEVELS: tuple[str, ...] = ("trusted", "semi_trusted", "untrusted", "derived")
FRESHNESSES: tuple[str, ...] = ("fresh", "stale", "expired", "unknown")
#: 20 类不变量目录（schema 枚举）。Agent B 的 ``ATTACK_CATEGORIES`` 必须等于它。
INVARIANT_CATEGORIES: tuple[str, ...] = (
    "ownership",
    "authorization",
    "tenant_isolation",
    "session_binding",
    "session_revocation",
    "token_scope",
    "token_lineage",
    "one_time_token",
    "workflow_transition",
    "replay",
    "privilege_version",
    "cache_consistency",
    "authentication_state",
    "trust_boundary",
    "resource_state",
    "temporal",
    "cross_flow_isolation",
    "cross_user_isolation",
    "cross_tenant_isolation",
    "state_freshness",
)
SEVERITIES: tuple[str, ...] = ("critical", "high", "medium", "low")
POLICY_EFFECTS: tuple[str, ...] = ("allow", "deny")
WORLD_ORIGINS: tuple[str, ...] = ("handcrafted", "step5_seed", "programmatic_mutation")
VALIDATION_OUTCOMES: tuple[str, ...] = ("accepted", "rejected", "pending")
HTTP_METHODS: tuple[str, ...] = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
APPLICATION_DOMAINS: tuple[str, ...] = (
    "e-commerce",
    "cloud_storage",
    "saas",
    "school_system",
    "finance_workflow",
    "ticketing",
    "logistics",
    "healthcare_workflow",
    "hr_system",
    "devops_platform",
    "code_hosting",
    "crm",
    "iam_system",
    "iot_management",
    "industrial_management",
    "api_marketplace",
    "content_platform",
    "messaging",
    "project_management",
    "subscription_system",
)
#: 41 类攻击族假设（**只在 spec 侧存在**，B7/B12：instance 侧没有这个字段）。
ATTACK_FAMILIES: tuple[str, ...] = (
    "idor_bola",
    "horizontal_privesc",
    "vertical_privesc",
    "tenant_isolation_violation",
    "stale_authorization",
    "revoked_session_reuse",
    "stale_session_privilege",
    "cross_account_session_misuse",
    "session_after_password_reset",
    "session_after_account_disable",
    "token_replay",
    "one_time_token_reuse",
    "cross_workflow_token_reuse",
    "cross_resource_token_reuse",
    "scope_mismatch",
    "audience_mismatch",
    "privilege_version_mismatch",
    "token_lineage_confusion",
    "workflow_bypass",
    "invalid_state_transition",
    "repeated_operation",
    "skipping_required_step",
    "irreversible_state_reversal",
    "state_machine_confusion",
    "stale_permission_cache",
    "inconsistent_revocation_state",
    "stale_ownership_cache",
    "cache_invalidation_failure",
    "inconsistent_replicas",
    "owner_mismatch",
    "tenant_mismatch",
    "resource_state_violation",
    "race_sensitive_state",
    "stale_object_reference",
    "sql_injection",
    "command_injection",
    "path_traversal",
    "xss",
    "ssrf",
    "unsafe_deserialization",
    "prompt_injection",
    "benign",
)


# --------------------------------------------------------------------------- #
# 小块文档
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Identity(Document):
    """``actors[].identity``。"""

    identity_id: str
    email: str | None = None
    verified: bool | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Identity":
        doc = require_fields(
            document,
            "actor.identity",
            allowed=("identity_id", "email", "verified"),
            required=("identity_id",),
        )
        return cls(
            identity_id=require_non_empty_str(doc["identity_id"], "actor.identity.identity_id"),
            email=require_str_or_none(doc.get("email"), "actor.identity.email"),
            verified=require_bool_or_none(doc.get("verified"), "actor.identity.verified"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {"identity_id": self.identity_id}
        put_if_present(out, "email", self.email)
        put_if_present(out, "verified", self.verified)
        return out


@dataclass(frozen=True)
class PrivilegeSnapshot(Document):
    """``sessions[].privilege_snapshot``——会话建立时的权限快照。

    ``privilege_version`` 与 actor 的活值比较就是"过期授权"样本的机制来源。
    """

    roles: tuple[str, ...]
    privileges: tuple[str, ...]
    privilege_version: int

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "PrivilegeSnapshot":
        doc = require_fields(
            document,
            "session.privilege_snapshot",
            allowed=("roles", "privileges", "privilege_version"),
            required=("roles", "privileges", "privilege_version"),
        )
        return cls(
            roles=require_str_tuple(doc["roles"], "session.privilege_snapshot.roles", unique=True),
            privileges=require_str_tuple(
                doc["privileges"], "session.privilege_snapshot.privileges", unique=True
            ),
            privilege_version=require_non_negative_int(
                doc["privilege_version"], "session.privilege_snapshot.privilege_version"
            ),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "roles": list(self.roles),
            "privileges": list(self.privileges),
            "privilege_version": self.privilege_version,
        }


@dataclass(frozen=True)
class AclEntry(Document):
    """``resources[].acl[]``。"""

    grantee: str
    permissions: tuple[str, ...]
    grantee_type: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "AclEntry":
        doc = require_fields(
            document,
            "resource.acl[]",
            allowed=("grantee", "grantee_type", "permissions"),
            required=("grantee", "permissions"),
        )
        return cls(
            grantee=require_non_empty_str(doc["grantee"], "resource.acl[].grantee"),
            permissions=require_str_tuple(
                doc["permissions"], "resource.acl[].permissions", unique=True
            ),
            grantee_type=(
                require_enum(doc["grantee_type"], "resource.acl[].grantee_type", GRANTEE_TYPES)
                if doc.get("grantee_type") is not None
                else None
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {"grantee": self.grantee, "permissions": list(self.permissions)}
        put_if_present(out, "grantee_type", self.grantee_type)
        return out


@dataclass(frozen=True)
class Sink(Document):
    """``services[].sinks[]``——传统 payload 类的**声明式**漏洞模型（§8.5 / R8）。

    oracle 从不检查 payload 字符串：只有"结构化污染输入到达
    ``parameterized=false`` 且 ``sanitized_on_path=false`` 的 sink"才算攻击。
    """

    sink_id: str
    kind: str
    parameterized: bool
    sanitized: bool | None = None
    reachable_from: tuple[str, ...] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Sink":
        doc = require_fields(
            document,
            "service.sinks[]",
            allowed=("sink_id", "kind", "parameterized", "sanitized", "reachable_from"),
            required=("sink_id", "kind", "parameterized"),
        )
        return cls(
            sink_id=require_non_empty_str(doc["sink_id"], "service.sinks[].sink_id"),
            kind=require_enum(doc["kind"], "service.sinks[].kind", SINK_KINDS),
            parameterized=require_bool(doc["parameterized"], "service.sinks[].parameterized"),
            sanitized=require_bool_or_none(doc.get("sanitized"), "service.sinks[].sanitized"),
            reachable_from=require_str_tuple_or_none(
                doc.get("reachable_from"), "service.sinks[].reachable_from", unique=True
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "sink_id": self.sink_id,
            "kind": self.kind,
            "parameterized": self.parameterized,
        }
        put_if_present(out, "sanitized", self.sanitized)
        put_if_present(out, "reachable_from", list(self.reachable_from) if self.reachable_from else None)
        return out


@dataclass(frozen=True)
class WorkflowTransitionRecord(Document):
    """``workflows[].instances[].history[]``——一次已发生的状态迁移。"""

    from_state: str
    to_state: str
    at: str
    actor_id: str

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "WorkflowTransitionRecord":
        doc = require_fields(
            document,
            "workflow.instances[].history[]",
            allowed=("from_state", "to_state", "at", "actor_id"),
            required=("from_state", "to_state", "at", "actor_id"),
        )
        return cls(
            from_state=require_non_empty_str(doc["from_state"], "history[].from_state"),
            to_state=require_non_empty_str(doc["to_state"], "history[].to_state"),
            at=require_non_empty_str(doc["at"], "history[].at"),
            actor_id=require_non_empty_str(doc["actor_id"], "history[].actor_id"),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "from_state": self.from_state,
            "to_state": self.to_state,
            "at": self.at,
            "actor_id": self.actor_id,
        }


@dataclass(frozen=True)
class WorkflowTransition(Document):
    """``workflows[].transitions[]``。``condition`` 是 DSL 文档（条件迁移）。"""

    from_state: str
    to_state: str
    condition: Mapping[str, Any] | None = None
    required_privileges: tuple[str, ...] | None = None
    reversible: bool | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "WorkflowTransition":
        doc = require_fields(
            document,
            "workflow.transitions[]",
            allowed=("from_state", "to_state", "condition", "required_privileges", "reversible"),
            required=("from_state", "to_state"),
        )
        return cls(
            from_state=require_non_empty_str(doc["from_state"], "transitions[].from_state"),
            to_state=require_non_empty_str(doc["to_state"], "transitions[].to_state"),
            condition=require_object_or_none(doc.get("condition"), "transitions[].condition"),
            required_privileges=require_str_tuple_or_none(
                doc.get("required_privileges"), "transitions[].required_privileges", unique=True
            ),
            reversible=require_bool_or_none(doc.get("reversible"), "transitions[].reversible"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {"from_state": self.from_state, "to_state": self.to_state}
        put_if_present(out, "condition", dict(self.condition) if self.condition is not None else None)
        put_if_present(
            out,
            "required_privileges",
            list(self.required_privileges) if self.required_privileges else None,
        )
        put_if_present(out, "reversible", self.reversible)
        return out


@dataclass(frozen=True)
class WorkflowInstance(Document):
    """``workflows[].instances[]``——一个具体的工作流实例（``workflow_instance`` 实体）。"""

    instance_id: str
    resource_id: str
    current_state: str
    history: tuple[WorkflowTransitionRecord, ...] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "WorkflowInstance":
        doc = require_fields(
            document,
            "workflow.instances[]",
            allowed=("instance_id", "resource_id", "current_state", "history"),
            required=("instance_id", "resource_id", "current_state"),
        )
        raw_history = doc.get("history")
        if raw_history is not None and (
            isinstance(raw_history, Mapping) or not isinstance(raw_history, Sequence)
        ):
            raise ModelError("workflow.instances[].history 必须是数组")
        return cls(
            instance_id=require_non_empty_str(doc["instance_id"], "instances[].instance_id"),
            resource_id=require_non_empty_str(doc["resource_id"], "instances[].resource_id"),
            current_state=require_non_empty_str(doc["current_state"], "instances[].current_state"),
            history=(
                tuple(WorkflowTransitionRecord.from_document(item) for item in raw_history)
                if raw_history is not None
                else None
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "instance_id": self.instance_id,
            "resource_id": self.resource_id,
            "current_state": self.current_state,
        }
        put_if_present(
            out,
            "history",
            [record.to_document() for record in self.history]
            if self.history is not None
            else None,
        )
        return out


# --------------------------------------------------------------------------- #
# 实体
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Role(Document):
    role_id: str
    name: str
    privileges: tuple[str, ...]
    description: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Role":
        doc = require_fields(
            document, "roles[]", allowed=("role_id", "name", "privileges", "description"),
            required=("role_id", "name", "privileges"),
        )
        return cls(
            role_id=require_non_empty_str(doc["role_id"], "roles[].role_id"),
            name=require_non_empty_str(doc["name"], "roles[].name"),
            privileges=require_str_tuple(doc["privileges"], "roles[].privileges", unique=True),
            description=require_str_or_none(doc.get("description"), "roles[].description"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "role_id": self.role_id,
            "name": self.name,
            "privileges": list(self.privileges),
        }
        put_if_present(out, "description", self.description)
        return out


@dataclass(frozen=True)
class Actor(Document):
    actor_id: str
    actor_type: str
    identity: Identity
    roles: tuple[str, ...]
    tenant: str | None
    authentication_state: str
    display_name: str | None = None
    groups: tuple[str, ...] | None = None
    privileges: tuple[str, ...] | None = None
    privilege_version: int | None = None
    attributes: Mapping[str, Any] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Actor":
        doc = require_fields(
            document,
            "actors[]",
            allowed=(
                "actor_id", "actor_type", "display_name", "identity", "roles", "groups", "tenant",
                "privileges", "authentication_state", "privilege_version", "attributes",
            ),
            required=("actor_id", "actor_type", "identity", "roles", "tenant", "authentication_state"),
        )
        return cls(
            actor_id=require_non_empty_str(doc["actor_id"], "actors[].actor_id"),
            actor_type=require_enum(doc["actor_type"], "actors[].actor_type", ACTOR_TYPES),
            identity=Identity.from_document(require_mapping(doc["identity"], "actors[].identity")),
            roles=require_str_tuple(doc["roles"], "actors[].roles", unique=True),
            tenant=require_str_or_none(doc["tenant"], "actors[].tenant"),
            authentication_state=require_enum(
                doc["authentication_state"], "actors[].authentication_state", AUTHENTICATION_STATES
            ),
            display_name=require_str_or_none(doc.get("display_name"), "actors[].display_name"),
            groups=require_str_tuple_or_none(doc.get("groups"), "actors[].groups", unique=True),
            privileges=require_str_tuple_or_none(
                doc.get("privileges"), "actors[].privileges", unique=True
            ),
            privilege_version=require_non_negative_int_or_none(
                doc.get("privilege_version"), "actors[].privilege_version"
            ),
            attributes=require_object_or_none(doc.get("attributes"), "actors[].attributes"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "actor_id": self.actor_id,
            "actor_type": self.actor_type,
            "identity": self.identity.to_document(),
            "roles": list(self.roles),
            "tenant": self.tenant,
            "authentication_state": self.authentication_state,
        }
        put_if_present(out, "display_name", self.display_name)
        put_if_present(out, "groups", list(self.groups) if self.groups else None)
        put_if_present(out, "privileges", list(self.privileges) if self.privileges else None)
        put_if_present(out, "privilege_version", self.privilege_version)
        put_if_present(out, "attributes", dict(self.attributes) if self.attributes else None)
        return out


@dataclass(frozen=True)
class Resource(Document):
    resource_id: str
    resource_type: str
    owner: str
    sensitivity: str
    state: str
    display_name: str | None = None
    tenant: str | None = None
    acl: tuple[AclEntry, ...] | None = None
    attributes: Mapping[str, Any] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Resource":
        doc = require_fields(
            document,
            "resources[]",
            allowed=(
                "resource_id", "resource_type", "display_name", "owner", "tenant", "acl",
                "sensitivity", "state", "attributes",
            ),
            required=("resource_id", "resource_type", "owner", "sensitivity", "state"),
        )
        raw_acl = doc.get("acl")
        acl: tuple[AclEntry, ...] | None = None
        if raw_acl is not None:
            if isinstance(raw_acl, Mapping) or not isinstance(raw_acl, Sequence):
                raise ModelError("resources[].acl 必须是数组")
            acl = tuple(AclEntry.from_document(item) for item in raw_acl)
        return cls(
            resource_id=require_non_empty_str(doc["resource_id"], "resources[].resource_id"),
            resource_type=require_enum(
                doc["resource_type"], "resources[].resource_type", RESOURCE_TYPES
            ),
            owner=require_non_empty_str(doc["owner"], "resources[].owner"),
            sensitivity=require_enum(doc["sensitivity"], "resources[].sensitivity", SENSITIVITIES),
            state=require_non_empty_str(doc["state"], "resources[].state"),
            display_name=require_str_or_none(doc.get("display_name"), "resources[].display_name"),
            tenant=require_str_or_none(doc.get("tenant"), "resources[].tenant"),
            acl=acl,
            attributes=require_object_or_none(doc.get("attributes"), "resources[].attributes"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "resource_id": self.resource_id,
            "resource_type": self.resource_type,
            "owner": self.owner,
            "sensitivity": self.sensitivity,
            "state": self.state,
        }
        put_if_present(out, "display_name", self.display_name)
        put_if_present(out, "tenant", self.tenant)
        put_if_present(out, "acl", [entry.to_document() for entry in self.acl] if self.acl else None)
        put_if_present(out, "attributes", dict(self.attributes) if self.attributes else None)
        return out


@dataclass(frozen=True)
class Session(Document):
    session_id: str
    principal: str
    created_at: str
    authenticated_at: str
    auth_strength: str
    valid: bool
    revoked: bool
    expires_at: str
    privilege_snapshot: PrivilegeSnapshot
    flow_id: str
    revoked_at: str | None = None
    revocation_reason: str | None = None
    bound_to: Mapping[str, Any] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Session":
        doc = require_fields(
            document,
            "sessions[]",
            allowed=(
                "session_id", "principal", "created_at", "authenticated_at", "auth_strength",
                "valid", "revoked", "revoked_at", "revocation_reason", "expires_at",
                "privilege_snapshot", "flow_id", "bound_to",
            ),
            required=(
                "session_id", "principal", "created_at", "authenticated_at", "auth_strength",
                "valid", "revoked", "expires_at", "privilege_snapshot", "flow_id",
            ),
        )
        return cls(
            session_id=require_non_empty_str(doc["session_id"], "sessions[].session_id"),
            principal=require_non_empty_str(doc["principal"], "sessions[].principal"),
            created_at=require_non_empty_str(doc["created_at"], "sessions[].created_at"),
            authenticated_at=require_non_empty_str(
                doc["authenticated_at"], "sessions[].authenticated_at"
            ),
            auth_strength=require_enum(
                doc["auth_strength"], "sessions[].auth_strength", AUTH_STRENGTHS
            ),
            valid=require_bool(doc["valid"], "sessions[].valid"),
            revoked=require_bool(doc["revoked"], "sessions[].revoked"),
            expires_at=require_non_empty_str(doc["expires_at"], "sessions[].expires_at"),
            privilege_snapshot=PrivilegeSnapshot.from_document(
                require_mapping(doc["privilege_snapshot"], "sessions[].privilege_snapshot")
            ),
            flow_id=require_non_empty_str(doc["flow_id"], "sessions[].flow_id"),
            revoked_at=require_str_or_none(doc.get("revoked_at"), "sessions[].revoked_at"),
            revocation_reason=require_str_or_none(
                doc.get("revocation_reason"), "sessions[].revocation_reason"
            ),
            bound_to=require_object_or_none(doc.get("bound_to"), "sessions[].bound_to"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "session_id": self.session_id,
            "principal": self.principal,
            "created_at": self.created_at,
            "authenticated_at": self.authenticated_at,
            "auth_strength": self.auth_strength,
            "valid": self.valid,
            "revoked": self.revoked,
            "expires_at": self.expires_at,
            "privilege_snapshot": self.privilege_snapshot.to_document(),
            "flow_id": self.flow_id,
        }
        put_if_present(out, "revoked_at", self.revoked_at)
        put_if_present(out, "revocation_reason", self.revocation_reason)
        put_if_present(out, "bound_to", dict(self.bound_to) if self.bound_to else None)
        return out


@dataclass(frozen=True)
class Token(Document):
    token_id: str
    issuer: str
    subject: str
    audience: tuple[str, ...]
    scope: tuple[str, ...]
    created_at: str
    expires_at: str
    one_time: bool
    used: bool
    parent_token: str | None
    flow_id: str
    privilege_version: int
    token_type: str | None = None
    used_at: str | None = None
    bound_resource: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Token":
        doc = require_fields(
            document,
            "tokens[]",
            allowed=(
                "token_id", "token_type", "issuer", "subject", "audience", "scope", "created_at",
                "expires_at", "one_time", "used", "used_at", "parent_token", "flow_id",
                "privilege_version", "bound_resource",
            ),
            required=(
                "token_id", "issuer", "subject", "audience", "scope", "created_at", "expires_at",
                "one_time", "used", "parent_token", "flow_id", "privilege_version",
            ),
        )
        return cls(
            token_id=require_non_empty_str(doc["token_id"], "tokens[].token_id"),
            issuer=require_non_empty_str(doc["issuer"], "tokens[].issuer"),
            subject=require_non_empty_str(doc["subject"], "tokens[].subject"),
            audience=require_str_tuple(doc["audience"], "tokens[].audience", unique=True),
            scope=require_str_tuple(doc["scope"], "tokens[].scope", unique=True),
            created_at=require_non_empty_str(doc["created_at"], "tokens[].created_at"),
            expires_at=require_non_empty_str(doc["expires_at"], "tokens[].expires_at"),
            one_time=require_bool(doc["one_time"], "tokens[].one_time"),
            used=require_bool(doc["used"], "tokens[].used"),
            parent_token=require_str_or_none(doc["parent_token"], "tokens[].parent_token"),
            flow_id=require_non_empty_str(doc["flow_id"], "tokens[].flow_id"),
            privilege_version=require_non_negative_int(
                doc["privilege_version"], "tokens[].privilege_version"
            ),
            token_type=(
                require_enum(doc["token_type"], "tokens[].token_type", TOKEN_TYPES)
                if doc.get("token_type") is not None
                else None
            ),
            used_at=require_str_or_none(doc.get("used_at"), "tokens[].used_at"),
            bound_resource=require_str_or_none(doc.get("bound_resource"), "tokens[].bound_resource"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "token_id": self.token_id,
            "issuer": self.issuer,
            "subject": self.subject,
            "audience": list(self.audience),
            "scope": list(self.scope),
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "one_time": self.one_time,
            "used": self.used,
            "parent_token": self.parent_token,
            "flow_id": self.flow_id,
            "privilege_version": self.privilege_version,
        }
        put_if_present(out, "token_type", self.token_type)
        put_if_present(out, "used_at", self.used_at)
        put_if_present(out, "bound_resource", self.bound_resource)
        return out


@dataclass(frozen=True)
class Credential(Document):
    credential_id: str
    credential_type: str
    holder: str
    status: str
    rotated_at: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Credential":
        doc = require_fields(
            document,
            "credentials[]",
            allowed=("credential_id", "credential_type", "holder", "status", "rotated_at"),
            required=("credential_id", "credential_type", "holder", "status"),
        )
        return cls(
            credential_id=require_non_empty_str(doc["credential_id"], "credentials[].credential_id"),
            credential_type=require_enum(
                doc["credential_type"], "credentials[].credential_type", CREDENTIAL_TYPES
            ),
            holder=require_non_empty_str(doc["holder"], "credentials[].holder"),
            status=require_enum(doc["status"], "credentials[].status", CREDENTIAL_STATUSES),
            rotated_at=require_str_or_none(doc.get("rotated_at"), "credentials[].rotated_at"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "credential_id": self.credential_id,
            "credential_type": self.credential_type,
            "holder": self.holder,
            "status": self.status,
        }
        put_if_present(out, "rotated_at", self.rotated_at)
        return out


@dataclass(frozen=True)
class Workflow(Document):
    workflow_id: str
    name: str
    states: tuple[str, ...]
    initial_state: str
    transitions: tuple[WorkflowTransition, ...]
    instances: tuple[WorkflowInstance, ...] = ()

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Workflow":
        doc = require_fields(
            document,
            "workflows[]",
            allowed=("workflow_id", "name", "states", "initial_state", "transitions", "instances"),
            required=("workflow_id", "name", "states", "initial_state", "transitions"),
        )
        raw_transitions = doc["transitions"]
        if isinstance(raw_transitions, Mapping) or not isinstance(raw_transitions, Sequence):
            raise ModelError("workflows[].transitions 必须是数组")
        raw_instances = doc.get("instances") or ()
        if isinstance(raw_instances, Mapping) or not isinstance(raw_instances, Sequence):
            raise ModelError("workflows[].instances 必须是数组")
        return cls(
            workflow_id=require_non_empty_str(doc["workflow_id"], "workflows[].workflow_id"),
            name=require_non_empty_str(doc["name"], "workflows[].name"),
            states=require_str_tuple(doc["states"], "workflows[].states", unique=True),
            initial_state=require_non_empty_str(doc["initial_state"], "workflows[].initial_state"),
            transitions=tuple(WorkflowTransition.from_document(item) for item in raw_transitions),
            instances=tuple(WorkflowInstance.from_document(item) for item in raw_instances),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "states": list(self.states),
            "initial_state": self.initial_state,
            "transitions": [item.to_document() for item in self.transitions],
            "instances": [item.to_document() for item in self.instances],
        }


@dataclass(frozen=True)
class Service(Document):
    service_id: str
    service_type: str
    trust_boundary: str | None = None
    consistency_model: str | None = None
    sinks: tuple[Sink, ...] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Service":
        doc = require_fields(
            document,
            "services[]",
            allowed=("service_id", "service_type", "trust_boundary", "consistency_model", "sinks"),
            required=("service_id", "service_type"),
        )
        raw_sinks = doc.get("sinks")
        sinks: tuple[Sink, ...] | None = None
        if raw_sinks is not None:
            if isinstance(raw_sinks, Mapping) or not isinstance(raw_sinks, Sequence):
                raise ModelError("services[].sinks 必须是数组")
            sinks = tuple(Sink.from_document(item) for item in raw_sinks)
        return cls(
            service_id=require_non_empty_str(doc["service_id"], "services[].service_id"),
            service_type=require_enum(
                doc["service_type"], "services[].service_type", SERVICE_TYPES
            ),
            trust_boundary=require_str_or_none(
                doc.get("trust_boundary"), "services[].trust_boundary"
            ),
            consistency_model=(
                require_enum(doc["consistency_model"], "services[].consistency_model", CONSISTENCY_MODELS)
                if doc.get("consistency_model") is not None
                else None
            ),
            sinks=sinks,
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {"service_id": self.service_id, "service_type": self.service_type}
        put_if_present(out, "trust_boundary", self.trust_boundary)
        put_if_present(out, "consistency_model", self.consistency_model)
        put_if_present(out, "sinks", [sink.to_document() for sink in self.sinks] if self.sinks else None)
        return out


@dataclass(frozen=True)
class CacheEntry(Document):
    """缓存条目。``cached_subject`` 是 ID 视图路径（S4：原先是裸 id，无法解析）。"""

    cache_id: str
    cached_subject: str
    cached_value: Any
    source_of_truth: str
    fresh: bool
    ttl_seconds: int | None = None
    populated_at: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "CacheEntry":
        doc = require_fields(
            document,
            "caches[]",
            allowed=(
                "cache_id", "cached_subject", "cached_value", "source_of_truth", "fresh",
                "ttl_seconds", "populated_at",
            ),
            required=("cache_id", "cached_subject", "cached_value", "source_of_truth", "fresh"),
        )
        return cls(
            cache_id=require_non_empty_str(doc["cache_id"], "caches[].cache_id"),
            cached_subject=require_non_empty_str(doc["cached_subject"], "caches[].cached_subject"),
            cached_value=require_value(doc["cached_value"], "caches[].cached_value"),
            source_of_truth=require_non_empty_str(
                doc["source_of_truth"], "caches[].source_of_truth"
            ),
            fresh=require_bool(doc["fresh"], "caches[].fresh"),
            ttl_seconds=require_non_negative_int_or_none(
                doc.get("ttl_seconds"), "caches[].ttl_seconds"
            ),
            populated_at=require_str_or_none(doc.get("populated_at"), "caches[].populated_at"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "cache_id": self.cache_id,
            "cached_subject": self.cached_subject,
            "cached_value": self.cached_value,
            "source_of_truth": self.source_of_truth,
            "fresh": self.fresh,
        }
        put_if_present(out, "ttl_seconds", self.ttl_seconds)
        put_if_present(out, "populated_at", self.populated_at)
        return out


@dataclass(frozen=True)
class TrustBoundary(Document):
    boundary_id: str
    inside: tuple[str, ...]
    outside: tuple[str, ...]
    name: str | None = None
    crossing_requires: tuple[str, ...] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "TrustBoundary":
        doc = require_fields(
            document,
            "trust_boundaries[]",
            allowed=("boundary_id", "name", "inside", "outside", "crossing_requires"),
            required=("boundary_id", "inside", "outside"),
        )
        return cls(
            boundary_id=require_non_empty_str(doc["boundary_id"], "trust_boundaries[].boundary_id"),
            inside=require_str_tuple(doc["inside"], "trust_boundaries[].inside"),
            outside=require_str_tuple(doc["outside"], "trust_boundaries[].outside"),
            name=require_str_or_none(doc.get("name"), "trust_boundaries[].name"),
            crossing_requires=require_str_tuple_or_none(
                doc.get("crossing_requires"), "trust_boundaries[].crossing_requires", unique=True
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "boundary_id": self.boundary_id,
            "inside": list(self.inside),
            "outside": list(self.outside),
        }
        put_if_present(out, "name", self.name)
        put_if_present(
            out,
            "crossing_requires",
            list(self.crossing_requires) if self.crossing_requires else None,
        )
        return out


@dataclass(frozen=True)
class Endpoint(Document):
    path: str
    method: str
    operation: str
    resource_type: str | None = None
    auth_required: bool | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Endpoint":
        doc = require_fields(
            document,
            "application.endpoints[]",
            allowed=("path", "method", "operation", "resource_type", "auth_required"),
            required=("path", "method", "operation"),
        )
        return cls(
            path=require_non_empty_str(doc["path"], "endpoints[].path"),
            method=require_enum(doc["method"], "endpoints[].method", HTTP_METHODS),
            operation=require_non_empty_str(doc["operation"], "endpoints[].operation"),
            resource_type=require_str_or_none(doc.get("resource_type"), "endpoints[].resource_type"),
            auth_required=require_bool_or_none(doc.get("auth_required"), "endpoints[].auth_required"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "path": self.path,
            "method": self.method,
            "operation": self.operation,
        }
        put_if_present(out, "resource_type", self.resource_type)
        put_if_present(out, "auth_required", self.auth_required)
        return out


@dataclass(frozen=True)
class Application(Document):
    name: str
    description: str
    endpoints: tuple[Endpoint, ...] = ()

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Application":
        doc = require_fields(
            document,
            "application",
            allowed=("name", "description", "endpoints"),
            required=("name", "description"),
        )
        raw = doc.get("endpoints") or ()
        if isinstance(raw, Mapping) or not isinstance(raw, Sequence):
            raise ModelError("application.endpoints 必须是数组")
        return cls(
            name=require_non_empty_str(doc["name"], "application.name"),
            description=require_non_empty_str(doc["description"], "application.description"),
            endpoints=tuple(Endpoint.from_document(item) for item in raw),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "endpoints": [endpoint.to_document() for endpoint in self.endpoints],
        }

    def operations(self) -> frozenset[str]:
        """声明过的全部 operation 名（``applies_to`` 校验用）。"""
        return frozenset(endpoint.operation for endpoint in self.endpoints)


@dataclass(frozen=True)
class WorldProvenance(Document):
    """世界的来源。``generation_timestamp`` 是 VirtualClock 派生值（§8.1 / S19）。"""

    origin: str
    generator_model: str
    generator_model_version: str
    prompt_version: str
    prompt_hash: str
    generation_timestamp: str
    raw_generation_id: str | None = None
    decoding_parameters: Mapping[str, Any] | None = None
    validation_outcome: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "WorldProvenance":
        doc = require_fields(
            document,
            "provenance",
            allowed=(
                "origin", "generator_model", "generator_model_version", "prompt_version",
                "prompt_hash", "generation_timestamp", "raw_generation_id",
                "decoding_parameters", "validation_outcome",
            ),
            required=(
                "origin", "generator_model", "generator_model_version", "prompt_version",
                "prompt_hash", "generation_timestamp",
            ),
        )
        return cls(
            origin=require_enum(doc["origin"], "provenance.origin", WORLD_ORIGINS),
            generator_model=require_non_empty_str(
                doc["generator_model"], "provenance.generator_model"
            ),
            generator_model_version=require_non_empty_str(
                doc["generator_model_version"], "provenance.generator_model_version"
            ),
            prompt_version=require_non_empty_str(doc["prompt_version"], "provenance.prompt_version"),
            prompt_hash=require_non_empty_str(doc["prompt_hash"], "provenance.prompt_hash"),
            generation_timestamp=require_non_empty_str(
                doc["generation_timestamp"], "provenance.generation_timestamp"
            ),
            raw_generation_id=require_str_or_none(
                doc.get("raw_generation_id"), "provenance.raw_generation_id"
            ),
            decoding_parameters=require_object_or_none(
                doc.get("decoding_parameters"), "provenance.decoding_parameters"
            ),
            validation_outcome=(
                require_enum(
                    doc["validation_outcome"], "provenance.validation_outcome", VALIDATION_OUTCOMES
                )
                if doc.get("validation_outcome") is not None
                else None
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "origin": self.origin,
            "generator_model": self.generator_model,
            "generator_model_version": self.generator_model_version,
            "prompt_version": self.prompt_version,
            "prompt_hash": self.prompt_hash,
            "generation_timestamp": self.generation_timestamp,
        }
        put_if_present(out, "raw_generation_id", self.raw_generation_id)
        put_if_present(
            out,
            "decoding_parameters",
            dict(self.decoding_parameters) if self.decoding_parameters else None,
        )
        put_if_present(out, "validation_outcome", self.validation_outcome)
        return out

    def generator_id(self) -> str:
        """``generator_id`` group key 的取值（S20：config 里原先缺这两个 key）。"""
        return self.generator_model


@dataclass(frozen=True)
class CompileRecord(Document):
    """``compile`` 审计块：编译器对 spec 做了什么（§4.1 / B20）。"""

    compiler_version: str
    source_spec_id: str
    derived_world_family_id: bool = True
    dropped_hypothesis_fields: tuple[str, ...] = ()
    reason_codes: tuple[str, ...] = ()

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "CompileRecord":
        doc = require_fields(
            document,
            "compile",
            allowed=(
                "compiler_version", "source_spec_id", "derived_world_family_id",
                "dropped_hypothesis_fields", "reason_codes",
            ),
            required=("compiler_version", "source_spec_id"),
        )
        return cls(
            compiler_version=require_non_empty_str(
                doc["compiler_version"], "compile.compiler_version"
            ),
            source_spec_id=require_non_empty_str(doc["source_spec_id"], "compile.source_spec_id"),
            derived_world_family_id=require_bool(
                doc.get("derived_world_family_id", True), "compile.derived_world_family_id"
            ),
            dropped_hypothesis_fields=require_str_tuple(
                doc.get("dropped_hypothesis_fields") or (),
                "compile.dropped_hypothesis_fields",
                unique=True,
            ),
            reason_codes=require_str_tuple(
                doc.get("reason_codes") or (), "compile.reason_codes", unique=True
            ),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "compiler_version": self.compiler_version,
            "source_spec_id": self.source_spec_id,
            "derived_world_family_id": self.derived_world_family_id,
            "dropped_hypothesis_fields": list(self.dropped_hypothesis_fields),
            "reason_codes": list(self.reason_codes),
        }


@dataclass(frozen=True)
class StateSnapshot(Document):
    """``state_history[]`` / ``current_state``。

    单调性 JSON Schema 表达不了，由 Gate 2 强制（§4.4 / S3）：
    ``state_history[i].at <= state_history[i+1].at`` 且
    ``current_state.at >= max(history.at)``。
    """

    snapshot_id: str
    at: str
    label: str
    actor_states: Mapping[str, Any] | None = None
    session_states: Mapping[str, Any] | None = None
    token_states: Mapping[str, Any] | None = None
    workflow_states: Mapping[str, Any] | None = None
    resource_states: Mapping[str, Any] | None = None
    free_form: Mapping[str, Any] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "StateSnapshot":
        doc = require_fields(
            document,
            "state_snapshot",
            allowed=(
                "snapshot_id", "at", "label", "actor_states", "session_states", "token_states",
                "workflow_states", "resource_states", "free_form",
            ),
            required=("snapshot_id", "at", "label"),
        )
        return cls(
            snapshot_id=require_non_empty_str(doc["snapshot_id"], "snapshot.snapshot_id"),
            at=require_non_empty_str(doc["at"], "snapshot.at"),
            label=require_non_empty_str(doc["label"], "snapshot.label"),
            actor_states=require_object_or_none(doc.get("actor_states"), "snapshot.actor_states"),
            session_states=require_object_or_none(
                doc.get("session_states"), "snapshot.session_states"
            ),
            token_states=require_object_or_none(doc.get("token_states"), "snapshot.token_states"),
            workflow_states=require_object_or_none(
                doc.get("workflow_states"), "snapshot.workflow_states"
            ),
            resource_states=require_object_or_none(
                doc.get("resource_states"), "snapshot.resource_states"
            ),
            free_form=require_object_or_none(doc.get("free_form"), "snapshot.free_form"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "snapshot_id": self.snapshot_id,
            "at": self.at,
            "label": self.label,
        }
        for key in ("actor_states", "session_states", "token_states", "workflow_states",
                    "resource_states", "free_form"):
            value = getattr(self, key)
            put_if_present(out, key, dict(value) if value else None)
        return out


@dataclass(frozen=True)
class EvidenceItem(Document):
    """一条证据：对某个世界状态路径的**断言**（§6）。

    ``required_for_decision`` 已从 schema 删除（B3）："决策需要什么"只有
    oracle 一个所有者。``trust_level`` / ``attacker_controllable`` /
    ``visible_in_observation`` 是 oracle 与 Gate 侧的字段，**不**进
    ``observation.model_visible``（D7）。
    """

    evidence_id: str
    type: str
    asserts_ref: str
    value: Any
    source: str
    provenance: str
    trust_level: str
    freshness: str
    attacker_controllable: bool
    visible_in_observation: bool
    timestamp: str | None = None
    contradicts: tuple[str, ...] | None = None
    notes: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "EvidenceItem":
        doc = require_fields(
            document,
            "evidence[]",
            allowed=(
                "evidence_id", "type", "asserts_ref", "value", "source", "provenance",
                "trust_level", "timestamp", "freshness", "attacker_controllable",
                "visible_in_observation", "contradicts", "notes", "$comment",
            ),
            required=(
                "evidence_id", "type", "asserts_ref", "value", "source", "provenance",
                "trust_level", "freshness", "attacker_controllable", "visible_in_observation",
            ),
        )
        return cls(
            evidence_id=require_non_empty_str(doc["evidence_id"], "evidence[].evidence_id"),
            type=require_enum(doc["type"], "evidence[].type", EVIDENCE_TYPES),
            asserts_ref=require_non_empty_str(doc["asserts_ref"], "evidence[].asserts_ref"),
            value=require_value(doc["value"], "evidence[].value"),
            source=require_non_empty_str(doc["source"], "evidence[].source"),
            provenance=require_enum(doc["provenance"], "evidence[].provenance", EVIDENCE_PROVENANCES),
            trust_level=require_enum(doc["trust_level"], "evidence[].trust_level", TRUST_LEVELS),
            freshness=require_enum(doc["freshness"], "evidence[].freshness", FRESHNESSES),
            attacker_controllable=require_bool(
                doc["attacker_controllable"], "evidence[].attacker_controllable"
            ),
            visible_in_observation=require_bool(
                doc["visible_in_observation"], "evidence[].visible_in_observation"
            ),
            timestamp=require_str_or_none(doc.get("timestamp"), "evidence[].timestamp"),
            contradicts=require_str_tuple_or_none(
                doc.get("contradicts"), "evidence[].contradicts", unique=True
            ),
            notes=require_str_or_none(doc.get("notes"), "evidence[].notes"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "evidence_id": self.evidence_id,
            "type": self.type,
            "asserts_ref": self.asserts_ref,
            "value": self.value,
            "source": self.source,
            "provenance": self.provenance,
            "trust_level": self.trust_level,
            "freshness": self.freshness,
            "attacker_controllable": self.attacker_controllable,
            "visible_in_observation": self.visible_in_observation,
        }
        put_if_present(out, "timestamp", self.timestamp)
        put_if_present(
            out, "contradicts", list(self.contradicts) if self.contradicts else None
        )
        put_if_present(out, "notes", self.notes)
        return out

    def is_establishing(self, trusted: tuple[str, ...] = TRUSTED_ESTABLISHES) -> bool:
        """是否属于"能建立决策关键事实"的信任集（§6 的信任规则）。"""
        return self.trust_level in trusted

    def model_visible_projection(self) -> dict[str, Any]:
        """``observation.model_visible.evidence`` 的七键投影（§5.2 / D7）。

        只有 ``evidence_id`` / ``type`` / ``asserts_ref`` / ``value`` /
        ``source`` / ``provenance`` / ``timestamp`` 七个键——模型必须自己从
        provenance 推断可信度，那正是要训练的能力；``trust_level`` 是 oracle
        的分类结论，给它等于直接发答案。
        """
        out: dict[str, Any] = {
            "evidence_id": self.evidence_id,
            "type": self.type,
            "asserts_ref": self.asserts_ref,
            "value": self.value,
            "source": self.source,
            "provenance": self.provenance,
        }
        put_if_present(out, "timestamp", self.timestamp)
        return out


@dataclass(frozen=True)
class ActionPattern(Document):
    """``policies[].action``——策略匹配的动作模式。"""

    operation: str
    resource_type: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "ActionPattern":
        doc = require_fields(
            document,
            "policy.action",
            allowed=("operation", "resource_type"),
            required=("operation",),
        )
        return cls(
            operation=require_non_empty_str(doc["operation"], "policy.action.operation"),
            resource_type=require_str_or_none(
                doc.get("resource_type"), "policy.action.resource_type"
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {"operation": self.operation}
        put_if_present(out, "resource_type", self.resource_type)
        return out

    def matches(self, operation: str, resource_type: str | None = None) -> bool:
        """operation 相等或 ``*``；``resource_type`` 省略表示任意（§7.3）。"""
        if self.operation != "*" and self.operation != operation:
            return False
        if self.resource_type is not None and resource_type is not None:
            return self.resource_type == resource_type
        return True


@dataclass(frozen=True)
class PolicyRule(Document):
    """一条策略规则。

    ``condition`` 以**原始 DSL 文档**存放（``Mapping``）：``parse_expr`` /
    ``eval_expr`` 是 L2 ``security_world/policy`` 的公共符号，L1 不重复实现，
    只保证文档形态合法（jsonschema）与可遍历（``iter_document_ref_paths``）。
    """

    policy_id: str
    action: ActionPattern
    effect: str
    condition: Mapping[str, Any]
    description: str | None = None
    priority: int | None = None
    is_default_rule: bool | None = None
    requires_fresh: bool | None = None
    rationale: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "PolicyRule":
        doc = require_fields(
            document,
            "policies[]",
            allowed=(
                "policy_id", "description", "action", "effect", "condition", "priority",
                "is_default_rule", "requires_fresh", "rationale",
            ),
            required=("policy_id", "action", "effect", "condition"),
        )
        return cls(
            policy_id=require_non_empty_str(doc["policy_id"], "policies[].policy_id"),
            action=ActionPattern.from_document(require_mapping(doc["action"], "policies[].action")),
            effect=require_enum(doc["effect"], "policies[].effect", POLICY_EFFECTS),
            condition=require_object(doc["condition"], "policies[].condition"),
            description=require_str_or_none(doc.get("description"), "policies[].description"),
            priority=require_int_or_none(doc.get("priority"), "policies[].priority"),
            is_default_rule=require_bool_or_none(
                doc.get("is_default_rule"), "policies[].is_default_rule"
            ),
            requires_fresh=require_bool_or_none(
                doc.get("requires_fresh"), "policies[].requires_fresh"
            ),
            rationale=require_str_or_none(doc.get("rationale"), "policies[].rationale"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "policy_id": self.policy_id,
            "action": self.action.to_document(),
            "effect": self.effect,
            "condition": dict(self.condition),
        }
        put_if_present(out, "description", self.description)
        put_if_present(out, "priority", self.priority)
        put_if_present(out, "is_default_rule", self.is_default_rule)
        put_if_present(out, "requires_fresh", self.requires_fresh)
        put_if_present(out, "rationale", self.rationale)
        return out

    @property
    def effective_priority(self) -> int:
        """``priority`` 的有效值（文档缺省 = schema default 0）。"""
        return 0 if self.priority is None else self.priority

    @property
    def is_default(self) -> bool:
        """是否是闭世界兜底规则（文档缺省 = false）。

        ``world_truth = attack`` 要求否定来自**非** default 规则、或某条不变量
        被违反；仅 default-deny 命中得到 ``unauthorized``（§8.2 / B10）。
        """
        return self.is_default_rule is True

    @property
    def needs_fresh(self) -> bool:
        """决策关键事实是否必须由 fresh 证据建立（文档缺省 = false）。"""
        return self.requires_fresh is True


@dataclass(frozen=True)
class Invariant(Document):
    """一条安全不变量——``world_truth`` 的唯一生产者（§7.4 / B2）。

    ``severity`` **只进报告**，不参与聚合：任何被违反的安全不变量都是 attack，
    否则"把 severity 标成 high 就能让违反不产生 attack 标签"会把标签权威交给
    作者可写的枚举。
    """

    invariant_id: str
    category: str
    expr: Mapping[str, Any]
    severity: str
    applies_to: tuple[str, ...]
    description: str | None = None
    expected_violation_when: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Invariant":
        doc = require_fields(
            document,
            "invariants[]",
            allowed=(
                "invariant_id", "category", "expr", "severity", "applies_to", "description",
                "expected_violation_when",
            ),
            required=("invariant_id", "category", "expr", "severity", "applies_to"),
        )
        return cls(
            invariant_id=require_non_empty_str(doc["invariant_id"], "invariants[].invariant_id"),
            category=require_enum(doc["category"], "invariants[].category", INVARIANT_CATEGORIES),
            expr=require_object(doc["expr"], "invariants[].expr"),
            severity=require_enum(doc["severity"], "invariants[].severity", SEVERITIES),
            applies_to=require_str_tuple(
                doc["applies_to"], "invariants[].applies_to", unique=True
            ),
            description=require_str_or_none(doc.get("description"), "invariants[].description"),
            expected_violation_when=require_str_or_none(
                doc.get("expected_violation_when"), "invariants[].expected_violation_when"
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "invariant_id": self.invariant_id,
            "category": self.category,
            "expr": dict(self.expr),
            "severity": self.severity,
            "applies_to": list(self.applies_to),
        }
        put_if_present(out, "description", self.description)
        put_if_present(out, "expected_violation_when", self.expected_violation_when)
        return out

    def applies_to_operation(self, operation: str) -> bool:
        """``["*"]`` 或显式列出该 operation（§7.4 的作用域规则）。"""
        return "*" in self.applies_to or operation in self.applies_to


# --------------------------------------------------------------------------- #
# 实体收集（注册表的输入）
# --------------------------------------------------------------------------- #
def collect_entities(world_document: Mapping[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """从世界文档收集 ``entity_type -> (entity_id -> document)``。

    ``workflow_instance`` 是把所有 ``workflows[].instances[]`` 拍平后的虚拟实体
    类型——它没有独立的顶层数组，但 ID 视图需要它（``state_is`` /
    ``transition_allowed`` 都引用它）。
    """
    require_mapping(world_document, "world")

    def bucket(key: str, id_field: str) -> dict[str, dict[str, Any]]:
        raw = world_document.get(key) or ()
        if isinstance(raw, Mapping) or not isinstance(raw, Sequence):
            raise ModelError(f"world.{key} 必须是数组")
        out: dict[str, dict[str, Any]] = {}
        for index, item in enumerate(raw):
            if not isinstance(item, Mapping):
                raise ModelError(f"world.{key}[{index}] 必须是 object")
            entity_id = item.get(id_field)
            if not isinstance(entity_id, str) or not entity_id:
                raise ModelError(f"world.{key}[{index}] 缺少 {id_field}")
            if entity_id in out:
                raise ModelError(f"world.{key} 中 {id_field}={entity_id!r} 重复")
            out[entity_id] = dict(item)
        return out

    entities: dict[str, dict[str, dict[str, Any]]] = {
        "actor": bucket("actors", "actor_id"),
        "resource": bucket("resources", "resource_id"),
        "session": bucket("sessions", "session_id"),
        "token": bucket("tokens", "token_id"),
        "credential": bucket("credentials", "credential_id"),
        "service": bucket("services", "service_id"),
        "cache": bucket("caches", "cache_id"),
        "role": bucket("roles", "role_id"),
        "workflow": bucket("workflows", "workflow_id"),
        "workflow_instance": {},
    }
    for workflow in world_document.get("workflows") or ():
        if not isinstance(workflow, Mapping):
            raise ModelError("world.workflows[] 必须是 object")
        for instance in workflow.get("instances") or ():
            if not isinstance(instance, Mapping):
                raise ModelError("world.workflows[].instances[] 必须是 object")
            instance_id = instance.get("instance_id")
            if not isinstance(instance_id, str) or not instance_id:
                raise ModelError("world.workflows[].instances[] 缺少 instance_id")
            if instance_id in entities["workflow_instance"]:
                raise ModelError(f"workflow_instance {instance_id!r} 在多个 workflow 中重复")
            entities["workflow_instance"][instance_id] = dict(instance)
    return entities


__all__ = [
    "ACTOR_TYPES",
    "APPLICATION_DOMAINS",
    "ATTACK_FAMILIES",
    "AUTHENTICATION_STATES",
    "AUTH_STRENGTHS",
    "CONSISTENCY_MODELS",
    "CREDENTIAL_STATUSES",
    "CREDENTIAL_TYPES",
    "EVIDENCE_PROVENANCES",
    "EVIDENCE_TYPES",
    "FRESHNESSES",
    "GRANTEE_TYPES",
    "HTTP_METHODS",
    "INVARIANT_CATEGORIES",
    "POLICY_EFFECTS",
    "RESOURCE_TYPES",
    "SEVERITIES",
    "SENSITIVITIES",
    "SERVICE_TYPES",
    "SINK_KINDS",
    "TOKEN_TYPES",
    "TRUSTED_ESTABLISHES",
    "TRUST_LEVELS",
    "VALIDATION_OUTCOMES",
    "WORLD_ORIGINS",
    "AclEntry",
    "ActionPattern",
    "Actor",
    "Application",
    "CacheEntry",
    "CompileRecord",
    "Credential",
    "Endpoint",
    "EvidenceItem",
    "Identity",
    "Invariant",
    "PolicyRule",
    "PrivilegeSnapshot",
    "Resource",
    "Role",
    "Service",
    "Session",
    "Sink",
    "StateSnapshot",
    "Token",
    "TrustBoundary",
    "Workflow",
    "WorkflowInstance",
    "WorkflowTransition",
    "WorkflowTransitionRecord",
    "WorldProvenance",
    "collect_entities",
]
