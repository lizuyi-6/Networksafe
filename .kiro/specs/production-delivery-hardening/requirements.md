# Requirements Document

## Introduction

本需求文档基于 AetherGuard 生产交付加固设计文档，覆盖两个交付目标：

1. **冷部署加固**：确保客户机执行 `docker-compose up` 后系统能正常启动，不因缺少环境变量而崩溃循环，并提供一键初始化脚本降低运维门槛。
2. **真实数据完整性**：确保生产环境 API 返回真实数据，消除 demo 数据泄漏风险和接口格式不一致问题，同时加固高危操作的访问控制。

所有需求均可追溯至设计文档中的正确性属性 P1–P6。

---

## Glossary

- **Compose_Guard**：`docker-compose.yml` 中使用 `:?` 语法对环境变量进行的启动前校验机制
- **RuntimeEnv_Validator**：`backend/src/bootstrap/runtime-env.ts` 中的 `validateRuntimeEnvironment()` 函数，负责在服务启动时验证环境变量的完整性和强度
- **WEAK_VALUE_PATTERNS**：`runtime-env.ts` 中定义的已知弱密钥正则表达式集合
- **assertStrongSecret**：`runtime-env.ts` 中的辅助函数，验证单个密钥的长度和强度
- **DatabaseManager**：`backend/src/config/database.ts` 中的数据库管理器，支持 sql.js 和 better-sqlite3 双后端
- **SQLite_Fallback**：当 Postgres 不可用时降级到 SQLite 的机制，由 `SQLITE_FALLBACK_ENABLED` 环境变量控制
- **Stats_Router**：`backend/src/api/routes/stats.routes.ts` 中的统计数据路由处理器
- **ApiEnvelope**：项目规定的 API 响应格式，由 `backend/src/core/http/api-response.ts` 中的 `sendSuccess()` / `sendError()` 生成，结构为 `{ success, data, error, meta? }`
- **SeedManager**：`backend/src/database/seeds/seed-manager.ts` 中的种子数据管理器
- **Logs_Router**：`backend/src/api/routes/logs.routes.ts` 中的日志路由处理器
- **Setup_Script**：`deployment/production/setup-env.sh`，一键部署初始化脚本
- **AuditLog**：系统审计日志，记录高危操作的操作者、时间戳、客户端 IP

---

## Requirements

### Requirement 1: 必要环境变量启动前守卫

**User Story:** As a 运维工程师, I want docker-compose 在缺少必要环境变量时立即报错退出, so that 我能在容器启动循环前快速定位配置问题。

#### Acceptance Criteria

1. WHEN `docker-compose up` 执行时且 `ADMIN_PASSWORD` 未在环境中设置, THE Compose_Guard SHALL 在容器启动前输出包含变量名的错误信息、强制停止所有已启动的容器并终止 compose 进程
2. WHEN `docker-compose up` 执行时且 `ENCRYPTION_KEY` 未在环境中设置, THE Compose_Guard SHALL 在容器启动前输出包含变量名的错误信息、强制停止所有已启动的容器并终止 compose 进程
3. WHEN `docker-compose up` 执行时且 `ENCRYPTION_SALT` 未在环境中设置, THE Compose_Guard SHALL 在容器启动前输出包含变量名的错误信息、强制停止所有已启动的容器并终止 compose 进程
4. WHEN `ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 均已设置, THE Compose_Guard SHALL 允许 backend 容器正常启动
5. THE `.env.example` 文件 SHALL 为 `ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 提供注释说明和占位符值

---

### Requirement 2: 运行时弱密钥检测

**User Story:** As a 安全工程师, I want 系统在生产模式启动时检测并拒绝已知弱密钥, so that 运维人员不会因使用默认占位符值而暴露安全风险。

#### Acceptance Criteria

1. WHEN `NODE_ENV=production` 且 `ADMIN_PASSWORD` 的值匹配 `WEAK_VALUE_PATTERNS` 中任意模式, THE RuntimeEnv_Validator SHALL 将该字段加入 errors 数组并在启动时抛出错误
2. WHEN `NODE_ENV=production` 且 `ENCRYPTION_KEY` 的值匹配 `WEAK_VALUE_PATTERNS` 中任意模式, THE RuntimeEnv_Validator SHALL 将该字段加入 errors 数组并在启动时抛出错误
3. WHEN `NODE_ENV=production` 且 `POSTGRES_PASSWORD` 的值匹配 `WEAK_VALUE_PATTERNS` 中任意模式, THE RuntimeEnv_Validator SHALL 在启动日志中输出 WARNING 级别告警，包含字段名和风险说明
4. WHEN `NODE_ENV=production` 且 `S3_SECRET_KEY` 的值匹配 `WEAK_VALUE_PATTERNS` 中任意模式, THE RuntimeEnv_Validator SHALL 在启动日志中输出 WARNING 级别告警，包含字段名和风险说明
5. WHEN `NODE_ENV=production` 且 `DEVICE_API_KEYS` 的值匹配 `WEAK_VALUE_PATTERNS` 中任意模式, THE RuntimeEnv_Validator SHALL 在启动日志中输出 WARNING 级别告警，包含字段名和风险说明
6. WHEN 密钥值不匹配任何弱值模式且满足最小长度要求, THE RuntimeEnv_Validator SHALL 通过验证并继续启动流程

