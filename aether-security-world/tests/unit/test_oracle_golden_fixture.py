"""Oracle 输出的 schema 合规性 + 黄金 fixture 对齐 + 证据桥单向性。

``oracle-output.schema.json`` 是契约权威（本任务的输入约定），因此 oracle 的产出
必须**逐个场景**过该 schema——不是一个场景过了就假定其余场景也过。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from security_world.model import load_world, validate_document
from security_world.model.canonical import canonical_json
from security_world.oracle import EvidenceView, run_oracle
from security_world.policy import Action
from asw_worlds import (
    actor,
    evidence,
    make_action,
    make_world,
    resource,
    role,
    run,
    view_of,
    world_with_full_evidence,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]


# --------------------------------------------------------------------------- #
# schema 合规
# --------------------------------------------------------------------------- #
def _scenarios():
    """四种 observable_decision 各至少一个场景。"""
    base_actors = (actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",)))
    base_resources = (resource("RES-001", owner="ACT-001"),)
    owner_policy = {
        "policy_id": "POL-OWNER",
        "action": {"operation": "read", "resource_type": "order"},
        "effect": "allow",
        "condition": {
            "op": "eq",
            "args": [
                {"op": "ref", "path": "action.actor.actor_id"},
                {"op": "ref", "path": "action.resource.owner"},
            ],
        },
        "priority": 100,
    }
    default_deny = {
        "policy_id": "POL-DEFAULT-DENY",
        "action": {"operation": "*"},
        "effect": "deny",
        "condition": {"op": "lit", "value": True},
        "priority": -1,
        "is_default_rule": True,
    }
    ownership = {
        "invariant_id": "INV-OWN",
        "category": "ownership",
        "applies_to": ["read"],
        "severity": "critical",
        "expr": {
            "op": "eq",
            "args": [
                {"op": "ref", "path": "action.actor.actor_id"},
                {"op": "ref", "path": "action.resource.owner"},
            ],
        },
    }
    full = (
        evidence("EV-OWN", "resource.RES-001.owner", "ACT-001"),
        evidence("EV-ROLE-004", "actor.ACT-004.roles", ["ROLE-CUSTOMER"]),
    )

    def world_with(*, policies, invariants, items, extra_actors=()):
        return make_world(
            actors=base_actors + extra_actors,
            resources=base_resources,
            policies=policies,
            invariants=invariants,
            evidence_items=items,
        )

    yield "safe", world_with(
        policies=(owner_policy, default_deny), invariants=(), items=full
    ), make_action("read", "ACT-001", resource_id="RES-001"), None
    yield "attack", world_with(
        policies=(owner_policy, default_deny), invariants=(ownership,), items=full
    ), make_action("read", "ACT-004", resource_id="RES-001"), None
    yield "unauthorized", world_with(
        policies=(default_deny,), invariants=(), items=full
    ), make_action("read", "ACT-001", resource_id="RES-001"), None
    yield "insufficient_evidence", world_with(
        policies=(owner_policy, default_deny), invariants=(ownership,), items=()
    ), make_action("read", "ACT-004", resource_id="RES-001"), ()


@pytest.mark.parametrize(
    "expected,world,action,visible", list(_scenarios()), ids=lambda item: str(item)
)
def test_output_document_validates_against_the_schema(expected, world, action, visible):
    view = view_of(world) if visible is None else view_of(world, visible=visible)
    output = run_oracle(world, action, view)
    assert output.observable_decision == expected
    document = output.to_document()
    errors = validate_document(document, "oracle-output")
    assert not errors, "oracle 输出未通过 oracle-output.schema.json:\n  - " + "\n  - ".join(errors)


def test_action_document_validates_against_the_schema():
    action = make_action(
        "read", "ACT-001", resource_id="RES-001", session_id="SES-001",
        parameters={"amount": 1}, request={"method": "GET"},
    )
    errors = validate_document(action.to_document(), "action")
    assert not errors, errors


def test_golden_episode_documents_are_schema_valid():
    """黄金 world / episode / policy bundle 三份工件都过 schema。"""
    world = load_world(PROJECT_ROOT / "schemas/examples/world.example.json")
    episode = json.loads(
        (PROJECT_ROOT / "schemas/examples/episode.example.json").read_text(encoding="utf-8")
    )
    policy_bundle = json.loads(
        (PROJECT_ROOT / "schemas/examples/policy.example.json").read_text(encoding="utf-8")
    )
    assert not validate_document(world.to_document(), "world")
    assert not validate_document(episode, "episode")
    assert not validate_document(policy_bundle, "policy")


# --------------------------------------------------------------------------- #
# 黄金 fixture 对齐
# --------------------------------------------------------------------------- #
def _golden():
    world = load_world(PROJECT_ROOT / "schemas/examples/world.example.json")
    episode = json.loads(
        (PROJECT_ROOT / "schemas/examples/episode.example.json").read_text(encoding="utf-8")
    )
    action = Action.from_document(episode["action"])
    return world, action, EvidenceView.from_world(world), episode["oracle_output"]


def test_golden_verdicts_match():
    world, action, view, expected = _golden()
    output = run_oracle(world, action, view)
    assert output.world_truth == expected["world_truth"] == "attack"
    assert output.observable_decision == expected["observable_decision"] == "attack"
    assert list(output.violated_invariants) == expected["violated_invariants"]
    assert list(output.satisfied_invariants) == expected["satisfied_invariants"]
    assert [dict(item) for item in output.skipped_invariants] == expected["skipped_invariants"]
    assert list(output.missing_evidence) == []


def test_golden_consulted_facts_are_all_asserted_by_evidence():
    """B14：每个 consulted fact 都能在 ``asserts_ref`` 里逐字找到。"""
    world, action, view, _expected = _golden()
    output = run_oracle(world, action, view)
    sufficiency = [s for s in output.decision_trace if s["rule"] == "evidence.sufficiency"][0]
    consulted = sufficiency["operands"]["consulted_facts"]
    asserted = {item["asserts_ref"] for item in output.required_evidence}
    missing = [fact for fact in consulted if fact not in asserted]
    assert missing == []


def test_golden_trace_operands_for_policy_steps():
    world, action, view, expected = _golden()
    output = run_oracle(world, action, view)
    for produced, reference in zip(output.decision_trace, expected["decision_trace"]):
        assert produced["rule"] == reference["rule"]
        if reference["rule"] in ("policy.match", "policy.default"):
            assert produced["result"] == reference["result"]
        if reference["rule"] == "policy.evaluate":
            assert produced["operands"]["policy_id"] == reference["operands"]["policy_id"]
            assert produced["operands"]["ref"] == reference["operands"]["ref"]
            assert produced["result"] == reference["result"]
        if reference["rule"] == "invariant.skip":
            assert produced["operands"] == reference["operands"]
            assert produced["result"] == reference["result"]


# --------------------------------------------------------------------------- #
# 证据桥单向性
# --------------------------------------------------------------------------- #
def test_evidence_bridge_cannot_turn_a_verdict_into_attack():
    """B19：桥只能把 verdict 降级成 insufficient_evidence，永远不能变成 attack。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(
            {
                "policy_id": "POL-OWNER",
                "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {
                    "op": "and",
                    "args": [
                        {"op": "eq", "args": [
                            {"op": "ref", "path": "action.actor.actor_id"},
                            {"op": "ref", "path": "action.resource.owner"},
                        ]},
                        {"op": "establishing_evidence_exists",
                         "args": ["resource.RES-001.owner"]},
                    ],
                },
                "priority": 100,
            },
            {
                "policy_id": "POL-DEFAULT-DENY",
                "action": {"operation": "*"},
                "effect": "deny",
                "condition": {"op": "lit", "value": True},
                "priority": -1,
                "is_default_rule": True,
            },
        ),
    )
    owner = make_action("read", "ACT-001", resource_id="RES-001")

    # 证据可见 ⇒ 策略放行 ⇒ safe
    with_evidence = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(
            {
                "policy_id": "POL-OWNER",
                "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {
                    "op": "and",
                    "args": [
                        {"op": "eq", "args": [
                            {"op": "ref", "path": "action.actor.actor_id"},
                            {"op": "ref", "path": "action.resource.owner"},
                        ]},
                        {"op": "establishing_evidence_exists",
                         "args": ["resource.RES-001.owner"]},
                    ],
                },
                "priority": 100,
            },
            {
                "policy_id": "POL-DEFAULT-DENY",
                "action": {"operation": "*"},
                "effect": "deny",
                "condition": {"op": "lit", "value": True},
                "priority": -1,
                "is_default_rule": True,
            },
        ),
        evidence_items=(evidence("EV-OWN", "resource.RES-001.owner", "ACT-001"),),
    )
    output = run_oracle(with_evidence, owner, view_of(with_evidence))
    assert output.world_truth == "safe"
    assert output.observable_decision == "safe"

    # 证据不可见 ⇒ 桥为 False ⇒ 只可能 insufficient，绝不可能 attack
    hidden = view_of(with_evidence, visible=())
    output = run_oracle(with_evidence, owner, hidden)
    assert output.observable_decision == "insufficient_evidence"
    assert output.world_truth == "safe"
    assert "attack" != output.observable_decision


