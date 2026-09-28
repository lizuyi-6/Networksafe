"""Step-5-pre client interface, the raw-generation record, and the live-client refusal.

Phase 1 boundary (design §11.5): ``provider`` is ALWAYS ``replay``. This module holds
the *interface* a live client would implement plus the record type every client
returns. The live implementation itself is deliberately absent:

* :class:`Step5Client` raises :class:`NotImplementedError` on construction, so no call
  path — not even an accidental import-time one — can reach a network.
* no API key, base URL, model name or endpoint is hardcoded anywhere in this package;
  a Phase 2 live client must be opted in explicitly with an audit record
  (``configs/default.json`` ``generation.$comment``).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Mapping, Protocol, runtime_checkable

#: Phase 1 only ever replays. Kept as a constant so a future live path has to name it.
PHASE = 1
LIVE_PROVIDER_PHASE = 2


@dataclass(frozen=True)
class RawGeneration:
    """One raw model response, exactly as the client returned it.

    ``output_text`` is never normalised, trimmed or repaired here: the parser is the
    only component allowed to look inside it, and it rejects rather than fixes.
    ``output_tokens`` is what the call cost (from the provider, or recorded in a
    replay fixture) — it is the denominator of the Generation Efficiency metric, so it
    is never estimated silently.
    """

    raw_generation_id: str
    model: str
    model_version: str
    prompt_version: str
    prompt_hash: str
    decoding_parameters: Mapping[str, Any]
    output_text: str
    output_tokens: int
    input_tokens: int

    def to_document(self) -> dict:
        return {
            "raw_generation_id": self.raw_generation_id,
            "model": self.model,
            "model_version": self.model_version,
            "prompt_version": self.prompt_version,
            "prompt_hash": self.prompt_hash,
            "decoding_parameters": dict(self.decoding_parameters),
            "output_tokens": self.output_tokens,
            "input_tokens": self.input_tokens,
            "output_text_sha256": _sha256(self.output_text),
            "output_text_length": len(self.output_text),
        }


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@runtime_checkable
class WorldSeedClient(Protocol):
    """The only thing the generation pipeline knows about a model provider."""

    def generate(self, prompt: str, *, batch_size: int, max_output_tokens: int) -> RawGeneration:
        """Return one raw batch response for ``prompt``.

        Implementations must not post-process ``output_text`` and must not raise on a
        malformed response: a corrupt batch is data, and the parser decides its fate.
        """
        ...


class Step5Client:
    """NOT IMPLEMENTED — the live Step-5-pre provider client (Phase 2).

    Design §11.5: "Step5Client 标注 NOT IMPLEMENTED，Phase 1 不得被调用". The class
    exists so the interface is visible and so a Phase 2 implementation has an obvious
    home; constructing it fails immediately, which is the only way to guarantee that
    no test, script or accident can turn Phase 1 into a network caller.

    A Phase 2 implementation must take its credentials from the environment (never a
    literal), must be gated behind an explicit opt-in plus an audit record, and must
    still return an unmodified :class:`RawGeneration`.
    """

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        raise NotImplementedError(
            "Step5Client is NOT IMPLEMENTED in Phase 1 (design §11.5): the provider is "
            "always 'replay' and no test may open a network connection. Use "
            "generation.step5.replay.ReplayClient with a recorded fixture. A live "
            f"provider is Phase {LIVE_PROVIDER_PHASE} and requires explicit opt-in plus an audit record."
        )

    def generate(self, prompt: str, *, batch_size: int, max_output_tokens: int) -> RawGeneration:  # pragma: no cover
        raise NotImplementedError("Step5Client is NOT IMPLEMENTED in Phase 1 (design §11.5)")


@dataclass(frozen=True)
class ClientInfo:
    """Identity of the client that produced a batch, for provenance and GE rows."""

    provider: str
    model: str
    model_version: str


def describe_client(client: object) -> ClientInfo:
    """Best-effort client identity. Unknown clients are reported as 'unknown', never guessed."""
    model = getattr(client, "model", None)
    model_version = getattr(client, "model_version", None)
    if isinstance(model, str) and isinstance(model_version, str):
        provider = getattr(client, "provider", "replay")
        return ClientInfo(provider=str(provider), model=model, model_version=model_version)
    return ClientInfo(provider="unknown", model="unknown", model_version="unknown")


__all__ = [
    "PHASE",
    "LIVE_PROVIDER_PHASE",
    "ClientInfo",
    "RawGeneration",
    "Step5Client",
    "WorldSeedClient",
    "describe_client",
]
