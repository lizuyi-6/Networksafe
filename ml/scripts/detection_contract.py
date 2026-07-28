"""Shared AetherGuard detection contract helpers.

This module deliberately has no model dependencies so dataset generation,
evaluation, and acceptance checks use exactly the same JSON contract.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


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

SYSTEM_PROMPT = (
    "你是 AetherGuard 安全流量判定引擎。根据输入的 HTTP 请求、安全上下文和规则信号进行判断。"
    "只能输出一个 JSON 对象，不得输出 Markdown、代码块、思考过程或额外说明。"
    "必须且只能包含 verdict、confidence、attackFamily、severity、reasoning、evidence、"
    "recommendedAction。verdict 只能是 safe、suspicious、malicious、unknown；"
    "attackFamily 只能是 benign、sqli、xss、command_injection、path_traversal、ssrf、"
    "authentication、automation、api_abuse、deserialization、file_upload、protocol_attack、"
    "business_logic、other；severity 只能是 low、medium、high、critical；"
    "recommendedAction 只能是 allow、monitor、challenge、block。"
    "confidence 必须在 0 到 1 之间。evidence 必须是数组，每项只包含 field、value、reason。"
    "信息不足时返回 unknown，解析或判断失败绝不能返回 safe。"
)


def resolve_repository_root() -> Path:
    """Return the repository root from this module's stable location."""

    return Path(__file__).resolve().parents[2]


def load_json_schema(schema_name: str) -> dict[str, Any]:
    """Load one tracked JSON schema by filename."""

    schema_path = resolve_repository_root() / "ml" / "schemas" / schema_name
    with schema_path.open("r", encoding="utf-8") as schema_file:
        loaded_schema = json.load(schema_file)
    Draft202012Validator.check_schema(loaded_schema)
    return loaded_schema


def create_validator(schema_name: str) -> Draft202012Validator:
    """Create a Draft 2020-12 validator for a tracked schema."""

    return Draft202012Validator(load_json_schema(schema_name))


def serialize_json(value: Any) -> str:
    """Serialize deterministic compact JSON without escaping Chinese text."""

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=False)


def parse_strict_json_object(generated_text: str) -> dict[str, Any]:
    """Parse a response only when the complete response is one JSON object."""

    stripped_text = generated_text.strip()
    parsed_value = json.loads(stripped_text)
    if not isinstance(parsed_value, dict):
        raise ValueError("model output is not a JSON object")
    return parsed_value


def validate_detection_input(detection_input: dict[str, Any]) -> list[str]:
    """Return stable validation error messages for a detection input."""

    validator = create_validator("detection-input.schema.json")
    return [
        validation_error.message
        for validation_error in sorted(validator.iter_errors(detection_input), key=lambda error: list(error.path))
    ]


def validate_detection_output(detection_output: dict[str, Any]) -> list[str]:
    """Return stable validation error messages for a detection output."""

    validator = create_validator("detection-output.schema.json")
    return [
        validation_error.message
        for validation_error in sorted(validator.iter_errors(detection_output), key=lambda error: list(error.path))
    ]


def build_messages(
    detection_input: dict[str, Any],
    detection_output: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Build the canonical chat messages used by training and inference."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": serialize_json(detection_input)},
    ]
    if detection_output is not None:
        messages.append({"role": "assistant", "content": serialize_json(detection_output)})
    return messages
