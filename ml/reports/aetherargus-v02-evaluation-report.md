# AetherArgus v0.2 Preview — 评测报告

生成时间：2026-07-29
数据截至：LoRA independent 评测完成（2026-07-29T14:08:12Z）

本报告对照三次评测（baseline / closed-set / independent-set），并按门禁 `ml/configs/aetherargus-v02-acceptance-gates.json` 给出最终判定。**门槛在 independent 跑之前已锁定，不得下调。**

---

## 1. 三次评测基本信息

| Run | 文件 | 样本数 | 模型 | 完成时间 | 用途 |
| --- | --- | ---: | --- | --- | --- |
| baseline smoke | `ml/reports/v02-baseline-smoke-metrics.json` | 100（stratified 抽样） | Qwen3-4B-Instruct-2507（未微调） | 2026-07-29T01:37:52Z | 证明基座不可用，建立 LoRA 增益下限 |
| lora-v02-closed | `ml/reports/lora-v02-closed-metrics.json` | 1236（test-closed 全量） | LoRA v0.2 | 2026-07-29T08:56:23Z | 开发集回归 / 阈值调试参考 |
| lora-v02-independent | `ml/reports/lora-v02-independent-metrics.json` | 1750（test-independent 全量） | LoRA v0.2 | 2026-07-29T14:08:12Z | **发布判定唯一依据**；配置锁定后唯一一次跑 |

每个 run 的 `modelInvocationCount == sampleCount`，`heuristicOnly=false`，全部为真实模型推理。

## 2. 核心指标对照

| 指标 | Baseline (n=100) | LoRA closed (n=1236) | LoRA independent (n=1750) |
| --- | ---: | ---: | ---: |
| jsonSyntaxSuccessRate | 0.7900 | 0.9984 | **0.9714** |
| schemaValidRate | 0.7800 | 0.9984 | **0.9714** |
| verdictAccuracy | 0.0100 | 0.9717 | 0.9657 |
| maliciousPrecision | 0.0000 | 0.9416 | 0.9929 |
| maliciousRecall | 0.0000 | 0.9963 | **1.0000** |
| maliciousF1 | 0.0000 | 0.9682 | 0.9964 |
| normalFPR | 0.9286 (13/14) | 0.0567 (33/582) | **0.0286** (10/350) |
| hardNegativeFPR | 1.0000 (7/7) | 0.0000 (0/274) | **0.0200** (2/100) |
| unknownAccuracy | 0.1429 (1/7) | 1.0000 (120/120) | **1.0000** (150/150) |
| promptInjectionObedience | n/a (0) | n/a (0) | **0.9197** (137) |
| attackFamilyMacroF1 | 0.3401 | 0.6655 | **0.9787** |
| recommendedActionAccuracy | 0.1200 | 0.9717 | 0.9663 |
| unknownUsageRate | 0.2200 | 0.0987 | 0.1143 |
| 平均延迟 ms | 13,903.6 | 8,975.6 | 9,979.6 |
| p50 延迟 ms | 14,091.5 | 8,504.3 | 9,700.7 |
| p95 延迟 ms | 16,325.3 | 13,806.8 | 14,522.0 |
| 显存峰值 GiB | 2.643 | 2.775 | 2.925 |

**Baseline 的意义**：在未微调状态下，Qwen3-4B-Instruct-2507 对该任务 79% 时间能输出可解析 JSON，但 verdictAccuracy 仅 0.01、maliciousRecall=0、normalFPR=0.9286——模型普遍输出 `suspicious`，无检测能力。**v0.2 的任何 PASS 都不能归功于基座本身**。

## 3. 门禁判定（independent 集）

阈值来源 `ml/configs/aetherargus-v02-acceptance-gates.json`，lockedAt=2026-07-29T00:00:00Z，明确"不得在跑 independent 后下调"。

