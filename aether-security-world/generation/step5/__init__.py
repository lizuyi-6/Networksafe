"""Step-5-pre client boundary: the interface, the raw record, and the replay adapter.

Phase 1 has exactly one working client — :class:`ReplayClient`, which performs no
network I/O. :class:`Step5Client` is the declared-but-unimplemented live client and
refuses to be constructed (design §11.5).
"""
from __future__ import annotations

from .client import (
    LIVE_PROVIDER_PHASE,
    PHASE,
    ClientInfo,
    RawGeneration,
    Step5Client,
    WorldSeedClient,
    describe_client,
)
from .replay import (
    RECORDED_FIXTURES_DIR,
    SYNTHETIC_FIXTURES_DIR,
    FixtureError,
    RecordedResponse,
    ReplayClient,
    fixture_files,
    load_recorded,
    registered_prompt_versions,
)

__all__ = [
    "LIVE_PROVIDER_PHASE",
    "PHASE",
    "RECORDED_FIXTURES_DIR",
    "SYNTHETIC_FIXTURES_DIR",
    "ClientInfo",
    "FixtureError",
    "RawGeneration",
    "RecordedResponse",
    "ReplayClient",
    "Step5Client",
    "WorldSeedClient",
    "describe_client",
    "fixture_files",
    "load_recorded",
    "registered_prompt_versions",
]
