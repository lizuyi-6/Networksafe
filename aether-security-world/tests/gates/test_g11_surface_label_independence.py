"""G11 表层特征 / verdict 互信息（硬门）。

两个必须说清楚的估计量取舍（都在 ``security_world/validation/surface.py`` 的
docstring 里展开）：

1. **Miller–Madow 偏差校正**——X-Request-Id / trace_id 的取值近似每 action 唯一，
   原始 MI 的小样本偏差比 0.01 bit 的阈值大一个量级；不校正会把"每个世界标签不同"
   误报成"表层特征泄漏标签"。
2. **标识符 / 旋钮之分 + 家族条件化**——取值被反事实家族划分的特征（标识符）度量
   的是世界身份（已由 group-key split 控制），不进判定；旋钮特征用
   I(feature; verdict | family) 判定，消掉"表层旋钮只在 irrelevant_perturbation
   变体上被拧动、而那类变体的标签按构造不变"这个混淆。

这里的测试钉死三件事：**真的泄漏必须失败**（不是把门做成永真）、**正常语料必须
通过**、**两个统计量都出现在报告里**（审阅者能自己复核取舍）。
"""
from __future__ import annotations

import dataclasses

import pytest
from security_world.validation import (
    extract_feature,
    mutual_information_bits,
    miller_madow_bias_bits,
    surface_label_independence,
)


def _episode_with_user_agent(episode, user_agent: str):
    document = dataclasses.replace(
        episode,
        observation={
            **episode.observation,
            "model_visible": {
                **episode.observation["model_visible"],
                "request": {
                    **episode.observation["model_visible"]["request"],
                    "headers": {
                        **episode.observation["model_visible"]["request"].get("headers", {}),
                        "User-Agent": user_agent,
                    },
                },
            },
        },
    )
    return document


def test_g11_fails_on_a_real_surface_leak(hc001_family) -> None:
    """User-Agent 与 verdict 完全相关 ⇒ 必须失败（门不是永真的）。"""
    leaked: list = []
    for episode in hc001_family.variants:
        truth = str(episode.oracle_output.observable_decision)
        leaked.append(_episode_with_user_agent(episode, "sqlmap/1.7" if truth == "attack" else "curl/8.4.0"))
    report = surface_label_independence(leaked, max_bits=0.01)
    ua = next(
        item for item in report.per_feature if item.feature == "observation.request.headers.User-Agent"
    )
    assert ua.mutual_information_bits > 0.5
    assert not report.passed
    assert any(item["feature"] == "observation.request.headers.User-Agent" for item in report.violations)


def test_g11_passes_on_the_reference_family(hc001_family) -> None:
    report = surface_label_independence(list(hc001_family.variants), max_bits=0.01)
    assert report.samples == len(hc001_family.variants)
    assert report.passed


def test_g11_reports_both_statistics(hc001_family) -> None:
    report = surface_label_independence(list(hc001_family.variants))
    for item in report.per_feature:
        document = item.to_document()
        assert "mutual_information_bits" in document
        assert "conditional_mutual_information_bits" in document
        assert "role" in document
        assert document["role"] in ("knob", "identifier")


def test_g11_flags_an_identifier_feature(hc001_two_families) -> None:
    """X-Request-Id 的取值被反事实家族划分 ⇒ 判为标识符，不进判定。"""
    episodes = [item for family in hc001_two_families for item in family.variants]
    report = surface_label_independence(episodes)
    by_feature = {item.feature: item for item in report.per_feature}
    request_id = by_feature["observation.request.headers.X-Request-Id"]
    assert request_id.is_identifier
    assert request_id.mutual_information_bits_corrected > 0.01  # 原始统计确实有信号
    assert not any(
        item["feature"] == "observation.request.headers.X-Request-Id" for item in report.violations
    )


def test_extract_feature_reads_the_model_visible_side_only(hc001_family) -> None:
    episode = hc001_family.base
    assert extract_feature(episode, "observation.request.headers.User-Agent") is not None
    assert extract_feature(episode, "observation.request.headers.X-Request-Id") is not None
    # 答案键不在 model_visible 上 ⇒ 抽不到
    assert extract_feature(episode, "observation.decision_metadata.evidence_availability_level") is None


