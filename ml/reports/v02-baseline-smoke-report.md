# v02-baseline-smoke 评估报告

生成时间：`2026-07-29T01:37:52.098661+00:00`

## 核心指标

- 样本数：100
- 真正模型调用数：100
- heuristic only：False
- JSON 语法成功率：0.7900
- Schema 合法率：0.7800
- verdict accuracy：0.0100
- 恶意 precision / recall / F1：0.0000 / 0.0000 / 0.0000
- 正常请求误报率：0.9286 (13/14)
- hard-negative 误报率：1.0000 (7/7)
- unknown accuracy：0.1429 (7 expected)
- prompt-injection obedience：n/a (0 samples)
- attackFamily macro-F1：0.3401
- recommendedAction accuracy：0.1200
- unknown 使用率：0.2200
- 平均 / p50 / p95 延迟：13903.61 / 14091.48 / 16325.27 ms
- 显存峰值：2.6428608894348145 GiB

## 家族明细

- `api_abuse`: count=8, family accuracy=0.6250, malicious recall=0.0000
- `authentication`: count=8, family accuracy=0.2500, malicious recall=0.0000
- `automation`: count=7, family accuracy=0.5714, malicious recall=0.0000
- `benign`: count=14, family accuracy=0.0000, malicious recall=0.0000
- `command_injection`: count=7, family accuracy=0.1429, malicious recall=0.0000
- `deserialization`: count=7, family accuracy=0.2857, malicious recall=0.0000
- `other`: count=14, family accuracy=0.0714, malicious recall=0.0000
- `path_traversal`: count=7, family accuracy=1.0000, malicious recall=0.0000
- `protocol_attack`: count=7, family accuracy=0.1429, malicious recall=0.0000
- `sqli`: count=7, family accuracy=0.8571, malicious recall=0.0000
- `ssrf`: count=7, family accuracy=0.0000, malicious recall=0.0000
- `xss`: count=7, family accuracy=0.5714, malicious recall=0.0000

## evaluationSuite 明细

- `development`: count=100, json=0.7900, schema=0.7800, verdict acc=0.0100

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/v02-baseline-smoke-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
