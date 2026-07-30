# AetherArgus v0.2 Preview — 训练报告

生成时间：2026-07-29
数据截至：LoRA independent 评测完成（2026-07-29T14:08:12Z）

本报告记录 v0.2 QLoRA 训练 run 的配置、数据、过程指标与可复现路径。**不**做门禁判定（见 `aetherargus-v02-model-card.md` 与 `aetherargus-v02-evaluation-report.md`）。

---

## 1. 运行身份

| 项 | 值 |
| --- | --- |
| 训练配置 | `ml/configs/qwen3-4b-qlora-v02.yaml` |
| 训练摘要 | `ml/output/aetherargus-v02-lora/training-summary.json` |
| 训练产物目录 | `ml/output/aetherargus-v02-lora/` |
| 训练完成时间 | 2026-07-29T05:37:25Z |
| 训练端 git commit | `d8d6c93489c4a3e72ef1e580dafabad2b319cbe5` |
| GPU | NVIDIA GeForce RTX 5070 Ti Laptop GPU（11.94 GiB） |
| 数据集版本 | v02（manifest sha256 `c780d22f412dd71d37180b7bd1ac28df90074e6289352d6125f749eba79623fd`） |
| seed | 20260728 |

## 2. 模型与适配器

| 项 | 值 |
| --- | --- |
| 基座 | `Qwen/Qwen3-4B-Instruct-2507` |
| 基座 revision | `cdbee75f17c01a7cc42f958dc650907174af0554` |
| 加载方式 | 4-bit NF4 double-quant（`load_in_4bit=true`，`bnb_4bit_quant_type=nf4`，`bnb_4bit_use_double_quant=true`，`bnb_4bit_compute_dtype=bfloat16`） |
| 总参数 | 2,238,840,320 |
| 可训练参数 | 33,030,144（1.4753%） |
| LoRA | r=16, alpha=32, dropout=0.05, target_modules=all-linear |
| 适配器产物 | `adapter_model.safetensors`（132 MB）+ `adapter_config.json` + `tokenizer_config.json` + `trainer_state.json`（`adapterFiles` 全 true） |
| Checkpoint 策略 | save_steps=200, save_total_limit=3 → `checkpoint-600/`, `checkpoint-800/`, `checkpoint-895/` |

## 3. 数据

| Split | 文件 | records | bytes | sha256 |
| --- | --- | ---: | ---: | --- |
| train | `ml/data/releases/v02/train.jsonl` | 14,314 | 60,123,833 | `e8ff084f…c3e1` |
| validation | `ml/data/releases/v02/validation.jsonl` | 1,752 | 7,293,617 | `ea6f3d07…5606` |
| test-closed | `ml/data/releases/v02/test-closed.jsonl` | 1,236 | 4,916,613 | `c1cba66e…d003` |
| test-independent | `ml/data/releases/v02/test-independent.jsonl` | 1,750 | 7,495,809 | `4a0dbda1…01f4` |

完整 sha256 见 `ml/data/releases/v02/manifest.json`。**v0.2 数据集是在 v0.2 初版系统 prompt 与 `detection_contract.SYSTEM_PROMPT` 对齐之后整体重写**的：4 个 split + manifest + independent seal 全部重新生成。`seed=20260728` 贯穿切分 / 生成 / 训练 / 评测。

**人类与真实流量声明**：`humanReviewCount=0`、`realNormalCount=0`、`authorizedRealAttackCount=0`。所有样本均为 deterministic synthetic 或公开派生（OWASP CRS regression / S-Labs prompt-injection train / Stripe OpenAPI contract），attribution 完整链见 manifest `publicSources` 与 `bySourceDataset`。

## 4. 训练超参（`qwen3-4b-qlora-v02.yaml`）

| 参数 | 值 |
| --- | --- |
| `max_length` | 1024 |
| `num_train_epochs` | 1 |
| `learning_rate` | 1e-4 |
| `lr_scheduler_type` | cosine |
| `warmup_ratio` | 0.05 |
| `per_device_train_batch_size` | 1 |
| `per_device_eval_batch_size` | 1 |
| `gradient_accumulation_steps` | 16（有效 batch = 16） |
| `gradient_checkpointing` | true |
| `bf16` | true |
| `fp16` | false |
| `packing` | false |
| `assistant_only_loss` | true |
| `optim` | paged_adamw_8bit |
| `save_steps` / `eval_steps` / `logging_steps` | 200 / 200 / 10 |
| `save_total_limit` | 3 |
| `seed` | 20260728 |

## 5. 截断与样本可用性

源数据 14,314 条，实际进入训练 14,310 条。截断/丢弃情况：

| 指标 | 值 | 门禁 | 判定 |
| --- | ---: | ---: | :---: |
| trainSourceRecords | 14,314 | — | — |
| trainUsableExamples | 14,310 | — | — |
| trainTruncated | 10 | — | — |
| trainDroppedWithoutAssistantTokens | 4 | — | — |
| trainDropRatio | 0.000279 | ≤ 0.001 | **PASS** |
| validationTruncated | 3 | — | — |
| validationDroppedWithoutAssistantTokens | 3 | — | — |

