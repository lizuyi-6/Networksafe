#!/usr/bin/env python3
"""Build leakage-resistant AetherGuard SFT datasets from tracked source data.

The source corpus is never modified. Generated JSONL files contain normalized
request/event inputs, strict-schema assistant outputs, and provenance metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote

from detection_contract import (
    ATTACK_FAMILIES,
    build_messages,
    parse_strict_json_object,
    resolve_repository_root,
    serialize_json,
    validate_detection_input,
    validate_detection_output,
)


SOURCE_DATASET_DIRECTORIES = (
    "full_test_dataset",
    "complete_dataset",
    "advanced_dataset",
    "zeroday_dataset",
)
TARGET_CATEGORY_RATIOS = {
    "attack": 0.35,
    "normal": 0.35,
    "hard_negative": 0.20,
    "unknown": 0.10,
}
SPLIT_RATIOS = {"train": 0.80, "validation": 0.10, "test": 0.10}
SAFE_SOURCE_CONTEXT_KEYS = {
    "requestsLastMinute",
    "distinctPathsLastMinute",
    "recentFailureCount",
    "historicalRiskScore",
    "authenticated",
    "accountPrivilege",
    "internalService",
    "endpointSensitivity",
    "openApiMatched",
    "assetType",
    "distinctUsernamesLastMinute",
    "sessionAgeSeconds",
    "geoConsistency",
    "statusCodeHistory",
}
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"}
SENSITIVE_HEADER_NAMES = {"authorization", "cookie", "proxy-authorization", "x-api-key", "api-key"}


@dataclass(frozen=True)
class BuildPaths:
    """Resolved paths used during a dataset build."""

    repository_root: Path
    source_root: Path
    existing_sft_path: Path
    processed_directory: Path
    manifest_directory: Path
    reports_directory: Path


@dataclass
class BuildStatistics:
    """Mutable counters collected without retaining rejected payloads."""

    raw_files_read: int = 0
    raw_records_read: int = 0
    existing_sft_records_read: int = 0
    redactions_applied: int = 0
    exact_duplicates_removed: int = 0
    ambiguous_records_rejected: int = 0
    schema_records_rejected: int = 0
    field_presence: Counter[str] = field(default_factory=Counter)
    source_dataset_records: Counter[str] = field(default_factory=Counter)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target-samples",
        type=int,
        default=1200,
        help="Requested total after deduplication and category balancing (default: 1200).",
    )
    parser.add_argument("--seed", type=int, default=42, help="Deterministic sampling and split seed.")
    parser.add_argument(
        "--source-root",
        type=Path,
        default=None,
        help="Optional source dataset root; defaults to the tracked backend test dataset.",
    )
    return parser.parse_args()


def resolve_build_paths(source_root_override: Path | None) -> BuildPaths:
    repository_root = resolve_repository_root()
    default_source_root = repository_root / "backend" / "test-data" / "aetherguard-security-dataset"
    source_root = source_root_override.resolve() if source_root_override else default_source_root
    return BuildPaths(
        repository_root=repository_root,
        source_root=source_root,
        existing_sft_path=source_root / "aetherguard-sft-batch-001.jsonl",
        processed_directory=repository_root / "ml" / "data" / "processed",
        manifest_directory=repository_root / "ml" / "data" / "manifests",
        reports_directory=repository_root / "ml" / "reports",
    )


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def redact_sensitive_text(value: str) -> tuple[str, int]:
    """Redact credential-like values while preserving attack syntax."""

    redaction_count = 0
    redacted_value = value
    substitution_patterns = (
        (re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key)=([^&\s]+)"), r"\1=[REDACTED]"),
        (re.compile(r"(?i)(\"(?:password|passwd|secret|token|apiKey)\"\s*:\s*)\"[^\"]*\""), r'\1"[REDACTED]"'),
        (re.compile(r"(?i)Bearer\s+[A-Za-z0-9._~+/=-]{12,}"), "Bearer [REDACTED]"),
        (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "user@example.invalid"),
    )
    for substitution_pattern, replacement in substitution_patterns:
        redacted_value, replacements_made = substitution_pattern.subn(replacement, redacted_value)
        redaction_count += replacements_made
    return redacted_value, redaction_count


def normalize_template_text(value: str) -> str:
    """Normalize variants aggressively for split grouping, not model input."""

    normalized_value = unicodedata.normalize("NFKC", value).lower().strip()
    for _decode_attempt in range(3):
        decoded_value = unquote(normalized_value)
        if decoded_value == normalized_value:
            break
        normalized_value = decoded_value
    normalized_value = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<ip>", normalized_value)
    normalized_value = re.sub(r"\b[0-9a-f]{16,}\b", "<hex>", normalized_value)
    normalized_value = re.sub(r"\b\d+\b", "<number>", normalized_value)
    normalized_value = re.sub(r"[A-Za-z0-9_-]{24,}", "<opaque>", normalized_value)
    normalized_value = re.sub(r"\s+", " ", normalized_value)
    return normalized_value[:8192]


def identify_encoding(payload: str) -> str:
    lowered_payload = payload.lower()
    if re.search(r"%25(?:2e|2f|5c|27|3c)", lowered_payload):
        return "double_url_encoded"
    if re.search(r"%(?:2e|2f|5c|27|3c|00|c0|e0)", lowered_payload):
        return "url_encoded"
    if "\\u" in lowered_payload or any(ord(character) > 127 for character in payload):
        return "unicode"
    if re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*", payload.strip()):
        return "token_or_base64"
    return "plain"


def map_attack_family(original_type: str, payload: str) -> str:
    normalized_type = original_type.lower().replace("-", "_")
    lowered_payload = payload.lower()
    if normalized_type == "normal":
        return "benign"
    if any(token in normalized_type for token in ("sql", "nosql", "graphql", "ldap")):
        return "sqli"
    if "xss" in normalized_type:
        return "xss"
    if any(token in normalized_type for token in ("command", "log4j", "spring4shell", "text4shell", "ssti", "struts")):
        return "command_injection"
    if "path_traversal" in normalized_type or "directory_traversal" in normalized_type:
        return "path_traversal"
    if "ssrf" in normalized_type:
        return "ssrf"
    if any(token in normalized_type for token in ("jwt", "oauth", "auth", "brute_force", "homoglyph")):
        return "authentication"
    if any(token in normalized_type for token in ("ddos", "port_scan", "redos", "automation", "bot")):
        return "automation"
    if "api_abuse" in normalized_type:
        return "api_abuse"
    if any(token in normalized_type for token in ("deserial", "prototype_pollution", "type_confusion")):
        return "deserialization"
    if "upload" in normalized_type:
        return "file_upload"
    if any(
        token in normalized_type
        for token in ("smuggling", "websocket", "cache_poison", "protocol_pollution", "xxe", "bluekeep", "exchange")
    ):
        return "protocol_attack"
    if "business" in normalized_type:
        return "business_logic"

    # Encoding-bypass records need payload-level mapping because their source
    # type intentionally hides the underlying attack family.
    if "../" in lowered_payload or "..\\" in lowered_payload or "etc/passwd" in lowered_payload:
        return "path_traversal"
    if "<script" in lowered_payload or "onerror=" in lowered_payload:
        return "xss"
    if "union" in lowered_payload or "select" in lowered_payload:
        return "sqli"
    if "file.php" in lowered_payload or "%00.jpg" in lowered_payload:
        return "file_upload"
    return "other"


def normalize_severity(source_severity: Any, expected_detection: bool) -> str:
    normalized_severity = str(source_severity or "").lower().strip()
    if normalized_severity in {"low", "medium", "high", "critical"}:
        return normalized_severity
    return "high" if expected_detection else "low"


def sanitize_headers(headers: dict[str, Any], statistics: BuildStatistics) -> dict[str, str]:
    sanitized_headers: dict[str, str] = {}
    for raw_name, raw_value in headers.items():
        header_name = str(raw_name)[:160]
        header_value = str(raw_value)[:8192]
        if header_name.lower() in SENSITIVE_HEADER_NAMES:
            sanitized_headers[header_name] = "[REDACTED]"
            statistics.redactions_applied += 1
            continue
        sanitized_value, redaction_count = redact_sensitive_text(header_value)
        statistics.redactions_applied += redaction_count
        sanitized_headers[header_name] = sanitized_value
    return sanitized_headers


def parse_http_payload(payload: str, statistics: BuildStatistics) -> dict[str, Any] | None:
    normalized_newlines = payload.replace("\r\n", "\n")
    request_lines = normalized_newlines.split("\n")
    if not request_lines:
        return None
    request_line_match = re.match(r"^([A-Z]+)\s+(\S+)(?:\s+HTTP/\d(?:\.\d)?)?$", request_lines[0].strip())
    if not request_line_match or request_line_match.group(1) not in HTTP_METHODS:
        return None

    method = request_line_match.group(1)
    request_target = request_line_match.group(2)
    path, separator, query = request_target.partition("?")
    headers: dict[str, str] = {}
    body_start_index = len(request_lines)
    for line_index, request_line in enumerate(request_lines[1:], start=1):
        if request_line == "":
            body_start_index = line_index + 1
            break
        header_name, header_separator, header_value = request_line.partition(":")
        if header_separator:
            headers[header_name.strip()] = header_value.strip()
    raw_body = "\n".join(request_lines[body_start_index:]) if body_start_index < len(request_lines) else ""
    sanitized_body, redaction_count = redact_sensitive_text(raw_body)
    statistics.redactions_applied += redaction_count
    return {
        "method": method,
        "path": path[:2048] or "/",
        "query": query[:8192] if separator else "",
        "headers": sanitize_headers(headers, statistics),
        "body": sanitized_body[:32768],
        "sourceContext": {
            "requestsLastMinute": 1,
            "distinctPathsLastMinute": 1,
            "recentFailureCount": 0,
        },
        "ruleSignals": [],
    }


def convert_payload_to_input(
    original_type: str,
    payload: str,
    expected_detection: bool,
    statistics: BuildStatistics,
) -> tuple[dict[str, Any], str]:
    sanitized_payload, redaction_count = redact_sensitive_text(payload)
    statistics.redactions_applied += redaction_count
    parsed_http_input = parse_http_payload(sanitized_payload, statistics)
    if parsed_http_input is not None:
        evidence_field = "body" if parsed_http_input["body"] else ("query" if parsed_http_input["query"] else "path")
        return parsed_http_input, evidence_field

    attack_family = map_attack_family(original_type, sanitized_payload)
    body_preferred_families = {
        "command_injection",
        "deserialization",
        "file_upload",
        "protocol_attack",
        "business_logic",
    }
    if attack_family in body_preferred_families:
        detection_input = {
            "method": "POST" if expected_detection else "EVENT",
            "path": f"/security/event/{re.sub(r'[^a-z0-9_-]', '_', original_type.lower())}"[:2048],
            "query": "",
            "headers": {"Content-Type": "text/plain"},
            "body": sanitized_payload[:32768],
            "sourceContext": {
                "requestsLastMinute": 1,
                "distinctPathsLastMinute": 1,
                "recentFailureCount": 0,
            },
            "ruleSignals": [],
        }
        return detection_input, "body"

    detection_input = {
        "method": "GET",
        "path": "/inspect",
        "query": f"input={sanitized_payload}"[:8192],
        "headers": {"Accept": "application/json"},
        "body": "",
        "sourceContext": {
            "requestsLastMinute": 1,
            "distinctPathsLastMinute": 1,
            "recentFailureCount": 0,
        },
        "ruleSignals": [],
    }
    return detection_input, "query"


def build_labeled_output(
    expected_detection: bool,
    attack_family: str,
    severity: str,
    evidence_field: str,
    payload: str,
) -> dict[str, Any]:
    if not expected_detection:
        return {
            "verdict": "safe",
            "confidence": 0.95,
            "attackFamily": "benign",
            "severity": "low",
            "reasoning": "请求结构与上下文一致，未发现明确攻击特征",
            "evidence": [],
            "recommendedAction": "allow",
        }

    sanitized_evidence_value, _redaction_count = redact_sensitive_text(payload)
    family_reasoning = {
        "sqli": "输入包含可改变查询语义的注入特征",
        "xss": "输入包含可在页面上下文执行脚本的特征",
        "command_injection": "输入包含可能触发命令或表达式执行的特征",
        "path_traversal": "输入包含越过预期资源目录的路径特征",
        "ssrf": "输入尝试让服务访问本地、私网或元数据地址",
        "authentication": "认证材料或访问行为包含明确的绕过与滥用特征",
        "automation": "请求行为与自动化扫描或资源耗尽攻击一致",
        "api_abuse": "API 调用方式、频率或参数组合体现滥用意图",
        "deserialization": "输入包含不可信对象反序列化或结构污染特征",
        "file_upload": "上传内容或文件名包含可执行与绕过校验特征",
        "protocol_attack": "请求违反协议边界并可能造成解析差异或服务异常",
        "business_logic": "请求参数违反关键业务约束并可能造成越权或资产损失",
        "other": "输入包含明确安全异常，但现有攻击家族不足以精确归类",
    }
    return {
        "verdict": "malicious",
        "confidence": 0.97 if severity in {"high", "critical"} else 0.93,
        "attackFamily": attack_family if attack_family in ATTACK_FAMILIES else "other",
        "severity": severity,
        "reasoning": family_reasoning.get(attack_family, family_reasoning["other"]),
        "evidence": [
            {
                "field": evidence_field,
                "value": sanitized_evidence_value[:240],
                "reason": "该字段包含与判定攻击家族一致的关键特征",
            }
        ],
        "recommendedAction": "block",
    }


def build_leakage_group(
    attack_family: str,
    cve: str | None,
    payload: str,
    scenario: str | None = None,
) -> tuple[str, str]:
    normalized_template = normalize_template_text(payload)
    similarity_hash = stable_hash(normalized_template)
    if cve:
        group_anchor = f"cve:{cve.lower()}"
    elif scenario:
        group_anchor = f"scenario:{scenario.lower()}"
    else:
        group_anchor = f"template:{similarity_hash}"
    return stable_hash(f"{attack_family}|{group_anchor}"), similarity_hash


def create_record(
    *,
    sample_id: str,
    detection_input: dict[str, Any],
    detection_output: dict[str, Any],
    label_category: str,
    provenance: str,
    source_dataset: str,
    source_file: str,
    original_type: str,
    payload_for_grouping: str,
    synthetic: bool,
    cve: str | None = None,
    scenario: str | None = None,
    generation_source: str | None = None,
) -> dict[str, Any]:
    leakage_group, similarity_hash = build_leakage_group(
        detection_output["attackFamily"], cve, payload_for_grouping, scenario
    )
    serialized_input = serialize_json(detection_input)
    serialized_output = serialize_json(detection_output)
    content_hash = stable_hash(f"{serialized_input}\n{serialized_output}")
    return {
        "sampleId": sample_id,
        "messages": build_messages(detection_input, detection_output),
        "metadata": {
            "labelCategory": label_category,
            "provenance": provenance,
            "synthetic": synthetic,
            "generationSource": generation_source or provenance,
            "sourceDataset": source_dataset,
            "sourceFile": source_file,
            "originalType": original_type,
            "cve": cve,
            "encoding": identify_encoding(payload_for_grouping),
            "attackFamily": detection_output["attackFamily"],
            "verdict": detection_output["verdict"],
            "contentHash": content_hash,
            "similarityHash": similarity_hash,
            "leakageGroup": leakage_group,
            "scenario": scenario,
        },
    }


def iter_raw_source_records(paths: BuildPaths, statistics: BuildStatistics) -> Iterable[tuple[dict[str, Any], Path, str]]:
    for source_dataset in SOURCE_DATASET_DIRECTORIES:
        dataset_directory = paths.source_root / source_dataset
        if not dataset_directory.is_dir():
            continue
        for source_file in sorted(dataset_directory.glob("*.json")):
            if source_file.name == "00_summary.json":
                continue
            statistics.raw_files_read += 1
            with source_file.open("r", encoding="utf-8") as input_file:
                loaded_value = json.load(input_file)
            if not isinstance(loaded_value, list):
                continue
            for raw_record in loaded_value:
                if isinstance(raw_record, dict):
                    statistics.raw_records_read += 1
                    statistics.field_presence.update(raw_record.keys())
                    statistics.source_dataset_records[source_dataset] += 1
                    yield raw_record, source_file, source_dataset


def convert_raw_record(
    raw_record: dict[str, Any],
    source_file: Path,
    source_dataset: str,
    paths: BuildPaths,
    statistics: BuildStatistics,
) -> dict[str, Any] | None:
    payload = raw_record.get("payload")
    original_type = raw_record.get("type")
    expected_detection = raw_record.get("expected_detection")
    if not isinstance(payload, str) or not isinstance(original_type, str) or not isinstance(expected_detection, bool):
        statistics.ambiguous_records_rejected += 1
        return None

    detection_input, evidence_field = convert_payload_to_input(
        original_type, payload, expected_detection, statistics
    )
    attack_family = map_attack_family(original_type, payload)
    severity = normalize_severity(raw_record.get("severity"), expected_detection)
    detection_output = build_labeled_output(
        expected_detection,
        attack_family,
        severity,
        evidence_field,
        payload,
    )
    label_category = "attack" if expected_detection else "normal"
    sample_id = str(raw_record.get("id") or stable_hash(f"{source_file}:{payload}")[:20])
    relative_source_file = source_file.relative_to(paths.repository_root).as_posix()
    return create_record(
        sample_id=f"raw-{sample_id}",
        detection_input=detection_input,
        detection_output=detection_output,
        label_category=label_category,
        provenance="tracked_synthetic_security_corpus",
        source_dataset=source_dataset,
        source_file=relative_source_file,
        original_type=original_type,
        payload_for_grouping=payload,
        synthetic=True,
        cve=str(raw_record["cve"]) if raw_record.get("cve") else None,
        generation_source="tracked_aetherguard_dataset",
    )


def normalize_existing_detection_input(
    detection_input: dict[str, Any], statistics: BuildStatistics
) -> dict[str, Any]:
    raw_source_context = detection_input.get("sourceContext")
    source_context = raw_source_context if isinstance(raw_source_context, dict) else {}
    normalized_source_context = {
        key: value for key, value in source_context.items() if key in SAFE_SOURCE_CONTEXT_KEYS
    }
    normalized_source_context.setdefault("requestsLastMinute", 0)
    normalized_source_context.setdefault("distinctPathsLastMinute", 0)
    normalized_source_context.setdefault("recentFailureCount", 0)

    raw_headers = detection_input.get("headers")
    normalized_headers = sanitize_headers(raw_headers if isinstance(raw_headers, dict) else {}, statistics)
    raw_rule_signals = detection_input.get("ruleSignals")
    normalized_rule_signals = []
    if isinstance(raw_rule_signals, list):
        for rule_signal in raw_rule_signals:
            if not isinstance(rule_signal, dict):
                continue
            if not all(required_key in rule_signal for required_key in ("ruleId", "score", "field", "description")):
                continue
            normalized_rule_signals.append(
                {
                    "ruleId": str(rule_signal["ruleId"])[:160],
                    "score": max(0.0, min(1.0, float(rule_signal["score"]))),
                    "field": str(rule_signal["field"])[:160],
                    "description": str(rule_signal["description"])[:500],
                }
            )

    raw_body, body_redactions = redact_sensitive_text(str(detection_input.get("body", "")))
    raw_query, query_redactions = redact_sensitive_text(str(detection_input.get("query", "")))
    statistics.redactions_applied += body_redactions + query_redactions
    method = str(detection_input.get("method", "EVENT")).upper()
    if method not in HTTP_METHODS | {"EVENT"}:
        method = "EVENT"
    return {
        "method": method,
        "path": str(detection_input.get("path") or "/")[:2048],
        "query": raw_query[:8192],
        "headers": normalized_headers,
        "body": raw_body[:32768],
        "sourceContext": normalized_source_context,
        "ruleSignals": normalized_rule_signals[:100],
    }


def load_existing_sft_records(paths: BuildPaths, statistics: BuildStatistics) -> list[dict[str, Any]]:
    converted_records: list[dict[str, Any]] = []
    if not paths.existing_sft_path.is_file():
        return converted_records
    with paths.existing_sft_path.open("r", encoding="utf-8") as input_file:
        for line_number, raw_line in enumerate(input_file, start=1):
            if not raw_line.strip():
                continue
            statistics.existing_sft_records_read += 1
            try:
                loaded_record = json.loads(raw_line)
                messages = loaded_record["messages"]
                user_message = next(message for message in messages if message.get("role") == "user")
                assistant_message = next(message for message in messages if message.get("role") == "assistant")
                detection_input = normalize_existing_detection_input(json.loads(user_message["content"]), statistics)
                detection_output = parse_strict_json_object(assistant_message["content"])
            except (KeyError, StopIteration, TypeError, ValueError, json.JSONDecodeError):
                statistics.ambiguous_records_rejected += 1
                continue
            if validate_detection_input(detection_input) or validate_detection_output(detection_output):
                statistics.schema_records_rejected += 1
                continue

            source_metadata = loaded_record.get("metadata") if isinstance(loaded_record.get("metadata"), dict) else {}
            generation_type = str(source_metadata.get("generationType") or "existing_sft")
            scenario = str(source_metadata.get("scenario") or f"line-{line_number}")
            verdict = detection_output["verdict"]
            attack_like_content = any(
                token in serialize_json(detection_input).lower()
                for token in ("<script", "union select", "../", "etc/passwd", "jndi:", "$(", "localhost")
            )
            if verdict == "unknown":
                label_category = "unknown"
            elif verdict == "safe" and (generation_type == "rule_false_positive" or attack_like_content):
                label_category = "hard_negative"
            elif verdict == "safe":
                label_category = "normal"
            else:
                label_category = "attack"
            grouping_payload = serialize_json(detection_input)
            converted_records.append(
                create_record(
                    sample_id=str(loaded_record.get("sampleId") or f"existing-sft-{line_number:06d}"),
                    detection_input=detection_input,
                    detection_output=detection_output,
                    label_category=label_category,
                    provenance="tracked_sft_batch",
                    source_dataset="aetherguard-sft-batch-001",
                    source_file=paths.existing_sft_path.relative_to(paths.repository_root).as_posix(),
                    original_type=generation_type,
                    payload_for_grouping=grouping_payload,
                    synthetic=True,
                    scenario=scenario,
                    generation_source=str(source_metadata.get("labelSource") or "synthetic_teacher"),
                )
            )
    return converted_records


def generate_synthetic_normal_records() -> list[dict[str, Any]]:
    scenarios = [
        ("health_check", "GET", "/health", "", ""),
        ("static_asset", "GET", "/static/app.js", "version={variant}", ""),
        ("product_lookup", "GET", "/products", "id={variant}", ""),
        ("ordinary_search", "GET", "/search", "q=wireless+keyboard&page={variant}", ""),
        ("create_order", "POST", "/api/orders", "", '{"productId":"SKU-{variant}","quantity":1}'),
        ("profile_update", "PATCH", "/api/profile", "", '{"displayName":"Synthetic User {variant}"}'),
        ("signed_webhook", "POST", "/webhooks/payment", "", '{"event":"payment.success","id":"evt-{variant}"}'),
        ("session_logout", "DELETE", "/api/sessions/current", "", ""),
        ("metrics_scrape", "GET", "/internal/metrics", "format=prometheus", ""),
        ("csv_export", "GET", "/api/reports/export", "format=csv&page={variant}", ""),
        ("documentation", "GET", "/docs/api", "section=authentication", ""),
        ("image_resize", "GET", "/images/logo.png", "width=200&height=200", ""),
        ("feature_flag", "PUT", "/api/preferences", "", '{"compactView":true,"pageSize":{variant}}'),
        ("inventory_read", "GET", "/api/inventory", "warehouse=west&limit={variant}", ""),
    ]
    generated_records: list[dict[str, Any]] = []
    for scenario_index, (scenario, method, path, query_template, body_template) in enumerate(scenarios):
        for variant_index in range(1, 41):
            formatted_query = query_template.replace("{variant}", str(variant_index))
            formatted_body = body_template.replace("{variant}", str(variant_index))
            detection_input = {
                "method": method,
                "path": path,
                "query": formatted_query,
                "headers": {
                    "Host": "example.invalid",
                    "Accept": "application/json",
                    "X-Synthetic-Request": f"normal-{scenario_index}-{variant_index}",
                },
                "body": formatted_body,
                "sourceContext": {
                    "requestsLastMinute": 1 + (variant_index % 8),
                    "distinctPathsLastMinute": 1 + (variant_index % 3),
                    "recentFailureCount": 0,
                    "historicalRiskScore": 0.02,
                    "authenticated": scenario not in {"health_check", "static_asset", "documentation"},
                    "openApiMatched": True,
                },
                "ruleSignals": [],
            }
            detection_output = {
                "verdict": "safe",
                "confidence": 0.97,
                "attackFamily": "benign",
                "severity": "low",
                "reasoning": "请求符合接口用途与正常访问上下文，未发现明确攻击特征",
                "evidence": [],
                "recommendedAction": "allow",
            }
            generated_records.append(
                create_record(
                    sample_id=f"synthetic-normal-{scenario_index:02d}-{variant_index:03d}",
                    detection_input=detection_input,
                    detection_output=detection_output,
                    label_category="normal",
                    provenance="generated_auxiliary",
                    source_dataset="synthetic_normal_v1",
                    source_file="ml/scripts/build_dataset.py",
                    original_type="normal",
                    payload_for_grouping=f"{method} {path}?{formatted_query}\n{formatted_body}",
                    synthetic=True,
                    scenario=scenario,
                    generation_source="deterministic_template_v1",
                )
            )
    return generated_records


def generate_hard_negative_records() -> list[dict[str, Any]]:
    scenarios = [
        ("article_union_select", "/cms/articles", "技术文章示例解释 UNION SELECT 语法，不会提交到数据库"),
        ("search_script_literal", "/search", "用户搜索文本：<script>alert('training')</script>"),
        ("log_payload_display", "/logs/view", "日志只读展示：../../etc/passwd 与 ' OR 1=1 --"),
        ("repository_shell_example", "/repositories/examples", "代码示例字符串：$(id); cat /etc/passwd"),
        ("security_tutorial_passwd", "/training/path-traversal", "教学页面展示 ../../etc/passwd 作为需阻断的例子"),
        ("authorized_localhost_probe", "/internal/health/probe", "合法运维探针访问 http://127.0.0.1:3005/health"),
        ("admin_sql_keywords", "/admin/query-library", "管理员保存只读模板 SELECT id FROM users WHERE active = 1"),
        ("xss_unit_test_fixture", "/ci/tests/fixtures", "单元测试夹具 <img src=x onerror=alert('synthetic')>，期望转义"),
        ("encoded_payload_documentation", "/docs/encoding", "文档展示 %252e%252e%252f 的双重编码检测方法"),
        ("jwt_security_fixture", "/ci/jwt/fixtures", "测试令牌头 eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0 仅用于验证拒绝逻辑"),
        ("deserialization_advisory", "/advisories/deserialization", "公告正文包含 rO0ABXNy 与反序列化风险说明"),
        ("file_upload_signature_docs", "/docs/upload-policy", "策略文档列出 file.php%00.jpg 作为禁止文件名"),
        ("ssrf_allowlisted_service", "/service-catalog/check", "已登记服务调用 http://localhost:9090/-/ready，目标在 allowlist"),
        ("command_rule_editor", "/rules/command-injection", "规则编辑器保存正则以识别 ; whoami 和 | id 字符串"),
    ]
    generated_records: list[dict[str, Any]] = []
    for scenario_index, (scenario, path, content) in enumerate(scenarios):
        for variant_index in range(1, 31):
            detection_input = {
                "method": "POST",
                "path": path,
                "query": "",
                "headers": {
                    "Host": "internal.example.invalid",
                    "Content-Type": "application/json",
                    "X-Synthetic-Request": f"hard-negative-{scenario_index}-{variant_index}",
                },
                "body": serialize_json(
                    {
                        "content": content,
                        "documentRevision": variant_index,
                        "executionEnabled": False,
                    }
                ),
                "sourceContext": {
                    "requestsLastMinute": 2 + (variant_index % 6),
                    "distinctPathsLastMinute": 1,
                    "recentFailureCount": 0,
                    "historicalRiskScore": 0.03,
                    "authenticated": True,
                    "accountPrivilege": "security_editor",
                    "internalService": True,
                    "assetType": "documentation_or_test_fixture",
                    "openApiMatched": True,
                },
                "ruleSignals": [
                    {
                        "ruleId": "AG-CONTEXT-WEAK-001",
                        "score": 0.28,
                        "field": "body",
                        "description": "正文含攻击字面量，但上下文可能是文档、日志或测试夹具",
                    }
                ],
            }
            detection_output = {
                "verdict": "safe",
                "confidence": 0.94,
                "attackFamily": "benign",
                "severity": "low",
                "reasoning": "攻击字符串位于不可执行的文档、日志或测试上下文，且调用者与接口用途一致",
                "evidence": [
                    {
                        "field": "sourceContext.assetType",
                        "value": "documentation_or_test_fixture",
                        "reason": "内容被明确标记为不可执行的文档或测试资产",
                    }
                ],
                "recommendedAction": "allow",
            }
            generated_records.append(
                create_record(
                    sample_id=f"synthetic-hard-negative-{scenario_index:02d}-{variant_index:03d}",
                    detection_input=detection_input,
                    detection_output=detection_output,
                    label_category="hard_negative",
                    provenance="generated_auxiliary",
                    source_dataset="synthetic_hard_negative_v1",
                    source_file="ml/scripts/build_dataset.py",
                    original_type="hard_negative",
                    payload_for_grouping=content,
                    synthetic=True,
                    scenario=scenario,
                    generation_source="deterministic_template_v1",
                )
            )
    return generated_records


def generate_unknown_records() -> list[dict[str, Any]]:
    scenarios = [
        ("truncated_request", "请求在头部中途截断，缺少目标与正文"),
        ("opaque_encrypted_body", "正文为无法解码的应用层密文，缺少协议元数据"),
        ("missing_rule_context", "仅收到孤立规则编号，无法确认命中字段"),
        ("ambiguous_rate_spike", "请求速率升高但没有身份、端点或历史基线"),
        ("partial_auth_event", "认证事件缺少结果状态和账号标识"),
        ("unknown_binary_protocol", "未知二进制协议片段被转成占位文本"),
        ("conflicting_rule_signals", "两个低置信度规则分别指向正常与异常"),
        ("empty_security_event", "安全事件只有时间戳占位，无可判定载荷"),
        ("redacted_for_privacy", "关键字段因隐私策略全部脱敏，无法恢复语义"),
        ("unsupported_compression", "正文使用当前解析器不支持的压缩格式"),
    ]
    generated_records: list[dict[str, Any]] = []
    for scenario_index, (scenario, description) in enumerate(scenarios):
        for variant_index in range(1, 25):
            detection_input = {
                "method": "EVENT",
                "path": f"/security/ambiguous/{scenario}",
                "query": "",
                "headers": {"X-Synthetic-Request": f"unknown-{scenario_index}-{variant_index}"},
                "body": f"{description}；片段编号 {variant_index}",
                "sourceContext": {
                    "requestsLastMinute": variant_index % 12,
                    "distinctPathsLastMinute": 0,
                    "recentFailureCount": 0,
                },
                "ruleSignals": [],
            }
            detection_output = {
                "verdict": "unknown",
                "confidence": 0.32,
                "attackFamily": "other",
                "severity": "medium",
                "reasoning": "现有输入缺少完成安全判定所需的请求语义或上下文，不能视为安全",
                "evidence": [
                    {
                        "field": "body",
                        "value": description,
                        "reason": "该片段明确说明关键判定信息缺失",
                    }
                ],
                "recommendedAction": "monitor",
            }
            generated_records.append(
                create_record(
                    sample_id=f"synthetic-unknown-{scenario_index:02d}-{variant_index:03d}",
                    detection_input=detection_input,
                    detection_output=detection_output,
                    label_category="unknown",
                    provenance="generated_auxiliary",
                    source_dataset="synthetic_unknown_v1",
                    source_file="ml/scripts/build_dataset.py",
                    original_type="unknown",
                    payload_for_grouping=description,
                    synthetic=True,
                    scenario=scenario,
                    generation_source="deterministic_template_v1",
                )
            )
    return generated_records


def deduplicate_records(
    records: Iterable[dict[str, Any]], statistics: BuildStatistics
) -> list[dict[str, Any]]:
    deduplicated_records: list[dict[str, Any]] = []
    observed_content_hashes: set[str] = set()
    for record in records:
        content_hash = record["metadata"]["contentHash"]
        if content_hash in observed_content_hashes:
            statistics.exact_duplicates_removed += 1
            continue
        observed_content_hashes.add(content_hash)
        deduplicated_records.append(record)
    return deduplicated_records


def deterministic_score(record: dict[str, Any], seed: int) -> str:
    return stable_hash(f"{seed}|{record['sampleId']}|{record['metadata']['contentHash']}")


def select_family_balanced_records(
    records: list[dict[str, Any]], target_count: int, seed: int
) -> list[dict[str, Any]]:
    if len(records) <= target_count:
        return sorted(records, key=lambda record: deterministic_score(record, seed))
    records_by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        records_by_family[record["metadata"]["attackFamily"]].append(record)
    for family_records in records_by_family.values():
        family_records.sort(key=lambda record: deterministic_score(record, seed))

    selected_records: list[dict[str, Any]] = []
    family_names = sorted(records_by_family)
    while len(selected_records) < target_count:
        selected_in_round = False
        for family_name in family_names:
            family_records = records_by_family[family_name]
            if family_records and len(selected_records) < target_count:
                selected_records.append(family_records.pop())
                selected_in_round = True
        if not selected_in_round:
            break
    return selected_records


def select_category_records(
    records: list[dict[str, Any]], target_count: int, seed: int, prioritize_tracked: bool
) -> list[dict[str, Any]]:
    if len(records) <= target_count:
        return sorted(records, key=lambda record: deterministic_score(record, seed))
    sorted_records = sorted(
        records,
        key=lambda record: (
            0 if prioritize_tracked and record["metadata"]["provenance"] != "generated_auxiliary" else 1,
            deterministic_score(record, seed),
        ),
    )
    return sorted_records[:target_count]


def balance_categories(
    records: list[dict[str, Any]], target_samples: int, seed: int
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    records_by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        records_by_category[record["metadata"]["labelCategory"]].append(record)
    target_counts = {
        category: round(target_samples * ratio) for category, ratio in TARGET_CATEGORY_RATIOS.items()
    }
    target_counts["attack"] += target_samples - sum(target_counts.values())

    selected_records: list[dict[str, Any]] = []
    shortages: dict[str, int] = {}
    for category, target_count in target_counts.items():
        category_records = records_by_category.get(category, [])
        if category == "attack":
            selected_category_records = select_family_balanced_records(category_records, target_count, seed)
        else:
            selected_category_records = select_category_records(
                category_records,
                target_count,
                seed,
                prioritize_tracked=category in {"normal", "hard_negative"},
            )
        selected_records.extend(selected_category_records)
        shortages[category] = max(0, target_count - len(selected_category_records))
    return selected_records, shortages


def assign_grouped_splits(records: list[dict[str, Any]], seed: int) -> dict[str, list[dict[str, Any]]]:
    records_by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        records_by_group[record["metadata"]["leakageGroup"]].append(record)

    groups_by_stratum: dict[tuple[str, str], list[list[dict[str, Any]]]] = defaultdict(list)
    for group_records in records_by_group.values():
        representative_metadata = group_records[0]["metadata"]
        stratum = (representative_metadata["labelCategory"], representative_metadata["attackFamily"])
        groups_by_stratum[stratum].append(group_records)

    split_records: dict[str, list[dict[str, Any]]] = {split_name: [] for split_name in SPLIT_RATIOS}
    for stratum, stratum_groups in sorted(groups_by_stratum.items()):
        random_generator = random.Random(stable_hash(f"{seed}|{stratum}"))
        random_generator.shuffle(stratum_groups)
        total_stratum_records = sum(len(group_records) for group_records in stratum_groups)
        target_by_split = {
            split_name: total_stratum_records * split_ratio
            for split_name, split_ratio in SPLIT_RATIOS.items()
        }
        assigned_by_split = Counter()
        for group_records in sorted(stratum_groups, key=len, reverse=True):
            split_name = max(
                SPLIT_RATIOS,
                key=lambda candidate_split: (
                    target_by_split[candidate_split] - assigned_by_split[candidate_split],
                    SPLIT_RATIOS[candidate_split],
                ),
            )
            for record in group_records:
                record["metadata"]["split"] = split_name
            split_records[split_name].extend(group_records)
            assigned_by_split[split_name] += len(group_records)

    for split_name, records_in_split in split_records.items():
        records_in_split.sort(key=lambda record: deterministic_score(record, seed))
    return split_records


def validate_records(records: list[dict[str, Any]], statistics: BuildStatistics) -> list[dict[str, Any]]:
    valid_records: list[dict[str, Any]] = []
    for record in records:
        try:
            user_message = next(message for message in record["messages"] if message["role"] == "user")
            assistant_message = next(message for message in record["messages"] if message["role"] == "assistant")
            detection_input = json.loads(user_message["content"])
            detection_output = parse_strict_json_object(assistant_message["content"])
        except (KeyError, StopIteration, TypeError, ValueError, json.JSONDecodeError):
            statistics.schema_records_rejected += 1
            continue
        if validate_detection_input(detection_input) or validate_detection_output(detection_output):
            statistics.schema_records_rejected += 1
            continue
        valid_records.append(record)
    return valid_records


def calculate_distribution(records: Iterable[dict[str, Any]], metadata_key: str) -> dict[str, int]:
    distribution = Counter(record["metadata"].get(metadata_key) or "null" for record in records)
    return dict(sorted(distribution.items()))


def calculate_leakage(split_records: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    leakage_groups_by_split = {
        split_name: {record["metadata"]["leakageGroup"] for record in records}
        for split_name, records in split_records.items()
    }
    content_hashes_by_split = {
        split_name: {record["metadata"]["contentHash"] for record in records}
        for split_name, records in split_records.items()
    }
    pairwise_results: dict[str, dict[str, int]] = {}
    split_names = list(split_records)
    for left_index, left_split in enumerate(split_names):
        for right_split in split_names[left_index + 1 :]:
            pair_name = f"{left_split}_vs_{right_split}"
            pairwise_results[pair_name] = {
                "sharedLeakageGroups": len(
                    leakage_groups_by_split[left_split] & leakage_groups_by_split[right_split]
                ),
                "sharedExactContentHashes": len(
                    content_hashes_by_split[left_split] & content_hashes_by_split[right_split]
                ),
            }
    leakage_detected = any(
        pair_result["sharedLeakageGroups"] or pair_result["sharedExactContentHashes"]
        for pair_result in pairwise_results.values()
    )
    return {"detected": leakage_detected, "pairwise": pairwise_results}


def write_jsonl(output_path: Path, records: Iterable[dict[str, Any]]) -> None:
    with output_path.open("w", encoding="utf-8", newline="\n") as output_file:
        for record in records:
            output_file.write(serialize_json(record))
            output_file.write("\n")


def write_outputs(
    paths: BuildPaths,
    split_records: dict[str, list[dict[str, Any]]],
    statistics: BuildStatistics,
    shortages: dict[str, int],
    seed: int,
    target_samples: int,
) -> dict[str, Any]:
    paths.processed_directory.mkdir(parents=True, exist_ok=True)
    paths.manifest_directory.mkdir(parents=True, exist_ok=True)
    paths.reports_directory.mkdir(parents=True, exist_ok=True)
    for split_name, records_in_split in split_records.items():
        write_jsonl(paths.processed_directory / f"{split_name}.jsonl", records_in_split)

    all_records = [record for records_in_split in split_records.values() for record in records_in_split]
    leakage_result = calculate_leakage(split_records)
    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "seed": seed,
        "requestedSamples": target_samples,
        "actualSamples": len(all_records),
        "sourceRoot": paths.source_root.relative_to(paths.repository_root).as_posix(),
        "sourceCorpusIsSynthetic": True,
        "categoryTargetRatios": TARGET_CATEGORY_RATIOS,
        "splitTargetRatios": SPLIT_RATIOS,
        "categoryShortages": shortages,
        "counts": {
            "bySplit": {split_name: len(records) for split_name, records in split_records.items()},
            "byCategory": calculate_distribution(all_records, "labelCategory"),
            "byAttackFamily": calculate_distribution(all_records, "attackFamily"),
            "bySourceDataset": calculate_distribution(all_records, "sourceDataset"),
            "byProvenance": calculate_distribution(all_records, "provenance"),
            "byEncoding": calculate_distribution(all_records, "encoding"),
        },
        "sourceInspection": {
            "rawFilesRead": statistics.raw_files_read,
            "rawRecordsRead": statistics.raw_records_read,
            "existingSftRecordsRead": statistics.existing_sft_records_read,
            "redactionsApplied": statistics.redactions_applied,
            "exactDuplicatesRemoved": statistics.exact_duplicates_removed,
            "ambiguousRecordsRejected": statistics.ambiguous_records_rejected,
            "schemaRecordsRejected": statistics.schema_records_rejected,
            "sourceDatasetRecords": dict(sorted(statistics.source_dataset_records.items())),
            "requestedFieldPresence": {
                field_name: statistics.field_presence[field_name]
                for field_name in (
                    "payload",
                    "type",
                    "expected_detection",
                    "severity",
                    "source_ip",
                    "pattern",
                    "cve",
                    "method",
                    "path",
                    "headers",
                    "body",
                    "query",
                )
            },
        },
        "grouping": {
            "factors": [
                "decoded and normalized payload template",
                "attack family (stratification)",
                "CVE (single leakage group when present)",
                "encoding form",
                "generation source and scenario",
                "exact content hash",
                "similarity hash",
            ],
            "leakageGroups": len({record["metadata"]["leakageGroup"] for record in all_records}),
            "similarityGroups": len({record["metadata"]["similarityHash"] for record in all_records}),
        },
        "leakageCheck": leakage_result,
        "files": {
            split_name: (paths.processed_directory / f"{split_name}.jsonl").relative_to(paths.repository_root).as_posix()
            for split_name in split_records
        },
    }
    manifest_path = paths.manifest_directory / "dataset-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    category_counts = manifest["counts"]["byCategory"]
    split_count_lines = "\n".join(
        f"- `{split_name}`: {split_count}"
        for split_name, split_count in manifest["counts"]["bySplit"].items()
    )
    category_count_lines = "\n".join(
        f"- `{category}`: {count} ({count / max(1, len(all_records)):.2%})"
        for category, count in category_counts.items()
    )
    report_text = f"""# AetherGuard 训练数据报告

