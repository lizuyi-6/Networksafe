"""Unit tests for ``generation/prompts`` — prompt_version management.

The prompt version is what pins the output frame (design §11.1: "输出必须是严格 JSON array
（或 JSONL，在 prompt_version 里钉死）"), so these tests treat an unregistered version and a
mislabelled file as hard errors rather than something to fall back from.
"""
from __future__ import annotations

import hashlib

import pytest

from generation.prompts import (
    DEFAULT_PROMPT_VERSION,
    PromptFormatError,
    UnknownPromptVersion,
    available_versions,
    decoding_defaults,
    load_prompt,
    output_format_for,
    resolve_prompt_hash,
)


@pytest.fixture()
def scratch_dir():
    """A throwaway directory for tests that need to author a file.

    Deliberately NOT ``tmp_path``: this machine's pytest temp root
    (``%TEMP%/pytest-of-<user>``) denies directory listing/writes to this process, while
    ``tempfile.mkdtemp`` works. Keeping the fixture independent of the pytest temp root
    makes the suite runnable on such a machine without weakening any assertion.
    """
    import shutil
    import tempfile
    from pathlib import Path

    path = Path(tempfile.mkdtemp(prefix="asw-generation-"))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def test_v01_is_registered_and_pins_the_strict_json_array():
    spec = load_prompt(DEFAULT_PROMPT_VERSION)
    assert spec.version == "0.1"
    assert spec.path.name == "v0.1.md"
    assert spec.output_format == "json_array"
    assert spec.schema_contract == "world-spec.schema.json"
    assert spec.default_batch_size == 8


def test_available_versions_lists_exactly_the_registered_prompts():
    # 每个 v<version>.md 落盘即注册；真实 provider smoke 期间合同迭代到 0.12
    # （v0.2 嵌套字段契约 → v0.3 骨架 → v0.4 枚举/endpoints → v0.5 轴路径 →
    # v0.6 binds/timestamp 普适规则 → v0.7 session privilege_version →
    # v0.8 判决词汇 + policy 非空洞 → v0.9 allow 取值/轴 before/双 critical 轴/
    # 证据目录七掩蔽），冻结记录以 state/frozen-versions.json 为准。
    assert available_versions() == (
        "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12"
    )


def test_prompt_hash_is_the_sha256_of_the_body_sent_to_the_model():
    spec = load_prompt("0.1")
    assert spec.prompt_hash == hashlib.sha256(spec.text.encode("utf-8")).hexdigest()
    assert len(spec.prompt_hash) == 64
    # the header is metadata about the prompt, not part of the prompt
    assert "prompt_version: 0.1" not in spec.text
    assert spec.text.strip() != ""


def test_prompt_hash_is_stable_across_loads():
    assert load_prompt("0.1").prompt_hash == load_prompt("0.1").prompt_hash
    assert resolve_prompt_hash("0.1") == load_prompt("0.1").prompt_hash


def test_prompt_requires_batch_output_and_forbids_request_enumeration():
    text = load_prompt("0.1").text.lower()
    assert "json array" in text
    assert "batch_size" in text
    assert "world-spec.schema.json" in text
    # brief §7: "让模型创造逻辑结构，不要让模型提前枚举 50 个 HTTP 请求"
    assert "do not enumerate http requests" in text
    assert "information density" in text


def test_prompt_forbids_labels_and_long_explanations():
    text = load_prompt("0.1").text.lower()
    assert "do not write oracle-label explanations" in text
    assert "provenance" in text  # the harness owns it, the model must not emit it


def test_unknown_prompt_version_is_an_error_not_a_silent_default():
    with pytest.raises(UnknownPromptVersion):
        load_prompt("9.9")
    with pytest.raises(UnknownPromptVersion):
        output_format_for("9.9")


def test_a_jsonl_prompt_version_can_be_registered(scratch_dir):
    (scratch_dir / "v0.2.md").write_text(
        "# prompt_version: 0.2\n# output_format: jsonl\n# schema_contract: world-spec.schema.json\n\nbody\n",
        encoding="utf-8",
    )
    assert output_format_for("0.2", prompts_dir=scratch_dir) == "jsonl"
    assert available_versions(scratch_dir) == ("0.2",)


def test_prompt_header_rejects_unknown_keys(scratch_dir):
    (scratch_dir / "v0.3.md").write_text(
        "# prompt_version: 0.3\n# output_format: json_array\n# surprise: 1\n\nbody\n",
        encoding="utf-8",
    )
    with pytest.raises(PromptFormatError) as excinfo:
        load_prompt("0.3", prompts_dir=scratch_dir)
    assert "surprise" in str(excinfo.value)


def test_prompt_header_requires_the_output_frame(scratch_dir):
    (scratch_dir / "v0.4.md").write_text("# prompt_version: 0.4\n\nbody\n", encoding="utf-8")
    with pytest.raises(PromptFormatError) as excinfo:
        load_prompt("0.4", prompts_dir=scratch_dir)
    assert "output_format" in str(excinfo.value)


def test_prompt_filename_must_match_the_declared_version(scratch_dir):
    (scratch_dir / "v0.5.md").write_text(
        "# prompt_version: 0.6\n# output_format: json_array\n\nbody\n",
        encoding="utf-8",
    )
    with pytest.raises(PromptFormatError) as excinfo:
        load_prompt("0.5", prompts_dir=scratch_dir)
    assert "v0.6" in str(excinfo.value)


def test_prompt_rejects_an_unknown_output_frame(scratch_dir):
    (scratch_dir / "v0.7.md").write_text(
        "# prompt_version: 0.7\n# output_format: yaml_stream\n\nbody\n",
        encoding="utf-8",
    )
    with pytest.raises(PromptFormatError):
        load_prompt("0.7", prompts_dir=scratch_dir)


def test_decoding_defaults_come_from_the_project_config():
    defaults = decoding_defaults("0.1")
    assert defaults["temperature"] == 0.2
    assert defaults["top_p"] == 0.9
    assert defaults["max_output_tokens"] == 8192


def test_v09_carries_the_four_new_contract_clauses() -> None:
    """v0.9 必须逐条带上 21-world 深审的四条新合同（P1-6）。

    这四条对应四个引擎缺陷的**生成侧**对偶：allow 取值必须是世界自己的词汇（P0-1）、
    轴 ``before`` 必须与实际值一致（P0-4）、至少 2 条 critical 轴且有读者（P0-4）、
    证据目录要能构造七个掩蔽 level（观测侧）。漏一条 = 下一批 run 会重踩同一个坑。
    """
    text = load_prompt("0.9").text
    # 1) allow 规则取值必须来自本世界已声明实体
    assert "Every value an `allow` rule compares against must exist in YOUR world" in text
    assert "ROLE-GHOST" in text
    # 2) 轴 before 必须与当前世界实际值一致
    assert "must equal the world's\nACTUAL current value" in text or (
        "before` must equal the world's" in text
    )
    # 3) 至少 2 条 critical 轴且至少 1 条能翻转
    assert "at least 2 critical axes" in text
    assert "axis_skipped_no_reader" in text
    # 4) 证据目录要能构造全部 7 个 masking level
    assert "must support all 7 masking levels" in text
    for field in ("trust_level", "freshness", "attacker_controllable", "contradicts"):
        assert field in text, field
    # 头块版本已升 0.9，v0.8 的两条旧规则逐字保留
    assert load_prompt("0.9").version == "0.9"
    assert "No verdict vocabulary in world text" in text
    assert "Every policy must be non-vacuous" in text
