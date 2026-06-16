# Routes DB 直接访问清点（Roadmap）

> Date: 2026-06-05
> Sprint: Sprint 2 · 路由 DB 访问清点
> 相关 ADR: `docs/adr/2026-03-12-module-boundaries-bootstrap-core-modules-integrations.md`
> 相关规约: 项目 `CLAUDE.md`（Database Access Rules / API Response Format）

## 0. TL;DR — 调研结论（重要）

| 维度 | 结果 |
|---|---|
| `backend/src/api/routes/*.ts` 文件总数 | **28** |
| 含直接 DB 访问的 routes（`.prepare()` / `db.exec()` / `getDatabase()`） | **0** |
| `scripts/guards/check-route-db-access.mjs` 是否漏检 | **没有漏检**。routes 实际无违规，guard 正确返回绿色 |
| 28 个 routes 文件的 `.get(` / `.run(` / `.all(` 匹配 | **全部为 HTTP 路由声明（`router.get(...)`）** 或 **Map 操作（`devices.get(...)`）** 或 **service 方法（`auditLogger.getLogs(...)`）**——**不是** DB 调用 |
| 模块文件夹（`backend/src/modules/**`） | 共有 9 个 `*.repository.ts`，**这是直接 DB 访问的合法位置**（ADR 明确允许） |

**结论**：Sprint 2 任务的前提（"28 个 routes 文件中很多仍然直接调用 `.prepare()` / `.run()` / `.all()` / `.get()`"）**不成立**。`api/routes/` 已经完成 service / repository 化迁移。当前实际风险点是另外两类"软违规"，详见 §4。

---

## 1. 总览

- `api/routes/` 总数：**28**
- 含直接 DB 调用（`getDatabase()` / `.prepare(` / `db.exec(`）：**0**
- 严重度分布：
  - 🔴 P0（写操作、routes 内）：**0**
  - 🟡 P1（复杂读、routes 内）：**0**
  - 🟢 P2（简单读、routes 内）：**0**
  - 🟠 "软违规"（setter 暴露、view shim 兼容层）：**3 文件**（详见 §4）
- 额外 `routes` 文件（不在 `api/routes/` 下）：
  - `backend/src/modules/announcements/announcements.routes.ts`：**1 个**，同样已迁到 repository

### 1.1 实际数据访问分层（已就位）

| 层 | 路径 | 职责 | 直接 DB? |
|---|---|---|---|
| 路由层 | `backend/src/api/routes/*.ts` | HTTP 收发、参数校验、调用 service / repository | **否** |
| 业务服务层 | `backend/src/services/*.service.ts` | 业务逻辑编排（`securityOperationsService`、`scannerTaskService`、`finalDefenseService` 等） | 否（通过 repository） |
| 仓储层 | `backend/src/modules/*/*.repository.ts` | 持久化、`getDatabase().prepare(...)` | **是**（合规） |
| 启动/迁移层 | `backend/src/bootstrap/persistence.ts` | `ensureSchema()` 入口 | 是（合规） |
| 控制器层 | `backend/src/api/controllers/*.controller.ts` | 把 service / repository 装配给路由 | 否 |

---

## 2. 现有 guard 的盲点

文件：`scripts/guards/check-route-db-access.mjs`（38 行）

### 2.1 Guard 实际检测的内容

```js
const disallowedPatterns = [
  /\bgetDatabase\s*\(/,   // 匹配 getDatabase(
  /\.prepare\s*\(/,        // 匹配 .prepare(
  /\bdb\.exec\s*\(/        // 匹配 db.exec(
];

for (const entry of fs.readdirSync(routesRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
  // ... file-level scan, no per-line breakdown
}
```

### 2.2 Guard 没有漏报，因为它**已经匹配了所有应该匹配的**

- 28 个 routes 文件中没有任何一个出现 `getDatabase(`、`db.exec(`、或带 SQL 的 `.prepare(`。
- 因此 guard 报告"No direct route-level database access found outside the migration allowlist"是**正确**的。

### 2.3 Guard 的真实盲点（如果将来 routes 出现新违规，guard 仍然会漏报的情形）

