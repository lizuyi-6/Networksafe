"""runner 的每世界接受标准（REVISION 3 / P1-8 + P0-3 的 coverage 实算）。

两条新标准都只在 ``scripts/provider_run.py`` 的 ``process_world`` 接受路径上生效：

* **P1-8 每世界标签约束**——世界的全部 base 变体 ``observable_decision`` 都是
  ``insufficient_evidence``（标签熵过低：只有 1 种且为弃权）⇒ 降级 quarantine，
  reason ``single_label_world_all_insufficient``。门禁全过也拦：一个所有可观测
  决策都弃权的世界没有训练信号；
* **P0-3 unsupported 族实算**——接受路径把 witness 级可达性算进
  ``coverage["unsupported_families"]``（此前是静态 ``[]``，"没算过"被显示成"没有"）。

测试用 monkeypatch 过的 ``ROOT`` 把 RunState 的落盘全部导向 tmp_path，不碰仓库里的
``worlds/`` / ``state/`` 数据文件。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import provider_run  # noqa: E402


def _accepted_record(world_id: str) -> dict:
    # spec 的权威来源是 raw 文件（结论文件随门禁演进而变；W-001/W-L4-001 重裁后已不在
    # accepted，但回归测试要验的正是"它们在新门下被正确处置/记录"）。
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from real_worlds import load_raw_world

    return load_raw_world(world_id)


@pytest.fixture()
def sandbox(monkeypatch):
    """把 provider_run 的 ROOT 指向一个临时目录，返回 ``(RunState, root)``。

    用 ``tempfile.mkdtemp`` 而不是 pytest 的 ``tmp_path``：本机的 pytest-asyncio
    包装器在 ``tmp_path`` 拆卸时踩 Windows 权限（与项目代码无关的环境问题）。
    """
    import shutil
    import tempfile

    root = Path(tempfile.mkdtemp(prefix="asw-p18-"))
    try:
        monkeypatch.setattr(provider_run, "ROOT", root)
        (root / "state").mkdir(parents=True, exist_ok=True)
        yield provider_run.RunState("test-p1-8"), root
    finally:
        shutil.rmtree(root, ignore_errors=True)


# --------------------------------------------------------------------------- #
# 纯函数：base 变体标签集合
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def ownership_family():
    """HC-001 的所有权世界家族（与 tests/unit 的其它测试同源构造）。"""
    from asw_expansion import ownership_world, spec_from_world
    from security_world.expansion import expand_family

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
    )
    return expand_family(spec, seed=3)


def test_observable_label_set_reads_base_variants_only(ownership_family) -> None:
    """只看 base 变体：干预/扰动/掩蔽变体的标签按构造会变，不算"世界能表达什么"。"""
    base = next(item for item in ownership_family.variants if item.variant_type == "base")
    base_label = str(base.oracle_output.observable_decision)
    labels = provider_run.observable_label_set(list(ownership_family.variants))
    assert labels == frozenset({base_label})
    # 没有 base 变体 ⇒ 空集合（调用方按"没有可判定标签"处理，不误判成降级）
    assert provider_run.observable_label_set(
        [episode for episode in ownership_family.variants if episode.variant_type != "base"]
    ) == frozenset()
    # Mapping 形态的 oracle_output 同样可读（落盘记录与内存对象一致）
    documents = [
        {
            "variant_type": episode.variant_type,
            "oracle_output": episode.oracle_output.to_document(),
        }
        for episode in ownership_family.variants
    ]
    assert provider_run.observable_label_set(documents) == labels


def test_all_insufficient_is_the_downgrade_condition() -> None:
    """标签集合是 ``{"insufficient_evidence"}`` 的单元素集才降级；混合标签不降级。"""
    assert provider_run.SINGLE_LABEL_QUARANTINE_LABELS == frozenset({"insufficient_evidence"})
    for labels, expected in (
        (frozenset({"insufficient_evidence"}), True),
        (frozenset(), False),
        (frozenset({"insufficient_evidence", "safe"}), False),
        (frozenset({"attack"}), False),
    ):
        assert (bool(labels) and labels <= provider_run.SINGLE_LABEL_QUARANTINE_LABELS) is expected


# --------------------------------------------------------------------------- #
# process_world 接受路径
# --------------------------------------------------------------------------- #
def test_process_world_downgrades_an_all_insufficient_world(sandbox) -> None:
    """W-001：唯一 base 变体是 insufficient_evidence ⇒ quarantine（P1-8）。"""
    sandbox_state, tmp_path = sandbox
    record = _accepted_record("W-001")
    outcome = provider_run.process_world(
        dict(record["spec_document"]),
        state=sandbox_state,
        batch_meta={"raw_generation_id": "test-batch"},
        world_number=1,
        renderer="http_request",
    )
    assert outcome == "quarantined"
    assert sandbox_state.progress["rejection_reasons"]["single_label_world_all_insufficient"] == 1
    quarantined = [
        json.loads(line)
        for line in (tmp_path / "worlds" / "quarantine" / "test-p1-8.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
    ]
    assert quarantined and quarantined[0]["reason"] == "single_label_world_all_insufficient"
    assert quarantined[0]["labels"] == ["insufficient_evidence"]
    assert quarantined[0]["base_variant_count"] >= 1


def test_process_world_accepts_a_world_with_real_labels(sandbox) -> None:
    """W-ECOM-001：base 标签是 attack（不是弃权）⇒ 照常 accepted。"""
    sandbox_state, tmp_path = sandbox
    record = _accepted_record("W-ECOM-001")
    outcome = provider_run.process_world(
        dict(record["spec_document"]),
        state=sandbox_state,
        batch_meta={"raw_generation_id": "test-batch"},
        world_number=2,
        renderer="http_request",
    )
    assert outcome == "accepted"
    assert sandbox_state.progress["accepted"] == 1
    accepted = [
        json.loads(line)
        for line in (tmp_path / "worlds" / "accepted" / "milestone-1-100-test-p1-8.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
    ]
    assert accepted and accepted[0]["world_id"] == "W-ECOM-001"
    # 家族结构完整（base + 关键干预 + 扰动 + 掩蔽都在）
    assert set(accepted[0]["variant_counts"]) >= {
        "base", "critical_intervention", "irrelevant_perturbation", "evidence_masked",
    }


def test_process_world_records_unsupported_families_in_coverage(sandbox) -> None:
    """W-L4-001：接受路径把 witness 级 unsupported 族写进 coverage（P0-3）。

    W-L4-001 的 trust_boundary 不变量 100% ``skipped_unbound_subject``（0 witnesses）
    ——它同时被 P0-2 的 G12 拒收，所以这里直接验证纯函数在 runner 的调用形态下
    给出记录，而不是"可达"。
    """
    sandbox_state, _root = sandbox
    record = _accepted_record("W-L4-001")
    from analysis.pipeline import expand_handcrafted_world
    from security_world.expansion import ExpansionConfig
    from worlds.registry import HandcraftedWorld

    spec_document = dict(record["spec_document"])
    handcrafted = HandcraftedWorld(
        directory=record["world_id"],
        number=3,
        spec_path=provider_run.ROOT / "worlds" / "raw" / f"{record['world_id']}.json",
        expected_path=provider_run.ROOT / "worlds" / "raw" / f"{record['world_id']}.expected.md",
        spec_document=spec_document,
        expectations={},
    )
    expansion = expand_handcrafted_world(
        handcrafted, config=ExpansionConfig.default(), renderers=("http_request",)
    )
    unsupported = provider_run.unsupported_families(
        list(expansion.episodes),
        worlds={expansion.world_id: expansion.instance},
        declared_families={expansion.world_id: str(spec_document.get("attack_family") or "")},
    )
    provider_run.merge_unsupported_families(sandbox_state.coverage, unsupported)
    rows = sandbox_state.coverage["unsupported_families"]
    assert rows, "W-L4-001 必须产出 unsupported 记录（trust_boundary 0 witnesses）"
    assert {(row["kind"], row["family"], row["world_id"]) for row in rows} >= {
        ("invariant", "trust_boundary", "W-L4-001")
    }
    assert all(row["supported"] is False and row["witnesses"] == 0 for row in rows)
