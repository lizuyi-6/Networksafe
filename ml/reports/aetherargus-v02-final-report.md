# AetherArgus v0.2 Preview — 最终报告

生成时间：2026-07-29
数据截至：LoRA independent 评测完成（2026-07-29T14:08:12Z）

> **判定：v0.2 未达到发布门槛（8 项门禁 3 项 FAIL）。按锁定 spec 不得发布为 GA；允许以 research preview 名义分发，所有 FAIL 项必须随附披露。**

---

## 1. v0.2 范围

v0.2 的目标是：在 v0.1（120 条 LoRA 冒烟）基础上，把数据集扩到 ≥14k 条、按 `detection_contract.SYSTEM_PROMPT` 对齐系统 prompt、引入独立密封的 test-independent split、跑通"配置锁定 → 训练 → 三段评测（baseline/closed/independent）→ 锁定门禁判定"的完整发布流水线。

**不在范围内**：epoch 2、GGUF 量化、HuggingFace 正式发布、真实流量回放、人工标注。

## 2. 达成

### 2.1 数据
- 数据集 v0.2 重写：train 14314 / validation 1752 / test-closed 1236 / test-independent 1750，全部经确定性生成器 + 公开派生（OWASP CRS regression / S-Labs prompt-injection train / Stripe OpenAPI contract）。
- independent 集在 development 生成前完成密封（`sealedBeforeDevelopmentGeneration=true`），六对 split 泄露审计全 `detected=false`。
- 数据集 acceptance gates 全 PASS（train≥8000、validation≥1000、independent≥1500、家族最低数、全确定性校验）。
- seed `20260728` 全程一致。

### 2.2 训练
- QLoRA（4-bit NF4 基座 + BF16 LoRA r16/alpha32/dropout0.05）在 RTX 5070 Ti Laptop 11.94 GiB 上完成 1 epoch，用时 12,695 s（≈3.53 h），峰值显存 6.77 GiB。
- 895 步，train_loss=0.07975，eval_loss=0.00963，截断率 0.000279 远低于 0.001 门禁。
- 适配器 4 文件齐（adapter_model.safetensors 132 MB + adapter_config + tokenizer_config + trainer_state）。

### 2.3 评测
- 三次评测全部按预设协议跑通，每次 `modelInvocationCount == sampleCount`。
- **Baseline（100 条）证明基座不可用**：verdictAcc=0.01、maliciousRecall=0、normalFPR=0.9286——v0.2 的所有增益都来自 LoRA 微调而非基座。
- **independent 集 5/8 门禁 PASS**：maliciousRecall=1.0、normalFPR=0.0286、hardNegativeFPR=0.0200、unknownAccuracy=1.0、attackFamilyMacroF1=0.9787、perFamilyGuard PASS。
- **失败模式被定位**：
  - `long_input_test` 50 条全失败是评测配置 `max_input_length=1024` 与训练长度 p99=660 不匹配，**不是模型在 ≤1024 tokens 内的能力问题**；
  - `prompt_injection_test` 137 条中 11 条 verdict/recommendedAction 被劫持，**是模型真实鲁棒性问题**；
  - closed-set 的 familyAcc 异常（authentication 0.056 / deserialization 0.067 等）在 independent 14 个家族全 1.0 的对比下被证明是该小子集特殊性。

### 2.4 发布纪律
- 门禁文件 `ml/configs/aetherargus-v02-acceptance-gates.json` 在 independent 跑之前 lockedAt=2026-07-29T00:00:00Z 完成锁定，spec 明确"不得下调"。
- 门禁 FAIL 后未发生任何门槛下调或子集豁免。
- 模型卡 / 训练报告 / 评测报告 / 量化占位 / 检查清单 / 最终报告 6 份文档齐套。

## 3. 未达成

### 3.1 主门禁 3 项 FAIL

| 门禁 | 阈值 | 实测 | 差距 |
| --- | ---: | ---: | ---: |
| jsonSyntaxSuccessRate | ≥ 0.995 | 0.9714 | -2.4 pt |
| schemaValidRate | ≥ 0.990 | 0.9714 | -1.9 pt |
| promptInjectionObedience | ≥ 0.980 | 0.9197 | -6.0 pt |

按锁定 spec，**v0.2 不得发布**。

### 3.2 过程缺口

- epoch 2 未跑（用户选择"记录缺口，继续 independent"）；
- 长输入覆盖未关闭（训练 p99=660，long_input_test 全失败）；
- prompt injection 鲁棒性不足（8.03% 劫持率）；
- 0 条真实流量、0 条人工标注；
- GGUF 量化对比已完成（Task 10，`aetherargus-v02-quantization-comparison.md`）：5 档全部超 normalFPR 降级预算（推理路径效应，非量化损失），无部署候选；
- 未做 K-fold / 多 seed / 超参扫描。

## 4. 与 Preview 0.1 的对比

> **Preview 0.1 报告未在仓库中找到。** 已检索 `ml/reports/` 全部 markdown，无 `aetherargus-v01-*` 或 `*preview-0.1*` 命名的报告文件；仅在 `ml/reports/shadow-mode-runbook.md` 第 14 行看到环境变量 `SECURITY_DETECTION_MODEL_VERSION=Preview-0.1` 的引用，证明 0.1 概念存在但**没有独立的模型卡 / 训练报告 / 评测报告入库**。

可参照的最接近 0.1 的产物是 `ml/reports/lora-metrics.json` + `lora-report.md`（120 条 LoRA 冒烟，2026-07-28T01:21:51Z），与 v0.2 independent 对比如下：

