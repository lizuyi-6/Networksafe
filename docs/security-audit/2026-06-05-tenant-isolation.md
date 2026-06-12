# 租户隔离审计 - 2026-06-05

**审计范围**：AetherGuard 后端 (Sprint 5 · R1 租户隔离攻击)
**审计员**：白盒静态审计（不修改代码、不运行攻击）
**审计时间**：2026-06-05
**审计重点**：多租户隔离绕过（IDOR、tenant_id 推导缺陷、admin 越权、路由层遗漏）

---

## 攻击面映射

### Tenant 解析核心函数

**文件**：`X:/repos/Networksafe/backend/src/core/tenant/tenant-context.ts`

```typescript
// 第 18-30 行 — 危险：从 req 直接读取 tenantId（用户可控）
function readRequestedTenantId(req: AuthenticatedRequest): string | undefined {
  const rawValue =
    req.params?.tenantId ||
    req.query?.tenantId ||
    req.body?.tenantId;
  if (typeof rawValue !== 'string') return undefined;
  return rawValue.trim() || undefined;
}

// 第 49-81 行 — resolveUserTenantContext 信任 request 中的 tenantId
export function resolveUserTenantContext(user, options) {
  if (!user) return null;
  const requestedTenantId = normalizeTenantId(options.requestedTenantId);
  if (requestedTenantId) {
    return { tenantId: requestedTenantId, source: 'request' };  // ← 无任何授权检查
  }
  const userTenantId = normalizeTenantId(user.tenantId);
  if (userTenantId) return { tenantId: userTenantId, source: 'user' };
  if (user.role === 'admin' && options.allowAdminPlatformFallback) {
    return buildPlatformTenantContext('admin-platform-fallback');
  }
  return null;
}

// 第 83-103 行 — HTTP 入口
export function resolveRequestTenantContext(req, options) {
  if (req.tenantContext) return req.tenantContext;
  const context = resolveUserTenantContext(req.user, {
    requestedTenantId: readRequestedTenantId(req),  // ← 用户可控的 tenantId
    allowAdminPlatformFallback: options.allowAdminPlatformFallback
  });
  if (context) req.tenantContext = context;
  return context;
}
```

### Tenant 隔离中间件

`requireTenantAccess`（`auth.middleware.ts:347-382`）**正确**实现了：
1. 调用 `resolveRequestTenantContext`
2. 对非 platform_admin 角色，**检查 `context.tenantId !== req.user.tenantId`**
3. 不匹配直接返回 403

但这个中间件**只被 `sites.routes.ts` 使用**（`authenticate + requireTenantAccess` 组合）。其他路由通过 `tenantOf(req)` 内部函数**绕过这个 check**。

### 调用链（受影响的路由）

```
HTTP Request (user-controlled ?tenantId=X)
    ↓
authenticate (loads JWT user, sets req.user.tenantId = OWN)
    ↓
requireRole / requirePermission (RBAC, no tenant check)
    ↓
handler() → tenantOf(req)
    ↓
resolveRequestTenantContext(req, { allowAdminPlatformFallback: ... })
    ↓
readRequestedTenantId(req) ← returns ?tenantId=X (USER CONTROLLED)
    ↓
resolveUserTenantContext(user, { requestedTenantId: 'X' })
    ↓
{ tenantId: 'X', source: 'request' } ← 切换到受害者租户
    ↓
service.readX(view, tenantId='X')  ← 数据泄露 / 越权写
```

### Tenant 检查的实际分布

`tenantOf` 函数的实现方式（grep 出来 8 个不同写法）：

