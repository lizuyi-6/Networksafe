"""L5 质量门禁层：Gate 1–12、group-key split、三层去重、分布摘要（Agent E）。

REVISION 2：门禁从 G1–G11 增至 **G1–G12**——新增
:func:`security_world.validation.lexical.lexical_label_leakage` 驱动的
``G12_lexical_label_leakage``（模型可见侧的判决线索词审计，任务书 A1）。
group key 从 8 个增至 **12** 个（新增 generator_model_family / policy_family_id /
workflow_family_id / invariant_family_id；实现在 L1 ``security_world.model.grouping``，
本包只做兼容转发）。

公共契约（设计 §15.3 的 L5 部分）::

    GateResult / GateReport / GATES
    run_gates / run_dataset_gates
    SplitAssignment / STRATEGY_TO_GROUP_KEY / assign_splits / group_overlap_audit
    dedup / distribution_summary

分层纪律：本包 import L1/L2/L3/L4，**不** import L6 ``security_world.release``
（release 在它之上）。反向依赖由 ``tests/test_import_boundaries.py`` 静态断言。

**门禁的作用域分两级**（这是实现上的必要拆分，不是设计偏离）：

* :func:`run_gates` —— 单 episode（+ 可选家族上下文）。G10/G11 需要全集才能算，
  在这里记为 ``checked=False``：**没有运行的门不显示成绿色**。
* :func:`run_dataset_gates` —— 全数据集。逐 episode 跑 G1–G9，再加全局 G8/G9/G10/G11。

G11 的互信息用 Miller–Madow 偏差校正（见 :mod:`security_world.validation.surface`
的 docstring：不校正会把"每个世界标签不同"误报成"表层特征泄漏标签"）。
"""
from __future__ import annotations

from .dedup import (
    DEFAULT_SEMANTIC_THRESHOLD,
    REQUIRED_LAYERS,
    DedupReport,
    DuplicateRecord,
    dedup,
    exact_digest,
    jaccard,
    normalized_digest,
    semantic_duplicate_pairs,
    semantic_similarity,
    structural_digest,
)
from .distribution import (
    OBSERVABLE_DECISIONS,
    VARIANT_TYPES,
    WORLD_TRUTHS,
    distribution_summary,
    domain_coverage_floor,
    entropy_bits,
    label_entropy_floor,
)
from .errors import ValidationError
from .gates import (
    EPISODE_SCOPED_GATES,
    GATES,
    HARD_GATES,
    INSUFFICIENCY_REASONS,
    FamilyView,
    GateReport,
    GateResult,
    evidence_view_from_episode,
    family_view,
    gate_failures_by_gate,
    run_dataset_gates,
    run_gates,
)
from .grouping import (
    BENIGN_ATTACK_FAMILY,
    GROUP_KEYS,
    INVARIANT_CATEGORY_TO_ATTACK_FAMILIES,
    STRATEGY_TO_GROUP_KEY,
    app_domain_of,
    attack_family_of,
    derive_attack_family,
    episode_group_keys,
    generator_id,
    generator_model_family,
    invariant_family_id,
    policy_family_id,
    policy_graph_hash,
    semantic_scenario_signature,
    workflow_family_id,
    workflow_template_hash,
)
from .lexical import (
    SUSPICIOUS_MARKERS,
    LexicalLeakageReport,
    MarkerHit,
    iter_marker_hits,
    lexical_label_leakage,
    marker_pattern,
    markers_from_config,
    markers_in_text,
    scan_model_visible,
)
from .probe import (
    MAX_PROBE_WORLDS,
    MAX_VALUES_PER_REF,
    FamilyCoverage,
    FamilyReachabilityResult,
    PolicyProbeResult,
    ReachabilityResult,
    attack_family_reachability,
    declared_domain,
    family_reachability,
    probe_world_policies,
    unsupported_families,
)
from .split import (
    DEFAULT_MIN_GROUPS_PER_SPLIT,
    DEFAULT_RATIOS,
    SplitAssignment,
    assign_splits,
    audit_keys,
    group_overlap_audit,
)
from .surface import (
    DEFAULT_FEATURES,
    DEFAULT_MAX_BITS,
    DEFAULT_MIN_SAMPLES,
    FeatureMutualInformation,
    SurfaceLabelReport,
    extract_feature,
    miller_madow_bias_bits,
    mutual_information_bits,
    surface_label_independence,
)

__all__ = [
    # 门禁
    "GATES",
    "HARD_GATES",
    "EPISODE_SCOPED_GATES",
    "INSUFFICIENCY_REASONS",
    "GateResult",
    "GateReport",
    "FamilyView",
    "run_gates",
    "run_dataset_gates",
    "family_view",
    "evidence_view_from_episode",
    "gate_failures_by_gate",
    # group key
    "GROUP_KEYS",
    "STRATEGY_TO_GROUP_KEY",
    "BENIGN_ATTACK_FAMILY",
    "INVARIANT_CATEGORY_TO_ATTACK_FAMILIES",
    "episode_group_keys",
    "derive_attack_family",
    "attack_family_of",
    "policy_graph_hash",
    "workflow_template_hash",
    "semantic_scenario_signature",
    "app_domain_of",
    "generator_id",
    # split
    "SplitAssignment",
    "assign_splits",
    "audit_keys",
    "group_overlap_audit",
    "DEFAULT_RATIOS",
    "DEFAULT_MIN_GROUPS_PER_SPLIT",
    # 去重
    "dedup",
    "DedupReport",
    "DuplicateRecord",
    "REQUIRED_LAYERS",
    "DEFAULT_SEMANTIC_THRESHOLD",
    "exact_digest",
    "normalized_digest",
    "structural_digest",
    "semantic_similarity",
    "semantic_duplicate_pairs",
    "jaccard",
    # 分布
    "distribution_summary",
    "entropy_bits",
    "label_entropy_floor",
    "domain_coverage_floor",
    "OBSERVABLE_DECISIONS",
    "WORLD_TRUTHS",
    "VARIANT_TYPES",
    # G3 探针
    "probe_world_policies",
    "declared_domain",
    "PolicyProbeResult",
    "attack_family_reachability",
    "ReachabilityResult",
    "family_reachability",
    "FamilyCoverage",
    "FamilyReachabilityResult",
    "unsupported_families",
    "MAX_PROBE_WORLDS",
    "MAX_VALUES_PER_REF",
    # G11
    "surface_label_independence",
    "SurfaceLabelReport",
    "FeatureMutualInformation",
    "extract_feature",
    "mutual_information_bits",
    "miller_madow_bias_bits",
    "DEFAULT_FEATURES",
    "DEFAULT_MAX_BITS",
    "DEFAULT_MIN_SAMPLES",
    # 异常
    "ValidationError",
]
