"""episode 组装与家族展开（设计 §5.1 / §9.1 / §15.3 的 L4 组装入口）。

两个公共入口：

* :func:`assemble_episode` —— 把 (world, action, timeline, observation) 钉成一个
  ``Episode``。它**内部调用** ``security_world.oracle.run_oracle``（D → C 是唯一
  允许的跨包调用方向），因此标签永远由 oracle 在组装期产生；调用方传入的
  ``oracle_output`` 只被当作**待验证的重算结果**，不一致即抛
  （G4 的"同入参同出参"在组装期强制，而不是等 Gate 才发现）。
* :func:`expand_family` —— 一个 spec 展开出 §9.1 的家族：base + 关键干预 +
  无关扰动 + 掩蔽变体，返回 :class:`ExpansionResult`（变体 + 逐变体 world diff）。

``observation`` 的两半在组装期分开（§5.2 / D7）：

* ``model_visible`` 来自渲染器（闭集五键）；
* ``decision_metadata`` 由组装器从**世界证据目录 + 视图可见性**生成（分类全量、
  hidden 只存 id 不存值、可用性 level 由 :func:`classify_evidence_level` 判定）——
  模型侧按构造拿不到它（``Episode.serialize_for_model`` 把它整体剥掉）。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import re
from datetime import timedelta
from typing import Any

from ..model.canonical import canonical_json, stable_hash
from ..model.clock import format_instant, parse_instant
from ..model.entities import Endpoint
from ..model.episode import (
    VARIANT_TYPES,
    Episode,
)
from ..model.errors import RefResolutionError
from ..model.events import Event
from ..model.grouping import episode_group_keys
from ..model.rng import derive_seed, validate_seed
from ..model.world import WorldInstance, WorldSpec
from ..oracle import EvidenceView, run_oracle
from ..policy import Action
from .config import ExpansionConfig
from .counterfactual import (
    Intervention,
    critical_intervention,
    evaluate_intervention_effect,
    with_actual_effect,
)
from .diff import WorldDiff, diff_worlds
from .errors import EpisodeAssemblyError
from .masking import classify_evidence_level, consulted_facts_from_output, mask_evidence
from .perturbation import (
    IRRELEVANT_PERTURBATION_EFFECT,
    PerturbationError,
    axis_change,
    irrelevant_perturbation,
)
from .rendering import Observation, project_evidence, render

#: 组装器版本（写进 ``episode.provenance.pipeline_version``）。
PIPELINE_VERSION = "0.1.0"

#: ``episode.schema.json`` 的 ``provenance.generator_provenance`` 闭键白名单（B7）。
GENERATOR_PROVENANCE_KEYS: tuple[str, ...] = (
    "model",
    "model_version",
    "prompt_version",
    "prompt_hash",
    "raw_generation_id",
    "decoding_parameters",
)

#: ``decision_metadata`` 里允许调用方补充的声明性键（relevant/irrelevant/causal）。
DECISION_METADATA_EXTRA_KEYS: tuple[str, ...] = (
    "relevant_history",
    "irrelevant_history",
    "causal_tags",
)

#: REVISION 3（P0-4）：critical 轴没有任何 in-scope policy/invariant 读取时的跳过
#: 原因码。这样的轴改不动任何判决（oracle 只被策略与不变量驱动），把它展开成关键
#: 干预只会得到 ``verdict_invariant``，与先验的 ``verdict_flip`` 不符后被 G5 拒——
#: 不如在选择期就跳过并留痕。
AXIS_SKIPPED_NO_READER = "axis_skipped_no_reader"


# --------------------------------------------------------------------------- #
# assemble_episode
# --------------------------------------------------------------------------- #
def assemble_episode(
    *,
    world: WorldInstance,
    spec: WorldSpec | None,
    family_id: str,
    variant_type: str,
    action: Any,
    timeline: Sequence[Any],
    observation: Observation,
    oracle_output: Any = None,
    evidence_view: Any = None,
    intervention: Any = None,
    decision_metadata: Mapping[str, Any] | None = None,
    episode_id: str | None = None,
    current_event: Any = None,
    split: str | None = None,
    generator_provenance: Mapping[str, Any] | None = None,
    variant_key: str | None = None,
) -> Episode:
    """把一次观测钉成 episode（标签由内部 ``run_oracle`` 重算产生）。

    ``spec`` 给出时校验 ``world.world_id == spec.world_id``（防串号）并从
    ``spec.provenance`` 派生 ``generator_provenance``；``None`` 表示"裸世界"
    （测试与手工装配），此时跳过这两步。
    """
    if variant_type not in VARIANT_TYPES:
        raise EpisodeAssemblyError(
            "unknown_variant_type", f"variant_type 必须是 {VARIANT_TYPES} 之一，得到 {variant_type!r}"
        )
    if not isinstance(world, WorldInstance):
        raise EpisodeAssemblyError(
            "world_not_instance", f"world 必须是 WorldInstance，得到 {type(world).__name__}"
        )
    if not isinstance(observation, Observation):
        raise EpisodeAssemblyError(
            "observation_not_observation",
            f"observation 必须是 expansion.Observation，得到 {type(observation).__name__}",
        )
    if spec is not None and spec.world_id != world.world_id:
        raise EpisodeAssemblyError(
            "world_spec_mismatch",
            f"world.world_id={world.world_id!r} 与 spec.world_id={spec.world_id!r} 不一致",
        )
    timeline_tuple = tuple(timeline)
    if not timeline_tuple:
        raise EpisodeAssemblyError("empty_timeline", "timeline 不能为空（episode.schema.json minItems: 1）")

    intervention_document = _intervention_document(intervention, variant_type)
    view = evidence_view if evidence_view is not None else EvidenceView.from_world(world)

    # 标签：oracle 重算（调用方给的只作交叉验证）。
    recomputed = run_oracle(world, action, view)
    if oracle_output is not None:
        given = oracle_output.to_document() if hasattr(oracle_output, "to_document") else dict(oracle_output)
        if canonical_json(given) != canonical_json(recomputed.to_document()):
            raise EpisodeAssemblyError(
                "oracle_output_mismatch",
                "调用方给的 oracle_output 与 (world, action, evidence_view) 的重算结果不一致"
                "（G4：同入参必须同出参）",
            )

    # 可见性三处一致（S7）：世界目录是权威，视图是投影，观测是投影的投影。
    visible_ids = {item.evidence_id for item in view.visible}
    expected_evidence = _projected_evidence(view, observation.current_time)
    if [canonical_json(item) for item in expected_evidence] != [
        canonical_json(item) for item in observation.evidence
    ]:
        raise EpisodeAssemblyError(
            "observation_projection_mismatch",
            "观测携带的证据投影与 (world, evidence_view) 的权威可见性不一致（S7）",
        )

    classification: list[dict[str, Any]] = []
    for item in world.evidence:
        document = item.to_document()
        document["visible_in_observation"] = item.evidence_id in visible_ids
        classification.append(document)
    hidden_ids = sorted(
        item.evidence_id for item in world.evidence if item.evidence_id not in visible_ids
    )
    consulted = consulted_facts_from_output(recomputed)
    metadata: dict[str, Any] = {
        "evidence_classification": classification,
        "hidden_evidence_ids": hidden_ids,
        "evidence_availability_level": classify_evidence_level(
            view,
            baseline=EvidenceView.from_world(world),
            consulted_facts=consulted,
            world=world,
            action=action,
        ),
    }
    for key, value in (decision_metadata or {}).items():
        if key not in DECISION_METADATA_EXTRA_KEYS:
            raise EpisodeAssemblyError(
                "unknown_decision_metadata_key",
                f"decision_metadata 只接受 {DECISION_METADATA_EXTRA_KEYS}，得到 {key!r}",
            )
        metadata[key] = value

    resolved_event = current_event if current_event is not None else timeline_tuple[-1]
    resolved_id = episode_id or _derive_episode_id(
        world=world,
        family_id=family_id,
        variant_type=variant_type,
        action=action,
        intervention=intervention_document,
        variant_key=variant_key,
    )
    provenance: dict[str, Any] = {
        "created_at": action.at,
        "pipeline_version": PIPELINE_VERSION,
    }
    resolved_generator = _generator_provenance(generator_provenance, spec)
    if resolved_generator is not None:
        provenance["generator_provenance"] = resolved_generator

    # REVISION 2（任务书 A7）：组装期把十二个 group key 值盖章进 episode 文档。
    # 派生规则只有一套（``security_world.model.grouping``，L1 纯文档函数）——split
    # 分配、泄漏审计与这里的盖章共用同一实现，不可能漂移。spec 给出时用 spec 声明
    # 的 attack_family（与 assign_splits(declared_attack_families=...) 同一规则）。
    group_keys = episode_group_keys(
        {
            "counterfactual_family_id": family_id,
            "world_family_id": world.world_family_id,
            "action": action,
            "oracle_output": recomputed,
            "provenance": provenance,
        },
        world=world,
        declared_attack_family=(spec.attack_family if spec is not None and spec.attack_family else None),
    )

    return Episode(
        schema_version="0.1",
        episode_id=resolved_id,
        world_id=world.world_id,
        world_family_id=world.world_family_id,
        counterfactual_family_id=family_id,
        variant_type=variant_type,
        action=action,
        timeline=timeline_tuple,
        current_event=resolved_event,
        observation={"model_visible": observation.to_model_visible(), "decision_metadata": metadata},
        oracle_output=recomputed,
        split=split,
        intervention=intervention_document,
        provenance=provenance,
        group_keys=group_keys,
    )


def _projected_evidence(view: EvidenceView, current_time: str) -> tuple[dict[str, Any], ...]:
    from .rendering import project_evidence

    return project_evidence(tuple(view.visible), current_time)


def _intervention_document(intervention: Any, variant_type: str) -> dict[str, Any] | None:
    if intervention is None:
        if variant_type in ("critical_intervention", "irrelevant_perturbation"):
            raise EpisodeAssemblyError(
                "intervention_required",
                f"variant_type={variant_type!r} 必须带 intervention（episode.schema.json 的 allOf/if-then）",
            )
        return None
    if isinstance(intervention, Intervention):
        return intervention.to_document()
    if isinstance(intervention, Mapping):
        return dict(Intervention.from_document(intervention).to_document())
    raise EpisodeAssemblyError(
        "intervention_not_document",
        f"intervention 必须是 Intervention 或 object，得到 {type(intervention).__name__}",
    )


def _generator_provenance(
    generator_provenance: Mapping[str, Any] | None, spec: WorldSpec | None
) -> dict[str, Any] | None:
    if generator_provenance is None and spec is not None:
        provenance = spec.provenance
        generator_provenance = {
            "model": provenance.generator_model,
            "model_version": provenance.generator_model_version,
            "prompt_version": provenance.prompt_version,
            "prompt_hash": provenance.prompt_hash,
        }
    if generator_provenance is None:
        return None
    unknown = sorted(str(key) for key in generator_provenance if key not in GENERATOR_PROVENANCE_KEYS)
    if unknown:
        raise EpisodeAssemblyError(
            "bad_generator_provenance",
            f"generator_provenance 是闭键白名单 {list(GENERATOR_PROVENANCE_KEYS)}，得到越界键 {unknown}",
        )
    document = {str(key): value for key, value in generator_provenance.items()}
    for required in ("model", "model_version", "prompt_version", "prompt_hash"):
        if required not in document:
            raise EpisodeAssemblyError(
                "bad_generator_provenance", f"generator_provenance 缺少必填键 {required!r}"
            )
    prompt_hash = document["prompt_hash"]
    if not isinstance(prompt_hash, str) or len(prompt_hash) != 64 or any(
        character not in "0123456789abcdef" for character in prompt_hash
    ):
        raise EpisodeAssemblyError(
            "bad_generator_provenance", f"prompt_hash 必须是 64 位十六进制: {prompt_hash!r}"
        )
    return document


def _derive_episode_id(
    *,
    world: WorldInstance,
    family_id: str,
    variant_type: str,
    action: Any,
    intervention: Mapping[str, Any] | None,
    variant_key: str | None = None,
) -> str:
    digest = stable_hash(
        {
            "world_id": world.world_id,
            "family_id": family_id,
            "variant_type": variant_type,
            "action_id": action.action_id,
            "intervention": dict(intervention) if intervention else None,
            "variant_key": variant_key,
        }
    )
    return f"EP-{digest[:16]}"


# --------------------------------------------------------------------------- #
# expand_family
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ExpansionResult:
    """一个反事实家族的展开结果（设计 §15.3）。"""

    family_id: str
    variants: tuple[Episode, ...]
    diffs: Mapping[str, WorldDiff]
    world: WorldInstance | None = None
    skipped: tuple[Mapping[str, Any], ...] = ()

    def variant(self, episode_id: str) -> Episode:
        for episode in self.variants:
            if episode.episode_id == episode_id:
                return episode
        raise KeyError(episode_id)

    def by_variant_type(self, variant_type: str) -> tuple[Episode, ...]:
        return tuple(episode for episode in self.variants if episode.variant_type == variant_type)


def instantiate(
    spec: WorldSpec,
    *,
    seed: int | None = None,
    compile_config: Mapping[str, Any] | None = None,
) -> WorldInstance:
    """spec → instance（``compile_spec`` 的 L4 入口；假设块在编译期整体丢弃）。

    ``compile_config`` 是 Phase 2A 的显式注入口：语义骨架编译器会把租户类语义事实
    编译成 ``actor.*.tenant`` / ``resource.*.tenant`` 轴，而 Phase 1 的
    ``configs/default.json`` 白名单里没有这两条。与其改默认配置（那会让 Phase 1 的
    ``config_sha256`` 失效），Phase 2A 传自己的 ``configs/phase2a.json`` 进来。
    缺省行为逐字节不变：``None`` 仍然走默认配置。
    """
    from ..model import compile_spec

    return compile_spec(spec, seed=seed, config=compile_config)


def expand_family(
    spec: WorldSpec,
    *,
    seed: int | None = None,
    action: Any = None,
    renderer: str | None = None,
    style: str = "rest",
    config: ExpansionConfig | None = None,
    allowlist: Mapping[str, Any] | None = None,
    compile_config: Mapping[str, Any] | None = None,
) -> ExpansionResult:
    """把一个 spec 展开成 §9.1 的变体家族（base + critical + irrelevant + masked）。

    关键干预变体由 spec 的 **先验假设**驱动（``hypotheses.
    expected_counterfactual_axes`` 中 ``kind == "critical"`` 的轴，R4：预期只能
    先验声明）；``before`` 与世界现值不符的轴记入 ``skipped`` 而不是悄悄改写。
    REVISION 3（P0-4）：选择期还做**读者预检**——没有任何 in-scope policy/invariant
    读取的 critical 轴记 ``axis_skipped_no_reader``（它改不动判决，展开只会制造
    必然 ``verdict_invariant`` 的假干预）。掩蔽 level 按 ``config.masked_levels()``
    的顺序构造，世界支撑不了的 level 同样记入 ``skipped``（带 reason code），不静默降级。
    """
    cfg = config if config is not None else ExpansionConfig.default()
    resolved_seed = spec.seed if seed is None else validate_seed(seed)
    world = instantiate(spec, seed=resolved_seed, compile_config=compile_config)
    family_id = spec.counterfactual_family_id(world.world_family_id)
    renderer_name = renderer or cfg.renderer
    resolved_allowlist = allowlist if allowlist is not None else cfg.projection_allowlist
    decision = action if action is not None else _action_from_spec(spec, world)
    timeline = _timeline_from_spec(spec, world, decision)

    base_observation = render(
        world,
        decision,
        renderer=renderer_name,
        seed=resolved_seed,
        allowlist=resolved_allowlist,
        style=style,
        timeline=timeline,
    )
    base = assemble_episode(
        world=world,
        spec=spec,
        family_id=family_id,
        variant_type="base",
        action=decision,
        timeline=timeline,
        observation=base_observation,
        current_event=_decision_event(timeline, spec),
    )
    variants: list[Episode] = [base]
    diffs: dict[str, WorldDiff] = {base.episode_id: diff_worlds(world, world)}
    skipped: list[Mapping[str, Any]] = []
    consulted = consulted_facts_from_output(base.oracle_output)
    base_output = base.oracle_output

    # ---- 关键干预：单变量 + 先验预期 + 实际效应回填 ---------------- #
    # REVISION 3（P0-4）：先做读者预检——没有任何 in-scope policy/invariant 读取的
    # critical 轴改不动判决，展开它只会制造一个必然 ``verdict_invariant`` 的假干预。
    readers = _axis_reader_keys(world, decision)
    critical_axes = [
        axis for axis in spec.hypotheses.expected_counterfactual_axes if axis.kind == "critical"
    ]
    for axis in critical_axes[: cfg.variant_count("critical_intervention")]:
        if not world.contains(axis.variable):
            skipped.append(
                {"variant": "critical_intervention", "axis_id": axis.axis_id, "reason": "axis_unresolvable"}
            )
            continue
        if not _axis_has_reader(axis.variable, readers, world):
            skipped.append(
                {
                    "variant": "critical_intervention",
                    "axis_id": axis.axis_id,
                    "reason": AXIS_SKIPPED_NO_READER,
                }
            )
            continue
        if canonical_json(world.resolve(axis.variable)) != canonical_json(axis.before):
            skipped.append(
                {
                    "variant": "critical_intervention",
                    "axis_id": axis.axis_id,
                    "reason": "hypothesis_before_mismatch",
                }
            )
            continue
        try:
            variant_world, intervention = critical_intervention(
                world,
                intervention_variable=axis.variable,
                after=axis.after,
                seed=derive_seed(resolved_seed, "critical", axis.axis_id),
                expected_effect=axis.expected_effect,
                whitelist=cfg.critical_axes_whitelist,
            )
        except Exception as exc:  # InterventionError 及其 reason code 原样记录
            skipped.append(
                {
                    "variant": "critical_intervention",
                    "axis_id": axis.axis_id,
                    "reason": getattr(exc, "reason_code", type(exc).__name__),
                }
            )
            continue
        variant_output = run_oracle(variant_world, decision, EvidenceView.from_world(variant_world))
        effect = evaluate_intervention_effect(base_output, variant_output)
        episode = assemble_episode(
            world=variant_world,
            spec=spec,
            family_id=family_id,
            variant_type="critical_intervention",
            action=decision,
            timeline=timeline,
            observation=render(
                variant_world,
                decision,
                renderer=renderer_name,
                seed=resolved_seed,
                allowlist=resolved_allowlist,
                style=style,
                timeline=timeline,
            ),
            intervention=with_actual_effect(intervention, effect),
            current_event=_decision_event(timeline, spec),
            variant_key=axis.axis_id,
        )
        variants.append(episode)
        diffs[episode.episode_id] = diff_worlds(world, variant_world)

    # ---- 无关扰动：世界零变化，观测变 ---------------- #
    for axis in spec.irrelevant_state_variables[: cfg.variant_count("irrelevant_perturbation")]:
        try:
            perturbed = irrelevant_perturbation(
                world, base_observation, axis=axis, seed=derive_seed(resolved_seed, "irrelevant", axis)
            )
        except PerturbationError as exc:
            skipped.append({"variant": "irrelevant_perturbation", "axis": axis, "reason": exc.reason_code})
            continue
        change = axis_change(axis, base_observation.surface or {}, perturbed.surface or {})
        # 同一 (world, action, view) 的 oracle 输出确定性相同 ⇒ 实际效应可先算后装配。
        effect = evaluate_intervention_effect(base_output, run_oracle(world, decision, EvidenceView.from_world(world)))
        intervention = Intervention(
            intervention_variable=axis,
            before=change.before,
            after=change.after,
            expected_effect=IRRELEVANT_PERTURBATION_EFFECT,
            actual_effect=effect,
        )
        episode = assemble_episode(
            world=world,
            spec=spec,
            family_id=family_id,
            variant_type="irrelevant_perturbation",
            action=decision,
            timeline=timeline,
            observation=perturbed,
            intervention=intervention,
            current_event=_decision_event(timeline, spec),
            variant_key=axis,
        )
        variants.append(episode)
        diffs[episode.episode_id] = diff_worlds(world, world)

    # ---- 证据掩蔽：世界与请求不变，只有可见性变 ---------------- #
    view = EvidenceView.from_world(world)
    for level in cfg.masked_levels()[: cfg.variant_count("evidence_masked")]:
        try:
            masked = mask_evidence(
                view,
                level=level,
                seed=derive_seed(resolved_seed, "mask", level),
                consulted_facts=consulted,
                world=world,
                action=decision,
            )
        except Exception as exc:  # MaskingError 及其 reason code 原样记录
            skipped.append(
                {"variant": "evidence_masked", "level": level, "reason": getattr(exc, "reason_code", type(exc).__name__)}
            )
            continue
        episode = assemble_episode(
            world=world,
            spec=spec,
            family_id=family_id,
            variant_type="evidence_masked",
            action=decision,
            timeline=timeline,
            observation=render(
                world,
                decision,
                renderer=renderer_name,
                seed=resolved_seed,
                allowlist=resolved_allowlist,
                style=style,
                evidence_view=masked,
                timeline=timeline,
            ),
            evidence_view=masked,
            current_event=_decision_event(timeline, spec),
            variant_key=level,
        )
        variants.append(episode)
        diffs[episode.episode_id] = diff_worlds(world, world)

    return ExpansionResult(
        family_id=family_id,
        variants=tuple(variants),
        diffs=diffs,
        world=world,
        skipped=tuple(skipped),
    )


# --------------------------------------------------------------------------- #
# spec → action / timeline
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class _AxisReaders:
    """in-scope policy / invariant 的读者集合（P0-4 的读者预检原料）。

    ``paths`` 是直接写死的 ID 视图引用（作者点名了具体实体）；``shapes`` 是
    ``<实体类型>.<字段路径>`` 形状键（实体 id 被抽象掉）——action 视图引用读的是
    "本动作绑定的那个实体"，轴上挂在哪个 id 上不影响"这条规则读不读这个字段"。
    """

    paths: frozenset[str] = frozenset()
    shapes: frozenset[str] = frozenset()


def _path_shape(path: str, world: WorldInstance) -> str | None:
    """ID 视图路径的形状键（``resource.RES-001.owner`` → ``resource.owner``）。"""
    from ..policy import split_entity_path

    try:
        entity_type, _entity_id, fields = split_entity_path(path, world)
    except Exception:  # noqa: BLE001 - 非实体路径 / 悬空引用 ⇒ 无形状
        return None
    if not fields:
        return None
    return f"{entity_type}.{'.'.join(fields)}"


def _lineage_nested_refs(expr: Any) -> set[str]:
    """被 ``lineage_root`` / ``lineage_depth`` 直接包住的 ref 路径。

    血缘 op 读的是**父链**（``_token_chain`` 沿 ``parent_token`` 上溯），不是被引
    字段本身：``lineage_depth(action.token.flow_id)`` 改 ``token.X.parent_token``
    就会翻转。因此读者预检必须把父链字段也算进读者集合，否则 HC-008 / HC-020 这种
    血缘世界的关键轴会被误判成"无读者"。
    """
    from ..policy import LINEAGE_OPS, REF_OP

    found: set[str] = set()

    def walk(node: Any) -> None:
        if getattr(node, "op", None) in LINEAGE_OPS:
            for arg in getattr(node, "args", ()) or ():
                if getattr(arg, "op", None) == REF_OP and getattr(arg, "path", None):
                    found.add(str(arg.path))
            return
        for arg in getattr(node, "args", ()) or ():
            walk(arg)

    walk(expr)
    return found


def _axis_reader_keys(world: WorldInstance, action: Action) -> _AxisReaders:
    """in-scope policy / invariant 实际会读到的路径与形状（P0-4 的读者预检）。

    **读者** = 一条其 ``action_pattern`` 匹配本动作的 policy 条件，或一条
    ``applies_to`` 覆盖本动作 operation 的 invariant expr（``"*"`` 或显式列出）。
    oracle 的世界判决只由策略与不变量驱动，因此"没有读者的轴"改不动任何判决。

    血缘 op（``lineage_root`` / ``lineage_depth``）额外贡献被包住 token 的
    ``parent_token`` 路径与 ``token.parent_token`` 形状——它们读父链，不读被引字段。
    """
    from ..model.refs import is_id_view
    from ..policy import parse_expr, split_entity_path, static_refs

    refs: set[str] = set()
    lineage_refs: set[str] = set()
    try:
        resource_type = action.resource_type(world)
    except RefResolutionError:
        resource_type = None
    for policy in world.policies:
        if not policy.action.matches(action.operation, resource_type):
            continue
        try:
            expr = parse_expr(policy.condition)
            refs.update(static_refs(expr))
            lineage_refs.update(_lineage_nested_refs(expr))
        except Exception:  # noqa: BLE001 - 不可解析条件由 G3 拒收，读者集合忽略它
            continue
    for invariant in world.invariants:
        applies = tuple(invariant.applies_to or ())
        if applies and "*" not in applies and action.operation not in applies:
            continue
        try:
            expr = parse_expr(invariant.expr)
            refs.update(static_refs(expr))
            lineage_refs.update(_lineage_nested_refs(expr))
        except Exception:  # noqa: BLE001 - 同上
            continue

    paths: set[str] = set()
    shapes: set[str] = set()

    def _add(path: str) -> None:
        shape = _path_shape(path, world)
        if shape:
            shapes.add(shape)

    for ref in sorted(refs):
        if is_id_view(ref):
            paths.add(ref)
            _add(ref)
            continue
        expanded = world.try_expand_action_view(ref, action)
        if expanded:
            _add(expanded)
    for ref in sorted(lineage_refs):
        candidate = ref
        if not is_id_view(candidate):
            candidate = world.try_expand_action_view(ref, action) or ""
        if not candidate:
            continue
        try:
            entity_type, entity_id, _fields = split_entity_path(candidate, world)
        except Exception:  # noqa: BLE001 - 非实体路径 ⇒ 无父链可读
            continue
        if entity_type != "token":
            continue
        parent_path = f"token.{entity_id}.parent_token"
        paths.add(parent_path)
        _add(parent_path)
    return _AxisReaders(paths=frozenset(paths), shapes=frozenset(shapes))


def _axis_has_reader(variable: str, readers: _AxisReaders, world: WorldInstance) -> bool:
    """该轴是否被至少一条 in-scope policy/invariant 读取。

    三种匹配：精确路径相等、互为前后缀（读者读轴的子字段 / 轴是读者路径的父对象）、
    形状键相等或互为前后缀。形状匹配让"策略读 ``action.resource.owner``"覆盖轴上
    任意资源——否则合法动作家族绑了别的实体就会被误判成无读者。
    """
    if variable in readers.paths:
        return True
    for path in readers.paths:
        if path.startswith(f"{variable}.") or variable.startswith(f"{path}."):
            return True
    shape = _path_shape(variable, world)
    if shape is None:
        return False
    if shape in readers.shapes:
        return True
    for candidate in readers.shapes:
        if candidate.startswith(f"{shape}.") or shape.startswith(f"{candidate}."):
            return True
    return False


def _decision_template(spec: WorldSpec) -> Any:
    if not spec.episode_templates:
        raise EpisodeAssemblyError(
            "spec_without_episode_templates", "spec 没有 episode_templates，无法派生决策事件"
        )
    template = spec.episode_templates[0]
    if not 0 <= template.decision_event_index < len(template.events):
        raise EpisodeAssemblyError(
            "decision_event_index_out_of_range",
            f"decision_event_index={template.decision_event_index} 越界（events={len(template.events)}）",
        )
    return template


def _decision_event(timeline: tuple[Event, ...], spec: WorldSpec) -> Event | None:
    """spec 声明的决策事件（``current_event``）；模板缺失时退化为末事件。"""
    if spec.episode_templates:
        index = spec.episode_templates[0].decision_event_index
        if 0 <= index < len(timeline):
            return timeline[index]
    return timeline[-1] if timeline else None


def _action_from_spec(spec: WorldSpec, world: WorldInstance) -> Action:
    template = _decision_template(spec)
    event = template.events[template.decision_event_index]
    binds = dict(event.binds or {})
    operation = binds.get("operation")
    if not isinstance(operation, str) or not operation:
        raise EpisodeAssemblyError(
            "decision_event_without_operation",
            "决策事件的 binds 必须声明 operation（action.schema.json 的 operation 必填）",
        )
    flow_id = binds.get("flow_id") or f"FLOW-{operation}"
    document: dict[str, Any] = {
        "action_id": "ACTN-" + stable_hash([spec.world_id, template.template_id, template.decision_event_index])[:12],
        "operation": operation,
        "actor": event.actor_id,
        "flow_id": flow_id,
        "at": spec.current_state.at,
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


def _timeline_from_spec(spec: WorldSpec, world: WorldInstance, action: Action) -> tuple[Event, ...]:
    template = _decision_template(spec)
    offsets = [event.t_offset_ms for event in template.events]
    latest = max(offsets)
    endpoint = _endpoint_for(world, action)
    events: list[Event] = []
    for index, event in enumerate(template.events):
        moment = parse_instant(action.at) - timedelta(milliseconds=latest - event.t_offset_ms)
        document: dict[str, Any] = {
            "event_id": f"EVT-{index:03d}",
            "t_index": index,
            "at": format_instant(moment),
            "event_type": event.event_type,
            "actor_id": event.actor_id,
        }
        if event.summary:
            document["summary"] = event.summary
        if event.emits_evidence:
            document["emitted_evidence"] = list(event.emits_evidence)
        if event.causal_tag:
            document["causal_tag"] = event.causal_tag
        if index == template.decision_event_index and endpoint is not None:
            document["endpoint"] = {"method": endpoint.method, "path": _rendered_endpoint_path(endpoint, action)}
            document["outcome"] = "unknown"
        events.append(Event.from_document(document))
    return tuple(events)


def _endpoint_for(world: WorldInstance, action: Action) -> Endpoint | None:
    candidates = [ep for ep in world.application.endpoints if ep.operation == action.operation]
    if not candidates:
        return None
    if action.resource is not None:
        try:
            resource_type = action.resource_type(world)
        except RefResolutionError:
            resource_type = None
        for endpoint in candidates:
            if endpoint.resource_type == resource_type:
                return endpoint
    return candidates[0]


def _rendered_endpoint_path(endpoint: Endpoint, action: Action) -> str:
    path = endpoint.path
    if action.resource is not None:
        path = re.sub(r"\{[^{}]+\}", action.resource, path)
    return path


__all__ = [
    "DECISION_METADATA_EXTRA_KEYS",
    "GENERATOR_PROVENANCE_KEYS",
    "PIPELINE_VERSION",
    "ExpansionResult",
    "assemble_episode",
    "expand_family",
    "instantiate",
]