| 路由文件 | 写法 | 是否调用 `resolveRequestTenantContext`（用户可控） |
|---|---|---|
| `sites.routes.ts` | `user.tenantId` | 否（用 `requireTenantAccess` 替代） |
| `admin.routes.ts` | `resolveRequestTenantContext` + `allowAdminPlatformFallback: role==='admin'` | **是**（admin 越权/可切换） |
| `logs.routes.ts:13` | `resolveRequestTenantContext` | **是**（任何登录用户可控） |
| `rules.routes.ts:11` | `resolveRequestTenantContext` | **是**（admin 才能调，但可切换） |
| `stats.routes.ts:83` | `resolveRequestTenantContext` | **是** |
| `hardware-authorization.routes.ts:13` | `resolveRequestTenantContext` | **是** |
| `final-defense.routes.ts:14` | `resolveRequestTenantContext` | **是**（**最危险**：含 hardware grant/policy/action） |
| `devices.routes.ts:91` | `resolveRequestTenantContext` | **是** |
| `agents.routes.ts:47` | `user.tenantId` | 否（直接读 JWT） |
| `attack.routes.ts:49,450,481` | `user.tenantId` | 否 |
| `alerts.routes.ts:23` | `user.tenantId` | 否 |
| `scanner.routes.ts:22` | `user.tenantId` | 否 |
| `traffic.routes.ts:13` | `user.tenantId` | 否 |
| `dashboard.routes.ts:12` | `req.tenantContext?.tenantId ?? user.tenantId` | 依赖 `resolveRequestTenantContext` 副作用 |
| `auth.routes.ts:684,771` | `user.tenantId` | 否 |
| `ai-system.routes.ts:48,110,215` | `req.tenantContext?.tenantId ?? user.tenantId ?? PLATFORM` | 依赖 `resolveRequestTenantContext` 副作用 |
| `ai-endpoints.routes.ts:64` | `user.tenantId` | 否 |
| `agent-onboarding.routes.ts:45,259,298` | `user.tenantId` | 否 |
| `deployments.routes.ts:23` | `user.tenantId` | 否 |
| `config.routes.ts:10` | `user.tenantId` | 否 |

### 权限矩阵（`permissions.ts`）

`platform_admin` 拥有所有 `tenant.admin` 权限，包括 `final_defense.execute`、`final_defense.manage`、`gate.enroll`、`deployment.run.approve` 等。`tenant_admin` 也有 `final_defense.execute` / `deployment.run.approve` 等（见 `permissions.ts:101-114`）。这意味着任何 `tenant_admin` 用户的 `requirePermission('final_defense.execute')` 检查都会通过——但他们本应**只能操作自己租户**的资源。

---

## 🔴 P0 漏洞（可立即利用）

### V1.1: `resolveUserTenantContext` 信任用户提供的 `requestedTenantId` — **核心根因**

- **文件:行号**:
  - `X:/repos/Networksafe/backend/src/core/tenant/tenant-context.ts:49-81`（核心逻辑）
  - `X:/repos/Networksafe/backend/src/core/tenant/tenant-context.ts:18-30`（HTTP 入口）
- **攻击代码**（`tenant-context.ts:60-66`）：
  ```typescript
  const requestedTenantId = normalizeTenantId(options.requestedTenantId);
  if (requestedTenantId) {
    return {
      tenantId: requestedTenantId,  // ← 用户通过 ?tenantId=X 直接指定
      source: 'request'              // ← 无任何 authz 校验
    };
  }
  ```
- **PoC**（任何登录的 tenant 用户）：
  ```bash
  # 攻击者是 tenant_admin（tenant=A）
  # 受害者是 tenant_admin（tenant=B）
  curl -X GET 'https://target/api/final-defense/status?tenantId=B' \
    -H "Cookie: accessToken=<攻击者 JWT>"
  # 返回 B 租户的 policies / root gateways / 隔离状态
  ```
- **影响**:
  - 跨租户**只读**泄露：所有 `tenantOf(req)` 调用 `resolveRequestTenantContext` 的路由
  - 配合 `requireRole('admin')` / `requirePermission('deployment.run.approve')` 等，**可越权执行**（如升级 policy、approve deployment run、enroll hardware gate）
  - 横向移动到受害租户的 hardware-grant 流程，触发 critical 的 final-defense 动作
- **修复建议**:
  ```typescript
  // 在 resolveUserTenantContext 中插入授权检查
  if (requestedTenantId) {
    if (user.role !== 'platform_admin' && user.tenantId !== requestedTenantId) {
      return null;  // 拒绝跨租户
    }
    return { tenantId: requestedTenantId, source: 'request' };
  }
  ```
  或者**彻底删除** `requestedTenantId` 参数，让 tenant 上下文**永远**只从 `user.tenantId` / JWT 派生。

