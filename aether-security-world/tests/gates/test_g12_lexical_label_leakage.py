"""G12 可疑判决线索词审计（硬门，任务书 A1 / REVISION 2 / REVISION 3）。

G11 度量**统计**泄漏（表层特征与 verdict 的互信息）；G12 堵**词法**泄漏：渲染表面
里出现一个可直接解题的判决线索词。四个必须说清楚的规则：

1. **decision_metadata 侧允许出现**（``attack_family`` 之类本就属于 oracle/gate
   侧，模型可见边界由 ``conftest.model_visible_boundary`` 与 G2 另外封死）；
2. **model_visible / rendered_text 侧出现即失败**，且没有最小样本量——一个泄漏
   样本就足以让标签可被字符串匹配猜出；
3. **匹配单元是标识符段**（REVISION 3 / P0-2）：按 ``[-._/@]`` 切片后逐段精确匹配
   词表。``SES-L2-ATTACK.valid`` 切出 ``ATTACK`` ⇒ 命中，``X-Actor-Display-Name``
   不误伤。旧规则"紧邻 ``.@_`` 不算命中"把答案写进实体 id/summary 的泄漏整个放过了
   （真实 provider run 104 episode 0 命中）；
4. **保留域名豁免**：RFC 2606 的 ``*.example.invalid`` 主机名与
   ``act-001@example.invalid`` 邮箱是合成语料的基础设施，其中的 ``invalid`` 是
   DNS 保留后缀不是判决词；豁免只认这四个保留后缀，且不跨 ``/`` 路径段蔓延。

测试钉死五件事：真的泄漏必须失败（门不是永真的）、干净语料必须通过、分段规则
按声明工作（标识符段命中、保留域名不命中、``attackers``/``preattack`` 不误伤）、
配置可增补、词表覆盖任务书点名词 + REVISION 3 增补词。
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from security_world.validation import (
    SUSPICIOUS_MARKERS,
    lexical_label_leakage,
    marker_pattern,
    markers_from_config,
    markers_in_text,
    run_gates,
    scan_model_visible,
)


# --------------------------------------------------------------------------- #
# 词法与分段规则
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "text",
    [
        "the request was blocked by policy",
        "status: invalid",
        "X-Verdict: malicious",
        "UNAUTHORIZED access attempt",
        "possible injection in body",
        "idor suspected",
        "verdict=attack",
        "denied, forbidden, exploit",
    ],
)
def test_standalone_markers_are_detected(text):
    assert markers_in_text(text), text


@pytest.mark.parametrize(
    "text",
    [
        "SES-L2-ATTACK",          # session id：连字符段就是词
        "SES-L2-ATTACK.valid",    # 段后紧跟 '.'：旧粘合规则放过的正是这个形态
        "ACT-L2-ATTACKER",        # actor id：答案写在实体名里
        "ACT-L2-ATTACKER.valid",
        "unauthorized_access_flag",  # 下划线分段：标识符风格同样是线索
        "compromised_account_flag",
        "Compromised CI service session starts.",  # 事件 summary 的自由文本
        "a compromised token was replayed",
        "the attacker session",  # REVISION 3：attacker 进词表
    ],
)
def test_identifier_segment_markers_are_detected(text):
    """标识符段/路径段里的判决词必须命中（P0-2 的核心回归）。"""
    assert markers_in_text(text), text


@pytest.mark.parametrize(
    "text",
    [
        "api.northwind-storefront-api.example.invalid",  # 保留域名：粘在 . 分隔的 token 里
        "act-001@example.invalid",  # 邮箱：粘在 @ 两侧
        "attacker@example.invalid",  # 邮箱的 local part 也不误伤（同 token 是保留域名）
        "api.order-api-with-attacker-controlled-ownership-header.example.invalid",  # HC-023 的 Host slug
        "attackers",  # 另一个词（词表里没有 attackers）
        "preattack",
        "aetherguard-synthetic-client",  # 正常 UA：切片后无一段是判决词
        "X-Actor-Display-Name",  # 每段都不是判决词
    ],
)
def test_glued_markers_are_not_detected(text):
    assert markers_in_text(text) == (), text


@pytest.mark.parametrize("text", ["X-Attack-Flag", "cross-tenant-injection", "/api/idor/RES-001"])
def test_hyphen_and_slash_separated_markers_are_detected(text):
    """连字符段与路径段都是词：``X-Attack-Flag`` 与 ``/api/idor`` 同样是线索。"""
    assert markers_in_text(text), text


def test_marker_pattern_is_case_insensitive_and_word_scoped():
    pattern = marker_pattern(("attack",))
    assert pattern.search("Attack").group(0) == "Attack"
    assert pattern.search("ATTACK").group(0) == "ATTACK"
    assert pattern.search("attacker") is None  # 不同词（不在本词表里）
    assert pattern.search("antiattack") is None


def test_the_reserved_domain_exemption_is_bounded():
    """豁免只认 RFC 2606 保留后缀，且不跨 ``/`` 路径段蔓延。"""
    # 保留后缀 ⇒ 域名/邮箱，豁免
    assert markers_in_text("host-api.example.invalid") == ()
    assert markers_in_text("host-api.example.test") == ()
    # 非保留后缀（真实 TLD / 任意标签）⇒ 不是域名，照常命中
    assert markers_in_text("attack-api.example.com"), "真实 TLD 不在豁免里"
    assert markers_in_text("attack-example"), "连字符段照常命中"
    # 路径段里的线索不被后面的保留域名连带豁免
    assert "attack" in markers_in_text("https://api.example.invalid/api/attack/RES-001")
    # 判决词写法（status: invalid）仍然命中——豁免的是 TLD，不是词
    assert markers_in_text("status: invalid") == ("invalid",)


def test_the_schema_vocabulary_compound_exemption_is_bounded():
    """``attacker_controlled`` / ``attacker_controllable`` 是 schema 词汇，不是判决。

    ``evidence.attacker_controllable`` 是证据目录字段名、``attacker_controlled_account``
    是 ``actor_type`` 枚举值，手写语料合法地让它们进入模型可见侧（HC-006 的
    ``actor_type``、HC-023 的 summary）。豁免只认这两个段：``attacker`` 是**末段**
    （``ACT-L2-ATTACKER``）或后跟普通词（"Attacker replays the consumed code"）时
    照常命中——真实泄漏一个不放。
    """
    assert markers_in_text("attacker_controlled_account") == ()
    assert markers_in_text("attacker-controllable") == ()
    assert markers_in_text("the only ownership evidence is attacker-controllable.") == ()
    # 末段 / 后跟普通词 ⇒ 照常命中
    assert markers_in_text("ACT-L2-ATTACKER") == ("attacker",)
    assert markers_in_text("Attacker replays the consumed code") == ("attacker",)
    # 段后还粘着字母数字 ⇒ 不是 schema 词汇，照常命中
    assert markers_in_text("attacker_controllablex") == ("attacker",)


def test_the_marker_list_includes_the_revision_3_words():
    """REVISION 3（P0-2）：``attacker`` / ``attacks`` / ``compromised`` 进词表。

    它们此前被如实排除，理由是"人工语料合法地把 attacker 用作角色描述"；真实
    provider run 之后这个理由不成立了——``ACT-L2-ATTACKER`` 这样的实体 id 与
    "Compromised CI service session starts." 这样的 summary 就是在写答案。语料里
    合法的 attacker 风味文本（HC-023 的 Host slug）由保留域名豁免收口，见
    ``test_the_reserved_domain_exemption_is_bounded`` 与全语料干净性测试。
    """
    for word in ("attacker", "attacks", "compromised"):
        assert word in SUSPICIOUS_MARKERS, word


def test_empty_marker_list_is_refused():
    from security_world.validation.errors import ValidationError

    with pytest.raises(ValidationError):
        marker_pattern(())


def test_scan_model_visible_audits_keys_too():
    hits = scan_model_visible({"request": {"headers": {"X-Attack-Flag": "1"}}})
    assert hits and hits[0].marker == "attack"
    assert hits[0].path.endswith("X-Attack-Flag")


# --------------------------------------------------------------------------- #
# 门级行为（正/反各一）
# --------------------------------------------------------------------------- #
def test_g12_accepts_the_reference_family(hc001_family) -> None:
    """干净语料必须通过（门不是永假）。"""
    for episode in hc001_family.variants:
        report = run_gates(episode, family=hc001_family)
        result = report.result("G12_lexical_label_leakage")
        assert result is not None and result.passed, result
        assert result.checked


def test_g12_rejects_a_leaked_marker_in_rendered_text(hc001_family) -> None:
    """rendered_text 里出现线索词 ⇒ 拒绝（门不是永真）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["observation"]["model_visible"]["request"]["rendered_text"] += (
        "\nX-Security-Verdict: blocked"
    )
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G12_lexical_label_leakage")
    assert result is not None and not result.passed
    assert "blocked" in result.detail


