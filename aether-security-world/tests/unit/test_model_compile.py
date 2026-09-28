"""``compile_spec`` 的五步契约（设计 §4.1）与 family id 派生（§10.1）。

核心断言分两类：

* **正例**：参考 spec 逐字编译成参考 instance——``hypotheses`` /
  ``attack_family`` 被丢弃并记录，``world_family_id`` 是派生值，其余字段一字不差。
* **负例**：悬空引用、token 环、角色悬空、轴越界、历史非单调、恒真放行策略
  ——全部拒绝并给出**稳定 reason_code**。拒绝必须是响亮的，不能靠"猜一个合理值"
  把坏 spec 补成能跑的世界。
"""
from __future__ import annotations

import copy
import json

import pytest

from security_world.model import (
    DROPPED_HYPOTHESIS_FIELDS,
    FALLBACK_CRITICAL_AXES_WHITELIST,
    CompileError,
    WorldInstance,
    WorldSpec,
    compile_spec,
    derive_counterfactual_family_id,
    derive_world_family_id,
    load_default_config,
    load_world_spec,
    validate_world_document,
)


@pytest.fixture(scope="module")
def spec_document(reference_world_spec):
    return copy.deepcopy(reference_world_spec)


@pytest.fixture(scope="module")
def reference_spec(examples_dir):
    return load_world_spec(examples_dir / "world-spec.example.json")


@pytest.fixture(scope="module")
def compiled(reference_spec):
    return compile_spec(reference_spec)


# --------------------------------------------------------------------------- #
# 正例：spec -> instance
# --------------------------------------------------------------------------- #
def test_compile_spec_reproduces_the_reference_instance(compiled, reference_world):
    """参考夹具就是 compile_spec 的worked example：除派生的 family id 外逐字相同。"""
    assert compiled.to_document() == reference_world


def test_compile_spec_copies_shared_fields_verbatim(compiled, reference_world_spec):
    document = compiled.to_document()
    for key in (
        "schema_version", "world_id", "application_domain", "seed", "provenance", "application",
        "roles", "actors", "resources", "sessions", "tokens", "credentials", "workflows",
        "services", "caches", "trust_boundaries", "policies", "invariants", "state_history",
        "current_state", "evidence",
    ):
        assert document[key] == reference_world_spec[key], f"{key} 必须逐字复制"


def test_compile_spec_drops_the_hypothesis_block(compiled, reference_world_spec):
    document = compiled.to_document()
    assert "hypotheses" not in document
    assert "attack_family" not in document
    assert "notes" not in document
    assert "critical_state_variables" not in document
    assert "irrelevant_state_variables" not in document
    assert "episode_templates" not in document
    assert document["compile"]["dropped_hypothesis_fields"] == [
        key for key in DROPPED_HYPOTHESIS_FIELDS if key in reference_world_spec
    ]
    assert document["compile"]["dropped_hypothesis_fields"] == ["hypotheses", "attack_family"]


def test_compile_spec_writes_the_audit_block(compiled):
    compile_block = compiled.to_document()["compile"]
    assert compile_block["compiler_version"]
    assert compile_block["source_spec_id"] == compiled.world_id
    assert compile_block["derived_world_family_id"] is True
    assert compile_block["reason_codes"] == []


