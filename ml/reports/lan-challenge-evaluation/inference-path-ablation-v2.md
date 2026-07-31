# Inference-Path Ablation v2

**Status: COMPLETE.** Every predeclared diagnostic covers all 413 frozen inputs.

## Controls

Context length 2048, output cap 320, temperature 0, top_p 1, top_k 0, seed 0, system prompt SHA-256 `9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8`, input SHA-256 `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`.

## Results

| comparison | verdict agreement | left safe FPR | right safe FPR | delta (right-left) |
| --- | ---: | ---: | ---: | ---: |
| Native system+user: Transformers vs Ollama | 413/413 (100.0%) | 0.2057 | 0.2057 | +0.0000 |
| Transformers: system+user vs single concatenated | 402/413 (97.3%) | 0.2057 | 0.2249 | +0.0191 |
| Ollama: system+user vs single concatenated | 402/413 (97.3%) | 0.2057 | 0.2297 | +0.0239 |
| Shared HF-serialized prompt: Transformers vs Ollama | 413/413 (100.0%) | 0.2057 | 0.2057 | +0.0000 |
| Transformers: native vs pre-serialized | 413/413 (100.0%) | 0.2057 | 0.2057 | +0.0000 |
| Ollama: native vs pre-serialized | 413/413 (100.0%) | 0.2057 | 0.2057 | +0.0000 |

## Artifact qualification

Both artifacts descend from the same trained checkpoint, but they are not bit-identical: Transformers uses merged BF16 safetensors and Ollama uses an f16 GGUF conversion. Therefore cross-runtime differences still combine runtime and numeric-representation effects.

## Conclusion

With byte-identical pre-serialized prompts, the Transformers merged-BF16 and Ollama f16 paths agreed on 413/413 verdicts (100.0%) on this frozen set. The within-runtime message-structure comparisons quantify template/serialization sensitivity. Any residual cross-runtime effect still combines runtime and BF16-to-f16 representation and must not be attributed to quantization alone.

Latency is intentionally excluded from causal ranking because the two timing boundaries and runtime overheads differ.
