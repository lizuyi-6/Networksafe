"""不变量 registry：可扩展性、模板覆盖度、构造期自校验。

设计 §7.4 的"20 类目录，Phase 1 实现 7 类"：registry 是那 13 类推迟项的挂点，
因此它必须可扩展、键稳定、重复注册显式失败。
"""
from __future__ import annotations

import pytest

from security_world.model.entities import INVARIANT_CATEGORIES, SEVERITIES
from security_world.policy import DslError, parse_expr
from security_world.invariants import (
    ATTACK_CATEGORIES,
    TEMPLATES,
    InvariantTemplate,
    build_invariant,
    build_library,
    invariant_keys,
    invariant_template,
    register_invariant,
    registered_templates,
    templates_by_category,
)
from asw_worlds import actor, make_world, resource


# --------------------------------------------------------------------------- #
# 覆盖度
# --------------------------------------------------------------------------- #
def test_phase1_covers_the_seven_design_categories():
    """设计 §7.4 的 Phase 1 七类全部有模板。"""
    by_category = templates_by_category()
    for category in (
        "ownership",
        "authorization",
        "session_revocation",
        "authentication_state",
        "token_lineage",
        "workflow_transition",
        "tenant_isolation",
        "one_time_token",
    ):
        assert category in by_category, category
        assert by_category[category], category


def test_session_validity_umbrella_maps_to_three_schema_categories():
    """§7.4 的 ``session_validity`` 是合称；schema 枚举里没有这个名字。"""
    assert "session_validity" not in INVARIANT_CATEGORIES
    for category in ("session_revocation", "authentication_state", "session_binding"):
        assert category in templates_by_category()


def test_attack_categories_is_the_engine_private_full_list():
    """ATTACK_CATEGORIES = 全部 20 类，不随作者输入变化（B2）。"""
    assert ATTACK_CATEGORIES == frozenset(INVARIANT_CATEGORIES)
    assert len(ATTACK_CATEGORIES) == 20


def test_invariant_keys_are_sorted_and_unique():
    keys = invariant_keys()
    assert keys == tuple(sorted(keys))
    assert len(keys) == len(set(keys)) == len(TEMPLATES)


def test_every_template_declares_its_bindings_and_category():
    for template in registered_templates():
        assert template.category in INVARIANT_CATEGORIES, template.key
        assert template.bindings, template.key
        assert set(template.bindings) <= {"actor", "resource", "session", "token", "workflow_instance"}
        assert template.default_severity in SEVERITIES
        assert template.default_applies_to
        assert template.summary


def test_every_template_builds_a_parsable_expression():
    for template in registered_templates():
        params = {name: _probe_value(name) for name in template.params}
        expr = template.build_expr(**params)
        assert parse_expr(expr).op != "lit" or not template.params, template.key


def _probe_value(name: str):
    if name in ("support_roles", "groups", "roles", "states"):
        return ("ROLE-PROBE",)
    if name == "max_depth":
        return 1
    return "PROBE"


# --------------------------------------------------------------------------- #
# build_invariant
# --------------------------------------------------------------------------- #
def test_build_invariant_produces_a_valid_document():
    invariant = build_invariant(
        "ownership.owner_only",
        invariant_id="INV-OWN-1",
        applies_to=("read",),
        support_roles=("ROLE-SUPPORT",),
        severity="critical",
        description="owner only read",
        expected_violation_when="principal != owner",
    )
    document = invariant.to_document()
    assert document["invariant_id"] == "INV-OWN-1"
    assert document["category"] == "ownership"
    assert document["severity"] == "critical"
    assert document["applies_to"] == ["read"]
    assert document["description"] == "owner only read"
    assert document["expected_violation_when"] == "principal != owner"
    assert parse_expr(document["expr"]).op == "or"


def test_build_invariant_defaults_come_from_the_template():
    invariant = build_invariant("ownership.owner_only", invariant_id="INV-OWN-2")
    document = invariant.to_document()
    assert document["applies_to"] == ["*"]
    assert document["severity"] == "high"
    # 没有 support_roles ⇒ 纯属主判定（不读 tenant，少一个 consulted fact）
    assert document["expr"]["op"] == "eq"


def test_build_invariant_rejects_unknown_keys_and_bad_params():
    with pytest.raises(DslError):
        build_invariant("ownership.nope", invariant_id="INV-X")
    with pytest.raises(DslError):
        build_invariant("ownership.owner_only", invariant_id="INV-X", unknown_param=1)
    with pytest.raises(DslError):
        build_invariant("ownership.owner_or_group", invariant_id="INV-X")  # 缺 groups
    with pytest.raises(DslError):
        build_invariant("ownership.owner_only", invariant_id="INV-X", support_roles="ROLE-SUPPORT")
    with pytest.raises(DslError):
        build_invariant("token_lineage.depth_at_most", invariant_id="INV-X", max_depth=-1)
    with pytest.raises(DslError):
        build_invariant("ownership.owner_only", invariant_id="")  # 空 id
    with pytest.raises(DslError):
        build_invariant("ownership.owner_only", invariant_id="INV-X", severity="extreme")


