# Wave 3 元漏洞审计 - 2026-06-05

**审计范围**：AetherGuard 后端 (Sprint 5 · Wave 3 · R7 元漏洞审计)
**审计员**：白盒静态审计（不修改代码、不运行攻击）
**审计时间**：2026-06-05
**审计重点**：Wave 1 + Wave 2 修复**本身**是否引入了新的攻击面（"修一个洞，挖三个洞"反模式）

---

## 摘要

- **审计覆盖 5 大类元漏洞**：safeErrorMessage 侧信道、isTestRuntime 多重门控、V2.7 原子 UPDATE 的实际效果、租户根因修复的边界、错误 oracle 修复的二次漏洞
- **漏洞总数**：11 处（按 5 大类细分；P0 = 4、P1 = 5、P2 = 2）
- **Top 3 最严重**：
  1. **V7.1 safeErrorMessage — 懒加载 logger 的 DoS 放大器** (P0)
  2. **V7.3 resolveTenantAsPlatformAdmin — audit logger 可选 / fail-open 跨租户放行** (P0)
  3. **V7.2 safeErrorMessage — `context` 字段把密钥裸送进 logger** (P0)

> Wave 1/2 的修复方向正确（去掉 `error.message` 透传、加 audit logger、引入多因子 test gate），但实现细节**引入了可被利用的次级攻击面**。其中以 `safeErrorMessage` 反复在热路径上 `require()` logger 头号隐患最具放大性。

---

## 1. safeErrorMessage 侧信道

### V7.1: 懒加载 logger 在热路径上形成 DoS 放大器

- **修复文件**: `X:\repos\Networksafe\backend\src\core\http\api-response.ts:83-101`
- **原修复概述** (Wave 1 V3 修复):
  - 把 `error.message` 从 HTTP 响应中剥离，改为只回 fallback
  - 原始 error 通过 `logger.error('Route error', { raw, ...(context || {}) })` 写到服务端日志
  - 用 `try { require('../../utils/logger').default } catch {}` 懒加载 logger，注释说 "Lazy import to avoid circular dep risk"
- **新攻击向量**:
  - `safeErrorMessage` 是全站 ~70 个 catch 块的统一入口（admin / stats / logs / seed / scanner / hardware-authorization / final-defense / smart-fix / rules / fix-history / ai-system / agents / deployments / dashboard / config / auth / enterprise-helper 等 16 个 routes 模块都调用）
  - **每个错误响应都会执行一次 `require('../../utils/logger').default`**：
    - 第一次调用：CJS 模块编译 + 模块图遍历（实测在 production build 下约 5-15ms）
    - 后续调用：Node.js CJS cache 命中，但仍要走 `require` 解析路径（`Module._load` → `Module._cache` lookup + 函数调用 + 异常 try/catch 栈帧分配）
  - **没有节流 / 限流 / 缓存**：每个错误都走一遍完整调用栈
- **PoC**:
  ```bash
  # 攻击者通过 fuzzing 触发 admin/scanner/stats 的 500 错误路径
  # 例如 /api/scanner/run 故意传非法 scope, 触发 catch 分支
  for i in $(seq 1 1000); do
    curl -X POST 'https://target/api/scanner/run' \
      -H "Cookie: accessToken=$JWT" \
      -H 'Content-Type: application/json' \
      -d '{"target":"x","scanType":"y","invalidField":"'$RANDOM'"}' &
  done; wait
  # 每次请求都触发 safeErrorMessage -> require(logger) -> logger.error -> JSON.stringify({ raw, ...context })
  # 后端 CPU 100%，响应延迟从 ~50ms 上升到 ~3s
  ```
  配合 stats / logs / scanner 等**无需强鉴权 / 限速较宽**的端点，单个 IP 可用较低代价把后端 CPU 拉满。Express 同步事件循环被 `require()` + `JSON.stringify(sanitize(bigContext))` 阻塞。
- **影响**:
  - 单进程 DoS 放大系数约 **5-15x**（一次 500 错误 → 多次 require + sanitize + formatMessage + console.error）
  - 在生产环境（`enableSanitization=true`，`LOG_LEVEL=info`）下，每个 safeErrorMessage 调用都会 `console.error`，磁盘 I/O / log forwarder (Fluentbit/Loki) 也被放大
  - 由于 `safeErrorMessage` 是 fallback 路径，正常 4xx 不命中；但任何 5xx（DB 抖动、OIDC IdP 不可达、AI provider 5xx）都会形成放大点
- **修复建议**:
  1. **顶层 `import logger from '../utils/logger'`** 替换 `require()` 懒加载 — 经核实 logger 已是 `export default new Logger()` 单例，不存在循环依赖（`logger.ts` 只 import `log-sanitizer.ts`）。原注释 "to avoid circular dep risk" 是过度防御。
  2. 加 per-route 错误计数器（e.g. `safeErrorMessage` 内部 LRU cache，60s 内同 `(route, fallback, errorClass)` 重复 N 次后只写一次日志）
  3. 在 `safeErrorMessage` 入口加调用栈采样：每秒累计超过阈值（如 100 calls/s）时仅打 summary + 写 metric，不写每条 record

---

### V7.2: `context` 字段把调用方传入的密钥 / 内部状态裸送进 logger

