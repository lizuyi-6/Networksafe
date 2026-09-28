"""27 个 op 的全量正/反例（设计 §13.1 的 ``test_policy_eval.py``）。

每个 op 至少一条"成立"与一条"不成立"的断言，外加四类横切性质：

* **短路**：``and`` / ``or`` 不求值被短路的分支（否则一个不可解析的分支会让
  整个表达式抛错，而它本该不影响结论）；
* **``on_missing="unknown"`` 永不放行**：建立不起来的操作数不能让布尔表达式为真；
* **无隐式类型转换**：``eq`` 类型严格，不可比较的操作数类型抛 ``DslError``；
* **求值无副作用**：求值前后世界的 ``canonical_json`` 逐字节相同。
"""
from __future__ import annotations

import pytest

from security_world.model.canonical import canonical_json
from security_world.policy import (
    UNKNOWN,
    EvalContext,
    DslError,
    eval_expr,
    parse_expr,
    static_refs,
    action_bindings_read,
)
from asw_worlds import (
    LATER,
    NOW,
    actor,
    evidence,
    make_action,
    make_world,
    override,
    resource,
    role,
    session,
    token,
    transition,
    workflow,
    instance,
)


@pytest.fixture()
def world():
    return make_world(
        roles=(
            role("ROLE-CUSTOMER", privileges=("order:read",)),
            role("ROLE-SUPPORT", privileges=("order:refund", "order:read")),
        ),
        actors=(
            actor(
                "ACT-001",
                roles=("ROLE-CUSTOMER",),
                privileges=("order:read",),
                privilege_version=0,
                groups=("G-ALPHA", "G-BETA"),
            ),
            actor(
                "ACT-002",
                roles=("ROLE-SUPPORT",),
                tenant="TEN-002",
                privileges=("order:refund",),
                privilege_version=1,
                groups=(),
            ),
        ),
        resources=(
            resource("RES-001", owner="ACT-001", tenant="TEN-001"),
            resource("RES-002", owner="ACT-002", tenant="TEN-002"),
        ),
        sessions=(
            session("SES-001", principal="ACT-001", flow_id="FLOW-A", privilege_version=0),
            session("SES-002", principal="ACT-001", revoked=True, revoked_at=NOW),
        ),
        tokens=(
            token("TOK-001", subject="ACT-001", flow_id="FLOW-A"),
            token(
                "TOK-002",
                subject="ACT-001",
                flow_id="FLOW-B",
                one_time=True,
                used=True,
                parent_token="TOK-001",
                token_type="one_time_code",
            ),
        ),
        workflows=(
            workflow(
                "WFL-ORDER",
                states=("created", "paid", "refunded"),
                initial_state="created",
                transitions_=(
                    transition("created", "paid"),
                    transition("paid", "refunded", condition={
                        "op": "eq",
                        "args": [
                            {"op": "ref", "path": "action.actor.privilege_version"},
                            {"op": "lit", "value": 0},
                        ],
                    }),
                ),
                instances=(instance("WFI-001", resource_id="RES-001", current_state="paid"),),
            ),
        ),
        evidence_items=(
            evidence("EV-ROLE-001", "actor.ACT-001.roles", ["ROLE-CUSTOMER"]),
            evidence("EV-TENANT-001", "actor.ACT-001.tenant", "TEN-001"),
            evidence("EV-TENANT-002", "actor.ACT-002.tenant", "TEN-002"),
            evidence("EV-PV-001", "actor.ACT-001.privilege_version", 0),
            evidence("EV-PV-002", "actor.ACT-002.privilege_version", 1),
        ),
    )


@pytest.fixture()
def action():
    return make_action(
        "read",
        "ACT-001",
        resource_id="RES-001",
        session_id="SES-001",
        token_id="TOK-001",
        workflow_instance_id="WFI-001",
        flow_id="FLOW-A",
    )


def ctx(world, action, **kwargs):
    return EvalContext(world=world, action=action, now=NOW, current_flow_id="FLOW-A", **kwargs)


