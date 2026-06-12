# WebSocket 签名审计 - 2026-06-05

**Sprint**: 5 · R4 (WebSocket 签名审计)
**审查员**: 白盒安全审计员 (只读)
**审查范围**: Agent Gateway + Device Gateway 双向 WebSocket 通信的签名 / 重放 / 注入 / 信任升级 / 速率限制

## 摘要

- **文件扫描**: 10 个核心文件
- **漏洞总数**: 15
- **🔴 P0**: 3 (可执行未授权命令 / 完全绕过 / 全局状态污染)
- **🟡 P1**: 7 (可重放 / 时序侧信道 / 信任边界绕过 / 部署风险)
- **🟢 P2**: 5 (深度 / 大小 / 资源耗尽 / 配置)

---

## 🔴 P0 漏洞

### V4.1: Device gateway `broadcastCommand()` 在签名失败时静默回退到未签名命令
- **文件:行号**: `backend/src/websocket/device-gateway.ts:789-823` (重点 `797-800`)
- **PoC**:
  ```ts
  // 当前实现
  const signedCommand = this.signCommand(deviceId, command, params);
  if (signedCommand) {
    socket.emit('command', signedCommand);
  } else {
    socket.emit('command', { cmd: command, params, timestamp: Date.now() });  // ❌ 无 signature
  }
  ```
  触发条件: (1) `DEVICE_COMMAND_SECRET` 未配置 / 长度 <32 字节 (警告不阻断, `device-gateway.ts:141-145`); 或 (2) 设备特定密钥 `DEVICE_KEY_${deviceId}` 也未配置。
- **影响**: ESP32 设备收到无签名的命令总线帧。若设备固件未做严格的"缺少 signature 字段即丢弃"逻辑, 任何能向 device 端发包的网络路径 (MGMT 端口、BMC、带外) 可触发破坏性指令 (reboot / factory_reset / wipe_data 全部在 `command-risk-policy.ts:3-31` 的 `PHYSICAL_CONFIRMATION_COMMANDS` 集合中)。
- **修复建议**:
  1. `broadcastCommand` 必须完全镜像 `sendCommand` 的行为, 签名失败时**直接跳过该设备**而不是发无签名包。
  2. `signCommand` 在 secret 缺失/过短时 throw (而非 warn), `sendCommand`/`broadcastCommand` 在 catch 中返回 false。
  3. 在 `device-gateway.ts:139` 启动时若 `commandSigningSecret.length < 32` 直接 throw。

---

### V4.2: Agent 通道几乎所有上传事件缺少速率限制 — DoS + 全局状态污染
- **文件:行号**:
  - `backend/src/websocket/agent-gateway.ts:484` `agent:heartbeat` 处理器
  - `backend/src/websocket/agent-gateway.ts:531` `agent:traffic_stats` 处理器
  - `backend/src/websocket/agent-gateway.ts:590` `agent:threat` 处理器
  - `backend/src/websocket/agent-gateway.ts:638` `agent:review_sample` 处理器
  - `backend/src/websocket/agent-gateway.ts:696` `agent:scan_result` 处理器
  - `backend/src/websocket/agent-gateway.ts:715` `agent:log` 处理器
  - `backend/src/websocket/agent-gateway.ts:723` `agent:command_ack` 处理器
  - `backend/src/websocket/agent-gateway.ts:741` `agent:command_failed` 处理器
- **PoC**: `checkUserRateLimit`/`checkSocketRateLimit` 仅在三个 dashboard 触发器 (`request:scan`, `request:block_ip`, `request:unblock_ip` — `agent-gateway.ts:790, 832, 904`) 中调用。Agent 认证通过后即可用以下循环耗尽数据库写入:
  ```js
  for (let i=0; i<1e6; i++) socket.emit('agent:threat', { threat: { ruleId: 'X'.repeat(1e6), ... } });
  ```
  每次 `agent:threat` 都会触发 `detectionPipelineService.recordBlockedThreat` 写入 (`agent-gateway.ts:608`)。
