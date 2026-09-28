"""分布摘要（G10，报告门）与标签熵/域覆盖审计。

G10 是**报告门**（``configs/default.json`` 的 ``quality_gates.report_only``）：
它永不失败，只把语料的形状写进 manifest。理由写在设计里——把 abstention 率调到一个
目标值等于按模型弱点造数据（需求 §26 明令禁止），所以"分布长什么样"必须是观测量，
不是达标项。

同时提供两个**审计**函数（阈值由调用方给，缺省不失败）：

* :func:`label_entropy_floor` —— ``observable_decision`` 的熵下限。熵塌成一点说明
  某一类样本（通常是 ``insufficient_evidence``）根本没被造出来。
* :func:`domain_coverage_floor` —— 应用域覆盖下限（需求 §12.2 的"5 类必须不变量 ×
  4 个以上 domain"）。
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from .errors import ValidationError
from .grouping import derive_attack_family

#: ``observable_decision`` 的闭集（``oracle-output.schema.json`` 的枚举）。
OBSERVABLE_DECISIONS: tuple[str, ...] = (
    "safe",
    "attack",
    "insufficient_evidence",
    "unauthorized",
)

#: ``world_truth`` 的闭集。
WORLD_TRUTHS: tuple[str, ...] = ("safe", "attack", "unauthorized")

#: 变体类型闭集。
VARIANT_TYPES: tuple[str, ...] = (
    "base",
    "critical_intervention",
    "irrelevant_perturbation",
    "evidence_masked",
    # Phase 2B brief §33/§40：同一断言值改挂到更弱的来源/时效上，由 Oracle 重新判定
    # 充分性（不许多数投票）。干预记录照旧必填（schema 的 allOf/if-then 同款约束）。
    "trust_provenance_variant",
)


def _oracle_field(episode: Any, name: str) -> str:
    output = getattr(episode, "oracle_output", None)
    if output is None and isinstance(episode, Mapping):
        output = episode.get("oracle_output")
    if isinstance(output, Mapping):
        return str(output.get(name) or "")
    return str(getattr(output, name, "") or "")


def _field(episode: Any, name: str) -> Any:
    value = getattr(episode, name, None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get(name)
    return value


def _availability_level(episode: Any) -> str:
    observation = _field(episode, "observation") or {}
    metadata = observation.get("decision_metadata") or {}
    return str(metadata.get("evidence_availability_level") or "unknown")


def _counts(values: Sequence[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for value in values:
        out[value] = out.get(value, 0) + 1
    return dict(sorted(out.items()))


def distribution_summary(
    episodes: Sequence[Any],
    *,
    worlds: Mapping[str, Any] | None = None,
    declared_attack_families: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """语料的分布摘要（G10 的原料）。

    ``worlds`` 给出时补上 ``app_domain`` / ``policy_graph_hash`` /
    ``workflow_template_hash`` 三个只能从世界取的分发；不给就只报 episode 自带维度。
    """
    items = list(episodes)
    if not items:
        raise ValidationError("empty_episode_set", "distribution_summary 需要至少一个 episode")
    observable = _counts([_oracle_field(episode, "observable_decision") for episode in items])
    truth = _counts([_oracle_field(episode, "world_truth") for episode in items])
    variant = _counts([str(_field(episode, "variant_type") or "") for episode in items])
    availability = _counts([_availability_level(episode) for episode in items])
    declared = dict(declared_attack_families or {})
    families = _counts(
        [
            declared.get(str(_field(episode, "world_id") or "")) or derive_attack_family(episode)
            for episode in items
        ]
    )
    violated: list[str] = []
    for episode in items:
        output = _field(episode, "oracle_output")
        document = output if isinstance(output, Mapping) else (
            output.to_document() if hasattr(output, "to_document") else {}
        )
        violated.extend(str(item) for item in (document.get("violated_invariants") or ()))
    summary: dict[str, Any] = {
        "sample_count": len(items),
        "observable_decision": observable,
        "world_truth": truth,
        "variant_type": variant,
        "evidence_availability_level": availability,
        "attack_family": families,
        "violated_invariants": _counts(violated),
        "episode_length": _counts([str(len(_field(episode, "timeline") or ())) for episode in items]),
        "counterfactual_family_count": len({str(_field(episode, "counterfactual_family_id")) for episode in items}),
        "world_count": len({str(_field(episode, "world_id")) for episode in items}),
        "average_variants_per_world": round(
            len(items) / max(1, len({str(_field(episode, "world_id")) for episode in items})), 4
        ),
    }
    if worlds:
        from .grouping import policy_graph_hash, workflow_template_hash

        summary["app_domain"] = _counts(
            [str(getattr(worlds.get(str(_field(episode, "world_id"))), "application_domain", "unknown"))
             for episode in items]
        )
        summary["policy_graph_hash"] = _counts(
            [policy_graph_hash(worlds[str(_field(episode, "world_id"))])
             for episode in items
             if str(_field(episode, "world_id")) in worlds]
        )
        summary["workflow_template_hash"] = _counts(
            [workflow_template_hash(worlds[str(_field(episode, "world_id"))])
             for episode in items
             if str(_field(episode, "world_id")) in worlds]
        )
    summary["label_entropy_bits"] = round(entropy_bits(list(observable.values())), 6)
    return summary


def entropy_bits(counts: Sequence[int]) -> float:
    """香农熵（bit）。全零或单值 ⇒ 0.0。"""
    total = sum(counts)
    if total <= 0 or len(counts) < 2:
        return 0.0
    bits = 0.0
    for count in counts:
        if count <= 0:
            continue
        p = count / total
        bits -= p * math.log2(p)
    return bits


def label_entropy_floor(
    episodes: Sequence[Any], *, min_bits: float = 0.5
) -> tuple[bool, float, str]:
    """``observable_decision`` 熵下限审计（G10 的相关不变量）。"""
    counts = _counts([_oracle_field(episode, "observable_decision") for episode in episodes])
    bits = entropy_bits(list(counts.values()))
    ok = bits >= min_bits
    detail = f"observable_decision 熵 {bits:.4f} bit（分布 {counts}，下限 {min_bits}）"
    return ok, bits, detail


def domain_coverage_floor(
    episodes: Sequence[Any],
    *,
    worlds: Mapping[str, Any] | None = None,
    min_domains: int = 4,
) -> tuple[bool, int, str]:
    """应用域覆盖下限审计（需求 §12.2：至少 4 个 domain）。"""
    if worlds:
        domains = {
            str(getattr(worlds.get(str(_field(episode, "world_id"))), "application_domain", "unknown"))
            for episode in episodes
        }
    else:
        domains = set()
    ok = len(domains) >= min_domains
    detail = f"覆盖 {len(domains)} 个应用域（下限 {min_domains}）: {sorted(domains)}"
    return ok, len(domains), detail


__all__ = [
    "OBSERVABLE_DECISIONS",
    "VARIANT_TYPES",
    "WORLD_TRUTHS",
    "distribution_summary",
    "domain_coverage_floor",
    "entropy_bits",
    "label_entropy_floor",
]
