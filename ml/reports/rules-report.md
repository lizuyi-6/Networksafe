# rules 评估报告

生成时间：`2026-07-27T21:46:05.213738+00:00`

## 核心指标

- 样本数：120
- 真正模型调用数：0
- heuristic only：True
- JSON 语法成功率：1.0000
- Schema 合法率：1.0000
- verdict accuracy：0.4000
- 恶意 precision / recall / F1：0.2222 / 0.1463 / 0.1765
- 正常请求误报率：0.3788 (25/66)
- attackFamily macro-F1：0.0990
- recommendedAction accuracy：0.4000
- unknown 使用率：0.0000
- 平均 / p50 / p95 延迟：0.23 / 0.12 / 0.39 ms
- 显存峰值：None GiB

## 家族明细

- `api_abuse`: count=3, family accuracy=0.0000, malicious recall=0.0000
- `authentication`: count=4, family accuracy=0.0000, malicious recall=0.0000
- `automation`: count=2, family accuracy=0.0000, malicious recall=0.0000
- `benign`: count=66, family accuracy=0.6212, malicious recall=0.0000
- `command_injection`: count=5, family accuracy=0.0000, malicious recall=0.2000
- `deserialization`: count=4, family accuracy=0.0000, malicious recall=0.0000
- `file_upload`: count=1, family accuracy=0.0000, malicious recall=1.0000
- `other`: count=13, family accuracy=0.0769, malicious recall=0.0000
- `path_traversal`: count=5, family accuracy=0.2000, malicious recall=0.2000
- `protocol_attack`: count=5, family accuracy=0.0000, malicious recall=0.2000
- `sqli`: count=5, family accuracy=0.0000, malicious recall=0.0000
- `ssrf`: count=2, family accuracy=0.0000, malicious recall=0.0000
- `xss`: count=5, family accuracy=0.6000, malicious recall=0.4000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/rules-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