- **影响**:
  1. 持久化层 (sql.js / Postgres) 内存或磁盘被填满。
  2. `agent:traffic_stats` (`agent-gateway.ts:531-587`) **直接累加到 `globalStats`** — 一个被攻陷的合法 agent 可把 `packetsProcessed` 撑爆 32 位整数, 或通过 `updateAgentHeartbeat` 任意操纵 `tasksCompleted`/`responseTime`/`memoryUsage`/`cpuUsage` (`agent-gateway.ts:567-575`), 这是仪表板"AI 决策系统"指标的信任根。
  3. Redis `nonce:*` 写入虽独立 (受 nonce 保护), 但 agent 上行路径无 nonce 保护且无限制, 形成免费资源耗尽向量。
- **修复建议**:
  1. 在 `agent-gateway.ts` 内部新增 `checkAgentEventRateLimit(agent.agentId, socket, tenantContext.tenantId)` 助手, 在 `agent:heartbeat`、`agent:traffic_stats`、`agent:threat`、`agent:log`、`agent:scan_result` 等所有事件处理器入口先调用。
  2. `agent:traffic_stats` 的 `processed` / `tasksCompleted` 增量应做单次上限 (例如单帧不超过 1e9) 并采用差值模式而非绝对累加。
  3. `agent:review_sample` 触发的 `detectionPipelineService.reviewAgentSample` 内部也应做速率节流, 防止异步 AI 评审被打爆。

---

### V4.3: `isTestRuntime()` 检查 `NODE_ENV === 'test'` — 部署错配即完全绕过认证
- **文件:行号**:
  - `backend/src/testing/test-runtime-adapter.ts:8-10`
  - `backend/src/websocket/agent-gateway.ts:231-249` 完整跳过的认证分支
- **PoC**: 在生产 backend 启动脚本中:
  ```bash
  NODE_ENV=test nohup node dist/index.js
  ```
  任何 socket 即可通过:
  ```js
  io({ auth: { type: 'agent', agentId: 'attacker', apiKey: 'whatever' } });
  // → wsTestAgentAdapter 接收并赋予 tenantId='test-tenant', 后续审计 actor 全部为 attacker.agentId
  io({ auth: { type: 'dashboard', token: 'x' } });
  // → wsTestDashboardUserAdapter 赋予 role: 'admin', 获得 PLATFORM_TENANT_ID 跨租户能力
  ```
- **影响**: 一旦 `NODE_ENV=test` 被带入生产, 任何客户端可成为 "admin" 角色并访问 `PLATFORM_TENANT_ID` 下全部 agent (`canAccessTenant` 在 `agent-gateway.ts:1184-1190` 允许 PLATFORM_TENANT_ID 跨租户)。这是 CVE 级别的误用陷阱。
- **修复建议**:
  1. 改用专门的 `ALLOW_TEST_RUNTIME=true` 环境变量, 与 `NODE_ENV` 解耦, 并在 `validateRuntimeEnvironment` 中要求显式开启且记录启动告警。
  2. 把 `isTestRuntime()` 替换为更严格的 `isTestAdapterAllowed()`, 需同时满足 `NODE_ENV=test` AND `process.env.TEST_RUNTIME_TOKEN === <boot-time secret>`, 生产即便误设 `NODE_ENV` 也无法启用。
  3. 路由层在认证成功后再次校验 `user.userId !== 'test-user' && agent.agentId !startsWith 'test-agent-'`, 防止测试身份漏到生产。

---

## 🟡 P1 漏洞

### V4.5: Device gateway nonce 防重放是**死代码** — `usedNonces` Map 从未被写入
- **文件:行号**: `backend/src/websocket/device-gateway.ts:135, 174-181`
- **PoC**:
  - 第 135 行声明 `private usedNonces: Map<string, number> = new Map();`
  - 第 157 行启动 `setInterval(() => this.cleanupUsedNonces(), 5*60*1000);`
  - 第 174-181 行遍历 `this.usedNonces.entries()` 删除过期项
  - **但全文件搜索 `this.usedNonces` 写入点: 无。** `signCommand` 每次生成新的 16-byte nonce (`device-gateway.ts:200`) 但**从不**调用 `this.usedNonces.set(nonce, Date.now())`。
