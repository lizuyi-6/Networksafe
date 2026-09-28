"""严格字段校验（设计 §3 D6）：frozen dataclass + 显式校验，无隐式 coerce。

数据工厂最怕"字符串被悄悄转成数字"。这些测试把每个 ``require_*`` 的边界钉住：
``bool`` 不是 ``int``、``None`` 不是缺省、数组不是字符串、未知键不是宽容。
"""
from __future__ import annotations

import pytest

from security_world.model import (
    ModelError,
    collect_entities,
)
from security_world.model.entities import (
    Actor,
    CacheEntry,
    EvidenceItem,
    Invariant,
    PolicyRule,
    Resource,
    Role,
    Session,
    Sink,
    StateSnapshot,
    Token,
    Workflow,
)


def _actor_document(**overrides):
    document = {
        "actor_id": "ACT-001",
        "actor_type": "user",
        "identity": {"identity_id": "ID-001"},
        "roles": ["ROLE-A"],
        "tenant": None,
        "authentication_state": "authenticated",
    }
    document.update(overrides)
    return document


# --------------------------------------------------------------------------- #
# 无隐式转换
# --------------------------------------------------------------------------- #
def test_bool_is_not_accepted_as_an_integer():
    with pytest.raises(ModelError, match="需要 integer"):
        Actor.from_document(_actor_document(privilege_version=True))


def test_string_is_not_accepted_as_an_integer():
    with pytest.raises(ModelError, match="需要 integer"):
        Actor.from_document(_actor_document(privilege_version="2"))


def test_float_is_not_accepted_as_an_integer():
    with pytest.raises(ModelError, match="需要 integer"):
        Actor.from_document(_actor_document(privilege_version=2.0))


def test_integer_is_not_accepted_as_a_boolean():
    with pytest.raises(ModelError, match="需要 boolean"):
        Session.from_document(
            {
                "session_id": "SES-001",
                "principal": "ACT-001",
                "created_at": "2026-01-01T00:00:00Z",
                "authenticated_at": "2026-01-01T00:00:00Z",
                "auth_strength": "password",
                "valid": 1,
                "revoked": False,
                "expires_at": "2026-01-02T00:00:00Z",
                "privilege_snapshot": {"roles": [], "privileges": [], "privilege_version": 0},
                "flow_id": "FLOW-A",
            }
        )


def test_string_is_not_accepted_where_an_array_is_required():
    with pytest.raises(ModelError, match="需要 string 数组"):
        Actor.from_document(_actor_document(roles="ROLE-A"))


def test_array_is_not_accepted_where_an_object_is_required():
    with pytest.raises(ModelError, match="需要 object"):
        Actor.from_document(_actor_document(identity=["ID-001"]))


# --------------------------------------------------------------------------- #
# 未知键 / 缺失键 / 枚举
# --------------------------------------------------------------------------- #
def test_unknown_keys_are_rejected():
    with pytest.raises(ModelError, match="schema 未定义的键"):
        Actor.from_document(_actor_document(actorID="ACT-001"))


def test_missing_required_keys_are_rejected():
    with pytest.raises(ModelError, match="缺少必填键"):
        Actor.from_document({"actor_id": "ACT-001"})


def test_enum_violations_are_rejected():
    with pytest.raises(ModelError, match="不在枚举"):
        Actor.from_document(_actor_document(actor_type="robot"))
    with pytest.raises(ModelError, match="不在枚举"):
        Actor.from_document(_actor_document(authentication_state="sort_of_authenticated"))


def test_empty_strings_are_rejected_for_identifier_fields():
    with pytest.raises(ModelError, match="不允许空字符串"):
        Actor.from_document(_actor_document(actor_id=""))


def test_non_string_object_keys_are_rejected():
    with pytest.raises(ModelError, match="object 键必须是字符串"):
        Actor.from_document(_actor_document(attributes={1: "x"}))


def test_duplicate_array_items_are_rejected_where_unique():
    with pytest.raises(ModelError, match="必须唯一"):
        Actor.from_document(_actor_document(roles=["ROLE-A", "ROLE-A"]))


