"""A6：族级可达性（不变量族 / 失效族的 witness 核验，REVISION 2）。

§10.5 的 ``attack_family_reachability`` 回答"声明的攻击族有没有 attack 样本"；
A6 把它细化到 **(world, family)** 粒度，并补上不变量族：

* **invariant 族**（世界声明的不变量类别）：witness = 至少一个 episode 里该不变量
  真的被求值过（进 satisfied/violated）。只被 ``skipped_out_of_scope`` 的类别在
  任何动作上都没有可执行语义——世界声明了它表达不出来的族；
* **failure 族**（spec 声明的攻击族）：witness = attack 样本且被违反的类别能映射
  到该族（spec 声明优先）。

**没有 witness 的族标记 unsupported 并在报告里如实列出，绝不计入"已支持"**——
这是 A6 的硬要求，也是它与硬门的区别：unsupported 不拒收数据（语料可以合法地
携带一个故意越界的不变量来训练 skipped 路径），但它必须出现在 manifest 里。
"""
from __future__ import annotations

import pytest

from security_world.validation import family_reachability


@pytest.fixture(scope="module")
def pipeline_one_renderer():
    """全语料单 renderer 管线（与 tests/integration 同款；族级覆盖要全集才有意义）。"""
    from analysis import run_pipeline

    return run_pipeline(renderers=("http_request",))


def _coverage(pipeline_one_renderer):
    result = pipeline_one_renderer
    return family_reachability(
        list(result.episodes),
        worlds=dict(result.worlds),
        declared_families=dict(result.declared_attack_families),
    )


def test_every_declared_invariant_family_gets_a_row(pipeline_one_renderer) -> None:
    coverage = _coverage(pipeline_one_renderer)
    declared: dict[tuple[str, str], int] = {}
    for world_id, world in pipeline_one_renderer.worlds.items():
        for invariant in world.invariants:
            key = (world_id, invariant.category)
            declared[key] = declared.get(key, 0) + 1
    rows = {(row.world_id, row.family) for row in coverage.invariant}
    assert rows == set(declared), "每个 (world, 类别) 都必须有一行"


def test_the_corpus_unsupported_family_is_reported_honestly(pipeline_one_renderer) -> None:
    """HC-017 故意携带一个越界 ownership 不变量（语料注释明言）——它必须被列出。"""
    coverage = _coverage(pipeline_one_renderer)
    unsupported = {(row.world_id, row.family) for row in coverage.unsupported}
    assert ("W-HC-017", "ownership") in unsupported, sorted(unsupported)
    # 未支持的族：supported=False、witnesses=0、witness 列表为空
    row = next(
        item
        for item in coverage.unsupported
        if item.world_id == "W-HC-017" and item.family == "ownership"
    )
    assert row.kind == "invariant"
    assert row.witnesses == 0 and row.witness_episode_ids == ()
    assert row.supported is False


def test_unsupported_families_are_never_counted_as_supported(pipeline_one_renderer) -> None:
    coverage = _coverage(pipeline_one_renderer)
    document = coverage.to_document()
    total = len(coverage.results)
    assert document["supported_count"] == len(coverage.supported)
    assert document["unsupported_count"] == len(coverage.unsupported)
    assert document["supported_count"] + document["unsupported_count"] == total
    # 未支持集合与 supported_count 的来源完全互补
    assert {id(row) for row in coverage.supported}.isdisjoint(
        {id(row) for row in coverage.unsupported}
    )
    for row in document["unsupported"]:
        assert row["supported"] is False and row["witnesses"] == 0
    for row in document["invariant_families"] + document["failure_families"]:
        assert row["supported"] == (row["witnesses"] > 0)


def test_the_attack_family_of_a_probe_world_has_witnesses(pipeline_one_renderer) -> None:
    """HC-001 的 idor_bola：attack probe 真的违反 ownership ⇒ 有可达 witness。"""
    coverage = _coverage(pipeline_one_renderer)
    row = next(
        item
        for item in coverage.failure
        if item.world_id == "W-HC-001" and item.family == "idor_bola"
    )
    assert row.witnesses > 0
    assert row.witness_episode_ids, "有 witness 就必须给得出样本 id"
    assert row.supported is True


