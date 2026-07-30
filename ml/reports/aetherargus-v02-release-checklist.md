# AetherArgus v0.2 Preview — 发布检查清单

生成时间：2026-07-29
数据截至：LoRA independent 评测完成（2026-07-29T14:08:12Z）

**判定结论：v0.2 未达到发布门槛，按锁定 spec 不得发布为 GA；允许以 research preview 名义分发，但必须随附 FAIL 项披露。**

---

## 1. 已完成项（含证据锚点）

### 数据
- [x] v0.2 数据集按 `detection_contract.SYSTEM_PROMPT` 对齐后整体重写（4 split + manifest + independent seal 重新生成）—— `ml/data/releases/v02/{train,validation,test-closed,test-independent}.jsonl` + `manifest.json`
- [x] 各 split records/bytes/sha256 在 manifest 登记：train 14314 / validation 1752 / test-closed 1236 / test-independent 1750 —— `ml/data/releases/v02/manifest.json` `files` 字段
- [x] independent 集在 development 生成前完成密封 —— `manifest.json` `independentSeal.sealedBeforeDevelopmentGeneration=true`，`recordsSha256=4d2ccde0…111b`
- [x] 泄露审计通过 —— `manifest.json` `leakage.pairwise` 六对 split 两两 `detected=false`、`sharedNormalizedHashes=0`、`sharedTemplateFingerprints=0`、`sharedGroupIds=0`
- [x] 数据集 acceptance gates 全 PASS —— `manifest.json` `datasetAcceptance.passed=true`（train≥8000 / validation≥1000 / independent≥1500 / 家族最低数 / 全确定性校验）
- [x] 公开源审计落盘 —— `ml/reports/dataset-v02-public-source-audit.json`，`acceptedSourceCount=3`、`upstreamEvaluationSplitsUsedForTraining=false`
- [x] seed 全程一致 —— `manifest.json` `seed=20260728`，训练 yaml `seed=20260728`

### 训练
- [x] 训练配置入库 —— `ml/configs/qwen3-4b-qlora-v02.yaml`（max_length=1024 / epoch=1 / lr=1e-4 cosine / LoRA r16 alpha32 dropout0.05 / nf4 double-quant / seed=20260728）
- [x] 训练摘要落盘 —— `ml/output/aetherargus-v02-lora/training-summary.json`（epoch=1.0, globalStep=895, train_loss=0.07975, eval_loss=0.00963）
- [x] 适配器 4 文件齐 —— `training-summary.json` `adapterFiles.{adapterModel,adapterConfig,tokenizerConfig,trainerState}` 全 true；`adapter_model.safetensors` 132 MB
- [x] 显存与时长记录 —— peakGpuAllocatedGiB=6.31 / peakGpuReservedGiB=6.77；train runtime=12695.1s（≈3.53 h），eval runtime=385s
- [x] 截断门禁 PASS —— `trainDropRatio=0.000279` ≤ 0.001（trainTruncated=10/14314，trainDroppedWithoutAssistantTokens=4）
- [x] 训练端 git commit 记录 —— `d8d6c93489c4a3e72ef1e580dafabad2b319cbe5`

### 评测
- [x] baseline 100 条 stratified 跑通 —— `ml/reports/v02-baseline-smoke-metrics.json`（jsonSyntax=0.79 / verdictAcc=0.01 / maliciousRecall=0 / normalFPR=0.9286，证明基座不可用）
- [x] LoRA closed-set 全量（1236）跑通 —— `ml/reports/lora-v02-closed-metrics.json` + `lora-v02-closed-report.md`
- [x] LoRA independent-set 全量（1750）跑通，**配置锁定后唯一一次** —— `ml/reports/lora-v02-independent-metrics.json` + `lora-v02-independent-report.md`
- [x] 门禁文件锁定 —— `ml/configs/aetherargus-v02-acceptance-gates.json` `lockedAt=2026-07-29T00:00:00Z`、`lockedBefore="running any test-independent evaluation"`

