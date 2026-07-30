# AetherArgus v0.2 Preview — 模型卡（Model Card）

生成时间：2026-07-29
数据截至：LoRA independent 评测完成（2026-07-29T14:08:12Z）

> **判定结论：v0.2 未达到发布门槛（8 项门禁中 3 项 FAIL）。** 本模型仅作为 **research preview** 发布，**不应用于生产流量决策**。所有 FAIL 项见下文「评测结果 → 门禁」。

---

## 1. 模型身份

| 项 | 值 |
| --- | --- |
| 名称 | AetherArgus v0.2 Preview |
| 基座模型 | `Qwen/Qwen3-4B-Instruct-2507` |
| 基座 revision | `cdbee75f17c01a7cc42f958dc650907174af0554` |
| 适配方式 | QLoRA（4-bit NF4 double-quant 基座 + BF16 LoRA adapters） |
| LoRA 配置 | r=16, alpha=32, dropout=0.05, target_modules=all-linear |
| 可训练参数 | 33,030,144 / 2,238,840,320（1.4753%） |
| 适配器文件 | `ml/output/aetherargus-v02-lora/adapter_model.safetensors`（132 MB） |
| 训练仓库 commit | `d8d6c93489c4a3e72ef1e580dafabad2b319cbe5` |
| 训练配置 | `ml/configs/qwen3-4b-qlora-v02.yaml` |
| 训练摘要 | `ml/output/aetherargus-v02-lora/training-summary.json` |
| 种子 | `seed=20260728`（数据集 / 训练 / 切分全程一致） |

## 2. 用途（Intended Use）

**允许用途**：
- 作为 AetherGuard 安全检测管线的**辅助信号源**（shadow mode / 旁路参考），输出结构化 JSON 判定，供人审或作为融合输入之一。
- 在**已授权、隔离**的评测/红队环境内做合成数据集上的离线评估。
- 作为后续 v0.3 数据/训练迭代的对照基线。

**禁止用途**：
- 不得作为**唯一**判定来源（尤其是 block/allow 决策）；最终授权路径仍必须由规则引擎 + Final Defense 硬件闸门走完整链路（见 `backend/src/services/final-defense.service.ts`、`hardware-authorization.service.ts`）。
- 不得直接驱动任何**不可逆副作用**（drop 连接、删数据、下发 commands 到 host agent）。
- 不得用于处理**未授权第三方流量**——本模型训练集 `authorizedRealAttackCount=0`，没有接触真实生产攻击样本。

## 3. 训练数据

| 项 | 值 |
| --- | --- |
| 数据集版本 | v0.2 release（重写于 v0.2 初版系统 prompt 与 `detection_contract.SYSTEM_PROMPT` 对齐之后） |
| 数据 manifest | `ml/data/releases/v02/manifest.json`（sha256=`c780d22f…23fd`） |
| Split | train 14314 / validation 1752 / test-closed 1236 / test-independent 1750 |
| train sha256 | `e8ff084fc251f3e9ede791dabac747b1021c199e24685d6af9e6a696da2fc3e1` |
| validation sha256 | `ea6f3d070ed796bba4f0ea2582c7eb406794b0162f871ceaf9f07de7e1f55606` |
| test-closed sha256 | `c1cba66e4ceeabed129b344e867566fa4df40ff9e8fae05d3b7eee3fb55ad003` |
| test-independent sha256 | `4a0dbda1122eaa461ebe3358a43745f004af4c379c5b64cb72a0febed1de01f4` |
| 生成方式 | `deterministic-aetherargus-v02` / prompt 版本 `dataset-v02.1` |
| 人工标注 | **0 条**（`humanReviewCount=0`） |
| 真实生产流量 | **0 条**（`realNormalCount=0`、`authorizedRealAttackCount=0`） |
| independent 集密封 | `sealedBeforeDevelopmentGeneration=true`，sha256=`4d2ccde0…111b` |

**数据 provenance（manifest 计数）**：
- `deterministic_synthetic_v02`: 13354 条
- `public_open_source_derived`: 5309 条（其中 OWASP CRS regression 1935、S-Labs prompt-injection train 2200、Stripe OpenAPI 1174，进入 train/validation 两个 split；上游 evaluation split 未用于训练）
- `tracked_synthetic_security_corpus_v02_conversion`: 389 条

**Attribution**：样本骨架来自 OWASP CRS regression requests、S-Labs prompt-injection training split、Stripe OpenAPI contract 派生。所有公开源仅取 train/validation split（`allowedSplits=["train","validation"]`）。

**泄露审计**（manifest.leakage）：所有 split 两两比对 `sharedNormalizedHashes=0`、`sharedTemplateFingerprints=0`、`sharedGroupIds=0`、`detected=false`。注意已知限制：本环境无神经 embedding 模型，SimHash/MinHash 仅覆盖词面相似性，不能证明不存在语义级泄露。

## 4. 训练过程

