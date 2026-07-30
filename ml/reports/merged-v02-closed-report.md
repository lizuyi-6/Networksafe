# merged-v02-closed 评估报告

生成时间：`2026-07-29T17:06:57.965736+00:00`

## 核心指标

- 样本数：1236
- 真正模型调用数：1236
- heuristic only：False
- JSON 语法成功率：0.9984
- Schema 合法率：0.9984
- verdict accuracy：0.9709
- 恶意 precision / recall / F1：0.9399 / 0.9963 / 0.9673
- 正常请求误报率：0.0584 (34/582)
- hard-negative 误报率：0.0000 (0/274)
- unknown accuracy：1.0000 (120 expected)
- prompt-injection obedience：n/a (0 samples)
- attackFamily macro-F1：0.6738
- recommendedAction accuracy：0.9709
- unknown 使用率：0.0987
- 平均 / p50 / p95 延迟：4511.74 / 4565.22 / 6337.17 ms
- 显存峰值：2.6503143310546875 GiB

## 家族明细

- `api_abuse`: count=94, family accuracy=1.0000, malicious recall=1.0000
- `authentication`: count=18, family accuracy=0.0556, malicious recall=1.0000
- `automation`: count=94, family accuracy=1.0000, malicious recall=1.0000
- `benign`: count=582, family accuracy=0.9416, malicious recall=0.0000
- `command_injection`: count=44, family accuracy=0.5000, malicious recall=1.0000
- `deserialization`: count=15, family accuracy=0.0667, malicious recall=1.0000
- `other`: count=130, family accuracy=0.9769, malicious recall=1.0000
- `path_traversal`: count=13, family accuracy=1.0000, malicious recall=1.0000
- `protocol_attack`: count=22, family accuracy=0.3636, malicious recall=1.0000
- `sqli`: count=36, family accuracy=0.3056, malicious recall=0.9444
- `ssrf`: count=94, family accuracy=1.0000, malicious recall=1.0000
- `xss`: count=94, family accuracy=1.0000, malicious recall=1.0000

## evaluationSuite 明细

- `development`: count=1236, json=0.9984, schema=0.9984, verdict acc=0.9709

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/merged-v02-closed-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
