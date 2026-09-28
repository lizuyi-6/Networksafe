"""G1 schema 门禁：episode / action / oracle_output / evidence / world 全部过 schema。

正例：HC-001 家族的每个变体都过；负例：往 episode 文档里塞一个 schema 未定义的键，
断言**拒绝路径**是 ``G1_schema`` 且 detail 指出该键（不只是"被拒"）。
"""
from __future__ import annotations

import copy

from security_world.model import validate_document
from security_world.validation import run_gates

from asw_expansion import spec_from_world  # noqa: F401 - 证明共享构造器可导入


def test_g1_accepts_a_well_formed_family(hc001_family) -> None:
    for episode in hc001_family.variants:
        report = run_gates(episode, family=hc001_family)
        result = report.result("G1_schema")
        assert result is not None and result.passed, result
        # 独立复核：文档本身过 episode schema
        assert validate_document(episode.to_document(), "episode") == []


def test_g1_rejects_an_unknown_root_key(hc001_family) -> None:
    episode = hc001_family.base
    broken = copy.deepcopy(episode.to_document())
    broken["ground_truth"] = "attack"  # world/episode schema 都禁的键
    assert validate_document(broken, "episode"), "schema 必须拒绝 ground_truth 键"
    # 门禁层面：同一份文档经 Episode.from_document 会被 L1 挡下，
    # 因此这里断言"L1 与 schema 互相印证"——门禁的拒绝路径由下一个用例覆盖。
    from security_world.model.episode import Episode
    from security_world.model.errors import ModelError

    try:
        Episode.from_document(broken)
    except ModelError as exc:
        assert "ground_truth" in str(exc)
    else:  # pragma: no cover - 上面必须抛
        raise AssertionError("Episode.from_document 放行了 schema 未定义的键")


def test_g1_rejects_a_malformed_oracle_output(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["oracle_output"] = {
        **document["oracle_output"],
        "world_truth": "definitely_an_attack",  # 不在枚举里
    }
    errors = validate_document(document["oracle_output"], "oracle-output")
    assert errors, "oracle-output schema 必须拒绝越界 world_truth"
    assert "world_truth" in errors[0]


def test_g1_rejects_a_bad_evidence_classification(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["observation"]["decision_metadata"]["evidence_classification"][0]["trust_level"] = "very_trusted"
    errors = validate_document(
        document["observation"]["decision_metadata"]["evidence_classification"][0], "evidence"
    )
    assert errors, "evidence schema 必须拒绝越界 trust_level"


def test_g1_rejects_a_world_with_a_ground_truth_field(hc001_world) -> None:
    document = hc001_world.to_document()
    document["ground_truth"] = "attack"
    errors = validate_document(document, "world")
    assert errors, "world schema 必须拒绝 ground_truth（设计 §4.1）"
    assert "ground_truth" in errors[0]