| # | 盲点 | 复现示例 | 修复建议 |
|---|---|---|---|
| 1 | **不检查 `db.run(` / `db.all(` / `db.get(`**（prepared statement 的执行方法） | `const s = getDatabase().prepare(...); s.run(...)` 会被 `.prepare(` 命中；但若有人把 statement 注入成模块级变量并跨文件复用，guard 看不到 `s.run(` | 在 `disallowedPatterns` 增加 `\.\b(run\|all\|get)\b\s*\(` 仅在 `routes` 范围内（注意要排除 `router.get(/.post(` 这类 HTTP） |
| 2 | **不检查 raw SQL 字符串字面量**（如 `'SELECT ...'` / `'INSERT INTO ...'`） | `const SQL = 'SELECT * FROM users';` | 在 routes 范围内搜索 `/(SELECT\|INSERT\|UPDATE\|DELETE\|REPLACE)\b/i` 字符串字面量 |
| 3 | **不检查 `import` 自 `database` / `seeds` 以外的位置** | `import db from '../../services/some-service'` 实际是从 `database` 重新导出 | 增加 AST 级别 import 解析，标记从 `config/database` 或 `database/` 子目录导入的 symbol |
| 4 | **只扫描顶层 `backend/src/api/routes/`**，不递归 `sub-routes/` 也不扫 `modules/*/routes/` | `backend/src/modules/announcements/announcements.routes.ts` 不在扫描范围 | 在 `routesRoot` 上叠加 `backend/src/modules/**/routes.ts`，并去掉"migration allowlist" |
| 5 | **白名单为空**（`transitionalAllowlist = new Set([])`），但 routes 之外的 `*.test.ts` / `*.spec.ts` 不在扫描范围时——guard 不会因测试文件存在而误报 | （当前 routes/ 下没有 `.test.ts`，无影响） | 加一个显式 `if (entry.name.endsWith('.test.ts')) continue;` 防御未来 |
| 6 | **不输出**行号 / 文件具体位置 | 违规时只输出 `backend/src/api/routes/xxx.routes.ts` | 把 file-level scan 改成 line-level，输出 `file:line: <matched code>` |
| 7 | **不检查 typed repositories 的 .run 包装**（如 `repository.insert(payload)` 内部用 `prepare`） | routes 已迁到 service，service 调用 repository——这是合规的；但 guard 完全无法察觉"service 内部仍用 `getDatabase`" | 配套添加 service 层白名单 + repository 层抽样规则 |

**总结**：guard 在**当前仓库状态**下行为正确；它的盲点主要是**面向未来的鲁棒性**问题，而不是"漏检了 28 个文件的违规"。

---

## 3. 详细清单（按文件）

> 所有 28 个 `backend/src/api/routes/*.routes.ts` 文件**均无直接 DB 访问**。下表给出"业务入口数"和"对外依赖的服务/repo"，作为后续如果需要做 service 边界清理时的依据。

