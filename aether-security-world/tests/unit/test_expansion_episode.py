"""episode 组装与家族展开：schema 合法性、oracle 重算、model_visible 边界。

``assemble_episode`` 是 L4 的组装入口，也是"标签只能由 oracle 产生"（I-1）在组装期
的强制点：调用方传入的 ``oracle_output`` 只被当作待验证对象，与
``(world, action, evidence_view)`` 的重算结果不一致即抛。``expand_family`` 则把
§9.1 的家族结构（base + critical + irrelevant + masked）跑通，并证明 R4：
预期不符时引擎记录 ``actual_effect`` 而不是改标签。
"""
from __future__ import annotations

import pytest
from asw_worlds import make_action
from asw_expansion import ownership_world, spec_from_world, timeline_for

from security_world.expansion import (
    EpisodeAssemblyError,
    ExpansionConfig,
    assemble_episode,
    expand_family,
    instantiate,
)
from security_world.expansion.config import ExpansionConfig as _Config
from security_world.expansion.rendering import render
from security_world.model import (
    WorldSpec,
    compile_spec,
    validate_episode_document,
    validate_world_document,
)
from security_world.model.canonical import canonical_json
from security_world.oracle import EvidenceView, run_oracle


def _assemble_base(**overrides):
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    config = ExpansionConfig.default()
    observation = render(
        world,
        action,
        renderer=config.renderer,
        seed=5,
        allowlist=config.projection_allowlist,
        timeline=timeline_for(),
    )
    kwargs = {
        "world": world,
        "spec": None,
        "family_id": "CF-" + "0" * 12,
        "variant_type": "base",
        "action": action,
        "timeline": timeline_for(),
        "observation": observation,
    }
    kwargs.update(overrides)
    return assemble_episode(**kwargs)


def test_assembled_episode_validates_against_schema():
    episode = _assemble_base()
    document = episode.to_document()
    errors = validate_episode_document(document)
    assert not errors, errors
    assert document["variant_type"] == "base"
    assert document["oracle_output"]["world_truth"] == "attack"
    assert document["provenance"]["pipeline_version"] == "0.1.0"


def test_assembled_episode_model_visible_boundary(model_visible_boundary):
    episode = _assemble_base()
    model_visible_boundary(episode.to_document())


def test_decision_metadata_carries_classification_and_hidden_ids():
    episode = _assemble_base()
    metadata = episode.to_document()["observation"]["decision_metadata"]
    assert {item["evidence_id"] for item in metadata["evidence_classification"]} == {
        "EV-OWN",
        "EV-NC",
    }
    assert metadata["hidden_evidence_ids"] == []
    assert metadata["evidence_availability_level"] == "complete"


def test_oracle_output_is_recomputed_not_trusted():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = render(
        world,
        action,
        renderer="http_request",
        seed=5,
        allowlist=ExpansionConfig.default().projection_allowlist,
        timeline=timeline_for(),
    )
    forged = run_oracle(world, action, EvidenceView.from_world(world)).to_document()
    forged["world_truth"] = "safe"  # 伪造标签
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        assemble_episode(
            world=world,
            spec=None,
            family_id="CF-" + "0" * 12,
            variant_type="base",
            action=action,
            timeline=timeline_for(),
            observation=observation,
            oracle_output=forged,
        )
    assert excinfo.value.reason_code == "oracle_output_mismatch"


def test_matching_oracle_output_accepted():
    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = render(
        world,
        action,
        renderer="http_request",
        seed=5,
        allowlist=ExpansionConfig.default().projection_allowlist,
        timeline=timeline_for(),
    )
    expected = run_oracle(world, action, EvidenceView.from_world(world))
    episode = assemble_episode(
        world=world,
        spec=None,
        family_id="CF-" + "0" * 12,
        variant_type="base",
        action=action,
        timeline=timeline_for(),
        observation=observation,
        oracle_output=expected,
    )
    assert canonical_json(episode.oracle_output.to_document()) == canonical_json(
        expected.to_document()
    )


