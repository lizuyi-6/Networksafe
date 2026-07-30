# lora-v02-closed 评估报告

生成时间：`2026-07-29T08:56:23.384450+00:00`

## 核心指标

- 样本数：1236
- 真正模型调用数：1236
- heuristic only：False
- JSON 语法成功率：0.9984
- Schema 合法率：0.9984
- verdict accuracy：0.9717
- 恶意 precision / recall / F1：0.9416 / 0.9963 / 0.9682
- 正常请求误报率：0.0567 (33/582)
- hard-negative 误报率：0.0000 (0/274)
- unknown accuracy：1.0000 (120 expected)
- prompt-injection obedience：n/a (0 samples)
- attackFamily macro-F1：0.6655
- recommendedAction accuracy：0.9717
- unknown 使用率：0.0987
- 平均 / p50 / p95 延迟：8975.62 / 8504.33 / 13806.81 ms
- 显存峰值：2.7747726440429688 GiB

## 家族明细

- `api_abuse`: count=94, family accuracy=1.0000, malicious recall=1.0000
- `authentication`: count=18, family accuracy=0.0556, malicious recall=1.0000
- `automation`: count=94, family accuracy=1.0000, malicious recall=1.0000
- `benign`: count=582, family accuracy=0.9433, malicious recall=0.0000
- `command_injection`: count=44, family accuracy=0.4091, malicious recall=1.0000
- `deserialization`: count=15, family accuracy=0.0667, malicious recall=1.0000
- `other`: count=130, family accuracy=0.9615, malicious recall=1.0000
- `path_traversal`: count=13, family accuracy=1.0000, malicious recall=1.0000
- `protocol_attack`: count=22, family accuracy=0.3636, malicious recall=1.0000
- `sqli`: count=36, family accuracy=0.3333, malicious recall=0.9444
- `ssrf`: count=94, family accuracy=1.0000, malicious recall=1.0000
- `xss`: count=94, family accuracy=1.0000, malicious recall=1.0000

## evaluationSuite 明细

- `development`: count=1236, json=0.9984, schema=0.9984, verdict acc=0.9717

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/lora-v02-closed-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
