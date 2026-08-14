"""v0.3 LLM provider abstraction (Volcano Ark GLM-5.2, OpenAI-compatible).

Mission §42-43: provider abstraction with base_url/model/api_key from env; keys NEVER in config
files or committed. Default backend is Volcano Ark (ark.cn-beijing.volces.com) model glm-5.2 via
the `/api/plan/v3` OpenAI-compatible chat completions endpoint.

GLM-5.2 is a REASONING model: responses carry `message.reasoning_content` (internal thinking,
do NOT persist as the sample's reasoning - mission §34) separate from `message.content` (final
answer). Callers MUST set max_tokens generously (>=1024) or reasoning eats the whole budget and
content comes back empty.

Usage:
    cfg = load_provider_config("generator")
    provider = LLMProvider(cfg)
    result = await provider.chat(system=SYS, user=USR, max_tokens=2048)
    text = result.content  # final answer only
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass
from typing import Any

from openai import (
    AsyncOpenAI,
    APIError,
    RateLimitError,
    APITimeoutError,
    APIConnectionError,
    InternalServerError,
)

log = logging.getLogger("v03.provider")

DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"
DEFAULT_ARK_MODEL = "glm-5.2"

# Retryable: rate-limit, timeout, connection, 5xx. Other 4xx (auth/bad-request) are NOT retryable.
_RETRYABLE = (RateLimitError, APITimeoutError, APIConnectionError, InternalServerError, TimeoutError)


# --- Global token budget gate (audit 2026-08, ML-012) -----------------------
# The 5h rolling provider budget was a process constraint with no code gate; a
# runaway wave (max_waves x oversample) could spend without any hard stop. Set
# ARK_TOTAL_TOKEN_BUDGET (prompt+completion tokens, process lifetime) and every
# provider call checks it BEFORE hitting the network; exhaustion raises
# TokenBudgetExceeded, the orchestrator's producer stops feeding new specs, and
# the run ends resumably (audit log intact; raise the env to continue).
# Unset -> unlimited (legacy behaviour, still bounded by process discipline).
import threading as _threading

class TokenBudgetExceeded(RuntimeError):
    """Hard stop: the configured ARK_TOTAL_TOKEN_BUDGET is exhausted."""

_budget_total: int | None = None
_budget_used = 0
_budget_lock = _threading.Lock()
_budget_announced = False


def _init_budget() -> None:
    global _budget_total
    raw = os.environ.get("ARK_TOTAL_TOKEN_BUDGET", "").strip()
    if not raw:
        _budget_total = None
        return
    try:
        _budget_total = int(raw)
    except ValueError:
        raise SystemExit(f"ARK_TOTAL_TOKEN_BUDGET must be an integer token count, got {raw!r}")
    if _budget_total <= 0:
        raise SystemExit(f"ARK_TOTAL_TOKEN_BUDGET must be positive, got {_budget_total}")


_init_budget()


def budget_exhausted() -> bool:
    return _budget_total is not None and _budget_used >= _budget_total


def _budget_check() -> None:
    if budget_exhausted():
        global _budget_announced
        if not _budget_announced:
            _budget_announced = True
            log.critical("token budget exhausted: used=%d budget=%d (ARK_TOTAL_TOKEN_BUDGET); "
                         "refusing further provider calls", _budget_used, _budget_total)
        raise TokenBudgetExceeded(
            f"token budget exhausted: used={_budget_used} budget={_budget_total}")


def _budget_account(result: "ChatResult") -> None:
    global _budget_used
    if _budget_total is None:
        return
    with _budget_lock:
        _budget_used += result.prompt_tokens + result.completion_tokens


# --- Usage logger (mirrors token usage into opencode.db for `vibe-usage` cost tracking) ---
# Env-gated via ARK_USAGE_LOG_OPENCODE_DB; lazy-init on first use so standalone/probe runs
# that don't set the env pay only a single None-check per call. See usage_logger.py.
_usage_logger = None
_usage_logger_inited = False


def _get_usage_logger():
    global _usage_logger, _usage_logger_inited
    if _usage_logger_inited:
        return _usage_logger
    _usage_logger_inited = True
    try:
        from .usage_logger import init_from_env
        _usage_logger = init_from_env()
    except Exception as e:
        log.warning("usage logger init failed (disabled): %s", e)
        _usage_logger = None
    return _usage_logger


@dataclass(frozen=True)
class ProviderConfig:
    """Configuration for one LLM role (generator / reviewer_a / reviewer_b / adjudicator)."""
    role: str
    base_url: str
    api_key: str
    model: str
    timeout: float = 90.0
    max_retries: int = 6
    thinking: str = "disabled"  # "disabled" (reasoning off, fast/cheap) | "enabled" | "auto"


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name, "")
    return v if v else default


def load_provider_config(role: str) -> ProviderConfig:
    """Build a ProviderConfig for `role` from environment variables.

    Key resolution (mission §43): ARK_API_KEY MUST be in env. Never read a key from a config file
    or commit it. Raises RuntimeError if the key is absent.

    thinking (mission §34/scale): glm-5.2 is a reasoning model. Reasoning eats the max_tokens
    budget and returns empty content on complex prompts. For structured-JSON tasks (realize/
    review/adjudicate) reasoning is not worth 2-3x cost at 300k scale, so the default is
    "disabled" (reasoning_content omitted, content populates with ~100-500 tokens). Override
    per role via ARK_THINKING_<ROLE> or globally via ARK_THINKING.
    """
    api_key = os.environ.get("ARK_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "ARK_API_KEY env var not set. Provider unavailable (mission §43: API keys only from env). "
            "Set it in your shell before launching the orchestrator."
        )
    base_url = _env("ARK_BASE_URL", DEFAULT_ARK_BASE_URL)
    # per-role model override: ARK_MODEL_GENERATOR / ARK_MODEL_REVIEWER_A / ... else ARK_MODEL
    model = os.environ.get(f"ARK_MODEL_{role.upper()}") or _env("ARK_MODEL", DEFAULT_ARK_MODEL)
    timeout = float(_env("ARK_TIMEOUT", "90"))
    max_retries = int(_env("ARK_MAX_RETRIES", "6"))
    thinking = _env(f"ARK_THINKING_{role.upper()}", _env("ARK_THINKING", "disabled"))
    if thinking not in ("disabled", "enabled", "auto"):
        thinking = "disabled"
    return ProviderConfig(
        role=role, base_url=base_url, api_key=api_key, model=model,
        timeout=timeout, max_retries=max_retries, thinking=thinking,
    )


@dataclass
class ChatResult:
    content: str
    usage: dict[str, Any]
    latency: float
    model: str
    raw_message: dict[str, Any]
    # NOTE: reasoning_content is intentionally NOT a field here. Callers must not persist it as
    # sample reasoning (mission §34: no chain-of-thought in final output). It remains in
    # raw_message for debugging only and should never be written into a training record.

    @property
    def prompt_tokens(self) -> int:
        return int(self.usage.get("prompt_tokens") or self.usage.get("input_tokens") or 0)

    @property
    def completion_tokens(self) -> int:
        return int(self.usage.get("completion_tokens") or self.usage.get("output_tokens") or 0)


class LLMProvider:
    """Async LLM provider wrapping an OpenAI-compatible chat completions endpoint with retry."""

    def __init__(self, config: ProviderConfig):
        self.config = config
        self.client = AsyncOpenAI(
            base_url=config.base_url,
            api_key=config.api_key,
            timeout=config.timeout,
            max_retries=0,  # we do our own retry for logging + jitter control (mission §44)
        )

    async def chat(
        self,
        system: str,
        user: str,
        *,
        max_tokens: int = 2048,
        temperature: float = 0.0,
        response_format_json: bool = False,
    ) -> ChatResult:
        """One chat completion. Returns ChatResult with .content (final answer only).

        Raises RuntimeError after exhausting retries (mission §45: resumability - caller records
        the sample as 'needs_retry' and continues).
        """
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        # ML-012: refuse before any network traffic once the budget is gone
        # (raises through the retry loop - TokenBudgetExceeded is not retryable).
        _budget_check()
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            # glm-5.2 reasoning control (mission §34/scale). "disabled" turns off reasoning_content
            # so content populates within a small token budget (verified: reasoning_len=0, content ok).
            "extra_body": {"thinking": {"type": self.config.thinking}},
        }
        if response_format_json:
            # OpenAI-compatible JSON mode. Ark may or may not honor it; caller parses defensively.
            kwargs["response_format"] = {"type": "json_object"}

        last_exc: Exception | None = None
        for attempt in range(self.config.max_retries + 1):
            t0 = time.monotonic()
            try:
                resp = await self.client.chat.completions.create(**kwargs)
                msg = resp.choices[0].message
                content = msg.content or ""
                usage = self._usage_to_dict(resp.usage)
                latency = time.monotonic() - t0
                if not content:
                    # reasoning model: max_tokens too small -> reasoning ate the budget.
                    log.warning(
                        "provider=%s role=%s empty content (max_tokens=%d usage=%s) - "
                        "raise max_tokens so reasoning doesn't eat the budget",
                        self.config.model, self.config.role, max_tokens, usage,
                    )
                _ul = _get_usage_logger()
                if _ul is not None:
                    _ul.log(
                        role=self.config.role,
                        model=getattr(resp, "model", self.config.model),
                        usage=usage,
                        latency=latency,
                    )
                result = ChatResult(
                    content=content,
                    usage=usage,
                    latency=latency,
                    model=getattr(resp, "model", self.config.model),
                    raw_message=msg.model_dump() if hasattr(msg, "model_dump") else {},
                )
                _budget_account(result)
                return result
            except _RETRYABLE as e:
                last_exc = e
                # exponential backoff + full jitter (mission §44)
                base = min(2 ** attempt, 32)
                delay = base + random.uniform(0, 1.0)
                retry_after = getattr(e, "retry_after", None)
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except (TypeError, ValueError):
                        pass
                log.warning(
                    "provider=%s role=%s attempt=%d/%d retryable %s; sleeping %.2fs",
                    self.config.model, self.config.role, attempt + 1, self.config.max_retries,
                    type(e).__name__, delay,
                )
                if attempt < self.config.max_retries:
                    await asyncio.sleep(delay)
                continue
            except APIError as e:
                # non-retryable 4xx (auth/bad-request) - do not loop
                raise RuntimeError(
                    f"provider={self.config.model} role={self.config.role} non-retryable APIError: {e}"
                ) from e
        raise RuntimeError(
            f"provider={self.config.model} role={self.config.role} exhausted "
            f"{self.config.max_retries} retries: {last_exc}"
        ) from last_exc

    @staticmethod
    def _usage_to_dict(usage: Any) -> dict[str, Any]:
        if usage is None:
            return {}
        if hasattr(usage, "model_dump"):
            return usage.model_dump()
        if isinstance(usage, dict):
            return usage
        return {}
