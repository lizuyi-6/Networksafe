"""Phase 2A 的真实 provider 客户端（brief §38 的加固版）。

Phase 1 实测过的三类故障都在这里被结构性堵住：

============================  ================================================
故障                         对策
============================  ================================================
85 分钟"滴漏"挂死              ``absolute_deadline_s``：超过绝对墙钟就取消，
（keep-alive 微量字节          不等 socket 超时
让 per-op 超时永不触发）
401 key 失效引发 1992 次重试   ``_AuthCircuit``：401 不重试、直接熔断
瞬时 SSL / IncompleteRead      可重试集合 + 指数退避 +抖动
断点续跑重复烧 token           ``idempotency_key`` + 响应落盘 checkpoint
============================  ================================================

凭据仍然只从 ``STEPFUN_API_KEY`` 环境变量读；代码里没有任何 key 字面量，key 永不落盘、
永不进日志、永不进 provenance。构造仍需显式 ``opt_in=True``。
"""
from __future__ import annotations

import http.client
import json
import os
import random
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping

from generation.step5.client import RawGeneration

DEFAULT_BASE_URL = "https://api.stepfun.com/step_plan/v1"
DEFAULT_MODEL = "step-5-preview"

_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
_AUTH_STATUS = {401, 403}


class ProviderError(RuntimeError):
    """传输层失败（重试耗尽 / 熔断 / 超时）。与"模型吐了坏数据"是两回事。"""


class AuthCircuitOpen(ProviderError):
    """连续鉴权失败触发熔断：凭据问题只能由运行方解决，客户端不再硬刚。"""