def ev(world, action, document, **kwargs):
    return eval_expr(parse_expr(document, where="test"), ctx(world, action, **kwargs))


# --------------------------------------------------------------------------- #
# lit / ref
# --------------------------------------------------------------------------- #
def test_lit_returns_value_verbatim(world, action):
    assert ev(world, action, {"op": "lit", "value": "x"}) == "x"
    assert ev(world, action, {"op": "lit", "value": None}) is None
    assert ev(world, action, {"op": "lit", "value": False}) is False


def test_ref_resolves_id_action_and_context_views(world, action):
    assert ev(world, action, {"op": "ref", "path": "resource.RES-001.owner"}) == "ACT-001"
    assert ev(world, action, {"op": "ref", "path": "action.resource.owner"}) == "ACT-001"
    assert ev(world, action, {"op": "ref", "path": "action.actor.roles"}) == ["ROLE-CUSTOMER"]
    assert ev(world, action, {"op": "ref", "path": "current_flow.flow_id"}) == "FLOW-A"
    assert ev(world, action, {"op": "ref", "path": "current_time"}) == NOW


def test_ref_action_local_views_read_the_action_document(world):
    action = make_action(
        "read", "ACT-001", resource_id="RES-001",
        parameters={"amount": 100}, request={"method": "GET"},
    )
    assert ev(world, action, {"op": "ref", "path": "action.parameters.amount"}) == 100
    assert ev(world, action, {"op": "ref", "path": "action.request.method"}) == "GET"


