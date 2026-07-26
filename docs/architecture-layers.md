# AetherGuard 程序层级与请求生命周期（权威梳理）

- Date: 2026-07-08
- 目的：把"前端 → 后端 → 数据库"与"控制面 → 硬件"的每一跳定死在具体文件，消除层级模糊。任何新代码先在这张图上找到自己的层，再动手。
- 强制手段：层级不是约定而是 guard —— 违反会被 `scripts/guards/*.mjs` 拦截（见 §5）。

## 1. 分层总图（自上而下，依赖只允许向下）

```
┌─ L0 浏览器/操作员 ──────────────────────────────────────────────┐
│  React pages (frontend/src/pages) + contexts (App.tsx 组合)      │
├─ L1 前端 API 客户端（唯一出口）──────────────────────────────────┤
│  frontend/src/services/api.ts                                    │
│  fetchWithCredentials / unwrapApiEnvelope / extractErrorMessage  │
├─ L2 网络边界 ────────────────────────────────────────────────────┤
│  dev: Vite proxy ─→ :3005 │ docker: nginx :8080 /api ─→ backend  │
├─ L3 HTTP 入口与横切中间件（顺序固定，见 §2）─────────────────────┤
│  backend/src/bootstrap/control-plane-app.ts（规范 app 构造器）    │
├─ L4 路由层（无业务、无 DB）─────────────────────────────────────┤
│  backend/src/api/routes/*.routes.ts → sendSuccess/sendError      │
├─ L5 服务层（业务与安全语义）────────────────────────────────────┤
│  backend/src/services/*.service.ts, security/, ai-agents/        │
├─ L6 仓储层（唯一 SQL 所在地）───────────────────────────────────┤
│  backend/src/modules/*/…repository.ts, repositories/             │
├─ L7 数据层 ─────────────────────────────────────────────────────┤
│  config/database.ts（better-sqlite3 运行时 / sql.js 测试）        │
│  postgres-shadow-store.service.ts（仅 ShadowTable，不含 hardware_*）│
└──────────────────────────────────────────────────────────────────┘
   旁路（不经 L3–L4）：
   - WebSocket: websocket/agent-gateway.ts, device-gateway.ts（自带鉴权/HMAC）
   - 硬件控制环: services/final-defense.service.ts → companion/gateway-daemon.ts(M1)
     → firmware M2 → SE M3 → interlock M4（串口 newline-JSON）
   - 救援控制面: rescue/（独立进程，禁止挂进本表任何一层，见 ADR 2026-07-08）
```

**方向规则**：L(n) 只能调 L(n+1)；跨层直调（route→DB、前端组件→fetch）都是违规。反向依赖（service 引 route）禁止。

## 2. 一次登录请求的完整生命周期（file:line 锚点）

1. 前端提交 → `api.ts` 的 login 函数（携 `credentials:'include'`）。
2. 代理：dev 走 Vite proxy；docker 走 nginx `:8080 → backend:3005`。
3. `control-plane-app.ts` 中间件链（顺序即行为，改动须过 `control-plane-app.test.ts`）：
   cors(:102) → helmet(:124) → compression → cookieParser → requestTiming → 原型污染前置守卫(:135) → metrics → body 解析(json 25mb, :148) → 原型污染后置守卫 → **到达日志 logger.info(:157，运维判断"到没到后端"的唯一锚点)** → `/api` 挂 apiRateLimit(:196) → `/api/health*`(:204, 不受 apiEnabled 门控) → apiEnabled 门(:263) → apiTrafficShadow(:264, auth 路径经 `isAuthPipelineBypass` 豁免；非 auth 路径检测管线异常时 **fail-closed 503**) → authRouter(:278)。
4. `auth.routes.ts:215` POST /login：authRateLimit → 锁定检查 → 用户查询（L6 `auth-user.repository.ts`）→ 密码验证 → 签发 httpOnly cookie（`buildCookieOptions`，sameSite=strict）→ `touchAuthUserLastLogin`（失败=500）+ `recordLoginHistory`（失败仅 warn，不阻断）→ 审计。
5. 会话判定：前端不读 cookie（httpOnly），靠 `GET /api/auth/me` 回答"我登录了吗"。

**排障口径**：症状"登录没反应" → 先看后端到达日志有没有那一行。有 = 中间件/handler 段问题（看响应码：429 限流 / 503 检测管线或黑名单 fail-closed / 404 apiEnabled 关）；没有 = L2 段问题（代理、端口、进程是旧构建）。2026-07-08 实测案例：3005 上 docker 容器跑 `bc034f9` 之前的旧镜像导致 `/api/*` 全部挂起，HEAD 重建后登录 1.2s 返回 401/200——**"后端没收到"优先怀疑跑的不是当前代码**。

## 3. 硬件控制环层级（与 HTTP 栈平行，不共享中间件）

```
final-defense.service.ts（policyDigest 计算/会话编排）
  → hardware-authorization.service.ts（grant 签名/monotonic counter 高水位·持久）
  → device-control.service.ts（只 dispatch，无 clamp/estop——安全全在授权链）
  → companion/gateway-daemon.ts  M1（桥状态机，内存高水位）
  → firmware controller_tasks.c  M2（challenge 环形窗/digest strcmp/counter>/expiry）
  → se_driver.c                  M3（OPTIGA 桩：签名/counter 返回 false=fail-closed，集成待硬件）
  → interlock 继电器             M4（feedback 反读）
```
三套 counter 高水位互不共享、各自严格 `>`；digest 逐字 `===` 跨 4 服务。此环的不变量清单见 CLAUDE.md《安全控制流不变量》，本文不复制。

## 4. 各层禁止事项（历史踩坑固化）

| 层 | 禁止 | 强制来源 |
| --- | --- | --- |
| L0/L1 | 组件内直接 fetch/axios | check-no-direct-api-fetch.mjs |
| L1 | 调用未注册的后端路由 | check-frontend-api-contract.mjs |
| L4 | route 内 SQL/prepare/ensureSchema | check-route-db-access.mjs |
| L4 | 自造响应格式（必须 envelope） | api-envelope ADR + 路由测试 |
| L5 | request handler 里 `ensureSchema()` | CLAUDE.md（表在 persistence.ts 启动期 prepare） |
| L7 | 运行中直改 SQLite 文件 | sql.js 30s 落盘会覆盖 |
| 旁路 | 测试/embedding 绕过 `createControlPlaneApp()` 直 new Express | startup-entrypoint ADR |
| rescue | 出现 release 帧字符串 | check-rescue-no-release.mjs |

## 5. 层级的机械校验

```bash
node scripts/guards/check-route-db-access.mjs
node scripts/guards/check-no-direct-api-fetch.mjs
node scripts/guards/check-frontend-api-contract.mjs
node scripts/guards/check-repository-hygiene.mjs
node scripts/guards/check-rescue-no-release.mjs
```

新增层级规则时：先在本文登记，再写 guard，最后才写业务代码。只有文档没有 guard 的规则视为"愿望"，不算层级。
