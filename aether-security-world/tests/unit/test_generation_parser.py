"""Unit tests for ``generation/parser`` — strict frame decoding and the two-tier rejection.

The contract under test (design §11.2 plus the ask's "损坏批次整批拒绝并记录原因，绝不静默修复"):

* a **corrupted frame** (truncated array, illegal JSON, duplicate key, non-array top
  level, empty batch, unknown prompt version) rejects the WHOLE batch — ``specs`` comes
  back empty and exactly one rejection record explains why. No partial salvage.
* a **bad element** inside a perfectly decodable frame (schema violation, duplicate
  ``world_id``, non-object element) is rejected on its own, with its index and the sorted
  schema error paths, and the rest of the batch survives.
"""
from __future__ import annotations

import copy
import json

import pytest
from jsonschema import Draft202012Validator

from generation import (
    BATCH_REASONS,
    ELEMENT_REASONS,
    ParseResult,
    RawGeneration,
    Rejection,
    SpecConversionError,
    parse_world_specs,
)
from generation.parser import strict
from generation.parser.strict import StrictJsonError
from generation.prompts import PROMPTS_DIR

PROMPT_HASH = "a" * 64
TIMESTAMP = "2026-09-20T00:00:00Z"


def _raw(output_text: str, *, prompt_version: str = "0.1", tokens: int = 100) -> RawGeneration:
    return RawGeneration(
        raw_generation_id="raw-1",
        model="step5-pre-replay-synthetic",
        model_version="synthetic-0.1",
        prompt_version=prompt_version,
        prompt_hash=PROMPT_HASH,
        decoding_parameters={"temperature": 0.2},
        output_text=output_text,
        output_tokens=tokens,
        input_tokens=10,
    )