def _minimal_spec_document() -> dict:
    """一个不含 sessions/tokens/credentials/services/caches/trust_boundaries 的最小 spec。

    用来验证 S22 的"缺省注入空数组"，同时也是一个能编译通过的最小世界。
    """
    return {
        "schema_version": "0.1",
        "world_id": "W-MINIMAL",
        "application_domain": "saas",
        "seed": 1,
        "provenance": {
            "origin": "handcrafted",
            "generator_model": "human",
            "generator_model_version": "n/a",
            "prompt_version": "n/a",
            "prompt_hash": "0" * 64,
            "generation_timestamp": "2026-01-01T00:00:00Z",
        },
        "attack_family": "benign",
        "application": {
            "name": "Minimal API",
            "description": "A minimal synthetic application.",
            "endpoints": [{"path": "/files/{id}", "method": "GET", "operation": "read"}],
        },
        "roles": [{"role_id": "ROLE-A", "name": "member", "privileges": ["file.read"]}],
        "actors": [
            {
                "actor_id": "ACT-001",
                "actor_type": "user",
                "identity": {"identity_id": "ID-001"},
                "roles": ["ROLE-A"],
                "tenant": None,
                "authentication_state": "authenticated",
            }
        ],
        "resources": [
            {
                "resource_id": "RES-001",
                "resource_type": "file",
                "owner": "ACT-001",
                "sensitivity": "internal",
                "state": "active",
            }
        ],
        "workflows": [
            {
                "workflow_id": "WFL-A",
                "name": "minimal",
                "states": ["a", "b"],
                "initial_state": "a",
                "transitions": [{"from_state": "a", "to_state": "b"}],
                "instances": [
                    {"instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "a"}
                ],
            }
        ],
        "policies": [
            {
                "policy_id": "POL-DEFAULT-DENY",
                "action": {"operation": "*"},
                "effect": "deny",
                "condition": {"op": "lit", "value": True},
                "is_default_rule": True,
            }
        ],
        "invariants": [
            {
                "invariant_id": "INV-OWNERSHIP-001",
                "category": "ownership",
                "applies_to": ["read"],
                "severity": "high",
                "expr": {
                    "op": "eq",
                    "args": [
                        {"op": "ref", "path": "action.actor.actor_id"},
                        {"op": "ref", "path": "action.resource.owner"},
                    ],
                },
            }
        ],
        "state_history": [
            {"snapshot_id": "SNAP-000", "at": "2026-01-01T00:00:00Z", "label": "before"}
        ],
        "current_state": {
            "snapshot_id": "SNAP-001",
            "at": "2026-01-01T01:00:00Z",
            "label": "now",
        },
        "evidence": [
            {
                "evidence_id": "EV-001",
                "type": "ownership_record",
                "asserts_ref": "resource.RES-001.owner",
                "value": "ACT-001",
                "source": "db",
                "provenance": "system_of_record",
                "trust_level": "trusted",
                "freshness": "fresh",
                "attacker_controllable": False,
                "visible_in_observation": True,
            }
        ],
        "critical_state_variables": ["resource.RES-001.owner"],
        "irrelevant_state_variables": ["observation.request.headers.User-Agent"],
        "hypotheses": {
            "attack_opportunities": [
                {
                    "opportunity_id": "OPP-001",
                    "attack_family": "idor_bola",
                    "target_operation": "read",
                    "hypothesized_verdict": "safe",
                }
            ],
            "expected_counterfactual_axes": [
                {
                    "axis_id": "AXIS-001",
                    "variable": "resource.RES-001.owner",
                    "kind": "critical",
                    "before": "ACT-001",
                    "after": "ACT-002",
                    "expected_effect": "verdict_flip",
                }
            ],
        },
        "episode_templates": [
            {
                "template_id": "TPL-001",
                "decision_event_index": 0,
                "events": [{"event_type": "request", "actor_id": "ACT-001", "t_offset_ms": 0}],
            }
        ],
    }


def test_compile_spec_injects_empty_optional_collections():
    """spec 缺省 sessions/tokens/... 时，instance 注入空数组（§15.3 / S22）。"""
    instance = compile_spec(WorldSpec.from_document(_minimal_spec_document()))
    document = instance.to_document()
    for key in ("sessions", "tokens", "credentials", "services", "caches", "trust_boundaries"):
        assert document[key] == []
    assert document["world_id"] == "W-MINIMAL"


def test_compile_spec_is_deterministic(reference_spec):
    first = compile_spec(reference_spec)
    second = compile_spec(reference_spec)
    assert first.to_document() == second.to_document()
    assert first.world_family_id == second.world_family_id


def test_compile_spec_seed_override_changes_only_the_instance_seed(reference_spec):
    base = compile_spec(reference_spec)
    other = compile_spec(reference_spec, seed=reference_spec.seed + 7)
    assert other.seed == reference_spec.seed + 7
    assert other.world_family_id == base.world_family_id, "family id 只依赖结构，不依赖 seed"


# --------------------------------------------------------------------------- #
# family id 派生
# --------------------------------------------------------------------------- #
def test_world_family_id_is_derived_and_form_pinned(compiled):
    family_id = compiled.world_family_id
    assert family_id.startswith("WF-")
    assert len(family_id) == 15
    int(family_id[3:], 16)  # 12 个十六进制字符
    assert family_id == derive_world_family_id(compiled)


def test_world_family_id_ignores_identifier_renaming(reference_spec):
    """同一模板的表面变体（改 id）必须落进同一连通分量，否则 world_ood 不可分。"""
    document = copy.deepcopy(reference_spec.to_document())
    renaming = {}
    for entity_type, id_field in (
        ("actor", "actor_id"), ("resource", "resource_id"), ("session", "session_id"),
        ("token", "token_id"), ("workflow", "workflow_id"),
    ):
        for entity in document.get(entity_type, []):
            renaming[entity[id_field]] = entity[id_field] + "-X"

    def rename(value):
        if isinstance(value, str):
            return renaming.get(value, value)
        if isinstance(value, dict):
            return {renaming.get(key, key): rename(item) for key, item in value.items()}
        if isinstance(value, list):
            return [rename(item) for item in value]
        return value

    renamed = rename(document)
    # hypotheses 引用了实体 id，但编译期整体丢弃，因此不影响 family id。
    assert compile_spec(WorldSpec.from_document(renamed)).world_family_id == (
        compile_spec(reference_spec).world_family_id
    )


def test_world_family_id_changes_when_structure_changes(reference_spec):
    document = copy.deepcopy(reference_spec.to_document())
    document["actors"].append(copy.deepcopy(document["actors"][0]))
    document["actors"][-1]["actor_id"] = "ACT-009"
    assert compile_spec(WorldSpec.from_document(document)).world_family_id != (
        compile_spec(reference_spec).world_family_id
    )


def test_world_family_id_ignores_state_and_evidence(reference_spec):
    """反事实变体会改状态/证据可见性，family id 必须在同一家族的所有变体上稳定。"""
    document = copy.deepcopy(reference_spec.to_document())
    document["current_state"]["label"] = "T3 改过的标签"
    document["evidence"][0]["visible_in_observation"] = False
    document["state_history"] = document["state_history"][:1]
    assert compile_spec(WorldSpec.from_document(document)).world_family_id == (
        compile_spec(reference_spec).world_family_id
    )


def test_world_family_id_ignores_schema_default_annotation_noise(reference_spec):
    """显式写出 ``is_default_rule: false`` 与省略必须是同一结构（R3）。"""
    document = copy.deepcopy(reference_spec.to_document())
    for policy in document["policies"]:
        if policy["policy_id"] != "POL-DEFAULT-DENY":
            policy.setdefault("is_default_rule", False)
            policy.setdefault("requires_fresh", False)
            policy.setdefault("priority", 0)
    assert compile_spec(WorldSpec.from_document(document)).world_family_id == (
        compile_spec(reference_spec).world_family_id
    )


def test_counterfactual_family_id_is_derived_from_axes(reference_spec):
    family_id = compile_spec(reference_spec).world_family_id
    derived = derive_counterfactual_family_id(
        world_family_id=family_id,
        world_id=reference_spec.world_id,
        seed=reference_spec.seed,
        critical_axes=reference_spec.critical_state_variables,
    )
    assert derived.startswith("CF-") and len(derived) == 15
    # 轴的顺序不影响派生（sorted 后进哈希）。
    assert derived == derive_counterfactual_family_id(
        world_family_id=family_id,
        world_id=reference_spec.world_id,
        seed=reference_spec.seed,
        critical_axes=list(reversed(reference_spec.critical_state_variables)),
    )
    # 换一个轴集合必须换一个家族。
    assert derived != derive_counterfactual_family_id(
        world_family_id=family_id,
        world_id=reference_spec.world_id,
        seed=reference_spec.seed,
        critical_axes=reference_spec.critical_state_variables[:-1],
    )


def test_critical_axes_whitelist_matches_the_config():
    """内置白名单镜像必须与 configs/default.json 逐字一致。"""
    config = load_default_config()
    assert list(config["expansion"]["critical_axes_whitelist"]) == list(
        FALLBACK_CRITICAL_AXES_WHITELIST
    )


# --------------------------------------------------------------------------- #
# 负例：拒绝并给 reason_code
# --------------------------------------------------------------------------- #
def _mutate(spec_document, mutate):
    document = copy.deepcopy(spec_document)
    mutate(document)
    return document


def test_dangling_resource_owner_is_rejected(spec_document):
    def mutate(document):
        document["resources"][0]["owner"] = "ACT-999"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "dangling_ref"


def test_dangling_actor_role_is_rejected(spec_document):
    def mutate(document):
        document["actors"][0]["roles"] = ["ROLE-MISSING"]

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "role_dangling"


def test_dangling_evidence_asserts_ref_is_rejected(spec_document):
    def mutate(document):
        document["evidence"][0]["asserts_ref"] = "resource.RES-999.owner"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "dangling_ref"


def test_dangling_cache_subject_is_rejected(spec_document):
    def mutate(document):
        document["caches"][0]["cached_subject"] = "session.SES-999.valid"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "dangling_ref"


def test_token_parent_cycle_is_rejected(spec_document):
    def mutate(document):
        document["tokens"][1]["parent_token"] = "TOK-002"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "cycle"


def test_unresolvable_dsl_ref_is_rejected(spec_document):
    def mutate(document):
        document["policies"][0]["condition"]["args"][1]["path"] = "resource.RES-999.owner"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "ref_unresolvable"


def test_action_view_ref_without_a_matching_field_is_rejected(spec_document):
    def mutate(document):
        document["invariants"][0]["expr"]["args"][0]["args"][1]["path"] = (
            "action.resource.nonexistent_field"
        )

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "ref_unresolvable"


def test_critical_axis_outside_the_whitelist_is_rejected(spec_document):
    def mutate(document):
        document["critical_state_variables"][0] = "resource.RES-001.sensitivity"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "axis_not_in_whitelist"


def test_critical_axis_pointing_at_an_observation_path_is_rejected(spec_document):
    """B9：原先该规则不存在，负 fixture 其实因别的原因被拒。"""
    def mutate(document):
        document["critical_state_variables"][0] = "observation.request.headers.User-Agent"

    # schema 层先拒（world-spec 的 critical 轴模式是 ID 视图）
    with pytest.raises(Exception):
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))


