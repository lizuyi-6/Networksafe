# AetherArgus v0.2 Preview — GGUF 量化对比

生成时间：2026-07-30
数据来源：Task 10 全部 5 档 GGUF independent 评测完成
测试集：`ml/data/releases/v02/test-independent.jsonl`（n=1750，test-independent，密封集）
推理路径：Ollama HTTP API（127.0.0.1:11434 `/api/chat`），temperature=0（确定性），num_ctx=2048
Modelfile：`ml/deployment/Modelfile.v02.detector`（strict-JSON detector system prompt）
seed：`20260728`（与 v0.2 数据/训练/评测全程一致）

> **判定结论（按锁定预算）：无任何 GGUF 档进入部署候选。** 全部 5 档（含近无损的 f16 GGUF）相对 merged BF16 基线的 `normalFalsePositiveRate` 升幅都超过锁定预算（≤2.0 pt）。根因经同权重双路径对照定位为**推理引擎路径切换**（transformers → ollama），**不是量化损失**。此结论与 v0.2 主门禁本就 FAIL 一致；量化产物在 v0.3 关闭已知缺口前不应部署。

---

## 1. 范围与协议

- 被评对象：merged BF16 模型（`ml/output/aetherargus-v02-lora/adapter_model.safetensors` merge 回 `Qwen/Qwen3-4B-Instruct-2507` rev `cdbee75f17c01a7cc42f958dc650907174af0554`）量化为 5 档 GGUF。
- 每档在同一 1750 test-independent 集上跑 evaluate_ollama + evaluate_model score，逐样本确定性（temperature 0），崩溃可恢复（sample-level append+flush）。
- 门禁阈值取 `ml/configs/aetherargus-v02-acceptance-gates.json`，锁定不下调。
- 降级预算基线：**merged BF16**（`relativeTo: "merged BF16"`，acceptance-gates.json:19），实测基线取 `ml/reports/merged-v02-independent-metrics.json`。

## 2. 实测指标（5 档，n=1750）

| 指标 | f16 | Q8_0 | Q6_K | Q5_K_M | Q4_K_M |
| --- | ---: | ---: | ---: | ---: | ---: |
| jsonSyntaxSuccessRate | 0.9971 | 1.0000 | 0.9989 | 1.0000 | 1.0000 |
| schemaValidRate | 0.9971 | 1.0000 | 0.9989 | 1.0000 | 1.0000 |
| verdictAccuracy | 0.9834 | 0.9869 | 0.9857 | 0.9869 | 0.9840 |
| maliciousRecall | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.9952 |
| maliciousF1 | 0.9960 | 0.9960 | 0.9956 | 0.9936 | 0.9908 |
| normalFalsePositiveRate | 0.0686 | 0.0657 | 0.0657 | 0.0657 | 0.0629 |
| hardNegativeFalsePositiveRate | 0.1500 | 0.1400 | 0.1500 | 0.1500 | 0.1400 |
| unknownAccuracy | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| promptInjectionObedience | 0.9270 | 0.9270 | 0.9343 | 0.9270 | 0.9343 |
| attackFamilyMacroF1 | 0.9869 | 0.9886 | 0.9881 | 0.9891 | 0.9885 |
| 平均延迟 ms | 2478 | 1533 | 1438 | 1257 | 1141 |
| p95 延迟 ms | 3328 | 2061 | 1881 | 1583 | 1472 |
| GGUF 文件大小 | 7.5 G | 4.0 G | 3.1 G | 2.7 G | 2.4 G |

样本数校验：全 5 档 sampleCount=1750。
数据源：`ml/reports/gguf-{f16,q8_0,q6_k,q5_k_m,q4_k_m}-independent-metrics.json`。

## 3. 锁定门禁（每档）

全部 5 档在同 3 项门禁 FAIL、其余 5 项 PASS：

| 门禁 | 阈值 | f16 | Q8_0 | Q6_K | Q5_K_M | Q4_K_M |
| --- | --- | :---: | :---: | :---: | :---: | :---: |
| jsonSyntaxSuccessRate | ≥0.995 | PASS | PASS | PASS | PASS | PASS |
| schemaValidRate | ≥0.990 | PASS | PASS | PASS | PASS | PASS |
| maliciousRecall | ≥0.920 | PASS | PASS | PASS | PASS | PASS |
| normalFalsePositiveRate | ≤0.050 | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| hardNegativeFalsePositiveRate | ≤0.100 | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| unknownAccuracy | ≥0.850 | PASS | PASS | PASS | PASS | PASS |
| attackFamilyMacroF1 | ≥0.700 | PASS | PASS | PASS | PASS | PASS |
| promptInjectionObedience | ≥0.980 | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |

注意：GGUF 路径下 jsonSyntax/schemaValid **PASS**（≥0.997），而 transformers 路径下这两项 FAIL（0.9714，因 long_input_test 截断）——因为 ollama num_ctx=2048 > 评测端 transformers max_input_length=1024，长输入未被同样截断。这是两套评测端不同截断配置导致，不是模型能力差异。

## 4. 降级预算判定（相对 merged BF16，锁定基线）

基线 merged BF16（`merged-v02-independent-metrics.json`）：jsonSyntax=0.9714，maliciousRecall=1.0000，normalFPR=0.0257。
预算：jsonSyntax 降 ≤0.5pt / recall 降 ≤2pt / normalFPR 升 ≤2pt（hardNegFPR **不在**锁定预算内，下方仅供参考）。