def test_a_family_without_any_attack_sample_is_unsupported() -> None:
    """声明了一个 attack 样本产生不了的族 ⇒ unsupported（与 §10.5 硬门一致的口径）。"""
    from asw_expansion import ownership_world, timeline_for
    from asw_worlds import make_action
    from security_world.expansion import assemble_episode, render

    world = ownership_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")  # 合法动作：safe
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
    coverage = family_reachability(
        [episode],
        worlds={world.world_id: world},
        declared_families={world.world_id: "idor_bola"},
    )
    failure_rows = {(row.world_id, row.family): row for row in coverage.failure}
    row = failure_rows[(world.world_id, "idor_bola")]
    assert row.witnesses == 0 and row.supported is False
    assert row in coverage.unsupported
    # 同一世界的 invariant 族有 witness（ownership 被求值且违反）
    invariant_rows = {(item.family): item for item in coverage.invariant}
    assert invariant_rows["ownership"].witnesses > 0


def test_the_coverage_document_shape_is_stable(pipeline_one_renderer) -> None:
    document = _coverage(pipeline_one_renderer).to_document()
    assert set(document) == {
        "invariant_families",
        "failure_families",
        "supported_count",
        "unsupported_count",
        "unsupported",
    }
    for row in document["invariant_families"]:
        assert row["kind"] == "invariant"
    for row in document["failure_families"]:
        assert row["kind"] == "failure"


# --------------------------------------------------------------------------- #
# REVISION 3（P0-3）：unsupported_families 纯函数 + witness 级可达性进数据集门
# --------------------------------------------------------------------------- #
def test_unsupported_families_is_a_pure_reporting_function(pipeline_one_renderer) -> None:
    """``unsupported_families`` 与 ``family_reachability().unsupported`` 同源、只报告。"""
    from security_world.validation import unsupported_families

    episodes = list(pipeline_one_renderer.episodes)
    worlds = dict(pipeline_one_renderer.worlds)
    declared = dict(pipeline_one_renderer.declared_attack_families)
    rows = unsupported_families(episodes, worlds, declared)
    coverage = family_reachability(episodes, worlds=worlds, declared_families=declared)
    assert rows == coverage.unsupported
    # 每个条目都是 witnesses=0、supported=False 的 FamilyReachabilityResult
    assert rows, "语料里有故意越界的不变量（HC-017），unsupported 不能为空"
    for row in rows:
        assert row.witnesses == 0 and row.witness_episode_ids == ()
        assert row.supported is False
    assert ("W-HC-017", "ownership") in {(row.world_id, row.family) for row in rows}
    # 纯函数：同样输入再跑一次，结果逐字节相同
    assert [row.to_document() for row in unsupported_families(episodes, worlds, declared)] == [
        row.to_document() for row in rows
    ]


