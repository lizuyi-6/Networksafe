# Wave 2 注入与时序攻击面扫描 - 2026-06-05

## 摘要

- **扫描范围**：`backend/src` 全量（重点：`api/routes/`, `services/`, `security/`, `websocket/`, `ai-agents/`, `bootstrap/`, `config/`）
- **漏洞总数**：**18 条**（去重后 16 条独立漏洞点）
  - Prototype Pollution (PP)：**6 条**（含 1 条基础设施级）
  - ReDoS：**5 条**（含 1 条 P0 高危）
  - SQL Injection：**0 条**直接命中（深度确认后无新发现）
  - TOCTOU / Race：**5 条**（含 2 条 P0）
  - Supply Chain：**2 条**
- **扫描方法**：Grep + 全文阅读关键路径
- **P0 优先级**：1（ReDoS @ tool-executor.ts:407，**user-controlled regex 编译 + 内容回环**）

> 总体判断：Sprint 1-5 修了一批 P0，但 **PP 防护在生产代码中是空白**——`Object.assign`/spread + `JSON.parse` 没有任何过滤；ReDoS 在 AI 工具执行层有一个清晰的 P0；TOCTOU 模式在 agent/audit log 路径仍然存在，但被 Node.js 单线程 + DB UNIQUE 约束缓解。

---

## 关键发现（Top 3 严重度排序）

| 排名 | 漏洞 ID | 位置 | 类型 | 严重度 | 实际可利用性 × 后果 |
|------|---------|------|------|--------|---------------------|
| 1 | V2.5 | `ai-agents/capabilities/tool-executor.ts:407` | ReDoS | **P0** | 高（admin 即可触发） × 进程级拒绝服务 |
| 2 | V2.4 | `security-operations.service.ts:422-426,572-579` + `scanner-task.service.ts:1608-1638` | Prototype Pollution | **P1** | 中（需 authenticated POST） × 全局 Object.prototype 污染 → RCE/Auth bypass 跳板 |
| 3 | V2.1 | `agent/agent.ts:320-372` + `auth.routes.ts:115-144,373-387` | TOCTOU | **P1** | 低-中（受 DB UNIQUE 与 JS 单线程缓解） × nonce 重放/重复注册/会话超限绕过 |

---

## 1. Prototype Pollution（PP）— 6 条

### V1.1: spread `input.metadata` 进入 sec_assets metadata 合并
- **类型**: Prototype Pollution
- **文件:行号**:
  - `backend/src/services/security-operations.service.ts:422-426`
  - `backend/src/services/security-operations.service.ts:572-579`
  - `backend/src/services/security-operations.service.ts:1632-1638`
- **PoC**:
  ```json
  POST /api/security/assets { "tenantId": "...", "assetType": "...", "externalRef": "...", "displayName": "x",
    "metadata": { "__proto__": { "isAdmin": true, "polluted": 1 } } }
  ```
  或通过 `app.use(express.urlencoded({ extended: true }))` 的 `qs` 解析：`metadata[__proto__][isAdmin]=1`
- **影响**: 当 `input.metadata` 来自用户（资产注册、扫描发现、finding 上报），与现有 metadata 合并 `{ ...existing, ...input.metadata }` 时，`__proto__` 会作为 own property 被 spread；取决于 V8 行为，**有可能**写入 `Object.prototype`。V8 在 spread 时会把 `__proto__` 当作普通 key 复制到新对象的 own property，**但**这条数据随后会进入 `JSON.stringify`（写到 sec_assets.metadata_json）并被多处后续 spread（`scanner-task.service.ts:1627` 等），形成跨请求持久化的污染链。`{ ... }` 不会污染，但 `Object.assign(target, source)` 会污染，详见 V1.4。
- **修复建议**:
  1. **关键修复**：合并 metadata 前用 `Object.create(null)` 中间件：`const safe = Object.create(null); Object.keys(input.metadata || {}).forEach(k => { if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') safe[k] = input.metadata[k]; });`
  2. 在 `backend/src/core/safe-object.ts` 增加 `safeMerge(target, source)` 工具函数，递归跳过 `__proto__`/`constructor`/`prototype`
  3. 在 `control-plane-app.ts` 给 `express.json()` 加自定义 `reviver`：`const noProto = (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : v;`