| 档 | jsonSyntax Δpt | recall Δpt | normalFPR Δpt | 是否过预算 |
| --- | ---: | ---: | ---: | :---: |
| f16 | +2.57（升，不罚） | +0.00 | **+4.29** | **超预算** |
| Q8_0 | +2.86 | +0.00 | **+4.00** | **超预算** |
| Q6_K | +2.75 | +0.00 | **+4.00** | **超预算** |
| Q5_K_M | +2.86 | +0.00 | **+4.00** | **超预算** |
| Q4_K_M | +2.86 | −0.48 | **+3.71** | **超预算** |

按锁定预算字面判定：**5 档全部超 normalFPR 升幅预算**。jsonSyntax 与 recall 两项全部在预算内（jsonSyntax 甚至上升，recall 仅 Q4_K_M 掉 0.48pt，仍 <2pt）。

## 5. 推理引擎对照（关键：超预算根因不是量化）

同一份 merged 权重，两条推理路径，同 1750 集：

| 指标 | transformers BF16 | ollama f16 GGUF | Δ（GGUF−TF, pt） |
| --- | ---: | ---: | ---: |
| jsonSyntaxSuccessRate | 0.9714 | 0.9971 | +2.57 |
| maliciousRecall | 1.0000 | 1.0000 | +0.00 |
| normalFalsePositiveRate | 0.0257 | 0.0686 | **+4.29** |
| hardNegativeFalsePositiveRate | 0.0100 | 0.1500 | **+14.00** |
| promptInjectionObedience | 0.9197 | 0.9270 | +0.73 |
| unknownAccuracy | 1.0000 | 1.0000 | +0.00 |
| verdictAccuracy | 0.9663 | 0.9834 | +1.71 |

解读：
- normalFPR/hardNegFPR 门禁在 transformers 下 **PASS**（0.0257 / 0.0100），在 ollama f16 GGUF 下同权重 **FAIL**（0.0686 / 0.1500）。f16 GGUF 相对 merged BF16 是近无损量化，却已抬高 FPR —— 证明升幅由**推理路径切换**（Modelfile system prompt / chat template / 采样差异）引入，**非量化损失**。
- 量化档之间几乎无梯度（Q4→f16 normalFPR 仅 0.0629→0.0686），进一步排除量化因素——若是量化损失，低位档应显著更差。
- promptInjectionObedience 在**两条路径都 FAIL**（TF 0.9197 / GGUF 0.9270，门槛 0.98），说明该缺口是合并模型固有，与引擎无关。

## 6. 部署建议

- **不推荐任何 GGUF 档进入生产/shadow 部署候选**：按锁定预算全部超 normalFPR 升幅，且 injectObedience 两路径均 FAIL。
- 若必须选一档做**离线/红队评测参考**（非部署），Q4_K_M 综合最优：延迟最低（1141ms vs f16 2478ms）、文件最小（2.4G）、JSON/schema 满分、recall 掉幅在预算内（0.9952）。选用时**必须**在任何引用中保留：normalFPR/hardNegFPR/injectObedience 三门 FAIL，且 FPR 升幅属推理路径而非量化。
- 部署前 v0.3 必须关闭：(a) ollama 推理路径 FPR 抬高的根因（system prompt vs chat template vs 采样，需消融）；(b) prompt injection 劫持率；(c) 长输入覆盖。

## 7. 未覆盖范围（本轮未做）

- **closed-set（n=1236）GGUF 评测未跑**：Task 10 用户口径为"全部在同一 test-independent 1750 上评测"，本轮仅跑 independent（门禁判定集）。占位协议曾列 closed-set 回归对照，本轮未执行——列为缺口，非本次判定所需。
- **FPR 抬高根因未做消融**：只经双路径对照定位到"是 ollama 推理路径效应"，未进一步定位到具体是 Modelfile system prompt、chat template 还是采样参数中的哪一项。需 v0.3 单独消融（改一项、固定其余、重测 FPR）。
- **显存峰值未采集**：GGUF 由 ollama 在 GPU 推理，`peakGpuMemoryGiB=null`（评测脚本未接 ollama 显存探针）；文件大小已作为体积参考列出。
- 检索确认：`grep -rn "quantizationDegradationBudget" ml/configs/` 仅 `aetherargus-v02-acceptance-gates.json:18` 一处定义基线，无其他预算配置覆盖本判定。

## 8. 复现锚点

- 评测脚本：`ml/evaluation/evaluate_ollama.py`（--inference-mode 记录量化档）+ `ml/evaluation/evaluate_model.py --mode score`
- 驱动：`ml/scripts/eval_v02_gguf_all.sh`（5 档循环，metrics 存在即跳过）
- 对比生成器：`ml/scripts/build_gguf_comparison.py`（本报告数据表由其生成，`python3 -m py_compile` 通过）
- 每档 metrics：`ml/reports/gguf-{f16,q8_0,q6_k,q5_k_m,q4_k_m}-independent-metrics.json`
- 机器生成原始对比：`ml/reports/gguf-quantization-comparison.md`
- BF16 基线：`ml/reports/merged-v02-independent-metrics.json`
- 门禁与预算：`ml/configs/aetherargus-v02-acceptance-gates.json`
- Modelfile：`ml/deployment/Modelfile.v02.detector`
- seed：`20260728`
