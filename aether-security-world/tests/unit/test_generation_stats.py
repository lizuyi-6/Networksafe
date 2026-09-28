"""Unit tests for ``generation/stats`` — token accounting and Generation Efficiency.

Brief §19 requires four recorded numbers (``output_tokens``, ``valid_worlds``,
``rejected_worlds``, ``valid_worlds_per_1k_tokens``) and one derived indicator
(``GE = accepted_unique_worlds / output_tokens * 1000``). These tests pin the arithmetic
and, more importantly, the refusal to invent a denominator.
"""
from __future__ import annotations

import json

import pytest
from jsonschema import Draft202012Validator

from generation import GenerationStats, generation_efficiency


def test_generation_efficiency_is_valid_worlds_per_1k_output_tokens():
    assert generation_efficiency(5, 2000) == 2.5
    assert generation_efficiency(8, 18052) == pytest.approx(0.4431641923, rel=1e-6)
    assert generation_efficiency(0, 1000) == 0.0


@pytest.mark.parametrize("tokens", [0, -1])
def test_generation_efficiency_refuses_an_absent_denominator(tokens):
    with pytest.raises(ValueError) as excinfo:
        generation_efficiency(3, tokens)
    assert "output_tokens" in str(excinfo.value)


@pytest.mark.parametrize("value", [True, False])
def test_generation_efficiency_rejects_booleans_as_counts(value):
    with pytest.raises(TypeError):
        generation_efficiency(value, 100)
    with pytest.raises(TypeError):
        generation_efficiency(1, value)


@pytest.mark.parametrize("value", [1.5, "10", None])
def test_generation_efficiency_rejects_non_integers(value):
    with pytest.raises(TypeError):
        generation_efficiency(value, 100)
    with pytest.raises(TypeError):
        generation_efficiency(1, value)


def test_generation_efficiency_rejects_negative_world_counts():
    with pytest.raises(ValueError):
        generation_efficiency(-1, 100)


def test_stats_record_the_four_required_numbers():
    stats = GenerationStats(
        output_tokens=2000,
        input_tokens=500,
        elements_decoded=6,
        valid_worlds=5,
        rejected_worlds=1,
        duplicate_world_ids=0,
        batch_rejected=False,
    )
    document = stats.to_document()
    assert document["output_tokens"] == 2000
    assert document["valid_worlds"] == 5
    assert document["rejected_worlds"] == 1
    assert document["valid_worlds_per_1k_tokens"] == 2.5
    assert document["elements_decoded"] == 6
    assert document["input_tokens"] == 500
    assert document["batch_rejected"] is False


def test_stats_property_matches_the_standalone_metric():
    stats = GenerationStats(
        output_tokens=4000, input_tokens=0, elements_decoded=2, valid_worlds=2,
        rejected_worlds=0, duplicate_world_ids=0, batch_rejected=False,
    )
    assert stats.valid_worlds_per_1k_tokens == generation_efficiency(2, 4000) == 0.5


def test_stats_with_no_recorded_tokens_report_no_efficiency_instead_of_crashing():
    stats = GenerationStats(
        output_tokens=0, input_tokens=0, elements_decoded=0, valid_worlds=0,
        rejected_worlds=0, duplicate_world_ids=0, batch_rejected=True,
    )
    document = stats.to_document()
    assert document["valid_worlds_per_1k_tokens"] is None
    with pytest.raises(ValueError):
        _ = stats.valid_worlds_per_1k_tokens


def test_stats_reject_negative_and_non_integer_counts():
    with pytest.raises(ValueError):
        GenerationStats(
            output_tokens=-1, input_tokens=0, elements_decoded=0, valid_worlds=0,
            rejected_worlds=0, duplicate_world_ids=0, batch_rejected=True,
        )
    with pytest.raises(TypeError):
        GenerationStats(
            output_tokens="10", input_tokens=0, elements_decoded=0, valid_worlds=0,
            rejected_worlds=0, duplicate_world_ids=0, batch_rejected=True,
        )


def test_generator_model_entry_feeds_the_release_manifest_schema(project_root):
    """The GE row must be a valid ``release.schema.json`` ``generator_models[]`` item."""
    release_schema = json.loads((project_root / "schemas" / "release.schema.json").read_text(encoding="utf-8"))
    item_schema = release_schema["properties"]["generator_models"]["items"]
    stats = GenerationStats(
        output_tokens=2000, input_tokens=500, elements_decoded=5, valid_worlds=5,
        rejected_worlds=0, duplicate_world_ids=0, batch_rejected=False,
    )
    row = stats.generator_model_entry(model="step5-pre-replay-synthetic", model_version="synthetic-0.1")
    assert row == {
        "model": "step5-pre-replay-synthetic",
        "model_version": "synthetic-0.1",
        "world_count": 5,
        "output_tokens": 2000,
        "valid_worlds_per_1k_tokens": 2.5,
        "provider": "replay",
    }
    assert list(Draft202012Validator(item_schema).iter_errors(row)) == []


def test_generator_model_entry_distinguishes_replay_from_live():
    stats = GenerationStats(
        output_tokens=100, input_tokens=10, elements_decoded=1, valid_worlds=1,
        rejected_worlds=0, duplicate_world_ids=0, batch_rejected=False,
    )
    assert stats.generator_model_entry(model="m", model_version="v", provider="live")["provider"] == "live"
    with pytest.raises(ValueError):
        stats.generator_model_entry(model="m", model_version="v", provider="imagination")