def test_evidence_bridge_does_not_participate_in_world_truth():
    """truth 趟不看证据：把全部证据藏起来，world_truth 不变。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(
            {
                "invariant_id": "INV-OWN",
                "category": "ownership",
                "applies_to": ["read"],
                "severity": "critical",
                "expr": {
                    "op": "and",
                    "args": [
                        {"op": "eq", "args": [
                            {"op": "ref", "path": "action.actor.actor_id"},
                            {"op": "ref", "path": "action.resource.owner"},
                        ]},
                        {"op": "establishing_evidence_exists", "args": ["resource.RES-001.owner"]},
                    ],
                },
            },
        ),
    )
    intruder = make_action("read", "ACT-004", resource_id="RES-001")
    visible = run(world, intruder, view_of(world))
    masked = run(world, intruder, view_of(world, visible=()))
    assert visible.world_truth == masked.world_truth == "attack"
    assert visible.observable_decision == "insufficient_evidence"
    assert masked.observable_decision == "insufficient_evidence"


def test_llm_cannot_influence_labels():
    """结构性论证：oracle 的输入只有 (world, action, evidence_view)，没有生成器假设。

    给一个"假设与 oracle 结论相反"的世界（hypotheses 说 safe），verdict 仍由程序算。
    """
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        invariants=(
            {
                "invariant_id": "INV-OWN",
                "category": "ownership",
                "applies_to": ["read"],
                "severity": "critical",
                "expr": {
                    "op": "eq",
                    "args": [
                        {"op": "ref", "path": "action.actor.actor_id"},
                        {"op": "ref", "path": "action.resource.owner"},
                    ],
                },
            },
        ),
    )
    intruder = make_action("read", "ACT-004", resource_id="RES-001")
    output = run(world_with_full_evidence(world, intruder), intruder)
    # 世界里没有任何地方能写"verdict"：world.schema.json 是 additionalProperties:false
    assert set(world.to_document()) & {"ground_truth", "verdict", "hypotheses", "attack_family"} == set()
    assert output.world_truth == "attack"


def test_output_round_trips_through_json():
    world, action, view, _expected = _golden()
    output = run_oracle(world, action, view)
    text = canonical_json(output.to_document())
    again = json.loads(text)
    assert canonical_json(again) == text