生成时间：`{manifest['generatedAt']}`  
固定随机种子：`{seed}`

## 结果

- 请求样本数：{target_samples}
- 实际样本数：{len(all_records)}
- 原始源记录：{statistics.raw_records_read}
- 复用的已跟踪 SFT 记录：{statistics.existing_sft_records_read}
- 精确重复移除：{statistics.exact_duplicates_removed}
- Schema 拒绝：{statistics.schema_records_rejected}
- 标签不明确拒绝：{statistics.ambiguous_records_rejected}
- 脱敏替换：{statistics.redactions_applied}

## 切分

{split_count_lines}

## 类别比例

{category_count_lines}

仓库原始安全语料本身是合成测试数据；报告中的 `tracked_synthetic_security_corpus`
表示从已跟踪语料转换而来，不代表生产真实流量。辅助正常、硬负与 unknown 样本均明确标记
为 `generated_auxiliary`，未伪装成真实数据。

## 防泄漏

- 分组键同时考虑规范化 payload 模板、CVE、场景、攻击家族和相似内容哈希。
- 同一 CVE 的记录被绑定到同一 leakage group。
- URL 多次解码、Unicode NFKC、数字/IP/长 opaque token 归一化后再计算相似哈希。
- 跨 split leakage group 重叠：`{leakage_result['detected']}`。
- 详细 pairwise 结果见 `ml/data/manifests/dataset-manifest.json`。

