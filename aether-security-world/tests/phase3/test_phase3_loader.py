"""Deterministic loader + group index / mixed-base detection tests (§36/§29)."""
from experiments.phase3.loader import (
    build_group_index,
    make_sample,
    split_mixed_groups,
)


def test_sample_is_deterministic(base_episode):
    s1 = make_sample(base_episode, "m2-stateful-sft")
    s2 = make_sample(base_episode, "m2-stateful-sft")
    assert s1.prompt == s2.prompt
    assert s1.target_text == s2.target_text
    assert s1.group_key == ("train", "CF-0001", "W-0001")


def test_sample_metadata_never_in_prompt(base_episode):
    sample = make_sample(base_episode, "m1-ordinary-sft")
    assert "complete" not in sample.prompt  # availability metadata
    assert "INV-aaa" not in sample.prompt
    assert "world_truth" not in sample.prompt


def test_group_index_mixed_detection(episode_factory):
    # clean: critical resolves exactly the one violated invariant (|delta| == 1)
    clean = episode_factory(episode_id="EP-c", world_id="W-c", cf_family="CF-c",
                            variant_type="critical_intervention",
                            violated_invariants=())
    base = episode_factory(episode_id="EP-b", world_id="W-c", cf_family="CF-c",
                           violated_invariants=("INV-aaa",))
    index = build_group_index([base, clean])
    assert split_mixed_groups(index) == set()

    # mixed: critical violates extra invariants (|delta| != 1)
    dirty = episode_factory(episode_id="EP-d", world_id="W-d", cf_family="CF-d",
                            variant_type="critical_intervention",
                            violated_invariants=("INV-bbb", "INV-ccc"))
    base_d = episode_factory(episode_id="EP-e", world_id="W-d", cf_family="CF-d",
                             violated_invariants=("INV-aaa",))
    index2 = build_group_index([base_d, dirty])
    mixed = split_mixed_groups(index2)
    assert ("train", "CF-d", "W-d") in mixed


def test_group_index_keys_are_split_scoped(episode_factory):
    a = episode_factory(episode_id="EP-1", split="train")
    b = episode_factory(episode_id="EP-2", split="iid-dev")
    index = build_group_index([a, b])
    assert len(index) == 2
    assert ("train", "CF-0001", "W-0001") in index
    assert ("iid-dev", "CF-0001", "W-0001") in index


def test_missing_prediction_raises_in_metrics(base_episode):
    from experiments.phase3 import metrics as M

    sample = make_sample(base_episode, "m1-ordinary-sft")
    import pytest
    with pytest.raises(KeyError):
        M.compute_metrics([sample], [])
