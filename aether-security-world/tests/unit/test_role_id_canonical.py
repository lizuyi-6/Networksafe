"""role_id 是角色的唯一标识（设计 §4.2 / 第 1 轮复审 S6；REVISION 2 任务书 A4）。

S6 发现两个参考 fixture 对"``actor.roles`` 存什么"给出冲突答案（一个存 role_id
``ROLE-SUPPORT``，一个存 name ``support_agent``），同一条策略在两种约定下一条恒真
一条恒假。现在的规则钉死为：

1. ``actor.roles`` 只存 **canonical role_id**（schema 模式 ``^ROLE-`` + Gate 2 的
   ``actor_roles_subset_of_declared_role_ids`` 悬空即拒）；
2. **policy 求值只认 role_id**——``action.actor.roles`` 与 role_id 字面量比较；
3. role **name** 只能经显式 ref ``role.<id>.name`` 读取（ID 视图 BNF 的一等路径），
   不存在"按名字解析角色"的隐式回路。

本文件把三条规则钉成可证伪断言：名字当 id 用必须求值为假（而不是抛错或蒙混），
按名字解析必须显式走 ``role.<id>.name``，悬空角色名必须被 Gate 2 拒。
"""
from __future__ import annotations

import pytest
from asw_worlds import actor, make_world, resource, role

from security_world.model import WorldInstance, validate_document
from security_world.policy import EvalContext, eval_expr, parse_expr
from security_world.validation.gates import _g2_world_checks
from security_world.validation import run_gates


def _world(*, actor_roles=("ROLE-SUPPORT",), declared=(("ROLE-SUPPORT", ("order:refund",)),)):
    return make_world(
        world_id="W-ROLE-ID",
        roles=tuple(role(role_id, privileges=privileges) for role_id, privileges in declared),
        actors=(actor("ACT-001", roles=actor_roles, privileges=("order:read",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
    )


def _action(world):
    from asw_worlds import make_action

    return make_action("read", "ACT-001", resource_id="RES-001")


def _eval(world, action, document):
    return eval_expr(
        parse_expr(document, where="test"),
        EvalContext(world=world, action=action, evidence_view=None, now="2026-09-20T08:00:00Z"),
    )


# --------------------------------------------------------------------------- #
# 求值只认 canonical role_id
# --------------------------------------------------------------------------- #
def test_policy_matches_the_role_id_never_the_name():
    world = _world()
    action = _action(world)
    # role_id 字面量：命中
    assert _eval(
        world, action, {"op": "in", "args": [
            {"op": "ref", "path": "action.actor.roles"},
            {"op": "lit", "value": ["ROLE-SUPPORT"]},
        ]}
    ) is True
    # role name 字面量（"Support" 是 role() 的默认 name）：不命中，也不抛错
    assert _eval(
        world, action, {"op": "in", "args": [
            {"op": "ref", "path": "action.actor.roles"},
            {"op": "lit", "value": ["Support"]},
        ]}
    ) is False


def test_role_name_is_reachable_only_by_explicit_ref():
    """``role.<id>.name`` 是读取角色名的唯一显式路径（ID 视图 BNF 的一等公民）。"""
    world = _world()
    action = _action(world)
    assert world.resolve("role.ROLE-SUPPORT.name") == "Support"
    assert world.resolve("role.ROLE-SUPPORT.role_id") == "ROLE-SUPPORT"
    # 经显式 ref 比较名字：成立（这是唯一合法的"按名"用法）
    assert _eval(
        world, action, {"op": "eq", "args": [
            {"op": "ref", "path": "role.ROLE-SUPPORT.name"},
            {"op": "lit", "value": "Support"},
        ]}
    ) is True
    # 名字不在 actor.roles 的取值域里：把它当 id 比永远为假
    assert _eval(
        world, action, {"op": "eq", "args": [
            {"op": "ref", "path": "action.actor.roles"},
            {"op": "lit", "value": "Support"},
        ]}
    ) is False


def test_actor_roles_entries_must_resolve_to_declared_role_ids():
    """Gate 2：actor.roles 里的每一项都必须是 roles[].role_id（悬空即拒）。"""
    from security_world.model.episode import Episode

    world = _world()
    action = _action(world)
    document = world.to_document()
    document["actors"][0]["roles"] = ["Support"]  # 名字，不是 id
    broken = WorldInstance.from_document(document)
    # schema 层先拒（^ROLE- 模式）；即使绕过 schema，Gate 2 也必须拒
    assert validate_document(document, "world"), "schema 必须拒绝非 ROLE- 形式的 roles 项"
    problems = _g2_world_checks(_stub_episode(world, action), broken, family=None)
    assert any("roles" in problem for problem in problems), problems


def test_a_role_prefixed_but_undeclared_id_is_rejected():
    """形如 id 但未声明的角色（``ROLE-GHOST``）同样悬空——Gate 2 的实在检查。"""
    from security_world.model.episode import Episode

    world = _world()
    action = _action(world)
    document = world.to_document()
    document["actors"][0]["roles"] = ["ROLE-GHOST"]
    broken = WorldInstance.from_document(document)
    assert validate_document(document, "world") == [], "ROLE- 形式在 schema 层合法"
    problems = _g2_world_checks(_stub_episode(world, action), broken, family=None)
    assert any("ROLE-GHOST" in problem for problem in problems), problems


def _stub_episode(world, action):
    """只带 G2 世界级检查用到的字段的占位 episode（与 tests/gates 同手法）。"""

    class _Stub:
        world_id = world.world_id
        world_family_id = world.world_family_id
        counterfactual_family_id = "CF-" + "0" * 12
        timeline = ()
        current_event = {"event_id": "EVT-000", "t_index": 0, "at": world.current_state.at,
                         "event_type": "request", "actor_id": "ACT-001"}
        observation = {
            "model_visible": {},
            "decision_metadata": {"evidence_classification": [], "hidden_evidence_ids": []},
        }

    return _Stub()