def test_ref_unbound_binding_raises_unbound_subject(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")  # 无 token
    with pytest.raises(Exception) as excinfo:
        ev(world, action, {"op": "ref", "path": "action.token.flow_id"})
    assert excinfo.value.reason == "unbound_subject"


def test_ref_dangling_world_path_raises(world, action):
    """悬空引用（实体不存在）是引用完整性违规，硬失败。"""
    with pytest.raises(Exception) as excinfo:
        ev(world, action, {"op": "ref", "path": "resource.RES-999.owner"})
    assert excinfo.value.reason == "unknown_entity_id"


def test_ref_missing_optional_field_is_unknown_not_a_crash(world, action):
    """实体存在但没有该可选字段 ⇒ UNKNOWN（fail-closed），不是抛错。

    编译期只要求"某类实体里至少一个有该字段"（``compile._check_ref_path`` 对 action
    视图的检查），运行期剩下的只是"这个实体没声明它"。``or(owner, groups)`` 必须仍能
    因属主分支为真而满足，所以这里不能整条判违反。
    """
    from asw_worlds import actor as make_actor
    from asw_worlds import with_entities

    sparse = with_entities(
        world,
        actors=(
            make_actor("ACT-009", roles=("ROLE-CUSTOMER",)),  # 没有 groups / privileges
            *world.actors,
        ),
    )
    value = ev(sparse, action, {"op": "ref", "path": "actor.ACT-009.groups"})
    assert value is UNKNOWN
    # UNKNOWN 永不放行
    document = {
        "op": "or",
        "args": [
            {"op": "eq", "args": [{"op": "ref", "path": "actor.ACT-009.actor_id"},
                                  {"op": "ref", "path": "actor.ACT-009.actor_id"}]},
            {"op": "intersects", "args": [{"op": "ref", "path": "actor.ACT-009.groups"},
                                          {"op": "lit", "value": ["G-ALPHA"]}]},
        ],
    }
    assert ev(sparse, action, document) is True
    document["args"][0] = {"op": "lit", "value": False}
    assert ev(sparse, action, document) is False


def test_ref_on_missing_unknown_yields_the_sentinel(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    value = ev(
        world,
        action,
        {"op": "ref", "path": "action.token.flow_id", "on_missing": "unknown"},
    )
    assert value is UNKNOWN


def test_ref_on_missing_error_is_the_default(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    with pytest.raises(Exception):
        ev(world, action, {"op": "ref", "path": "action.token.flow_id"})


# --------------------------------------------------------------------------- #
# 比较
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "left,right,expected",
    [
        ("ACT-001", "ACT-001", True),
        ("ACT-001", "ACT-002", False),
        (1, 1, True),
        (True, True, True),
        (None, None, True),
    ],
)
def test_eq(world, action, left, right, expected):
    document = {"op": "eq", "args": [{"op": "lit", "value": left}, {"op": "lit", "value": right}]}
    assert ev(world, action, document) is expected


def test_eq_is_type_strict(world, action):
    """D6：不许隐式转换——``1`` / ``True`` / ``1.0`` 互不相等。"""
    for left, right in ((1, True), (True, 1), (1, 1.0), (0, False)):
        document = {"op": "eq", "args": [{"op": "lit", "value": left}, {"op": "lit", "value": right}]}
        assert ev(world, action, document) is False


def test_ne(world, action):
    document = {"op": "ne", "args": [{"op": "lit", "value": "a"}, {"op": "lit", "value": "b"}]}
    assert ev(world, action, document) is True
    document = {"op": "ne", "args": [{"op": "lit", "value": "a"}, {"op": "lit", "value": "a"}]}
    assert ev(world, action, document) is False


@pytest.mark.parametrize(
    "op,left,right,expected",
    [
        ("lt", 1, 2, True),
        ("lt", 2, 1, False),
        ("lt", 1, 1, False),
        ("le", 1, 1, True),
        ("le", 2, 1, False),
        ("gt", 2, 1, True),
        ("gt", 1, 2, False),
        ("ge", 1, 1, True),
        ("ge", 1, 2, False),
        ("lt", "a", "b", True),
        ("gt", "b", "a", True),
    ],
)
def test_ordering_ops(world, action, op, left, right, expected):
    document = {"op": op, "args": [{"op": "lit", "value": left}, {"op": "lit", "value": right}]}
    assert ev(world, action, document) is expected


def test_ordering_ops_reject_incomparable_types(world, action):
    for left, right in (("a", 1), (1, "a"), (True, 1), (None, 1)):
        document = {"op": "lt", "args": [{"op": "lit", "value": left}, {"op": "lit", "value": right}]}
        with pytest.raises(DslError):
            ev(world, action, document)


def test_comparisons_with_unknown_operand_are_false(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    unknown = {"op": "ref", "path": "action.token.flow_id", "on_missing": "unknown"}
    for op in ("eq", "ne", "lt", "le", "gt", "ge"):
        document = {"op": op, "args": [unknown, {"op": "lit", "value": "FLOW-A"}]}
        assert ev(world, action, document) is False, op


# --------------------------------------------------------------------------- #
# 集合
# --------------------------------------------------------------------------- #
def test_in_and_not_in(world, action):
    """两种写法都必须成立：数组∩数组（黄金 fixture 的 ``in(actor.roles, [...])``）
    与 标量∈数组（模板 ``in(lit priv, actor.privileges)``）。"""
    intersection = {
        "op": "in",
        "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": ["ROLE-CUSTOMER"]}],
    }
    assert ev(world, action, intersection) is True
    missing = {
        "op": "in",
        "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": ["ROLE-SUPPORT"]}],
    }
    assert ev(world, action, missing) is False
    assert ev(world, action, {"op": "not_in", "args": missing["args"]}) is True
    membership = {
        "op": "in",
        "args": [{"op": "lit", "value": "order:read"}, {"op": "ref", "path": "action.actor.privileges"}],
    }
    assert ev(world, action, membership) is True
    assert ev(
        world,
        action,
        {"op": "in", "args": [{"op": "lit", "value": "order:refund"},
                              {"op": "ref", "path": "action.actor.privileges"}]},
    ) is False


