"""Blind reviewer: independently classifies a detectionInput, seeing NO labels.

The reviewer sees ONLY {detectionInput}. It never sees the GenerationSpec, the expected labels,
the generator's reasoning, or the other reviewer's output. This independence is what makes
reviewer agreement a meaningful signal (mission §28-29).

The orchestrator instantiates two reviewers (A, B) and calls both concurrently per candidate.
"""
from __future__ import annotations
import json
from typing import Any

from . import config
from .provider import LLMProvider, load_provider_config
from .llm_call import load_prompt, parse_json_lenient

_PROMPT_NAME = "blind-reviewer.md"


class Reviewer:
    def __init__(self, label: str, provider: LLMProvider | None = None):
        self.label = label  # "A" or "B"
        self.provider = provider or LLMProvider(load_provider_config(config.ROLE_REVIEWER))
        self._prompt = load_prompt(_PROMPT_NAME)

    async def review(self, detection_input: dict[str, Any]) -> dict[str, Any]:
        """Return a detectionOutput dict, or {error: ...} on failure."""
        user = json.dumps({"detectionInput": detection_input}, ensure_ascii=False)
        try:
            result = await self.provider.chat(
                system=self._prompt, user=user,
                # reasoning_effort=high folds hidden reasoning into completion_tokens;
                # short verdict JSON (~80 tok) + reasoning headroom.
                max_tokens=12288, temperature=0.1, response_format_json=True,
            )
        except Exception as e:
            return {"error": f"provider_error:{type(e).__name__}", "detail": str(e)[:200]}
        out = parse_json_lenient(result.content)
        if out is None:
            return {"error": "unparseable_review_output", "raw": result.content[:200]}
        out["_reviewerLatency"] = round(result.latency, 3)
        out["_reviewerLabel"] = self.label
        return out


__all__ = ["Reviewer"]
