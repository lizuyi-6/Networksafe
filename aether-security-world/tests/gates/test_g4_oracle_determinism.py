"""G4 oracle 确定性：同 (world, action, evidence_view) 多次执行逐字节一致。

正例：HC-001 家族每个变体重算 N 次都与录制值相同；负例：给 episode 录一份被篡改的
oracle 输出，门禁必须报"重算结果不一致"（而不是悄悄接受）。
"""
from __future__ import annotations

import copy

from security_world.model.canonical import canonical_json
from security_world.validation import evidence_view_from_episode, run_gates


def test_g4_accepts_every_variant(hc001_family, config) -> None:
    for episode in hc001_family.variants:
        report = run_gates(episode, family=hc001_family, config=config)
        result = report.result("G4_oracle_determinism")
        assert result is not None and result.passed, result


def test_g4_recomputes_byte_identically(hc001_family) -> None:
    """直接复核：同一视图重跑三次，canonical json 逐字节相同。"""
    from security_world.oracle import run_oracle

    episode = hc001_family.base
    world = hc001_family.base_world
    view = evidence_view_from_episode(episode)
    documents = {
        canonical_json(run_oracle(world, episode.action, view).to_document()) for _ in range(3)
    }
    assert len(documents) == 1
    assert documents.pop() == canonical_json(episode.oracle_output.to_document())


def test_g4_rejects_a_tampered_oracle_output(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["oracle_output"]["observable_decision"] = "safe"
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G4_oracle_determinism")
    assert result is not None and not result.passed
    assert "重算结果不一致" in result.detail


def test_g4_is_not_run_without_a_world(hc001_family) -> None:
    """没有世界就重算不了——门禁必须记 not_run，不伪装成通过。"""
    report = run_gates(hc001_family.base)
    result = report.result("G4_oracle_determinism")
    assert result is not None and result.checked is False
    assert report.passed  # 未运行的门不计入通过判定
    assert result in report.not_run
