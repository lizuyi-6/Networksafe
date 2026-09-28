"""M3 family-aware sampler tests (master brief §37/§61)."""
import pytest

from experiments.phase3.loader import build_group_index, make_samples, split_mixed_groups
from experiments.phase3.sampler import (
    assert_train_only,
    group_samples,
    plan_batches,
    validate_no_cross_split,
)


def _mk(release_synth_factory, seed=0):
    return release_synth_factory()


def test_plan_batches_covers_all_exactly_once(release_synth_factory):
    eps = release_synth_factory()
    eps += release_synth_factory(world_id="W-2", cf="CF-2")
    samples = make_samples(eps, "m3-stateful-counterfactual")
    batches, eligible = plan_batches(samples, effective_batch=4, seed=20260921)
    flat = [s.episode_id for b in batches for s in b]
    assert sorted(flat) == sorted(s.episode_id for s in samples)
    assert len(flat) == len(set(flat))
    for batch in batches[:-1]:
        assert len(batch) == 4


def test_plan_batches_deterministic_under_seed(release_synth_factory):
    eps = []
    for i in range(6):
        eps += release_synth_factory(world_id=f"W-{i}", cf=f"CF-{i}")
    samples = make_samples(eps, "m3-stateful-counterfactual")
    b1, _ = plan_batches(samples, 4, seed=1)
    b2, _ = plan_batches(samples, 4, seed=1)
    b3, _ = plan_batches(samples, 4, seed=2)
    flat1 = [s.episode_id for b in b1 for s in b]
    assert flat1 == [s.episode_id for b in b2 for s in b]
    assert flat1 != [s.episode_id for b in b3 for s in b]


def test_group_members_stay_contiguous(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m3-stateful-counterfactual")
    batches, _ = plan_batches(samples, effective_batch=5, seed=7)
    positions = {}
    for i, batch in enumerate(batches):
        for s in batch:
            positions[s.episode_id] = i
    batches_used = set(positions.values())
    assert len(batches_used) == 1  # 5 members fit in one batch of 5


def test_mixed_groups_excluded_from_pair_objective(release_synth_factory):
    eps = release_synth_factory()
    dirty = release_synth_factory(world_id="W-X", cf="CF-X",
                                  base_violated=("INV-aaa",),
                                  crit_violated=("INV-bbb", "INV-ccc"))
    samples = make_samples(eps + dirty, "m3-stateful-counterfactual")
    index = build_group_index(eps + dirty)
    mixed = split_mixed_groups(index)
    _, eligible = plan_batches(samples, 4, seed=3, mixed_groups=mixed)
    assert ("train", "CF-1", "W-1") not in mixed
    assert ("train", "CF-X", "W-X") in mixed
    assert eligible[("train", "CF-X", "W-X")] is False
    assert eligible[("train", "CF-1", "W-1")] is True


def test_cross_split_group_raises(release_synth_factory):
    eps = release_synth_factory() + release_synth_factory(split="iid-dev")
    samples = make_samples(eps, "m1-ordinary-sft")
    with pytest.raises(RuntimeError):
        validate_no_cross_split(samples)


def test_train_only_guard(release_synth_factory):
    ok = make_samples(release_synth_factory(), "m1-ordinary-sft")
    assert_train_only(ok)
    bad = ok + make_samples(release_synth_factory(split="world-ood"), "m1-ordinary-sft")
    from experiments.phase3.contract import SplitPolicyError
    with pytest.raises(SplitPolicyError):
        assert_train_only(bad)


def test_grouping_preserves_distributed_members(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m3-stateful-counterfactual")
    grouped = group_samples(samples)
    assert len(grouped) == 1
    members = grouped[("train", "CF-1", "W-1")]
    assert {m.variant_type for m in members} == set(
        ["base", "critical_intervention", "irrelevant_perturbation",
         "evidence_masked", "trust_provenance_variant"])
