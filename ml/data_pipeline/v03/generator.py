"""Generator: realizes a detectionInput+detectionOutput from a GenerationSpec via the LLM.

The LLM does NOT decide labels - it copies the spec's immutable labels verbatim and only
realizes a realistic request honoring the context axes. The generator runs deterministic_checks
on its own output and retries (higher temperature) on failure before returning, so the reviewer
budget is not spent on structurally broken candidates (mission §33).
"""
from __future__ import annotations
import json
from dataclasses import dataclass
from typing import Any

from . import config
from .provider import LLMProvider, load_provider_config
from .deterministic_checks import CheckResult, check as det_check
from .llm_call import load_prompt, parse_json_lenient
from .generation_spec import GenerationSpec

_PROMPT_NAME = "request-realizer.md"


@dataclass
class GenerationResult:
    sample_id: str
    spec_hash: str
    candidate: dict[str, Any] | None  # {detectionInput, detectionOutput} or None on hard failure
    det_check: CheckResult
    attempts: int
    latency: float
    error: str | None  # None iff candidate passed det_check

    @property
    def ok(self) -> bool:
        return self.candidate is not None and self.det_check.ok


class Generator:
    def __init__(self, provider: LLMProvider | None = None, max_attempts: int = 2):
        self.provider = provider or LLMProvider(load_provider_config(config.ROLE_GENERATOR))
        self.max_attempts = max_attempts
        self._prompt = load_prompt(_PROMPT_NAME)

    async def generate(self, spec: GenerationSpec) -> GenerationResult:
        spec_dict = spec.to_dict()
        user = json.dumps(spec_dict, ensure_ascii=False)
        # thinking is disabled (provider config) -> no reasoning headroom needed; budget for
        # the realized request + output JSON. Long-context samples still get headroom.
        max_tok = min(6000, max(2048, int(spec.targetLengthTokens) + 1500))

        last_candidate: dict | None = None
        last_check = CheckResult.fail("not_run")
        last_error: str | None = None
        total_latency = 0.0

        for attempt in range(1, self.max_attempts + 1):
            temp = 0.2 + 0.15 * (attempt - 1)
            try:
                result = await self.provider.chat(
                    system=self._prompt, user=user,
                    max_tokens=max_tok, temperature=temp, response_format_json=True,
                )
            except Exception as e:
                # provider exhausted its own retries -> resumable failure (mission §45)
                last_error = f"provider_error:{type(e).__name__}:{str(e)[:120]}"
                break
            total_latency += result.latency
            candidate = parse_json_lenient(result.content)
            if candidate is None:
                last_error = "unparseable_generator_output"
                last_candidate = None
                continue
            last_candidate = candidate
            last_error = None
            last_check = det_check(spec_dict, candidate)
            if last_check.ok:
                return GenerationResult(
                    sample_id=spec.sampleId, spec_hash=spec.specHash,
                    candidate=candidate, det_check=last_check,
                    attempts=attempt, latency=total_latency, error=None,
                )
            # det-check failed -> retry with more entropy
        return GenerationResult(
            sample_id=spec.sampleId, spec_hash=spec.specHash,
            candidate=last_candidate, det_check=last_check,
            attempts=self.max_attempts, latency=total_latency,
            error=last_error or "det_check_failed",
        )


__all__ = ["Generator", "GenerationResult"]