def test_critical_axis_that_does_not_resolve_is_rejected(spec_document):
    def mutate(document):
        document["critical_state_variables"][0] = "resource.RES-999.owner"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "axis_unresolvable"


def test_non_monotonic_state_history_is_rejected(spec_document):
    def mutate(document):
        document["state_history"][1]["at"] = "2026-09-19T06:00:00Z"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "history_non_monotonic"


def test_current_state_before_history_is_rejected(spec_document):
    def mutate(document):
        document["current_state"]["at"] = "2026-09-19T06:00:00Z"

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "current_state_before_history"


def test_allow_if_true_policy_is_rejected_as_vacuous(spec_document):
    """R5：``allow if true`` 是最典型的策略空洞。"""
    def mutate(document):
        document["policies"][0]["condition"] = {"op": "lit", "value": True}

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "vacuous_policy"


def test_constant_false_policy_is_rejected_as_vacuous(spec_document):
    def mutate(document):
        document["policies"][0]["condition"] = {"op": "lit", "value": False}

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "vacuous_policy"


def test_constant_true_default_deny_is_accepted(spec_document):
    """闭世界兜底规则的常量真值是合法的（参考世界的 POL-DEFAULT-DENY 正是如此）。"""
    def mutate(document):
        document["policies"][0]["condition"] = {"op": "lit", "value": True}
        document["policies"][0]["is_default_rule"] = True

    compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))


