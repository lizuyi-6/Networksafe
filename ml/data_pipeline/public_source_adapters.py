#!/usr/bin/env python3
"""Deterministic adapters for approved public AetherArgus training sources."""

from __future__ import annotations

import csv
import io
import json
import re
import tarfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode, urlsplit

import yaml

from common import (
    count_distribution,
    make_output,
    make_record,
    normalize_text,
    stable_hash,
    stable_json,
    validate_record,
)
from fetch_public_sources import load_registry, validate_cached_artifact
from generate_candidates import sanitize_network_indicators


PUBLIC_PROVENANCE = "public_open_source_derived"
PUBLIC_GENERATOR = "deterministic-public-adapter"
ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
RISK_PATTERNS = (
    re.compile(r"(?i)\b(?:ransomware|malware|keylogger|reverse\s+shell|credential\s+harvest)\b"),
    re.compile(r"(?i)\b(?:steal|exfiltrat\w*)\b.{0,80}\b(?:credential|password|token|secret|key)\b"),
    re.compile(r"(?i)\brm\s+-rf\b"),
    re.compile(r"(?i)\b(?:curl|wget|netcat|nc|ssh|scp)\b.{0,100}\bhttps?://"),
    re.compile(r"(?i)\b(?:persistence|autorun|startup)\b.{0,80}\b(?:install|create|write|modify)\b"),
)
INJECTION_MARKERS = re.compile(
    r"(?i)(ignore|disregard|forget|reveal|disclose|system\s+prompt|hidden\s+prompt|"
    r"configuration|guideline|directive|instruction|unrestricted|bypass|jailbreak|"
    r"pretend|role|policy|rules|do\s+not\s+output|previous\s+instructions)"
)
HARD_NEGATIVE_MARKERS = re.compile(
    r"(?i)(prompt|instruction|ignore|system|configuration|guideline|jailbreak|bypass|"
    r"hidden|reveal|security|guardrail|output\s+validation|AI\s+safety)"
)


CRS_FAMILY_PREFIXES = {
    "REQUEST-913": "automation",
    "REQUEST-920": "protocol_attack",
    "REQUEST-921": "protocol_attack",
    "REQUEST-922": "file_upload",
    "REQUEST-930": "path_traversal",
    "REQUEST-931": "ssrf",
    "REQUEST-932": "command_injection",
    "REQUEST-933": "command_injection",
    "REQUEST-934": "other",
    "REQUEST-941": "xss",
    "REQUEST-942": "sqli",
    "REQUEST-943": "authentication",
    "REQUEST-944": "deserialization",
}


def source_metadata(record: dict[str, Any], source: dict[str, Any], *, upstream_split: str) -> None:
    metadata = record["metadata"]
    metadata["generatorModel"] = PUBLIC_GENERATOR
    metadata["generatorPromptVersion"] = "public-sources-v01"
    metadata["sourceLicense"] = source["license"]
    metadata["sourceRevision"] = source["revision"]
    metadata["sourceHomepage"] = source["homepage"]
    metadata["licenseEvidence"] = source["licenseEvidence"]
    metadata["upstreamSplit"] = upstream_split


def common_context(*, authenticated: bool, endpoint_sensitivity: str) -> dict[str, Any]:
    return {
        "requestsLastMinute": 2,
        "distinctPathsLastMinute": 1,
        "recentFailureCount": 0,
        "historicalRiskScore": 0.05 if authenticated else 0.35,
        "authenticated": authenticated,
        "accountPrivilege": "user" if authenticated else "anonymous",
        "internalService": False,
        "endpointSensitivity": endpoint_sensitivity,
        "openApiMatched": True,
        "distinctUsernamesLastMinute": 1,
        "sessionAgeSeconds": 900 if authenticated else 0,
        "geoConsistency": True,
        "statusCodeHistory": [200, 200],
    }


def source_artifact(root: Path, config: dict[str, Any], source: dict[str, Any]) -> Path:
    cache_root = root / str(config["public_sources"]["cache_dir"])
    path = cache_root / str(source["artifact"]["cachePath"])
    validate_cached_artifact(path, source["artifact"])
    return path


