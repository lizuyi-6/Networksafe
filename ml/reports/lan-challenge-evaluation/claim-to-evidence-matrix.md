# Claim-to-evidence matrix

This matrix contains only claims supported by the current primary-run artifacts. The incomplete inference-path ablation has no paper claim.

| Claim | Evidence | Field | Support | Allowed wording | Forbidden wording |
|---|---|---|---|---|---|
| C1: Frozen set identity | `ml/evaluation/lan_challenge/evaluation-protocol-v2.json` | `dataset.sampleCount; dataset.referenceDistribution` | DIRECT | The frozen evaluation contains 413 request-side samples (safe=209, attack=97, unknown=107). | Representative production traffic or human ground truth. |
| C2: AetherArgus headline scores | `metrics/aetherargus-v02-hf-lora.json` | `verdict.accuracy; verdict.macroF1` | DIRECT | AetherArgus HF-LoRA achieved accuracy 0.6150 and verdict macro-F1 0.4658 on this frozen set, with the reported 95% bootstrap intervals. | Universal model superiority. |
| C3: Observed safe FPR | `metrics/aetherargus-v02-hf-lora.json` | `safeFPR; proportions.safeFPR.clopperPearson95` | DIRECT | Observed safe FPR was 43/209 (0.2057; CP 95% upper bound 0.2670). | Guaranteed population FPR or no false positives. |
| C4: Strongest baseline comparison | `metrics/statistical-analysis.json` | `mcnemar; pairedBootstrapDifferences` | DIRECT | Against qwen3-4b-zero-shot, AetherArgus HF-LoRA had macro-F1 Δ +0.0482 (paired 95% CI [+0.0113,+0.0835]) and Holm-adjusted McNemar p=8.36e-7. | AetherArgus is universally more capable than Qwen3-4B or every baseline. |

All result-bearing rows use evidence commit `fa1661ddc68ac77ff7304ce11c4bdf2ccc699737`; the protocol row uses `553c0a9317e8c21f616991e92149fc828d7e8902`.
