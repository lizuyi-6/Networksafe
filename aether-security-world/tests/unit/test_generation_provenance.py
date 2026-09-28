"""Unit tests for ``generation/provenance`` — harness-owned provenance records.

The point of the module (design §11.3 / B7) is that a generated record's provenance is
written by the harness, not by the model, and that the key set is closed so no AI
assumption can ride into a release inside a provenance field.
"""
from __future__ import annotations

import pytest

from generation import RawGeneration
from generation.provenance import (
    HARNESS_OWNED_KEYS,
    PROVENANCE_KEYS,
    ProvenanceError,
    build_provenance,
    element_timestamp,
    provenance_mismatch_warnings,
    stamp_provenance,
    verify_provenance_keys,
)

TIMESTAMP = "2026-09-20T00:00:00Z"


def _raw(**overrides) -> RawGeneration:
    fields = {
        "raw_generation_id": "raw-1",
        "model": "step5-pre-replay-synthetic",
        "model_version": "synthetic-0.1",
        "prompt_version": "0.1",
        "prompt_hash": "a" * 64,
        "decoding_parameters": {"temperature": 0.2, "top_p": 0.9},
        "output_text": "[]",
        "output_tokens": 10,
        "input_tokens": 5,
    }
    fields.update(overrides)
    return RawGeneration(**fields)


def test_the_provenance_key_set_is_closed_and_matches_the_spec_schema():
    assert set(PROVENANCE_KEYS) == {
        "origin",
        "generator_model",
        "generator_model_version",
        "prompt_version",
        "prompt_hash",
        "generation_timestamp",
        "raw_generation_id",
        "decoding_parameters",
        "validation_outcome",
    }
    assert set(HARNESS_OWNED_KEYS) <= set(PROVENANCE_KEYS)
    assert "generation_timestamp" not in HARNESS_OWNED_KEYS  # the only field a caller may supply


def test_build_provenance_carries_every_required_field():
    provenance = build_provenance(_raw(), generation_timestamp=TIMESTAMP)
    assert provenance == {
        "origin": "step5_seed",
        "generator_model": "step5-pre-replay-synthetic",
        "generator_model_version": "synthetic-0.1",
        "prompt_version": "0.1",
        "prompt_hash": "a" * 64,
        "generation_timestamp": TIMESTAMP,
        "raw_generation_id": "raw-1",
        "decoding_parameters": {"temperature": 0.2, "top_p": 0.9},
        "validation_outcome": "accepted",
    }
    assert list(provenance) == list(PROVENANCE_KEYS)  # stable, schema-declaration order


def test_build_provenance_never_reads_the_wall_clock():
    # the timestamp is exactly what the caller passed; nothing is normalised or filled in
    provenance = build_provenance(_raw(), generation_timestamp="2001-02-03T04:05:06Z")
    assert provenance["generation_timestamp"] == "2001-02-03T04:05:06Z"


def test_build_provenance_rejects_an_unusable_raw_record():
    with pytest.raises(ProvenanceError):
        build_provenance(_raw(model=""), generation_timestamp=TIMESTAMP)
    with pytest.raises(ProvenanceError):
        build_provenance(_raw(prompt_hash=""), generation_timestamp=TIMESTAMP)
    with pytest.raises(ProvenanceError):
        build_provenance(_raw(model_version=None), generation_timestamp=TIMESTAMP)  # type: ignore[arg-type]
    with pytest.raises(ProvenanceError):
        build_provenance(_raw(), generation_timestamp="")
    with pytest.raises(ProvenanceError):
        build_provenance(_raw(), generation_timestamp=TIMESTAMP, validation_outcome="probably_fine")


def test_stamping_replaces_the_model_block_and_reports_it():
    document = {
        "world_id": "W-1000",
        "provenance": {
            "origin": "handcrafted",
            "generator_model": "a-model-that-lied",
            "generation_timestamp": "1999-01-01T00:00:00Z",
        },
    }
    stamped, replaced = stamp_provenance(document, _raw(), generation_timestamp=TIMESTAMP)
    assert replaced is True
    assert stamped["world_id"] == "W-1000"
    assert stamped["provenance"]["generator_model"] == "step5-pre-replay-synthetic"
    assert stamped["provenance"]["generation_timestamp"] == TIMESTAMP
    assert stamped["provenance"]["validation_outcome"] == "accepted"
    # the input document is never mutated
    assert document["provenance"]["generator_model"] == "a-model-that-lied"


def test_stamping_adds_a_block_where_the_model_emitted_none():
    stamped, replaced = stamp_provenance({"world_id": "W-1000"}, _raw(), generation_timestamp=TIMESTAMP)
    assert replaced is False
    assert stamped["provenance"]["origin"] == "step5_seed"


def test_element_timestamp_reads_only_a_usable_string():
    assert element_timestamp({"provenance": {"generation_timestamp": "2020-01-01T00:00:00Z"}}) == "2020-01-01T00:00:00Z"
    assert element_timestamp({"provenance": {"generation_timestamp": ""}}) is None
    assert element_timestamp({"provenance": {"generation_timestamp": 12}}) is None
    assert element_timestamp({"provenance": "nonsense"}) is None
    assert element_timestamp({}) is None
    assert element_timestamp("not a document") is None


def test_verify_provenance_keys_flags_anything_outside_the_closed_set():
    assert verify_provenance_keys({key: 1 for key in PROVENANCE_KEYS}) == []
    problems = verify_provenance_keys({"hypothesized_verdict": "attack"})
    assert problems == ["unexpected provenance key 'hypothesized_verdict'"]


def test_provenance_mismatch_warnings_flag_a_hash_that_disagrees_with_the_prompt():
    assert provenance_mismatch_warnings(_raw(prompt_hash="b" * 64), registered_prompt_hash="a" * 64) == [
        "prompt_hash_mismatch_registered_prompt: raw claims "
        f"{'b' * 64}, registered prompt v0.1 hashes to {'a' * 64}"
    ]
    assert provenance_mismatch_warnings(_raw(prompt_hash="a" * 64), registered_prompt_hash="a" * 64) == []
    assert provenance_mismatch_warnings(_raw()) == []


def test_the_stamped_block_validates_against_the_spec_schema(validators):
    provenance = build_provenance(_raw(), generation_timestamp=TIMESTAMP)
    validator = validators["world-spec"]
    schema = validator.schema
    provenance_schema = schema["properties"]["provenance"]
    from jsonschema import Draft202012Validator

    errors = list(Draft202012Validator(provenance_schema).iter_errors(provenance))
    assert errors == [], errors