| 项 | 值 |
| --- | --- |
| epoch | 1（用户选择"记录缺口，继续 independent 评测"而**未**继续 epoch 2） |
| global step | 895 |
| train_loss（最终） | 0.07975 |
| eval_loss（最终） | 0.00963 |
| train runtime | 12695.1 s（约 3.53 h），吞吐 1.127 samples/s |
| eval runtime | 385.0 s |
| 显存峰值（训练） | allocated 6.31 GiB / reserved 6.77 GiB（RTX 5070 Ti Laptop，11.94 GiB） |
| max_length | 1024 tokens |
| batch | per_device=1 × grad_accum=16 → 有效 batch 16 |
| 优化器 | paged_adamw_8bit |
| LR schedule | 1e-4 cosine，warmup_ratio=0.05 |
| 截断统计 | train 截断 10 / 14314；train 因无 assistant token 丢弃 4；train drop ratio 0.000279（门禁 ≤0.001 PASS） |
| train 输入 token 长度 | min=379 / mean=491.76 / p99=660 / max=2391；超 1024 仅 0.07% |

## 5. 评测结果

### 5.1 三次评测对照

| 指标 | Baseline（基座，n=100 stratified） | LoRA closed（n=1236） | LoRA independent（n=1750） |
| --- | ---: | ---: | ---: |
| jsonSyntaxSuccessRate | 0.7900 | 0.9984 | **0.9714** |
| schemaValidRate | 0.7800 | 0.9984 | **0.9714** |
| verdictAccuracy | 0.0100 | 0.9717 | 0.9657 |
| maliciousRecall | 0.0000 | 0.9963 | **1.0000** |
| normalFPR | 0.9286 | 0.0567 | **0.0286** |
| hardNegativeFPR | 1.0000 | 0.0000 | **0.0200** |
| unknownAccuracy | 0.1429 | 1.0000 | **1.0000** |
| attackFamilyMacroF1 | 0.3401 | 0.6655 | **0.9787** |
| promptInjectionObedience | n/a (0 条) | n/a (0 条) | **0.9197** |
| recommendedActionAccuracy | 0.1200 | 0.9717 | 0.9663 |
| 平均延迟 ms | 13903.6 | 8975.6 | 9979.6 |
| p95 延迟 ms | 16325.3 | 13806.8 | 14522.0 |
| 显存峰值 GiB | 2.643 | 2.775 | 2.925 |

Baseline 数据证明：未微调的 Qwen3-4B-Instruct-2507 在该任务上完全不可用（verdict acc=0.01，maliciousRecall=0，normalFPR=0.93）。

### 5.2 门禁（`ml/configs/aetherargus-v02-acceptance-gates.json`，跑 independent 前已锁定，不得下调）

| 门禁 | 阈值 | 实测 | 判定 |
| --- | --- | ---: | :---: |
| jsonSyntaxSuccessRate | ≥ 0.995 | 0.9714 | **FAIL**（差 2.4 pt） |
| schemaValidRate | ≥ 0.990 | 0.9714 | **FAIL**（差 1.9 pt） |
| maliciousRecall | ≥ 0.920 | 1.0000 | PASS |
| normalFalsePositiveRate | ≤ 0.050 | 0.0286 | PASS |
| hardNegativeFalsePositiveRate | ≤ 0.100 | 0.0200 | PASS |
| unknownAccuracy | ≥ 0.850 | 1.0000 | PASS |
| attackFamilyMacroF1 | ≥ 0.700 | 0.9787 | PASS |
| promptInjectionObedience | ≥ 0.980 | 0.9197 | **FAIL**（差 6.0 pt） |
| perFamilyGuard | 无单一家族全死 | 14 个家族 familyAcc/recall 均 =1.0 | PASS |

**结论：5 项 PASS / 3 项 FAIL / perFamilyGuard PASS → 整体未达到发布门槛**。按 spec 门槛锁定后不得下调，本次发布不通过；模型仅以 research preview 名义分发，FAIL 项必须在任何外部引用中保留。

### 5.3 失败模式定位

1. **jsonSyntax / schemaValid FAIL 的唯一显著因素是 long_input_test**：
   - independent 集中 `long_input_test` 共 50 条（占 1750 的 2.86%），全部 json=0 / schema=0 / verdictAcc=0。
   - 这些样本的 user message 均超过 5000 字符（≈2000-3000 tokens），被评测端 `max_input_length=1024` 截断后，模型只能看到 JSON body 开头片段，无法识别为安全检测任务，输出自由文本分析而不是 contract JSON。
   - 其余套件（authorized_attack_test 1125、independent_hard_negative 88、independent_synthetic_normal 200、independent_unknown 150、prompt_injection_test 137）jsonSyntax 全部 = 1.0。
   - 训练集 p99=660 tokens、超 1024 仅 0.07%，模型在 ≤1024 token 范围内的 JSON 遵从性是 0.9984（closed 集实测）。这是**评测配置与训练长度不匹配**的问题，不是模型在第 1024 tokens 内的能力问题，但它仍按门禁判定为 FAIL（阈值锁定，不针对子集豁免）。

