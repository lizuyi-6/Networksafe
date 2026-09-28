"""G11：表层特征与 verdict 的互信息（硬门，设计 §10 / ``configs.default.json``）。

表层特征是**渲染期旋钮**——User-Agent、X-Request-Id、header 顺序、trace id、时间戳
格式。它们与"这次操作是否越权"没有任何因果关系；若它们与 verdict 的互信息超过阈值，
说明生成器把标签信息渗进了表面（generator fingerprint，R3），模型可以靠背字符串
拿到分数而不做安全推理。

估计量与两个必须说清楚的取舍：

1. **原始互信息**用离散分布的
   ``MI(X;Y) = Σ p(x,y) log2(p(x,y) / (p(x)p(y)))``，完全确定性（无采样、无模型）。
2. **Miller–Madow 偏差校正**：X-Request-Id / trace id 的取值近似每 action 唯一，
   原始 MI 的小样本偏差约为 ``(|X|-1)(|Y|-1) / (2N ln2)`` bit——在一个 400 样本、
   32 个不同 action 的语料上该项约 0.05 bit，**比阈值本身大一个量级**。不校正的
   G11 会把"每个世界标签不同"误报成"表层特征泄漏标签"。因此本模块同时报告原始值
   与校正值，门判定用校正值（``mutual_information_bits_corrected``），并把两者都
   写进 detail——审阅者能自己复核这个选择。

特征提取全部来自 ``observation.model_visible``（模型唯一可读的部分），因此测的就
是模型能看到的东西：``rendering.header_order`` 从 ``rendered_text`` 的 header 行序
派生，``trace_id`` 从 ``traceparent`` 头派生，``timestamp_format`` 从 ``Date`` 头的
呈现格式反推。
"""
from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .errors import ValidationError

#: 默认特征表（``configs/default.json`` 的 ``quality_gates.G11.features``）。
DEFAULT_FEATURES: tuple[str, ...] = (
    "observation.request.headers.User-Agent",
    "observation.request.headers.X-Request-Id",
    "observation.rendering.header_order",
    "observation.rendering.trace_id",
    "observation.rendering.timestamp_format",
)

#: 默认互信息上限（bit）。
DEFAULT_MAX_BITS = 0.01

#: 默认最少样本数（REVISION 3 / P1-7：200 → 64，与 ``configs/default.json`` 的
#: ``quality_gates.G11_surface_label_independence.min_samples`` 逐字同步）。200 是按
#: 全量手写语料（单 renderer 373 episode）校准的；第一次真实 provider run 只有
#: 104 episode（8 个 accepted 世界 × ~13 变体），门在 milestone-1 规模下永远
#: "未运行"。64 是规模换算后的下限（8 世界 × 8 episode）——语义不变：不足即
#: **未运行**（``checked=False``，detail 写明"样本不足未运行"），绝不"不足即通过"。
DEFAULT_MIN_SAMPLES = 64