### V1.2: spread `input.metadata` 进入 sec_detection_session metadata
- **类型**: Prototype Pollution
- **文件:行号**:
  - `backend/src/services/scanner-task.service.ts:1608-1617`
  - `backend/src/services/scanner-task.service.ts:1635-1638`
- **PoC**:
  ```json
  POST /api/scanner/tasks (Nuclei 结果) ... metadata: { "__proto__": { "authBypass": true } }
  ```
- **影响**: scanner 报告的 metadata 来自 Nuclei 模板的输出，模板作者（plugin/rule 维护者）可在 metadata 字段中放任意 key。多租户下，一次污染可影响所有后续 metadata 合并路径。
- **修复建议**: 同 V1.1，并审计所有 scanner 输出 sink（scanner-task.service.ts:1410 写入 artifact、security-operations.service.ts:425 写入 sec_assets）

### V1.3: spread `existingMetadata` 来自 DB JSON 解析
- **类型**: Prototype Pollution
- **文件:行号**:
  - `backend/src/services/security-operations.service.ts:423-425`（`parseJson(existing.metadata_json, {})` + spread）
  - `backend/src/services/security-operations.service.ts:573-579`（evidence/remediation）
  - `backend/src/services/security-operations.service.ts:572-574`（`...this.parseJson(...)`）
  - `backend/src/services/security-operations.service.ts:577-579`（remediation）
  - `backend/src/services/security-operations.service.ts:1632-1638`（`...target.metadata`）
- **PoC**: 攻击者先通过 `__proto__` 写入 metadata_json → 下次读出 → spread 时触发 PP。需要先有写 metadata 的能力。
- **影响**: 持久化 PP——一旦污染进 DB，spread 链会持续复活。
- **修复建议**: 在 `parseJson` 内部用 `JSON.parse(value, noProtoReviver)` 过滤 `__proto__`/`constructor`/`prototype` 键。

### V1.4: `Object.assign(codebook, entries)` 设备 codebook 更新
- **类型**: Prototype Pollution
- **文件:行号**: `backend/src/api/routes/devices.routes.ts:723`
- **PoC**:
  ```json
  POST /api/devices/codebook
  { "entries": { "__proto__": { "isAdmin": true }, "VALID_KEY": "value" } }
  ```
  → 验证逻辑 `if (!/^[A-Z0-9_-]+$/.test(key))` 在 `for (const [key, value] of Object.entries(entries))` 内部，所以 `__proto__` 也会被迭代 → 不匹配正则 → 返回 400 拒绝。
  ```
  实际绕过（如果用 body 的 prototype mutation 而非 __proto__ 字符串）：
  { "entries": { "validKey": "x" } }  -- key 通过验证
  -- 但 Object.assign 仍会把所有 own enumerable property 复制，包括 prototype mutation attacks
  ```
- **影响**: **`Object.assign(target, source)` 会触发 `[[Set]]` 语义**，如果 `source.__proto__` 是 own property（如 `JSON.parse('{"__proto__":{}}')` 的结果），V8 在 assign 时会调用 `target.__proto__` 的 setter，**直接修改 `Object.prototype`**。当前代码对每个 key 做了 uppercase 校验，所以**实际可利用性低**，但属于"靠运气挡住 PP"的反模式。
- **修复建议**:
  1. 改用 `for...in` 显式过滤，或使用 `Object.create(null)` 中间对象
  2. 加 `if (key === '__proto__' || key === 'constructor') continue;` 兜底
  3. 替换为 `safeMerge`（V1.1 提案的工具函数）

### V1.5: `Object.assign(body, options.legacy)` API 响应包装
- **类型**: Prototype Pollution（潜在）
- **文件:行号**: `backend/src/core/http/api-response.ts:45,70`
- **PoC**: `sendSuccess(res, data, { legacy: { __proto__: { polluted: 1 } } })` — 但 `options.legacy` 来自代码内部，非用户输入。
- **影响**: **当前不可利用**（仅供内部使用）。但若未来 `options.legacy` 流向 `req.body` 衍生数据，将形成 sink。
- **修复建议**: 防御性使用 `Object.create(null)` 中间对象，或在 `sendSuccess`/`sendError` 内部对 `options.legacy` 做 key 过滤。