def test_g12_rejects_a_leaked_marker_in_an_evidence_value(hc001_family) -> None:
    """七键证据投影的 value 里出现线索词同样拒绝（rendered_text 不是唯一 surface）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    evidence = document["observation"]["model_visible"]["evidence"]
    assert evidence, "夹具必须带可见证据"
    evidence[0]["value"] = {"note": "suspicious ownership claim"}
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G12_lexical_label_leakage")
    assert result is not None and not result.passed
    assert "suspicious" in result.detail


@pytest.mark.parametrize(
    ("field", "leak", "marker"),
    [
        # 实体 id 段：答案写在标识符里（W-L2-001 的真实形态）
        ("timeline_actor_id", "ACT-L2-ATTACKER", "attacker"),
        ("evidence_asserts_ref", "session.SES-L2-ATTACK.valid", "attack"),
        # 事件 summary 的自由文本（W-L4-001 的真实形态）
        ("timeline_summary", "Compromised CI service session starts.", "compromised"),
    ],
)
def test_g12_rejects_identifier_segment_leaks(hc001_family, field, leak, marker) -> None:
    """REVISION 3（P0-2）：标识符段 / summary 里的判决词必须被门拒收。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    model_visible = document["observation"]["model_visible"]
    if field == "timeline_actor_id":
        model_visible["timeline"][0]["actor_id"] = leak
    elif field == "timeline_summary":
        model_visible["timeline"][0]["summary"] = leak
    else:
        model_visible["evidence"][0]["asserts_ref"] = leak
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = run_gates(broken, family=hc001_family)
    result = report.result("G12_lexical_label_leakage")
    assert result is not None and not result.passed, result
    assert marker in result.detail