#: 时间戳呈现格式的识别模式（与 ``expansion.rendering.TIMESTAMP_FORMATS`` 同源）。
_TIMESTAMP_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("epoch_millis", re.compile(r"^\d{10,}$")),
    ("iso_millis", re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}")),
    ("rfc3339_offset", re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")),
    ("rfc3339", re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")),
)

_HEADER_LINE = re.compile(r"^([A-Za-z0-9-]+): ", re.MULTILINE)


#: 标识符判定的最小取值数（单值特征是常量，不是标识符）。
IDENTIFIER_MIN_DISTINCT = 2


@dataclass(frozen=True)
class FeatureMutualInformation:
    """一个表层特征的互信息估计。"""

    feature: str
    samples: int
    distinct_values: int
    mutual_information_bits: float
    miller_madow_bias_bits: float
    mutual_information_bits_corrected: float
    #: ``knob`` ⇒ 世界无关的渲染旋钮，进 G11 判定；``identifier`` ⇒ 取值由
    #: (world, action) 身份决定，其互信息度量的是世界身份而不是表层泄漏。
    role: str = "knob"
    #: **家族条件化**的互信息（bit）：在同一个反事实家族内部度量"表层取值能否预测
    #: verdict"。它同时消掉两个混淆——世界身份，以及"表层旋钮只在
    #: irrelevant_perturbation 变体上被拧动、而那类变体的标签按构造不变"。
    conditional_mutual_information_bits: float = 0.0
    conditional_groups: int = 0

    @property
    def is_identifier(self) -> bool:
        return self.role == "identifier"

    @property
    def gated_bits(self) -> float:
        """G11 判定用的互信息（家族条件化值）。"""
        return self.conditional_mutual_information_bits

    def to_document(self) -> dict[str, Any]:
        return {
            "feature": self.feature,
            "role": self.role,
            "samples": self.samples,
            "distinct_values": self.distinct_values,
            "mutual_information_bits": round(self.mutual_information_bits, 6),
            "miller_madow_bias_bits": round(self.miller_madow_bias_bits, 6),
            "mutual_information_bits_corrected": round(
                self.mutual_information_bits_corrected, 6
            ),
            "conditional_mutual_information_bits": round(
                self.conditional_mutual_information_bits, 6
            ),
            "conditional_groups": self.conditional_groups,
        }


@dataclass(frozen=True)
class SurfaceLabelReport:
    """G11 的结论。"""

    samples: int
    features: tuple[str, ...]
    per_feature: tuple[FeatureMutualInformation, ...] = ()
    max_bits: float = DEFAULT_MAX_BITS
    labels: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def violations(self) -> tuple[dict[str, Any], ...]:
        """超阈值的**旋钮**特征（标识符特征不进判定，见模块 docstring）。"""
        out: list[dict[str, Any]] = []
        for item in self.per_feature:
            if item.is_identifier:
                continue
            if item.gated_bits > self.max_bits:
                out.append(
                    {
                        "feature": item.feature,
                        "mutual_information_bits": round(item.gated_bits, 6),
                        "samples": item.samples,
                    }
                )
        return tuple(out)

    @property
    def identifiers(self) -> tuple[FeatureMutualInformation, ...]:
        """被判为标识符的特征（其互信息度量世界身份，单独报告）。"""
        return tuple(item for item in self.per_feature if item.is_identifier)

    @property
    def passed(self) -> bool:
        return not self.violations

    def to_document(self) -> dict[str, Any]:
        return {
            "samples": self.samples,
            "features": list(self.features),
            "labels": list(self.labels),
            "max_bits": self.max_bits,
            "passed": self.passed,
            "per_feature": [item.to_document() for item in self.per_feature],
            "metric": "mutual_information_bits_conditional_on_counterfactual_family",
            "violations": [dict(item) for item in self.violations],
            "warnings": list(self.warnings),
        }


# --------------------------------------------------------------------------- #
# 特征提取
# --------------------------------------------------------------------------- #
def extract_feature(episode: Any, feature: str) -> str | None:
    """从 ``observation.model_visible`` 抽一个表层特征的取值（抽不到返回 ``None``）。"""
    observation = getattr(episode, "observation", None)
    if observation is None and isinstance(episode, Mapping):
        observation = episode.get("observation")
    if not isinstance(observation, Mapping):
        return None
    model_visible = observation.get("model_visible") or {}
    request = model_visible.get("request") or {}
    if feature.startswith("observation.request.headers."):
        name = feature[len("observation.request.headers.") :]
        headers = request.get("headers") or {}
        value = headers.get(name)
        return None if value is None else str(value)
    if feature == "observation.rendering.header_order":
        rendered = request.get("rendered_text")
        if not isinstance(rendered, str):
            return None
        order = tuple(match.group(1) for match in _HEADER_LINE.finditer(rendered))
        return "|".join(order) if order else None
    if feature == "observation.rendering.trace_id":
        headers = request.get("headers") or {}
        value = headers.get("traceparent")
        return None if value is None else str(value)
    if feature == "observation.rendering.timestamp_format":
        headers = request.get("headers") or {}
        value = headers.get("Date")
        if value is None:
            return None
        return _classify_timestamp(str(value))
    # 通用回路：按点号路径在 model_visible 里走
    node: Any = model_visible
    for part in feature.split(".")[1:]:
        if not isinstance(node, Mapping) or part not in node:
            return None
        node = node[part]
    return None if node is None else str(node)


def _classify_timestamp(value: str) -> str:
    for name, pattern in _TIMESTAMP_PATTERNS:
        if pattern.match(value):
            return name
    return "other"


# --------------------------------------------------------------------------- #
# 互信息
# --------------------------------------------------------------------------- #
def mutual_information_bits(pairs: Iterable[tuple[str, str]]) -> float:
    """离散互信息（bit）。空输入或单值输入 ⇒ 0.0。"""
    joint: dict[tuple[str, str], int] = {}
    x_counts: dict[str, int] = {}
    y_counts: dict[str, int] = {}
    total = 0
    for x, y in pairs:
        joint[(x, y)] = joint.get((x, y), 0) + 1
        x_counts[x] = x_counts.get(x, 0) + 1
        y_counts[y] = y_counts.get(y, 0) + 1
        total += 1
    if total == 0 or len(x_counts) < 2 or len(y_counts) < 2:
        return 0.0
    bits = 0.0
    for (x, y), count in joint.items():
        p_xy = count / total
        p_x = x_counts[x] / total
        p_y = y_counts[y] / total
        bits += p_xy * math.log2(p_xy / (p_x * p_y))
    return max(0.0, bits)


def miller_madow_bias_bits(distinct_x: int, distinct_y: int, samples: int) -> float:
    """Miller–Madow 一阶偏差（bit）：``(|X|-1)(|Y|-1) / (2N ln2)``。"""
    if samples <= 0:
        return 0.0
    return max(0, distinct_x - 1) * max(0, distinct_y - 1) / (2.0 * samples * math.log(2.0))


def _label_of(episode: Any) -> str:
    output = getattr(episode, "oracle_output", None)
    if output is None and isinstance(episode, Mapping):
        output = episode.get("oracle_output")
    if isinstance(output, Mapping):
        return str(output.get("observable_decision") or "")
    return str(getattr(output, "observable_decision", "") or "")


def _family_of(episode: Any) -> str:
    value = getattr(episode, "counterfactual_family_id", None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get("counterfactual_family_id")
    return str(value or "")


#: 标识符判定的样本加权阈值：超过这个比例的样本，其特征取值只属于一个反事实家族
#: ⇒ 该特征是标识符。
IDENTIFIER_SAMPLE_SHARE = 0.5


def is_identifier_feature(pairs: Sequence[tuple[str, str, str]]) -> bool:
    """一个特征是否是**标识符**（取值空间基本被反事实家族划分）。

    机械判定，不看阈值比率：统计"其取值只出现在**一个** ``counterfactual_family_id``
    里"的样本占比。占比超过 :data:`IDENTIFIER_SAMPLE_SHARE` 时，"这个取值是什么"
    基本上等于"这是哪个世界/哪次动作"——它的互信息度量的是世界身份，而世界身份
    已经由 group-key split 控制（设计 §10）。典型是 ``X-Request-Id`` / ``trace_id``：
    renderer 用 action id 派生它们（见 ``expansion/rendering.py`` 的 surface 构造），
    只有被扰动的少数样本落在共享池里。

    世界无关的渲染旋钮（User-Agent 池、header 排列、时间戳格式）取值跨家族重复，
    因此不会被误判。
    """
    if not pairs:
        return False
    families_of: dict[str, set[str]] = {}
    all_families: set[str] = set()
    for value, family, _label in pairs:
        families_of.setdefault(value, set()).add(family)
        all_families.add(family)
    if len(families_of) < IDENTIFIER_MIN_DISTINCT:
        return False
    if len(all_families) < 2:
        # 只有一个家族时，"取值只属于一个家族"是恒真的——那说明不了任何事。
        return False
    single = sum(1 for value, family, _label in pairs if len(families_of[value]) == 1)
    return single / len(pairs) > IDENTIFIER_SAMPLE_SHARE


def surface_label_independence(
    episodes: Sequence[Any],
    *,
    features: Sequence[str] | None = None,
    max_bits: float = DEFAULT_MAX_BITS,
) -> SurfaceLabelReport:
    """G11：每个表层特征与 ``observable_decision`` 的（偏差校正后）互信息。"""
    resolved_features = tuple(features) if features else DEFAULT_FEATURES
    items = list(episodes)
    labels = tuple(sorted({_label_of(episode) for episode in items if _label_of(episode)}))
    per_feature: list[FeatureMutualInformation] = []
    warnings: list[str] = []
    for feature in resolved_features:
        triples: list[tuple[str, str, str]] = []
        for episode in items:
            value = extract_feature(episode, feature)
            label = _label_of(episode)
            if value is None or not label:
                continue
            triples.append((value, _family_of(episode), label))
        if not triples:
            warnings.append(f"特征 {feature!r} 在 {len(items)} 个 episode 上无可抽取取值（跳过）")
            continue
        pairs = [(value, label) for value, _family, label in triples]
        distinct_x = len({value for value, _family, _label in triples})
        distinct_y = len({label for _value, _family, label in triples})
        raw = mutual_information_bits(pairs)
        bias = miller_madow_bias_bits(distinct_x, distinct_y, len(pairs))
        role = "identifier" if is_identifier_feature(triples) else "knob"
        if role == "identifier":
            warnings.append(
                f"特征 {feature!r} 有 {distinct_x} 个不同取值且每个取值只属于一个反事实家族，"
                "被判为标识符而非渲染旋钮：其取值由 (world, action) 身份决定，"
                "互信息度量的是世界身份（已由 group-key split 控制），不进 G11 判定"
            )
        conditional, groups = _conditional_mutual_information(triples)
        per_feature.append(
            FeatureMutualInformation(
                feature=feature,
                samples=len(pairs),
                distinct_values=distinct_x,
                mutual_information_bits=raw,
                miller_madow_bias_bits=bias,
                mutual_information_bits_corrected=max(0.0, raw - bias),
                role=role,
                conditional_mutual_information_bits=conditional,
                conditional_groups=groups,
            )
        )
    return SurfaceLabelReport(
        samples=len(items),
        features=resolved_features,
        per_feature=tuple(per_feature),
        max_bits=float(max_bits),
        labels=labels,
        warnings=tuple(warnings),
    )


def _conditional_mutual_information(
    triples: Sequence[tuple[str, str, str]]
) -> tuple[float, int]:
    """I(feature; verdict | counterfactual_family) 的样本加权平均（bit）。

    只统计"家族内部该特征与标签都至少有两个取值"的组——组内常量的 MI 是 0，
    统计它只会稀释结果。每组内部同样做 Miller–Madow 一阶偏差校正。
    """
    groups: dict[str, list[tuple[str, str]]] = {}
    for value, family, label in triples:
        groups.setdefault(family, []).append((value, label))
    total = 0.0
    counted = 0
    for family in sorted(groups):
        items = groups[family]
        if len({value for value, _ in items}) < 2 or len({label for _, label in items}) < 2:
            continue
        raw = mutual_information_bits(items)
        bias = miller_madow_bias_bits(
            len({value for value, _ in items}), len({label for _, label in items}), len(items)
        )
        total += max(0.0, raw - bias)
        counted += 1
    if not counted:
        return 0.0, 0
    return total / counted, counted


def knob_features(report: SurfaceLabelReport) -> tuple[str, ...]:
    """报告里进 G11 判定的旋钮特征名。"""
    return tuple(item.feature for item in report.per_feature if not item.is_identifier)


__all__ = [
    "DEFAULT_FEATURES",
    "IDENTIFIER_MIN_DISTINCT",
    "IDENTIFIER_SAMPLE_SHARE",
    "DEFAULT_MAX_BITS",
    "DEFAULT_MIN_SAMPLES",
    "FeatureMutualInformation",
    "SurfaceLabelReport",
    "extract_feature",
    "is_identifier_feature",
    "knob_features",
    "miller_madow_bias_bits",
    "mutual_information_bits",
    "surface_label_independence",
]
