#!/usr/bin/env python3
"""Interactive / one-shot AetherArgus security-verdict client.

Reads an HTTP request (raw text) from stdin or --request, sends it to the local
Ollama `aetherargus` model, and prints the strict-JSON verdict. Never patches a
failed parse to safe — surfaces the raw output on schema failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

SYSTEM_PROMPT = (
    "你是 AetherGuard 安全流量判定引擎。根据输入的 HTTP 请求、安全上下文和规则信号进行判断。"
    "只能输出一个 JSON 对象，不得输出 Markdown、代码块、思考过程或额外说明。"
    "必须且只能包含 verdict、confidence、attackFamily、severity、reasoning、evidence、recommendedAction。"
    "信息不足时返回 unknown，解析或判断失败绝不能返回 safe。"
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="aetherargus")
    parser.add_argument("--request", default=None, help="Raw HTTP request text; omit to read stdin.")
    parser.add_argument("--max-new-tokens", type=int, default=320)
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args()


def call_model(base_url: str, model: str, request_text: str, max_new_tokens: int, timeout: int) -> dict:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": request_text},
        ],
        "stream": False,
        "options": {"temperature": 0, "num_predict": max_new_tokens, "stop": ["<|im_end|>", "<|endoftext|>"]},
    }
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    args = parse_arguments()
    request_text = args.request if args.request is not None else sys.stdin.read()
    if not request_text.strip():
        print("empty request", file=sys.stderr)
        return 2
    response = call_model(args.base_url, args.model, request_text, args.max_new_tokens, args.timeout)
    content = (response.get("message") or {}).get("content", "").strip()
    try:
        parsed = json.loads(content)
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
        return 0
    except json.JSONDecodeError:
        print("__SCHEMA_OR_JSON_FAILURE__ raw output below (NOT patched to safe):", file=sys.stderr)
        print(content)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
