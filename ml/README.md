# AetherGuard 安全判定模型 — QLoRA 微调

在 RTX 5070 Ti Laptop（12GB，Blackwell sm_120）+ WSL2 Ubuntu 上，用 QLoRA 微调
`Qwen/Qwen3-4B-Instruct-2507`，使其对标准化 HTTP 请求输出严格 JSON 安全判定。

> 本目录所有权重 / checkpoint / 缓存 / GGUF 均被 `.gitignore` 排除，不进 Git。
> 数据集源只读，产物落在 `ml/data/processed/`、`ml/output/`、`ml/reports/`、`ml/logs/`。

## 1. 环境

- OS：WSL2 Ubuntu 24.04（kernel 6.18）
- GPU：NVIDIA GeForce RTX 5070 Ti Laptop，12GB，compute capability `sm_120`（Blackwell）
- Python：3.11（隔离 venv `ml/.venv`）
- 关键依赖：torch 2.11.0+cu128、transformers 5.14、peft 0.19、trl 1.9、bitsandbytes 0.50、datasets 5.0
  （完整锁定见 `ml/requirements-lock.txt`）
- sm_120 要求 PyTorch ≥ 2.7 + CUDA 12.8 构建；bitsandbytes 0.50 含 sm120 kernel。

环境检查：`python scripts/check_environment.py` → `ml/reports/environment-report.{md,json}`。

## 2. 安装

```bash
cd ml
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt          # 含版本上界，适配 sm_120
pip freeze > requirements-lock.txt        # 记录实际锁定版本
```

## 3. 数据生成

```bash
PYTHONPATH=scripts python scripts/build_dataset.py --target-samples 1200 --seed 42
```

- 源：`backend/test-data/aetherguard-security-dataset/`（只读，4 子目录 + 已跟踪 SFT batch，4500 原始记录）。
- 产物：`ml/data/processed/{train,validation,test}.jsonl` + `ml/data/manifests/dataset-manifest.json`。
- 类别目标：attack 35% / normal 35% / hard_negative 20% / unknown 10%。
- 防泄漏：按规范化 payload 模板 + CVE + 编码 + 场景 + 攻击家族 + 内容/相似哈希分组切分，跨 split 共享组 = 0。
- 校验：`python scripts/validate_dataset.py`（全部样本通过 input/output Schema）。

## 4. 基座模型

首选 `Qwen/Qwen3-4B-Instruct-2507`（non-thinking Instruct，未降级到 1.7B）。

```bash
# 小文件可自动下；大权重 shard 在受限网络下需手动下载（见下）
python scripts/download_model.py --source huggingface        # 或 modelscope
```

**受限网络手动下载**（本机实测 HF CDN 对大文件限速/超时）：

1. 自动下载会卡在 `model-00001/00002-of-00003.safetensors`（各约 3.97GB）。
2. 用能连通的方式（代理 / IDM 等）下载这两个文件，放入 `ml/output/base-model/`。
3. 直链（commit hash `cdbee75...` 锁定 revision）：
   `https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/resolve/cdbee75f17c01a7cc42f958dc650907174af0554/model-0000{1,2}-of-00003.safetensors`
4. 校验：`python scripts/verify_local_model.py`（safetensors header + SHA256 == HF blob 哈希，字节级一致）。

完整性清单：`ml/reports/base-model-integrity.json`，下载报告：`ml/reports/model-download-report.md`。

## 5. 基线评估（未微调）

```bash
python evaluation/evaluate_model.py --mode model --run-name baseline \
  --model-name output/base-model --max-input-length 1024 --max-new-tokens 320 --seed 42
```

- 固定测试集 `ml/data/processed/test.jsonl`（120 条），与 LoRA 评估完全相同。
- 指标：JSON 语法成功率、Schema 合法率、verdict accuracy、恶意 P/R/F1、正常 FPR、attackFamily macro-F1、
  action accuracy、unknown 使用率、平均/p50/p95 延迟、显存峰值。
- 失败输出降级为 `unknown`+`monitor`，绝不降为 `safe`。
- 产物：`ml/reports/baseline-{metrics.json,report.md}`、`ml/output/baseline-predictions.jsonl`。

规则基线（CPU，不需 GPU）：`cd ../backend && npx ts-node-transpile-only --project ../ml/tsconfig.rules.json ../ml/evaluation/evaluate_rules.ts`，
再 `python evaluation/evaluate_model.py --mode score --run-name rules --prediction-input output/rules-predictions.jsonl`。

## 6. 训练（QLoRA）

显存适配 smoke test（遇 OOM 自动降配，最多到 max_length 512 / lora_r 4 / alpha 8）：

```bash
python training/run_smoke_adaptation.py --model-name output/base-model
```

正式训练（用 smoke 胜出配置）：

```bash
python training/train_qlora.py --config configs/qwen3-4b-qlora.yaml \
  --model-name output/base-model \
  --max-length <smoke值> --lora-r <smoke值> --lora-alpha <smoke值>
```

- assistant-only loss（prompt token 被 -100 mask），原始 `Trainer`（不依赖 SFTTrainer）。
- 4-bit NF4 + double quant + bf16 compute；gradient checkpointing（use_reentrant=False）；paged_adamw_8bit。
- `use_cache=false`、只训 LoRA、基座冻结；信号感知中断保存；支持 `--resume-from-checkpoint auto`。
- 产物：`ml/output/aetherargus-lora/`（adapter + tokenizer + trainer_state + training-summary.json）。