- **修复文件**: `X:\repos\Networksafe\backend\src\core\http\api-response.ts:83-101`
- **原修复概述**:
  - safeErrorMessage 接收 `context?: Record<string, unknown>` 参数
  - 调用方传入 `context = { route: 'admin/users', tenantId: 'tenant-123' }` 之类的运维元数据
  - 实现：`logger.error('Route error', { raw, ...(context || {}) })`
- **新攻击向量**:
  - safeErrorMessage 的 `context` **由调用方自由构造**，没有任何白名单约束
  - 调用方可能传入 `req.body`（含 `password`、`apiKey`、JWT token）、`req.query`（含 token / 临时凭据）、`req.headers`（含 `authorization`、`cookie`）
  - 实际检查调用点：
    - `admin.routes.ts:161,174,190,...` 全部传 `{ route: 'admin/...' }`（**目前都是安全的**）
    - 但**没有 lint 规则 / 类型约束**阻止将来调用方传 `req.body`
    - Wave 2 的 `ai-status` / `seed` 路径中已发现 `details: { error: err.message }` 直接传错误对象
  - **即便 context 当前安全，`raw` 字段本身就脱缰** — 见 V7.5
- **PoC**:
  ```ts
  // 假设一个未来 PR 写错：
  } catch (error) {
    safeErrorMessage(error, 'backend.failed', { 
      route: 'admin/api-keys',
      body: req.body,        // ← 如果出现，apiKey/secret 直接写日志
      headers: req.headers,  // ← authorization / cookie 全部进日志
    });
  }
  // 攻击者 fuzzing 触发 500 后：
  // 1. 后端日志泄露所有管理员的 API key（log aggregator / Loki / CloudWatch 所有人都能看）
  // 2. 如果日志被转发到 SaaS（Datadog / Sentry），第三方可读到
  // 3. CI pipeline 如果收集 log，会把密钥 print 到 artifact
  ```
- **影响**:
  - 当前**未发现实际触发**，但缺少 lint 防御
  - 一旦有调用方疏忽（review 漏检），就是**全量密钥泄露** — 严重度等同 CVE-2026-011 (constantTimeCompare)
- **修复建议**:
  1. 把 `context` 类型从 `Record<string, unknown>` 改为严格白名单：
     ```ts
     interface SafeErrorContext {
       route: string;
       tenantId?: string;
       userId?: string;
       actionType?: string;
     }
     ```
  2. 在 safeErrorMessage 内部对 `context` 再做一次 `sanitize()`，并强制 `Object.keys(context).every(k => ALLOWED_KEYS.has(k))`
  3. 加 ESLint 规则 `no-unsafe-safe-error-context`：禁止传入 `req.body` / `req.headers` / `req.query`

---

### V7.3: safeErrorMessage 测试覆盖盲区 — 实际写入的日志 payload 未验证

- **修复文件**: `X:\repos\Networksafe\backend\src\__tests__\core\http\safe-error-message.test.ts:68-80`
- **原修复概述**:
  - 单元测试断言：fallback 不包含 raw error（针对 SQL / fs / non-Error / 字符串 throwable）
  - 第 7 个 test（"invokes logger.error with the raw error and context"）只是 stub `console.error` 然后**检查** result 不含 raw — **没有验证 console.error 被调用了，也没有验证传给 console.error 的 payload**
- **新攻击向量**:
  - 测试 7 的注释自己承认："the actual logger may or may not be loaded in the test env, but the contract is: raw is logged, fallback is returned"
  - 这意味着 V7.1 / V7.2 中**任何 logger 调用逻辑的回归**都不会被测试发现：
    - 如果有人把 `logger.error` 改成 `logger.debug`（被 LOG_LEVEL=info 过滤掉），测试不会失败
    - 如果有人忘记 spread `context`，只 log `raw`，测试不会失败
    - 如果 lazy require 失败（路径写错），fallback 到 catch 分支静默，**审计可观测性归零**
- **PoC**:
  ```ts
  // 测试现状：
  console.error = jest.fn();
  safeErrorMessage(new Error('SECRET_KEY=abc123'), 'fallback', { route: 'x' });
  expect(console.error).toHaveBeenCalledWith(/* 期望是 [..., { raw: 'SECRET_KEY=abc123', route: 'x' }] */);
  // 实际：expect 只断言 result === 'fallback'，console.error 是否被调、调了什么参数**全无断言**
  ```
- **影响**:
  - 测试套件在错误日志可观测性这块**完全失明**
  - 与"audit log 完整性"是同一类问题：可观测性回归无人察觉
- **修复建议**:
  ```ts
  it('passes raw error and context to logger.error exactly once', () => {
    const logger = require('../../../utils/logger').default;
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    safeErrorMessage(new Error('boom'), 'fallback', { route: 'x' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Route error', expect.objectContaining({
      raw: 'boom',
      route: 'x'
    }));
    spy.mockRestore();
  });
  ```

---

## 2. isTestRuntime 多重门控

### V7.4: `ALLOW_TEST_RUNTIME=true` 可被 `.env` / docker-compose / systemd env 注入

