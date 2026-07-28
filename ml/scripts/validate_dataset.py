#!/usr/bin/env python3
"""Validate generated JSONL datasets parse as UTF-8 JSON and pass schemas."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from detection_contract import validate_detection_input, validate_detection_output  # noqa: E402


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    processed = repo_root / "ml" / "data" / "processed"
    total = 0
    for split in ("train", "validation", "test"):
        path = processed / f"{split}.jsonl"
        sample_count = 0
        input_errors = 0
        output_errors = 0
        role_errors = 0
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                record = json.loads(line)
                sample_count += 1
                messages = record["messages"]
                if [m["role"] for m in messages[:3]] != ["system", "user", "assistant"]:
                    role_errors += 1
                user_obj = json.loads(messages[1]["content"])
                assistant_obj = json.loads(messages[2]["content"])
                if validate_detection_input(user_obj):
                    input_errors += 1
                if validate_detection_output(assistant_obj):
                    output_errors += 1
        total += sample_count
        print(
            f"{split}: {sample_count} samples, "
            f"role_errors={role_errors}, input_errors={input_errors}, output_errors={output_errors}"
        )
    print(f"TOTAL {total} samples validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