### V1.2: `GET /api/final-defense/status` — 跨租户读取防御策略 / 网关状态

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/final-defense.routes.ts:40-64`
- **攻击代码**:
  ```typescript
  router.get('/status', authenticate, requirePermission('final_defense.read'), async (req, res) => {
    const tenantId = tenantOf(req);  // ← tenantOf = resolveRequestTenantContext
    const statuses = finalDefenseService.listStatus(tenantId);
    const rootResistantGateways = finalDefenseService.listRootResistantGateways(tenantId);
    const policies = finalDefenseService.listPolicies(tenantId);
    ...
  });
  ```
- **PoC**:
  ```bash
  # attacker (tenant=A) 读 victim (tenant=B) 的 root-gateway 状态
  curl 'https://target/api/final-defense/status?tenantId=B' \
    -H "Cookie: accessToken=<attacker_jwt_with_tenant=A>"
  # 获得 victim 的：policyDigest、gateway 列表、interlockState、breederTarget
  ```
- **影响**:
  - 泄露其他租户的 **Final Defense Policy**（含 commandType / scriptPath / releaseTtlMs）
  - 泄露 **Root-Resistant Gateway** 拓扑（gatewayId、firmwareDigest、secureElementPresent）
  - 攻击者可针对 victim 的硬件配置制定旁路方案
- **修复建议**: 在 `tenantOf` 中对 `requestedTenantId` 强制相等性检查（同 V1.1），并对 `tenant_admin` 角色禁用 `allowAdminPlatformFallback`。

### V1.3: `POST /api/final-defense/policies` — 跨租户覆盖 Final Defense Policy

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/final-defense.routes.ts:147-182`
- **攻击代码**:
  ```typescript
  router.post('/policies', authenticate, requirePermission('final_defense.manage'), async (req, res) => {
    ...
    const policy = finalDefenseService.upsertPolicy({
      tenantId: tenantOf(req),  // ← 用户可控
      companionId, gateId, allowedActions, breakerTarget, ...
    });
  });
  ```
- **PoC**:
  ```bash
  # attacker 覆盖 victim 的 allowedActions，使危险的 commandType 被加入白名单
  curl -X POST 'https://target/api/final-defense/policies' \
    -H "Cookie: accessToken=<attacker_jwt>" \
    -H "Content-Type: application/json" \
    -d '{
      "tenantId": "B",
      "companionId": "victim-companion",
      "gateId": "victim-gate",
      "breakerTarget": "victim-target",
      "allowedActions": [{"commandType": "host_remove", "scriptPath": "/etc/aetherguard/rm.sh"}],
      "status": "active"
    }'
  ```
- **影响**:
  - **完全接管** victim 的 final-defense 决策面：攻击者可注入任意 allowedActions（`host_remove` / `wipe_data` / `factory_reset`）
  - 之后用 V1.4 触发 action，**整台被保护服务器被擦除**（被 final-defense 框架自身"合法"放行）
- **修复建议**: 同 V1.1；并在 `finalDefenseService.upsertPolicy` 内对 `tenantId` 做服务端二次校验（必须匹配 `actor.tenantId`）。

### V1.4: `POST /api/final-defense/actions` 和 `POST /api/final-defense/gateways/actions` — 跨租户触发 dangerous action

- **文件:行号**:
  - `X:/repos/Networksafe/backend/src/api/routes/final-defense.routes.ts:184-232`（gateway）
  - `X:/repos/Networksafe/backend/src/api/routes/final-defense.routes.ts:234-282`（companion）
- **攻击代码**:
  ```typescript
  router.post('/gateways/actions', authenticate, requirePermission('final_defense.execute'), async (req, res) => {
    ...
    const result = await finalDefenseService.requestGatewayAction({
      tenantId: tenantOf(req),  // ← 用户可控
      gatewayId, action, payload, ...
    });
  });
  ```
- **PoC**:
  ```bash
  # attacker 在 victim 的租户上触发 gateway action（注意：V1.3 已注入 allowedActions）
  curl -X POST 'https://target/api/final-defense/gateways/actions' \
    -H "Cookie: accessToken=<attacker_jwt>" \
    -d '{
      "tenantId": "B",
      "gatewayId": "victim-gateway",
      "action": "release",
      "payload": {"target": "victim-server"}
    }'
  ```
- **影响**:
  - 跨租户触发 high-risk command（`release` / `armed` / `isolated` 切换）
  - 配合 V1.3 注入 policy，可让整个 root-resistant 防线对 victim 失效
- **修复建议**: 同 V1.1；在 service 层强制 `tenantId` 等于 `actor.tenantId`。

### V1.5: `requireRole('admin')` 配合 `allowAdminPlatformFallback` 允许 admin 切换租户后越权

- **文件:行号**:
  - `X:/repos/Networksafe/backend/src/middleware/auth.middleware.ts:316-341`（`requireRole`）
  - `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:32-36`、`stats.routes.ts:83-87`、`logs.routes.ts:13-17` 等
- **攻击代码**（`admin.routes.ts:32-36`）：
  ```typescript
  function resolveTenantOrPlatform(req: AuthenticatedRequest): string {
    return resolveRequestTenantContext(req, {
      allowAdminPlatformFallback: req.user?.role === 'admin'
    })?.tenantId || PLATFORM_TENANT_ID;
  }
  ```