def test_intervention_required_for_intervention_variants():
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        _assemble_base(variant_type="critical_intervention")
    assert excinfo.value.reason_code == "intervention_required"
    with pytest.raises(EpisodeAssemblyError):
        _assemble_base(variant_type="irrelevant_perturbation")


def test_empty_timeline_rejected():
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        _assemble_base(timeline=())
    assert excinfo.value.reason_code == "empty_timeline"


def test_unknown_variant_type_rejected():
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        _assemble_base(variant_type="counterfactual")
    assert excinfo.value.reason_code == "unknown_variant_type"


def test_generator_provenance_is_a_closed_allowlist():
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        _assemble_base(generator_provenance={"model": "x", "hypothesized_verdict": "attack"})
    assert excinfo.value.reason_code == "bad_generator_provenance"
    with pytest.raises(EpisodeAssemblyError):
        _assemble_base(generator_provenance={"model": "x"})
    with pytest.raises(EpisodeAssemblyError):
        _assemble_base(
            generator_provenance={
                "model": "x",
                "model_version": "1",
                "prompt_version": "1",
                "prompt_hash": "not-hex",
            }
        )


def test_generator_provenance_derived_from_spec():
    world = ownership_world()
    spec = spec_from_world(
        world,
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
    )
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = render(
        world,
        action,
        renderer="http_request",
        seed=5,
        allowlist=ExpansionConfig.default().projection_allowlist,
        timeline=timeline_for(),
    )
    episode = assemble_episode(
        world=world,
        spec=spec,
        family_id="CF-" + "0" * 12,
        variant_type="base",
        action=action,
        timeline=timeline_for(),
        observation=observation,
    )
    provenance = episode.to_document()["provenance"]["generator_provenance"]
    assert set(provenance) <= {
        "model", "model_version", "prompt_version", "prompt_hash",
        "raw_generation_id", "decoding_parameters",
    }
    assert len(provenance["prompt_hash"]) == 64


def test_world_spec_mismatch_rejected():
    world = ownership_world()
    other = ownership_world(world_id="W-900999")
    spec = spec_from_world(
        other, critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),)
    )
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = render(
        world,
        action,
        renderer="http_request",
        seed=5,
        allowlist=ExpansionConfig.default().projection_allowlist,
        timeline=timeline_for(),
    )
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        assemble_episode(
            world=world,
            spec=spec,
            family_id="CF-" + "0" * 12,
            variant_type="base",
            action=action,
            timeline=timeline_for(),
            observation=observation,
        )
    assert excinfo.value.reason_code == "world_spec_mismatch"


def test_observation_projection_mismatch_rejected():
    """观测里的证据投影与视图权威可见性不一致 ⇒ 拒绝（S7）。"""
    from security_world.expansion import Observation

    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = render(
        world,
        action,
        renderer="http_request",
        seed=5,
        allowlist=ExpansionConfig.default().projection_allowlist,
        timeline=timeline_for(),
    )
    tampered = Observation(
        renderer=observation.renderer,
        current_time=observation.current_time,
        request=observation.request,
        evidence=(),  # 投影被清空
        timeline=observation.timeline,
        surface=observation.surface,
    )
    with pytest.raises(EpisodeAssemblyError) as excinfo:
        assemble_episode(
            world=world,
            spec=None,
            family_id="CF-" + "0" * 12,
            variant_type="base",
            action=action,
            timeline=timeline_for(),
            observation=tampered,
        )
    assert excinfo.value.reason_code == "observation_projection_mismatch"


def test_episode_ids_are_unique_across_variants():
    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        irrelevant_axes=("observation.request.headers.User-Agent",),
    )
    result = expand_family(spec, seed=3)
    ids = [episode.episode_id for episode in result.variants]
    assert len(ids) == len(set(ids)), ids


# --------------------------------------------------------------------------- #
# expand_family
# --------------------------------------------------------------------------- #


def _spec():
    return spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
        irrelevant_axes=(
            "observation.request.headers.User-Agent",
            "observation.rendering.trace_id",
        ),
    )


