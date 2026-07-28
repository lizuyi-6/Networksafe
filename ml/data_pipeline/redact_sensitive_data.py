#!/usr/bin/env python3
"""Redact credential-like values and unsafe network targets from candidate copies."""

from __future__ import annotations

import json
import ipaddress
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


URL_RE = re.compile(r"(?i)\b(https?://)([^/\s\"'<>]+)")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
IPV6_RE = re.compile(
    r"(?<![0-9A-Za-z])(?:\[[0-9A-Fa-f:.%]+\]|(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f:%]*)(?![0-9A-Za-z])"
)
DOMAIN_RE = re.compile(r"(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b")
ALLOWED_HOSTS = {"example.com", "example.org", "test.local", "example.invalid", "localhost"}


def allowed_network_host(raw_host: str) -> bool:
    host = raw_host.strip("[]").split("%", 1)[0].lower()
    if host in ALLOWED_HOSTS or host.endswith(".test.local"):
        return True
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        return False


def redact_network(value: str) -> tuple[str, int]:
    count = 0

    def replace_url(match: re.Match[str]) -> str:
        nonlocal count
        authority = match.group(2)
        candidate = authority.rsplit("@", 1)[-1]
        if candidate.startswith("["):
            closing = candidate.find("]")
            host = candidate[: closing + 1] if closing >= 0 else candidate
        else:
            host = candidate.split(":", 1)[0]
            if candidate.count(":") >= 2:
                host = candidate
        if allowed_network_host(host):
            return match.group(0)
        count += 1
        return f"{match.group(1)}example.com"

    value = URL_RE.sub(replace_url, value)

    def replace_ip(match: re.Match[str]) -> str:
        nonlocal count
        address = match.group(0)
        if allowed_network_host(address):
            return address
        count += 1
        return "192.0.2.10"

    value = IPV4_RE.sub(replace_ip, value)

    def replace_ipv6(match: re.Match[str]) -> str:
        nonlocal count
        address = match.group(0)
        candidate = address.strip("[]").split("%", 1)[0]
        try:
            parsed = ipaddress.ip_address(candidate)
        except ValueError:
            return address
        if not parsed.is_global:
            return address
        count += 1
        return "2001:db8::10"

    value = IPV6_RE.sub(replace_ipv6, value)

    def replace_domain(match: re.Match[str]) -> str:
        nonlocal count
        domain = match.group(0).lower()
        if domain in ALLOWED_HOSTS or domain.endswith(".test.local"):
            return match.group(0)
        count += 1
        return "example.com"

    return DOMAIN_RE.sub(replace_domain, value), count


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
            if str(key) in {"field", "ruleId"}:
                # These values are contract identifiers such as
                # ``sourceContext.assetType``; treating them as DNS names breaks
                # evidence and rule-signal field resolution.
                redacted, count = item, 0
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
