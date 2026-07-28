# baseline 评估报告

生成时间：`2026-07-27T17:44:38.915938+00:00`

## 核心指标

- 样本数：120
- 真正模型调用数：120
- heuristic only：False
- JSON 语法成功率：0.9167
- Schema 合法率：0.8667
- verdict accuracy：0.2833
- 恶意 precision / recall / F1：1.0000 / 0.0732 / 0.1364
- 正常请求误报率：0.5152 (34/66)
- attackFamily macro-F1：0.4582
- recommendedAction accuracy：0.3917
- unknown 使用率：0.2000
- 平均 / p50 / p95 延迟：16887.54 / 17042.92 / 21898.95 ms
- 显存峰值：2.633425235748291 GiB

## 家族明细

- `api_abuse`: count=3, family accuracy=0.3333, malicious recall=0.0000
- `authentication`: count=4, family accuracy=0.7500, malicious recall=0.0000
- `automation`: count=2, family accuracy=0.5000, malicious recall=0.0000
- `benign`: count=66, family accuracy=0.3333, malicious recall=0.0000
- `command_injection`: count=5, family accuracy=0.4000, malicious recall=0.2000
- `deserialization`: count=4, family accuracy=0.7500, malicious recall=0.2500
- `file_upload`: count=1, family accuracy=1.0000, malicious recall=1.0000
- `other`: count=13, family accuracy=0.6154, malicious recall=0.0000
- `path_traversal`: count=5, family accuracy=1.0000, malicious recall=0.0000
- `protocol_attack`: count=5, family accuracy=0.2000, malicious recall=0.0000
- `sqli`: count=5, family accuracy=0.8000, malicious recall=0.0000
- `ssrf`: count=2, family accuracy=1.0000, malicious recall=0.0000
- `xss`: count=5, family accuracy=1.0000, malicious recall=0.0000

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/baseline-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
