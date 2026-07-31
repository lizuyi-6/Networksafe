# AetherArgus Frozen VIguard LAN Challenge Evidence Report

## 1. Experiment identity

- Evaluation completion: `2026-07-31T12:42:52.104104+00:00`
- Evidence merge commit: `279282128f7bb1d11c2f4d49aa043a57a7b82fb5`
- Evaluation code commit: `9ebd1d2393efaf86b75adb3646c71e0727965768`
- Protocol commit: `553c0a9317e8c21f616991e92149fc828d7e8902`
- Protocol SHA-256: `b5fe38cb554a8ee63adfbb767a2ff5a2a73b18ac096e2f8812183f7979b4fdeb`
- Input SHA-256: `c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3`
- Label SHA-256: `13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad`
- Primary systems: **8/8 complete, 413/413 each**
- Inference-path diagnostic variants: **4/4 complete, 413/413 each**
- Frozen evidence validation: **27/27 PASS**

The challenge set was not used for training, prompt selection, threshold selection, hyperparameter tuning, checkpoint selection, or model selection.

## 2. Reference-label provenance

The reference labels were produced through:

1. independent annotation by GPT-5.6-SOL and Claude Opus 5;
2. third-model adjudication by operator-confirmed GLM-5.2;
3. a complete model-visible-context audit;
4. a subsequent confidential blind human review conducted outside the public repository.

The human review covered all **413/413** samples and found **0** disagreements with the frozen reference labels. No label bytes changed, so the final-label SHA-256 remained:

```text
13fd71f5507ec9bf6db74c38fafb073c76e9766c0e20e874452d3c62302ad8ad
```

The human review occurred after the frozen model evaluation. Because the label file remained byte-identical, no model prediction rerun or rescoring was required. Reviewer identities, count, worksheets, and raw materials are retained in a restricted environment and are not published in the repository. The public evidence is an operator-confirmed attestation:

```text
ml/data/lan_challenge_capture/human-review/human-review-attestation.json
SHA-256: 2c273945369cf41d98fe02072518b01151e17e2d98a5642e657dc3be2b5b9cbd
```

Publication terminology: **confidentially human-reviewed reference labels**.

## 3. Environment

- OS: Windows 11
- CPU: Intel64 Family 6 Model 183
- RAM: 31.73 GiB
- GPU: NVIDIA GeForce RTX 5070 Ti Laptop GPU
- CUDA: 13.0
- Python: 3.12.10
- PyTorch / Transformers / PEFT: 2.12.0.dev20260223+cu130 / 5.2.0 / 0.20.0
- Ollama: 0.32.5

## 4. Main results

| Model | Accuracy | Macro-F1 | Attack F1 | Attack recall | Safe FPR | Unknown recall | Schema valid |
|---|---:|---:|---:|---:|---:|---:|---:|
| **AetherArgus HF-LoRA** | **0.6150** | **0.4658** | **0.6692** | **0.9072** | 0.2057 | 0.0000 | 1.0000 |
| AetherArgus merged BF16 | 0.6150 | 0.4661 | 0.6718 | 0.9072 | 0.2057 | 0.0000 | 1.0000 |
| AetherArgus Ollama f16 | 0.6150 | 0.4661 | 0.6718 | 0.9072 | 0.2057 | 0.0000 | 1.0000 |
| AetherArgus Q4_K_M | 0.6005 | 0.4559 | 0.6519 | 0.9072 | 0.2249 | 0.0000 | 0.9952 |
| Qwen3-4B zero-shot | 0.5230 | 0.4175 | 0.4964 | 0.7113 | 0.3206 | 0.0561 | 1.0000 |
| Qwen3-4B few-shot | 0.5133 | 0.4114 | 0.4758 | 0.6082 | 0.2679 | 0.0654 | 0.9976 |
| Rules baseline | 0.5206 | 0.2994 | 0.1606 | 0.1134 | 0.0144 | 0.0187 | 1.0000 |
| Char n-gram LR | 0.2349 | 0.1273 | 0.3819 | 1.0000 | 1.0000 | 0.0000 | 1.0000 |

