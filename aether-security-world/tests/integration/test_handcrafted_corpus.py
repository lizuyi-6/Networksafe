"""人工测试世界语料（M5 交付物）的验收。

三件事，逐条可证伪：

1. **每个 spec 过 ``world-spec.schema.json``**（构造即校验，加载时再校验一次）；
2. **oracle 的判决逐字等于 ``expected.md`` 里人写的预期**——不一致 ⇒ 这个世界写错了，
   修 spec，不是修 oracle（设计 §12.2）；
3. **语料可复现**：``worlds/materialize.py --check`` 比对磁盘字节与 ``corpus.py`` 的
   物化结果，任何手改 JSON 都会被抓到。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from security_world.model import compile_spec, validate_document
from security_world.oracle import EvidenceView, run_oracle
from security_world.policy import Action

from analysis.pipeline import action_from_binds

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_corpus_has_at_least_twelve_worlds(corpus) -> None:
    """设计 §12.2：HC-001..HC-020 是 Phase 1 硬下限（任务书：12~20 个）。"""
    assert len(corpus) >= 12
    numbers = [item.number for item in corpus]
    assert numbers == sorted(numbers)
    assert len(set(numbers)) == len(numbers)


def test_every_spec_passes_the_schema(corpus) -> None:
    for world in corpus:
        errors = validate_document(world.spec_document, "world-spec")
        assert not errors, f"{world.directory}: {errors}"


def test_every_spec_compiles(corpus) -> None:
    for world in corpus:
        instance = compile_spec(world.spec, seed=world.spec.seed)
        assert instance.world_id == world.world_id
        assert instance.world_family_id.startswith("WF-")


def test_expected_md_covers_every_probe(corpus) -> None:
    for world in corpus:
        probes = world.probes()
        assert probes, f"{world.directory} 没有 probe action"
        assert set(world.expectations) == set(range(1, len(probes) + 1)), (
            f"{world.directory}: expected.md 的预期行 {sorted(world.expectations)} 与 probe 数 "
            f"{len(probes)} 不一致"
        )


def test_oracle_matches_the_human_expectation(corpus) -> None:
    """核心断言：人写的预期 == oracle 的输出（task book: otherwise it is a bug）。"""
    for world in corpus:
        instance = compile_spec(world.spec, seed=world.spec.seed)
        view = EvidenceView.from_world(instance)
        at = str(world.spec_document["current_state"]["at"])
        for index, (_summary, binds) in enumerate(world.probes(), start=1):
            action = action_from_binds(
                binds, action_id=f"ACTN-{world.number:03d}-{index}", at=at
            )
            output = run_oracle(instance, action, view)
            expected = world.expectations[index]
            assert output.world_truth == expected[0], (
                f"{world.directory} P{index}: world_truth={output.world_truth}，"
                f"expected.md 写的是 {expected[0]}（{expected[2]}）"
            )
            assert output.observable_decision == expected[1], (
                f"{world.directory} P{index}: observable_decision={output.observable_decision}，"
                f"expected.md 写的是 {expected[1]}（{expected[2]}）"
            )


def test_every_world_has_a_flipping_critical_axis(corpus) -> None:
    """每个世界至少一条关键轴，且它必须**真的改变状态**（空干预会被引擎拒）。"""
    for world in corpus:
        axes = [
            axis
            for axis in world.spec_document["hypotheses"]["expected_counterfactual_axes"]
            if axis["kind"] == "critical"
        ]
        assert axes, f"{world.directory} 没有关键轴"
        instance = compile_spec(world.spec, seed=world.spec.seed)
        for axis in axes:
            variable = axis["variable"]
            assert instance.contains(variable), f"{world.directory}: 轴 {variable} 不可解析"
            from security_world.model.canonical import canonical_json

            assert canonical_json(instance.resolve(variable)) == canonical_json(axis["before"]), (
                f"{world.directory}: 轴 {variable} 的 before 与世界现值不符"
            )


def test_every_world_declares_irrelevant_axes(corpus) -> None:
    for world in corpus:
        axes = world.spec_document["irrelevant_state_variables"]
        assert axes and all(axis.startswith("observation.") for axis in axes), (
            f"{world.directory}: 无关轴必须全是 observation.* 路径"
        )


def test_corpus_covers_many_domains_and_families(corpus) -> None:
    domains = {item.application_domain for item in corpus}
    families = {item.attack_family for item in corpus}
    assert len(domains) >= 8, f"只覆盖 {len(domains)} 个应用域: {sorted(domains)}"
    assert len(families) >= 8, f"只覆盖 {len(families)} 个攻击族: {sorted(families)}"


def test_corpus_is_reproducible(corpus) -> None:
    """磁盘字节与 ``worlds/corpus.py`` 的物化结果一致（可复现性护栏）。"""
    from worlds.materialize import check

    problems = check()
    assert problems == [], "；".join(problems)


def test_materialize_check_cli_exit_code() -> None:
    """``py -3 -m worlds.materialize --check`` 的退出码 0 == 一致。"""
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "worlds.materialize", "--check"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("number", [1, 2, 21, 22, 23])
def test_spot_check_a_few_worlds(corpus, number: int) -> None:
    world = next(item for item in corpus if item.number == number)
    assert world.directory == f"ASW-HC-{number:03d}"
    assert (PROJECT_ROOT / "worlds" / "handcrafted" / world.directory / "world-spec.json").is_file()
    assert (PROJECT_ROOT / "worlds" / "handcrafted" / world.directory / "expected.md").is_file()
