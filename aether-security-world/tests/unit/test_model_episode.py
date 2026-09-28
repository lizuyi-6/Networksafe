"""Episode 的内存形态与模型可见边界（设计 §5）。

最重要的两条：

1. **``intervention`` 条件必填**（schema 的 ``allOf`` + ``if/then``，§5.1）：
   ``critical_intervention`` / ``irrelevant_perturbation`` 没有 intervention 的
   episode 连 jsonschema 都过不了，内存层也必须拒。
2. **模型侧边界**（D7）：``observation.decision_metadata`` 与 ``oracle_output``
   按构造被排除在模型输入之外——否则 abstention 标签可以直接从元数据解码。
"""
from __future__ import annotations

import dataclasses

import pytest

from security_world.model import (
    SPLIT_STRATEGIES,
    STRATEGY_TO_GROUP_KEY,
    VARIANT_TYPES,
    Episode,
    Event,
    ModelError,
    StateFragment,
    load_episode,
    load_default_config,
)


def test_reference_episode_loads(examples_dir):
    episode = load_episode(examples_dir / "episode.example.json")
    assert episode.variant_type == "base"
    assert episode.split is None or episode.split in {"train", "validation", "test", "holdout"}
    assert episode.action["actor"] == "ACT-003"


def test_reference_episode_round_trips(reference_episode):
    episode = Episode.from_document(reference_episode)
    assert episode.to_document() == reference_episode


def test_reference_episode_satisfies_the_model_visible_boundary(reference_episode, model_visible_boundary):
    """conftest 的可执行边界：22 禁键 + 七键投影精确 + hidden id 一致。"""
    model_visible_boundary(reference_episode)


def test_variant_types_are_the_declared_ones():
    """Phase 2B 加了 ``trust_provenance_variant``（brief §33/§40），闭集跟着长。"""
    assert VARIANT_TYPES == (
        "base",
        "critical_intervention",
        "irrelevant_perturbation",
        "evidence_masked",
        "trust_provenance_variant",
    )


@pytest.mark.parametrize(
    "variant", ["critical_intervention", "irrelevant_perturbation", "trust_provenance_variant"]
)
def test_intervention_variants_require_an_intervention(reference_episode, variant):
    document = dict(reference_episode)
    document["variant_type"] = variant
    document.pop("intervention", None)
    with pytest.raises(ModelError, match="intervention"):
        Episode.from_document(document)


def test_base_variant_may_omit_the_intervention(reference_episode):
    document = dict(reference_episode)
    document["variant_type"] = "base"
    document.pop("intervention", None)
    assert Episode.from_document(document).intervention is None


def test_unknown_variant_type_is_rejected(reference_episode):
    document = dict(reference_episode)
    document["variant_type"] = "something_else"
    with pytest.raises(ModelError, match="不在枚举"):
        Episode.from_document(document)


def test_unknown_keys_are_rejected(reference_episode):
    document = dict(reference_episode)
    document["world_truth"] = "attack"  # 标签不是 episode 的字段
    with pytest.raises(ModelError, match="schema 未定义的键"):
        Episode.from_document(document)


# --------------------------------------------------------------------------- #
# 模型侧边界
# --------------------------------------------------------------------------- #
def test_serialize_for_model_excludes_decision_metadata_and_labels(reference_episode):
    episode = Episode.from_document(reference_episode)
    payload = episode.serialize_for_model()
    assert "decision_metadata" not in payload["observation"]
    assert "model_visible" in payload["observation"]
    assert "oracle_output" not in payload
    # 其余工件仍在：第三方要能独立重放 oracle。
    for key in ("episode_id", "world_id", "action", "timeline", "current_event", "variant_type"):
        assert key in payload


def test_serialize_for_model_carries_no_hidden_evidence(reference_episode):
    """隐藏证据既不能以 id 出现，也不能以值出现（S7：hidden 只存 id 不存值）。"""
    episode = Episode.from_document(reference_episode)
    payload = episode.serialize_for_model()
    classification = reference_episode["observation"]["decision_metadata"]["evidence_classification"]
    visible_ids = {item["evidence_id"] for item in classification if item["visible_in_observation"]}
    hidden = {item["evidence_id"]: item for item in classification if not item["visible_in_observation"]}
    projected = {item["evidence_id"] for item in payload["observation"]["model_visible"]["evidence"]}
    assert projected == visible_ids
    assert hidden, "参考 episode 必须至少有一条隐藏证据，否则这条断言是空转的"
    assert not (projected & set(hidden)), "隐藏证据的 id 不得出现在模型侧"
    for evidence_id, item in hidden.items():
        assert not any(
            projected_item["asserts_ref"] == item["asserts_ref"]
            and projected_item["value"] == item["value"]
            for projected_item in payload["observation"]["model_visible"]["evidence"]
        ), f"隐藏证据 {evidence_id} 的值泄漏进了模型侧"