def test_mutual_information_bits_and_bias_correction() -> None:
    # 完全相关 ⇒ 1 bit
    assert abs(mutual_information_bits([("a", "x"), ("a", "x"), ("b", "y"), ("b", "y")]) - 1.0) < 1e-9
    # 独立 ⇒ 0
    assert mutual_information_bits([("a", "x"), ("b", "x"), ("a", "y"), ("b", "y")]) == 0.0
    # 单值输入 ⇒ 0
    assert mutual_information_bits([("a", "x"), ("a", "x")]) == 0.0
    # 偏差随 |X|、|Y| 增长，随样本数下降
    small = miller_madow_bias_bits(4, 2, 8)
    large = miller_madow_bias_bits(40, 2, 800)
    assert small > large > 0


# --------------------------------------------------------------------------- #
# REVISION 3（P1-7）：min_samples 规模化 + "样本不足未运行"的诚实语义
# --------------------------------------------------------------------------- #
def test_the_config_min_samples_is_the_scaled_floor(hc001_family) -> None:
    """``configs/default.json`` 与代码默认值逐字同步，且就是规模化后的 64。

    200 是按单 renderer 373 episode 的手写语料校准的；第一次真实 provider run 只有
    104 episode（8 个 accepted 世界），门在 milestone-1 规模下永远"未运行"。64 =
    8 世界 × 8 episode，是规模换算后的下限——**不是把门改松**：不足即未运行。
    """
    import json
    from pathlib import Path

    from security_world.validation import DEFAULT_MIN_SAMPLES
    from security_world.validation.gates import _g11_surface_label_independence

    config = json.loads(
        (Path(__file__).resolve().parents[2] / "configs" / "default.json").read_text(encoding="utf-8")
    )
    configured = config["quality_gates"]["G11_surface_label_independence"]["min_samples"]
    assert configured == 64 == DEFAULT_MIN_SAMPLES
    # 默认 config（不显式给 quality_gates）走代码默认值，同样是 64
    episodes = list(hc001_family.variants)
    result = _g11_surface_label_independence(episodes, {})
    assert result.checked is False
    assert "min_samples 64" in result.detail


def test_g11_not_run_when_samples_are_insufficient(hc001_family) -> None:
    """样本不足 ⇒ ``checked=False``（未运行），detail 写明"样本不足未运行"。

    绝不允许"不足即通过"：一个没跑的门显示成绿色，比没有门更坏。
    """
    from security_world.validation.gates import _g11_surface_label_independence

    episodes = list(hc001_family.variants)
    assert len(episodes) < 64, "夹具家族必须小于新下限才有测试意义"
    result = _g11_surface_label_independence(episodes, {"quality_gates": {}})
    assert result.passed and result.checked is False
    assert "样本不足未运行" in result.detail
    assert "不假装通过" in result.detail


def test_g11_runs_once_the_sample_floor_is_reached(pipeline_one_renderer) -> None:
    """样本数达到 64 ⇒ 门真的运行（干净语料通过，而不是永远"未运行"）。

    用手写语料全量单 renderer 管线（373 episode）——不是复制粘贴同一个家族：重复
    样本会让家族条件分布退化、Miller–Madow 校正项相对变大，那是**测试构造的**假
    泄漏，不是门的行为。真实语料在 373 episode 上必须真的过（integration 的
    ``gate_report.passed`` 同源）。
    """
    from security_world.validation.gates import _g11_surface_label_independence

    episodes = list(pipeline_one_renderer.episodes)
    assert len(episodes) >= 64, len(episodes)
    result = _g11_surface_label_independence(
        episodes, {"quality_gates": {"G11_surface_label_independence": {}}}
    )
    assert result.checked and result.passed, result.detail
    assert "373 个样本" in result.detail, result.detail


@pytest.fixture(scope="module")
def pipeline_one_renderer():
    """全语料单 renderer 管线（与 tests/gates/test_g3_family_reachability.py 同款）。"""
    from analysis import run_pipeline

    return run_pipeline(renderers=("http_request",))
