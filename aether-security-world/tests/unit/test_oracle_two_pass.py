"""Oracle 两趟算法：``world_truth`` 与 ``observable_decision`` 的分离（设计 §8.2）。

核心场景：**陈旧缓存说 owner=Alice、真值是 Bob** ⇒ ``observable_decision=safe``
而 ``world_truth=attack``。 observable 趟在"已建立事实表"上重跑同一套规则，因此
证据可以让判决偏离真值——但只在"证据建立得起来"的方向上，缺证据只会得到
``insufficient_evidence``，永远不会把 attack 洗成 safe。
"""
from __future__ import annotations

import pytest

from security_world.model.canonical import canonical_json
from security_world.oracle import (
    FactStatus,
    build_fact_table,
    run_oracle,
)
from asw_worlds import (
    NOW,
    actor,
    evidence,
    make_action,
    make_world,
    override,
    resource,
    role,
    run,
    view_of,
    world_with_full_evidence,
)

OWNER_ONLY_POLICY = {
    "policy_id": "POL-OWNER",
    "description": "owner only read",
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

OWNERSHIP_INVARIANT = {
    "invariant_id": "INV-OWNERSHIP-001",
    "category": "ownership",
    "applies_to": ["read"],
    "severity": "critical",
    "description": "A resource read must be performed by its owner.",
    "expr": {
        "op": "eq",
        "args": [
            {"op": "ref", "path": "action.actor.actor_id"},
            {"op": "ref", "path": "action.resource.owner"},
        ],
    },
}


OWNER_OR_SUPPORT_INVARIANT = {
    "invariant_id": "INV-OWNER-OR-SUPPORT",
    "category": "ownership",
    "applies_to": ["read"],
    "severity": "critical",
    "description": "Owner, or a support agent.",
    "expr": {
        "op": "or",
        "args": [
            {
                "op": "eq",
                "args": [
                    {"op": "ref", "path": "action.actor.actor_id"},
                    {"op": "ref", "path": "action.resource.owner"},
                ],
            },
            {
                "op": "in",
                "args": [
                    {"op": "ref", "path": "action.actor.roles"},
                    {"op": "lit", "value": ["ROLE-SUPPORT"]},
                ],
            },
        ],
    },
}


def stale_world():
    """真值 owner=ACT-002，但（唯一可见的）证据说 owner=ACT-001。"""
    return make_world(
        roles=(role("ROLE-CUSTOMER"), role("ROLE-SUPPORT")),
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-002", roles=("ROLE-CUSTOMER",)),
        ),
        resources=(resource("RES-001", owner="ACT-002"),),
        policies=(OWNER_ONLY_POLICY,),
        invariants=(OWNERSHIP_INVARIANT,),
        evidence_items=(
            evidence("EV-OWN-STALE", "resource.RES-001.owner", "ACT-001"),
        ),
    )


# --------------------------------------------------------------------------- #
# 分离
# --------------------------------------------------------------------------- #
def test_stale_cache_makes_observable_safe_while_truth_is_attack():
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    assert output.world_truth == "attack"
    assert output.observable_decision == "safe"
    assert output.violated_invariants == ("INV-OWNERSHIP-001",)
    assert output.missing_evidence == ()


