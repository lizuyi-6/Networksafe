#!/usr/bin/env python3
"""Label-blind helpers shared only by inference processes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

EXPECTED_INPUT_SHA256 = "c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3"
EXPECTED_SAMPLE_COUNT = 413
VERDICTS = {"safe", "attack", "unknown"}
ATTACK_FAMILIES = {
    "none",
    "authorization",
    "idor_bola",
    "sqli",
    "xss",
    "command_injection",
    "path_traversal",
    "ssrf",
    "business_logic",
    "file_upload",
    "csrf",
    "cors",
    "prompt_injection",
    "authentication",
    "protocol_attack",
    "not_supported",
}
ACTIONS = {"allow", "monitor", "challenge", "block", "isolate"}
REQUIRED_OUTPUT_FIELDS = {
    "verdict",
    "attackFamily",
    "recommendedAction",
    "contextSufficient",
    "confidence",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_model_inputs(path: Path) -> list[dict[str, Any]]:
    if sha256_file(path) != EXPECTED_INPUT_SHA256:
        raise ValueError("model input SHA-256 does not match the locked protocol")
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            if set(row) != {"sampleId", "input"}:
                raise ValueError(f"unexpected model-input fields at line {line_number}")
            if not isinstance(row["input"], dict):
                raise ValueError(f"input must be an object at line {line_number}")
            rows.append(row)
    if len(rows) != EXPECTED_SAMPLE_COUNT:
        raise ValueError(f"expected {EXPECTED_SAMPLE_COUNT} model inputs, found {len(rows)}")
    sample_ids = [row["sampleId"] for row in rows]
    if len(set(sample_ids)) != len(sample_ids):
        raise ValueError("duplicate sampleId in model inputs")
    return rows


def canonical_request_text(request: dict[str, Any]) -> str:
    """Serialize only the fields exposed by the frozen model input."""
    allowed = {
        "method": request.get("method"),
        "path": request.get("path"),
        "headers": request.get("headers") or {},
        "body": request.get("body"),
        "sourceContext": request.get("sourceContext") or {},
    }
    return json.dumps(allowed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def user_message(request: dict[str, Any]) -> str:
    return "Classify this request-side observation:\n" + canonical_request_text(request)


def parse_strict_output(raw_output: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        parsed = json.loads(raw_output)
    except json.JSONDecodeError:
        return None, "json_parse_error"
    if not isinstance(parsed, dict):
        return None, "json_not_object"
    if set(parsed) != REQUIRED_OUTPUT_FIELDS:
        return None, "incomplete_or_extra_fields"
    if parsed.get("verdict") not in VERDICTS:
        return None, "invalid_verdict_enum"
    if parsed.get("attackFamily") not in ATTACK_FAMILIES - {"not_supported"}:
        return None, "invalid_attack_family_enum"
    if parsed.get("recommendedAction") not in ACTIONS:
        return None, "invalid_action_enum"
    if not isinstance(parsed.get("contextSufficient"), bool):
        return None, "invalid_context_sufficient_type"
    confidence = parsed.get("confidence")
    if not isinstance(confidence, int) or isinstance(confidence, bool) or not 1 <= confidence <= 5:
        return None, "invalid_confidence"
    return parsed, None


def make_prediction_record(
    *,
    sample_id: str,
    model_id: str,
    raw_output: str,
    latency_ms: float,
    input_token_count: int | None,
    output_token_count: int | None,
) -> dict[str, Any]:
    parsed_output, error_type = parse_strict_output(raw_output)
    valid = parsed_output is not None
    effective = parsed_output or {
        "verdict": "unknown",
        "attackFamily": "none",
        "recommendedAction": "challenge",
        "contextSufficient": False,
        "confidence": 1,
    }
    return {
        "sampleId": sample_id,
        "modelId": model_id,
        "rawOutput": raw_output,
        "parsed": valid,
        "schemaValid": valid,
        **effective,
        "latencyMs": latency_ms,
        "inputTokenCount": input_token_count,
        "outputTokenCount": output_token_count,
        "errorType": error_type,
        "inputSha256": EXPECTED_INPUT_SHA256,
    }


def load_completed(path: Path, model_id: str) -> tuple[list[str], set[str]]:
    if not path.exists():
        return [], set()
    valid_lines: list[str] = []
    completed: set[str] = set()
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            sample_id = row.get("sampleId")
            if row.get("modelId") != model_id or not isinstance(sample_id, str):
                continue
            if sample_id in completed:
                continue
            completed.add(sample_id)
            valid_lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
    return valid_lines, completed


def prepare_append_only_output(path: Path, model_id: str) -> tuple[Any, set[str]]:
    path.parent.mkdir(parents=True, exist_ok=True)
    recovered, completed = load_completed(path, model_id)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for line in recovered:
            stream.write(line + "\n")
    return path.open("a", encoding="utf-8", newline="\n", buffering=1), completed


def write_prediction(stream: Any, record: dict[str, Any]) -> None:
    stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()


def assert_complete(rows: Iterable[dict[str, Any]], output_path: Path) -> None:
    expected_ids = {row["sampleId"] for row in rows}
    actual: list[str] = []
    with output_path.open("r", encoding="utf-8") as stream:
        for line in stream:
            actual.append(json.loads(line)["sampleId"])
    if len(actual) != EXPECTED_SAMPLE_COUNT or set(actual) != expected_ids or len(actual) != len(set(actual)):
        raise ValueError("prediction output is incomplete, duplicated, or misaligned")
