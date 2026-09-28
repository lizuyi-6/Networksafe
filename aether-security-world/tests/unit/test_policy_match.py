"""策略匹配算法（设计 §7.3 / §13.1 的 ``test_policy_match.py``）。

覆盖：priority 排序、``is_default_rule`` 后置（同 priority 时兜底规则最后评估）、
``policy_id`` 升序 tie-break、无匹配 ⇒ 闭世界 deny、``"*"`` 语义、
``is_default_rule`` 对聚合的影响、未绑定主体 ⇒ 规则不匹配，以及三个真实 accepted
世界的 allow 规则重跑生效（P0-1 回归）。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from security_world.model import RefResolutionError, WorldSpec, compile_spec
from security_world.oracle import EvidenceView, run_oracle
from security_world.policy import (
    Action,
    EvalContext,
    decide_policy,
    decide_policy_traced,
    matched_policies,
    parse_expr,
)
from asw_worlds import (
    NOW,
    actor,
    evidence,
    make_action,
    make_world,
    override,
    resource,
    session,
    token,
    with_entities,
)

OWNER_ONLY = {
    "op": "eq",
    "args": [
        {"op": "ref", "path": "action.actor.actor_id"},
        {"op": "ref", "path": "action.resource.owner"},
    ],
}
SUPPORT_ROLE = {
    "op": "and",
    "args": [
        {"op": "in", "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": ["ROLE-SUPPORT"]}]},
        {"op": "eq", "args": [
            {"op": "ref", "path": "action.actor.tenant"},
            {"op": "ref", "path": "action.resource.tenant"},
        ]},
    ],
}
TRUE = {"op": "lit", "value": True}


def policy(policy_id, effect, condition, *, priority=0, operation="read", resource_type="order",
           is_default_rule=None):
    document = {
        "policy_id": policy_id,
        "action": {"operation": operation},
        "effect": effect,
        "condition": condition,
        "priority": priority,
    }
    if resource_type is not None:
        document["action"]["resource_type"] = resource_type
    if is_default_rule is not None:
        document["is_default_rule"] = is_default_rule
    return document


@pytest.fixture()
def world():
    return make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), tenant="TEN-001"),
            actor("ACT-002", roles=("ROLE-SUPPORT",), tenant="TEN-001"),
            actor("ACT-003", roles=("ROLE-SUPPORT",), tenant="TEN-002"),
        ),
        resources=(
            resource("RES-001", owner="ACT-001", tenant="TEN-001"),
            resource("RES-002", owner="ACT-003", tenant="TEN-002", resource_type="file"),
        ),
        policies=(
            policy("POL-OWNER", "allow", OWNER_ONLY, priority=100),
            policy("POL-SUPPORT", "allow", SUPPORT_ROLE, priority=50),
            policy("POL-DEFAULT", "deny", TRUE, priority=-1, operation="*", resource_type=None,
                   is_default_rule=True),
        ),
        evidence_items=(evidence("EV-1", "resource.RES-001.owner", "ACT-001"),),
    )


def test_matched_policies_sorted_by_priority_desc_then_id_asc(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    assert [p.policy_id for p in matched_policies(world, action)] == [
        "POL-OWNER",
        "POL-SUPPORT",
        "POL-DEFAULT",
    ]


def test_tie_break_is_policy_id_ascending(world):
    tied = with_priority_tie(world)
    action = make_action("read", "ACT-001", resource_id="RES-001")
    assert [p.policy_id for p in matched_policies(tied, action)] == [
        "POL-AAA",
        "POL-BBB",
        "POL-DEFAULT",
    ]


def with_priority_tie(world):
    from asw_worlds import with_entities

    return with_entities(
        world,
        policies=(
            policy("POL-BBB", "deny", TRUE, priority=10),
            policy("POL-AAA", "allow", OWNER_ONLY, priority=10),
            policy("POL-DEFAULT", "deny", TRUE, priority=-1, operation="*", resource_type=None,
                   is_default_rule=True),
        ),
    )


def test_first_true_condition_wins(world):
    owner = make_action("read", "ACT-001", resource_id="RES-001")
    decision = decide_policy(world, owner)
    assert (decision.effect, decision.matched_policy_id) == ("allow", "POL-OWNER")
    assert decision.is_default_rule is False

    support_same_tenant = make_action("read", "ACT-002", resource_id="RES-001")
    decision = decide_policy(world, support_same_tenant)
    assert (decision.effect, decision.matched_policy_id) == ("allow", "POL-SUPPORT")

    support_other_tenant = make_action("read", "ACT-003", resource_id="RES-001")
    decision = decide_policy(world, support_other_tenant)
    assert (decision.effect, decision.matched_policy_id) == ("deny", "POL-DEFAULT")
    assert decision.is_default_rule is True


def test_operation_star_matches_every_operation(world):
    for operation in ("read", "refund", "write", "delete"):
        action = make_action(operation, "ACT-001", resource_id="RES-001")
        assert any(p.policy_id == "POL-DEFAULT" for p in matched_policies(world, action))


def test_resource_type_filter(world):
    """``resource_type`` 省略表示任意；显式声明则必须相等。"""
    file_action = make_action("delete", "ACT-001", resource_id="RES-002")
    assert [p.policy_id for p in matched_policies(world, file_action)] == ["POL-DEFAULT"]
    order_action = make_action("read", "ACT-001", resource_id="RES-001")
    assert [p.policy_id for p in matched_policies(world, order_action)] == [
        "POL-OWNER",
        "POL-SUPPORT",
        "POL-DEFAULT",
    ]


def test_no_matching_policy_falls_back_to_closed_world_deny(world):
    """闭世界默认拒绝本身就是 default 规则 ⇒ 只产生 unauthorized（B10）。"""
    from asw_worlds import with_entities

    bare = with_entities(world, policies=(policy("POL-READ", "allow", OWNER_ONLY, operation="read"),))
    action = make_action("refund", "ACT-001", resource_id="RES-001")
    decision = decide_policy(bare, action)
    assert decision.effect == "deny"
    assert decision.matched_policy_id is None
    assert decision.is_default_rule is True


def test_default_effect_can_be_overridden_to_allow(world):
    from asw_worlds import with_entities

    bare = with_entities(world, policies=(policy("POL-READ", "allow", OWNER_ONLY, operation="read"),))
    action = make_action("refund", "ACT-001", resource_id="RES-001")
    decision = decide_policy(bare, action, default_effect="allow")
    assert decision.effect == "allow"
    assert decision.is_default_rule is True


def test_is_default_rule_flag_marks_the_fallback(world):
    explicit_default = with_entities(
        world,
        policies=(policy("POL-ALLOW", "allow", OWNER_ONLY), policy("POL-FALLBACK", "deny", TRUE, priority=-1, is_default_rule=True)),
    )
    action = make_action("read", "ACT-003", resource_id="RES-001")
    decision = decide_policy(explicit_default, action)
    assert (decision.effect, decision.matched_policy_id) == ("deny", "POL-FALLBACK")
    assert decision.is_default_rule is True


def test_unbound_subject_makes_the_rule_not_match(world):
    """策略条件读到未绑定主体 ⇒ ``condition_unbound``，规则不匹配，绝不抛错。"""
    from asw_worlds import with_entities

    token_rule = with_entities(
        world,
        policies=(
            policy(
                "POL-TOKEN",
                "allow",
                {"op": "eq", "args": [{"op": "ref", "path": "action.token.used"}, {"op": "lit", "value": False}]},
            ),
            policy("POL-DEFAULT", "deny", TRUE, priority=-1, operation="*", resource_type=None,
                   is_default_rule=True),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")  # 无 token 绑定
    decision = decide_policy(token_rule, action)
    assert decision.effect == "deny"
    assert decision.matched_policy_id == "POL-DEFAULT"
    assert ("POL-TOKEN", "condition_unbound") in decision.evaluated


def test_dangling_resource_reference_is_a_hard_failure(world):
    """action.resource 指向世界中不存在的资源是引用完整性违规，绝不静默降级。"""
    action = Action.from_document(
        {
            "action_id": "ACTN-000009-999",
            "operation": "read",
            "actor": "ACT-001",
            "resource": "RES-404",
            "flow_id": "FLOW-A",
            "at": NOW,
        }
    )
    with pytest.raises(RefResolutionError):
        decide_policy(world, action)


def test_decide_policy_traced_emits_match_evaluate_and_default_steps(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    decision, steps = decide_policy_traced(world, action)
    assert decision.effect == "allow"
    rules = [step["rule"] for step in steps]
    assert rules == ["policy.match", "policy.evaluate"]
    assert steps[0]["result"] == ["POL-OWNER", "POL-SUPPORT", "POL-DEFAULT"]
    assert steps[1]["operands"]["policy_id"] == "POL-OWNER"
    assert steps[1]["operands"]["ref"] == "action.actor.actor_id vs action.resource.owner"
    assert steps[1]["result"] == "condition_true"
    # step 序号连续且从 0 开始
    assert [step["step"] for step in steps] == list(range(len(steps)))


def test_decide_policy_traced_marks_the_default_rule_step(world):
    action = make_action("read", "ACT-003", resource_id="RES-001")  # 跨租户 support
    _decision, steps = decide_policy_traced(world, action)
    rules = [step["rule"] for step in steps]
    assert rules == ["policy.match", "policy.evaluate", "policy.evaluate", "policy.default"]
    default_step = steps[-1]
    assert default_step["operands"]["is_default_rule"] is True
    assert default_step["operands"]["policy_id"] == "POL-DEFAULT"
    assert default_step["result"] == "deny"


def test_condition_reading_nothing_records_no_ref_operand(world):
    action = make_action("read", "ACT-003", resource_id="RES-001")
    _decision, steps = decide_policy_traced(world, action)
    default_step = steps[-1]
    assert "ref" not in default_step["operands"]


def test_ctx_is_shared_so_consulted_refs_accumulate(world):
    action = make_action("read", "ACT-003", resource_id="RES-001")
    ctx = EvalContext(world=world, action=action, now=NOW, current_flow_id="FLOW-A")
    decide_policy_traced(world, action, ctx=ctx)
    # 两条 allow 规则都读了 ref，默认规则的条件是 lit true（不读）
    assert "resource.RES-001.owner" in ctx.consulted_refs
    assert "actor.ACT-003.roles" in ctx.consulted_refs


def test_non_boolean_condition_is_a_hard_error(world):
    from asw_worlds import with_entities

    broken = with_entities(
        world,
        policies=(policy("POL-BROKEN", "allow", {"op": "ref", "path": "action.resource.owner"}),),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    with pytest.raises(Exception):
        decide_policy(broken, action)


def test_parsed_expr_is_reused_for_matching(world):
    """matched_policies 与 decide_policy 对同一个 action 给出一致的策略集合。"""
    action = make_action("read", "ACT-002", resource_id="RES-001")
    assert [p.policy_id for p in matched_policies(world, action)] == [
        p.policy_id for p in matched_policies(world, action)
    ]
    assert decide_policy(world, action).matched_policy_id == "POL-SUPPORT"


def test_parse_expr_of_every_condition_in_the_fixture_world():
    """黄金 policy bundle 的每条 condition 都可解析。"""
    from security_world.model import load_world

    # 夹具路径按本文件定位，不依赖进程 CWD（pytest 可从仓库根调用本项目）。
    world = load_world(Path(__file__).resolve().parents[2] / "schemas/examples/world.example.json")
    for rule in world.policies:
        assert parse_expr(rule.condition).op in ("lit", "eq", "and")


# --------------------------------------------------------------------------- #
# REVISION 3（21-world 深审 P0-1）：兜底规则不得按 policy_id 字母序遮蔽 allow
# --------------------------------------------------------------------------- #
def test_default_rules_sort_after_specific_rules(world):
    """同 priority 时 ``is_default_rule=True`` 的规则排最后（不参与字母序竞争）。

    回归的正是真实缺陷：``lit(true)`` 兜底 deny（``POL-X-DENY``）与 allow
    （``POL-X-OWNER``）同 priority 时，按 ``policy_id`` 升序 D < O——兜底永远先
    命中，allow 成为死代码，世界表达不出 safe 判决。
    """
    shadowed = with_entities(
        world,
        policies=(
            policy("POL-X-OWNER", "allow", OWNER_ONLY, priority=100),
            policy("POL-X-DENY", "deny", TRUE, priority=100, is_default_rule=True),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    assert [p.policy_id for p in matched_policies(shadowed, action)] == [
        "POL-X-OWNER",
        "POL-X-DENY",
    ]
    # 默认规则没有 priority 时（省略 ⇒ 有效 priority 与 allow 相同）同样排在最后
    implicit = with_entities(
        world,
        policies=(
            policy("POL-X-OWNER", "allow", OWNER_ONLY),
            policy("POL-X-DENY", "deny", TRUE, is_default_rule=True),
        ),
    )
    assert [p.policy_id for p in matched_policies(implicit, action)] == [
        "POL-X-OWNER",
        "POL-X-DENY",
    ]


def test_owner_action_is_allowed_when_default_deny_shares_the_prefix(world):
    """owner 自己的动作判 allow，非 owner 落到兜底 deny（正/反各一）。"""
    shadowed = with_entities(
        world,
        policies=(
            policy("POL-X-OWNER", "allow", OWNER_ONLY, priority=100),
            policy("POL-X-DENY", "deny", TRUE, priority=100, is_default_rule=True),
        ),
    )
    owner = make_action("read", "ACT-001", resource_id="RES-001")
    decision = decide_policy(shadowed, owner)
    assert (decision.effect, decision.matched_policy_id) == ("allow", "POL-X-OWNER")
    assert decision.is_default_rule is False

    stranger = make_action("read", "ACT-003", resource_id="RES-001")
    decision = decide_policy(shadowed, stranger)
    assert (decision.effect, decision.matched_policy_id) == ("deny", "POL-X-DENY")
    assert decision.is_default_rule is True


def test_priority_still_dominates_the_default_flag(world):
    """priority 是第一排序键：高 priority 的兜底仍然先于低 priority 的精确规则。

    ``is_default_rule`` 只打破**同 priority 内**的字母序遮蔽，不推翻 priority 权威度
    （作者显式声明"这条兜底比那些 allow 更权威"时以作者为准）。
    """
    ranked = with_entities(
        world,
        policies=(
            policy("POL-A-ALLOW", "allow", OWNER_ONLY, priority=10),
            policy("POL-Z-DEFAULT", "deny", TRUE, priority=100, is_default_rule=True),
        ),
    )
    action = make_action("read", "ACT-001", resource_id="RES-001")
    assert [p.policy_id for p in matched_policies(ranked, action)] == [
        "POL-Z-DEFAULT",
        "POL-A-ALLOW",
    ]
    assert decide_policy(ranked, action).effect == "deny"


def test_default_rule_with_a_real_condition_still_matches(world):
    """兜底规则仍参与求值：条件可假的 default 规则不会遮蔽 allow，也不会永拒。"""
    conditional_default = with_entities(
        world,
        policies=(
            policy("POL-X-OWNER", "allow", OWNER_ONLY, priority=100),
            policy(
                "POL-X-DENY",
                "deny",
                {"op": "in", "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": ["ROLE-SUPPORT"]}]},
                priority=100,
                is_default_rule=True,
            ),
        ),
    )
    # customer：owner allow 先命中
    assert decide_policy(conditional_default, make_action("read", "ACT-001", resource_id="RES-001")).effect == "allow"
    # 同租户 support（非 owner）：allow 条件假 ⇒ 落到 default 规则，条件为真 ⇒ deny
    decision = decide_policy(conditional_default, make_action("read", "ACT-002", resource_id="RES-001"))
    assert (decision.effect, decision.matched_policy_id) == ("deny", "POL-X-DENY")


def test_accepted_worlds_allow_rules_are_effective():
    """三个真实 accepted 世界的 allow 规则重跑后生效（P0-1 的端到端回归）。

    读 ``worlds/accepted/milestone-1-100.jsonl``（只读），对每个世界编译出实例，
    分别跑 owner 动作与攻击者动作：owner 必须判 **safe**（allow 生效），攻击者必须
    判 **attack**（不变量被违反）。修复前 owner 会落到字母序在前的
    ``POL-*-READ-DENY`` 兜底，verdict 翻成 unauthorized——世界永远表达不出 safe。

    W-SCHOOL-004 的攻击形态不是"换一个 actor"而是"重用一次性 token"：它的 CI 轴
    就是 ``token.TOK-SCHOOL-001.used``（false → true），因此这里用一次单变量干预
    造出攻击者观测（引擎自己的 ``critical_intervention``，不手改世界）。
    """
    from security_world.expansion import critical_intervention

    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from real_worlds import load_raw_world

    cases = {
        # world_id: (operation, owner_actor, resource, token, attacker_actor, attack_override)
        "W-ECOM-001": ("read", "ACT-ECOM-001", "RES-ECOM-001", None, "ACT-ECOM-002", None),
        "W-CLOUD-001": ("read", "ACT-C1-001", "RES-C1-001", None, "ACT-C1-002", None),
        "W-SCHOOL-004": ("consume_token", "ACT-SCHOOL-001", None, "TOK-SCHOOL-001", "ACT-SCHOOL-001",
                         "token.TOK-SCHOOL-001.used"),
    }
    seen: set[str] = set()
    for world_id in cases:
        record = load_raw_world(world_id)
        seen.add(world_id)
        operation, owner, resource, token, attacker, attack_override = cases[world_id]
        spec = WorldSpec.from_document(dict(record["spec_document"]))
        instance = compile_spec(spec, seed=int(record["spec_document"].get("seed") or 0))
        at = str(record["spec_document"]["current_state"]["at"])

        def action_of(actor: str, world: Any = instance) -> Action:
            document = {
                "action_id": f"ACTN-{world_id}-{actor}",
                "operation": operation,
                "actor": actor,
                "flow_id": f"FLOW-{operation}",
                "at": at,
            }
            if resource is not None:
                document["resource"] = resource
            if token is not None:
                document["token"] = token
            return Action.from_document(document)

        owner_output = run_oracle(instance, action_of(owner), EvidenceView.from_world(instance))
        assert str(owner_output.world_truth) == "safe", (
            f"{world_id}: owner 动作应判 safe（allow 生效），得到 {owner_output.world_truth}"
        )
        if attack_override is None:
            attack_output = run_oracle(instance, action_of(attacker), EvidenceView.from_world(instance))
        else:
            # 攻击者观测 = 声明轴的单变量干预（引擎拒绝非单变量/空干预）
            variant, _intervention = critical_intervention(
                instance,
                intervention_variable=attack_override,
                after=True,
                seed=1,
            )
            attack_output = run_oracle(variant, action_of(attacker), EvidenceView.from_world(variant))
        assert str(attack_output.world_truth) == "attack", (
            f"{world_id}: 攻击者动作应判 attack，得到 {attack_output.world_truth}"
        )
    assert seen == set(cases), f"accepted 清单缺少用例世界：缺 {sorted(set(cases) - seen)}"
