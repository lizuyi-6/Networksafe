"""证据掩蔽：7 个 level 与"缺决策关键事实 ⇒ ``insufficient_evidence``"（设计 §9.4 / R2）。

``mask_evidence`` 的契约（§15.3）::

    mask_evidence(view, *, level, seed, consulted_facts) -> EvidenceView

**只改可见性，不改世界**：掩蔽变体的 ``diff_worlds(base, variant).changed_paths == ()``
（§9.2），因此 ``contradictory`` / ``stale`` / ``attacker_controlled`` 三个 level 只
能在**世界目录本身就声明了**相应证据时构造出来（掩蔽藏不掉"矛盾"，也造不出"陈旧"）。
世界支撑不了请求的 level 时抛 :class:`MaskingError`——绝不悄悄降级成一个邻近
level，那会让 §9.4 的确定映射失去意义。

level → 隐藏集合（``configs/default.json`` 的 ``level_to_hidden_set``，H(f) = 断言
事实 f 的**可见**证据集合）::

    complete            所有 visible_in_observation=true 的证据都渲染
    partially_missing   ≥1 个非 consulted 证据被隐藏；每个 consulted 事实仍保留
                        ≥1 个可见 establishing 项（诱饵变体：verdict 仍可判定）
    minimally_sufficient 每个 consulted 事实恰好保留 1 个可见 establishing 项，
                        其余全隐藏
    insufficient        ≥1 个 consulted 事实 H(f) == ∅ ⇒ observable 趟必然
                        insufficient_evidence
    contradictory       ≥1 个 consulted 事实有 ≥2 个可见 establishing 项取值不同
    stale               ≥1 个 consulted 事实的唯一可见 establishing 项 freshness
                        ∈ {stale, expired} 且某 in-scope 策略 requires_fresh=true
    attacker_controlled ≥1 个 consulted 事实的可见项全部 attacker_controllable=true
                        且无一在 TRUSTED_ESTABLISHES

``consulted_facts`` 必须是 oracle 求值期的**动态**集合（§8.2 / B3）——
:func:`consulted_facts_from_output` 从 ``decision_trace`` 的 ``evidence.sufficiency``
步骤原样取出，静态闭包（``decision_facts``）会把短路分支读到的 ref 也算成必需，
从而把本该可判定的样本误判成 ``insufficient_evidence``。
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..model.canonical import canonical_json
from ..model.entities import EvidenceItem
from ..model.rng import derive_seed, make_rng, shuffled, validate_seed
from ..oracle import (
    STALE_FRESHNESSES,
    TRUSTED_ESTABLISHES,
    TRUST_RANK,
    EvidenceView,
    Fact,
    FactStatus,
    FactTable,
    build_fact_table,
)
from ..policy import matched_policies
from .config import DEFAULT_MASKING_LEVELS
from .errors import MaskingError

#: 7 个掩蔽 level（与 configs / episode schema 的枚举逐字一致）。
MASKING_LEVELS: tuple[str, ...] = DEFAULT_MASKING_LEVELS


# --------------------------------------------------------------------------- #
# 主入口
# --------------------------------------------------------------------------- #
def mask_evidence(
    view: EvidenceView,
    *,
    level: str,
    seed: int,
    consulted_facts: frozenset[str] | set[str] | tuple[str, ...],
    trusted: frozenset[str] | set[str] = TRUSTED_ESTABLISHES,
    world: Any = None,
    action: Any = None,
) -> EvidenceView:
    """按 level 隐藏证据，返回新视图（原视图不变；隐藏项的 flag 被改写为 false，S7）。

    ``world`` / ``action`` 给出时，``stale`` level 额外要求"某 in-scope 策略
    ``requires_fresh=true``"（§9.4 的后半段只有世界+动作能判定）。
    """
    if level not in MASKING_LEVELS:
        raise MaskingError("unknown_level", f"level 必须是 {MASKING_LEVELS} 之一，得到 {level!r}")
    validate_seed(seed)
    consulted = _validate_consulted(consulted_facts)
    if not isinstance(view, EvidenceView):
        raise MaskingError(
            "view_not_evidence_view", f"view 必须是 EvidenceView，得到 {type(view).__name__}"
        )
    rng = make_rng(derive_seed(validate_seed(seed), "mask", level))
    hidden = _hidden_for_level(
        level, view, consulted, rng, frozenset(trusted), world=world, action=action
    )
    result = _rebuild_view(view, hidden)
    requires_fresh = _requires_fresh(world, action)
    if not _rule_holds(
        level,
        result=result,
        baseline=view,
        consulted=consulted,
        trusted=frozenset(trusted),
        requires_fresh=requires_fresh,
    ):
        raise MaskingError(
            "level_rule_not_achieved",
            f"level={level!r} 构造后未达到 §9.4 判定规则（hidden={sorted(hidden)}）",
        )
    return result


def classify_evidence_level(
    view: EvidenceView,
    *,
    baseline: EvidenceView,
    consulted_facts: frozenset[str] | set[str] | tuple[str, ...],
    trusted: frozenset[str] | set[str] = TRUSTED_ESTABLISHES,
    world: Any = None,
    action: Any = None,
) -> str:
    """一个视图相对 baseline 的**可用性 level**（``decision_metadata`` 的答案之一）。

    判定优先级的理由：先看"有没有事实建不起来"（那直接决定
    ``observable_decision``），再区分建不起来的原因；全部建得起来时才看"藏了什么"
    （complete / minimally_sufficient / partially_missing 三者的事实表完全相同，
    只能靠隐藏集合区分）。``untrusted_source`` / ``derived_only`` 归
    ``insufficient``——``configs/default.json`` 的 ``evidence_masking.insufficient_when``
    把它们与 ``not_rendered`` 并列为导致 insufficient_evidence 的原因。
    """
    consulted = _validate_consulted(consulted_facts)
    trusted_set = frozenset(trusted)
    if not isinstance(view, EvidenceView) or not isinstance(baseline, EvidenceView):
        raise MaskingError("view_not_evidence_view", "view/baseline 必须是 EvidenceView")
    requires_fresh = _requires_fresh(world, action)
    if world is not None and action is not None:
        table = build_fact_table(
            world, action, view, consulted_facts=consulted, trusted=trusted_set
        )
    else:
        table = _mirror_fact_table(view, consulted, trusted_set, requires_fresh)
    statuses = {fact_key: fact.status for fact_key, fact in table.facts.items()}
    reasons = {fact_key: fact.reason for fact_key, fact in table.facts.items()}
    if any(status is FactStatus.MISSING for status in statuses.values()):
        return "insufficient"
    if any(status is FactStatus.CONTRADICTORY for status in statuses.values()):
        return "contradictory"
    if any(status is FactStatus.STALE for status in statuses.values()):
        return "stale"
    unverifiable = [key for key, status in statuses.items() if status is FactStatus.UNVERIFIABLE]
    if any(reasons.get(key) == "attacker_controlled_only" for key in unverifiable):
        return "attacker_controlled"
    if unverifiable:
        return "insufficient"
    baseline_ids = {item.evidence_id for item in baseline.visible}
    view_ids = {item.evidence_id for item in view.visible}
    if not (baseline_ids - view_ids):
        return "complete"
    if _minimally_sufficient_shape(view, consulted, trusted_set):
        return "minimally_sufficient"
    return "partially_missing"


def consulted_facts_from_output(output: Any) -> frozenset[str]:
    """从 oracle 输出取求值期**动态** consulted_facts（§8.2 / B3）。

    取不到（输出没有 ``evidence.sufficiency`` 步骤）时返回空集合——调用方必须
    显式处理"没有 consulted 事实"这一情形，而不是静默拿到一个静态闭包。
    """
    trace = getattr(output, "decision_trace", None)
    if trace is None and isinstance(output, Mapping):
        trace = output.get("decision_trace")
    for step in trace or ():
        if not isinstance(step, Mapping) or step.get("rule") != "evidence.sufficiency":
            continue
        operands = step.get("operands") or {}
        facts = operands.get("consulted_facts") or ()
        if isinstance(facts, Mapping) or not isinstance(facts, (list, tuple)):
            raise MaskingError(
                "consulted_facts_malformed", "evidence.sufficiency 的 consulted_facts 必须是数组"
            )
        return frozenset(str(item) for item in facts)
    return frozenset()


# --------------------------------------------------------------------------- #
# 构造：每个 level 隐藏什么
# --------------------------------------------------------------------------- #
def _hidden_for_level(
    level: str,
    view: EvidenceView,
    consulted: frozenset[str],
    rng: Any,
    trusted: frozenset[str],
    *,
    world: Any,
    action: Any,
) -> frozenset[str]:
    by_fact = _items_by_fact(view)
    if level == "complete":
        return frozenset()
    if level == "insufficient":
        candidates = [fact for fact in sorted(consulted) if by_fact.get(fact)]
        if not candidates:
            return frozenset()  # 视图本身已无可建立证据，规则天然成立
        fact = candidates[rng.randrange(len(candidates))]
        return frozenset(item.evidence_id for item in by_fact[fact])
    if level == "contradictory":
        # 矛盾是**世界声明**出来的：掩蔽只能保留它，不能制造它。
        return frozenset()
    if level == "stale":
        candidates = [
            fact
            for fact in sorted(consulted)
            if _establishing(by_fact.get(fact, ()), trusted)
            and any(item.freshness in STALE_FRESHNESSES for item in _establishing(by_fact[fact], trusted))
        ]
        if not candidates:
            raise MaskingError(
                "world_declares_no_stale_evidence",
                "没有 consulted 事实带陈旧 establishing 证据，stale level 不可构造"
                "（掩蔽只改可见性，造不出陈旧）",
            )
        if world is not None and action is not None and not _requires_fresh(world, action):
            raise MaskingError(
                "no_requires_fresh_policy",
                "没有 in-scope 策略 requires_fresh=true，§9.4 的 stale 判定不可满足",
            )
        fact = candidates[rng.randrange(len(candidates))]
        return frozenset(
            item.evidence_id
            for item in _establishing(by_fact[fact], trusted)
            if item.freshness not in STALE_FRESHNESSES
        )
    if level == "attacker_controlled":
        candidates = [
            fact
            for fact in sorted(consulted)
            if by_fact.get(fact)
            and any(item.attacker_controllable for item in by_fact[fact])
            and not any(
                item.attacker_controllable and item.trust_level in trusted
                for item in by_fact[fact]
            )
        ]
        if not candidates:
            raise MaskingError(
                "world_declares_no_attacker_controllable_evidence",
                "没有 consulted 事实带『纯攻击者可控』证据，attacker_controlled level 不可构造",
            )
        fact = candidates[rng.randrange(len(candidates))]
        return frozenset(
            item.evidence_id for item in by_fact[fact] if not item.attacker_controllable
        )
    if level == "minimally_sufficient":
        keep: set[str] = set()
        for fact in sorted(consulted):
            establishing = _establishing(by_fact.get(fact, ()), trusted)
            if not establishing:
                raise MaskingError(
                    "consulted_fact_without_establishing_evidence",
                    f"consulted 事实 {fact!r} 没有可见 establishing 证据，"
                    "minimally_sufficient 不可构造",
                )
            keep.add(_best(establishing).evidence_id)
        return frozenset(item.evidence_id for item in view.visible if item.evidence_id not in keep)
    if level == "partially_missing":
        candidates = [item for item in view.visible if item.asserts_ref not in consulted]
        if not candidates:
            raise MaskingError(
                "no_non_consulted_evidence",
                "视图里没有『非 consulted』证据可藏，partially_missing（诱饵）不可构造",
            )
        order = shuffled(tuple(candidates), rng)
        take = max(1, len(order) // 2)
        return frozenset(item.evidence_id for item in order[:take])
    raise MaskingError("unknown_level", f"level 未实现: {level!r}")  # pragma: no cover


# --------------------------------------------------------------------------- #
# 复核：§9.4 判定规则
# --------------------------------------------------------------------------- #
def _rule_holds(
    level: str,
    *,
    result: EvidenceView,
    baseline: EvidenceView,
    consulted: frozenset[str],
    trusted: frozenset[str],
    requires_fresh: bool,
) -> bool:
    by_fact = _items_by_fact(result)
    if level == "complete":
        return {item.evidence_id for item in result.visible} == {
            item.evidence_id for item in baseline.visible
        }
    if level == "insufficient":
        return any(fact not in by_fact for fact in consulted)
    if level == "contradictory":
        for fact in consulted:
            establishing = _establishing(by_fact.get(fact, ()), trusted)
            if len({canonical_json(item.value) for item in establishing}) > 1:
                return True
        return False
    if level == "stale":
        for fact in consulted:
            establishing = _establishing(by_fact.get(fact, ()), trusted)
            if establishing and all(item.freshness in STALE_FRESHNESSES for item in establishing):
                return requires_fresh
        return False
    if level == "attacker_controlled":
        for fact in consulted:
            items = by_fact.get(fact, ())
            if items and all(item.attacker_controllable for item in items):
                if not any(item.trust_level in trusted for item in items):
                    return True
        return False
    if level == "minimally_sufficient":
        return _minimally_sufficient_shape(result, consulted, trusted)
    if level == "partially_missing":
        baseline_ids = {item.evidence_id for item in baseline.visible}
        result_ids = {item.evidence_id for item in result.visible}
        hidden_non_consulted = any(
            item.evidence_id in (baseline_ids - result_ids)
            for item in baseline.visible
            if item.asserts_ref not in consulted
        )
        if not hidden_non_consulted:
            return False
        baseline_by_fact = _items_by_fact(baseline)
        for fact in consulted:
            before = _establishing(baseline_by_fact.get(fact, ()), trusted)
            after = _establishing(by_fact.get(fact, ()), trusted)
            if before and not after:
                return False
        return True
    return False  # pragma: no cover


def _minimally_sufficient_shape(
    view: EvidenceView, consulted: frozenset[str], trusted: frozenset[str]
) -> bool:
    """可见证据是否恰好是"每个 consulted 事实一条 establishing 项"。"""
    by_fact = _items_by_fact(view)
    for item in view.visible:
        if item.asserts_ref not in consulted:
            return False
    for fact in consulted:
        items = by_fact.get(fact, ())
        if len(items) != 1:
            return False
        if items[0].trust_level not in trusted:
            return False
    return True


# --------------------------------------------------------------------------- #
# 内部助手
# --------------------------------------------------------------------------- #
def _validate_consulted(consulted_facts: Any) -> frozenset[str]:
    if consulted_facts is None:
        raise MaskingError("invalid_consulted_facts", "consulted_facts 不允许为 None")
    if isinstance(consulted_facts, str) or isinstance(consulted_facts, Mapping):
        raise MaskingError(
            "invalid_consulted_facts",
            f"consulted_facts 必须是字符串集合，得到 {type(consulted_facts).__name__}",
        )
    out: set[str] = set()
    for item in consulted_facts:
        if not isinstance(item, str) or not item:
            raise MaskingError(
                "invalid_consulted_facts", f"consulted_facts 含非字符串/空串元素: {item!r}"
            )
        out.add(item)
    return frozenset(out)


def _items_by_fact(view: EvidenceView) -> dict[str, tuple[EvidenceItem, ...]]:
    grouped: dict[str, list[EvidenceItem]] = {}
    for item in view.visible:
        grouped.setdefault(item.asserts_ref, []).append(item)
    return {fact: tuple(items) for fact, items in grouped.items()}


def _establishing(items: tuple[EvidenceItem, ...], trusted: frozenset[str]) -> tuple[EvidenceItem, ...]:
    return tuple(item for item in items if item.trust_level in trusted)


def _best(items: tuple[EvidenceItem, ...]) -> EvidenceItem:
    return sorted(items, key=lambda item: (TRUST_RANK.get(item.trust_level, 99), item.evidence_id))[0]


def _with_visibility(item: EvidenceItem, visible: bool) -> EvidenceItem:
    if item.visible_in_observation is visible:
        return item
    return EvidenceItem.from_document({**item.to_document(), "visible_in_observation": visible})


def _rebuild_view(view: EvidenceView, hidden_ids: frozenset[str]) -> EvidenceView:
    """按隐藏集合重建视图；隐藏项的 ``visible_in_observation`` 被改写为 false（S7）。"""
    new_visible: list[EvidenceItem] = []
    new_hidden: list[EvidenceItem] = [_with_visibility(item, False) for item in view.hidden]
    for item in view.visible:
        if item.evidence_id in hidden_ids:
            new_hidden.append(_with_visibility(item, False))
        else:
            new_visible.append(_with_visibility(item, True))
    return EvidenceView(visible=tuple(new_visible), hidden=tuple(new_hidden))


def _requires_fresh(world: Any, action: Any) -> bool:
    if world is None or action is None:
        return False
    return any(policy.needs_fresh for policy in matched_policies(world, action))


def _mirror_fact_table(
    view: EvidenceView,
    consulted: frozenset[str],
    trusted: frozenset[str],
    requires_fresh: bool,
) -> FactTable:
    """:func:`security_world.oracle.build_fact_table` 的镜像（无 world/action 时用）。

    逐条复刻 L3 的事实状态机（MISSING / CONTRADICTORY / UNVERIFIABLE / STALE /
    ESTABLISHED）；``tests/unit/test_masking_levels.py`` 断言两者在同一世界上
    逐字节一致，防止 L3 演进后这里静默漂移。
    """
    by_fact = _items_by_fact(view)
    facts: dict[str, Fact] = {}
    for fact_key in sorted(consulted):
        visible = by_fact.get(fact_key, ())
        establishing = _establishing(visible, trusted)
        if not visible:
            facts[fact_key] = Fact(
                fact_key=fact_key, status=FactStatus.MISSING, reason="not_rendered", evidence_ids=()
            )
            continue
        if len({canonical_json(item.value) for item in establishing}) > 1:
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
        chosen = _best(establishing)
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
    "MASKING_LEVELS",
    "classify_evidence_level",
    "consulted_facts_from_output",
    "mask_evidence",
]
