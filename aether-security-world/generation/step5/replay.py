"""Offline replay adapter: recorded Step-5-pre responses, zero network.

``ReplayClient`` is the Phase 1 default client (design §11.5). It reads one recorded
response per batch size from a fixture directory and hands back the bytes verbatim, so
the parser, the provenance stamping and the efficiency metrics can all be exercised —
and the batch-size stability probe can run — without a single API call.

Fixture layout (one file per batch size)::

    <fixture_dir>/batch-0001.json
    <fixture_dir>/batch-0002.json
    <fixture_dir>/batch-0008-schema_invalid.json   # class suffix, see probe_batch_stability

Real recordings land in ``generation/fixtures/recorded/`` (gitignored: design §11.5
"fixture 本身 gitignore"). The tiny hand-authored probe fixtures used by the unit tests
live in ``generation/fixtures/synthetic/`` and ARE tracked, so a fresh clone can run the
parser tests. Both directories are read by the same code.

A fixture is a JSON object::

    {
      "recorded_at": "2026-09-20T00:00:00Z",     # VirtualClock value, required
      "provider": "replay",                       # required, must be "replay"
      "model": "...", "model_version": "...",     # required
      "prompt_version": "0.1",                    # required, must be a registered prompt
      "prompt_hash": "<64 hex>",                  # required
      "prompt_sha256": "<64 hex>",                # optional; checked against the prompt passed to generate()
      "batch_size": 8,                            # optional; checked against the requested batch_size
      "decoding_parameters": {...},               # required object
      "output_text": "...",                       # required, verbatim model output
      "output_tokens": 1234, "input_tokens": 56,  # required ints >= 0
      "raw_generation_id": "...",                 # required
      "notes": "...",                             # optional free text
      ...                                         # extra keys are preserved, never silently dropped
    }

Every field is validated on load; a malformed fixture raises :class:`FixtureError`
instead of degrading into a partially-trusted replay.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from ..prompts import PromptFormatError, UnknownPromptVersion, available_versions, load_prompt
from .client import RawGeneration

#: Default directory for real recordings (gitignored, see .gitignore).
RECORDED_FIXTURES_DIR = Path(__file__).resolve().parents[2] / "generation" / "fixtures" / "recorded"
#: Tracked, hand-authored fixtures used by the unit tests and the batch-size probe.
SYNTHETIC_FIXTURES_DIR = Path(__file__).resolve().parents[2] / "generation" / "fixtures" / "synthetic"

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_FIXTURE_NAME = re.compile(r"^batch-(\d{4})(?:-([a-z0-9_]+))?\.json$")
_REQUIRED_STR = ("recorded_at", "provider", "model", "model_version", "prompt_version", "prompt_hash", "raw_generation_id")


class FixtureError(ValueError):
    """A recorded fixture is missing, malformed, or does not match the request."""


@dataclass(frozen=True)
class RecordedResponse:
    """A recorded response plus the metadata that only the fixture knows."""

    raw_generation_id: str
    model: str
    model_version: str
    prompt_version: str
    prompt_hash: str
    decoding_parameters: Mapping[str, Any]
    output_text: str
    output_tokens: int
    input_tokens: int
    recorded_at: str
    provider: str
    fixture_path: Path
    batch_size: int | None = None
    prompt_sha256: str | None = None
    extra: Mapping[str, Any] | None = None

    def to_raw_generation(self) -> RawGeneration:
        return RawGeneration(
            raw_generation_id=self.raw_generation_id,
            model=self.model,
            model_version=self.model_version,
            prompt_version=self.prompt_version,
            prompt_hash=self.prompt_hash,
            decoding_parameters=dict(self.decoding_parameters),
            output_text=self.output_text,
            output_tokens=self.output_tokens,
            input_tokens=self.input_tokens,
        )


def _require_str(doc: Mapping[str, Any], key: str, path: Path) -> str:
    value = doc.get(key)
    if not isinstance(value, str) or not value:
        raise FixtureError(f"{path.name}: '{key}' must be a non-empty string, got {value!r}")
    return value


def _require_int(doc: Mapping[str, Any], key: str, path: Path) -> int:
    value = doc.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise FixtureError(f"{path.name}: '{key}' must be an integer >= 0, got {value!r}")
    return value


def load_recorded(fixture_path: Path) -> RecordedResponse:
    """Load and validate one recorded fixture. Raises :class:`FixtureError` on any problem."""
    path = Path(fixture_path)
    if not path.is_file():
        raise FixtureError(f"recorded fixture not found: {path}")
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise FixtureError(f"{path.name}: fixture is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(doc, dict):
        raise FixtureError(f"{path.name}: fixture must be a JSON object, got {type(doc).__name__}")

    for key in _REQUIRED_STR:
        _require_str(doc, key, path)
    if doc["provider"] != "replay":
        raise FixtureError(
            f"{path.name}: provider must be 'replay' in Phase 1, got {doc['provider']!r}"
        )
    if not _HEX64.match(doc["prompt_hash"]):
        raise FixtureError(f"{path.name}: 'prompt_hash' must be 64 lowercase hex characters")
    for key in ("output_tokens", "input_tokens"):
        _require_int(doc, key, path)

    decoding = doc.get("decoding_parameters")
    if not isinstance(decoding, dict):
        raise FixtureError(f"{path.name}: 'decoding_parameters' must be a JSON object")
    output_text = doc.get("output_text")
    if not isinstance(output_text, str):
        raise FixtureError(f"{path.name}: 'output_text' must be a string, got {type(output_text).__name__}")

    try:
        load_prompt(doc["prompt_version"])
    except (UnknownPromptVersion, PromptFormatError) as exc:
        raise FixtureError(f"{path.name}: prompt_version is not usable: {exc}") from exc

    batch_size = doc.get("batch_size")
    if batch_size is not None and (isinstance(batch_size, bool) or not isinstance(batch_size, int) or batch_size < 1):
        raise FixtureError(f"{path.name}: 'batch_size' must be an integer >= 1 when present")
    prompt_sha256 = doc.get("prompt_sha256")
    if prompt_sha256 is not None and not _HEX64.match(prompt_sha256):
        raise FixtureError(f"{path.name}: 'prompt_sha256' must be 64 lowercase hex characters when present")

    known = set(_REQUIRED_STR) | {
        "provider", "decoding_parameters", "output_text", "output_tokens", "input_tokens",
        "batch_size", "prompt_sha256", "notes",
    }
    extra = {key: value for key, value in doc.items() if key not in known}

    return RecordedResponse(
        raw_generation_id=doc["raw_generation_id"],
        model=doc["model"],
        model_version=doc["model_version"],
        prompt_version=doc["prompt_version"],
        prompt_hash=doc["prompt_hash"],
        decoding_parameters=decoding,
        output_text=output_text,
        output_tokens=doc["output_tokens"],
        input_tokens=doc["input_tokens"],
        recorded_at=doc["recorded_at"],
        provider=doc["provider"],
        fixture_path=path,
        batch_size=batch_size,
        prompt_sha256=prompt_sha256,
        extra=extra,
    )


class ReplayClient:
    """Phase 1 default client: replays a recorded response, performs no I/O but file reads."""

    provider = "replay"

    def __init__(self, fixture_dir: Path | str | None = None) -> None:
        self.fixture_dir = Path(fixture_dir) if fixture_dir is not None else RECORDED_FIXTURES_DIR

    # -- fixture access ---------------------------------------------------------
    def fixture_path(self, batch_size: int, *, fixture_class: str = "normal") -> Path:
        """Where the recording for ``(batch_size, fixture_class)`` is expected to live."""
        suffix = "" if fixture_class == "normal" else f"-{fixture_class}"
        return self.fixture_dir / f"batch-{batch_size:04d}{suffix}.json"

    def _fixture_candidates(self, batch_size: int, fixture_class: str) -> list[Path]:
        """Candidate paths, in preference order.

        ``normal`` accepts either the bare ``batch-0008.json`` or the explicit
        ``batch-0008-normal.json``, so a directory that labels every recording with a
        class suffix works the same as one that leaves the normal batch bare.
        """
        if fixture_class == "normal":
            return [
                self.fixture_path(batch_size),
                self.fixture_dir / f"batch-{batch_size:04d}-normal.json",
            ]
        return [self.fixture_path(batch_size, fixture_class=fixture_class)]

    def available(self) -> tuple[int, ...]:
        """Batch sizes that have at least one recorded fixture, ascending."""
        sizes: set[int] = set()
        if not self.fixture_dir.is_dir():
            return ()
        for path in sorted(self.fixture_dir.glob("batch-*.json")):
            match = _FIXTURE_NAME.match(path.name)
            if match is not None:
                sizes.add(int(match.group(1)))
        return tuple(sorted(sizes))

    def load_recorded(self, batch_size: int, *, fixture_class: str = "normal") -> RecordedResponse:
        candidates = self._fixture_candidates(batch_size, fixture_class)
        for path in candidates:
            if path.is_file():
                return load_recorded(path)
        raise FixtureError(
            f"recorded fixture not found for batch_size={batch_size} class='{fixture_class}': "
            + " | ".join(str(path) for path in candidates)
        )

    # -- WorldSeedClient --------------------------------------------------------
    def generate(self, prompt: str, *, batch_size: int, max_output_tokens: int) -> RawGeneration:
        if isinstance(batch_size, bool) or not isinstance(batch_size, int) or batch_size < 1:
            raise FixtureError(f"batch_size must be an integer >= 1, got {batch_size!r}")
        if isinstance(max_output_tokens, bool) or not isinstance(max_output_tokens, int) or max_output_tokens < 1:
            raise FixtureError(f"max_output_tokens must be an integer >= 1, got {max_output_tokens!r}")
        recorded = self.load_recorded(batch_size)
        if recorded.batch_size is not None and recorded.batch_size != batch_size:
            raise FixtureError(
                f"{recorded.fixture_path.name}: fixture records batch_size={recorded.batch_size}, "
                f"requested {batch_size}"
            )
        if recorded.prompt_sha256 is not None:
            actual = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
            if actual != recorded.prompt_sha256:
                raise FixtureError(
                    f"{recorded.fixture_path.name}: fixture was recorded against a different prompt "
                    f"(expected sha256 {recorded.prompt_sha256}, got {actual})"
                )
        return recorded.to_raw_generation()


def fixture_files(fixture_dir: Path | str) -> list[Path]:
    """Every recorded fixture in a directory, in a deterministic order."""
    directory = Path(fixture_dir)
    if not directory.is_dir():
        return []
    return sorted(path for path in directory.glob("batch-*.json") if _FIXTURE_NAME.match(path.name))


def registered_prompt_versions() -> tuple[str, ...]:
    """Prompt versions the replay fixtures may reference."""
    return available_versions()


__all__ = [
    "RECORDED_FIXTURES_DIR",
    "SYNTHETIC_FIXTURES_DIR",
    "FixtureError",
    "RecordedResponse",
    "ReplayClient",
    "fixture_files",
    "load_recorded",
    "registered_prompt_versions",
]
