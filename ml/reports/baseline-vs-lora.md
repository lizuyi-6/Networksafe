# Baseline vs LoRA vs Rules

所有结果来自完全相同的固定 `ml/data/processed/test.jsonl`。`rules` 是现有
`detection-engine.ts` 规则与 heuristic 的实际执行结果，`modelInvocationCount=0`，不能解释为 AI 推理。

## 指标

| Metric | Base | LoRA | Rules (heuristic) | Rules + LoRA |
| --- | ---: | ---: | ---: | ---: |
| JSON syntax | 0.9167 | 0.9917 | 1.0000 | 0.9917 |
| Schema valid | 0.8667 | 0.9833 | 1.0000 | 0.9833 |
| verdict accuracy | 0.2833 | 0.9000 | 0.4000 | 0.7083 |
| malicious precision | 1.0000 | 0.8810 | 0.2222 | 0.6066 |
| malicious recall | 0.0732 | 0.9024 | 0.1463 | 0.9024 |
| malicious F1 | 0.1364 | 0.8916 | 0.1765 | 0.7255 |
| normal FPR | 0.5152 | 0.0455 | 0.3788 | 0.3939 |
| attackFamily macro-F1 | 0.4582 | 0.6147 | 0.0990 | 0.5208 |
| action accuracy | 0.3917 | 0.9000 | 0.4000 | 0.7083 |
| unknown usage | 0.2000 | 0.0833 | 0.0000 | 0.0833 |
| p95 latency ms | 21898.9509 | 9110.6181 | 0.3870 | 9110.8734 |
| peak GPU GiB | 2.6334 | 2.6944 | N/A | 2.6944 |

## LoRA 相对基座的变化

- 新增正确检出的恶意样本：34
- 新增误报：0
- 修复的基座误报：31
- 新增检出 sample IDs（最多 30）：`['batch-001-000004', 'batch-001-000026', 'batch-001-000057', 'batch-001-000154', 'batch-001-000173', 'batch-001-000174', 'batch-001-000194', 'raw-cmdi_0008', 'raw-encode_0004', 'raw-encode_0025', 'raw-graphql_0016', 'raw-nosql_adv_0021', 'raw-oauth_0002', 'raw-path_0013', 'raw-path_0049', 'raw-proto_pollute_0003', 'raw-proto_pollute_0006', 'raw-redos_0034', 'raw-smuggle_adv_0000', 'raw-smuggle_adv_0004', 'raw-sqli_0024', 'raw-sqli_0163', 'raw-ssrf_0001', 'raw-ssti_0015', 'raw-ssti_0030', 'raw-ssti_0038', 'raw-type_confuse_0025', 'raw-xss_0005', 'raw-xss_0015', 'raw-xss_0031']`
- 新增误报 sample IDs（最多 30）：`[]`

## 重点攻击面

- `ssrf`: Base [recall=0.000, familyAcc=1.000]；LoRA [recall=1.000, familyAcc=1.000]；Rules [recall=0.000, familyAcc=0.000]；Combined [recall=1.000, familyAcc=1.000]
- `authentication`: Base [recall=0.000, familyAcc=0.750]；LoRA [recall=1.000, familyAcc=0.750]；Rules [recall=0.000, familyAcc=0.000]；Combined [recall=1.000, familyAcc=0.750]
- `api_abuse`: Base [recall=0.000, familyAcc=0.333]；LoRA [recall=0.333, familyAcc=0.000]；Rules [recall=0.000, familyAcc=0.000]；Combined [recall=0.333, familyAcc=0.000]
- `path_traversal`: Base [recall=0.000, familyAcc=1.000]；LoRA [recall=0.800, familyAcc=0.800]；Rules [recall=0.200, familyAcc=0.200]；Combined [recall=0.800, familyAcc=0.800]
- `sqli`: Base [recall=0.000, familyAcc=0.800]；LoRA [recall=0.800, familyAcc=0.600]；Rules [recall=0.000, familyAcc=0.000]；Combined [recall=0.800, familyAcc=0.600]
- `xss`: Base [recall=0.000, familyAcc=1.000]；LoRA [recall=1.000, familyAcc=1.000]；Rules [recall=0.400, familyAcc=0.600]；Combined [recall=1.000, familyAcc=1.000]
- `command_injection`: Base [recall=0.200, familyAcc=0.400]；LoRA [recall=1.000, familyAcc=0.600]；Rules [recall=0.200, familyAcc=0.000]；Combined [recall=1.000, familyAcc=0.400]

编码绕过主要分布在 `path_traversal`、`sqli`、`file_upload` 和 `other`，应结合
`familyBreakdown`、样本 metadata 的 `encoding` 以及 prediction JSONL 逐条复核。

## 正常与硬负样本

- `baseline`: count=24, verdict accuracy=0.0000, predictions={'suspicious': 24}
- `lora`: count=24, verdict accuracy=0.9167, predictions={'malicious': 2, 'safe': 22}
- `rules`: count=24, verdict accuracy=0.0833, predictions={'malicious': 18, 'safe': 2, 'suspicious': 4}
- `combined`: count=24, verdict accuracy=0.0833, predictions={'malicious': 18, 'safe': 2, 'suspicious': 4}

## JSON 稳定性

- Base JSON / Schema：0.9167 / 0.8667
- LoRA JSON / Schema：0.9917 / 0.9833
- 组合策略保留规则 block guardrail；模型无效输出一律变为 unknown，不会变为 safe。

## 安全边界

LoRA 只提供安全判定建议，不直接执行高风险动作。现有规则引擎、Final Defense
硬件授权、policyDigest、monotonic counter 与 interlock fail-closed 链保持不变。
