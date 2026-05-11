# Implementation Plan: Production Delivery Hardening

## Overview

本计划将设计文档中的两个交付目标拆解为可独立执行的编码任务：

1. **冷部署加固**：docker-compose 环境变量守卫、弱密钥检测扩展、SQLite 回退禁用、一键初始化脚本、健康检查时序优化
2. **真实数据完整性**：Stats 路由格式统一、fetchStats 死代码清理、Seed force 二次确认、日志接口认证

所有任务均使用 TypeScript（后端）和 Bash（脚本），与项目现有技术栈一致。测试框架为 Jest + supertest（后端）。

---

## Tasks

- [ ] 1. docker-compose.yml 环境变量守卫与 SQLite 回退默认值修复
  - [ ] 1.1 为 `ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 添加 `:?` 守卫语法
    - 在 `docker-compose.yml` backend `environment` 块中，将三个变量改为 `:?` 语法，附带明确的错误提示信息
    - 参考已有的 `JWT_SECRET`、`REDIS_PASSWORD` 守卫写法保持风格一致
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 1.2 将 `SQLITE_FALLBACK_ENABLED` 默认值从 `true` 改为 `false`
    - 修改 `docker-compose.yml` 中 `SQLITE_FALLBACK_ENABLED=${SQLITE_FALLBACK_ENABLED:-true}` 为 `:-false`
    - _Requirements: 3.1_

  - [ ] 1.3 更新 `.env.example` 为三个新守卫变量补充注释和占位符
    - 在 `.env.example` 中确认 `ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 已有注释说明（当前文件已有，核实格式并补充 compose 守卫说明）
    - _Requirements: 1.5_

  - [ ] 1.4 为 Compose 守卫编写单元测试（验证 `:?` 语法行为）
    - 在 `backend/src/__tests__/routes/` 下新建 `compose-guard.test.ts`
    - 通过解析 `docker-compose.yml` 文件内容，断言三个变量均包含 `:?` 语法
    - 断言 `SQLITE_FALLBACK_ENABLED` 默认值为 `false`
    - _Requirements: 1.1, 1.2, 1.3, 3.1_

- [ ] 2. runtime-env.ts 弱密钥检测扩展
  - [ ] 2.1 在生产模式检查块中为 `POSTGRES_PASSWORD`、`S3_SECRET_KEY`、`DEVICE_API_KEYS` 添加 WARNING 级别检测
    - 修改 `backend/src/bootstrap/runtime-env.ts` 中 `validateRuntimeEnvironment()` 的 `isProduction` 块
    - 新增一个 `assertWeakSecretWarning()` 辅助函数（或复用 `hasWeakValue()`），对三个字段调用，将告警推入 `warnings` 数组而非 `errors`
    - 确保 `POSTGRES_PASSWORD=AetherGuardPgShadow2026`、`S3_SECRET_KEY=AetherGuardArtifactSecret2026`、`DEVICE_API_KEYS=dev-device-key-2026` 均能被 `WEAK_VALUE_PATTERNS` 匹配
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ] 2.2 为 P1 属性编写 property-based 测试（环境变量完整性）
    - 在 `backend/src/__tests__/security/` 下新建 `runtime-env-pbt.test.ts`
    - **Property 1: 环境变量完整性**
    - 使用参数化测试枚举所有必要字段的缺失组合（`ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT`），对每种缺失情况断言 `validateRuntimeEnvironment()` 抛出错误
    - 设置 `NODE_ENV=production`，在每个测试用例中 `delete process.env[field]`，断言 `expect(() => validateRuntimeEnvironment()).toThrow()`
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [ ] 2.3 为 P2 属性编写 property-based 测试（弱密钥拒绝）
    - 在同一文件 `runtime-env-pbt.test.ts` 中追加
    - **Property 2: 弱密钥拒绝**
    - 枚举 `WEAK_VALUE_PATTERNS` 中所有已知弱值字符串（`change_me*`、`dev-device-key-2026`、`AetherGuardDeviceCommandSecret2026`、`AetherGuardArtifactSecret2026`、`AetherGuardPgShadow2026`），对每个弱值断言 `assertStrongSecret()` 将其加入 errors 数组
    - 同时断言强值（随机 32 字符字符串）不触发错误
    - **Validates: Requirements 2.1, 2.2**

- [ ] 3. backend/src/config/database.ts SQLite 回退行为加固
  - [ ] 3.1 在 `DatabaseManager.initAsync()` 中，当 `SQLITE_FALLBACK_ENABLED=false` 且 Postgres 不可用时抛出明确错误
    - 在 `initAsync()` 的 sql.js 初始化路径之前，检查 `process.env.SQLITE_FALLBACK_ENABLED`
    - 若值为 `'false'` 且 `DB_MODE=postgres`，则在 Postgres 连接失败时抛出 `Error('SQLite fallback is disabled. Postgres connection is required.')` 而非静默降级
    - 保留 `SQLITE_FALLBACK_ENABLED=true` 时的现有行为
    - _Requirements: 3.2, 3.3, 3.4_

  - [ ] 3.2 为 SQLite 回退行为编写单元测试
    - 在 `backend/src/__tests__/config/` 下新建 `database-fallback.test.ts`
    - 测试 `SQLITE_FALLBACK_ENABLED=false` 时 Postgres 不可用场景下抛出错误
    - 测试 `SQLITE_FALLBACK_ENABLED=true` 时正常降级到 SQLite
    - _Requirements: 3.2, 3.4_