### V1.6: 基础设施级 — Express body parsers 无 PP 防护
- **类型**: Prototype Pollution
- **文件:行号**: `backend/src/bootstrap/control-plane-app.ts:124-126`
- **PoC**:
  ```json
  POST /api/auth/login HTTP/1.1
  Content-Type: application/json
  { "__proto__": { "isAdmin": true }, "email": "x", "password": "y" }
  ```
  或 urlencoded: `email=x&password=y&__proto__[isAdmin]=1`（`qs` 库 deep parsing）
- **影响**: 任何下游代码若对 `req.body` 做 `{ ...req.body }` 或 `Object.assign(target, req.body)`，会触发 PP。当前 `req.body` 主要用 destructuring（`const { email, password } = req.body`），所以**直接污染风险低**，但 `extend: true` + `qs` 是经典 PP 攻击面。
- **修复建议**:
  1. **必备**：`app.use(express.json({ reviver: noProtoReviver }))`
  2. **必备**：`app.use(express.urlencoded({ extended: false }))` 切换为 simple `querystring`，关闭 `qs` deep parsing
  3. 在 `backend/src/security/safe-json.ts` 创建 `parseJsonSafe(raw)` 工具

---

## 2. ReDoS（正则拒绝服务）— 5 条

### V2.1: `(.+)\1{2,}` 密码可疑模式检测
- **类型**: ReDoS（轻度）
- **文件:行号**: `backend/src/security/auth-security.service.ts:53`
- **PoC**: 密码 = `'a'.repeat(128) + 'X'`（maxLength=128 限制）
  ```
  $ node -e "console.log(/^|(.+)\1{2,}/.test('a'.repeat(128)))"
  → 触发指数回溯，但因为 maxLength=128，实际 O(128^3) ≈ 2M 操作，耗时 < 100ms
  ```
- **影响**: 受 maxLength=128 限制，**单次调用风险低**；但 `validatePassword` 在 register + login 都会被调用，攻击者可注册用户触发。
- **修复建议**: 改用 `^(.+?)\1{2,}$` 懒惰量词，或预编译后用 linear-time 子串搜索替代。

### V2.2: `new RegExp(\`\\b${kw}\\b\`, 'i')` SQL 关键词检测
- **类型**: ReDoS（理论）
- **文件:行号**: `backend/src/security/input-validator.ts:220,263,291,718`
- **PoC**: N/A（`kw`/`cmd` 来自硬编码集合，非用户输入）
- **影响**: **不可利用**，但模式不好。如果未来某个 `kw` 改为从用户/DB 读取，会立即形成攻击面。
- **修复建议**: 把硬编码的 `sqlKeywords` 列表改为编译好的 `RegExp[]`，运行时不再用模板字符串。

### V2.3: `new RegExp(pattern, 'i')` 检测规则（admin 可注入恶意规则）
- **类型**: ReDoS（admin 横向）
- **文件:行号**:
  - `backend/src/services/detection-engine.ts:160`（`compilePattern`）
  - `backend/src/agent/attack-detector.ts:361`（`new RegExp(pattern, 'i')`）
- **PoC**: admin 通过 `POST /api/rules/candidates/manual` 注入 `keywordPatterns: ["(a+)+$"]`，下次请求触发
- **影响**: admin 权限可发起。**但本身是 admin-only**，优先级低于 V2.4。
- **修复建议**:
  1. 在 `createManualRuleCandidate` 处用 `safe-regex` 库检测 pattern 安全性
  2. 或用线性时间 regex 引擎（如 `re2`）

### V2.4: `new RegExp(p, 'gi')` AI 工具 check_pattern 用户控制 regex
- **类型**: ReDoS — **P0**
- **文件:行号**: `backend/src/ai-agents/capabilities/tool-executor.ts:407`
- **PoC**:
  ```json
  POST /api/ai-endpoints/execute
  { "toolName": "check_pattern",
    "parameters": {
      "content": "a".repeat(50000),
      "patterns": ["(a+)+$"]
    }
  }
  ```
  → 进程级 event loop 阻塞，触发 Event Loop Lag spike；多次并发可导致整个 Node 进程 OOM/挂起
