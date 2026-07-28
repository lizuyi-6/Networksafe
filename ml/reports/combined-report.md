# combined 评估报告

生成时间：`2026-07-28T01:30:09.161736+00:00`

## 核心指标

- 样本数：120
- 真正模型调用数：120
- heuristic only：False
- JSON 语法成功率：0.9917
- Schema 合法率：0.9833
- verdict accuracy：0.7083
- 恶意 precision / recall / F1：0.6066 / 0.9024 / 0.7255
- 正常请求误报率：0.3939 (26/66)
- attackFamily macro-F1：0.5208
- recommendedAction accuracy：0.7083
- unknown 使用率：0.0833
- 平均 / p50 / p95 延迟：6116.62 / 6116.31 / 9110.87 ms
- 显存峰值：2.694413661956787 GiB

## 家族明细

- `api_abuse`: count=3, family accuracy=0.0000, malicious recall=0.3333
- `authentication`: count=4, family accuracy=0.7500, malicious recall=1.0000
- `automation`: count=2, family accuracy=0.5000, malicious recall=1.0000
- `benign`: count=66, family accuracy=0.6061, malicious recall=0.0000
- `command_injection`: count=5, family accuracy=0.4000, malicious recall=1.0000
- `deserialization`: count=4, family accuracy=0.7500, malicious recall=1.0000
- `file_upload`: count=1, family accuracy=0.0000, malicious recall=1.0000
- `other`: count=13, family accuracy=0.6154, malicious recall=1.0000
- `path_traversal`: count=5, family accuracy=0.8000, malicious recall=0.8000
- `protocol_attack`: count=5, family accuracy=0.6000, malicious recall=1.0000
- `sqli`: count=5, family accuracy=0.6000, malicious recall=0.8000
- `ssrf`: count=2, family accuracy=1.0000, malicious recall=1.0000
- `xss`: count=5, family accuracy=1.0000, malicious recall=1.0000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/combined-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