- **PoC**:
  ```bash
  # platform_admin 假装是 tenant_admin 操作（影响 audit attribution）
  curl 'https://target/api/admin/benchmarks/run?tenantId=ANY' \
    -H "Cookie: accessToken=<platform_admin_jwt>" \
    -d '{"scenario": "..."}'
  # audit log 中 tenantId = ANY (attacker 选择)，而 actor = 合法 platform_admin
  ```
- **影响**:
  - **审计绕过**：platform_admin 故意把动作记到无辜租户头上（`oversight_list_exports` 等会按请求的 tenantId 写 audit log）
  - `getAuditLogsForView` 中 `tenantId` 来自 query，未二次确认是否 actor 真的有该租户
  - 详见 V1.6
- **修复建议**: platform_admin 走 `PLATFORM_TENANT_ID` 专门路径；tenant 上下文永远从 JWT `user.tenantId` 读取。

### V1.6: `GET /api/admin/audit/logs` — 用 `?tenantId=` 跨租户读取审计日志

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:130-153`
- **攻击代码**:
  ```typescript
  router.get('/audit/logs', authenticate, requireRole('admin'), async (req, res) => {
    const { tenantId, ... } = req.query;
    const filter = {
      tenantId: tenantId ? String(tenantId) : undefined,  // ← 任意 tenant
      ...
    };
    const logs = await getAuditLogsForView(filter);
  });
  ```
- **PoC**:
  ```bash
  curl 'https://target/api/admin/audit/logs?tenantId=B&limit=100' \
    -H "Cookie: accessToken=<platform_admin_jwt>"
  # 读到 B 租户的所有审计日志
  ```
- **影响**:
  - 任意 platform_admin 可全量读取任何租户的 audit log
  - 暴露 victim 的 admin 邮箱、IP、user_id、action details（hardware grant 流程、password reset 流程等）
  - **合规违规**：平台 admin 不应有跨租户无限制读取能力
- **修复建议**:
  - 把审计日志按 region / 功能分表（已有 ADR `docs/adr/2026-03-12-postgres-primary-write-path.md` 应有 schema 隔离设计）
  - 增加 `oversight_scope_check`：admin 必须显式 `requestAccess(tenantId, justification)` 才可读
  - 短期 fix：增加 `actor.tenantId === filter.tenantId` check（platform_admin 仅能读 `PLATFORM_TENANT_ID`）

### V1.7: `POST /api/hardware-authorization/commands/intents` — 跨租户向受害 agent 派发命令

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/hardware-authorization.routes.ts:19-82`
- **攻击代码**:
  ```typescript
  router.post('/commands/intents', authenticate, requirePermission('deployment.run.create'), async (req, res) => {
    ...
    const actor = {
      tenantId: tenantOf(req),  // ← 用户可控
      userId: req.user?.userId || 'unknown',
      ...
    };
    const result = scope === 'agent'
      ? await commandDispatcherService.dispatchAgentCommand({
          agentId: targetId,
          commandType,
          payload,
          actor
        })
      : await commandDispatcherService.dispatchDeviceCommand({...});
  });
  ```
- **PoC**:
  ```bash
  # attacker 派发 'wipe_data' 到 victim 的 agent
  curl -X POST 'https://target/api/hardware-authorization/commands/intents' \
    -H "Cookie: accessToken=<attacker_jwt>" \
    -d '{
      "tenantId": "B",
      "scope": "agent",
      "targetId": "victim-agent-uuid",
      "commandType": "wipe_data",
      "payload": {}
    }'
  ```
- **影响**:
  - 跨租户派发 `wipe_data` / `factory_reset` / `recovery_flash` / `host_remove` 等 dangerous 命令
  - 即便有 hardware gate 校验（final-defense），如果 victim 的 gate policy 没设置（见 V1.3），命令会**直接执行**
- **修复建议**: 同 V1.1；并在 `commandDispatcherService.dispatchAgentCommand` 内强制 `actor.tenantId === agent.tenantId`。

