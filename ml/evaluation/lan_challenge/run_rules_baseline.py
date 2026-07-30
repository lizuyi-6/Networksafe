#!/usr/bin/env python3
"""Run a label-blind, read-only adapter over repository-frozen detection patterns."""

from __future__ import annotations

import argparse
import json
import re
import resource
import time
from pathlib import Path
from typing import Any

from inference_common import (
    EXPECTED_INPUT_SHA256,
    assert_complete,
    make_prediction_record,
    prepare_append_only_output,
    read_model_inputs,
    write_prediction,
)

MODEL_ID = "rules-baseline"
SOURCE_COMMIT = "4359276fa9c6c0b56b168fc5c002e7e542fe30b3"
SOURCE_FILE = "backend/src/services/detection-engine.ts"
SOURCE_BLOB_SHA1 = "95654206590b7fb733d1425b280e7dfacc8c20ba"

# These patterns are a frozen request-side subset of detection-engine.ts at
# SOURCE_COMMIT. They were copied before this challenge run and are not amended
# from challenge outcomes.
PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("sqli", re.compile(r"(?:union\s+(?:all\s+)?select|'\s*or\s+(?:'1'|1)\s*=\s*(?:'1'|1)|;\s*(?:drop|delete|insert|update|truncate|alter)\b)", re.I)),
    ("xss", re.compile(r"(?:<script\b|javascript:|on(?:error|load|click|mouseover)\s*=)", re.I)),
    ("path_traversal", re.compile(r"(?:\.\./|%2e%2e%2f|/etc/(?:passwd|shadow)|(?:^|/)\.env\b)", re.I)),
    ("command_injection", re.compile(r"(?:[;|]\s*(?:cat|ls|curl|wget|bash|sh|whoami|id)\b|\$\([^)]*\)|`[^`]*`)", re.I)),
    ("ssrf", re.compile(r"(?:https?://(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[?::1\]?|169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200)|(?:dict|file|gopher|ldap|ftp|tftp|jar|netdoc|php)://)", re.I)),
    ("file_upload", re.compile(r"(?:\b\w+\.(?:phtml|php\d?|asp|aspx|jspx?|cgi|sh|exe|war)\b|\b\w+\.(?:jpg|png|gif|pdf|txt)\.(?:php|asp|jsp|exe|sh)\b|<\?(?:php|=)?[\s\S]{0,80}(?:system|exec|passthru|shell_exec|eval)\s*\()", re.I)),
    ("protocol_attack", re.compile(r"(?:Content-Length:\s*\d+[\s\S]{0,200}Transfer-Encoding:\s*chunked|Transfer-Encoding:\s*chunked[\s\S]{0,200}Content-Length:\s*\d+)", re.I)),
    ("authentication", re.compile(r"(?:eyJhbGciOiJub25l[A-Za-z0-9_-]{0,80}\.|\"type\"\s*:\s*\"(?:change_password|change_role|grant_admin|disable_mfa|reset_password)\")", re.I)),
    ("prompt_injection", re.compile(r"(?:ignore (?:all |the )?(?:previous|prior) instructions|忽略(?:之前|以上|前面)的(?:所有)?指令|system prompt|reveal (?:your )?(?:instructions|prompt))", re.I)),
)


def classify(request: dict[str, Any]) -> dict[str, Any]:
    corpus = json.dumps(
        {
            "method": request.get("method"),
            "path": request.get("path"),
            "headers": request.get("headers") or {},
            "body": request.get("body"),
            "sourceContext": request.get("sourceContext") or {},
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    for family, pattern in PATTERNS:
        if pattern.search(corpus):
            return {
                "verdict": "attack",
                "attackFamily": family,
                "recommendedAction": "isolate" if family == "prompt_injection" else "block",
                "contextSufficient": True,
                "confidence": 4,
            }
    return {
        "verdict": "safe",
        "attackFamily": "none",
        "recommendedAction": "allow",
        "contextSufficient": True,
        "confidence": 3,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    rows = read_model_inputs(arguments.input)
    output, completed = prepare_append_only_output(arguments.output, MODEL_ID)
    started = time.perf_counter()
    try:
        for row in rows:
            if row["sampleId"] in completed:
                continue
            sample_started = time.perf_counter()
            prediction = classify(row["input"])
            raw_output = json.dumps(prediction, ensure_ascii=False, separators=(",", ":"))
            record = make_prediction_record(
                sample_id=row["sampleId"],
                model_id=MODEL_ID,
                raw_output=raw_output,
                latency_ms=(time.perf_counter() - sample_started) * 1000,
                input_token_count=None,
                output_token_count=None,
            )
            record["ruleSource"] = {
                "commit": SOURCE_COMMIT,
                "file": SOURCE_FILE,
                "blobSha1": SOURCE_BLOB_SHA1,
                "patternCount": len(PATTERNS),
            }
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    elapsed = time.perf_counter() - started
    summary = {
        "modelId": MODEL_ID,
        "status": "SUCCESS",
        "sampleCount": len(rows),
        "inputSha256": EXPECTED_INPUT_SHA256,
        "elapsedSeconds": elapsed,
        "samplesPerSecond": len(rows) / elapsed if elapsed else None,
        "peakHostMemoryMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
        "sourceCommit": SOURCE_COMMIT,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
