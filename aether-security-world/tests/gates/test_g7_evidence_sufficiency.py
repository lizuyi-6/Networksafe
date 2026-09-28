"""G7 证据充分性：标记 ``insufficient_evidence`` 必须**可证明**。

可证明的含义（任务书原文）：至少一条 required evidence 不可观察。落地成四种形态，
每种都算证明——什么都看不到（not_rendered）、可信证据互相矛盾（contradictory）、
可见项无一在 TRUSTED_ESTABLISHES（unverifiable）、唯一可信项已陈旧而策略要求新鲜
（stale）。HC-021/022/023 三个人工世界分别声明了后三种，因此它们的 base 就是
``world_truth=attack`` 而 ``observable_decision=insufficient_evidence``。
"""
from __future__ import annotations

import copy

from security_world.validation import evidence_view_from_episode, run_gates


def _world(number: int, corpus):
    return next(item for item in corpus if item.number == number)


def test_g7_accepts_sufficient_and_insufficient_samples(hc001_family, corpus) -> None:
    """HC-001 的 base 可判定；HC-021..023 的 base 不可判定但可证明。"""
    report = run_gates(hc001_family.base, family=hc001_family)
    result = report.result("G7_evidence_sufficiency")
    assert result is not None and result.passed, result

    from analysis.pipeline import action_from_binds
    from security_world.model import compile_spec
    from security_world.oracle import EvidenceView, run_oracle
    from security_world.policy import Action

    for number in (21, 22, 23):
        world = _world(number, corpus)
        instance = compile_spec(world.spec, seed=world.spec.seed)
        _summary, binds = world.probes()[-1]
        action = action_from_binds(
            binds,
            action_id=f"ACTN-{number:03d}-2",
            at=str(world.spec_document["current_state"]["at"]),
        )
        output = run_oracle(instance, action, EvidenceView.from_world(instance))
        assert output.world_truth == "attack"
        assert output.observable_decision == "insufficient_evidence"
        # 每条 missing_evidence 的原因都在 insufficient_when 词表里
        for entry in output.missing_evidence:
            assert entry["reason"] in {
                "not_rendered",
                "contradictory",
                "stale",
                "attacker_controlled_only",
                "untrusted_source",
                "derived_only",
            }


def test_g7_proves_insufficiency_from_the_rebuilt_fact_table(hc001_family, corpus) -> None:
    """重建事实表：未建立事实确实无法从可见证据里被唯一确定。"""
    from analysis.pipeline import action_from_binds
    from security_world.model import compile_spec
    from security_world.oracle import build_fact_table
    from security_world.policy import Action

    world = _world(21, corpus)  # 矛盾证据
    instance = compile_spec(world.spec, seed=world.spec.seed)
    _summary, binds = world.probes()[-1]
    action = action_from_binds(
        binds, action_id="ACTN-G7", at=str(world.spec_document["current_state"]["at"])
    )
    from security_world.expansion import expand_family

    result = expand_family(world.spec, seed=world.spec.seed, action=action)
    masked = [
        item for item in result.variants if item.variant_type == "evidence_masked"
    ]
    insufficient = [
        item
        for item in masked
        if item.oracle_output.observable_decision == "insufficient_evidence"
    ]
    assert insufficient, "矛盾世界必须产出 insufficient 变体"
    for episode in insufficient:
        view = evidence_view_from_episode(episode)
        consulted = _consulted(episode)
        table = build_fact_table(instance, action, view, consulted_facts=consulted)
        unestablished = {fact.fact_key for fact in table.unestablished()}
        assert unestablished, "insufficient 必须至少有一个未建立事实"


def _consulted(episode) -> frozenset[str]:
    from security_world.expansion import consulted_facts_from_output

    return consulted_facts_from_output(episode.oracle_output)


def test_g7_rejects_an_unprovable_insufficient(hc001_family) -> None:
    """标了 insufficient 但 missing_evidence 为空 ⇒ 不可证明 ⇒ 拒绝。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["oracle_output"]["observable_decision"] = "insufficient_evidence"
    document["oracle_output"]["missing_evidence"] = []
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G7_evidence_sufficiency")
    assert result is not None and not result.passed
    assert "missing_evidence 为空" in result.detail


def test_g7_rejects_an_out_of_vocabulary_reason(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["oracle_output"]["observable_decision"] = "insufficient_evidence"
    document["oracle_output"]["missing_evidence"] = [
        {"evidence_id": None, "decision_fact": "resource.RES-001.owner", "reason": "vibes"}
    ]
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G7_evidence_sufficiency")
    assert result is not None and not result.passed
    assert "vibes" in result.detail


def test_g7_rejects_missing_evidence_on_a_decided_sample(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["oracle_output"]["missing_evidence"] = [
        {"evidence_id": None, "decision_fact": "resource.RES-001.owner", "reason": "not_rendered"}
    ]
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G7_evidence_sufficiency")
    assert result is not None and not result.passed