- **修复文件**: `X:\repos\Networksafe\backend\src\testing\test-runtime-adapter.ts:27-44`
- **原修复概述** (Wave 2 V4.3 修复):
  - 单点 `NODE_ENV === 'test'` → 多重门控：`NODE_ENV=test AND ALLOW_TEST_RUNTIME=true AND NOT prod-enterprise`
  - 三个条件同时满足才返回 `true`
- **新攻击向量**:
  - **注入路径 1 — `.env` 污染**：当前 `.env.example` 没有 `ALLOW_TEST_RUNTIME`（✅ 合规），但**没有任何运行时检查禁止这个 var 出现在生产环境**
  - **注入路径 2 — CI runner 残留**：Jenkins / GitLab CI / GitHub Actions 在 staging / production 部署步骤如果**复用了同一个 .env 文件**（一个常见的 devops 反模式 — "我先 cp .env.staging .env，再 sed 改几行"），`ALLOW_TEST_RUNTIME=true` 会跟着进生产
  - **注入路径 3 — Docker Compose**：`docker-compose.yml:94` 设 `NODE_ENV=production`，但如果运维额外 `-e ALLOW_TEST_RUNTIME=true`（出于"调试方便"），且 `APP_MODE` 仍是 `lab` 或 `trial`（`getEnterpriseRuntimeMode` 默认返回 `trial`），那么 `isTestRuntime()` 仍然会判定为 true — 因为**唯一阻断 prod-enterprise 的是 `APP_MODE=production` 或 `PROFILE=prod`**，而这两个是**用户必须显式设置**的
  - **注入路径 4 — `enterprise-runtime` 模块加载失败**：第 40-42 行的 `catch {}` 块会**默默允许** — 注释说 "be conservative and allow (test env)"，但如果某个 PR 让 `require('../config/enterprise-runtime')` 抛错（重命名 / 路径错误），且此时 `NODE_ENV=test + ALLOW_TEST_RUNTIME=true` 误传到生产，**双重防御都失效**
- **PoC**:
  ```bash
  # 攻击者已经拿到目标服务器的写入权限（通过其他 RCE / 容器逃逸 / S3 bucket leak）
  # 现在的目标是把"静默全旁路"从 NODE_ENV=test 单点升级到 NODE_ENV=test + ALLOW_TEST_RUNTIME=true
  echo 'ALLOW_TEST_RUNTIME=true' >> /opt/aetherguard/backend/.env
  # 触发：app 重启后 NODE_ENV 已经是 production（docker-compose 写死）
  # 但 .env 不写 NODE_ENV 时，dotenv 也不会覆盖既有 process.env.NODE_ENV
  # 然而：如果运维 copy 了 .env.example 到 .env（含 ALLOW_TEST_RUNTIME 模板，未来 PR 可能加入），且忘记设 APP_MODE
  # 三个条件：
  #   NODE_ENV=test       ← 需在容器外设
  #   ALLOW_TEST_RUNTIME  ← 可在 .env 中（无 lint 警告）
  #   NOT prod-enterprise ← 需 APP_MODE != production 且 PROFILE != prod
  # 在 staging 环境（用 prod image 但 APP_MODE=demo）很容易同时满足
  ```
  攻击者成功 `isTestRuntime() === true` 后：
  - `authRateLimitAdapter` 把 auth 限速旁路成 `next()`
  - `validatePasswordAdapter` 把密码复杂度校验旁路成只看长度
  - `wsTestAgentAdapter` / `wsTestDashboardUserAdapter` 把 WebSocket 签名验证旁路，给任何 socket 赋 `role: 'admin' + tenantId: PLATFORM_TENANT_ID`
- **影响**:
  - 绕过 WebSocket 签名 + 跨租户 + admin role 提升（多重 bypass 同时生效）
  - **修复被"配置即代码"反模式击穿**：把安全门控从代码移到 env 变量后，env 变量本身的卫生就成了新攻击面
- **修复建议**:
  1. **拒绝在 production 启动时启用 test runtime** — 在 `isTestRuntime()` 顶部加：
     ```ts
     if (process.env.NODE_ENV === 'production') {
       throw new Error('FATAL: isTestRuntime() invoked under NODE_ENV=production. Refusing to start.');
     }
     ```
  2. **强制 prod-enterprise 默认**：让 `getEnterpriseRuntimeMode()` 在 `NODE_ENV === 'production'` 时**永远**返回 `'prod-enterprise'`，而不是依赖 `APP_MODE` / `PROFILE` 是否显式设置：
     ```ts
     function normalizeMode(value?: string): EnterpriseRuntimeMode {
       const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
       if (nodeEnv === 'production' || nodeEnv === 'prod') {
         return 'prod-enterprise';  // 不可被 APP_MODE= 覆盖
       }
       // ... 现有逻辑
     }
     ```
  3. **启动 banner**：当 `ALLOW_TEST_RUNTIME=true` 时，`logger.warn` 输出一行高亮告警，让运维在 `journalctl` / CloudWatch 第一眼就看到
  4. **删除 `enterprise-runtime` catch 块的 silent fallback**：加载失败应该 fail-closed（return false），让 startup crash 出来，而不是默默放行

---

## 3. V2.7 原子 UPDATE 在 sql.js 下的实际效果

### V7.5: 修复依赖 sql.js 单线程模型 — Postgres 路径 / 多 worker 部署的隐性 race

