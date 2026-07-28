#!/usr/bin/env bash
set -euo pipefail
SNAP="/home/break/.cache/huggingface/hub/models--Qwen--Qwen3-4B-Instruct-2507/snapshots/cdbee75f17c01a7cc42f958dc650907174af0554"
DEST="/mnt/x/repos/Networksafe/ml/output/base-model"
mkdir -p "$DEST"
echo "Copying already-downloaded files from HF cache to $DEST ..."
cp -rL "$SNAP"/* "$DEST/"
echo "--- dest contents (size bytes | name) ---"
cd "$DEST"
for f in *; do
  printf '%s | %s\n' "$(stat -c '%s' "$f")" "$f"
done