| # | 文件 | 入口数 | 主要依赖 service / repository | 直接 DB? |
|---|---|---|---|---|
| 1 | `admin.routes.ts` | 24 | `AdminController`, `tenantOversightService`, `auditSegmentService`, `benchmarkService`, `deviceControlService`, `hardwareAuthorizationService`, `admin.repository` | ❌ |
| 2 | `agent-management.routes.ts` | 3 | `agent-system.service`, `securityOperationsService` | ❌ |
| 3 | `agent-onboarding.routes.ts` | 3 | `agent-onboarding.service`, `securityOperationsService` | ❌ |
| 4 | `agents.routes.ts` | 6 | `agent-system.service`, `scannerTaskService`, `commandDispatcherService`, `securityOperationsService` | ❌ |
| 5 | `ai-endpoints.routes.ts` | 4 | `aiEndpointStoreService` | ❌ |
| 6 | `ai-system.routes.ts` | 3 | `ai-system.service`, `commandDispatcherService` | ❌ |
| 7 | `alerts.routes.ts` | 2 | `securityOperationsService` | ❌ |
| 8 | `attack.routes.ts` | 4 | `agent-system.service`, `traffic-stats.service`, `securityOperationsService` | ❌ |
| 9 | `auth.routes.ts` | 4 | `auth-user.repository`, `authSecurityService`, `redis.service`, `oidcAuthService` | ❌ |
| 10 | `config.routes.ts` | 2 | `platformConfigService` | ❌ |
| 11 | `dashboard.routes.ts` | 1 | `detectionPipelineService` | ❌ |
| 12 | `deployments.routes.ts` | 3 | `commandDispatcherService`, `deployment-profile.repository` | ❌ |
| 13 | `devices.routes.ts` | 18 | `securityOperationsService`, `commandDispatcherService` + 内存 Map（`devices`/`deviceEvents`/`deviceConfigs`/`deviceCommands`） | ❌（业务态用 Map） |
| 14 | `enterprise-helper.routes.ts` | 1 | `serial-deployer-protocol` helpers (legacy ESP32 USB-TTL protocol, archived 2026-06-13; Gateway Appliance uses newline-JSON) | ❌ |
| 15 | `final-defense.routes.ts` | 1 | `finalDefenseService` | ❌ |
| 16 | `fix-history.routes.ts` | 2 | `scanner-task.service`, `scanner-route.repository` | ❌ |
| 17 | `hardware-authorization.routes.ts` | 5 | `commandDispatcherService`, `hardwareAuthorizationService`, `deploymentRunService` | ❌ |
| 18 | `investigation.routes.ts` | 5 | `InvestigationController` | ❌ |
| 19 | `logs.routes.ts` | 3 | `traffic-stats.service`, `log-state.service`, `securityOperationsService` | ❌ |
| 20 | `pipeline.routes.ts` | 2 | `pipeline-diagnostics.service`（来自 `modules/pipeline/`） | ❌ |
| 21 | `rules.routes.ts` | 4 | `detectionPipelineService`, `agent-system.service` | ❌ |
| 22 | `scanner.routes.ts` | 6 | `scannerTaskService`, `securityOperationsService`, `scanner-route.repository` | ❌ |
| 23 | `seed.routes.ts` | 2 | `SeedManager`（来自 `database/seeds/`） | ❌（用 Manager 包装） |
| 24 | `sites.routes.ts` | 2 | `site.repository`（来自 `modules/sites/`），`securityOperationsService` | ❌ |
| 25 | `smart-fix.routes.ts` | 2 | `smart-fix.service` | ❌ |
| 26 | `stats.routes.ts` | 3 | `traffic-stats.service`, `agent-system.service`, `alert-state.service`, `device-registry.service`, `securityOperationsService`, `detectionPipelineService` | ❌ |
| 27 | `system.routes.ts` | 1 | `app-mode` config, `runtime-capabilities`, `enterprise-runtime` | ❌ |
| 28 | `traffic.routes.ts` | 5 | `traffic-stats.service`, `agent-system.service`, `securityOperationsService` | ❌ |
| 29 | `backend/src/modules/announcements/announcements.routes.ts` | 6 | `announcements.repository`（来自同目录） | ❌ |

> "入口数" = 路由中 `router.<method>(` 出现的次数。包含所有 HTTP 方法（GET/POST/PUT/DELETE/PATCH）和 `router.use(...)` 挂载点不计入。

### 3.1 完整 grep 验证记录

执行（仅调研，未跑任何工具）：

```bash
# 模式 1：DB 关键字
grep -rE 'getDatabase\s*\(|db\.exec\s*\(|\.prepare\s*\(' backend/src/api/routes/*.ts
# → 0 行匹配

# 模式 2：statement 执行方法
grep -rE '\.run\s*\(|\.all\s*\(|\.get\s*\(' backend/src/api/routes/*.ts
# → 仅匹配 HTTP 路由声明（router.get/post/put/delete）和 Map.get/Service.method.get

# 模式 3：SQL 关键字字符串
grep -rE 'SELECT|INSERT INTO|UPDATE |DELETE FROM' backend/src/api/routes/*.ts
# → 仅 attack.routes.ts 命中（payload 字符串，非 SQL）

# 模式 4：database import
grep -rE "^import.*from.*database" backend/src/api/routes/*.ts
# → 仅 seed.routes.ts 命中（用 SeedManager 包装，非裸 SQL）
```