def test_applies_to_unknown_operation_is_rejected(spec_document):
    def mutate(document):
        document["invariants"][0]["applies_to"] = ["read", "teleport"]

    with pytest.raises(CompileError) as excinfo:
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))
    assert excinfo.value.reason_code == "applies_to_unknown_operation"


def test_applies_to_star_is_exempt_from_the_endpoint_check(spec_document):
    def mutate(document):
        document["invariants"][0]["applies_to"] = ["*"]

    compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))


def test_irrelevant_axis_must_be_an_observation_path(spec_document):
    def mutate(document):
        document["irrelevant_state_variables"][0] = "resource.RES-001.owner"

    with pytest.raises(Exception):
        compile_spec(WorldSpec.from_document(_mutate(spec_document, mutate)))


def test_a_world_document_with_a_label_field_is_rejected_by_the_schema(spec_document):
    """D1/B12：带 ``ground_truth`` 的世界必须被拒，且拒因就是该键。"""
    instance = compile_spec(WorldSpec.from_document(copy.deepcopy(spec_document))).to_document()
    instance["ground_truth"] = "attack"
    errors = validate_world_document(instance)
    assert errors, "带 ground_truth 的世界必须被 schema 拒绝"
    assert any("ground_truth" in error for error in errors), errors


def test_world_instance_has_no_label_field(compiled):
    """D1 的静态面：instance 结构上不可能携带标签字段。"""
    document = compiled.to_document()
    for forbidden in (
        "ground_truth", "label", "verdict", "attack_family", "hypotheses", "metadata", "notes",
        "world_truth", "observable_decision",
    ):
        assert forbidden not in document
    assert isinstance(compiled, WorldInstance)
