#!/usr/bin/env python3
"""Redact credential-like values and unsafe network targets from candidate copies."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from common import (
    add_io_arguments,
    common_parser,
    emit_log,
    iter_jsonl,
    load_config,
    parse_record,
    redact_text,
    refresh_record_hashes,
    repository_root,
    resolve_path,
    stable_json,
    write_jsonl,
)


URL_RE = re.compile(r"(?i)\b(https?://)([a-z0-9.-]+)")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
ALLOWED_HOSTS = {"example.com", "example.org", "test.local", "example.invalid", "localhost"}


def redact_network(value: str) -> tuple[str, int]:
    count = 0

    def replace_url(match: re.Match[str]) -> str:
        nonlocal count
        host = match.group(2).lower()
        if host in ALLOWED_HOSTS or host.endswith(".test.local"):
            return match.group(0)
        count += 1
        return f"{match.group(1)}example.com"

    value = URL_RE.sub(replace_url, value)

    def replace_ip(match: re.Match[str]) -> str:
        nonlocal count
        address = match.group(0)
        parts = [int(part) for part in address.split(".")]
        allowed = (
            parts[0] in {10, 127}
            or (parts[0] == 169 and parts[1] == 254)
            or (parts[0] == 172 and 16 <= parts[1] <= 31)
            or (parts[0] == 192 and parts[1] in {0, 168})
            or (parts[0] == 198 and parts[1] == 51)
            or (parts[0] == 203 and parts[1] == 0)
        )
        if allowed:
            return address
        count += 1
        return "192.0.2.10"

    return IPV4_RE.sub(replace_ip, value), count


def redact_value(value: Any) -> tuple[Any, int]:
    if isinstance(value, str):
        redacted, count = redact_text(value)
        redacted, network_count = redact_network(redacted)
        return redacted, count + network_count
    if isinstance(value, list):
        result = []
        total = 0
        for item in value:
            redacted, count = redact_value(item)
            result.append(redacted)
            total += count
        return result, total
    if isinstance(value, dict):
        result = {}
        total = 0
        for key, item in value.items():
            if str(key).lower() in {"authorization", "proxy-authorization", "x-api-key", "cookie", "set-cookie"}:
                # Synthetic carrier cookies are safe to retain after token-level redaction.
                redacted, count = redact_value(item)
            else:
                redacted, count = redact_value(item)
            result[key] = redacted
            total += count
        return result, total
    return value, 0


def redact_records(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    result: list[dict[str, Any]] = []
    replacements = 0
    for source_record in records:
        record = json.loads(json.dumps(source_record, ensure_ascii=False))
        detection_input, detection_output = parse_record(record)
        detection_input, input_count = redact_value(detection_input)
        detection_output, output_count = redact_value(detection_output)
        replacements += input_count + output_count
        record["messages"][1]["content"] = stable_json(detection_input)
        record["messages"][2]["content"] = stable_json(detection_output)
        result.append(refresh_record_hashes(record))
    return result, replacements


def main() -> int:
    parser = common_parser(__doc__ or "Redact candidate data")
    add_io_arguments(parser)
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    if not arguments.input or not arguments.output:
        parser.error("--input and --output are required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    redacted, replacements = redact_records(records)
    write_jsonl(
        resolve_path(root, arguments.output),
        redacted,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log("redaction_complete", input=len(records), output=len(redacted), replacements=replacements)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
