"""Batch-size stability over recorded fixtures (design R6, §11.5; brief §7).

Brief §7: "batch size 必须通过实际稳定性测试确定。如果一次生成太多导致 JSON 损坏 / world
重复 / 安全逻辑变浅 / schema violation，则降低 batch size."

This file replays the recorded fixtures in ``generation/fixtures/synthetic/`` through the
real parser at every batch size and asserts, per input class, what the parser must do:

* ``normal``          — every element is accepted; nothing is silently dropped;
* ``truncated``       — the whole batch is rejected with a truncation reason and NO
  partial salvage, at every batch size;
* ``illegal``         — illegal JSON mixed into the batch rejects the whole batch;
* ``schema_invalid``  — only the offending element is rejected, the rest survive.

The batch-size dimension matters because corruption is a function of how much the model
was asked to emit at once: the assertions are run for sizes 1, 2, 4 and 8 (the sizes
``configs/default.json`` asks the probe to cover).
"""
from __future__ import annotations

import json

import pytest

from generation import (
    SYNTHETIC_FIXTURES_DIR,
    ReplayClient,
    default_sizes,
    efficiency_table,
    parse_world_specs,
    probe_batch_stability,
)
from generation.prompts import load_prompt

PROMPT_TEXT = load_prompt("0.1").text
PROMPT_HASH = load_prompt("0.1").prompt_hash
SIZES = (1, 2, 4, 8)
CLASSES = ("normal", "truncated", "illegal", "schema_invalid")
TIMESTAMP = "2026-09-20T00:00:00Z"


@pytest.fixture(scope="module")
def client() -> ReplayClient:
    return ReplayClient(SYNTHETIC_FIXTURES_DIR)


@pytest.fixture(scope="module")
def parsed(client):
    """(size, class) -> ParseResult, parsed once for the whole module."""
    out = {}
    for size in SIZES:
        for fixture_class in CLASSES:
            raw = client.load_recorded(size, fixture_class=fixture_class).to_raw_generation()
            out[(size, fixture_class)] = parse_world_specs(raw, generation_timestamp=TIMESTAMP)
    return out


# --------------------------------------------------------------------------------------
# the fixtures themselves are coherent recordings
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


def test_the_recorded_fixtures_cover_every_batch_size_and_class(client):
    assert client.available() == SIZES
    for size in SIZES:
        for fixture_class in CLASSES:
            recorded = client.load_recorded(size, fixture_class=fixture_class)
            assert recorded.provider == "replay"
            assert recorded.prompt_version == "0.1"
            # the recording's prompt hash is the registered prompt's hash, so replay
            # provenance and the prompt registry cannot drift apart silently
            assert recorded.prompt_hash == PROMPT_HASH
            assert recorded.output_tokens > 0
            assert recorded.output_text != ""


def test_default_sizes_come_from_the_project_config():
    assert default_sizes() == (1, 2, 4, 8)


# --------------------------------------------------------------------------------------
# class 1: normal batches
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("size", SIZES)
def test_normal_batches_accept_every_element(parsed, size):
    result = parsed[(size, "normal")]
    assert not result.stats.batch_rejected
    assert result.stats.elements_decoded == size
    assert result.stats.valid_worlds == size
    assert result.stats.rejected_worlds == 0
    assert result.stats.duplicate_world_ids == 0
    assert result.rejections == ()
    # every accepted world id is distinct and in the batch's own namespace
    ids = result.accepted_world_ids
    assert len(ids) == size
    assert len(set(ids)) == size
    assert all(world_id.startswith("W-") for world_id in ids)
    # and each accepted spec validates (the parser already checked, this is the audit view)
    for spec in result.specs:
        assert spec["provenance"]["origin"] == "step5_seed"
        assert spec["provenance"]["validation_outcome"] == "accepted"


@pytest.mark.parametrize("size", SIZES)
def test_normal_batches_report_a_positive_generation_efficiency(parsed, size):
    result = parsed[(size, "normal")]
    ge = result.stats.valid_worlds_per_1k_tokens
    assert ge > 0
    assert ge == pytest.approx(size / result.stats.output_tokens * 1000)


# --------------------------------------------------------------------------------------
# class 2: truncated output
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("size", SIZES)
def test_truncated_batches_are_rejected_wholesale_with_no_partial_salvage(parsed, size):
    result = parsed[(size, "truncated")]
    assert result.stats.batch_rejected
    assert result.specs == ()
    assert result.stats.elements_decoded == 0
    assert result.stats.valid_worlds == 0
    assert result.stats.rejected_worlds == 0  # nothing was decoded, so nothing was graded
    assert len(result.rejections) == 1
    rejection = result.rejections[0]
    assert rejection.kind == "batch"
    assert rejection.reason == "batch_truncated"
    assert rejection.element_index is None
    # the tokens were still spent: GE must be 0, not "unmeasured"
    assert result.stats.output_tokens > 0
    assert result.stats.valid_worlds_per_1k_tokens == 0.0


@pytest.mark.parametrize("size", SIZES)
def test_truncation_is_reported_as_truncation_not_as_a_schema_problem(parsed, size):
    result = parsed[(size, "truncated")]
    assert result.rejections[0].reason not in {"schema_violation", "element_not_an_object"}


# --------------------------------------------------------------------------------------
# class 3: illegal JSON mixed into the batch
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("size", SIZES)
def test_illegal_json_rejects_the_whole_batch(parsed, size):
    result = parsed[(size, "illegal")]
    assert result.stats.batch_rejected
    assert result.specs == ()
    assert result.stats.elements_decoded == 0
    assert [r.reason for r in result.rejections] == ["batch_undecodable_json"]
    assert result.stats.output_tokens > 0
    assert result.stats.valid_worlds_per_1k_tokens == 0.0


