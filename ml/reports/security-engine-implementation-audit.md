# AetherArgus 安全判定引擎接入审计报告

日期：2026-07-28
分支：`agent/security-engine-integration`
范围：本报告只审计后端检测链、配置、日志、指标、测试与 AetherArgus 接入的最小侵入点；不涉及训练数据与模型迭代。

## 1. 现有检测链入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| HTTP 流量影子中间件 | `backend/src/middleware/api-traffic-shadow.middleware.ts:220` | 对每个非 OPTIONS/health/auth 请求调 `detectionPipelineService.evaluateRequest()`，verdict=`block` 且 `ruleFirstEnabled` 时直接 403；管道异常走 fail-closed 503。 |
| Agent 桥 | `backend/src/traffic-interceptor/integration/agent-bridge.ts:140` | agent 上报样本走 `evaluateRequest({channel:'agent'})`。 |
| 决策核心 | `backend/src/services/detection-pipeline.service.ts:1383` `evaluateRequest()` | 规则评估 → 启发式 → 可选 AI 主判定/阻断讨论/异步复核 → 写 `sec_detection_events`。 |
| 规则引擎 | `backend/src/services/detection-engine.ts` | `evaluateDetectionRules`（:579）+ `assessDetectionHeuristics`（:639），0% 误报硬约束。 |
| AI 主判定 | `detectionPipelineService.setAiAnalyzer()`（`backend/src/api/routes/ai-system.routes.ts:412` 接线） | 走多 Agent 七层决策（`ai-agents/`），不是 AetherArgus 协议。 |

## 2. 现有 DetectionRequest 类型

`backend/src/services/detection-engine.ts:38`：`tenantId / channel / requestId / timestamp / sourceIp / method / path / decodedPath / query / decodedQuery / parsedQuery / headers / body / normalizedBody / parsedBody / userAgent / evidence / protocol / rawPayload / metadata / existingSignals?`。

与 AetherArgus `DetectionInput`（`ml/schemas/detection-input.schema.json`）的映射：

| DetectionInput 字段 | 来源 |
| --- | --- |
| method / path / query / headers / body | DetectionRequest 同名字段（需大小写与长度归一化） |
| sourceContext | 由 request.metadata + 流量统计拼装（requestsLastMinute / distinctPathsLastMinute / recentFailureCount 必填） |
| ruleSignals | `evaluateDetectionRules` 产生的 signals（ruleId/score/field/description） |

注意 schema 的 `sourceContext.additionalProperties=false`，白名单之外字段会被拒，engine 侧需做白名单过滤。

## 3. 现有规则判定结构

`DetectionDecision`（`detection-pipeline.service.ts:94`）：`verdict('allow'|'block'|'monitor') / matchedRuleIds / riskScore / escalatedToAI / decisionSource / signals / attackFamily / primaryAiResult / aiResult / blockingDiscussion...`。正式 verdict 只能由该链产生——AetherArgus 影子输出**绝不回写** `verdict` 或 `signals`。

## 4. 现有日志框架

`backend/src/utils/logger.ts`：单例 Logger，debug/info/warn/error，context 自动过 `log-sanitizer.ts`（RISK-003 修复）。环境变量 `LOG_LEVEL`、`DISABLE_LOG_SANITIZATION`。安全检测引擎复用该 logger；敏感字段（cookie/authorization/token/password/secret/key）由 sanitizer 处理，但** telemetry 事件本身不落 raw body/headers**，只落指纹与长度，双保险。

## 5. 现有配置系统

两套并存：
- `backend/src/config/`（app-mode / enterprise-runtime / platform-runtime / types），env 直读。
- `platformConfigService`（`backend/src/services/platform-config.service.ts`）per-tenant DB 配置（DetectionPipelineSettings 等）。

AetherArgus 引擎属进程级基础设施，采用 env 直读（`SECURITY_DETECTION_*`），缺省 `disabled`，不走 per-tenant 配置。

## 6. 现有指标系统

