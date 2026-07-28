# AetherGuard 安全判定模型 — 测试报告（GGUF/Ollama 部署态 vs 基线 vs LoRA）

生成时间：2026-07-28
评测后端：GGUF Q4_K_M 经 Ollama 0.32.5（`ollama create aetherguard-security`，真实 HTTP 推理）
测试集：固定 `ml/data/processed/test.jsonl`（120 条，与基线/LoRA 完全相同）
指标定义：`evaluation/evaluate_model.py::calculate_metrics`（三种产物同一套）
证据文件：`reports/ollama-metrics.json`、`output/ollama-predictions.jsonl`（逐样本原始输出+校验错误）

## 真实性声明

- 本轮为真实模型推理：`modelInvocationCount=120 / 120`，`heuristicOnly=false`（`ollama-metrics.json:6-7`）。
- 评测脚本 `evaluation/evaluate_ollama.py` 走 Ollama `/api/chat` HTTP，非 heuristic/fallback；
  JSON/Schema 失败不修补为 safe，统一降级 `unknown`+`monitor`（fail-safe），原始输出保留。
- 显存峰值 `peakGpuMemoryGiB=null`：score 模式不重载模型，Ollama 侧显存不在本指标采集范围（如实标注，不填估算值）。

## 三产物对比（同一固定测试集，同一指标）

| 指标 | 基线(未微调) | LoRA(HF/QLoRA) | GGUF/Ollama(Q4_K_M) |
| --- | --- | --- | --- |
| JSON 语法成功率 | 0.9167 | 0.9917 | **1.0000** |
| Schema 合法率 | 0.8667 | 0.9833 | 0.9833 |
| verdict accuracy | 0.2833 | **0.9000** | 0.8417 |
| 恶意 precision | 1.0000 | **0.8810** | 0.7170 |
| 恶意 recall | 0.0732 | 0.9024 | **0.9268** |
| 恶意 F1 | 0.1364 | **0.8916** | 0.8085 |
| 正常误报率 FPR | 0.5152 (34/66) | **0.0455 (3/66)** | 0.1970 (13/66) |
| attackFamily macro-F1 | 0.4582 | **0.6147** | 0.5193 |
| recommendedAction acc | 0.3917 | **0.9000** | 0.8417 |
| unknown 使用率 | 0.2000 | 0.0833 | 0.1000 |
| 平均延迟 | 16887 ms | 6116 ms | **869 ms** |
| p95 延迟 | 21899 ms | 9111 ms | **1140 ms** |

## 关键结论

1. **GGUF/Ollama 部署态可用且远优于基线**：verdict 0.8417 vs 基线 0.2833，恶意 F1 0.8085 vs 0.1364，
   JSON 语法成功率 1.0000（三产物最高）。量化（Q4_K_M）未破坏结构化输出能力。
2. **量化有损**:GGUF/Ollama 全面略低于 HF/LoRA——verdict -0.058、恶意 F1 -0.083、
   FPR 0.0455→0.1970（误报 3→13 条，集中在 hard_negative 类，该类 verdict 准确率 0.708）。
   主因是 Q4_K_M 量化精度损失；HF bf16 LoRA 仍是质量上限。
3. **召回反升**:GGUF/Ollama 恶意 recall 0.9268 高于 LoRA 0.9024（更倾向判 malicious），
   代价是 precision 降到 0.7170、FPR 升高——部署态偏"宁滥勿缺"，对安全场景是可接受的取向。
4. **延迟数量级优势**:GGUF/Ollama avg 869ms vs LoRA 6116ms(~7×)vs 基线 16887ms(~19×)，
   llama.cpp 推理栈在生产部署上明显更实用。

## 分类明细（GGUF/Ollama,categoryBreakdown）

- attack:42 条，verdict 准确率 0.905（判 malicious 39 / safe 1 / unknown 2）
- hard_negative:24 条，verdict 准确率 0.708（误判 malicious 7——主要误报来源）
- normal:42 条，verdict 准确率 0.857
- unknown:12 条（见 `ollama-metrics.json` categoryBreakdown.unknown）

## 家族明细（GGUF/Ollama,familyBreakdown）

- 强：`path_traversal` / `protocol_attack` / `xss` family accuracy 1.0；`deserialization` 0.75
- 弱：`sqli` 0.40、`command_injection` 0.60、`file_upload` 0.0(样本仅 1)、`benign` 0.803
- 各家族 malicious recall 普遍 1.0（除 command_injection 0.6），再次印证"高召回、精度让位"

## 未覆盖范围（本轮未触及）

- 未跑 rules / rules+Ollama 组合（组合策略已由 LoRA 实验证明引入误报，仅作对照，未接入生产）。
- Ollama 侧 GPU 显存/CPU 占用未采集（score 模式不重载模型；如需部署容量数据需单独压测）。
- 未做并发/吞吐压测（仅单并发延迟）；未接入 `detection-pipeline.service.ts` 生产路由。
- `peakGpuMemoryGiB` 为 null（如实标注）——非"未测量填 0"，是 score 模式采集边界。