- [ ] 4. 新增 deployment/production/setup-env.sh 初始化脚本
  - [ ] 4.1 创建 `deployment/production/setup-env.sh` 脚本
    - 检测工作目录根下 `.env` 是否存在；若存在，提示用户并询问是否覆盖（`read -p`），不静默覆盖
    - 若不存在或用户确认覆盖，从 `.env.example` 复制模板
    - 使用 `openssl rand -hex 32` 为 `JWT_SECRET`、`AUDIT_LOG_SECRET`、`DEVICE_COMMAND_SECRET`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 生成随机值并写入 `.env`（使用 `sed -i` 替换占位符）
    - 检测 `openssl` 不可用时输出错误信息并以非零状态码退出
    - 脚本末尾输出检查清单：已自动生成的字段 ✓，需手动填写的字段（`ADMIN_PASSWORD`、`POSTGRES_PASSWORD`、`S3_SECRET_KEY`）⚠
    - 脚本添加可执行权限（`chmod +x`）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 4.2 为 setup-env.sh 编写 Bash 单元测试（可选）
    - 在 `deployment/production/` 下新建 `setup-env.test.sh`，使用 `bash -c` 在临时目录中验证脚本行为
    - 测试：无 `.env` 时自动创建；已有 `.env` 时提示覆盖；`openssl` 不可用时退出码非零
    - _Requirements: 4.1, 4.4, 4.5_

- [ ] 5. docker-compose.yml 健康检查时序优化
  - [ ] 5.1 调整 backend 服务健康检查参数
    - 将 `start_period` 从 `60s` 改为 `90s`
    - 将 `interval` 从 `30s` 改为 `15s`
    - _Requirements: 5.1, 5.2_

  - [ ] 5.2 为健康检查参数编写验证测试
    - 在 `backend/src/__tests__/routes/` 下新建 `healthcheck-config.test.ts`
    - 解析 `docker-compose.yml` 文件，断言 backend healthcheck 的 `start_period` 为 `90s`，`interval` 为 `15s`
    - _Requirements: 5.1, 5.2_

- [ ] 6. Checkpoint — 确保所有测试通过
  - 运行 `cd backend && npm test`，确保所有测试通过，如有问题请向用户反馈。

- [ ] 7. stats.routes.ts 响应格式统一
  - [ ] 7.1 将 `GET /api/stats` 路由改用 `sendSuccess()` / `sendError()`
    - 修改 `backend/src/api/routes/stats.routes.ts`
    - 在文件顶部导入 `sendSuccess`、`sendError` from `../../core/http/api-response`
    - 将 `router.get('/')` 成功分支的 `res.json({...})` 替换为 `sendSuccess(res, {...})`
    - 将错误分支的 `res.json({...})` 替换为 `sendError(res, 500, { code: 'STATS_ERROR', message: err.message })`
    - _Requirements: 6.1, 6.2, 6.4_

  - [ ] 7.2 将 `GET /api/stats/badges` 路由改用 `sendSuccess()` / `sendError()`
    - 同文件，将 `router.get('/badges')` 的两个 `res.json({...})` 分别替换为 `sendSuccess` 和 `sendError`
    - _Requirements: 6.3, 6.4_

  - [ ] 7.3 为 P3 属性编写 property-based 测试（Stats 响应格式一致性）
    - 在 `backend/src/__tests__/routes/` 下新建 `stats-routes-pbt.test.ts`
    - **Property 3: Stats 响应格式一致性**
    - 使用 supertest 对 `GET /api/stats` 发起请求，断言响应体满足 `{ success: true, data: { ... }, error: null }` 结构
    - 枚举多种系统状态（空流量、有流量、有告警），断言 `success` 字段始终为 `true`
    - **Validates: Requirements 6.1, 6.4**

- [ ] 8. frontend/src/services/api.ts 删除 fetchStats 死代码
  - [ ] 8.1 删除 `fetchStats` 中的 demo jitter 死代码分支
    - 修改 `frontend/src/services/api.ts`
    - 找到 `fetchStats` 函数中 `if (isDemoModeActive() && data?.overview)` 整个条件块（约 10 行），完整删除
    - 保留函数开头的 `shouldUseDemoData()` 早返回分支（正确路径）
    - 确保删除后函数直接 `return data` 而不施加任何偏移
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ] 8.2 为 P4 属性编写 property-based 测试（Demo 数据隔离）
    - 在 `backend/src/__tests__/security/` 下新建 `app-mode-pbt.test.ts`
    - **Property 4: Demo 数据隔离**
    - 枚举 `APP_MODE=production` 与各种 `ENABLE_ATTACK_SIM`、`DEMO_AUTO_SEED` 组合（`true`/`false`/未设置），断言 `isDemoMode()` 始终返回 `false`，`isAttackSimulatorEnabled()` 始终返回 `false`，`isDemoAutoSeedEnabled()` 始终返回 `false`
    - 在每个测试用例中通过 `setAppMode('production')` 重置状态
    - **Validates: Requirements 7.2, 7.3**

