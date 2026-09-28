"""Phase 2B 的补充 episode 家族：``trust_provenance_variant``（brief §33/§40）。

这一族回答的是 brief §40 的要求::

    一部分 worlds：生成 authoritative evidence 与 cached / derived / untrusted
    evidence 冲突。Oracle 根据 source precedence / trust 确定 truth。不要多数投票。

做法是**改一条证据的来源属性，保留它断言的值**：

* ``provenance`` / ``source`` / ``freshness`` 是**模型可见**的（七键投影里的四项），
  ``trust_level`` 不在投影里——模型必须自己从 provenance 推断可信度，那正是要训练的能力；
* 编译器产出的语料里 provenance 与 trust_level 是**一致**的（实测 100 个 accepted world：
  ``system_of_record→trusted/fresh``、``replicated_cache→semi_trusted/stale``、
  ``client_supplied→untrusted/fresh``、``log_pipeline→semi_trusted/fresh``、
  ``llm_derived→derived/fresh``，无一例外），所以把一条证据从 system_of_record 改挂到
  replicated_cache 是"模型看得见、Oracle 也认"的降级；
* 世界本体一个字节都不改：变的是**观测**（可见证据的属性），因此 ``world_truth`` 不变，
  ``observable_decision`` 由 Oracle 在新的 evidence view 上重算——它降级成
  ``insufficient_evidence`` 才算数，不是我们说了算。

刻意**不做**的事：

* 不凭空造一条冲突证据。矛盾必须由世界声明（``contradicts`` / ``declare_contradiction``），
  掩蔽与改挂都只能保留或重新归属，不能发明（masking 的同一条纪律）。
* 不改多数投票语义：每个变体只动**一条**证据，Oracle 仍按信任集判定。
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Iterable, Mapping, Sequence

from ..model.entities import FRESHNESSES, TRUST_LEVELS
from ..oracle import TRUSTED_ESTABLISHES
from ..oracle.evidence_view import EvidenceItem, EvidenceView

#: provenance → (trust_level, freshness)。与编译器产出的一致性映射（见模块 docstring）。
#: 顺序即"来源优先级"：越靠前越权威。
PROVENANCE_TRUST: tuple[tuple[str, str, str], ...] = (
    ("system_of_record", "trusted", "fresh"),
    ("log_pipeline", "semi_trusted", "fresh"),
    ("replicated_cache", "semi_trusted", "stale"),
    ("client_supplied", "untrusted", "fresh"),
    ("llm_derived", "derived", "fresh"),
)

#: provenance → 改挂后使用的 ``source`` 字符串（模型可见，必须与语义自洽）。
PROVENANCE_SOURCE: Mapping[str, str] = {
    "system_of_record": "system-of-record",
    "log_pipeline": "log-pipeline",
    "replicated_cache": "replica",
    "client_supplied": "client-supplied-header",
    "llm_derived": "derived-summary",
}

#: 允许的降级方向（只往弱了改，不往强了改——往强了改会把"不可判定"变成"可判定"，
#: 那是另一族 episodes，且需要世界先声明冲突）。
DOWNGRADE_PAIRS: tuple[tuple[str, str], ...] = (
    ("system_of_record", "replicated_cache"),
    ("system_of_record", "client_supplied"),
    ("system_of_record", "llm_derived"),
    ("log_pipeline", "replicated_cache"),
    ("log_pipeline", "client_supplied"),
)


@dataclass(frozen=True)
class TrustProvenanceVariant:
    """一次"同值改挂"的完整记录（干预文档的原料）。"""

    evidence_id: str
    fact_key: str
    from_provenance: str
    to_provenance: str
    from_source: str
    to_source: str
    from_trust: str
    to_trust: str
    from_freshness: str
    to_freshness: str

    @property
    def intervention_variable(self) -> str:
        return f"evidence.{self.evidence_id}.provenance"

    def to_intervention(self, *, expected_effect: str, actual_effect: str | None) -> dict[str, Any]:
        return {
            "intervention_variable": self.intervention_variable,
            "before": {
                "source": self.from_source,
                "provenance": self.from_provenance,
                "trust_level": self.from_trust,
                "freshness": self.from_freshness,
            },
            "after": {
                "source": self.to_source,
                "provenance": self.to_provenance,
                "trust_level": self.to_trust,
                "freshness": self.to_freshness,
            },
            "expected_effect": expected_effect,
            "actual_effect": actual_effect,
        }


def _rank(provenance: str) -> int:
    for index, (name, _trust, _freshness) in enumerate(PROVENANCE_TRUST):
        if name == provenance:
            return index
    return len(PROVENANCE_TRUST)


def _attribution(provenance: str) -> tuple[str, str]:
    for name, trust, freshness in PROVENANCE_TRUST:
        if name == provenance:
            return trust, freshness
    raise KeyError(provenance)


def reattribute(item: EvidenceItem, to_provenance: str) -> EvidenceItem:
    """把一条证据改挂到 ``to_provenance``，**值不变**。

    ``trust_level`` / ``freshness`` 跟随 provenance 走（语料里二者一致）；``asserts_ref``
    与 ``value`` 逐字保留——这一族改的是"这句话是谁说的"，不是"这句话说了什么"。
    """
    if to_provenance not in PROVENANCE_SOURCE:
        raise ValueError(f"未知 provenance: {to_provenance!r}")
    trust, freshness = _attribution(to_provenance)
    if trust not in TRUST_LEVELS or freshness not in FRESHNESSES:
        raise ValueError(f"provenance {to_provenance!r} 的信任/时效不在词表内")
    return replace(
        item,
        provenance=to_provenance,
        source=PROVENANCE_SOURCE[to_provenance],
        trust_level=trust,
        freshness=freshness,
    )


def candidate_variants(
    view: EvidenceView,
    consulted: Iterable[str],
) -> tuple[TrustProvenanceVariant, ...]:
    """列出这个 view 上所有可构造的"同值改挂"（确定性排序）。

    只挑**establishing**（``trust_level ∈ TRUSTED_ESTABLISHES``）且 provenance 在降级表
    里的可见证据——改挂一条本来就不 establishing 的证据什么都不会发生。
    """
    consulted_set = {str(fact) for fact in consulted}
    out: list[TrustProvenanceVariant] = []
    for item in view.visible:
        if item.trust_level not in TRUSTED_ESTABLISHES:
            continue
        if consulted_set and item.asserts_ref not in consulted_set:
            continue
        for from_provenance, to_provenance in DOWNGRADE_PAIRS:
            if item.provenance != from_provenance:
                continue
            to_trust, to_freshness = _attribution(to_provenance)
            out.append(TrustProvenanceVariant(
                evidence_id=item.evidence_id,
                fact_key=item.asserts_ref,
                from_provenance=from_provenance,
                to_provenance=to_provenance,
                from_source=item.source,
                to_source=PROVENANCE_SOURCE[to_provenance],
                from_trust=item.trust_level,
                to_trust=to_trust,
                from_freshness=item.freshness,
                to_freshness=to_freshness,
            ))
    return tuple(sorted(out, key=lambda row: (row.evidence_id, row.to_provenance)))


def apply_variant(view: EvidenceView, variant: TrustProvenanceVariant) -> EvidenceView:
    """产出改挂后的 view（隐藏证据原样保留，绝不动）。"""
    visible = tuple(
        reattribute(item, variant.to_provenance)
        if item.evidence_id == variant.evidence_id else item
        for item in view.visible
    )
    return EvidenceView(visible=visible, hidden=tuple(view.hidden))


def variant_key(variant: TrustProvenanceVariant) -> str:
    return f"{variant.evidence_id}:{variant.from_provenance}->{variant.to_provenance}"


def observable_effect(base_output: Any, variant_output: Any) -> str:
    """这一族的**实际**效应（与 ``evaluate_intervention_effect`` 刻意不同）。

    ``evaluate_intervention_effect`` 只比 ``world_truth``，因为状态干预改的是世界；而
    这一族**不改世界**，改的是观测里一条证据的来源归属，能变的只有 observable 趟。
    所以这里比 ``observable_decision``：

    * 基准可判定 → 变体 ``insufficient_evidence`` ⇒ ``observable_downgrade``；
    * 两者相同 ⇒ ``verdict_invariant``（这次改挂没有改变可判定性，照实记）；
    * 世界真值变了 ⇒ ``verdict_flip``（理论上不可能——世界没动；真出现说明有 bug）。

    先验预期统一记 ``observable_downgrade``：实际不是它的时候由 Gate 5 拒绝，
    绝不改期望值让门变绿。
    """
    base_decision = str(getattr(base_output, "observable_decision", "") or "")
    variant_decision = str(getattr(variant_output, "observable_decision", "") or "")
    base_truth = str(getattr(base_output, "world_truth", "") or "")
    variant_truth = str(getattr(variant_output, "world_truth", "") or "")
    if base_truth != variant_truth:
        return "verdict_flip"
    if base_decision == variant_decision:
        return "verdict_invariant"
    if variant_decision == "insufficient_evidence" and base_decision != "insufficient_evidence":
        return "observable_downgrade"
    # 其余 observable 差异（例如 unauthorized → attack）不是这一族要表达的东西。
    return "verdict_invariant"


__all__ = [
    "DOWNGRADE_PAIRS",
    "PROVENANCE_SOURCE",
    "PROVENANCE_TRUST",
    "TrustProvenanceVariant",
    "apply_variant",
    "candidate_variants",
    "observable_effect",
    "reattribute",
    "variant_key",
]