def test_fresh_evidence_agrees_with_the_world():
    world = override(stale_world(), "resource.RES-001.owner", "ACT-001")
    action = make_action("read", "ACT-001", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    assert output.world_truth == "safe"
    assert output.observable_decision == "safe"


def test_missing_evidence_yields_insufficient_even_when_truth_is_attack():
    """隐藏唯一证据 ⇒ insufficient_evidence；truth 趟不受影响。"""
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    hidden = view_of(world, visible=())  # 什么都没有可见
    output = run_oracle(world, action, hidden)
    assert output.world_truth == "attack"
    assert output.observable_decision == "insufficient_evidence"
    assert [item["decision_fact"] for item in output.missing_evidence] == [
        "resource.RES-001.owner"
    ]
    assert output.missing_evidence[0]["reason"] == "not_rendered"


def test_insufficient_evidence_never_launders_an_attack_into_safe():
    """缺证据只能是 insufficient，不能是 safe（R2 的混杂要求）。"""
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    for visible in ((), ("EV-OWN-STALE",)):
        output = run_oracle(world, action, view_of(world, visible=visible))
        assert output.observable_decision in {"safe", "insufficient_evidence"}


# --------------------------------------------------------------------------- #
# 事实状态机（六类 status）
# --------------------------------------------------------------------------- #
def _fact(world, action, view, fact_key):
    table = build_fact_table(world, action, view, consulted_facts=frozenset({fact_key}))
    return table.facts[fact_key]


def test_fact_status_established():
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(world, action, view_of(world), "resource.RES-001.owner")
    assert fact.status is FactStatus.ESTABLISHED
    assert fact.value == "ACT-001"
    assert fact.evidence_ids == ("EV-OWN-STALE",)


def test_fact_status_missing():
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(world, action, view_of(world, visible=()), "resource.RES-001.owner")
    assert fact.status is FactStatus.MISSING
    assert fact.reason == "not_rendered"


def test_fact_status_unverifiable_attacker_controlled_only():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(OWNER_ONLY_POLICY,),
        evidence_items=(
            evidence(
                "EV-HEADER",
                "resource.RES-001.owner",
                "ACT-001",
                trust_level="untrusted",
                attacker_controllable=True,
                provenance="client_supplied",
                evidence_type="http_header",
            ),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(world, action, view_of(world), "resource.RES-001.owner")
    assert fact.status is FactStatus.UNVERIFIABLE
    assert fact.reason == "attacker_controlled_only"
    output = run_oracle(world, action, view_of(world))
    assert output.observable_decision == "insufficient_evidence"


def test_fact_status_unverifiable_derived_only():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        evidence_items=(
            evidence(
                "EV-SUM",
                "resource.RES-001.owner",
                "ACT-001",
                trust_level="derived",
                provenance="llm_derived",
                evidence_type="derived_summary",
                visible=True,
            ),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(world, action, view_of(world), "resource.RES-001.owner")
    assert fact.reason == "derived_only"


def test_fact_status_unverifiable_untrusted_source():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        evidence_items=(
            evidence(
                "EV-UNTRUSTED",
                "resource.RES-001.owner",
                "ACT-001",
                trust_level="untrusted",
                attacker_controllable=False,
            ),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(world, action, view_of(world), "resource.RES-001.owner")
    assert fact.reason == "untrusted_source"


def test_fact_status_contradictory():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(OWNER_ONLY_POLICY,),
        evidence_items=(
            evidence("EV-A", "resource.RES-001.owner", "ACT-001"),
            evidence("EV-B", "resource.RES-001.owner", "ACT-002"),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(world, action, view_of(world), "resource.RES-001.owner")
    assert fact.status is FactStatus.CONTRADICTORY
    assert fact.reason == "contradictory"
    output = run_oracle(world, action, view_of(world))
    assert output.observable_decision == "insufficient_evidence"
    # 两条都被标 contradicted
    assert {item["evidence_id"] for item in output.required_evidence} == {"EV-A", "EV-B"}
    assert all(item.get("contradicted") is True for item in output.required_evidence)


def test_fact_status_stale_only_when_a_policy_requires_fresh():
    """``requires_fresh`` 打开前，陈旧证据仍然能建立事实。"""
    fresh_policy = dict(OWNER_ONLY_POLICY)
    stale_world_doc = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(OWNER_ONLY_POLICY,),
        evidence_items=(
            evidence("EV-STALE", "resource.RES-001.owner", "ACT-001", freshness="stale"),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    fact = _fact(stale_world_doc, action, view_of(stale_world_doc), "resource.RES-001.owner")
    assert fact.status is FactStatus.ESTABLISHED

    requires_fresh = dict(OWNER_ONLY_POLICY)
    requires_fresh["requires_fresh"] = True
    strict_world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(requires_fresh,),
        evidence_items=(
            evidence("EV-STALE", "resource.RES-001.owner", "ACT-001", freshness="stale"),
        ),
    )
    fact = _fact(strict_world, action, view_of(strict_world), "resource.RES-001.owner")
    assert fact.status is FactStatus.STALE
    assert fact.reason == "stale"
    output = run_oracle(strict_world, action, view_of(strict_world))
    assert output.observable_decision == "insufficient_evidence"


def test_trust_two_dimensions_are_independent():
    """trust_level 与 attacker_controllable 是两个维度：untrusted 且非攻击者可控
    仍然是 untrusted_source，而不是 attacker_controlled_only。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        evidence_items=(
            evidence(
                "EV-LOG",
                "resource.RES-001.owner",
                "ACT-001",
                trust_level="untrusted",
                attacker_controllable=False,
                provenance="log_pipeline",
            ),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    assert _fact(world, action, view_of(world), "resource.RES-001.owner").reason == "untrusted_source"


def test_hidden_evidence_never_appears_in_required_evidence():
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(OWNER_ONLY_POLICY,),
        evidence_items=(
            evidence("EV-VISIBLE", "resource.RES-001.owner", "ACT-001"),
            evidence("EV-HIDDEN", "resource.RES-001.owner", "ACT-002", visible=False),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    ids = {item["evidence_id"] for item in output.required_evidence}
    assert "EV-VISIBLE" in ids
    assert "EV-HIDDEN" not in ids
    # 隐藏项不进事实表 ⇒ 不构成矛盾
    assert output.observable_decision == "safe"


# --------------------------------------------------------------------------- #
# observable 趟的分支敏感性
# --------------------------------------------------------------------------- #
def test_observable_pass_that_reads_more_facts_needs_them_established():
    """truth 趟短路在"属主"分支；observable 趟（owner 被证据改成别人）走到
    support 分支并读到 ``actor.roles``——那个事实没有证据 ⇒ insufficient。"""
    world = make_world(
        roles=(role("ROLE-CUSTOMER"), role("ROLE-SUPPORT")),
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-002"),),
        policies=(OWNER_ONLY_POLICY,),
        invariants=(OWNER_OR_SUPPORT_INVARIANT,),
        evidence_items=(
            # 只有 owner 一条证据，且说 owner=ACT-001（与真值 ACT-002 不同）
            evidence("EV-OWN", "resource.RES-001.owner", "ACT-001"),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    assert output.world_truth == "attack"
    assert output.observable_decision == "insufficient_evidence"
    assert "actor.ACT-001.roles" in {item["decision_fact"] for item in output.missing_evidence}


def test_observable_pass_converges_when_every_read_fact_is_established():
    world = make_world(
        roles=(role("ROLE-CUSTOMER"), role("ROLE-SUPPORT")),
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-002"),),
        policies=(OWNER_ONLY_POLICY,),
        invariants=(OWNER_OR_SUPPORT_INVARIANT,),
        evidence_items=(
            evidence("EV-OWN", "resource.RES-001.owner", "ACT-001"),
            evidence("EV-ROLE", "actor.ACT-001.roles", ["ROLE-CUSTOMER"]),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    assert output.world_truth == "attack"
    # 已建立的 owner=ACT-001 ⇒ 策略放行；属主分支也满足 ⇒ observable safe
    assert output.observable_decision == "safe"


def test_evidence_view_id_covers_world_action_and_visible_evidence():
    """S2/S11：同 ``(world, action, evidence_view_id)`` ⇒ 同 output。"""
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    first = run_oracle(world, action, view_of(world))
    second = run_oracle(world, action, view_of(world))
    assert first.evidence_view_id == second.evidence_view_id
    assert len(first.evidence_view_id) == 64
    # 换一个 action ⇒ view id 变（action_id 是 view id 的输入之一）
    other = make_action("read", "ACT-002", resource_id="RES-001", action_id="ACTN-000002-000")
    assert run_oracle(world, other, view_of(world)).evidence_view_id != first.evidence_view_id
    # 换可见证据集合 ⇒ view id 也变
    masked = view_of(world, visible=())
    assert run_oracle(world, action, masked).evidence_view_id != first.evidence_view_id


def test_full_evidence_helper_makes_the_observable_pass_decidable():
    """``world_with_full_evidence`` 让 observable 趟可判定，从而隔离 truth 趟结论。"""
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",)),
            actor("ACT-004", roles=("ROLE-CUSTOMER",)),
        ),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(OWNER_ONLY_POLICY,),
        invariants=(OWNERSHIP_INVARIANT,),
    )
    intruder = make_action("read", "ACT-004", resource_id="RES-001")
    output = run(world_with_full_evidence(world, intruder), intruder)
    assert output.world_truth == "attack"
    assert output.observable_decision == "attack"
    assert output.missing_evidence == ()


# --------------------------------------------------------------------------- #
# 边界：无法在覆盖后世界里表示的值
# --------------------------------------------------------------------------- #
def test_overlay_rejects_unrepresentable_values():
    """如实记录的窄边界：L1 的 ``to_document`` 会丢掉**空**可选集合。

    于是一条"``actor.ACT-001.groups == []``"的已建立证据无法写进覆盖后的世界。
    此时抛 :class:`OverlayError` 而不是静默用回世界真值——后者会让 observable
    趟偷偷读真值，那是 ground truth 漏洞。
    """
    from security_world.oracle import OverlayError, override_world_values

    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",), groups=("G-ALPHA",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
    )
    # 非空值可以覆盖
    patched = override_world_values(world, {"actor.ACT-001.groups": ["G-BETA"]})
    assert patched.resolve("actor.ACT-001.groups") == ["G-BETA"]
    assert world.resolve("actor.ACT-001.groups") == ["G-ALPHA"]  # 原世界不变
    with pytest.raises(OverlayError):
        override_world_values(world, {"actor.ACT-001.groups": []})


def test_concept_expression_owner_only_read():
    """需求原文的概念表达：``allow read(resource) if principal == resource.owner``。"""
    world = make_world(
        actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)), actor("ACT-004", roles=("ROLE-CUSTOMER",))),
        resources=(resource("RES-001", owner="ACT-001"),),
        policies=(
            {
                "policy_id": "POL-ORDER-READ-OWNER",
                "description": "Reading an order requires the caller to be its owner.",
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
                "rationale": "owner_only read",
            },
        ),
    )
    owner = make_action("read", "ACT-001", resource_id="RES-001")
    intruder = make_action("read", "ACT-004", resource_id="RES-001")
    from security_world.policy import decide_policy

    assert decide_policy(world, owner).effect == "allow"
    assert decide_policy(world, intruder).effect == "deny"


def test_output_document_is_json_serialisable():
    world = stale_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")
    output = run_oracle(world, action, view_of(world))
    text = canonical_json(output.to_document())
    assert '"world_truth":"attack"' in text
    assert '"observable_decision":"safe"' in text
