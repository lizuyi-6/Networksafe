"""Live Step-5-pre provider client（Phase 1.5，显式 opt-in 后才存在）。

设计 §11.5 的 Phase 1 边界在这里被用户显式放开（"本阶段第一次允许真实调用
Step-5-pre provider"），但放开的方式是结构性的，不是把 Phase 1 的拒绝删掉：

* **凭据只从环境变量读**：``STEPFUN_API_KEY``（必填）、``STEPFUN_BASE_URL`` /
  ``ASW_PROVIDER_MODEL``（可选，有默认值）。代码里没有任何 key、URL 字面量之外的
  秘密；key 永不落盘、永不进日志、永不进 provenance。
* **显式 opt-in**：构造必须传 ``opt_in=True``（由 runner 依据冻结配置
  ``generation.provider == "live"`` 传入），否则构造即失败——和 Phase 1 的
  ``Step5Client`` 一样，意外调用路径在构造点就被切断。
* **审计记录**：每次构造追加一条 JSONL 到 ``provenance/live-client-audit.jsonl``
  （墙钟时间只用于审计，不进安全语义），记录 model/base_url 主机名/run_id/
  prompt_version/prompt_hash/opt-in 来源。
* **不做任何后处理**：``output_text`` 原样返回，截断、坏 JSON、markdown 围栏都是
  数据，由 parser 判死刑（design：parser is the only component allowed to look
  inside it）。
* **串行 + 有界重试**：StepFun 账号并发上限 5（仓库 .step-audit 实测 429），
  因此本客户端一次只发一个请求；429/5xx/超时按指数退避重试，耗尽后抛
  :class:`LiveProviderError`（传输失败不是数据，runner 把它记为批次级拒绝）。
* **token 数不估算**：只用 provider 返回的 ``usage``；缺失记 0 并在调用日志里标记
  ``usage_missing``，绝不静默估算（GE 指标的分母必须真实）。
"""
from __future__ import annotations

import http.client
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping

from .client import RawGeneration

#: StepFun step_plan OpenAI 兼容端点（2026-09-21 用户指定为 canonical；旧的
#: https://api.stepfun.com/v1 对本账号返回 401）。可用 ``STEPFUN_BASE_URL`` 覆盖。
DEFAULT_BASE_URL = "https://api.stepfun.com/step_plan/v1"
#: 本阶段使用的模型（brief 所称 Step-5-pre）。
DEFAULT_MODEL = "step-5-preview"
#: 客户端审计记录（JSONL，追加写）。
AUDIT_PATH = Path(__file__).resolve().parents[2] / "provenance" / "live-client-audit.jsonl"

_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class LiveProviderError(RuntimeError):
    """传输层失败（重试耗尽）。与"模型吐出了坏数据"是两回事，后者由 parser 拒。"""


