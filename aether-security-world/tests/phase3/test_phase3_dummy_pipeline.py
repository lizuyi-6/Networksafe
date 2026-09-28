"""Full-pipeline dummy dry run (master brief §45).

loader -> renderer -> dummy predictor -> prediction writer -> metrics ->
family calibers -> bootstrap -> report dict. Oracle Echo is pipeline-only.
"""
import json
import os
import tempfile

import pytest

from experiments.phase3 import metrics as M
from experiments.phase3.bootstrap import bootstrap_ci
from experiments.phase3.dummy_models import (
    AlwaysAttack,
    AlwaysInsufficient,
    AlwaysSafe,
    OracleEcho,
    RandomVerdict,
)
from experiments.phase3.loader import make_samples


def _write_predictions(name, preds):
    # self-managed dir: the default pytest tmp_path fixture hits a sandbox ACL
    # denial on this host (PermissionError on %TEMP%/pytest-of-*).
    base = os.path.join(tempfile.gettempdir(), "p3-dryrun")
    os.makedirs(base, exist_ok=True)
    path = os.path.join(base, name)
    with open(path, "w", encoding="utf-8") as fh:
        for p in preds:
            fh.write(json.dumps(p, ensure_ascii=False) + "\n")
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


@pytest.mark.parametrize("dummy_cls", [AlwaysSafe, AlwaysAttack, AlwaysInsufficient])
def test_dummy_pipeline_end_to_end(release_synth_factory, dummy_cls):
    eps = release_synth_factory() + release_synth_factory(world_id="W-2", cf="CF-2")
    samples = make_samples(eps, "m2-stateful-sft")
    assert all(s.prompt for s in samples)
    assert all(json.loads(s.target_text)["verdict"] for s in samples)

    preds = _write_predictions(f"preds-{dummy_cls.name}.jsonl", dummy_cls().predict_batch(samples))
    m = M.compute_metrics(samples, preds)
    assert m["sample_count"] == len(samples)
    assert m["json_parse_rate"] == 1.0 and m["schema_valid_rate"] == 1.0

    ci = bootstrap_ci(samples, preds, lambda mm: mm["accuracy"],
                      cluster_key="world_id", n_resamples=2000, seed=20260921)
    assert ci["n_resamples"] == 2000
    assert "accuracy" in m and m["accuracy"] is not None


def test_all_five_dummies_run(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m1-ordinary-sft")
    for cls in (AlwaysSafe, AlwaysAttack, AlwaysInsufficient, RandomVerdict, OracleEcho):
        preds = _write_predictions(f"{cls.name}.jsonl", cls().predict_batch(samples))
        m = M.compute_metrics(samples, preds)
        assert m["schema_valid_n"] == len(samples)


def test_oracle_echo_is_pipeline_only(release_synth_factory):
    eps = release_synth_factory()
    samples = make_samples(eps, "m1-ordinary-sft")
    m = M.compute_metrics(samples, OracleEcho().predict_batch(samples))
    assert m["P1_observable_decision_macro_f1"] == 1.0
    # Oracle Echo is explicitly not a baseline; name marks it
    assert "pipeline test only" in OracleEcho.name
