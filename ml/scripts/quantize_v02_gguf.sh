#!/usr/bin/env bash
set -euo pipefail
GGUF_DIR=/mnt/d/aetherargus-v02-gguf
QUANT=$HOME/llama.cpp/build/bin/llama-quantize
cd "$GGUF_DIR"
for t in Q8_0 Q6_K Q5_K_M Q4_K_M; do
  echo "=== quantize $t ==="
  "$QUANT" aetherargus-v02-f16.gguf "aetherargus-v02-$t.gguf" "$t" 2>&1 | tail -3
done
echo "=== all sizes ==="
ls -la "$GGUF_DIR"/*.gguf