- **影响**: **可远程触发**——任何能调用 AI tool execution 的 API（admin/AI agent 调用方）都能 DoS 整个 control plane。`check_pattern` 工具对 patterns 长度无限制，content 也只受 `req.body` 25MB 限制。
- **修复建议**:
  1. **P0 紧急**：在 `executeCheckPattern` 入口对每个 pattern 用 `safe-regex`/`re2` 校验
  2. 把 `new RegExp(p, 'gi')` 改为编译前 200ms timeout（lib 不直接支持，但可用 `worker_threads` + `setTimeout` 协同）
  3. 限制 `patterns` 数量（如 ≤ 20）和 content 长度（如 ≤ 1MB）

### V2.5: `new RegExp(param.validation)` Tool 参数校验
- **类型**: ReDoS（中度）
- **文件:行号**: `backend/src/ai-agents/capabilities/tool-executor.ts:174`
- **PoC**: 攻击者注册一个 tool 携带 `validation: "(a+)+"`，之后任意用户调用该 tool 即触发
- **影响**: Tool 注册路径在 `registerTool()`，未发现 HTTP 端点暴露 tool 注册（内置 tools 都不带 `validation` 字段），**实际可利用性低**。
- **修复建议**: 同 V2.4，编译前 regex 复杂度检查。

### V2.6: 检测引擎 seed rules `(?:\.\.\/)+[^\s"'&]*`
- **类型**: ReDoS（轻度）
- **文件:行号**: `backend/src/services/detection-engine.ts:681`
- **PoC**: 长字符串 `'../'.repeat(10000) + 'a'`，regex backtrack 受 `[^\s"'&]*` 锚定
- **影响**: 受请求长度限制（25MB body），单次调用 O(n)，可接受。
- **修复建议**: 替换为 `/(?:\.\.\/)+[^\s"'&]+/g`（要求非空），或加 timeout。

---

## 3. SQL Injection（最终深度检查）— 0 条新发现

**结论：Wave 1-5 修复完整，无新发现。**

- `QueryBuilder` (`backend/src/utils/query-builder.ts`) 实现 `sanitizeIdentifier`（`/^[a-zA-Z_][a-zA-Z0-9_]*$/`）+ `sanitizeOperator` 双重过滤；所有 SQL 走 `?`/`$n` 参数化。
- 唯一发现 `db.exec(\`DELETE FROM ${table}\`)` 模式位于：
  - `backend/src/database/seeds/seed-manager.ts:217`（table 来自硬编码数组）
  - `backend/src/services/postgres-shadow-store.service.ts:866`（`TABLES` 枚举键）
  - `backend/src/testing/test-data-fixtures.ts:368`（硬编码）
  - `backend/src/testing/test-context.ts:421`（硬编码）
  → **全部 hardcoded，零 SQL 注入风险**。
- `query-builder.ts:212-228` 中 `selectColumns.join(', ')`、`conditions.join(' AND ')` 等位置已通过 `sanitizeIdentifier` 间接过滤。
- `deployment-profile.repository.ts:90-104` 等纯 repository 层全部参数化。

**遗留观察（不构成漏洞但建议加固）**：
- `db.exec(sql)` 接口在多处被用于"执行启动 SQL"，应改为 `db.exec(SQL_CONSTANT)` 而非模板字符串——目前已经是这样，但**未来添加新 exec 时需要 code review 守住**。

---

## 4. Race Condition / TOCTOU — 5 条

### V4.1: nonce check-then-add 路径在 agent 命令处理
- **类型**: TOCTOU
- **文件:行号**: `backend/src/agent/agent.ts:320-323,371-373`
- **PoC**: 并发发送两个相同 nonce 的命令，理论上两次都能过 check 然后都被 add；add 是 Set.add，**第二次 no-op**。
- **影响**: Node.js 单线程 + 函数全 synchronous（`handleSignedCommand` 在 `await crypto.timingSafeEqual` 等同步调用之间无 await），**实际不可利用**。但属于反模式——若未来加 `await` 将立即暴露。
- **修复建议**: 把 `if (this.usedNonces.has(command.nonce))` 改为 `if (!this.usedNonces.add(command.nonce) || alreadyAdded)` 原子模式，或用 `Map` 的 `set()` + `has()` 单次操作。