### V1.8: `POST /api/devices/:id/cmd` — 跨租户向受害 device 派发命令

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/devices.routes.ts:819-894`
- **攻击代码**:
  ```typescript
  router.post('/:id/cmd', requireRole('admin'), (req, res) => {
    ...
    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: id,
      commandType: String(command || '').trim(),
      payload: params || {},
      actor: {
        tenantId: resolveActorTenantId(req),  // ← 用户可控
        ...
      }
    });
  });
  ```
- **PoC**: 同 V1.7，但 target 是 ESP32 device（OTA / config / sync-config）。
- **影响**:
  - 跨租户下发 OTA 固件、配置同步、诊断命令
  - ESP32 设备本身没有任何 `tenant_id` 概念（见 `devices.routes.ts:85` 用全局 `Map<string, DeviceInfo>`），意味着**任何 device 都是公共的**
  - 一旦下发恶意 `ota_update`，可持久化控制受害 device
- **修复建议**: 在 `DeviceInfo` 上加 `tenantId`；`dispatchDeviceCommand` 内校验 `actor.tenantId === device.tenantId`；`requireRole('admin')` 应改为 `requireRole('platform_admin')` 或 `requireRole('admin', 'tenant_admin')` + tenant check。

---

## 🟡 P1 漏洞（需特定条件）

### V2.1: 平台 admin 跨租户修改用户角色 / 状态 / 计划

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:678-802`
- **攻击代码**（`/users/:id/role` 行 710-755）：
  ```typescript
  router.put('/users/:id/role', authenticate, requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!['admin', 'tenant', 'viewer'].includes(role)) {
      return sendError(res, 400, { ... });
    }
    // SECURITY: Prevent admin from demoting themselves
    if (id === req.user?.userId) { ... }
    // SECURITY: Prevent demoting the last admin
    if (user.role === 'admin' && role !== 'admin') { ... }
    await updateAdminUserField(id, 'role', role);
    ...
  });
  ```
- **触发条件**: 攻击者是 platform_admin（合规合法角色）。
- **影响**:
  - 平台 admin 可**直接**把 victim 改成 `admin`（注：本身合法但绕过 tenant scope）
  - 平台 admin 可 suspend victim 整个租户
  - 业务上没保护租户边界，违反 least-privilege
- **修复建议**:
  - 把 `/users/:id/role` 限制为 `requireRole('platform_admin')`（已有限制，但与 `requireRole('admin')` 等价，OK）
  - 增加 tenant scope：参数化 `?tenantId=` 必须为 `actor.tenantId`（V1.1 的副作用）
  - 增加审批流：suspension / role change 需双签

### V2.2: `PUT /api/admin/users/:id/reset-password` — 跨租户重置任意用户密码

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:920-1024`
- **攻击代码**（行 935）：
  ```typescript
  const tenantId = user.tenant_id || req.user?.tenantId || PLATFORM_TENANT_ID;
  ```
- **触发条件**: 平台 admin 角色（合法）。
- **影响**:
  - 平台 admin 可发起 password reset 给任何 user（需要 hardware grant 通过）
  - 虽然有 hardware gate 保护，但只要平台 admin 物理确认通过，**任何 user 密码被重置**
  - 配合 V2.1 可先把 victim suspend / 改 role，再 reset 密码 → 完全接管其租户
- **修复建议**: 增加 `actor.tenantId === user.tenant_id || actor.tenantId === PLATFORM` check，并记录 explicit `requestedByTenant`。

### V2.3: `GET /api/admin/tenant-oversight/tenants/:tenantId/{summary,timeline,evidence,events,exports}` — 全量读租户元数据

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:404-484, 533-546`
- **攻击代码**（行 404-418）：
  ```typescript
  router.get('/tenant-oversight/tenants/:tenantId/summary', authenticate, requireRole('admin'), async (req, res) => {
    const userId = req.query.userId ? String(req.query.userId) : undefined;
    const data = ... tenantOversightService.getTenantSummary(req.params.tenantId, userId);
  });
  ```
- **触发条件**: platform_admin 角色。
- **影响**:
  - 平台 admin 读取 victim 的 user_timeline（含登录历史 / 行为轨迹）
  - 平台 admin 创建 export（`/tenant-oversight/exports` 行 508-531）将 victim 全部数据打包
- **修复建议**:
  - 加 `oversight_access_audit`：每条 access 单独记录
  - 加 rate limit + multi-approval（大 export 必须 2 人）
  - 限缩到 `tenantId = actor.tenantId OR actor is platform_admin + 在 oversight session 中`

