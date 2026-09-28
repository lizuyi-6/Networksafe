"""质量门 Gate 1–12（设计 §13.5 / ``configs.default.json`` 的 ``quality_gates``）。

REVISION 2（任务书 A1）：新增 ``G12_lexical_label_leakage``——模型可见侧的判决
线索词审计（G11 的统计互信息之下的**词法**孪生门）。

十个硬门 + 两个报告门::

    G1_schema                      episode / action / oracle_output / evidence 全部过 schema
    G2_reference_integrity         时间单调、双记一致、轴白名单、可见性三处一致、group key 存在
    G3_policy_executability        §8.4 非空洞性探针 + 攻击族可达性（声明族样本级 +
                                  REVISION 3 起 witness 级 (world, family) 可达性：
                                  失效族无 witness ⇒ 拒收，不变量族无 witness ⇒ 报告）
    G4_oracle_determinism          同 (world, action, evidence_view) 多次执行逐字节一致
    G5_counterfactual_consistency  关键干预：单变量 + 请求不变 + 实际效应 == 先验预期
    G6_irrelevant_invariance       无关扰动/掩蔽：changed_paths == () 且 verdict 不变
    G7_evidence_sufficiency        insufficient 必须可证明（≥1 条 required evidence 不可观测）
    G8_leakage_audit               group key 值不得跨 split（反事实家族尤其）
    G9_duplicate_audit             exact / normalized / structural 三层
    G10_distribution_summary       报告门（不失败）
    G11_surface_label_independence 表层特征与 verdict 的互信息 ≤ 阈值（硬门）
    G12_lexical_label_leakage      模型可见侧不得出现判决线索词（词法泄漏，硬门）

**分两级执行**，因为门的作用域不同：

* :func:`run_gates` —— 单 episode（+ 可选家族上下文）。跑 G1–G9 与 G12 里能用
  "一个 episode + 它的家族"判定的那些；G10/G11 是数据集级，这里记为
  ``checked=False``（**不伪装成通过**）。
* :func:`run_dataset_gates` —— 全数据集。先对每个 episode 跑 :func:`run_gates`，
  再跑数据集级的 G8（全局 group overlap）、G9（全局三层去重）、G10、G11。

``GateResult.checked=False`` 的语义是"这个门在此作用域没有运行"，不是"通过"；
:meth:`GateReport.passed` 只统计运行过的门。让一个没跑的门显示绿色，比没有门更坏。
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ..expansion import (
    AXIS_SKIPPED_NO_READER,
    critical_intervention,
    diff_worlds,
    effect_matches,
    evaluate_intervention_effect,
)
from ..model.canonical import canonical_json, stable_hash
from ..model.config import axis_matches_whitelist, try_load_default_config
from ..model.entities import EvidenceItem
from ..model.episode import Episode, SPLIT_NAMES, STRATEGY_TO_GROUP_KEY
from ..model.errors import ModelError, RefResolutionError
from ..model.world import WorldInstance, WorldSpec
from ..oracle import (
    TRUSTED_ESTABLISHES,
    EvidenceView,
    FactStatus,
    build_fact_table,
    run_oracle,
)
from ..policy import Action, matched_policies, parse_expr
from .dedup import DuplicateRecord, dedup
from .distribution import distribution_summary
from .errors import ValidationError
from .grouping import GROUP_KEYS, episode_group_keys
from .lexical import lexical_label_leakage, markers_from_config
from .probe import attack_family_reachability, family_reachability, probe_world_policies
from .split import assign_splits, group_overlap_audit
from .surface import DEFAULT_MIN_SAMPLES, surface_label_independence

#: 十个硬门 + 两个报告门（与 ``configs/default.json`` 的 ``quality_gates`` 逐字一致）。
GATES: tuple[str, ...] = (
    "G1_schema",
    "G2_reference_integrity",
    "G3_policy_executability",
    "G4_oracle_determinism",
    "G5_counterfactual_consistency",
    "G6_irrelevant_invariance",
    "G7_evidence_sufficiency",
    "G8_leakage_audit",
    "G9_duplicate_audit",
    "G10_distribution_summary",
    "G11_surface_label_independence",
    "G12_lexical_label_leakage",
)

#: 硬门（失败 ⇒ 拒收）。G10 是报告门，不进这个集合。
HARD_GATES: tuple[str, ...] = tuple(gate for gate in GATES if gate != "G10_distribution_summary")

#: 单 episode 作用域内可判定的门（其余需要数据集上下文）。
EPISODE_SCOPED_GATES: tuple[str, ...] = (
    "G1_schema",
    "G2_reference_integrity",
    "G3_policy_executability",
    "G4_oracle_determinism",
    "G5_counterfactual_consistency",
    "G6_irrelevant_invariance",
    "G7_evidence_sufficiency",
    "G8_leakage_audit",
    "G9_duplicate_audit",
    "G12_lexical_label_leakage",
)

#: oracle 确定性重复执行次数（``configs/default.json`` 的 ``oracle.determinism_runs``）。
DEFAULT_DETERMINISM_RUNS = 3


# --------------------------------------------------------------------------- #
# 结果类型
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class GateResult:
    """一个门的一次判定。"""

    gate: str
    passed: bool
    detail: str = ""
    #: False ⇒ 这个门在当前作用域**没有运行**（缺世界/缺家族/样本不足）。
    #: 它既不是通过也不是失败；``GateReport.passed`` 不统计它。
    checked: bool = True

    def to_document(self) -> dict[str, Any]:
        return {
            "gate": self.gate,
            "passed": self.passed,
            "detail": self.detail,
            "checked": self.checked,
        }


@dataclass(frozen=True)
class GateReport:
    """一次门禁跑批的结论。"""

    results: tuple[GateResult, ...]
    episode_id: str | None = None

    @property
    def passed(self) -> bool:
        return all(result.passed for result in self.results if result.checked)

    @property
    def failures(self) -> tuple[GateResult, ...]:
        return tuple(result for result in self.results if result.checked and not result.passed)

    @property
    def not_run(self) -> tuple[GateResult, ...]:
        return tuple(result for result in self.results if not result.checked)

    def result(self, gate: str) -> GateResult | None:
        for item in self.results:
            if item.gate == gate:
                return item
        return None

    def reason_codes(self) -> tuple[str, ...]:
        """失败门的 gate 名（``rejection_reasons`` 的键）。"""
        return tuple(result.gate for result in self.failures)

    def to_document(self) -> dict[str, Any]:
        return {
            "episode_id": self.episode_id,
            "passed": self.passed,
            "results": [result.to_document() for result in self.results],
        }


# --------------------------------------------------------------------------- #
# 家族视图
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class G5WorldView:
    """world 粒度的 G5 上下文（REVISION 3 / P1-5 的 (axis, family) 判定原料）。

    ``confirmed_axes``——至少一个家族把该轴翻转到先验预期效应的变量路径。混合 base
    世界（attack-base 家族翻转正确、safe-base 家族不可能翻转）里，轴由能翻转的那个
    家族证实；不能翻转的家族记 mismatch 但不拒收世界——整世界一刀切会误杀好家族。

    ``has_any_variant``——世界里有任何 (axis, family) 对产出过关键干预变体。一个都
    没有 ⇒ 反事实结构空洞（``no_critical_intervention_variant``）。

    ``mixed_base``——世界的家族 base 判决不一致（有的 safe-base、有的 attack-base）。
    这是按家族判定的**原因**，在 report 里如实标注，不是缺陷本身。
    """

    confirmed_axes: frozenset[str] = frozenset()
    has_any_variant: bool = False
    mixed_base: bool = False
    confirming_families: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class FamilyView:
    """一个反事实家族的上下文（base + 变体 + 逐变体 world diff + 来源 spec）。"""

    family_id: str
    base: Episode
    base_world: WorldInstance
    variants: tuple[Episode, ...] = ()
    diffs: Mapping[str, Any] = field(default_factory=dict)
    spec: WorldSpec | None = None
    seed: int = 0
    #: REVISION 3（P0-4）：展开期的跳过记录（``axis_skipped_no_reader`` /
    #: ``hypothesis_before_mismatch`` / 掩蔽 level 不可构造…）。G5 靠它把"零关键
    #: 干预变体"从静默变成可见——没有它，被跳过的轴在世界里不留任何痕迹。
    skipped: tuple[Mapping[str, Any], ...] = ()

    def variant(self, episode_id: str) -> Episode | None:
        for episode in self.variants:
            if episode.episode_id == episode_id:
                return episode
        return None

    def critical_axis_promise(self) -> tuple[bool, tuple[str, ...]]:
        """家族是否承诺过 critical 轴，以及展开期跳过的 critical 轴原因。

        ``(promised, skip_reasons)``：spec 声明了 ``kind == "critical"`` 的轴，或
        展开期跳过了至少一条 critical 轴，都算承诺过。两者皆无 ⇒ 这个世界本来就没
        有反事实结构（那是 prompt/schema 合同问题，不是 G5 能判的）。
        """
        reasons: list[str] = []
        for record in self.skipped or ():
            if str(record.get("variant")) == "critical_intervention":
                reasons.append(f"{record.get('axis_id')}:{record.get('reason')}")
        declared: list[str] = []
        spec = self.spec
        if spec is not None:
            for axis in getattr(spec, "hypotheses", None).expected_counterfactual_axes if getattr(
                spec, "hypotheses", None
            ) else ():
                if axis.kind == "critical":
                    declared.append(str(axis.axis_id))
        return (bool(reasons) or bool(declared)), tuple(reasons)

    def axis_variable_of(self, axis_id: str) -> str | None:
        """``axis_id`` → ``variable``（spec 给出时；否则 ``None``）。"""
        spec = self.spec
        hypotheses = getattr(spec, "hypotheses", None) if spec is not None else None
        for axis in getattr(hypotheses, "expected_counterfactual_axes", ()) or ():
            if str(axis.axis_id) == str(axis_id):
                return str(axis.variable)
        return None


def family_view(result: Any, *, spec: WorldSpec | None = None, seed: int | None = None) -> FamilyView:
    """把 ``expansion.ExpansionResult`` 包装成门禁上下文。"""
    variants = tuple(result.variants)
    base = next((episode for episode in variants if episode.variant_type == "base"), variants[0])
    world = getattr(result, "world", None)
    if world is None:
        raise ValidationError("expansion_result_without_world", "ExpansionResult 必须带 base world")
    resolved_seed = seed if seed is not None else (spec.seed if spec is not None else 0)
    return FamilyView(
        family_id=str(result.family_id),
        base=base,
        base_world=world,
        variants=variants,
        diffs=dict(getattr(result, "diffs", {}) or {}),
        spec=spec,
        seed=resolved_seed,
        skipped=tuple(getattr(result, "skipped", ()) or ()),
    )


# --------------------------------------------------------------------------- #
# 主入口
# --------------------------------------------------------------------------- #
def run_gates(
    episode: Episode,
    *,
    family: FamilyView | None = None,
    world: WorldInstance | None = None,
    config: Mapping[str, Any] | None = None,
    siblings: Sequence[Episode] = (),
    g5_world_view: G5WorldView | None = None,
) -> GateReport:
    """对一个 episode 跑门禁（设计 §15.3 的 ``run_gates``）。

    ``world`` 是组装该 episode 时用的世界（``critical_intervention`` 变体传**变体
    世界**；其余变体传 base 世界）。``family`` 给出时 G5/G6 才能比对 base；
    ``siblings`` 给出时 G8/G9 才能在家族内比对。``g5_world_view`` 给出时 G5 的
    预期效应比对按 **(axis, counterfactual_family_id)** 粒度判定（P1-5）：轴在别的
    家族上被证实时，本家族的不符记入 detail 而不拒收世界——混合 base 世界（safe-base
    家族不可能翻转）不被整世界一刀切。
    """
    cfg = _config(config)
    if world is None and family is not None:
        # 变体世界重建失败（例如 intervention 记录被篡改成一个不可表示的值）时
        # 退回 base 世界：门禁绝不抛异常，随后的 G4/G5 会把不一致报出来。
        world = _safe_world_for_episode(family, episode)
    resolved_world = world if world is not None else (family.base_world if family is not None else None)
    action = _action_of(episode)
    results: list[GateResult] = []
    results.append(_g1_schema(episode, resolved_world))
    results.append(_g2_reference_integrity(episode, resolved_world, family))
    results.append(_g3_policy_executability(episode, resolved_world, action, family, cfg))
    results.append(_g4_oracle_determinism(episode, resolved_world, action, cfg))
    results.append(_g5_counterfactual_consistency(episode, family, g5_world_view))
    results.append(_g6_irrelevant_invariance(episode, family))
    results.append(_g7_evidence_sufficiency(episode, resolved_world, action, cfg))
    results.append(_g8_leakage_audit(episode, family, siblings))
    results.append(_g9_duplicate_audit(episode, siblings))
    results.append(_g12_lexical_label_leakage(episode, cfg))
    for gate in ("G10_distribution_summary", "G11_surface_label_independence"):
        results.append(
            GateResult(
                gate=gate,
                passed=True,
                checked=False,
                detail="数据集级门禁：请用 run_dataset_gates() 在全量 episode 上运行",
            )
        )
    return GateReport(results=tuple(results), episode_id=episode.episode_id)


def _g5_world_view_for(views: Sequence[FamilyView]) -> G5WorldView:
    """一组**同世界**家族的 (axis, family) 矩阵（P1-5 的世界级 G5 上下文）。

    收集：哪些轴被**某个家族**翻转到先验预期（``confirmed_axes``）、有没有任何
    (axis, family) 对产出过关键干预变体、家族的 base 判决是否混合。混合 base（有的
    safe-base、有的 attack-base）如实标注——它是按家族判定的原因，不是缺陷。
    """
    confirmed: set[str] = set()
    confirming: dict[str, str] = {}
    has_variant = False
    base_truths: dict[str, str] = {}
    for view in views:
        base_truths[view.family_id] = _world_truth(view.base)
        for episode in view.variants:
            if episode.variant_type != "critical_intervention":
                continue
            has_variant = True
            intervention = episode.intervention or {}
            variable = str(intervention.get("intervention_variable"))
            if intervention.get("actual_effect") is not None and intervention.get(
                "actual_effect"
            ) == intervention.get("expected_effect"):
                confirmed.add(variable)
                confirming.setdefault(variable, view.family_id)
    return G5WorldView(
        confirmed_axes=frozenset(confirmed),
        has_any_variant=has_variant,
        mixed_base=len(set(base_truths.values())) > 1,
        confirming_families=dict(sorted(confirming.items())),
    )


def _g5_world_views(families: Mapping[str, FamilyView]) -> dict[str, G5WorldView]:
    """按 ``world_id`` 分组家族并汇总 (axis, family) 矩阵（P1-5）。"""
    by_world: dict[str, list[FamilyView]] = {}
    for view in families.values():
        world_id = str(getattr(view.base_world, "world_id", "") or "")
        by_world.setdefault(world_id, []).append(view)
    return {
        world_id: _g5_world_view_for(views) for world_id, views in sorted(by_world.items())
    }


def _g5_world_counterfactual_structure(
    families: Mapping[str, FamilyView],
) -> list[GateResult]:
    """world 粒度的 G5 汇总行（REVISION 3 / P1-5）。

    逐世界回答：这个世界有没有**任何** (axis, family) 对真的产出过关键干预变体？
    一个都没有 ⇒ 反事实结构空洞，``no_critical_intervention_variant`` 拒收（W-002
    形态：before 不符 + 无读者，声明两条轴全部不可用）。有 ⇒ 通过，并在 detail 里
    标注混合 base 与各轴的证实家族——按 (axis, counterfactual_family_id) 判定的
    结论对审阅者可见。
    """
    by_world: dict[str, list[FamilyView]] = {}
    for view in families.values():
        world_id = str(getattr(view.base_world, "world_id", "") or "")
        by_world.setdefault(world_id, []).append(view)
    rows: list[GateResult] = []
    for world_id, views in sorted(by_world.items()):
        view = _g5_world_view_for(views)
        skip_reasons: list[str] = []
        for item in views:
            for record in item.skipped or ():
                if str(record.get("variant")) != "critical_intervention":
                    continue
                reason = str(record.get("reason"))
                variable = item.axis_variable_of(str(record.get("axis_id"))) or str(
                    record.get("axis_id")
                )
                skip_reasons.append(f"{variable}:{reason}")
        if not view.has_any_variant:
            detail = (
                "no_critical_intervention_variant: 世界声明了 critical 轴，但全部家族合计"
                "产出 0 个关键干预变体（反事实结构空洞，G5 无从验证）"
            )
            if skip_reasons:
                detail += f"；跳过记录: {', '.join(sorted(set(skip_reasons)))}"
            rows.append(GateResult("G5_counterfactual_consistency", False, detail))
            continue
        confirmed = ", ".join(
            f"{variable}→{family}" for variable, family in sorted(view.confirming_families.items())
        )
        annotation = "；mixed_base=是（家族 base 判决不一致，按 (axis, family) 判定）" if (
            view.mixed_base
        ) else ""
        rows.append(
            GateResult(
                "G5_counterfactual_consistency",
                True,
                f"{len(views)} 个家族合计 {len(view.confirming_families)} 条 critical 轴被"
                f"关键干预证实（{confirmed}）{annotation}",
            )
        )
    return rows


def run_dataset_gates(
    episodes: Sequence[Episode],
    *,
    families: Mapping[str, FamilyView] | None = None,
    worlds: Mapping[str, WorldInstance] | None = None,
    config: Mapping[str, Any] | None = None,
    declared_attack_families: Mapping[str, str] | None = None,
) -> GateReport:
    """全数据集门禁：逐 episode 的 G1–G9 + G12 + 数据集级 G8/G9/G10/G11。"""
    cfg = _config(config)
    if not episodes:
        return GateReport(
            results=(
                GateResult("G1_schema", False, "空数据集：没有任何 episode 可校验"),
            )
        )
    results: list[GateResult] = []
    per_episode_failures: dict[str, tuple[str, ...]] = {}
    # REVISION 3（P1-5）：(axis, counterfactual_family_id) 粒度的世界级 G5 上下文。
    # 逐 episode 的 G5 需要它才能把"本家族翻不动这条轴"与"这条轴被证伪"分开。
    g5_views = _g5_world_views(families or {}) if families else {}
    for episode in episodes:
        family = _family_for(families, episode)
        world = (
            _safe_world_for_episode(family, episode)
            if family is not None
            else (worlds or {}).get(episode.world_id)
        )
        g5_view = (
            g5_views.get(str(getattr(family.base_world, "world_id", "") or "")) if family else None
        )
        report = run_gates(
            episode,
            family=family,
            world=world,
            config=cfg,
            siblings=_siblings(episode, episodes),
            g5_world_view=g5_view,
        )
        if report.failures:
            per_episode_failures[episode.episode_id] = report.reason_codes()
        results.extend(report.results)
    results.append(_g8_dataset(episodes, worlds, declared_attack_families))
    results.append(_g9_dataset(episodes, cfg))
    results.append(_g10_distribution(episodes))
    results.append(_g11_surface_label_independence(episodes, cfg))
    results.append(_g3_attack_family_reachability(episodes, declared_attack_families, worlds))
    if families:
        # world 级 G5 汇总：零 (axis, family) 对的世界在此拒收；混合 base 在此标注。
        results.extend(_g5_world_counterfactual_structure(families))
    if per_episode_failures:
        # 汇总行不是额外的门，而是"哪些 episode 没过"的指针；逐 episode 的
        # GateResult 已经在 results 里，validation_summary 按门名聚合它们。
        detail = "; ".join(
            f"{episode_id}:{','.join(codes)}"
            for episode_id, codes in sorted(per_episode_failures.items())[:8]
        )
        results.append(
            GateResult(
                "episode_gate_summary",
                False,
                f"{len(per_episode_failures)} 个 episode 未过逐 episode 门禁：{detail}",
            )
        )
    return GateReport(results=tuple(results))


def gate_failures_by_gate(report: GateReport) -> dict[str, int]:
    """按门名统计失败次数（``release.validation_summary`` 的原料）。"""
    counts: dict[str, int] = {}
    for result in report.failures:
        counts[result.gate] = counts.get(result.gate, 0) + 1
    return counts


# --------------------------------------------------------------------------- #
# 内部助手
# --------------------------------------------------------------------------- #
def _config(config: Mapping[str, Any] | None) -> dict[str, Any]:
    if isinstance(config, Mapping):
        return dict(config)
    loaded = try_load_default_config()
    return loaded if loaded is not None else {}


def _action_of(episode: Episode) -> Action:
    action = episode.action
    if isinstance(action, Action):
        return action
    document = action if isinstance(action, Mapping) else action.to_document()
    return Action.from_document(document)


def _siblings(episode: Episode, episodes: Sequence[Episode]) -> tuple[Episode, ...]:
    return tuple(
        other
        for other in episodes
        if other.episode_id != episode.episode_id
        and other.counterfactual_family_id == episode.counterfactual_family_id
    )


def family_lookup_key(episode: Episode) -> tuple[str, str]:
    """一个 episode 的家族查找键：``(family_id, family_id:renderer)``。

    ``run_dataset_gates(families=...)`` 既接受按 ``counterfactual_family_id`` 键控的
    映射（单 renderer 语料），也接受按 ``family_id:renderer`` 键控的映射（同一决策
    用多种 renderer 观测时，每种观测必须有**自己**的 base 才能比对请求字节）。
    """
    family_id = str(episode.counterfactual_family_id)
    renderer = str((episode.observation.get("model_visible") or {}).get("renderer") or "")
    return family_id, f"{family_id}:{renderer}"


def _family_for(families: Mapping[str, FamilyView] | None, episode: Episode) -> FamilyView | None:
    if not families:
        return None
    plain, qualified = family_lookup_key(episode)
    return families.get(qualified) or families.get(plain)


def _world_for_episode(family: FamilyView, episode: Episode) -> WorldInstance:
    """episode 对应的世界：关键干预变体按 intervention 重建，其余用 base 世界。"""
    if episode.variant_type != "critical_intervention":
        return family.base_world
    intervention = episode.intervention or {}
    return _rebuild_variant_world(family.base_world, intervention)


def _safe_world_for_episode(family: FamilyView, episode: Episode) -> WorldInstance:
    """:func:`_world_for_episode` 的不抛异常版（重建失败退回 base 世界）。"""
    try:
        return _world_for_episode(family, episode)
    except ValidationError:
        return family.base_world


def _rebuild_variant_world(base_world: WorldInstance, intervention: Mapping[str, Any]) -> WorldInstance:
    from ..oracle import override_world_values

    variable = intervention.get("intervention_variable")
    after = intervention.get("after")
    if not isinstance(variable, str) or not variable:
        raise ValidationError("intervention_without_variable", "intervention 缺少 intervention_variable")
    try:
        return override_world_values(base_world, {variable: after})
    except (ModelError, RefResolutionError) as exc:
        raise ValidationError(
            "variant_world_unrebuildable", f"无法从 base 世界重建变体世界（{variable}）: {exc}"
        ) from exc


def evidence_view_from_episode(episode: Episode) -> EvidenceView:
    """从 ``decision_metadata.evidence_classification`` 重建证据视图。

    ``evidence_classification`` 是世界证据目录的**全量**投影（含隐藏项），
    ``visible_in_observation`` 是权威标志（S7），因此重建是精确的——G4 靠它重跑
    oracle，G2 靠它做"可见性三处一致"的交叉验证。
    """
    metadata = episode.observation.get("decision_metadata") or {}
    classification = metadata.get("evidence_classification") or []
    visible: list[EvidenceItem] = []
    hidden: list[EvidenceItem] = []
    for document in classification:
        item = EvidenceItem.from_document(dict(document))
        (visible if item.visible_in_observation else hidden).append(item)
    return EvidenceView(visible=tuple(visible), hidden=tuple(hidden))


def _consulted_facts(episode: Episode) -> frozenset[str]:
    from ..expansion import consulted_facts_from_output

    return consulted_facts_from_output(episode.oracle_output)


# --------------------------------------------------------------------------- #
# G1 schema
# --------------------------------------------------------------------------- #
def _g1_schema(episode: Episode, world: WorldInstance | None) -> GateResult:
    from ..model import validate_document

    errors: list[str] = []
    errors.extend(validate_document(episode.to_document(), "episode"))
    errors.extend(validate_document(_action_document(episode), "action"))
    errors.extend(validate_document(_oracle_document(episode), "oracle-output"))
    metadata = episode.observation.get("decision_metadata") or {}
    for index, document in enumerate(metadata.get("evidence_classification") or ()):
        errors.extend(
            f"evidence_classification[{index}]: {error}"
            for error in validate_document(document, "evidence")
        )
    if world is not None:
        errors.extend(validate_document(world.to_document(), "world"))
    if errors:
        return GateResult("G1_schema", False, f"{len(errors)} 条 schema 错误：{errors[0]}")
    return GateResult("G1_schema", True, "episode/action/oracle_output/evidence/world 全部过 schema")


def _action_document(episode: Episode) -> dict[str, Any]:
    action = episode.action
    if isinstance(action, Mapping):
        return dict(action)
    return action.to_document()


def _oracle_document(episode: Episode) -> dict[str, Any]:
    output = episode.oracle_output
    if isinstance(output, Mapping):
        return dict(output)
    return output.to_document()


# --------------------------------------------------------------------------- #
# G2 引用完整性
# --------------------------------------------------------------------------- #
def _g2_reference_integrity(
    episode: Episode, world: WorldInstance | None, family: FamilyView | None
) -> GateResult:
    problems: list[str] = []
    # 1) timeline 单调（t_index 与 at 同序）
    timeline = episode.timeline
    indices = [_event_field(event, "t_index") for event in timeline]
    stamps = [str(_event_field(event, "at")) for event in timeline]
    if any(later <= earlier for earlier, later in zip(indices, indices[1:])):
        # REVISION 2（任务书 A2）：t_index 是索引，必须**严格**递增——重复或回退的
        # 索引意味着两条事件被钉在同一序位，时序推理的输入本身就是坏的。
        problems.append(f"timeline.t_index 非严格单调: {indices}")
    if any(later < earlier for earlier, later in zip(stamps, stamps[1:])):
        # at 允许"同一 logical timestamp"并列（作者显式写出相同 at 的并列事件），
        # 但任何回退即失败（设计 §4.4 / S3/S5）。
        problems.append("timeline.at 非单调（必须与 t_index 同序）")
    # 2) 当前事件在时间线内
    current_id = _event_field(episode.current_event, "event_id")
    if current_id not in {_event_field(event, "event_id") for event in timeline}:
        problems.append(f"current_event {current_id!r} 不在 timeline 里")
    # 3) 可见性三处一致（世界目录权威 / 视图投影 / 观测投影）
    metadata = episode.observation.get("decision_metadata") or {}
    classification = metadata.get("evidence_classification") or []
    hidden_ids = sorted(str(item) for item in (metadata.get("hidden_evidence_ids") or ()))
    derived_hidden = sorted(
        str(item["evidence_id"]) for item in classification if item.get("visible_in_observation") is False
    )
    if hidden_ids != derived_hidden:
        problems.append(
            f"hidden_evidence_ids {hidden_ids} 与 evidence_classification 的不可见项 {derived_hidden} 不一致"
        )
    projected_ids = sorted(
        str(item["evidence_id"]) for item in (episode.observation["model_visible"].get("evidence") or ())
    )
    expected_visible = sorted(
        str(item["evidence_id"]) for item in classification if item.get("visible_in_observation") is True
    )
    if projected_ids != expected_visible:
        problems.append(
            f"model_visible.evidence {projected_ids} 与权威可见性 {expected_visible} 不一致（S7）"
        )
    # 4) 模型可见侧不得带 oracle 分类键
    for key in _FORBIDDEN_MODEL_VISIBLE_KEYS:
        if key in episode.observation["model_visible"]:
            problems.append(f"model_visible 出现答案键 {key!r}")
    # 5) REVISION 2（任务书 A7）：十二个 group key 必须全部存在且非空。它们是组装期
    # 盖章的派生值（security_world.model.grouping），缺一个就让 split/泄漏审计在
    # 这个 episode 上静默失效——"没有 key" 比 "key 值异常" 更危险，因为它不报错。
    problems.extend(_g2_group_key_presence_problems(episode))
    if world is None:
        # 世界级检查（双记/角色/轴白名单/family id/group key 派生）未运行，但**已
        # 运行的检查失败了就必须报失败**：把失败显示成"未运行"比没有门更坏
        # （模块契约：``checked=False`` 的语义是"没有运行"，不是"通过"）。
        if problems:
            return GateResult("G2_reference_integrity", False, "; ".join(problems))
        return GateResult(
            "G2_reference_integrity",
            True,
            checked=False,
            detail="未提供 world：时间线与可见性已查，世界级检查（双记/角色/轴白名单/family id/group key 派生）未运行",
        )
    problems.extend(_g2_world_checks(episode, world, family))
    if problems:
        return GateResult("G2_reference_integrity", False, "; ".join(problems))
    return GateResult("G2_reference_integrity", True, "单调性/可见性三处一致/世界级检查全部通过")


#: ``conftest.MODEL_VISIBLE_FORBIDDEN_KEYS`` 的镜像（L5 不 import 测试代码）。
_FORBIDDEN_MODEL_VISIBLE_KEYS: frozenset[str] = frozenset({
    "trust_level", "attacker_controllable", "required_for_decision", "freshness",
    "contradicts", "visible_in_observation", "evidence_availability_level",
    "relevant_history", "irrelevant_history", "causal_tag", "hidden_evidence",
    "hypothesized_verdict", "expected_effect", "rationale", "attack_family",
    "world_truth", "observable_decision", "violated_invariants", "satisfied_invariants",
    "skipped_invariants", "missing_evidence", "decision_trace",
})


def _g2_world_checks(
    episode: Episode, world: WorldInstance, family: FamilyView | None
) -> list[str]:
    problems: list[str] = []
    # 5) state_history 单调 + current_state.at >= max(history.at)
    history = list(getattr(world, "state_history", ()) or ())
    stamps = [str(getattr(snapshot, "at", "")) for snapshot in history]
    if any(later < earlier for earlier, later in zip(stamps, stamps[1:])):
        # REVISION 2（任务书 A2）：快照时间戳不得回退；同一 logical timestamp 的
        # 并列（作者显式写出相同 at）是允许的——严格单调只约束"回退"这一种坏数据。
        problems.append(f"state_history.at 非单调: {stamps}")
    current_at = str(getattr(world.current_state, "at", ""))
    if stamps and current_at < max(stamps):
        problems.append(f"current_state.at={current_at} 早于 max(history.at)={max(stamps)}")
    # 5b) REVISION 2（任务书 A5）：证据可见性的唯一权威链。``world.evidence[].
    # visible_in_observation`` 描述"世界中存在什么"；Episode 的
    # ``decision_metadata.evidence_classification`` 是模型可见性的**唯一权威**
    # （EvidenceView 与 model_visible.evidence 都由它派生，第 3 步已断言派生一致）。
    # 这里补上原先缺的一环：分类投影必须与世界证据目录逐条一致——世界说
    # visible=true 而 episode 把它藏起来（或反之）即失败，否则"权威"只是口头约定。
    problems.extend(_g2_evidence_catalog_problems(episode, world))
    # 5c) REVISION 2（任务书 A7）：group key 派生一致性。世界可得时，除
    # attack_family（依赖 spec 声明，Gate 2 看不到声明）外的每个 key 必须等于
    # 重新派生的值——盖章值与 split 实际使用的值一旦漂移，泄漏审计静默失效。
    problems.extend(_g2_group_key_derivation_problems(episode, world))
    # 6) actor.roles ⊆ roles[].role_id
    declared_roles = {role.role_id for role in world.roles}
    for actor in world.actors:
        unknown = sorted(set(actor.roles or ()) - declared_roles)
        if unknown:
            problems.append(f"actor {actor.actor_id} 的 roles 含未声明角色 {unknown}")
    # 7) applies_to 的 operation 存在于 endpoints
    operations = {endpoint.operation for endpoint in world.application.endpoints}
    for invariant in world.invariants:
        for operation in invariant.applies_to or ():
            if operation != "*" and operation not in operations:
                problems.append(
                    f"invariant {invariant.invariant_id} 的 applies_to 含未知 operation {operation!r}"
                )
    # 8) 关键轴 ⊆ 白名单 且不是 observation 路径
    whitelist = axis_matches_whitelist and _critical_axes_whitelist(family)
    if family is not None and family.spec is not None:
        for axis in family.spec.critical_state_variables:
            if axis.startswith("observation."):
                problems.append(f"critical 轴 {axis!r} 是 observation 路径（§9.5 禁止）")
            elif whitelist and not axis_matches_whitelist(axis, whitelist):
                problems.append(f"critical 轴 {axis!r} 不匹配 critical_axes_whitelist")
        for axis in family.spec.irrelevant_state_variables:
            if not axis.startswith("observation."):
                problems.append(f"irrelevant 轴 {axis!r} 不是 observation 路径（§9.5 禁止）")
    # 9) family id 是派生的。**只在编译出的 base 世界上校验**：结构骨架包含
    # workflow_instance.current_state 这类可变状态，因此一次关键干预后重新派生的
    # id 会变（见 tests/gates/test_g2_reference_integrity.py 的记录用例）。
    # 变体世界按构造沿用 base 的 world_family_id，那正是"同一家族"的定义。
    from ..model.world import derive_world_family_id  # noqa: F401 - 文档用途

    reference_world = family.base_world if family is not None else world
    if reference_world.world_family_id != reference_world.derived_world_family_id():
        problems.append(
            f"world_family_id={reference_world.world_family_id} 不是结构骨架派生值"
            f"（应为 {reference_world.derived_world_family_id()}）"
        )
    # 10) episode 与世界/家族的指向一致
    if episode.world_id != world.world_id:
        problems.append(f"episode.world_id={episode.world_id} != world.world_id={world.world_id}")
    if episode.world_family_id != world.world_family_id:
        problems.append("episode.world_family_id 与世界不一致")
    if family is not None and episode.counterfactual_family_id != family.family_id:
        problems.append("episode.counterfactual_family_id 与家族不一致")
    return problems


def _critical_axes_whitelist(family: FamilyView | None) -> tuple[str, ...]:
    from ..model.config import critical_axes_whitelist

    if family is not None and family.spec is not None:
        return critical_axes_whitelist(None)
    return critical_axes_whitelist(None)


# --------------------------------------------------------------------------- #
# G2: 证据目录 ↔ episode 分类（A5：可见性唯一权威链的最后一环）
# --------------------------------------------------------------------------- #
def _g2_evidence_catalog_problems(episode: Episode, world: WorldInstance) -> list[str]:
    """``world.evidence``（世界中存在什么）↔ ``evidence_classification``（可见性权威）。

    设计 §6 / S7（REVISION 2 任务书 A5 钉死权威归属）：

    * ``world.evidence[].visible_in_observation`` 描述**世界中存在什么**——世界级
      目录，是证据集合与"世界级可见性声明"的唯一来源；
    * Episode 的 ``decision_metadata.evidence_classification`` 是**模型可见性的
      唯一权威**：``EvidenceView`` 与 ``observation.model_visible.evidence`` 都必须
      由它派生（派生一致性由 ``_g2_reference_integrity`` 第 3 步断言）。

    本函数补上"权威本身与世界目录一致"的最后一环，分两个方向，两个方向的强度不同：

    * **普适（所有 variant_type）**：分类不得复活世界声明不可见的证据（
      classification.visible ⊆ world.visible），且 id 集合必须逐一对应（不得发明、
      不得遗漏）。前者是泄漏检查——把世界藏起来的东西显示给模型；
    * **仅非掩蔽变体**：分类必须**逐条等于**世界目录的可见性。``evidence_masked``
      变体按设计（§9.4 的 level → 隐藏集合映射）在视图层继续隐藏世界可见的证据，
      对它要求"与世界逐条相等"会连坐合法掩蔽；而 base / critical_intervention /
      irrelevant_perturbation 变体没有掩蔽步骤，隐藏世界可见证据即篡改。
    """
    problems: list[str] = []
    metadata = episode.observation.get("decision_metadata") or {}
    classification = metadata.get("evidence_classification") or []
    world_flags = {item.evidence_id: bool(item.visible_in_observation) for item in world.evidence}
    seen_ids: set[str] = set()
    for index, item in enumerate(classification):
        evidence_id = str(item.get("evidence_id"))
        seen_ids.add(evidence_id)
        if evidence_id not in world_flags:
            problems.append(
                f"evidence_classification[{index}] 的 {evidence_id!r} 不在世界证据目录里"
            )
            continue
        visible_here = bool(item.get("visible_in_observation"))
        if visible_here and not world_flags[evidence_id]:
            problems.append(
                f"证据 {evidence_id} 被显示给模型，但世界目录声明 visible_in_observation=false"
                "（复活世界隐藏证据 = 泄漏，S7）"
            )
        elif not visible_here and world_flags[evidence_id] and episode.variant_type != "evidence_masked":
            problems.append(
                f"证据 {evidence_id} 在世界目录里 visible_in_observation=true，却被 "
                f"{episode.variant_type} 变体的观测藏起来（非掩蔽变体必须逐条投影世界目录，S7）"
            )
    missing = sorted(set(world_flags) - seen_ids)
    if missing:
        problems.append(f"世界证据目录有 {len(missing)} 条未进 episode 分类: {missing[:4]}")
    return problems


# --------------------------------------------------------------------------- #
# G2: group key 存在性与派生一致性（A7）
# --------------------------------------------------------------------------- #
#: 派生一致性可机械核对的 key。两个 family id **不**在列：它们是 episode 顶层字段
#: （第 10 步已校验"episode 与世界/家族指向一致"），且分析管线会在组装后按 probe
#: action 收窄 ``counterfactual_family_id``（``analysis.pipeline._restamp_family``），
#: 那时盖章副本被顶层字段合法地取代——拿它做相等断言会假失败。``attack_family``
#: 也不在列：它依赖 spec 声明（Gate 2 看不到声明），只查存在性。
DERIVABLE_GROUP_KEYS: tuple[str, ...] = tuple(
    key
    for key in GROUP_KEYS
    if key not in ("attack_family", "counterfactual_family_id", "world_family_id")
)


def _g2_group_key_presence_problems(episode: Episode) -> list[str]:
    """十二个 group key 必须全部存在且非空（组装期盖章的派生值）。"""
    group_keys = getattr(episode, "group_keys", None)
    if not isinstance(group_keys, Mapping) or not group_keys:
        return [
            "episode 缺少 group_keys（组装期必须由 security_world.model.grouping 派生盖章，"
            "Gate 2 校验存在性；缺 key 会让 split/泄漏审计在此 episode 上静默失效）"
        ]
    problems: list[str] = []
    for key in GROUP_KEYS:
        value = group_keys.get(key)
        if not isinstance(value, str) or not value:
            problems.append(f"group key {key!r} 缺失或为空")
    return problems


def _g2_group_key_derivation_problems(episode: Episode, world: WorldInstance) -> list[str]:
    """盖章的 group key 值必须等于重新derive的值（防篡改/防漂移）。"""
    group_keys = getattr(episode, "group_keys", None)
    if not isinstance(group_keys, Mapping) or not group_keys:
        return []
    try:
        derived = episode_group_keys(episode, world=world)
    except ValidationError:
        # 派生失败（缺 family id / 缺 action）由 G1 与组装期负责，这里不重复报。
        return []
    problems: list[str] = []
    for key in DERIVABLE_GROUP_KEYS:
        stamped = group_keys.get(key)
        expected = derived.get(key)
        if stamped is not None and expected is not None and str(stamped) != str(expected):
            problems.append(
                f"group key {key!r} 与派生值不一致：盖章 {stamped!r}，重新派生 {expected!r}"
            )
    return problems


def _event_field(event: Any, name: str) -> Any:
    if isinstance(event, Mapping):
        return event.get(name)
    return getattr(event, name, None)


# --------------------------------------------------------------------------- #
# G3 policy 可执行性
# --------------------------------------------------------------------------- #
def _g3_policy_executability(
    episode: Episode,
    world: WorldInstance | None,
    action: Action,
    family: FamilyView | None,
    config: Mapping[str, Any],
) -> GateResult:
    if world is None:
        return GateResult("G3_policy_executability", True, checked=False, detail="未提供 world")
    probe_cfg = ((config.get("oracle") or {}) if isinstance(config, Mapping) else {}) or {}
    max_worlds = int(probe_cfg.get("probe_max_worlds", 64)) if isinstance(probe_cfg, Mapping) else 64
    # 探针跑在**家族 base 世界**上：策略图属于世界，不属于某个反事实变体。
    # 在变体世界上探针会把"干预后恰好全部放行"误判成 policy 空洞。
    probe_world = family.base_world if family is not None else world
    results = probe_world_policies(probe_world, action, max_worlds=max_worlds)
    not_runnable = [result for result in results if result.reason_code == "G3_probe_not_runnable"]
    bad = [
        result
        for result in results
        if result.reason_code is not None and result.reason_code != "G3_probe_not_runnable"
    ]
    if bad:
        detail = "; ".join(
            f"{result.policy_id}:{result.reason_code}(探针 {result.probe_world_count} 个世界)"
            for result in bad
        )
        return GateResult("G3_policy_executability", False, f"policy 探针失败: {detail}")
    # 策略条件必须可解析（不可解析的策略连探针都进不去）
    for policy in probe_world.policies:
        try:
            parse_expr(policy.condition)
        except Exception as exc:  # noqa: BLE001 - DslError 原样上报
            return GateResult(
                "G3_policy_executability", False, f"policy {policy.policy_id} 条件不可解析: {exc}"
            )
    if not_runnable:
        return GateResult(
            "G3_policy_executability",
            True,
            checked=False,
            detail=(
                f"{len(not_runnable)}/{len(results)} 条策略的探针赋值全部不可表示"
                "（把可选集合覆写成 [] 时 L1 会丢掉空集合），G3 未运行"
            ),
        )
    return GateResult(
        "G3_policy_executability",
        True,
        f"{len(results)} 条策略全部可解析且探针非空洞"
        f"（每策略 ≤{max_worlds} 个探针世界，探针世界不进数据集）",
    )


def _g3_attack_family_reachability(
    episodes: Sequence[Episode],
    declared: Mapping[str, str] | None,
    worlds: Mapping[str, WorldInstance] | None = None,
) -> GateResult:
    if not declared:
        return GateResult(
            "G3_policy_executability", True, checked=False, detail="未提供 declared attack_family 映射"
        )
    results = attack_family_reachability(
        episodes, declared_families=declared, worlds=worlds
    )
    dead = [result for result in results if not result.reachable]
    # REVISION 3（P0-3）：接线 witness 级可达性（§10.5 的 family_reachability）。
    # "声明优先"的样本级可达性只问"这个世界有没有 attack 样本"，不问"这个族有没有
    # 被程序真正走到"——W-L4-001 声明 trust_boundary 族、唯一 trust_boundary 不变量
    # 100% skipped_unbound_subject（0 witnesses），样本级却因为别处产出的 attack 样本
    # 判它可达。witness 级把 (world, family) 拆开核对：
    # * **失效族（failure）无 witness ⇒ 硬失败**：声明的攻击族没有任何 attack 样本
    #   的违反类别能映射到它，世界声明了它表达不出来的攻击；
    # * **不变量族（invariant）无 witness ⇒ 只报告**：语料可以合法地携带一个故意越界
    #   的不变量来训练 skipped 路径（HC-017 的 ownership），拒收它会误杀合法数据。
    #   但它必须出现在 detail 里——"没有运行"与"没有"不是一回事。
    coverage = family_reachability(episodes, worlds=worlds, declared_families=declared)
    dead_failure_families = [row for row in coverage.failure if not row.supported]
    unsupported_invariants = [row for row in coverage.invariant if not row.supported]
    if dead or dead_failure_families:
        detail = ", ".join(
            f"{result.attack_family}(declared_worlds={result.declared_worlds})" for result in dead
        )
        witness_detail = ", ".join(
            f"{row.family}@{row.world_id}(witnesses=0)" for row in dead_failure_families
        )
        suffix = f"；witness 级同样不可达: {witness_detail}" if witness_detail else ""
        return GateResult(
            "G3_policy_executability",
            False,
            f"声明的攻击族不可达（世界声明了它表达不出来的攻击，§10.5）: {detail}{suffix}",
        )
    if unsupported_invariants:
        # 报告门语义：通过，但 unsupported 族逐条点名（A6：绝不计入"已支持"）。
        listed = ", ".join(
            f"{row.family}@{row.world_id}" for row in unsupported_invariants[:8]
        )
        return GateResult(
            "G3_policy_executability",
            True,
            f"{len(results)} 个声明攻击族全部有可达样本；witness 级覆盖 "
            f"{len(coverage.supported)}/{len(coverage.results)} 个族可达，"
            f"{len(unsupported_invariants)} 个不变量族无 witness（不拒收，如实报告）: {listed}",
        )
    return GateResult(
        "G3_policy_executability",
        True,
        f"{len(results)} 个声明攻击族全部有可达样本；witness 级覆盖 "
        f"{len(coverage.results)}/{len(coverage.results)} 个族全部有 witness",
    )


# --------------------------------------------------------------------------- #
# G4 oracle 确定性
# --------------------------------------------------------------------------- #
def _g4_oracle_determinism(
    episode: Episode, world: WorldInstance | None, action: Action, config: Mapping[str, Any]
) -> GateResult:
    if world is None:
        return GateResult("G4_oracle_determinism", True, checked=False, detail="未提供 world")
    oracle_cfg = config.get("oracle") if isinstance(config, Mapping) else None
    runs = int((oracle_cfg or {}).get("determinism_runs", DEFAULT_DETERMINISM_RUNS))
    runs = max(2, runs)
    view = evidence_view_from_episode(episode)
    documents: list[str] = []
    for _ in range(runs):
        output = run_oracle(world, action, view)
        documents.append(canonical_json(output.to_document()))
    if len(set(documents)) != 1:
        return GateResult(
            "G4_oracle_determinism",
            False,
            f"同入参 {runs} 次执行得到 {len(set(documents))} 个不同输出（非确定性渗入标签）",
        )
    recorded = canonical_json(_oracle_document(episode))
    if recorded != documents[0]:
        return GateResult(
            "G4_oracle_determinism",
            False,
            "episode.oracle_output 与 (world, action, evidence_view) 的重算结果不一致",
        )
    return GateResult(
        "G4_oracle_determinism", True, f"{runs} 次重算逐字节一致且与录制值相同"
    )


# --------------------------------------------------------------------------- #
# G5 反事实一致性
# --------------------------------------------------------------------------- #
def _g5_counterfactual_consistency(
    episode: Episode,
    family: FamilyView | None,
    world_view: G5WorldView | None = None,
) -> GateResult:
    if family is None:
        return GateResult(
            "G5_counterfactual_consistency", True, checked=False, detail="未提供家族上下文"
        )
    if episode.variant_type != "critical_intervention":
        # REVISION 3（P0-4）：家族承诺过 critical 轴却展开出 0 个关键干预变体 ⇒ 反事实
        # 门在这个家族上形同虚设（W-TK-OTR-001 / W-L2-001 正是这个形态：唯一 critical
        # 轴 ``hypothesis_before_mismatch`` 被静默跳过，世界照常被接受）。跳过原因
        # 逐条列进 detail——"没有 CI 变体"与"没有声明 CI 轴"必须可区分。
        #
        # REVISION 3（P1-5）：跳过原因要分级。``axis_skipped_no_reader`` 是**家族级**
        # 事实（这条轴对本家族的动作不是决策相关的，读者预检的结论），不是世界缺陷——
        # 混合 base 世界的 safe-base 家族正是这个形态（W-SA-STATE-001 的 read 家族：
        # transition 不变量 applies_to 不含 read）。有 world 上下文且世界里别的家族
        # 真的翻转了该轴时，本家族判"不适用"，由 world 级汇总行判定；只有世界级原因
        # （轴不存在 / before 与世界现值不符 / 干预不可构造）才让家族本身失败。
        promised, skip_reasons = family.critical_axis_promise()
        if promised and not any(
            item.variant_type == "critical_intervention" for item in family.variants
        ):
            world_level = tuple(
                reason for reason in skip_reasons if not reason.endswith(AXIS_SKIPPED_NO_READER)
            )
            excused = bool(skip_reasons) and not world_level and world_view is not None
            if excused and world_view.has_any_variant:
                return GateResult(
                    "G5_counterfactual_consistency",
                    True,
                    "非关键干预变体：G5 不适用（本家族的 critical 轴对它不是决策相关的"
                    "（axis_skipped_no_reader），该轴由本世界其它家族证实）",
                )
            reason_list = world_level or skip_reasons
            detail = (
                "no_critical_intervention_variant: 家族声明了 critical 轴但展开出 0 个"
                "关键干预变体（零 CI 家族不得过 G5）"
            )
            if reason_list:
                detail += f"；跳过记录: {', '.join(reason_list)}"
            return GateResult("G5_counterfactual_consistency", False, detail)
        return GateResult(
            "G5_counterfactual_consistency", True, "非关键干预变体：G5 不适用"
        )
    intervention = episode.intervention or {}
    variable = intervention.get("intervention_variable")
    expected = intervention.get("expected_effect")
    actual = intervention.get("actual_effect")
    problems: list[str] = []
    if not isinstance(variable, str) or not variable:
        return GateResult("G5_counterfactual_consistency", False, "intervention 缺少 intervention_variable")
    try:
        variant_world = _rebuild_variant_world(family.base_world, intervention)
    except ValidationError as exc:
        return GateResult("G5_counterfactual_consistency", False, exc.reason_code)
    diff = diff_worlds(family.base_world, variant_world)
    if not diff.is_single(variable):
        problems.append(
            f"changed_paths={list(diff.changed_paths)}，期望恰好 [{variable!r}]（§9.2 单变量）"
        )
    if _request_face(family.base) != _request_face(episode):
        problems.append("请求面在干预后被改变（§9.1：请求必须不变）")
    if actual is None:
        problems.append("intervention.actual_effect 未回填")
    elif expected != actual:
        # REVISION 3（P1-5）：(axis, counterfactual_family_id) 粒度判定。同一个轴在
        # 另一个家族上被证实（``world_view.confirmed_axes``）时，本家族的不符是"这条
        # 轴对这个家族不具决定性"的混合 base 形态，记入 detail 而不拒收世界；世界里
        # 没有任何家族证实它 ⇒ 先验被证伪，照旧拒收（R4：不符即拒，不改标签）。
        confirmed_by = (world_view or G5WorldView()).confirming_families.get(str(variable))
        if confirmed_by is not None:
            problems.append(
                f"先验预期 expected_effect={expected!r} 与实际效应 actual_effect={actual!r} 在本家族不符，"
                f"但该轴已被家族 {confirmed_by} 证实（混合 base：按 (axis, family) 判定，不拒收世界）"
            )
            return GateResult(
                "G5_counterfactual_consistency",
                True,
                f"单变量 {variable}；本家族效应 {actual} 与先验 {expected} 不符（混合 base，"
                f"该轴由家族 {confirmed_by} 证实，按 (axis, counterfactual_family_id) 粒度放行）",
            )
        problems.append(
            f"先验预期 expected_effect={expected!r} 与实际效应 actual_effect={actual!r} 不符"
            "（R4：不符即拒，不改标签）"
        )
    if problems:
        return GateResult("G5_counterfactual_consistency", False, "; ".join(problems))
    return GateResult(
        "G5_counterfactual_consistency", True, f"单变量 {variable} 且预期效应 {expected} 被证实"
    )


# --------------------------------------------------------------------------- #
# G6 无关不变性
# --------------------------------------------------------------------------- #
def _request_face(episode: Episode) -> str:
    """episode 的**请求面**（``model_visible.request`` 去掉 ``rendered_text``）。

    ``rendered_text`` 不参与关键干预的比对：``structured_state`` renderer 按设计把
    世界状态投影进它（``configs/default.json`` 的 ``world_side_allowed`` 允许
    actors/resources/state_history/current_state），而干预**就是**改世界状态——
    对它要求"rendered_text 不变"与"干预必须改变状态"直接矛盾。请求面
    （method/path/query/headers/body）才是 §9.1 说的"请求字节"。
    """
    request = dict(episode.observation["model_visible"].get("request") or {})
    request.pop("rendered_text", None)
    return canonical_json(request)


def _g6_irrelevant_invariance(episode: Episode, family: FamilyView | None) -> GateResult:
    if family is None:
        return GateResult("G6_irrelevant_invariance", True, checked=False, detail="未提供家族上下文")
    if episode.variant_type not in ("irrelevant_perturbation", "evidence_masked"):
        return GateResult("G6_irrelevant_invariance", True, "非无关扰动/掩蔽变体：G6 不适用")
    problems: list[str] = []
    diff = (family.diffs or {}).get(episode.episode_id)
    if diff is None:
        diff = diff_worlds(family.base_world, family.base_world)
    if not diff.is_empty():
        problems.append(f"changed_paths={list(diff.changed_paths)}，期望为空（世界状态零变化）")
    base_request = canonical_json(family.base.observation["model_visible"].get("request"))
    variant_request = canonical_json(episode.observation["model_visible"].get("request"))
    if episode.variant_type == "evidence_masked" and base_request != variant_request:
        # 掩蔽只改证据可见性：请求必须逐字节相同（§9.1）。
        problems.append("请求字节被改变（evidence_masked 只允许改可见性）")
    if episode.variant_type == "irrelevant_perturbation" and base_request == variant_request:
        # 无关扰动的全部意义就在于改变观测表面；什么都不变是空扰动
        # （perturbation 模块自己会抛 no_op_perturbation，这里再机械断言一次）。
        problems.append("观测表面零变化：空扰动会让 verdict_invariant 假通过")
    base_truth = _world_truth(family.base)
    variant_truth = _world_truth(episode)
    if base_truth != variant_truth:
        problems.append(f"world_truth 因 {episode.variant_type} 改变：{base_truth} → {variant_truth}")
    if episode.variant_type == "irrelevant_perturbation":
        base_observable = _observable(family.base)
        variant_observable = _observable(episode)
        if base_observable != variant_observable:
            problems.append(
                f"observable_decision 因无关扰动改变：{base_observable} → {variant_observable}"
            )
    if problems:
        return GateResult("G6_irrelevant_invariance", False, "; ".join(problems))
    if episode.variant_type == "irrelevant_perturbation":
        return GateResult(
            "G6_irrelevant_invariance",
            True,
            "changed_paths == ()、观测表面已变、world_truth 与 observable_decision 均不变",
        )
    return GateResult(
        "G6_irrelevant_invariance",
        True,
        "changed_paths == ()、请求逐字节相同、world_truth 不变",
    )


def _world_truth(episode: Episode) -> str:
    output = episode.oracle_output
    if isinstance(output, Mapping):
        return str(output.get("world_truth"))
    return str(output.world_truth)


def _observable(episode: Episode) -> str:
    output = episode.oracle_output
    if isinstance(output, Mapping):
        return str(output.get("observable_decision"))
    return str(output.observable_decision)


# --------------------------------------------------------------------------- #
# G7 证据充分性
# --------------------------------------------------------------------------- #
#: ``configs/default.json`` 的 ``evidence_masking.insufficient_when``。
INSUFFICIENCY_REASONS: frozenset[str] = frozenset({
    "not_rendered",
    "attacker_controlled_only",
    "contradictory",
    "stale",
    "untrusted_source",
    "derived_only",
})


def _g7_evidence_sufficiency(
    episode: Episode, world: WorldInstance | None, action: Action, config: Mapping[str, Any]
) -> GateResult:
    output = _oracle_document(episode)
    decision = str(output.get("observable_decision"))
    missing = list(output.get("missing_evidence") or ())
    consulted = _consulted_facts(episode)
    problems: list[str] = []
    proof = ""
    if decision == "insufficient_evidence":
        if not missing:
            problems.append("observable_decision=insufficient_evidence 但 missing_evidence 为空")
        for entry in missing:
            reason = entry.get("reason")
            if reason not in INSUFFICIENCY_REASONS:
                problems.append(f"missing_evidence 的原因 {reason!r} 不在 insufficient_when 词表里")
        if world is not None:
            view = evidence_view_from_episode(episode)
            table = build_fact_table(
                world, action, view, consulted_facts=consulted, trusted=TRUSTED_ESTABLISHES
            )
            unestablished = {fact.fact_key: fact for fact in table.unestablished()}
            if not unestablished:
                problems.append(
                    "标记 insufficient 但重建的事实表里每个 consulted 事实都已建立（不可证明）"
                )
            else:
                proven = {
                    entry.get("decision_fact") for entry in missing if entry.get("decision_fact")
                }
                if not proven & set(unestablished):
                    problems.append(
                        f"missing_evidence 的 decision_fact {sorted(proven)} 与重建事实表的未建立事实 "
                        f"{sorted(unestablished)} 不一致"
                    )
                # 可证明性：至少一个未建立事实**无法从可观测证据里被确定下来**。
                # 四种形态都算证明——什么都看不到（not_rendered）、可信项互相矛盾
                # （contradictory）、没有任何可信项（attacker_controlled / untrusted）、
                # 唯一可信项已陈旧而策略要求新鲜（stale）。
                provable, why = _provably_unestablishable(
                    unestablished, view, world, action, consulted
                )
                if not provable:
                    problems.append(
                        "insufficient 不可证明：每个未建立事实都能从可见证据里唯一确定"
                    )
                else:
                    proof = why
        else:
            return GateResult(
                "G7_evidence_sufficiency",
                True,
                checked=False,
                detail="未提供 world：无法重建事实表，G7 的可证明性未运行",
            )
    elif missing:
        problems.append(f"observable_decision={decision} 却带 {len(missing)} 条 missing_evidence")
    if problems:
        return GateResult("G7_evidence_sufficiency", False, "; ".join(problems))
    if decision == "insufficient_evidence":
        return GateResult(
            "G7_evidence_sufficiency",
            True,
            f"insufficient 可证明：{len(missing)} 条 required evidence 无法从可观测证据确定"
            f"（{proof}；consulted={len(consulted)}）",
        )
    return GateResult("G7_evidence_sufficiency", True, f"{decision}: 无缺失证据，事实表可建立")


def _provably_unestablishable(
    unestablished: Mapping[str, Any],
    view: Any,
    world: WorldInstance,
    action: Action,
    consulted: frozenset[str],
) -> tuple[bool, str]:
    """是否至少一个未建立事实**无法**从可见证据里被唯一确定（G7 的可证明性）。"""
    from ..oracle import STALE_FRESHNESSES

    requires_fresh = any(policy.needs_fresh for policy in matched_policies(world, action))
    for fact_key in sorted(unestablished):
        visible = tuple(view.asserting(fact_key))
        establishing = tuple(
            item for item in visible if item.trust_level in TRUSTED_ESTABLISHES
        )
        if not visible:
            return True, f"{fact_key}: 没有任何可见证据（not_rendered）"
        if len({canonical_json(item.value) for item in establishing}) > 1:
            return True, f"{fact_key}: 可信证据互相矛盾（contradictory）"
        if not establishing:
            return True, f"{fact_key}: 可见项无一在 TRUSTED_ESTABLISHES（unverifiable）"
        if requires_fresh and all(
            item.freshness in STALE_FRESHNESSES for item in establishing
        ):
            return True, f"{fact_key}: 唯一可信项已陈旧且策略 requires_fresh（stale）"
    return False, ""


# --------------------------------------------------------------------------- #
# G8 泄漏审计
# --------------------------------------------------------------------------- #
def _g8_leakage_audit(
    episode: Episode, family: FamilyView | None, siblings: Sequence[Episode]
) -> GateResult:
    """家族内 split 一致性 + episode 自身 split 与 split_assignments 一致。

    全局的 group-overlap 审计在 :func:`_g8_dataset`（需要全部 episode）。
    """
    problems: list[str] = []
    assignments = list(episode.split_assignments or ())
    if not assignments:
        return GateResult(
            "G8_leakage_audit", True, checked=False, detail="episode 尚未分配 split（先跑 assign_splits）"
        )
    seen_strategies = [str(row.get("strategy")) for row in assignments]
    if sorted(seen_strategies) != sorted(STRATEGY_TO_GROUP_KEY):
        problems.append(f"split_assignments 必须是八种策略各一行，得到 {seen_strategies}")
    recorded_splits = {str(row.get("split")) for row in assignments}
    for row in assignments:
        strategy = str(row.get("strategy"))
        split = str(row.get("split"))
        if split not in SPLIT_NAMES:
            problems.append(f"策略 {strategy} 的 split {split!r} 不在 {SPLIT_NAMES}")
        expected_key = STRATEGY_TO_GROUP_KEY.get(strategy)
        if expected_key is not None and str(row.get("group_key")) != expected_key:
            problems.append(
                f"策略 {strategy} 的 group_key={row.get('group_key')!r}，应为 {expected_key!r}（§10.3）"
            )
    if episode.split is not None and episode.split not in recorded_splits:
        # ``episode.split`` 是**主策略**的分配；它必须是八行里真实出现过的取值
        # （不同策略给出不同 split 是 leave-key-out 的常态，因此不断言等于哪一行）。
        problems.append(
            f"episode.split={episode.split!r} 不在任何策略行的 split 取值 {sorted(recorded_splits)} 里"
        )
    if family is not None:
        for sibling in siblings:
            if sibling.split != episode.split:
                problems.append(
                    f"同家族 {sibling.episode_id} 的 split={sibling.split} 与本 episode 的 "
                    f"{episode.split} 不一致（反事实家族跨 split）"
                )
            if [dict(row) for row in (sibling.split_assignments or ())] != [dict(row) for row in assignments]:
                problems.append(f"同家族 {sibling.episode_id} 的 split_assignments 不一致")
    if problems:
        return GateResult("G8_leakage_audit", False, "; ".join(problems))
    return GateResult("G8_leakage_audit", True, "八策略 split 行齐全且家族内一致")


def _g8_dataset(
    episodes: Sequence[Episode],
    worlds: Mapping[str, WorldInstance] | None,
    declared: Mapping[str, str] | None = None,
) -> GateResult:
    """数据集级泄漏审计：四个关键 group key 不得跨 split。

    ``attack_family`` 必须用**与 split 分配同一套**派生规则（spec 声明优先，否则按
    违反的不变量类别派生）——两处各算一套会把"合法动作没有违反任何不变量"判成
    ``benign`` 族，而这个 pseudo 族天然跨 split，于是对正确数据报假失败。
    """
    declared_map = dict(declared or {})
    assignments: dict[str, dict[str, str]] = {}
    for episode in episodes:
        rows = episode.split_assignments or ()
        if not rows:
            continue
        iid = next((row for row in rows if str(row.get("strategy")) == "iid"), None)
        if iid is None:
            continue
        assignments[episode.episode_id] = {
            "counterfactual_family_id": episode.counterfactual_family_id,
            "world_family_id": episode.world_family_id,
            "app_domain": _lookup_world(worlds, episode).application_domain
            if _lookup_world(worlds, episode) is not None
            else "",
            "attack_family": declared_map.get(episode.world_id)
            or _attack_family_key(episode),
        }
    if not assignments:
        return GateResult("G8_leakage_audit", True, checked=False, detail="数据集尚未分配 split")
    overlaps: list[dict[str, Any]] = []
    for key in ("counterfactual_family_id", "world_family_id", "app_domain", "attack_family"):
        values: dict[str, set[str]] = {}
        for episode_id, keys in assignments.items():
            value = keys.get(key) or ""
            if not value:
                continue
            values.setdefault(value, set()).add(_split_of(episodes, episode_id))
        for value, splits in sorted(values.items()):
            if len(splits) > 1:
                overlaps.append({"group_key": key, "value": value, "splits": sorted(splits)})
    if overlaps:
        return GateResult(
            "G8_leakage_audit",
            False,
            f"{len(overlaps)} 个 group key 值跨 split（前 3：{overlaps[:3]}）",
        )
    return GateResult(
        "G8_leakage_audit",
        True,
        f"{len(assignments)} 个 episode 的四个关键 group key 无跨 split 取值",
    )


def _lookup_world(worlds: Mapping[str, WorldInstance] | None, episode: Episode) -> WorldInstance | None:
    if not worlds:
        return None
    return worlds.get(episode.world_id)


def _attack_family_key(episode: Episode) -> str:
    from .grouping import derive_attack_family

    return derive_attack_family(episode)


def _split_of(episodes: Sequence[Episode], episode_id: str) -> str:
    for episode in episodes:
        if episode.episode_id == episode_id:
            return str(episode.split)
    return "unknown"


# --------------------------------------------------------------------------- #
# G9 重复审计
# --------------------------------------------------------------------------- #
def _g9_duplicate_audit(episode: Episode, siblings: Sequence[Episode]) -> GateResult:
    """家族内**精确**去重（REVISION 1：exact dedup 是 family 内作用域）。

    只跑 ``exact`` 层：normalized / structural 会把 UA、header 顺序、trace id 扰动
    变体折叠掉，而那些正是「无关不变性」要训练的信号——跨家族才用那两层。
    """
    if not siblings:
        return GateResult("G9_duplicate_audit", True, "家族内无其他变体，无重复")
    report = dedup([episode, *siblings], layers=("exact",))
    removed = [record for record in report.records if record.removed]
    if removed:
        detail = ", ".join(f"{record.layer}:{record.kept_id}<-{record.dropped_id}" for record in removed[:4])
        return GateResult("G9_duplicate_audit", False, f"家族内发现 {len(removed)} 个重复样本: {detail}")
    return GateResult("G9_duplicate_audit", True, f"家族内 {len(siblings) + 1} 个变体三层去重后无重复")


def _g9_dataset(episodes: Sequence[Episode], config: Mapping[str, Any]) -> GateResult:
    report = dedup(list(episodes))
    kept, records = report.kept, report.records
    removed = [record for record in records if record.removed]
    rate = (len(removed) / len(episodes)) if episodes else 0.0
    if removed:
        by_layer: dict[str, int] = {}
        for record in removed:
            by_layer[record.layer] = by_layer.get(record.layer, 0) + 1
        return GateResult(
            "G9_duplicate_audit",
            False,
            f"全数据集 {len(removed)} 个重复样本（rate={rate:.4f}，分层 {by_layer}）",
        )
    return GateResult(
        "G9_duplicate_audit",
        True,
        f"{len(episodes)} 个 episode 三层去重后保留 {len(kept)} 个（duplicate_rate={rate:.4f}）",
    )


# --------------------------------------------------------------------------- #
# G10 分布摘要（报告门）
# --------------------------------------------------------------------------- #
def _g10_distribution(episodes: Sequence[Episode]) -> GateResult:
    summary = distribution_summary(episodes)
    classes = summary.get("observable_decision") or {}
    return GateResult(
        "G10_distribution_summary",
        True,
        f"observable_decision 分布 {classes}；variant_type {summary.get('variant_type')}",
    )


# --------------------------------------------------------------------------- #
# G11 表层特征 / 标签独立性
# --------------------------------------------------------------------------- #
def _g11_surface_label_independence(
    episodes: Sequence[Episode], config: Mapping[str, Any]
) -> GateResult:
    cfg = (config.get("quality_gates") or {}).get("G11_surface_label_independence") or {}
    max_bits = float(cfg.get("max_bits", 0.01))
    # REVISION 3（P1-7）：min_samples 与 ``configs/default.json`` / ``surface.
    # DEFAULT_MIN_SAMPLES`` 同步降为 64（200 是按 373 episode 的手写语料校准的，
    # milestone-1 规模下门永远不运行）。**样本不足是"未运行"，不是"通过"**——
    # 下面 checked=False 的分支就是这个语义，detail 如实写明样本不足未运行。
    min_samples = int(cfg.get("min_samples", DEFAULT_MIN_SAMPLES))
    report = surface_label_independence(episodes, features=cfg.get("features"), max_bits=max_bits)
    if report.samples < min_samples:
        return GateResult(
            "G11_surface_label_independence",
            True,
            checked=False,
            detail=(
                f"样本 {report.samples} < min_samples {min_samples}，G11 未运行"
                "（样本不足未运行，不假装通过）"
            ),
        )
    if not report.passed:
        detail = "; ".join(
            f"{item['feature']}={item['mutual_information_bits']}bit" for item in report.violations
        )
        return GateResult(
            "G11_surface_label_independence",
            False,
            f"表层特征与 verdict 的互信息超过 {max_bits} bit: {detail}",
        )
    return GateResult(
        "G11_surface_label_independence",
        True,
        f"{report.samples} 个样本、{len(report.features)} 个表层特征的 MI 全部 ≤ {max_bits} bit",
    )


# --------------------------------------------------------------------------- #
# G12 词法泄漏（模型可见侧出现判决线索词 ⇒ 硬失败）
# --------------------------------------------------------------------------- #
def _g12_lexical_label_leakage(episode: Episode, config: Mapping[str, Any]) -> GateResult:
    """G12：扫描 ``observation.model_visible``（含 ``rendered_text``）的线索词。

    decision_metadata 侧允许出现这些词（它们本就属于 oracle/gate 侧，G1/G2 的
    边界测试另外封死）；模型可见侧出现任何一个即失败。没有最小样本量：词法泄漏
    不是采样噪声，一个泄漏样本就足以让标签可被字符串匹配猜出。
    """
    markers = markers_from_config(config)
    report = lexical_label_leakage(episode, markers=markers)
    if not report.passed:
        detail = "; ".join(
            f"{hit.marker!r}@{hit.path}: {hit.excerpt}" for hit in report.hits[:4]
        )
        return GateResult(
            "G12_lexical_label_leakage",
            False,
            f"模型可见侧出现 {len(report.hits)} 处判决线索词（前 4：{detail}）",
        )
    return GateResult(
        "G12_lexical_label_leakage",
        True,
        f"model_visible 全部字节（含 rendered_text）无 {len(markers)} 个线索词命中",
    )


__all__ = [
    "EPISODE_SCOPED_GATES",
    "GATES",
    "HARD_GATES",
    "INSUFFICIENCY_REASONS",
    "DuplicateRecord",
    "FamilyView",
    "GateReport",
    "GateResult",
    "assign_splits",
    "evidence_view_from_episode",
    "family_view",
    "gate_failures_by_gate",
    "group_overlap_audit",
    "run_dataset_gates",
    "run_gates",
]