### 断点恢复

```bash
python training/train_qlora.py --config configs/qwen3-4b-qlora.yaml \
  --model-name output/base-model --resume-from-checkpoint auto
```

## 7. LoRA 推理评估

```bash
python evaluation/evaluate_model.py --mode model --run-name lora \
  --model-name output/base-model --adapter-path output/aetherargus-lora \
  --max-input-length 1024 --max-new-tokens 320 --seed 42
```

`do_sample=false`、固定 seed，确定性贪心解码。

## 8. 合并

```bash
python training/merge_adapter.py --base-model output/base-model \
  --adapter-path output/aetherargus-lora --output-dir output/aetherargus-merged
```

合并后在 bf16 全精度重载并对 ≥20 条固定样本 smoke test。GPU 显存不足时可 CPU 合并（脚本监控内存）。

## 9. Ollama 部署（GGUF，可选）

```bash
# 需 llama.cpp（convert_hf_to_gguf.py + 编译的 llama-quantize）
python training/export_gguf.py --llama-cpp <llama.cpp路径> \
  --merged-model output/aetherargus-merged
ollama create aetherargus -f deployment/Modelfile
```

无法可靠转换时不伪造 GGUF，保留 HF 合并模型 + LoRA adapter，在 `ml/reports/gguf-export-report.md` 注明阻塞。

## 10. 对比报告

```bash
python evaluation/compare_results.py    # 需 baseline/lora/rules/combined 四份 metrics
```

产物：`ml/reports/baseline-vs-lora.{md,json}`（基座 / LoRA / 规则 / 规则+LoRA 四列对比）。

## 11. 评估指标定义

见 `evaluation/evaluate_model.py` 的 `calculate_metrics`。关键：JSON/Schema 失败不计为 safe；
`heuristicOnly=true` 的规则结果明确标注非 AI 推理。

## 12. 已知限制

- 数据集源是合成测试语料（含明确标注的 generated_auxiliary 辅助样本），未经独立人工标注。
- 12GB 显存下 4B 用 4-bit + grad checkpointing 训练；更大 batch 需降配或降级 1.7B。
- /mnt/x（Windows 文件系统）跨 WSL I/O 较慢，模型加载/数据读写有额外开销。
- GGUF/Ollama 依赖 llama.cpp，本机不一定预装。
- 安全判定建议不绕过规则引擎与硬件闸门（Final Defense / Root-Resistant Gateway）。

## 13. 实际训练结果

> 实测来源：`output/aetherargus-lora/training-summary.json`、`reports/baseline-metrics.json`、
> `reports/lora-metrics.json`、`reports/combined-metrics.json`、`reports/baseline-vs-lora.json`。

- 实际模型：Qwen3-4B-Instruct-2507（commit `cdbee75f17c01a7cc42f958dc650907174af0554`，未降级 1.7B）
- GPU / 显存：RTX 5070 Ti Laptop / 11.94 GiB（sm_120）
- 是否 4B / 是否降级：4B，未降级；smoke 第一次尝试（max_length 768 / r=8 / alpha=16）即成功，未触发任何降配
- 样本数 train/validation/test：958 / 122 / 120
- 训练耗时：651.2s 训练 + 23.7s 验证（全程 740.8s，1 epoch / 60 steps）
- 显存峰值：训练 5.381 GiB allocated（5.615 GiB reserved）；LoRA 推理 2.694 GiB
- 最终训练参数（smoke 胜出）：max_length 768、lora_r 8、lora_alpha 16、dropout 0.05、lr 1e-4、batch 1×grad_accum 16、
  4-bit NF4 + double quant + bf16、paged_adamw_8bit、assistant-only loss；train_loss 0.6697、eval_loss 0.5009
- 基线 → LoRA 指标（120 条固定测试集，do_sample=false、seed 42）：
  - JSON 语法率 0.9167 → 0.9917；Schema 合法率 0.8667 → 0.9833
  - verdict 准确率 0.2833 → 0.9000；恶意 F1 0.1364 → 0.8916（P 0.8810 / R 0.9024）
  - 正常误报率 0.5152 → 0.0455（34/66 → 3/66）
  - attackFamily macro-F1 0.4582 → 0.6147；action 准确率 0.3917 → 0.9000
  - 延迟：基线 avg 16.9s → LoRA avg 6.1s / p95 9.1s
  - 相对基线：新增正确检出恶意 34 条、新增误报 0、修复基线误报 31 条
- rules+LoRA 组合：verdict 0.7083 / 恶意 F1 0.7255 / FPR 0.3939（规则 guardrail 引入误报，LoRA 单独更优；
  组合仅作对照，未接入生产路由）
- 数据泄漏：无（manifest leakageCheck.detected=false，跨 split 共享组 0）
- adapter 路径：`ml/output/aetherargus-lora/`（adapter_model.safetensors 64MB + tokenizer + trainer_state）
- 合并模型路径：`ml/output/aetherargus-merged/`（CPU 合并 + 20 条重载 smoke，见 `merge-summary.json`）
- GGUF / Ollama：F16 8.05GB + Q4_K_M 2.50GB（`ml/output/aetherargus-*.gguf`，`reports/gguf-export-report.json`）；
  已 `ollama create aetherargus`（2.5GB）并实测一次推理返回合法 JSON（7 键齐全、正确判 SQL 注入为 attack），非 heuristic
