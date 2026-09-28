"""Frozen metric numeric tests (master brief §38/§39)."""
import math

from experiments.phase3 import metrics as M
from experiments.phase3.loader import make_samples
from experiments.phase3.dummy_models import (
    AlwaysAttack,
    AlwaysInsufficient,
    AlwaysSafe,
    OracleEcho,
    RandomVerdict,
)


def _pred(sample, verdict, family=None):
    return {
        "episode_id": sample.episode_id,
        "pred_verdict": verdict,
        "pred_attack_family": family or ("none" if verdict != "attack" else sample.attack_family),
        "parse_ok": True,
        "schema_ok": True,
    }


def test_oracle_echo_scores_perfect(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m2-stateful-sft")
    preds = [{"episode_id": s.episode_id, "pred_verdict": s.oracle_decision,
              "pred_attack_family": s.attack_family if s.oracle_decision == "attack" else "none",
              "parse_ok": True, "schema_ok": True} for s in samples]
    m = M.compute_metrics(samples, preds)
    assert m["P1_observable_decision_macro_f1"] == 1.0
    assert m["accuracy"] == 1.0
    assert m["P4_evidence_sufficiency_accuracy"] == 1.0
    assert m["attack_recall"]["value"] == 1.0
    assert m["safe_fpr"]["value"] == 0.0
    assert m["insufficient_recall"]["value"] == 1.0
    # irrelevant members predict == base mode (all-oracle echo) -> P3 = 1.0
    assert m["P3_counterfactual_family_consistency"] == 1.0


def test_always_safe_metrics(release_synth_factory):
    eps = release_synth_factory(base_decision="attack")
    samples = make_samples(eps, "m1-ordinary-sft")
    preds = AlwaysSafe().predict_batch(samples)
    m = M.compute_metrics(samples, preds)
    assert m["safe_fpr"]["value"] is not None and m["safe_fpr"]["denominator"] > 0
    assert m["safe_fpr"]["value"] == 0.0  # nothing flagged as attack
    assert m["attack_recall"]["value"] == 0.0
    assert m["accuracy"] < 1.0


def test_always_attack_fpr_is_one(release_synth_factory):
    eps = release_synth_factory(base_decision="safe")
    samples = make_samples(eps, "m1-ordinary-sft")
    preds = AlwaysAttack().predict_batch(samples)
    m = M.compute_metrics(samples, preds)
    assert m["safe_fpr"]["value"] == 1.0


def test_always_insufficient_p4_floor(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m1-ordinary-sft")
    preds = AlwaysInsufficient().predict_batch(samples)
    m = M.compute_metrics(samples, preds)
    # every insufficient_evidence row is correctly abstained; every decided row is missed
    n_ins = sum(1 for s in samples if s.oracle_decision == "insufficient_evidence")
    n_dec = len(samples) - n_ins
    expected = (n_ins + 0) / len(samples)
    assert math.isclose(m["P4_evidence_sufficiency_accuracy"], expected, abs_tol=1e-4)
    assert m["insufficient_recall"]["value"] == 1.0


def test_random_is_deterministic_under_seed(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m1-ordinary-sft")
    a = M.compute_metrics(samples, RandomVerdict(seed=42).predict_batch(samples))
    b = M.compute_metrics(samples, RandomVerdict(seed=42).predict_batch(samples))
    c = M.compute_metrics(samples, RandomVerdict(seed=43).predict_batch(samples))
    assert a == b
    assert a["accuracy"] != c["accuracy"] or a["P1_observable_decision_macro_f1"] != c["P1_observable_decision_macro_f1"]


def test_p2_counts_clean_pairs(release_synth_factory):
    eps = release_synth_factory(base_decision="attack",
                                crit_violated=("INV-bbb",), base_violated=("INV-aaa",))
    samples = make_samples(eps, "m2-stateful-sft")
    echo = OracleEcho().predict_batch(samples)
    m = M.compute_metrics(samples, echo)
    n_crit = sum(1 for s in samples if s.variant_type == "critical_intervention")
    assert m["P2_n_pairs"] == n_crit
    assert m["P2_critical_pair_correctness"] == 1.0


def test_attack_family_macro_f1_ignores_non_attack(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m1-ordinary-sft")
    preds = AlwaysSafe().predict_batch(samples)
    m = M.compute_metrics(samples, preds)
    fam = m["attack_family_per_class"]
    assert "none" not in fam  # 'none' is not a family class