- **影响**:
  1. 设备端若实现为"收到重复 nonce 即拒绝", 它依赖的 server-side nonce 历史根本不存在。
  2. 同样在 `command-signing.service.ts:135` 的 `nonceManager.checkAndUseNonce` 与此处的 `usedNonces` 是**两套**不相关的机制, 维护者容易混淆 — 一处是真做了 (signing service → nonce manager → Redis/内存), 一处是空架子。
  3. 攻击者若能嗅探/重放设备 ↔ server 的命令 (例如位于 MGMT 路径的中间人), 可以重放任何已签名的 device → agent 命令。
- **修复建议**:
  1. 删除 `usedNonces` 字段、`cleanupUsedNonces` 方法和 `cleanupInterval`, 在文件顶部加注释说明 server-side 重放保护由 `command-signing.service.ts` 的 `nonceManager` 负责。
  2. 若打算做 device-receive-side 的去重, 必须真正写入 `usedNonces.set(nonce, Date.now())`, 并**验证**收到 device 上行消息时的 nonce。

---

### V4.6: 签名 payload canonicalization 是 `JSON.stringify` — 看似一致, 实则脆弱
- **文件:行号**:
  - `backend/src/security/command-signing.service.ts:54, 80`
  - `backend/src/agent/agent.ts:327`
  - `backend/src/websocket/device-gateway.ts:208`
- **PoC**:
  - 签名方: `const message = JSON.stringify(command);`
  - 验证方: `const message = JSON.stringify(command);`
  - `JSON.stringify` 在 V8 上对**字符串键按插入序**输出, 但 `command` 对象是从 `JSON.parse` 还原而来, 若中间链路 (WSS 帧 → Socket.IO 反序列化 → 业务层读取) 任一处用了 lodash / mapcat 类工具**重排**键, 签名即失败 (FATAL: 拒绝合法命令) 而非可恢复的失败。
  - 此外, 相同内容不同键序: `{"a":1,"b":2}` 与 `{"b":2,"a":1}` 的签名**不同**。如果某天有人把 `command` 改用 `Object.fromEntries(Object.entries(...).sort())` 来"美化", 服务器签的名客户端永远验不过。
- **影响**: 维护风险 — 任何看似无害的 refactor 都会打破签名兼容性。当前尚未发现可利用的注入, 但是结构性脆弱。
- **修复建议**: 引入 RFC 8785 (JCS - JSON Canonicalization Scheme) 库, 或自己写一个稳定序列化器: 键字典序排序 + UTF-8 无 BOM + 拒绝未定义值 + 拒绝 NaN/Infinity。在 sign & verify 两侧都用同一实现。

---

### V4.7: 时间窗: nonce TTL 远超命令最大年龄, 留下大重放窗口
- **文件:行号**:
  - `backend/src/security/command-signing.service.ts:111` `MAX_AGE = 30 * 1000` (30 秒)
  - `backend/src/security/command-signing.service.ts:125` `command.timestamp > now + 5000` (5 秒前向容差)
  - `backend/src/security/nonce-manager.service.ts:24` `MEMORY_TTL = 600000` (10 分钟)
  - `backend/src/security/command-signing.service.ts:135` `nonceManager.checkAndUseNonce(command.nonce, 600)` (10 分钟 TTL)
- **PoC**:
  - 攻击者在 T=0 嗅探到一条合法 30s 内的命令, 立刻用同样的 nonce 在 T+8 分钟时重放。
  - 验证逻辑: `commandAge = 8*60*1000 = 480000` > 30000? **YES** → 拒绝 (仅当 server 真的检查 `commandAge`)。
  - 但是, 如果 attacker 篡改 `command.timestamp` 为 T+8 分钟, `commandAge = 0`, 签名因为 server 用了**修改后的 timestamp 重新签**就过不了… 所以"修改 timestamp"路径堵死。
  - 真正的风险是 server 端 nonce 在 Redis 重启 / failover 后丢失 — 此时 attacker 持有的旧 nonce + 旧 timestamp 命令会被误接受 (因为 `nonceManager` 报告"是新 nonce")。这就是经典 failover replay。
