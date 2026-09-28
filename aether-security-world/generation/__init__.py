"""Aether Security World — L7 generation layer (Step-5-pre world seeds).

This package builds the *capability* to generate world seeds with a batch LLM call.
Phase 1 boundary (design §11.5, §14-4):

* the provider is always ``replay`` — :class:`~generation.step5.replay.ReplayClient`
  reads recorded responses from disk and performs no network I/O;
* :class:`~generation.step5.client.Step5Client` (the live client) is NOT IMPLEMENTED
  and refuses to be constructed;
* no API key, endpoint or model id is hardcoded anywhere in this package;
* the 500-world scale run is a separate, separately-budgeted activity — what exists
  here is the parser, the provenance stamping, the token accounting and the batch-size
  stability probe.

Module map::

    generation/prompts/    prompt_version -> (text, output frame, prompt_hash)
    generation/step5/      client interface, RawGeneration, ReplayClient, Step5Client(NOT IMPLEMENTED)
    generation/parser/     strict JSON/JSONL frame decoding + parse_world_specs
    generation/provenance/ harness-owned provenance stamping (closed key set)
    generation/stats/      token accounting, Generation Efficiency, batch-size probe
    generation/fixtures/   recorded/ (gitignored real recordings) + synthetic/ (tracked probe fixtures)

What is deliberately NOT here: any label. ``parse_world_specs`` validates structure and
stamps provenance; ground truth stays with ``security_world/oracle`` (design I-1).
"""
from __future__ import annotations

from .parser import (
    BATCH_REASONS,
    ELEMENT_REASONS,
    ParseResult,
    Rejection,
    SpecConversionError,
    parse_world_specs,
    strict,
)
from .prompts import (
    DEFAULT_PROMPT_VERSION,
    OUTPUT_FORMATS,
    PROMPTS_DIR,
    PromptFormatError,
    PromptSpec,
    UnknownPromptVersion,
    available_versions,
    decoding_defaults,
    load_prompt,
    output_format_for,
    resolve_prompt_hash,
)
from .provenance import (
    HARNESS_OWNED_KEYS,
    PROVENANCE_KEYS,
    ProvenanceError,
    STEP5_SEED_ORIGIN,
    build_provenance,
    stamp_provenance,
    verify_provenance_keys,
)
from .schema_registry import SCHEMAS_DIR, build_registry, world_spec_validator
from .stats import GenerationStats, generation_efficiency
from .stats.probe import default_sizes, efficiency_table, probe_batch_stability
from .step5 import (
    LIVE_PROVIDER_PHASE,
    RECORDED_FIXTURES_DIR,
    SYNTHETIC_FIXTURES_DIR,
    ClientInfo,
    FixtureError,
    RawGeneration,
    RecordedResponse,
    ReplayClient,
    Step5Client,
    WorldSeedClient,
    load_recorded,
)

__all__ = [
    "BATCH_REASONS",
    "DEFAULT_PROMPT_VERSION",
    "ELEMENT_REASONS",
    "HARNESS_OWNED_KEYS",
    "LIVE_PROVIDER_PHASE",
    "OUTPUT_FORMATS",
    "PROMPTS_DIR",
    "PROVENANCE_KEYS",
    "RECORDED_FIXTURES_DIR",
    "SCHEMAS_DIR",
    "SYNTHETIC_FIXTURES_DIR",
    "STEP5_SEED_ORIGIN",
    "ClientInfo",
    "FixtureError",
    "GenerationStats",
    "ParseResult",
    "PromptFormatError",
    "PromptSpec",
    "ProvenanceError",
    "RawGeneration",
    "ReplayClient",
    "RecordedResponse",
    "Rejection",
    "SpecConversionError",
    "Step5Client",
    "UnknownPromptVersion",
    "WorldSeedClient",
    "available_versions",
    "build_provenance",
    "build_registry",
    "decoding_defaults",
    "default_sizes",
    "efficiency_table",
    "generation_efficiency",
    "load_prompt",
    "load_recorded",
    "output_format_for",
    "parse_world_specs",
    "probe_batch_stability",
    "resolve_prompt_hash",
    "stamp_provenance",
    "strict",
    "verify_provenance_keys",
    "world_spec_validator",
]
