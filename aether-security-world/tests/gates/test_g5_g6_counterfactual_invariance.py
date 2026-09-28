"""G5 反事实一致性 + G6 无关不变性。

G5：关键干预必须**单变量**、请求面不变、实际效应等于先验预期（R4：不符即拒，不改标签）。
REVISION 3（P1-5）：预期效应比对按 **(axis, counterfactual_family_id)** 粒度判定——
轴在别的家族上被证实时，本家族的不符是混合 base 形态（记 detail 不拒收世界）；世界里
没有任何家族证实它 ⇒ 照旧拒收。零关键干预变体的世界由 world 级汇总行拒收。

G6：无关扰动与证据掩蔽必须 ``changed_paths == ()``、判决不变。
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from security_world.model.canonical import canonical_json
from security_world.validation import run_dataset_gates, run_gates


def _by_type(family, variant_type: str):
    return [item for item in family.variants if item.variant_type == variant_type]


def test_g5_accepts_the_reference_family(hc001_family) -> None:
    critical = _by_type(hc001_family, "critical_intervention")
    assert critical, "家族里必须有关键干预变体"
    for episode in critical:
        report = run_gates(episode, family=hc001_family)
        result = report.result("G5_counterfactual_consistency")
        assert result is not None and result.passed, result
        intervention = episode.intervention
        assert intervention["actual_effect"] == intervention["expected_effect"] == "verdict_flip"


def test_g5_rejects_a_wrong_prior(hc001_family) -> None:
    """先验说 verdict_flip 而实际不变 ⇒ 拒绝（R4：证伪即拒，绝不改标签）。"""
    episode = _by_type(hc001_family, "critical_intervention")[0]
    document = copy.deepcopy(episode.to_document())
    document["intervention"]["actual_effect"] = "verdict_invariant"
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G5_counterfactual_consistency")
    assert result is not None and not result.passed
    assert "verdict_flip" in result.detail and "verdict_invariant" in result.detail


def test_g5_rejects_a_multi_variable_intervention(hc001_family) -> None:
    """一次干预改了超过一个状态路径 ⇒ 拒绝（§9.2 单变量机械断言）。"""
    episode = _by_type(hc001_family, "critical_intervention")[0]
    document = copy.deepcopy(episode.to_document())
    # 伪造成"还顺手改了 session"：从 intervention 记录重建的变体世界必然多一条 changed path
    document["intervention"]["after"] = {"owner": "ACT-003"}
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G5_counterfactual_consistency")
    assert result is not None and not result.passed


def test_g5_rejects_a_changed_request_face(hc001_family) -> None:
    episode = _by_type(hc001_family, "critical_intervention")[0]
    document = copy.deepcopy(episode.to_document())
    document["observation"]["model_visible"]["request"]["path"] = "/api/orders/RES-999"
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G5_counterfactual_consistency")
    assert result is not None and not result.passed
    assert "请求面" in result.detail


def test_g6_accepts_irrelevant_perturbations(hc001_family) -> None:
    perturbations = _by_type(hc001_family, "irrelevant_perturbation")
    assert perturbations, "家族里必须有无扰扰动变体"
    base_truth = hc001_family.base.oracle_output.world_truth
    for episode in perturbations:
        report = run_gates(episode, family=hc001_family)
        result = report.result("G6_irrelevant_invariance")
        assert result is not None and result.passed, result
        assert episode.oracle_output.world_truth == base_truth
        # 机械断言：世界状态零变化
        diff = hc001_family.diffs.get(episode.episode_id)
        assert diff is not None and diff.is_empty()


def test_g6_accepts_masked_variants(hc001_family) -> None:
    masked = _by_type(hc001_family, "evidence_masked")
    assert masked, "家族里必须有掩蔽变体"
    base_request = canonical_json(hc001_family.base.observation["model_visible"]["request"])
    for episode in masked:
        report = run_gates(episode, family=hc001_family)
        result = report.result("G6_irrelevant_invariance")
        assert result is not None and result.passed, result
        assert canonical_json(episode.observation["model_visible"]["request"]) == base_request


def test_g6_nuisance_mutations_are_real_and_verdict_preserving(hc001_family) -> None:
    """REVISION 2（任务书 A1）：组装级核验每个无关扰动变体。

    三条合起来才是"确定性扰动验证"：(a) 扰动必须真的改变 model_visible 字节
    （含 rendered_text——S16 的可见载体），否则 verdict_invariant 假通过；
    (b) oracle 判决逐字节相同；(c) 世界状态零变化（与 G6 的机械 diff 同源）。
    """
    base = hc001_family.base
    base_model_visible = canonical_json(base.observation["model_visible"])
    base_request = canonical_json(base.observation["model_visible"]["request"])
    base_rendered = base.observation["model_visible"]["request"]["rendered_text"]
    base_output = canonical_json(base.oracle_output.to_document())
    perturbations = _by_type(hc001_family, "irrelevant_perturbation")
    assert perturbations, "家族里必须有无扰扰动变体"
    for episode in perturbations:
        # (a) 非空扰动：model_visible 与请求面（含 rendered_text）都必须变
        assert canonical_json(episode.observation["model_visible"]) != base_model_visible, (
            f"{episode.episode_id} 是空扰动"
        )
        assert canonical_json(episode.observation["model_visible"]["request"]) != base_request, (
            f"{episode.episode_id} 的请求面零变化"
        )
        assert (
            episode.observation["model_visible"]["request"]["rendered_text"] != base_rendered
        ), f"{episode.episode_id} 的 rendered_text 零变化"
        # (b) oracle 判决逐字节相同
        assert canonical_json(episode.oracle_output.to_document()) == base_output
        # (c) 世界状态零变化
        diff = hc001_family.diffs.get(episode.episode_id)
        assert diff is not None and diff.is_empty()


def test_g6_rejects_a_changed_verdict(hc001_family) -> None:
    """把扰动变体的判决抹成 base 的相反值 ⇒ 拒绝。"""
    episode = _by_type(hc001_family, "irrelevant_perturbation")[0]
    document = copy.deepcopy(episode.to_document())
    document["oracle_output"]["world_truth"] = (
        "safe" if hc001_family.base.oracle_output.world_truth == "attack" else "attack"
    )
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G6_irrelevant_invariance")
    assert result is not None and not result.passed
    assert "world_truth" in result.detail


def test_g6_rejects_a_no_op_perturbation(hc001_family) -> None:
    """扰动什么都没改 ⇒ 拒绝（空扰动会让 verdict_invariant 假通过）。"""
    episode = _by_type(hc001_family, "irrelevant_perturbation")[0]
    document = copy.deepcopy(episode.to_document())
    document["observation"]["model_visible"]["request"] = copy.deepcopy(
        hc001_family.base.observation["model_visible"]["request"]
    )
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G6_irrelevant_invariance")
    assert result is not None and not result.passed
    assert "空扰动" in result.detail


def test_gates_are_not_run_without_a_family(hc001_family) -> None:
    report = run_gates(hc001_family.base)
    for gate in ("G5_counterfactual_consistency", "G6_irrelevant_invariance"):
        result = report.result(gate)
        assert result is not None and result.checked is False


# --------------------------------------------------------------------------- #
# REVISION 3（P0-4）：零 critical 干预变体的家族不得过 G5
# --------------------------------------------------------------------------- #
def test_g5_rejects_a_family_whose_critical_axes_were_all_skipped() -> None:
    """唯一 critical 轴 before 不符 ⇒ 零 CI 变体 ⇒ G5 拒收（反事实门不形同虚设）。"""
    from asw_expansion import ownership_world, spec_from_world
    from security_world.expansion import expand_family
    from security_world.validation import family_view

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-002", "ACT-003"),),  # before 不符
    )
    result = expand_family(spec, seed=3)
    family = family_view(result, spec=spec)
    assert [e for e in family.variants if e.variant_type == "critical_intervention"] == []
    promised, reasons = family.critical_axis_promise()
    assert promised and reasons == ("AXIS-001:hypothesis_before_mismatch",), reasons
    for episode in family.variants:
        report = run_gates(episode, family=family)
        result = report.result("G5_counterfactual_consistency")
        assert result is not None and not result.passed, (episode.variant_type, result)
        assert "no_critical_intervention_variant" in result.detail
        assert "hypothesis_before_mismatch" in result.detail, "跳过原因必须可见"


def test_g5_rejects_a_family_whose_only_axis_has_no_reader() -> None:
    """唯一 critical 轴没有读者（``axis_skipped_no_reader``）⇒ 同样零 CI ⇒ 拒收。"""
    from asw_expansion import ownership_world, spec_from_world
    from security_world.expansion import expand_family
    from security_world.validation import family_view

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.state", "paid", "refunded"),),  # 无 policy/invariant 读者
    )
    result = expand_family(spec, seed=3)
    family = family_view(result, spec=spec)
    assert [e for e in family.variants if e.variant_type == "critical_intervention"] == []
    _promised, reasons = family.critical_axis_promise()
    assert reasons == ("AXIS-001:axis_skipped_no_reader",), reasons
    report = run_gates(family.base, family=family)
    result = report.result("G5_counterfactual_consistency")
    assert result is not None and not result.passed
    assert "no_critical_intervention_variant" in result.detail
    assert "axis_skipped_no_reader" in result.detail


def test_g5_stays_not_applicable_when_no_critical_axis_was_declared() -> None:
    """家族本来没声明 critical 轴 ⇒ 不是"承诺了却做不到"，G5 保持不适用（不误杀）。

    world-spec schema 要求 ``critical_state_variables`` 与
    ``expected_counterfactual_axes`` 非空，因此"无声明 critical 轴"只能通过"轴全是
    irrelevant"或"裸 FamilyView（无 spec、无跳过记录）"出现——两者都不是 G5 能判的
    反事实结构缺失（那是 prompt/schema 合同问题）。
    """
    import dataclasses

    from asw_expansion import ownership_world, spec_from_world
    from security_world.expansion import expand_family
    from security_world.model import WorldSpec
    from security_world.validation import FamilyView, family_view

    # (a) hypotheses 里只有 irrelevant 轴
    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
    )
    document = spec.to_document()
    document["hypotheses"]["expected_counterfactual_axes"][0]["kind"] = "irrelevant"
    irrelevant_only = WorldSpec.from_document(document)
    result = expand_family(irrelevant_only, seed=3)
    family = family_view(result, spec=irrelevant_only)
    assert [e for e in family.variants if e.variant_type == "critical_intervention"] == []
    promised, reasons = family.critical_axis_promise()
    assert not promised and reasons == ()
    report = run_gates(family.base, family=family)
    gate = report.result("G5_counterfactual_consistency")
    assert gate is not None and gate.passed and gate.checked
    assert gate.detail == "非关键干预变体：G5 不适用"

    # (b) 裸 FamilyView（无 spec、无展开跳过记录）：同样不适用
    bare = dataclasses.replace(family, spec=None, skipped=())
    assert bare.critical_axis_promise() == (False, ())
    gate = run_gates(bare.base, family=bare).result("G5_counterfactual_consistency")
    assert gate is not None and gate.passed and gate.detail == "非关键干预变体：G5 不适用"


def test_g5_rejects_the_real_zero_ci_accepted_worlds() -> None:
    """W-TK-OTR-001 / W-L2-001 重跑后必须被 G5 拒收（P0-4 的端到端回归）。

    两个世界唯一的 critical 轴都是 ``hypothesis_before_mismatch``（声明的 before 与
    世界现值不符），旧行为下零 CI 变体被静默接受——反事实门形同虚设。只读
    ``worlds/accepted/milestone-1-100.jsonl``。
    """
    import json
    from pathlib import Path

    from analysis.pipeline import action_from_binds, axes_for_probe, spec_with_axes
    from security_world.expansion import ExpansionConfig, expand_family
    from security_world.model import WorldSpec
    from security_world.validation import family_view

    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from real_worlds import load_raw_world

    seen: set[str] = set()
    for world_id in ("W-TK-OTR-001", "W-L2-001"):
        record = load_raw_world(world_id)
        seen.add(world_id)
        spec = WorldSpec.from_document(dict(record["spec_document"]))
        document = spec.to_document()
        at = str(document["current_state"]["at"])
        event = next(item for item in document["episode_templates"][0]["events"] if item.get("binds"))
        binds = {"actor": event["actor_id"], **dict(event["binds"])}
        action = action_from_binds(binds, action_id=f"ACTN-{world_id}-PROBE", at=at)
        probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
        result = expand_family(
            probe_spec, seed=spec.seed, action=action, config=ExpansionConfig.default()
        )
        family = family_view(result, spec=probe_spec)
        assert [e for e in family.variants if e.variant_type == "critical_intervention"] == [], world_id
        report = run_gates(family.base, family=family)
        gate = report.result("G5_counterfactual_consistency")
        assert gate is not None and not gate.passed, (world_id, gate)
        assert "no_critical_intervention_variant" in gate.detail
        assert "hypothesis_before_mismatch" in gate.detail, world_id
    assert seen == {"W-TK-OTR-001", "W-L2-001"}, sorted({"W-TK-OTR-001", "W-L2-001"} - seen)


# --------------------------------------------------------------------------- #
# REVISION 3（P1-5）：G5 按 (axis, counterfactual_family_id) 粒度判定 + 混合 base 标注
# --------------------------------------------------------------------------- #
def _expand_raw_world(world_id: str, *, raw_path: Path):
    """按 runner 的展开路径展开 worlds/raw 里的一个世界（只读）。"""
    from analysis.pipeline import (
        _family_key,
        action_from_binds,
        axes_for_probe,
        family_view_for_action,
        spec_with_axes,
    )
    from security_world.expansion import ExpansionConfig, expand_family
    from security_world.model import WorldSpec

    record = next(
        json.loads(line)
        for line in raw_path.read_text(encoding="utf-8").splitlines()
        if line.strip() and json.loads(line)["world_id"] == world_id
    )
    spec = WorldSpec.from_document(dict(record["spec_document"]))
    document = spec.to_document()
    at = str(document["current_state"]["at"])
    episodes: list = []
    families: dict = {}
    instance = None
    for index, event in enumerate(
        [item for item in document["episode_templates"][0]["events"] if item.get("binds")], start=1
    ):
        binds = {"actor": event["actor_id"], **dict(event["binds"])}
        action = action_from_binds(binds, action_id=f"ACTN-{world_id}-{index}", at=at)
        probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
        result = expand_family(
            probe_spec, seed=spec.seed, action=action, config=ExpansionConfig.default()
        )
        instance = result.world
        view = family_view_for_action(result, action, seed=spec.seed, spec=probe_spec)
        families[_family_key(view)] = view
        episodes.extend(view.variants)
    return record, instance, episodes, families


def test_g5_judges_per_axis_and_family_for_a_mixed_base_world() -> None:
    """W-SA-STATE-001：safe-base 家族翻不动轴、attack-base 家族翻转正确 ⇒ 世界放行。

    这是 P1-5 的核心回归。旧行为下 safe-base（read）家族的关键干预变体
    ``expected=verdict_flip`` / ``actual=verdict_invariant`` 让**整个世界**被 G5
    拒收；按 (axis, counterfactual_family_id) 粒度判定后，该轴由 attack-base
    （transition）家族证实，read 家族判"不适用"，世界级汇总行还标注 mixed_base。
    只读 ``worlds/raw/provider-run-001.jsonl``。
    """
    raw_path = Path(__file__).resolve().parents[2] / "worlds" / "raw" / "provider-run-001.jsonl"
    record, instance, episodes, families = _expand_raw_world("W-SA-STATE-001", raw_path=raw_path)
    report = run_dataset_gates(
        episodes,
        families=families,
        worlds={record["world_id"]: instance},
        declared_attack_families={record["world_id"]: str(record["spec_document"].get("attack_family"))},
    )
    g5_rows = [item for item in report.results if item.gate == "G5_counterfactual_consistency"]
    assert g5_rows and all(item.passed for item in g5_rows), [
        (item.passed, item.detail) for item in g5_rows if not item.passed
    ]
    world_row = g5_rows[-1]
    assert "mixed_base=是" in world_row.detail
    assert "workflow_instance.WFI-SA-001.current_state" in world_row.detail
    # read 家族（safe-base）的轴被读者预检跳过 ⇒ 不适用，而不是 mismatch 拒收
    read_rows = [
        item
        for item in g5_rows
        if "不适用" in item.detail and "axis_skipped_no_reader" not in item.detail
    ]
    assert read_rows, "safe-base 家族必须留下'不适用'痕迹"


def test_g5_world_row_rejects_a_world_with_no_variant_anywhere() -> None:
    """全部家族的 critical 轴都不可用（before 不符）⇒ world 级汇总行拒收。"""
    from asw_expansion import ownership_world, spec_from_world
    from analysis.pipeline import family_view_for_action
    from security_world.expansion import expand_family

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-002", "ACT-003"),),  # before 不符
    )
    result = expand_family(spec, seed=3)
    view = family_view_for_action(result, _action_from_spec(spec), seed=spec.seed, spec=spec)
    report = run_dataset_gates(
        list(view.variants),
        families={f"{view.family_id}:http_request": view},
        worlds={view.base_world.world_id: view.base_world},
        declared_attack_families={view.base_world.world_id: "idor_bola"},
    )
    g5_rows = [item for item in report.results if item.gate == "G5_counterfactual_consistency"]
    assert any(not item.passed for item in g5_rows)
    world_row = next(item for item in g5_rows if not item.passed)
    assert "no_critical_intervention_variant" in world_row.detail
    assert "hypothesis_before_mismatch" in world_row.detail


def _action_from_spec(spec):
    from security_world.policy import Action

    template = spec.episode_templates[0]
    event = template.events[template.decision_event_index]
    binds = dict(event.binds or {})
    document = {
        "action_id": "ACTN-G5-WORLD",
        "operation": binds["operation"],
        "actor": event.actor_id,
        "flow_id": binds.get("flow_id") or f"FLOW-{binds['operation']}",
        "at": spec.current_state.at,
    }
    for action_key, bind_key in (
        ("resource", "resource_id"),
        ("session", "session_id"),
        ("token", "token_id"),
        ("workflow_instance", "workflow_instance_id"),
    ):
        if binds.get(bind_key) is not None:
            document[action_key] = binds[bind_key]
    return Action.from_document(document)


def test_family_view_diffs_resolve_for_every_variant(hc001_family) -> None:
    """FamilyView.diffs 必须对**每个**变体都可查到，且与变体类型一致。

    Phase 2A 因果审计抓到过一个假通过：``family_view_for_action`` 先把 episode_id
    用 ``qualify_episode_id`` 重盖（追加 ``-renderer``），再按重盖后的 id 去查
    ``expand_family`` 的 ``diffs``——每次 lookup 都落空并回落到
    ``WorldDiff(())``，于是 ``diffs`` 退化成"键都在、值全空"。G6 对每个无关扰动
    都读到空 diff，"世界状态零变化"这一半检查恒真；而关键干预本该有非空 diff，
    也一并被抹平。因此这里同时钉死三件事：键齐全、干预变体非空、扰动/掩蔽变体为空。
    """
    missing = [
        episode.episode_id
        for episode in hc001_family.variants
        if episode.episode_id not in hc001_family.diffs
    ]
    assert not missing, f"这些变体在 diffs 里查不到（G6 会退化成恒真）: {missing}"

    for episode in hc001_family.variants:
        diff = hc001_family.diffs[episode.episode_id]
        if episode.variant_type == "critical_intervention":
            assert not diff.is_empty(), (
                f"关键干预 {episode.episode_id} 的 diff 是空的——"
                "diffs 键空间与 episode_id 重盖不一致，G5/G6 都在对空集下判断"
            )
            variable = str((episode.intervention or {}).get("intervention_variable"))
            assert diff.is_single(variable), (
                f"{episode.episode_id} 的 changed_paths={list(diff.changed_paths)} "
                f"应恰好只有 {variable!r}"
            )
        else:
            assert diff.is_empty(), (
                f"{episode.variant_type} 变体 {episode.episode_id} 改了世界状态: "
                f"{list(diff.changed_paths)}"
            )


def test_g6_world_diff_half_is_not_vacuous(hc001_family) -> None:
    """无关扰动必须"真实地"通过 G6：diff 查得到、为空，且观测表面确实变了。"""
    perturbations = _by_type(hc001_family, "irrelevant_perturbation")
    assert perturbations, "夹具里必须有关扰扰动变体"
    for episode in perturbations:
        diff = hc001_family.diffs.get(episode.episode_id)
        assert diff is not None, "diff 缺失会让 G6 的世界状态检查恒真"
        assert diff.is_empty()
        report = run_gates(episode, family=hc001_family)
        result = report.result("G6_irrelevant_invariance")
        assert result is not None and result.passed, result