`backend/src/observability/metrics.ts`：零依赖 Prometheus 文本格式注册表，`incCounter(name, labels)` / `observeHistogram(name, value, labels)` / `render()`。单例 default export。新增 `security_detection_*` 指标直接挂该注册表；标签只用 provider/model/mode/verdict/error_code，**禁用 requestId/path/用户 ID**（高基数）。

## 7. 现有测试框架

Jest + ts-jest，`backend/jest.config.js`，测试脚本必须走 `npm run test:all`（4 shard）或 `npx jest <path>`（`npm test` 单进程 OOM）。env 由 cross-env 注入（JWT_SECRET/AUDIT_LOG_SECRET/DISABLE_REDIS）。sql.js 内存库隔离。

## 8. 既有 AetherArgus 工件（上一阶段遗留，未提交）

- `backend/src/ai/security-detection-engine.ts`：单文件 engine，内置 input/output JSON Schema 常量（与 `ml/schemas/` 手工同步）、Ajv 校验、严格 JSON.parse、fail-safe `unknown`。缺：provider 抽象、超时/重试、归一化/截断、telemetry、影子接入、配置开关。
- `backend/src/__tests__/ai/security-detection-engine.test.ts`：5 用例（合法输出、Markdown 包裹→unknown、额外字段→unknown、调用失败→unknown、输入非法→不调用模型）。
- `backend/package.json`：已新增 `ajv ^8.20.0`（lock 已更新）。
- `ml/schemas/detection-{input,output}.schema.json`：冻结契约。
- `ml/deployment/Modelfile`：含身份问答例外（"你是谁"→自然语言），**生产 detector 不允许**，需拆分 detector/demo 两份。

本阶段在其上重构为 `backend/src/ai/security-detection/` 目录结构，保留已有测试语义并扩展。

## 9. 最小侵入接入点

选择：`api-traffic-shadow.middleware.ts` 在 `evaluateRequest` 返回后、`next()` 前，调用 `securityDetectionShadowService.submit(req, decision, requestSnapshot)`。该服务内部：

1. 配置 `disabled` → 零调用直接返回。
2. 采样率判定 + 有界队列（默认 256）+ 并发上限（默认 2）。
3. 队列满 → `security_detection_dropped_total` 计数并丢弃。
4. worker 异步执行 engine.detect()，结果只写 telemetry/分歧记录，**不回写 req/detectionDecision**。
5. 永不 throw 到中间件（外层 try/catch + Promise 不 await）。

理由：中间件已是"影子"语义且拥有完整归一化后的 DetectionRequest 与正式 decision，是构建 DetectionInput（含 ruleSignals）成本最低的位置；agent-bridge 通道后续可用同一 service 扩展，本阶段只接 http_api 通道。

不选 `detection-pipeline.service.ts` 内部：避免在正式决策函数内引入任何异步分支与条件判断，降低破坏现有控制流的风险。

## 10. 不能被破坏的安全控制流

以下路径本次**一行不改**：

- `backend/src/services/final-defense.service.ts`（policyDigest 端到端绑定）
- `backend/src/services/hardware-authorization.service.ts`（monotonic counter / grant 验签）
- `backend/src/services/device-control.service.ts`（hardwareContext 强制 + ack 逐字段 ===）
- `backend/src/companion/gateway-daemon.ts`、`serial-device-companion.ts`（fail-closed 断桥 / interlock）
- `backend/src/security/`（final-defense-policy、hardware-grant）
- `detection-pipeline.service.ts` 的 verdict 产生逻辑（影子输出不回写）
- `api-traffic-shadow.middleware.ts` 的 block/fail-closed 分支语义（只追加 submit 调用，不改判定）

引擎硬性约束（测试断言）：

- 解析/校验/超时/provider 离线/非法枚举 → 一律 `verdict:'unknown'`，绝不 `safe`。
- `recommendedAction` 只是记录，不触发任何执行（risk-fusion `executable:false`）。
- 不调 Shell、不改防火墙、不碰硬件授权链。
- 默认 `SECURITY_DETECTION_ENGINE_ENABLED` 缺失/非 true → `disabled`。