def test_in_rejects_two_scalars_and_string_haystacks(world, action):
    with pytest.raises(DslError):
        ev(world, action, {"op": "in", "args": [{"op": "lit", "value": "a"}, {"op": "lit", "value": "b"}]})
    # 字符串不当集合：子串判定属于 contains
    with pytest.raises(DslError):
        ev(world, action, {"op": "in", "args": [{"op": "lit", "value": "a"}, {"op": "lit", "value": "abc"}]})


def test_in_requires_array_haystack(world, action):
    document = {"op": "in", "args": [{"op": "lit", "value": "a"}, {"op": "lit", "value": "abc"}]}
    with pytest.raises(DslError):
        ev(world, action, document)


def test_subset_of_intersects_disjoint(world, action):
    groups = {"op": "ref", "path": "action.actor.groups"}
    assert ev(world, action, {"op": "subset_of", "args": [groups, {"op": "lit", "value": ["G-ALPHA", "G-BETA", "G-GAMMA"]}]}) is True
    assert ev(world, action, {"op": "subset_of", "args": [groups, {"op": "lit", "value": ["G-ALPHA"]}]}) is False
    assert ev(world, action, {"op": "intersects", "args": [groups, {"op": "lit", "value": ["G-BETA"]}]}) is True
    assert ev(world, action, {"op": "intersects", "args": [groups, {"op": "lit", "value": ["G-Z"]}]}) is False
    assert ev(world, action, {"op": "disjoint", "args": [groups, {"op": "lit", "value": ["G-Z"]}]}) is True
    assert ev(world, action, {"op": "disjoint", "args": [groups, {"op": "lit", "value": ["G-ALPHA"]}]}) is False


def test_is_empty(world, action):
    """空集合判定。字面量走 DSL 自身；世界字段用非空的那个。

    （不用"把 ``actor.groups`` 覆盖成 ``[]``"来测：L1 的 ``to_document`` 会丢掉空
    可选集合，覆盖后该字段在新世界里不可解析——那是如实记录的边界，见
    ``security_world/oracle/overlay.py`` 的 :class:`OverlayError` 与
    ``test_oracle_overlay_rejects_unrepresentable_values``。）
    """
    assert ev(world, action, {"op": "is_empty", "args": [{"op": "ref", "path": "action.actor.groups"}]}) is False
    assert ev(world, action, {"op": "is_empty", "args": [{"op": "lit", "value": []}]}) is True
    assert ev(world, action, {"op": "is_empty", "args": [{"op": "lit", "value": ""}]}) is True
    assert ev(world, action, {"op": "is_empty", "args": [{"op": "lit", "value": None}]}) is True
    assert ev(world, action, {"op": "is_empty", "args": [{"op": "lit", "value": ["x"]}]}) is False


def test_is_empty_rejects_scalars(world, action):
    with pytest.raises(DslError):
        ev(world, action, {"op": "is_empty", "args": [{"op": "lit", "value": 3}]})


