"""Phase 2A 的**确定性世界编译器**（brief §19-§23, §35-§36, §41-§42）。

输入是一个 :ref:`semantic skeleton`（LLM 只写安全语义），输出是一份完整的
``world-spec.schema.json`` 文档。九个阶段各自独立、可单测、失败带稳定 reason code：

======================  ====================================================
阶段                    职责
======================  ===================================================
``entities``            EntityConstructor：开槽、派 id、建实体
``facts``                FactPathCompiler：语义事实 → canonical 路径
``states``              StateConstructor + HistoryCompiler：状态轨迹与快照
``invariant``           InvariantCompiler：原型 → DSL expr
``policy``              PolicyCompiler：allow 规则 + 闭世界默认拒绝
``evidence``            EvidenceCompiler：证据目录（含矛盾/陈旧/可控声明）
``trust``               TrustCompiler：信任边界 / 权威来源 / 一致性模型
``counterfactual``      CounterfactualCompiler：轴 + before/after + 期望
``assemble``            组装成 spec 文档并过 world-spec schema
======================  ====================================================

三条不可谈判的性质：

* **确定性**：同一骨架重复编译得到 canonical-json 相同的文档（brief §20）。id 全部
  由 ``stable_hash(skeleton_id, slot)`` 派生，没有随机 UUID、没有挂钟。
* **LLM 不是真值来源**：``attack_family`` 由机制派生；反事实的
  ``semantic_expectation`` 只是先验，最终分类由 Oracle 轨迹决定（brief §35）——
  本编译器因此**不接受**任何 verdict / label 字段，骨架里出现即拒。
* **不猜**：任何映射不到的事实、原型、反事实改法都是显式失败并带 reason code，
  绝不用"最接近的"糊过去（brief §42）。
"""
from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence

from .. import mechanisms as _mech
from ..mechanisms import Mechanism, StateStep
from ..ontology import SemanticFact, semantic_fact, surface_axis_path
from ..vocabularies import (
    actor_type as _actor_type,
    resource_type as _resource_type,
    service_type as _service_type,
)
from .archetypes import ArchetypeResult, build_archetype
from .errors import CompilerFailure, SkeletonCompileError, fail
from .plan import SLOT_ENTITY_TYPE, SLOT_PREFIX, WorldPlan, stable_digest

#: 编译器版本（与 semantic_skeleton/compiler/__init__.py 一致，单独引用避免循环）。
COMPILER_VERSION = "0.3.0"

#: 无关轴的固定集合（observation 表面路径；与 Phase 1 的 irrelevant_axes 同源）。
IRRELEVANT_AXES: tuple[str, ...] = (
    "observation.request.headers.User-Agent",
    "observation.request.headers.X-Request-Id",
    "observation.request.headers.Accept-Language",
    "observation.rendering.trace_id",
    "observation.rendering.timestamp_format",
    "observation.rendering.display_name_case",
)

#: VirtualClock 基准（逻辑时钟，非挂钟；由 skeleton_id 派生）。
_EPOCH = _dt.datetime(2026, 1, 1, tzinfo=_dt.timezone.utc)

#: 历史 landmark → episode 事件类型的关键词表（确定性分类；只影响渲染与轨迹步的应用点，
#: 不影响 Oracle 判决——判决读世界状态，不读时间线）。分类失败的后果是
#: ``HISTORY_INCONSISTENT`` 拒收，而不是一个静默错掉的世界；generator prompt 因此
#: 必须把这套规范措辞教给模型。
_LANDMARK_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("login", ("authenticate", "sign in", "signs in", "logs in", "login", "session established",
               "presents credentials")),
    ("mfa_challenge", ("mfa", "second factor", "one-time code challenge", "step-up")),
    ("token_issued", ("issues a token", "token is issued", "issues token", "mints", "grants a token",
                      "issues a one-time", "delegation token", "issues a code", "code is issued",
                      "credential is issued",
                      # Phase 2B OOD pilot：第二生成器的同义表述（"issues a delegated
                      # access token"），语义本体完全支持——分类器曾只认 Step 的措辞。
                      "issues a delegated", "delegated access token",
                      "issues an access token", "access token is issued")),
    ("token_used", ("consumes the code", "token is used", "presents the token", "uses the token",
                    "first use", "redeems", "token is presented", "code is consumed",
                    "one-time code is consumed")),
    ("token_revoked", ("token is revoked", "revokes the token", "token revoked")),
    ("role_changed", ("role is changed", "role changes", "privileges are changed", "grants a role",
                      "demotes", "promotes", "privilege version", "role is granted",
                      "permission set is updated")),
    ("permission_changed", ("permission is changed", "policy is updated", "ownership is transferred",
                            "owner is changed", "switches active", "changes active",
                            "tenant context is updated", "authorization is updated",
                            "commits", "active context", "propagates", "propagation",
                            "state is committed", "writes the new",
                            # Phase 2B OOD pilot：属主/权限更新的另一类措辞。
                            "ownership is updated", "revokes a privilege",
                            "updating the authoritative version")),
    ("password_reset", ("password is reset", "resets the password", "credential is rotated",
                        "password reset")),
    ("account_disabled", ("account is disabled", "disables the account", "account disabled")),
    ("account_enabled", ("account is enabled", "re-enables", "account enabled")),
    ("session_revoked", ("session is revoked", "revokes the session", "session revoked",
                         "session is invalidated")),
    ("cache_populated", ("cache is populated", "populates the cache", "caches the", "cache entry is written",
                         "stores a cached", "replica", "cache", "cached", "retains", "holds the previous",
                         "still holds", "stale copy", "snapshot is kept")),
    ("cache_invalidated", ("cache is invalidated", "invalidates the cache", "cache entry expires",
                           "cache is dropped")),
    ("workflow_transition", ("workflow moves", "workflow transitions", "advances the workflow",
                             "workflow is advanced", "state machine", "moves toward",
                             "transition is applied",
                             # Phase 2B OOD pilot：转移尝试的措辞（曾被 sensitive_operation
                             # 的 "attempts" 以同分抢先——同分同位时按元组序 workflow 在前）。
                             "attempts a transition", "attempts to move",
                             "processes a transition", "transition attempt")),
    ("resource_created", ("resource is created", "creates the", "record is created", "opens a",
                          "resource is opened", "is created")),
    ("resource_updated", ("resource is updated", "updates the", "record is updated")),
    ("privilege_downgraded", ("privileges are downgraded", "downgrades")),
    ("sensitive_operation", ("requests", "asks", "performs", "executes", "invokes", "calls",
                             "reads", "writes", "submits", "attempts", "presents",
                             "asks the console", "retries",
                             # Phase 2B OOD pilot："records the token validation attempt"——
                             # 令牌校验尝试就是被判决的操作。
                             "validation attempt")),
)


#: landmark 同义词：机制要求的 landmark 可以由语义等价的分类结果满足。
#: 分类器是关键词表，生成器的措辞永远比表丰富；把"语义等价"显式列出来，
#: 比让它猜中规范措辞现实得多（v0.4 run 实测 5/9 拒绝来自这一处）。
_LANDMARK_SYNONYMS: Mapping[str, tuple[str, ...]] = {
    "role_changed": ("role_changed", "privilege_downgraded", "permission_changed"),
    "permission_changed": ("permission_changed", "role_changed", "privilege_downgraded"),
    "session_revoked": ("session_revoked", "account_disabled", "token_revoked"),
    "token_revoked": ("token_revoked", "session_revoked"),
    "token_issued": ("token_issued", "mfa_challenge"),
    "cache_populated": ("cache_populated", "cache_invalidated"),
    "cache_invalidated": ("cache_invalidated", "cache_populated"),
    "resource_created": ("resource_created", "resource_updated"),
    "resource_updated": ("resource_updated", "resource_created"),
    "workflow_transition": ("workflow_transition", "permission_changed"),
    "login": ("login", "mfa_challenge"),
    "password_reset": ("password_reset", "credential_active", "role_changed"),
    "account_disabled": ("account_disabled", "session_revoked"),
}


def _landmark_matches(required: str, classified: str) -> bool:
    """分类结果是否满足机制要求的 landmark（含同义词）。"""
    return required == classified or classified in _LANDMARK_SYNONYMS.get(required, ())


def classify_history_line(line: str) -> str:
    """把一行历史叙述分类成 episode 事件类型（确定性关键词表）。

    评分规则：命中关键词最多的类型胜出；平分取**最靠前**命中位置更靠前的那个；
    零命中归 ``other``。只影响**渲染与轨迹步的应用点**，不影响 Oracle 判决——判决读
    世界状态，不读时间线。因此一次误分类的最坏后果是 ``HISTORY_INCONSISTENT`` 拒收
    （可见、可行动），而不是真值被悄悄污染。
    """
    text = str(line).lower()
    best_score = 0
    best_position = len(text) + 1
    best_type = "other"
    for event_type, keywords in _LANDMARK_KEYWORDS:
        score = 0
        position = len(text) + 1
        for keyword in keywords:
            index = text.find(keyword)
            if index >= 0:
                score += 1
                position = min(position, index)
        if score > best_score or (score == best_score and score > 0 and position < best_position):
            best_score, best_position, best_type = score, position, event_type
    return best_type


# --------------------------------------------------------------------------- #
# 编译上下文
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class CompileResult:
    """编译产物 + 侧信道（Plan / 状态轨迹 / 实体表）。"""

    spec: dict[str, Any]
    plan: WorldPlan
    state: Mapping[str, Any]
    entities: Mapping[str, Any]


@dataclass(frozen=True)
class CompileContext:
    """编译期需要的外部信息（prompt 版本 / 生成器身份 / 逻辑时刻）。"""

    generator_model: str = "step-5-preview"
    generator_model_version: str = "unknown"
    prompt_version: str = "0.1"
    prompt_hash: str = "0" * 64
    generation_timestamp: str = "2026-01-01T00:00:00Z"
    raw_generation_id: str | None = None
    origin: str = "step5_seed"
    #: canonical skeleton id（Phase 2B brief §6）。production contract 下由程序从骨架
    #: 语义内容派生后经这里传入；``world_id`` / ``seed`` / 全部实体 ID 都从它派生，
    #: 因此 provider 声称的任何 id 都不能影响 canonical 身份。缺省 ``None`` 时退回
    #: 文档里的 ``skeleton_id``（Phase 2A 兼容路径，行为不变）。
    canonical_skeleton_id: str | None = None


