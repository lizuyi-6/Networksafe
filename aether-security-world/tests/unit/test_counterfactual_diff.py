"""``diff_worlds``：单变量反事实的机械强制（设计 §9.2 / D4）。

断言的是"只改一个变量"这条不变量的**机械**形式：``changed_paths`` 用与
``intervention.intervention_variable`` 同一套 ID 视图路径（§4.3 规则 4），因此两边
可以逐字 ``==``。测试同时钉死三类容易悄悄失效的边界：键序不算变化（canonical
比较）、类型严格（``1`` 不等于 ``"1"``）、字段增删算变化。
"""
from __future__ import annotations

import pytest
from asw_worlds import actor, make_world, resource, role, with_entities

from security_world.expansion import ExpansionError, WorldDiff, diff_worlds
from security_world.model import canonical_json


def _world(**kwargs):
    return make_world(
        world_id=kwargs.pop("world_id", "W-DIFF-001"),
        actors=kwargs.pop("actors", (actor("ACT-001", roles=("ROLE-CUSTOMER",)),)),
        resources=kwargs.pop("resources", (resource("RES-001", owner="ACT-001"),)),
        roles=kwargs.pop("roles", (role("ROLE-CUSTOMER"),)),
        **kwargs,
    )


def test_identical_worlds_diff_empty():
    world = _world()
    diff = diff_worlds(world, world)
    assert diff.is_empty()
    assert diff.changed_paths == ()
    assert len(diff) == 0
    assert list(diff) == []


def test_single_field_change_is_single():
    world = _world()
    other = with_entities(world, resources=(resource("RES-001", owner="ACT-002"),))
    diff = diff_worlds(world, other)
    assert diff.changed_paths == ("resource.RES-001.owner",)
    assert diff.is_single("resource.RES-001.owner")
    assert not diff.is_single("resource.RES-001.tenant")
    assert not diff.is_empty()


def test_key_order_is_not_a_change():
    """JSON 键序不是世界状态变化（canonical_json 排序后比较）。"""
    left = _world()
    right_document = left.to_document()
    right_document["actors"] = [
        {key: right_document["actors"][0][key] for key in sorted(right_document["actors"][0], reverse=True)}
    ]
    from security_world.model import WorldInstance

    right = WorldInstance.from_document(right_document)
    assert diff_worlds(left, right).is_empty()


def test_list_order_is_a_change():
    """数组顺序是状态的一部分（roles 的两种排列是不同的授权状态）。"""
    left = _world(actors=(actor("ACT-001", roles=("ROLE-CUSTOMER", "ROLE-SUPPORT")),))
    right = with_entities(left, actors=(actor("ACT-001", roles=("ROLE-SUPPORT", "ROLE-CUSTOMER")),))
    diff = diff_worlds(left, right)
    assert diff.changed_paths == ("actor.ACT-001.roles",)


def test_type_strictness_one_is_not_one_string():
    """``1`` 与 ``"1"`` 是不同的状态（D6：不许隐式转换）。"""
    left = _world()
    right = with_entities(
        left,
        resources=(
            {
                "resource_id": "RES-001",
                "resource_type": "order",
                "owner": "ACT-001",
                "tenant": "TEN-001",
                "sensitivity": "confidential",
                "state": "active",
                "attributes": {"total_cents": 1},
            },
        ),
    )
    other = with_entities(
        left,
        resources=(
            {
                "resource_id": "RES-001",
                "resource_type": "order",
                "owner": "ACT-001",
                "tenant": "TEN-001",
                "sensitivity": "confidential",
                "state": "active",
                "attributes": {"total_cents": "1"},
            },
        ),
    )
    diff = diff_worlds(right, other)
    assert diff.changed_paths == ("resource.RES-001.attributes.total_cents",)


def test_added_and_removed_fields_are_changes():
    """可选字段被写没/新写出来与改值一样改变世界状态。"""
    left = _world(actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",), groups=("GRP-A",)),))
    right = with_entities(left, actors=(actor("ACT-001", roles=("ROLE-CUSTOMER",)),))
    diff = diff_worlds(left, right)
    assert "actor.ACT-001.groups" in diff.changed_paths
    assert not diff.is_empty()


def test_diff_rejects_non_world():
    with pytest.raises(ExpansionError) as excinfo:
        diff_worlds({"world_id": "W-1"}, _world())  # type: ignore[arg-type]
    assert excinfo.value.reason_code == "diff_requires_world_instance"


def test_world_diff_document_roundtrip():
    diff = WorldDiff(("resource.RES-001.owner",))
    assert diff.to_document() == {"changed_paths": ["resource.RES-001.owner"]}
    assert canonical_json(diff.changed_paths) == canonical_json(("resource.RES-001.owner",))


def test_diff_is_deterministic():
    left = _world()
    right = with_entities(left, resources=(resource("RES-001", owner="ACT-002"),))
    first = diff_worlds(left, right)
    second = diff_worlds(left, right)
    assert canonical_json(first.changed_paths) == canonical_json(second.changed_paths)