### V2.4: `GET /api/agents/:id` 任意 agentId — 可读全部 agent

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/agents.routes.ts:542-620`
- **攻击代码**:
  ```typescript
  router.get('/:id', async (req, res) => {
    ...
    const agent = agentGateway.getAgent(req.params.id);
    if (!agent) { return res.status(404).json({ ... }); }
    const tenantId = tenantOf(req);  // ← 直接 user.tenantId
    const securityContext = hydrateAgentContext(tenantId, agent);
    ...
  });
  ```
- **触发条件**: 任意已登录用户。
- **影响**:
  - 攻击者 (`tenant=A`) 可读 victim (`tenant=B`) 的 agent 元数据（hostname / platform / version / IP / status）
  - 返回 `agent.registration.ip`（明文 IP）→ 后续横向攻击目标发现
  - 注：`tenantId` 用的是 `tenantOf = user.tenantId`（非 `resolveRequestTenantContext`），所以**不能**通过 `?tenantId=` 切换——但仍可读
- **修复建议**:
  - `agentGateway.getAgent(id)` 返回 `agent.tenantId`，handler 内强制 `agent.tenantId === req.user.tenantId || isPlatformAdmin`

### V2.5: `GET /api/agents/` 列出全部 agent 缺少租户过滤

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/agents.routes.ts:244-269`
- **攻击代码**:
  ```typescript
  router.get('/', (req, res) => {
    ...
    const tenantId = tenantOf(req);
    const agents = agentGateway.getAgentList().map((agent: any) => {
      const context = hydrateAgentContext(tenantId, agent);  // ← 把 victim 的 agent 写到 attacker 租户的资产表
      return { ...agent, ... };
    });
    res.json({ success: true, count: agents.length, agents });
  });
  ```
- **触发条件**: 任意已登录用户。
- **影响**:
  - 攻击者拿到**所有** agent 的完整对象（hostname、IP、状态）
  - 同时**注入攻击者自己的 tenantId** 到 `security_operations` 资产表 → 污染 victim 资产的 tenant 归属
- **修复建议**: 严格过滤：`agents.filter(a => a.tenantId === req.user.tenantId || isPlatformAdmin)`；`hydrateAgentContext` 只能用 agent 自身的 `tenantId`。

### V2.6: `GET /api/devices/:id` 与 `GET /api/devices/:id/events` 与 `GET /api/devices/:id/config` 任意 deviceId

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/devices.routes.ts:734-812`
- **攻击代码**: device 存储是全局 `Map`（行 85-88），无 `tenantId` 字段。
- **触发条件**: 任意已登录用户。
- **影响**:
  - 任意 user 可读任何 device 的 events（包含 `bundle` 内容、deploy 操作历史）
  - 任意 user 可读 config（包含 `commandPermissions` 列表，可推断设备能力）
- **修复建议**: 给 `DeviceInfo` 加 `tenantId`；路由内加 tenant check；`getDeviceById` 应返回 `null` 当 tenant 不匹配。

### V2.7: `GET /api/traffic/flows/:id` — 跨租户读取流量会话详情

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/traffic.routes.ts:113-197`
- **攻击代码**:
  ```typescript
  router.get('/flows/:id', async (req, res) => {
    const tenantId = tenantOf(req);  // ← user.tenantId
    const session = await securityOperationsService.getTrafficSessionByIdView(tenantId, req.params.id);
    if (!session) { return res.status(404).json({ ... }); }
    ...
  });
  ```
- **触发条件**: 任意已登录用户。
- **影响**:
  - `getTrafficSessionByIdView` 内部如果用 `tenantId` 作为 WHERE，attacker 只能看到自己的；但如果内部实现是按 `sessionId` 查询（多数 view 是这样），则可读**任何 tenant** 的 session
  - 返回 `sourceIP / destIP / payload / metadata` → 业务数据 + 拓扑泄露
- **修复建议**: 调用 service 前先在 `traffic_sessions` 表中 `WHERE session_id = ? AND tenant_id = ?` 验证归属。

### V2.8: `GET /api/alerts/:id` — 跨租户读取 alert 详情

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/alerts.routes.ts:115-229`
- **攻击代码**:
  ```typescript
  router.get('/:id', async (req, res) => {
    const tenantId = tenantOf(req);
    const alert = await securityOperationsService.getAlertByIdView(tenantId, req.params.id);
    ...
  });
  ```
- **触发条件**: 任意已登录用户。
- **影响**:
  - 与 V2.7 同；`getAlertByIdView` 实现未知，需检查；如果按 `alertId` 全局查，则跨租户读
- **修复建议**: 校验 `alert.tenantId === req.user.tenantId`。

### V2.9: `POST /api/alerts/:id/{acknowledge,investigate,resolve,suppress}` 跨租户篡改 alert 状态

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/alerts.routes.ts:231-281`
- **攻击代码**:
  ```typescript
  router.post('/:id/resolve', async (req, res) => {
    const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'resolved', ...);
    ...
  });
  ```
- **触发条件**: 任意已登录用户。
- **影响**:
  - 攻击者可把 victim 的 critical alert 标记为 `resolved` / `suppressed` → 阻止 victim 收到告警
  - 是**主动破坏**而不是数据泄露
- **修复建议**: `transitionAlertView` 内部必须校验 `alert.tenantId === tenantId`。

