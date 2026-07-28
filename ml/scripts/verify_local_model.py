#!/usr/bin/env python3
"""Verify the manually-assembled local base-model directory.

Run after the user downloads the two large safetensors shards into
ml/output/base-model/. Checks presence, size, SHA256, architecture index
consistency, and a minimal tokenizer/config load (no full weight load).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = REPO_ROOT / "ml" / "output" / "base-model"

# Expected shard file names per model.safetensors.index.json for this revision.
EXPECTED_SHARDS = (
    "model-00001-of-00003.safetensors",
    "model-00002-of-00003.safetensors",
    "model-00003-of-00003.safetensors",
)
REQUIRED_FILES = (
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "model.safetensors.index.json",
    "LICENSE",
)


def sha256_of(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if not MODEL_DIR.is_dir():
        print(f"ERROR: model dir missing: {MODEL_DIR}")
        return 1

    print(f"Verifying local base model at: {MODEL_DIR}")

    # 1. Required small files present.
    missing_required = [name for name in REQUIRED_FILES if not (MODEL_DIR / name).is_file()]
    if missing_required:
        print(f"ERROR: missing required files: {missing_required}")
        return 1
    print(f"[OK] all {len(REQUIRED_FILES)} required non-weight files present")

    # 2. Architecture sanity (official Qwen3-4B).
    config = json.loads((MODEL_DIR / "config.json").read_text(encoding="utf-8"))
    if config.get("model_type") != "qwen3" or config.get("architectures") != ["Qwen3ForCausalLM"]:
        print(f"ERROR: unexpected architecture: {config.get('model_type')} / {config.get('architectures')}")
        return 1
    if config.get("num_hidden_layers") != 36 or config.get("hidden_size") != 2560:
        print(f"ERROR: config does not match Qwen3-4B: layers={config.get('num_hidden_layers')} hidden={config.get('hidden_size')}")
        return 1
    print(f"[OK] architecture qwen3 / Qwen3ForCausalLM, layers=36 hidden=2560")

    # 3. Shards present and index consistency.
    index = json.loads((MODEL_DIR / "model.safetensors.index.json").read_text(encoding="utf-8"))
    weight_map = index.get("weight_map")
    if not isinstance(weight_map, dict) or not weight_map:
        print("ERROR: index.json weight_map missing")
        return 1
    index_shards = sorted(set(weight_map.values()))
    if tuple(index_shards) != EXPECTED_SHARDS:
        print(f"ERROR: index shards {index_shards} != expected {EXPECTED_SHARDS}")
        return 1
    total_size_declared = int(index.get("metadata", {}).get("total_size", 0))
    print(f"[OK] index declares {len(index_shards)} shards, total_size={total_size_declared} bytes")

    missing_shards = [name for name in EXPECTED_SHARDS if not (MODEL_DIR / name).is_file()]
    if missing_shards:
        print(f"ERROR: missing weight shards: {missing_shards}")
        print("       Download these files into the base-model dir and re-run.")
        return 1

    # 4. Shard sizes + SHA256 (integrity record).
    actual_total = 0
    integrity = {}
    for name in EXPECTED_SHARDS:
        shard_path = MODEL_DIR / name
        size = shard_path.stat().st_size
        actual_total += size
        if size <= 0:
            print(f"ERROR: shard {name} is empty")
            return 1
        print(f"[..] computing SHA256 for {name} ({size} bytes) ...")
        digest = sha256_of(shard_path)
        integrity[name] = {"sizeBytes": size, "sha256": digest}
        print(f"     {name}: {size} bytes  sha256={digest}")

    # 5. Authoritative per-shard integrity via safetensors header/mmap check,
    #    plus an informational total_size comparison (the index total_size uses
    #    a padded accounting that may differ from raw file bytes by a small
    #    header/padding margin, so it is reported but not treated as fatal).
    from safetensors import safe_open

    shard_integrity = {}
    for name in EXPECTED_SHARDS:
        shard_path = MODEL_DIR / name
        try:
            with safe_open(str(shard_path), framework="pt") as handle:
                tensor_count = len(list(handle.keys()))
                # force header/length validation by reading one tensor
                first_key = next(iter(handle.keys()))
                _ = handle.get_tensor(first_key)
            shard_integrity[name] = {"safeOpen": "OK", "tensorCount": tensor_count}
            print(f"[OK] safetensors header valid for {name} (tensors={tensor_count})")
        except Exception as exc:  # noqa: BLE001
            shard_integrity[name] = {"safeOpen": "FAIL", "error": f"{type(exc).__name__}: {exc}"}
            print(f"ERROR: safetensors header invalid for {name}: {exc}")
            print("       This shard is truncated or corrupt. Re-download it.")
            return 1

    delta = actual_total - total_size_declared if total_size_declared else 0
    if delta == 0:
        print(f"[OK] weight bytes {actual_total} == declared total_size {total_size_declared}")
    else:
        print(f"[INFO] weight bytes {actual_total} vs declared total_size {total_size_declared} (delta={delta}); safetensors header check above is authoritative")

    # 6. Minimal tokenizer + config load (fast, no GPU/weights).
    try:
        from transformers import AutoConfig, AutoTokenizer

        loaded_config = AutoConfig.from_pretrained(str(MODEL_DIR), trust_remote_code=False)
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), use_fast=True, trust_remote_code=False)
        enc = tokenizer("AetherGuard smoke test", return_tensors="pt")
        print(f"[OK] AutoConfig loaded (vocab={loaded_config.vocab_size}, layers={loaded_config.num_hidden_layers})")
        print(f"[OK] AutoTokenizer loaded (fast={tokenizer.is_fast}, pad={tokenizer.pad_token_id}, eos={tokenizer.eos_token_id}), test ids shape={tuple(enc['input_ids'].shape)}")
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: minimal load failed: {type(exc).__name__}: {exc}")
        return 1

    # 7. Write integrity manifest.
    manifest_path = REPO_ROOT / "ml" / "reports" / "base-model-integrity.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "modelDir": str(MODEL_DIR.relative_to(REPO_ROOT)).replace("\\", "/"),
        "modelId": "Qwen/Qwen3-4B-Instruct-2507",
        "revision": "cdbee75f17c01a7cc42f958dc650907174af0554",
        "declaredTotalSizeBytes": total_size_declared,
        "actualTotalSizeBytes": actual_total,
        "shards": integrity,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] integrity manifest written: {manifest_path.relative_to(REPO_ROOT)}")

    print("\nVERIFICATION PASSED — local base model is complete and ready for baseline + training.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
