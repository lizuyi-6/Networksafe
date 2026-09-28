"""总成管线：load → expand → mask → render → oracle → gates → split（Agent E 的胶水层）。

这一层是**胶水**，不是引擎：它调用 L4 的 ``expand_family``（每个 probe action 一个
反事实家族）、L5 的门禁与拆分、L6 的发布。放在 ``analysis/`` 而不是
``security_world/expansion`` 是因为展开引擎归 Agent D 独占，而"一个世界展开多少
实例"是语料策略（设计 §12.2：每个 world 20~200 实例），属于分析/发布侧。

每个世界的实例数（``configs/default.json`` 的 ``variants_per_world`` = 1+3+3+6）
乘以 probe action 数：:

    23 个世界 × 2 个 probe action × 最多 13 个变体 ≈ 598 个 episode

掩蔽 level 世界支撑不了的会记进 ``ExpansionResult.skipped``（不静默降级），
因此实际数量略低——低多少是**如实报告**的，不是凑数凑出来的。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from security_world.expansion import (
    ExpansionConfig,
    ExpansionResult,
    WorldDiff,
    expand_family,
)
from security_world.model import SPLIT_STRATEGIES, WorldInstance, WorldSpec, stable_hash
from security_world.policy import Action
from security_world.validation import (
    FamilyView,
    GateReport,
    SplitAssignment,
    assign_splits,
    run_dataset_gates,
)
from worlds.registry import HandcraftedWorld, iter_handcrafted

#: 每个世界的实例数下限/上限（设计 §12.2 / 任务书：20~200）。
MIN_INSTANCES_PER_WORLD = 20
MAX_INSTANCES_PER_WORLD = 200


@dataclass(frozen=True)
class WorldExpansion:
    """一个世界的展开结果（全部 probe action 的家族并集）。"""

    world_id: str
    spec: WorldSpec
    instance: WorldInstance
    families: tuple[FamilyView, ...]
    episodes: tuple[Any, ...]
    skipped: tuple[Mapping[str, Any], ...] = ()

    @property
    def instance_count(self) -> int:
        return len(self.episodes)


@dataclass(frozen=True)
class PipelineResult:
    """整条管线的产物。"""

    expansions: tuple[WorldExpansion, ...]
    episodes: tuple[Any, ...]
    worlds: Mapping[str, WorldInstance]
    families: Mapping[str, FamilyView]
    gate_report: GateReport
    split_assignments: tuple[SplitAssignment, ...]
    declared_attack_families: Mapping[str, str]
    per_world_counts: Mapping[str, int] = field(default_factory=dict)

    @property
    def sample_count(self) -> int:
        return len(self.episodes)

    def summary(self) -> dict[str, Any]:
        counts = self.per_world_counts
        return {
            "worlds": len(self.expansions),
            "episodes": len(self.episodes),
            "counterfactual_families": len(self.families),
            "per_world_instances": {
                "min": min(counts.values()) if counts else 0,
                "max": max(counts.values()) if counts else 0,
            },
            "skipped_variants": sum(len(item.skipped) for item in self.expansions),
            "gates_passed": self.gate_report.passed,
            "gate_failures": [result.gate for result in self.gate_report.failures],
        }


class BindsIncompleteError(ValueError):
    """episode 模板事件的 ``binds`` 缺少 action 必需字段（如 ``operation``）。

    世界欠规格化是**数据问题**，不是崩溃：调用方按 reason code 隔离该世界，
    而不是让 ``KeyError`` 逃逸成通用 expansion_error。schema 里 ``binds.operation``
    是可选的，但决策事件不绑 operation 时 action 无法构造（policy 匹配、oracle
    求值都依赖它），因此这里显式拒绝并留痕。
    """

    def __init__(self, missing: str, binds: Mapping[str, Any]) -> None:
        super().__init__(
            f"binds missing required key {missing!r} (keys present: {sorted(binds)})"
        )
        self.missing = missing


def action_from_binds(
    binds: Mapping[str, Any], *, action_id: str, at: str
) -> Action:
    """把 episode 模板的 ``binds``（含合并进来的 ``actor``）变成 :class:`Action`。"""
    for required in ("operation", "actor"):
        if binds.get(required) in (None, ""):
            raise BindsIncompleteError(required, binds)
    document: dict[str, Any] = {
        "action_id": action_id,
        "operation": str(binds["operation"]),
        "actor": str(binds["actor"]),
        "flow_id": str(binds.get("flow_id") or f"FLOW-{binds['operation']}"),
        "at": at,
    }
    for action_key, bind_key in (
        ("resource", "resource_id"),
        ("session", "session_id"),
        ("token", "token_id"),
        ("workflow_instance", "workflow_instance_id"),
    ):
        value = binds.get(bind_key)
        if value is not None:
            document[action_key] = value
    return Action.from_document(document)


def counterfactual_family_id(base_family_id: str, action_id: str) -> str:
    """把展开引擎的家族 id 收窄成"每个 probe action 一个家族"。

    **为什么需要这一步**：``derive_counterfactual_family_id`` 的输入是
    ``(world_family_id, world_id, seed, sorted(critical axes))``——**不含 action**。
    于是一个世界里的两个 probe action（合法动作 + 攻击动作）会拿到同一个
    ``counterfactual_family_id``，它们的 base 变体因此互相被当成"同一家族的反事实
    变体"：Gate 5/6 拿着攻击动作的 base 去比对合法动作的扰动变体，verdict 必然
    不一致，门禁于是对正确数据报假失败。

    收窄（而不是放宽）家族边界对泄漏控制只有好处：更小的组 = 更少的跨 split 共享。
    派生仍是纯函数，且仍然满足 ``episode.schema.json`` 的 ``^CF-[0-9a-f]{12,64}$``。
    """
    return "CF-" + stable_hash([base_family_id, action_id])[:12]


#: 轴路径的实体类型段 → probe action 的绑定字段名。
_AXIS_TYPE_TO_BINDING: Mapping[str, str] = {
    "actor": "actor",
    "resource": "resource",
    "session": "session",
    "token": "token",
    "workflow_instance": "workflow_instance",
}


def spec_probes(spec: WorldSpec) -> tuple[tuple[str, Mapping[str, Any]], ...]:
    """spec 的全部 probe 动作（``(summary, binds)``，按 ``t_offset_ms`` 排序）。"""
    document = spec.to_document()
    template = document["episode_templates"][0]
    events = sorted(template["events"], key=lambda event: int(event["t_offset_ms"]))
    out: list[tuple[str, Mapping[str, Any]]] = []
    for event in events:
        binds = dict(event.get("binds") or {})
        if not binds:
            continue
        out.append((str(event.get("summary") or ""), {"actor": event.get("actor_id"), **binds}))
    return tuple(out)


def axes_for_probe(spec: WorldSpec, binds: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    """选出**这个 probe action** 的关键轴（先验声明按探针分区）。

    ``hypotheses.expected_counterfactual_axes`` 是一份跨全部 probe 的列表，而
    ``expand_family`` 对每个家族应用其中所有 ``kind == "critical"`` 的轴。一条只
    改动攻击目标实体的轴，对合法动作的家族是空操作——它的 ``actual_effect`` 会是
    ``verdict_invariant``，与先验的 ``verdict_flip`` 不符，Gate 5 于是对**正确的
    数据**报假失败（R4 的证伪机制被作用域错误触发）。

    分区规则是机械的、**不看 oracle**：一条轴适用于某个 probe，当且仅当

    * 该轴路径的实体被这个 probe 的 action 绑定（``resource.RES-001.owner`` 适用于
      绑定 ``RES-001`` 的 probe），或
    * 该轴的实体类型根本没有任何 probe 绑定（例如 ``cache.*``——它对所有 probe
      都是同一个全局状态）。

    单轴世界因此对所有 probe 生效。
    """
    document = spec.to_document()
    axes = tuple(
        axis
        for axis in document["hypotheses"]["expected_counterfactual_axes"]
        if axis.get("kind") == "critical"
    )
    if len(axes) <= 1:
        return axes
    globally_bound: set[str] = set()
    for _summary, other_binds in spec_probes(spec):
        for axis_type, binding in _AXIS_TYPE_TO_BINDING.items():
            if other_binds.get(binding) or other_binds.get(f"{binding}_id"):
                globally_bound.add(axis_type)
    selected: list[Mapping[str, Any]] = []
    for axis in axes:
        axis_type = str(axis["variable"]).split(".", 1)[0]
        if axis_type not in globally_bound:
            selected.append(axis)
            continue
        binding = _AXIS_TYPE_TO_BINDING.get(axis_type)
        if binding is None:
            selected.append(axis)
            continue
        bound_value = binds.get(binding) or binds.get(f"{binding}_id")
        entity_id = str(axis["variable"]).split(".")[1]
        if bound_value == entity_id:
            selected.append(axis)
    return tuple(selected) or axes


def spec_with_axes(spec: WorldSpec, axes: Sequence[Mapping[str, Any]]) -> WorldSpec:
    """返回只带指定关键轴的 spec 副本（无关轴原样保留）。"""
    document = spec.to_document()
    hypotheses = dict(document["hypotheses"])
    all_axes = list(hypotheses["expected_counterfactual_axes"])
    selected_ids = {str(axis["axis_id"]) for axis in axes}
    hypotheses["expected_counterfactual_axes"] = [
        axis
        for axis in all_axes
        if axis.get("kind") != "critical" or str(axis.get("axis_id")) in selected_ids
    ]
    document["hypotheses"] = hypotheses
    document["critical_state_variables"] = [str(axis["variable"]) for axis in axes]
    return WorldSpec.from_document(document)


def renderer_of(episode: Any) -> str:
    """episode 的渲染形态（``model_visible.renderer``）。"""
    observation = getattr(episode, "observation", None) or {}
    model_visible = observation.get("model_visible") or {}
    return str(model_visible.get("renderer") or "")


def _with_episode_id(episode: Any, episode_id: str) -> Any:
    import dataclasses

    if episode.episode_id == episode_id:
        return episode
    return dataclasses.replace(episode, episode_id=episode_id)


def _restamp_family(episodes: Sequence[Any], family_id: str) -> tuple[Any, ...]:
    """把一组 episode 的 ``counterfactual_family_id`` 换成收窄后的值。"""
    import dataclasses

    out: list[Any] = []
    for episode in episodes:
        if episode.counterfactual_family_id == family_id:
            out.append(episode)
            continue
        out.append(dataclasses.replace(episode, counterfactual_family_id=family_id))
    return tuple(out)


def qualify_episode_id(episode_id: str, renderer: str) -> str:
    """把 episode id 限定到渲染形态。

    ``expansion`` 的 ``_derive_episode_id`` 只哈希
    ``(world_id, family_id, variant_type, action_id, intervention, variant_key)``——
    **不含 renderer**。于是同一个 (world, action, variant) 用不同 renderer 渲染会
    拿到**同一个 episode_id**，数据集里出现 id 冲突：split 的 ``assignments``
    （以 episode_id 为键）会把它们折叠成一个，G9 的家族内去重也会误判。

    本管线按渲染形态重新限定 id（仍然是 ``EP-`` 前缀，仍满足
    ``episode.schema.json`` 的 ``^EP-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$``），
    使"同一决策的不同观测"成为不同样本——那正是 D2（renderer 是单向投影）要的。
    """
    if not renderer or episode_id.endswith(f"-{renderer}"):
        return episode_id
    return f"{episode_id}-{renderer}"


def family_view_for_action(
    result: ExpansionResult, action: Action, *, seed: int = 0, spec: Any = None
) -> FamilyView:
    """把 ``expand_family`` 的结果包装成**按 action 收窄家族 id**的门禁上下文。

    与 :func:`expand_handcrafted_world` 内部用的是同一条收窄规则，测试因此能复现
    管线的家族切分，而不是各自猜一套。``spec`` 给出时带进 FamilyView——G5 的
    "零 critical 干预变体"判定（P0-4）要问"这个世界声明过 critical 轴吗"，而
    ``skipped``（``axis_skipped_no_reader`` / ``hypothesis_before_mismatch``）是
    展开期的跳过记录，两者合起来才分得清"没有 CI 变体"与"没有声明 CI 轴"。

    **diffs 的键必须是重盖章前的那一个**：``expand_family`` 的 ``diffs`` 按展开期
    的原始 episode_id 索引，而这里紧接着就把 id 限定到渲染形态。若按重盖后的 id 查，
    每次 lookup 都落空，``diffs`` 退化成全空字典——G6 于是对**每一个**扰动变体
    都拿到 ``diff is None``，回落到 ``diff_worlds(base_world, base_world)``
    （空集），"世界状态零变化"这一半检查就此恒真。Phase 2A 因果审计实测抓到过
    这个假通过，因此这里显式保留原始 id 做键。
    """
    family_id = counterfactual_family_id(result.family_id, action.action_id)
    variants = _restamp_family(result.variants, family_id)
    stamped: list[tuple[str, Any]] = []
    for variant in variants:
        original_id = variant.episode_id
        stamped.append(
            (original_id, _with_episode_id(
                variant, qualify_episode_id(variant.episode_id, renderer_of(variant))
            ))
        )
    diffs = {
        episode.episode_id: result.diffs.get(original_id, WorldDiff(()))
        for original_id, episode in stamped
    }
    return FamilyView(
        family_id=family_id,
        base=next(item for _original, item in stamped if item.variant_type == "base"),
        base_world=result.world,
        variants=tuple(item for _original, item in stamped),
        diffs=diffs,
        seed=seed,
        spec=spec,
        skipped=tuple(getattr(result, "skipped", ()) or ()),
    )


def expand_handcrafted_world(
    world: HandcraftedWorld,
    *,
    config: ExpansionConfig | None = None,
    renderer: str | None = None,
    renderers: Sequence[str] = ("http_request", "structured_state", "reverse_proxy_log"),
) -> WorldExpansion:
    """把一个人工世界展开成它的全部实例（每个 probe action 一个反事实家族）。"""
    cfg = config if config is not None else ExpansionConfig.default()
    spec = world.spec
    instance = spec.compile(seed=spec.seed) if hasattr(spec, "compile") else None
    if instance is None:
        from security_world.model import compile_spec

        instance = compile_spec(spec, seed=spec.seed)
    families: list[FamilyView] = []
    episodes: list[Any] = []
    skipped: list[Mapping[str, Any]] = []
    at = str(world.spec_document["current_state"]["at"])
    for index, (_summary, binds) in enumerate(world.probes(), start=1):
        action = action_from_binds(binds, action_id=f"ACTN-{world.number:03d}-{index}", at=at)
        probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
        for renderer_name in renderers:
            result: ExpansionResult = expand_family(
                probe_spec,
                seed=spec.seed,
                action=action,
                config=cfg,
                renderer=renderer or renderer_name,
            )
            view = family_view_for_action(result, action, seed=spec.seed, spec=probe_spec)
            families.append(view)
            episodes.extend(view.variants)
            skipped.extend(result.skipped)
    return WorldExpansion(
        world_id=world.world_id,
        spec=spec,
        instance=instance,
        families=tuple(families),
        episodes=tuple(episodes),
        skipped=tuple(skipped),
    )


def annotate_with_splits(
    episodes: Sequence[Any],
    assignments: Sequence[SplitAssignment],
    *,
    primary: str,
) -> list[Any]:
    """把八策略 split 分配写回 episode（八行 + 主策略的 ``split``）。

    与 ``security_world.release.build_release`` 用的是同一条规则：``episode.split``
    是**主策略**的分配，``split_assignments`` 八种策略各一行（episode.schema.json）。
    """
    import dataclasses

    rows_by_episode: dict[str, list[dict[str, Any]]] = {}
    primary_split: dict[str, str] = {}
    for assignment in assignments:
        for episode_id, split in sorted(assignment.assignments.items()):
            rows_by_episode.setdefault(episode_id, []).append(
                {
                    "strategy": assignment.strategy,
                    "group_key": assignment.group_key,
                    "split": split,
                }
            )
            if assignment.strategy == primary:
                primary_split[episode_id] = split
    out: list[Any] = []
    for episode in episodes:
        episode_id = str(getattr(episode, "episode_id", ""))
        rows = sorted(rows_by_episode.get(episode_id, []), key=lambda row: str(row["strategy"]))
        if hasattr(episode, "with_split_assignments"):
            updated = episode.with_split_assignments(rows)
            split = primary_split.get(episode_id)
            if split is not None and updated.split != split:
                updated = dataclasses.replace(updated, split=split)
        else:
            document = dict(episode)
            document["split"] = primary_split.get(episode_id)
            document["split_assignments"] = rows
            updated = document
        out.append(updated)
    return out


def _family_key(view: FamilyView) -> str:
    """家族键：``family_id:renderer``（同一次决策的不同渲染形态是不同家族）。

    ``family_id`` 已经按 probe action 收窄，但多种 renderer 共用同一个 id；门禁的
    ``family.base`` 必须指向**同 renderer** 的 base，否则 G5/G6 会跨渲染形态比对
    请求字节。``security_world.validation.gates.family_lookup_key`` 用同一把键查找。
    """
    renderer = view.base.observation["model_visible"].get("renderer")
    return f"{view.family_id}:{renderer}"


def run_pipeline(
    *,
    root: Path | None = None,
    config: Mapping[str, Any] | None = None,
    strategy: str | None = None,
    ratios: Mapping[str, float] | None = None,
    seed: int | None = None,
    renderer: str | None = None,
    renderers: Sequence[str] = ("http_request", "structured_state", "reverse_proxy_log"),
    expansion_config: ExpansionConfig | None = None,
) -> PipelineResult:
    """跑完整条管线并返回产物（门禁与拆分都在内）。"""
    from security_world.model.config import load_default_config

    cfg = dict(config) if config is not None else load_default_config()
    expansions: list[WorldExpansion] = []
    for world in iter_handcrafted(root):
        expansions.append(
            expand_handcrafted_world(
                world, config=expansion_config, renderer=renderer, renderers=renderers
            )
        )
    episodes = [episode for expansion in expansions for episode in expansion.episodes]
    worlds = {expansion.world_id: expansion.instance for expansion in expansions}
    families = {
        _family_key(view): view for expansion in expansions for view in expansion.families
    }
    declared = {
        world.world_id: world.attack_family for world in iter_handcrafted(root)
    }
    leakage = cfg.get("leakage_control") or {}
    resolved_strategy = strategy or str(leakage.get("default_strategy") or "world_ood")
    resolved_ratios = ratios if ratios is not None else (leakage.get("split_ratios") or None)
    resolved_seed = int(seed if seed is not None else int(cfg.get("seed", 0)))
    # 八种策略全部分配：episode.schema.json 的 split_assignments 要求每种策略各一行
    # （brief §16：全部八种 OOD split 都能从冻结 release 复现），G8 也按这个断言。
    assignments = tuple(
        assign_splits(
            episodes,
            strategy=name,
            ratios=resolved_ratios,
            seed=resolved_seed,
            worlds=worlds,
            declared_attack_families=declared,
        )
        for name in SPLIT_STRATEGIES
    )
    # 把 split 写回 episode：G8 的全局泄漏审计要看到 ``split_assignments`` 才能判定
    # "反事实家族不跨 split"——不标注就等于把 G8 跳过。
    annotated = annotate_with_splits(episodes, assignments, primary=resolved_strategy)
    gate_report = run_dataset_gates(
        annotated,
        families=families,
        worlds=worlds,
        config=cfg,
        declared_attack_families=declared,
    )
    return PipelineResult(
        expansions=tuple(expansions),
        episodes=annotated,
        worlds=worlds,
        families=families,
        gate_report=gate_report,
        split_assignments=assignments,
        declared_attack_families=declared,
        per_world_counts={item.world_id: item.instance_count for item in expansions},
    )


__all__ = [
    "MAX_INSTANCES_PER_WORLD",
    "MIN_INSTANCES_PER_WORLD",
    "PipelineResult",
    "WorldExpansion",
    "action_from_binds",
    "annotate_with_splits",
    "axes_for_probe",
    "counterfactual_family_id",
    "expand_handcrafted_world",
    "family_view_for_action",
    "qualify_episode_id",
    "renderer_of",
    "run_pipeline",
    "spec_probes",
    "spec_with_axes",
]