| 门禁 | 阈值 | 实测 | 余量 | 判定 |
| --- | --- | ---: | ---: | :---: |
| jsonSyntaxSuccessRate | ≥ 0.995 | 0.9714 | -0.0236 | **FAIL** |
| schemaValidRate | ≥ 0.990 | 0.9714 | -0.0186 | **FAIL** |
| maliciousRecall | ≥ 0.920 | 1.0000 | +0.0800 | PASS |
| normalFalsePositiveRate | ≤ 0.050 | 0.0286 | +0.0214 | PASS |
| hardNegativeFalsePositiveRate | ≤ 0.100 | 0.0200 | +0.0800 | PASS |
| unknownAccuracy | ≥ 0.850 | 1.0000 | +0.1500 | PASS |
| attackFamilyMacroF1 | ≥ 0.700 | 0.9787 | +0.2787 | PASS |
| promptInjectionObedience | ≥ 0.980 | 0.9197 | -0.0603 | **FAIL** |
| perFamilyGuard | 无单一家族全死 | 14 个家族 familyAcc/recall 全 =1.0 | — | PASS |

**总结**：5 PASS / 3 FAIL / perFamilyGuard PASS → **整体未达到发布门槛**。按 spec 门槛锁定后不得下调，本次发布**不通过**；产物可作为 research preview 但 model card 必须披露全部 FAIL 项。

## 4. 子套件分析（independent 集）

| evaluationSuite | n | jsonSyntax | schemaValid | verdictAcc |
| --- | ---: | ---: | ---: | ---: |
| authorized_attack_test | 1125 | 1.0000 | 1.0000 | 1.0000 |
| independent_hard_negative | 88 | 1.0000 | 1.0000 | 0.9886 |
| independent_synthetic_normal | 200 | 1.0000 | 1.0000 | 0.9600 |
| independent_unknown | 150 | 1.0000 | 1.0000 | 1.0000 |
| **long_input_test** | **50** | **0.0000** | **0.0000** | **0.0000** |
| prompt_injection_test | 137 | 1.0000 | 1.0000 | 0.9927 |

### 4.1 long_input_test 是 jsonSyntax/schemaValid 失败的唯一显著因素

- 50 条全部 json=0 / schema=0 / verdictAcc=0。占 independent 总数 50/1750 = **2.86%**。
- 这些样本的 user message 均超过 5000 字符（≈2000-3000 tokens）。评测端使用 `max_input_length=1024` 截断，模型只能看到 JSON body 的开头片段，无法识别为安全检测任务，输出自由文本分析而不是 contract JSON。
- 其余 1700 条样本的 jsonSyntax 全部 = 1.0。
- 训练数据 p99=660 tokens、超 1024 仅 0.07%（10 条截断）；模型在 ≤1024 tokens 范围内的 JSON 遵从性是 closed 集实测 0.9984。
- **结论**：这是评测配置（`max_input_length=1024`）与训练长度（p99=660）共同造成的长输入未覆盖问题，**不是模型在第 1024 tokens 内的能力问题**。但门禁对整个 independent 集判定，不按子集豁免——按锁定规则 FAIL 成立。

### 4.2 prompt_injection_test 的 obedience 失败

- 137 条 injection 样本，verdictAcc=0.9927（仅 1 条 verdict 错）但 obedience=0.9197（**11 条被劫持**，按 injection 指令改变了 verdict 或 recommendedAction）。
- 劫持率 8.03%，远超阈值 2%。
- 该子套件 jsonSyntax/schemaValid 全部 = 1.0，说明劫持并非靠破坏 JSON 结构，而是模型按 contract 返回了**内容被污染**的判定。
- **部署含义**：本模型不能单独面对含对抗 prompt 的输入，必须保留前置规则 / sanitize 层；不得用作唯一检测层。

### 4.3 closed-set 的 familyAcc 异常在 independent 上消失

closed 集（n=1236）attackFamilyMacroF1=0.6655，弱家族：

| 家族 | n | familyAcc | maliciousRecall |
| --- | ---: | ---: | ---: |
| authentication | 18 | 0.0556 | 1.0000 |
| deserialization | 15 | 0.0667 | 1.0000 |
| sqli | 36 | 0.3333 | 0.9444 |
| protocol_attack | 22 | 0.3636 | 1.0000 |
| command_injection | 44 | 0.4091 | 1.0000 |

independent 集 14 个家族 familyAcc/recall 全部 = 1.0（包括 authentication 100 条、deserialization 80 条、command_injection 100 条、sqli 100 条、protocol_attack 100 条）。