- **影响**: Redis 故障 / 故障转移 / 内存回退切换瞬间 (在 `nonce-manager.service.ts:69-74` catch 分支), 攻击者持有的任何 ≤ 30s 老命令 nonce 在 5 分钟内可重放。`nonceManager.getStats()` 报告 `redisAvailable: false` 时, 内存字典还在但只覆盖**新** nonce, 不会与 Redis 状态冲突。
- **修复建议**:
  1. 把 nonce TTL 收紧到 ≤ 60s (略大于 `MAX_AGE + clockSkew = 35s`)。
  2. 在 Redis 不可用时**降级模式**应当 `fail-closed` (拒绝所有新 nonce), 而不是悄悄切到内存字典。
  3. 启动时, 旧 nonce 不应自动放行, 应当要求 `command.timestamp` 在启动时间之后。

---

### V4.8: `device:data` 事件接受任意结构 + 跨端状态污染
- **文件:行号**: `backend/src/websocket/device-gateway.ts:488-547`
- **PoC**: 已认证 device 发送:
  ```js
  socket.emit('data', { payload: {
    policyDigest: 'ATTACKER_DIGEST',
    breakerTarget: 'attacker_breaker',
    interlockState: 'released',  // ⚠️ 客户端可强行声明 released
    externalPowerPresent: true,
    secureElementPresent: false,
    feedbackOk: true
  } });
  ```
  → 进入 `updateDeviceFinalDefenseState()` (`device-registry.service.ts:464-474`) → 修改设备记录, 进而影响 root-resistant final defense 的"UI 可见'root-resistant active'"判定。
- **影响**:
  1. 同样的 finalDefense 字段也可通过 `agent:threat` (`agent-gateway.ts:590-636`) 间接污染, 攻击者控制的合法 agent 也能写同样的字段。
  2. 设备端 `interlockState` 是声明性的, 服务端无法独立校验硬件反馈。
  3. 仪表板会显示"已 armed/released"误导运维。
- **修复建议**:
  1. `updateDeviceFinalDefenseState` 必须有来源标记 (`source: 'device-heartbeat' | 'agent-threat' | 'device-data'`), 不同来源有不同信任级别。
  2. `interlockState === 'released'` 只可由硬件授权服务 (`hardwareAuthorizationService`) 写, 设备 / agent 上行只可写 `interlockState` 候选, 由服务端综合判断。
  3. 在 `device-gateway.ts:527-540` 加注释: 此路径是**不可信**的声明, 不得用于 root-resistant active 判定。

---

### V4.9: `validateAgentHeartbeatPayload` 允许 `isOnline` 覆盖 + 缺少 rate limit
- **文件:行号**:
  - `backend/src/websocket/socket-payload-validator.ts:49-65` (重点 63)
  - `backend/src/websocket/agent-gateway.ts:484-528`
- **PoC**: 合法 agent 循环发送:
  ```js
  for (let i=0; i<1e5; i++) socket.emit('agent:heartbeat', { isOnline: false, agentId: self });
  ```
  - 验证器 63 行 `typeof payload.isOnline === 'boolean' ? payload.isOnline : undefined` 通过。
  - agentId 一致 (line 492) 也通过。
  - 进入 515 行 `connectedAgent.status = validatedStatus` → 写库的 `status.isOnline` 由 agent 完全控制。
  - 因为 `agent:heartbeat` 没有 rate limit, 1e5 心跳轻易填满数据库并广播给所有 dashboard。
