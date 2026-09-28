"""G3 policy 可执行性：§8.4 非空洞性探针 + 攻击族可达性（§10.5）。

正例：HC-001 世界的每条策略都探得过；负例：一条 ``lit(true)`` 的 allow 策略必须被
判 ``G3_policy_vacuous``，一条恒假条件必须被 ``G3_policy_never_allows``——并且断言
拒绝路径带 reason code，不只是"被拒"。
"""
from __future__ import annotations

from security_world.policy import Action
from security_world.validation import probe_world_policies, run_gates

from asw_worlds import actor, make_action, make_world, resource, role, session


def _probe(world, operation: str = "read", actor_id: str = "ACT-003", session_id: str | None = None):
    return make_action(
        operation, actor_id, resource_id="RES-001", flow_id="FLOW-READ", session_id=session_id
    )


def test_g3_accepts_the_reference_world(hc001_family, hc001_world) -> None:
    action = hc001_family.base.action
    if not isinstance(action, Action):
        from security_world.policy import Action as _Action

        action = _Action.from_document(action)
    results = probe_world_policies(hc001_world, action)
    assert results, "至少要有默认拒绝策略"
    for result in results:
        assert result.reason_code is None, result.to_document()
        assert result.probe_world_count >= 1


def test_g3_rejects_a_vacuous_allow_policy() -> None:
    """``condition: lit(true)`` 的 allow ⇒ 无条件放行 ⇒ policy 空洞。"""
    world = make_world(
        world_id="W-G3-VACUOUS",
        policies=(
            {
                "policy_id": "POL-ALWAYS-ALLOW",
                "description": "vacuous allow: always true",
                "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {"op": "lit", "value": True},
                "priority": 100,
            },
        ),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    results = {result.policy_id: result for result in probe_world_policies(world, _probe(world))}
    vacuous = results["POL-ALWAYS-ALLOW"]
    assert vacuous.vacuous
    assert vacuous.reason_code == "G3_policy_vacuous"
    assert all(outcome == "true" for outcome in vacuous.condition_outcomes)


def test_g3_rejects_a_never_allowing_policy() -> None:
    """恒假条件 ⇒ 死规则：任何动作都匹配不上它。

    条件读 ``action.session.revoked``，因此探针动作必须**绑定**一个 session——
    否则该 ref 展开不了、被探针跳过，域为空，"永拒"就证明不了。
    """
    world = make_world(
        world_id="W-G3-DEAD",
        policies=(
            {
                "policy_id": "POL-NEVER",
                "description": "dead rule: condition can never hold",
                "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {
                    "op": "and",
                    "args": [
                        {"op": "eq", "args": [
                            {"op": "ref", "path": "action.session.revoked"},
                            {"op": "lit", "value": False},
                        ]},
                        {"op": "eq", "args": [
                            {"op": "ref", "path": "action.session.revoked"},
                            {"op": "lit", "value": True},
                        ]},
                    ],
                },
                "priority": 100,
            },
        ),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        sessions=(session("SES-001", principal="ACT-003"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    results = {
        result.policy_id: result
        for result in probe_world_policies(world, _probe(world, session_id="SES-001"))
    }
    dead = results["POL-NEVER"]
    assert dead.never_allows
    assert dead.reason_code == "G3_policy_never_allows"


def test_g3_rejects_an_unparseable_policy() -> None:
    world = make_world(
        world_id="W-G3-PARSE",
        policies=(
            {
                "policy_id": "POL-BROKEN",
                "description": "unknown op",
                "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {"op": "teleport", "args": []},
                "priority": 100,
            },
        ),
        actors=(actor("ACT-003", roles=("ROLE-CUSTOMER",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
        # 未知 op 连 world.schema.json 都过不了，因此跳过构造期校验，直接测探针
        validate=False,
    )
    results = {result.policy_id: result for result in probe_world_policies(world, _probe(world))}
    assert results["POL-BROKEN"].reason_code == "G3_policy_unparseable"


def test_g3_gate_reports_the_reason_code(hc001_family, hc001_world) -> None:
    """把一条空洞策略塞进家族世界，门禁必须带 reason code 失败。"""
    document = hc001_world.to_document()
    document["policies"].append(
        {
            "policy_id": "POL-INJECTED-VACUOUS",
            "description": "injected vacuous allow",
            "action": {"operation": "read", "resource_type": "order"},
            "effect": "allow",
            "condition": {"op": "lit", "value": True},
            "priority": 200,
        }
    )
    from security_world.model import WorldInstance

    broken = WorldInstance.from_document(document)
    # 不给 family：G3 探针跑在调用方给的世界上（给了 family 时它跑在家族的 base
    # 世界上——策略图属于世界而不是某个反事实变体）。
    report = run_gates(hc001_family.base, world=broken)
    result = report.result("G3_policy_executability")
    assert result is not None and not result.passed
    assert "G3_policy_vacuous" in result.detail
    assert "POL-INJECTED-VACUOUS" in result.detail


def test_g3_attack_family_reachability_flags_an_unreachable_family(corpus) -> None:
    """声明了一个世界里表达不出来的攻击族 ⇒ 硬失败（§10.5）。"""
    from security_world.validation.probe import attack_family_reachability

    world = corpus[0]
    result = attack_family_reachability(
        [], declared_families={world.world_id: "no_such_attack_family"}
    )
    assert result and not result[0].reachable
    assert result[0].declared_worlds == 1
    assert result[0].reachable_samples == 0