### V4.2: 用户注册邮箱 check-then-create
- **类型**: TOCTOU
- **文件:行号**: `backend/src/api/routes/auth.routes.ts:115-123,135-144`
- **PoC**: 两个并发 register 请求用相同 email → 都过 `findAuthUserByEmail` → 都 `bcrypt.hash`（async，等待 ~100-300ms）→ 都调用 `createAuthUser`
- **影响**:
  - `users.email` 列有 `UNIQUE` 约束（`config/database.ts:211`），第二个 INSERT 抛 `SQLITE_CONSTRAINT: UNIQUE`，被 `safeErrorMessage` 兜底 → 用户看到模糊的 "registration failed" 而非 "user exists"。
  - **不构成安全漏洞**，但用户体验差且日志可能泄露。
- **修复建议**:
  1. 在 `createAuthUser` 改用 `INSERT ... ON CONFLICT (email) DO NOTHING RETURNING id` 检测重复
  2. 或在 `findAuthUserByEmail` 后用 advisory lock 阻塞

### V4.3: `checkConcurrentSessions` check-then-add 路径
- **类型**: TOCTOU（warning-only）
- **文件:行号**: `backend/src/api/routes/auth.routes.ts:373-387`
- **PoC**: 并发 6 次登录同一用户 → 5 个都过 `checkConcurrentSessions`（scard < 5）→ 都 addSession，最终 6 个 session
- **影响**: 6 > 5 但代码只用 `concurrentWarning` 警告不阻断。**当前不构成安全漏洞**（max 只是 advisory）。
- **修复建议**: 用 Redis Lua 脚本原子地 `SCARD + SADD`，或在 DB 层加 session 总数 CHECK。

### V4.4: audit log 写入路径无原子 batch
- **类型**: TOCTOU（数据完整性）
- **文件:行号**: `backend/src/security/audit-logger.service.ts:168-281`
- **PoC**: 多个并发请求同时 `auditLogger.log()`，每个都生成独立 `uuid + signature`，**逻辑上安全**——每条都独立 INSERT，互不影响。
- **影响**: 无安全影响，但 Postgres fallback 是 `await` 异步路径，SQLite 是同步。混合模式在 SQLITE_BUSY 时可能写入失败。
- **修复建议**: 监控 `audit_log` 写入失败率；考虑在 SQLite fallback 加 `db.transaction(() => {...})` 批处理。

### V4.5: 设备 codebook 计数器与 `cachedAttackOrigins` 全局状态
- **类型**: TOCTOU（数据完整性）
- **文件:行号**: `backend/src/services/api-request-tracker.service.ts:63-74`
- **PoC**: 多个并发请求触发 `recordApiRequest(true, '1.2.3.4')`：
  ```js
  const existing = cachedAttackOrigins.find(o => o.country === sourceIP);
  if (existing) { existing.count++; } else { cachedAttackOrigins.push({...}); }
  // ... 然后异步计算 percentage 时 array 可能已经变了
  ```
- **影响**:
  - **数据竞争**：JS 单线程下 `find`+`push`+`for` 之间无 await，**不会交错**。
  - **但** percentage 计算在最后 `for (const o of cachedAttackOrigins) { o.percentage = ... }` 期间，如果有新 push 会让现有 origin 的 percentage 偏小。
  - **不构成安全漏洞**（只是 dashboard 统计有微小时序偏差）。
- **修复建议**: 用 `Map<sourceIP, AttackOrigin>` 替代 find+push；计算 percentage 时 copy 一次。