# --------------------------------------------------------------------------- #
# 可选字段：None == 文档里没有这个键
# --------------------------------------------------------------------------- #
def test_optional_fields_round_trip_without_inventing_keys():
    document = _actor_document()
    actor = Actor.from_document(document)
    assert actor.to_document() == document
    assert actor.privilege_version is None
    assert actor.display_name is None
    assert actor.attributes is None


def test_explicit_false_is_distinguishable_from_absent():
    """``is_default_rule: false`` 显式写出时必须保留，不能被折成缺省。"""
    present = PolicyRule.from_document(
        {
            "policy_id": "POL-A",
            "action": {"operation": "read"},
            "effect": "allow",
            "condition": {"op": "lit", "value": True},
            "is_default_rule": False,
        }
    )
    absent = PolicyRule.from_document(
        {
            "policy_id": "POL-A",
            "action": {"operation": "read"},
            "effect": "allow",
            "condition": {"op": "lit", "value": True},
        }
    )
    assert present.to_document()["is_default_rule"] is False
    assert "is_default_rule" not in absent.to_document()
    assert present.is_default is False and absent.is_default is False


def test_policy_effective_priority_defaults_to_zero():
    rule = PolicyRule.from_document(
        {
            "policy_id": "POL-A",
            "action": {"operation": "read"},
            "effect": "deny",
            "condition": {"op": "lit", "value": True},
        }
    )
    assert rule.effective_priority == 0
    assert rule.needs_fresh is False


# --------------------------------------------------------------------------- #
# 自由形态字段被深拷、与入参文档断开
# --------------------------------------------------------------------------- #
def test_free_form_objects_are_detached_from_the_source_document():
    document = _actor_document(attributes={"nested": {"list": [1, 2]}})
    actor = Actor.from_document(document)
    document["attributes"]["nested"]["list"].append(3)
    assert actor.to_document()["attributes"] == {"nested": {"list": [1, 2]}}


def test_evidence_value_accepts_any_json_type():
    for value in (None, "x", 3, 3.5, True, {"a": 1}, [1, 2]):
        item = EvidenceItem.from_document(
            {
                "evidence_id": "EV-001",
                "type": "ownership_record",
                "asserts_ref": "resource.RES-001.owner",
                "value": value,
                "source": "db",
                "provenance": "system_of_record",
                "trust_level": "trusted",
                "freshness": "fresh",
                "attacker_controllable": False,
                "visible_in_observation": True,
            }
        )
        assert item.value == value


# --------------------------------------------------------------------------- #
# 往返契约
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("factory", "document"),
    [
        (Role.from_document, {"role_id": "ROLE-A", "name": "a", "privileges": ["p"]}),
        (Actor.from_document, _actor_document()),
        (
            Resource.from_document,
            {
                "resource_id": "RES-001",
                "resource_type": "file",
                "owner": "ACT-001",
                "sensitivity": "internal",
                "state": "active",
            },
        ),
        (
            Session.from_document,
            {
                "session_id": "SES-001",
                "principal": "ACT-001",
                "created_at": "2026-01-01T00:00:00Z",
                "authenticated_at": "2026-01-01T00:00:00Z",
                "auth_strength": "password",
                "valid": True,
                "revoked": False,
                "expires_at": "2026-01-02T00:00:00Z",
                "privilege_snapshot": {"roles": [], "privileges": [], "privilege_version": 0},
                "flow_id": "FLOW-A",
            },
        ),
        (
            Token.from_document,
            {
                "token_id": "TOK-001",
                "issuer": "auth",
                "subject": "ACT-001",
                "audience": ["api"],
                "scope": ["read"],
                "created_at": "2026-01-01T00:00:00Z",
                "expires_at": "2026-01-02T00:00:00Z",
                "one_time": True,
                "used": False,
                "parent_token": None,
                "flow_id": "FLOW-A",
                "privilege_version": 0,
            },
        ),
        (
            Workflow.from_document,
            {
                "workflow_id": "WFL-A",
                "name": "w",
                "states": ["a", "b"],
                "initial_state": "a",
                "transitions": [{"from_state": "a", "to_state": "b"}],
                "instances": [
                    {"instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "a"}
                ],
            },
        ),
        (
            Sink.from_document,
            {"sink_id": "SINK-1", "kind": "sql", "parameterized": False, "sanitized": False},
        ),
        (
            CacheEntry.from_document,
            {
                "cache_id": "CACHE-1",
                "cached_subject": "actor.ACT-001.privilege_version",
                "cached_value": 3,
                "source_of_truth": "SVC-DB",
                "fresh": True,
            },
        ),
        (
            StateSnapshot.from_document,
            {"snapshot_id": "SNAP-001", "at": "2026-01-01T00:00:00Z", "label": "now"},
        ),
        (
            Invariant.from_document,
            {
                "invariant_id": "INV-A",
                "category": "ownership",
                "expr": {"op": "lit", "value": True},
                "severity": "high",
                "applies_to": ["*"],
            },
        ),
    ],
)
def test_from_document_to_document_round_trips(factory, document):
    instance = factory(document)
    assert instance.to_document() == document
    assert factory(instance.to_document()) == instance


