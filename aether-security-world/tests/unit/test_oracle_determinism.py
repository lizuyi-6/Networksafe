"""Oracle 确定性：同入参 ⇒ 逐字节同出参（README 不可协商项 7 / 设计 §8.1 / R7）。

四道防线：

1. **同进程两次执行** ⇒ ``canonical_json`` 相同；
2. **跨进程** ⇒ 两个不同 ``PYTHONHASHSEED`` 的子进程产出逐字节相同
   （集合迭代序 / 字典序 / 哈希随机化都不得渗入标签）；
3. **静态断言** ⇒ oracle 源码里没有 ``time.time`` / ``datetime.now`` / ``random`` /
   ``uuid`` / 环境变量读取；
4. **无副作用** ⇒ 求值不写世界、不写时钟。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from security_world.model import load_world
from security_world.model.canonical import canonical_json
from security_world.oracle import EvidenceView, OracleOutput, run_oracle
from security_world.policy import Action
from asw_worlds import (
    NOW,
    actor,
    evidence,
    make_action,
    make_world,
    resource,
    role,
    run,
    view_of,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def rich_world():
    return make_world(
        roles=(role("ROLE-CUSTOMER"), role("ROLE-SUPPORT")),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), tenant="TEN-001"),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
        ),
        resources=(resource("RES-001", owner="ACT-001", tenant="TEN-001"),),
        policies=(
            {
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
        invariants=(
            {
                "invariant_id": "INV-OWNERSHIP-001",
                "category": "ownership",
                "applies_to": ["read"],
                "severity": "critical",
                "expr": {
                    "op": "or",
                    "args": [
                        {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"},
                                              {"op": "ref", "path": "action.resource.owner"}]},
                        {"op": "and", "args": [
                            {"op": "in", "args": [{"op": "ref", "path": "action.actor.roles"},
                                                  {"op": "lit", "value": ["ROLE-SUPPORT"]}]},
                            {"op": "eq", "args": [{"op": "ref", "path": "action.actor.tenant"},
                                                  {"op": "ref", "path": "action.resource.tenant"}]},
                        ]},
                    ],
                },
            },
            {
                "invariant_id": "INV-TENANT-001",
                "category": "tenant_isolation",
                "applies_to": ["read"],
                "severity": "high",
                "expr": {
                    "op": "or",
                    "args": [
                        {"op": "eq", "args": [{"op": "ref", "path": "action.actor.tenant"},
                                              {"op": "ref", "path": "action.resource.tenant"}]},
                        {"op": "is_empty", "args": [{"op": "ref", "path": "action.actor.tenant"}]},
                    ],
                },
            },
        ),
        evidence_items=(
            evidence("EV-ROLE-001", "actor.ACT-004.roles", ["ROLE-CUSTOMER"]),
            evidence("EV-TENANT-004", "actor.ACT-004.tenant", "TEN-002"),
            evidence("EV-TENANT-001", "actor.ACT-001.tenant", "TEN-001"),
            evidence("EV-TENANT-RES", "resource.RES-001.tenant", "TEN-001"),
            evidence("EV-OWN-001", "resource.RES-001.owner", "ACT-001"),
            evidence("EV-CLIENT-001", "actor.ACT-004.tenant", "TEN-001",
                     trust_level="untrusted", attacker_controllable=True),
            evidence("EV-HIDDEN-001", "resource.RES-001.owner", "ACT-004", visible=False),
        ),
    )


# --------------------------------------------------------------------------- #
# 1. 同进程
# --------------------------------------------------------------------------- #
def test_same_input_twice_is_byte_identical():
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    view = view_of(world)
    first = run_oracle(world, action, view)
    second = run_oracle(world, action, view)
    assert canonical_json(first.to_document()) == canonical_json(second.to_document())


def test_fresh_evidence_view_object_gives_the_same_result():
    """视图对象每次新建（集合顺序可能不同）也不影响输出。"""
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    first = run_oracle(world, action, view_of(world))
    second = run_oracle(world, action, EvidenceView.from_world(world))
    assert canonical_json(first.to_document()) == canonical_json(second.to_document())


def test_every_field_of_the_output_is_stable():
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    view = view_of(world)
    first = run_oracle(world, action, view)
    second = run_oracle(world, action, view)
    assert first.world_truth == second.world_truth
    assert first.observable_decision == second.observable_decision
    assert first.violated_invariants == second.violated_invariants
    assert first.satisfied_invariants == second.satisfied_invariants
    assert first.skipped_invariants == second.skipped_invariants
    assert first.required_evidence == second.required_evidence
    assert first.missing_evidence == second.missing_evidence
    assert first.decision_trace == second.decision_trace
    assert first.evidence_view_id == second.evidence_view_id


def test_many_actions_are_deterministic():
    world = rich_world()
    for actor_id in ("ACT-001", "ACT-004"):
        for visible in (None, ("EV-OWN-001",)):
            action = make_action("read", actor_id, resource_id="RES-001")
            view = view_of(world) if visible is None else view_of(world, visible=visible)
            first = run_oracle(world, action, view)
            second = run_oracle(world, action, view)
            assert canonical_json(first.to_document()) == canonical_json(second.to_document())


# --------------------------------------------------------------------------- #
# 2. 跨进程（PYTHONHASHSEED）
# --------------------------------------------------------------------------- #
_CHILD = """
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(%r)))
from security_world.model import load_world
from security_world.model.canonical import canonical_json
from security_world.oracle import EvidenceView, run_oracle
from security_world.policy import Action