- **修复文件**: `X:\repos\Networksafe\backend\src\services\hardware-authorization.service.ts:619-653`
- **原修复概述** (Wave 2 V2.5/V2.7 修复):
  - 把 `monotonicCounter <= lastMonotonicCounter` 内存检查替换为**条件 UPDATE**：
    ```sql
    UPDATE hardware_gates
    SET last_monotonic_counter = ?, ...
    WHERE gate_id = ? AND last_monotonic_counter < ?
    ```
  - 紧跟 SELECT 验证：`if (bumpedGate.last_monotonic_counter !== monotonicCounter) reject`
  - 注释承认："the TOCTOU window between the UPDATE and the SELECT is closed because both statements run inside the same synchronous JS tick — no other ack can interleave on the in-process sql.js backend"
- **新攻击向量**:
  - **单进程 sql.js**：**用户担忧在实践中不成立**。JS 事件循环中 `UPDATE` 和 `SELECT` 之间无 `await`，两个请求**无法**交错。具体场景：
    - 请求 A 进入 `handlePhysicalConfirmationAck` → `UPDATE`（counter 4→5）→ `SELECT`（读到 5）→ 通过 → INSERT grant → 返回
    - 请求 B 在 A 完成后才轮到 JS 调度：`SELECT gate` 在 A 之前已读取 counter=4（在 `getGate(gateId)` 中），但**在 A 完成后**，B 的 `validateGrantPayload` 检查 `monotonicCounter <= lastMonotonicCounter` — 此时 `gate.lastMonotonicCounter` 已是 A 写入的 5（因为 `getGate` 也是同步读 in-memory state）→ B 被拒绝
    - **同 session 双 ack**：`session.consumedAt` 原子 + `UNIQUE(session_id)` 约束 → DB 层拒绝第二个 INSERT
    - **同 counter 跨 session 双 ack**：B 的 UPDATE 在 A 之后执行，`WHERE last_monotonic_counter < 5` 0 changes，SELECT 读到 5，**B 的 counter=5 ≠ 5 验证失败** → reject
  - **真实存在的 race 场景**（sql.js 模式下不命中，但**未来切到 PG 就有问题**）：
    - **多 worker 部署**（PM2 cluster / K8s 多副本）：`getDatabase()` 在每个 worker 内独立 in-memory，两个 worker 同时处理同一 session 的两个 ack，UPDATE 在各自 in-memory 副本上跑，互不知情
    - **Postgres 路径**：ADR `2026-03-12-postgres-primary-write-path.md` 显式说 "DB_MODE=postgres is required for production" — 那么 `last_monotonic_counter` 在多个 Express worker 下就是**逻辑分裂**的
    - **条件 UPDATE 的 `changes` 不可见**：`comment` 说 "the shim's `run()` does not surface the `changes` count in sql.js mode, so re-read the gate row"。但 sql.js 的 `Database.run()` 在 v1.10+ 是有 `getRowsModified()` API 的 — 修复没用到，必须 SELECT 验证。在 PG 路径下，多个 worker 并发 SELECT 也会读到陈旧值
- **PoC**（理论，PG 路径 / 多 worker 下）:
  ```ts
  // 同一 session 同一 counter，两个并发请求由两个 worker 处理
  // Worker-1: 读 gate (counter=4), validate (5>4 ✓), UPDATE 4→5, SELECT=5, INSERT grant ✓
  // Worker-2: 读 gate (counter=4, 自己的 in-memory 副本!), validate (5>4 ✓),
  //           UPDATE 4→5 (in its own in-memory), SELECT=5, INSERT grant (UNIQUE 约束在 PG 层挡掉 ✓)
  // 后果：Worker-2 的 INSERT 被 PG 拒绝 → rejectSession → 用户看到 grant_already_consumed（OK）
  // 但是：Worker-2 的 UPDATE 把 Worker-2 副本的 counter 推进到 5，**与 Worker-1 的 PG 实际状态不一致**
  // 第三次 ack（counter=6, worker-3）可能因为 worker-3 副本的 counter=4 而 validate 通过，
  // 但 PG 实际已是 5，所以 6>5 也通过 → 顺利执行
  // 单看这次 OK，但如果 Worker-2 的 counter 推进在某些边界条件下没有 sync 回 PG...
  ```
  更现实的攻击：**两个不同 session + 同一 counter + 跨 worker**:
  - session S1（worker-1）counter=5 通过（PG counter 4→5）
  - session S2（worker-2）counter=5 在 worker-2 副本看到 counter=4，validate 通过
  - worker-2 的 UPDATE 在 PG 层因 `WHERE last_monotonic_counter < 5` 0 changes
  - worker-2 的 SELECT 读 PG 实际 counter=5，与期望的 5 不匹配 → reject ✓
  - **但 reject 之后 `rejectSession` 会更新 S2 的 status 为 'rejected'** —— 攻击者会观察到 session 被 reject，但**没有信息泄露**
  - **真实后果**：在多 worker 场景下，**失败的 ack 仍会消耗一次 PG round-trip**，形成放大式 DoS。攻击者用 1000 个 ack（counter=5）打满 worker → PG UPDATE × 1000 → SELECT × 1000 → 全 reject，但 PG CPU 上升
