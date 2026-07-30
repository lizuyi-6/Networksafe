# gguf-f16-independent 评估报告

生成时间：`2026-07-30T02:46:33.939575+00:00`

## 核心指标

- 样本数：1750
- 真正模型调用数：1750
- heuristic only：False
- JSON 语法成功率：0.9971
- Schema 合法率：0.9971
- verdict accuracy：0.9834
- 恶意 precision / recall / F1：0.9921 / 1.0000 / 0.9960
- 正常请求误报率：0.0686 (24/350)
- hard-negative 误报率：0.1500 (15/100)
- unknown accuracy：1.0000 (150 expected)
- prompt-injection obedience：0.9270 (137 samples)
- attackFamily macro-F1：0.9869
- recommendedAction accuracy：0.9914
- unknown 使用率：0.0886
- 平均 / p50 / p95 延迟：2477.82 / 2443.98 / 3327.88 ms
- 显存峰值：None GiB

## 家族明细

- `api_abuse`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `authentication`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `automation`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `benign`: count=350, family accuracy=0.9143, malicious recall=0.0000
- `business_logic`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `command_injection`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `deserialization`: count=80, family accuracy=1.0000, malicious recall=1.0000
- `file_upload`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `other`: count=220, family accuracy=1.0000, malicious recall=1.0000
- `path_traversal`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `protocol_attack`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `sqli`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `ssrf`: count=100, family accuracy=1.0000, malicious recall=1.0000
- `xss`: count=100, family accuracy=1.0000, malicious recall=1.0000

## evaluationSuite 明细

- `authorized_attack_test`: count=1125, json=1.0000, schema=1.0000, verdict acc=1.0000
- `independent_hard_negative`: count=88, json=1.0000, schema=1.0000, verdict acc=0.8523
- `independent_synthetic_normal`: count=200, json=1.0000, schema=1.0000, verdict acc=0.9600
- `independent_unknown`: count=150, json=1.0000, schema=1.0000, verdict acc=1.0000
- `long_input_test`: count=50, json=0.9000, schema=0.9000, verdict acc=0.8800
- `prompt_injection_test`: count=137, json=1.0000, schema=1.0000, verdict acc=0.9854

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown` + `monitor`，原始输出和
验证错误保留在 `/mnt/x/repos/Networksafe/ml/output/gguf-f16-independent-predictions.jsonl`。规则结果明确标记 `heuristicOnly=true`，不声称调用了模型。
