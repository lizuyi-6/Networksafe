#!/usr/bin/env python3
"""Fast integrity check of safetensors shards via header/mmap validation.

safe_open validates that the file's declared tensor offsets match the actual
file length; a truncated download fails immediately without loading weights.
"""
from __future__ import annotations

import sys
from pathlib import Path

from safetensors import safe_open


def check_shard(path: Path) -> dict:
    info = {"path": str(path), "exists": path.is_file()}
    if not info["exists"]:
        info["status"] = "MISSING"
        return info
    info["sizeBytes"] = path.stat().st_size
    try:
        with safe_open(str(path), framework="pt") as handle:
            keys = list(handle.keys())
            # Touch metadata of a couple tensors to force header validation.
            sample = []
            for name in keys[:2]:
                tensor = handle.get_tensor(name)
                sample.append({"name": name, "dtype": str(tensor.dtype), "shape": list(tensor.shape)})
        info["status"] = "OK"
        info["tensorCount"] = len(keys)
        info["sampleTensors"] = sample
    except Exception as exc:  # noqa: BLE001
        info["status"] = "CORRUPT_OR_TRUNCATED"
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def main() -> int:
    candidates = [
        Path("/mnt/c/Users/Abraham/Downloads/model-00001-of-00003.safetensors"),
        Path("/mnt/c/Users/Abraham/Downloads/model-00002-of-00003.safetensors"),
        Path("/mnt/x/repos/Networksafe/ml/output/base-model/model-00003-of-00003.safetensors"),
    ]
    all_ok = True
    for shard_path in candidates:
        result = check_shard(shard_path)
        size_gib = result.get("sizeBytes", 0) / 1024**3
        print(f"{shard_path.name}: status={result['status']} size={result.get('sizeBytes')} ({size_gib:.3f} GiB)")
        if result["status"] == "OK":
            print(f"  tensors={result['tensorCount']}, sample={result['sampleTensors'][0] if result['sampleTensors'] else None}")
        elif result["status"] != "MISSING":
            print(f"  ERROR: {result.get('error')}")
            all_ok = False
        else:
            all_ok = False
    print("\nALL SHARDS OK" if all_ok else "\nONE OR MORE SHARDS PROBLEMATIC")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
