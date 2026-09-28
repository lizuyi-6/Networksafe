"""Phase 2A 验证器包（brief §32 / §35-§36）。"""

from __future__ import annotations

from .verify import (
    SEMANTIC_CLASSES,
    AxisOutcome,
    ExpectationContradiction,
    VerificationReport,
    verify_compiled_world,
)

__all__ = [
    "SEMANTIC_CLASSES",
    "AxisOutcome",
    "ExpectationContradiction",
    "VerificationReport",
    "verify_compiled_world",
]
