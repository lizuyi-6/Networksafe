"""Phase 2B episode 展开：新家族 + surface 乘数 + id 唯一性（brief §33/§36/§41）。

三条被钉死的东西：

1. ``trust_provenance_variant`` 只改证据**出处**不改断言值，且 provenance ↔ trust_level
   的映射必须与语料一致（不一致就等于给模型一个它看不见的标签变化）；
2. 铺满 surface 之后 episode_id 必须仍然唯一——engine 的 ``_derive_episode_id`` 不含
   renderer/style，这是驱动层必须补的一课（实测踩过：304 条 episode 只有 49 个 id）；
3. ``world_truth`` 与 ``observable_decision`` 是两个字段，不许合并（brief §36）。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from analysis.phase2b_expand import (
    DEFAULT_PLAN,
    expand_world,
    release_episode_id,
)
from generation.schema_registry import _cached_validator
from security_world.expansion.families import (
    PROVENANCE_TRUST,
    TrustProvenanceVariant,
    apply_variant,
    candidate_variants,
    observable_effect,
    reattribute,
)
from security_world.model import WorldSpec
from security_world.oracle import run_oracle
from security_world.oracle.evidence_view import EvidenceView
from security_world.expansion import instantiate
from security_world.expansion.episode import _action_from_spec

ROOT = Path(__file__).resolve().parents[2]
CONFIRMATION_WORLDS = ROOT / "worlds" / "skeletons" / "accepted" / "provider-run-003.jsonl"
PHASE2A_CONFIG = ROOT / "configs" / "phase2a.json"


def _episode_validator():
    return _cached_validator(str((ROOT / "schemas").resolve()), "episode")


def _worlds(limit: int = 4):
    rows = []
    with CONFIRMATION_WORLDS.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
            if len(rows) >= limit:
                break
    return rows


# --------------------------------------------------------------------------- #
# provenance ↔ trust 一致性
# --------------------------------------------------------------------------- #
def test_provenance_trust_mapping_matches_the_compiled_corpus():
    """编译器产出的语料里 provenance 必须是 trust/freshness 的完全代理。

    这一族改的是 provenance（模型可见），靠的是 trust_level（模型不可见）随之改变。
    两者只要有一次不一致，就会造出"模型看不见的标签变化"——那是泄漏，不是训练信号。
    """
    rows = _worlds(limit=25)
    seen: set[tuple[str, str, str]] = set()
    for row in rows:
        for item in row["spec_document"].get("evidence") or ():
            seen.add((
                str(item.get("provenance")),
                str(item.get("trust_level")),
                str(item.get("freshness")),
            ))
    assert seen, "样本里没有证据项"
    declared = {(name, trust, freshness) for name, trust, freshness in PROVENANCE_TRUST}
    unexpected = sorted(seen - declared)
    assert not unexpected, f"语料出现了映射表外的 (provenance, trust, freshness): {unexpected}"


def test_reattribute_keeps_the_asserted_value():
    item = reattribute(_item(), "replicated_cache")
    assert item.value == _item().value
    assert item.asserts_ref == _item().asserts_ref
    assert item.provenance == "replicated_cache"
    assert item.trust_level == "semi_trusted"
    assert item.freshness == "stale"
    assert item.source == "replica"


def _item():
    from security_world.model.entities import EvidenceItem

    return EvidenceItem(
        evidence_id="EV-0001", type="ownership_record", asserts_ref="resource.RES-1.owner",
        value="ACT-1", source="system-of-record", provenance="system_of_record",
        trust_level="trusted", freshness="fresh", attacker_controllable=False,
        visible_in_observation=True,
    )


def test_candidate_variants_only_pick_establishing_visible_evidence():
    from security_world.model.entities import EvidenceItem

    establishing = _item()
    weak = EvidenceItem(
        evidence_id="EV-0002", type="identity_claim", asserts_ref="actor.ACT-1.tenant",
        value="TEN-1", source="client-supplied-header", provenance="client_supplied",
        trust_level="untrusted", freshness="fresh", attacker_controllable=True,
        visible_in_observation=True,
    )
    hidden = EvidenceItem(
        evidence_id="EV-0003", type="policy_document", asserts_ref="resource.RES-1.owner",
        value="ACT-9", source="system-of-record", provenance="system_of_record",
        trust_level="trusted", freshness="fresh", attacker_controllable=False,
        visible_in_observation=False,
    )
    view = EvidenceView(visible=(establishing, weak), hidden=(hidden,))
    candidates = candidate_variants(view, ())
    assert {item.evidence_id for item in candidates} == {"EV-0001"}
    # 确定性排序：同一证据的多个降级目标按字典序
    assert [item.to_provenance for item in candidates] == sorted(
        item.to_provenance for item in candidates
    )


def test_apply_variant_leaves_hidden_evidence_untouched():
    from security_world.model.entities import EvidenceItem

    establishing = _item()
    hidden = EvidenceItem(
        evidence_id="EV-0009", type="policy_document", asserts_ref="resource.RES-1.owner",
        value="ACT-9", source="system-of-record", provenance="system_of_record",
        trust_level="trusted", freshness="fresh", attacker_controllable=False,
        visible_in_observation=False,
    )
    view = EvidenceView(visible=(establishing,), hidden=(hidden,))
    variant = TrustProvenanceVariant(
        evidence_id="EV-0001", fact_key=establishing.asserts_ref,
        from_provenance="system_of_record", to_provenance="client_supplied",
        from_source="system-of-record", to_source="client-supplied-header",
        from_trust="trusted", to_trust="untrusted",
        from_freshness="fresh", to_freshness="fresh",
    )
    result = apply_variant(view, variant)
    assert result.hidden == view.hidden
    assert result.visible[0].trust_level == "untrusted"
    assert result.visible[0].value == establishing.value


def test_observable_effect_distinguishes_downgrade_from_noop():
    class _Out:
        def __init__(self, truth: str, decision: str) -> None:
            self.world_truth = truth
            self.observable_decision = decision

    assert observable_effect(_Out("attack", "attack"), _Out("attack", "insufficient_evidence")) == (
        "observable_downgrade"
    )
    assert observable_effect(_Out("attack", "attack"), _Out("attack", "attack")) == (
        "verdict_invariant"
    )
    assert observable_effect(_Out("attack", "attack"), _Out("safe", "attack")) == "verdict_flip"
    # 其余 observable 差异不冒充 downgrade
    assert observable_effect(_Out("attack", "attack"), _Out("attack", "unauthorized")) == (
        "verdict_invariant"
    )


# --------------------------------------------------------------------------- #
# 驱动层：surface 乘数 + id 唯一性 + schema
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def expanded():
    config_document = json.loads(PHASE2A_CONFIG.read_text(encoding="utf-8"))
    rows = _worlds(limit=3)
    return [
        expand_world(row["spec_document"], config_document=config_document, plan=DEFAULT_PLAN)
        for row in rows
    ]


def test_expansion_covers_every_declared_family(expanded):
    families: set[str] = set()
    for summary in expanded:
        families.update(summary["per_family"])
    assert families == {
        "base", "critical_intervention", "irrelevant_perturbation",
        "evidence_masked", "trust_provenance_variant",
    }


def test_episode_ids_are_unique_across_surfaces(expanded):
    seen: dict[str, str] = {}
    for summary in expanded:
        for episode in summary["episodes"]:
            previous = seen.get(episode["episode_id"])
            assert previous is None, (
                f"{episode['episode_id']} 重复（{previous} 与 "
                f"{episode['world_id']}/{episode['variant_type']}）"
            )
            seen[episode["episode_id"]] = f"{episode['world_id']}/{episode['variant_type']}"
    assert len(seen) > 100


def test_release_episode_id_is_recomputable_from_the_document():
    document = {"episode_id": "EP-603b5e7a8479fa74", "world_id": "W-1",
                "variant_type": "base"}
    first = release_episode_id(document, renderer="http_request", style="rest")
    second = release_episode_id(dict(document), renderer="http_request", style="rest")
    assert first == second
    assert first != release_episode_id(document, renderer="audit_log", style="rest")
    assert first != release_episode_id(document, renderer="http_request", style="graphql")
    assert first.startswith("EP-") and len(first) == 19


def test_every_episode_satisfies_the_episode_schema(expanded):
    validator = _episode_validator()
    for summary in expanded:
        for episode in summary["episodes"]:
            errors = list(validator.iter_errors(episode))
            assert not errors, (
                f"{episode['episode_id']} 不过 episode.schema.json: "
                + "; ".join(f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message[:120]}"
                            for e in errors[:3])
            )


def test_world_truth_and_observable_decision_stay_separate_fields(expanded):
    """brief §36：两者必须分开，且 unknown 不是第三种世界真值。"""
    for summary in expanded:
        for episode in summary["episodes"]:
            output = episode["oracle_output"]
            assert output["world_truth"] in {"safe", "attack", "unauthorized"}
            assert output["observable_decision"] in {
                "safe", "attack", "unauthorized", "insufficient_evidence",
            }


def test_surface_plan_puts_full_diversity_on_the_decisive_families(expanded):
    """base / critical 拿满 24 个 surface；证据类家族只拿 8 个 renderer。"""
    summary = expanded[0]
    surfaces_for: dict[str, set[str]] = {}
    for episode in summary["episodes"]:
        renderer = episode["observation"]["model_visible"]["renderer"]
        surfaces_for.setdefault(episode["variant_type"], set()).add(renderer)
    assert len(surfaces_for["base"]) == len(DEFAULT_PLAN["renderers"])
    assert len(surfaces_for["critical_intervention"]) >= 1
    assert len(surfaces_for["evidence_masked"]) == len(DEFAULT_PLAN["renderers"])
    assert surfaces_for["trust_provenance_variant"] == {DEFAULT_PLAN["trust_provenance_renderer"]}


def test_trust_provenance_episodes_record_what_moved(expanded):
    """干预记录必填且必须写出 before/after 的出处变化（schema 的 allOf/if-then）。"""
    for summary in expanded:
        for episode in summary["episodes"]:
            if episode["variant_type"] != "trust_provenance_variant":
                continue
            intervention = episode["intervention"]
            assert intervention["before"]["provenance"] != intervention["after"]["provenance"]
            assert intervention["before"]["trust_level"] != intervention["after"]["trust_level"]
            assert intervention["intervention_variable"].startswith("evidence.")


def test_expansion_is_deterministic(expanded):
    config_document = json.loads(PHASE2A_CONFIG.read_text(encoding="utf-8"))
    row = _worlds(limit=1)[0]
    again = expand_world(row["spec_document"], config_document=config_document, plan=DEFAULT_PLAN)
    first = json.dumps(expanded[0]["episodes"], sort_keys=True)
    second = json.dumps(again["episodes"], sort_keys=True)
    assert first == second


def test_oracle_agrees_with_the_episode_labels(expanded):
    """抽样重算：episode 上的标签必须等于 (world, action, evidence_view) 的 Oracle 输出。"""
    for summary in expanded[:1]:
        for episode in summary["episodes"][:6]:
            spec = WorldSpec.from_document(
                _spec_for(summary["world_id"])
            )
            world = instantiate(spec, seed=spec.seed)
            action = _action_from_spec(spec, world)
            view = EvidenceView.from_world(world)
            # 只有 base / irrelevant_perturbation 用的是**未改动**的世界与视图；
            # critical_intervention 换了世界、trust_provenance_variant 换了视图，
            # 它们的标签当然不同——那正是这一族要造的东西。
            if episode["variant_type"] not in ("base", "irrelevant_perturbation"):
                continue
            output = run_oracle(world, action, view)
            assert output.world_truth == episode["oracle_output"]["world_truth"]
            assert output.observable_decision == episode["oracle_output"]["observable_decision"]


def _spec_for(world_id: str):
    for row in _worlds(limit=25):
        if row["world_id"] == world_id:
            return row["spec_document"]
    raise AssertionError(f"找不到 world {world_id}")