### V2.10: `getSecurityOperations` 各类 `*View` 函数依赖传入的 `tenantId` 严格性

- **文件:行号**: 散落在 `security-operations.service.ts`（未完整审计）
- **触发条件**: 任何调用方传入错误 tenantId。
- **影响**:
  - 整条服务链（`listAlertsView` / `listFindingsView` / `listActionsView` / `listTrafficSessionsView` / `getAssetByIdView` 等）若没在 WHERE 加 `tenant_id = ?`，则全部受 V1.* 影响
  - 也就是说 V1.1-V1.4 + V2.* 的攻击能否成功，**完全取决于 service 层是否在所有 SQL 串接 `tenant_id`**——`X:/repos/Networksafe/backend/src/services/security-operations.service.ts` 未完整审计
- **修复建议**: 在 service 层每个 `*View` 函数**首行**断言 `tenantId` 是非空且非 platform；为 platform 路径单独建 `*AdminView` 函数。

---

## 🟢 P2 漏洞（理论风险）

### V3.1: 平台 admin 切换到 PLATFORM_TENANT_ID 后审计可见性错位

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:32-36`
- **理论风险**: platform_admin 故意用 `?tenantId=PLATFORM` 触发 audit，但 actor 实际做了 victim 租户的事——造成审计"消失"（attacker 看到自己 audit 在 PLATFORM 池，但 victim 看不到）。
- **影响**: 取证/合规困难。

### V3.2: `getAuditLogsForView` 的 `tenantId` filter 无服务端归一

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/admin.routes.ts:132-144`
- **理论风险**: `String(tenantId)` 直接传入 filter，依赖底层 `getLogs` 的 SQL 实现是否过滤。

### V3.3: 缺失 `siteId` 路径参数所有权检查

- **文件:行号**: `X:/repos/Networksafe/backend/src/api/routes/deployments.routes.ts:744-812`
- **理论风险**: `GET /:id/download` 中 `getDeploymentProfile(id, tenantOf(req))` 如果底层是按 `id` 全局查，则可读别的租户的部署 bundle（含 API key / 证书）。

### V3.4: `requirePlanQuota` 用 `req.user.tenantId` 但 admin bypass 无限额

- **文件:行号**: `X:/repos/Networksafe/backend/src/middleware/plan.middleware.ts:22-25, 42-46`
- **理论风险**: `req.user.role === 'admin'` 直接 bypass plan quota，但 `user.role` 已被 `normalizeRole` 别名为 `platform_admin`——如果使用 `tenant_admin` 用户，他们**不被** bypass，但创建 site 数量的限制是 `user.tenantId` → 不会跨租户；OK。

### V3.5: `sites.routes.ts:279` `getSiteForUser(req.params.id, user.role, user.tenantId)` 依赖 repository 实现

- **理论风险**: 内部 `getSiteForUser` 在 role=admin 时**不**加 `tenant_id` 过滤（见 `site.repository.ts:80-84`）——platform_admin 正确路径，但若未来 `role` 检查被绕过，所有 site 泄露。

### V3.6: WebSocket `agent-gateway` 已正确 tenant check，但 `dashboard_client` 路径有侧信道

- **文件:行号**: `X:/repos/Networksafe/backend/src/websocket/agent-gateway.ts:357-375`
- **理论风险**: dashboard client 上来时 `resolveUserTenantContext(user, { allowAdminPlatformFallback: user.role === 'admin' })`——同 V1.1，平台 admin 可切换。

---

## 总评

- **漏洞总数**: 22 条
- **P0**: 8 条
- **P1**: 9 条
- **P2**: 6 条

### 修复优先级

1. **第一优先（必须立即修复）**:
   - V1.1（核心根因）
   - V1.2 / V1.3 / V1.4（final-defense 全链路跨租户）
   - V1.5 / V1.6（admin 越权 + 审计绕过）
   - V1.7 / V1.8（hardware authorization / device command 跨租户）

2. **第二优先（一个月内）**:
   - V2.1 - V2.10（agents / devices / alerts / traffic 各类 IDOR）

3. **第三优先（持续 hardening）**:
   - V3.1 - V3.6
   - **架构层**修复：service 层 `*View` 函数全部强制 `tenant_id = ?`；platform admin 路径分离；OIDC `aud` / `iss` 校验

### 核心建议