def family_for_crs_member(member_name: str) -> str | None:
    directory = Path(member_name).parent.name
    return next(
        (family for prefix, family in CRS_FAMILY_PREFIXES.items() if directory.startswith(prefix)),
        None,
    )


def normalize_headers(raw_headers: Any) -> dict[str, str]:
    headers: dict[str, str] = {}
    if isinstance(raw_headers, dict):
        items = raw_headers.items()
    elif isinstance(raw_headers, list):
        parsed = []
        for item in raw_headers:
            name, separator, value = str(item).partition(":")
            if separator:
                parsed.append((name.strip(), value.strip()))
        items = parsed
    else:
        items = []
    for name, value in items:
        clean_name = str(name)[:256]
        clean_value = value if isinstance(value, str) else stable_json(value)
        headers[clean_name] = sanitize_network_indicators(clean_value)[:8192]
        if len(headers) == 99:
            break
    headers["Host"] = "test.local"
    return headers


def request_parts(raw_input: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    method = str(raw_input.get("method") or "GET").upper()
    if method not in ALLOWED_METHODS:
        return None, "unsupported_method"
    raw_uri = sanitize_network_indicators(str(raw_input.get("uri") or "/"))
    if raw_uri.startswith(("http://", "https://")):
        parsed = urlsplit(raw_uri)
        path = parsed.path or "/"
        query = parsed.query
    else:
        path, separator, query = raw_uri.partition("?")
        if not separator:
            query = ""
    if not path.startswith("/"):
        path = "/" + path
    raw_data = raw_input.get("data")
    if raw_data is None:
        body = ""
    elif isinstance(raw_data, str):
        body = raw_data
    else:
        body = stable_json(raw_data)
    body = sanitize_network_indicators(body)
    if len(path) > 2048:
        return None, "path_too_long"
    if len(query) > 8192:
        return None, "query_too_long"
    if len(body) > 32768:
        return None, "body_too_long"
    headers = normalize_headers(raw_input.get("headers"))
    if body and not any(name.lower() == "content-type" for name in headers):
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if body:
        evidence_field, evidence_value = "body", body
    elif query:
        evidence_field, evidence_value = "query", query
    elif path != "/":
        evidence_field, evidence_value = "path", path
    else:
        evidence_field = "headers.User-Agent" if "User-Agent" in headers else "headers.Host"
        evidence_value = headers.get("User-Agent", headers["Host"])
    return (
        {
            "method": method,
            "path": path,
            "query": query,
            "headers": headers,
            "body": body,
            "evidenceField": evidence_field,
            "evidenceValue": evidence_value,
        },
        None,
    )


def normalized_rule_ids(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if value is None:
        return []
    return [str(value)]


def adapt_owasp_crs(
    root: Path,
    config: dict[str, Any],
    source: dict[str, Any],
    seed: int,
    *,
    smoke: bool,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    archive = source_artifact(root, config, source)
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    rejected = Counter()
    positive_stages = 0
    with tarfile.open(archive, "r:gz") as handle:
        members = sorted(
            (
                member
                for member in handle.getmembers()
                if member.isfile()
                and "/tests/regression/tests/" in member.name
                and member.name.endswith((".yaml", ".yml"))
            ),
            key=lambda member: member.name,
        )
        for member in members:
            family = family_for_crs_member(member.name)
            if family is None:
                continue
            extracted = handle.extractfile(member)
            if extracted is None:
                rejected["unreadable_member"] += 1
                continue
            document = yaml.safe_load(extracted.read().decode("utf-8")) or {}
            for test in document.get("tests") or []:
                for stage_index, stage in enumerate(test.get("stages") or []):
                    log_output = ((stage.get("output") or {}).get("log") or {})
                    if not isinstance(log_output, dict):
                        rejected["invalid_log_output"] += 1
                        continue
                    rule_ids = normalized_rule_ids(log_output.get("expect_ids"))
                    if not rule_ids:
                        rejected["not_positive_expect_ids"] += 1
                        continue
                    positive_stages += 1
                    parts, problem = request_parts(stage.get("input") or {})
                    if problem or parts is None:
                        rejected[str(problem)] += 1
                        continue
                    relative_file = member.name.split("/", 1)[-1]
                    source_sample_id = (
                        f"{source['id']}:{source['revision']}:{relative_file}:"
                        f"{test.get('test_id', 'missing')}:{stage_index}"
                    )
                    rule_id_text = ",".join(rule_ids[:8])
                    detection_input = {
                        "method": parts["method"],
                        "path": parts["path"],
                        "query": parts["query"],
                        "headers": parts["headers"],
                        "body": parts["body"],
                        "sourceContext": common_context(
                            authenticated=False,
                            endpoint_sensitivity="high",
                        ),
                        "ruleSignals": [
                            {
                                "ruleId": f"OWASP-CRS-{rule_ids[0]}"[:128],
                                "score": 0.98,
                                "field": parts["evidenceField"],
                                "description": "上游 Apache-2.0 回归用例明确要求对应 CRS 规则命中",
                            }
                        ],
                    }
                    detection_output = make_output(
                        verdict="malicious",
                        family=family,
                        severity="high",
                        reasoning=(
                            "OWASP CRS 正向回归用例明确要求安全规则命中；请求字段已映射并保留可定位证据"
                        ),
                        evidence=[
                            {
                                "field": parts["evidenceField"],
                                "value": parts["evidenceValue"],
                                "reason": f"上游回归用例期望规则 {rule_id_text} 命中",
                            }
                        ],
                        action="block",
                        confidence=0.97,
                    )
                    record = make_record(
                        sample_id=f"v02-public-crs-{stable_hash(source_sample_id)[:24]}",
                        detection_input=detection_input,
                        detection_output=detection_output,
                        config=config,
                        label_category="attack",
                        source_sample_id=source_sample_id,
                        generation_type="public_waf_regression_mapping",
                        transformations=[
                            "positive_expect_ids_filter",
                            "http_request_schema_mapping",
                            "reserved_target_sanitization",
                        ],
                        scenario=f"public_crs_{family}",
                        evaluation_suite="public_training_waf_regression",
                        partition_intent="public_training",
                        template_id=source_sample_id,
                        provenance=PUBLIC_PROVENANCE,
                        source_dataset=source["id"],
                        source_file=relative_file,
                        original_type="synthetic_security_regression_request",
                        synthetic=True,
                    )
                    source_metadata(record, source, upstream_split="regression")
                    candidates[family].append(record)

    selected: list[dict[str, Any]] = []
    family_limits = source["selection"]["maxByAttackFamily"]
    for family, records in sorted(candidates.items()):
        records.sort(key=lambda record: stable_hash(f"{seed}|{record['metadata']['sourceSampleId']}"))
        limit = min(int(family_limits.get(family, 0)), 20 if smoke else len(records))
        selected.extend(records[:limit])
        rejected["family_cap"] += max(0, len(records) - limit)
    selected.sort(key=lambda record: stable_hash(f"{seed}|{record['sampleId']}"))
    return selected, {
        "sourceId": source["id"],
        "positiveStages": positive_stages,
        "selected": len(selected),
        "selectedByAttackFamily": count_distribution(selected, "attackFamily"),
        "rejected": dict(sorted(rejected.items())),
    }


def violates_content_boundary(text: str) -> bool:
    return any(pattern.search(text) for pattern in RISK_PATTERNS)


def adapt_s_labs(
    root: Path,
    config: dict[str, Any],
    source: dict[str, Any],
    seed: int,
    *,
    smoke: bool,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    path = source_artifact(root, config, source)
    selection = source["selection"]
    minimum = int(selection["minimumLength"])
    maximum = int(selection["maximumLength"])
    rejected = Counter()
    malicious: list[tuple[str, str]] = []
    benign: list[tuple[str, str, bool]] = []
    seen_text: set[str] = set()
    with path.open("r", encoding="utf-8", newline="") as handle:
        for row_index, row in enumerate(csv.DictReader(handle)):
            text = str(row.get("text") or "").strip()
            label = str(row.get("label") or "")
            normalized = normalize_text(text)
            if len(text) < minimum:
                rejected["too_short"] += 1
                continue
            if len(text) > maximum:
                rejected["too_long"] += 1
                continue
            if normalized in seen_text:
                rejected["duplicate_text"] += 1
                continue
            seen_text.add(normalized)
            if violates_content_boundary(text):
                rejected["content_boundary"] += 1
                continue
            row_id = f"train:{row_index}:{stable_hash(text)[:20]}"
            if label == "1":
                if not INJECTION_MARKERS.search(text):
                    rejected["injection_marker_missing"] += 1
                    continue
                malicious.append((row_id, text))
            elif label == "0":
                benign.append((row_id, text, bool(HARD_NEGATIVE_MARKERS.search(text))))
            else:
                rejected["unknown_label"] += 1

    malicious.sort(key=lambda item: stable_hash(f"{seed}|malicious|{item[0]}"))
    benign.sort(key=lambda item: (not item[2], stable_hash(f"{seed}|benign|{item[0]}")))
    malicious_limit = min(int(selection["maliciousMax"]), 40 if smoke else len(malicious))
    benign_limit = min(int(selection["benignMax"]), 40 if smoke else len(benign))
    chosen: list[tuple[str, str, int, bool]] = [
        (row_id, text, 1, True) for row_id, text in malicious[:malicious_limit]
    ] + [
        (row_id, text, 0, hard_negative)
        for row_id, text, hard_negative in benign[:benign_limit]
    ]
    rejected["class_cap"] += len(malicious) - malicious_limit + len(benign) - benign_limit

    records = []
    for row_id, text, label, hard_negative in chosen:
        source_sample_id = f"{source['id']}:{source['revision']}:{row_id}"
        detection_input = {
            "method": "POST",
            "path": "/api/ai-assistant/messages/analyze",
            "query": "",
            "headers": {
                "Host": "test.local",
                "Content-Type": "text/plain; charset=utf-8",
                "X-Content-Origin": "untrusted-user",
            },
            "body": text,
            "sourceContext": common_context(
                authenticated=True,
                endpoint_sensitivity="medium",
            ),
            "ruleSignals": [],
        }
        if label == 1:
            output = make_output(
                verdict="malicious",
                family="other",
                severity="high",
                reasoning="请求正文包含面向分析模型的指令覆盖或提示词提取意图，必须只作为待分析数据处理",
                evidence=[
                    {
                        "field": "body",
                        "value": text,
                        "reason": "上游 MIT 许可训练分片标注为 prompt injection，且确定性标记复核通过",
                    }
                ],
                action="block",
                confidence=0.94,
            )
            category = "attack"
            scenario = "public_prompt_injection"
            generation_type = "public_prompt_injection_mapping"
        else:
            output = make_output(
                verdict="safe",
                family="benign",
                severity="low",
                reasoning="请求正文是普通用户文本或安全讨论；其语义不要求模型覆盖检测协议",
                evidence=[
                    {
                        "field": "body",
                        "value": text,
                        "reason": "上游训练分片标注为 benign，文本作为不可信内容被分析而非执行",
                    }
                ],
                action="allow",
                confidence=0.97,
            )
            category = "hard_negative" if hard_negative else "normal"
            scenario = "public_prompt_hard_negative" if hard_negative else "public_benign_message"
            generation_type = "public_benign_text_mapping"
        record = make_record(
            sample_id=f"v02-public-pi-{stable_hash(source_sample_id)[:24]}",
            detection_input=detection_input,
            detection_output=output,
            config=config,
            label_category=category,
            source_sample_id=source_sample_id,
            generation_type=generation_type,
            transformations=[
                "upstream_train_split_only",
                "untrusted_text_body_mapping",
                "content_boundary_filter",
            ],
            scenario=scenario,
            evaluation_suite="public_training_prompt_injection",
            partition_intent="public_training",
            template_id=source_sample_id,
            provenance=PUBLIC_PROVENANCE,
            source_dataset=source["id"],
            source_file="data/train.csv",
            original_type="public_text_sample_mapped_to_synthetic_http_request",
            synthetic=True,
        )
        source_metadata(record, source, upstream_split="train")
        records.append(record)
    records.sort(key=lambda record: stable_hash(f"{seed}|{record['sampleId']}"))
    return records, {
        "sourceId": source["id"],
        "eligibleMalicious": len(malicious),
        "eligibleBenign": len(benign),
        "selected": len(records),
        "selectedByCategory": count_distribution(records, "labelCategory"),
        "rejected": dict(sorted(rejected.items())),
    }


def schema_variant(schema: dict[str, Any]) -> dict[str, Any]:
    if "anyOf" in schema:
        candidates = [item for item in schema["anyOf"] if isinstance(item, dict)]
        return next((item for item in candidates if item.get("type") in {"string", "integer", "boolean"}), {})
    return schema


def scalar_value(name: str, raw_schema: dict[str, Any], variant: int) -> str | None:
    schema = schema_variant(raw_schema)
    if "$ref" in schema or schema.get("type") == "object":
        return None
    if schema.get("type") == "array":
        item = scalar_value(name, schema.get("items") or {}, variant)
        return item
    enum = schema.get("enum")
    if isinstance(enum, list) and enum and isinstance(enum[0], (str, int, float, bool)):
        return str(enum[variant % len(enum)]).lower()
    lowered = name.lower()
    if any(part in lowered for part in ("password", "secret", "token", "api_key", "private_key")):
        return "[REDACTED]"
    if "email" in lowered:
        return f"user{variant}@example.com"
    if "url" in lowered or "return" in lowered:
        return "https://example.com/callback"
    if lowered.endswith("ip") or "ip_address" in lowered:
        return "192.0.2.10"
    if "currency" in lowered:
        return "usd"
    if "country" in lowered:
        return "US"
    if "date" in lowered:
        return "2026-01-15"
    if any(part in lowered for part in ("amount", "quantity", "limit", "count")):
        return str(20 + variant)
    if schema.get("type") == "integer":
        return str(1 + variant)
    if schema.get("type") == "boolean":
        return "true" if variant % 2 == 0 else "false"
    if any(part in lowered for part in ("customer", "account", "payment", "invoice", "price", "product")):
        return f"test_{lowered[:12]}_{variant}"
    return f"sample_{lowered[:16]}_{variant}"


def operation_parameters(path_item: dict[str, Any], operation: dict[str, Any]) -> list[dict[str, Any]]:
    values = []
    for candidate in list(path_item.get("parameters") or []) + list(operation.get("parameters") or []):
        if isinstance(candidate, dict) and "$ref" not in candidate:
            values.append(candidate)
    return values


def request_body_fields(operation: dict[str, Any], variant: int) -> list[tuple[str, str]]:
    content = (operation.get("requestBody") or {}).get("content") or {}
    schema = (content.get("application/x-www-form-urlencoded") or {}).get("schema") or {}
    properties = schema.get("properties") or {}
    required = [str(name) for name in schema.get("required") or []]
    ordered = required + sorted(
        (name for name in properties if name not in required),
        key=lambda name: stable_hash(f"{variant}|{name}"),
    )
    result = []
    for name in ordered:
        value = scalar_value(name, properties.get(name) or {}, variant)
        if value is None:
            continue
        result.append((name, value))
        if len(result) == 6:
            break
    return result


def normal_scenario(path: str) -> str:
    mapping = (
        ("payment", "payment_status_and_update"),
        ("customer", "customer_profile"),
        ("invoice", "invoice_management"),
        ("subscription", "subscription_management"),
        ("checkout", "checkout_session"),
        ("refund", "refund_management"),
        ("file", "business_file_operation"),
        ("report", "financial_report"),
    )
    return next((scenario for marker, scenario in mapping if marker in path), "public_api_operation")


def adapt_stripe_openapi(
    root: Path,
    config: dict[str, Any],
    source: dict[str, Any],
    seed: int,
    *,
    smoke: bool,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    path = source_artifact(root, config, source)
    specification = json.loads(path.read_text(encoding="utf-8"))
    allowed_methods = {str(value).upper() for value in source["selection"]["methods"]}
    operations = []
    for request_path, path_item in sorted((specification.get("paths") or {}).items()):
        if not isinstance(path_item, dict):
            continue
        for method, operation in sorted(path_item.items()):
            if method.upper() in allowed_methods and isinstance(operation, dict):
                operation_id = str(operation.get("operationId") or f"{method}:{request_path}")
                operations.append((request_path, path_item, method.upper(), operation, operation_id))
    operations.sort(key=lambda item: stable_hash(f"{seed}|{item[4]}"))
    operation_limit = 25 if smoke else int(source["selection"]["maximumOperations"])
    operations = operations[:operation_limit]
    variants = 1 if smoke else int(source["selection"]["variantsPerOperation"])
    records = []
    skipped = Counter()
    for request_path, path_item, method, operation, operation_id in operations:
        source_sample_id = f"{source['id']}:{source['revision']}:{operation_id}"
        for variant in range(variants):
            concrete_path = request_path
            for parameter_name in re.findall(r"\{([^}]+)\}", concrete_path):
                replacement = f"test-{stable_hash(f'{operation_id}|{parameter_name}')[:8]}"
                concrete_path = concrete_path.replace("{" + parameter_name + "}", replacement)
            query_fields = []
            for parameter in operation_parameters(path_item, operation):
                if parameter.get("in") != "query":
                    continue
                name = str(parameter.get("name") or "")
                value = scalar_value(name, parameter.get("schema") or {}, variant)
                if name and value is not None:
                    query_fields.append((name, value))
                if len(query_fields) == 4:
                    break
            body_fields = request_body_fields(operation, variant) if method == "POST" else []
            query = urlencode(query_fields, doseq=True)
            body = urlencode(body_fields, doseq=True)
            headers = {
                "Host": "test.local",
                "Accept": "application/json",
                "Authorization": "Bearer [REDACTED]",
                "X-Client-Mode": "web" if variant % 2 == 0 else "mobile",
            }
            if body:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            detection_input = {
                "method": method,
                "path": concrete_path,
                "query": query,
                "headers": headers,
                "body": body,
                "sourceContext": common_context(
                    authenticated=True,
                    endpoint_sensitivity="high" if "payment" in concrete_path else "medium",
                ),
                "ruleSignals": [],
            }
            output = make_output(
                verdict="safe",
                family="benign",
                severity="low",
                reasoning="请求方法、路径和参数结构来自公开 API 合约，使用保留测试值且未出现攻击证据",
                evidence=[],
                action="allow",
                confidence=0.99,
            )
            record = make_record(
                sample_id=f"v02-public-openapi-{stable_hash(f'{source_sample_id}|{variant}')[:24]}",
                detection_input=detection_input,
                detection_output=output,
                config=config,
                label_category="normal",
                source_sample_id=source_sample_id,
                generation_type="public_openapi_normal_shape",
                transformations=[
                    "openapi_operation_mapping",
                    "reserved_test_value_generation",
                    "sensitive_placeholder_redaction",
                ],
                scenario=normal_scenario(concrete_path),
                evaluation_suite="public_training_openapi_normal",
                partition_intent="public_training",
                template_id=source_sample_id,
                provenance=PUBLIC_PROVENANCE,
                source_dataset=source["id"],
                source_file="openapi/spec3.json",
                original_type="public_api_contract_derived_synthetic_request",
                synthetic=True,
            )
            source_metadata(record, source, upstream_split="openapi_contract")
            errors = validate_record(record)
            if errors:
                skipped.update(errors)
                continue
            records.append(record)
    records.sort(key=lambda record: stable_hash(f"{seed}|{record['sampleId']}"))
    return records, {
        "sourceId": source["id"],
        "eligibleOperations": len(operations),
        "variantsPerOperation": variants,
        "selected": len(records),
        "rejected": dict(sorted(skipped.items())),
    }


ADAPTERS = {
    "owasp_crs_regression": adapt_owasp_crs,
    "s_labs_prompt_injection": adapt_s_labs,
    "stripe_openapi": adapt_stripe_openapi,
}


def generate_public_candidates(
    root: Path,
    config: dict[str, Any],
    seed: int,
    *,
    smoke: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    registry = load_registry(root, config)
    accepted = [source for source in registry["sources"] if source.get("status") == "accepted"]
    excluded = [source for source in registry["sources"] if source.get("status") == "excluded"]
    records = []
    adapter_reports = []
    for source in accepted:
        adapter_name = str(source["adapter"])
        if adapter_name not in ADAPTERS:
            raise ValueError(f"unsupported public source adapter: {adapter_name}")
        adapted, report = ADAPTERS[adapter_name](root, config, source, seed, smoke=smoke)
        records.extend(adapted)
        adapter_reports.append(report)
    records.sort(key=lambda record: stable_hash(f"{seed}|public|{record['sampleId']}"))
    if smoke:
        records = records[: int(config["public_sources"]["smoke_total"])]
    invalid = []
    for record in records:
        problems = validate_record(record)
        if problems:
            invalid.append({"sampleId": record["sampleId"], "problems": problems})
    if invalid:
        raise ValueError(f"public source adapter produced invalid records: {stable_json(invalid[:5])}")
    audit = {
        "schemaVersion": 1,
        "registryVersion": registry["registryVersion"],
        "registryReviewedAt": registry["reviewedAt"],
        "acceptedSources": [
            {
                "id": source["id"],
                "revision": source["revision"],
                "license": source["license"],
                "allowedSplits": source["allowedSplits"],
                "upstreamNature": source["upstreamNature"],
            }
            for source in accepted
        ],
        "excludedSources": [
            {
                "id": source["id"],
                "reason": source["reason"],
                "homepage": source["homepage"],
            }
            for source in excluded
        ],
        "adapters": adapter_reports,
        "selected": len(records),
        "byCategory": count_distribution(records, "labelCategory"),
        "byAttackFamily": count_distribution(records, "attackFamily"),
        "bySourceDataset": count_distribution(records, "sourceDataset"),
        "invalid": len(invalid),
        "claims": {
            "realProductionTraffic": False,
            "humanReviewPerformedByThisProject": False,
            "publicDerivedRequestsAreSynthetic": True,
            "upstreamValidationOrTestSplitsUsedForTraining": False,
        },
    }
    return records, audit


def render_public_source_audit(report: dict[str, Any]) -> str:
    accepted_rows = "\n".join(
        f"| `{source['id']}` | `{source['revision']}` | `{source['license']}` | "
        f"{', '.join(source['allowedSplits'])} |"
        for source in report["acceptedSources"]
    )
    excluded_rows = "\n".join(
        f"| `{source['id']}` | `{source['reason']}` |"
        for source in report["excludedSources"]
    )
    adapter_rows = "\n".join(
        f"| `{adapter['sourceId']}` | {adapter['selected']} | `{stable_json(adapter.get('rejected', {}))}` |"
        for adapter in report["adapters"]
    )
    split_counts = report.get("postPipelineBySplit", {})
    return f"""# AetherArgus dataset v0.2 public-source audit

Public-derived candidates accepted after deterministic mapping: **{report['selected']}**.
Accepted after redaction, review, deduplication and cross-corpus checks:
**{report.get('postPipelineAccepted', report['selected'])}**.

- Train: `{split_counts.get('train', 0)}`.
- Validation: `{split_counts.get('validation', 0)}`.
- Public-derived test records: `0`.
- Cross-corpus duplicates removed: `{report.get('crossCorpusDuplicatesRemoved', 0)}`.

## Accepted sources

| Source | Pinned revision | License | Allowed release splits |
| --- | --- | --- | --- |
{accepted_rows}

## Adapter results

| Source | Selected | Rejected or capped |
| --- | ---: | --- |
{adapter_rows}

## Excluded sources

| Source | Reason |
| --- | --- |
{excluded_rows}

## Evidence boundary

- Only checksum-pinned artifacts from accepted sources are read.
- Public-derived records are restricted to `train` and `validation`.
- Upstream validation/test splits are not used as training input.
- OWASP CRS records are synthetic regression traffic, not production traffic.
- OpenAPI records are deterministic synthetic requests derived from a public contract.
- No human review by this project is claimed.
"""