world = load_world(Path(%r) / "schemas/examples/world.example.json")
document = json.loads((Path(%r) / "schemas/examples/episode.example.json").read_text(encoding="utf-8"))
action = Action.from_document(document["action"])
output = run_oracle(world, action, EvidenceView.from_world(world))
sys.stdout.write(canonical_json(output.to_document()))
""" % (str(PROJECT_ROOT), str(PROJECT_ROOT), str(PROJECT_ROOT))


def _run_child(hash_seed: str) -> str:
    env = dict(os.environ)
    env["PYTHONHASHSEED"] = hash_seed
    env["PYTHONPATH"] = str(PROJECT_ROOT)
    completed = subprocess.run(
        [sys.executable, "-c", _CHILD],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(PROJECT_ROOT),
        timeout=120,
    )
    assert completed.returncode == 0, completed.stderr
    return completed.stdout


def test_pythonhashseed_does_not_change_the_output():
    """两个不同的 PYTHONHASHSEED ⇒ 逐字节相同的 oracle 输出。"""
    first = _run_child("0")
    second = _run_child("12345")
    third = _run_child("random")
    assert first == second == third
    assert len(first) > 1000


# --------------------------------------------------------------------------- #
# 3. 静态断言：数据路径上没有挂钟 / 随机源
# --------------------------------------------------------------------------- #
def _oracle_sources() -> str:
    root = PROJECT_ROOT / "security_world"
    texts = []
    for package in ("policy", "invariants", "workflows", "oracle"):
        for path in sorted((root / package).glob("*.py")):
            texts.append(path.read_text(encoding="utf-8"))
    return "\n".join(texts)


@pytest.mark.parametrize(
    "forbidden",
    [
        "time.time(",
        "time.monotonic(",
        "datetime.now(",
        "datetime.today(",
        "utcnow(",
        "random.random(",
        "random.randint(",
        "random.choice(",
        "uuid.uuid",
        "os.urandom(",
        "os.environ",
        "requests.",
        "urllib",
        "socket.",
    ],
)
def test_oracle_source_has_no_nondeterminism_sources(forbidden):
    assert forbidden not in _oracle_sources(), forbidden


def test_oracle_does_not_use_set_iteration_order_in_output():
    """输出里出现的列表都来自 sorted()/文档序，而不是集合迭代序。"""
    source = _oracle_sources()
    # consulted_facts 必须排序
    assert "sorted(needed)" in source
    assert "sorted(consulted_facts)" in source
    assert "sorted(self.facts)" in source


# --------------------------------------------------------------------------- #
# 4. 无副作用
# --------------------------------------------------------------------------- #
def test_evaluation_does_not_mutate_the_world_or_the_view():
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    view = view_of(world)
    before_world = canonical_json(world)
    before_view = canonical_json(view)
    run_oracle(world, action, view)
    assert canonical_json(world) == before_world
    assert canonical_json(view) == before_view


def test_output_is_a_frozen_dataclass():
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    assert isinstance(output, OracleOutput)
    with pytest.raises(Exception):
        output.world_truth = "safe"  # type: ignore[misc]


def test_notes_field_is_optional_and_deterministic():
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    view = view_of(world)
    plain = run_oracle(world, action, view)
    assert "notes" not in plain.to_document()
    annotated = run_oracle(world, action, view, notes="unit-test")
    assert annotated.to_document()["notes"] == "unit-test"
    # notes 不影响判决字段
    assert canonical_json(
        {k: v for k, v in annotated.to_document().items() if k != "notes"}
    ) == canonical_json(plain.to_document())


def test_oracle_rejects_a_bad_version_string():
    world = rich_world()
    action = make_action("read", "ACT-004", resource_id="RES-001")
    view = view_of(world)
    with pytest.raises(Exception):
        run_oracle(world, action, view, version="0.1")


def test_golden_fixture_output_is_stable_across_two_runs():
    world = load_world(PROJECT_ROOT / "schemas/examples/world.example.json")
    document = __import__("json").loads(
        (PROJECT_ROOT / "schemas/examples/episode.example.json").read_text(encoding="utf-8")
    )
    action = Action.from_document(document["action"])
    view = EvidenceView.from_world(world)
    first = run_oracle(world, action, view)
    second = run_oracle(world, action, view)
    assert canonical_json(first.to_document()) == canonical_json(second.to_document())
    assert first.world_truth == "attack"