def test_a_world_with_an_unbound_invariant_family_is_unsupported() -> None:
    """W-L4-001 形态：唯一 trust_boundary 不变量 100% skipped ⇒ unsupported 记录。

    这个世界的 attack 样本来自别处（workflow_transition / 非默认 deny），"声明优先"
    的样本级可达性因此判它的族可达；witness 级如实记录 trust_boundary 族 0 witness。
    只读 ``worlds/accepted/milestone-1-100.jsonl``。
    """
    import json
    from pathlib import Path

    from analysis.pipeline import action_from_binds, axes_for_probe, spec_with_axes
    from security_world.expansion import ExpansionConfig, expand_family
    from security_world.model import WorldSpec
    from security_world.validation import unsupported_families

    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from real_worlds import load_raw_world

    record = load_raw_world("W-L4-001")
    spec = WorldSpec.from_document(dict(record["spec_document"]))
    document = spec.to_document()
    at = str(document["current_state"]["at"])
    event = next(item for item in document["episode_templates"][0]["events"] if item.get("binds"))
    binds = {"actor": event["actor_id"], **dict(event["binds"])}
    action = action_from_binds(binds, action_id="ACTN-W-L4-001-PROBE", at=at)
    probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
    result = expand_family(probe_spec, seed=spec.seed, action=action, config=ExpansionConfig.default())
    episodes = list(result.variants)
    worlds = {record["world_id"]: result.world}
    declared = {record["world_id"]: str(record["spec_document"].get("attack_family"))}

    rows = unsupported_families(episodes, worlds, declared)
    keys = {(row.kind, row.family, row.world_id) for row in rows}
    assert ("invariant", "trust_boundary", "W-L4-001") in keys, sorted(keys)
    row = next(item for item in rows if item.family == "trust_boundary")
    assert row.witnesses == 0 and row.supported is False
    # 失效族（spec 声明的 unsafe_deserialization）有 witness——世界确实产出了 attack
    # 样本；不可达的是**族语义**，不是"没有 attack 样本"。两者都要如实区分。
    failure_keys = {(row.family, row.witnesses) for row in unsupported_families(episodes, worlds, declared)}
    assert ("unsafe_deserialization", 0) not in failure_keys
    coverage = family_reachability(episodes, worlds=worlds, declared_families=declared)
    failure_row = next(item for item in coverage.failure if item.family == "unsafe_deserialization")
    assert failure_row.witnesses > 0 and failure_row.supported is True


def test_dataset_g3_reports_unsupported_invariant_families_without_rejecting(
    pipeline_one_renderer,
) -> None:
    """数据集门：不变量族无 witness ⇒ 通过但逐条点名（不拒收，只报告）。"""
    from security_world.validation.gates import _g3_attack_family_reachability

    report = _g3_attack_family_reachability(
        list(pipeline_one_renderer.episodes),
        dict(pipeline_one_renderer.declared_attack_families),
        dict(pipeline_one_renderer.worlds),
    )
    assert report.passed, report.detail
    assert report.checked
    # HC-017 的越界 ownership 族必须出现在 detail 里（"没有运行"与"没有"不是一回事）
    assert "W-HC-017" in report.detail and "ownership" in report.detail
    assert "witness 级覆盖" in report.detail


def test_dataset_g3_fails_when_a_declared_failure_family_has_no_witness() -> None:
    """声明了一个 attack 样本产生不了的失效族 ⇒ witness 级也不可达 ⇒ 拒收。"""
    from asw_expansion import ownership_world, timeline_for
    from asw_worlds import make_action
    from security_world.expansion import assemble_episode, render
    from security_world.validation.gates import _g3_attack_family_reachability

    world = ownership_world()
    action = make_action("read", "ACT-001", resource_id="RES-001")  # 合法动作：safe
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
    report = _g3_attack_family_reachability(
        [episode],
        {world.world_id: "idor_bola"},
        {world.world_id: world},
    )
    assert not report.passed
    assert "idor_bola" in report.detail
    assert "witness 级同样不可达" in report.detail


def test_merge_unsupported_families_is_idempotent() -> None:
    """runner 的 coverage 合并：同一条 (kind, family, world) 不重复累积。"""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    from provider_run import merge_unsupported_families

    class _Row:
        def __init__(self, kind, family, world_id):
            self.kind, self.family, self.world_id = kind, family, world_id

        def to_document(self):
            return {
                "kind": self.kind,
                "family": self.family,
                "world_id": self.world_id,
                "witnesses": 0,
                "witness_episode_ids": [],
                "supported": False,
            }

    coverage: dict = {"unsupported_families": []}
    rows = [_Row("invariant", "ownership", "W-HC-017"), _Row("invariant", "trust_boundary", "W-L4-001")]
    first = merge_unsupported_families(coverage, rows)
    second = merge_unsupported_families(coverage, rows)
    assert first == second and len(first) == 2
    assert merge_unsupported_families(coverage, rows[:1]) == second, "重复合并不该变长"
    # 合并结果就是落盘形态（JSON 可序列化、字段稳定）
    assert set(first[0]) == {"kind", "family", "world_id", "witnesses", "witness_episode_ids", "supported"}
