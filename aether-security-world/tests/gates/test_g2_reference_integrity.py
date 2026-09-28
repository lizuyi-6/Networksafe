"""G2 引用完整性：时间单调、双记一致、轴白名单、可见性三处一致、family id 派生。

正例：HC-001 家族全绿；负例：手工构造一个时间线乱序的 episode、一个隐藏 id 与
分类不一致的 episode、一个 actor 角色悬空的世界——逐个断言拒绝路径。

REVISION 2（任务书 A2）单调性规则钉死为：``t_index`` **严格**递增（索引重复即
坏数据）；``at`` 单调**不减**，同一 logical timestamp（逐字相同的 ``at``）是显式
允许的并列，任何回退即失败；``current_state.at >= max(state_history.at)`` 允许取等。
"""
from __future__ import annotations

import copy

from security_world.model import WorldInstance, validate_document
from security_world.validation import run_gates


def test_g2_accepts_the_reference_family(hc001_family) -> None:
    for episode in hc001_family.variants:
        report = run_gates(episode, family=hc001_family)
        result = report.result("G2_reference_integrity")
        assert result is not None and result.passed, result


def test_g2_rejects_a_non_monotonic_timeline(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    # 把末事件的 at 改到首事件之前：t_index 与 at 不再同序
    document["timeline"][-1]["at"] = "2020-01-01T00:00:00Z"
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "at" in result.detail or "t_index" in result.detail


def test_g2_rejects_a_duplicated_t_index(hc001_family) -> None:
    """t_index 必须**严格**递增：重复索引意味着两条事件被钉在同一序位（A2）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["timeline"][-1]["t_index"] = document["timeline"][0]["t_index"]
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "t_index" in result.detail


def test_g2_rejects_a_decreasing_t_index(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    # 整体反转 t_index（保持非负）：序列从递增变成递减
    indices = [event["t_index"] for event in document["timeline"]]
    for event, index in zip(document["timeline"], reversed(indices)):
        event["t_index"] = index
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "t_index" in result.detail


def test_g2_rejects_at_going_backwards_while_t_index_advances(hc001_family) -> None:
    """t_index 有序但 at 回退：两个序列必须同序，只修一个不算修好（S3/S5）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["timeline"][1]["at"] = "2020-01-01T00:00:00Z"
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "timeline.at" in result.detail


def test_g2_allows_an_explicit_tie_on_the_same_logical_timestamp(hc001_family) -> None:
    """两条事件共享逐字相同的 at 是**显式允许**的并列（A2 的唯一例外）。

    除此之外时间必须严格单调：并列由作者显式写出（同一个 logical timestamp），
    回退则是坏数据。本用例把末事件的 at 改成与首事件相同，断言仍然通过。
    """
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["timeline"][-1]["at"] = document["timeline"][0]["at"]
    from security_world.model.episode import Episode

    tied = Episode.from_document(document)
    report = run_gates(tied, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and result.passed, result


def test_g2_rejects_an_inconsistent_hidden_evidence_list(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    metadata = document["observation"]["decision_metadata"]
    hidden = list(metadata.get("hidden_evidence_ids") or [])
    hidden.append("EV-DOES-NOT-EXIST")
    metadata["hidden_evidence_ids"] = hidden
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "hidden_evidence_ids" in result.detail


def test_g2_rejects_a_model_visible_answer_key(hc001_family) -> None:
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["observation"]["model_visible"]["trust_level"] = "trusted"
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "trust_level" in result.detail


def test_g2_rejects_a_dangling_actor_role() -> None:
    from asw_worlds import make_world, actor, resource, role

    world = make_world(
        world_id="W-G2-ROLE",
        actors=(actor("ACT-001", roles=("ROLE-NOT-DECLARED",)),),
        resources=(resource("RES-001", owner="ACT-001"),),
        roles=(role("ROLE-CUSTOMER"),),
    )
    document = world.to_document()
    errors = validate_document(document, "world")
    # schema 层不查角色存在性（那是引用完整性），因此直接调门禁的世界级检查
    from security_world.validation.gates import _g2_world_checks

    problems = _g2_world_checks(
        _any_episode(world), world, family=None
    )
    assert any("ROLE-NOT-DECLARED" in problem for problem in problems), problems


# --------------------------------------------------------------------------- #
# REVISION 2（任务书 A5）：证据可见性的唯一权威链
# --------------------------------------------------------------------------- #
def test_g2_accepts_the_world_catalog_projection_on_the_base(hc001_family, hc001_world) -> None:
    """正例：base 变体的分类必须逐条等于世界证据目录的可见性（S7 权威链闭合）。"""
    from security_world.validation.gates import _g2_evidence_catalog_problems

    episode = hc001_family.base
    problems = _g2_evidence_catalog_problems(episode, hc001_world)
    assert problems == [], problems
    # 派生值必须等于投影：model_visible.evidence 正是世界可见项的七键投影
    world_visible = sorted(
        item.evidence_id for item in hc001_world.evidence if item.visible_in_observation
    )
    projected = sorted(
        str(item["evidence_id"]) for item in episode.observation["model_visible"]["evidence"]
    )
    assert projected == world_visible


def test_g2_rejects_a_world_visible_item_hidden_by_the_observation(hc001_family, hc001_world) -> None:
    """反例 1：世界说 visible=true，非掩蔽变体却把它藏起来 ⇒ 不一致即失败。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    classification = document["observation"]["decision_metadata"]["evidence_classification"]
    victim = next(
        item for item in classification if item.get("visible_in_observation") is True
    )
    victim["visible_in_observation"] = False
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family, world=hc001_world)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert victim["evidence_id"] in result.detail


def test_g2_rejects_a_world_hidden_item_shown_by_the_observation() -> None:
    """反例 2：复活世界声明不可见的证据 ⇒ 泄漏，任何 variant_type 都失败。

    人工语料的世界目录全部 visible=true（隐藏只发生在掩蔽层），因此这里用合成
    世界构造"世界藏了一条"的场景——把分类里的隐藏项翻成可见。
    """
    from asw_expansion import ownership_world, timeline_for
    from asw_worlds import evidence, make_action
    from security_world.expansion import assemble_episode, render
    from security_world.validation.gates import _g2_evidence_catalog_problems

    world = ownership_world()
    # 在世界目录里藏一条同事实的次要证据（矛盾项：世界声明它不可见）
    from security_world.model import EvidenceItem

    hidden_item = EvidenceItem.from_document(
        evidence("EV-WORLD-HIDDEN", "resource.RES-001.owner", "ACT-009", visible=False)
    )
    from dataclasses import replace

    world = replace(world, evidence=tuple(world.evidence) + (hidden_item,))
    action = make_action("read", "ACT-003", resource_id="RES-001")
    observation = render(
        world,
        action,
        renderer="http_request",
        seed=41,
        allowlist={"world_side_allowed": [], "world_side_forbidden": []},
        timeline=timeline_for(),
    )
    episode = assemble_episode(
        world=world,
        spec=None,
        family_id="CF-" + "0" * 12,
        variant_type="base",
        action=action,
        timeline=timeline_for(),
        observation=observation,
    )
    #  sanity：组装期如实隐藏了它（世界目录权威）
    assert _g2_evidence_catalog_problems(episode, world) == []

    document = copy.deepcopy(episode.to_document())
    classification = document["observation"]["decision_metadata"]["evidence_classification"]
    victim = next(
        item for item in classification if item["evidence_id"] == "EV-WORLD-HIDDEN"
    )
    assert victim["visible_in_observation"] is False
    victim["visible_in_observation"] = True
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    problems = _g2_evidence_catalog_problems(broken, world)
    assert any("EV-WORLD-HIDDEN" in problem for problem in problems), problems
    report = run_gates(broken, world=world)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "EV-WORLD-HIDDEN" in result.detail


def test_g2_rejects_an_invented_evidence_classification(hc001_family, hc001_world) -> None:
    """反例 3：分类里出现世界目录没有的证据 id ⇒ 失败（不得发明证据）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    classification = document["observation"]["decision_metadata"]["evidence_classification"]
    invented = dict(classification[0])
    invented["evidence_id"] = "EV-INVENTED-001"
    classification.append(invented)
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family, world=hc001_world)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "EV-INVENTED-001" in result.detail


def test_g2_allows_masked_variants_to_hide_world_visible_evidence(hc001_family, hc001_world) -> None:
    """掩蔽变体按设计（§9.4）在视图层继续隐藏世界可见证据——这是被许可的操作。"""
    from security_world.validation.gates import _g2_evidence_catalog_problems

    masked = [
        episode for episode in hc001_family.variants if episode.variant_type == "evidence_masked"
    ]
    assert masked, "家族里必须有掩蔽变体"
    for episode in masked:
        # 掩蔽变体：隐藏世界可见项合法；但复活世界隐藏项仍然不被许可
        assert _g2_evidence_catalog_problems(episode, hc001_world) == [], episode.episode_id


# --------------------------------------------------------------------------- #
# REVISION 2（任务书 A7）：group key 存在性与派生一致性
# --------------------------------------------------------------------------- #
def test_g2_accepts_the_stamped_group_keys(hc001_family, hc001_world) -> None:
    """正例：组装期盖章的十二个 group key 全部存在且与派生值一致。"""
    from security_world.model import GROUP_KEYS

    episode = hc001_family.base
    assert set(episode.group_keys or {}) == set(GROUP_KEYS)
    report = run_gates(episode, family=hc001_family, world=hc001_world)
    result = report.result("G2_reference_integrity")
    assert result is not None and result.passed, result


def test_g2_rejects_an_episode_without_group_keys(hc001_family) -> None:
    """反例 1：整个 group_keys 缺失 ⇒ 拒收（split/泄漏审计会静默失效）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document.pop("group_keys", None)
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "group_keys" in result.detail


def test_g2_rejects_an_episode_missing_one_group_key(hc001_family) -> None:
    """反例 2：缺任何一个 key（这里删 policy_family_id）⇒ 拒收。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["group_keys"].pop("policy_family_id")
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "policy_family_id" in result.detail


def test_g2_rejects_a_tampered_group_key_value(hc001_family, hc001_world) -> None:
    """反例 3：盖章值与重新派生的值不一致 ⇒ 拒收（防篡改/防漂移）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["group_keys"]["policy_graph_hash"] = "0" * 64
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family, world=hc001_world)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "policy_graph_hash" in result.detail


def test_g2_group_key_presence_is_checked_even_without_a_world(hc001_family) -> None:
    """没有 world 时存在性检查仍然运行（世界级检查才跳过）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document.pop("group_keys", None)
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken)
    result = report.result("G2_reference_integrity")
    assert result is not None and not result.passed
    assert "group_keys" in result.detail


def test_g2_rejects_a_non_monotonic_state_history() -> None:
    from asw_worlds import make_world

    world = make_world(world_id="W-G2-HISTORY")
    document = world.to_document()
    document["state_history"] = [
        {"snapshot_id": "SNAP-001", "at": "2026-09-20T08:00:00Z", "label": "later"},
        {"snapshot_id": "SNAP-000", "at": "2026-09-19T08:00:00Z", "label": "earlier"},
    ]
    from security_world.validation.gates import _g2_world_checks

    broken = WorldInstance.from_document(document)
    problems = _g2_world_checks(_any_episode(broken), broken, family=None)
    assert any("state_history" in problem for problem in problems), problems


def test_g2_allows_a_state_history_tie_on_the_same_logical_timestamp() -> None:
    """两个快照共享同一 logical timestamp 是显式允许的并列（A2 的唯一例外）。"""
    from asw_worlds import make_world
    from security_world.validation.gates import _g2_world_checks

    world = make_world(world_id="W-G2-HISTORY-TIE")
    document = world.to_document()
    document["state_history"] = [
        {"snapshot_id": "SNAP-000", "at": "2026-09-20T08:00:00Z", "label": "a"},
        {"snapshot_id": "SNAP-001", "at": "2026-09-20T08:00:00Z", "label": "b"},
    ]
    tied = WorldInstance.from_document(document)
    problems = _g2_world_checks(_any_episode(tied), tied, family=None)
    assert not any("state_history" in problem for problem in problems), problems


def test_g2_rejects_a_current_state_earlier_than_the_history() -> None:
    """``current_state.at >= max(state_history.at)`` 是 compile_spec 的第 5 步断言。"""
    from asw_worlds import make_world
    from security_world.validation.gates import _g2_world_checks

    world = make_world(world_id="W-G2-CURRENT")
    document = world.to_document()
    document["state_history"] = [
        {"snapshot_id": "SNAP-000", "at": "2026-09-20T08:00:00Z", "label": "a"},
    ]
    document["current_state"]["at"] = "2026-09-19T08:00:00Z"
    broken = WorldInstance.from_document(document)
    problems = _g2_world_checks(_any_episode(broken), broken, family=None)
    assert any("current_state.at" in problem for problem in problems), problems


def test_g2_accepts_current_state_at_the_history_boundary() -> None:
    """``current_state.at == max(history.at)`` 取等合法（事件恰好落在最后快照上）。"""
    from asw_worlds import make_world
    from security_world.validation.gates import _g2_world_checks

    world = make_world(world_id="W-G2-CURRENT-EQ")
    document = world.to_document()
    document["state_history"] = [
        {"snapshot_id": "SNAP-000", "at": "2026-09-20T08:00:00Z", "label": "a"},
    ]
    document["current_state"]["at"] = "2026-09-20T08:00:00Z"
    boundary = WorldInstance.from_document(document)
    problems = _g2_world_checks(_any_episode(boundary), boundary, family=None)
    assert not any("current_state.at" in problem for problem in problems), problems


def _any_episode(world: WorldInstance):
    """用一个空动作占位（G2 的世界级检查不看 action 内容）。"""
    from security_world.policy import Action

    action = Action.from_document(
        {
            "action_id": "ACTN-G2",
            "operation": "read",
            "actor": world.actors[0].actor_id,
            "flow_id": "FLOW-READ",
            "at": world.current_state.at,
        }
    )
    return _FakeEpisode(world, action)


class _FakeEpisode:
    """只带 G2 世界级检查用到的字段的占位 episode。"""

    def __init__(self, world: WorldInstance, action: Action) -> None:
        self.world_id = world.world_id
        self.world_family_id = world.world_family_id
        self.counterfactual_family_id = "CF-" + "0" * 12
        self.action = action
        self.timeline = ()
        self.current_event = {"event_id": "EVT-000", "t_index": 0, "at": world.current_state.at,
                              "event_type": "request", "actor_id": world.actors[0].actor_id}
        self.observation = {
            "model_visible": {},
            "decision_metadata": {"evidence_classification": [], "hidden_evidence_ids": []},
        }