- **影响**: 仪表板看到 agent "刚刚还在线突然离线" 的混乱, 触发不必要的告警风暴 (security-operations.service 同步 `device-health` 告警)。同时 `isOnline: true` 的伪造 + `lastHeartbeat` 任意更新可绕过 stale heartbeat 检测 (15 分钟阈值)。
- **修复建议**:
  1. `agent:heartbeat` 处理器入口加 `checkAgentEventRateLimit` (与 V4.2 共用)。
  2. `validateAgentHeartbeatPayload` 不接受 `isOnline` 字段 (它应该由服务端 `lastHeartbeat` 时间推断)。
  3. agent status 写入前, 服务端**始终**根据 `lastHeartbeat` 与当前时间重算 `isOnline`, 忽略 agent 提供的值。

---

### V4.10: 信任升级: `commandDispatcherService` 的 setter 注入点被广泛 export, route 层可直接修改全局状态
- **文件:行号**:
  - `backend/src/api/routes/agents.routes.ts:42` `export function setAgentGateway(gateway: any)`
  - `backend/src/api/routes/ai-system.routes.ts:277` `export const setAgentGateway`
  - `backend/src/api/routes/devices.routes.ts:181` `export function setDeviceCommandTransport`
  - `backend/src/services/command-dispatcher.service.ts:66, 70`
- **PoC**: 任何 route 模块 (例如 `agents.routes.ts:42`) 或单元测试 (例如 `command-dispatcher.service.test.ts:54, 71, 94`) 都可调用:
  ```ts
  import { setAgentGateway } from '../api/routes/agents.routes';
  setAgentGateway({ getAgent: () => ({ socketId: 'fake' }), sendCommandToAgent: () => true });
  ```
  后续所有 `dispatchAgentCommand` 都会把命令发给这个假网关。配合 V4.3 (`isTestRuntime`), production test 模式下, attacker 可:
  1. 替换 agentGateway → 所有 dashboard 命令"成功"但实际无效 (混淆审计)
  2. 替换 deviceAdapter → 设备命令在 dispatcher 层看似成功, 但实际未到达设备
- **影响**:
  1. 拒绝服务 + 审计混淆: 攻击者拦截所有下行命令, 系统"以为"已发, 实际无操作。
  2. 单点失效: 任何 route 模块 bug / 测试残留都可能把全局 gateway 引用置为错对象, 影响所有后续请求 (进程级共享状态)。
  3. `docs/refactor/roadmap-routes-db-migration.md:160, 268, 324` 已知 P1, 但尚未移除。
- **修复建议**:
  1. 实施 `docs/refactor/roadmap-routes-db-migration.md:210-212` 的整改: 在 `bootstrap/control-plane-app.ts` 中通过 DI 注入, 删除 routes 模块对 `setAgentGateway` 的 export。
  2. 单元测试改用局部 `commandDispatcher` 实例 (`new CommandDispatcherService()`), 不污染全局 singleton。
  3. 在 `commandDispatcherService` 内部对 setter 调用做进程启动后只允许一次 (`started` flag)。

---

### V4.11: `signAdminCommand` 写 nonce 但不消费 nonce manager — admin 命令无重放保护
- **文件:行号**: `backend/src/security/command-signing.service.ts:156-167`
- **PoC**:
  ```ts
  signAdminCommand(command: any, adminSecret: string): string {
    const message = JSON.stringify({
      ...command, timestamp: Date.now(), nonce: crypto.randomBytes(16).toString('hex')
    });
    return crypto.createHmac('sha256', adminSecret).update(message).digest('hex');
  }
  ```
  - 无对应 `verifyAdminCommand` 方法 — 验证方不在仓库中搜到任何引用。
  - 生成的 nonce 仅做"唯一性", 不会写进 `nonceManager`。
  - 如果将来 `verifyAdminCommand` 简单复制 `verifyCommand` 逻辑而忘了 `checkAndUseNonce`, admin 命令可被无限重放 (在 30s 时间窗内)。