def test_g12_rejects_the_real_leaking_accepted_worlds() -> None:
    """两个真实 accepted 世界（W-L2-001 / W-L4-001）重跑后必须被 G12 拒收。

    这是 P0-2 的端到端回归：旧词表 + 旧粘合规则对它们 104 个 episode 实跑 0 命中
    （答案通过 ``ACT-L2-ATTACKER`` / ``SES-L2-ATTACK.valid`` / "Compromised CI
    service session starts." 直接可读）。只读 ``worlds/accepted/milestone-1-100.jsonl``，
    用与 runner 相同的展开路径（probe 轴筛选 + expand_family）。
    """
    from pathlib import Path

    from analysis.pipeline import action_from_binds, axes_for_probe, spec_with_axes
    from security_world.expansion import ExpansionConfig, expand_family
    from security_world.model import WorldSpec
    from security_world.validation import family_view

    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from real_worlds import load_raw_world

    seen: set[str] = set()
    for world_id in ("W-L2-001", "W-L4-001"):
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
        rejected = []
        for episode in result.variants:
            report = run_gates(episode, family=family_view(result, spec=probe_spec))
            gate = report.result("G12_lexical_label_leakage")
            assert gate is not None
            if not gate.passed:
                rejected.append((episode.variant_type, gate.detail[:80]))
        assert rejected, f"{world_id}: 新词表+分段规则必须拒收至少一个变体"
        markers = {detail.split("'")[1] for _variant, detail in rejected}
        assert markers & {"attacker", "attack", "compromised"}, sorted(markers)
    assert seen == {"W-L2-001", "W-L4-001"}, f"accepted 清单缺少泄漏世界：缺 {sorted({'W-L2-001', 'W-L4-001'} - seen)}"