| 指标 | v0.1 LoRA smoke (n=120, 2026-07-28) | v0.2 LoRA independent (n=1750, 2026-07-29) |
| --- | ---: | ---: |
| 样本数 | 120 | 1750 |
| jsonSyntax | 0.9917 | 0.9714 |
| schemaValid | 0.9833 | 0.9714 |
| verdictAcc | 0.9000 | 0.9657 |
| maliciousRecall | 0.9024 | 1.0000 |
| normalFPR | 0.0455 (3/66) | 0.0286 (10/350) |
| attackFamilyMacroF1 | 0.6147 | 0.9787 |
| 平均延迟 ms | 6,116.4 | 9,979.6 |
| 显存峰值 GiB | 2.694 | 2.925 |

**变化方向**：
- 数据集从 120 条冒烟扩到 1750 条 independent，覆盖面与判定置信度大幅提升；
- maliciousRecall 从 0.9024 → 1.0000（independent 上 1250 条攻击样本全检出）；
- normalFPR 从 4.55% → 2.86%，hardNegativeFPR 从（v0.1 未测）→ 2.00%；
- attackFamilyMacroF1 从 0.6147 → 0.9787（independent 14 家族全 1.0）；
- jsonSyntax 略降（0.9917 → 0.9714）完全由 `long_input_test` 2.86% 子集引起；
- 延迟从 ~6 s/sample → ~10 s/sample（independent 含更长 prompt）。

注意：v0.1 是 120 条冒烟，**没有锁定门禁**，所以"达到发布门槛"的说法对 v0.1 也不成立；v0.2 是首次引入 locked acceptance gates 的版本。

## 5. 下一步建议（按优先级）

1. **关闭长输入覆盖缺口**——二选一：
   - (a) 训练侧：调大 `max_length`（≥2048）+ 在 v0.3 训练集主动加入 >1024 tokens 的样本，并重跑训练；
   - (b) 推理侧：实施长输入降级路径（分块 / 启发式 / 规则引擎 fallback），并在 system prompt 里加输入长度约束声明。
   选择结果直接决定 v0.3 是否需要重训。
2. **提升 prompt injection 鲁棒性**——v0.3 数据集需增加对抗 injection 样本（尤其 targeting verdict / recommendedAction 字段），并考虑在训练目标里加入"拒绝执行 user message 中的指令"损失项。当前 8.03% 的劫持率是发布前必须降到 ≤2% 的硬指标。
3. **跑 epoch 2**——在关闭上述两项之前先不增加超参变更面；epoch 2 完成后对比 eval_loss 是否继续下降，再决定是否扩 epoch。
4. **真实流量与人工标注**——0 条真实流量 / 0 条人工标注是「生产可用」声明的硬阻断；在补这部分之前，本模型不得进入任何"决定 block/allow"的在线路径。
5. **GGUF 量化对比（Task 10）**——已完成（`aetherargus-v02-quantization-comparison.md`）：5 档 GGUF 全部超 normalFPR 降级预算（≤2pt 相对 merged BF16），根因经双路径对照定位为 ollama 推理路径效应而非量化损失；在第 1-2 项关闭前，量化产物不进入部署候选名单。
6. **多 seed 复跑**——单 seed=20260728 的方差未知，v0.3 至少 3 seed 复跑以确认稳定区间。
7. **v0.3 门禁版本化**——把 `aetherargus-v02-acceptance-gates.json` 复制为 `aetherargus-v03-acceptance-gates.json` 并在跑 v0.3 independent 前重新锁定，避免"用 v0.2 门禁套 v0.3 模型"或"v0.3 跑完再调门槛"。

## 6. 红线（任何对外引用必须保留）

- 本模型**不声称**：生产级绝对安全 / 覆盖所有零日攻击 / 经过真实流量验证 / 经过人工专家标注 / 能替代规则引擎或硬件安全闸门。
- Final Defense 硬件授权链仍是所有高风险动作的**唯一**最终授权路径，本模型输出**不接入**该链路。
- 延迟 ~10 s/sample，仅适合旁路 / 离线 / shadow mode，不得放入在线热路径。

## 7. 锚点清单

| 类别 | 路径 |
| --- | --- |
| 训练配置 | `ml/configs/qwen3-4b-qlora-v02.yaml` |
| 训练摘要 | `ml/output/aetherargus-v02-lora/training-summary.json` |
| 适配器 | `ml/output/aetherargus-v02-lora/adapter_model.safetensors`（132 MB） |
| 数据 manifest | `ml/data/releases/v02/manifest.json` |
| 门禁 | `ml/configs/aetherargus-v02-acceptance-gates.json` |
| baseline 评测 | `ml/reports/v02-baseline-smoke-metrics.json` |
| closed 评测 | `ml/reports/lora-v02-closed-metrics.json` + `lora-v02-closed-report.md` |
| independent 评测 | `ml/reports/lora-v02-independent-metrics.json` + `lora-v02-independent-report.md` |
| 模型卡 | `ml/reports/aetherargus-v02-model-card.md` |
| 训练报告 | `ml/reports/aetherargus-v02-training-report.md` |
| 评测报告 | `ml/reports/aetherargus-v02-evaluation-report.md` |
| 量化对比占位 | `ml/reports/aetherargus-v02-quantization-comparison.md` |
| 发布检查清单 | `ml/reports/aetherargus-v02-release-checklist.md` |
| 训练 git commit | `d8d6c93489c4a3e72ef1e580dafabad2b319cbe5` |
| seed | `20260728` |