# --------------------------------------------------------------------------- #
# 符号值解析（StateStep 里的 ``@slot.field`` 引用）
# --------------------------------------------------------------------------- #
def _resolve_symbolic(plan: WorldPlan, value: Any) -> Any:
    """把 ``@slot.field`` 解析成计划里的具体值（确定性）。"""
    if not isinstance(value, str) or not value.startswith("@"):
        return value
    reference = value[1:]
    slot, _, field_path = reference.partition(".")
    if not plan.has_slot(slot):
        raise fail(
            "states", "INTERNAL_COMPILER_ERROR", "mechanism_family",
            f"符号引用 {value!r} 指向未开的槽 {slot!r}",
        )
    entity_id = plan.id_for(slot)
    if field_path == "tenant":
        return plan.tenant_of(slot)
    if field_path == "actor_id":
        return entity_id
    if field_path == "cached_value":
        return plan.cache_value_of(slot)
    if field_path == "privilege_version":
        return plan.privilege_version_of(slot)
    if field_path == "current_state":
        return plan.workflow_state_of(slot)
    if field_path == "resource_id":
        return entity_id
    raise fail(
        "states", "INTERNAL_COMPILER_ERROR", "mechanism_family",
        f"符号引用 {value!r} 的字段 {field_path!r} 没有解析规则",
    )