### V4.6: 设备 gateway `usedNonces` Map 定义但未使用
- **类型**: TOCTOU（潜在）
- **文件:行号**: `backend/src/websocket/device-gateway.ts:135,177-181`
- **PoC**: N/A — 实际代码只 `delete` 不 `has`/`set`
- **影响**: **死代码**——`usedNonces` 字段在 `cleanupUsedNonces()` 中迭代但从未被命令处理器 read。设备命令 nonce 防重放**完全没生效**。
- **修复建议**:
  1. **必须修复**：在 `handleSignedCommand`（device gateway 版）里 `if (this.usedNonces.has(nonce)) { return; }` + `this.usedNonces.set(nonce, Date.now())`
  2. 或删除该 dead code 并在 architecture doc 中说明设备命令不依赖 nonce 防重放

---

## 5. NPM postinstall / Supply Chain — 2 条

### V5.1: `package.json` 无 postinstall 脚本
- **类型**: Supply Chain（健康）
- **文件:行号**: `backend/package.json`
- **PoC**: `grep -c "postinstall\|preinstall\|preuninstall" backend/package.json` → 0
- **影响**: **好**——Sprint 1 创建的 package-lock.json 不会触发自动脚本。
- **修复建议**:
  1. CI 阶段加 `npm install --ignore-scripts` 双保险
  2. `.npmrc` 加 `ignore-scripts=true`（推荐）
  3. 启用 `npm audit signatures`

### V5.2: 生产代码无 `eval`/`new Function`
- **类型**: Supply Chain（健康）
- **文件:行号**: 全量 `backend/src`
- **PoC**: `grep -E "eval\s*\(|new Function" backend/src/**` → 0（仅 AI agents investigation 模块有针对 `eval(` 的检测代码，非实际 eval）
- **影响**: **好**——无 dynamic code execution。
- **修复建议**: 在 ESLint 配置 `no-eval: error`、`no-new-func: error`（已部分启用 `eslint-plugin-security`）

### V5.3: audit-logger `outputPath` 可被调用方指定，路径未沙箱
- **类型**: Supply Chain（潜在 — 间接路径遍历）
- **文件:行号**:
  - `backend/src/security/audit-logger.service.ts:589,659-666`
  - `backend/src/security/audit-logger.service.ts:717-728`（`verifyBackup(filePath)`）
- **PoC**: 
  - 外部 HTTP 端点**未发现**直接接收 `outputPath` / `filePath`（grep 验证），仅由 `rotateLogs()` 内部调用 `./data/audit-log-archive-${date}.json`。
  - 但若未来添加 `POST /api/admin/audit/restore` 端点接收 `filePath` 参数，将立即形成路径遍历。
- **影响**: **当前不可利用**（HTTP 入口未暴露），属于"未来风险"型。
- **修复建议**:
  1. 在 `exportBackup`/`verifyBackup` 入口加白名单：`path.resolve(filePath).startsWith(path.resolve(process.env.DATA_DIR))`
  2. 添加 `try { realpathSync }` 跟随 symlink 检测

### V5.4: scanner 子进程调用安全审计
- **类型**: Supply Chain（已加固）
- **文件:行号**:
  - `backend/src/scanner/nuclei-scanner.ts:8,193`（`spawn(this.nucleiPath, args, ...)`）
  - `backend/src/scanner/port-scanner.ts:1`（`exec`）
  - `backend/src/scanner/system-scanner.ts:1`
  - `backend/src/scanner/web-scanner.ts:1`
  - `backend/src/scanner/optimization-engine.ts:6,68`（`spawn(cmd, args, ...)`）
  - `backend/src/scanner/execution-monitor.ts:1,139`
  - `backend/src/agent/firewall-controller.ts:200-319`（`execFile` + 硬编码 args）
  - `backend/src/services/benchmark.service.ts:968`（`execFileAsync('sh', ['-lc', 'ps -o ...'])`）
  - `backend/src/utils/system-stats.ts:79,95`（`exec('wmic logicaldisk ...', cb)` — **无 await，错误静默**）
- **PoC**: `system-stats.ts:79` `exec('wmic logicaldisk get size,freespace,caption', cb)` 在 `process.platform === 'win32'` 才执行；不传 user input。**安全**。
- **影响**:
  - `firewall-controller.ts` 显式 SECURITY FIX comment + `execFile` 模式 + 硬编码 args，**已加固**。
  - `optimization-engine.ts:68` `spawn(cmd, args, ...)` 中 `cmd` 来自配置（需 audit `OptimizationConfig` 注入路径），但 args 是数组形式，无 shell 注入。