@pytest.mark.parametrize("size", SIZES)
def test_a_corrupt_frame_never_yields_a_partially_accepted_batch(parsed, size):
    for fixture_class in ("truncated", "illegal"):
        result = parsed[(size, fixture_class)]
        assert result.accepted_documents() == []
        document = result.to_document()
        assert document["batch_rejected"] is True
        assert document["accepted_world_ids"] == []


# --------------------------------------------------------------------------------------
# class 4: a schema-violating element inside a well-formed batch
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize("size", SIZES)
def test_a_schema_violation_rejects_only_the_offending_element(parsed, size):
    result = parsed[(size, "schema_invalid")]
    assert not result.stats.batch_rejected
    assert result.stats.elements_decoded == size
    assert result.stats.valid_worlds == size - 1
    assert result.stats.rejected_worlds == 1
    assert len(result.rejections) == 1
    rejection = result.rejections[0]
    assert rejection.kind == "element"
    assert rejection.reason == "schema_violation"
    assert rejection.element_index == size // 2
    assert rejection.world_id is not None
    assert rejection.error_paths == ("application_domain",)
    assert rejection.world_id not in result.accepted_world_ids


@pytest.mark.parametrize("size", SIZES)
def test_element_level_rejection_still_spends_the_tokens(parsed, size):
    result = parsed[(size, "schema_invalid")]
    assert result.stats.output_tokens > 0
    assert result.stats.valid_worlds_per_1k_tokens == pytest.approx(
        (size - 1) / result.stats.output_tokens * 1000
    )


# --------------------------------------------------------------------------------------
# the probe itself
# --------------------------------------------------------------------------------------
def test_probe_batch_stability_reports_every_recording_with_the_required_metrics():
    rows = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, SIZES, generation_timestamp=TIMESTAMP)
    assert len(rows) == len(SIZES) * len(CLASSES) == 16
    assert [row["fixture"] for row in rows] == sorted(row["fixture"] for row in rows)
    required = {
        "batch_size", "fixture", "fixture_class", "provider", "model", "model_version",
        "prompt_version", "prompt_hash", "output_tokens", "input_tokens", "elements_decoded",
        "valid_worlds", "rejected_worlds", "duplicate_world_ids", "batch_rejected",
        "rejection_reasons", "valid_worlds_per_1k_tokens", "warnings",
    }
    for row in rows:
        assert required <= set(row), row["fixture"]
        assert row["provider"] == "replay"
        assert row["prompt_version"] == "0.1"
        assert json.dumps(row, sort_keys=True)  # machine-readable, no exotic types


def test_probe_rows_separate_corruption_from_schema_violation():
    rows = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, SIZES, generation_timestamp=TIMESTAMP)
    by_key = {(row["batch_size"], row["fixture_class"]): row for row in rows}
    for size in SIZES:
        normal = by_key[(size, "normal")]
        truncated = by_key[(size, "truncated")]
        illegal = by_key[(size, "illegal")]
        schema_invalid = by_key[(size, "schema_invalid")]
        assert normal["batch_rejected"] is False
        assert normal["valid_worlds"] == size
        assert truncated["batch_rejected"] is True and truncated["valid_worlds"] == 0
        assert illegal["batch_rejected"] is True and illegal["valid_worlds"] == 0
        assert schema_invalid["batch_rejected"] is False
        assert schema_invalid["valid_worlds"] == size - 1
        assert schema_invalid["rejected_worlds"] == 1


def test_probe_reports_a_missing_recording_instead_of_skipping_it(scratch_dir):
    rows = probe_batch_stability(scratch_dir, [1, 16], generation_timestamp=TIMESTAMP)
    assert rows == [
        {"batch_size": 1, "fixture": None, "fixture_class": None, "error": "no_fixture_for_batch_size"},
        {"batch_size": 16, "fixture": None, "fixture_class": None, "error": "no_fixture_for_batch_size"},
    ]


def test_probe_is_deterministic():
    first = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, SIZES, generation_timestamp=TIMESTAMP)
    second = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, SIZES, generation_timestamp=TIMESTAMP)
    assert first == second


def test_efficiency_table_summarises_the_probe_rows():
    rows = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, SIZES, generation_timestamp=TIMESTAMP)
    table = efficiency_table(rows)
    assert len(table) == len(rows)
    normal_rows = [row for row in table if row.get("fixture_class") == "normal"]
    assert [row["batch_size"] for row in normal_rows] == list(SIZES)
    for row in normal_rows:
        assert row["valid_worlds"] == row["batch_size"]
        assert row["batch_rejected"] is False
        assert row["valid_worlds_per_1k_tokens"] > 0
    truncated_rows = [row for row in table if row.get("fixture_class") == "truncated"]
    assert all(row["valid_worlds"] == 0 and row["batch_rejected"] for row in truncated_rows)


def test_the_batch_size_decision_has_the_numbers_it_needs():
    """The end-to-end question brief §7 asks: which batch size is worth its tokens?"""
    rows = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, SIZES, generation_timestamp=TIMESTAMP)
    per_size = {}
    for row in rows:
        entry = per_size.setdefault(row["batch_size"], {"valid": 0, "rejected": 0, "corrupt": 0})
        entry["valid"] += row["valid_worlds"]
        entry["rejected"] += row["rejected_worlds"]
        entry["corrupt"] += int(row["batch_rejected"])
    assert set(per_size) == set(SIZES)
    for size, entry in per_size.items():
        # normal contributes `size` accepted worlds, schema_invalid contributes size-1
        assert entry["valid"] == 2 * size - 1, entry
        assert entry["corrupt"] == 2, entry  # truncated + illegal
