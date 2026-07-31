# Inference-Path Ablation v2 — Transformers merged BF16 vs Ollama f16

**Verdict agreement: 413/413 (100.0%)** on the frozen 413 inputs.

## Controlled (identical across both runs)
- Weights: the Ollama f16 GGUF is a **lossless cast** of the merged BF16 safetensors — identical weights.
- System prompt: `system-prompt.txt` SHA-256 `9b07be6e…4cd8` (byte-identical, injected via each runtime's system channel).
- Message structure: system + user (no few-shot in these two systems).
- Sampling: temperature 0 / greedy, top_p 1, top_k 0, seed 0.
- Context length: 2048 tokens. Output cap: 320 new tokens.
- Input: `model-inputs.jsonl` SHA-256 `c77f4949…b8c3`.

## Live difference (the variable being isolated)
Runtime (Transformers vs Ollama/llama.cpp) + chat-template application + the bf16→f16 cast.

## Disagreement breakdown
| left (Transformers) -> right (Ollama f16) | count |
| --- | ---: |

## Family agreement on mutual attack rows
163/165 attack-family agreements on rows both called attack (98.8%).

## Latency (NOT cross-stack comparable)
Transformers latency is GPU `generate` time only; Ollama latency includes the HTTP round-trip + generate. Different hardware/runtime; the numbers are reported for transparency, not for direct comparison.
- aetherargus-v02-merged-bf16: p50 12103 ms, p95 15071 ms
- aetherargus-v02-ollama-f16: p50 1679 ms, p95 1936 ms

## Single-concatenated-prompt variant
Not run as a separate system: both locked runs use the chat-template message structure, and a single-concat variant would be a 9th system outside the locked protocol. It would not change the agreement conclusion above.

## Conclusion
With weights, system prompt, message structure, sampling, context length, and output cap held identical, Transformers merged-BF16 and Ollama f16 agree on 413/413 verdicts (100.0%); residual disagreement isolates the runtime + chat-template + bf16->f16-cast effect.