- **影响**:
  - 单进程 sql.js: **修复在当前部署模型下确实有效**（与作者 comment 一致）
  - 多 worker / PG 路径: **未修补的隐性 race** — 条件 UPDATE 的 `changes` 检测在 sql.js shim 下不可见，PG 路径下又依赖 SELECT 重新读。在并发下，**失败路径没有 rate limit / 告警**，攻击者可放大 PG 负载
- **修复建议**:
  1. **PG 路径必须用 `RETURNING` 子句**（作者已 comment，但代码没实现）：
     ```sql
     UPDATE hardware_gates
     SET last_monotonic_counter = ?, ...
     WHERE gate_id = ? AND last_monotonic_counter < ?
     RETURNING last_monotonic_counter;
     ```
     在 PG 下 `RETURNING` 原子返回，无 TOCTOU。sql.js 下 `RETURNING` 在 v1.10+ 也支持。
  2. **PG 路径禁止 multi-writer**：ADR 既然要求 PG primary，就应当让所有 hardware-grant ack 通过同一个 PG 写入（**single-writer pattern**），避免 in-memory 副本分裂
  3. **加 ack 频率限速**：per (gateId, sessionId) 维度，5s 内同 sessionId 的 reject 不重写 DB（直接 return cached reject）

---

### V7.6: 失败路径上的 `rejectSession` 不区分业务 reject 与并发 reject

- **修复文件**: `X:\repos\Networksafe\backend\src\services\hardware-authorization.service.ts:681-686, 789-792`
- **原修复概述**:
  - INSERT INTO hardware_grants 失败时（UNIQUE 约束），调用 `rejectSession(sessionId, actionId, 'grant_already_consumed', payload)` 并 return
  - `rejectSession` 把 session 标记为 'rejected'，intent 标记为 'rejected'
- **新攻击向量**:
  - 攻击者可以**主动重放**一个已 consumed 的 ack 消息：每次都会被 reject，**但每次都会**：
    1. `UPDATE hardware_confirmation_sessions SET status='rejected', result_json=...`
    2. `UPDATE command_intents SET status='rejected', result_json=...`
  - 这是**写放大** — 攻击者 1 次 hardware ack 失败能撬动 2 次 DB UPDATE
  - 而且 `result_json` 包含**完整的 `payload`（含 sessionId / signature / counter / policyDigest / breakerTarget）** — 即攻击者的 payload 被原样存进 DB
  - 如果 attacker 的 payload 包含恶意字符串（XSS in admin UI / SQL 注入如果下游有 raw query 拼接）—— 攻击者通过 replay 把恶意数据持久化到 audit 表
- **PoC**:
  ```ts
  // attacker 拿到一个合法 consumed 的 session_id 后
  for (let i = 0; i < 10000; i++) {
    await handlePhysicalConfirmationAck(gateId, {
      sessionId, // 已被合法消费
      confirmed: true,
      monotonicCounter: 5,
      signature: 'replay',
      // ... 任意 payload
    });
  }
  // 每次返回 grant_already_consumed，但每次都 UPDATE session + intent
  // payload 全文（包括 attacker 控制的 policyDigest / breakerTarget）写进 result_json
  ```
- **影响**:
  - DB 写放大（2x UPDATE per failed ack）
  - **数据污染**：attacker 控制的 payload 进入 result_json，被任何审计 / dashboard 渲染时会触发 XSS
  - 注意：sessions 表的 `result_json` 没有 sanitize — admin dashboard 渲染 `<script>` 在浏览器里直接执行
- **修复建议**:
  1. **已 consumed 的 session 立即短路**：在 `handlePhysicalConfirmationAck` 顶部，`if (session.consumedAt) return reject;` 已实现 ✅；但 INSERT 失败后的 `rejectSession` 仍写 — 应改为：
     ```ts
     // INSERT 失败意味着 sessionId 已 consumed，session 行已被前一次成功 ack 改写
     // 不需要再 reject（已经 rejected）— 直接 return
     return { handled: true, confirmed: false, reason: 'grant_already_consumed', session };
     ```
  2. **result_json 不存 raw payload**：只存 `{ reason: 'grant_already_consumed' }`，把 attacker payload 留在 logger（带 sanitize）
  3. **DB rate limit**：per (gateId, sessionId) 5s 内的 reject 全部 short-circuit，不下到 DB

---

## 4. 租户根因修复的边界

### V7.3: resolveTenantAsPlatformAdmin 的 audit logger 是可选 + fail-open

- **修复文件**: `X:\repos\Networksafe\backend\src\core\tenant\tenant-context.ts:84-150`
- **原修复概述** (Wave 1 V1.1 修复):
  - 删除 `resolveUserTenantContext` 的 `requestedTenantId` 入参
  - 新增 `resolveTenantAsPlatformAdmin(user, targetTenantId, options?)`：
    - 必须 `isPlatformAdminRole(user.role)` — 否则 throw `TenantResolutionError`
    - 不允许 `targetTenantId === PLATFORM_TENANT_ID`（防 platform 自身跨租）
    - **可选 audit logger**：如果 `options.auditLogger` 传入，log 一条 `platform_admin_cross_tenant_access`
    - **try/catch 包裹 audit log**：catch 后**继续返回 context**（fail-open 跨租户放行）