def test_expand_family_produces_the_documented_variants():
    result = expand_family(_spec(), seed=3)
    types = [episode.variant_type for episode in result.variants]
    assert types.count("base") == 1
    assert types.count("critical_intervention") == 1
    assert types.count("irrelevant_perturbation") == 2
    assert types.count("evidence_masked") >= 1
    assert result.family_id.startswith("CF-")


def test_expand_family_variants_all_validate_against_schema(model_visible_boundary):
    result = expand_family(_spec(), seed=3)
    for episode in result.variants:
        errors = validate_episode_document(episode.to_document())
        assert not errors, (episode.episode_id, errors)
        model_visible_boundary(episode.to_document())


def test_expand_family_diffs_match_variant_types():
    result = expand_family(_spec(), seed=3)
    for episode in result.variants:
        diff = result.diffs[episode.episode_id]
        if episode.variant_type == "critical_intervention":
            assert diff.changed_paths == ("resource.RES-001.owner",)
        else:
            assert diff.is_empty()


def test_expand_family_records_actual_effect_for_critical_intervention():
    result = expand_family(_spec(), seed=3)
    (episode,) = result.by_variant_type("critical_intervention")
    intervention = episode.to_document()["intervention"]
    assert intervention["expected_effect"] == "verdict_flip"
    assert intervention["actual_effect"] == "verdict_flip"
    assert episode.to_document()["oracle_output"]["world_truth"] == "safe"


def test_expand_family_records_mismatch_instead_of_relabelling():
    """R4：先验预期写错时，引擎记录差异，绝不反向改标签。"""
    spec = spec_from_world(
        ownership_world(),
        # before 与现值不符（世界现值是 ACT-001）⇒ 该轴进 skipped，不被悄悄应用。
        critical_axes=(("resource.RES-001.owner", "ACT-002", "ACT-003"),),
    )
    result = expand_family(spec, seed=3)
    assert result.by_variant_type("critical_intervention") == ()
    critical_skips = [
        item["reason"] for item in result.skipped if item.get("variant") == "critical_intervention"
    ]
    assert critical_skips == ["hypothesis_before_mismatch"]


def test_expand_family_skips_critical_axes_without_a_reader():
    """REVISION 3（P0-4）：没有 in-scope policy/invariant 读取的 critical 轴被跳过并留痕。

    ``resource.RES-001.state`` 在 critical_axes_whitelist 里、路径也可解析，但
    ownership_world 的策略与不变量只读 ``actor_id`` / ``owner``——改 state 动不了
    任何判决。展开它只会得到一个必然 ``verdict_invariant`` 的假干预（然后被 G5 拒），
    不如在选择期跳过并记 ``axis_skipped_no_reader``。
    """
    spec = spec_from_world(
        ownership_world(),
        critical_axes=(
            ("resource.RES-001.owner", "ACT-001", "ACT-003"),  # 有读者（策略读 owner）
            ("resource.RES-001.state", "paid", "refunded"),  # 无读者
        ),
    )
    result = expand_family(spec, seed=3)
    critical = result.by_variant_type("critical_intervention")
    assert len(critical) == 1
    assert critical[0].intervention["intervention_variable"] == "resource.RES-001.owner"
    skips = {
        (item.get("axis_id"), item.get("reason"))
        for item in result.skipped
        if item.get("variant") == "critical_intervention"
    }
    assert ("AXIS-002", "axis_skipped_no_reader") in skips, sorted(skips)


def test_expand_family_keeps_lineage_axes_with_a_parent_chain_reader():
    """血缘 op 读父链：``lineage_depth(action.token.*)`` 让 ``parent_token`` 有读者。"""
    from security_world.expansion.episode import _axis_has_reader, _axis_reader_keys
    from security_world.policy import Action

    spec = spec_from_world(
        _lineage_world(),
        critical_axes=(("token.TOK-002.parent_token", "TOK-001", "TOK-003"),),
    )
    world = instantiate(spec, seed=spec.seed)
    action = Action.from_document(
        {
            "action_id": "ACTN-LINEAGE",
            "operation": "read",
            "actor": "ACT-003",
            "resource": "RES-001",
            "token": "TOK-002",
            "flow_id": "FLOW-READ",
            "at": spec.current_state.at,
        }
    )
    readers = _axis_reader_keys(world, action)
    assert "token.parent_token" in readers.shapes
    assert _axis_has_reader("token.TOK-002.parent_token", readers, world)
    # 一个没人读的 token 字段仍然没有读者（预检不是永放行）
    assert not _axis_has_reader("token.TOK-002.one_time", readers, world)