def test_build_invariant_rejects_empty_applies_to():
    with pytest.raises(DslError):
        build_invariant("ownership.owner_only", invariant_id="INV-X", applies_to=())


def test_build_library_assigns_sequential_ids():
    invariants = build_library(
        (
            "ownership.owner_only",
            "tenant_isolation.same_tenant",
            "one_time_token.unused::INV-CUSTOM-1",
        ),
        applies_to=("read",),
    )
    assert [item.invariant_id for item in invariants] == ["INV-000", "INV-001", "INV-CUSTOM-1"]
    assert [item.category for item in invariants] == ["ownership", "tenant_isolation", "one_time_token"]


# --------------------------------------------------------------------------- #
# 可扩展性
# --------------------------------------------------------------------------- #
def test_register_invariant_adds_a_new_key():
    key = "replay.nonce_unused"
    template = InvariantTemplate(
        key=key,
        category="replay",
        summary="nonce 不得重复使用（Phase 2 的 13 类之一）",
        build=lambda **_: {
            "op": "not_in",
            "args": [
                {"op": "ref", "path": "action.parameters.nonce"},
                {"op": "ref", "path": "resource.RES-001.attributes.seen_nonces"},
            ],
        },
        bindings=("resource",),
        params=(),
    )
    registered = register_invariant(template)
    assert registered.key == key
    assert key in invariant_keys()
    assert invariant_template(key).category == "replay"
    assert "replay" in templates_by_category()


def test_register_invariant_rejects_duplicate_keys():
    template = InvariantTemplate(
        key="ownership.owner_only",
        category="ownership",
        summary="duplicate",
        build=lambda **_: {"op": "lit", "value": True},
        bindings=(),
    )
    with pytest.raises(DslError):
        register_invariant(template)


def test_register_invariant_rejects_bad_severity_and_empty_applies_to():
    with pytest.raises(DslError):
        register_invariant(
            InvariantTemplate(
                key="x.y",
                category="replay",
                summary="s",
                build=lambda **_: {"op": "lit", "value": True},
                bindings=(),
                default_severity="extreme",
            )
        )
    with pytest.raises(DslError):
        register_invariant(
            InvariantTemplate(
                key="x.z",
                category="replay",
                summary="s",
                build=lambda **_: {"op": "lit", "value": True},
                bindings=(),
                default_applies_to=(),
            )
        )


def test_register_invariant_validates_the_expression_at_registration():
    """注册期就发现模板 bug：产出的 expr 不过 parse_expr 即拒绝。"""
    with pytest.raises(DslError):
        register_invariant(
            InvariantTemplate(
                key="x.bad_expr",
                category="replay",
                summary="s",
                build=lambda **_: {"op": "nope", "args": []},
                bindings=(),
            )
        )
    with pytest.raises(DslError):
        register_invariant(
            InvariantTemplate(
                key="x.bad_path",
                category="replay",
                summary="s",
                build=lambda **_: {"op": "ref", "path": "evidence_view.EV-1.value"},
                bindings=(),
            )
        )


def test_unknown_template_key_lists_the_available_keys():
    with pytest.raises(DslError) as excinfo:
        invariant_template("does.not.exist")
    assert "ownership.owner_only" in str(excinfo.value)


# --------------------------------------------------------------------------- #
# 端到端：模板构造的不变量真的能驱动 oracle
# --------------------------------------------------------------------------- #
def test_library_invariants_drive_the_oracle_end_to_end():
    world = make_world(
        actors=(
            actor("ACT-001", roles=("ROLE-CUSTOMER",), tenant="TEN-001"),
            actor("ACT-004", roles=("ROLE-CUSTOMER",), tenant="TEN-002"),
        ),
        resources=(resource("RES-001", owner="ACT-001", tenant="TEN-001"),),
        invariants=build_library(
            ("ownership.owner_only::INV-OWN", "tenant_isolation.same_tenant::INV-TENANT"),
            applies_to=("read",),
        ),
    )
    from asw_worlds import make_action, run, world_with_full_evidence

    intruder = make_action("read", "ACT-004", resource_id="RES-001")
    output = run(world_with_full_evidence(world, intruder), intruder)
    assert output.world_truth == "attack"
    assert set(output.violated_invariants) == {"INV-OWN", "INV-TENANT"}

    owner = make_action("read", "ACT-001", resource_id="RES-001")
    output = run(world_with_full_evidence(world, owner), owner)
    assert output.violated_invariants == ()
    assert set(output.satisfied_invariants) == {"INV-OWN", "INV-TENANT"}