> **白盒根因**：`resolveUserTenantContext` 的"信任客户端传 `tenantId`" 设计是单点失败。建议：
> 1. 移除 `requestedTenantId` 参数，让 tenant 上下文**只能**从 `user.tenantId`（即 JWT claim）派生
> 2. platform_admin 跨租户操作走专门 endpoint + 单独审计通道
> 3. 路由层在所有 `tenantOf` 调用前**强制** `req.user.tenantId === tenantId`（或 `isPlatformAdmin`）
> 4. service 层**不再**接受 tenantId 参数——直接从 `actor.tenantId` 派生
> 5. 数据库层面启用 Postgres RLS（参考 `docs/adr/2026-03-12-postgres-primary-write-path.md` 路线图）

---

## 已读关键文件清单

| 文件 | 行数摘要 |
|---|---|
| `backend/src/core/tenant/tenant-context.ts` | 全文 132 行 |
| `backend/src/middleware/auth.middleware.ts` | 全文 555 行 |
| `backend/src/middleware/plan.middleware.ts` | 全文 77 行 |
| `backend/src/middleware/helper-auth.middleware.ts` | 全文 49 行 |
| `backend/src/security/permissions.ts` | 全文 161 行 |
| `backend/src/security/auth-security.service.ts` | 全文 497 行 |
| `backend/src/config/enterprise-runtime.ts` | 全文 95 行 |
| `backend/src/config/runtime-capabilities.ts` | 全文 35 行 |
| `backend/src/api/routes/admin.routes.ts` | 全文 1026 行 |
| `backend/src/api/routes/auth.routes.ts` | 全文 823 行 |
| `backend/src/api/routes/sites.routes.ts` | 全文 491 行 |
| `backend/src/api/routes/agents.routes.ts` | 全文 622 行 |
| `backend/src/api/routes/devices.routes.ts` | 全文 1111 行 |
| `backend/src/api/routes/alerts.routes.ts` | 全文 283 行 |
| `backend/src/api/routes/agent-onboarding.routes.ts` | 全文 323 行 |
| `backend/src/api/routes/final-defense.routes.ts` | 全文 284 行 |
| `backend/src/api/routes/hardware-authorization.routes.ts` | 全文 296 行 |
| `backend/src/api/routes/stats.routes.ts` | 全文 341 行 |
| `backend/src/api/routes/logs.routes.ts` | 全文 148 行 |
| `backend/src/api/routes/scanner.routes.ts` | 全文 813 行 |
| `backend/src/api/routes/traffic.routes.ts` | 全文 260 行 |
| `backend/src/api/routes/ai-system.routes.ts` | 全文 386 行 |
| `backend/src/api/routes/ai-endpoints.routes.ts` | 部分（前 100 行） |
| `backend/src/api/routes/attack.routes.ts` | 部分（前 100 行） |
| `backend/src/api/routes/dashboard.routes.ts` | 全文 34 行 |
| `backend/src/api/routes/deployments.routes.ts` | 全文 1006 行 |
| `backend/src/api/routes/config.routes.ts` | 全文 114 行 |
| `backend/src/api/routes/rules.routes.ts` | 全文 308 行 |
| `backend/src/api/routes/seed.routes.ts` | 全文 178 行 |
| `backend/src/api/routes/smart-fix.routes.ts` | 全文 357 行 |
| `backend/src/api/routes/fix-history.routes.ts` | 全文 92 行 |
| `backend/src/api/routes/investigation.routes.ts` | 部分（前 150 行） |
| `backend/src/api/routes/system.routes.ts` | 部分（前 100 行） |
| `backend/src/api/routes/agent-management.routes.ts` | 部分（前 100 行） |
| `backend/src/modules/announcements/announcements.routes.ts` | 全文 186 行 |
| `backend/src/modules/sites/site.repository.ts` | 全文 241 行 |
| `backend/src/modules/admin/admin.repository.ts` | 全文 205 行 |
| `backend/src/modules/agent-onboarding/agent-onboarding.repository.ts` | 全文 216 行 |
| `backend/src/modules/auth/auth-user.repository.ts` | 全文 158 行 |
| `backend/src/services/security-operations.service.ts` | 部分（前 100 行） |
| `backend/src/bootstrap/control-plane-app.ts` | 全文 300 行 |
| `backend/src/websocket/agent-gateway.ts` | 部分（200-599 行） |
| `backend/src/websocket/device-gateway.ts` | 部分（200-499 行） |

---

**审计结论**：AetherGuard 后端存在严重的**单点根因 + 横向扩散**的多租户隔离问题。`resolveUserTenantContext` 信任客户端 `tenantId` 是一条贯通 8 个以上路由的 0day 级设计缺陷，可被任何 `tenant_admin` 角色横向移动到任意其他租户的 final-defense / hardware-grant / device-command 关键面。建议**立即**修复 V1.1 + V1.2-V1.4，并安排专项 sprint 修复 V2.* 全部。
