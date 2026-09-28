"""production runner 路径的端到端离线测试（Phase 2B brief §6/§7/§23/§29）。

dry run 只验证覆盖指令；这里把 ``scripts/skeleton_run.py`` 的 ``process_skeleton``
真的跑起来（monkeypatch ROOT 到临时目录，不发任何网络请求），钉死四件事：

1. production 骨架**没有** ``skeleton_id`` 也能被接受，canonical id 由程序派生；
2. provider 重复自称同一个 id 不构成拒收（brief §29）；
3. 编译出的 ``world_id`` / 实体 id 跟随 canonical id，与 provider 自称无关；
4. 产物落在 ``worlds/production/``，与开发 corpus 物理隔离（brief §23）。
"""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"


def _load_runner():
    spec = importlib.util.spec_from_file_location("skeleton_run_under_test", SCRIPTS / "skeleton_run.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _production_document(runner, family: str, *, claimed: str | None, variant: str) -> dict:
    """按机制族合成一个 production 形状的骨架（没有 skeleton_id）。"""
    sys.path.insert(0, str(SCRIPTS))
    from mechanism_selfcheck import _skeleton_for

    document = {key: value for key, value in _skeleton_for(0, family).items() if key != "skeleton_id"}
    document["scenario_summary"] = f"{variant}: {document['scenario_summary']}"
    document["security_goal"] = f"{variant}: {document['security_goal']}"
    document["failure_mechanism"] = f"{variant}: {document['failure_mechanism']}"
    if claimed is not None:
        document["provider_claimed_id"] = claimed
    return document


@pytest.fixture()
def sandbox(monkeypatch):
    """把 runner 的 ROOT 指到临时目录：离线跑完整 process_skeleton，不碰真实产物。

    不用 pytest 的 ``tmp_path``——这台机器上它的基目录
    （``%LOCALAPPDATA%\\Temp\\pytest-of-<user>``）有 ACL 问题，会 PermissionError。
    """
    module = _load_runner()
    with tempfile.TemporaryDirectory(prefix="asw-runner-test-") as tmp:
        root = Path(tmp)
        monkeypatch.setattr(module, "ROOT", root)
        yield module, root


def _state(runner, tmp_path, run_id: str = "test-production-run"):
    return runner.RunState(run_id, contract="production")


def _batch_meta(runner):
    return {
        "raw_generation_id": "test-batch-001", "model": "step-5-preview",
        "input_tokens": 0, "output_tokens": 0, "latency_s": 0.0, "retries": 0,
    }


def _accept(runner, state, document, compiler, context):
    return runner.process_skeleton(
        document, state=state, batch_meta=_batch_meta(runner), compiler=compiler,
        context=context, schema_path=runner.PRODUCTION_SCHEMA_PATH,
    )


def test_production_skeleton_without_any_id_is_accepted(sandbox, compiler):
    runner, tmp_path = sandbox
    state = _state(runner, tmp_path)
    document = _production_document(runner, "stale_tenant_context", claimed=None, variant="alpha")
    assert "skeleton_id" not in document
    outcome = _accept(runner, state, document, compiler, runner.CompileContext())
    assert outcome == "accepted", state.progress["rejection_reasons"]

    accepted = [json.loads(line) for line in state.accepted_path.read_text(encoding="utf-8").splitlines()]
    assert len(accepted) == 1
    record = accepted[0]
    assert record["skeleton_id"] == record["canonical_id"]
    assert record["skeleton_id"].startswith("SK-") and len(record["skeleton_id"]) == 19
    assert record["provider_claimed_id"] is None
    assert record["world_id"].startswith("W-")
    # 产物必须落在 worlds/production/（brief §23）
    assert "production" in str(state.accepted_path)
    assert state.compiled_path.parent.name == "compiled"


def test_repeated_provider_claimed_ids_are_not_rejected(sandbox, compiler):
    runner, tmp_path = sandbox
    """brief §29：provider 撞 id 只记录；两个不同语义的骨架都要进 accepted。"""
    state = _state(runner, tmp_path)
    first = _production_document(runner, "stale_tenant_context", claimed="SK-COPY-001", variant="alpha")
    second = _production_document(runner, "one_time_token_reuse", claimed="SK-COPY-001", variant="beta")
    assert first["mechanism_family"] != second["mechanism_family"]
    assert _accept(runner, state, first, compiler, runner.CompileContext()) == "accepted"
    assert _accept(runner, state, second, compiler, runner.CompileContext()) == "accepted"
    assert state.progress["accepted"] == 2
    assert state.progress["rejected"] == 0
    assert state.progress["provider_claimed_id_reuse"] == 1
    assert state.progress["canonical_ids"][0] != state.progress["canonical_ids"][1]


def test_world_identity_is_independent_of_the_claimed_id(sandbox, compiler):
    runner, tmp_path = sandbox
    """同样语义内容 + 不同自称 ⇒ 同一 world_id（ID 由程序拥有的可观测证据）。"""
    def compile_with(claimed: str | None) -> str:
        state = _state(runner, tmp_path, run_id=f"identity-{claimed}")
        document = _production_document(
            runner, "stale_tenant_context", claimed=claimed, variant="alpha"
        )
        assert _accept(runner, state, document, compiler, runner.CompileContext()) == "accepted"
        record = json.loads(state.accepted_path.read_text(encoding="utf-8").splitlines()[0])
        return record["world_id"]

    assert compile_with(None) == compile_with("SK-COPY-001") == compile_with("SK-COPY-002")


def test_identical_content_is_a_program_detected_duplicate(sandbox, compiler):
    runner, tmp_path = sandbox
    """逐字节相同的骨架：canonical id 撞车，按程序判定的重复拒收（不是 provider 的错）。"""
    state = _state(runner, tmp_path)
    document = _production_document(runner, "stale_tenant_context", claimed=None, variant="alpha")
    assert _accept(runner, state, document, compiler, runner.CompileContext()) == "accepted"
    assert _accept(runner, state, dict(document), compiler, runner.CompileContext()) == "rejected"
    assert "duplicate_canonical_id" in state.progress["rejection_reasons"]


def test_phase2a_contract_behaviour_is_unchanged(sandbox, compiler):
    runner, _root = sandbox
    """兼容路径：Phase 2A 契约下 provider id 撞车仍然拒收，产物路径不变。"""
    state = runner.RunState("provider-run-002", contract="phase2a")
    assert str(state.accepted_path).endswith(
        str(Path("worlds") / "skeletons" / "accepted" / "provider-run-002.jsonl")
    )
    document = _production_document(runner, "stale_tenant_context", claimed=None, variant="alpha")
    document["skeleton_id"] = "SK-LEGACY-001"
    outcome = runner.process_skeleton(
        document, state=state, batch_meta=_batch_meta(runner), compiler=compiler,
        context=runner.CompileContext(), schema_path=None,
    )
    assert outcome == "accepted"
    duplicate = dict(document)
    assert runner.process_skeleton(
        duplicate, state=state, batch_meta=_batch_meta(runner), compiler=compiler,
        context=runner.CompileContext(), schema_path=None,
    ) == "rejected"
    assert "duplicate_skeleton_id" in state.progress["rejection_reasons"]


def test_run_id_default_mapping_covers_every_contract(sandbox):
    """run_id 默认映射必须覆盖全部三个契约。

    回归：main() 的映射漏了 ood，OOD pilot 因此以 production run id 跑了 2 批
    （state/ood-progress-provider-run-production-001.json），provenance 全部污染后作废。
    """
    runner, _root = sandbox
    # 001 因编译器泄漏缺陷作废后，production run id 从 002 起（brief §60/§21）。
    # 这条测试钉的是"每个契约都有默认 run id"，不是具体编号——编号会随作废递增。
    assert runner.OOD_RUN_ID == "provider-ood-pilot-001"
    assert runner.PRODUCTION_RUN_ID.startswith("provider-run-production-")
    assert runner.PRODUCTION_RUN_ID != "provider-run-production-001"
    assert set(runner.CONTRACTS) == {"phase2a", "production", "ood"}


def test_ood_and_production_contract_artifact_layout(sandbox):
    """ood / production 契约的产物必须与开发 corpus 物理分开。"""
    runner, _root = sandbox
    for contract, directory, default_id in (
        ("ood", "worlds/ood", runner.OOD_RUN_ID),
        ("production", "worlds/production", runner.PRODUCTION_RUN_ID),
    ):
        state = runner.RunState(default_id, contract=contract)
        actual = str(state.accepted_path).replace("\\", "/")
        assert f"/{directory}/accepted/" in actual, (
            f"{contract} accepted 落在 {state.accepted_path}"
        )
        assert state.contract == contract
    phase2a = runner.RunState(runner.RUN_ID, contract="phase2a")
    assert "/worlds/skeletons/accepted/" in str(phase2a.accepted_path).replace("\\", "/")


def test_production_contract_uses_production_schema_in_the_parser(sandbox):
    """预检必须与契约同 schema：production/ood 骨架没有 skeleton_id 也要能过。

    回归：批循环里 parse_skeleton_batch 漏传 schema_path，clean-room prompt 正确地
    不输出 id，10/10 元素被冻结的 Phase 2A schema 拒掉（'skeleton_id' is a required
    property）——pilot 第一批就把这个管道 bug 抓了出来。
    """
    from semantic_skeleton.generator.parser import parse_skeleton_batch

    runner, _root = sandbox
    sys.path.insert(0, str(SCRIPTS))
    from mechanism_selfcheck import _skeleton_for

    document = {
        key: value for key, value in _skeleton_for(0, "stale_tenant_context").items()
        if key != "skeleton_id"
    }
    batch = parse_skeleton_batch(
        json.dumps(document, ensure_ascii=False),
        reject_duplicate_ids=False,
        schema_path=runner.PRODUCTION_SCHEMA_PATH,
    )
    assert not batch.frame_rejected
    assert len(batch.skeletons) == 1, batch.rejections
