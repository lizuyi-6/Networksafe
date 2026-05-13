# Design: Production Delivery Hardening

## Overview

AetherGuard 是一个智能服务器安全防御平台，核心亮点是 ESP32 硬件物理确认门——即使服务器软件层完全沦陷，攻击者也无法在没有人肉身按下 ESP32 按钮的情况下触发高风险操作。

本设计文档覆盖两个交付目标：

1. **冷部署加固**：确保客户机执行 `docker-compose up` 后系统能正常启动，不因缺少环境变量而崩溃循环
2. **真实数据完整性**：确保生产环境 API 返回真实数据，消除 demo 数据泄漏风险和接口格式不一致问题

---

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    客户机 (Docker Host)                       │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Frontend │───▶│ Backend  │───▶│ Postgres │              │
│  │  (nginx) │    │ (Node.js)│    │  (主库)  │              │
│  └──────────┘    └────┬─────┘    └──────────┘              │
│                       │                                     │
│              ┌────────┼────────┐                            │
│              ▼        ▼        ▼                            │
│           Redis     MinIO   Fastpath                        │
│                    (S3)    (Rust)                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              启动验证层 (runtime-env.ts)              │   │
│  │  JWT_SECRET ✓  ADMIN_PASSWORD ✓  ENCRYPTION_KEY ✓   │   │
│  │  ENCRYPTION_SALT ✓  DEVICE_COMMAND_SECRET ✓         │   │
│  │  POSTGRES_PASSWORD (弱值检测) ✓  S3_SECRET_KEY ✓    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │ USB-TTL Serial (UART)
                           ▼
              ┌────────────────────────┐
              │   ESP32 物理确认门      │
              │  AG:REQ:* → 按钮确认   │
              │  AG:OK/* / AG:ERR/*    │
              └────────────────────────┘
```

---

## 方向一：冷部署加固

### 1.1 必要环境变量守卫

**问题**：`ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 未在 `docker-compose.yml` 中声明，客户机没有 `.env` 文件时后端 `process.exit(1)` 崩溃循环。

**方案**：在 `docker-compose.yml` 的 backend `environment` 块中为这三个变量添加 `:?` 语法守卫，使 compose 在启动前就快速失败并给出明确错误信息。

```yaml
# docker-compose.yml — backend environment 新增
- ADMIN_PASSWORD=${ADMIN_PASSWORD:?ADMIN_PASSWORD is required (min 12 chars)}
- ENCRYPTION_KEY=${ENCRYPTION_KEY:?ENCRYPTION_KEY is required (min 32 chars)}
- ENCRYPTION_SALT=${ENCRYPTION_SALT:?ENCRYPTION_SALT is required (min 16 chars)}
```

同步更新 `.env.example`，为这三个变量添加注释说明和占位符。

**影响范围**：`docker-compose.yml`、`.env.example`

---

### 1.2 弱默认密钥检测扩展

**问题**：`runtime-env.ts` 的 `WEAK_VALUE_PATTERNS` 已覆盖已知弱值，但 `assertStrongSecret()` 只被调用于部分字段，`POSTGRES_PASSWORD`、`S3_SECRET_KEY`、`DEVICE_API_KEYS` 使用已知默认值时不会报错。

**方案**：在 `validateRuntimeEnvironment()` 的生产模式检查块中，对以下字段追加 `assertStrongSecret()` 调用：

| 字段 | 最小长度 | 说明 |
|------|---------|------|
| `POSTGRES_PASSWORD` | 16 | Postgres 主库密码 |
| `S3_SECRET_KEY` | 16 | MinIO/S3 访问密钥 |
| `DEVICE_API_KEYS` | 20 | ESP32 设备 API 密钥 |

这些字段设为 warning 级别（不阻断启动），但在日志中明确标注安全风险，方便运维排查。

**影响范围**：`backend/src/bootstrap/runtime-env.ts`

---

### 1.3 禁用生产环境 SQLite 回退

**问题**：`docker-compose.yml` 中 `SQLITE_FALLBACK_ENABLED=${SQLITE_FALLBACK_ENABLED:-true}`，Postgres 断连时静默回退到内存 SQLite，数据丢失无告警。

**方案**：将 compose 中的默认值改为 `false`：

```yaml
- SQLITE_FALLBACK_ENABLED=${SQLITE_FALLBACK_ENABLED:-false}
```

同时在 `database.ts` 的 SQLite 回退逻辑中，当 `SQLITE_FALLBACK_ENABLED=false` 且 Postgres 不可用时，抛出明确错误而非静默降级。

**影响范围**：`docker-compose.yml`、`backend/src/config/database.ts`

---

### 1.4 一键部署初始化脚本

**问题**：客户机需要手动创建 `.env` 文件，容易遗漏必要字段。

**方案**：提供 `deployment/production/setup-env.sh` 脚本，自动：
1. 检测 `.env` 是否存在
2. 从 `.env.example` 复制模板
3. 用 `openssl rand` 生成强随机值填充 `JWT_SECRET`、`AUDIT_LOG_SECRET`、`DEVICE_COMMAND_SECRET`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT`
4. 提示用户手动设置 `ADMIN_PASSWORD`、`POSTGRES_PASSWORD`、`S3_SECRET_KEY`

脚本输出清晰的检查清单，告知哪些字段已自动生成、哪些需要手动填写。

**影响范围**：新增 `deployment/production/setup-env.sh`、更新 `deployment/production/README.md`（如存在）

---

### 1.5 健康检查时序优化

**问题**：后端 `start_period: 60s`，前端依赖 `backend: condition: service_healthy`，冷启动时前端可能在后端就绪前收到请求，返回 502。

**方案**：
- 将后端 `start_period` 从 60s 调整为 90s（给 Postgres schema 迁移更多时间）
- 将后端 `healthcheck.interval` 从 30s 调整为 15s（更快检测到就绪状态）
- 前端 nginx 配置增加 `proxy_connect_timeout` 和 `proxy_read_timeout`，在后端未就绪时返回友好的 503 页面而非空白 502

**影响范围**：`docker-compose.yml`、`deployment/nginx.conf`（或前端 `Dockerfile` 中的 nginx 配置）

---

## 方向二：真实数据完整性

### 2.1 Stats 路由响应格式统一

**问题**：`stats.routes.ts` 直接使用 `res.json()` 返回数据，绕过了项目规定的 `sendSuccess()` / `sendError()` 包装，违反 API 响应格式规范。

**方案**：将 `stats.routes.ts` 中的 `res.json({...})` 替换为 `sendSuccess(res, {...})`，错误分支替换为 `sendError(res, ...)`。

前端 `fetchStats` 已通过 `unwrapApiEnvelope()` 处理，兼容包装后的格式，无需修改前端。

**影响范围**：`backend/src/api/routes/stats.routes.ts`

---

### 2.2 修复 fetchStats demo jitter 死代码

**问题**：`frontend/src/services/api.ts` 中 `fetchStats` 的 demo jitter 检查 `data?.overview`，但后端（和 `getDemoStats()`）返回的是扁平对象（`{ totalRequests, blockedRequests, ... }`），`overview` 字段不存在，jitter 代码永远不执行。

**方案**：删除 `fetchStats` 中 `if (isDemoModeActive() && data?.overview)` 整个分支（死代码）。demo 模式下 `shouldUseDemoData()` 已在函数开头返回 `getDemoStats()`，不会走到这个分支；生产模式下不应有任何 demo jitter。

**影响范围**：`frontend/src/services/api.ts`

---

### 2.3 生产环境 seed force 绕过加固

**问题**：`POST /api/seed/execute` 接受 `{ force: true }` 参数，管理员可在生产环境强制写入 demo 数据，没有额外确认机制。

**方案**：在 `seed.routes.ts` 中，当 `force=true` 且当前为生产模式时：
1. 记录审计日志（操作者、时间、IP）
2. 在响应中返回 `requiresConfirmation: true` 和一个短期 token（TTL 60s）
3. 客户端需要在 60s 内携带该 token 再次调用才能真正执行

这样保留了 `force` 的紧急用途，同时增加了操作摩擦，防止误触发。

**影响范围**：`backend/src/api/routes/seed.routes.ts`

---

### 2.4 日志接口认证

**问题**：`GET /api/logs` 无认证中间件，返回 IP、攻击模式等敏感信息，公开可访问。

**方案**：在 `logs.routes.ts` 中添加 `authenticate` 中间件。对于仪表盘需要在未登录状态展示的摘要数据，提供单独的公开端点（如 `/api/logs/summary`），只返回聚合计数，不返回原始日志条目。

**影响范围**：`backend/src/api/routes/logs.routes.ts`

---

## 数据模型变更

本次修改不涉及数据库 schema 变更，所有改动集中在：
- 配置文件（`docker-compose.yml`、`.env.example`）
- 启动验证逻辑（`runtime-env.ts`）
- API 路由层（`stats.routes.ts`、`seed.routes.ts`、`logs.routes.ts`）
- 前端 API 客户端（`api.ts`）
- 新增部署脚本（`setup-env.sh`）

---

## 正确性属性（Property-Based Testing）

*属性是在系统所有有效执行中都应成立的特征或行为——本质上是关于系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。*

以下属性用于验证修改后系统的正确性：

### P1：环境变量完整性

对于任意缺少 `ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 之一的环境配置，`validateRuntimeEnvironment()` 必须抛出错误，不得返回成功报告。

**Validates: Requirements 1.1, 1.2, 1.3**

### P2：弱密钥拒绝

对于 `WEAK_VALUE_PATTERNS` 中任意已知弱值字符串，`assertStrongSecret()` 必须将其加入 errors 数组，不得静默通过。

**Validates: Requirements 2.1, 2.2**

### P3：Stats 响应格式一致性

对于任意系统状态下的 `GET /api/stats` 请求，响应体必须满足 `{ success: true, data: { totalRequests, blockedRequests, ... }, error: null }` 结构，`success` 字段必须存在且为 `true`。

**Validates: Requirements 6.1, 6.4**

### P4：Demo 数据隔离

当 `APP_MODE=production` 时，`isDemoMode()` 必须返回 `false`，`isAttackSimulatorEnabled()` 必须返回 `false`，`isDemoAutoSeedEnabled()` 必须返回 `false`。三者不受 `ENABLE_ATTACK_SIM` 或 `DEMO_AUTO_SEED` 环境变量影响。

**Validates: Requirements 7.2, 7.3**

### P5：Seed force 操作可审计

对于任意携带 `force=true` 的 seed 请求（无论操作者 ID、客户端 IP 如何变化），审计日志中必须存在对应记录，包含操作者 ID、时间戳、客户端 IP。

**Validates: Requirements 8.4, 8.5**

### P6：日志接口访问控制

对于任意未携带有效认证 cookie 的请求访问 `GET /api/logs`，无论请求来源 IP 或携带的其他 headers 如何，响应状态码必须为 401，不得返回任何日志条目。

**Validates: Requirements 9.1, 9.3**

---

## 交付检查清单

- [ ] `docker-compose up` 在无 `.env` 文件时给出明确错误，不崩溃循环
- [ ] `setup-env.sh` 能在 30 秒内完成初始化，生成所有必要密钥
- [ ] 生产模式下使用已知弱密钥时，启动日志中出现 WARNING
- [ ] `GET /api/stats` 响应包含 `success: true` 包装
- [ ] `GET /api/logs` 未认证时返回 401
- [ ] `POST /api/seed/execute` 携带 `force=true` 时触发二次确认流程
- [ ] 所有 P1–P6 属性测试通过
