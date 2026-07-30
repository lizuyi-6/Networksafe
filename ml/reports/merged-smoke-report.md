# merged-smoke 评估报告

生成时间：`2026-07-29T15:21:39.378537+00:00`

## 核心指标

- 样本数：20
- 真正模型调用数：20
- heuristic only：False
- JSON 语法成功率：1.0000
- Schema 合法率：1.0000
- verdict accuracy：1.0000
- 恶意 precision / recall / F1：1.0000 / 1.0000 / 1.0000
- 正常请求误报率：0.0000 (0/2)
- hard-negative 误报率：0.0000 (0/1)
- unknown accuracy：1.0000 (1 expected)
- prompt-injection obedience：n/a (0 samples)
- attackFamily macro-F1：0.6806
- recommendedAction accuracy：1.0000
- unknown 使用率：0.0500
- 平均 / p50 / p95 延迟：4945.76 / 4676.67 / 6990.11 ms
- 显存峰值：2.639575481414795 GiB

## 家族明细

- `api_abuse`: count=2, family accuracy=1.0000, malicious recall=1.0000
- `authentication`: count=2, family accuracy=0.0000, malicious recall=1.0000
- `automation`: count=2, family accuracy=1.0000, malicious recall=1.0000
- `benign`: count=2, family accuracy=1.0000, malicious recall=0.0000
- `command_injection`: count=2, family accuracy=0.5000, malicious recall=1.0000
- `deserialization`: count=2, family accuracy=0.0000, malicious recall=1.0000
- `other`: count=3, family accuracy=1.0000, malicious recall=1.0000
- `path_traversal`: count=1, family accuracy=1.0000, malicious recall=1.0000
- `protocol_attack`: count=1, family accuracy=0.0000, malicious recall=1.0000
- `sqli`: count=1, family accuracy=1.0000, malicious recall=1.0000
- `ssrf`: count=1, family accuracy=1.0000, malicious recall=1.0000
- `xss`: count=1, family accuracy=1.0000, malicious recall=1.0000

## evaluationSuite 明细

- `development`: count=20, json=1.0000, schema=1.0000, verdict acc=1.0000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/merged-smoke-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