def test_g12_rejects_an_episode_without_model_visible(hc001_family) -> None:
    """没有 model_visible 可审 ⇒ 失败（fail-closed，不假装通过）。"""
    episode = hc001_family.base
    document = copy.deepcopy(episode.to_document())
    document["observation"]["model_visible"] = {}
    from security_world.model.episode import Episode

    broken = Episode.from_document(document)
    report = lexical_label_leakage(broken)
    assert not report.passed


def test_decision_metadata_side_is_exempt() -> None:
    """答案词出现在 decision_metadata 是合法的——G12 只审模型可见侧。"""
    episode = {
        "observation": {
            "model_visible": {"request": {"path": "/api/orders/RES-001"}},
            "decision_metadata": {"attack_family": "idor_bola"},
        }
    }
    assert lexical_label_leakage(episode).passed


# --------------------------------------------------------------------------- #
# 配置与语料实证
# --------------------------------------------------------------------------- #
def test_markers_from_config_reads_the_config_section():
    assert markers_from_config(None) == SUSPICIOUS_MARKERS
    config = {"quality_gates": {"G12_lexical_label_leakage": {"markers": ["blocked"]}}}
    assert markers_from_config(config) == ("blocked",)
    # 空数组退回内置表（空表会让门永真）
    config = {"quality_gates": {"G12_lexical_label_leakage": {"markers": []}}}
    assert markers_from_config(config) == SUSPICIOUS_MARKERS


def test_the_handcrafted_corpus_is_lexically_clean(corpus) -> None:
    """23 个手写世界 × 8 renderer 的全部 model_visible 字节零命中（防假失败）。

    这是**实证**而不是理论：词表经过全语料扫描（含 ``attacker`` / ``attacks`` /
    ``compromised`` 三个 REVISION 3 增补词），HC-023 的 ``application.name``
    （"Order API With Attacker-Controlled Ownership Header"）以 Host slug 形式进入
    模型可见侧，由**保留域名豁免**收口——豁免是有界的（只认 RFC 2606 后缀），
    不是把词表改窄。
    """
    from asw_expansion import ownership_world, timeline_for
    from asw_worlds import make_action
    from security_world.expansion import RENDERERS, render

    world = ownership_world()
    action = make_action("read", "ACT-003", resource_id="RES-001")
    for renderer in RENDERERS:
        observation = render(
            world,
            action,
            renderer=renderer,
            seed=41,
            allowlist={"world_side_allowed": [], "world_side_forbidden": []},
            timeline=timeline_for(),
        )
        assert scan_model_visible(observation.to_model_visible()) == (), renderer


def test_the_full_pipeline_is_lexically_clean() -> None:
    """端到端：人工语料管线的每个 episode 都过 G12（门不是永假）。"""
    from analysis import run_pipeline

    result = run_pipeline(renderers=("http_request",))
    assert result.episodes
    for episode in result.episodes:
        assert scan_model_visible(episode.observation["model_visible"]) == (), episode.episode_id


def test_the_default_marker_list_covers_the_required_words() -> None:
    required = {
        "malicious", "unauthorized", "attack", "suspicious", "invalid", "violation",
        "exploit", "forbidden", "blocked", "denied", "benign", "idor", "injection",
        # REVISION 3（P0-2）增补：实体 id 与事件 summary 里的答案词
        "attacker", "attacks", "compromised",
    }
    assert required <= set(SUSPICIOUS_MARKERS)


def test_the_config_marker_list_matches_the_builtin_list() -> None:
    """``configs/default.json`` 的 G12 词表与内置表逐字一致（单一来源，不同步即失败）。"""
    config = json.loads(
        (Path(__file__).resolve().parents[2] / "configs" / "default.json").read_text(encoding="utf-8")
    )
    configured = tuple(config["quality_gates"]["G12_lexical_label_leakage"]["markers"])
    assert set(configured) == set(SUSPICIOUS_MARKERS)
    assert markers_from_config(config) == configured