- **修复建议**:
  1. `system-stats.ts:79,95` 加 `try/catch` 处理 stderr，避免静默失败
  2. 监控 `nucleiPath` 配置项的来源，确保只允许 platform admin 设置

---

## 附录 A：扫描过的关键文件清单

### 配置 / Bootstrap
- `backend/src/bootstrap/control-plane-app.ts`（body parser 配置 + 路由挂载）
- `backend/src/config/database.ts`（db.exec 调用集中地）
- `backend/src/config/runtime-capabilities.ts`
- `backend/src/config/enterprise-runtime.ts`
- `backend/src/config/index.ts`（REDIS_KEYS/RATE_LIMIT 配置）

### 路由（PP/ReDoS 重点）
- `backend/src/api/routes/devices.routes.ts:660-735`（codebook 验证 + Object.assign）
- `backend/src/api/routes/auth.routes.ts:60-200`（注册/login TOCTOU）
- `backend/src/api/routes/admin.routes.ts`（user-mgmt, audit, benchmark, firmware）
- `backend/src/api/routes/final-defense.routes.ts`（policy + status report）
- `backend/src/api/routes/deployments.routes.ts`（profile 渲染 + generate-bundle）
- `backend/src/api/routes/traffic.routes.ts`（`...JSON.parse(flow.metadata_json)` spread）
- `backend/src/api/routes/rules.routes.ts`（admin-only 规则管理）
- `backend/src/api/routes/smart-fix.routes.ts`（AI prompt validator + 硬编码 DANGEROUS_PATTERNS）

### 服务层（PP / ReDoS / TOCTOU 重点）
- `backend/src/services/security-operations.service.ts:185-2000`（sec_assets/sec_findings metadata spread）
- `backend/src/services/scanner-task.service.ts:1380-1640`（recordFinding + observedSession metadata spread）
- `backend/src/services/detection-pipeline.service.ts:1100-2050`（DB write 集中）
- `backend/src/services/detection-engine.ts:160,615-790`（compilePattern + inferAttackFamily）
- `backend/src/services/hardware-authorization.service.ts:480-580`（counter bump 原子性已加固）
- `backend/src/services/agent-system.service.ts`
- `backend/src/services/final-defense.service.ts:82,139`（`JSON.parse` 包装函数）
- `backend/src/services/audit-archive.service.ts:243`
- `backend/src/services/audit-segment.service.ts:171,202`
- `backend/src/services/api-request-tracker.service.ts:54-76`
- `backend/src/services/postgres-shadow-store.service.ts:866`（template `db.prepare`）
- `backend/src/services/benchmark.service.ts:1143`

### 安全模块
- `backend/src/security/auth-security.service.ts:49-54`（SUSPICIOUS_PATTERNS `(.+)\1{2,}`）
- `backend/src/security/input-validator.ts:200-300,700-740`（`new RegExp(\`\\b${kw}\\b\`)` 模式）
- `backend/src/security/audit-logger.service.ts:159,589,717,897`（JSON.parse + fs.readFile/writeFile）
- `backend/src/security/agent-auth.service.ts:113-360`（DB schema 准备 + 业务查询）
- `backend/src/security/command-risk-policy.ts`
- `backend/src/security/hardware-grant.ts`
- `backend/src/security/enhanced-rate-limiter.service.ts:102,312,331`
- `backend/src/security/ratelimit.middleware.ts:106,127`（Redis multi.exec）

### Agent / WebSocket
- `backend/src/agent/agent.ts:60-410`（usedNonces + handleSignedCommand）
- `backend/src/agent/attack-detector.ts:300-370`（`new RegExp(pattern, 'i')`）
- `backend/src/agent/enhanced-attack-detector.ts:53,234,279`
- `backend/src/websocket/agent-gateway.ts:1135`（emit command spread）
- `backend/src/websocket/device-gateway.ts:135,177,275-535`（register/heartbeat/data/handleData）
- `backend/src/companion/serial-device-companion.ts:42,240,374`（LocalPolicy JSON.parse）