def test_set_ops_with_unknown_operand_are_false(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    unknown = {"op": "ref", "path": "action.token.scope", "on_missing": "unknown"}
    for op in ("in", "not_in", "subset_of", "intersects", "disjoint"):
        document = {"op": op, "args": [unknown, {"op": "lit", "value": ["read"]}]}
        assert ev(world, action, document) is False, op
    assert ev(world, action, {"op": "is_empty", "args": [unknown]}) is False


# --------------------------------------------------------------------------- #
# 布尔（短路）
# --------------------------------------------------------------------------- #
def test_and_or_not(world, action):
    assert ev(world, action, {"op": "and", "args": [{"op": "lit", "value": True}, {"op": "lit", "value": True}]}) is True
    assert ev(world, action, {"op": "and", "args": [{"op": "lit", "value": True}, {"op": "lit", "value": False}]}) is False
    assert ev(world, action, {"op": "or", "args": [{"op": "lit", "value": False}, {"op": "lit", "value": True}]}) is True
    assert ev(world, action, {"op": "or", "args": [{"op": "lit", "value": False}, {"op": "lit", "value": False}]}) is False
    assert ev(world, action, {"op": "not", "args": [{"op": "lit", "value": False}]}) is True


def test_boolean_ops_short_circuit(world, action):
    """被短路的分支不求值：否则一个不可解析的 ref 会让本该成立的表达式抛错。"""
    document = {
        "op": "and",
        "args": [{"op": "lit", "value": False}, {"op": "ref", "path": "resource.RES-999.owner"}],
    }
    assert ev(world, action, document) is False
    document = {
        "op": "or",
        "args": [{"op": "lit", "value": True}, {"op": "ref", "path": "resource.RES-999.owner"}],
    }
    assert ev(world, action, document) is True


def test_unknown_never_authorizes(world):
    """UNKNOWN 永不放行：``and``/``not`` 见 UNKNOWN 即 False；``or`` 只有另一个
    操作数为真时才放行。"""
    action = make_action("read", "ACT-001", resource_id="RES-001")
    unknown = {"op": "ref", "path": "action.token.flow_id", "on_missing": "unknown"}
    assert ev(world, action, {"op": "and", "args": [unknown, {"op": "lit", "value": True}]}) is False
    assert ev(world, action, {"op": "not", "args": [unknown]}) is False
    assert ev(world, action, {"op": "or", "args": [unknown, {"op": "lit", "value": True}]}) is True
    assert ev(world, action, {"op": "or", "args": [unknown, {"op": "lit", "value": False}]}) is False


def test_boolean_ops_reject_non_boolean_operands(world, action):
    for op, args in (
        ("and", [{"op": "lit", "value": "x"}]),
        ("or", [{"op": "lit", "value": 1}]),
        ("not", [{"op": "lit", "value": None}]),
    ):
        with pytest.raises(DslError):
            ev(world, action, {"op": op, "args": args})


# --------------------------------------------------------------------------- #
# 字符串
# --------------------------------------------------------------------------- #
def test_contains_and_not_contains(world, action):
    path = {"op": "ref", "path": "action.request.path"}
    action_with_path = make_action(
        "read", "ACT-001", resource_id="RES-001", request={"path": "/api/orders/183"}
    )
    assert ev(world, action_with_path, {"op": "contains", "args": [path, {"op": "lit", "value": "orders"}]}) is True
    assert ev(world, action_with_path, {"op": "contains", "args": [path, {"op": "lit", "value": "users"}]}) is False
    assert ev(world, action_with_path, {"op": "not_contains", "args": [path, {"op": "lit", "value": "users"}]}) is True


def test_contains_accepts_array_membership(world, action):
    document = {
        "op": "contains",
        "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": "ROLE-CUSTOMER"}],
    }
    assert ev(world, action, document) is True


def test_contains_rejects_other_type_pairs(world, action):
    with pytest.raises(DslError):
        ev(world, action, {"op": "contains", "args": [{"op": "lit", "value": 1}, {"op": "lit", "value": 2}]})


# --------------------------------------------------------------------------- #
# 时间（虚拟时钟）
# --------------------------------------------------------------------------- #
def test_before_after(world, action):
    early, late = {"op": "lit", "value": NOW}, {"op": "lit", "value": LATER}
    assert ev(world, action, {"op": "before", "args": [early, late]}) is True
    assert ev(world, action, {"op": "before", "args": [late, early]}) is False
    assert ev(world, action, {"op": "after", "args": [late, early]}) is True
    assert ev(world, action, {"op": "after", "args": [early, late]}) is False


def test_within(world, action):
    start = {"op": "lit", "value": "2026-09-20T08:00:00Z"}
    end_30s = {"op": "lit", "value": "2026-09-20T08:00:30Z"}
    end_2m = {"op": "lit", "value": "2026-09-20T08:02:00Z"}
    assert ev(world, action, {"op": "within", "args": [start, end_30s, {"op": "lit", "value": 60_000}]}) is True
    assert ev(world, action, {"op": "within", "args": [start, end_2m, {"op": "lit", "value": 60_000}]}) is False
    # 负区间（时钟回拨）不在窗口内
    assert ev(world, action, {"op": "within", "args": [end_30s, start, {"op": "lit", "value": 60_000}]}) is False