def test_model_visible_returns_the_closed_block(reference_episode):
    episode = Episode.from_document(reference_episode)
    visible = episode.model_visible()
    assert set(visible) == {"renderer", "current_time", "request", "evidence", "timeline"}
    assert set(visible["evidence"][0]) == {
        "evidence_id", "type", "asserts_ref", "value", "source", "provenance", "timestamp",
    }


def test_model_visible_requires_the_split_observation(reference_episode):
    document = dict(reference_episode)
    document["observation"] = {"evidence": []}
    with pytest.raises(ModelError, match="model_visible"):
        Episode.from_document(document).model_visible()


def test_with_split_assignments_returns_a_new_episode(reference_episode):
    episode = Episode.from_document(reference_episode)
    original = episode.split_assignments
    assert len(original) == 8, "参考 episode 带八种策略各一行"
    assignments = tuple(
        {"strategy": strategy, "group_key": key, "split": "holdout"}
        for strategy, key in sorted(STRATEGY_TO_GROUP_KEY.items())
    )
    updated = episode.with_split_assignments(assignments)
    assert updated is not episode
    assert episode.split_assignments == original, "原 episode 不得被修改"
    assert updated.split_assignments == assignments
    assert updated.to_document()["split_assignments"] == [dict(item) for item in assignments]


# --------------------------------------------------------------------------- #
# split 策略表
# --------------------------------------------------------------------------- #
def test_strategy_to_group_key_matches_the_config():
    config = load_default_config()
    assert dict(STRATEGY_TO_GROUP_KEY) == config["leakage_control"]["strategy_to_group_key"]
    assert set(STRATEGY_TO_GROUP_KEY) == set(config["leakage_control"]["strategies"])
    assert len(SPLIT_STRATEGIES) == 8


# --------------------------------------------------------------------------- #
# Event / StateFragment
# --------------------------------------------------------------------------- #
def test_event_observation_projection_drops_causal_tag_and_state():
    event = Event.from_document(
        {
            "event_id": "EVT-000",
            "t_index": 0,
            "at": "2026-09-19T08:00:00Z",
            "event_type": "login",
            "actor_id": "ACT-001",
            "causal_tag": "relevant",
            "state_after": {"actor_states": {"ACT-001": {"privilege_version": 2}}},
            "summary": "Alice logs in.",
        }
    )
    projection = event.to_observation()
    assert "causal_tag" not in projection
    assert "state_after" not in projection
    assert projection["event_id"] == "EVT-000"
    assert projection["summary"] == "Alice logs in."
    # 决策侧仍拿得到完整事件。
    assert event.causal_tag == "relevant"
    assert event.state_after.referenced_ids() == ("ACT-001",)


def test_state_fragment_round_trips_empty_and_populated():
    empty = StateFragment.from_document({})
    assert empty.to_document() == {}
    populated = StateFragment.from_document(
        {"actor_states": {"ACT-001": {"privilege_version": 2}}}
    )
    assert populated.to_document() == {"actor_states": {"ACT-001": {"privilege_version": 2}}}
    assert populated.referenced_ids() == ("ACT-001",)


def test_event_rejects_unknown_keys():
    with pytest.raises(ModelError, match="schema 未定义的键"):
        Event.from_document(
            {
                "event_id": "EVT-000",
                "t_index": 0,
                "at": "2026-09-19T08:00:00Z",
                "event_type": "login",
                "actor_id": "ACT-001",
                "trust_level": "trusted",  # oracle 分类键不属于事件
            }
        )


def test_episode_action_accepts_a_document_or_a_to_document_object(reference_episode):
    """``action`` 可以是 action 文档，也可以是提供 ``to_document()`` 的 L2 Action。"""
    episode = Episode.from_document(reference_episode)
    assert episode.action == reference_episode["action"]

    class _Action:
        def to_document(self):
            return dict(reference_episode["action"])

    rebuilt = dataclasses.replace(episode, action=_Action())
    assert rebuilt.to_document()["action"] == reference_episode["action"]


def test_episode_action_rejects_a_bare_object(reference_episode):
    episode = Episode.from_document(reference_episode)
    rebuilt = dataclasses.replace(episode, action=object())
    with pytest.raises(ModelError, match="to_document"):
        rebuilt.to_document()
