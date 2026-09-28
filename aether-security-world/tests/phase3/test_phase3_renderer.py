"""RENDERER-V1 rendering + leakage audit tests (master brief §34/§35)."""
import pytest

from experiments.phase3 import renderer
from experiments.phase3.renderer import (
    audit_prompt_leakage,
    build_prompt,
    render_m1,
    render_m2,
    target_for,
    target_text,
)


def test_m1_view_is_request_only(base_episode):
    body = render_m1(base_episode)
    assert "POST /api/saas/billing-record/RES-1" in body
    assert "TIMELINE" not in body
    assert "EVIDENCE" not in body
    assert "session created" not in body  # timeline summary must not leak


def test_m2_view_contains_state_history_evidence(base_episode):
    body = render_m2(base_episode)
    assert "POST /api/saas/billing-record/RES-1" in body
    assert "CURRENT_TIME:" in body
    assert "TIMELINE:" in body and "session created" in body
    assert "EVIDENCE:" in body and "provenance=system_of_record" in body


def test_target_frozen_semantics(base_episode):
    target = target_for(base_episode)
    assert target == {"verdict": "attack", "attack_family": "tenant_isolation_violation"}
    base_episode["oracle_output"]["observable_decision"] = "safe"
    assert target_for(base_episode)["attack_family"] == "none"
    base_episode["oracle_output"]["observable_decision"] = "insufficient_evidence"
    assert target_for(base_episode)["attack_family"] == "none"


def test_target_text_is_deterministic(base_episode):
    assert target_text(target_for(base_episode)) == (
        '{"attack_family":"tenant_isolation_violation","verdict":"attack"}')


def test_unknown_verdict_hard_fails(base_episode):
    base_episode["oracle_output"]["observable_decision"] = "maybe"
    with pytest.raises(ValueError):
        target_for(base_episode)


def test_leakage_audit_clean_on_synthetic_episode(base_episode):
    for method in ("m1-ordinary-sft", "m2-stateful-sft", "m3-stateful-counterfactual"):
        prompt = build_prompt(method, base_episode)
        assert audit_prompt_leakage(prompt) == [], (method, audit_prompt_leakage(prompt))


def test_leakage_audit_blocks_oracle_metadata(episode_factory):
    polluted = episode_factory()
    polluted["observation"]["model_visible"]["request"]["rendered_text"] += (
        "\nX-Oracline: oracle says observable_decision=attack violated_invariants=INV-aaa")
    hits = audit_prompt_leakage(build_prompt("m2-stateful-sft", polluted))
    assert any("oracle" in h for h in hits)
    assert any("observable_decision" in h for h in hits)


def test_leakage_audit_blocks_metadata_id_prefixes(episode_factory):
    polluted = episode_factory()
    polluted["observation"]["model_visible"]["evidence"][0]["value"] = (
        "refers to CF-73fe5c7f2284 group state")
    hits = audit_prompt_leakage(build_prompt("m2-stateful-sft", polluted))
    assert any(h.startswith("id-prefix:CF-") for h in hits)


def test_renderer_missing_request_hard_fails(base_episode):
    base_episode["observation"]["model_visible"]["request"]["rendered_text"] = "  "
    with pytest.raises(ValueError):
        render_m1(base_episode)
    with pytest.raises(ValueError):
        render_m2(base_episode)


def test_system_prompt_forbids_extra_keys():
    assert "verdict" in renderer.SYSTEM_PROMPT and "attack_family" in renderer.SYSTEM_PROMPT
    assert renderer.RENDERER_ID == "RENDERER-V1"


def test_target_never_enters_prompt(base_episode):
    prompt = build_prompt("m2-stateful-sft", base_episode)
    target = target_for(base_episode)
    for value in target.values():
        assert target_text(target) not in prompt
