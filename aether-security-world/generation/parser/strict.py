"""Strict JSON / JSONL decoding for recorded model output.

The frame decoder is the first line of defence of the generation boundary. Its rules:

1. **RFC 8259 strictness.** No trailing commas, no comments, no single-quoted strings,
   no ``NaN``/``Infinity``, no control characters inside strings, exactly one document
   per call (trailing content is an error, not something to skip past).
2. **No silent key collapsing.** Python's ``json`` keeps the *last* value of a
   duplicated object key. For a contract document that is a silent repair — a model (or
   an adversary) could emit ``{"world_id": "W-1", "world_id": "W-2"}`` and have the
   first value vanish. Duplicate keys are therefore a hard error.
3. **Truncation is reported as truncation.** A decode that ran out of input is
   classified :data:`REASON_TRUNCATED` (with the decoder's own message and position
   kept in ``detail``), so the batch-size probe can tell "the model stopped mid-array"
   apart from "the model emitted garbage".

Nothing is ever repaired, trimmed, completed or best-effort parsed: every failure raises
:class:`StrictJsonError` carrying a machine-readable reason, and the caller rejects the
whole batch.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

REASON_TRUNCATED = "batch_truncated"
REASON_UNDECODABLE = "batch_undecodable_json"
REASON_DUPLICATE_KEY = "batch_duplicate_key"
REASON_NON_FINITE = "batch_non_finite_constant"
REASON_LINE_UNDECODABLE = "batch_line_undecodable"
REASON_NOT_AN_ARRAY = "batch_not_an_array"
REASON_EMPTY = "batch_empty"


class StrictJsonError(ValueError):
    """The output frame could not be decoded strictly. The batch is rejected wholesale."""

    def __init__(self, reason: str, detail: str, *, line: int | None = None, position: int | None = None) -> None:
        self.reason = reason
        self.detail = detail
        self.line = line
        self.position = position
        location = "" if line is None else f" (line {line})"
        super().__init__(f"{reason}{location}: {detail}")


@dataclass(frozen=True)
class JsonlEntry:
    """One decoded JSONL record with its 1-based line number."""

    line: int
    value: Any


def _object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: dict[str, Any] = {}
    for key, value in pairs:
        if key in seen:
            raise StrictJsonError(
                REASON_DUPLICATE_KEY,
                f"duplicate object key '{key}' (first value {seen[key]!r}, then {value!r}) - "
                "JSON objects in a world-spec batch must have unique keys, otherwise the last "
                "value silently wins",
            )
        seen[key] = value
    return dict(pairs)


def _reject_constant(name: str) -> Any:
    raise StrictJsonError(REASON_NON_FINITE, f"'{name}' is not valid JSON (RFC 8259 has no NaN/Infinity literals)")


def _classify_decode_error(exc: json.JSONDecodeError, text: str) -> str:
    """Distinguish 'ran out of input' from 'emitted something unparseable'."""
    stripped = text.rstrip()
    message = exc.msg
    if message.startswith("Unterminated"):
        return REASON_TRUNCATED
    if exc.pos >= len(stripped) and stripped and stripped[-1] in "{[,:\"'":
        return REASON_TRUNCATED
    if exc.pos >= len(stripped) and message.startswith("Expecting"):
        return REASON_TRUNCATED
    return REASON_UNDECODABLE


def loads_strict(text: str) -> Any:
    """Decode exactly one JSON document. Raises :class:`StrictJsonError` on any problem."""
    if not isinstance(text, str):
        raise StrictJsonError(REASON_UNDECODABLE, f"expected str, got {type(text).__name__}")
    try:
        return json.loads(
            text,
            object_pairs_hook=_object_pairs,
            parse_constant=_reject_constant,
        )
    except json.JSONDecodeError as exc:
        raise StrictJsonError(
            _classify_decode_error(exc, text),
            f"{exc.msg} at char {exc.pos}",
            position=exc.pos,
        ) from exc
    except StrictJsonError:
        raise
    except RecursionError as exc:  # pathologically nested input
        raise StrictJsonError(REASON_UNDECODABLE, f"input nesting exceeded the decoder limit: {exc}") from exc


def loads_strict_array(text: str) -> list[Any]:
    """Decode a strict JSON array (the frame pinned by prompt v0.1)."""
    value = loads_strict(text)
    if not isinstance(value, list):
        raise StrictJsonError(
            REASON_NOT_AN_ARRAY,
            f"top-level value must be a JSON array of world specs, got {type(value).__name__}",
        )
    return value


def loads_jsonl(text: str) -> list[JsonlEntry]:
    """Decode JSONL: one JSON value per non-blank line, in order.

    Blank (whitespace-only) lines carry no data and are skipped; every other line must
    be exactly one JSON document. A line that is not decodable fails the whole batch —
    there is no "skip the bad line and keep the rest", because a frame we cannot fully
    decode is a frame we cannot trust.
    """
    if not isinstance(text, str):
        raise StrictJsonError(REASON_UNDECODABLE, f"expected str, got {type(text).__name__}")
    entries: list[JsonlEntry] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(
                line,
                object_pairs_hook=_object_pairs,
                parse_constant=_reject_constant,
            )
        except json.JSONDecodeError as exc:
            raise StrictJsonError(
                _classify_decode_error(exc, line),
                f"{exc.msg} at char {exc.pos}",
                line=number,
                position=exc.pos,
            ) from exc
        except StrictJsonError as exc:
            raise StrictJsonError(exc.reason, exc.detail, line=number) from exc
        entries.append(JsonlEntry(line=number, value=value))
    return entries


__all__ = [
    "REASON_DUPLICATE_KEY",
    "REASON_EMPTY",
    "REASON_LINE_UNDECODABLE",
    "REASON_NON_FINITE",
    "REASON_NOT_AN_ARRAY",
    "REASON_TRUNCATED",
    "REASON_UNDECODABLE",
    "JsonlEntry",
    "StrictJsonError",
    "loads_jsonl",
    "loads_strict",
    "loads_strict_array",
]
