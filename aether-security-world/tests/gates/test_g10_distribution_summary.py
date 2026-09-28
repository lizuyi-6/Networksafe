"""G10 分布摘要（报告门，永不失败）+ 标签熵/域覆盖审计。

G10 是 ``configs/default.json`` 的 ``quality_gates.report_only``：把 abstention 率
调到一个目标值等于按模型弱点造数据（需求 §26 明令禁止），所以"分布长什么样"必须是
观测量而不是达标项。这里断言它**不失败**，且摘要里确实有每一维计数。
"""
from __future__ import annotations

from security_world.validation import (
    distribution_summary,
    domain_coverage_floor,
    entropy_bits,
    label_entropy_floor,
)


def test_g10_reports_every_dimension(hc001_family) -> None:
    from security_world.validation import run_gates

    report = run_gates(hc001_family.base, family=hc001_family)
    result = report.result("G10_distribution_summary")
    assert result is not None and result.checked is False  # 数据集级门禁
    summary = distribution_summary(list(hc001_family.variants))
    for key in (
        "sample_count",
        "observable_decision",
        "world_truth",
        "variant_type",
        "evidence_availability_level",
        "attack_family",
        "episode_length",
        "counterfactual_family_count",
        "world_count",
        "average_variants_per_world",
        "label_entropy_bits",
    ):
        assert key in summary, key
    assert summary["sample_count"] == len(hc001_family.variants)
    assert sum(summary["observable_decision"].values()) == summary["sample_count"]


def test_g10_is_a_report_only_gate(hc001_family) -> None:
    from security_world.validation import GATES, HARD_GATES, run_gates

    assert "G10_distribution_summary" in GATES
    assert "G10_distribution_summary" not in HARD_GATES
    report = run_gates(hc001_family.base, family=hc001_family)
    assert report.passed


def test_entropy_bits_is_zero_for_a_single_class() -> None:
    assert entropy_bits([5]) == 0.0
    assert entropy_bits([0, 0]) == 0.0
    assert entropy_bits([1, 1]) == 1.0
    assert abs(entropy_bits([3, 1]) - 0.8112781) < 1e-6


def test_label_entropy_floor_flags_a_collapsed_distribution(hc001_family) -> None:
    """所有样本同一个判决 ⇒ 熵 0 ⇒ 审计不通过（某一类根本没被造出来）。"""
    episodes = list(hc001_family.variants)
    ok, bits, detail = label_entropy_floor(episodes, min_bits=0.5)
    assert bits >= 0.0
    if len({str(ep.oracle_output.observable_decision) for ep in episodes}) == 1:
        assert not ok
        assert "熵" in detail


def test_domain_coverage_floor_counts_world_domains(corpus, hc001_family, hc001_world) -> None:
    worlds = {hc001_world.world_id: hc001_world}
    ok, count, detail = domain_coverage_floor(
        list(hc001_family.variants), worlds=worlds, min_domains=4
    )
    assert not ok and count == 1
    assert "e-commerce" in detail
    # 没有世界注册表时一个域都数不出来（诚实的 0，不是猜的）
    ok2, count2, _detail2 = domain_coverage_floor(list(hc001_family.variants), min_domains=4)
    assert not ok2 and count2 == 0
