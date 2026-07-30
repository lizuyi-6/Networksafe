# Claim-to-evidence matrix

| Claim | Evidence | Field | Support | Allowed wording | Forbidden wording |
|---|---|---|---|---|---|
| C1: The frozen external challenge set contains 413 model-visible requests. | `ml/evaluation/lan_challenge/evaluation-protocol.json` | `dataset.sampleCount` | DIRECT | The frozen evaluation contains 413 request-side samples. | The benchmark is representative production traffic. |
| C2: The repository rule baseline achieved the reported verdict scores. | `ml/reports/lan-challenge-evaluation/metrics/rules-baseline.json` | `verdict.accuracy; verdict.macroF1` | DIRECT | The frozen rule baseline achieved accuracy 0.5690 (95% CI 0.5496-0.5908) and macro-F1 0.3589. | AetherArgus significantly outperformed the rule baseline. |
| C3: The rule baseline had zero safe-to-attack errors in this sample. | `ml/reports/lan-challenge-evaluation/metrics/rules-baseline.json` | `safeFPR` | DIRECT | Observed safe FPR was 0/209 on this frozen set. | The rule engine has no false positives. |
| C4: AetherArgus-versus-baseline superiority was not established in this run. | `ml/reports/lan-challenge-evaluation/metrics/run-status.json` | `models` | NOT_AVAILABLE | This execution could not complete the primary model comparisons. | AetherArgus is universally more capable than Qwen3-4B. |
