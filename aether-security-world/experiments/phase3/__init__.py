"""Phase 3 experiment package (Paper B, ASW v0.1, master brief PART III)."""
from .contract import (
    Method,
    Usage,
    Verdict,
    assert_split_allowed,
    DATA_USAGE_POLICY,
    SplitPolicyError,
)
from .renderer import RENDERER_ID, SYSTEM_PROMPT, audit_prompt_leakage, build_prompt, render_m1, render_m2, target_for, target_text

__all__ = [
    "Method",
    "Usage",
    "Verdict",
    "SplitPolicyError",
    "assert_split_allowed",
    "DATA_USAGE_POLICY",
    "RENDERER_ID",
    "SYSTEM_PROMPT",
    "audit_prompt_leakage",
    "build_prompt",
    "render_m1",
    "render_m2",
    "target_for",
    "target_text",
]