---

### Requirement 3: 生产环境禁用 SQLite 回退

**User Story:** As a 数据库管理员, I want 生产环境在 Postgres 不可用时明确报错而非静默降级到 SQLite, so that 数据丢失风险能被立即发现而不是被掩盖。

#### Acceptance Criteria

1. WHEN `SQLITE_FALLBACK_ENABLED` 未设置时, THE `docker-compose.yml` SHALL 将该变量默认值设为 `false`
2. WHEN `SQLITE_FALLBACK_ENABLED` 在运行时环境中完全缺失（未通过 docker-compose 或其他方式注入）, THE DatabaseManager SHALL 抛出异常并拒绝启动，而不是使用隐式默认值
3. WHEN `SQLITE_FALLBACK_ENABLED=false` 且 Postgres 连接不可用, THE DatabaseManager SHALL 抛出包含明确错误信息的异常，而不是静默降级到 SQLite
4. WHEN `SQLITE_FALLBACK_ENABLED=false` 且 Postgres 连接可用, THE DatabaseManager SHALL 优先使用 Postgres 连接，即使 SQLite 也可用
5. WHERE `SQLITE_FALLBACK_ENABLED=true` 且 Postgres 可用, THE DatabaseManager SHALL 优先使用 Postgres，仅在 Postgres 连接失败时才降级到 SQLite
6. WHERE `SQLITE_FALLBACK_ENABLED=true` 且 Postgres 不可用, THE DatabaseManager SHALL 降级到 SQLite 以支持开发和测试环境

---

### Requirement 4: 一键部署初始化脚本

**User Story:** As a 运维工程师, I want 一个初始化脚本自动生成强随机密钥并填充 `.env` 文件, so that 我能在 30 秒内完成部署前的密钥配置，不遗漏必要字段。

#### Acceptance Criteria

1. WHEN `setup-env.sh` 执行且 `.env` 文件不存在, THE Setup_Script SHALL 从 `.env.example` 复制模板并创建 `.env` 文件
2. WHEN `setup-env.sh` 执行, THE Setup_Script SHALL 使用 `openssl rand` 为 `JWT_SECRET`、`AUDIT_LOG_SECRET`、`DEVICE_COMMAND_SECRET`、`ENCRYPTION_KEY`、`ENCRYPTION_SALT` 生成长度不少于 32 字节的随机值
3. WHEN `setup-env.sh` 执行完成, THE Setup_Script SHALL 在终端输出检查清单，列明哪些字段已自动生成、哪些字段需要手动填写（`ADMIN_PASSWORD`、`POSTGRES_PASSWORD`、`S3_SECRET_KEY`）
4. WHEN `setup-env.sh` 执行且 `.env` 文件已存在, THE Setup_Script SHALL 阻塞所有后续操作，提示用户文件已存在并询问是否覆盖，不得静默覆盖已有配置；若用户拒绝覆盖，THE Setup_Script SHALL 以非零状态码退出以表明配置未完成
5. IF `openssl` 命令不可用, THEN THE Setup_Script SHALL 输出明确的错误信息并以非零状态码退出

---

### Requirement 5: 健康检查时序优化

**User Story:** As a 运维工程师, I want 冷启动时前端等待后端完全就绪后再接受请求, so that 用户不会在系统初始化期间收到 502 错误。

#### Acceptance Criteria

1. THE `docker-compose.yml` 中 backend 服务的 `healthcheck.start_period` SHALL 设置为不少于 90 秒，以覆盖 Postgres schema 迁移时间
2. THE `docker-compose.yml` 中 backend 服务的 `healthcheck.interval` SHALL 设置为不超过 15 秒，以加快就绪状态检测
3. WHEN backend 健康检查未通过时, THE frontend 服务 SHALL 保持等待状态，不接受外部请求
4. WHEN backend 未就绪时客户端发起请求, THE nginx SHALL 返回 503 状态码和友好的错误页面，而不是空白 502

---

### Requirement 6: Stats 路由响应格式统一

**User Story:** As a 前端开发者, I want `GET /api/stats` 的响应遵循项目统一的 ApiEnvelope 格式, so that 前端的 `unwrapApiEnvelope()` 能正确解析数据，不需要针对该接口做特殊处理。

#### Acceptance Criteria

