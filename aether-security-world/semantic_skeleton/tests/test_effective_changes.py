"""有效反事实改法：每个机制都必须至少有一个非空干预（brief §41/§42）。

``COUNTERFACTUAL_NOOP`` 是一个真实的失败类别，但它不该是**注册表的**失败类别——
如果一个机制的所有改法在它自己的基准世界里都是空操作，那是机制定义错了，不是生成器错了。
这里把它钉成可证伪的断言，并且断言 prompt 里出现的清单与实算一致。
"""
from __future__ import annotations

import pytest

from semantic_skeleton.effective import (
    all_effective_changes,
    effective_changes,
    effective_changes_summary,
)
from semantic_skeleton.mechanisms import MECHANISMS


@pytest.mark.parametrize("family", sorted(item.family for item in MECHANISMS))
def test_every_mechanism_has_at_least_one_effective_change(family):
    mapping = effective_changes(family)
    assert mapping, f"机制 {family} 在它自己的基准世界里没有任何有效反事实改法"
    for fact, changes in mapping.items():
        assert changes, f"机制 {family} 的事实 {fact} 列了空改法表"
        assert len(set(changes)) == len(changes), f"机制 {family} 的 {fact} 改法重复"


def test_effective_changes_are_a_subset_of_the_declared_ones():
    for item in MECHANISMS:
        declared = {spec.fact: set(spec.changes) for spec in item.counterfactuals}
        for fact, changes in effective_changes(item.family).items():
            assert fact in declared, f"{item.family} 的 {fact} 不在机制的 counterfactuals 里"
            assert set(changes) <= declared[fact], (
                f"{item.family} 的 {fact} 出现了声明外的改法 {changes}"
            )


def test_effective_changes_are_deterministic():
    for family in ("stale_tenant_context", "revoked_session_reuse", "token_lineage_confusion"):
        assert effective_changes(family) == effective_changes(family)


def test_all_effective_changes_covers_every_mechanism():
    everything = all_effective_changes()
    assert set(everything) == {item.family for item in MECHANISMS}


def test_summary_is_human_readable_and_nonempty():
    text = effective_changes_summary("stale_tenant_context")
    assert "→" in text
    assert "authenticated_tenant" in text


def test_unknown_mechanism_has_no_effective_changes():
    assert effective_changes("not_a_mechanism") == {}
    assert effective_changes_summary("not_a_mechanism") == "（无有效改法）"
