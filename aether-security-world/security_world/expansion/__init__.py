"""L4 展开层：反事实、扰动、掩蔽、渲染与 episode 组装（设计 §15.3 Agent D）。

公共契约（设计 §15.3 的 L4 部分 + 本任务落地的全部符号）::

    ExpansionConfig
    WorldDiff / diff_worlds
    Intervention / critical_intervention / evaluate_intervention_effect
    irrelevant_perturbation / SUPPORTED_AXES
    mask_evidence / classify_evidence_level / consulted_facts_from_output / MASKING_LEVELS
    Observation / render / rerender / RENDERERS / RENDER_STYLES
    assemble_episode / expand_family / ExpansionResult / instantiate
    ExpansionError / InterventionError / PerturbationError / MaskingError / RenderError /
    EpisodeAssemblyError

四条能力与它们的**可证伪断言**（逐条有测试）：

* **causal sensitivity** —— ``critical_intervention`` 只改一个 ID 视图状态路径，
  ``diff_worlds(base, variant).changed_paths == (intervention_variable,)``，且
  verdict 必须按 spec 的先验预期翻转（R4：预期先验声明，不符即拒，不改标签）。
* **irrelevant invariance** —— ``irrelevant_perturbation`` 只改 ``observation.*``
  表面，``diff_worlds().is_empty()``，verdict 逐字节不变（metamorphic 测试证明）。
* **abstention** —— ``mask_evidence`` 把 consulted 事实的 establishing 证据藏掉 ⇒
  ``observable_decision == "insufficient_evidence"`` 且 ``missing_evidence`` 指明
  缺哪一个（Gate 7 可证明）。
* **renderer 是单向投影** —— 8 种 renderer × REST/GraphQL/RPC 三风格只改观测表面，
  同一 action 的安全语义不变（D2）。

分层纪律：本包 import L1/L2/L3，**不** import L5/L6/L7；D → C（oracle）是唯一允许
的跨包调用方向。跨包只经包级公共 API（``from security_world.oracle import ...``），
禁止深导入。
"""
from __future__ import annotations

from .config import (
    DEFAULT_MASKING_LEVELS,
    DEFAULT_RENDERER,
    DEFAULT_RENDERERS,
    ExpansionConfig,
)
from .counterfactual import (
    CRITICAL_INTERVENTION_EFFECT,
    INTERVENTION_EFFECTS,
    Intervention,
    critical_intervention,
    effect_matches,
    evaluate_intervention_effect,
    with_actual_effect,
)
from .diff import WorldDiff, diff_worlds
from .episode import (
    AXIS_SKIPPED_NO_READER,
    GENERATOR_PROVENANCE_KEYS,
    PIPELINE_VERSION,
    ExpansionResult,
    assemble_episode,
    expand_family,
    instantiate,
)
from .errors import (
    EpisodeAssemblyError,
    ExpansionError,
    InterventionError,
    MaskingError,
    PerturbationError,
    RenderError,
)
from .masking import (
    MASKING_LEVELS,
    classify_evidence_level,
    consulted_facts_from_output,
    mask_evidence,
)
from .perturbation import (
    IRRELEVANT_AXIS_PATTERN,
    IRRELEVANT_PERTURBATION_EFFECT,
    SUPPORTED_AXES,
    Perturbation,
    axis_change,
    irrelevant_perturbation,
)
from .rendering import (
    EVIDENCE_OBSERVATION_KEYS,
    EVENT_OBSERVATION_KEYS,
    RENDERERS,
    RENDER_STYLES,
    TIMESTAMP_FORMATS,
    Observation,
    format_timestamp,
    project_event,
    project_evidence,
    projection_guard,
    render,
    rendered_text,
    rerender,
)

__all__ = [
    # critical 轴读者预检
    "AXIS_SKIPPED_NO_READER",
    # 配置
    "ExpansionConfig",
    "DEFAULT_RENDERERS",
    "DEFAULT_RENDERER",
    "DEFAULT_MASKING_LEVELS",
    # 世界 diff（D4）
    "WorldDiff",
    "diff_worlds",
    # 关键干预
    "Intervention",
    "INTERVENTION_EFFECTS",
    "CRITICAL_INTERVENTION_EFFECT",
    "critical_intervention",
    "evaluate_intervention_effect",
    "with_actual_effect",
    "effect_matches",
    # 无关扰动
    "Perturbation",
    "SUPPORTED_AXES",
    "IRRELEVANT_AXIS_PATTERN",
    "IRRELEVANT_PERTURBATION_EFFECT",
    "irrelevant_perturbation",
    "axis_change",
    # 证据掩蔽
    "MASKING_LEVELS",
    "mask_evidence",
    "classify_evidence_level",
    "consulted_facts_from_output",
    # 渲染
    "Observation",
    "RENDERERS",
    "RENDER_STYLES",
    "TIMESTAMP_FORMATS",
    "EVIDENCE_OBSERVATION_KEYS",
    "EVENT_OBSERVATION_KEYS",
    "render",
    "rerender",
    "rendered_text",
    "format_timestamp",
    "project_evidence",
    "project_event",
    "projection_guard",
    # 组装与家族展开
    "assemble_episode",
    "expand_family",
    "instantiate",
    "ExpansionResult",
    "PIPELINE_VERSION",
    "GENERATOR_PROVENANCE_KEYS",
    # 异常
    "ExpansionError",
    "InterventionError",
    "PerturbationError",
    "MaskingError",
    "RenderError",
    "EpisodeAssemblyError",
]