## 输入字段检查

原始 JSON 数组的主要字段为 `id`、`type`、`payload`、`severity`、
`expected_detection`、`source_ip`、`timestamp`；部分 zeroday 文件包含 `cve`。
原始记录通常不直接含 `method`、`path`、`headers`、`body`、`query`，脚本从完整 HTTP
payload 解析这些字段，或将孤立 payload 转为标准安全事件。`source_ip` 不写入训练样本。

## 限制

- 标签继承自合成测试语料及明确的确定性辅助模板，尚未经过独立双人安全标注。
- 相似度分组是保守的规范化哈希，不等价于语义嵌入聚类。
- 类别目标受可用且通过 Schema 的样本池约束；不足量记录在 manifest 的
  `categoryShortages` 中。
"""
    (paths.reports_directory / "dataset-report.md").write_text(report_text, encoding="utf-8")
    return manifest


def main() -> int:
    arguments = parse_arguments()
    if arguments.target_samples < 100:
        raise ValueError("--target-samples must be at least 100")
    paths = resolve_build_paths(arguments.source_root)
    if not paths.source_root.is_dir():
        raise FileNotFoundError(f"source dataset directory not found: {paths.source_root}")

    statistics = BuildStatistics()
    raw_records = [
        converted_record
        for raw_record, source_file, source_dataset in iter_raw_source_records(paths, statistics)
        if (
            converted_record := convert_raw_record(
                raw_record, source_file, source_dataset, paths, statistics
            )
        )
        is not None
    ]
    existing_sft_records = load_existing_sft_records(paths, statistics)
    generated_records = (
        generate_synthetic_normal_records()
        + generate_hard_negative_records()
        + generate_unknown_records()
    )
    all_candidate_records = validate_records(
        deduplicate_records(raw_records + existing_sft_records + generated_records, statistics),
        statistics,
    )
    balanced_records, shortages = balance_categories(
        all_candidate_records, arguments.target_samples, arguments.seed
    )
    split_records = assign_grouped_splits(balanced_records, arguments.seed)
    manifest = write_outputs(
        paths,
        split_records,
        statistics,
        shortages,
        arguments.seed,
        arguments.target_samples,
    )
    print(json.dumps(manifest["counts"], ensure_ascii=False, indent=2))
    print(json.dumps(manifest["leakageCheck"], ensure_ascii=False, indent=2))
    return 1 if manifest["leakageCheck"]["detected"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