def _spec(world_id: str = "W-1000", **overrides) -> dict:
    """A minimal but complete, schema-valid world seed."""
    spec = {
        "schema_version": "0.1",
        "world_id": world_id,
        "application_domain": "e-commerce",
        "seed": 1,
        "application": {"name": "Synthetic API", "description": "A synthetic API for parser tests."},
        "roles": [{"role_id": "ROLE-USER", "name": "user", "privileges": ["item.read.own"]}],
        "actors": [
            {
                "actor_id": "ACT-001", "actor_type": "user",
                "identity": {"identity_id": "ID-001"},
                "roles": ["ROLE-USER"], "tenant": "TEN-001",
                "authentication_state": "authenticated",
            }
        ],
        "resources": [
            {"resource_id": "RES-001", "resource_type": "file", "owner": "ACT-001",
             "sensitivity": "internal", "state": "active"}
        ],
        "workflows": [
            {
                "workflow_id": "WFL-ITEM", "name": "Item lifecycle",
                "states": ["draft", "published"], "initial_state": "draft",
                "transitions": [{"from_state": "draft", "to_state": "published"}],
                "instances": [{"instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "published"}],
            }
        ],
        "policies": [
            {"policy_id": "POL-READ-OWNER", "action": {"operation": "read"}, "effect": "allow",
             "condition": {"op": "eq", "args": [
                 {"op": "ref", "path": "action.actor.actor_id"},
                 {"op": "ref", "path": "action.resource.owner"}]}},
            {"policy_id": "POL-DEFAULT-DENY", "action": {"operation": "*"}, "effect": "deny",
             "condition": {"op": "lit", "value": True}, "is_default_rule": True},
        ],
        "invariants": [
            {"invariant_id": "INV-OWNERSHIP-001", "category": "ownership", "severity": "critical",
             "applies_to": ["read"],
             "expr": {"op": "eq", "args": [
                 {"op": "ref", "path": "action.actor.actor_id"},
                 {"op": "ref", "path": "action.resource.owner"}]}}
        ],
        "state_history": [{"snapshot_id": "SNAP-000", "at": "2026-09-19T07:00:00Z", "label": "before"}],
        "current_state": {"snapshot_id": "SNAP-001", "at": "2026-09-19T09:00:00Z", "label": "current"},
        "evidence": [
            {"evidence_id": "EV-OWN-001", "type": "ownership_record",
             "asserts_ref": "resource.RES-001.owner", "value": "ACT-001", "source": "item_db",
             "provenance": "system_of_record", "trust_level": "trusted",
             "timestamp": "2026-09-19T09:00:00Z", "freshness": "fresh",
             "attacker_controllable": False, "visible_in_observation": True}
        ],
        "critical_state_variables": ["resource.RES-001.owner"],
        "irrelevant_state_variables": ["observation.request.headers.User-Agent"],
        "attack_family": "idor_bola",
        "hypotheses": {
            "attack_opportunities": [
                {"opportunity_id": "OPP-001", "attack_family": "idor_bola",
                 "target_operation": "read", "hypothesized_verdict": "attack"}
            ],
            "expected_counterfactual_axes": [
                {"axis_id": "AXIS-001", "variable": "resource.RES-001.owner", "kind": "critical",
                 "before": "ACT-001", "after": "ACT-002", "expected_effect": "verdict_flip"}
            ],
        },
        "episode_templates": [
            {"template_id": "TPL-001", "decision_event_index": 0,
             "events": [{"event_type": "request", "actor_id": "ACT-001", "t_offset_ms": 0}]}
        ],
    }
    spec.update(overrides)
    return spec


def _array(*specs: dict) -> str:
    return json.dumps(list(specs), indent=2)


# --------------------------------------------------------------------------------------
# frame decoding
# --------------------------------------------------------------------------------------
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


def test_a_normal_batch_accepts_every_element():
    result = parse_world_specs(_raw(_array(_spec(), _spec("W-1001"))), generation_timestamp=TIMESTAMP)
    assert isinstance(result, ParseResult)
    assert result.stats.valid_worlds == 2
    assert result.stats.rejected_worlds == 0
    assert result.stats.elements_decoded == 2
    assert not result.stats.batch_rejected
    assert result.accepted_world_ids == ("W-1000", "W-1001")
    assert result.rejections == ()


def test_a_truncated_batch_is_rejected_wholesale_without_partial_salvage():
    text = _array(_spec(), _spec("W-1001"))
    truncated = text[: int(len(text) * 0.6)]
    result = parse_world_specs(_raw(truncated), generation_timestamp=TIMESTAMP)
    assert result.specs == ()
    assert result.stats.batch_rejected
    assert result.stats.elements_decoded == 0
    assert len(result.rejections) == 1
    rejection = result.rejections[0]
    assert rejection.kind == "batch"
    assert rejection.reason == "batch_truncated"
    assert rejection.reason in BATCH_REASONS


def test_illegal_json_mixed_into_the_batch_rejects_the_whole_batch():
    text = "[\n" + json.dumps(_spec(), indent=2) + ',\n{"world_id": "W-1001", "application_domain": \n]'
    result = parse_world_specs(_raw(text), generation_timestamp=TIMESTAMP)
    assert result.specs == ()
    assert result.stats.batch_rejected
    assert [r.reason for r in result.rejections] == ["batch_undecodable_json"]


def test_duplicate_object_keys_are_a_batch_rejection_not_last_wins():
    text = '[{"world_id": "W-1000", "world_id": "W-1001"}]'
    result = parse_world_specs(_raw(text), generation_timestamp=TIMESTAMP)
    assert result.specs == ()
    assert result.stats.batch_rejected
    assert result.rejections[0].reason == "batch_duplicate_key"
    assert "W-1001" in result.rejections[0].detail


@pytest.mark.parametrize("text", ['[{"world_id": "W-1000", "seed": NaN}]', '[{"a": Infinity}]'])
def test_non_finite_constants_are_rejected(text):
    result = parse_world_specs(_raw(text), generation_timestamp=TIMESTAMP)
    assert result.stats.batch_rejected
    assert result.rejections[0].reason == "batch_non_finite_constant"


def test_trailing_content_after_the_array_is_rejected():
    text = _array(_spec()) + "\n// the model added a comment"
    result = parse_world_specs(_raw(text), generation_timestamp=TIMESTAMP)
    assert result.stats.batch_rejected
    assert result.rejections[0].reason in {"batch_undecodable_json", "batch_truncated"}


def test_a_non_array_top_level_is_rejected():
    result = parse_world_specs(_raw(json.dumps(_spec())), generation_timestamp=TIMESTAMP)
    assert result.stats.batch_rejected
    assert result.rejections[0].reason == "batch_not_an_array"


def test_an_empty_batch_is_rejected_not_treated_as_zero_cost():
    for text in ("[]", "   \n  "):
        result = parse_world_specs(_raw(text), generation_timestamp=TIMESTAMP)
        assert result.stats.batch_rejected, text
        assert result.rejections[0].reason == "batch_empty"
        assert result.specs == ()


def test_an_unknown_prompt_version_rejects_the_batch_before_decoding():
    result = parse_world_specs(_raw(_array(_spec()), prompt_version="9.9"), generation_timestamp=TIMESTAMP)
    assert result.specs == ()
    assert result.output_format == "unknown"
    assert [r.reason for r in result.rejections] == ["unknown_prompt_version"]


def test_a_prompt_hash_that_disagrees_with_the_registered_prompt_is_reported():
    result = parse_world_specs(_raw(_array(_spec())), generation_timestamp=TIMESTAMP)
    assert result.stats.valid_worlds == 1
    assert any("prompt_hash_mismatch_registered_prompt" in warning for warning in result.warnings)


# --------------------------------------------------------------------------------------
# element-level rejection
# --------------------------------------------------------------------------------------
def test_a_schema_violating_element_is_rejected_alone_and_the_rest_survive():
    bad = _spec("W-1001", application_domain="not_a_real_domain")
    result = parse_world_specs(_raw(_array(_spec(), bad, _spec("W-1002"))), generation_timestamp=TIMESTAMP)
    assert not result.stats.batch_rejected
    assert result.stats.valid_worlds == 2
    assert result.stats.rejected_worlds == 1
    assert result.accepted_world_ids == ("W-1000", "W-1002")
    rejection = result.rejections[0]
    assert rejection.kind == "element"
    assert rejection.reason == "schema_violation"
    assert rejection.element_index == 1
    assert rejection.world_id == "W-1001"
    assert "application_domain" in rejection.error_paths


def test_an_unknown_top_level_key_is_rejected_with_its_path():
    bad = _spec("W-1001")
    bad["ground_truth"] = "attack"
    result = parse_world_specs(_raw(_array(bad)), generation_timestamp=TIMESTAMP)
    assert result.stats.valid_worlds == 0
    assert result.stats.rejected_worlds == 1
    assert result.rejections[0].reason == "schema_violation"


def test_a_non_object_element_is_rejected_alone():
    text = json.dumps([_spec(), "not an object", 42])
    result = parse_world_specs(_raw(text), generation_timestamp=TIMESTAMP)
    assert result.stats.valid_worlds == 1
    assert result.stats.rejected_worlds == 2
    assert [r.reason for r in result.rejections] == ["element_not_an_object", "element_not_an_object"]
    assert [r.element_index for r in result.rejections] == [1, 2]


def test_a_duplicate_world_id_inside_a_batch_is_rejected():
    result = parse_world_specs(_raw(_array(_spec(), _spec())), generation_timestamp=TIMESTAMP)
    assert result.stats.valid_worlds == 1
    assert result.stats.rejected_worlds == 1
    assert result.stats.duplicate_world_ids == 1
    rejection = result.rejections[0]
    assert rejection.reason == "duplicate_world_id"
    assert rejection.element_index == 1
    assert "element 0" in rejection.detail


# --------------------------------------------------------------------------------------
# provenance stamping
# --------------------------------------------------------------------------------------
def test_accepted_specs_carry_the_harness_provenance_record():
    result = parse_world_specs(_raw(_array(_spec())), generation_timestamp=TIMESTAMP)
    provenance = result.specs[0]["provenance"]
    assert provenance == {
        "origin": "step5_seed",
        "generator_model": "step5-pre-replay-synthetic",
        "generator_model_version": "synthetic-0.1",
        "prompt_version": "0.1",
        "prompt_hash": PROMPT_HASH,
        "generation_timestamp": TIMESTAMP,
        "raw_generation_id": "raw-1",
        "decoding_parameters": {"temperature": 0.2},
        "validation_outcome": "accepted",
    }


def test_model_claimed_provenance_is_replaced_and_reported():
    lying = _spec()
    lying["provenance"] = {
        "origin": "handcrafted",
        "generator_model": "definitely-not-the-real-model",
        "generator_model_version": "0",
        "prompt_version": "0.0",
        "prompt_hash": "b" * 64,
        "generation_timestamp": "1999-01-01T00:00:00Z",
        "validation_outcome": "accepted",
    }
    result = parse_world_specs(_raw(_array(lying)), generation_timestamp=TIMESTAMP)
    assert result.stats.valid_worlds == 1
    assert result.stats.model_provenance_replaced == 1
    assert result.specs[0]["provenance"]["generator_model"] == "step5-pre-replay-synthetic"
    assert result.specs[0]["provenance"]["generation_timestamp"] == TIMESTAMP
    assert any("model_provenance_replaced" in warning for warning in result.warnings)


def test_a_model_supplied_timestamp_is_used_only_as_a_fallback_and_is_flagged():
    spec = _spec()
    spec["provenance"] = {"generation_timestamp": "1999-01-01T00:00:00Z"}
    result = parse_world_specs(_raw(_array(spec)))
    assert result.stats.valid_worlds == 1
    assert result.specs[0]["provenance"]["generation_timestamp"] == "1999-01-01T00:00:00Z"
    assert any("model_supplied_generation_timestamp" in warning for warning in result.warnings)


def test_an_element_with_no_timestamp_anywhere_is_rejected_not_stamped_with_a_guess():
    result = parse_world_specs(_raw(_array(_spec())))
    assert result.stats.valid_worlds == 0
    assert result.stats.rejected_worlds == 1
    assert result.rejections[0].reason == "missing_generation_timestamp"
    assert result.rejections[0].reason in ELEMENT_REASONS


# --------------------------------------------------------------------------------------
# result shape, immutability, cross-checks
# --------------------------------------------------------------------------------------
def test_result_unpacks_as_the_contract_pair():
    result = parse_world_specs(_raw(_array(_spec(), _spec("W-1001", application_domain="nope"))),
                               generation_timestamp=TIMESTAMP)
    specs, rejections = result
    assert len(specs) == 1
    assert isinstance(specs[0], dict)
    assert len(rejections) == 1
    assert rejections[0]["reason"] == "schema_violation"
    assert isinstance(rejections[0], dict)


def test_accepted_documents_are_deep_copies():
    result = parse_world_specs(_raw(_array(_spec())), generation_timestamp=TIMESTAMP)
    documents = result.accepted_documents()
    documents[0]["world_id"] = "mutated"
    documents[0]["provenance"]["generator_model"] = "mutated"
    assert result.specs[0]["world_id"] == "W-1000"
    assert result.specs[0]["provenance"]["generator_model"] == "step5-pre-replay-synthetic"


def test_to_document_carries_the_four_required_numbers():
    result = parse_world_specs(_raw(_array(_spec(), _spec("W-1001")), tokens=250),
                               generation_timestamp=TIMESTAMP)
    document = result.to_document()
    for key in ("output_tokens", "valid_worlds", "rejected_worlds", "valid_worlds_per_1k_tokens"):
        assert key in document
    assert document["output_tokens"] == 250
    assert document["valid_worlds"] == 2
    assert document["rejected_worlds"] == 0
    assert document["valid_worlds_per_1k_tokens"] == 8.0


def test_the_reference_world_spec_example_survives_the_parser(examples_dir):
    spec_document = json.loads((examples_dir / "world-spec.example.json").read_text(encoding="utf-8"))
    result = parse_world_specs(_raw(_array(spec_document)), generation_timestamp=TIMESTAMP)
    assert result.stats.valid_worlds == 1, [r.to_document() for r in result.rejections]
    assert result.specs[0]["world_id"] == spec_document["world_id"]
    # the hypotheses block is a spec-side hypothesis and survives here; compile_spec drops it
    assert "hypotheses" in result.specs[0]


# --------------------------------------------------------------------------------------
# the L7 -> L1 bridge (design §15.3 promises WorldSpec elements)
# --------------------------------------------------------------------------------------
def test_accepted_documents_convert_to_world_spec_objects(examples_dir):
    from security_world.model import WorldSpec

    spec_document = json.loads((examples_dir / "world-spec.example.json").read_text(encoding="utf-8"))
    result = parse_world_specs(_raw(_array(spec_document, _spec("W-1001"))), generation_timestamp=TIMESTAMP)
    world_specs = result.as_world_specs()
    assert len(world_specs) == 2
    assert all(isinstance(spec, WorldSpec) for spec in world_specs)
    assert [spec.world_id for spec in world_specs] == ["W-000001", "W-1001"]

    # the typed form preserves what the parser validated. (It is NOT asserted to be a
    # byte-identical re-serialisation: L1's to_document() materialises empty optional
    # collections, e.g. an omitted state_preconditions comes back as []. That is L1's
    # serialisation policy, not this layer's contract.)
    typed = world_specs[0]
    assert typed.application_domain == "e-commerce"
    assert typed.attack_family == "idor_bola"
    assert len(typed.actors) == len(result.specs[0]["actors"])
    assert len(typed.evidence) == len(result.specs[0]["evidence"])
    assert [role.role_id for role in typed.roles] == [role["role_id"] for role in result.specs[0]["roles"]]
    assert [opportunity.opportunity_id for opportunity in typed.hypotheses.attack_opportunities] == ["OPP-001", "OPP-002"]
    assert [axis.axis_id for axis in typed.hypotheses.expected_counterfactual_axes] == ["AXIS-001", "AXIS-002"]
    assert typed.provenance.generator_model == "step5-pre-replay-synthetic"
    assert typed.provenance.prompt_version == "0.1"
    assert typed.provenance.generation_timestamp == TIMESTAMP
    assert typed.provenance.validation_outcome == "accepted"


def test_conversion_reports_a_contract_disagreement_instead_of_swallowing_it(examples_dir, monkeypatch):
    spec_document = json.loads((examples_dir / "world-spec.example.json").read_text(encoding="utf-8"))
    result = parse_world_specs(_raw(_array(spec_document)), generation_timestamp=TIMESTAMP)

    import security_world.model as model_module

    def _refuse(_document):
        raise ValueError("L1 says no")

    monkeypatch.setattr(model_module.WorldSpec, "from_document", classmethod(lambda cls, doc: _refuse(doc)))
    with pytest.raises(SpecConversionError) as excinfo:
        result.as_world_specs()
    assert "W-000001" in str(excinfo.value)


def test_a_rejected_batch_converts_to_no_world_specs():
    result = parse_world_specs(_raw("[{"), generation_timestamp=TIMESTAMP)
    assert result.as_world_specs() == ()


def test_the_parser_validator_agrees_with_the_architect_registry(validators, examples_dir):
    """Cross-check: what the parser accepts must also validate under conftest's registry."""
    spec_document = json.loads((examples_dir / "world-spec.example.json").read_text(encoding="utf-8"))
    result = parse_world_specs(_raw(_array(spec_document)), generation_timestamp=TIMESTAMP)
    validator: Draft202012Validator = validators["world-spec"]
    for spec in result.specs:
        errors = list(validator.iter_errors(spec))
        assert errors == [], f"parser accepted a spec the architect registry rejects: {errors}"


# --------------------------------------------------------------------------------------
# JSONL frame (the alternative the prompt version may pin)
# --------------------------------------------------------------------------------------
def _jsonl_prompt_dir(scratch_dir):
    """A prompts directory registering v0.1 (a copy of the real one) plus a JSONL v0.2."""
    (scratch_dir / "v0.1.md").write_text(
        (PROMPTS_DIR / "v0.1.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (scratch_dir / "v0.2.md").write_text(
        "# prompt_version: 0.2\n# output_format: jsonl\n# schema_contract: world-spec.schema.json\n\nbody\n",
        encoding="utf-8",
    )
    return scratch_dir


def test_a_jsonl_prompt_version_decodes_line_by_line(scratch_dir):
    text = "\n".join(json.dumps(_spec(f"W-{index}")) for index in range(3)) + "\n"
    result = parse_world_specs(
        _raw(text, prompt_version="0.2"), generation_timestamp=TIMESTAMP, prompts_dir=_jsonl_prompt_dir(scratch_dir)
    )
    assert result.output_format == "jsonl"
    assert result.stats.valid_worlds == 3
    assert result.accepted_world_ids == ("W-0", "W-1", "W-2")


def test_a_jsonl_frame_with_an_undecodable_line_rejects_the_whole_batch(scratch_dir):
    lines = [json.dumps(_spec("W-0")), '{"world_id": "W-1", ', json.dumps(_spec("W-2"))]
    result = parse_world_specs(
        _raw("\n".join(lines), prompt_version="0.2"),
        generation_timestamp=TIMESTAMP,
        prompts_dir=_jsonl_prompt_dir(scratch_dir),
    )
    assert result.specs == ()
    assert result.stats.batch_rejected
    rejection = result.rejections[0]
    assert rejection.kind == "batch"
    assert rejection.line == 2
    assert rejection.reason in {strict.REASON_LINE_UNDECODABLE, strict.REASON_TRUNCATED}


def test_a_jsonl_frame_skips_blank_lines_but_not_bad_objects(scratch_dir):
    text = "\n\n" + json.dumps(_spec("W-0")) + "\n\n" + json.dumps(_spec("W-1", seed="not-an-int")) + "\n"
    result = parse_world_specs(
        _raw(text, prompt_version="0.2"),
        generation_timestamp=TIMESTAMP,
        prompts_dir=_jsonl_prompt_dir(scratch_dir),
    )
    assert result.stats.valid_worlds == 1
    assert result.stats.rejected_worlds == 1
    assert result.rejections[0].reason == "schema_violation"


# --------------------------------------------------------------------------------------
# strict decoder primitives
# --------------------------------------------------------------------------------------
def test_loads_strict_rejects_a_second_document_in_one_call():
    with pytest.raises(StrictJsonError):
        strict.loads_strict('{"a": 1} {"b": 2}')


def test_loads_strict_allows_surrounding_whitespace():
    assert strict.loads_strict('  \n [1, 2] \n ') == [1, 2]


def test_loads_jsonl_returns_one_based_line_numbers():
    entries = strict.loads_jsonl('{"a": 1}\n\n{"b": 2}\n')
    assert [(entry.line, entry.value) for entry in entries] == [(1, {"a": 1}), (3, {"b": 2})]


def test_rejection_documents_are_json_serialisable():
    result = parse_world_specs(_raw("["), generation_timestamp=TIMESTAMP)
    payload = json.dumps(result.to_document(), sort_keys=True)
    assert "batch_truncated" in payload
    assert isinstance(Rejection(kind="batch", reason="x", detail="y").to_document(), dict)
    assert copy.deepcopy(result.rejections[0].to_document()) == result.rejections[0].to_document()


def test_prompt_pinning_uses_the_package_prompt_directory():
    assert PROMPTS_DIR.is_dir()
    assert (PROMPTS_DIR / "v0.1.md").is_file()
