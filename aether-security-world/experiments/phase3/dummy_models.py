"""Dummy predictors for the full-pipeline dry run (master brief §45).

Always Safe / Always Attack / Always Insufficient / Random / Oracle Echo.
Oracle Echo is for pipeline testing only - it is never a model baseline.
"""
from __future__ import annotations

import random
from typing import Any

from .contract import Verdict


class DummyModel:
    name = "dummy"

    def predict(self, sample: Any) -> dict[str, Any]:
        raise NotImplementedError

    def predict_batch(self, samples: list[Any]) -> list[dict[str, Any]]:
        return [self.predict(s) for s in samples]


def _row(pred_verdict: str, sample: Any) -> dict[str, Any]:
    family = sample.attack_family if pred_verdict == Verdict.ATTACK.value else "none"
    return {
        "episode_id": sample.episode_id,
        "pred_verdict": pred_verdict,
        "pred_attack_family": family,
        "parse_ok": True,
        "schema_ok": True,
    }


class AlwaysSafe(DummyModel):
    name = "always-safe"

    def predict(self, sample):
        return _row(Verdict.SAFE.value, sample)


class AlwaysAttack(DummyModel):
    name = "always-attack"

    def predict(self, sample):
        return _row(Verdict.ATTACK.value, sample)


class AlwaysInsufficient(DummyModel):
    name = "always-insufficient"

    def predict(self, sample):
        return _row(Verdict.INSUFFICIENT_EVIDENCE.value, sample)


class RandomVerdict(DummyModel):
    name = "random"

    def __init__(self, seed: int = 0):
        self.rng = random.Random(seed)

    def predict(self, sample):
        return _row(self.rng.choice([v.value for v in Verdict]), sample)


class OracleEcho(DummyModel):
    name = "oracle-echo (pipeline test only)"

    def predict(self, sample):
        return _row(sample.oracle_decision, sample)


ALL_DUMMIES = (AlwaysSafe, AlwaysAttack, AlwaysInsufficient, RandomVerdict, OracleEcho)
