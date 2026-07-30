#!/usr/bin/env python3
"""Rewrite the system prompt of every v0.2 release record in-place.

The v0.2 release was built while data_pipeline/common.py carried an older
SYSTEM_PROMPT that did not include the enum/format constraints used by training
and evaluation. After aligning common.py to detection_contract.SYSTEM_PROMPT,
this script rewrites only messages[0].content for the four release splits,
leaving every other byte (user payload, assistant target, metadata) untouched.

It then recomputes sha256/sizeBytes for each split and updates manifest.json
and independent-seal.json accordingly. The sampleId list, split assignments
and counts are unchanged, so the seal remains valid.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RELEASE_DIR = ROOT / "ml" / "data" / "releases" / "v02"
SPLITS = {
    "train": "train.jsonl",
    "validation": "validation.jsonl",
    "test_closed": "test-closed.jsonl",
    "test_independent": "test-independent.jsonl",
}

sys.path.insert(0, str(ROOT / "ml" / "scripts"))
from detection_contract import SYSTEM_PROMPT  # noqa: E402


def sha256_and_size(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def main() -> int:
    manifest_path = RELEASE_DIR / "manifest.json"
    seal_path = RELEASE_DIR / "independent-seal.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    new_hashes: dict[str, dict] = {}
    for split_name, filename in SPLITS.items():
        path = RELEASE_DIR / filename
        rewritten_lines: list[str] = []
        with path.open("r", encoding="utf-8") as handle:
            for raw in handle:
                if not raw.strip():
                    continue
                record = json.loads(raw)
                messages = record["messages"]
                if messages[0]["role"] != "system":
                    raise RuntimeError(f"{filename}: first message is not system")
                if messages[0]["content"] != SYSTEM_PROMPT:
                    messages[0]["content"] = SYSTEM_PROMPT
                rewritten_lines.append(json.dumps(record, ensure_ascii=False))
        tmp = path.with_suffix(path.suffix + ".rewrite-tmp")
        tmp.write_text("\n".join(rewritten_lines) + "\n", encoding="utf-8")
        tmp.replace(path)
        sha, size = sha256_and_size(path)
        new_hashes[split_name] = {"sha256": sha, "sizeBytes": size, "count": len(rewritten_lines)}
        print(f"{filename}: records={len(rewritten_lines)} sha256={sha[:12]}... size={size}")

    # update manifest files entries (schema: files is an object keyed by split name)
    for split_key, info in new_hashes.items():
        entry = manifest["files"].get(split_key)
        if entry is None:
            raise RuntimeError(f"manifest.files missing key: {split_key}")
        entry["sha256"] = info["sha256"]
        entry["bytes"] = info["sizeBytes"]
        entry["records"] = info["count"]

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if seal_path.is_file():
        seal = json.loads(seal_path.read_text(encoding="utf-8"))
        # recordsSha256 is stable_json(record)+"\n" over independent records
        # (stable_json sorts keys); recompute from the rewritten file.
        independent_records: list[dict] = []
        with (RELEASE_DIR / SPLITS["test_independent"]).open("r", encoding="utf-8") as handle:
            for raw in handle:
                if raw.strip():
                    independent_records.append(json.loads(raw))
        digest = hashlib.sha256()
        for record in independent_records:
            digest.update(json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))
            digest.update(b"\n")
        seal["recordsSha256"] = digest.hexdigest()
        seal["recordCount"] = len(independent_records)
        seal_path.write_text(json.dumps(seal, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("seal updated:", seal_path.name, "recordsSha256=", seal["recordsSha256"][:16], "...")

    print("manifest updated:", manifest_path.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
