"""Per-record generator provenance (design §11.3, brief §20).

Every AI-generated world seed carries::

    generator_model, generator_model_version, generation_timestamp,
    prompt_version, prompt_hash, raw_generation_id, decoding_parameters,
    validation_outcome

The key point of this module is **who owns those fields**. A model cannot know its own
``prompt_hash``, the harness's ``raw_generation_id``, or whether its output passed
validation, so the provenance block of a generated spec is *harness-owned*: the parser
replaces it wholesale with values taken from the :class:`~generation.step5.client.RawGeneration`
record. A model that emits its own provenance block has it discarded (and that is
counted and reported, never silent).

The stamped key set is closed and equals the ``provenance`` object allowed by
``schemas/world-spec.schema.json``. This is the spec-side mirror of the closed
``generator_provenance`` whitelist on the episode side (design §5.1/B7): an AI
hypothesis must not be able to ride into a release inside a provenance field.

``generation_timestamp`` is a VirtualClock-derived value (design §8.1) — this module
never reads the wall clock. The caller passes it in; if nobody does and the element does
not carry one either, the element is rejected rather than stamped with an invented time.
"""
from __future__ import annotations

from typing import Any, Mapping

from ..step5.client import RawGeneration

#: Closed key set, in the order ``schemas/world-spec.schema.json`` declares them.
PROVENANCE_KEYS: tuple[str, ...] = (
    "origin",
    "generator_model",
    "generator_model_version",
    "prompt_version",
    "prompt_hash",
    "generation_timestamp",
    "raw_generation_id",
    "decoding_parameters",
    "validation_outcome",
)

#: Keys the harness always overwrites, whatever the model claimed.
HARNESS_OWNED_KEYS: tuple[str, ...] = (
    "origin",
    "generator_model",
    "generator_model_version",
    "prompt_version",
    "prompt_hash",
    "raw_generation_id",
    "decoding_parameters",
    "validation_outcome",
)

#: ``origin`` value for a Step-5-pre generated seed (schema enum).
STEP5_SEED_ORIGIN = "step5_seed"

VALIDATION_OUTCOMES = ("accepted", "rejected", "pending")


class ProvenanceError(ValueError):
    """A provenance record is unusable (missing harness fields, wrong types)."""


def build_provenance(
    raw: RawGeneration,
    *,
    generation_timestamp: str,
    validation_outcome: str = "accepted",
) -> dict[str, Any]:
    """Build the authoritative provenance block for one generated record.

    Raises :class:`ProvenanceError` when the raw record cannot support an auditable
    provenance entry (non-string model/version, empty prompt hash, ...). Nothing is
    defaulted: a record we cannot describe is a record we must not accept.
    """
    if validation_outcome not in VALIDATION_OUTCOMES:
        raise ProvenanceError(f"validation_outcome must be one of {list(VALIDATION_OUTCOMES)}")
    if not isinstance(generation_timestamp, str) or not generation_timestamp:
        raise ProvenanceError("generation_timestamp must be a non-empty VirtualClock string")
    for field in ("model", "model_version", "prompt_version", "prompt_hash", "raw_generation_id"):
        value = getattr(raw, field)
        if not isinstance(value, str) or not value:
            raise ProvenanceError(f"raw.{field} must be a non-empty string, got {value!r}")
    if not isinstance(raw.decoding_parameters, Mapping):
        raise ProvenanceError("raw.decoding_parameters must be a mapping")

    return {
        "origin": STEP5_SEED_ORIGIN,
        "generator_model": raw.model,
        "generator_model_version": raw.model_version,
        "prompt_version": raw.prompt_version,
        "prompt_hash": raw.prompt_hash,
        "generation_timestamp": generation_timestamp,
        "raw_generation_id": raw.raw_generation_id,
        "decoding_parameters": dict(raw.decoding_parameters),
        "validation_outcome": validation_outcome,
    }


def stamp_provenance(
    document: Mapping[str, Any],
    raw: RawGeneration,
    *,
    generation_timestamp: str,
    validation_outcome: str = "accepted",
) -> tuple[dict[str, Any], bool]:
    """Return ``(new_document, model_provenance_replaced)``.

    The input document is never mutated (design D6: no implicit coercion, no in-place
    edits of parsed data). Any ``provenance`` block the model emitted is discarded and
    reported through the second return value.
    """
    provenance = build_provenance(
        raw, generation_timestamp=generation_timestamp, validation_outcome=validation_outcome
    )
    replaced = isinstance(document, Mapping) and "provenance" in document
    stamped = dict(document)
    stamped["provenance"] = provenance
    return stamped, replaced


def element_timestamp(document: Mapping[str, Any]) -> str | None:
    """The model-emitted ``provenance.generation_timestamp``, if it is a usable string.

    Only consulted when the caller supplied no timestamp of its own; the parser records
    a warning whenever this path is taken, so a hallucinated timestamp is visible in the
    audit trail instead of quietly landing in a release.
    """
    if not isinstance(document, Mapping):
        return None
    provenance = document.get("provenance")
    if not isinstance(provenance, Mapping):
        return None
    value = provenance.get("generation_timestamp")
    return value if isinstance(value, str) and value else None


def verify_provenance_keys(provenance: Mapping[str, Any]) -> list[str]:
    """Closed-key check: a provenance block may carry only :data:`PROVENANCE_KEYS`."""
    if not isinstance(provenance, Mapping):
        return ["provenance is not an object"]
    return [f"unexpected provenance key '{key}'" for key in sorted(set(provenance) - set(PROVENANCE_KEYS))]


def provenance_mismatch_warnings(raw: RawGeneration, *, registered_prompt_hash: str | None = None) -> list[str]:
    """Audit signals (never fatal, never silent) about a raw record's provenance claims."""
    warnings: list[str] = []
    if registered_prompt_hash is not None and raw.prompt_hash != registered_prompt_hash:
        warnings.append(
            "prompt_hash_mismatch_registered_prompt: raw claims "
            f"{raw.prompt_hash}, registered prompt v{raw.prompt_version} hashes to {registered_prompt_hash}"
        )
    return warnings


__all__ = [
    "HARNESS_OWNED_KEYS",
    "PROVENANCE_KEYS",
    "ProvenanceError",
    "STEP5_SEED_ORIGIN",
    "VALIDATION_OUTCOMES",
    "build_provenance",
    "element_timestamp",
    "provenance_mismatch_warnings",
    "stamp_provenance",
    "verify_provenance_keys",
]