- **影响**: 当前没有调用方 (`grep signAdminCommand` 仅本文件), 但作为公开 API 接口, 未来误用风险高。
- **修复建议**:
  1. 把 `signAdminCommand` 改为 `signAdminCommand(command, adminSecret, actionType)`, 同时**写入** `nonceManager` (TTL=30s)。
  2. 添加 `verifyAdminCommand(signedCommand, adminSecret)`, 强制走 `nonceManager.checkAndUseNonce` + 时间窗检查。
  3. 文档中明确"admin 命令必须有显式 caller, 不允许在 test runtime 启用"。

---

## 🟢 P2 漏洞

### V4.12: 嵌套对象深度无限制 — `socket-payload-validator.ts` 不限制 JSON 深度
- **文件:行号**: `backend/src/websocket/socket-payload-validator.ts:10-14` (`asRecord`)
- **PoC**: 攻击者可发送 1MB 内任意深度的 `{ a: { a: { a: ... } } }`, `JSON.parse` 在 socket 端完成, 验证器递归 `typeof === 'object'` 走完一遍, 然后被原样转发到 detection pipeline / dashboard broadcast。
- **影响**: CPU 消耗 (深递归), 仪表板 React 渲染卡死 (嵌套对象导致浏览器 stack overflow)。
- **修复建议**: 在 `socket-payload-validator.ts` 顶层加 `MAX_DEPTH = 10`, 递归时传递 depth, 超限返回 `null`。

---

### V4.13: `agent:traffic_stats` 直接累加到 `globalStats` 无单调 / 上限检查
- **文件:行号**: `backend/src/websocket/agent-gateway.ts:531-587`
- **PoC**: `globalStats.packetsProcessed += probeStats.packetsProcessed || 0` (line 538), agent 可发送 `packetsProcessed: 1e15` 单帧, 后续所有 dashboard 看到 `1e15` 基线, 永远降不下来。
- **影响**: 监控指标中毒, 所有相对统计失真。
- **修复建议**:
  1. 对每个累加字段做 `Math.min(value, MAX_DELTA_PER_FRAME)`, 例如单帧累加上限 1e6。
  2. `bytesProcessed` 用 `BigInt` 或饱和到 `Number.MAX_SAFE_INTEGER`。
  3. 接收侧重置 / 滚动窗口机制。

---

### V4.14: `commandSigningService` 不与 `command-risk-policy` 联动 — 高危命令可绕过 admin approval
- **文件:行号**:
  - `backend/src/security/command-signing.service.ts` (完整)
  - `backend/src/security/command-risk-policy.ts:53-65`
  - `backend/src/services/command-dispatcher.service.ts:443-547` `dispatchAgentCommand` 才走 `classifyCommandRisk` 链路
- **PoC**: 恶意 admin 通过 REST `dispatchAgentCommand({ agentId, commandType: 'wipe_data' })` → `classifyCommandRisk('wipe_data')` 返回 `physical_confirmation_required` → 进入 `requestHardwareConfirmation` 路径, 等待硬件按钮。✅ 安全。
  但是, 通过 `deviceGateway.sendCommand(deviceId, 'wipe_data')` (`device-gateway.ts:718`) → 直接走 `signCommand` 路径, `sendCommand` 不调用 `classifyCommandRisk`, **不触发 hardware 确认**, 直接发给设备。
- **影响**: dashboard → deviceGateway 直接发包路径绕过了 `command-dispatcher` 的硬件授权网关。代码 `device-gateway.ts:718-735` 显式只检查 `allowGatewayDestructiveCommands()` (企业级运行模式), 不检查物理确认。
- **修复建议**:
  1. `deviceGateway.sendCommand` 在 `command-risk-policy` 返回 `physical_confirmation_required` 时**直接拒绝** (除非传入 `params.hardwareGrant`)。
  2. 统一命令下发入口: 所有 `commandType` 必须经 `command-dispatcher.dispatchDeviceCommand` 走, `deviceGateway.sendCommand` 改为 `private`。
  3. 审计每个 `deviceGateway.sendCommand` 调用点, 确认都带 `hardwareGrant`。

---

