"""证据视图与事实表——``observable_decision`` 的唯一依据。

设计 §15.3 把 ``EvidenceView`` / ``Fact`` / ``FactTable`` / ``build_fact_table``
列在 **L3 ``security_world.evidence``**（Agent C）。该包在本轮实现里**尚未落盘**，
而 oracle 没有它就无法运行；因此这里提供一份**参考实现**，并让 ``run_oracle``
只依赖结构协议（``asserting`` / ``view_id``），不依赖具体类型。

落地边界（如实记录，不当成已完成的 L3）：

* 本模块是 ``security_world.oracle`` 的私有实现细节，**不是** ``security_world.evidence``
  的替代品。``security_world.evidence`` 落盘后，应把这里的类改为对它 re-export，
  并保留 ``run_oracle`` 的协议不变（``EvidenceView.asserting`` 的签名与语义相同）。
* 可见性的权威来源是 ``world.evidence[].visible_in_observation``（S7）；
  ``EvidenceView`` 是它的投影，不自行发明第二套可见性。

事实状态机（§8.2 / §9.4）::

    not E                              → MISSING        (not_rendered)
    |{e.value for e in T}| > 1         → CONTRADICTORY   (contradictory)
    T                                  → ESTABLISHED     (value = 最高 trust 的 e.value)
    否则                               → UNVERIFIABLE    (attacker_controlled_only /
                                                       derived_only / untrusted_source)
    ESTABLISHED 且唯一 establishing 项 stale/expired
      且某 in-scope policy requires_fresh → STALE         (stale)

``T`` = 可见且 ``trust_level ∈ TRUSTED_ESTABLISHES = {trusted, semi_trusted}``（S17：
与 ``configs/default.json`` 的 ``evidence_masking.trusted_establishes`` 同源）。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..model.canonical import canonical_json, stable_hash
from ..model.entities import EvidenceItem
from ..model.errors import ModelError
from ..policy import matched_policies

#: 能建立决策关键事实的信任集（§7.2 / S17）。
TRUSTED_ESTABLISHES: frozenset[str] = frozenset({"trusted", "semi_trusted"})

#: 信任排序（"最高 trust"的判定；小的更可信）。
TRUST_RANK: dict[str, int] = {"trusted": 0, "semi_trusted": 1, "untrusted": 2, "derived": 3}

#: 需要"新鲜"才算建立的新鲜度取值。
STALE_FRESHNESSES: frozenset[str] = frozenset({"stale", "expired"})


class FactStatus(Enum):
    """一个决策关键事实的可观测状态（§8.2）。"""

    ESTABLISHED = "established"
    MISSING = "missing"
    UNVERIFIABLE = "unverifiable"
    CONTRADICTORY = "contradictory"
    STALE = "stale"


@dataclass(frozen=True)
class Fact:
    """一个决策关键事实的状态（含建立它的事实值与证据 id）。"""

    fact_key: str
    status: FactStatus
    value: Any = None
    evidence_ids: tuple[str, ...] = ()
    reason: str | None = None

    @property
    def established(self) -> bool:
        return self.status is FactStatus.ESTABLISHED

    def to_document(self) -> dict[str, Any]:
        return {
            "fact_key": self.fact_key,
            "status": self.status.value,
            "value": self.value,
            "evidence_ids": list(self.evidence_ids),
            "reason": self.reason,
        }


@dataclass(frozen=True)
class FactTable:
    """``consulted_facts`` 上的一份事实表（设计 §15.3）。"""

    facts: Mapping[str, Fact] = field(default_factory=dict)

    def established(self, fact_key: str) -> Any:
        """取一个已建立事实的值；未建立即 :class:`ModelError`（绝不返回 None）。"""
        fact = self.facts.get(fact_key)
        if fact is None:
            raise ModelError(f"事实 {fact_key!r} 不在本次 consulted_facts 里")
        if fact.status is not FactStatus.ESTABLISHED:
            raise ModelError(
                f"事实 {fact_key!r} 未建立（status={fact.status.value}, reason={fact.reason}）"
            )
        return fact.value

    def established_values(self) -> dict[str, Any]:
        """全部已建立事实的 ``fact_key -> value``（供 observable 趟覆盖世界）。"""
        return {
            fact_key: fact.value
            for fact_key, fact in sorted(self.facts.items())
            if fact.status is FactStatus.ESTABLISHED
        }

    @property
    def sufficient(self) -> bool:
        """每个 consulted 事实都已建立？"""
        return all(fact.established for fact in self.facts.values())

    def unestablished(self) -> tuple[Fact, ...]:
        """未建立的事实（按 fact_key 排序，确定性）。"""
        return tuple(
            self.facts[key] for key in sorted(self.facts) if not self.facts[key].established
        )


@dataclass(frozen=True)
class EvidenceView:
    """一次观测里可见/隐藏的证据（S7：``world.evidence`` 的投影）。"""

    visible: tuple[EvidenceItem, ...] = ()
    hidden: tuple[EvidenceItem, ...] = ()

    @classmethod
    def from_world(cls, world: Any) -> "EvidenceView":
        """按 ``visible_in_observation``（权威字段）切分世界证据，保持文档顺序。"""
        visible: list[EvidenceItem] = []
        hidden: list[EvidenceItem] = []
        for item in getattr(world, "evidence", ()):
            (visible if item.visible_in_observation else hidden).append(item)
        return cls(visible=tuple(visible), hidden=tuple(hidden))

    def asserting(self, fact_key: str) -> tuple[EvidenceItem, ...]:
        """断言该事实键的**可见**证据（按 ``asserts_ref`` 精确匹配，文档顺序）。

        隐藏证据**绝不**出现在这里——它能进 ``required_evidence`` 就等于把答案发给
        模型（D7 / S7）。
        """
        return tuple(item for item in self.visible if item.asserts_ref == fact_key)

    def view_id(self, world_id: str, action_id: str) -> str:
        """``sha256(world_id, action_id, canonical visible evidence)``（S2/S11 修订）。

        原定义只哈希可见证据集，却断言"同 id 同决策"——而 ``observable_decision``
        是 ``(world, action, evidence_view)`` 的函数，该断言不可满足。现在三元组
        一起进哈希，第三方可以逐字重算。
        """
        return stable_hash(
            {
                "world_id": world_id,
                "action_id": action_id,
                "visible": [item.to_document() for item in self.visible],
            }
        )


def _value_key(value: Any) -> str:
    """证据值的规范化文本（比较"取值是否相同"用；NaN 等会被 canonical_json 拒）。"""
    return canonical_json(value)


def _best_item(items: Sequence[EvidenceItem]) -> EvidenceItem | None:
    """信任最高、其次 evidence_id 最小的证据（确定性 tie-break）。"""
    if not items:
        return None
    return sorted(items, key=lambda item: (TRUST_RANK.get(item.trust_level, 99), item.evidence_id))[0]


def build_fact_table(
    world: Any,
    action: Any,
    view: Any,
    *,
    consulted_facts: frozenset[str] | set[str],
    trusted: frozenset[str] | set[str] = TRUSTED_ESTABLISHES,
) -> FactTable:
    """在 ``consulted_facts`` 上建事实表（§8.2 / B3：动态集合，不是静态闭包）。

    ``action`` 参与 ``requires_fresh`` 的 in-scope 判定：只有匹配当前 action 的
    策略里有一条 ``requires_fresh=true``，陈旧证据才会把事实降级成 ``STALE``。
    """
    if not hasattr(view, "asserting"):
        raise ModelError("evidence_view 必须提供 asserting(fact_key) 方法")
    requires_fresh = any(policy.needs_fresh for policy in matched_policies(world, action))
    facts: dict[str, Fact] = {}
    for fact_key in sorted(consulted_facts):
        visible = tuple(view.asserting(fact_key))
        establishing = tuple(item for item in visible if item.trust_level in trusted)
        if not visible:
            facts[fact_key] = Fact(
                fact_key=fact_key,
                status=FactStatus.MISSING,
                reason="not_rendered",
                evidence_ids=(),
            )
            continue
        best = _best_item(visible)
        if len({_value_key(item.value) for item in establishing}) > 1:
            facts[fact_key] = Fact(
                fact_key=fact_key,
                status=FactStatus.CONTRADICTORY,
                reason="contradictory",
                evidence_ids=tuple(item.evidence_id for item in visible),
            )
            continue
        if not establishing:
            if all(item.attacker_controllable for item in visible):
                reason = "attacker_controlled_only"
            elif all(item.trust_level == "derived" for item in visible):
                reason = "derived_only"
            else:
                reason = "untrusted_source"
            facts[fact_key] = Fact(
                fact_key=fact_key,
                status=FactStatus.UNVERIFIABLE,
                reason=reason,
                evidence_ids=tuple(item.evidence_id for item in visible),
            )
            continue
        chosen = _best_item(establishing)
        assert chosen is not None
        if requires_fresh and all(item.freshness in STALE_FRESHNESSES for item in establishing):
            facts[fact_key] = Fact(
                fact_key=fact_key,
                status=FactStatus.STALE,
                value=chosen.value,
                reason="stale",
                evidence_ids=tuple(item.evidence_id for item in visible),
            )
            continue
        facts[fact_key] = Fact(
            fact_key=fact_key,
            status=FactStatus.ESTABLISHED,
            value=chosen.value,
            evidence_ids=tuple(item.evidence_id for item in visible),
        )
    return FactTable(facts=facts)


__all__ = [
    "STALE_FRESHNESSES",
    "TRUSTED_ESTABLISHES",
    "TRUST_RANK",
    "EvidenceView",
    "Fact",
    "FactStatus",
    "FactTable",
    "build_fact_table",
]
