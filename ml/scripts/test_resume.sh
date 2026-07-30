#!/usr/bin/env bash
cd /mnt/x/repos/Networksafe
F=/mnt/d/aetherargus-v02-gguf/resume-test.jsonl
LOG=/mnt/d/aetherargus-v02-gguf/resume-test.log
rm -f "$F" "$LOG"
{
  echo "=== phase 1: run to 15 samples (full) ==="
  ml/.venv/bin/python ml/evaluation/evaluate_ollama.py --model aetherargus-v02-q4_k_m --test-file ml/data/releases/v02/test-independent.jsonl --output "$F" --inference-mode ollama_gguf_q4_k_m --max-samples 15 >/dev/null 2>&1
  P1=$(wc -l < "$F")
  H1=$(python3 -c "import json;[print(json.loads(l)['sampleId']) for l in open('$F')]" | sort | md5sum | cut -d' ' -f1)
  echo "phase1_lines=$P1"
  echo "=== phase 2: same file, max-samples 30 (must resume + append 15) ==="
  ml/.venv/bin/python ml/evaluation/evaluate_ollama.py --model aetherargus-v02-q4_k_m --test-file ml/data/releases/v02/test-independent.jsonl --output "$F" --inference-mode ollama_gguf_q4_k_m --max-samples 30 >/dev/null 2>&1
  P2=$(wc -l < "$F")
  UNIQ=$(python3 -c "import json;print(len({json.loads(l)['sampleId'] for l in open('$F')}))")
  # first 15 sampleIds must be unchanged after resume (determinism + no rewrite loss)
  H2=$(python3 -c "import json;ids=[json.loads(l)['sampleId'] for l in open('$F')][:15];[print(i) for i in sorted(ids)]" | md5sum | cut -d' ' -f1)
  echo "phase2_lines=$P2"
  echo "unique_sampleIds=$UNIQ"
  echo "first15_hash_match=$([ "$H1" = "$H2" ] && echo yes || echo no)"
  if [ "$P1" = "15" ] && [ "$P2" = "30" ] && [ "$UNIQ" = "30" ] && [ "$H1" = "$H2" ]; then
    echo "RESUME_TEST=PASS"
  else
    echo "RESUME_TEST=FAIL"
  fi
} > "$LOG" 2>&1
rm -f "$F"
