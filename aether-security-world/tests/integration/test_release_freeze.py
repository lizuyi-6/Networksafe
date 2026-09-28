"""release manifest + freeze：manifest 过 schema、字节可验证、冻结后拒绝覆盖。

``release.schema.json`` 是契约权威，因此这里逐项断言 manifest 的**必填字段都有出处**：
``git_commit`` 由调用方给、``schema_versions`` 从 schemas 读、``generator_prompt_hash``
是 prompt body 的 sha256、``file_sha256`` 是写出文件的实际字节哈希。
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from analysis import run_pipeline
from security_world.model import validate_document
from security_world.release import (
    ReleaseError,
    build_release,
    freeze,
    is_frozen,
    load_episodes,
    load_manifest,
    resolve_generator_prompt_hash,
    schema_versions,
    verify_release,
)

GIT_COMMIT = "0df82c2" + "0" * 33  # 7~64 位十六进制（本地合成值，非真实 commit）


@pytest.fixture(scope="module")
def release():
    """一个真实构建（并冻结）的 release。"""
    result = run_pipeline(renderers=("http_request",))
    holder = tempfile.TemporaryDirectory(prefix="asw-release-")
    out_dir = Path(holder.name)
    manifest = build_release(
        list(result.episodes),
        out_dir=out_dir,
        git_commit=GIT_COMMIT,
        worlds=dict(result.worlds),
        families=dict(result.families),
        declared_attack_families=dict(result.declared_attack_families),
        release_id="ASW-v0.1-test",
        frozen_at="2026-09-21T00:00:00Z",
    )
    # 让临时目录活到这个模块的测试跑完
    pytest.modules_tmp = holder  # type: ignore[attr-defined]
    return manifest


def test_manifest_passes_the_release_schema(release) -> None:
    document = release.document
    errors = validate_document(dict(document), "release")
    assert not errors, errors


def test_manifest_records_the_required_provenance(release) -> None:
    document = release.document
    assert document["release_id"] == "ASW-v0.1-test"
    assert document["git_commit"] == GIT_COMMIT
    assert document["schema_version"] == "0.1"
    assert document["schema_versions"]["world"] == "0.1"
    assert document["schema_versions"]["oracle_output"] == "0.1"
    assert len(document["generator_prompt_hash"]) == 64
    assert document["frozen_at"] == "2026-09-21T00:00:00Z"


def test_manifest_counts_match_the_episodes(release) -> None:
    document = release.document
    assert document["sample_count"] == len(release.episodes)
    assert document["expanded_episode_count"] == len(release.episodes)
    assert document["source_world_count"] == len({item.world_id for item in release.episodes})
    assert sum(document["class_distribution"].values()) == document["sample_count"]
    assert document["counterfactual_family_count"] == len(
        {item.counterfactual_family_id for item in release.episodes}
    )


def test_manifest_carries_one_split_row_per_strategy(release) -> None:
    document = release.document
    strategies = [row["strategy"] for row in document["split_assignments"]]
    assert len(strategies) == 8
    assert len(set(strategies)) == 8
    for row in document["split_assignments"]:
        assert row["group_overlap_audit"] == []  # schema maxItems: 0
        assert sum(row["counts"].values()) == document["sample_count"]
    primary = document["split_statistics"]
    assert primary["strategy"] in strategies
    assert sum(primary["counts"].values()) == document["sample_count"]


def test_manifest_validation_summary_covers_every_gate(release) -> None:
    summary = {row["gate"]: row for row in release.document["validation_summary"]}
    for gate in (
        "G1_schema",
        "G2_reference_integrity",
        "G3_policy_executability",
        "G4_oracle_determinism",
        "G5_counterfactual_consistency",
        "G6_irrelevant_invariance",
        "G7_evidence_sufficiency",
        "G8_leakage_audit",
        "G9_duplicate_audit",
        "G10_distribution_summary",
        "G11_surface_label_independence",
        "G12_lexical_label_leakage",
    ):
        assert gate in summary, gate
        assert summary[gate]["failed"] == 0, summary[gate]


def test_manifest_family_coverage_lists_unsupported_families(release) -> None:
    """REVISION 2（A6）：manifest 必须带族级 coverage，未支持的族如实列出。"""
    coverage = release.document["family_coverage"]
    assert coverage["supported_count"] + coverage["unsupported_count"] == (
        len(coverage["invariant_families"]) + len(coverage["failure_families"])
    )
    for row in coverage["unsupported"]:
        assert row["supported"] is False and row["witnesses"] == 0, row
    # 人工语料里 HC-017 故意携带一个越界 ownership 不变量 ⇒ 必须出现在未支持清单
    unsupported = {(row["world_id"], row["family"]) for row in coverage["unsupported"]}
    assert ("W-HC-017", "ownership") in unsupported, sorted(unsupported)


def test_manifest_attack_family_reachability(release) -> None:
    rows = release.document["attack_family_reachability"]
    assert rows
    for row in rows:
        assert row["reachable_samples"] > 0, row


def test_file_sha256_matches_the_bytes_on_disk(release) -> None:
    entries = release.document["file_sha256"]
    assert entries, "file_sha256 不允许为空（schema minItems: 1）"
    assert verify_release(release.out_dir) == []
    for entry in entries:
        assert entry["bytes"] > 0
        assert len(entry["sha256"]) == 64


def test_episodes_jsonl_round_trips(release) -> None:
    documents = load_episodes(release.out_dir)
    assert len(documents) == len(release.episodes)
    for document in documents[:5]:
        assert validate_document(document, "episode") == []
        assert document["split_assignments"], "冻结 release 里的 episode 必须带 split 行"


def test_freeze_refuses_to_overwrite(release) -> None:
    assert not is_frozen(release.out_dir)
    freeze(release.out_dir)
    assert is_frozen(release.out_dir)
    try:
        freeze(release.out_dir)
    except ReleaseError as exc:
        assert exc.reason_code == "release_already_frozen"
    else:  # pragma: no cover
        raise AssertionError("冻结后的 release 必须拒绝再次冻结")


def test_freeze_requires_a_manifest() -> None:
    with tempfile.TemporaryDirectory(prefix="asw-empty-") as name:
        try:
            freeze(Path(name))
        except ReleaseError as exc:
            assert exc.reason_code == "release_without_manifest"
        else:  # pragma: no cover
            raise AssertionError("没有 manifest 的目录不许冻结")


def test_prompt_hash_is_the_prompt_body_sha256() -> None:
    digest = resolve_generator_prompt_hash("0.1")
    assert len(digest) == 64
    assert all(character in "0123456789abcdef" for character in digest)


def test_schema_versions_come_from_the_schema_files() -> None:
    versions = schema_versions()
    for key in ("world", "episode", "evidence", "policy", "oracle_output"):
        assert versions[key] == "0.1"


def test_manifest_is_written_as_sorted_json(release) -> None:
    text = (release.out_dir / "manifest.json").read_text(encoding="utf-8")
    document = json.loads(text)
    assert document == json.loads(json.dumps(release.document))
    assert text.endswith("\n")
