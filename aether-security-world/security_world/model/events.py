"""Episode 的事件与状态片段类型。

这些是 ``episode.schema.json`` 的 ``$defs.event`` / ``$defs.state_fragment`` 的
内存形态。注意两处**故意的不对称**：

* ``event``（episode 顶层 ``timeline`` / ``current_event``）带 ``causal_tag``；
  ``event_observation``（``observation.model_visible.timeline``）**不带**——
  "哪段历史要紧"是决策元数据，不是观察（§5.2 / D7）。
* ``state_fragment`` 是事件前后的状态差量，键是实体 id、值是状态字段；
  Gate 6 用 ``causal_tag == "irrelevant"`` 的事件其 ``state_after`` 引用的任何
  ref 都不得出现在决策闭包里（§5.4）。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .documents import (
    Document,
    put_if_present,
    require_enum,
    require_fields,
    require_mapping,
    require_non_empty_str,
    require_object_or_none,
    require_non_negative_int,
    require_str_or_none,
    require_str_tuple_or_none,
)
from .errors import ModelError

#: ``episode_templates[].events[].event_type`` 与 ``episode.timeline[].event_type``
#: 共用同一枚举（两个 schema 逐字一致）。
EVENT_TYPES: tuple[str, ...] = (
    "login",
    "logout",
    "mfa_challenge",
    "resource_created",
    "resource_updated",
    "permission_changed",
    "role_changed",
    "token_issued",
    "token_used",
    "token_revoked",
    "privilege_downgraded",
    "password_reset",
    "account_disabled",
    "account_enabled",
    "session_revoked",
    "workflow_transition",
    "cache_populated",
    "cache_invalidated",
    "sensitive_operation",
    "request",
    "other",
)

CAUSAL_TAGS: tuple[str, ...] = ("relevant", "irrelevant")
EVENT_OUTCOMES: tuple[str, ...] = ("success", "denied", "error", "unknown")


@dataclass(frozen=True)
class StateFragment(Document):
    """事件前后的状态差量（``event.state_before`` / ``event.state_after``）。"""

    actor_states: Mapping[str, Any] | None = None
    session_states: Mapping[str, Any] | None = None
    token_states: Mapping[str, Any] | None = None
    resource_states: Mapping[str, Any] | None = None
    workflow_states: Mapping[str, Any] | None = None
    cache_states: Mapping[str, Any] | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "StateFragment":
        doc = require_fields(
            document,
            "state_fragment",
            allowed=(
                "actor_states", "session_states", "token_states", "resource_states",
                "workflow_states", "cache_states",
            ),
        )
        return cls(
            actor_states=require_object_or_none(doc.get("actor_states"), "state_fragment.actor_states"),
            session_states=require_object_or_none(
                doc.get("session_states"), "state_fragment.session_states"
            ),
            token_states=require_object_or_none(doc.get("token_states"), "state_fragment.token_states"),
            resource_states=require_object_or_none(
                doc.get("resource_states"), "state_fragment.resource_states"
            ),
            workflow_states=require_object_or_none(
                doc.get("workflow_states"), "state_fragment.workflow_states"
            ),
            cache_states=require_object_or_none(doc.get("cache_states"), "state_fragment.cache_states"),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key in (
            "actor_states",
            "session_states",
            "token_states",
            "resource_states",
            "workflow_states",
            "cache_states",
        ):
            value = getattr(self, key)
            put_if_present(out, key, dict(value) if value else None)
        return out

    def referenced_ids(self) -> tuple[str, ...]:
        """片段里出现的全部实体 id（Gate 6 的"irrelevant 事件不得喂决策闭包"用）。"""
        ids: list[str] = []
        for key in (
            "actor_states",
            "session_states",
            "token_states",
            "resource_states",
            "workflow_states",
            "cache_states",
        ):
            value = getattr(self, key)
            if isinstance(value, Mapping):
                ids.extend(str(entity_id) for entity_id in value)
        return tuple(sorted(set(ids)))


@dataclass(frozen=True)
class Event(Document):
    """``episode.timeline[]`` / ``episode.current_event``。"""

    event_id: str
    t_index: int
    at: str
    event_type: str
    actor_id: str
    summary: str | None = None
    state_before: StateFragment | None = None
    state_after: StateFragment | None = None
    emitted_evidence: tuple[str, ...] | None = None
    causal_tag: str | None = None
    endpoint: Mapping[str, Any] | None = None
    outcome: str | None = None

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Event":
        doc = require_fields(
            document,
            "event",
            allowed=(
                "event_id", "t_index", "at", "event_type", "actor_id", "summary", "state_before",
                "state_after", "emitted_evidence", "causal_tag", "endpoint", "outcome",
            ),
            required=("event_id", "t_index", "at", "event_type", "actor_id"),
        )
        return cls(
            event_id=require_non_empty_str(doc["event_id"], "event.event_id"),
            t_index=require_non_negative_int(doc["t_index"], "event.t_index"),
            at=require_non_empty_str(doc["at"], "event.at"),
            event_type=require_enum(doc["event_type"], "event.event_type", EVENT_TYPES),
            actor_id=require_non_empty_str(doc["actor_id"], "event.actor_id"),
            summary=require_str_or_none(doc.get("summary"), "event.summary"),
            state_before=(
                StateFragment.from_document(require_mapping(doc["state_before"], "event.state_before"))
                if doc.get("state_before") is not None
                else None
            ),
            state_after=(
                StateFragment.from_document(require_mapping(doc["state_after"], "event.state_after"))
                if doc.get("state_after") is not None
                else None
            ),
            emitted_evidence=require_str_tuple_or_none(
                doc.get("emitted_evidence"), "event.emitted_evidence", unique=True
            ),
            causal_tag=(
                require_enum(doc["causal_tag"], "event.causal_tag", CAUSAL_TAGS)
                if doc.get("causal_tag") is not None
                else None
            ),
            endpoint=require_object_or_none(doc.get("endpoint"), "event.endpoint"),
            outcome=(
                require_enum(doc["outcome"], "event.outcome", EVENT_OUTCOMES)
                if doc.get("outcome") is not None
                else None
            ),
        )

    def to_document(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "event_id": self.event_id,
            "t_index": self.t_index,
            "at": self.at,
            "event_type": self.event_type,
            "actor_id": self.actor_id,
        }
        put_if_present(out, "summary", self.summary)
        put_if_present(
            out, "state_before", self.state_before.to_document() if self.state_before else None
        )
        put_if_present(
            out, "state_after", self.state_after.to_document() if self.state_after else None
        )
        put_if_present(
            out,
            "emitted_evidence",
            list(self.emitted_evidence) if self.emitted_evidence else None,
        )
        put_if_present(out, "causal_tag", self.causal_tag)
        put_if_present(out, "endpoint", dict(self.endpoint) if self.endpoint else None)
        put_if_present(out, "outcome", self.outcome)
        return out

    def to_observation(self) -> dict[str, Any]:
        """七键 ``event_observation`` 投影：**去掉** ``causal_tag`` 与状态片段。

        模型只能看到"发生了什么"，看不到"这事要紧不要紧"。
        """
        out: dict[str, Any] = {
            "event_id": self.event_id,
            "t_index": self.t_index,
            "at": self.at,
            "event_type": self.event_type,
            "actor_id": self.actor_id,
        }
        put_if_present(out, "summary", self.summary)
        put_if_present(out, "endpoint", dict(self.endpoint) if self.endpoint else None)
        put_if_present(out, "outcome", self.outcome)
        put_if_present(
            out,
            "emitted_evidence",
            list(self.emitted_evidence) if self.emitted_evidence else None,
        )
        return out


def require_sequence(value: Any, where: str) -> tuple[Any, ...]:
    """数组助手：``None`` 当空数组，非数组直接抛错。"""
    if value is None:
        return ()
    if isinstance(value, Mapping) or not isinstance(value, Sequence):
        raise ModelError(f"{where} 必须是数组，得到 {type(value).__name__}")
    return tuple(value)


__all__ = [
    "CAUSAL_TAGS",
    "EVENT_OUTCOMES",
    "EVENT_TYPES",
    "Event",
    "StateFragment",
    "require_sequence",
]