> 详细证据：见 `X:\repos\Networksafe\backend\src\api\routes\` 下 28 个文件，逐一验证未发现 `getDatabase()` / `db.prepare()` / `db.exec()` 调用。

---

## 4. "软违规"清点（不直接违反 ADR，但有代码味道）

> 这才是 Sprint 2 真正需要关注的部分。

### 4.1 🔴 P0 — 路由层导出 setter，将数据库实例从 bootstrap 注入

| 文件 | 行号 | 调用 | 严重度 | 建议迁移到 |
|---|---|---|---|---|
| `backend/src/api/routes/sites.routes.ts` | 23-25 | `export function setDatabase(db: any \| null): void { setSiteRepositoryDatabase(db); }` | 🔴 P0 | 移除。`setSiteRepositoryDatabase` 应在 `bootstrap/persistence.ts` 启动时调用一次，**而不是从路由模块导出**。当前这是 routes 反向耦合到 bootstrap 的反向依赖，违反 ADR 中"routes shrink toward transport concerns" |
| `backend/src/api/routes/agents.routes.ts` | 42-45 | `export function setAgentGateway(gateway: any): void { agentGateway = gateway; commandDispatcherService.setAgentGateway(gateway); }` | 🟡 P1 | 改为从 `bootstrap/control-plane-app.ts` 在挂载 router 之前注入，路由层只读。`agentGateway` 状态应通过 service 暴露，避免在 routes 里存全局可变状态 |
| `backend/src/api/routes/ai-system.routes.ts` | 277 | `export const setAgentGateway = (gateway: any) => { ... }` | 🟡 P1 | 同上 |

### 4.2 🟡 P1 — `*View` 兼容 shim：业务路由在做向后兼容判断

`router` 文件中多处出现以下模式：

```ts
const service = someService as typeof someService & {
  getTaskView?: (...) => Promise<...>;
};
if (typeof service.getTaskView === 'function') {
  return await service.getTaskView(...);
}
return service.getTask(...);
```

| 文件 | 行 | 严重度 | 备注 |
|---|---|---|---|
| `backend/src/api/routes/admin.routes.ts` | 93-101, 103-111, 113-123 | 🟡 P1 | `auditLogger.getLogsView` / `tenantOversightService.*View` 多处 shim |
| `backend/src/api/routes/scanner.routes.ts` | 26-48 | 🟡 P1 | `scannerTaskService.getHistoryView` / `getTaskView` / `getTaskResultsView` |
| `backend/src/api/routes/fix-history.routes.ts` | 12-16, 48-61 | 🟡 P1 | `scannerTaskService.getHistoryView` 等 |

**风险**：
- `*View` 分支（旧 SQLite 视图 vs 新服务返回）逻辑跑在 routes 层，导致 routes 知道 DB 形态的差异。
- 增加了 routes 的耦合面，一旦 `*View` 函数被移除或重命名，路由会静默退化。
- 违反 ADR "Route handlers can shrink toward transport concerns instead of owning storage bootstrap"。

**建议**：在 service 层完成 `View` 适配（service 根据 DB 模式自动选实现），routes 只调一个方法。

### 4.3 🟢 P2 — 路由层做"业务态 + 配置"混合

| 文件 | 行 | 模式 | 备注 |
|---|---|---|---|
| `backend/src/api/routes/devices.routes.ts` | 85-89 | 4 个模块级 `Map`（devices / deviceEvents / deviceConfigs / deviceCommands）作为"内存数据库" | 业务态保留在 routes，全局可变。应迁到 `modules/devices/device-state.ts` |
| `backend/src/api/routes/devices.routes.ts` | 110-125 | 模块级 `codebook` 常量 | 配置性常量可在 `config/device-codebook.ts` 抽出 |
| `backend/src/api/routes/system.routes.ts` | 49-77, 93-107 | 路由 handler 中重复构造 17-字段 payload 对象 | 抽到 `core/views/system-mode.view.ts` 或类似 |
| `backend/src/api/routes/stats.routes.ts` | 35-38, 79-82, 161-183 | 多个模块级缓存（`historyBuffer`, `cachedOpsSummary`, `cachedAlerts`, `cachedAttackOrigins`, `apiRequestCount`） | 迁到 service 状态对象 |

### 4.4 🟢 P2 — `seed.routes.ts` 直接从 `database/seeds/seed-manager` 导入

`backend/src/api/routes/seed.routes.ts:11` 引入 `SeedManager` 来自 `database/seeds/`。`SeedManager` 内部封装了 `getDatabase()` 调用，对 routes 不可见——**ADR 合规**。但既然 `backend/src/modules/announcements/announcements.repository.ts` 已经把 repository 都放到 `modules/`，seed 也建议同步迁到 `backend/src/modules/seeds/seed.repository.ts` + `backend/src/modules/seeds/seed.service.ts`，让 `api/routes/seed.routes.ts` 改用 service 注入，**消除 routes → database 跨层 import**。

---

## 5. 推荐迁移策略

> 注意：Sprint 2 的"清点"结论是 routes **没有直接 DB 访问**。下面的阶段化是针对 §4 的**软违规**清理，而非 ADR 强制项。

### 阶段 1（1 周）：🔴 P0 — 消除 routes 导出的 setter
- 在 `backend/src/bootstrap/persistence.ts` 启动时调用 `setSiteRepositoryDatabase(getDatabase())` 一次。
- 在 `backend/src/bootstrap/control-plane-app.ts` 的 `createControlPlaneApp` 之前调用 `agentsRoutes.setAgentGateway(gateway)` 和 `aiSystemRoutes.setAgentGateway(gateway)`。
- 删除 `sites.routes.ts` 里的 `setDatabase` export。
- 删除 `agents.routes.ts` 和 `ai-system.routes.ts` 里的 `setAgentGateway` export，改为 service 层内部管理 gateway 引用。

### 阶段 2（1 周）：🟡 P1 — 消除 `*View` shim
- service 层（`scannerTaskService`、`tenantOversightService`、`auditLogger`）内部根据 `getDatabaseMode()` / `DB_MODE` 自动选 `*View` vs 主路径。
- 路由 handler 直接 `await service.method(...)`。
- 移除 `as typeof & { ... }` 的强制类型断言。

### 阶段 3（1 周）：🟢 P2 — 路由层业务态与配置外迁
- `devices.routes.ts` 的 4 个 `Map` 抽到 `backend/src/modules/devices/device-state.ts`（单例 + repository 持久化）。
- `stats.routes.ts` 的多个缓存抽到 `traffic-stats.service.ts` / `dashboard-stats-cache.service.ts`。
- `system.routes.ts` 的 17 字段 payload 抽到 `core/views/system-mode.view.ts`。
- `seed.routes.ts` 改用 `seed.service.ts`，`SeedManager` 仅在 service 内部使用。

### 阶段 4（1 周）：增强 guard，加 CI 红线
- 见 §6。

---

## 6. 推荐的 Guard 增强方案

### 6.1 新的 `scripts/guards/check-route-db-access.mjs` 应支持

```js
// 1) 现有 patterns
const dbAccessorPatterns = [
  /\bgetDatabase\s*\(/,
  /\bdb\.exec\s*\(/,
  /\.prepare\s*\(/,
];

// 2) 新增：routes 内任何 raw SQL 字符串字面量
const rawSqlInRoutes = /(?:'|`|")\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i;

// 3) 新增：禁止 routes 直接 import 持久化层
const forbiddenRouteImports = [
  /from\s+['"][^'"]*config\/database['"]/,
  /from\s+['"][^'"]*database\/seeds/,
  /from\s+['"][^'"]*modules\/[^'"]*\/[^'"]*\.repository['"]/, // 例外：scanner-route.repository（legacy 兼容）等允许的少量
];

// 4) 扫多根
const routeRoots = [
  'backend/src/api/routes',
  'backend/src/modules/**/routes.ts',
];

// 5) 跳过 .test.ts
if (entry.name.endsWith('.test.ts')) continue;

// 6) 输出 file:line:code 三元组
violations.push({ file, line, match, code: matchedLine });
```

### 6.2 配套 ADR 修订建议
在 `docs/adr/2026-03-12-module-boundaries-...md` 中追加一句（与项目 `CLAUDE.md` 同步）：

> Routes 不得直接调用 `getDatabase()` / `db.exec()` / `db.prepare()` 等持久化 API，不得从 `config/database` 或 `database/seeds` 直接 import 符号。`setDatabase` / `setAgentGateway` 等基础设施 setter 不得从 routes 模块导出。允许例外：与 `scanner-route.repository` 的兼容 import，**该例外须在新 ADR 中明文列出**。

---

## 7. 推荐的 service / repository 命名约定

| 层 | 命名 | 形态 | 例子 |
|---|---|---|---|
| Service | `<Entity>Service`，**单数** | `class` / `export const xxxService` | `securityOperationsService`, `scannerTaskService`, `finalDefenseService`, `auditSegmentService` |
| Repository | `<entity>Repository`，**单数** | 模块内 `export function ...`，默认无 class | `auth-user.repository`, `site.repository`, `admin.repository`, `announcements.repository` |
| View（向后兼容 shim） | `<entity>View` 后缀 | 隐藏在 service 内部，**不暴露到 routes** | `securityOperationsService.listAlertsView`（service 内部分支） |
| Controller | `<Entity>Controller` | `class`，仅做 routes ↔ service 装配 | `AdminController`, `InvestigationController` |

**Service 方法命名**：
- 列表：`listXxx(tenantId, opts)`、`listXxxView`（当 service 内部需要选视图时）。
- 详情：`getXxx(id)` / `getXxxView(id)`。
- 创建：`createXxx(payload)` / `upsertXxx(payload)`。
- 状态机：`transitionXxxView(id, nextState, actor)`。
- 汇总：`summarizeXxx(tenantId)` / `getDashboardSummaryView(tenantId)`。

**Repository 方法命名**（推荐全用动词原形，**不**加 `get` 前缀当返回 `Promise` 时——保持与 `db.prepare().all()` 语义一致）：
- 列表：`findAll(filter)` / `findById(id)` / `findByTenant(tenantId)`。
- 写入：`insert(row)` / `update(id, patch)` / `upsert(row)` / `deleteById(id)`。
- 副作用：`archive(id)` / `publish(id)` / `markStale(ids)`。

---

## 8. 风险点

### 8.1 跨边界副作用

| 路由 | 外部副作用 | 风险 |
|---|---|---|
| `auth.routes.ts` | `redisService.set('token:blacklist:...', ...)`, `redisService.set('refresh:blacklist:...', ...)` | 中：Redis 黑名单是 token 撤销路径，service 已有，routes 走 service——OK |
| `hardware-authorization.routes.ts` | `commandDispatcherService.dispatchAgentCommand / dispatchDeviceCommand` | 高：硬件 gate 决策路径，幂等性依赖 service |
| `final-defense.routes.ts` | `finalDefenseService.requestAction` / `requestGatewayAction` | 高：硬件释放决策，失败必须 fail-closed |
| `investigation.routes.ts` | `InvestigationController.startInvestigation`（触发 bug 调查 agent 编排） | 中：长时任务，需 service 端处理超时与取消 |
| `attack.routes.ts` | 写 `attackHistory`（**进程内数组**）、写 `trafficStats`、写 `securityOperationsService.upsertAsset` | 中：内存状态在重启时丢失；应该迁到 `attack-validation.repository` |

### 8.2 复杂事务
- `admin.routes.ts` 里的密码重置：包含 `updateAdminUserField` + `auditLogger.log` + 多个 sendError 分支。**非事务性**，但因 audit log 是独立存储，短暂不一致可接受。
- `seed.routes.ts` 的 `SeedManager.seed(options)` 内部包含多表写入（`clearExisting` 路径）。**事务性**由 `SeedManager` 自己保证（同一 `getDatabase()`），routes 看到的是 `await` 完成的整体。

### 8.3 内存数据丢失风险
- `devices.routes.ts`：4 个 `Map` 在进程重启时清空。已通过 `securityOperationsService.upsertAsset` 做持久化兜底，但 command history 不持久化——属预期（设计如此）。

### 8.4 后台缓存与 SSE
- `stats.routes.ts` 用 `setInterval(refreshCache, 30_000)` 做 dashboard 缓存。定时器在 `routes` 模块加载时即启动，**如果 `apiRouter` 在测试中未挂载会泄漏**。建议迁到 service / 显式 lifecycle。

---

## 9. 建议的下一步（具体 ticket 建议）

| 优先级 | 任务 | 文件 | 预估 |
|---|---|---|---|
| 🔴 P0 | 移除 `sites.routes.ts` 的 `setDatabase` export | `sites.routes.ts:23`, `bootstrap/persistence.ts` | 30 min |
| 🔴 P0 | 移除 `agents.routes.ts` / `ai-system.routes.ts` 的 `setAgentGateway` export | `agents.routes.ts:42`, `ai-system.routes.ts:277`, `bootstrap/control-plane-app.ts` | 1 h |
| 🟡 P1 | service 层消化 `*View` shim | `scanner-task.service.ts`, `tenant-oversight.service.ts`, `audit-logger.service.ts` | 1 d |
| 🟡 P1 | 增强 `check-route-db-access.mjs` 输出 `file:line:code` 并扫 `modules/**/routes.ts` | `scripts/guards/check-route-db-access.mjs` | 2 h |
| 🟢 P2 | `seed.routes.ts` 改用 `seed.service.ts` | `seed.routes.ts`, 新建 `modules/seeds/seed.service.ts` | 2 h |
| 🟢 P2 | `devices.routes.ts` 的 4 个 Map 抽到 `modules/devices/device-state.ts` | `devices.routes.ts`, 新建 `modules/devices/device-state.ts` | 0.5 d |
| 🟢 P2 | `stats.routes.ts` 的 4 个缓存 + `setInterval` 抽到 service | `stats.routes.ts`, `services/dashboard-stats-cache.service.ts` | 0.5 d |
| 🟢 P2 | `system.routes.ts` 的 17 字段 payload 抽到 `core/views/system-mode.view.ts` | `system.routes.ts`, 新建 `core/views/system-mode.view.ts` | 0.5 d |

合计：**约 1 人周** 完成全部 Sprint 2 重构 + 增强。

---

## 10. 附录：调研方法学

### 10.1 工具
- 纯静态分析（Grep 模式匹配 + Read 文件 + Glob 目录扫描）。
- **没有**运行任何命令、构建、测试——以保持调研为只读。

### 10.2 关键判断口径
- "routes 内的直接 DB 访问" = 文件 `backend/src/api/routes/*.routes.ts` 文本中出现 `getDatabase(` / `db.exec(` / `db.prepare(` / `import` 来自 `config/database` / `database/seeds`。
- 不把 `router.get(...)` / `Map.get(...)` / `service.method(...)` 计为 DB 访问。
- "软违规"指不直接违反 ADR 但破坏层间单向依赖的写法（如 setter 导出、view shim、模块级 Map 状态）。

### 10.3 不在本次调研范围
- `backend/src/services/**/*.ts`（service 层可能有 `getDatabase()` 临时绕过 repository——属于 ADR 第二阶段的"集成重的服务层"待迁移项）。
- `backend/src/api/controllers/*.ts`（仅 admin 和 investigation 控制器，均未发现直接 DB 访问）。
- `backend/src/api/middleware/*` 和 `backend/src/websocket/*`（不在 routes 范围）。
- 前端 `frontend/src/**`。
- 测试文件（routes/ 下无 `.test.ts`）。

---

## 11. 参考文件清单（已 Read）

| 用途 | 绝对路径 |
|---|---|
| Guard 脚本 | `X:\repos\Networksafe\scripts\guards\check-route-db-access.mjs` |
| 模块边界 ADR | `X:\repos\Networksafe\docs\adr\2026-03-12-module-boundaries-bootstrap-core-modules-integrations.md` |
| 项目规约 | `X:\repos\Networksafe\CLAUDE.md` |
| 启动入口 | `X:\repos\Networksafe\backend\src\bootstrap\control-plane-app.ts` |
| 28 个 routes | `X:\repos\Networksafe\backend\src\api\routes\*.routes.ts` |
| 模块内 routes | `X:\repos\Networksafe\backend\src\modules\announcements\announcements.routes.ts` |
| 模块 repository（合规的 DB 访问点） | `X:\repos\Networksafe\backend\src\modules\admin\admin.repository.ts` |
| 模块 repository | `X:\repos\Networksafe\backend\src\modules\announcements\announcements.repository.ts` |
| 数据库 manager（合规入口） | `X:\repos\Networksafe\backend\src\database\seeds\seed-manager.ts`（间接通过 seed.routes.ts 引用） |
| 控制器 | `X:\repos\Networksafe\backend\src\api\controllers\admin.controller.ts`（未 Read 全文，未发现 DB 访问） |
| 控制器 | `X:\repos\Networksafe\backend\src\api\controllers\investigation.controller.ts`（未 Read 全文，未发现 DB 访问） |
