"""Phase 2A 的**编译后验证器**（brief §35-§36：先验不是真值）。

Phase 1 的因果审计（``reports/phase2a/counterfactual-causal-audit.md``）结论：两个
``verdict_invariant_expected_but_flipped`` 全部是**生成器把决策相关事实标成了"判决
不变"**——它自己把该事实列进 ``critical_state_variables``，而作用域内的不变量确实读它。
处置不是改期望值让门变绿，而是让程序复核先验：

1. 编译骨架 → world-spec → WorldInstance；
2. 对每个 probe action 展开家族，取 base 与每个 critical_intervention 变体；
3. 用 Oracle 轨迹**推导**实际效应（``verdict_flip`` / ``verdict_invariant`` /
   ``observable_downgrade``）与语义分类（``violation_removed`` / ``violation_created`` /
   ``critical_flip`` / ``verdict_invariant``）；
4. 与骨架声明的 ``semantic_expectation`` 比对，矛盾即 :class:`ExpectationContradiction`。

因此 LLM 的 ``semantic_expectation`` 只是一个**可证伪的先验**：猜错 ⇒ 骨架被拒，
绝不把标签改成猜的那个值。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence

from analysis.pipeline import (
    _AXIS_TYPE_TO_BINDING,
    action_from_binds,
    axes_for_probe,
    family_view_for_action,
    spec_probes,
    spec_with_axes,
)
from security_world.expansion import expand_family
from security_world.expansion.config import ExpansionConfig
from security_world.model import WorldInstance, WorldSpec
from security_world.model.compile import compile_spec
from security_world.model.config import load_default_config

#: 骨架的 semantic_expectation → 允许的实际效应集合。
#: ``verdict_invariant`` 的先验只有在实际也是不变时才成立；其余先验要求实际翻转。
_EXPECTATION_ALLOWS: Mapping[str, frozenset[str]] = {
    "violation_removed": frozenset({"verdict_flip"}),
    "violation_created": frozenset({"verdict_flip"}),
    "verdict_flip": frozenset({"verdict_flip"}),
    "verdict_invariant": frozenset({"verdict_invariant"}),
    "observable_downgrade": frozenset({"observable_downgrade", "verdict_flip"}),
}

#: brief §35 的最终分类词表。
SEMANTIC_CLASSES: tuple[str, ...] = (
    "critical_flip", "violation_removed", "violation_created",
    "verdict_invariant", "evidence_mask",
)


@dataclass
class AxisOutcome:
    """一条关键轴的复核结果。"""

    axis_id: str
    variable: str
    declared_expectation: str
    declared_effect: str
    actual_effect: str
    semantic_class: str
    base_world_truth: str
    variant_world_truth: str
    base_observable: str
    variant_observable: str
    changed_paths: tuple[str, ...]
    base_violated: tuple[str, ...]
    variant_violated: tuple[str, ...]
    contradicted: bool

    def to_document(self) -> dict[str, Any]:
        return {
            "axis_id": self.axis_id,
            "variable": self.variable,
            "declared_expectation": self.declared_expectation,
            "declared_effect": self.declared_effect,
            "actual_effect": self.actual_effect,
            "semantic_class": self.semantic_class,
            "base_world_truth": self.base_world_truth,
            "variant_world_truth": self.variant_world_truth,
            "base_observable": self.base_observable,
            "variant_observable": self.variant_observable,
            "changed_paths": list(self.changed_paths),
            "base_violated": list(self.base_violated),
            "variant_violated": list(self.variant_violated),
            "contradicted": self.contradicted,
        }


@dataclass
class VerificationReport:
    """一个骨架的编译后验证结果。"""

    world_id: str
    mechanism_family: str
    attack_family: str
    compiled: bool = False
    stage: str = "verify"
    error_code: str | None = None
    error_detail: str = ""
    probes: int = 0
    episodes: int = 0
    base_labels: tuple[str, ...] = ()
    outcomes: list[AxisOutcome] = field(default_factory=list)
    unsupported_invariants: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.compiled and not self.contradictions

    @property
    def contradictions(self) -> list[AxisOutcome]:
        return [item for item in self.outcomes if item.contradicted]

    def to_document(self) -> dict[str, Any]:
        return {
            "world_id": self.world_id,
            "mechanism_family": self.mechanism_family,
            "attack_family": self.attack_family,
            "compiled": self.compiled,
            "stage": self.stage,
            "error_code": self.error_code,
            "error_detail": self.error_detail,
            "probes": self.probes,
            "episodes": self.episodes,
            "base_labels": list(self.base_labels),
            "outcomes": [item.to_document() for item in self.outcomes],
            "unsupported_invariants": list(self.unsupported_invariants),
        }


class ExpectationContradiction(ValueError):
    """骨架声明的 ``semantic_expectation`` 与 Oracle 轨迹矛盾（brief §35/§36）。"""

    def __init__(self, outcomes: Sequence[AxisOutcome]) -> None:
        self.outcomes = tuple(outcomes)
        detail = "; ".join(
            f"{item.axis_id}({item.variable}): 声明 {item.declared_expectation}，"
            f"实际 {item.actual_effect}/{item.semantic_class}"
            for item in self.outcomes
        )
        super().__init__(detail)


def _trace(episode: Any) -> dict[str, Any]:
    output = episode.oracle_output
    document = output.to_document() if hasattr(output, "to_document") else dict(output)
    satisfied: list[str] = []
    violated: list[str] = []
    for step in document.get("decision_trace") or ():
        if not isinstance(step, Mapping):
            continue
        rule = str(step.get("rule"))
        if rule == "invariant.evaluate":
            invariant_id = str((step.get("operands") or {}).get("invariant_id") or "?")
            if step.get("result") == "violated":
                violated.append(invariant_id)
            elif step.get("result") == "satisfied":
                satisfied.append(invariant_id)
    return {
        "world_truth": document.get("world_truth"),
        "observable_decision": document.get("observable_decision"),
        "violated": tuple(sorted(violated)),
        "satisfied": tuple(sorted(satisfied)),
    }


def _classify(base: Mapping[str, Any], variant: Mapping[str, Any]) -> tuple[str, str]:
    """从两条 Oracle 轨迹推导 (actual_effect, semantic_class)。"""
    truth_changed = base["world_truth"] != variant["world_truth"]
    observable_changed = base["observable_decision"] != variant["observable_decision"]
    gained = set(variant["violated"]) - set(base["violated"])
    lost = set(base["violated"]) - set(variant["violated"])

    if not truth_changed and not observable_changed:
        return "verdict_invariant", "verdict_invariant"
    if truth_changed:
        if lost and not gained:
            return "verdict_flip", "violation_removed"
        if gained and not lost:
            return "verdict_flip", "violation_created"
        return "verdict_flip", "critical_flip"
    return "observable_downgrade", "evidence_mask"


def verify_compiled_world(
    spec_document: Mapping[str, Any],
    *,
    skeleton: Mapping[str, Any] | None = None,
    plan: Any | None = None,
    config_path: Path | None = None,
    renderer: str = "http_request",
) -> VerificationReport:
    """编译 + 展开 + Oracle 复核一个已编译的 world-spec 文档。

    ``plan`` 是 :meth:`SemanticSkeletonCompiler.compile_with_plan` 的侧信道，用来把
    骨架声明的 ``semantic_expectation`` 对齐到编译后的 canonical 路径。缺省时按
    "未声明先验"处理（等价于先验缺失，绝不猜）。
    """
    document = json.loads(json.dumps(dict(spec_document)))
    report = VerificationReport(
        world_id=str(document.get("world_id") or "?"),
        mechanism_family=str((skeleton or {}).get("mechanism_family") or ""),
        attack_family=str(document.get("attack_family") or ""),
    )
    try:
        spec = WorldSpec.from_document(document)
        config = (
            load_default_config(config_path)
            if config_path is not None
            else load_default_config()
        )
        instance = compile_spec(spec, seed=int(document.get("seed") or 0), config=config)
    except Exception as exc:  # CompileError / ModelError
        report.compiled = False
        report.error_code = getattr(exc, "reason_code", "compile_error")
        report.error_detail = str(exc)[:500]
        return report
    report.compiled = True

    # ExpansionConfig 必须与 compile_config 同源：它自带一份 critical_axes_whitelist
    # 镜像，读的是 configs/default.json。Phase 2A 的租户轴只在 configs/phase2a.json
    # 里，若两边不同源，展开期会以 axis_not_in_whitelist 静默跳过租户轴。
    cfg = (
        ExpansionConfig.from_config(config)
        if config_path is not None
        else ExpansionConfig.default()
    )
    at = str(document["current_state"]["at"])
    declared = {
        str(axis.get("variable")): axis
        for axis in (document.get("hypotheses") or {}).get("expected_counterfactual_axes") or ()
        if str(axis.get("kind")) == "critical"
    }
    expectations = _expectations_by_path(skeleton or {}, plan)

    labels: set[str] = set()
    for _summary, binds in spec_probes(spec):
        action = action_from_binds(binds, action_id=f"ACTN-VERIFY-{report.probes}", at=at)
        report.probes += 1
        probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
        try:
            result = expand_family(
                probe_spec, seed=spec.seed, action=action, config=cfg, renderer=renderer,
                compile_config=config,
            )
            view = family_view_for_action(
                result, action, seed=spec.seed, spec=probe_spec
            )
        except Exception as exc:
            report.compiled = False
            report.stage = "expand"
            report.error_code = "expansion_error"
            report.error_detail = str(exc)[:500]
            return report
        report.episodes += len(view.variants)
        for episode in view.variants:
            if episode.variant_type == "base":
                labels.add(str(episode.oracle_output.observable_decision))
        # 只复核**本 probe 严格选中**的轴。``axes_for_probe`` 在"没有轴适用"时会退回
        # 全部轴（Phase 1 的单轴世界约定），那种 probe 上轴并非决定性条件——拿它的
        # verdict_invariant 去否证生成器，与 G5 的家族粒度判定不一致（G5：轴在别的
        # 家族上被证实过，本家族的不符记混合 base 形态，不拒收世界）。
        applicable = {
            str(axis.get("variable"))
            for axis in _strict_axes_for_probe(spec, binds)
        }
        for episode in view.variants:
            if episode.variant_type != "critical_intervention":
                continue
            variable = str((episode.intervention or {}).get("intervention_variable") or "")
            if applicable and variable not in applicable:
                continue
            axis = declared.get(variable, {})
            base_trace = _trace(view.base)
            variant_trace = _trace(episode)
            actual_effect, semantic_class = _classify(base_trace, variant_trace)
            declared_expectation = expectations.get(variable, "verdict_flip")
            allowed = _EXPECTATION_ALLOWS.get(declared_expectation)
            contradicted = allowed is not None and actual_effect not in allowed
            diff_key = episode.episode_id
            if diff_key not in view.diffs:
                for candidate in view.diffs:
                    if diff_key.startswith(candidate):
                        diff_key = candidate
                        break
            diff = view.diffs.get(diff_key)
            report.outcomes.append(AxisOutcome(
                axis_id=str(axis.get("axis_id") or "AXIS-?"),
                variable=variable,
                declared_expectation=declared_expectation,
                declared_effect=str(axis.get("expected_effect") or ""),
                actual_effect=actual_effect,
                semantic_class=semantic_class,
                base_world_truth=str(base_trace["world_truth"]),
                variant_world_truth=str(variant_trace["world_truth"]),
                base_observable=str(base_trace["observable_decision"]),
                variant_observable=str(variant_trace["observable_decision"]),
                changed_paths=tuple(getattr(diff, "changed_paths", ()) or ()),
                base_violated=base_trace["violated"],
                variant_violated=variant_trace["violated"],
                contradicted=bool(contradicted),
            ))
    report.base_labels = tuple(sorted(labels))
    if not report.outcomes:
        report.compiled = False
        report.stage = "counterfactual"
        report.error_code = "COUNTERFACTUAL_UNRESOLVABLE"
        report.error_detail = "展开没有产出任何 critical_intervention 变体"
        return report
    # 按轴聚合：一条轴只要在**任意一个**适用 probe 上被证实，它的先验就成立
    #（与 G5 的家族粒度判定同一语义）。全都不证实才算矛盾。
    confirmed: set[str] = set()
    for outcome in report.outcomes:
        allowed = _EXPECTATION_ALLOWS.get(outcome.declared_expectation)
        if allowed is not None and outcome.actual_effect in allowed:
            confirmed.add(outcome.variable)
    rebuilt: list[AxisOutcome] = []
    for outcome in report.outcomes:
        settled = outcome.variable in confirmed
        if settled == outcome.contradicted:
            rebuilt.append(AxisOutcome(**{**outcome.__dict__, "contradicted": not settled}))
        else:
            rebuilt.append(outcome)
    report.outcomes = rebuilt
    return report


def _strict_axes_for_probe(spec: Any, binds: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    """``axes_for_probe`` 的**不带回落**版本：只返回本 probe 真正选中的关键轴。

    回落（``tuple(selected) or axes``）是 Phase 1 为"单轴世界对所有 probe 生效"设的；
    多轴世界里它会把不适用的轴也摊到每个 probe 上，复核时就会拿一个非决定性的
    verdict_invariant 去否证生成器。
    """
    document = spec.to_document() if hasattr(spec, "to_document") else dict(spec)
    axes = tuple(
        axis
        for axis in (document.get("hypotheses") or {}).get("expected_counterfactual_axes") or ()
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
    return tuple(selected)


def _expectations_by_path(
    skeleton: Mapping[str, Any], plan: Any | None
) -> dict[str, str]:
    """骨架的 ``counterfactuals[].target_fact`` → 编译后的 canonical 路径 → 先验。

    对齐完全靠 :class:`WorldPlan` 的 ``fact_paths``（编译器自己的绑定结果），**不解析
    任何文本**。没有 plan（或事实没被绑定）时返回空——调用方按"未声明"处理，绝不猜。
    """
    if plan is None:
        return {}
    fact_paths = getattr(plan, "fact_paths", {}) or {}
    by_path = {path: name for name, path in fact_paths.items() if path}
    out: dict[str, str] = {}
    for item in skeleton.get("counterfactuals") or ():
        if not isinstance(item, Mapping):
            continue
        fact_name = str(item.get("target_fact") or "")
        expectation = str(item.get("semantic_expectation") or "")
        path = fact_paths.get(fact_name)
        if path and by_path.get(path) == fact_name:
            out[path] = expectation
    return out


__all__ = [
    "SEMANTIC_CLASSES",
    "AxisOutcome",
    "ExpectationContradiction",
    "VerificationReport",
    "verify_compiled_world",
]
