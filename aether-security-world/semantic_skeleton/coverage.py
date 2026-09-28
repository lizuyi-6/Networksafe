"""Phase 2A 覆盖控制器（brief §26：HARD SCHEDULING，不再是 soft hint）。

Phase 1 的覆盖指令是"提示"：模型记不住就忘，multi_tenant 最后拿到 0 个 accepted。
Phase 2A 把它变成**硬调度**：前 20 个 accepted 有强制配额，未达标的标签在每一批的指令里
被提到最前面，并且**记入进度**——连续若干批仍不推进就停 run 并上报，而不是继续烧 token。

多标签（brief §26 "允许一个 world 多标签"）：一个世界的标签集来自机制注册表的
``coverage_labels``，因此一个跨租户 + 缓存 + 信任边界的世界同时计三类。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from semantic_skeleton.mechanisms import COVERAGE_LABELS, MECHANISMS, label_families

#: brief §26 的前 20 个 accepted 的硬配额。
EARLY_QUOTAS: dict[str, int] = {
    "multi_tenant": 8,
    "cross_flow_reuse": 4,
    "cache_distributed": 4,
    "trust_boundary": 4,
}

#: brief §27 的最终 100 accepted 配额。
FINAL_QUOTAS: dict[str, int] = {
    "multi_tenant": 8,
    "authorization": 8,
    "session": 8,
    "token": 8,
    "workflow": 10,
    "cache_distributed": 8,
    "trust_boundary": 8,
    "temporal_history": 8,
    "cross_flow_reuse": 8,
}

#: 复杂度配额（brief I / §54：不得为凑比例只生成简单世界）。
COMPLEXITY_QUOTAS: dict[str, tuple[int, int]] = {
    "simple": (15, 20),
    "medium": (40, 45),
    "complex": (30, 35),
    "very_complex": (5, 10),
}

#: 连续多少批某个硬配额标签零推进就停 run。
STALL_BATCH_LIMIT = 12


@dataclass
class CoverageState:
    """覆盖进度的全部状态（可序列化，断点续跑用）。"""

    labels: dict[str, int] = field(default_factory=dict)
    complexity: dict[str, int] = field(default_factory=dict)
    domains: dict[str, int] = field(default_factory=dict)
    families: dict[str, int] = field(default_factory=dict)
    accepted: int = 0
    #: 标签 → 连续零推进的批次数。
    stalls: dict[str, int] = field(default_factory=dict)

    def to_document(self) -> dict[str, Any]:
        return {
            "labels": dict(sorted(self.labels.items())),
            "complexity": dict(sorted(self.complexity.items())),
            "domains": dict(sorted(self.domains.items())),
            "families": dict(sorted(self.families.items())),
            "accepted": self.accepted,
            "stalls": dict(sorted(self.stalls.items())),
        }

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "CoverageState":
        return cls(
            labels=dict(document.get("labels") or {}),
            complexity=dict(document.get("complexity") or {}),
            domains=dict(document.get("domains") or {}),
            families=dict(document.get("families") or {}),
            accepted=int(document.get("accepted", 0)),
            stalls=dict(document.get("stalls") or {}),
        )


def quotas_for(accepted: int) -> dict[str, int]:
    """按当前 accepted 数选配额表：前 20 用 EARLY，之后用 FINAL。"""
    return dict(EARLY_QUOTAS) if accepted < 20 else dict(FINAL_QUOTAS)


def deficits(state: CoverageState) -> list[tuple[int, str]]:
    """未达标的 (缺口, 标签)，缺口大的优先。"""
    quotas = quotas_for(state.accepted)
    out: list[tuple[int, str]] = []
    for label, target in quotas.items():
        have = int(state.labels.get(label, 0))
        if have < target:
            out.append((target - have, label))
    out.sort(reverse=True)
    return out


def record_world(state: CoverageState, *, labels: tuple[str, ...], complexity: str,
                 domain: str, family: str) -> None:
    """把一个 accepted 世界记进覆盖进度（多标签全部计数）。"""
    state.accepted += 1
    for label in labels:
        state.labels[label] = int(state.labels.get(label, 0)) + 1
    state.complexity[complexity] = int(state.complexity.get(complexity, 0)) + 1
    state.domains[domain] = int(state.domains.get(domain, 0)) + 1
    state.families[family] = int(state.families.get(family, 0)) + 1


def advance_stalls(state: CoverageState) -> list[str]:
    """一批结束后推进停顿计数；返回已经卡死的标签。"""
    stuck: list[str] = []
    for _gap, label in deficits(state):
        state.stalls[label] = int(state.stalls.get(label, 0)) + 1
        if state.stalls[label] >= STALL_BATCH_LIMIT:
            stuck.append(label)
    for label in list(state.stalls):
        if label not in {name for _gap, name in deficits(state)}:
            state.stalls[label] = 0
    return stuck


def _selection(state: CoverageState) -> tuple[list[str], list[str], bool]:
    """覆盖选择的唯一实现（``directive`` 与 ``selection_record`` 共用，避免两边漂移）。

    返回 ``(chosen_labels, eligible_families, used_fallback)``。选择语义**没有**
    因为加追踪而改变——追踪只是把这里已经算出来的东西如实记录下来（brief §7）。
    """
    by_label = label_families()
    chosen: list[str] = [label for _gap, label in deficits(state)[:4]]
    families: list[str] = []
    used_fallback = not chosen
    if chosen:
        for label in chosen:
            families.extend(by_label.get(label, ())[:6])
    else:
        # 无缺口时不要落到固定清单——那会让模型反复产同一批"顺手"的机制
        # （v0.5 run 实测 post_disable_session 一个机制占了 10.68%，刚好越过
        # brief §62 的 10% 结构簇红线）。改成按"已 accepted 数最少"的机制族排序，
        # 把 46 个机制均匀铺开。
        used = {str(name): int(count) for name, count in (state.families or {}).items()}
        least_used = sorted(
            (item.family for item in MECHANISMS),
            key=lambda name: (used.get(name, 0), name),
        )
        families.extend(least_used[:14])
    return chosen, list(dict.fromkeys(families)), used_fallback


def selection_record(state: CoverageState, *, batch_index: int) -> dict[str, Any]:
    """brief §7 的 mechanism-selection 追踪记录。

    记下每次覆盖控制器做选择时的完整上下文：当前各机制 accepted 数、未达标标签集、
    选中的标签与可选机制、是否走了无缺口回退、以及回退时的排序依据。有了它就能
    直接回答"fallback 是否还在固定选同一个机制"。
    """
    chosen, families, used_fallback = _selection(state)
    used = {str(name): int(count) for name, count in (state.families or {}).items()}
    underrepresented = [
        {"label": label, "gap": gap, "have": int(state.labels.get(label, 0)),
         "target": quotas_for(state.accepted)[label]}
        for gap, label in deficits(state)
    ]
    rationale = (
        "category-level deficit: labels still below quota are prioritised, "
        "and only mechanisms carrying at least one of those labels are eligible"
        if chosen else
        "no category-level deficit: fallback ranks ALL mechanism families by "
        "(accepted count ascending, name ascending) and offers the least-used ones"
    )
    return {
        "batch_index": batch_index,
        "accepted_so_far": state.accepted,
        "mechanism_counts": dict(sorted(used.items())),
        "underrepresented": underrepresented,
        "chosen_labels": chosen,
        "eligible_mechanisms": families,
        "used_fallback": used_fallback,
        "selection_rationale": rationale,
        "least_used_order": (
            sorted(MECHANISMS, key=lambda item: (used.get(item.family, 0), item.family))[
                0
            ].family
            if used_fallback else None
        ),
    }


def directive(state: CoverageState, batch_size: int, *, recent_failures: tuple[str, ...] = (),
              duplicate_signatures: tuple[str, ...] = (),
              used_skeleton_ids: tuple[str, ...] = (),
              include_id_blacklist: bool = True) -> str:
    """本批的覆盖指令（硬调度：缺口最大的标签排最前，并给出可选机制）。

    ``include_id_blacklist=False`` 是 production contract（Phase 2B brief §6/§7）：
    provider 不再拥有 ``skeleton_id``，契约里已经没有这个键，再发一份"这些 id 已被占用"
    的清单只会让模型继续产一个它无法负责的字段。去重改由语义指纹与 canonical id 负责。
    """
    chosen, families, _used_fallback = _selection(state)
    complexity_targets = sorted(
        COMPLEXITY_QUOTAS,
        key=lambda level: int(state.complexity.get(level, 0)),
    )[:2]
    lines = [
        "## Coverage directive (this batch only; the contract above is unchanged)",
        f"- Produce exactly {batch_size} semantic skeletons, one JSON object per line.",
        f"- HARD PRIORITY: these coverage labels are still below quota: "
        f"{', '.join(chosen)}.",
        "- Use ONLY mechanism families that carry at least one of those labels: "
        + ", ".join(sorted(set(families))[:40]),
        f"- Target complexity mix: {', '.join(complexity_targets)} "
        "(keep the overall corpus roughly simple 15-20% / medium 40-45% / "
        "complex 30-35% / very_complex 5-10%; do NOT flood simple worlds to hit quota).",
        "- Every skeleton must be independently formalisable: cover the mechanism's "
        "REQUIRED FACTS in critical_facts, declare its invariants, and only use the "
        "change kinds listed for each counterfactual target.",
        "- Include sessions/tokens/caches/trust boundaries ONLY when the mechanism needs "
        "them; an empty optional collection is better than a decorative one.",
    ]
    if include_id_blacklist and used_skeleton_ids:
        # 已用 id 黑名单：没有它，模型对同一批次的骨架 id 有很强的复用倾向
        # （v0.5 run 实测 9/25 拒绝是 duplicate_skeleton_id，纯烧 output token）。
        lines.append(
            "- These skeleton_ids are ALREADY TAKEN (earlier batches). Reusing any of them — "
            "or a case/plural/separator variant of one — rejects the element. Pick fresh ids: "
            + ", ".join(sorted(set(used_skeleton_ids))[:200])
        )
    if duplicate_signatures:
        lines.append(
            "- These semantic fingerprints are ALREADY TAKEN (same mechanism + same fact "
            "structure + same history topology + same invariants + same evidence/trust/"
            "counterfactual shape). A renamed business story with the same structure is "
            "rejected as a semantic near-duplicate: "
            + ", ".join(duplicate_signatures[:20])
        )
    if recent_failures:
        lines.append(
            "- Recent rejection reasons to avoid: " + ", ".join(recent_failures[:12])
        )
    return "\n".join(lines)


def coverage_report(state: CoverageState) -> dict[str, Any]:
    """覆盖进度的可读摘要（审计用）。"""
    quotas = quotas_for(state.accepted)
    return {
        "accepted": state.accepted,
        "quotas_in_force": quotas,
        "labels": dict(sorted(state.labels.items())),
        "shortfalls": {
            label: {
                "have": int(state.labels.get(label, 0)),
                "target": target,
                "gap": target - int(state.labels.get(label, 0)),
                "stalled_batches": int(state.stalls.get(label, 0)),
            }
            for label, target in quotas.items()
            if int(state.labels.get(label, 0)) < target
        },
        "complexity": dict(sorted(state.complexity.items())),
        "domains": dict(sorted(state.domains.items())),
        "families": dict(sorted(state.families.items())),
    }


__all__ = [
    "COMPLEXITY_QUOTAS",
    "selection_record",
    "COVERAGE_LABELS",
    "EARLY_QUOTAS",
    "FINAL_QUOTAS",
    "STALL_BATCH_LIMIT",
    "CoverageState",
    "advance_stalls",
    "coverage_report",
    "deficits",
    "directive",
    "quotas_for",
    "record_world",
]