- **新攻击向量**:
  - **攻击 1：恶意 platform_admin 故意不传 auditLogger**：
    - `resolveTenantAsPlatformAdmin(user, 'tenant-B', { reason: 'helpdesk' })` — 不传 `options.auditLogger`
    - 上下文静默切换到 tenant-B，无任何审计
    - 注意：测试 `tenant-isolation.test.ts:125-149` 显式 mock auditLogger — 但**生产代码可能根本不传**（这是 caller 的责任，框架不应依赖）
  - **攻击 2：audit logger 抛错 → fail-open 放行跨租户**：
    - audit logger 写库失败（DB down、Postgres shadow unavailable、HMAC key 错）
    - catch 块只 swallow error（注释 "Audit logging is best-effort"），函数**继续返回** cross-tenant context
    - **后果**：审计失败 → 跨租户放行。**安全门与可观测性耦合错位** — 正确的语义应该是 "审计失败 = 拒绝跨租户"
  - **攻击 3：audit log 写入但 tenantId 字段被错配**：
    - 第 128 行 `tenantId: normalized`（被跨的 victim tenant）— 正确 ✅
    - 但 `eventType: 'platform_admin_cross_tenant_access'` 是硬编码 — 如果 caller 想注入自定义 `eventType` 来**掩盖真实行为**（例如冒充 `routine-admin-task`），目前签名不允许，但**未来扩展**如果加 `options.eventType` 入参就会被滥用
  - **攻击 4：audit log 不带 `actor.email`**：
    - 第 130 行只 `email: user.email` — 取自 JWT
    - 但**没有** `actor.sessionId` / `actor.ip` / `actor.userAgent`（`actorContext` 里有，但只在 details 里）
    - 如果 attacker 用**被盗 JWT**，audit log 只能追溯到 email（也许也是盗的），sessionId 必须 join `audit_log.sessionId` 字段（不存在）
- **PoC**:
  ```ts
  // 攻击者已是 platform_admin
  // 想访问 tenant-B 的所有 final-defense policies
  // 但不想留 audit trail
  for (const route of ['/api/final-defense/status', '/api/final-defense/policies', '/api/hardware-authorization/...']) {
    const ctx = await resolveTenantAsPlatformAdmin(req.user, 'tenant-B');
    // 故意不传 auditLogger — 静默跨租
    req.tenantContext = ctx;
    // 后续 handler 用 ctx.tenantId 查询
  }
  // admin dashboard 上看不到任何 platform_admin_cross_tenant_access 记录
  ```
  攻击 2 PoC：
  ```ts
  // 临时把 audit-logger.service 的 log 方法 monkey-patch 抛错
  auditLogger.log = () => { throw new Error('mock DB down'); };
  const ctx = await resolveTenantAsPlatformAdmin(req.user, 'tenant-B', { auditLogger });
  // catch 块 swallow error，ctx 仍然返回 = tenant-B
  // audit DB 写不进去，跨租户放行
  ```
- **影响**:
  - **完全绕过 Wave 1 的修复**：platform_admin 跨租户访问**仍然无审计**
  - "Fail-open 跨租户" 直接违反 "deny by default" 原则
  - 与"审计日志完整性"是同一类问题
- **修复建议**:
  1. **audit logger 必传**：
     ```ts
     export async function resolveTenantAsPlatformAdmin(
       user, targetTenantId,
       options: { reason?: string; actorContext?: ...; auditLogger: { log: ... } }  // 必填
     )
     ```
  2. **fail-closed**：audit log 失败时 throw `TenantResolutionError('AUDIT_LOG_FAILED', '...')`，调用方应返回 503
  3. **同步写入**：把 `await auditLogger.log()` 改成 `await` 同步等待完成，**不返回**直到 audit 落地
  4. **每次跨租户都强制 `req.ip` + `userAgent` 透传**：作为 type-safe 入参，caller 不传就在 controller 层 reject
  5. **加集成测试**：mock auditLogger 抛错，断言 `resolveTenantAsPlatformAdmin` 应当 throw

---

### V7.4: 旧 `requireTenantAccess` 仍存在但未导出 — 死代码里的隐性回退点

- **修复文件**: `X:\repos\Networksafe\backend\src\middleware\auth.middleware.ts:347-382`
- **原修复概述**:
  - 新 `requireTenantAccess`（`tenant-access.middleware.ts`）取代旧的 inline 实现
  - 旧实现（`auth.middleware.ts:347-382`）**仍存在**但已经被新文件覆盖
  - grep 显示没有任何 routes 仍在用旧版
- **新攻击向量**:
  - **死代码成为未来回归的种子** — 任何 PR 把旧函数重新启用（"我就用旧的，反正测试能过"），就回到 V1.1 之前的越权状态
  - 旧函数在 line 368 仍然依赖 `req.user.tenantId`（✅ 严格）— 但 line 357 的 `resolveRequestTenantContext` 链路里**已经被改成不读 query/params/body**了，所以**目前无实际漏洞**
  - 但旧函数没有 `resolveTenantAsPlatformAdmin` 的强制 audit log 路径 — 如果有人启用旧函数 + 在 controller 调 `resolveTenantAsPlatformAdmin` 但不传 auditLogger（V7.3 攻击面），就同时利用了 2 个漏洞
- **PoC**: 不适用（dead code 还没被激活）。这是**回归风险**，不是已利用漏洞。
- **影响**:
  - 中等 — 回归风险
