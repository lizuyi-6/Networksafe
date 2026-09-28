"""Canonical identity 与 provider ID 所有权（Phase 2B brief §6/§7/§29）。

这一组测试钉的是 Phase 2A 实测踩过的坑：Step 曾连续三批复制旧的 ``skeleton_id``，
而那时 ``skeleton_id`` 不只是句柄——``world_id``、``seed``、全部实体 ID 都由它派生。
也就是说 provider 随口写的字符串进了 canonical 身份。现在身份是程序的纯函数，
这些测试保证它不会再退回去。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from semantic_skeleton.compiler.compiler import CompileContext
from semantic_skeleton.generator.parser import parse_skeleton_batch
from semantic_skeleton.identity import (
    canonical_document_digest,
    canonical_skeleton_id,
    provider_claimed_id,
)
from semantic_skeleton.skeleton import (
    PRODUCTION_SCHEMA_PATH,
    SCHEMA_PATH,
    load_skeleton,
    schema_violations,
)

ROOT = Path(__file__).resolve().parents[2]


# --------------------------------------------------------------------------- #
# canonical id 本身
# --------------------------------------------------------------------------- #
def test_canonical_id_is_deterministic_and_independent_of_arrival_order(fixture_skeleton):
    first = canonical_skeleton_id(fixture_skeleton)
    # 键顺序不同（JSON 对象无序）+ 到达批次不同 ⇒ 同一个 frozen 骨架必须同一个 id
    reordered = dict(reversed(list(fixture_skeleton.items())))
    assert canonical_skeleton_id(reordered) == first
    assert canonical_skeleton_id(json.loads(json.dumps(fixture_skeleton))) == first
    assert first.startswith("SK-") and len(first) == 19


def test_canonical_id_is_stable_across_processes(fixture_skeleton):
    """跨进程稳定（不依赖 PYTHONHASHSEED / dict 迭代顺序）。"""
    script = (
        "import json,sys;"
        "sys.path.insert(0, %r);"
        "from semantic_skeleton.identity import canonical_skeleton_id;"
        "print(canonical_skeleton_id(json.load(open(%r, encoding='utf-8'))))"
        % (str(ROOT), str(ROOT / "semantic_skeleton" / "fixtures" / "stale-tenant-context.json"))
    )
    proc = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, check=True
    )
    assert proc.stdout.strip() == canonical_skeleton_id(fixture_skeleton)


def test_provider_claimed_id_does_not_change_the_canonical_id(fixture_skeleton):
    """brief §6：provider 自称的 id 不得进入 canonical 身份。

    这正是 Phase 2A 的坑：模型复制旧 id ⇒ world_id / 实体 ID 跟着撞。
    """
    baseline = canonical_skeleton_id(fixture_skeleton)
    for claimed in ("SK-COPY-001", "SK-COPY-001", "totally-different", ""):
        variant = dict(fixture_skeleton)
        variant["provider_claimed_id"] = claimed
        assert canonical_skeleton_id(variant) == baseline
        variant = dict(fixture_skeleton)
        variant["skeleton_id"] = claimed
        assert canonical_skeleton_id(variant) == baseline
    assert canonical_document_digest(fixture_skeleton) == canonical_document_digest(
        {**fixture_skeleton, "skeleton_id": "SK-SOMETHING-ELSE"}
    )


def test_distinct_semantics_get_distinct_ids(fixture_skeleton):
    other = dict(fixture_skeleton)
    other["failure_mechanism"] = "a materially different failure mechanism description"
    assert canonical_skeleton_id(other) != canonical_skeleton_id(fixture_skeleton)


def test_provider_claimed_id_reads_both_spellings(fixture_skeleton):
    assert provider_claimed_id({"provider_claimed_id": "SK-A"}) == "SK-A"
    assert provider_claimed_id({"skeleton_id": "SK-B"}) == "SK-B"
    assert provider_claimed_id({}) is None
    assert provider_claimed_id({"provider_claimed_id": "  "}) is None


# --------------------------------------------------------------------------- #
# production schema
# --------------------------------------------------------------------------- #
def test_production_schema_rejects_a_provider_supplied_skeleton_id(fixture_skeleton):
    document = {**fixture_skeleton, "provider_claimed_id": "SK-EXAMPLE-001"}
    document.pop("skeleton_id")
    assert not schema_violations(document, schema_path=PRODUCTION_SCHEMA_PATH)
    with_id = dict(document)
    with_id["skeleton_id"] = "SK-EXAMPLE-001"
    messages = " | ".join(
        item.detail for item in schema_violations(with_id, schema_path=PRODUCTION_SCHEMA_PATH)
    )
    assert "skeleton_id" in messages, (
        f"production schema 必须拒绝 provider 自带 skeleton_id，实际违规: {messages}"
    )


def test_production_schema_accepts_a_document_with_no_id_at_all(fixture_skeleton):
    document = {key: value for key, value in fixture_skeleton.items() if key != "skeleton_id"}
    assert not schema_violations(document, schema_path=PRODUCTION_SCHEMA_PATH)
    # 装载也不需要调用方给 id 之外的东西：canonical id 由程序派生
    skeleton = load_skeleton(document, schema_path=PRODUCTION_SCHEMA_PATH)
    assert skeleton.skeleton_id == canonical_skeleton_id(document)
    assert skeleton.provider_claimed_id is None


def test_phase2a_schema_still_requires_skeleton_id(fixture_skeleton):
    """Phase 2A 契约逐字节不变：它的 schema 仍然要求 skeleton_id。"""
    without = {key: value for key, value in fixture_skeleton.items() if key != "skeleton_id"}
    assert schema_violations(without, schema_path=SCHEMA_PATH)
    assert not schema_violations(fixture_skeleton, schema_path=SCHEMA_PATH)


def test_frozen_phase2a_schema_file_is_untouched():
    """PHASE2A-FINAL-FREEZE 记录的 schema 哈希必须仍然对得上（禁止改冻结产物）。"""
    import hashlib

    digest = hashlib.sha256(SCHEMA_PATH.read_bytes()).hexdigest()
    assert digest == "82bc9516e089f9b37bd1f56b97da79d6faa83e020b74d4dac545a00196a3874d"


# --------------------------------------------------------------------------- #
# 编译器：canonical 身份流向 world_id / 实体 id
# --------------------------------------------------------------------------- #
def test_compiled_identity_follows_the_canonical_id_not_the_claim(compiler, fixture_skeleton):
    document = {key: value for key, value in fixture_skeleton.items() if key != "skeleton_id"}
    canonical = canonical_skeleton_id(document)

    def compile_with(claim: str | None, canonical_id: str | None) -> tuple[str, dict]:
        payload = dict(document)
        if claim is not None:
            payload["provider_claimed_id"] = claim
        ctx = CompileContext(canonical_skeleton_id=canonical_id)
        result = compiler.compile_with_plan(payload, context=ctx)
        return result.spec["world_id"], dict(result.plan.entity_ids)

    baseline_world, baseline_ids = compile_with(None, canonical)
    # provider 换了三个自称，canonical id 不变 ⇒ world_id 与实体 id 必须逐字节相同
    for claim in ("SK-COPY-001", "SK-COPY-002", "another-handle"):
        world_id, entity_ids = compile_with(claim, canonical)
        assert world_id == baseline_world
        assert entity_ids == baseline_ids
    # canonical id 变 ⇒ 身份必须变（否则说明还在吃 provider 的输入）
    other_world, other_ids = compile_with(None, "SK-" + "0" * 16)
    assert other_world != baseline_world
    assert other_ids != baseline_ids


def test_compiling_the_same_skeleton_twice_is_byte_identical(compiler, fixture_skeleton):
    """brief §20：同一 frozen 骨架重复编译逐字节相同（canonical id 是纯函数的前提）。"""
    document = {key: value for key, value in fixture_skeleton.items() if key != "skeleton_id"}
    ctx = CompileContext(canonical_skeleton_id=canonical_skeleton_id(document))
    first = compiler.compile_with_plan(document, context=ctx)
    second = compiler.compile_with_plan(document, context=ctx)
    assert json.dumps(first.spec, sort_keys=True) == json.dumps(second.spec, sort_keys=True)


# --------------------------------------------------------------------------- #
# brief §29：provider id 撞车不再是拒收理由
# --------------------------------------------------------------------------- #
def test_duplicate_claimed_ids_are_not_a_rejection_in_production(fixture_skeleton):
    base = {key: value for key, value in fixture_skeleton.items() if key != "skeleton_id"}
    twin = dict(base)
    twin["scenario_summary"] = "a second, genuinely different scenario summary text here"
    twin["security_goal"] = "a second, genuinely different security goal statement here"
    text = "\n".join(
        json.dumps({**doc, "provider_claimed_id": "SK-SAME-CLAIM"}, ensure_ascii=False)
        for doc in (base, twin)
    )
    batch = parse_skeleton_batch(text, reject_duplicate_ids=False,
                                 schema_path=PRODUCTION_SCHEMA_PATH)
    assert not batch.frame_rejected
    assert len(batch.skeletons) == 2, batch.rejections
    assert not [item for item in batch.rejections if item.reason == "duplicate_skeleton_id"]


def test_phase2a_parser_still_rejects_duplicate_ids(fixture_skeleton):
    """兼容路径行为不变：Phase 2A 契约下 provider id 撞车仍然拒收。"""
    text = "\n".join(json.dumps(fixture_skeleton, ensure_ascii=False) for _ in range(2))
    batch = parse_skeleton_batch(text)
    assert len(batch.skeletons) == 1
    assert [item.reason for item in batch.rejections] == ["duplicate_skeleton_id"]


def test_load_skeleton_derives_the_id_when_the_provider_supplies_none(fixture_skeleton):
    """没有 canonical_id 也没有 skeleton_id 时，装载器自己算 canonical id（不漏身份）。"""
    document = {key: value for key, value in fixture_skeleton.items() if key != "skeleton_id"}
    skeleton = load_skeleton(document, schema_path=PRODUCTION_SCHEMA_PATH)
    assert skeleton.skeleton_id == canonical_skeleton_id(document)
    # 调用方显式给的 canonical id 优先（runner 与编译器走这条路）
    explicit = load_skeleton(
        document, schema_path=PRODUCTION_SCHEMA_PATH, canonical_id="SK-" + "a" * 16
    )
    assert explicit.skeleton_id == "SK-" + "a" * 16
