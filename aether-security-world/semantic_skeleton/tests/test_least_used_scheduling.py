"""least-used mechanism 调度与 selection trace（brief §7）。

Phase 2A 唯一未过的 gate 是 structural cluster 10.68%——根因是覆盖控制器在"无类别缺口"
时落到固定清单，`post_disable_session` 一个机制占了 11/103。这里把修复钉成可证伪断言：

1. 无缺口时走 fallback，且 fallback 按 (accepted 数升序, 名字升序) 排序；
2. 被过度选择的机制**不出现在**可选列表里；
3. `directive()` 与 `selection_record()` 用同一个选择实现，不会两边漂移；
4. trace 记录 brief §7 点名的每一栏。
"""
from __future__ import annotations

import pytest

from semantic_skeleton.coverage import (
    FINAL_QUOTAS,
    MECHANISMS,
    CoverageState,
    deficits,
    directive,
    record_world,
    selection_record,
)


def _full_state(overused: str = "post_disable_session", overused_count: int = 11) -> CoverageState:
    """构造一个**无类别缺口**的状态，并让某个机制被过度选择（复现 v0.5 的病灶）。"""
    state = CoverageState()
    for _ in range(overused_count):
        record_world(state, labels=("session",), complexity="medium",
                     domain="saas", family=overused)
    for label, target in FINAL_QUOTAS.items():
        if label == "session":
            continue
        while int(state.labels.get(label, 0)) < target:
            family = next(
                item.family for item in MECHANISMS if label in item.coverage_labels
            )
            record_world(state, labels=(label,), complexity="medium",
                         domain="saas", family=family)
    return state


def test_no_deficit_state_has_no_shortfalls():
    state = _full_state()
    assert deficits(state) == []
    assert selection_record(state, batch_index=1)["underrepresented"] == []


def test_fallback_is_used_only_when_there_is_no_deficit():
    assert selection_record(_full_state(), batch_index=1)["used_fallback"] is True

    gapped = CoverageState()
    record_world(gapped, labels=("session",), complexity="medium",
                 domain="saas", family="post_disable_session")
    assert selection_record(gapped, batch_index=1)["used_fallback"] is False


def test_fallback_prefers_the_least_used_mechanism():
    state = _full_state()
    record = selection_record(state, batch_index=1)
    counts = record["mechanism_counts"]
    # 提议的机制必须全部是"用得最少"那一档
    offered = record["eligible_mechanisms"]
    assert offered, "fallback 必须给出可选机制"
    max_offered = max(counts.get(name, 0) for name in offered)
    unused = sorted(
        item.family for item in MECHANISMS if counts.get(item.family, 0) == 0
    )
    assert unused, "46 个机制里应该有从未用过的"
    assert max_offered == 0, (
        f"fallback 提议了已用过的机制（最多 {max_offered} 次），"
        "而还有 {len(unused)} 个从未用过"
    )


def test_overused_mechanism_is_not_offered_by_the_fallback():
    """v0.5 run 的病灶：post_disable_session 被 fallback 反复选中。"""
    state = _full_state(overused="post_disable_session", overused_count=11)
    record = selection_record(state, batch_index=1)
    assert record["mechanism_counts"]["post_disable_session"] == 11
    assert "post_disable_session" not in record["eligible_mechanisms"], (
        "被过度选择的机制不该再被 fallback 提议"
    )
    assert record["least_used_order"] != "post_disable_session"


def test_fallback_rotates_as_counts_change():
    """随着最少用机制被消耗，fallback 的排序必须跟着转。"""
    state = _full_state()
    first = selection_record(state, batch_index=1)["eligible_mechanisms"][0]
    record_world(state, labels=tuple(
        item.coverage_labels for item in MECHANISMS if item.family == first
    ), complexity="medium", domain="saas", family=first)
    second = selection_record(state, batch_index=2)["eligible_mechanisms"][0]
    assert first != second, "消耗掉最少用机制后，fallback 必须换一个"


def test_selection_record_has_every_field_the_brief_requires():
    record = selection_record(_full_state(), batch_index=7)
    for field in (
        "batch_index", "accepted_so_far", "mechanism_counts", "underrepresented",
        "chosen_labels", "eligible_mechanisms", "used_fallback", "selection_rationale",
        "least_used_order",
    ):
        assert field in record, f"selection trace 缺栏: {field}"
    assert record["batch_index"] == 7


def test_directive_and_selection_record_agree():
    """两边必须用同一个选择实现（否则 trace 会说一套、prompt 说另一套）。"""
    for state in (_full_state(), CoverageState()):
        text = directive(state, 5)
        record = selection_record(state, batch_index=1)
        for family in record["eligible_mechanisms"]:
            assert family in text, (
                f"selection_record 选了 {family} 但 directive 没把它写进 prompt"
            )
        if record["chosen_labels"]:
            for label in record["chosen_labels"]:
                assert label in text


def test_deficit_path_still_prioritises_shortfall_labels():
    """有缺口时行为不变：缺口标签排最前，只提议带该标签的机制。"""
    state = CoverageState()
    record = selection_record(state, batch_index=1)
    assert record["used_fallback"] is False
    assert record["chosen_labels"], "有缺口时必须选出缺口标签"
    assert record["underrepresented"], "有缺口时必须记录缺口"
    assert record["least_used_order"] is None
    from semantic_skeleton.mechanisms import label_families

    allowed = {name for label in record["chosen_labels"]
               for name in label_families().get(label, ())}
    assert set(record["eligible_mechanisms"]) <= allowed