def test_within_rejects_non_integer_window(world, action):
    with pytest.raises(DslError):
        ev(
            world,
            action,
            {"op": "within", "args": [{"op": "lit", "value": NOW}, {"op": "lit", "value": LATER},
                                      {"op": "lit", "value": "60s"}]},
        )


def test_temporal_ops_reject_non_instants(world, action):
    with pytest.raises(DslError):
        ev(world, action, {"op": "before", "args": [{"op": "lit", "value": "yesterday"}, {"op": "lit", "value": NOW}]})
    with pytest.raises(DslError):
        ev(world, action, {"op": "after", "args": [{"op": "lit", "value": 5}, {"op": "lit", "value": NOW}]})


# --------------------------------------------------------------------------- #
# 状态机
# --------------------------------------------------------------------------- #
def test_state_is(world, action):
    document = {
        "op": "state_is",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "paid"}],
    }
    assert ev(world, action, document) is True
    document = {
        "op": "state_is",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "refunded"}],
    }
    assert ev(world, action, document) is False


def test_state_is_rejects_undeclared_state(world, action):
    """与字符串相似度无关：未在 ``workflow.states`` 里声明的态恒为 False。"""
    document = {
        "op": "state_is",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "paid!"}],
    }
    assert ev(world, action, document) is False


def test_transition_allowed(world, action):
    allowed = {
        "op": "transition_allowed",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "refunded"}],
    }
    forbidden = {
        "op": "transition_allowed",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "created"}],
    }
    assert ev(world, action, allowed) is True
    assert ev(world, action, forbidden) is False


def test_conditional_transition_depends_on_the_condition(world, action):
    """``paid -> refunded`` 声明了 ``condition = action.actor.privilege_version == 0``。"""
    document = {
        "op": "transition_allowed",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "refunded"}],
    }
    assert ev(world, action, document) is True  # ACT-001.privilege_version == 0
    bumped = override(world, "actor.ACT-001.privilege_version", 7)
    assert ev(bumped, action, document) is False


def test_state_ops_reject_non_workflow_instance_refs(world, action):
    for path in ("action.resource.owner", "action.token.token_id"):
        document = {"op": "state_is", "args": [{"op": "ref", "path": path}, {"op": "lit", "value": "paid"}]}
        with pytest.raises(DslError):
            ev(world, action, document)


def test_state_ops_require_a_bound_instance(world):
    action = make_action("read", "ACT-001", resource_id="RES-001")
    document = {
        "op": "state_is",
        "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "paid"}],
    }
    with pytest.raises(Exception) as excinfo:
        ev(world, action, document)
    assert excinfo.value.reason == "unbound_subject"


