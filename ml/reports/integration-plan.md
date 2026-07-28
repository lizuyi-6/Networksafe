# AetherGuard 安全判定模型接入方案（阶段 13）

生成时间：`2026-07-28`
状态：**设计文档，本次不替换生产路由**。配套实现代码与测试待训练验收后按本方案落地。

## 1. 现状：两个互不相关的 AI 表面

| 现有模块 | 协议 | 用途 | 是否本任务目标 |
| --- | --- | --- | --- |
| `backend/src/scanner/ai-engine.ts`（`AIEngine`） | `AIAnalysisRequest`/`AIAnalysisResponse`（`diagnosis.rootCause` + `solutions[].command`） | **运维诊断**：分析服务器问题、生成修复命令 | ❌ 不是 |
| `backend/src/ai-agents/models/model-router.ts`（`ModelRouter`） | `ModelRequest`/`ModelResponse`，L6 异构模型协作 | 把七层 agent 管线的推理路由到本地 Ollama（默认 `llama3:8b`）或云端 | ❌ 不是 |
| **本任务新增** `backend/src/ai/security-detection-engine.ts`（`SecurityDetectionEngine`） | **Detection Input → Detection Output**（`ml/schemas/`） | **安全流量判定**：单条 HTTP 请求 → 严格 JSON 判定 | ✅ |

**关键结论**：现有 `AIEngine` 是"运维诊断"协议，与"安全判定"协议**不是同一个输出契约**。本方案**不改动 `AIEngine`、不替换 `model-router` 生产路由**，而是新增一个独立的安全判定引擎，经特性开关渐进接入。

## 2. 新引擎契约（与训练/评估完全一致）

输入 / 输出严格遵循 `ml/schemas/detection-input.schema.json` 与 `ml/schemas/detection-output.schema.json`，与 QLoRA 训练样本、评估脚本用的是**同一套 Schema**（`ml/scripts/detection_contract.py`）。

```text
DetectionInput  = { method, path, query, headers, body, sourceContext, ruleSignals }
DetectionOutput  = { verdict, confidence, attackFamily, severity, reasoning, evidence[], recommendedAction }
verdict          ∈ {safe, suspicious, malicious, unknown}
recommendedAction∈ {allow, monitor, challenge, block}
```

## 3. SecurityDetectionEngine 设计要点

`backend/src/ai/security-detection-engine.ts`（新增，不破坏现有代码）：

1. **发送标准 Detection Input**：把规则引擎产出的 `DetectionRequest` 归一化为 Schema 输入（method/path/query/headers/body + sourceContext + ruleSignals）。
2. **接收标准 Detection Output**：调用本地 LoRA 模型（两种部署形态，见 §5），拿到 assistant 文本。
3. **JSON Schema 强校验**：用 `detection-output.schema.json` 校验；任何额外字段、枚举越界、confidence 越界、evidence 非数组一律判失败。
4. **解析失败 → `unknown`，绝不 → `safe`**：与评估脚本 `fallback_unknown_output` 同语义（fail-safe）。`unknown` + `monitor` 是底线，不得因模型输出不规范而放行。
5. **不执行高风险操作**：引擎只返回判定；`block`/`challenge` 等动作仍由现有规则引擎 + 硬件安全门（Final Defense / Root-Resistant Gateway）强制。引擎本身无副作用。
6. **保留规则引擎与硬件闸门**：组合策略 = 规则护栏 + 模型判定（与 `evaluate_model.py` 的 `combine_predictions` 一致）：规则判 `malicious` 直接 `block`；模型输出无效直接 `unknown`；规则 `suspicious` 且模型 `safe` 时取规则的 `monitor`。

## 4. 推理后端抽象（本地 LoRA / Ollama 二选一）

```text
SecurityDetectionEngine
 ├── provider: "local-lora"   → transformers + peft 加载 ml/output/aetherguard-qwen-lora（或 merged）
 └── provider: "ollama"       → HTTP 调本机 Ollama（模型名 aetherguard-security，GGUF Q4_K_M）
```

- `local-lora`：精度最高（bf16 + LoRA），适合控制面同机部署、有 GPU 时。
- `ollama`：CPU/边缘部署友好，经 `ml/deployment/Modelfile` 固定低温度 + 系统提示词 + 停止标记。
- 两者用**相同的 system prompt**（`detection_contract.SYSTEM_PROMPT`）与 `do_sample=false`/`temperature=0`，保证确定性。

## 5. 部署形态

| 形态 | 模型来源 | 位置 |
| --- | --- | --- |
| GPU 控制面同机 | `ml/output/aetherguard-qwen-merged/`（合并模型）或 LoRA adapter + 基座 | transformers 直接加载 |
| CPU / 边缘 | `aetherguard-security`（GGUF Q4_K_M） | Ollama `localhost:11434` |

## 6. 渐进接入（特性开关，不替换生产）

1. 新增配置 `SECURITY_DETECTION_ENGINE_ENABLED`（默认 `false`）。
2. 在 `detection-pipeline.service.ts` 的 AI 升级分支后，**并行**调用 `SecurityDetectionEngine`（影子模式，仅记录，不影响线上判定），收集判定与延迟。
3. 当影子模式的 JSON 合法率、verdict 准确率达到验收线（见 §7）后，再切换为**组合策略**（规则护栏 + 模型）生效。
4. 全程不绕过规则引擎与硬件授权链（`final-defense` / `hardware-authorization` / `device-control` / `companion` 均不动）。

## 7. 验收线（与评估指标对齐）

接入前需在本机测试集上达到（参考 `ml/reports/baseline-vs-lora.md`）：

- JSON 语法成功率 ≥ 0.99（LoRA 后应接近 1.0；基座模型通常很低）。
- Schema 合法率 ≥ 0.99。
- 正常请求误报率 ≤ 现有规则引擎水平。
- 恶意请求 recall ≥ 现有规则引擎水平。
- 单条推理 p95 延迟符合部署形态预算（GPU < 数百 ms；Ollama 视量化档位）。

## 8. 与本项目安全不变量的关系

- 本引擎**不触碰** `policyDigest` / monotonic counter / interlock / grant 签名链——那些是 Final Defense 与硬件闸门的职责。
- 引擎的 `recommendedAction` 是**建议**，最终 `block`/断桥由硬件强制（见 CLAUDE.md「安全控制流不变量」）。
- 引擎解析失败返回 `unknown`，与项目"不确定就 fail-closed"原则一致；绝不把解析失败当 `safe`。

## 9. 本次交付物边界

本次仅产出本设计文档 + `ml/` 下完整的训练/评估/导出产物。**不**在本次直接改 `backend/src/` 生产代码或替换 `model-router`，避免未充分测试即影响线上判定路径。落地实现（`security-detection-engine.ts` + 单测 + 特性开关接线）作为后续独立 PR，以本方案 + 评估报告为验收依据。
