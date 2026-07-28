# cmp-llama32-3b 评估报告

生成时间：`2026-07-28T04:11:53.510594+00:00`

## 核心指标

- 样本数：120
- 真正模型调用数：120
- heuristic only：False
- JSON 语法成功率：0.8333
- Schema 合法率：0.1000
- verdict accuracy：0.0917
- 恶意 precision / recall / F1：0.0000 / 0.0000 / 0.0000
- 正常请求误报率：0.0455 (3/66)
- attackFamily macro-F1：0.1592
- recommendedAction accuracy：0.1000
- unknown 使用率：0.9000
- 平均 / p50 / p95 延迟：764.86 / 817.96 / 1061.79 ms
- 显存峰值：None GiB

## 家族明细

- `api_abuse`: count=3, family accuracy=0.0000, malicious recall=0.0000
- `authentication`: count=4, family accuracy=0.2500, malicious recall=0.0000
- `automation`: count=2, family accuracy=0.0000, malicious recall=0.0000
- `benign`: count=66, family accuracy=0.0000, malicious recall=0.0000
- `command_injection`: count=5, family accuracy=0.2000, malicious recall=0.0000
- `deserialization`: count=4, family accuracy=0.2500, malicious recall=0.0000
- `file_upload`: count=1, family accuracy=0.0000, malicious recall=0.0000
- `other`: count=13, family accuracy=0.9231, malicious recall=0.0000
- `path_traversal`: count=5, family accuracy=0.0000, malicious recall=0.0000
- `protocol_attack`: count=5, family accuracy=0.0000, malicious recall=0.0000
- `sqli`: count=5, family accuracy=0.2000, malicious recall=0.0000
- `ssrf`: count=2, family accuracy=0.5000, malicious recall=0.0000
- `xss`: count=5, family accuracy=0.0000, malicious recall=0.0000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/cmp-llama32-3b-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