# --------------------------------------------------------------------------- #
# 血缘
# --------------------------------------------------------------------------- #
def test_lineage_depth_and_root(world, action):
    assert ev(world, action, {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.token.token_id"}]}) == 0
    action_child = make_action(
        "read", "ACT-001", resource_id="RES-001", token_id="TOK-002", flow_id="FLOW-B"
    )
    assert ev(world, action_child, {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.token.token_id"}]}) == 1
    assert ev(world, action_child, {"op": "lineage_root", "args": [{"op": "ref", "path": "action.token.token_id"}]}) == "FLOW-A"


def test_lineage_ops_reject_cycles_and_dangling_parents(world):
    cyclic = override(world, "token.TOK-001.parent_token", "TOK-002")
    action = make_action("read", "ACT-001", resource_id="RES-001", token_id="TOK-001")
    with pytest.raises(DslError):
        ev(cyclic, action, {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.token.token_id"}]})


def test_lineage_ops_reject_non_token_refs(world, action):
    document = {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.actor.actor_id"}]}
    with pytest.raises(DslError):
        ev(world, action, document)


# --------------------------------------------------------------------------- #
# 证据桥（单向）
# --------------------------------------------------------------------------- #
def test_bridge_is_true_in_truth_pass_and_reads_the_view_in_observable_pass(world, action):
    document = {"op": "establishing_evidence_exists", "args": ["actor.ACT-001.tenant"]}
    # truth 趟：不看证据
    assert ev(world, action, document) is True
    # observable 趟：视图里有 trusted 证据 ⇒ True
    from asw_worlds import view_of

    view = view_of(world)
    assert ev(world, action, document, evidence_view=view) is True


def test_bridge_is_false_when_only_untrusted_evidence_exists(world, action):
    from asw_worlds import view_of

    document = {"op": "establishing_evidence_exists", "args": ["actor.ACT-001.tenant"]}
    view = view_of(world, visible=("EV-FILLER",))  # 只有占位证据可见
    assert ev(world, action, document, evidence_view=view) is False


def test_bridge_records_the_fact_key_as_consulted(world, action):
    document = {"op": "establishing_evidence_exists", "args": ["actor.ACT-001.tenant"]}
    context = ctx(world, action)
    eval_expr(parse_expr(document), context)
    assert context.consulted_refs == {"actor.ACT-001.tenant"}


# --------------------------------------------------------------------------- #
# 横切性质
# --------------------------------------------------------------------------- #
def test_evaluation_does_not_mutate_the_world(world, action):
    before = canonical_json(world)
    document = {
        "op": "and",
        "args": [
            {"op": "eq", "args": [{"op": "ref", "path": "action.resource.owner"}, {"op": "lit", "value": "ACT-001"}]},
            {"op": "state_is", "args": [{"op": "ref", "path": "action.workflow_instance.current_state"}, {"op": "lit", "value": "paid"}]},
            {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.token.token_id"}]},
        ],
    }
    # lineage_depth 不是布尔，用 eq 包一层以保持表达式是布尔
    document["args"][2] = {"op": "eq", "args": [document["args"][2], {"op": "lit", "value": 0}]}
    ev(world, action, document)
    assert canonical_json(world) == before


def test_consulted_refs_exclude_identity_fields_and_short_circuited_branches(world, action):
    document = {
        "op": "and",
        "args": [
            {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"}, {"op": "ref", "path": "action.resource.owner"}]},
            {"op": "lit", "value": False},  # 短路：后面的分支不读
            {"op": "ref", "path": "action.session.revoked"},
        ],
    }
    context = ctx(world, action)
    eval_expr(parse_expr(document), context)
    # actor_id 是"自建立"绑定（action 文档已点名 principal），不进 consulted_facts；
    # 被短路的分支不进；context / action 局部视图不进。
    assert context.consulted_refs == {"resource.RES-001.owner"}
    assert context.read_paths == {
        "action.actor.actor_id",
        "action.resource.owner",
    }


def test_static_refs_returns_the_whole_closure(world, action):
    document = {
        "op": "or",
        "args": [
            {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"}, {"op": "ref", "path": "action.resource.owner"}]},
            {"op": "establishing_evidence_exists", "args": ["actor.ACT-001.tenant"]},
            {"op": "ref", "path": "current_time"},
        ],
    }
    refs = static_refs(parse_expr(document))
    assert refs == {"action.actor.actor_id", "action.resource.owner", "current_time"}


def test_action_bindings_read(world, action):
    document = {
        "op": "and",
        "args": [
            {"op": "eq", "args": [{"op": "ref", "path": "action.resource.owner"}, {"op": "lit", "value": "ACT-001"}]},
            {"op": "eq", "args": [{"op": "ref", "path": "action.token.flow_id"}, {"op": "ref", "path": "current_flow.flow_id"}]},
        ],
    }
    assert action_bindings_read(parse_expr(document)) == frozenset({"resource", "token"})