class LiveSkeletonClient:
    """真实 Step-5 客户端（Phase 2A 加固版）。"""

    def __init__(
        self,
        *,
        opt_in: bool = False,
        run_id: str,
        prompt_version: str,
        prompt_hash: str,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        temperature: float = 0.2,
        top_p: float = 0.9,
        reasoning_effort: str = "medium",
        max_output_tokens: int = 32768,
        #: 单 socket 操作超时（秒）。
        timeout_s: float = 120.0,
        #: 单次请求的绝对墙钟上限（秒）。brief §38.A。
        absolute_deadline_s: float = 1800.0,
        #: 连续多少秒没有任何字节进展就判死（秒）。brief §38.B。
        idle_timeout_s: float = 300.0,
        max_retries: int = 4,
        #: 连续鉴权失败多少次后熔断。brief §38.F。
        auth_failure_limit: int = 2,
        start_index: int = 0,
        checkpoint_dir: Path | None = None,
        seed: int = 0,
    ) -> None:
        if not opt_in:
            raise ProviderError(
                "LiveSkeletonClient 需要显式 opt_in=True。Phase 1 的默认拒绝没有被删除，"
                "只是多了一条需要显式选择的路。"
            )
        self._api_key = api_key if api_key is not None else os.environ.get("STEPFUN_API_KEY")
        if not self._api_key:
            raise ProviderError(
                "STEPFUN_API_KEY 未设置：真实 provider 调用不可用。凭据只从环境变量读。"
            )
        self._base_url = (
            base_url if base_url is not None else os.environ.get("STEPFUN_BASE_URL")
        ) or DEFAULT_BASE_URL
        self._base_url = self._base_url.rstrip("/")
        self.model = model or os.environ.get("ASW_PROVIDER_MODEL") or DEFAULT_MODEL
        self.run_id = run_id
        self.prompt_version = prompt_version
        self.prompt_hash = prompt_hash
        self._temperature = float(temperature)
        self._top_p = float(top_p)
        self._reasoning_effort = str(reasoning_effort)
        self._max_output_tokens = int(max_output_tokens)
        self._timeout_s = float(timeout_s)
        self._absolute_deadline_s = float(absolute_deadline_s)
        self._idle_timeout_s = float(idle_timeout_s)
        self._max_retries = int(max_retries)
        self._auth_failure_limit = int(auth_failure_limit)
        self._counter = int(start_index)
        self._checkpoint_dir = checkpoint_dir
        self._rng = random.Random(seed)
        self.calls: list[dict[str, Any]] = []
        self._auth_failures = 0
        self._last_finish_reason: str | None = None

    # -- 公开 --------------------------------------------------------------- #
    @property
    def last_finish_reason(self) -> str | None:
        return self._last_finish_reason

    def generate(self, prompt: str, *, batch_size: int, max_output_tokens: int | None = None) -> RawGeneration:
        """发一次 chat completion，返回未改动的 :class:`RawGeneration`。"""
        self._counter += 1
        raw_generation_id = f"{self.run_id}-b{self._counter:03d}"
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": prompt}],
            "temperature": self._temperature,
            "top_p": self._top_p,
            "max_tokens": int(max_output_tokens or self._max_output_tokens),
            "stream": False,
        }
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort

        started = time.monotonic()
        status, payload, text, retries = self._post_with_retry(
            body, idempotency_key=f"{self.run_id}:{raw_generation_id}"
        )
        latency_s = round(time.monotonic() - started, 3)
        self._checkpoint(raw_generation_id, text)

        if not isinstance(payload, dict):
            raise ProviderError("provider 返回了非对象 JSON")
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ProviderError("provider 响应缺少 choices")
        first = choices[0] if isinstance(choices[0], Mapping) else {}
        finish_reason = first.get("finish_reason")
        message = first.get("message") if isinstance(first, Mapping) else None
        if not isinstance(message, Mapping) or not isinstance(message.get("content"), str):
            raise ProviderError("provider 响应缺少 message.content")
        content = message["content"]

        usage = payload.get("usage") if isinstance(payload, Mapping) else None
        usage_missing = not isinstance(usage, Mapping)
        prompt_tokens = int(usage.get("prompt_tokens", 0)) if not usage_missing else 0
        completion_tokens = int(usage.get("completion_tokens", 0)) if not usage_missing else 0
        returned_model = str(payload.get("model") or self.model)

        record = {
            "raw_generation_id": raw_generation_id,
            "http_status": status,
            "latency_s": latency_s,
            "retries": retries,
            "batch_size": batch_size,
            "input_tokens": prompt_tokens,
            "output_tokens": completion_tokens,
            "usage_missing": usage_missing,
            "output_text_length": len(content),
            "finish_reason": finish_reason,
            "idempotency_key": f"{self.run_id}:{raw_generation_id}",
        }
        self.calls.append(record)
        self._last_finish_reason = finish_reason
        return RawGeneration(
            raw_generation_id=raw_generation_id,
            model=returned_model,
            model_version=returned_model,
            prompt_version=self.prompt_version,
            prompt_hash=self.prompt_hash,
            decoding_parameters={
                "temperature": self._temperature,
                "top_p": self._top_p,
                "reasoning_effort": self._reasoning_effort,
                "max_tokens": int(max_output_tokens or self._max_output_tokens),
                "batch_size": int(batch_size),
                "provider": "stepfun-live",
            },
            output_text=content,
            output_tokens=completion_tokens,
            input_tokens=prompt_tokens,
        )

    # -- 传输层 ------------------------------------------------------------- #
    def _post_with_retry(
        self, body: Mapping[str, Any], *, idempotency_key: str
    ) -> tuple[int, dict[str, Any], str, int]:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                status, payload, text = self._post_once(body, idempotency_key=idempotency_key)
                if status in _AUTH_STATUS:
                    self._auth_failures += 1
                    if self._auth_failures >= self._auth_failure_limit:
                        raise AuthCircuitOpen(
                            f"连续 {self._auth_failures} 次鉴权失败（HTTP {status}）："
                            "熔断。凭据/配额问题只能由运行方解决。"
                        )
                    # 401 不重试：重试一个坏 key 只会烧配额（Phase 1 实测 1992 次）。
                    raise ProviderError(f"provider HTTP {status}: 鉴权失败，不重试")
                self._auth_failures = 0
                return status, payload, text, attempt
            except AuthCircuitOpen:
                raise
            except ProviderError:
                raise
            except urllib.error.HTTPError as exc:
                status = int(exc.code)
                detail = exc.read().decode("utf-8", "replace")[:500]
                last_error = exc
                if status not in _RETRYABLE_STATUS or attempt == self._max_retries:
                    raise ProviderError(f"provider HTTP {status}: {detail}") from exc
            except (http.client.HTTPException, urllib.error.URLError, TimeoutError, OSError) as exc:
                # IncompleteRead / BadStatusLine / RemoteDisconnected 不是 OSError 子类，
                # 不捕获就会让整个 run 崩掉（Phase 1 实测：201KB 响应中途断开）。
                last_error = exc
                if attempt == self._max_retries:
                    raise ProviderError(f"provider 传输失败: {exc}") from exc
            self._sleep_backoff(attempt)
        raise ProviderError(f"provider 重试耗尽: {last_error}")

    def _post_once(
        self, body: Mapping[str, Any], *, idempotency_key: str
    ) -> tuple[int, dict[str, Any], str]:
        request = urllib.request.Request(
            self._base_url + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self._api_key,
                # brief §38.G：同一批次重试不会在服务端产生第二次计费生成。
                "Idempotency-Key": idempotency_key,
            },
            method="POST",
        )
        deadline = time.monotonic() + self._absolute_deadline_s
        last_progress = time.monotonic()
        chunks: list[bytes] = []
        with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
            status = int(response.status)
            while True:
                now = time.monotonic()
                if now > deadline:
                    raise ProviderError(
                        f"绝对墙钟上限 {self._absolute_deadline_s:.0f}s 已到，取消请求"
                        "（brief §38.A：不等 keep-alive 滴漏）"
                    )
                if now - last_progress > self._idle_timeout_s:
                    raise ProviderError(
                        f"{self._idle_timeout_s:.0f}s 没有任何字节进展，判定挂死"
                        "（brief §38.B）"
                    )
                try:
                    chunk = response.read(65536)
                except (TimeoutError, socket.timeout) as exc:
                    raise ProviderError(f"socket 读超时: {exc}") from exc
                if not chunk:
                    break
                chunks.append(chunk)
                last_progress = time.monotonic()
        raw = b"".join(chunks).decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"provider 返回了非 JSON 响应体: {exc}") from exc
        if not isinstance(payload, dict):
            raise ProviderError("provider 返回了非对象 JSON")
        return status, payload, raw

    def _sleep_backoff(self, attempt: int) -> None:
        base = min(2.0 ** attempt * 2.0, 30.0)
        # brief §38.E：jitter，避免多 worker 同时重试把配额打满。
        time.sleep(base * (0.5 + self._rng.random()))

    def _checkpoint(self, raw_generation_id: str, text: str) -> None:
        """brief §38.H：原始响应体立即落盘，进程被杀也不丢这一批。"""
        if self._checkpoint_dir is None:
            return
        try:
            self._checkpoint_dir.mkdir(parents=True, exist_ok=True)
            (self._checkpoint_dir / f"{raw_generation_id}.json").write_text(
                json.dumps(
                    {
                        "raw_generation_id": raw_generation_id,
                        "model": self.model,
                        "prompt_version": self.prompt_version,
                        "prompt_hash": self.prompt_hash,
                        "output_text": text,
                    },
                    ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
        except OSError:
            self.calls.append({"checkpoint_write_failed": True, "raw_generation_id": raw_generation_id})


__all__ = [
    "AuthCircuitOpen",
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "LiveSkeletonClient",
    "ProviderError",
]
