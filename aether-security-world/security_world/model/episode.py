"""``Episode``——进入数据集的单元。

一个 episode 是：``{world, action, timeline, current_event, observation,
oracle_output, intervention?, split_assignments?}``。**一个裸 HTTP 请求永远不是
episode**（§5.1）。

两处归属说明（设计 §15.3 没有为这两个类型指定所有者，而它们被 L4/L5 共同消费，
因此落在 L1）：

* ``action`` 与 ``oracle_output`` **不是**本包的数据类——它们分别是 L2
  ``security_world/policy`` 与 L3 ``security_world/oracle`` 的公共符号。本模块
  只声明结构协议（:class:`ActionLike` / :class:`OracleOutputLike`）与
  "文档或带 ``to_document()`` 的对象都接受"的宽松落点，避免两个包导出同名符号。
* ``observation`` 以**文档**形态存放：它的两个子块分别由 L4 的 renderer 与 L3
  的 oracle 生成，L1 不重复定义它们，只负责拆分与序列化时的边界。

:meth:`serialize_for_model` 实现 schema 注释里承诺的"``decision_metadata``
按构造被排除在模型侧之外"：模型输入里既没有 oracle 的分类，也没有标签。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from .documents import (
    Document,
    put_if_present,
    require_enum,
    require_fields,
    require_mapping,
    require_non_empty_str,
    require_object,
    require_object_or_none,
)
from .errors import ModelError
from .events import Event, require_sequence

#: ``episode.schema.json`` 的 ``variant_type`` 枚举。
VARIANT_TYPES: tuple[str, ...] = (
    "base",
    "critical_intervention",
    "irrelevant_perturbation",
    "evidence_masked",
    # Phase 2B brief §33/§40：同一断言值改挂到更弱的来源/时效上，由 Oracle 重新判定
    # 充分性（不许多数投票）。干预记录照旧必填（schema 的 allOf/if-then 同款约束）。
    "trust_provenance_variant",
)

#: split 名（``episode.schema.json`` / ``release.schema.json`` 共用）。
SPLIT_NAMES: tuple[str, ...] = ("train", "validation", "test", "holdout")

#: 需要 ``intervention`` 的 variant_type（schema 的 allOf/if-then 同款约束，
#: 内存层也强制——否则构造出来的 episode 连 jsonschema 都过不了）。
INTERVENTION_REQUIRED_VARIANTS: frozenset[str] = frozenset({
    "critical_intervention",
    "irrelevant_perturbation",
    # Phase 2B：trust_provenance_variant 改的是一条证据的来源/时效，同样必须留下
    # "什么动了"的记录，否则模型被要求推断一个它看不见的变化。
    "trust_provenance_variant",
})

#: 八种 OOD split 策略 → holdout group key（设计 §10.3，与 configs/default.json 同源）。
STRATEGY_TO_GROUP_KEY: dict[str, str] = {
    "iid": "counterfactual_family_id",
    "world_ood": "world_family_id",
    "app_ood": "app_domain",
    "workflow_ood": "workflow_template_hash",
    "policy_ood": "policy_graph_hash",
    "attack_ood": "attack_family",
    "evidence_ood": "semantic_scenario_signature",
    "generator_ood": "generator_id",
}
SPLIT_STRATEGIES: tuple[str, ...] = tuple(sorted(STRATEGY_TO_GROUP_KEY))


class ActionLike(Protocol):
    """oracle 输入的结构契约（L2 ``security_world/policy.Action`` 满足它）。"""

    action_id: str
    operation: str
    actor: str
    resource: str | None
    session: str | None
    token: str | None
    workflow_instance: str | None
    flow_id: str
    at: str


class OracleOutputLike(Protocol):
    """oracle 输出的结构契约（L3 ``security_world/oracle.OracleOutput`` 满足它）。"""

    def to_document(self) -> dict[str, Any]:  # pragma: no cover - 协议定义
        ...


def as_document(value: Any, where: str) -> dict[str, Any]:
    """把"文档或带 ``to_document()`` 的对象"统一成普通 dict。"""
    if isinstance(value, Mapping):
        return require_object(value, where)
    to_document = getattr(value, "to_document", None)
    if callable(to_document):
        produced = to_document()
        if not isinstance(produced, Mapping):
            raise ModelError(f"{where}: to_document() 必须返回 object，得到 {type(produced).__name__}")
        return require_object(produced, where)
    raise ModelError(
        f"{where}: 需要 action/oracle 文档（Mapping）或提供 to_document() 的对象，"
        f"得到 {type(value).__name__}"
    )


@dataclass(frozen=True)
class Episode(Document):
    """一个状态化安全 episode。"""

    schema_version: str
    episode_id: str
    world_id: str
    world_family_id: str
    counterfactual_family_id: str
    variant_type: str
    action: ActionLike | Mapping[str, Any]
    timeline: tuple[Event | Mapping[str, Any], ...]
    current_event: Event | Mapping[str, Any]
    observation: Mapping[str, Any]
    oracle_output: OracleOutputLike | Mapping[str, Any]
    split: str | None = None
    intervention: Mapping[str, Any] | None = None
    provenance: Mapping[str, Any] | None = None
    split_assignments: tuple[Mapping[str, Any], ...] = ()
    #: REVISION 2：组装期盖章的十二个 group key 值（设计 §10.1）。**派生值**，
    #: 不是作者输入；Gate 2 校验存在性（缺一个即拒）与派生一致性（世界可得时）。
    group_keys: Mapping[str, str] | None = None

    def __post_init__(self) -> None:
        if self.variant_type in INTERVENTION_REQUIRED_VARIANTS and self.intervention is None:
            raise ModelError(
                f"episode {self.episode_id}: variant_type={self.variant_type!r} 必须带 "
                "intervention（episode.schema.json 的 allOf/if-then，§5.1）"
            )

    def __hash__(self) -> int:
        return hash(("Episode", self.episode_id))

    # -- 文档往返 ----------------------------------------------------------- #
    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Episode":
        doc = require_fields(
            document,
            "episode",
            allowed=(
                "schema_version", "episode_id", "world_id", "world_family_id",
                "counterfactual_family_id", "variant_type", "split", "intervention", "action",
                "timeline", "current_event", "observation", "oracle_output", "provenance",
                "split_assignments", "group_keys", "$comment",
            ),
            required=(
                "schema_version", "episode_id", "world_id", "world_family_id",
                "counterfactual_family_id", "variant_type", "action", "timeline", "current_event",
                "observation", "oracle_output",
            ),
        )
        timeline_raw = require_sequence(doc["timeline"], "episode.timeline")
        return cls(
            schema_version=require_non_empty_str(doc["schema_version"], "episode.schema_version"),
            episode_id=require_non_empty_str(doc["episode_id"], "episode.episode_id"),
            world_id=require_non_empty_str(doc["world_id"], "episode.world_id"),
            world_family_id=require_non_empty_str(doc["world_family_id"], "episode.world_family_id"),
            counterfactual_family_id=require_non_empty_str(
                doc["counterfactual_family_id"], "episode.counterfactual_family_id"
            ),
            variant_type=require_enum(doc["variant_type"], "episode.variant_type", VARIANT_TYPES),
            action=require_object(doc["action"], "episode.action"),
            timeline=tuple(
                Event.from_document(item) if isinstance(item, Mapping) else item
                for item in timeline_raw
            ),
            current_event=(
                Event.from_document(require_mapping(doc["current_event"], "episode.current_event"))
            ),
            observation=require_object(doc["observation"], "episode.observation"),
            oracle_output=require_object(doc["oracle_output"], "episode.oracle_output"),
            split=(
                require_enum(doc["split"], "episode.split", SPLIT_NAMES)
                if doc.get("split") is not None
                else None
            ),
            intervention=require_object_or_none(doc.get("intervention"), "episode.intervention"),
            provenance=require_object_or_none(doc.get("provenance"), "episode.provenance"),
            split_assignments=tuple(
                require_object(item, f"episode.split_assignments[{index}]")
                for index, item in enumerate(require_sequence(doc.get("split_assignments"), "episode.split_assignments"))
            ),
            group_keys=require_object_or_none(doc.get("group_keys"), "episode.group_keys"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schema_version": self.schema_version,
            "episode_id": self.episode_id,
            "world_id": self.world_id,
            "world_family_id": self.world_family_id,
            "counterfactual_family_id": self.counterfactual_family_id,
            "variant_type": self.variant_type,
            "action": as_document(self.action, "episode.action"),
            "timeline": [_event_document(item) for item in self.timeline],
            "current_event": _event_document(self.current_event),
            "observation": dict(self.observation),
            "oracle_output": as_document(self.oracle_output, "episode.oracle_output"),
        }
        put_if_present(out, "split", self.split)
        put_if_present(
            out, "intervention", dict(self.intervention) if self.intervention else None
        )
        put_if_present(out, "provenance", dict(self.provenance) if self.provenance else None)
        if self.split_assignments:
            out["split_assignments"] = [dict(item) for item in self.split_assignments]
        if self.group_keys:
            out["group_keys"] = dict(self.group_keys)
        return out

    # -- 模型侧边界 --------------------------------------------------------- #
    def model_visible(self) -> dict[str, Any]:
        """``observation.model_visible`` 原样返回（闭集七键证据投影）。"""
        observation = require_mapping(self.observation, "episode.observation")
        if "model_visible" not in observation:
            raise ModelError(
                f"episode {self.episode_id}: observation 必须拆成 model_visible/decision_metadata（§5.2）"
            )
        return dict(observation["model_visible"])

    def serialize_for_model(self) -> dict[str, Any]:
        """模型侧序列化：按构造排除 ``observation.decision_metadata`` 与 ``oracle_output``。

        ``decision_metadata`` 是 oracle 与 Gate 的答案键（trust_level /
        freshness / attacker_controllable / hidden ids / relevant_history /
        causal_tags）；``oracle_output`` 是标签本身。两者都不属于模型输入——
        ``test_hidden_evidence_not_serialized`` 与 ``test_model_visible_boundary``
        断言的就是这条边界。
        """
        document = self.to_document()
        observation = document.get("observation")
        if isinstance(observation, Mapping):
            trimmed = dict(observation)
            trimmed.pop("decision_metadata", None)
            document["observation"] = trimmed
        document.pop("oracle_output", None)
        return document

    def with_split_assignments(self, assignments: Sequence[Mapping[str, Any]]) -> "Episode":
        """返回带 ``split_assignments`` 的新 episode（八种策略各一行）。"""
        return Episode(
            schema_version=self.schema_version,
            episode_id=self.episode_id,
            world_id=self.world_id,
            world_family_id=self.world_family_id,
            counterfactual_family_id=self.counterfactual_family_id,
            variant_type=self.variant_type,
            action=self.action,
            timeline=self.timeline,
            current_event=self.current_event,
            observation=self.observation,
            oracle_output=self.oracle_output,
            split=self.split,
            intervention=self.intervention,
            provenance=self.provenance,
            split_assignments=tuple(require_object(item, "split_assignments[]") for item in assignments),
            group_keys=self.group_keys,
        )


def _event_document(event: Event | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(event, Event):
        return event.to_document()
    if isinstance(event, Mapping):
        return require_object(event, "episode.timeline[]")
    raise ModelError(f"episode.timeline[] 元素必须是 Event 或 object，得到 {type(event).__name__}")


__all__ = [
    "INTERVENTION_REQUIRED_VARIANTS",
    "SPLIT_NAMES",
    "SPLIT_STRATEGIES",
    "STRATEGY_TO_GROUP_KEY",
    "VARIANT_TYPES",
    "ActionLike",
    "Episode",
    "OracleOutputLike",
    "as_document",
]
