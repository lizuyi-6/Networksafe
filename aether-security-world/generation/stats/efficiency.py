"""Token accounting and the Generation Efficiency metric (brief §19, design §11.4).

Four numbers must be recorded for every generation run (brief §19)::

    output_tokens, valid_worlds, rejected_worlds, valid_worlds_per_1k_tokens

and the derived indicator is::

    GE = accepted_unique_worlds / output_tokens * 1000

``output_tokens`` is the number the provider charged (or the number a replay fixture
recorded). It is never estimated here: a silently estimated denominator would make the
one metric that decides the batch size meaningless. If a caller has no token count, it
has no GE — :func:`generation_efficiency` raises rather than inventing one.
"""
from __future__ import annotations

from dataclasses import dataclass


def _require_count(value: object, name: str) -> int:
    # bool is an int subclass; a boolean slipping into a token count is a type bug, not a value.
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int, got {type(value).__name__}")
    if value < 0:
        raise ValueError(f"{name} must be >= 0, got {value}")
    return value


def generation_efficiency(accepted_unique_worlds: int, output_tokens: int) -> float:
    """``accepted_unique_worlds / output_tokens * 1000`` (design §11.4).

    ``output_tokens <= 0`` raises: with no tokens spent there is no efficiency to report,
    and returning 0.0 would read as "the run produced nothing" when the truth is "the run
    was not measured".
    """
    worlds = _require_count(accepted_unique_worlds, "accepted_unique_worlds")
    tokens = _require_count(output_tokens, "output_tokens")
    if tokens == 0:
        raise ValueError("output_tokens must be > 0 to compute a Generation Efficiency value")
    return worlds / tokens * 1000.0


@dataclass(frozen=True)
class GenerationStats:
    """Token and yield accounting for one parsed batch."""

    output_tokens: int
    input_tokens: int
    elements_decoded: int
    valid_worlds: int
    rejected_worlds: int
    duplicate_world_ids: int
    batch_rejected: bool
    model_provenance_replaced: int = 0

    def __post_init__(self) -> None:
        for name in (
            "output_tokens",
            "input_tokens",
            "elements_decoded",
            "valid_worlds",
            "rejected_worlds",
            "duplicate_world_ids",
            "model_provenance_replaced",
        ):
            _require_count(getattr(self, name), name)

    @property
    def valid_worlds_per_1k_tokens(self) -> float:
        """Generation Efficiency for this batch (raises when no tokens were recorded)."""
        return generation_efficiency(self.valid_worlds, self.output_tokens)

    def to_document(self) -> dict:
        return {
            "output_tokens": self.output_tokens,
            "input_tokens": self.input_tokens,
            "elements_decoded": self.elements_decoded,
            "valid_worlds": self.valid_worlds,
            "rejected_worlds": self.rejected_worlds,
            "duplicate_world_ids": self.duplicate_world_ids,
            "model_provenance_replaced": self.model_provenance_replaced,
            "batch_rejected": self.batch_rejected,
            "valid_worlds_per_1k_tokens": (
                self.valid_worlds_per_1k_tokens if self.output_tokens > 0 else None
            ),
        }

    def generator_model_entry(self, *, model: str, model_version: str, provider: str = "replay") -> dict:
        """One ``release.schema.json`` ``generator_models[]`` row.

        ``provider`` is 'replay' or 'live' so a frozen release can tell recorded
        throughput from real throughput (design §11.3).
        """
        if provider not in ("replay", "live"):
            raise ValueError(f"provider must be 'replay' or 'live', got {provider!r}")
        return {
            "model": model,
            "model_version": model_version,
            "world_count": self.valid_worlds,
            "output_tokens": self.output_tokens,
            "valid_worlds_per_1k_tokens": (
                self.valid_worlds_per_1k_tokens if self.output_tokens > 0 else 0
            ),
            "provider": provider,
        }


__all__ = ["GenerationStats", "generation_efficiency"]
