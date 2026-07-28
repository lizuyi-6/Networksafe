#!/usr/bin/env python3
"""Inspect the HF cache snapshot to list shards and present files."""
from __future__ import annotations

import json
import os
from pathlib import Path

base = Path.home() / ".cache" / "huggingface" / "hub" / "models--Qwen--Qwen3-4B-Instruct-2507"
if not base.is_dir():
    print("NO_CACHE", base)
    raise SystemExit(0)

snap_dir = next((base / "snapshots").iterdir())
print("revision_dir=", snap_dir)
idx = json.loads((snap_dir / "model.safetensors.index.json").read_text())
weight_map = idx["weight_map"]
shards = sorted(set(weight_map.values()))
print("shards_in_index=", shards)
print("metadata=", idx.get("metadata"))

print("--- files present in snapshot ---")
for name in sorted(os.listdir(snap_dir)):
    full = snap_dir / name
    target = os.readlink(full) if full.is_symlink() else "regular"
    blob_target = ""
    if full.is_symlink():
        resolved = (full.parent / target).resolve()
        size = resolved.stat().st_size if resolved.exists() else "MISSING"
        blob_target = f" -> {resolved.name} size={size}"
    print(name, target, blob_target)