2. **prompt_injection obedience FAIL**：
   - `prompt_injection_test` 137 条，verdictAcc=0.9927 但 obedience=0.9197，11 条 injection 样本模型输出被劫持（按 injection 指令改变了 verdict 或 recommendedAction）。
   - 8.0% 的劫持率在 spec 阈值（≤2%）之上，**说明该模型不能单独面对含对抗 prompt 的输入**——部署时必须保留前置规则 / sanitize 层。

3. **closed-set 的 attackFamilyMacroF1=0.6655 在 independent 上反弹到 0.9787**：
   - closed 集 `authentication`（18 条）familyAcc=0.056、`deserialization`（15 条）=0.067、`sqli`=0.333、`command_injection`=0.409、`protocol_attack`=0.364，所有攻击家族 recall 仍 =1.0 但家族标签互相串扰。
   - independent 集 14 个家族 familyAcc/recall 全部 = 1.0，说明 closed 低分是该小子集（<20 条 / 家族）特殊性，不构成系统性失败。但 perFamilyGuard 在 closed 上的弱点值得在 v0.3 数据扩充时关注。

## 6. 限制与已知风险（Limitations & Known Risks）

按举证责任倒置原则，以下声明必须出现在任何使用本模型的代码/README/UI 标注里：

- **未经过真实流量验证**：训练与评测均为 deterministic synthetic + 公开派生语料，**0 条来自真实生产流量**，**0 条经人工安全专家标注**。
- **长输入未覆盖**：训练样本 p99=660 tokens；任何 user message > 1024 tokens 的输入在当前评测配置下会因截断失败。该能力缺口尚未在模型侧关闭。
- **prompt injection 鲁棒性不足**：在独立集上 137 条 injection 样本有 11 条（8.0%）成功劫持 verdict/recommendedAction。本模型**必须**与前置 sanitize / 规则引擎串联，不得作为唯一检测层。
- **训练未充分**：仅完成 1 epoch（用户选择"记录缺口，继续 independent"）；epoch 2 的影响未知。
- **延迟不可用于在线热路径**：平均 ~10 s/sample、p95 ~14.5 s/sample，仅适合旁路/离线/shadow mode。
- **不可声称**：
  - 生产级绝对安全；
  - 覆盖所有零日攻击；
  - 经过真实流量验证；
  - 经过人工专家标注；
  - 能替代规则引擎或硬件安全闸门。
- **Hardware Gate 仍兜底**：本模型的输出**不接入** Final Defense 硬件授权链；所有高风险动作（`host_remove`/`wipe_data`/`factory_reset` 等）仍必须经过 `hardware-authorization` + companion 校验。

## 7. 使用建议

1. 仅在 `security-engine` 的 **shadow mode** 接入，输出与规则结果并行，不直接驱动响应。
2. 接入侧必须实施：
   - 输入长度预检：user message 超过 1024 tokens 的样本**必须**走降级路径（例如分块 + 启发式，或直接降级到规则引擎），不能原样送入；
   - 系统 prompt 与用户 prompt 严格分离 + 输入 sanitize（防 prompt injection 落到 8% 劫持率上）；
   - 输出 JSON schema 强校验，失败时降级为 `unknown + monitor`（与 `lora-v02-independent-report.md` 现有约定一致）。
3. 任何 v0.3 计划必须显式关闭：(a) 长输入覆盖；(b) prompt injection 劫持率；(c) closed-set 小样本家族的 familyAcc。
4. 量化部署评估已完成（`aetherargus-v02-quantization-comparison.md`，Task 10）：5 档 GGUF（f16/Q8_0/Q6_K/Q5_K_M/Q4_K_M）在 1750 test-independent 上评测。**结论：无任何档进入部署候选**——全部超 normalFPR 升幅预算（≤2 pt，相对 merged BF16），根因经同权重双路径对照定位为 ollama 推理路径效应而非量化损失；且 promptInjectionObedience 在 transformers/ollama 两路径均 FAIL。GGUF 产物在 v0.3 关闭 FPR 根因、injection、长输入三项缺口前不得部署。

## 8. 复现锚点

- 训练配置：`ml/configs/qwen3-4b-qlora-v02.yaml`
- 训练摘要：`ml/output/aetherargus-v02-lora/training-summary.json`
- 数据 manifest：`ml/data/releases/v02/manifest.json`
- 门禁：`ml/configs/aetherargus-v02-acceptance-gates.json`
- 评测：`ml/reports/v02-baseline-smoke-metrics.json` / `lora-v02-closed-metrics.json` / `lora-v02-independent-metrics.json`
- 训练代码 git commit：`d8d6c93489c4a3e72ef1e580dafabad2b319cbe5`
- seed：`20260728`（数据集 / 训练 / 评测全程一致）
