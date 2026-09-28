"""``decision_trace``：非空、可复算、无自然语言（设计 §8.3 / §13.1）。

另外断言 ``consulted_facts`` 与 ``evidence.asserts_ref`` **逐字可比**（B14）——
那是"这个 unknown 真的因为证据不足"可被第三方机械检查的唯一途径。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from security_world.model import load_world
from security_world.model.canonical import canonical_json
from security_world.oracle import TRACE_RULES, EvidenceView, run_oracle
from security_world.policy import Action
from asw_worlds import (
    actor,
    make_action,
    make_world,
    resource,
    role,
    run,
    view_of,
    world_with_full_evidence,
)

OWNER_ONLY_POLICY = {
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
DEFAULT_DENY = {
    "policy_id": "POL-DEFAULT-DENY",
    "action": {"operation": "*"},
    "effect": "deny",
    "condition": {"op": "lit", "value": True},
    "priority": -1,
    "is_default_rule": True,
}

# 夹具路径按本文件定位，不依赖进程 CWD——pytest 也可以从仓库根以
# `pytest aether-security-world` 调用，彼时 CWD 并不是项目根。
PROJECT_ROOT = Path(__file__).resolve().parents[2]
WORLD_FIXTURE = PROJECT_ROOT / "schemas/examples/world.example.json"
EPISODE_FIXTURE = PROJECT_ROOT / "schemas/examples/episode.example.json"


def trace_world():
    return make_world(
        roles=(role("ROLE-CUSTOMER"),),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-004", roles=("ROLE-CUSTOMER",)),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(OWNER_ONLY_POLICY, DEFAULT_DENY),
        invariants=(
            {
                "invariant_id": "INV-OWNERSHIP-001",
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
            {
                "invariant_id": "INV-REFUND-ONLY",
                "category": "workflow_transition",
                "applies_to": ["refund"],
                "severity": "high",
                "expr": {
                    "op": "state_is",
                    "args": [
                        {"op": "ref", "path": "action.workflow_instance.current_state"},
                        {"op": "lit", "value": "paid"},
                    ],
                },
            },
        ),
    )


@pytest.fixture()
def output():
    world = trace_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    return run(world_with_full_evidence(world, action), action)


# --------------------------------------------------------------------------- #
# 结构
# --------------------------------------------------------------------------- #
def test_trace_is_not_empty(output):
    assert len(output.decision_trace) >= 1


def test_trace_steps_are_numbered_from_zero_consecutively(output):
    assert [step["step"] for step in output.decision_trace] == list(range(len(output.decision_trace)))


def test_trace_rules_stay_inside_the_documented_vocabulary(output):
    for step in output.decision_trace:
        assert step["rule"] in TRACE_RULES, step["rule"]
        assert set(step) == {"step", "rule", "operands", "result"}


def test_trace_contains_the_expected_rule_sequence(output):
    rules = [step["rule"] for step in output.decision_trace]
    assert rules == [
        "policy.match",
        "policy.evaluate",   # POL-OWNER: condition_false
        "policy.default",    # POL-DEFAULT-DENY: 兜底规则命中
        "invariant.evaluate",
        "invariant.skip",
        "verdict.aggregate",
        "evidence.sufficiency",
        "verdict.observable",
    ]


def test_trace_contains_no_natural_language(output):
    """轨迹是机器记录：每个 result 都是受控词表里的值。"""
    allowed_results = {
        "condition_true", "condition_false", "condition_unbound",
        "satisfied", "violated", "skipped_out_of_scope", "skipped_unbound_subject",
        "allow", "deny", "safe", "attack", "unauthorized",
        "sufficient", "insufficient", "insufficient_evidence",
    }
    for step in output.decision_trace:
        result = step["result"]
        if isinstance(result, str):
            assert result in allowed_results, result
        else:
            # policy.match 的 result 是策略 id 列表
            assert isinstance(result, list) and all(isinstance(item, str) for item in result)


def test_trace_is_recomputable_from_the_same_inputs(output):
    """同入参重跑 ⇒ 逐字节相同的轨迹（可复算的前提）。"""
    world = trace_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    again = run(world_with_full_evidence(world, action), action)
    assert canonical_json(output.decision_trace) == canonical_json(again.decision_trace)


def test_render_trace_is_human_readable_and_debug_only(output):
    lines = output.render_trace()
    assert len(lines) == len(output.decision_trace)
    assert lines[0].startswith("[0] policy.match")
    assert "->" in lines[0]
    # 人读形态带操作数
    assert any("policy_id=POL-OWNER" in line for line in lines)
    assert any("invariant_id=INV-OWNERSHIP-001" in line for line in lines)


# --------------------------------------------------------------------------- #
# consulted_facts ↔ asserts_ref
# --------------------------------------------------------------------------- #
def test_consulted_facts_are_verbatim_comparable_with_asserts_ref(output):
    """B14：每个 consulted fact 都能在 evidence.asserts_ref 里逐字找到。"""
    sufficiency = [s for s in output.decision_trace if s["rule"] == "evidence.sufficiency"][0]
    consulted = sufficiency["operands"]["consulted_facts"]
    assert consulted  # 非空
    assert consulted == sorted(consulted)  # 排序 ⇒ 跨进程确定
    asserted = {item["asserts_ref"] for item in output.required_evidence}
    for fact in consulted:
        assert fact in asserted, fact
    # decision_fact 与 asserts_ref 逐字相同
    for item in output.required_evidence:
        assert item["decision_fact"] == item["asserts_ref"]


def test_short_circuited_branches_are_not_consulted(output):
    """POL-OWNER 的条件是 eq(...)——两条 ref 都读；POL-DEFAULT-DENY 是 lit true——不读。"""
    sufficiency = [s for s in output.decision_trace if s["rule"] == "evidence.sufficiency"][0]
    consulted = set(sufficiency["operands"]["consulted_facts"])
    assert "resource.RES-001.owner" in consulted
    # actor_id 是"自建立"绑定，不是需要证据的事实
    assert "actor.ACT-004.actor_id" not in consulted


def test_required_evidence_records_the_trust_level_and_observability(output):
    for item in output.required_evidence:
        assert item["trust_level"] in {"trusted", "semi_trusted", "untrusted", "derived"}
        assert isinstance(item["observable"], bool)


def test_missing_evidence_reasons_are_machine_readable():
    world = trace_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    hidden = run(world, action, view_of(world, visible=()))
    assert hidden.observable_decision == "insufficient_evidence"
    for item in hidden.missing_evidence:
        assert item["reason"] in {
            "not_rendered", "attacker_controlled_only", "contradictory",
            "stale", "untrusted_source", "derived_only",
        }
        assert item["evidence_id"] is None  # 没有任何可见证据


# --------------------------------------------------------------------------- #
# 黄金 fixture 的轨迹
# --------------------------------------------------------------------------- #
def test_golden_fixture_trace_matches_the_reference():
    """黄金 episode 的 oracle_output 是 schemas/examples 里的参考工件。

    逐字段对齐（``evidence_view_id`` 是夹具里手写的占位值，无法逐字复算；
    ``consulted_facts`` 的差异见 :func:`test_golden_consulted_facts_deviation`）。
    """
    world = load_world(WORLD_FIXTURE)
    document = json.loads(EPISODE_FIXTURE.read_text(encoding="utf-8"))
    action = Action.from_document(document["action"])
    output = run_oracle(world, action, EvidenceView.from_world(world))
    expected = document["oracle_output"]

    assert output.world_truth == expected["world_truth"]
    assert output.observable_decision == expected["observable_decision"]
    assert list(output.violated_invariants) == expected["violated_invariants"]
    assert list(output.satisfied_invariants) == expected["satisfied_invariants"]
    assert [dict(item) for item in output.skipped_invariants] == expected["skipped_invariants"]
    assert output.oracle_version == expected["oracle_version"]
    # 轨迹的 rule 序列与 result 序列逐条相同
    assert [step["rule"] for step in output.decision_trace] == [
        step["rule"] for step in expected["decision_trace"]
    ]
    assert [step["result"] for step in output.decision_trace] == [
        step["result"] for step in expected["decision_trace"]
    ]
    # policy.match 的结果列表逐字相同
    assert output.decision_trace[0]["result"] == expected["decision_trace"][0]["result"]


def test_golden_consulted_facts_deviation():
    """如实记录的偏差：黄金夹具的 ``consulted_facts`` 有 8 条，本实现给 7 条。

    差的是 ``session.SES-003.revoked``：它在 ``INV-SESSION-REVOCATION-001`` 的
    ``and(eq(valid,true), eq(revoked,false))`` 的**第二个合取项**里，而
    ``session.SES-003.valid`` 已经是 false ⇒ 该分支被短路，按设计 §8.2 与
    ``schemas/oracle-output.schema.json`` 的 ``decision_trace`` 描述
    （"short-circuited branches excluded"）不计入 consulted_facts。

    契约权威（schema 描述 + 设计 §8.2 / B3）与夹具数据在此不一致；本实现跟随
    schema 描述，并把这个差异显式记录下来，而不是悄悄改一边。
    """
    world = load_world(WORLD_FIXTURE)
    document = json.loads(EPISODE_FIXTURE.read_text(encoding="utf-8"))
    action = Action.from_document(document["action"])
    output = run_oracle(world, action, EvidenceView.from_world(world))
    expected = document["oracle_output"]

    sufficiency = [s for s in output.decision_trace if s["rule"] == "evidence.sufficiency"][0]
    produced = set(sufficiency["operands"]["consulted_facts"])
    reference = set(
        [s for s in expected["decision_trace"] if s["rule"] == "evidence.sufficiency"][0][
            "operands"
        ]["consulted_facts"]
    )
    assert produced < reference
    assert reference - produced == {"session.SES-003.revoked"}
    # 其余 7 条逐字相同，且都能在 asserts_ref 里找到（B14 的性质仍然成立）
    asserted = {item["asserts_ref"] for item in output.required_evidence}
    assert produced <= asserted


def test_golden_required_evidence_is_a_subset_of_the_reference():
    """``required_evidence`` 只少那条短路分支的证据；其余条目字段一致。"""
    world = load_world(WORLD_FIXTURE)
    document = json.loads(EPISODE_FIXTURE.read_text(encoding="utf-8"))
    action = Action.from_document(document["action"])
    output = run_oracle(world, action, EvidenceView.from_world(world))
    expected = document["oracle_output"]

    produced = {(item["evidence_id"], item["decision_fact"]) for item in output.required_evidence}
    reference = {(item["evidence_id"], item["decision_fact"]) for item in expected["required_evidence"]}
    assert produced < reference
    assert reference - produced == {("EV-SESS-003", "session.SES-003.revoked")}
    by_id = {item["evidence_id"]: item for item in output.required_evidence}
    for item in expected["required_evidence"]:
        if item["evidence_id"] in by_id:
            assert by_id[item["evidence_id"]]["trust_level"] == item["trust_level"]
            assert by_id[item["evidence_id"]]["observable"] == item["observable"]
            assert by_id[item["evidence_id"]].get("contradicted", False) == item.get("contradicted", False)