class LiveStep5Client:
    """真实 Step-5-pre 客户端。构造即 opt-in + 审计；``generate`` 返回原始响应。"""

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
        #: 单 socket 操作超时。世界生成调用历史 3-9 分钟；85 分钟无进展的调用
        #: （v0.11 批量 3 实测）说明服务端在断续发 keep-alive 字节，per-op 超时
        #: 永远不会 fire——15 分钟无数据的调用判定死亡，交重试。
        timeout_s: float = 900.0,
        max_retries: int = 2,
        start_index: int = 0,
        audit_path: Path | None = None,
    ) -> None:
        if not opt_in:
            raise LiveProviderError(
                "LiveStep5Client 需要显式 opt_in=True（由 runner 依据冻结配置 "
                "generation.provider == \"live\" 传入）。Phase 1 的默认拒绝没有被删除，"
                "只是多了一条需要显式选择的路。"
            )
        self._api_key = api_key if api_key is not None else os.environ.get("STEPFUN_API_KEY")
        if not self._api_key:
            raise LiveProviderError(
                "STEPFUN_API_KEY 未设置：真实 provider 调用不可用。凭据只从环境变量读，"
                "代码不提供任何字面量 key。"
            )
        self._base_url = (
            base_url if base_url is not None else os.environ.get("STEPFUN_BASE_URL")
        ) or DEFAULT_BASE_URL
        self._base_url = self._base_url.rstrip("/")
        self.model = model or os.environ.get("ASW_PROVIDER_MODEL") or DEFAULT_MODEL
        self.model_version = "unknown-until-first-response"
        self.provider = "stepfun-live"
        self.run_id = run_id
        self.prompt_version = prompt_version
        self.prompt_hash = prompt_hash
        self._temperature = float(temperature)
        self._top_p = float(top_p)
        self._reasoning_effort = str(reasoning_effort)
        self._timeout_s = float(timeout_s)
        self._max_retries = int(max_retries)
        self._audit_path = audit_path if audit_path is not None else AUDIT_PATH
        #: raw_generation_id 在**整个 run** 内单调：断点续跑的进程从已完成批次数继续，
        #: 否则两个进程都会产出 b001，provenance 与 raw 帧的对应关系会混淆。
        self._counter = int(start_index)
        #: 最近一次调用的 provider finish_reason（"stop"/"length"/…），runner 据此
        # 判断帧失败是否源于输出上限截断并自适应缩小批量。
        self._last_finish_reason: str | None = None
        #: 每次调用的平面记录（延迟/重试/usage/http 状态），runner 原样收进指标。
        self.calls: list[dict[str, Any]] = []
        self._append_audit("live_client_constructed")

    @property
    def last_finish_reason(self) -> str | None:
        return self._last_finish_reason

    # ------------------------------------------------------------------ #
    def generate(self, prompt: str, *, batch_size: int, max_output_tokens: int) -> RawGeneration:
        """发一次 chat completion，返回未改动的 :class:`RawGeneration`。"""
        self._counter += 1
        raw_generation_id = f"{self.run_id}-b{self._counter:03d}"
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": prompt}],
            "temperature": self._temperature,
            "top_p": self._top_p,
            "max_tokens": int(max_output_tokens),
            "stream": False,
        }
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort

        started = time.monotonic()
        status, payload, retries = self._post_with_retry(body)
        latency_s = round(time.monotonic() - started, 3)

        choices = payload.get("choices") if isinstance(payload, Mapping) else None
        finish_reason = None
        if isinstance(choices, list) and choices and isinstance(choices[0], Mapping):
            finish_reason = choices[0].get("finish_reason")
        text = _extract_content(payload)
        usage = payload.get("usage") if isinstance(payload, Mapping) else None
        usage_missing = not isinstance(usage, Mapping)
        prompt_tokens = int(usage.get("prompt_tokens", 0)) if not usage_missing else 0
        completion_tokens = int(usage.get("completion_tokens", 0)) if not usage_missing else 0
        returned_model = str(payload.get("model") or self.model) if isinstance(payload, Mapping) else self.model
        self.model_version = returned_model

        self.calls.append(
            {
                "raw_generation_id": raw_generation_id,
                "http_status": status,
                "latency_s": latency_s,
                "retries": retries,
                "batch_size": batch_size,
                "max_output_tokens": int(max_output_tokens),
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
                "usage_missing": usage_missing,
                "output_text_length": len(text),
                "finish_reason": finish_reason,
            }
        )
        self._last_finish_reason = finish_reason
        self._append_audit(
            "live_call",
            {
                "raw_generation_id": raw_generation_id,
                "http_status": status,
                "latency_s": latency_s,
                "retries": retries,
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
                "usage_missing": usage_missing,
            },
        )
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
                "max_tokens": int(max_output_tokens),
                "batch_size": int(batch_size),
                "provider": self.provider,
            },
            output_text=text,
            output_tokens=completion_tokens,
            input_tokens=prompt_tokens,
        )

    # ------------------------------------------------------------------ #
    def _post_with_retry(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any], int]:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                status, payload = self._post_once(body)
                return status, payload, attempt
            except urllib.error.HTTPError as exc:
                status = int(exc.code)
                detail = exc.read().decode("utf-8", "replace")[:500]
                last_error = exc
                if status not in _RETRYABLE_STATUS or attempt == self._max_retries:
                    raise LiveProviderError(
                        f"provider HTTP {status}: {detail}"
                    ) from exc
            except (http.client.HTTPException, urllib.error.URLError, TimeoutError, OSError) as exc:
                # http.client.IncompleteRead / BadStatusLine / RemoteDisconnected 在长响应
                # 中途断连时抛出，且不是 OSError 子类——不捕获就会整个 run 崩掉
                # （milestone 批次 34 实测：201KB 响应中途断开）。
                last_error = exc
                if attempt == self._max_retries:
                    raise LiveProviderError(f"provider 传输失败: {exc}") from exc
            time.sleep(min(2.0**attempt * 2.0, 30.0))
        raise LiveProviderError(f"provider 重试耗尽: {last_error}")

    def _post_once(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(
            self._base_url + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self._api_key,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
            status = int(response.status)
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise LiveProviderError("provider 返回了非对象 JSON")
        return status, payload

    def _append_audit(self, event: str, extra: Mapping[str, Any] | None = None) -> None:
        record = {
            "event": event,
            "recorded_at_wallclock": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "provider": self.provider,
            "model": self.model,
            "base_url_host": self._base_url.split("/")[2] if "//" in self._base_url else self._base_url,
            "run_id": self.run_id,
            "prompt_version": self.prompt_version,
            "prompt_hash": self.prompt_hash,
        }
        if extra:
            record.update(dict(extra))
        try:
            self._audit_path.parent.mkdir(parents=True, exist_ok=True)
            with self._audit_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        except OSError:
            # 审计写失败不能阻断生成，但必须在调用日志里留下痕迹。
            self.calls.append({"audit_write_failed": True, "event": event})


def _extract_content(payload: Mapping[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LiveProviderError("provider 响应缺少 choices")
    message = choices[0].get("message") if isinstance(choices[0], Mapping) else None
    if not isinstance(message, Mapping) or not isinstance(message.get("content"), str):
        raise LiveProviderError("provider 响应缺少 message.content")
    return message["content"]


__all__ = ["LiveProviderError", "LiveStep5Client", "DEFAULT_BASE_URL", "DEFAULT_MODEL"]