def _lineage_world():
    """一个血缘世界：策略用 ``lineage_depth(action.token.*)`` 判 parent_token 链。"""
    from asw_worlds import with_entities

    world = ownership_world()
    document = world.to_document()
    tokens = [
        {
            "token_id": "TOK-001",
            "token_type": "access",
            "issuer": "ExampleShop",
            "subject": "ACT-001",
            "audience": ["ExampleShop"],
            "scope": ["order.read.own"],
            "created_at": "2026-09-20T08:00:00Z",
            "expires_at": "2026-09-20T09:00:00Z",
            "one_time": False,
            "used": False,
            "parent_token": None,
            "flow_id": "FLOW-ROOT",
            "privilege_version": 1,
        },
        {
            "token_id": "TOK-002",
            "token_type": "access",
            "issuer": "ExampleShop",
            "subject": "ACT-001",
            "audience": ["ExampleShop"],
            "scope": ["order.read.own"],
            "created_at": "2026-09-20T08:00:00Z",
            "expires_at": "2026-09-20T09:00:00Z",
            "one_time": False,
            "used": False,
            "parent_token": "TOK-001",
            "flow_id": "FLOW-READ",
            "privilege_version": 1,
        },
    ]
    policies = (
        {
            "policy_id": "POL-LINEAGE",
            "action": {"operation": "read", "resource_type": "order"},
            "effect": "allow",
            "condition": {
                "op": "le",
                "args": [
                    {"op": "lineage_depth", "args": [{"op": "ref", "path": "action.token.flow_id"}]},
                    {"op": "lit", "value": 1},
                ],
            },
        },
        {
            "policy_id": "POL-DEFAULT-DENY",
            "action": {"operation": "*"},
            "effect": "deny",
            "condition": {"op": "lit", "value": True},
            "is_default_rule": True,
        },
    )
    return with_entities(world, tokens=tokens, policies=policies)


def test_expand_family_skips_unconstructible_masking_levels():
    """ownership_world 不声明矛盾/陈旧/攻击者可控证据 ⇒ 三个 level 进 skipped。"""
    result = expand_family(_spec(), seed=3)
    reasons = {
        (item.get("level"), item["reason"]) for item in result.skipped
    }
    assert ("contradictory", "level_rule_not_achieved") in reasons
    assert ("stale", "world_declares_no_stale_evidence") in reasons
    assert ("attacker_controlled", "world_declares_no_attacker_controllable_evidence") in reasons


def test_expand_family_masked_variant_downgrades_observable_decision():
    result = expand_family(_spec(), seed=3)
    masked = [
        episode
        for episode in result.by_variant_type("evidence_masked")
        if episode.to_document()["oracle_output"]["observable_decision"] == "insufficient_evidence"
    ]
    assert masked, "insufficient 掩蔽变体必须把 observable_decision 降级"
    for episode in masked:
        metadata = episode.to_document()["observation"]["decision_metadata"]
        assert metadata["evidence_availability_level"] == "insufficient"


def test_expand_family_is_deterministic():
    first = expand_family(_spec(), seed=3)
    second = expand_family(_spec(), seed=3)
    assert [e.episode_id for e in first.variants] == [e.episode_id for e in second.variants]
    assert canonical_json([e.to_document() for e in first.variants]) == canonical_json(
        [e.to_document() for e in second.variants]
    )


def test_instantiate_matches_compile_spec():
    spec = _spec()
    assert canonical_json(instantiate(spec).to_document()) == canonical_json(
        compile_spec(spec).to_document()
    )
    assert validate_world_document(instantiate(spec).to_document()) == []