- [ ] 9. seed.routes.ts 生产环境 force=true 二次确认与审计日志
  - [ ] 9.1 实现确认 token 生成与存储机制
    - 在 `backend/src/api/routes/seed.routes.ts` 中，在路由文件顶部添加一个内存 Map：`const pendingConfirmations = new Map<string, { expiresAt: number; userId: string; ip: string }>()`
    - 添加 `generateConfirmToken()` 辅助函数（使用 `crypto.randomBytes(16).toString('hex')`）
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 9.2 修改 `POST /api/seed/execute` 添加生产模式二次确认流程
    - 在 `seed.routes.ts` 的 `router.post('/execute')` 处理器中：
      - 当 `force=true` 且 `APP_MODE=production`（通过 `import { isDemoMode } from '../../config/app-mode'` 判断非 demo 即生产）时：
        - 若请求体不含 `confirmToken`：记录审计日志（操作者 userId、时间戳、客户端 IP），生成 token 存入 `pendingConfirmations`（TTL 60s），返回 HTTP 202 `{ requiresConfirmation: true, confirmToken, expiresIn: 60 }`
        - 若请求体含 `confirmToken`：查找 Map，若不存在或已过期返回 HTTP 403；若有效则继续执行 seed，执行后记录第二条审计日志（含操作结果）
    - 审计日志使用项目现有的 `logger.warn()` 记录，字段包含 `userId`、`timestamp`、`clientIp`、`action: 'seed.force'`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 9.3 为 P5 属性编写 property-based 测试（Seed force 操作可审计）
    - 在 `backend/src/__tests__/routes/` 下新建 `seed-routes-pbt.test.ts`
    - **Property 5: Seed force 操作可审计**
    - 使用 supertest 构造携带 `force=true` 的请求，枚举不同的 userId 和客户端 IP 组合
    - 断言每次请求均触发审计日志记录（通过 spy `logger.warn`），日志对象包含 `userId`、`clientIp` 字段
    - 断言响应包含 `requiresConfirmation: true` 和 `confirmToken`
    - **Validates: Requirements 8.4, 8.5**

- [ ] 10. logs.routes.ts 添加认证中间件与公开摘要端点
  - [ ] 10.1 为 `GET /api/logs` 添加 `authenticate` 中间件
    - 修改 `backend/src/api/routes/logs.routes.ts`
    - 在文件顶部导入 `authenticate` from `../../middleware/auth.middleware`
    - 在 `router.get('/', ...)` 之前添加 `router.use(authenticate)`，或直接在路由定义中插入中间件：`router.get('/', authenticate, (req, res) => {...})`
    - _Requirements: 9.1, 9.3_

  - [ ] 10.2 新增 `GET /api/logs/summary` 公开摘要端点
    - 在 `logs.routes.ts` 中，在 `authenticate` 中间件应用之前（或单独注册，不经过 authenticate）添加 `router.get('/summary', ...)` 路由
    - 该端点只返回聚合计数：`{ totalLogs, blockedCount, warnCount, criticalCount }`，不返回原始日志条目（无 IP、无 path、无 message 字段）
    - _Requirements: 9.4, 9.5_

  - [ ] 10.3 为 P6 属性编写 property-based 测试（日志接口访问控制）
    - 在 `backend/src/__tests__/routes/` 下新建 `logs-routes-pbt.test.ts`
    - **Property 6: 日志接口访问控制**
    - 使用 supertest 枚举多种未认证请求（无 cookie、无 Authorization header、伪造 header），断言每种情况下 `GET /api/logs` 均返回 HTTP 401
    - 断言 401 响应体不包含任何日志条目（`response.body` 不是数组，或为空）
    - 断言 `GET /api/logs/summary` 在未认证时返回 HTTP 200 且响应体只含聚合计数字段
    - **Validates: Requirements 9.1, 9.3**

- [ ] 11. Final Checkpoint — 确保所有测试通过
  - 运行 `cd backend && npm test`，确保所有测试通过，如有问题请向用户反馈。

---

## Notes

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 交付
- 每个任务均引用了具体的需求条款，确保可追溯性
- 属性测试（P1–P6）使用 Jest 参数化测试（`test.each`）模拟 property-based testing，无需引入额外 PBT 库
- `setup-env.sh` 脚本不属于 Node.js 代码，但属于可由编码 agent 创建的文件
- 任务 1、5 均修改 `docker-compose.yml`，已安排在不同 wave 中避免冲突
- 任务 7、10 均修改路由文件，已安排在不同 wave 中

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1", "3.1", "4.1", "7.1", "7.2", "8.1", "9.1", "10.1", "10.2"] },
    { "id": 1, "tasks": ["1.4", "2.2", "2.3", "3.2", "5.1", "9.2"] },
    { "id": 2, "tasks": ["4.2", "5.2", "7.3", "8.2", "9.3", "10.3"] }
  ]
}
```
