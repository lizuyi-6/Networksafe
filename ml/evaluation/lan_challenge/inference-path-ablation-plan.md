# Locked inference-path ablation plan

Status: **LOCKED_PRE_RUN**. Implementation-only fixes made before any diagnostic prediction are disclosed in `inference-path-ablation-amendments.md`. This plan completes diagnostics already named by protocol v1/v2. It does not change a primary model, system prompt, label, threshold, or generation hyperparameter, and it was committed before the four diagnostic prediction files.

Protocol v2 commit: `553c0a9317e8c21f616991e92149fc828d7e8902`; canonical protocol SHA-256: `b5fe38cb554a8ee63adfbb767a2ff5a2a73b18ac096e2f8812183f7979b4fdeb`.

## Frozen controls

- Input SHA-256: `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`; 413 samples.
- System prompt SHA-256: `9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8`.
- Context 2048; output cap 320; temperature 0; top_p 1; top_k 0; seed 0.
- Transformers artifact: merged BF16 from the locked checkpoint lineage.
- Ollama artifact: f16 GGUF from the same checkpoint lineage. It is not claimed to be bit-identical to the BF16 artifact.

## Predeclared comparisons

1. Within Transformers and within Ollama, compare native `system + user` with one `user` message containing byte-identical `systemPrompt.rstrip("\n") + "\n\n" + userMessage`. Only message structure changes within each runtime.
2. Serialize `system + user` once with the locked Transformers tokenizer chat template. Feed those exact prompt bytes to Transformers and to Ollama's raw generate endpoint. This removes per-runtime message serialization as a free variable.
3. Compare each runtime's native template path with the shared Transformers-serialized path. This quantifies template/serialization sensitivity.

The cross-runtime comparison still couples runtime with the unavoidable BF16-to-f16 artifact representation. It may not be described as a pure quantization or pure runtime effect.

## Operator commands

Run from the repository root on the same frozen operator machine used for the primary BF16/f16 runs. Set `AA_MERGED_MODEL` to the locked merged-model directory and `AA_OLLAMA_F16` to the existing locked Ollama f16 tag. `AA_SERIALIZED` is deliberately under the repository-ignored `tmp/` directory.

```bash
export AA_MERGED_MODEL='D:/aetherargus-v02-merged'
export AA_OLLAMA_F16='aetherargus-v02-f16'
export AA_SERIALIZED='tmp/aetherargus-hf-serialized-prompts.jsonl'

python ml/evaluation/lan_challenge/prepare_ablation_prompts.py \
  --tokenizer "$AA_MERGED_MODEL" \
  --revision cdbee75f17c01a7cc42f958dc650907174af0554 \
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \
  --prompt ml/evaluation/lan_challenge/system-prompt.txt \
  --output "$AA_SERIALIZED"

python ml/evaluation/lan_challenge/run_transformers.py \
  --model-id aetherargus-v02-merged-bf16-single-concat \
  --model "$AA_MERGED_MODEL" \
  --revision cdbee75f17c01a7cc42f958dc650907174af0554 \
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \
  --prompt ml/evaluation/lan_challenge/system-prompt.txt \
  --message-mode single-concatenated \
  --output ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-merged-bf16-single-concat.jsonl

python ml/evaluation/lan_challenge/run_ollama.py \
  --model-id aetherargus-v02-ollama-f16-single-concat \
  --ollama-model "$AA_OLLAMA_F16" \
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \
  --prompt ml/evaluation/lan_challenge/system-prompt.txt \
  --message-mode single-concatenated \
  --output ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-ollama-f16-single-concat.jsonl

python ml/evaluation/lan_challenge/run_transformers.py \
  --model-id aetherargus-v02-merged-bf16-hf-serialized \
  --model "$AA_MERGED_MODEL" \
  --revision cdbee75f17c01a7cc42f958dc650907174af0554 \
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \
  --prompt ml/evaluation/lan_challenge/system-prompt.txt \
  --message-mode pre-serialized \
  --serialized-prompts "$AA_SERIALIZED" \
  --output ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-merged-bf16-hf-serialized.jsonl

python ml/evaluation/lan_challenge/run_ollama.py \
  --model-id aetherargus-v02-ollama-f16-hf-serialized \
  --ollama-model "$AA_OLLAMA_F16" \
  --input ml/data/lan_challenge_capture/model-inputs.jsonl \
  --prompt ml/evaluation/lan_challenge/system-prompt.txt \
  --message-mode pre-serialized \
  --serialized-prompts "$AA_SERIALIZED" \
  --output ml/reports/lan-challenge-evaluation/predictions/ablation/aetherargus-v02-ollama-f16-hf-serialized.jsonl

python ml/evaluation/lan_challenge/run_ablation.py
python ml/evaluation/lan_challenge/validate-paper-evidence.py
```

The first file contains serialized, sanitized model inputs and must not be committed. The four prediction files are committed only after the repository privacy scan passes. Scoring opens the frozen labels only after every prediction file covers all 413 `sampleId` values.
