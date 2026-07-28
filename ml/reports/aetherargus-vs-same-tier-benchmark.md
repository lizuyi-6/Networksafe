# AetherArgus vs 同量级模型基准对比报告

- 日期：2026-07-28
- 评测对象：`aetherargus:latest`（Ollama，GGUF Q4_K_M，基座 Qwen3-4B-Instruct-2507 + LoRA 已合并）
- 对比对象：同参数量级（3–4B）开箱模型 + AetherArgus HF-LoRA 未量化上限 + HF 基座
- 评测方式：`ml/evaluation/evaluate_ollama.py`（真实 HTTP 推理）→ `ml/evaluation/evaluate_model.py --mode score` 统一打分
- 评测集：同一固定测试集 120 条样本，所有模型 **120/120 真实调用，`heuristicOnly=false`**，无任何 mock / heuristic 补丁

## 1. 总表

| 指标 | **AetherArgus GGUF Q4_K_M** | Qwen3-4B-Instruct（开箱） | Llama3.2-3B（开箱） | Qwen3-4B HF 基座 | AetherArgus HF-LoRA（上限） |
|---|---|---|---|---|---|
| verdict 准确率 | **0.8417** | 0.0917 | 0.0917 | 0.2833 | 0.9000 |
| 恶意 F1 | **0.8085** | 0.1364 | 0.0000 | 0.1364 | 0.8916 |
| 恶意 recall | **0.9268** | 0.0732 | 0.0000 | — | 0.9024 |
| 恶意 precision | 0.7170 | 1.0000 | 0.0000 | — | 0.8810 |
| 正常误报率 FPR | 0.1970 | 0.5909 | 0.0455 | 0.5152 | 0.0455 |
| JSON 语法成功率 | **1.0000** | 0.7917 | 0.8333 | — | 0.9917 |
| Schema 合法率 | **0.9833** | 0.7167 | 0.1000 | — | 0.9833 |
| attackFamily macro-F1 | **0.5193** | 0.2942 | 0.1592 | — | 0.6147 |
| 平均延迟 | 869 ms | 2515 ms | 765 ms | 16887 ms | 6116 ms |

## 2. 相对倍数（AetherArgus GGUF vs 同量级开箱模型）

| 对比 | verdict 准确率 | 恶意 F1 |
|---|---|---|
| vs Qwen3-4B-Instruct（同族同参数量，最公平） | 0.8417 / 0.0917 ≈ **9.2×** | 0.8085 / 0.1364 ≈ **5.9×** |
| vs Llama3.2-3B | 0.8417 / 0.0917 ≈ **9.2×** | 0.8085 / 0.0（不可比，Llama 全零） |
| vs Qwen3-4B HF 基座 | 0.8417 / 0.2833 ≈ **3.0×** | 0.8085 / 0.1364 ≈ **5.9×** |

误报率：AetherArgus FPR 0.1970，Qwen3-4B-Instruct 0.5909（约 **3× 更低**），HF 基座 0.5152。

## 3. 开箱模型低分的真实原因（不是"安全判断力差 9 倍"）

开箱模型大量输出 **`suspicious` 这个不在枚举内的 verdict**——它们没学过本任务的严格输出协议（固定 verdict 枚举 + 7 字段 Schema），而非通用安全能力弱：

- Qwen3-4B-Instruct：attack 类 42 条中仅 4 条判对（9.5%），28 条被标为非法值 `suspicious`；hard_negative 类 23 条全部被标 `suspicious`（该类准确率 0.0）。
- Llama3.2-3B：Schema 合法率仅 0.10，几乎全部输出不符合协议，恶意 F1 = 0 主要是 **Schema 不兼容** 所致。
- Llama3.2-3B 的 FPR 0.0455 看似优秀，但那是它几乎从不判 malicious（recall = 0）的副产品，不构成"误报控制好"的证据。

**结论：这正是 LoRA 微调的价值——把一个通用 4B 模型对齐到这套严格 JSON 安全判定协议上。** 对比不应解读为"AetherArgus 通用能力是同量级 9 倍"。

## 4. 量化损失（GGUF vs HF-LoRA 上限）

同一权重 HF-LoRA（未量化）到 GGUF Q4_K_M 的退化：

| 指标 | HF-LoRA | GGUF Q4_K_M | 退化 |
|---|---|---|---|
| verdict 准确率 | 0.9000 | 0.8417 | −0.058 |
| 恶意 F1 | 0.8916 | 0.8085 | −0.083 |
| FPR | 0.0455 | 0.1970 | +0.152（误报恶化最明显） |
| attackFamily macro-F1 | 0.6147 | 0.5193 | −0.095 |
| 平均延迟 | 6116 ms | 869 ms | **快约 7×** |

量化主要伤害 precision/FPR（边界样本更容易误判正常为恶意），recall 基本保住（0.9024 → 0.9268，反而略升，因判定整体更偏向恶意）。延迟收益显著。

## 5. 测量说明与已知注意事项（如实）

1. **`qwen3:4b` 官方 thinking 镜像首轮评测全零是测量伪迹**：思考过程吃光 token 预算导致 content 为空，并非模型真实水平。公平对比行使用 `qwen3:4b-instruct`（非 thinking，与 HF 基座 Qwen3-4B-Instruct-2507 形态对应），本文数据均以 instruct 行有效。`ml/reports/cmp-qwen3-4b-metrics.json` 保留全零记录仅作伪迹存档，不得用于对比结论。
2. HF 基座与 HF-LoRA 行来自此前评测（`baseline-metrics.json` / `lora-metrics.json`），评测集与打分脚本相同，但推理栈为 HF transformers 而非 Ollama，延迟数字跨栈不可直接比。
3. 所有 Ollama 行：120/120 真实调用、temperature=0、`heuristicOnly=false`；JSON/Schema 解析失败从不补丁为 safe，按失败计。
4. Llama3.2-3B 的 0 分行含 Schema 不兼容成分（见 §3），引用时须带此限定。

## 6. 证据文件索引

| 模型 | 指标文件 | 预测明细 |
|---|---|---|
| AetherArgus GGUF | `ml/reports/ollama-metrics.json` | `ml/output/ollama-predictions.jsonl`（git-ignored） |
| Qwen3-4B-Instruct | `ml/reports/cmp-qwen3-4b-instruct-metrics.json` | `ml/output/cmp-qwen3-4b-instruct-predictions.jsonl`（git-ignored） |
| Llama3.2-3B | `ml/reports/cmp-llama32-3b-metrics.json` | `ml/output/cmp-llama32-3b-predictions.jsonl`（git-ignored） |
| qwen3:4b thinking（伪迹存档） | `ml/reports/cmp-qwen3-4b-metrics.json` | `ml/output/cmp-qwen3-4b-predictions.jsonl`（git-ignored） |
| Qwen3-4B HF 基座 | `ml/reports/baseline-metrics.json` | — |
| AetherArgus HF-LoRA | `ml/reports/lora-metrics.json` | — |

复现命令（WSL 内）：

```bash
cd /x/repos/Networksafe/ml
source .venv/bin/activate
PYTHONPATH=scripts:evaluation python evaluation/evaluate_ollama.py \
  --model <ollama_model_name> --output output/cmp-<name>-predictions.jsonl
PYTHONPATH=scripts:evaluation python evaluation/evaluate_model.py \
  --mode score --run-name cmp-<name> --prediction-input output/cmp-<name>-predictions.jsonl
# 指标落盘：reports/cmp-<name>-metrics.json
```
