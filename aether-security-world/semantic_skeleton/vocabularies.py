"""Phase 2A 的**语义类型词表**：LLM 可说的角色/资源/服务名字 → schema 枚举的确定性映射。

为什么需要这一层：``world.schema.json`` 的 ``actor_type`` / ``resource_type`` /
``service_type`` 是**闭合枚举**（8 / 10 / 8 项），而安全语义里自然出现的角色是
"ordinary_user"、"tenant_admin"、"api_gateway"、"billing_service"这类。让 LLM 直接
写 schema 枚举等于让它背一张与安全语义无关的表；让它自由写又会在编译期撞枚举。

折中：语义侧用自己的小词表（本模块的键），编译器按本表**确定性**映射到 schema 枚举。
词表外的名字不是编译失败——它是 ``UNKNOWN_SEMANTIC_TYPE``，骨架进 quarantine，
由人工/agent 决定是扩词表还是拒收（与 §23 的新事实候选同一纪律）。

**映射是单向的、多对一的**：多个语义角色可以落到同一个 schema 枚举值
（``api_gateway`` 与 ``billing_service`` 都是 ``backend_service``）。世界的多样性
来自 ``mechanism_family`` / ``critical_facts`` / ``history`` / ``trust_relationships``，
不来自枚举值本身——这一点在审计里要能说清楚。
"""
from __future__ import annotations

from typing import Mapping

#: 语义 actor 类型 → ``world.schema.json`` 的 ``actor.actor_type`` 枚举。
ACTOR_TYPES: Mapping[str, str] = {
    "ordinary_user": "user",
    "tenant_admin": "administrator",
    "platform_admin": "administrator",
    "support_agent": "support_agent",
    "merchant": "merchant",
    "service_account": "service_account",
    "api_gateway": "backend_service",
    "billing_service": "backend_service",
    "identity_service": "backend_service",
    "authorization_service": "backend_service",
    "audit_service": "backend_service",
    "downstream_worker": "backend_service",
    "records_service": "backend_service",
    "workflow_service": "backend_service",
    "search_service": "backend_service",
    "metrics_service": "backend_service",
    "gateway_service": "backend_service",
    "storage_service": "backend_service",
    "notification_service": "backend_service",
    # Phase 2B OOD pilot（provider-ood-pilot-001）实测：第二生成器把 cache_service 用作
    # 行动主体（授权缓存服务的服务动作），而 cache_service 原来只在 SERVICE_TYPES——
    # 词表不对称，不是安全语义边界（映射目标与十个已在两表的服务完全相同）。
    "cache_service": "backend_service",
    "ci_service": "backend_service",
    "attacker_controlled_account": "attacker_controlled_account",
    "anonymous_principal": "anonymous_principal",
}

#: 语义 resource 类型 → ``world.schema.json`` 的 ``resource.resource_type`` 枚举。
RESOURCE_TYPES: Mapping[str, str] = {
    "invoice": "invoice",
    "order": "order",
    "file": "file",
    "document": "file",
    "message": "message",
    "ticket": "ticket",
    "secret": "secret",
    "api_key": "api_key",
    "user_profile": "user_profile",
    "database_record": "database_record",
    "billing_record": "database_record",
    "tenant_context": "database_record",
    "permission_cache": "database_record",
    "device_record": "cloud_resource",
    "cloud_resource": "cloud_resource",
    "cluster_config": "cloud_resource",
}

#: 语义 service 类型 → ``world.schema.json`` 的 ``service.service_type`` 枚举。
SERVICE_TYPES: Mapping[str, str] = {
    "identity_service": "auth_provider",
    "authorization_service": "auth_provider",
    "billing_service": "database",
    "records_service": "database",
    "payment_service": "payment_gateway",
    "object_store": "object_store",
    "cache_service": "cache",
    "message_queue": "queue",
    "notification_service": "webhook",
    "llm_service": "llm_service",
    "audit_service": "database",
    "records_service": "database",
    "document_service": "database",
    "workflow_service": "database",
    "search_service": "database",
    "metrics_service": "database",
    "gateway_service": "webhook",
    "edge_service": "webhook",
    "storage_service": "object_store",
    "media_service": "object_store",
    "signing_service": "auth_provider",
}


def actor_type(semantic: str) -> str | None:
    """语义角色 → schema 枚举；未知返回 ``None``。"""
    return ACTOR_TYPES.get(semantic)


def resource_type(semantic: str) -> str | None:
    return RESOURCE_TYPES.get(semantic)


def service_type(semantic: str) -> str | None:
    return SERVICE_TYPES.get(semantic)


def unknown_actor_types(values: object) -> tuple[str, ...]:
    return _unknown(ACTOR_TYPES, values)


def unknown_resource_types(values: object) -> tuple[str, ...]:
    return _unknown(RESOURCE_TYPES, values)


def unknown_service_types(values: object) -> tuple[str, ...]:
    return _unknown(SERVICE_TYPES, values)


def _unknown(table: Mapping[str, str], values: object) -> tuple[str, ...]:
    if isinstance(values, str) or not isinstance(values, (list, tuple, set)):
        return ()
    seen: set[str] = set()
    out: list[str] = []
    for item in values:
        name = str(item)
        if name in seen:
            continue
        seen.add(name)
        if name not in table:
            out.append(name)
    return tuple(out)


def vocabulary_summary() -> dict[str, tuple[str, ...]]:
    """三张表的名字（prompt 用）。"""
    return {
        "actor_types": tuple(sorted(ACTOR_TYPES)),
        "resource_types": tuple(sorted(RESOURCE_TYPES)),
        "service_types": tuple(sorted(SERVICE_TYPES)),
    }


__all__ = [
    "ACTOR_TYPES",
    "RESOURCE_TYPES",
    "SERVICE_TYPES",
    "actor_type",
    "resource_type",
    "service_type",
    "unknown_actor_types",
    "unknown_resource_types",
    "unknown_service_types",
    "vocabulary_summary",
]