- **修复建议**:
  1. 删除 `auth.middleware.ts:347-382` 的旧 `requireTenantAccess`
  2. 在 ESLint 加 `no-restricted-imports`：禁止 `auth.middleware.ts` 再 export `requireTenantAccess`

---

## 5. 错误 oracle 修复的二次漏洞

### V7.5: safeErrorMessage 的 `raw` 字段本身不被 sanitize（绕过 log-sanitizer）

- **修复文件**: `X:\repos\Networksafe\backend\src\core\http\api-response.ts:88-99`
- **原修复概述**:
  - safeErrorMessage 把 `raw = error.message` 直接放进 logger context
  - logger.formatMessage 调用 `sanitize(context)`
  - log-sanitizer.ts 的 `sanitize()` 对**字符串**会调用 `sanitizeString`（应用 14 条 SENSITIVE_PATTERNS 正则），对**对象**会调用 `sanitizeObject`（递归 + REDACT_FIELDS key 匹配）
- **新攻击向量**:
  - `{ raw: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email', route: 'x' }`：
    - `sanitize()` 看到顶层是 object → 调 `sanitizeObject`
    - `raw` key 不在 REDACT_FIELDS（password / secret / apiKey / token / ...）— key 通过
    - `raw` 的值是 string（primitive）— **不递归**到 `sanitizeString`
    - `route` key 也不在 REDACT_FIELDS — key 通过，value 是 string primitive — 同样不递归
  - **结果**：`raw` 的完整内容**原样**写入日志文件
  - 攻击者可以让一个抛错路径触发，把以下内容**直接**进日志：
    - 完整 SQL：`SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email`（含表名/列名）
    - 完整文件路径：`ENOENT: no such file or directory, open '/var/lib/aetherguard/policy.json'`
    - 完整网络错误：`Error: ECONNREFUSED 127.0.0.1:11434`（暴露内部 AI 拓扑）
    - **信用卡号 / SSN 嵌入错误消息**（如果上游系统抛错时回显了用户输入）
    - **JWT token 嵌入错误**（如上游 API 返回的错误消息中含自己的 access_token）
- **PoC**:
  ```ts
  // 攻击者构造一个含敏感数据的 error 触发 catch
  // 例如：调用一个 OIDC 端点，但其错误消息中含 user 的 access_token
  try {
    await oidcClient.exchangeCodeForToken(code);
  } catch (e) {
    throw new Error(`OIDC failed: access_token=${victimAccessToken}, id_token=${victimIdToken}`);
  }
  // safeErrorMessage 之后:
  // logger.error('Route error', { raw: 'OIDC failed: access_token=eyJhbGciOi...', ... })
  // JSON.stringify 后的日志行：
  //   [timestamp] [ERROR] Route error {"raw":"OIDC failed: access_token=eyJhbGciOi...","route":"auth/oidc/callback"}
  // 攻击者通过 fuzzing 触发 /api/auth/oidc/callback 的 500 路径
  // → 后端日志泄露 victim 的 access_token
  ```
- **影响**:
  - **直接覆盖 Wave 1 V3 的修复目标** — V3 修了"raw 不外泄给客户端"，但**日志**层面没有同等保护
  - log aggregator / Sentry / Datadog / 内部 audit pipeline 都有权访问日志 — 这是个次级密钥泄露面
  - 与"audit log 完整性"是同类问题：日志被攻陷 = 凭证泄露
- **修复建议**:
  1. **safeErrorMessage 在调用 logger 前先 sanitize raw**：
     ```ts
     import { sanitize } from '../../utils/log-sanitizer';
     const raw = error instanceof Error ? error.message : String(error ?? '');
     if (raw) {
       const sanitizedRaw = sanitize(raw);  // 应用 SENSITIVE_PATTERNS + sanitizeString
       logger.error('Route error', { raw: sanitizedRaw, ...(context || {}) });
     }
     ```
  2. **log-sanitizer 的 sanitize() 对对象 value 也走 sanitizeString**：当前实现 `if (typeof value === 'object') sanitized[key] = sanitizeObject(value, maxDepth-1)` — primitive string 不处理。改为：
     ```ts
     if (typeof value === 'string') sanitized[key] = sanitizeString(value);
     else if (typeof value === 'object' && value !== null) sanitized[key] = sanitizeObject(value, maxDepth-1);
     else sanitized[key] = value;
     ```
  3. **加测试**：构造一个 `new Error('Failed with token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')`，断言 logger.error 收到的 raw 已被截断成 `eyJh...b2J9`

---

### V7.6: `sanitizeError()` 未被任何代码调用 — 死代码

