#!/usr/bin/env python3
"""Shared, dependency-light helpers for the AetherArgus v0.2 data pipeline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence
from urllib.parse import unquote

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from detection_contract import SYSTEM_PROMPT  # noqa: E402


VERDICTS = ("safe", "suspicious", "malicious", "unknown")
ATTACK_FAMILIES = (
    "benign",
    "sqli",
    "xss",
    "command_injection",
    "path_traversal",
    "ssrf",
    "authentication",
    "automation",
    "api_abuse",
    "deserialization",
    "file_upload",
    "protocol_attack",
    "business_logic",
    "other",
)
SEVERITIES = ("low", "medium", "high", "critical")
RECOMMENDED_ACTIONS = ("allow", "monitor", "challenge", "block")
INPUT_FIELDS = ("method", "path", "query", "headers", "body", "sourceContext", "ruleSignals")
OUTPUT_FIELDS = (
    "verdict",
    "confidence",
    "attackFamily",
    "severity",
    "reasoning",
    "evidence",
    "recommendedAction",
)
SOURCE_CONTEXT_FIELDS = {
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
RULE_SIGNAL_FIELDS = {"ruleId", "score", "field", "description"}
METADATA_FIELDS = {
    "datasetVersion",
    "labelCategory",
    "provenance",
    "synthetic",
    "generatorModel",
    "generatorPromptVersion",
    "sourceSampleId",
    "generationType",
    "transformations",
    "generatedAt",
    "reviewStatus",
    "sourceDataset",
    "sourceFile",
    "originalType",
    "cve",
    "encoding",
    "attackFamily",
    "verdict",
    "contentHash",
    "normalizedHash",
    "simHash",
    "templateFingerprint",
    "scenario",
    "evaluationSuite",
    "partitionIntent",
}
RESERVED_DOMAIN_RE = re.compile(
    r"(?i)\b(?:https?://)?([a-z0-9-]+\.)+(?!example\.com\b|example\.org\b|test\.local\b|example\.invalid\b)"
    r"[a-z]{2,}(?::\d+)?"
)
SENSITIVE_PATTERNS = (
    (re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key)=([^&\s]+)"), r"\1=[REDACTED]"),
    (
        re.compile(r'(?i)("(?:password|passwd|secret|token|apiKey)"\s*:\s*)"[^"]*"'),
        r'\1"[REDACTED]"',
    ),
    (re.compile(r"(?i)Bearer\s+[A-Za-z0-9._~+/=-]{12,}"), "Bearer [REDACTED]"),
    (re.compile(r"[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|invalid)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "user@example.com"),
    # ML-009 (audit 2026-08): value-shape blind spot. The generic key=/"key": shapes
    # above never fire on provider keys whose literal VALUE is the secret (no
    # recognizable key name adjacent). Mirror the v0.3 deterministic-check
    # _SECRET_PATTERNS here so the v0.2 redactor is not solely dependent on the
    # v0.3 gate as a backstop. Order: most specific first.
    (re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[A-Za-z0-9+/=\s]+?-----END [A-Za-z ]*PRIVATE KEY-----"), "[REDACTED:private_key]"),
    (re.compile(r"\bark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-fA-Za-z]+\b"), "[REDACTED:ark_key]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED:aws_access_key]"),
    (re.compile(r"(?i)\baws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}\b"), "aws_secret_access_key=[REDACTED:aws_secret]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"), "[REDACTED:github_pat]"),
    (re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b"), "[REDACTED:gitlab_pat]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "[REDACTED:slack_token]"),
    (re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b"), "[REDACTED:stripe_live]"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{50,}\b"), "[REDACTED:anthropic_key]"),
    (re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b"), "[REDACTED:openai_key]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "[REDACTED:google_api]"),
    (re.compile(r"(?i)\bya29\.[A-Za-z0-9_-]{20,}\b"), "[REDACTED:google_oauth]"),
)


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def emit_log(event: str, **fields: Any) -> None:
    print(stable_json({"event": event, **fields}), flush=True)


def repository_root(override: str | Path | None = None) -> Path:
    if override:
        return Path(override).expanduser().resolve()
    environment_root = os.environ.get("AETHERARGUS_REPO_ROOT")
    if environment_root:
        return Path(environment_root).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def load_config(path: str | Path, repo_root: Path) -> dict[str, Any]:
    config_path = Path(path)
    if not config_path.is_absolute():
        config_path = repo_root / config_path
    with config_path.open("r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    if not isinstance(config, dict):
        raise ValueError(f"config must contain a mapping: {config_path}")
    config["_configPath"] = config_path.as_posix()
    return config


def resolve_path(repo_root: Path, raw_path: str | Path) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else repo_root / path


def common_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--config",
        default="ml/data_pipeline/configs/dataset-v02.yaml",
        help="Pipeline YAML configuration relative to repository root.",
    )
    parser.add_argument("--repo-root", help="Repository root override.")
    parser.add_argument("--seed", type=int, help="Override the configuration random seed.")
    parser.add_argument("--resume", action="store_true", help="Reuse valid completed stage outputs.")
    parser.add_argument("--dry-run", action="store_true", help="Plan and validate without writing outputs.")
    return parser


def add_io_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input", help="Input JSONL path relative to repository root.")
    parser.add_argument("--output", help="Output JSONL or report path relative to repository root.")


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: record is not an object")
            yield value


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def guarded_write_text(path: Path, content: str, *, dry_run: bool, resume: bool) -> bool:
    """Write once. Resume only accepts byte-identical existing content."""

    if dry_run:
        emit_log("write_skipped", path=path.as_posix(), reason="dry_run", bytes=len(content.encode("utf-8")))
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if resume and existing == content:
            emit_log("write_reused", path=path.as_posix(), sha256=stable_hash(content))
            return False
        raise FileExistsError(f"refusing to overwrite existing output: {path}")
    path.write_text(content, encoding="utf-8", newline="\n")
    emit_log("write_complete", path=path.as_posix(), sha256=stable_hash(content), bytes=len(content.encode("utf-8")))
    return True


def write_json(path: Path, value: Any, *, dry_run: bool, resume: bool) -> bool:
    return guarded_write_text(
        path,
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        dry_run=dry_run,
        resume=resume,
    )


def write_jsonl(path: Path, records: Iterable[dict[str, Any]], *, dry_run: bool, resume: bool) -> bool:
    content = "".join(stable_json(record) + "\n" for record in records)
    return guarded_write_text(path, content, dry_run=dry_run, resume=resume)


def redact_text(value: str) -> tuple[str, int]:
    redacted = value
    replacements = 0
    for pattern, replacement in SENSITIVE_PATTERNS:
        redacted, count = pattern.subn(replacement, redacted)
        replacements += count
    return redacted, replacements


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower().strip()
    for _ in range(3):
        decoded = unquote(normalized)
        if decoded == normalized:
            break
        normalized = decoded
    normalized = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<ip>", normalized)
    normalized = re.sub(r"\b[0-9a-f]{16,}\b", "<hex>", normalized)
    normalized = re.sub(r"\b\d+\b", "<number>", normalized)
    normalized = re.sub(r"[A-Za-z0-9_-]{24,}", "<opaque>", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized[:65536]


def detect_encoding(value: str) -> str:
    lowered = value.lower()
    if re.search(r"%25(?:2e|2f|5c|27|3c)", lowered):
        return "double_url_encoded"
    if re.search(r"%(?:2e|2f|5c|27|3c|00|c0|e0)", lowered):
        return "url_encoded"
    if "\\u" in lowered or any(ord(character) > 127 for character in value):
        return "unicode"
    if re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*", value.strip()):
        return "token_or_base64"
    return "plain"


def char_ngrams(value: str, n: int = 4) -> set[str]:
    normalized = normalize_text(value)
    if len(normalized) <= n:
        return {normalized}
    return {normalized[index : index + n] for index in range(len(normalized) - n + 1)}


def jaccard(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    return len(left & right) / max(1, len(left | right))


def simhash64(value: str) -> str:
    features = Counter(char_ngrams(value, 3))
    vector = [0] * 64
    for feature, weight in features.items():
        digest = int(hashlib.blake2b(feature.encode("utf-8"), digest_size=8).hexdigest(), 16)
        for bit in range(64):
            vector[bit] += weight if digest & (1 << bit) else -weight
    result = 0
    for bit, score in enumerate(vector):
        if score >= 0:
            result |= 1 << bit
    return f"{result:016x}"


def simhash_distance(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def minhash_signature(value: str, permutations: int = 24) -> list[int]:
    features = sorted(char_ngrams(value, 4))
    # Bound work for long-input samples while retaining deterministic coverage
    # across the complete normalized string.
    if len(features) > 64:
        stride = max(1, len(features) // 64)
        features = features[::stride][:64]
    if not features:
        return [0] * permutations
    signature: list[int] = []
    for index in range(permutations):
        salt = index.to_bytes(2, "little")
        signature.append(
            min(
                int.from_bytes(
                    hashlib.blake2b(feature.encode("utf-8") + salt, digest_size=8).digest(),
                    "little",
                )
                for feature in features
            )
        )
    return signature


def minhash_similarity(left: Sequence[int], right: Sequence[int]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    return sum(1 for a, b in zip(left, right) if a == b) / len(left)


def canonical_payload(detection_input: dict[str, Any]) -> str:
    return stable_json(
        {
            "method": detection_input.get("method"),
            "path": detection_input.get("path"),
            "query": detection_input.get("query"),
            "headers": detection_input.get("headers"),
            "body": detection_input.get("body"),
            "sourceContext": detection_input.get("sourceContext"),
            "ruleSignals": detection_input.get("ruleSignals"),
        }
    )


def parse_record(record: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    messages = record.get("messages")
    if not isinstance(messages, list) or len(messages) != 3:
        raise ValueError("messages must contain exactly system, user, assistant")
    roles = [message.get("role") for message in messages if isinstance(message, dict)]
    if roles != ["system", "user", "assistant"]:
        raise ValueError("message roles must be system,user,assistant")
    try:
        detection_input = json.loads(messages[1]["content"])
        detection_output = json.loads(messages[2]["content"])
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError(f"message content is not strict JSON: {error}") from error
    if not isinstance(detection_input, dict) or not isinstance(detection_output, dict):
        raise ValueError("user and assistant messages must parse to objects")
    return detection_input, detection_output


def resolve_field(detection_input: dict[str, Any], field_path: str) -> tuple[bool, Any]:
    value: Any = detection_input
    for component in field_path.split("."):
        if not isinstance(value, dict) or component not in value:
            return False, None
        value = value[component]
    return True, value


def validate_input(value: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if set(value) != set(INPUT_FIELDS):
        errors.append(f"input_fields:{sorted(set(value) ^ set(INPUT_FIELDS))}")
    if value.get("method") not in {
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
        "CONNECT",
        "TRACE",
        "EVENT",
    }:
        errors.append("method_invalid")
    for field_name, maximum in (("path", 2048), ("body", 32768)):
        field_value = value.get(field_name)
        if not isinstance(field_value, str) or (field_name == "path" and not field_value):
            errors.append(f"{field_name}_invalid")
        elif len(field_value) > maximum:
            errors.append(f"{field_name}_too_long")
    # SECURITY FIX (audit 2026-08, ML-010): `query` is dual-shape and was validated
    # as string-only, directly contradicting the committed v0.3 schema (object of
    # scalars). Validate both shapes with their real bounds instead of silently
    # rejecting every v0.3 record as `query_invalid` (or blessing an over-long one).
    query_value = value.get("query")
    if isinstance(query_value, str):
        # legacy v0.2 producer form (public_source_adapters / generate_candidates)
        if len(query_value) > 8192:
            errors.append("query_too_long")
    elif isinstance(query_value, dict):
        if len(query_value) > 100:
            errors.append("query_too_many_properties")
        else:
            for query_key, query_item in query_value.items():
                if not isinstance(query_key, str):
                    errors.append("query_key_invalid")
                    break
                if isinstance(query_item, str):
                    if len(query_item) > 8192:
                        errors.append("query_value_too_long")
                        break
                elif isinstance(query_item, bool):
                    continue  # bool before int: bool is an int subclass
                elif not isinstance(query_item, (int, float)):
                    errors.append("query_value_invalid")
                    break
    else:
        errors.append("query_invalid")
    headers = value.get("headers")
    if not isinstance(headers, dict) or len(headers) > 100:
        errors.append("headers_invalid")
    elif any(not isinstance(key, str) or not isinstance(item, str) or len(item) > 8192 for key, item in headers.items()):
        errors.append("headers_entry_invalid")
    source_context = value.get("sourceContext")
    if not isinstance(source_context, dict):
        errors.append("source_context_invalid")
    else:
        if not {"requestsLastMinute", "distinctPathsLastMinute", "recentFailureCount"} <= set(source_context):
            errors.append("source_context_required_missing")
        if not set(source_context) <= SOURCE_CONTEXT_FIELDS:
            errors.append("source_context_extra_fields")
        for count_field in (
            "requestsLastMinute",
            "distinctPathsLastMinute",
            "recentFailureCount",
            "distinctUsernamesLastMinute",
            "sessionAgeSeconds",
        ):
            if count_field in source_context and (
                not isinstance(source_context[count_field], int) or source_context[count_field] < 0
            ):
                errors.append(f"{count_field}_invalid")
        if "historicalRiskScore" in source_context and (
            not isinstance(source_context["historicalRiskScore"], (int, float))
            or not 0 <= source_context["historicalRiskScore"] <= 1
        ):
            errors.append("historical_risk_score_invalid")
    rule_signals = value.get("ruleSignals")
    if not isinstance(rule_signals, list) or len(rule_signals) > 100:
        errors.append("rule_signals_invalid")
    else:
        for signal in rule_signals:
            if not isinstance(signal, dict) or set(signal) != RULE_SIGNAL_FIELDS:
                errors.append("rule_signal_fields_invalid")
                continue
            score = signal.get("score")
            if not isinstance(score, (int, float)) or not 0 <= score <= 1:
                errors.append("rule_signal_score_invalid")
    return errors


def validate_output(value: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if set(value) != set(OUTPUT_FIELDS):
        errors.append(f"output_fields:{sorted(set(value) ^ set(OUTPUT_FIELDS))}")
    if value.get("verdict") not in VERDICTS:
        errors.append("verdict_invalid")
    confidence = value.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        errors.append("confidence_invalid")
    if value.get("attackFamily") not in ATTACK_FAMILIES:
        errors.append("attack_family_invalid")
    if value.get("severity") not in SEVERITIES:
        errors.append("severity_invalid")
    if value.get("recommendedAction") not in RECOMMENDED_ACTIONS:
        errors.append("recommended_action_invalid")
    if not isinstance(value.get("reasoning"), str) or not 1 <= len(value["reasoning"]) <= 500:
        errors.append("reasoning_invalid")
    evidence = value.get("evidence")
    if not isinstance(evidence, list) or len(evidence) > 12:
        errors.append("evidence_invalid")
    else:
        for item in evidence:
            if not isinstance(item, dict) or set(item) != {"field", "value", "reason"}:
                errors.append("evidence_fields_invalid")
    return errors


def validate_label_consistency(output: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    verdict = output.get("verdict")
    action = output.get("recommendedAction")
    family = output.get("attackFamily")
    severity = output.get("severity")
    confidence = output.get("confidence")
    if verdict == "safe" and action == "block":
        errors.append("safe_block")
    if verdict == "malicious" and action == "allow":
        errors.append("malicious_allow")
    if verdict == "unknown" and isinstance(confidence, (int, float)) and confidence > 0.60:
        errors.append("unknown_confidence_gt_060")
    if family == "benign" and verdict == "malicious":
        errors.append("benign_malicious")
    if severity == "critical" and action == "allow":
        errors.append("critical_allow")
    if verdict == "safe" and family != "benign":
        errors.append("safe_non_benign")
    if verdict in {"malicious", "suspicious"} and family == "benign":
        errors.append("unsafe_benign")
    return errors


def validate_evidence(input_value: dict[str, Any], output_value: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for index, evidence in enumerate(output_value.get("evidence", [])):
        field_path = evidence.get("field")
        if not isinstance(field_path, str):
            errors.append(f"evidence_{index}_field_invalid")
            continue
        exists, source_value = resolve_field(input_value, field_path)
        if not exists:
            errors.append(f"evidence_{index}_field_missing")
            continue
        evidence_value = evidence.get("value")
        if isinstance(source_value, str):
            if stable_json(evidence_value).strip('"') not in source_value and str(evidence_value) not in source_value:
                errors.append(f"evidence_{index}_value_not_located")
        elif evidence_value != source_value:
            errors.append(f"evidence_{index}_value_mismatch")
    return errors


def validate_metadata(metadata: Any) -> list[str]:
    if not isinstance(metadata, dict):
        return ["metadata_invalid"]
    errors = [f"metadata_missing:{field_name}" for field_name in sorted(METADATA_FIELDS - set(metadata))]
    if metadata.get("synthetic") not in {True, False}:
        errors.append("metadata_synthetic_invalid")
    if not isinstance(metadata.get("transformations"), list):
        errors.append("metadata_transformations_invalid")
    if metadata.get("reviewStatus") not in {"pending", "rules_accepted", "rejected", "manual_review"}:
        errors.append("metadata_review_status_invalid")
    return errors


def validate_record(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    sample_id = record.get("sampleId")
    if not isinstance(sample_id, str) or not sample_id:
        errors.append("sample_id_invalid")
    try:
        detection_input, detection_output = parse_record(record)
    except ValueError as error:
        return errors + [str(error)]
    errors.extend(validate_input(detection_input))
    errors.extend(validate_output(detection_output))
    errors.extend(validate_label_consistency(detection_output))
    errors.extend(validate_evidence(detection_input, detection_output))
    errors.extend(validate_metadata(record.get("metadata")))
    return errors


def make_output(
    *,
    verdict: str,
    family: str,
    severity: str,
    reasoning: str,
    evidence: list[dict[str, Any]],
    action: str,
    confidence: float,
) -> dict[str, Any]:
    return {
        "verdict": verdict,
        "confidence": round(confidence, 4),
        "attackFamily": family,
        "severity": severity,
        "reasoning": reasoning,
        "evidence": evidence,
        "recommendedAction": action,
    }


def make_record(
    *,
    sample_id: str,
    detection_input: dict[str, Any],
    detection_output: dict[str, Any],
    config: dict[str, Any],
    label_category: str,
    source_sample_id: str,
    generation_type: str,
    transformations: list[str],
    scenario: str,
    evaluation_suite: str,
    partition_intent: str,
    template_id: str,
    provenance: str = "deterministic_synthetic_v02",
    source_dataset: str = "aetherargus-v02-deterministic",
    source_file: str = "ml/data_pipeline/generate_candidates.py",
    original_type: str = "synthetic",
    cve: str | None = None,
    synthetic: bool = True,
) -> dict[str, Any]:
    serialized_input = stable_json(detection_input)
    serialized_output = stable_json(detection_output)
    normalized_payload = normalize_text(canonical_payload(detection_input))
    metadata = {
        "datasetVersion": str(config["version"]),
        "labelCategory": label_category,
        "provenance": provenance,
        "synthetic": synthetic,
        "generatorModel": str(config["generation"]["generator_model"]),
        "generatorPromptVersion": str(config["generation"]["prompt_version"]),
        "sourceSampleId": source_sample_id,
        "generationType": generation_type,
        "transformations": transformations,
        "generatedAt": str(config["generation"]["generated_at"]),
        "reviewStatus": "pending",
        "sourceDataset": source_dataset,
        "sourceFile": source_file,
        "originalType": original_type,
        "cve": cve,
        "encoding": detect_encoding(canonical_payload(detection_input)),
        "attackFamily": detection_output["attackFamily"],
        "verdict": detection_output["verdict"],
        "contentHash": stable_hash(f"{serialized_input}\n{serialized_output}"),
        "normalizedHash": stable_hash(normalized_payload),
        "simHash": simhash64(normalized_payload),
        "templateFingerprint": stable_hash(template_id),
        "scenario": scenario,
        "evaluationSuite": evaluation_suite,
        "partitionIntent": partition_intent,
    }
    return {
        "sampleId": sample_id,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": serialized_input},
            {"role": "assistant", "content": serialized_output},
        ],
        "metadata": metadata,
    }


def refresh_record_hashes(record: dict[str, Any]) -> dict[str, Any]:
    """Refresh derived hashes after a copied record is redacted or normalized."""

    detection_input, detection_output = parse_record(record)
    record["messages"][1]["content"] = stable_json(detection_input)
    record["messages"][2]["content"] = stable_json(detection_output)
    metadata = record["metadata"]
    normalized_payload = normalize_text(canonical_payload(detection_input))
    metadata["contentHash"] = stable_hash(
        f"{record['messages'][1]['content']}\n{record['messages'][2]['content']}"
    )
    metadata["normalizedHash"] = stable_hash(normalized_payload)
    metadata["simHash"] = simhash64(normalized_payload)
    metadata["encoding"] = detect_encoding(canonical_payload(detection_input))
    return record


@dataclass
class AuditResult:
    total: int = 0
    accepted: int = 0
    rejected: int = 0
    duplicate_sample_ids: int = 0
    problems: Counter[str] = field(default_factory=Counter)
    by_category: Counter[str] = field(default_factory=Counter)
    by_family: Counter[str] = field(default_factory=Counter)
    by_scenario: Counter[str] = field(default_factory=Counter)
    by_encoding: Counter[str] = field(default_factory=Counter)
    by_provenance: Counter[str] = field(default_factory=Counter)
    by_suite: Counter[str] = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "accepted": self.accepted,
            "rejected": self.rejected,
            "duplicateSampleIds": self.duplicate_sample_ids,
            "problems": dict(sorted(self.problems.items())),
            "byCategory": dict(sorted(self.by_category.items())),
            "byAttackFamily": dict(sorted(self.by_family.items())),
            "byScenario": dict(sorted(self.by_scenario.items())),
            "byEncoding": dict(sorted(self.by_encoding.items())),
            "byProvenance": dict(sorted(self.by_provenance.items())),
            "byEvaluationSuite": dict(sorted(self.by_suite.items())),
        }


def audit_records(records: Sequence[dict[str, Any]]) -> AuditResult:
    result = AuditResult()
    observed_ids: set[str] = set()
    for record in records:
        result.total += 1
        sample_id = record.get("sampleId")
        if sample_id in observed_ids:
            result.duplicate_sample_ids += 1
        if isinstance(sample_id, str):
            observed_ids.add(sample_id)
        errors = validate_record(record)
        if errors:
            result.rejected += 1
            result.problems.update(errors)
        else:
            result.accepted += 1
        metadata = record.get("metadata", {})
        if isinstance(metadata, dict):
            result.by_category[str(metadata.get("labelCategory", "missing"))] += 1
            result.by_family[str(metadata.get("attackFamily", "missing"))] += 1
            result.by_scenario[str(metadata.get("scenario", "missing"))] += 1
            result.by_encoding[str(metadata.get("encoding", "missing"))] += 1
            result.by_provenance[str(metadata.get("provenance", "missing"))] += 1
            result.by_suite[str(metadata.get("evaluationSuite", "missing"))] += 1
    return result


def exact_deduplicate(records: Sequence[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    observed: dict[str, str] = {}
    for record in records:
        content_hash = str(record.get("metadata", {}).get("contentHash", ""))
        if content_hash in observed:
            rejected.append(
                {
                    "sampleId": record.get("sampleId"),
                    "accepted": False,
                    "problems": [f"exact_duplicate_of:{observed[content_hash]}"],
                    "suggestedLabel": None,
                    "needsManualReview": False,
                }
            )
            continue
        observed[content_hash] = str(record.get("sampleId"))
        accepted.append(record)
    return accepted, rejected


def normalized_deduplicate(records: Sequence[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    observed: dict[tuple[str, str], str] = {}
    for record in records:
        metadata = record.get("metadata", {})
        key = (str(metadata.get("attackFamily")), str(metadata.get("normalizedHash")))
        if key in observed:
            rejected.append(
                {
                    "sampleId": record.get("sampleId"),
                    "accepted": False,
                    "problems": [f"normalized_duplicate_of:{observed[key]}"],
                    "suggestedLabel": None,
                    "needsManualReview": False,
                }
            )
            continue
        observed[key] = str(record.get("sampleId"))
        accepted.append(record)
    return accepted, rejected


def assign_group_ids(records: Sequence[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    grouped = [json.loads(json.dumps(record, ensure_ascii=False)) for record in records]
    parent: dict[str, str] = {}

    def find(node: str) -> str:
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left: str, right: str) -> None:
        left_root, right_root = find(left), find(right)
        if left_root == right_root:
            return
        lower, higher = sorted((left_root, right_root))
        parent[higher] = lower

    record_nodes: list[list[str]] = []
    for record in grouped:
        metadata = record["metadata"]
        partition = str(metadata.get("partitionIntent"))
        family = str(metadata.get("attackFamily"))
        family_prefix = f"{partition}|{family}|"
        partition_prefix = f"{partition}|"
        nodes = [
            family_prefix + f"template:{metadata.get('templateFingerprint')}",
            partition_prefix + f"normalized:{metadata.get('normalizedHash')}",
            family_prefix
            + f"semantic:{metadata.get('semanticClusterId') or metadata.get('templateFingerprint')}",
        ]
        if metadata.get("cve"):
            nodes.append(partition_prefix + f"cve:{metadata['cve']}")
        for node in nodes[1:]:
            union(nodes[0], node)
        record_nodes.append(nodes)

    for record, nodes in zip(grouped, record_nodes):
        metadata = record["metadata"]
        component = find(nodes[0])
        anchor = "|".join(
            [
                component,
                str(metadata.get("generatorModel")),
                str(metadata.get("generatorPromptVersion")),
            ]
        )
        metadata["groupId"] = stable_hash(f"{seed}|{anchor}")
        if not isinstance(metadata.get("minHash"), list):
            metadata["minHash"] = minhash_signature(
                normalize_text(canonical_payload(parse_record(record)[0]))
            )
    return grouped


def grouped_split(
    records: Sequence[dict[str, Any]],
    ratios: dict[str, float],
    seed: int,
) -> dict[str, list[dict[str, Any]]]:
    by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_group[str(record["metadata"]["groupId"])].append(record)
    by_stratum: dict[tuple[str, str], list[list[dict[str, Any]]]] = defaultdict(list)
    for group_records in by_group.values():
        metadata = group_records[0]["metadata"]
        by_stratum[(metadata["labelCategory"], metadata["attackFamily"])].append(group_records)
    result = {split_name: [] for split_name in ratios}
    for stratum, groups in sorted(by_stratum.items()):
        randomizer = random.Random(int(stable_hash(f"{seed}|{stratum}")[:16], 16))
        randomizer.shuffle(groups)
        total = sum(len(group) for group in groups)
        target = {name: total * ratio for name, ratio in ratios.items()}
        assigned = Counter()
        for group in sorted(groups, key=lambda item: (-len(item), item[0]["metadata"]["groupId"])):
            split_name = max(
                ratios,
                key=lambda name: (
                    target[name] - assigned[name],
                    ratios[name],
                    stable_hash(f"{seed}|{name}|{group[0]['metadata']['groupId']}"),
                ),
            )
            for record in group:
                record["metadata"]["split"] = split_name
            result[split_name].extend(group)
            assigned[split_name] += len(group)
    for split_name in result:
        result[split_name].sort(key=lambda record: stable_hash(f"{seed}|{record['sampleId']}"))
    return result


def leakage_report(split_records: dict[str, Sequence[dict[str, Any]]]) -> dict[str, Any]:
    pairwise: dict[str, Any] = {}
    detected = False
    split_names = list(split_records)
    for left_index, left_name in enumerate(split_names):
        for right_name in split_names[left_index + 1 :]:
            left = split_records[left_name]
            right = split_records[right_name]
            left_groups = {str(record["metadata"].get("groupId")) for record in left}
            right_groups = {str(record["metadata"].get("groupId")) for record in right}
            left_hashes = {str(record["metadata"].get("normalizedHash")) for record in left}
            right_hashes = {str(record["metadata"].get("normalizedHash")) for record in right}
            left_templates = {str(record["metadata"].get("templateFingerprint")) for record in left}
            right_templates = {str(record["metadata"].get("templateFingerprint")) for record in right}
            group_overlap = left_groups & right_groups
            hash_overlap = left_hashes & right_hashes
            template_overlap = left_templates & right_templates
            pair_detected = bool(group_overlap or hash_overlap or template_overlap)
            detected = detected or pair_detected
            pairwise[f"{left_name}_vs_{right_name}"] = {
                "sharedGroupIds": len(group_overlap),
                "sharedNormalizedHashes": len(hash_overlap),
                "sharedTemplateFingerprints": len(template_overlap),
                "detected": pair_detected,
            }
    return {
        "detected": detected,
        "pairwise": pairwise,
        "checks": [
            "normalized SHA-256",
            "template fingerprint",
            "source-seed group",
            "CVE group",
            "generator model and prompt version group",
            "64-bit SimHash retained per sample",
            "24-permutation MinHash retained per sample",
            "character n-gram hashing vectors (non-neural fallback)",
        ],
        "limitations": [
            "No neural embedding model was available in this execution environment.",
            "SimHash/MinHash are lexical similarity controls and do not prove absence of all semantic leakage.",
        ],
    }


def source_registry(records: Sequence[dict[str, Any]]) -> dict[str, Any]:
    grouped_sources: dict[tuple[str, str, bool, str, str], list[str]] = defaultdict(list)
    for record in records:
        metadata = record["metadata"]
        key = (
            str(metadata["sourceDataset"]),
            str(metadata["sourceFile"]),
            bool(metadata["synthetic"]),
            str(metadata["generatorModel"]),
            str(metadata["generatorPromptVersion"]),
        )
        grouped_sources[key].append(str(metadata["sourceSampleId"]))
    groups = []
    all_source_ids: set[str] = set()
    for key in sorted(grouped_sources):
        source_ids = sorted(set(grouped_sources[key]))
        all_source_ids.update(source_ids)
        groups.append(
            {
                "sourceDataset": key[0],
                "sourceFile": key[1],
                "synthetic": key[2],
                "generatorModel": key[3],
                "generatorPromptVersion": key[4],
                "sourceSampleCount": len(source_ids),
                "sourceSampleIdsSha256": stable_hash("\n".join(source_ids)),
                "examples": source_ids[:3],
            }
        )
    return {
        "schemaVersion": 1,
        "sourceSampleIdCount": len(all_source_ids),
        "sourceSampleIdsSha256": stable_hash("\n".join(sorted(all_source_ids))),
        "sourceGroups": groups,
    }


def count_distribution(records: Iterable[dict[str, Any]], key: str) -> dict[str, int]:
    return dict(
        sorted(Counter(str(record.get("metadata", {}).get(key, "missing")) for record in records).items())
    )


def file_manifest(paths: dict[str, Path]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, path in paths.items():
        if path.exists():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            result[name] = {
                "path": path.as_posix(),
                "bytes": path.stat().st_size,
                "sha256": digest,
                "records": sum(1 for _ in iter_jsonl(path)) if path.suffix == ".jsonl" else None,
            }
    return result
