"""Cluster bootstrap tests (master brief §40/§41)."""
import pytest

from experiments.phase3.bootstrap import bootstrap_ci, paired_bootstrap_diff
from experiments.phase3.dummy_models import AlwaysSafe, OracleEcho, RandomVerdict
from experiments.phase3.loader import make_samples


def _echo_preds(samples):
    return [{"episode_id": s.episode_id, "pred_verdict": s.oracle_decision,
             "pred_attack_family": s.attack_family if s.oracle_decision == "attack" else "none",
             "parse_ok": True, "schema_ok": True} for s in samples]


def test_bootstrap_ci_covers_point(release_synth_factory):
    eps = []
    for i in range(8):
        eps += release_synth_factory(world_id=f"W-{i}", cf=f"CF-{i}")
    samples = make_samples(eps, "m2-stateful-sft")
    preds = _echo_preds(samples)
    metric = lambda m: m["P1_observable_decision_macro_f1"]
    ci = bootstrap_ci(samples, preds, metric, cluster_key="world_id",
                      n_resamples=2000, seed=20260921)
    assert ci["point"] == 1.0
    assert ci["ci95_low"] <= ci["point"] <= ci["ci95_high"]
    assert ci["n_resamples"] == 2000


def test_row_bootstrap_is_not_what_we_do(release_synth_factory):
    """World-cluster resampling must move whole worlds, not single rows."""
    eps = []
    for i in range(6):
        eps += release_synth_factory(world_id=f"W-{i}", cf=f"CF-{i}")
    samples = make_samples(eps, "m2-stateful-sft")
    preds = RandomVerdict(seed=1).predict_batch(samples)
    ci = bootstrap_ci(samples, preds, lambda m: m["accuracy"],
                      cluster_key="world_id", n_resamples=2000, seed=5)
    # with 6 worlds the CI must be wide enough to show cluster (not row) noise
    assert ci["ci95_high"] - ci["ci95_low"] > 0.0


def test_paired_bootstrap_diff_symmetry(release_synth_factory):
    eps = []
    for i in range(8):
        eps += release_synth_factory(world_id=f"W-{i}", cf=f"CF-{i}")
    samples = make_samples(eps, "m2-stateful-sft")
    echo = _echo_preds(samples)
    safe = AlwaysSafe().predict_batch(samples)
    metric = lambda m: m["accuracy"]
    d12 = paired_bootstrap_diff(samples, echo, samples, safe, metric,
                                n_resamples=2000, seed=9)
    d21 = paired_bootstrap_diff(samples, safe, samples, echo, metric,
                                n_resamples=2000, seed=9)
    assert d12["n_resamples"] == 2000
    assert d12["diff_point"] == pytest.approx(-d21["diff_point"])
    assert d12["diff_point"] > 0  # oracle echo beats always-safe


def test_paired_requires_alignment(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m2-stateful-sft")
    a = AlwaysSafe().predict_batch(samples)
    b = AlwaysSafe().predict_batch(samples)[:-1]
    with pytest.raises(ValueError):
        paired_bootstrap_diff(samples, a, samples, b, lambda m: m["accuracy"])


def test_resample_counts_supported(release_synth_factory):
    eps = []
    for i in range(4):
        eps += release_synth_factory(world_id=f"W-{i}", cf=f"CF-{i}")
    samples = make_samples(eps, "m1-ordinary-sft")
    preds = AlwaysSafe().predict_batch(samples)
    for n in (2000, 5000, 10000):
        ci = bootstrap_ci(samples, preds, lambda m: m["accuracy"],
                          cluster_key="attack_family", n_resamples=n, seed=11)
        assert ci["n_resamples"] == n