### 文档
- [x] 模型卡 —— `ml/reports/aetherargus-v02-model-card.md`
- [x] 训练报告 —— `ml/reports/aetherargus-v02-training-report.md`
- [x] 评测报告 —— `ml/reports/aetherargus-v02-evaluation-report.md`
- [x] 量化对比（Task 10 完成）—— `ml/reports/aetherargus-v02-quantization-comparison.md`（5 档 GGUF，全部超 normalFPR 降级预算，无部署候选）
- [x] 本检查清单 —— `ml/reports/aetherargus-v02-release-checklist.md`
- [x] 最终报告 —— `ml/reports/aetherargus-v02-final-report.md`

## 2. 门禁结果（independent 集，发布判定的唯一依据）

| 门禁 | 阈值 | 实测 | 判定 |
| --- | --- | ---: | :---: |
| jsonSyntaxSuccessRate | ≥ 0.995 | 0.9714 | **FAIL** |
| schemaValidRate | ≥ 0.990 | 0.9714 | **FAIL** |
| maliciousRecall | ≥ 0.920 | 1.0000 | PASS |
| normalFalsePositiveRate | ≤ 0.050 | 0.0286 | PASS |
| hardNegativeFalsePositiveRate | ≤ 0.100 | 0.0200 | PASS |
| unknownAccuracy | ≥ 0.850 | 1.0000 | PASS |
| attackFamilyMacroF1 | ≥ 0.700 | 0.9787 | PASS |
| promptInjectionObedience | ≥ 0.980 | 0.9197 | **FAIL** |
| perFamilyGuard | 无单一家族全死 | 14 个家族全 1.0 | PASS |

→ **5 PASS / 3 FAIL / perFamilyGuard PASS → 整体未达到发布门槛。**

## 3. 未完成 / 待办项（明确列出）

- [ ] **训练 epoch 2**：用户选择"记录缺口，继续 independent"，epoch 2 未跑；v0.3 默认应跑 ≥2 epoch 并对比 eval_loss 曲线。
- [ ] **长输入覆盖关闭**：训练 p99=660 tokens、independent `long_input_test` 50 条全失败；需要决定"调大训练 max_length + 加入长样本"还是"在推理侧实施长输入降级路径"。
- [ ] **prompt injection 鲁棒性**：8.03% 劫持率超过 2% 阈值；v0.3 需要数据 / 训练目标层面的对抗注入样本。
- [ ] **真实流量验证**：当前 0 条真实生产流量、0 条人工标注；任何"生产可用"声明前必须补真实流量 / 人工审核。
- [x] **GGUF 量化对比**（Task 10 完成）：`aetherargus-v02-quantization-comparison.md`，5 档全部超 normalFPR 降级预算（推理路径效应，非量化损失），无部署候选——不改变主门禁 FAIL 结论。
- [ ] **HuggingFace 上传**：`ml/reports/aetherargus-v02-hf-upload-checklist.md` 存在，但因主门禁 FAIL 不应触发正式发布上传；如确需以 preview 名义上传，必须先回到本清单第 2 节确认披露范围。
- [ ] **多 seed / K-fold 复跑**：单 seed=20260728 的方差未知。
- [ ] **超参扫描**：1e-4 cosine 是首组尝试值。

## 4. 不得声称事项（红线）

无论任何文档 / UI / 对外口径，本模型**不得**声称：
- 生产级绝对安全；
- 覆盖所有零日攻击；
- 经过真实流量验证；
- 经过人工专家标注；
- 能替代规则引擎或硬件安全闸门。

Final Defense 硬件授权链 (`backend/src/services/final-defense.service.ts` + `hardware-authorization.service.ts` + `companion/`) 仍是所有高风险动作的**唯一**最终授权路径，本模型输出**不接入**该链路。
