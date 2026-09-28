"""Batch parser: raw model output -> validated world-spec documents (design §11.2).

Two-tier rejection, deliberately explicit:

**Tier 1 — the frame.** The output must decode *perfectly* in the frame its
``prompt_version`` pins (strict JSON array for v0.1, JSONL for a JSONL prompt). A
truncated array, a stray byte, a duplicated key, a non-array top level, an empty batch:
the **whole batch is rejected**, ``specs`` comes back empty, and exactly one rejection
record carries a machine-readable reason. There is no partial salvage — a frame we
cannot fully decode is a frame we cannot trust, and "keep the elements that happened to
parse" is exactly the silent repair this project forbids.

**Tier 2 — the elements.** An element that decodes fine but fails
``schemas/world-spec.schema.json`` (or repeats a ``world_id`` already seen in the batch,
or is not a JSON object at all) is rejected *individually*, with its index, its
``world_id`` when readable, and the sorted schema error paths. The rest of the batch
survives. This is design §11.2 verbatim: "只接受能通过 world-spec.schema.json 的元素；
坏元素进 rejected/ 并记 reason code，不尝试修复".

What the parser never does: repair a value, coerce a type, drop an unknown key, re-order
anything to make it fit, or read the wall clock. Accepted elements come back as plain
JSON documents with a harness-owned ``provenance`` block stamped on; conversion to
``security_world.model.WorldSpec`` belongs to L1 (``security_world/model``, Agent A,
NOT IMPLEMENTED at the time of writing), which is why this module's element type is the
document form rather than that dataclass.

The return value is a :class:`ParseResult`, which also unpacks as the contract's
``(specs, rejections)`` pair::

    specs, rejections = parse_world_specs(raw)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from ..prompts import UnknownPromptVersion, load_prompt, resolve_prompt_hash
from ..provenance import element_timestamp, provenance_mismatch_warnings, stamp_provenance
from ..schema_registry import error_paths, world_spec_validator
from ..stats import GenerationStats
from ..step5.client import RawGeneration
from . import strict
from .strict import StrictJsonError

#: Reason codes a whole-batch (frame) rejection can carry.
BATCH_REASONS = frozenset({
    strict.REASON_TRUNCATED,
    strict.REASON_UNDECODABLE,
    strict.REASON_DUPLICATE_KEY,
    strict.REASON_NON_FINITE,
    strict.REASON_LINE_UNDECODABLE,
    strict.REASON_NOT_AN_ARRAY,
    strict.REASON_EMPTY,
    "unknown_prompt_version",
})

#: Reason codes a single-element rejection can carry.
ELEMENT_REASONS = frozenset({
    "element_not_an_object",
    "schema_violation",
    "duplicate_world_id",
    "missing_generation_timestamp",
    "missing_world_id",
})


@dataclass(frozen=True)
class Rejection:
    """One rejected batch or element, with the reason a human can act on."""

    kind: str  # "batch" | "element"
    reason: str
    detail: str
    element_index: int | None = None
    line: int | None = None
    world_id: str | None = None
    error_paths: tuple[str, ...] = ()

    def to_document(self) -> dict:
        return {
            "kind": self.kind,
            "reason": self.reason,
            "detail": self.detail,
            "element_index": self.element_index,
            "line": self.line,
            "world_id": self.world_id,
            "error_paths": list(self.error_paths),
        }


class SpecConversionError(ValueError):
    """A document the schema accepted was refused by ``security_world.model``.

    Raised only by :meth:`ParseResult.as_world_specs`. It means the two layers disagree
    about what a world spec is, which is a contract bug to surface, never to swallow.
    """


@dataclass(frozen=True)
class ParseResult:
    """The outcome of parsing one raw generation."""

    raw_generation_id: str
    prompt_version: str
    prompt_hash: str
    output_format: str
    specs: tuple[Mapping[str, Any], ...] = ()
    rejections: tuple[Rejection, ...] = ()
    warnings: tuple[str, ...] = ()
    stats: GenerationStats = field(
        default_factory=lambda: GenerationStats(
            output_tokens=0,
            input_tokens=0,
            elements_decoded=0,
            valid_worlds=0,
            rejected_worlds=0,
            duplicate_world_ids=0,
            batch_rejected=True,
        )
    )

    @property
    def batch_rejected(self) -> bool:
        return self.stats.batch_rejected

    @property
    def accepted_world_ids(self) -> tuple[str, ...]:
        return tuple(spec.get("world_id") for spec in self.specs if isinstance(spec.get("world_id"), str))

    def accepted_documents(self) -> list[dict]:
        """The accepted specs as plain JSON documents (deep-copied, safe to mutate)."""
        import copy

        return [copy.deepcopy(dict(spec)) for spec in self.specs]

    def as_world_specs(self) -> tuple[Any, ...]:
        """The accepted specs as ``security_world.model.WorldSpec`` objects (§15.3 element type).

        The parser itself stays at the L0 contract level: it validates against
        ``schemas/world-spec.schema.json`` and returns documents, which keeps L7
        independent of L1's dataclass API. This method is the explicit L7 -> L1 bridge for
        callers that want the typed form; it imports L1 lazily so importing
        ``generation`` never pulls the semantic kernel in, and it raises
        :class:`~generation.parser.world_specs.SpecConversionError` if L1 refuses a
        document the schema accepted (that disagreement is a contract bug, not something
        to paper over).
        """
        from security_world.model import WorldSpec  # package-level public API only (design §15.2)

        converted = []
        for spec in self.specs:
            try:
                converted.append(WorldSpec.from_document(spec))
            except Exception as exc:  # noqa: BLE001 - re-raised as a typed conversion error
                raise SpecConversionError(
                    f"world-spec document '{spec.get('world_id')}' passed world-spec.schema.json but "
                    f"security_world.model.WorldSpec.from_document refused it: {exc}"
                ) from exc
        return tuple(converted)

    def rejected_documents(self) -> list[dict]:
        return [rejection.to_document() for rejection in self.rejections]

    def to_document(self) -> dict:
        document = self.stats.to_document()
        document.update(
            {
                "raw_generation_id": self.raw_generation_id,
                "prompt_version": self.prompt_version,
                "prompt_hash": self.prompt_hash,
                "output_format": self.output_format,
                "batch_rejected": self.stats.batch_rejected,
                "accepted_world_ids": list(self.accepted_world_ids),
                "rejections": self.rejected_documents(),
                "warnings": list(self.warnings),
            }
        )
        return document

    def __iter__(self):
        """Unpack as the §15.3 contract pair: ``specs, rejections = parse_world_specs(raw)``."""
        yield list(self.specs)
        yield self.rejected_documents()


def _readable_world_id(element: Any) -> str | None:
    if isinstance(element, Mapping):
        value = element.get("world_id")
        if isinstance(value, str):
            return value
    return None


def _decode_frame(raw: RawGeneration, output_format: str) -> tuple[list[Any], list[Rejection]]:
    """Decode the output frame. Any failure is a whole-batch rejection."""
    if output_format == "json_array":
        try:
            return strict.loads_strict_array(raw.output_text), []
        except StrictJsonError as exc:
            return [], [Rejection(kind="batch", reason=exc.reason, detail=exc.detail)]
    if output_format == "jsonl":
        try:
            return [entry.value for entry in strict.loads_jsonl(raw.output_text)], []
        except StrictJsonError as exc:
            return [], [
                Rejection(kind="batch", reason=exc.reason, detail=exc.detail, line=exc.line)
            ]
    return [], [
        Rejection(
            kind="batch",
            reason="unknown_output_format",
            detail=f"prompt v{raw.prompt_version} pins unsupported output_format '{output_format}'",
        )
    ]


def _batch_rejection(
    raw: RawGeneration,
    *,
    prompt_version: str,
    prompt_hash: str,
    output_format: str,
    reason: str | None = None,
    detail: str = "",
    rejections: list[Rejection] | None = None,
    warnings: list[str] | None = None,
) -> ParseResult:
    """Build the whole-batch-rejected result. ``specs`` is empty by construction."""
    records = tuple(rejections) if rejections else (Rejection(kind="batch", reason=reason or "", detail=detail),)
    return ParseResult(
        raw_generation_id=raw.raw_generation_id,
        prompt_version=prompt_version,
        prompt_hash=prompt_hash,
        output_format=output_format,
        rejections=records,
        warnings=tuple(warnings or ()),
        stats=GenerationStats(
            output_tokens=raw.output_tokens,
            input_tokens=raw.input_tokens,
            elements_decoded=0,
            valid_worlds=0,
            rejected_worlds=0,
            duplicate_world_ids=0,
            batch_rejected=True,
        ),
    )


def parse_world_specs(
    raw: RawGeneration,
    *,
    generation_timestamp: str | None = None,
    schemas_dir: Path | None = None,
    prompts_dir: Path | None = None,
) -> ParseResult:
    """Parse one raw batch into validated world-spec documents.

    ``generation_timestamp`` is the VirtualClock value stamped into every accepted
    spec's provenance (design §8.1: never the wall clock). When it is omitted, an
    element's own ``provenance.generation_timestamp`` is used if present and a warning is
    recorded; an element with neither is rejected (``missing_generation_timestamp``)
    rather than stamped with an invented time.

    ``schemas_dir`` / ``prompts_dir`` exist so a test can point at its own contract
    fixtures; production callers leave them alone.
    """
    warnings: list[str] = []

    try:
        prompt = load_prompt(raw.prompt_version, prompts_dir=prompts_dir)
    except UnknownPromptVersion as exc:
        # Without the registered prompt we do not know which frame to expect, so we
        # cannot decode anything at all - reject the batch rather than guess.
        return _batch_rejection(
            raw,
            prompt_version=raw.prompt_version,
            prompt_hash=raw.prompt_hash,
            output_format="unknown",
            reason="unknown_prompt_version",
            detail=str(exc),
            warnings=warnings,
        )

    registered_hash = resolve_prompt_hash(raw.prompt_version, prompts_dir=prompts_dir)
    warnings.extend(provenance_mismatch_warnings(raw, registered_prompt_hash=registered_hash))

    if not raw.output_text.strip():
        # An all-whitespace response is "the model produced nothing", which would decode
        # as a JSON error; report it as the empty batch it is.
        return _batch_rejection(
            raw,
            prompt_version=raw.prompt_version,
            prompt_hash=raw.prompt_hash,
            output_format=prompt.output_format,
            reason=strict.REASON_EMPTY,
            detail="the response contains no JSON at all (empty or whitespace-only output)",
            warnings=warnings,
        )

    elements, rejections = _decode_frame(raw, prompt.output_format)
    if rejections:
        return _batch_rejection(
            raw,
            prompt_version=raw.prompt_version,
            prompt_hash=raw.prompt_hash,
            output_format=prompt.output_format,
            rejections=rejections,
            warnings=warnings,
        )
    if not elements:
        return _batch_rejection(
            raw,
            prompt_version=raw.prompt_version,
            prompt_hash=raw.prompt_hash,
            output_format=prompt.output_format,
            reason=strict.REASON_EMPTY,
            detail=(
                "output decoded to an empty batch - a generation that yields no worlds is a "
                "failed generation, not a zero-cost one"
            ),
            warnings=warnings,
        )

    validator = world_spec_validator(schemas_dir)
    accepted: list[Mapping[str, Any]] = []
    element_rejections: list[Rejection] = []
    seen_world_ids: dict[str, int] = {}
    duplicates = 0
    model_provenance_replaced = 0
    model_supplied_timestamps = 0

    for index, element in enumerate(elements):
        world_id = _readable_world_id(element)
        if not isinstance(element, dict):
            element_rejections.append(
                Rejection(
                    kind="element",
                    reason="element_not_an_object",
                    detail=f"element {index} is a {type(element).__name__}, not a world-spec object",
                    element_index=index,
                    world_id=world_id,
                )
            )
            continue
        if world_id is not None and world_id in seen_world_ids:
            duplicates += 1
            element_rejections.append(
                Rejection(
                    kind="element",
                    reason="duplicate_world_id",
                    detail=(
                        f"world_id '{world_id}' already appeared at element "
                        f"{seen_world_ids[world_id]}; world ids must be unique inside a batch"
                    ),
                    element_index=index,
                    world_id=world_id,
                )
            )
            continue
        if world_id is not None:
            seen_world_ids[world_id] = index

        timestamp = generation_timestamp
        if timestamp is None:
            timestamp = element_timestamp(element)
            if timestamp is not None:
                model_supplied_timestamps += 1
        if timestamp is None:
            element_rejections.append(
                Rejection(
                    kind="element",
                    reason="missing_generation_timestamp",
                    detail=(
                        "no generation_timestamp was supplied by the caller and the element "
                        "does not carry one; provenance timestamps are never invented"
                    ),
                    element_index=index,
                    world_id=world_id,
                )
            )
            continue

        stamped, replaced = stamp_provenance(element, raw, generation_timestamp=timestamp)
        if replaced:
            model_provenance_replaced += 1

        errors = sorted(validator.iter_errors(stamped), key=lambda error: list(error.absolute_path))
        if errors:
            element_rejections.append(
                Rejection(
                    kind="element",
                    reason="schema_violation",
                    detail=f"element {index} failed world-spec.schema.json with {len(errors)} error(s)",
                    element_index=index,
                    world_id=world_id,
                    error_paths=tuple(error_paths(errors)),
                )
            )
            continue
        accepted.append(stamped)

    if model_provenance_replaced:
        warnings.append(
            f"model_provenance_replaced: {model_provenance_replaced} element(s) carried their own "
            "provenance block; it was discarded and replaced with the harness record"
        )
    if model_supplied_timestamps:
        warnings.append(
            f"model_supplied_generation_timestamp: {model_supplied_timestamps} accepted element(s) "
            "used a model-emitted provenance.generation_timestamp because the caller supplied none"
        )

    stats = GenerationStats(
        output_tokens=raw.output_tokens,
        input_tokens=raw.input_tokens,
        elements_decoded=len(elements),
        valid_worlds=len(accepted),
        rejected_worlds=len(element_rejections),
        duplicate_world_ids=duplicates,
        batch_rejected=False,
        model_provenance_replaced=model_provenance_replaced,
    )
    return ParseResult(
        raw_generation_id=raw.raw_generation_id,
        prompt_version=raw.prompt_version,
        prompt_hash=raw.prompt_hash,
        output_format=prompt.output_format,
        specs=tuple(accepted),
        rejections=tuple(element_rejections),
        warnings=tuple(warnings),
        stats=stats,
    )


__all__ = [
    "BATCH_REASONS",
    "ELEMENT_REASONS",
    "ParseResult",
    "Rejection",
    "SpecConversionError",
    "parse_world_specs",
]
