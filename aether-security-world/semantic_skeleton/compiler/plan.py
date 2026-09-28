"""Phase 2A 的 :class:`WorldPlan`：编译器内部的**已解析世界草图**。

骨架只说语义（"主体"、"目标资源"、"授权缓存"）；Plan 把这些语义槽钉到**具体的实体
id** 上。id 由 ``stable_hash(skeleton_id + slot)`` 派生——不是随机 UUID，因此同一个
骨架重复编译得到逐字节相同的结果（brief §20）。

Plan 还持有每个槽的**语义角色名**（``actor.principal`` 的 schema ``actor_type``、
``resource.target_resource`` 的 schema ``resource_type`` …），这些是
EntityConstructor 从骨架的 ``actor_types`` / ``resource_types`` / ``service_types``
按位置确定性指派的。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from ..ontology import SemanticFact, semantic_fact
from ..mechanisms import Mechanism

#: 槽 → 实体 id 前缀（与 world.schema.json 的各 id 模式一致）。
SLOT_PREFIX: Mapping[str, str] = {
    "principal": "ACT",
    "peer": "ACT",
    "target_resource": "RES",
    "acting_session": "SES",
    "acting_token": "TOK",
    "lineage_parent": "TOK",
    "workflow_instance": "WFI",
    "cache_entry": "CACHE",
    "second_cache": "CACHE",
    "authority_service": "SVC",
    "credential": "CRED",
    "boundary": "TB",
}

#: 槽 → 世界里的实体类型（ID 视图第一段）。
SLOT_ENTITY_TYPE: Mapping[str, str] = {
    "principal": "actor",
    "peer": "actor",
    "target_resource": "resource",
    "acting_session": "session",
    "acting_token": "token",
    "lineage_parent": "token",
    "workflow_instance": "workflow_instance",
    "cache_entry": "cache",
    "second_cache": "cache",
    "authority_service": "service",
    "credential": "credential",
    "boundary": "trust_boundary",
}

#: 槽 → 状态快照里的分组（与 world.schema.json 的 state_snapshot 对齐）。
SLOT_SNAPSHOT_GROUP: Mapping[str, str] = {
    "principal": "actor_states",
    "peer": "actor_states",
    "target_resource": "resource_states",
    "acting_session": "session_states",
    "acting_token": "token_states",
    "lineage_parent": "token_states",
    "workflow_instance": "workflow_states",
}


def stable_digest(*parts: object) -> str:
    """确定性短摘要（同一入参 ⇒ 同一输出，跨进程稳定）。"""
    import hashlib
    import json

    payload = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass
class WorldPlan:
    """一个骨架解析后的世界草图。"""

    skeleton_id: str
    domain: str
    mechanism: Mechanism
    complexity: str
    #: 槽 → 实体 id。
    entity_ids: dict[str, str] = field(default_factory=dict)
    #: 槽 → 语义类型名（骨架的 actor_types / resource_types / service_types 条目）。
    semantic_types: dict[str, str] = field(default_factory=dict)
    #: 语义事实名 → 已解析的 canonical 路径（None 表示该事实不当轴/不进证据）。
    fact_paths: dict[str, str | None] = field(default_factory=dict)
    #: 语义事实名 → 它落在哪个槽。
    fact_slots: dict[str, str] = field(default_factory=dict)
    #: 槽 → 租户 id（trajectory 的 ``@slot.tenant`` 与实体构造共用同一份真值）。
    tenant_of_map: dict[str, str] = field(default_factory=dict)
    #: 语义事实名 → 基准世界里的取值（证据 ``value`` 与反事实 ``before`` 的唯一真源）。
    base_values: dict[str, Any] = field(default_factory=dict)
    #: 工作流定义（编译器可被机制覆盖）。
    workflow_states: tuple[str, ...] = ()
    workflow_initial_state: str = ""
    workflow_transitions: tuple[tuple[str, str], ...] = ()
    #: 该世界实际开出来的实体类型集合（审计/指纹用）。
    materialised: tuple[str, ...] = ()
    #: 编译期诊断（不参与世界内容，只进 provenance）。
    notes: tuple[str, ...] = ()

    # -- 派生标识 ----------------------------------------------------------- #
    @property
    def world_id(self) -> str:
        """确定性 world_id（``W-`` + 12 hex；同一骨架重复编译逐字节相同）。"""
        return "W-" + stable_digest(self.skeleton_id, self.mechanism.family, "world")[:12]

    @property
    def seed(self) -> int:
        """确定性 seed（同一骨架 ⇒ 同一 seed）。"""
        return int(stable_digest(self.skeleton_id, "seed")[:8], 16)

    @property
    def primary_operation(self) -> str:
        """决策操作名：带工作流实例的机制走 ``transition``，其余走 ``read``。"""
        return "transition" if self.has_slot("workflow_instance") else "read"

    @property
    def secondary_operation(self) -> str:
        return "read" if self.primary_operation == "transition" else "update"

    @property
    def resource_semantic_type(self) -> str:
        return self.semantic_types.get("target_resource", "database_record")

    # -- 查询 --------------------------------------------------------------- #
    def id_for(self, slot: str) -> str:
        try:
            return self.entity_ids[slot]
        except KeyError:  # pragma: no cover - 机制声明与槽表不一致
            raise KeyError(f"世界没有开槽 {slot!r}（机制 {self.mechanism.family}）") from None

    def path_for(self, slot: str, field_path: str) -> str:
        entity_type = SLOT_ENTITY_TYPE[slot]
        return f"{entity_type}.{self.id_for(slot)}.{field_path}"

    def has_slot(self, slot: str) -> bool:
        return slot in self.entity_ids

    def tenant_of(self, slot: str) -> str:
        try:
            return self.tenant_of_map[slot]
        except KeyError:  # pragma: no cover - 机制声明与槽表不一致
            raise KeyError(f"槽 {slot!r} 没有租户（机制 {self.mechanism.family}）") from None

    def cache_value_of(self, slot: str) -> object:
        from .compiler import _cache_value

        return _cache_value(self.mechanism, self, slot)

    def privilege_version_of(self, slot: str) -> int:
        return 1

    def workflow_state_of(self, slot: str) -> str:
        return self.workflow_initial_state

    def bind(self, fact: SemanticFact, *, slot: str | None = None) -> str:
        """把一个语义事实绑定到槽上，返回 canonical 路径。

        ``slot`` 显式给出时覆盖本体里的缺省槽——机制可以把同一个语义事实派到不同槽
        （例如 ``cached_privilege_version`` 在单缓存机制里落 ``cache_entry``，在双缓存
        机制里落 ``second_cache``）。不覆盖就会让两条不变量读到同一条
        ``cached_value``，反事实改一个值两条一起动，判决翻转不了。
        """
        resolved_slot = slot or fact.slot
        if not self.has_slot(resolved_slot):
            raise KeyError(
                f"语义事实 {fact.name!r} 需要槽 {resolved_slot!r}，但本机制没有开它"
            )
        path = self.path_for(resolved_slot, fact.field_path)
        self.fact_paths[fact.name] = path
        self.fact_slots[fact.name] = resolved_slot
        return path

    def resolved_path(self, fact_name: str) -> str | None:
        return self.fact_paths.get(fact_name)

    def value_of(self, fact_name: str) -> object:
        """一个语义事实在基准世界里的取值（证据 ``value`` 与反事实 ``before`` 用）。

        真源是 :attr:`base_values`——由 StateConstructor 在轨迹跑完后一次性记录。
        早期实现这里传一个空 state 进去现算，结果每个 actor 绑定的事实都算出 ``None``，
        证据 ``value`` 全空、overlay 解析失败；自检脚本第一次跑就抓到了。
        """
        if fact_name in self.base_values:
            return self.base_values[fact_name]
        fact = semantic_fact(fact_name)
        if fact is None:  # pragma: no cover
            return None
        slot = self.fact_slots.get(fact_name, fact.slot)
        entity_id = self.id_for(slot) if self.has_slot(slot) else None
        from .compiler import _base_value

        return _base_value(self, {"state": {}}, fact_name, slot, entity_id, {})

    def snapshot_group(self, slot: str) -> str | None:
        return SLOT_SNAPSHOT_GROUP.get(slot)

    def to_document(self) -> dict[str, Any]:
        """审计/指纹用的紧凑视图（不进世界）。"""
        return {
            "skeleton_id": self.skeleton_id,
            "world_id": self.world_id,
            "mechanism_family": self.mechanism.family,
            "attack_family": self.mechanism.attack_family,
            "coverage_labels": list(self.mechanism.coverage_labels),
            "domain": self.domain,
            "entity_ids": dict(sorted(self.entity_ids.items())),
            "fact_paths": dict(sorted(self.fact_paths.items())),
            "materialised": list(self.materialised),
        }


__all__ = [
    "SLOT_ENTITY_TYPE",
    "SLOT_PREFIX",
    "SLOT_SNAPSHOT_GROUP",
    "WorldPlan",
    "stable_digest",
]