AetherArgus HF-LoRA versus Qwen3-4B zero-shot:

- Macro-F1 difference: **+0.0482**, paired bootstrap 95% CI **[+0.0113, +0.0835]**.
- Attack F1: **0.6692 vs 0.4964**.
- Safe FPR: **20.57% vs 32.06%**.
- Holm-corrected McNemar p-value: **8.358e-7**.

These are frozen-set results, not universal model-capability claims.

## 5. Primary-model confusion matrix

```text
reference\prediction     safe   attack  unknown
safe                       166       43        0
attack                       9       88        0
unknown                     72       35        0
```

Material limitations:

- Safe FPR: **43/209 = 20.57%**.
- Unknown recall: **0/107 = 0%**.
- The model is attack-sensitive but does not provide reliable abstention.
- The model is not suitable for autonomous production blocking.

## 6. Statistical analysis

- 10,000-draw reference-verdict-stratified bootstrap, seed `20260731`.
- Paired McNemar tests.
- Paired bootstrap differences.
- Holm-Bonferroni correction.
- Clopper-Pearson and Wilson intervals for proportion metrics.

For AetherArgus HF-LoRA:

- Accuracy 95% CI: `[0.5835, 0.6441]`.
- Macro-F1 95% CI: `[0.4415, 0.4894]`.

Machine-readable results are in `metrics/statistical-analysis.json`.

## 7. Inference-path ablation

Changing only message structure from native `system + user` to one concatenated message changed 11/413 verdicts in both Transformers and Ollama:

| Runtime | Native safe FPR | Single-concat safe FPR | Verdict agreement |
|---|---:|---:|---:|
| Transformers | 43/209 | 47/209 | 402/413 |
| Ollama | 43/209 | 48/209 | 402/413 |

With byte-identical HF-pre-serialized prompts, Transformers merged BF16 and Ollama f16 agreed on **413/413** verdicts. This does not prove numerical equivalence outside the frozen set and does not isolate runtime from BF16-to-f16 representation effects.

## 8. Model size

| Artifact | Measured size |
|---|---:|
| Qwen3-4B base | 8,044,982,000 B |
| Base + LoRA adapter | 8,177,169,888 B |
| Merged BF16 | 8,044,982,000 B |
| f16 GGUF | 8,051,283,232 B |
| Q4_K_M GGUF | 2,497,278,752 B |

Q4_K_M uses approximately 31% of the BF16 storage while preserving most verdict-level performance. The observed Macro-F1 difference between merged BF16 and Q4_K_M was +0.0102 in favor of BF16, with 95% CI `[-0.0043, +0.0249]`.

## 9. Threats and limitations

1. The public human-review evidence is an operator-confirmed attestation; confidential raw reviewer worksheets are not publicly auditable.
2. Human review occurred after evaluation, although the unchanged label hash preserves the applicability of the existing scoring.
3. Human confirmation does not make the labels infallible or universally generalizable ground truth.
4. The challenge set is authorized synthetic/live-captured challenge traffic, not natural production traffic.
5. The benchmark contains no confirmed successful exploits.
6. AetherArgus has a 20.57% safe FPR and 0% unknown recall.
7. Cross-stack latency is not directly comparable because timing boundaries differ.
8. Q4 and BF16 are not proven equivalent.
9. The AI annotation systems may share systematic biases; annotator B also has intra-class correlation risk from a deterministic program authored in one model session.

## 10. Reproduction and validation

```bash
node ml/data/lan_challenge_capture/adjudication/validate-context-visibility.js
node ml/data/lan_challenge_capture/adjudication/validate-adjudication.js
python ml/evaluation/lan_challenge/validate-paper-evidence.py
```

The original frozen evaluation validation remains a historical 27/27 result. The post-evaluation human-review state is validated by the two dataset-side validators and the SHA-bound attestation without rewriting the historical prediction files.