def test_collect_entities_flattens_workflow_instances():
    document = {
        "actors": [_actor_document()],
        "workflows": [
            {
                "workflow_id": "WFL-A",
                "name": "w",
                "states": ["a", "b"],
                "initial_state": "a",
                "transitions": [{"from_state": "a", "to_state": "b"}],
                "instances": [
                    {"instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "a"},
                    {"instance_id": "WFI-002", "resource_id": "RES-002", "current_state": "b"},
                ],
            }
        ],
    }
    entities = collect_entities(document)
    assert set(entities["actor"]) == {"ACT-001"}
    assert set(entities["workflow"]) == {"WFL-A"}
    assert set(entities["workflow_instance"]) == {"WFI-001", "WFI-002"}
    assert entities["workflow_instance"]["WFI-002"]["current_state"] == "b"


def test_collect_entities_rejects_duplicate_ids():
    document = {"actors": [_actor_document(), _actor_document()]}
    with pytest.raises(ModelError, match="重复"):
        collect_entities(document)


def test_collect_entities_rejects_duplicate_workflow_instance_ids():
    document = {
        "workflows": [
            {
                "workflow_id": "WFL-A",
                "name": "w",
                "states": ["a", "b"],
                "initial_state": "a",
                "transitions": [{"from_state": "a", "to_state": "b"}],
                "instances": [
                    {"instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "a"}
                ],
            },
            {
                "workflow_id": "WFL-B",
                "name": "w2",
                "states": ["a", "b"],
                "initial_state": "a",
                "transitions": [{"from_state": "a", "to_state": "b"}],
                "instances": [
                    {"instance_id": "WFI-001", "resource_id": "RES-002", "current_state": "a"}
                ],
            },
        ]
    }
    with pytest.raises(ModelError, match="重复"):
        collect_entities(document)


def test_action_pattern_matching_semantics():
    from security_world.model.entities import ActionPattern

    pattern = ActionPattern(operation="read", resource_type="order")
    assert pattern.matches("read", "order")
    assert not pattern.matches("read", "file")
    assert not pattern.matches("refund", "order")
    star = ActionPattern(operation="*")
    assert star.matches("anything")
    assert star.matches("anything", "whatever")
    # resource_type 省略 = 任意
    loose = ActionPattern(operation="read")
    assert loose.matches("read", "file")


def test_invariant_applies_to_semantics():
    invariant = Invariant.from_document(
        {
            "invariant_id": "INV-A",
            "category": "ownership",
            "expr": {"op": "lit", "value": True},
            "severity": "high",
            "applies_to": ["read", "refund"],
        }
    )
    assert invariant.applies_to_operation("read")
    assert not invariant.applies_to_operation("delete")
    star = Invariant.from_document(
        {
            "invariant_id": "INV-B",
            "category": "ownership",
            "expr": {"op": "lit", "value": True},
            "severity": "high",
            "applies_to": ["*"],
        }
    )
    assert star.applies_to_operation("whatever")