train 输入 token 长度分布（来自 `training-summary.json`）：min=379 / mean=491.76 / median=483 / p90=561 / p95=589 / **p99=660** / max=2391；超 512 占 37.75%，超 1024 仅 0.07%，超 1536 仅 0.03%。

assistant 输出 token 长度：min=0 / mean=88.47 / p99=166 / max=297，全程无超 512。

→ 训练长度分布集中在 380-660 tokens，**>1024 的长输入在训练阶段几乎未出现**（仅 10 条截断）。这是评测端 `long_input_test` 50 条全失败的上游根因（详见评测报告）。

## 6. 训练过程

### 6.1 总览

| 指标 | 值 |
| --- | ---: |
| 总耗时 | 12,695.1 s（约 3.53 h） |
| 吞吐 | 1.127 train samples/s（0.07 train steps/s） |
| global step | 895 |
| epoch | 1.0 |
| total FLOPs | 1.5465e17 |
| 最终 train_loss | 0.07975 |
| 最终 eval_loss | 0.00963 |
| eval runtime | 385.0 s（4.543 samples/s） |

### 6.2 loss 曲线关键节点（来自 `trainer_state.json`）

| step | epoch | learning_rate | train_loss | eval_loss |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0.0011 | 0.0 | 3.5078 | — |
| 10 | 0.0112 | 2.00e-05 | 3.2076 | — |
| 20 | 0.0224 | 4.22e-05 | 1.7727 | — |
| 30 | 0.0335 | 6.44e-05 | 1.0716 | — |
| 40 | 0.0447 | 8.67e-05 | 0.6018 | — |
| 50 | 0.0559 | 1.00e-04（峰值） | 0.1825 | — |
| 60 | 0.0671 | 9.99e-05 | 0.0296 | — |
| 100 | 0.1118 | 9.90e-05 | 0.0078 | — |
| 200 | 0.2236 | 9.21e-05 | 0.0034 | **0.11391** |
| 400 | 0.4472 | 6.30e-05 | 0.0029 | **0.01534** |
| 600 | 0.6709 | 2.71e-05 | 0.0026 | **0.01315** |
| 800 | 0.8945 | 3.11e-06 | 0.0006 | **0.00960** |
| 895（final） | 1.0000 | ≈0 | （train_metrics 汇总 0.07975） | **0.00963** |

观察：
- loss 在前 60 步快速收敛到 0.03 以下，此后长期低位震荡（~1e-3 量级）。
- step 140、180、280、360、690 等处出现 1e-2 量级尖刺，但 eval_loss 单调下行（0.114 → 0.015 → 0.013 → 0.0096），未见退化迹象。
- 训练汇总 `train_loss=0.07975` 是 895 步的滑动平均，包含了 warmup 期的高 loss；后期稳态 loss 远低于该值。
- **未执行 epoch 2**：用户在 epoch 1 完成后选择"记录缺口，继续 independent 评测"，因此本 run 没有任何 epoch 2 数据。epoch 2 是否能进一步压低 eval_loss / 是否导致过拟合，本次未验证。

### 6.3 显存与吞吐

| 指标 | 值 |
| --- | ---: |
| peakGpuAllocatedGiB | 6.315 |
| peakGpuReservedGiB | 6.768 |
| GPU 总容量 | 11.94 GiB |
| 占用率（reserved / total） | 56.7% |

QLoRA 4-bit 加载 + gradient_checkpointing + per_device=1 + grad_accum=16 是把 4B 模型压到 6-7 GiB 训练的组合。RTX 5070 Ti Laptop 11.94 GiB 上有 ~5 GiB 余量。

## 7. 复现命令

环境前置：仓库已存在 `ml/.venv`（Python 3.11），且基座模型已落到 `ml/output/base-model`（训练摘要里的 `modelReference`）。Windows 侧直接跑 `python` 会因路径问题失败，统一在 WSL Ubuntu 下执行：

```bash
cd /mnt/x/repos/Networksafe
# 1) 准备数据集（如已生成可跳过；本步骤为幂等）
ml/.venv/bin/python ml/scripts/build_dataset_v02.py \
  --config ml/configs/dataset-v02.yaml \
  --seed 20260728

# 2) 启动 QLoRA 训练
ml/.venv/bin/python ml/scripts/train_qlora.py \
  --config ml/configs/qwen3-4b-qlora-v02.yaml
```

注意：以上命令名称与参数仅是文档记录，**本次工作流不重新执行训练**。任何复现跑前必须确认 `ml/data/releases/v02/manifest.json` sha256=`c780d22f…23fd`、`train.jsonl` sha256=`e8ff084f…c3e1`，否则不算同一 run。

## 8. 已知缺口

- epoch 2 未跑（用户决策"记录缺口，继续 independent"），下一轮 v0.3 默认应跑 ≥2 epoch 并对比 eval_loss 曲线。
- 训练 token 长度分布 p99=660，对 >1024 输入无覆盖；v0.3 若目标支持长 JSON body，需要在训练集主动加入长样本或调大 `max_length`，并相应调整显存预算。
- 当前未做 K-fold / 多 seed 复跑，单一 seed=20260728 的方差未知。
- 未做超参扫描，1e-4 cosine 是首组尝试值。
