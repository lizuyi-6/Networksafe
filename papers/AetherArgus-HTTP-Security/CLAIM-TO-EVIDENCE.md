# Manuscript Claim-to-Evidence Audit

This file maps the paper's load-bearing claims to frozen repository evidence.

| Claim | Evidence | Allowed wording | Prohibited expansion |
|---|---|---|---|
| The challenge set contains 413 request-side samples | `ml/data/lan_challenge_capture/model-inputs.jsonl`; input SHA `c77f...b8c3` | frozen 413-sample authorized LAN challenge set | representative sample of all production traffic |
| Reference distribution is 209 safe / 97 attack / 107 unknown | `adjudication/final-labels-manifest.json` | confidentially human-reviewed reference labels | infallible objective ground truth |
| Human blind review covered 413/413 and changed zero labels | `human-review/human-review-attestation.json`; attestation SHA `2c27...9cbd` | post-evaluation confidential blind human confirmation | publicly reproducible human worksheets or pre-evaluation human annotation |
| HF-LoRA Macro-F1 is 0.4658 | `tables/table-1-main-results.csv`; model metrics JSON | Macro-F1 0.4658 on the frozen challenge set | universal security accuracy |
| Zero-shot Qwen Macro-F1 is 0.4175 | same main-results evidence | Qwen3-4B zero-shot baseline under the frozen prompt | general Qwen capability |
| Macro-F1 difference is +0.0482, 95% CI [+0.0113,+0.0835] | paired bootstrap in `table-3-statistical-tests.csv` | statistically supported improvement on this set | superiority on all traffic or tasks |
| Attack recall is 0.9072 | HF-LoRA metrics | detected 88/97 reference attacks | detects all attacks or zero-days |
| Safe FPR is 43/209 = 0.2057 | HF-LoRA confusion matrix and metrics | observed challenge-set safe FPR | production false-positive rate |
| Unknown recall is 0/107 | HF-LoRA confusion matrix | complete abstention failure on this set | model can never abstain in any environment |
| Q4_K_M retains most verdict quality | merged-vs-Q4 paired bootstrap; artifact sizes | small, non-significant observed Macro-F1 reduction | lossless quantization or numerical equivalence |
| Q4_K_M size is about 2.33 GiB vs 7.49 GiB BF16 | `artifact-inventory.json`; table 4 | approximately 31% of BF16 storage | 3x controlled end-to-end speedup |
| Single-concatenated messages change 11/413 verdicts | `inference-path-ablation-v2.json` | message structure is an isolated source of variance | every template change has the same effect |
| Shared serialized prompts yield 413/413 matching verdicts | inference-path ablation | identical tested verdicts on the frozen set | runtime or BF16/f16 numerical equivalence |

## Mandatory limitations in abstract, discussion, or conclusion

- Safe FPR remains 20.57%.
- Unknown recall is zero.
- Human-review raw materials are withheld.
- Human review occurred after frozen evaluation.
- The challenge set is authorized and curated, not natural production prevalence.
- Training used one seed and one epoch.
- Cross-stack latency is descriptive, not a controlled ranking.
- AetherArgus is not an autonomous blocking authority.
