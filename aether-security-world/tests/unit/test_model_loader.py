"""加载器：schema 校验 → 内存形态 → 引用完整性，逐层 fail-fast。

坏文档**绝不修复**（设计 §11.2）：能通过 schema 的进内存，不能通过的抛
:class:`SchemaValidationError` 并带上逐条错误（含 JSON 路径）。
"""
from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import pytest

from security_world.model import (
    CompileError,
    ModelError,
    SchemaValidationError,
    compile_spec_file,
    load_action,
    load_episode,
    load_json,
    load_world,
    load_world_spec,
    validate_action_document,
    validate_episode_document,
    validate_world_document,
    validate_world_spec_document,
)


@pytest.fixture()
def scratch_dir():
    """本环境的 pytest ``tmp_path`` 会因临时目录权限失败，故自建可写目录。"""
    path = Path(tempfile.mkdtemp(prefix="asw-model-test-"))
    yield path
    shutil.rmtree(path, ignore_errors=True)


def test_load_world_reads_the_reference_instance(examples_dir):
    world = load_world(examples_dir / "world.example.json")
    assert world.world_id == "W-000001"
    assert world.world_family_id.startswith("WF-")
    assert len(world.actors) == 4
    assert world.resolve("resource.RES-001.owner") == "ACT-002"


def test_load_world_spec_reads_the_reference_seed(examples_dir):
    spec = load_world_spec(examples_dir / "world-spec.example.json")
    assert spec.world_id == "W-000001"
    assert spec.attack_family == "idor_bola"
    assert spec.hypotheses.attack_opportunities[0].opportunity_id == "OPP-001"
    assert len(spec.episode_templates) == 1


def test_validate_world_document_returns_empty_for_a_valid_document(reference_world):
    assert validate_world_document(reference_world) == []


def test_validate_world_spec_document_returns_empty_for_a_valid_document(reference_world_spec):
    assert validate_world_spec_document(reference_world_spec) == []


def test_validate_episode_document_returns_empty_for_a_valid_document(reference_episode):
    assert validate_episode_document(reference_episode) == []


def test_validate_functions_report_the_json_path(examples_dir):
    invalid = json.loads((examples_dir / "world.invalid.json").read_text(encoding="utf-8"))
    errors = validate_world_document(invalid)
    assert errors
    assert any("ground_truth" in error for error in errors)


def test_load_world_rejects_a_document_with_a_label_field(examples_dir):
    with pytest.raises(SchemaValidationError) as excinfo:
        load_world(examples_dir / "world.invalid.json")
    assert excinfo.value.schema_stem == "world"
    assert any("ground_truth" in error for error in excinfo.value.errors)


def test_load_world_spec_rejects_an_out_of_whitelist_critical_axis(examples_dir):
    """B9：负 fixture 必须因"critical 轴指向 observation 路径"被拒，而不是别的原因。"""
    with pytest.raises(SchemaValidationError) as excinfo:
        load_world_spec(examples_dir / "world-spec.invalid.json")
    assert any("critical_state_variables" in error for error in excinfo.value.errors)


def test_load_episode_reads_the_reference_episode(examples_dir):
    episode = load_episode(examples_dir / "episode.example.json")
    assert episode.episode_id
    assert episode.variant_type == "base"
    assert episode.timeline


def test_validate_action_document_accepts_the_reference_action(reference_episode):
    assert validate_action_document(reference_episode["action"]) == []


def test_load_action_reads_a_valid_action_document(scratch_dir, reference_episode):
    path = scratch_dir / "action.json"
    path.write_text(json.dumps(reference_episode["action"], ensure_ascii=False), encoding="utf-8")
    action = load_action(path)
    assert action["action_id"] == reference_episode["action"]["action_id"]
    assert action["operation"] == "read"


def test_validate_action_document_rejects_an_empty_operation(reference_episode):
    document = dict(reference_episode["action"])
    document["operation"] = ""
    assert validate_action_document(document)


def test_load_json_reports_a_missing_file(scratch_dir):
    with pytest.raises(ModelError, match="文件不存在"):
        load_json(scratch_dir / "nope.json")


def test_load_json_reports_malformed_json(scratch_dir):
    path = scratch_dir / "broken.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ModelError, match="不是合法 JSON"):
        load_json(path)


def test_load_world_reports_a_dangling_reference(scratch_dir, reference_world):
    """已编译世界里的悬空引用是产出管线的错误，必须响亮失败。"""
    document = json.loads(json.dumps(reference_world))
    document["resources"][0]["owner"] = "ACT-999"
    path = scratch_dir / "dangling.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(CompileError) as excinfo:
        load_world(path)
    assert excinfo.value.reason_code == "dangling_ref"


def test_load_world_reports_a_token_cycle(scratch_dir, reference_world):
    document = json.loads(json.dumps(reference_world))
    document["tokens"][1]["parent_token"] = "TOK-002"
    path = scratch_dir / "cycle.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(CompileError) as excinfo:
        load_world(path)
    assert excinfo.value.reason_code == "cycle"


def test_compile_spec_file_round_trips_the_reference_pair(examples_dir, reference_world):
    assert compile_spec_file(examples_dir / "world-spec.example.json").to_document() == reference_world
