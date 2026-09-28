"""Unit tests for ``generation/step5`` — the client boundary and the replay adapter.

Two properties are load-bearing here and both are asserted:

1. **Replay is offline.** :class:`ReplayClient` reads a file and nothing else; with
   ``socket.socket`` sabotaged the whole replay + parse path still works (design §11.5).
2. **The live client cannot be reached.** :class:`Step5Client` refuses to be constructed,
   so no test, script or accident can turn Phase 1 into a network caller. No credential
   material is hardcoded anywhere in the package (asserted by scanning the sources).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from generation import RawGeneration, Step5Client, SYNTHETIC_FIXTURES_DIR
from generation.prompts import load_prompt
from generation.step5.replay import FixtureError, RecordedResponse, ReplayClient, load_recorded

PROMPT_TEXT = load_prompt("0.1").text
PROMPT_HASH = load_prompt("0.1").prompt_hash


def _fixture(**overrides) -> dict:
    fixture = {
        "recorded_at": "2026-09-20T00:00:00Z",
        "provider": "replay",
        "model": "step5-pre-replay-synthetic",
        "model_version": "synthetic-0.1",
        "prompt_version": "0.1",
        "prompt_hash": PROMPT_HASH,
        "batch_size": 4,
        "decoding_parameters": {"temperature": 0.2},
        "output_text": '[{"world_id": "W-1000"}]',
        "output_tokens": 12,
        "input_tokens": 900,
        "raw_generation_id": "synthetic-test",
    }
    fixture.update(overrides)
    return fixture


def _write_fixture(scratch_dir: Path, name: str, fixture: dict) -> Path:
    path = scratch_dir / name
    path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    return path


# --------------------------------------------------------------------------------------
# ReplayClient: happy path
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


def test_replay_client_returns_the_recorded_bytes_verbatim():
    client = ReplayClient(SYNTHETIC_FIXTURES_DIR)
    raw = client.generate(PROMPT_TEXT, batch_size=8, max_output_tokens=8192)
    recorded = load_recorded(SYNTHETIC_FIXTURES_DIR / "batch-0008-normal.json")
    assert isinstance(raw, RawGeneration)
    assert raw.output_text == recorded.output_text
    assert raw.output_tokens == recorded.output_tokens
    assert raw.input_tokens == recorded.input_tokens
    assert raw.raw_generation_id == recorded.raw_generation_id
    assert raw.model == recorded.model
    assert raw.model_version == recorded.model_version
    assert raw.prompt_version == "0.1"
    assert raw.prompt_hash == PROMPT_HASH
    assert raw.decoding_parameters == {"temperature": 0.2, "top_p": 0.9, "max_output_tokens": 8192}


def test_replay_client_accepts_a_bare_normal_fixture_name(scratch_dir):
    _write_fixture(scratch_dir, "batch-0004.json", _fixture(batch_size=4))
    client = ReplayClient(scratch_dir)
    raw = client.generate(PROMPT_TEXT, batch_size=4, max_output_tokens=8192)
    assert raw.output_text == '[{"world_id": "W-1000"}]'
    assert client.available() == (4,)


def test_replay_client_lists_every_recorded_batch_size():
    assert ReplayClient(SYNTHETIC_FIXTURES_DIR).available() == (1, 2, 4, 8)


def test_recorded_response_keeps_unknown_fixture_keys(scratch_dir):
    path = _write_fixture(scratch_dir, "batch-0001.json", _fixture(batch_size=1, operator_note="keep me"))
    recorded = load_recorded(path)
    assert isinstance(recorded, RecordedResponse)
    assert recorded.extra == {"operator_note": "keep me"}
    assert recorded.to_raw_generation().output_tokens == 12


# --------------------------------------------------------------------------------------
# ReplayClient: fixture validation (a malformed recording is a hard error)
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "overrides",
    [
        {"provider": "live"},
        {"prompt_hash": "not-a-hash"},
        {"prompt_version": "9.9"},
        {"output_tokens": -1},
        {"output_tokens": "12"},
        {"output_tokens": True},
        {"decoding_parameters": []},
        {"output_text": 12},
        {"model": ""},
        {"recorded_at": None},
    ],
)
def test_malformed_fixtures_are_rejected(scratch_dir, overrides):
    path = _write_fixture(scratch_dir, "batch-0001.json", _fixture(batch_size=1, **overrides))
    with pytest.raises(FixtureError):
        load_recorded(path)


def test_missing_fixture_is_reported_not_skipped(scratch_dir):
    with pytest.raises(FixtureError) as excinfo:
        ReplayClient(scratch_dir).generate(PROMPT_TEXT, batch_size=8, max_output_tokens=8192)
    assert "batch-0008" in str(excinfo.value)


def test_fixture_recorded_against_another_prompt_is_rejected(scratch_dir):
    _write_fixture(scratch_dir, "batch-0001.json", _fixture(batch_size=1, prompt_sha256="0" * 64))
    with pytest.raises(FixtureError) as excinfo:
        ReplayClient(scratch_dir).generate(PROMPT_TEXT, batch_size=1, max_output_tokens=8192)
    assert "different prompt" in str(excinfo.value)


def test_fixture_for_another_batch_size_is_rejected(scratch_dir):
    _write_fixture(scratch_dir, "batch-0008.json", _fixture(batch_size=4))
    with pytest.raises(FixtureError) as excinfo:
        ReplayClient(scratch_dir).generate(PROMPT_TEXT, batch_size=8, max_output_tokens=8192)
    assert "batch_size=4" in str(excinfo.value)


@pytest.mark.parametrize("kwargs", [{"batch_size": 0}, {"batch_size": True}, {"batch_size": "8"}])
def test_generate_validates_its_arguments(scratch_dir, kwargs):
    _write_fixture(scratch_dir, "batch-0001.json", _fixture(batch_size=1))
    client = ReplayClient(scratch_dir)
    size = kwargs["batch_size"]
    with pytest.raises(FixtureError):
        client.generate(PROMPT_TEXT, batch_size=size, max_output_tokens=8192)


def test_fixture_must_reference_a_registered_prompt(scratch_dir):
    _write_fixture(scratch_dir, "batch-0001.json", _fixture(batch_size=1, prompt_version="0.1-beta"))
    with pytest.raises(FixtureError) as excinfo:
        load_recorded(scratch_dir / "batch-0001.json")
    assert "prompt_version" in str(excinfo.value)


# --------------------------------------------------------------------------------------
# Phase 1 network boundary
# --------------------------------------------------------------------------------------
def test_replay_and_parse_work_with_sockets_disabled(monkeypatch):
    import socket

    from generation import parse_world_specs

    def _no_socket(*args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("Phase 1 generation must not open a socket")

    monkeypatch.setattr(socket, "socket", _no_socket)
    client = ReplayClient(SYNTHETIC_FIXTURES_DIR)
    raw = client.generate(PROMPT_TEXT, batch_size=2, max_output_tokens=8192)
    result = parse_world_specs(raw, generation_timestamp="2026-09-20T00:00:00Z")
    assert result.stats.valid_worlds == 2
    assert not result.stats.batch_rejected


def test_step5_client_is_not_implemented_and_refuses_construction():
    with pytest.raises(NotImplementedError) as excinfo:
        Step5Client(api_key="sk-not-a-real-key")  # type: ignore[call-arg]
    assert "NOT IMPLEMENTED" in str(excinfo.value)
    assert "replay" in str(excinfo.value)


def test_no_credential_material_is_hardcoded_in_the_package():
    pattern = re.compile(
        r"(?i)\b(api[_-]?key|secret|password|passphrase|bearer|private[_-]?key)\b\s*[:=]\s*[\"'][^\"']{8,}[\"']"
    )
    package_dir = Path(__file__).resolve().parents[2] / "generation"
    sources = sorted(package_dir.rglob("*.py"))
    assert sources, "no generation sources found"
    hits = []
    for path in sources:
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if pattern.search(line):
                hits.append(f"{path.name}:{number}")
    assert hits == [], f"possible hardcoded credential material: {hits}"