### V4.15: CORS 默认 `['http://localhost:5173']` — 缺少 ALLOWED_ORIGINS 时放行 dev origin
- **文件:行号**:
  - `backend/src/websocket/agent-gateway.ts:209`
  - `backend/src/websocket/device-gateway.ts:147`
- **PoC**: 部署时未设置 `ALLOWED_ORIGINS` 环境变量, 浏览器打开 `http://localhost:5173` 即可成功建立 WebSocket (同源策略仅阻止 HTTP 跨域, WebSocket 不受同源保护, 但浏览器会发 Origin 头, Socket.IO 用 CORS 检查)。如果 dashboard 用户访问了恶意页面 `http://attacker.com:5173/` (或者 nginx 反代配置错误把 5173 暴露), 可以读 cookie 拿 token (但 cookie 是 httpOnly, 实际读不到; 攻击者可代用户发起 dashboard WebSocket 仍需 cookie 配合)。
- **影响**: 中等 — 需要 CORS 误配 + 用户访问恶意页面同时发生。生产环境若漏配 `ALLOWED_ORIGINS` 是真实风险。
- **修复建议**:
  1. `validateRuntimeEnvironment` 在 `APP_MODE=production` 且无 `ALLOWED_ORIGINS` 时**启动失败**。
  2. 默认值改为空数组 `[]` 并强制显式配置。
  3. 在 device gateway 中要求 `Origin` 头必须匹配 device API 调用源 (很可能无浏览器, 默认拒绝有 Origin 的请求)。

---

## 已审计文件清单

| 文件 | 行数 | 重点检查项 |
|---|---|---|
| `backend/src/websocket/agent-gateway.ts` | 1279 | 速率限制覆盖率 (V4.2), 认证路径 (V4.3), 心跳校验 (V4.9) |
| `backend/src/websocket/device-gateway.ts` | 858 | 死代码 nonce (V4.5), broadcast 静默回退 (V4.1), finalDefense 信任 (V4.8) |
| `backend/src/websocket/socket-payload-validator.ts` | 138 | 嵌套深度 (V4.12), isOnline 透传 (V4.9) |
| `backend/src/websocket/socket-events.ts` | 111 | 类型契约 |
| `backend/src/security/command-signing.service.ts` | 170 | 时间窗 (V4.7), JSON canonicalization (V4.6), admin sign (V4.11) |
| `backend/src/security/nonce-manager.service.ts` | 224 | Redis failover 重放 (V4.7), TTL 不一致 (V4.7) |
| `backend/src/security/agent-auth.service.ts` | 401 | scrypt key derivation, API key hash timing-safe, race condition fix |
| `backend/src/services/socket-rate-limit.service.ts` | 239 | Redis Lua 原子脚本, 内存回退锁机制 |
| `backend/src/services/command-dispatcher.service.ts` | 1069 | setAgentGateway 注入 (V4.10), risk-class 集成 (V4.14) |
| `backend/src/security/command-risk-policy.ts` | 73 | 风险分类白名单, normalize 大小写/下划线 |

---

## 修复优先级建议 (按攻击成本 vs 影响排序)

1. **本周必修**: V4.1 (broadcast 无签名回退), V4.3 (isTestRuntime 误配)
2. **两周一周期**: V4.2 (agent 速率限制), V4.5 (device nonce 死代码清理), V4.10 (setter 注入点整改)
3. **下一 sprint**: V4.7 (nonce TTL + fail-closed), V4.8 (finalDefense 信任源), V4.9 (heartbeat 校验)
4. **后续清理**: V4.6 (JCS), V4.11 (admin sign 配对), V4.12-15 (硬化项)

---

## 备注

- 本次审计**未**触碰任何源代码。
- 报告不替代正式安全测试: 建议补一轮 fuzzing (尤其 `socket-payload-validator.ts` 边界) 和 pen-test (从外部模拟 attacker 调用 `device:data` / `agent:threat`)。
- 跟 `docs/refactor/roadmap-routes-db-migration.md` 已知 P1 整改 (`setAgentGateway` 删除) 高度耦合, 推进整改会同时解决 V4.10。
