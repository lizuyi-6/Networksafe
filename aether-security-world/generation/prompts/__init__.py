"""Generator prompt registry: prompt_version -> (text, output frame, hash).

The output frame (strict JSON array vs JSONL) is pinned by the prompt version
(design §11.1), so the parser never has to guess what a recorded batch looks like.
"""
from __future__ import annotations

from .registry import (
    DEFAULT_PROMPT_VERSION,
    OUTPUT_FORMATS,
    PROMPTS_DIR,
    PROJECT_ROOT,
    PromptFormatError,
    PromptSpec,
    UnknownPromptVersion,
    available_versions,
    decoding_defaults,
    load_prompt,
    output_format_for,
    resolve_prompt_hash,
)

__all__ = [
    "DEFAULT_PROMPT_VERSION",
    "OUTPUT_FORMATS",
    "PROMPTS_DIR",
    "PROJECT_ROOT",
    "PromptFormatError",
    "PromptSpec",
    "UnknownPromptVersion",
    "available_versions",
    "decoding_defaults",
    "load_prompt",
    "output_format_for",
    "resolve_prompt_hash",
]