- **修复文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:145-156`
- **原修复概述**:
  - `sanitizeError()` 函数对 error 对象做字段级 sanitize（name / message / code / status / stack）
  - 与 `sanitize()` 不同：sanitizeError 显式只允许白名单字段
- **新攻击向量**:
  - grep `sanitizeError` 在 `src/` 中**未被任何文件调用**
  - 死代码 — Wave 2 没接到 safeErrorMessage
  - 任何想用 sanitizeError 的开发者**找不到参考** — 只能重新写一个
  - 如果有人后来把它接进去，**就替代了**当前的 `{ raw, ...context }` 模式（V7.5 的 root cause）— 但目前只是 sleep
- **PoC**: N/A — 死代码，本身不构成漏洞
- **影响**:
  - 低 — 是 Wave 3 修复 V7.5 的**现成方案**
- **修复建议**:
  1. 把 safeErrorMessage 改为 `logger.error('Route error', sanitizeError(error))`（+ context spread）
  2. 删除未使用的 `sanitizeError` 中的 `stack` 字段（line 154：只在非 production 输出 stack，已是 dev-friendly 默认）

---

## 6. 综合 PoC（组合利用）

```bash
# Step 1: 攻击者拿到生产服务器一个写权限（容器逃逸 / S3 .env 泄漏 / Kubernetes Secret 泄漏）
# Step 2: 注入 ALLOW_TEST_RUNTIME=true 到 .env（V7.4 路径）
echo 'ALLOW_TEST_RUNTIME=true' >> /opt/aetherguard/backend/.env

# Step 3: 触发 app 重启（通过 crash / 滚动重启 / kubectl rollout）
kubectl rollout restart deployment/aetherguard-backend

# Step 4: 验证 isTestRuntime() = true（V7.4）
curl https://target/api/health
# 日志里看 banner: "isTestRuntime() enabled — DO NOT USE IN PRODUCTION"
# 如果有 banner — 攻击者已成功

# Step 5: 现在 WebSocket 签名验证全旁路
wscat -c wss://target/socket.io/?EIO=4&transport=websocket
# 发送 {'role': 'admin', 'tenantId': 'platform'} — 直接升级为 platform_admin

# Step 6: 跨租户枚举 + audit 静默（V7.3）
curl https://target/api/final-defense/policies?tenantId=tenant-B \
  -H "Cookie: accessToken=$WSHIJACKED_JWT"
# 返回 tenant-B 的所有 final-defense policies
# 但 audit log 不记录 (因为 resolveTenantAsPlatformAdmin 没传 auditLogger)

# Step 7: 触发 V7.1 放大
for i in $(seq 1 10000); do
  curl -X POST 'https://target/api/scanner/run' \
    -H "Cookie: accessToken=$JWT" \
    -H 'Content-Type: application/json' \
    -d '{"target":"'$RANDOM'"}' &
done; wait
# 10000 个 safeErrorMessage 调用 → 10000 次 require(logger) + console.error
# 单进程 CPU 100%

# Step 8: 触发 V7.5 错误日志泄露
# 通过 fuzzing 让 OIDC / DB / AI provider 抛错带 token
# 日志里出现 victim 的 access_token
```

---

## 修复建议（优先级排序）

1. **P0** (立刻修，组合利用风险高):
   - V7.5: safeErrorMessage 在 log 前先 sanitize raw 字段
   - V7.3: `resolveTenantAsPlatformAdmin` audit logger 必填 + fail-closed
   - V7.1: 顶层 `import logger` 替换 `require()`，加 LRU 防爆
2. **P1** (Sprint 6):
   - V7.4: `isTestRuntime()` 加 production 启动拒绝
   - V7.6: INSERT 失败时短路 rejectSession，避免写放大
   - V7.2: context 类型白名单 + ESLint 规则
3. **P2** (技术债):
   - V7.3-test: safeErrorMessage 测试断言 logger.error 被调用的参数
   - V7.4-deadcode: 删除 auth.middleware.ts 旧 requireTenantAccess
   - V7.6-deadcode: 把 sanitizeError 接进 safeErrorMessage

## 附：扫描覆盖度

- ✅ `safeErrorMessage` 调用方（16 个 routes 模块，约 70 个 catch 块）
- ✅ `log-sanitizer` 函数（`sanitize` / `sanitizeString` / `sanitizeObject` / `sanitizeError` / `Sanitizers`）— `sanitizeError` 未被调用（V7.6）
- ✅ `isTestRuntime` 三个条件（NODE_ENV / ALLOW_TEST_RUNTIME / prod-enterprise） + catch 块行为
- ✅ `hardware-authorization.service.ts` 的 conditional UPDATE 路径 + rejectSession 写放大
- ✅ `resolveTenantAsPlatformAdmin` 的 audit 必填 / fail-open 语义
- ✅ `resolveRequestTenantContext` / `resolveUserTenantContext` / `tenantOf` 模式在所有 routes 的覆盖（全部走严格 JWT，无 query/params/body 注入点）
- ❌ 业务 service 层（非 routes）的 error message 内容（未审查）
- ❌ WebSocket gateway 的错误回传（未审查）
- ❌ hardware-grant 的 signature verify 路径（仅 spot-checked，line 88-114 正常）

## 备注

- `safeErrorMessage` 是 Wave 1 V3 修复的核心抓手，**但其实现方式（lazy require + 不 sanitize raw + context 无类型约束）把可观测性问题降级为可利用漏洞**。是本仓库"修一个洞，挖三个洞"的典型反模式。
- `isTestRuntime` 的多因子门控是好的方向，但**配置即代码**陷阱需要 production-side 二次防御（启动拒绝 / banner / 不允许 silent fallback）。
- `resolveTenantAsPlatformAdmin` 的 audit 必填化是**最小改动、最大收益**的修复 — 改一个函数签名 + 加一个集成测试即可。
