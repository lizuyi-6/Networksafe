# lora-smoke 评估报告

生成时间：`2026-07-28T01:01:02.614461+00:00`

## 核心指标

- 样本数：3
- 真正模型调用数：3
- heuristic only：False
- JSON 语法成功率：1.0000
- Schema 合法率：1.0000
- verdict accuracy：1.0000
- 恶意 precision / recall / F1：0.0000 / 0.0000 / 0.0000
- 正常请求误报率：0.0000 (0/3)
- attackFamily macro-F1：1.0000
- recommendedAction accuracy：1.0000
- unknown 使用率：0.0000
- 平均 / p50 / p95 延迟：5751.65 / 6272.91 / 7684.32 ms
- 显存峰值：2.692460060119629 GiB

## 家族明细

- `benign`: count=3, family accuracy=1.0000, malicious recall=0.0000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/lora-smoke-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