def test_expand_family_config_controls_variant_counts():
    spec = _spec()
    config = _Config.default()
    trimmed = _Config(
        variants_per_world={"base": 1, "critical_intervention": 0, "irrelevant_perturbation": 1, "evidence_masked": 1},
        critical_axes_whitelist=config.critical_axes_whitelist,
        irrelevant_axes=config.irrelevant_axes,
        masking_levels=config.masking_levels,
        level_to_hidden_set=config.level_to_hidden_set,
        renderer=config.renderer,
        seed=config.seed,
        per_world_level_quota={"insufficient": 1},
        decoy_masking_per_world=0,
    )
    result = expand_family(spec, seed=3, config=trimmed)
    types = [episode.variant_type for episode in result.variants]
    assert types.count("critical_intervention") == 0
    assert types.count("irrelevant_perturbation") == 1
    assert types.count("evidence_masked") == 1


def test_expand_family_action_and_timeline_come_from_the_spec():
    result = expand_family(_spec(), seed=3)
    episode = result.variants[0]
    document = episode.to_document()
    assert document["action"]["operation"] == "read"
    assert document["action"]["resource"] == "RES-001"
    assert document["action"]["flow_id"] == "FLOW-READ"
    assert [event["event_id"] for event in document["timeline"]] == ["EVT-000", "EVT-001"]
    assert document["current_event"]["event_id"] == "EVT-001"
    # 时间线单调（Gate 2 性质在组装期就成立）。
    stamps = [event["at"] for event in document["timeline"]]
    assert stamps == sorted(stamps)


# --------------------------------------------------------------------------- #
# 与架构师黄金 fixture 的交叉验证
# --------------------------------------------------------------------------- #


def test_reference_spec_base_variant_reproduces_golden_oracle_output(
    reference_world_spec, reference_episode
):
    """参考 spec 展开出的 base 变体，oracle 输出与黄金 episode fixture 逐字段一致。

    这是"引擎与 L0 契约没有漂移"的单点证据：黄金 fixture 的 ``oracle_output`` 是
    架构师手写的期望，本测试证明展开层 + oracle 能从 spec **重新算出**同一份判决
    （而不是只有 fixture 自己自洽）。
    """
    spec = WorldSpec.from_document(reference_world_spec)
    result = expand_family(spec, seed=spec.seed)
    for episode in result.variants:
        assert not validate_episode_document(episode.to_document()), episode.episode_id
    actual = result.by_variant_type("base")[0].to_document()["oracle_output"]
    expected = reference_episode["oracle_output"]
    assert actual["world_truth"] == expected["world_truth"] == "attack"
    assert actual["observable_decision"] == expected["observable_decision"] == "attack"
    assert actual["violated_invariants"] == expected["violated_invariants"]
    assert actual["satisfied_invariants"] == expected["satisfied_invariants"]
    assert actual["skipped_invariants"] == expected["skipped_invariants"]


def test_reference_spec_falsified_axis_is_recorded_not_relabelled(reference_world_spec):
    """参考 spec 的 AXIS-001 预期被 oracle 证伪，引擎只记录、不改标签（R4）。

    实测：owner 改成 ACT-003 后 ownership 满足，但 tenant_isolation 与
    session_revocation 两条不变量仍违反 ⇒ world_truth 仍是 attack。spec 的
    ``expected_effect`` 写着 ``verdict_flip``，Gate 5 因此必须拒绝这个家族——
    这正是 R4 的行为（预期只能先验声明，证伪即拒）。黄金 fixture 的
    ``validation_summary`` 里 "owner intervention flips verdict to safe" 的备注与
    当前 oracle 结论不一致，以 oracle 为准（如实记录，不改 fixture）。
    """
    spec = WorldSpec.from_document(reference_world_spec)
    result = expand_family(spec, seed=spec.seed)
    (episode,) = result.by_variant_type("critical_intervention")
    document = episode.to_document()
    intervention = document["intervention"]
    assert intervention["intervention_variable"] == "resource.RES-001.owner"
    assert intervention["expected_effect"] == "verdict_flip"
    assert intervention["actual_effect"] == "verdict_invariant"
    assert document["oracle_output"]["world_truth"] == "attack"
    assert result.diffs[episode.episode_id].is_single("resource.RES-001.owner")
