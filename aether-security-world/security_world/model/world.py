"""``WorldInstance``（编译产物）与 ``WorldSpec``（种子）——L1 的核心类型。

两个 schema 分开是有意的（设计 §3 D1）：spec 可以携带假设（``hypotheses`` /
``attack_family`` / ``episode_templates``），instance **结构上不可能**携带标签——
``world.schema.json`` 是 ``additionalProperties: false`` 且没有 ``ground_truth``
键，``schemas/examples/world.invalid.json`` 证明带该键的世界会被拒，且拒因就是
这个键。把两者混成一个 schema，"AI 写的假设"就会和"程序的状态"同层，I-1 失守。

``WorldInstance`` 是 oracle 的**唯一输入**。它内部持有一个只读的
:class:`~security_world.model.refs.ReferenceRegistry`，因此
``world.resolve("resource.RES-001.owner")`` 是世界状态的唯一读入口；
悬空引用在这里就炸，不会变成一个静默的 ``None`` 流到 oracle。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .canonical import (
    COUNTERFACTUAL_FAMILY_ID_PREFIX,
    WORLD_FAMILY_ID_PREFIX,
    canonical_json,
    derive_family_id,
    stable_hash,
)
from .documents import (
    Document,
    put_if_present,
    require_enum,
    require_fields,
    require_int,
    require_mapping,
    require_non_empty_str,
    require_object,
    require_object_or_none,
    require_str_or_none,
    require_str_tuple,
    require_str_tuple_or_none,
    require_value,
)
from .entities import (
    APPLICATION_DOMAINS,
    ATTACK_FAMILIES,
    Actor,
    Application,
    CacheEntry,
    CompileRecord,
    Credential,
    EvidenceItem,
    Invariant,
    PolicyRule,
    Resource,
    Role,
    Service,
    Session,
    StateSnapshot,
    Token,
    TrustBoundary,
    Workflow,
    WorldProvenance,
)
from .errors import ModelError, RefResolutionError
from .refs import (
    ActionLike,
    ReferenceRegistry,
    expand_action_view,
    try_expand_action_view,
)

#: 顶层可选实体集合：spec 缺省时编译器注入空数组（设计 §15.3 / S22）。
OPTIONAL_COLLECTIONS: tuple[str, ...] = (
    "sessions",
    "tokens",
    "credentials",
    "services",
    "caches",
    "trust_boundaries",
)

#: 参与结构骨架的顶层键（设计 §4.1 / §10.1 的派生定义）。
SKELETON_ENTITY_COLLECTIONS: tuple[str, ...] = (
    "roles",
    "actors",
    "resources",
    "sessions",
    "tokens",
    "credentials",
    "workflows",
    "services",
    "caches",
    "trust_boundaries",
)


# --------------------------------------------------------------------------- #
# WorldInstance
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class WorldInstance(Document):
    """可执行世界：oracle 的唯一输入，结构上无标签字段。"""

    schema_version: str
    world_id: str
    world_family_id: str
    application_domain: str
    seed: int
    provenance: WorldProvenance
    compile: CompileRecord
    application: Application
    roles: tuple[Role, ...]
    actors: tuple[Actor, ...]
    resources: tuple[Resource, ...]
    workflows: tuple[Workflow, ...]
    policies: tuple[PolicyRule, ...]
    invariants: tuple[Invariant, ...]
    state_history: tuple[StateSnapshot, ...]
    current_state: StateSnapshot
    evidence: tuple[EvidenceItem, ...]
    sessions: tuple[Session, ...] = ()
    tokens: tuple[Token, ...] = ()
    credentials: tuple[Credential, ...] = ()
    services: tuple[Service, ...] = ()
    caches: tuple[CacheEntry, ...] = ()
    trust_boundaries: tuple[TrustBoundary, ...] = ()
    registry: ReferenceRegistry = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "registry", ReferenceRegistry(self.entity_documents()))

    def __hash__(self) -> int:
        # 默认生成的 __hash__ 会因为 Mapping 字段抛 TypeError；世界 id 唯一，
        # 因此按它取哈希是合法且可预测的（相等世界必有相等 world_id）。
        return hash(("WorldInstance", self.world_id))

    # -- 文档往返 ----------------------------------------------------------- #
    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "WorldInstance":
        doc = require_fields(
            document,
            "world",
            allowed=(
                "schema_version", "world_id", "world_family_id", "application_domain", "seed",
                "provenance", "compile", "application", "roles", "actors", "resources", "sessions",
                "tokens", "credentials", "workflows", "services", "caches", "trust_boundaries",
                "policies", "invariants", "state_history", "current_state", "evidence", "$comment",
            ),
            required=(
                "schema_version", "world_id", "world_family_id", "application_domain", "seed",
                "provenance", "application", "roles", "actors", "resources", "workflows",
                "policies", "invariants", "state_history", "current_state", "evidence",
            ),
        )
        return cls(
            schema_version=require_non_empty_str(doc["schema_version"], "world.schema_version"),
            world_id=require_non_empty_str(doc["world_id"], "world.world_id"),
            world_family_id=require_non_empty_str(
                doc["world_family_id"], "world.world_family_id"
            ),
            application_domain=require_enum(
                doc["application_domain"], "world.application_domain", APPLICATION_DOMAINS
            ),
            seed=require_int(doc["seed"], "world.seed"),
            provenance=WorldProvenance.from_document(
                require_mapping(doc["provenance"], "world.provenance")
            ),
            compile=CompileRecord.from_document(require_mapping(doc["compile"], "world.compile")),
            application=Application.from_document(
                require_mapping(doc["application"], "world.application")
            ),
            roles=tuple(Role.from_document(item) for item in _sequence(doc["roles"], "world.roles")),
            actors=tuple(
                Actor.from_document(item) for item in _sequence(doc["actors"], "world.actors")
            ),
            resources=tuple(
                Resource.from_document(item)
                for item in _sequence(doc["resources"], "world.resources")
            ),
            workflows=tuple(
                Workflow.from_document(item)
                for item in _sequence(doc["workflows"], "world.workflows")
            ),
            policies=tuple(
                PolicyRule.from_document(item)
                for item in _sequence(doc["policies"], "world.policies")
            ),
            invariants=tuple(
                Invariant.from_document(item)
                for item in _sequence(doc["invariants"], "world.invariants")
            ),
            state_history=tuple(
                StateSnapshot.from_document(item)
                for item in _sequence(doc["state_history"], "world.state_history")
            ),
            current_state=StateSnapshot.from_document(
                require_mapping(doc["current_state"], "world.current_state")
            ),
            evidence=tuple(
                EvidenceItem.from_document(item)
                for item in _sequence(doc["evidence"], "world.evidence")
            ),
            sessions=tuple(
                Session.from_document(item) for item in _sequence(doc.get("sessions"), "world.sessions")
            ),
            tokens=tuple(
                Token.from_document(item) for item in _sequence(doc.get("tokens"), "world.tokens")
            ),
            credentials=tuple(
                Credential.from_document(item)
                for item in _sequence(doc.get("credentials"), "world.credentials")
            ),
            services=tuple(
                Service.from_document(item) for item in _sequence(doc.get("services"), "world.services")
            ),
            caches=tuple(
                CacheEntry.from_document(item) for item in _sequence(doc.get("caches"), "world.caches")
            ),
            trust_boundaries=tuple(
                TrustBoundary.from_document(item)
                for item in _sequence(doc.get("trust_boundaries"), "world.trust_boundaries")
            ),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "world_id": self.world_id,
            "world_family_id": self.world_family_id,
            "application_domain": self.application_domain,
            "seed": self.seed,
            "provenance": self.provenance.to_document(),
            "compile": self.compile.to_document(),
            "application": self.application.to_document(),
            "roles": [item.to_document() for item in self.roles],
            "actors": [item.to_document() for item in self.actors],
            "resources": [item.to_document() for item in self.resources],
            "sessions": [item.to_document() for item in self.sessions],
            "tokens": [item.to_document() for item in self.tokens],
            "credentials": [item.to_document() for item in self.credentials],
            "workflows": [item.to_document() for item in self.workflows],
            "services": [item.to_document() for item in self.services],
            "caches": [item.to_document() for item in self.caches],
            "trust_boundaries": [item.to_document() for item in self.trust_boundaries],
            "policies": [item.to_document() for item in self.policies],
            "invariants": [item.to_document() for item in self.invariants],
            "state_history": [item.to_document() for item in self.state_history],
            "current_state": self.current_state.to_document(),
            "evidence": [item.to_document() for item in self.evidence],
        }

    # -- 引用解析 ----------------------------------------------------------- #
    def entity_documents(self) -> dict[str, dict[str, dict[str, Any]]]:
        """``entity_type -> (entity_id -> document)``，注册表的输入。"""
        from .entities import collect_entities

        return collect_entities(self.to_document())

    def resolve(self, path: str) -> Any:
        """解析 ID 视图路径；未知路径抛 :class:`RefResolutionError`（§4.3）。"""
        return self.registry.resolve(path)

    def contains(self, path: str) -> bool:
        return self.registry.contains(path)

    def ref_universe(self) -> frozenset[str]:
        """全部可解析 ID 视图路径（Gate 2 / Gate 3）。"""
        return self.registry.ref_universe()

    def expand_action_view(self, path: str, action: ActionLike) -> str:
        """``action.resource.owner`` → ``resource.RES-001.owner``。"""
        return expand_action_view(path, action)

    def try_expand_action_view(self, path: str, action: ActionLike) -> str | None:
        """无法展开（未绑定 / 动作局部视图）时返回 ``None`` 而不抛错。"""
        return try_expand_action_view(path, action)

    # -- 结构骨架 ----------------------------------------------------------- #
    def structural_skeleton(self) -> dict[str, Any]:
        """世界结构骨架：标识符抽象为类型占位后的 entities + policies + invariants。

        派生定义（设计 §4.1 / §10.1）刻意**只**含结构，不含：

        * ``state_history`` / ``current_state`` —— 反事实变体会改状态，
          family id 必须在同一家族的所有变体上保持稳定；
        * ``evidence`` —— 掩蔽只改可见性，不改目录；且证据是决策输入而非结构；
        * ``application`` / ``provenance`` / ``seed`` / ``world_id`` ——
          分别是 app_ood / generator_ood group key 与实例身份，与"同一模板"无关。

        "标识符抽象为类型占位"让**同一 AI 世界模板的表面变体落进同一连通分量**
        （否则 world_ood 不可分），同时让任何结构改动（增删实体、改策略、改不
        变量）都改变 family id。实体列表在抽象后按规范化 JSON 排序，因此重排或
        重命名实体不改变骨架——骨架刻画的是结构，不是书写顺序。
        """
        return world_structural_skeleton_from_document(self.to_document())

    def derived_world_family_id(self) -> str:
        """:func:`derive_world_family_id` 的实例方法形态。"""
        return derive_world_family_id(self)

    def stable_fingerprint(self) -> str:
        """整个世界的规范化 sha256——release manifest 与 dedup 用。"""
        return stable_hash(self.to_document())


def derive_world_family_id(world: WorldInstance | Mapping[str, Any]) -> str:
    """``"WF-" + stable_hash(结构骨架)[:12]``（设计 §10.1）。

    **禁止作者填写**：作者可写的 family id 会让生成器把整个数据集并成一个连通
    分量（``world_ood`` 不可分），或把同一世界的表面变体拆到不同 split。
    """
    if isinstance(world, WorldInstance):
        skeleton = world.structural_skeleton()
    else:
        skeleton = world_structural_skeleton_from_document(world)
    return derive_family_id(WORLD_FAMILY_ID_PREFIX, skeleton)


#: 结构骨架归一化：这些键取 schema default 值时，**显式写出与省略视为同一结构**。
#: 否则同一个 AI 世界模板只因为生成器某次多写了 ``"is_default_rule": false``
#: 就会落进另一个 leakage 连通分量——那正是 R3 要堵的"表面变体跨 split"。
SKELETON_NORMALIZED_DEFAULTS: dict[str, Any] = {
    "priority": 0,
    "is_default_rule": False,
    "requires_fresh": False,
    "reversible": True,
    "auth_required": True,
    "verified": False,
    "sanitized": False,
    "privilege_version": 0,
    "derived_world_family_id": True,
}


def world_structural_skeleton_from_document(document: Mapping[str, Any]) -> dict[str, Any]:
    """文档形态的结构骨架（:meth:`WorldInstance.structural_skeleton` 的实现）。

    抽象规则：任何**已知实体 id**（无论出现在值位置还是键位置，例如
    ``state_snapshot.actor_states`` 以 actor id 为键）都被替换成它的实体类型
    占位符；其余字符串原样保留。因此 ``resource.RES-001.owner == "ACT-002"``
    变成 ``resource.resource.owner == "actor"``，而 ``TEN-001`` 这类非实体
    标识符保留原样（租户不是 BNF 里的实体类型）。

    取 schema default 的键在骨架中被抹掉（见 :data:`SKELETON_NORMALIZED_DEFAULTS`），
    实体列表在抽象后按规范化 JSON 排序，因此重排或重命名实体不改变骨架——
    骨架刻画的是结构，不是书写顺序、也不是 default 注解的显式程度。
    """
    from .entities import collect_entities

    require_mapping(document, "world")
    entities = collect_entities(document)
    id_to_type: dict[str, str] = {}
    for entity_type, bucket in entities.items():
        for entity_id in bucket:
            id_to_type.setdefault(entity_id, entity_type)

    def abstract(value: Any) -> Any:
        if isinstance(value, str):
            return id_to_type.get(value, value)
        if isinstance(value, Mapping):
            abstracted: dict[str, Any] = {}
            for key, item in value.items():
                token = id_to_type.get(key, key)
                prepared = abstract(item)
                if (
                    isinstance(token, str)
                    and token in SKELETON_NORMALIZED_DEFAULTS
                    and type(prepared) is type(SKELETON_NORMALIZED_DEFAULTS[token])
                    and prepared == SKELETON_NORMALIZED_DEFAULTS[token]
                ):
                    continue
                abstracted[token] = prepared
            return abstracted
        if isinstance(value, (list, tuple)):
            return [abstract(item) for item in value]
        return value

    skeleton_entities: dict[str, list[Any]] = {}
    for collection in SKELETON_ENTITY_COLLECTIONS:
        items = document.get(collection)
        if not items:
            continue
        if isinstance(items, Mapping) or not isinstance(items, Sequence):
            raise ModelError(f"world.{collection} 必须是数组")
        abstracted = [abstract(item) for item in items]
        # 实体 id 已被抽象成同一个占位符，因此必须重排成与书写顺序无关的规范序。
        skeleton_entities[collection] = sorted(abstracted, key=canonical_json)

    return {
        "entities": skeleton_entities,
        "policies": [abstract(item) for item in (document.get("policies") or ())],
        "invariants": [abstract(item) for item in (document.get("invariants") or ())],
    }


def derive_counterfactual_family_id(
    *,
    world_family_id: str,
    world_id: str,
    seed: int,
    critical_axes: Sequence[str],
) -> str:
    """``"CF-" + stable_hash((world_family_id, world_id, seed, sorted(axes)))[:12]``。

    同一 ``counterfactual_family_id`` 的样本只能全在 train 或全在 test（I-3）——
    因此它必须由编译器从结构派生，而不是由作者填写。
    """
    return derive_family_id(
        COUNTERFACTUAL_FAMILY_ID_PREFIX,
        [world_family_id, world_id, seed, sorted(critical_axes)],
    )


def _sequence(value: Any, where: str) -> tuple[Any, ...]:
    if value is None:
        return ()
    if isinstance(value, Mapping) or not isinstance(value, Sequence):
        raise ModelError(f"{where} 必须是数组，得到 {type(value).__name__}")
    return tuple(value)


# --------------------------------------------------------------------------- #
# WorldSpec
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class AttackOpportunity(Document):
    """``hypotheses.attack_opportunities[]``——假设，不是标签（I-1）。"""

    opportunity_id: str
    attack_family: str
    target_operation: str
    hypothesized_verdict: str
    state_preconditions: tuple[Mapping[str, Any], ...] | None = None
    rationale: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "AttackOpportunity":
        doc = require_fields(
            document,
            "hypotheses.attack_opportunities[]",
            allowed=(
                "opportunity_id", "attack_family", "target_operation", "hypothesized_verdict",
                "state_preconditions", "rationale",
            ),
            required=(
                "opportunity_id", "attack_family", "target_operation", "hypothesized_verdict",
            ),
        )
        preconditions = _sequence(
            doc.get("state_preconditions"), "hypotheses.attack_opportunities[].state_preconditions"
        )
        return cls(
            opportunity_id=require_non_empty_str(doc["opportunity_id"], "opportunity_id"),
            attack_family=require_non_empty_str(doc["attack_family"], "attack_family"),
            target_operation=require_non_empty_str(doc["target_operation"], "target_operation"),
            hypothesized_verdict=require_non_empty_str(
                doc["hypothesized_verdict"], "hypothesized_verdict"
            ),
            state_preconditions=(
                tuple(require_object(item, "state_preconditions[]") for item in preconditions)
                if doc.get("state_preconditions") is not None
                else None
            ),
            rationale=require_str_or_none(doc.get("rationale"), "rationale"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "opportunity_id": self.opportunity_id,
            "attack_family": self.attack_family,
            "target_operation": self.target_operation,
            "hypothesized_verdict": self.hypothesized_verdict,
        }
        put_if_present(
            out,
            "state_preconditions",
            [dict(item) for item in self.state_preconditions]
            if self.state_preconditions is not None
            else None,
        )
        put_if_present(out, "rationale", self.rationale)
        return out


@dataclass(frozen=True)
class CounterfactualAxis(Document):
    """``hypotheses.expected_counterfactual_axes[]``——先验声明的反事实预期（R4）。"""

    axis_id: str
    variable: str
    kind: str
    before: Any
    after: Any
    expected_effect: str
    rationale: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "CounterfactualAxis":
        doc = require_fields(
            document,
            "hypotheses.expected_counterfactual_axes[]",
            allowed=("axis_id", "variable", "kind", "before", "after", "expected_effect", "rationale"),
            required=("axis_id", "variable", "kind", "before", "after", "expected_effect"),
        )
        return cls(
            axis_id=require_non_empty_str(doc["axis_id"], "axis_id"),
            variable=require_non_empty_str(doc["variable"], "variable"),
            kind=require_enum(doc["kind"], "kind", ("critical", "irrelevant")),
            before=require_value(doc["before"], "before"),
            after=require_value(doc["after"], "after"),
            expected_effect=require_enum(
                doc["expected_effect"], "expected_effect",
                ("verdict_flip", "verdict_invariant", "observable_downgrade"),
            ),
            rationale=require_str_or_none(doc.get("rationale"), "rationale"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "axis_id": self.axis_id,
            "variable": self.variable,
            "kind": self.kind,
            "before": self.before,
            "after": self.after,
            "expected_effect": self.expected_effect,
        }
        put_if_present(out, "rationale", self.rationale)
        return out


@dataclass(frozen=True)
class Hypotheses(Document):
    """spec 的假设块。``compile_spec`` 会**整体丢弃**它（§4.1 第 3 步）。"""

    attack_opportunities: tuple[AttackOpportunity, ...]
    expected_counterfactual_axes: tuple[CounterfactualAxis, ...]

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Hypotheses":
        doc = require_fields(
            document,
            "hypotheses",
            allowed=("attack_opportunities", "expected_counterfactual_axes"),
            required=("attack_opportunities", "expected_counterfactual_axes"),
        )
        return cls(
            attack_opportunities=tuple(
                AttackOpportunity.from_document(item)
                for item in _sequence(doc["attack_opportunities"], "hypotheses.attack_opportunities")
            ),
            expected_counterfactual_axes=tuple(
                CounterfactualAxis.from_document(item)
                for item in _sequence(
                    doc["expected_counterfactual_axes"],
                    "hypotheses.expected_counterfactual_axes",
                )
            ),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "attack_opportunities": [item.to_document() for item in self.attack_opportunities],
            "expected_counterfactual_axes": [
                item.to_document() for item in self.expected_counterfactual_axes
            ],
        }


@dataclass(frozen=True)
class EventTemplate(Document):
    """``episode_templates[].events[]``。``binds`` 声明该事件骑在哪些实体上（B15）。"""

    event_type: str
    actor_id: str
    t_offset_ms: int
    binds: Mapping[str, Any] | None = None
    emits_evidence: tuple[str, ...] | None = None
    causal_tag: str | None = None
    summary: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "EventTemplate":
        doc = require_fields(
            document,
            "episode_templates[].events[]",
            allowed=(
                "event_type", "actor_id", "t_offset_ms", "binds", "emits_evidence", "causal_tag",
                "summary",
            ),
            required=("event_type", "actor_id", "t_offset_ms"),
        )
        from .events import EVENT_TYPES

        return cls(
            event_type=require_enum(doc["event_type"], "event_type", EVENT_TYPES),
            actor_id=require_non_empty_str(doc["actor_id"], "actor_id"),
            t_offset_ms=require_int(doc["t_offset_ms"], "t_offset_ms"),
            binds=require_object_or_none(doc.get("binds"), "binds"),
            emits_evidence=require_str_tuple_or_none(
                doc.get("emits_evidence"), "emits_evidence", unique=True
            ),
            causal_tag=(
                require_enum(doc["causal_tag"], "causal_tag", ("relevant", "irrelevant"))
                if doc.get("causal_tag") is not None
                else None
            ),
            summary=require_str_or_none(doc.get("summary"), "summary"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "event_type": self.event_type,
            "actor_id": self.actor_id,
            "t_offset_ms": self.t_offset_ms,
        }
        put_if_present(out, "binds", dict(self.binds) if self.binds else None)
        put_if_present(
            out, "emits_evidence", list(self.emits_evidence) if self.emits_evidence else None
        )
        put_if_present(out, "causal_tag", self.causal_tag)
        put_if_present(out, "summary", self.summary)
        return out


@dataclass(frozen=True)
class EpisodeTemplate(Document):
    """``episode_templates[]``——一个 episode 的事件序列模板。"""

    template_id: str
    decision_event_index: int
    events: tuple[EventTemplate, ...]

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "EpisodeTemplate":
        doc = require_fields(
            document,
            "episode_templates[]",
            allowed=("template_id", "decision_event_index", "events"),
            required=("template_id", "events", "decision_event_index"),
        )
        return cls(
            template_id=require_non_empty_str(doc["template_id"], "template_id"),
            decision_event_index=require_int(doc["decision_event_index"], "decision_event_index"),
            events=tuple(
                EventTemplate.from_document(item)
                for item in _sequence(doc["events"], "episode_templates[].events")
            ),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "decision_event_index": self.decision_event_index,
            "events": [item.to_document() for item in self.events],
        }


@dataclass(frozen=True)
class WorldSpec(Document):
    """世界种子：人或 AI 写，可含假设，**不含标签**。"""

    schema_version: str
    world_id: str
    application_domain: str
    seed: int
    provenance: WorldProvenance
    application: Application
    roles: tuple[Role, ...]
    actors: tuple[Actor, ...]
    resources: tuple[Resource, ...]
    workflows: tuple[Workflow, ...]
    policies: tuple[PolicyRule, ...]
    invariants: tuple[Invariant, ...]
    state_history: tuple[StateSnapshot, ...]
    current_state: StateSnapshot
    evidence: tuple[EvidenceItem, ...]
    critical_state_variables: tuple[str, ...]
    irrelevant_state_variables: tuple[str, ...]
    attack_family: str
    hypotheses: Hypotheses
    episode_templates: tuple[EpisodeTemplate, ...]
    sessions: tuple[Session, ...] = ()
    tokens: tuple[Token, ...] = ()
    credentials: tuple[Credential, ...] = ()
    services: tuple[Service, ...] = ()
    caches: tuple[CacheEntry, ...] = ()
    trust_boundaries: tuple[TrustBoundary, ...] = ()
    notes: str | None = None

    def __hash__(self) -> int:
        return hash(("WorldSpec", self.world_id))

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "WorldSpec":
        doc = require_fields(
            document,
            "world_spec",
            allowed=(
                "schema_version", "world_id", "application_domain", "seed", "provenance",
                "attack_family", "application", "roles", "actors", "resources", "sessions",
                "tokens", "credentials", "workflows", "services", "caches", "trust_boundaries",
                "policies", "invariants", "state_history", "current_state", "evidence",
                "critical_state_variables", "irrelevant_state_variables", "hypotheses",
                "episode_templates", "notes", "$comment",
            ),
            required=(
                "schema_version", "world_id", "application_domain", "seed", "provenance",
                "application", "roles", "actors", "resources", "workflows", "policies",
                "invariants", "state_history", "current_state", "evidence",
                "critical_state_variables", "irrelevant_state_variables", "attack_family",
                "hypotheses", "episode_templates",
            ),
        )
        from .events import EVENT_TYPES  # noqa: F401 - 供 EventTemplate 复用枚举表

        return cls(
            schema_version=require_non_empty_str(doc["schema_version"], "spec.schema_version"),
            world_id=require_non_empty_str(doc["world_id"], "spec.world_id"),
            application_domain=require_enum(
                doc["application_domain"], "spec.application_domain", APPLICATION_DOMAINS
            ),
            seed=require_int(doc["seed"], "spec.seed"),
            provenance=WorldProvenance.from_document(
                require_mapping(doc["provenance"], "spec.provenance")
            ),
            application=Application.from_document(
                require_mapping(doc["application"], "spec.application")
            ),
            roles=tuple(Role.from_document(item) for item in _sequence(doc["roles"], "spec.roles")),
            actors=tuple(
                Actor.from_document(item) for item in _sequence(doc["actors"], "spec.actors")
            ),
            resources=tuple(
                Resource.from_document(item)
                for item in _sequence(doc["resources"], "spec.resources")
            ),
            workflows=tuple(
                Workflow.from_document(item)
                for item in _sequence(doc["workflows"], "spec.workflows")
            ),
            policies=tuple(
                PolicyRule.from_document(item)
                for item in _sequence(doc["policies"], "spec.policies")
            ),
            invariants=tuple(
                Invariant.from_document(item)
                for item in _sequence(doc["invariants"], "spec.invariants")
            ),
            state_history=tuple(
                StateSnapshot.from_document(item)
                for item in _sequence(doc["state_history"], "spec.state_history")
            ),
            current_state=StateSnapshot.from_document(
                require_mapping(doc["current_state"], "spec.current_state")
            ),
            evidence=tuple(
                EvidenceItem.from_document(item)
                for item in _sequence(doc["evidence"], "spec.evidence")
            ),
            critical_state_variables=require_str_tuple(
                doc["critical_state_variables"], "spec.critical_state_variables", unique=True
            ),
            irrelevant_state_variables=require_str_tuple(
                doc["irrelevant_state_variables"], "spec.irrelevant_state_variables", unique=True
            ),
            attack_family=require_enum(
                doc["attack_family"], "spec.attack_family", ATTACK_FAMILIES
            ),
            hypotheses=Hypotheses.from_document(
                require_mapping(doc["hypotheses"], "spec.hypotheses")
            ),
            episode_templates=tuple(
                EpisodeTemplate.from_document(item)
                for item in _sequence(doc["episode_templates"], "spec.episode_templates")
            ),
            sessions=tuple(
                Session.from_document(item) for item in _sequence(doc.get("sessions"), "spec.sessions")
            ),
            tokens=tuple(
                Token.from_document(item) for item in _sequence(doc.get("tokens"), "spec.tokens")
            ),
            credentials=tuple(
                Credential.from_document(item)
                for item in _sequence(doc.get("credentials"), "spec.credentials")
            ),
            services=tuple(
                Service.from_document(item) for item in _sequence(doc.get("services"), "spec.services")
            ),
            caches=tuple(
                CacheEntry.from_document(item) for item in _sequence(doc.get("caches"), "spec.caches")
            ),
            trust_boundaries=tuple(
                TrustBoundary.from_document(item)
                for item in _sequence(doc.get("trust_boundaries"), "spec.trust_boundaries")
            ),
            notes=require_str_or_none(doc.get("notes"), "spec.notes"),
        )

    def to_document(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "world_id": self.world_id,
            "application_domain": self.application_domain,
            "seed": self.seed,
            "provenance": self.provenance.to_document(),
            "attack_family": self.attack_family,
            "application": self.application.to_document(),
            "roles": [item.to_document() for item in self.roles],
            "actors": [item.to_document() for item in self.actors],
            "resources": [item.to_document() for item in self.resources],
            "sessions": [item.to_document() for item in self.sessions],
            "tokens": [item.to_document() for item in self.tokens],
            "credentials": [item.to_document() for item in self.credentials],
            "workflows": [item.to_document() for item in self.workflows],
            "services": [item.to_document() for item in self.services],
            "caches": [item.to_document() for item in self.caches],
            "trust_boundaries": [item.to_document() for item in self.trust_boundaries],
            "policies": [item.to_document() for item in self.policies],
            "invariants": [item.to_document() for item in self.invariants],
            "state_history": [item.to_document() for item in self.state_history],
            "current_state": self.current_state.to_document(),
            "evidence": [item.to_document() for item in self.evidence],
            "critical_state_variables": list(self.critical_state_variables),
            "irrelevant_state_variables": list(self.irrelevant_state_variables),
            "hypotheses": self.hypotheses.to_document(),
            "episode_templates": [item.to_document() for item in self.episode_templates],
            "notes": self.notes,
        }

    def generator_id(self) -> str:
        """``generator_id`` group key 的取值（S20）。"""
        return self.provenance.generator_model

    def counterfactual_family_id(self, world_family_id: str) -> str:
        """给定 world family id 后派生 counterfactual family id。"""
        return derive_counterfactual_family_id(
            world_family_id=world_family_id,
            world_id=self.world_id,
            seed=self.seed,
            critical_axes=self.critical_state_variables,
        )


__all__ = [
    "OPTIONAL_COLLECTIONS",
    "SKELETON_ENTITY_COLLECTIONS",
    "AttackOpportunity",
    "CounterfactualAxis",
    "EpisodeTemplate",
    "EventTemplate",
    "Hypotheses",
    "WorldInstance",
    "WorldSpec",
    "derive_counterfactual_family_id",
    "derive_world_family_id",
    "world_structural_skeleton_from_document",
]