### AI Agents（ReDoS 重点）
- `backend/src/ai-agents/capabilities/tool-executor.ts:170-180,393-430`（P0 ReDoS）
- `backend/src/ai-agents/roles/{socrates,plato,aristotle}-agent.ts`（AI agent 逻辑）
- `backend/src/ai-agents/core/base-agent.ts:219-221`（sanitize pattern）
- `backend/src/ai-agents/investigation/agents/base-investigation.agent.ts:277`（JSON.parse 包装）

### Utils
- `backend/src/utils/query-builder.ts:91-256`（sanitizeIdentifier + sanitizeOperator 双重过滤）
- `backend/src/utils/validation.ts:109`（domain regex）
- `backend/src/utils/system-stats.ts:79,95`（exec 调用）

### Module Repositories
- `backend/src/modules/auth/auth-user.repository.ts:24-158`（findByEmail/ById + createAuthUser）
- `backend/src/modules/agent-onboarding/agent-onboarding.repository.ts:191-200`
- `backend/src/modules/announcements/announcements.repository.ts:21-103`
- `backend/src/modules/admin/admin.repository.ts:47-197`
- `backend/src/modules/sites/site.repository.ts:38-104`
- `backend/src/modules/deployments/deployment-profile.repository.ts:27-104`
- `backend/src/modules/scanner/scanner-route.repository.ts:17-27`

### Database / Seeds / Migrations
- `backend/src/database/init.ts:62-150`（schema init）
- `backend/src/database/seeds/seed-manager.ts:151-227`
- `backend/src/database/seeds/demo_data.ts:37-165`
- `backend/src/database/migrations/001_add_security_tables.ts:1-120`

### Companion / Hardware
- `backend/src/companion/serial-device-companion.ts:42,240,374`（LocalPolicy + payload spread）
- `backend/src/services/hardware-authorization.service.ts:85,122,183-744`（lastMonotonicCounter atomic update）
- `backend/src/services/final-defense.service.ts:82,139`
- `backend/src/services/deployment-run.service.ts:80,205`
- `backend/src/services/device-control.service.ts:57,77,425`

### Observability
- `backend/src/observability/metrics.ts:200-260`（mergeLabels spread）
- `backend/src/middleware/api-traffic-shadow.middleware.ts`（shadow middleware）
- `backend/src/middleware/auth.middleware.ts`（JWT + EnvValidator）

### Scanner 外部命令调用（Supply Chain 重点）
- `backend/src/scanner/nuclei-scanner.ts:8,193`
- `backend/src/scanner/port-scanner.ts:1`
- `backend/src/scanner/system-scanner.ts:1`
- `backend/src/scanner/web-scanner.ts:1`
- `backend/src/scanner/optimization-engine.ts:6,68`
- `backend/src/scanner/execution-monitor.ts:1,139`
- `backend/src/scanner/scan-scheduler.ts:54-410`
- `backend/src/agent/firewall-controller.ts:200-319`（已 SECURITY FIX）

---

## 附录 B：Wave 2 修复优先级建议

| 优先级 | 漏洞 | 工时估计 |
|--------|------|----------|
| **P0** | V2.4 `tool-executor.ts:407` ReDoS | 0.5 天（加 safe-regex 检查 + size 限制） |
| **P1** | V1.6 `control-plane-app.ts:124-126` body parser PP 防护 | 1 天（自定义 reviver + 改 `extended: false`） |
| **P1** | V1.1-V1.3 `security-operations`/`scanner-task` spread 全部过 `safeMerge` | 2 天（写工具 + 全量替换） |
| **P1** | V4.6 `device-gateway.ts:135` dead code 或补完 nonce 检查 | 0.5 天 |
| **P2** | V2.3 `detection-engine.ts:160` admin-injected ReDoS | 1 天（regex 编译前安全校验） |
| **P2** | V1.4 `devices.routes.ts:723` Object.assign 改 safeMerge | 0.5 天 |
| **P3** | V5.3 `audit-logger.verifyBackup(filePath)` 沙箱 | 0.5 天 |
| **P3** | V1.5 `api-response.ts:45,70` 防御性 hardening | 0.25 天 |