1. WHEN `GET /api/stats` 请求成功时, THE Stats_Router SHALL 使用 `sendSuccess()` 返回响应，响应体包含 `success: true`、`data` 对象和 `error: null` 字段
2. WHEN `GET /api/stats` 请求处理过程中发生异常, THE Stats_Router SHALL 使用 `sendError()` 返回响应，响应体包含 `success: false`、`data: null` 和 `error` 对象
3. WHEN `GET /api/stats/badges` 请求成功时, THE Stats_Router SHALL 使用 `sendSuccess()` 返回响应，响应体包含 `success: true` 和 `data` 对象
4. THE Stats_Router SHALL 不直接调用 `res.json()` 返回裸对象，所有响应必须经过 `sendSuccess()` 或 `sendError()` 包装

---

### Requirement 7: 清理 fetchStats Demo Jitter 死代码

**User Story:** As a 后端开发者, I want 前端 `fetchStats` 函数中不存在永远不会执行的 demo jitter 代码, so that 生产环境的统计数据不受任何 demo 偏移逻辑的干扰。

#### Acceptance Criteria

1. THE `frontend/src/services/api.ts` 中的 `fetchStats` 函数 SHALL 不包含检查 `data?.overview` 字段的条件分支，但 SHALL 保留对后端响应结构变更的最小兼容性处理，以便未来 overview 数据重新可用时能正确处理
2. WHEN `APP_MODE=production` 且 `fetchStats` 被调用, THE `fetchStats` 函数 SHALL 直接返回后端响应数据，不对 `totalRequests` 或 `threatsBlocked` 字段施加任何偏移量；WHEN 后端返回的 `totalRequests` 和 `threatsBlocked` 均为零时, THE `fetchStats` 函数 SHALL 对响应数据进行完整性校验，确认字段存在且类型正确后再返回
3. WHEN `isDemoModeActive()` 返回 `false` 时, THE `fetchStats` 函数 SHALL 不调用 `applyDemoJitter()` 或修改 `demoState.statsOffset`

---

### Requirement 8: Seed Force 操作二次确认与审计

**User Story:** As a 安全审计员, I want 生产环境中携带 `force=true` 的 seed 操作触发二次确认流程并留下审计记录, so that 误操作写入 demo 数据的风险被有效控制，且每次操作均可追溯。

#### Acceptance Criteria

1. WHEN `POST /api/seed/execute` 携带 `force=true` 且当前为生产模式, THE SeedManager SHALL 返回 HTTP 202 响应，响应体包含 `requiresConfirmation: true` 和一个 TTL 为 60 秒的确认 token
2. WHEN 客户端在 60 秒内携带有效确认 token 再次调用 `POST /api/seed/execute`, THE SeedManager SHALL 执行 seed 操作
3. WHEN 确认 token 已过期（超过 60 秒）且客户端尝试使用该 token, THE SeedManager SHALL 返回 HTTP 403 响应，拒绝执行 seed 操作
4. WHEN `POST /api/seed/execute` 携带 `force=true` 且当前为生产模式, THE AuditLog SHALL 记录一条包含操作者 userId、时间戳、客户端 IP 的审计条目
5. WHEN `POST /api/seed/execute` 最终执行成功（携带有效确认 token）, THE AuditLog SHALL 记录一条包含操作者 userId、时间戳、客户端 IP 和操作结果的审计条目
6. WHEN `APP_MODE=demo` 且 `force=false`, THE SeedManager SHALL 保持现有行为，不触发二次确认流程

---

### Requirement 9: 日志接口访问控制

**User Story:** As a 安全工程师, I want `GET /api/logs` 接口要求有效认证才能访问, so that 包含 IP 地址和攻击模式的敏感日志数据不会被未认证的访问者获取。

#### Acceptance Criteria

1. WHEN 未携带有效认证 cookie 的请求访问 `GET /api/logs`, THE Logs_Router SHALL 返回 HTTP 401 状态码，响应体不包含任何日志条目
2. WHEN 携带有效认证 cookie 的请求访问 `GET /api/logs`, THE Logs_Router SHALL 返回日志数据
3. THE `backend/src/api/routes/logs.routes.ts` SHALL 在路由处理器之前应用 `authenticate` 中间件；IF `authenticate` 中间件未正确配置或加载失败, THE 服务器 SHALL 拒绝启动并输出包含中间件配置错误的明确错误信息
4. WHERE 仪表盘需要展示聚合摘要数据, THE Logs_Router SHALL 提供独立的 `GET /api/logs/summary` 端点，该端点要求有效认证，只返回聚合计数，不返回原始日志条目
5. WHEN 未携带有效认证 cookie 的请求访问 `GET /api/logs/summary`, THE Logs_Router SHALL 返回 HTTP 401 状态码，不返回任何摘要数据
