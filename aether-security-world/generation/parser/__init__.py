"""Strict batch parsing of recorded Step-5-pre output into world-spec documents."""
from __future__ import annotations

from . import strict
from .strict import (
    REASON_DUPLICATE_KEY,
    REASON_EMPTY,
    REASON_LINE_UNDECODABLE,
    REASON_NON_FINITE,
    REASON_NOT_AN_ARRAY,
    REASON_TRUNCATED,
    REASON_UNDECODABLE,
    JsonlEntry,
    StrictJsonError,
    loads_jsonl,
    loads_strict,
    loads_strict_array,
)
from .world_specs import (
    BATCH_REASONS,
    ELEMENT_REASONS,
    ParseResult,
    Rejection,
    SpecConversionError,
    parse_world_specs,
)

__all__ = [
    "BATCH_REASONS",
    "ELEMENT_REASONS",
    "JsonlEntry",
    "ParseResult",
    "REASON_DUPLICATE_KEY",
    "REASON_EMPTY",
    "REASON_LINE_UNDECODABLE",
    "REASON_NON_FINITE",
    "REASON_NOT_AN_ARRAY",
    "REASON_TRUNCATED",
    "REASON_UNDECODABLE",
    "Rejection",
    "SpecConversionError",
    "StrictJsonError",
    "loads_jsonl",
    "loads_strict",
    "loads_strict_array",
    "parse_world_specs",
    "strict",
]
