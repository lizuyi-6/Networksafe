# merged-smoke 评估报告

生成时间：`2026-07-28T01:49:34.385249+00:00`

## 核心指标

- 样本数：20
- 真正模型调用数：20
- heuristic only：False
- JSON 语法成功率：1.0000
- Schema 合法率：1.0000
- verdict accuracy：0.9500
- 恶意 precision / recall / F1：1.0000 / 1.0000 / 1.0000
- 正常请求误报率：0.0000 (0/14)
- attackFamily macro-F1：0.6580
- recommendedAction accuracy：0.9500
- unknown 使用率：0.1000
- 平均 / p50 / p95 延迟：2805.17 / 2454.47 / 4111.78 ms
- 显存峰值：2.6309828758239746 GiB

## 家族明细

- `benign`: count=14, family accuracy=1.0000, malicious recall=0.0000
- `deserialization`: count=2, family accuracy=1.0000, malicious recall=1.0000
- `other`: count=3, family accuracy=0.6667, malicious recall=0.0000
- `protocol_attack`: count=1, family accuracy=0.0000, malicious recall=1.0000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/merged-smoke-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
