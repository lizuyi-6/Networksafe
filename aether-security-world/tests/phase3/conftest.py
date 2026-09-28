"""Fixtures for Phase 3 protocol tests (synthetic episodes, no release data)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[2]
for name in ("experiments",):
    if str(PKG_ROOT / name) not in sys.path and str(PKG_ROOT) not in sys.path:
        pass
sys.path.insert(0, str(PKG_ROOT))

from experiments.phase3 import contract  # noqa: E402


def make_episode(
    episode_id="EP-0001",
    world_id="W-0001",
    cf_family="CF-0001",
    variant_type="base",
    split="train",
    attack_family="tenant_isolation_violation",
    observable_decision="attack",
    violated_invariants=("INV-aaa",),
    availability="complete",
    evidence=None,
    timeline=None,
    request_text="POST /api/saas/billing-record/RES-1 HTTP/1.1\nHost: api.example.invalid\n",
):
    return {
        "episode_id": episode_id,
        "world_id": world_id,
        "_split": split,
        "counterfactual_family_id": cf_family,
        "variant_type": variant_type,
        "group_keys": {"attack_family": attack_family},
        "observation": {
            "model_visible": {
                "current_time": "2026-01-01T20:00:00Z",
                "request": {
                    "method": "POST",
                    "path": "/api/saas/billing-record/RES-1",
                    "query": {},
                    "headers": {"Host": "api.example.invalid"},
                    "body": None,
                    "rendered_text": request_text,
                },
                "timeline": timeline if timeline is not None else [
                    {"t_index": 0, "at": "2026-01-01T19:59:00Z", "event_type": "session_start",
                     "summary": "session created", "actor_id": "ACT-1", "event_id": "EV-0"},
                ],
                "evidence": evidence if evidence is not None else [
                    {"evidence_id": "EV-1", "type": "session_record", "source": "session-store",
                     "provenance": "system_of_record", "timestamp": "2026-01-01T19:59:00Z",
                     "value": "session ACT-1 active for principal PRN-7"},
                ],
            },
            "decision_metadata": {
                "evidence_availability_level": availability,
                "evidence_classification": [],
                "hidden_evidence_ids": [],
            },
        },
        "oracle_output": {
            "observable_decision": observable_decision,
            "violated_invariants": list(violated_invariants),
            "satisfied_invariants": [],
            "missing_evidence": [],
            "world_truth": "attack",
        },
    }


@pytest.fixture
def episode_factory():
    return make_episode


@pytest.fixture
def base_episode():
    return make_episode()


@pytest.fixture
def release_synth_factory():
    """A synthetic 1-group x 5-variant set resembling the release algebra."""

    def build(split="train", world_id="W-1", cf="CF-1", base_decision="attack",
              crit_violated=(), base_violated=("INV-aaa",),
              crit_decision=None):
        eps = []
        decisions = {
            "base": base_decision,
            "critical_intervention": crit_decision or (
                "safe" if base_decision == "attack" else "attack"),
            "irrelevant_perturbation": base_decision,
            "evidence_masked": "insufficient_evidence",
            "trust_provenance_variant": "insufficient_evidence",
        }
        for i, vt in enumerate(contract.ALL_VARIANTS):
            eps.append(make_episode(
                episode_id=f"EP-{split}-{world_id}-{i}",
                world_id=world_id,
                cf_family=cf,
                variant_type=vt,
                split=split,
                observable_decision=decisions[vt],
                violated_invariants=crit_violated if vt == "critical_intervention" else base_violated,
            ))
        return eps

    return build