# --------------------------------------------------------------------------- #
# 主编译器
# --------------------------------------------------------------------------- #
class SemanticSkeletonCompiler:
    """把一个语义骨架编译成一份 world-spec 文档。"""

    def __init__(self, *, config: Mapping[str, Any] | None = None) -> None:
        self._config = dict(config or {})

    # -- 入口 --------------------------------------------------------------- #
    def compile(
        self,
        skeleton: Mapping[str, Any],
        *,
        context: CompileContext | None = None,
        world_id: str | None = None,
    ) -> dict[str, Any]:
        """编译一个骨架；失败抛 :class:`SkeletonCompileError`。"""
        return self.compile_with_plan(skeleton, context=context, world_id=world_id).spec

    def compile_with_plan(
        self,
        skeleton: Mapping[str, Any],
        *,
        context: CompileContext | None = None,
        world_id: str | None = None,
    ) -> "CompileResult":
        """编译一个骨架并连同 :class:`WorldPlan` 一起返回。

        Plan 是**审计与复核的侧信道**：它记录每个语义事实落到了哪条 canonical 路径，
        验证器据此把骨架声明的 ``semantic_expectation`` 对齐到具体轴，不必去解析
        rationale 文本。Plan 本身不进世界——world-spec 装不下它，也不该装。
        """
        ctx = context or CompileContext()
        document = dict(skeleton)
        # canonical id 由调用方拥有（production：``identity.canonical_skeleton_id``
        # 从语义内容派生）；只有 Phase 2A 兼容路径才退回 provider 写的 skeleton_id。
        skeleton_id = str(ctx.canonical_skeleton_id or document.get("skeleton_id") or "")
        if not skeleton_id:
            raise fail("normalize", "SCHEMA_INVALID", "skeleton_id", "skeleton_id 不能为空")

        mechanism = self._mechanism(document)
        plan = self._plan(document, mechanism, world_id=world_id, skeleton_id=skeleton_id)
        self._facts(document, mechanism, plan)
        # StateConstructor 先跑：EntityConstructor 从轨迹的**终态**推导实体的
        # valid/revoked/privilege_version/owner…，实体与快照因此不可能各说各话。
        state = self._states(document, mechanism, plan)
        self._record_base_values(plan, state)
        entities = self._entities(document, mechanism, plan, state)
        invariants, policies = self._rules(document, mechanism, plan)
        evidence = self._evidence(document, mechanism, plan)
        self._trust(document, mechanism, plan, entities)
        axes, surface_requests = self._counterfactuals(document, mechanism, plan, state)
        irrelevant = self._irrelevant(document, mechanism, plan, axes, surface_requests)
        templates = self._templates(document, mechanism, plan, state)
        spec = self._assemble(
            document, mechanism, plan, entities, state, invariants, policies,
            evidence, axes, irrelevant, templates, ctx,
        )
        return CompileResult(spec=spec, plan=plan, state=state, entities=entities)

    # -- 阶段 1：机制 ------------------------------------------------------- #
    def _mechanism(self, document: Mapping[str, Any]) -> Mechanism:
        family = str(document.get("mechanism_family") or "")
        if not family:
            raise fail(
                "normalize", "UNKNOWN_MECHANISM", "mechanism_family",
                "mechanism_family 不能为空",
            )
        mechanism = _mech.mechanism(family)
        if mechanism is None:
            raise fail(
                "entities", "UNKNOWN_MECHANISM", "mechanism_family",
                f"机制族 {family!r} 不在注册表内；已注册 {len(_mech.MECHANISMS)} 个: "
                f"{', '.join(_mech.mechanism_families()[:12])}…",
            )
        return mechanism

    # -- 阶段 2：开槽 ------------------------------------------------------- #
    def _plan(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        *,
        world_id: str | None,
        skeleton_id: str | None = None,
    ) -> WorldPlan:
        # ``skeleton_id`` 由 ``compile_with_plan`` 决定来源：production 传程序派生的
        # canonical id，Phase 2A 兼容路径退回文档里的 provider 句柄。
        resolved_id = skeleton_id if skeleton_id is not None else str(document["skeleton_id"])
        plan = WorldPlan(
            skeleton_id=resolved_id,
            domain=str(document.get("domain") or ""),
            mechanism=mechanism,
            complexity=str(document.get("complexity") or "medium"),
        )
        # 需要的槽 = 实体清单隐含的槽 ∪ slot_facts 声明的槽
        needed: list[str] = []
        for slot in _slots_for_entities(mechanism.entities):
            needed.append(slot)
        for slot in mechanism.slot_facts:
            if slot not in needed:
                needed.append(slot)
        for slot in needed:
            prefix = SLOT_PREFIX[slot]
            digest = stable_digest(resolved_id, mechanism.family, slot)[:8].upper()
            plan.entity_ids[slot] = f"{prefix}-{digest}"
        plan.workflow_states = mechanism.workflow_states or ("open", "active", "closed")
        plan.workflow_initial_state = mechanism.workflow_initial_state or plan.workflow_states[0]
        plan.workflow_transitions = mechanism.workflow_transitions or (
            (plan.workflow_states[0], plan.workflow_states[1]),
            (plan.workflow_states[1], plan.workflow_states[-1]),
        )
        plan.materialised = tuple(sorted(set(mechanism.entities)))
        if world_id:
            plan.notes = (f"world_id 由调用方指定: {world_id}",)
        # 租户在这里指派：StateConstructor 先于 EntityConstructor 跑，而轨迹里的
        # ``@slot.tenant`` 符号引用与缓存缺省值都要读它。
        principal_tenant, peer_tenant = _tenant_ids(plan)
        plan.tenant_of_map = {"principal": principal_tenant, "peer": peer_tenant}
        if plan.has_slot("target_resource"):
            plan.tenant_of_map["target_resource"] = (
                peer_tenant if "multi_tenant" in mechanism.coverage_labels else principal_tenant
            )
        return plan

    # -- 阶段 3：语义事实 → canonical 路径 --------------------------------- #
    def _facts(
        self, document: Mapping[str, Any], mechanism: Mechanism, plan: WorldPlan
    ) -> None:
        declared = declared_facts(document)
        # 机制用到的事实（required_facts + slot_facts + evidence 计划）必须全部出现在
        # 骨架的声明里。否则编译到一半才在某个 stage 炸，reason code 会指向错误的位置。
        needed = set(mechanism.required_facts)
        needed.update(mechanism.slot_facts.values())
        needed.update(spec.fact for spec in mechanism.evidence)
        for fact_name in sorted(needed):
            if fact_name not in declared:
                raise fail(
                    "facts", "MISSING_CRITICAL_FACT", "critical_facts",
                    f"机制 {mechanism.family!r} 要求语义事实 {fact_name!r}，"
                    f"骨架声明的是 {sorted(declared)}",
                )
        # 骨架声明的语义事实必须全部在本体内（brief §32 的 pre-flight 检查之一）。
        # 静默跳过未知名字等于让"本体"变成一个建议——那正是 §23 要关掉的门。
        for field_name in (
            "critical_facts", "required_evidence", "optional_evidence",
            "untrusted_evidence", "evidence_masking_targets", "irrelevant_facts",
        ):
            for name in document.get(field_name) or ():
                if semantic_fact(str(name)) is None:
                    raise fail(
                        "facts", "UNKNOWN_SEMANTIC_FACT", field_name,
                        f"{field_name} 里的 {name!r} 不在语义事实本体"
                        "（semantic_skeleton/ontology.py）内；新事实请走 "
                        "new_semantic_fact_candidates 走 quarantine 流程（brief §23）",
                    )
        # 绑定机制声明的槽 → 事实（机制的槽指派优先于本体缺省槽）
        for slot, fact_name in sorted(mechanism.slot_facts.items()):
            fact = semantic_fact(fact_name)
            if fact is None:
                raise fail(
                    "facts", "UNKNOWN_SEMANTIC_FACT", "critical_facts",
                    f"机制 {mechanism.family!r} 的槽 {slot!r} 指向未知语义事实 {fact_name!r}",
                )
            plan.bind(fact, slot=slot)
        # 绑定其余已声明且能当轴的事实（用于 counterfactual / evidence 解析）
        for fact_name in sorted(declared):
            fact = semantic_fact(fact_name)
            if fact is None or fact_name in plan.fact_paths:
                continue
            if plan.has_slot(fact.slot):
                plan.bind(fact)

    # -- 阶段 3.5：记录基准取值 --------------------------------------------- #
    def _record_base_values(
        self, plan: WorldPlan, state: Mapping[str, Any]
    ) -> None:
        """把每个已绑定语义事实在**基准世界**里的取值记进 plan。

        证据 ``value`` 与反事实 ``before`` 都从这里取，因此两者不可能不一致——而
        ``before`` 与世界现值不一致会被展开期记成 ``hypothesis_before_mismatch`` 并
        跳过该轴（一个静默丢失的反事实）。
        """
        for fact_name in sorted(plan.fact_paths):
            fact = semantic_fact(fact_name)
            if fact is None:  # pragma: no cover - fact_paths 只装已知事实
                continue
            slot = plan.fact_slots.get(fact_name, fact.slot)
            entity_id = plan.id_for(slot) if plan.has_slot(slot) else None
            plan.base_values[fact_name] = _base_value(
                plan, state, fact_name, slot, entity_id,
                _state_entry(state, slot, entity_id),
            )

    # -- 阶段 4：实体 ------------------------------------------------------- #
    def _entities(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        plan: WorldPlan,
        state: Mapping[str, Any],
    ) -> dict[str, Any]:
        actor_types = list(document.get("actor_types") or [])
        resource_types = list(document.get("resource_types") or [])
        service_types = list(document.get("service_types") or [])

        roles = _role_set(mechanism)
        principal_tenant = plan.tenant_of("principal") if plan.has_slot("principal") else "TEN-A"
        peer_tenant = plan.tenant_of("peer") if plan.has_slot("peer") else principal_tenant
        resource_tenant = (
            plan.tenant_of("target_resource") if plan.has_slot("target_resource") else principal_tenant
        )

        actors: list[dict[str, Any]] = []
        for slot, tenant, role in (
            ("principal", principal_tenant, roles[0]),
            ("peer", peer_tenant, roles[1] if len(roles) > 1 else roles[0]),
        ):
            if not plan.has_slot(slot):
                continue
            actor_id = plan.id_for(slot)
            semantic = actor_types[0] if slot == "principal" else (
                actor_types[1] if len(actor_types) > 1 else actor_types[0]
            )
            plan.semantic_types[slot] = str(semantic)
            schema_type = _actor_type(str(semantic))
            if schema_type is None:
                raise fail(
                    "entities", "UNKNOWN_SEMANTIC_TYPE", "actor_types",
                    f"语义角色 {semantic!r} 不在词表内（semantic_skeleton/vocabularies.py）",
                )
            actor_state = state["state"]["actor_states"].get(actor_id, {})
            actors.append({
                "actor_id": actor_id,
                "actor_type": schema_type,
                "display_name": actor_id,
                "identity": {
                    "identity_id": f"ID-{actor_id.split('-', 1)[1]}",
                    "email": f"{actor_id.lower()}@example.invalid",
                    "verified": True,
                },
                "roles": list(actor_state.get("roles") or [role]),
                "tenant": tenant,
                "privileges": _privileges_for(role),
                "authentication_state": str(actor_state.get("authentication_state") or "authenticated"),
                "privilege_version": int(actor_state.get("privilege_version", 1)),
            })
        resources: list[dict[str, Any]] = []
        if plan.has_slot("target_resource"):
            resource_id = plan.id_for("target_resource")
            semantic = resource_types[0] if resource_types else "database_record"
            plan.semantic_types["target_resource"] = str(semantic)
            schema_type = _resource_type(str(semantic))
            if schema_type is None:
                raise fail(
                    "entities", "UNKNOWN_SEMANTIC_TYPE", "resource_types",
                    f"语义资源 {semantic!r} 不在词表内（semantic_skeleton/vocabularies.py）",
                )
            resource_state = state["state"]["resource_states"].get(resource_id, {})
            # 跨资源重用机制要把 token 绑定的"另一个资源"实体真的建出来，否则
            # token.bound_resource 是一条 dangling_ref。
            if mechanism.family == "token_bound_to_other_resource":
                other_id = "RES-" + stable_digest(plan.skeleton_id, "other-resource")[:8].upper()
                other_state = state["state"]["resource_states"].get(other_id, {})
                resources.append({
                    "resource_id": other_id,
                    "resource_type": schema_type,
                    "display_name": other_id,
                    "owner": str(other_state.get("owner") or plan.id_for("peer")),
                    "tenant": resource_tenant,
                    "sensitivity": "internal",
                    "state": str(other_state.get("state") or "active"),
                })
            resources.append({
                "resource_id": resource_id,
                "resource_type": schema_type,
                "display_name": resource_id,
                "owner": str(resource_state.get("owner") or (
                    plan.id_for("principal") if plan.has_slot("principal") else actors[0]["actor_id"]
                )),
                "tenant": resource_tenant,
                "sensitivity": "confidential",
                "state": str(resource_state.get("state") or "active"),
            })
        services: list[dict[str, Any]] = []
        if plan.has_slot("authority_service"):
            service_id = plan.id_for("authority_service")
            semantic = service_types[0] if service_types else "identity_service"
            plan.semantic_types["authority_service"] = str(semantic)
            schema_type = _service_type(str(semantic))
            if schema_type is None:
                raise fail(
                    "entities", "UNKNOWN_SEMANTIC_TYPE", "service_types",
                    f"语义服务 {semantic!r} 不在词表内（semantic_skeleton/vocabularies.py）",
                )
            services.append({
                "service_id": service_id,
                "service_type": schema_type,
                "trust_boundary": "TB-CORE",
                "consistency_model": mechanism.service_consistency,
            })

        workflows = self._workflows(mechanism, plan, resources, state)

        sessions = self._sessions(mechanism, plan, actors, state)
        tokens = self._tokens(mechanism, plan, actors, resources, state)
        credentials = self._credentials(mechanism, plan, actors)
        caches = self._caches(mechanism, plan)
        boundaries = self._boundaries(mechanism, plan, services)

        return {
            "roles": [
                {"role_id": role_id, "name": role_id.split("-", 1)[1].title(), "privileges": _privileges_for(role_id)}
                for role_id in roles
            ],
            "actors": actors,
            "resources": resources,
            "sessions": sessions,
            "tokens": tokens,
            "credentials": credentials,
            "workflows": workflows,
            "services": services,
            "caches": caches,
            "trust_boundaries": boundaries,
        }

    def _workflows(
        self,
        mechanism: Mechanism,
        plan: WorldPlan,
        resources: Sequence[Mapping[str, Any]],
        state: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        workflow_id = "WFL-" + stable_digest(plan.skeleton_id, mechanism.family, "workflow")[:8].upper()
        transitions = [
            {"from_state": source, "to_state": target}
            for source, target in plan.workflow_transitions
        ]
        instances: list[dict[str, Any]] = []
        if plan.has_slot("workflow_instance"):
            instance_id = plan.id_for("workflow_instance")
            resource_id = (
                resources[0]["resource_id"] if resources else plan.id_for("target_resource")
            )
            instance_state = state["state"]["workflow_states"].get(instance_id, {})
            instances.append({
                "instance_id": instance_id,
                "resource_id": resource_id,
                # 终态：轨迹可能已经把实例推过若干状态。实体与快照必须同源，否则
                # 展开期记 hypothesis_before_mismatch，整条轴被静默跳过。
                "current_state": str(instance_state.get("current_state") or plan.workflow_initial_state),
                "history": [],
            })
        return [{
            "workflow_id": workflow_id,
            # Phase 2B 泄漏修复：name 曾嵌机制族名（= 攻击族名），structured_state 渲染
            # 会把它带进 model-visible（B12 投影白名单命中，W-90a101a962ca 实测）。
            # category 不是攻击族，确定性且语义自洽。
            "name": f"{mechanism.category} lifecycle",
            "states": list(plan.workflow_states),
            "initial_state": plan.workflow_initial_state,
            "transitions": transitions,
            "instances": instances,
        }]

    def _sessions(
        self,
        mechanism: Mechanism,
        plan: WorldPlan,
        actors: Sequence[Mapping[str, Any]],
        state: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        if not plan.has_slot("acting_session"):
            return []
        session_id = plan.id_for("acting_session")
        principal_id = (
            plan.id_for("principal") if plan.has_slot("principal") else actors[0]["actor_id"]
        )
        peer_id = plan.id_for("peer") if plan.has_slot("peer") else principal_id
        # 会话嫁接类机制：会话绑的是 peer，行动主体是 principal ⇒ 不变量被违反
        bound_principal = peer_id if mechanism.family in (
            "session_principal_swap", "boundary_crossing_without_required_assertion",
        ) else principal_id
        session_state = state["state"]["session_states"].get(session_id, {})
        revoked = bool(session_state.get("revoked", False))
        session = {
            "session_id": session_id,
            "principal": bound_principal,
            "created_at": _instant(plan, -4),
            "authenticated_at": _instant(plan, -4),
            "auth_strength": "password_mfa",
            "valid": bool(session_state.get("valid", True)),
            "revoked": revoked,
            "expires_at": _instant(plan, 24),
            "privilege_snapshot": {
                "roles": list(actors[0]["roles"]) if actors else [],
                "privileges": list(actors[0]["privileges"]) if actors else [],
                "privilege_version": int(session_state.get("privilege_version", 1)),
            },
            "flow_id": _flow_id(plan, mechanism),
        }
        if revoked:
            # revoked_at 必须真的落在实体上：``revocation_time`` 语义事实的 canonical
            # 路径指向它，L1 会丢掉空的可选字段，缺了它就是 dangling_ref。
            session["revoked_at"] = _instant(plan, -1)
            session["revocation_reason"] = "policy_change"
        return [session]

    def _tokens(
        self,
        mechanism: Mechanism,
        plan: WorldPlan,
        actors: Sequence[Mapping[str, Any]],
        resources: Sequence[Mapping[str, Any]],
        state: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        if not plan.has_slot("acting_token"):
            return []
        token_id = plan.id_for("acting_token")
        subject = (
            plan.id_for("principal") if plan.has_slot("principal") else actors[0]["actor_id"]
        )
        peer_id = plan.id_for("peer") if plan.has_slot("peer") else subject
        resource_id = (
            resources[0]["resource_id"] if resources else plan.id_for("target_resource")
        )
        current_flow = _flow_id(plan, mechanism)
        # 跨 flow 类机制：token 签在另一个 flow 上
        token_flow = "FLOW-OTHER" if mechanism.family in (
            "token_reused_across_flow", "token_lineage_confusion",
            "session_reused_across_flow", "workflow_instance_reused_across_flow",
        ) else current_flow
        # 跨资源类机制：token 绑定到另一个资源
        other_resource = "RES-" + stable_digest(plan.skeleton_id, "other-resource")[:8].upper()
        bound_resource = (
            other_resource
            if mechanism.family == "token_bound_to_other_resource"
            else resource_id
        )
        # 血缘类机制：token 有父 token，且父 token 的 flow 不是根 flow
        parent = None
        if plan.has_slot("lineage_parent"):
            parent = plan.id_for("lineage_parent")
        audience = _token_audience(plan)
        scope = _token_scope(mechanism, plan)
        tokens: list[dict[str, Any]] = [{
            "token_id": token_id,
            "token_type": "access",
            "issuer": plan.id_for("authority_service") if plan.has_slot("authority_service") else "SVC-CORE",
            "subject": subject,
            "audience": audience,
            "scope": scope,
            "created_at": _instant(plan, -3),
            "expires_at": _instant(plan, -1) if mechanism.family == "expiry_window_violation" else _instant(plan, 24),
            "one_time": mechanism.family in (
                "one_time_token_reuse", "repeated_operation", "race_sensitive_state",
            ),
            "used": mechanism.family in (
                "one_time_token_reuse", "repeated_operation", "race_sensitive_state",
            ),
            "used_at": _instant(plan, -2) if mechanism.family in (
                "one_time_token_reuse", "repeated_operation", "race_sensitive_state",
            ) else None,
            "parent_token": parent,
            "flow_id": token_flow,
            "privilege_version": 1,
            "bound_resource": bound_resource,
        }]
        if plan.has_slot("lineage_parent"):
            tokens.append({
                "token_id": plan.id_for("lineage_parent"),
                "token_type": "access",
                "issuer": "SVC-ROOT",
                "subject": subject,
                "audience": audience,
                "scope": list(scope),
                "created_at": _instant(plan, -10),
                "expires_at": _instant(plan, 48),
                "one_time": False,
                "used": False,
                "used_at": None,
                "parent_token": None,
                # 血缘混乱：根的 flow 不是本次 flow
                "flow_id": "FLOW-ROOT" if mechanism.family == "token_lineage_confusion" else current_flow,
                "privilege_version": 1,
                "bound_resource": bound_resource,
            })
        return tokens

    def _credentials(
        self, mechanism: Mechanism, plan: WorldPlan, actors: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        if not plan.has_slot("credential"):
            return []
        holder = (
            plan.id_for("principal") if plan.has_slot("principal") else actors[0]["actor_id"]
        )
        return [{
            "credential_id": plan.id_for("credential"),
            "credential_type": "password",
            "holder": holder,
            "status": "active",
            "rotated_at": None,
        }]

    def _caches(self, mechanism: Mechanism, plan: WorldPlan) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for slot in ("cache_entry", "second_cache"):
            if not plan.has_slot(slot):
                continue
            fact_name = mechanism.slot_facts.get(slot)
            value = _cache_value(mechanism, plan, slot)
            out.append({
                "cache_id": plan.id_for(slot),
                "cached_subject": _cache_subject(mechanism, plan, slot),
                "cached_value": value,
                "source_of_truth": mechanism.cache_source or "SVC-CORE",
                # fresh 与 cached_value 必须同源：实体写一套、轴 before 写另一套，
                # 展开期就记 hypothesis_before_mismatch，整条轴被静默跳过。
                "fresh": bool(value) if fact_name == "cache_freshness" else True,
                "ttl_seconds": 60,
                "populated_at": _instant(plan, -2),
            })
        return out

    def _boundaries(
        self, mechanism: Mechanism, plan: WorldPlan, services: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        if not plan.has_slot("boundary"):
            return []
        service_id = services[0]["service_id"] if services else "SVC-CORE"
        return [{
            "boundary_id": plan.id_for("boundary"),
            # 同上：机制族名 → category（Phase 2B 泄漏修复）。
            "name": f"{mechanism.category} boundary",
            "inside": [service_id],
            "outside": ["client-supplied-input"],
            "crossing_requires": ["signed-assertion"],
        }]

    # -- 阶段 5：状态 ------------------------------------------------------- #
    def _states(
        self, document: Mapping[str, Any], mechanism: Mechanism, plan: WorldPlan
    ) -> dict[str, Any]:
        history_lines = [str(item) for item in document.get("history") or ()]
        landmarks = [classify_history_line(line) for line in history_lines]
        self._check_landmarks(mechanism, landmarks, history_lines)

        # 初始状态（轨迹之前）
        state = _initial_state(plan)
        snapshots: list[dict[str, Any]] = []
        applied: list[str] = []
        for index, (line, landmark) in enumerate(zip(history_lines, landmarks, strict=True)):
            step = _step_for(mechanism, landmark)
            if step is not None:
                state = _apply_step(plan, state, step)
                applied.append(landmark)
            snapshots.append({
                "snapshot_id": f"SNAP-{index:03d}",
                "at": _instant(plan, index),
                "label": line[:120],
                **_snapshot_body(state),
            })
        # current_state 必须是最后一个快照之后（Gate 2：current_state.at >= max(history.at)）
        current = {
            "snapshot_id": f"SNAP-{len(snapshots):03d}",
            "at": _instant(plan, len(snapshots)),
            "label": "T0 current",
            **_snapshot_body(state),
        }
        return {
            "snapshots": snapshots,
            "current": current,
            "landmarks": landmarks,
            "applied_landmarks": tuple(applied),
            "state": state,
            "history_lines": history_lines,
        }

    def _check_landmarks(
        self,
        mechanism: Mechanism,
        landmarks: Sequence[str],
        history_lines: Sequence[str],
    ) -> None:
        missing = [
            landmark for landmark in mechanism.required_landmarks
            if not any(_landmark_matches(landmark, item) for item in landmarks)
        ]
        if missing:
            raise fail(
                "history", "HISTORY_INCONSISTENT", "history",
                f"机制 {mechanism.family!r} 要求历史里出现 {list(mechanism.required_landmarks)}，"
                f"缺少 {missing}（分类结果: {list(landmarks)}）",
            )
        if not history_lines:
            raise fail("history", "HISTORY_INCONSISTENT", "history", "history 不能为空")
        # 顺序约束：required_landmarks 必须按声明顺序出现
        positions: list[int] = []
        cursor = 0
        for landmark in mechanism.required_landmarks:
            found = None
            for index in range(cursor, len(landmarks)):
                if _landmark_matches(landmark, landmarks[index]):
                    found = index
                    break
            if found is None:
                raise fail(
                    "history", "HISTORY_INCONSISTENT", "history",
                    f"机制 {mechanism.family!r} 的 landmark {landmark!r} 未按顺序出现",
                )
            positions.append(found)
            cursor = found + 1
        if positions != sorted(positions):
            raise fail(
                "history", "HISTORY_INCONSISTENT", "history",
                f"机制 {mechanism.family!r} 的 landmark 顺序与声明不符: {positions}",
            )

    # -- 阶段 6：不变量与策略 ----------------------------------------------- #
    def _rules(
        self, document: Mapping[str, Any], mechanism: Mechanism, plan: WorldPlan
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        declared = document.get("security_invariants") or []
        if not declared:
            raise fail(
                "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
                "security_invariants 不能为空",
            )
        # 机制声明的不变量原型必须全部出现在骨架里（反过来不允许：骨架多声明的原型
        # 也编译，但它必须在本机制的 optional 集里，否则这个世界会带上机制不支持的规则）。
        supported = set(mechanism.invariants and [item.archetype for item in mechanism.invariants]) or set()
        results: list[ArchetypeResult] = []
        seen_archetypes: set[str] = set()
        for index, item in enumerate(declared):
            if not isinstance(item, Mapping):
                raise fail(
                    "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
                    f"security_invariants[{index}] 必须是对象",
                )
            archetype_key = str(item.get("type") or "")
            if not archetype_key:
                raise fail(
                    "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
                    f"security_invariants[{index}].type 不能为空",
                )
            spec = next(
                (entry for entry in mechanism.invariants if entry.archetype == archetype_key), None
            )
            if spec is None:
                raise fail(
                    "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
                    f"机制 {mechanism.family!r} 不支持不变量原型 {archetype_key!r}；"
                    f"支持: {sorted(supported) or '（无）'}",
                )
            results.append(build_archetype(archetype_key, plan, spec.params))
            seen_archetypes.add(archetype_key)
        missing = sorted(supported - seen_archetypes)
        if missing:
            raise fail(
                "invariant", "UNSUPPORTED_INVARIANT", "security_invariants",
                f"机制 {mechanism.family!r} 必须声明不变量原型 {missing}，骨架漏了",
            )

        invariants: list[dict[str, Any]] = []
        policies: list[dict[str, Any]] = []
        operation = plan.primary_operation
        for index, result in enumerate(results):
            invariant_id = f"INV-{index + 1:03d}-" + stable_digest(
                plan.skeleton_id, result.category, index
            )[:6].upper()
            invariants.append({
                "invariant_id": invariant_id,
                "category": result.category,
                "applies_to": list(result.applies_to),
                "severity": "critical",
                "description": result.description,
                "expr": result.invariant_expr,
            })
            if result.policy_condition.get("op") == "lit" and result.policy_condition.get("value") is True:
                # 纯证据桥：不生成对应 allow 规则（它会把"来源不可信"变成 attack）
                continue
            policy_id = f"POL-{index + 1:03d}-" + stable_digest(
                plan.skeleton_id, "policy", index
            )[:6].upper()
            policy: dict[str, Any] = {
                "policy_id": policy_id,
                "description": result.description,
                "action": {"operation": operation, "resource_type": _resource_type_name(plan)},
                "effect": "allow",
                "condition": result.policy_condition,
                "priority": 100 - index,
            }
            # 一律 requires_fresh：掩蔽的 ``stale`` level 需要"有 in-scope 策略要求新鲜"
            # （§9.4 判定规则）。只给缓存类原型标会让其它机制的 stale 变体永远进
            # ``skipped``——那不是世界的问题，是编译策略的问题。
            policy["requires_fresh"] = True
            policies.append(policy)
        policies.append({
            "policy_id": "POL-DEFAULT-DENY",
            "description": "Closed-world default deny.",
            "action": {"operation": "*"},
            "effect": "deny",
            "condition": {"op": "lit", "value": True},
            "priority": -1,
            "is_default_rule": True,
        })
        if not policies[:-1]:
            raise fail(
                "policy", "UNREACHABLE_FAILURE", "security_invariants",
                "没有任何 allow 规则被编译出来（只有默认拒绝）——世界的失败不可达",
            )
        return invariants, policies

    # -- 阶段 7：证据 ------------------------------------------------------- #
    def _evidence(
        self, document: Mapping[str, Any], mechanism: Mechanism, plan: WorldPlan
    ) -> list[dict[str, Any]]:
        required = [str(item) for item in document.get("required_evidence") or ()]
        untrusted = {str(item) for item in document.get("untrusted_evidence") or ()}
        optional = {str(item) for item in document.get("optional_evidence") or ()}
        masking_targets = [str(item) for item in document.get("evidence_masking_targets") or ()]
        if not required:
            raise fail(
                "evidence", "EVIDENCE_UNRESOLVABLE", "required_evidence",
                "required_evidence 不能为空",
            )
        unknown = [
            name for name in required + masking_targets + list(untrusted) + list(optional)
            if semantic_fact(name) is None
        ]
        if unknown:
            raise fail(
                "evidence", "UNKNOWN_SEMANTIC_FACT", "required_evidence",
                f"证据概念 {unknown} 不在语义事实本体内",
            )

        items: list[dict[str, Any]] = []
        counter = 0

        def add(fact_name: str, *, trust: str, freshness: str, controllable: bool,
                provenance: str, contradicts: str | None = None,
                value_override: Any = None, actor_slot: str | None = None) -> None:
            nonlocal counter
            fact = semantic_fact(fact_name)
            if fact is None:
                raise fail(
                    "evidence", "UNKNOWN_SEMANTIC_FACT", "required_evidence",
                    f"证据概念 {fact_name!r} 不在本体",
                )
            if actor_slot is not None and fact.entity_type == "actor":
                path = plan.path_for(actor_slot, fact.field_path)
                value = _actor_slot_value(plan, actor_slot, fact)
            else:
                path = plan.resolved_path(fact_name) or plan.bind(fact)
                if fact.entity_type not in _EVIDENCE_REF_ENTITY_TYPES:
                    # ``evidence.schema.json`` 的 asserts_ref 模式只认九类实体；
                    # trust_boundary / observation 上的事实不能当证据目标。
                    return
                value = plan.value_of(fact_name) if value_override is None else value_override
            item: dict[str, Any] = {
                "evidence_id": f"EV-{counter:03d}",
                "type": _evidence_type(fact, provenance),
                "asserts_ref": path,
                "value": value,
                "source": _evidence_source(plan, provenance),
                "provenance": provenance,
                "trust_level": trust,
                "timestamp": _instant(plan, 0),
                "freshness": freshness,
                "attacker_controllable": controllable,
                "visible_in_observation": True,
            }
            if contradicts:
                item["contradicts"] = [contradicts]
            items.append(item)
            counter += 1

        # 机制声明的证据计划优先（它知道每个事实该用什么信任级别）
        for spec in mechanism.evidence:
            if spec.optional and spec.fact not in required:
                continue
            fact = semantic_fact(spec.fact)
            if fact is None:
                raise fail(
                    "evidence", "UNKNOWN_SEMANTIC_FACT", "required_evidence",
                    f"机制 {mechanism.family!r} 的证据计划指向未知事实 {spec.fact!r}",
                )
            add(
                spec.fact,
                trust=spec.trust,
                freshness=spec.freshness,
                controllable=spec.attacker_controllable,
                provenance=spec.provenance,
            )
        # actor 绑定的事实补一条 peer 镜像：否则第二个 probe（对照主体行动）时
        # ``action.actor.*`` 解析到 peer，而 peer 的事实没有任何证据 ⇒ 每个对照 probe
        # 的 base 都只能是 insufficient_evidence，标签多样性被证据布局人为压平。
        for spec in list(mechanism.evidence):
            fact = semantic_fact(spec.fact)
            if fact is None or fact.entity_type != "actor" or fact.slot != "principal":
                continue
            if not plan.has_slot("peer"):
                continue
            add(
                spec.fact,
                trust=spec.trust,
                freshness=spec.freshness,
                controllable=spec.attacker_controllable,
                provenance=spec.provenance,
                actor_slot="peer",
            )
        # 骨架声明但机制没摆的事实：补一条系统记录证据（宁可多摆，不可漏摆）
        covered = {spec.fact for spec in mechanism.evidence}
        for name in required:
            if name in covered or semantic_fact(name) is None:
                continue
            if not plan.has_slot(semantic_fact(name).slot):  # type: ignore[union-attr]
                continue
            add(name, trust="trusted", freshness="fresh", controllable=False,
                provenance="system_of_record")
        # 矛盾项：掩蔽的 contradictory level 只能"保留"世界声明出来的矛盾
        primary = next(
            (spec.fact for spec in mechanism.evidence if not spec.optional), None
        )
        if primary is None and items:
            primary = str(required[0])
        if mechanism.declare_contradiction and primary is not None and semantic_fact(primary) is not None:
            baseline_id = next(
                (item["evidence_id"] for item in items if item["asserts_ref"] == plan.resolved_path(primary)),
                None,
            )
            # 矛盾必须由**世界声明**（掩蔽只能保留它，不能制造它），且冲突双方都要能
            # establishing——``trusted`` vs ``semi_trusted`` 都在 TRUSTED_ESTABLISHES
            # 里，取值不同才构成 §9.4 的 contradictory。这里**不**标
            # attacker_controllable：半可信即可控的项会同时取消 ``attacker_controlled``
            # level（那条规则要求"有可控项且没有可控的可信项"）。
            add(
                primary,
                trust="semi_trusted",
                freshness="fresh",
                controllable=False,
                provenance="log_pipeline",
                contradicts=baseline_id,
                value_override=_contradicting_value(plan, primary),
            )
        # 客户端可控项：``attacker_controlled`` level 需要"有 attacker_controllable
        # 且不在可信集里"的证据。untrusted 不 establishing，因此它只陪衬、不改判决。
        if primary is not None and semantic_fact(primary) is not None:
            add(
                primary,
                trust="untrusted",
                freshness="fresh",
                controllable=True,
                provenance="client_supplied",
            )
        # 陈旧项：stale level 需要一条陈旧 establishing 证据
        if primary is not None and semantic_fact(primary) is not None:
            add(
                primary,
                trust="semi_trusted",
                freshness="stale",
                controllable=False,
                provenance="replicated_cache",
            )
        if not items:
            raise fail(
                "evidence", "EVIDENCE_UNRESOLVABLE", "required_evidence",
                "没有构造出任何证据项",
            )
        return items

    # -- 阶段 8：信任 ------------------------------------------------------- #
    def _trust(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        plan: WorldPlan,
        entities: Mapping[str, Any],
    ) -> None:
        relationships = document.get("trust_relationships") or []
        for index, item in enumerate(relationships):
            if isinstance(item, Mapping):
                kind = str(item.get("kind") or "")
            else:
                kind = str(item)
            if not kind:
                raise fail(
                    "trust", "TRUST_RELATION_UNSUPPORTED", "trust_relationships",
                    f"trust_relationships[{index}] 不能为空",
                )
        # 机制要求 untrusted 证据源时，骨架必须真的声明了 untrusted_evidence
        needs_untrusted = any(
            spec.trust in ("untrusted", "derived") for spec in mechanism.evidence
        )
        if needs_untrusted and not (document.get("untrusted_evidence") or []):
            raise fail(
                "trust", "TRUST_RELATION_UNSUPPORTED", "untrusted_evidence",
                f"机制 {mechanism.family!r} 的决定性证据来自不可信来源，"
                "骨架必须声明 untrusted_evidence",
            )

    # -- 阶段 9：反事实 ----------------------------------------------------- #
    def _counterfactuals(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        plan: WorldPlan,
        state: Mapping[str, Any],
    ) -> tuple[tuple[dict[str, Any], ...], tuple[str, ...]]:
        declared = document.get("counterfactuals") or []
        if not declared:
            raise fail(
                "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                "counterfactuals 不能为空",
            )
        supported = {spec.fact: spec for spec in mechanism.counterfactuals}
        axes: list[dict[str, Any]] = []
        surface_requests: list[str] = []
        seen_paths: set[str] = set()
        for index, item in enumerate(declared):
            if not isinstance(item, Mapping):
                raise fail(
                    "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                    f"counterfactuals[{index}] 必须是对象",
                )
            fact_name = str(item.get("target_fact") or "")
            change = str(item.get("change") or "")
            expectation = str(item.get("semantic_expectation") or "")
            fact = semantic_fact(fact_name)
            if fact is None:
                raise fail(
                    "counterfactual", "UNKNOWN_SEMANTIC_FACT", "counterfactuals",
                    f"未知语义事实 {fact_name!r}",
                )
            if fact.group == "surface":
                # 观测表面事实走无关轴（brief §16 的第三个例子：改 locale，判决不变）。
                # 它**不是**关键轴——扰动它会改世界状态之外的观测面，而关键轴必须落在
                # 世界状态上（critical_axes_whitelist）。
                if change not in ("change_cosmetic", "change_value"):
                    raise fail(
                        "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                        f"观测表面事实 {fact_name!r} 只接受 change_cosmetic，得到 {change!r}",
                    )
                surface_requests.append(fact_name)
                continue
            spec = supported.get(fact_name)
            if spec is None:
                raise fail(
                    "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                    f"机制 {mechanism.family!r} 不支持对 {fact_name!r} 的反事实；"
                    f"支持: {sorted(supported)}",
                )
            if change not in spec.changes:
                raise fail(
                    "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                    f"事实 {fact_name!r} 不支持改法 {change!r}；可用: {list(spec.changes)}",
                )
            path = plan.resolved_path(fact_name) or plan.bind(fact)
            if not fact.axis_pattern:
                raise fail(
                    "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                    f"事实 {fact_name!r} 不能当反事实轴（没有 axis_pattern）",
                )
            before, after = _mutate(plan, state, fact_name, change)
            if before == after:
                raise fail(
                    "counterfactual", "COUNTERFACTUAL_NOOP", "counterfactuals",
                    f"事实 {fact_name!r} 的改法 {change!r} 不改变取值"
                    f"（before == after == {before!r}）：空干预会让 verdict_invariant 假通过",
                )
            if path in seen_paths:
                raise fail(
                    "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                    f"路径 {path!r} 被多条反事实重复指定",
                )
            seen_paths.add(path)
            axes.append({
                "axis_id": f"AXIS-{index + 1:03d}",
                "variable": path,
                "kind": "critical",
                "before": before,
                "after": after,
                # 先验 → world-spec 的 expected_effect 词表（brief §35：先验不是真值，
                # 最终分类由 Oracle 轨迹复核；矛盾先验由 validators/verify.py 拒收）。
                "expected_effect": _expected_effect(expectation or spec.default_expectation),
                "rationale": (
                    f"语义骨架声明对 {fact_name} 施加 {change}"
                    f"（semantic_expectation={expectation or spec.default_expectation}）；"
                    "最终效应由 Oracle 轨迹复核。"
                ),
            })
        if not axes:
            raise fail(
                "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                "没有解析出任何关键轴",
            )
        return tuple(axes), tuple(dict.fromkeys(surface_requests))

    # -- 阶段 10：无关事实 -------------------------------------------------- #
    def _irrelevant(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        plan: WorldPlan,
        axes: Sequence[Mapping[str, Any]],
        surface_requests: Sequence[str] = (),
    ) -> tuple[dict[str, Any], ...]:
        """把骨架的 ``irrelevant_facts`` 落地成 observation 轴（brief §15 / B9）。

        无关轴**必须**是 ``observation.(request|rendering).*`` 路径：改了世界状态的
        "无关"轴会让 Gate 6 的 ``changed_paths == ()`` 永假。因此这里只接受
        ontology 的 ``surface`` 分组，并校验它与 critical 事实不冲突（brief §32）。
        """
        declared = [str(item) for item in document.get("irrelevant_facts") or ()]
        declared.extend(str(item) for item in surface_requests if str(item) not in declared)
        if len(declared) < 2:
            raise fail(
                "counterfactual", "IRRELEVANT_FACT_CONFLICT", "irrelevant_facts",
                f"irrelevant_facts 至少 2 个，得到 {len(declared)}",
            )
        critical = {str(axis["variable"]) for axis in axes}
        critical_facts = {str(item) for item in document.get("critical_facts") or ()}
        overlap = sorted(set(declared) & critical_facts)
        if overlap:
            raise fail(
                "counterfactual", "IRRELEVANT_FACT_CONFLICT", "irrelevant_facts",
                f"irrelevant_facts 与 critical_facts 冲突: {overlap}"
                "（同一个事实不可能既关键又无关）",
            )
        out: list[dict[str, Any]] = []
        used_paths: set[str] = set()
        for name in declared:
            fact = semantic_fact(name)
            if fact is None:
                raise fail(
                    "counterfactual", "UNKNOWN_SEMANTIC_FACT", "irrelevant_facts",
                    f"irrelevant_facts 的 {name!r} 不在语义事实本体内",
                )
            if fact.group != "surface":
                raise fail(
                    "counterfactual", "IRRELEVANT_FACT_CONFLICT", "irrelevant_facts",
                    f"无关事实 {name!r} 属于 {fact.group!r} 分组而不是 surface——"
                    "它落在世界状态上，扰动它会改变 changed_paths，Gate 6 永假",
                )
            path = surface_axis_path(name)
            if path is None or path in used_paths or path in critical:
                raise fail(
                    "counterfactual", "IRRELEVANT_FACT_CONFLICT", "irrelevant_facts",
                    f"无关事实 {name!r} 解析不出可用的观测轴路径（{path!r}）",
                )
            used_paths.add(path)
            out.append({
                "axis_id": "AXIS-IR-" + str(len(out) + 1).zfill(3),
                "variable": path,
                "kind": "irrelevant",
                "before": "before",
                "after": "after",
                "expected_effect": "verdict_invariant",
                "rationale": "Surface-only axis: it carries no decision-critical fact.",
            })
        return tuple(out)

    # -- 阶段 11：episode 模板 ---------------------------------------------- #
    def _templates(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        plan: WorldPlan,
        state: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        history_lines = state["history_lines"]
        landmarks = state["landmarks"]
        operation = plan.primary_operation
        binds: dict[str, Any] = {"operation": operation, "flow_id": _flow_id(plan, mechanism)}
        if plan.has_slot("target_resource"):
            binds["resource_id"] = plan.id_for("target_resource")
        if plan.has_slot("acting_session"):
            binds["session_id"] = plan.id_for("acting_session")
        if plan.has_slot("acting_token"):
            binds["token_id"] = plan.id_for("acting_token")
        if plan.has_slot("workflow_instance"):
            binds["workflow_instance_id"] = plan.id_for("workflow_instance")

        actors = ["principal", "peer"] if plan.has_slot("peer") else ["principal"]
        events: list[dict[str, Any]] = []
        for offset, (line, landmark) in enumerate(zip(history_lines, landmarks, strict=True)):
            events.append({
                "event_type": landmark if landmark != "other" else "request",
                "actor_id": plan.id_for("principal"),
                "t_offset_ms": offset * 60000,
                "causal_tag": "relevant",
                # summary 进 model_visible：机制族名/attack_family 是 decision metadata
                # （compile_spec 会把 attack_family 整块丢掉），写进时间线就是 G12 泄漏。
                # 编译器在这里做有界消毒——真实 run 实测 144 处命中全来自这一处。
                "summary": _sanitise_prose(line, mechanism)[:500],
            })
        decision_index = max(len(events) - 1, 0)
        for actor_slot in actors:
            event = {
                "event_type": "sensitive_operation",
                "actor_id": plan.id_for(actor_slot),
                "t_offset_ms": len(events) * 60000,
                "causal_tag": "relevant",
                # 同样消毒：机制族名不得以任何形式进 model_visible（G12 硬门）。
                "summary": _sanitise_prose(
                    f"{actor_slot} performs {operation} under the {mechanism.family} mechanism",
                    mechanism,
                ),
                "binds": dict(binds),
            }
            events.append(event)
            if actor_slot == actors[0]:
                decision_index = len(events) - 1
        return [{
            "template_id": "TPL-001",
            "decision_event_index": decision_index,
            "events": events,
        }]

    # -- 组装 --------------------------------------------------------------- #
    def _assemble(
        self,
        document: Mapping[str, Any],
        mechanism: Mechanism,
        plan: WorldPlan,
        entities: Mapping[str, Any],
        state: Mapping[str, Any],
        invariants: Sequence[Mapping[str, Any]],
        policies: Sequence[Mapping[str, Any]],
        evidence: Sequence[Mapping[str, Any]],
        axes: Sequence[Mapping[str, Any]],
        irrelevant: Sequence[Mapping[str, Any]],
        templates: Sequence[Mapping[str, Any]],
        ctx: CompileContext,
    ) -> dict[str, Any]:
        critical = [str(axis["variable"]) for axis in axes]
        opportunities = [{
            "opportunity_id": "OPP-001",
            "attack_family": mechanism.attack_family,
            "target_operation": plan.primary_operation,
            "hypothesized_verdict": "attack",
            "rationale": str(document.get("failure_mechanism") or mechanism.summary)[:1024],
        }]
        irrelevant_axes = [str(axis["variable"]) for axis in irrelevant]
        hypothesis_axes: list[dict[str, Any]] = [dict(axis) for axis in axes]
        hypothesis_axes.extend(dict(axis) for axis in irrelevant)

        spec: dict[str, Any] = {
            "schema_version": "0.1",
            "world_id": plan.world_id,
            "application_domain": plan.domain,
            "seed": plan.seed,
            "provenance": {
                "origin": ctx.origin,
                "generator_model": ctx.generator_model,
                "generator_model_version": ctx.generator_model_version,
                "prompt_version": ctx.prompt_version,
                "prompt_hash": ctx.prompt_hash,
                "generation_timestamp": ctx.generation_timestamp,
                "validation_outcome": "pending",
            },
            "attack_family": mechanism.attack_family,
            "application": {
                "name": f"{plan.domain} / {mechanism.family}",
                "description": str(document.get("scenario_summary") or mechanism.summary)[:4096],
                "endpoints": [
                    {
                        "path": f"/api/{_slug(plan.domain)}/{_slug(plan.resource_semantic_type)}/{{id}}",
                        "method": "POST",
                        "operation": plan.primary_operation,
                        "resource_type": _resource_type_name(plan),
                        "auth_required": True,
                    },
                    {
                        "path": f"/api/{_slug(plan.domain)}/{_slug(plan.resource_semantic_type)}/{{id}}/status",
                        "method": "GET",
                        "operation": plan.secondary_operation,
                        "resource_type": _resource_type_name(plan),
                        "auth_required": True,
                    },
                ],
            },
            "roles": entities["roles"],
            "actors": entities["actors"],
            "resources": entities["resources"],
            "sessions": entities["sessions"],
            "tokens": entities["tokens"],
            "credentials": entities["credentials"],
            "workflows": entities["workflows"],
            "services": entities["services"],
            "caches": entities["caches"],
            "trust_boundaries": entities["trust_boundaries"],
            "policies": list(policies),
            "invariants": list(invariants),
            "state_history": list(state["snapshots"]),
            "current_state": state["current"],
            "evidence": list(evidence),
            "critical_state_variables": critical,
            "irrelevant_state_variables": irrelevant_axes,
            "hypotheses": {
                "attack_opportunities": opportunities,
                "expected_counterfactual_axes": hypothesis_axes,
            },
            "episode_templates": list(templates),
            "notes": (
                f"Phase 2A semantic-skeleton compile: mechanism={mechanism.family}, "
                f"skeleton_id={plan.skeleton_id}, compiler={COMPILER_VERSION}"
            )[:4096],
        }
        if ctx.raw_generation_id:
            spec["provenance"]["raw_generation_id"] = ctx.raw_generation_id
        return spec


# --------------------------------------------------------------------------- #
# 助手
# --------------------------------------------------------------------------- #
def _slots_for_entities(entities: Sequence[str]) -> tuple[str, ...]:
    out: list[str] = []
    for kind in entities:
        if kind == "actor":
            out.extend(["principal", "peer"])
        elif kind == "resource":
            out.append("target_resource")
        elif kind == "session":
            out.append("acting_session")
        elif kind == "token":
            out.append("acting_token")
        elif kind == "workflow":
            out.append("workflow_instance")
        elif kind == "service":
            out.append("authority_service")
        elif kind == "cache":
            out.extend(["cache_entry", "second_cache"])
        elif kind == "credential":
            out.append("credential")
        elif kind == "trust_boundary":
            out.append("boundary")
    # 去重保序
    return tuple(dict.fromkeys(out))


def _tenant_ids(plan: WorldPlan) -> tuple[str, str]:
    digest = stable_digest(plan.skeleton_id, "tenants")[:8].upper()
    return (f"TEN-{digest[:4]}", f"TEN-{digest[4:]}")


def _role_set(mechanism: Mechanism) -> tuple[str, ...]:
    roles: list[str] = ["ROLE-MEMBER", "ROLE-VIEWER"]
    for spec in mechanism.invariants:
        for value in spec.params.get("roles", ()) or ():
            name = str(value)
            if name not in roles:
                roles.append(name)
    return tuple(roles)


def _privileges_for(role_id: str) -> list[str]:
    slug = role_id.split("-", 1)[1].lower() if "-" in role_id else role_id.lower()
    return [f"{slug}.act", f"{slug}.read"]


def _flow_id(plan: WorldPlan, mechanism: Mechanism) -> str:
    digest = stable_digest(plan.skeleton_id, "flow")[:6].upper()
    return f"FLOW-{digest}"


def _token_scope(mechanism: Mechanism, plan: WorldPlan) -> list[str]:
    if mechanism.family in ("token_scope_overreach", "token_scope_carries_tenant",
                            "token_tenant_mismatch", "delegated_tenant_access"):
        return ["write"]
    if mechanism.family == "token_audience_mismatch":
        return ["read", "write"]
    return ["read"]


def _cache_subject(mechanism: Mechanism, plan: WorldPlan, slot: str) -> str:
    """cache.cached_subject 必须是可解析的 ID 视图路径（Gate 2 会查）。"""
    if slot == "cache_entry":
        mapping = {
            "cached_owner": ("resource", "owner"),
            "cached_privilege_version": ("actor", "privilege_version"),
            "cached_policy_version": ("service", "service_id"),
            "cached_tenant_context_version": ("service", "service_id"),
            "cached_tenant": ("actor", "tenant"),
            "cache_freshness": ("session", "revoked"),
            "cache_populated_at": ("resource", "owner"),
        }
    else:
        mapping = {
            "replica_cached_value": ("resource", "owner"),
            "cached_policy_version": ("service", "service_id"),
            "current_tenant_context_version": ("service", "service_id"),
            "cached_privilege_version": ("actor", "privilege_version"),
        }
    fact_name = mechanism.slot_facts.get(slot)
    # 候选 (entity_type, slot, field_path) 按语义优先级排列，取第一个**槽真的开了**的。
    # 写一个占位 id（SES-CORE 之类）就是一条 dangling_ref——cache.cached_subject
    # 要被 Gate 2 静态解析。
    by_slot = {
        "cache_entry": {
            "cached_owner": ("resource", "target_resource", "owner"),
            "cached_privilege_version": ("actor", "principal", "privilege_version"),
            "cached_policy_version": ("service", "authority_service", "service_id"),
            "cached_tenant_context_version": ("service", "authority_service", "service_id"),
            "cached_tenant": ("actor", "principal", "tenant"),
            "cache_freshness": ("session", "acting_session", "revoked"),
            "cache_populated_at": ("resource", "target_resource", "owner"),
        },
        "second_cache": {
            "replica_cached_value": ("resource", "target_resource", "owner"),
            "cached_policy_version": ("service", "authority_service", "service_id"),
            "current_tenant_context_version": ("service", "authority_service", "service_id"),
            "cached_privilege_version": ("actor", "principal", "privilege_version"),
            "cached_tenant": ("actor", "principal", "tenant"),
        },
    }
    preferred = by_slot.get(slot, {}).get(fact_name or "")
    candidates = [preferred] if preferred else []
    candidates.append(("service", "authority_service", "service_id"))
    candidates.append(("actor", "principal", "tenant"))
    for entity_type, slot_name, field_path in candidates:
        if plan.has_slot(slot_name):
            return f"{entity_type}.{plan.id_for(slot_name)}.{field_path}"
    return f"actor.{plan.id_for('principal')}.tenant"


def _cache_value(mechanism: Mechanism, plan: WorldPlan, slot: str) -> Any:
    fact_name = mechanism.slot_facts.get(slot)
    # 语义：缓存持的是"旧值"，权威侧持"新值"
    stale = {
        "cached_owner": plan.id_for("peer") if plan.has_slot("peer") else "ACT-CORE",
        "cached_privilege_version": 1,
        "cached_policy_version": 1,
        "cached_tenant_context_version": 1,
        "cached_tenant": plan.tenant_of("peer") if plan.has_slot("peer") else "TEN-CORE",
        "cache_freshness": True,
        "cache_populated_at": _instant(plan, -2),
    }
    fresh = {
        "replica_cached_value": plan.id_for("peer") if plan.has_slot("peer") else "ACT-CORE",
        "cached_policy_version": 4,
        "current_tenant_context_version": 2,
        "cached_privilege_version": 3,
    }
    if slot == "cache_entry":
        return stale.get(fact_name or "", "STALE")
    return fresh.get(fact_name or "", "CURRENT")


def _actor_slot_value(plan: WorldPlan, slot: str, fact: SemanticFact) -> Any:
    """peer 槽上同一语义事实的取值（证据镜像用）。"""
    if fact.field_path == "tenant":
        return plan.tenant_of(slot)
    if fact.field_path == "actor_id":
        return plan.id_for(slot)
    if fact.field_path == "roles":
        return ["ROLE-MEMBER"]
    if fact.field_path == "privileges":
        return _privileges_for("ROLE-MEMBER")
    if fact.field_path == "privilege_version":
        return 1
    if fact.field_path == "authentication_state":
        return "authenticated"
    if fact.field_path == "identity.verified":
        return True
    return plan.value_of(fact.name)


def _contradicting_value(plan: WorldPlan, fact_name: str) -> Any:
    """与基准取值**不同**的值（contradictory level 需要两个 establishing 项取值不同）。"""
    base = plan.value_of(fact_name)
    if isinstance(base, str):
        return f"{base}-contradicted"
    if isinstance(base, bool):
        return not base
    if isinstance(base, int) and not isinstance(base, bool):
        return base + 1
    if isinstance(base, (list, tuple)):
        return [*(list(base)), "contradicted"]
    return "contradicted"


def _evidence_type(fact: SemanticFact, provenance: str) -> str:
    if provenance == "client_supplied":
        return "http_header"
    if provenance == "replicated_cache":
        return "cache_entry"
    if provenance == "llm_derived":
        return "derived_summary"
    if fact.group == "token":
        return "token_claim"
    if fact.group == "session":
        return "session_record"
    if fact.group == "cache":
        return "cache_entry"
    if fact.group == "identity":
        return "identity_claim"
    if fact.group == "resource":
        return "ownership_record"
    if fact.group == "trust":
        return "service_metadata"
    return "log_line"


def _evidence_source(plan: WorldPlan, provenance: str) -> str:
    if provenance == "client_supplied":
        return "client-supplied-header"
    if provenance == "replicated_cache":
        return plan.id_for("cache_entry") if plan.has_slot("cache_entry") else "replica"
    if provenance == "llm_derived":
        return "derived-summary-pipeline"
    return plan.id_for("authority_service") if plan.has_slot("authority_service") else "system-of-record"


def _initial_state(plan: WorldPlan) -> dict[str, Any]:
    state: dict[str, Any] = {
        "actor_states": {}, "session_states": {}, "token_states": {},
        "workflow_states": {}, "resource_states": {},
    }
    for slot in ("principal", "peer"):
        if plan.has_slot(slot):
            state["actor_states"][plan.id_for(slot)] = {
                "authentication_state": "authenticated",
                "privilege_version": 1,
                "roles": ["ROLE-MEMBER"],
            }
    if plan.has_slot("acting_session"):
        state["session_states"][plan.id_for("acting_session")] = {
            "valid": True, "revoked": False, "privilege_version": 1,
        }
    for slot in ("acting_token", "lineage_parent"):
        if plan.has_slot(slot):
            state["token_states"][plan.id_for(slot)] = {"used": False, "valid": True}
    if plan.has_slot("workflow_instance"):
        state["workflow_states"][plan.id_for("workflow_instance")] = {
            "current_state": plan.workflow_initial_state,
        }
    if plan.has_slot("target_resource"):
        state["resource_states"][plan.id_for("target_resource")] = {
            "state": "active", "owner": plan.id_for("principal"),
        }
    return state


def _state_entry(
    state: Mapping[str, Any], slot: str, entity_id: str | None
) -> dict[str, Any]:
    """轨迹终态里某个槽的状态条目（快照分组 → 实体 id）。"""
    if entity_id is None:
        return {}
    group = {
        "principal": "actor_states", "peer": "actor_states",
        "acting_session": "session_states", "acting_token": "token_states",
        "lineage_parent": "token_states", "workflow_instance": "workflow_states",
        "target_resource": "resource_states",
    }.get(slot)
    if group is None:
        return {}
    return dict(state.get("state", {}).get(group, {}).get(entity_id, {}))


#: ``evidence.schema.json`` 的 ``asserts_ref`` 认得的实体类型（schema 模式钉死）。
_EVIDENCE_REF_ENTITY_TYPES: frozenset[str] = frozenset({
    "actor", "resource", "session", "token", "workflow_instance",
    "cache", "service", "credential", "role",
})

#: 快照每个分组允许的字段（``world.schema.json`` 的 state_snapshot 是
#: ``additionalProperties: false``）。轨迹可以往状态里写实体字段（如
#: ``acting_token.one_time``），但快照只投影这几项——多写一个键就是 schema 违规。
_SNAPSHOT_ALLOWED: Mapping[str, tuple[str, ...]] = {
    "actor_states": ("authentication_state", "privilege_version", "roles"),
    "session_states": ("valid", "revoked", "privilege_version"),
    "token_states": ("used", "valid"),
    "workflow_states": ("current_state",),
    "resource_states": ("state", "owner"),
}


def _snapshot_body(state: Mapping[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {}
    for group, allowed in _SNAPSHOT_ALLOWED.items():
        projected: dict[str, Any] = {}
        for entity_id, entry in state.get(group, {}).items():
            projected[entity_id] = {
                key: value for key, value in entry.items() if key in allowed
            }
            for key in allowed:
                projected[entity_id].setdefault(key, _SNAPSHOT_DEFAULTS[key])
        body[group] = projected
    return body


_SNAPSHOT_DEFAULTS: Mapping[str, Any] = {
    "authentication_state": "authenticated",
    "privilege_version": 1,
    "roles": [],
    "valid": True,
    "revoked": False,
    "used": False,
    "current_state": "open",
    "state": "active",
    "owner": None,
}


def _step_for(mechanism: Mechanism, landmark: str) -> StateStep | None:
    for step in mechanism.trajectory:
        if _landmark_matches(step.landmark, landmark):
            return step
    return None


def _apply_step(
    plan: WorldPlan, state: dict[str, Any], step: StateStep
) -> dict[str, Any]:
    import copy

    new_state = copy.deepcopy(state)
    for path, raw_value in step.updates:
        slot, _, field_path = str(path).partition(".")
        value = _resolve_symbolic(plan, raw_value)
        group = {
            "principal": "actor_states", "peer": "actor_states",
            "acting_session": "session_states", "acting_token": "token_states",
            "lineage_parent": "token_states", "workflow_instance": "workflow_states",
            "target_resource": "resource_states",
        }.get(slot)
        if group is None:
            continue
        entity_id = plan.id_for(slot)
        entry = new_state[group].setdefault(entity_id, {})
        if field_path == "tenant":
            plan.tenant_of_map[slot] = value
            continue
        if field_path == "roles":
            entry["roles"] = list(value) if isinstance(value, (list, tuple)) else [value]
            continue
        entry[field_path] = value
    return new_state


#: 消毒替换词（中性描述，不携带攻击族语义）。
_SANITISED_NOUN = "this control"


def _sanitise_prose(text: str, mechanism: Mechanism) -> str:
    """把决策元数据词从散文里剔掉（有界：只认机制族名与它派生的 attack_family）。

    为什么不由 prompt 单独保证：prompt 只能**要求**模型别写，编译器才能**保证**。
    两者都做——prompt 减少产生，编译器兜底清除（G12 是硬门，一个样本就足以让
    benchmark 失去意义）。
    """
    import re as _re

    out = str(text)
    for token in (mechanism.family, mechanism.attack_family):
        if not token:
            continue
        out = _re.sub(_re.escape(token), _SANITISED_NOUN, out, flags=_re.IGNORECASE)
    return out


def _instant(plan: WorldPlan, offset_hours: int) -> str:
    base = _EPOCH + _dt.timedelta(
        hours=int(stable_digest(plan.skeleton_id, "clock")[:6], 16) % 24
    )
    moment = base + _dt.timedelta(hours=offset_hours)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _slug(text: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in str(text).lower()).strip("-") or "app"


def _resource_type_name(plan: WorldPlan) -> str:
    from ..vocabularies import RESOURCE_TYPES

    semantic = plan.semantic_types.get("target_resource", "database_record")
    return RESOURCE_TYPES.get(semantic, "database_record")


#: 布尔改法 → 干预后的取值（``before`` 仍取世界实际值，空干预由调用方拒）。
_BOOLEAN_CHANGE_AFTER: Mapping[str, bool] = {
    "unrevoke": False,       # 会话撤销 True → False
    "revoke": True,
    "validate": True,        # 会话有效 False → True
    "invalidate": False,
    "mark_fresh": True,      # 缓存新鲜 False → True
    "mark_stale": False,
    "unconsume": False,      # 一次性 token 已用 True → False
    "consume": True,
}

#: 骨架的 semantic_expectation → world-spec 的 expected_effect（brief §35 的词表桥）。
_EXPECTATION_TO_EFFECT: Mapping[str, str] = {
    "violation_removed": "verdict_flip",
    "violation_created": "verdict_flip",
    "verdict_flip": "verdict_flip",
    "verdict_invariant": "verdict_invariant",
    "observable_downgrade": "observable_downgrade",
}


def _expected_effect(expectation: str) -> str:
    resolved = _EXPECTATION_TO_EFFECT.get(expectation)
    if resolved is None:
        raise fail(
            "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
            f"semantic_expectation {expectation!r} 不在词表内",
        )
    return resolved


def declared_facts(document: Mapping[str, Any]) -> set[str]:
    """骨架声明的全部语义事实（critical + 证据 + 反事实目标 + 无关）。"""
    out: set[str] = set()
    for key in (
        "critical_facts", "required_evidence", "optional_evidence",
        "untrusted_evidence", "evidence_masking_targets", "irrelevant_facts",
    ):
        for item in document.get(key) or ():
            out.add(str(item))
    for item in document.get("counterfactuals") or ():
        if isinstance(item, Mapping):
            out.add(str(item.get("target_fact") or ""))
    out.discard("")
    return out


# --------------------------------------------------------------------------- #
# 反事实变值器
# --------------------------------------------------------------------------- #
def _mutate(
    plan: WorldPlan, state: Mapping[str, Any], fact_name: str, change: str
) -> tuple[Any, Any]:
    """计算 (before, after)。before 必须等于编译出的基准值，否则展开期会记
    ``hypothesis_before_mismatch`` 并跳过该轴。"""
    fact = semantic_fact(fact_name)
    if fact is None:  # pragma: no cover
        raise fail("counterfactual", "UNKNOWN_SEMANTIC_FACT", "counterfactuals", fact_name)
    slot = plan.fact_slots.get(fact_name, fact.slot)
    entity_id = plan.id_for(slot) if plan.has_slot(slot) else None
    group = {
        "principal": "actor_states", "peer": "actor_states",
        "acting_session": "session_states", "acting_token": "token_states",
        "lineage_parent": "token_states", "workflow_instance": "workflow_states",
        "target_resource": "resource_states",
    }.get(slot)
    entry: dict[str, Any] = {}
    if group is not None and entity_id is not None:
        entry = state["state"].get(group, {}).get(entity_id, {})
    base = _base_value(plan, state, fact_name, slot, entity_id, entry)

    if change == "reassign_to_peer" and fact_name in (
        "resource_owner", "cached_owner", "replica_cached_value",
    ):
        # 把属主/缓存属主改到**对照主体**：base 是 principal 持有，干预后 peer 持有。
        return base, plan.id_for("peer") if plan.has_slot("peer") else plan.id_for("principal")
    if change == "align_with_authoritative" and fact_name in (
        "resource_owner", "cached_owner", "replica_cached_value",
    ):
        return base, plan.id_for("principal")
    if change == "bind_to_acting_principal":
        return base, plan.id_for("principal")
    if change == "grant_privileged_role":
        return base, _with_role(base, _privileged_role(plan))
    if change == "drop_privileged_role":
        return base, _without_role(base, _privileged_role(plan))
    # 布尔改法逐个钉死"干预后的取值"：before 取世界实际值，after 由改法决定。
    # 合桶写（"一类改法都设 True"）会把 unrevoke 与 revoke 混为一体——Phase 2A 自检
    # 第一次跑就抓到 5 个机制因此变成空干预（before == after）。
    boolean_after = _BOOLEAN_CHANGE_AFTER.get(change)
    if boolean_after is not None:
        return base, boolean_after
    if change == "disable_principal":
        return base, "disabled"
    if change == "restore_principal":
        return base, "authenticated"
    if change == "advance_to_required":
        return base, _required_state(plan)
    if change == "rewind_to_initial":
        return base, plan.workflow_initial_state
    if change == "switch_tenant":
        return base, _other_tenant(plan, base)
    if change == "align_with_required":
        return base, ["read"]
    if change == "diverge_from_required":
        return base, ["write"]
    if change == "carry_current_tenant":
        # 只对**列表型**事实有意义（token.scope）：把当前租户加进范围。
        # 对标量事实施加它是类型错误——override 会被展开期拒掉，因此这里显式拒绝。
        if not isinstance(base, (list, tuple)):
            raise fail(
                "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
                f"改法 carry_current_tenant 只适用于列表型事实，{fact_name!r} 的取值是 "
                f"{type(base).__name__}",
            )
        scope = list(base)
        tenant = plan.tenant_of("principal")
        return base, sorted(set([*scope, tenant]))
    if change == "align_with_cached_value":
        # 权威侧压到缓存侧的当前值：与 align_with_authoritative 方向相反、效果相同
        # （都把等式修好）。用于"两个缓存版本不一致"类机制。
        if fact_name in ("current_tenant_context_version", "current_policy_version"):
            return base, _cache_value(plan.mechanism, plan, "cache_entry")
        return base, _cache_value(plan.mechanism, plan, "second_cache")
    if change == "align_with_session_snapshot":
        session = state["state"]["session_states"].get(plan.id_for("acting_session"), {})
        return base, int(session.get("privilege_version", 1))
    if change == "rewind_to_declared_predecessor":
        required = _required_state(plan)
        for source, target in plan.workflow_transitions:
            if target == required:
                return base, source
        return base, plan.workflow_initial_state
    if change == "align_with_current_flow":
        return base, _flow_id(plan, plan.mechanism)
    if change == "diverge_from_current_flow":
        return base, "FLOW-OTHER"
    if change == "detach_from_parent":
        return base, None
    if change == "attach_to_root":
        return base, plan.id_for("lineage_parent")
    if change == "align_with_action_resource":
        return base, plan.id_for("target_resource")
    if change == "extend_into_future":
        return base, _instant(plan, 48)
    if change == "move_into_past":
        return base, _instant(plan, -48)
    if fact_name == "token_audience" and change in ("align_with_authoritative", "diverge_from_authoritative"):
        # audience 是字符串数组：权威侧是"本服务"，发散侧是"别的服务"。
        service = plan.id_for("authority_service") if plan.has_slot("authority_service") else "SVC-CORE"
        return base, ([service] if change == "align_with_authoritative" else ["SVC-UNRELATED"])
    if change == "align_with_authoritative":
        return base, _authoritative_value(plan, state, fact_name)
    if change == "diverge_from_authoritative":
        current = _authoritative_value(plan, state, fact_name)
        return base, _next_version(current)
    raise fail(
        "counterfactual", "COUNTERFACTUAL_UNRESOLVABLE", "counterfactuals",
        f"事实 {fact_name!r} 的改法 {change!r} 没有变值规则",
    )


def _base_value(
    plan: WorldPlan,
    state: Mapping[str, Any],
    fact_name: str,
    slot: str,
    entity_id: str | None,
    entry: Mapping[str, Any],
) -> Any:
    if slot in ("cache_entry", "second_cache"):
        return _cache_value(plan.mechanism, plan, slot)
    if slot == "credential":
        return "active"
    if slot == "boundary":
        return ["signed-assertion"]
    if slot == "authority_service":
        return entity_id
    if fact_name == "token_lineage":
        # 快照的 token_states 只带 {used, valid}，parent_token 是实体字段——从 plan 取。
        return plan.id_for("lineage_parent") if plan.has_slot("lineage_parent") else None
    if fact_name == "token_bound_resource":
        return _token_bound_resource(plan)
    if fact_name == "token_scope":
        return _token_scope(plan.mechanism, plan)
    if fact_name == "token_audience":
        return _token_audience(plan)
    if fact_name == "token_flow":
        return _token_flow(plan)
    if fact_name == "expiry_time":
        return _instant(plan, -1) if plan.mechanism.family == "expiry_window_violation" else _instant(plan, 24)
    if fact_name == "issue_time":
        return _instant(plan, -3)
    if fact_name == "revocation_time":
        return _instant(plan, -1)
    if fact_name == "cache_populated_at":
        return _instant(plan, -2)
    if fact_name == "authenticated_tenant" or fact_name == "resource_tenant":
        return plan.tenant_of(slot)
    if fact_name == "session_principal":
        # 会话嫁接类机制：会话实体绑的是对照主体，行动主体是 principal ⇒ 不变量被违反。
        if plan.mechanism.family in (
            "session_principal_swap", "boundary_crossing_without_required_assertion",
        ) and plan.has_slot("peer"):
            return plan.id_for("peer")
        return plan.id_for("principal")
    field = semantic_fact(fact_name)
    if field is None:  # pragma: no cover
        return None
    if field.field_path in entry:
        return entry[field.field_path]
    return entry.get(field.field_path.split(".")[-1])


def _token_audience(plan: WorldPlan) -> list[str]:
    if plan.mechanism.family == "token_audience_mismatch":
        return ["SVC-UNRELATED"]
    if plan.has_slot("authority_service"):
        return [plan.id_for("authority_service")]
    return ["SVC-CORE"]


def _token_bound_resource(plan: WorldPlan) -> str:
    if plan.mechanism.family == "token_bound_to_other_resource":
        return "RES-" + stable_digest(plan.skeleton_id, "other-resource")[:8].upper()
    return plan.id_for("target_resource") if plan.has_slot("target_resource") else "RES-CORE"


def _token_flow(plan: WorldPlan) -> str:
    if plan.mechanism.family in (
        "token_reused_across_flow", "token_lineage_confusion",
        "session_reused_across_flow", "workflow_instance_reused_across_flow",
    ):
        return "FLOW-OTHER"
    return _flow_id(plan, plan.mechanism)


def _with_role(base: Any, role: str) -> list[str]:
    roles = list(base) if isinstance(base, (list, tuple)) else []
    return sorted(set([*roles, role]))


def _without_role(base: Any, role: str) -> list[str]:
    roles = list(base) if isinstance(base, (list, tuple)) else []
    return [item for item in roles if item != role]


def _privileged_role(plan: WorldPlan) -> str:
    for spec in plan.mechanism.invariants:
        for value in spec.params.get("roles", ()) or ():
            return str(value)
    return "ROLE-ADMIN"


def _required_state(plan: WorldPlan) -> str:
    for spec in plan.mechanism.invariants:
        states = spec.params.get("states")
        if states:
            return str(states[0])
        to_state = spec.params.get("to_state")
        if to_state:
            return str(to_state)
    return plan.workflow_states[-1]


def _other_tenant(plan: WorldPlan, current: object) -> str:
    for candidate in (plan.tenant_of("principal"), plan.tenant_of("peer")):
        if candidate != current:
            return candidate
    return "TEN-OTHER"


def _authoritative_value(plan: WorldPlan, state: Mapping[str, Any], fact_name: str) -> Any:
    if fact_name in ("cached_privilege_version", "session_privilege_version",
                     "token_privilege_version"):
        actor = state["state"]["actor_states"].get(plan.id_for("principal"), {})
        return actor.get("privilege_version", 3)
    if fact_name in ("cached_owner", "replica_cached_value"):
        resource = state["state"]["resource_states"].get(plan.id_for("target_resource"), {})
        return resource.get("owner", plan.id_for("principal"))
    if fact_name == "cached_policy_version":
        return _cache_value(plan.mechanism, plan, "second_cache")
    if fact_name == "current_tenant_context_version":
        return _cache_value(plan.mechanism, plan, "second_cache")
    if fact_name == "cached_tenant_context_version":
        return _cache_value(plan.mechanism, plan, "second_cache")
    if fact_name == "cached_tenant":
        return plan.tenant_of("principal")
    if fact_name == "privilege_version":
        return 3
    return _cache_value(plan.mechanism, plan, "second_cache")


def _next_version(value: Any) -> Any:
    if isinstance(value, bool) or not isinstance(value, int):
        return value
    return value + 1


__all__ = [
    "COMPILER_VERSION",
    "CompilerFailure",
    "CompileContext",
    "IRRELEVANT_AXES",
    "SemanticSkeletonCompiler",
    "SkeletonCompileError",
    "classify_history_line",
]