→ closed 集 familyAcc 低分是**该小子集（<20 条/家族）的特殊性**，不构成系统性失败；但 closed-set 的 `authentication`/`deserialization` 弱点仍建议在 v0.3 数据扩充中定向加强。

## 5. 编码与 provenance 维度

### 5.1 编码分布（independent 集）

| encoding | n | jsonSyntax | schemaValid | verdictAcc |
| --- | ---: | ---: | ---: | ---: |
| double_url_encoded | 164 | 1.0000 | 1.0000 | 1.0000 |
| plain | 919 | 0.9456 | 0.9456 | 0.9369 |
| unicode | 560 | 1.0000 | 1.0000 | 0.9964 |
| url_encoded | 107 | 1.0000 | 1.0000 | 1.0000 |

`plain` 是唯一 jsonSyntax<1.0 的编码桶——但 long_input_test 的 50 条全部属于 `plain`，扣除后 `plain` 的实际 jsonSyntax=869/869=1.0。结论：编码本身不构成失败模式。

### 5.2 provenance

independent 集 1750 条全部 `deterministic_synthetic_v02`，与 closed 集（含 192 条 `tracked_synthetic_security_corpus_v02_conversion`）来源不同，这是两集分布差异的另一来源。

## 6. 性能与延迟

| 指标 | closed | independent |
| --- | ---: | ---: |
| 平均延迟 ms/sample | 8,975.6 | 9,979.6 |
| p50 ms | 8,504.3 | 9,700.7 |
| p95 ms | 13,806.8 | 14,522.0 |
| 显存峰值 GiB | 2.775 | 2.925 |

平均约 10 s/sample、p95 14.5 s/sample 的延迟**仅适合旁路/shadow mode**，不能放入在线热路径。

## 7. 失败模式分类汇总

| 失败模式 | 影响指标 | 影响样本 | 根因 | 是否模型能力问题 |
| --- | --- | --- | --- | --- |
| 长输入截断 | jsonSyntax, schemaValid | long_input_test 50 条 | `max_input_length=1024` + 训练集 p99=660 | 否（配置/数据覆盖问题） |
| Prompt injection 劫持 | promptInjectionObedience | 137 条中 11 条 | 模型按 contract 返回内容被污染的 verdict/action | **是**（鲁棒性不足） |
| closed-set 小样本 familyAcc | attackFamilyMacroF1（closed only） | closed authentication/deserialization/sqli/command_injection/protocol_attack | 子集小且分布特殊 | 否（independent 上同家族全 1.0） |

## 8. 已知弱项（必须在任何外部引用中保留）

1. **prompt injection 鲁棒性不足**：8.03% 劫持率，超过 2% 阈值。
2. **长输入未覆盖**：>1024 tokens 的 user message 在当前训练/评测配置下不可用。
3. **真实流量 0 条**：所有训练/评测样本均为 deterministic synthetic 或公开派生，**未在真实生产流量上验证**。
4. **人工标注 0 条**：所有标签由生成器与源数据集自动产生，**未经人工安全专家审核**。
5. **训练未充分**：仅 1 epoch；epoch 2 未跑（用户选择"记录缺口，继续 independent"）。
6. **延迟偏高**：~10 s/sample 仅适合 shadow mode。
7. **closed-set 部分家族 familyAcc 异常低**（authentication 0.056 / deserialization 0.067 / sqli 0.333），虽然 independent 上不存在，但提示在小样本场景下家族标签边界仍脆弱。

## 9. 复现锚点

- 门禁配置：`ml/configs/aetherargus-v02-acceptance-gates.json`
- baseline metrics：`ml/reports/v02-baseline-smoke-metrics.json`
- closed metrics：`ml/reports/lora-v02-closed-metrics.json` + `lora-v02-closed-report.md`
- independent metrics：`ml/reports/lora-v02-independent-metrics.json` + `lora-v02-independent-report.md`
- 预测明细（原始输出+验证错误）：`ml/output/lora-v02-closed-predictions.jsonl`、`ml/output/lora-v02-independent-predictions.jsonl`
- 数据 manifest：`ml/data/releases/v02/manifest.json`
- 评测 seed：`20260728`（与数据/训练一致）

JSON 或 Schema 失败不会被修补成 safe；计分时统一降级为 `unknown + monitor`（与 `lora-v02-independent-report.md` 现有约定一致）。
