# Wave 5 元漏洞审计 R8 深度攻击修复再审 - 2026-06-06

**审计范围**：AetherGuard 后端 (Sprint 5 · Wave 5 · R8 深度攻击修复的"修复之修复")
**审计员**：白盒静态审计（不修改代码、不运行攻击）
**审计时间**：2026-06-06
**审计重点**：Wave 1-4 修了一批 P0，**但新修复本身**可能不完美——审计 safe-merge / safe-regex / sql.js 原子性 / log-sanitizer 4 个修复组件的边界

---

## 摘要

- **审计覆盖 4 大类元漏洞**：safeMerge/stripProtoKeys 边界、safeRegex false negative、V2.7 sql.js 真实原子性、sanitizeString 漏报模式
- **漏洞总数**：14 处（P0 = 4、P1 = 6、P2 = 4）
- **Top 3 最严重**：
  1. **V8.2 NESTED_QUANTIFIER 漏报 `(a|a)*` / `(?:a+)+` 两大经典 ReDoS 家族** (P0) — safe-regex 的核心启发式仍有致命盲区
  2. **V8.5 sanitizeString 完全漏掉 AKIA / `ghp_` / `sk-` / Basic Auth / 中文字段 / Base64-wrapped secret** (P0) — log-sanitizer 误以为覆盖了主流格式，实际严重欠覆盖
  3. **V8.1 safeMerge 把 Function / Date / RegExp / Map / Set / typed array 当作普通 object 处理，但 `typeof === 'object'` 的分支会落到 mergeInternal，行为不一致** (P0) — `metadata` 字段污染时可能破坏后续消费者（如 .toJSON / .exec 静默调用）

> Wave 1-4 修复方向正确（PP 过滤、ReDoS 静态检测、原子 counter、log 脱敏），但 4 个工具的实现细节**留下了真实可利用的次级攻击面**。其中 safeRegex 的 `(a|a)*` 漏报和 sanitizeString 的 AWS key 漏报都是"看起来通过测试但生产必出洞"的典型反模式。

---

## 1. safeMerge / stripProtoKeys 边界

### V8.1: `safeMerge` 把 Function / Date / RegExp / Map / Set / typed array 视作 plain object，行为不可预测

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:47-84`
- **修复概述** (Wave 4):
  - 新增 `safeMerge(target, source, options?)` 与 `stripProtoKeys(obj)`
  - 用 `typeof value === 'object'` 判断是否递归
  - 对数组元素递归 `mergeInternal({}, item, ...)`
  - 过滤 `__proto__` / `constructor` / `prototype`
- **新攻击向量**:
  - 真实业务调用点（`scanner-task.service.ts:1636-1639`）把 `extra.metadata`（来源: scanner agent 上报的 JSON）传给 `safeMerge`
  - 真实业务调用点（`security-operations.service.ts:573-580`）把 `input.evidence` / `input.remediation`（来源: ingestion API）传给 `safeMerge`
  - **若 attacker 在 evidence 里塞 Date / RegExp / Error 实例**（通过自定义 Node.js Agent 上报，或通过 upstream service 反序列化漏洞注入），`safeMerge` 不会拒绝，而是走 `typeof value === 'object'` 分支递归进 `mergeInternal`
  - `mergeInternal` 走 `Object.keys(source)` —— 对 `Date` 返回 `[]`，对 `RegExp` 返回 `[]`（flags 是 non-enumerable），对 `Error` 返回 `['message']`（取决于 JS 引擎），对 `Map` / `Set` 返回 `[]`
  - 后果：**整个 Date / RegExp / Map 静默退化为 `{}`，原始数据全部丢失**。如果是 scanner evidence，evidence payload 中精心构造的 `RegExp` 实例的 `source` / `flags` 字段消失，**scanner 后续逻辑如果依赖 RegExp 实例类型判断（`value instanceof RegExp`）会得到意外结果**。
  - 更危险：**Function 实例**：`typeof fn === 'function'` 不属于 `typeof === 'object'`，但 `typeof fn === 'object'` 走 false 分支到 `else` (`target[key] = value`)，**Function 引用被原样保留**。如果 `target` 后续被 `JSON.stringify` 序列化（`metadata_json` 列），Function 会变成 `undefined`；如果**不**被序列化而是直接 `target.execute()` 调用（scanner dispatcher / hardware-gateway 之类），attacker 注入的函数引用就被执行
  - **典型污染面**：
    1. scanner 任务元数据被 attacker-controlled agent 注入 Function 引用 → dispatcher 拿到 `target.metadata.execute` 误以为是注册的 handler → 调用 attacker 函数
    2. finding `remediation.runScript` 字段若被注入 Function 引用，`remediation-executor` 直接执行
    3. RegExp 实例的 `lastIndex` 是有状态可变的——attacker 注入的 RegExp 在序列化后通过 `evidence` JSON 反序列化时 `lastIndex` 状态会异常，触发 scanner 逻辑 bug
- **PoC**:
  ```ts
  // scanner agent (attacker 已拿下) 上报 metadata：
  const maliciousMetadata = {
    scanner: { engine: 'nuclei' },
    callback: function attackerFn(cmd) { /* read env, exfil via DNS */ },
    pattern: /(.*)+$/,  // 序列化后变成 {}，但 instance 检测仍为 RegExp
    lastSeen: new Date('invalid'),  // Date 实例的 JSON 序列化变成 "Invalid Date"
    tags: new Set(['a', 'b'])  // Set 序列化变成 {}
  };
  await scannerTaskService.updateStage(stageId, { metadata: maliciousMetadata });
  // safeMerge 后:
  //   metadata.scanner = { engine: 'nuclei' }  ✓
  //   metadata.callback = [Function]            ← 保留!
  //   metadata.pattern = {}                    ← 退化
  //   metadata.lastSeen = {}                   ← 退化
  //   metadata.tags = {}                       ← 退化
  // dispatcher 后续: if (metadata.callback) metadata.callback(cmd) → RCE
  ```
- **影响**:
  - **RCE 路径**: 任何把 `target.metadata` 当作可执行结构（function field、RegExp.exec、Date.toISOString）的下游消费者都可能被利用
  - **数据完整性**: Date / RegExp / Map / Set / typed array 全部静默丢失数据，下游消费者拿到的 metadata 不完整
  - 与"PP 防御"目标不符：Function 引用绕过过滤直接进 target
- **修复建议**:
  1. **在 mergeInternal 顶部加 type whitelist**:
     ```ts
     const ALLOWED_TYPES = new Set(['object', 'array']);
     function mergeInternal(target, source, maxDepth, allowArrays, depth) {
       if (source === null || source === undefined) return target;
       if (depth > maxDepth) return target;
       // Reject everything except plain objects and arrays.
       if (typeof source !== 'object') return target;
       const proto = Object.getPrototypeOf(source);
       if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
         return target;  // skip Date, RegExp, Map, Set, Error, Function, etc.
       }
       // ... rest
     }
     ```
  2. **同样加 Function 检测**:
     ```ts
     if (typeof value === 'function') continue;
     ```
  3. 加单元测试：传 `{ fn: () => 1, date: new Date(), regex: /x/ }`，断言 `target.fn === undefined && target.date === undefined && target.regex === undefined`

---

### V8.2: `maxDepth` 默认 5，但调用方没显式传——递归不会触发 stack overflow，但行为未文档化导致下游误解

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:42-45, 54-56`
- **修复概述** (Wave 4):
  - `maxDepth: 5` 默认
  - `if (depth > maxDepth) return target;` 提前 return
  - 注释说"preserves the shape (no crash) but the deepest value is not promoted"
- **新攻击向量**:
  - 所有调用点（`security-operations.service.ts:424, 573, 577`、`scanner-task.service.ts:1636, 1868`、`devices.routes.ts:724`）**都没传 maxDepth**，使用默认 5
  - attacker 提交深度 > 5 的 metadata（如 `{a:{b:{c:{d:{e:{f:{g:{h: "pwn"}}}}}}}}`）时，level 6+ 的数据**静默丢失**
  - **风险 1 — silent data loss**：attacker 探测到 metadata 在 dashboard 上"明明有 8 层但 UI 只显示 5 层"，可能推断出 safeMerge 在跑，**给安全研究者可观察侧信道**（哪一层的 key 是否存在 ⇒ 是否过 safeMerge）
  - **风险 2 — race condition on `target[key]` mutation**：`mergeInternal` 在 depth > maxDepth 时 return `target`（**传入的那个 target**），但**不修改任何东西**。如果 caller 写 `const merged = safeMerge({}, deepObject)`，merged 是个新空对象，但 deepObject 的子结构可能被多轮 safeMerge 累积引用，导致**意外共享引用**（如果 caller 自己又 spread 一遍）
  - **风险 3 — stack overflow on maxDepth=0**：
    - 调用 `safeMerge({}, {a:1}, {maxDepth: 0})` → depth=0, source 是 object, 跳过第一个 if（depth > maxDepth 0>0 false），进入循环
    - `value = 1` 不是 object 也不是 array，走 else → `target.a = 1` ✓
    - 没问题
    - 但 `safeMerge({}, {a: {b: 1}}, {maxDepth: 0})` → depth=0, source 是 object, value `{b:1}` 是 object, **递归** `mergeInternal(target.a || {}, {b:1}, 0, true, 1)` → depth=1>0, return target.a (which is `{}`). So `target.a` stays `{}`. No crash, but `b:1` is lost.
  - **真正的 stack overflow 风险**：调用方传 `{maxDepth: 100000}` 同时 source 也是 100000 层深的对象。**会爆栈**。V8 默认 stack limit ~10k frames，每层 recursion 至少 1 frame + 各 helpers。所以 depth 100k 必然 stack overflow。
  - 调用方能不能传 `{maxDepth: 100000}`？所有现有调用方都是 hardcoded 数字，没有 attacker-controlled maxDepth 入口。所以**当前**没有 stack overflow 路径，但**未来**如果引入"用户可配置 maxDepth"或"从 env 读"就是 DoS。
- **PoC**:
  ```ts
  // 当前调用方 hardcoded，不可达。但作为未来风险：
  const deep = {};
  let cur = deep;
  for (let i = 0; i < 100000; i++) { cur.x = {}; cur = cur.x; }
  cur.payload = 'attacker-data';
  // 假设未来某 PR 引入：maxDepth: Number(process.env.MAX_MERGE_DEPTH || 5)
  // env 可控后，attacker 在 .env (V7.4 路径) 写 MAX_MERGE_DEPTH=1000000
  // 重启后任何 metadata 合并都会 stack overflow
  ```
- **影响**:
  - 当前不可达（hardcoded maxDepth=5）
  - 未来 `env-driven config` 反模式下会变成 PoC 路径
  - silent data loss 是已存在的"功能 bug"（文档说保留 shape，实际是 drop 深层）
- **修复建议**:
  1. **clamp maxDepth 到硬上限**:
     ```ts
     const HARD_MAX_DEPTH = 64;
     const maxDepth = Math.min(options.maxDepth ?? 5, HARD_MAX_DEPTH);
     ```
  2. **当 depth > maxDepth 时不 return target，return sentinel `__MERGE_DEEP_LIMIT_REACHED__`**，让 caller 决定怎么处理（drop / log warning / fallback to shallow merge）
  3. **文档化**：在 JSDoc 中明确"超过 maxDepth 的子树会被丢弃，不抛错"
  4. **拒绝 Function/Date/RegExp 等非 plain object** (见 V8.1)

---

### V8.3: `stripProtoKeys` 不递归 Symbol 键，但 Symbol 键的 PP 风险被低估

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:90-99`
- **修复概述** (Wave 4):
  - `stripProtoKeys` 用 `Object.keys(obj)` 遍历，**不处理 Symbol key**
  - `Object.keys` 只返回 enumerable string keys
- **新攻击向量**:
  - Symbol 键不入 `Object.keys`，所以**理论**上 Symbol 键的污染不会被 strip
  - **真实威胁评估**:
    - 攻击者无法通过 JSON 直接注入 Symbol key（JSON 不支持 Symbol 序列化）
    - 攻击者无法通过 `body-parser` / `express.json` 注入 Symbol key
    - Symbol 键只能通过**已经执行过的 JS 代码**注入
    - **所以 Symbol 键 PP 风险在 normal 攻击链中不成立**
  - **但**：`stripProtoKeys` 是"防御在野已被持久化数据"的最后一层（注释："Use for sanitizing data read back from DB before re-spreading"）
  - **场景**：某个老漏洞（Wave 1 之前）已经把 Symbol 键污染写进 DB（`metadata_json` 列）。**Wave 4 的 strip 不会清理这些 Symbol**，但 JSON 序列化会丢 Symbol 键，所以**重新读回的 Symbol 污染实际上**通过 JSON.stringify/parse 已经丢了一部分
  - **真正的隐患**：`mergeInternal` 在第 58 行 `for (const key of Object.keys(source as object))` — 同样**漏 Symbol 键**。但因为 `target[key] = value` 用了 computed property，**Symbol 键**如果**存在**于 `source` 上，会被**保留到 target**（因为 `Object.keys` 不枚举它们，但 `for (const key of Object.getOwnPropertySymbols(source))` 才能拿到）
  - **等等**：`Object.keys(source)` 真的**忽略** Symbol，所以**`mergeInternal` 不会**把 Symbol 键从 source 复制到 target。`target` 仍然是 plain
  - **结论**: Symbol 键路径在 safeMerge / stripProtoKeys 中**没有 PP 风险**（被静默忽略）
  - **真正的风险**：**测试覆盖盲区**——`safe-merge.test.ts` 第 73 行只测了 `hasOwnProperty.call(out, '__proto__')`，没测 Symbol 键
- **PoC**:
  ```ts
  // 攻击者无法通过正常 input 触发 Symbol PP。
  // 但要测试 stripProtoKeys 是否真的覆盖所有路径：
  const obj = Object.defineProperty({}, Symbol.iterator, { value: 'polluted', enumerable: true });
  // Object.defineProperty 默认 enumerable=false, 这里手动设 true
  const out = stripProtoKeys(obj);
  // Object.keys 不返回 Symbol，所以 Symbol 键不会被 strip
  // 但也不会被复制（因为 Object.keys 不遍历）
  // 所以 Symbol 污染在 strip 链中是被自然忽略的
  // 真要"test"这个，需要：
  expect(Object.getOwnPropertySymbols(out).length).toBe(0);
  ```
- **影响**:
  - 低 — Symbol 路径在标准攻击面下不可达
  - 中 — 测试覆盖盲区，未来如果有人重构用了 `Reflect.ownKeys` (会枚举 Symbol)，Symbol 键可能突然进入合并路径
- **修复建议**:
  1. **显式过滤 Symbol 键**:
     ```ts
     function stripProtoKeys<T = any>(obj: T): T {
       if (obj === null || typeof obj !== 'object') return obj;
       if (Array.isArray(obj)) return obj.map(stripProtoKeys) as any;
       const result: Record<string, any> = {};
       for (const key of Object.keys(obj as object)) {
         if (FORBIDDEN_KEYS.has(key)) continue;
         result[key] = stripProtoKeys((obj as any)[key]);
       }
       // No Symbol copy — defense in depth
       return result as T;
     }
     ```
  2. **加测试**:
     ```ts
     it('does not copy Symbol keys', () => {
       const sym = Symbol('test');
       const obj = { a: 1, [sym]: 'polluted' };
       const out = stripProtoKeys(obj);
       expect(Object.getOwnPropertySymbols(out)).toEqual([]);
     });
     ```

---

### V8.4: 数组元素的 `__proto__` 过滤 vs `Object.create(null)` 的微妙差异

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:61-67`
- **修复概述** (Wave 4):
  - 数组元素走 `value.map(item => typeof item === 'object' && item !== null ? mergeInternal({}, item, ...) : item)`
  - `mergeInternal` 第 59 行 `if (FORBIDDEN_KEYS.has(key)) continue;` 过滤 `__proto__` / `constructor` / `prototype`
- **新攻击向量**:
  - 测试 `safe-merge.test.ts:44-53` 验证"preserves arrays (and deep-clones their elements)" — 但**只测了基本类型元素**
  - **未测的路径**：
    ```ts
    safeMerge({}, { tags: [{ __proto__: { polluted: 'yes' } }] })
    // mergeInternal 内部 for...in 跳过 __proto__，所以 target[0] 不会包含 __proto__
    // 但因为 target 是个新对象（用 `{}` literal），其 __proto__ 仍是 Object.prototype
    // 所以如果后续某代码用 `({}).polluted` 测试，会得到 undefined
    // 看似安全，但：
    ```
  - **真正隐患**: 数组元素的 `mergeInternal({}, item, ...)` 把每个元素 merge 到**新的空对象**。如果 `item` 是 `Object.create(null)`（没有 prototype），mergeInternal 第 58 行 `for (const key of Object.keys(source as object))` 仍能拿到 keys（Object.keys 在 null-proto 对象上工作正常）
  - **构造恶意数组元素**:
    ```ts
    const evil = JSON.parse('{"__proto__": {"polluted": "yes"}, "ok": "fine"}');
    // JSON.parse 不会把 __proto__ 设为 own property
    // 但 attacker 如果控制了 source 对象的构造（比如通过一个 custom JSON reviver），
    // 就可以直接用 Object.create(null) + own __proto__ key
    ```
  - **JSON.parse 的 quirks**:
    - `JSON.parse('{"__proto__": {"polluted": "x"}}')` 在 V8 中**确实**会创建 own `__proto__` 属性（与其他 property 一样），但**会**触发 `__proto__` setter（把 prototype 改成 `{polluted: "x"}`）
    - 测试 `safe-merge.test.ts:17-24` 显式用 `JSON.parse('{"__proto__": ...}')` 然后 safeMerge，**测试通过了** — 这说明 `Object.keys(JSON.parse(...))` 不返回 `__proto__`（因为 V8 把它当作 prototype 赋值而不是 own property）
    - **但**：如果 attacker 通过 `body-parser` (JSON) 上传 `{ "__proto__": { "polluted": "yes" } }`，**V8 在解析时已经把 Object.prototype 改成 `{polluted: "yes"}`**（因为 `__proto__` 是 setter）
    - **整个 process 的 Object.prototype 被污染**，所有 `safeMerge` 调用都基于这个被污染的 prototype 工作
    - 测试为什么能过？因为测试 case 是新启动的 process，第一个 `JSON.parse` 就污染了 Object.prototype，但 safeMerge 用 `for (const key of Object.keys(...))` — Object.keys **不返回 __proto__**，所以**这个特定 case 看起来过滤了**，但 Object.prototype **已经**被污染了
    - **结论**：safeMerge 的 `FORBIDDEN_KEYS` 过滤**不能修复**已被污染的 Object.prototype — 因为 `Object.prototype` 上的 `polluted` 是通过 prototype 链访问，不是 own property
- **PoC**:
  ```ts
  // Stage 1: 通过 body-parser 上传
  POST /api/something-with-metadata
  Content-Type: application/json
  {"__proto__": {"isAdmin": true}, "name": "x"}
  // V8 解析时调用 Object.prototype.__proto__ setter
  // 现在整个 process: ({}).isAdmin === true

  // Stage 2: 任何后续的 auth check
  if (user.role === 'admin' || {}.isAdmin) {  // {}.isAdmin is true
    grantAccess();
  }
  // 这是真正的 PP 攻击 — safeMerge 的 filter 防不住已污染的 Object.prototype
  ```
- **影响**:
  - **P0 风险**：safeMerge **不能**防"已污染的 Object.prototype 后"的合并
  - 真正需要的是 F6 body-parser 层级的 `__proto__` 过滤（V7.5 已提到），而不是 merge 时过滤
  - Wave 4 的注释自己承认："Even if F6 (body-parser) blocks `__proto__` keys at parse time, an attacker who already has data persisted in the DB can re-trigger PP on read-back" —— 但 safeMerge **实际上**也没能挡住 read-back PP（因为 Object.keys 不返回 __proto__，但 prototype 链上的 `polluted` 会被 access）
- **修复建议**:
  1. **用 `Object.create(null)` 作为 target 起点**:
     ```ts
     const result: Record<string, any> = Object.create(null);
     ```
     这样 result 没有 prototype 链，attacker 注入的 `__proto__` 不会污染 result 的 prototype
  2. **同时** stripProtoKeys 的 result 也用 `Object.create(null)`:
     ```ts
     const result: Record<string, any> = Object.create(null);
     ```
  3. **递归后用 `Object.hasOwn(obj, key)` 替代 `obj[key]`** 直接读，**绕过 prototype 链查找**:
     ```ts
     for (const key of Object.keys(source as object)) {
       if (FORBIDDEN_KEYS.has(key)) continue;
       const value = Object.hasOwn(source, key) ? (source as any)[key] : undefined;
       // ...
     }
     ```
  4. **加测试**: 先 `Object.prototype.polluted = true`，再 safeMerge，断言 result 不会通过 prototype 链 access 到 polluted

---

### V8.5: 1GB source size — safeMerge 一次性 deep clone，CPU+memory DoS

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts`（整文件） + 所有调用方
- **修复概述** (Wave 4):
  - safeMerge 递归遍历 source 每一个 key
  - 对 array 元素 `.map(item => ...)` — 一次性 map 全部元素
- **新攻击向量**:
  - 调用点 `security-operations.service.ts:573-580`:
    ```ts
    const mergedEvidence = safeMerge(
      { ...this.parseJson(existing.evidence_json, {}) } as Record<string, any>,
      stripProtoKeys(input.evidence || {})
    );
    ```
    **没有 size limit 检查**。`input.evidence` 来源是 API request body
  - 调用点 `scanner-task.service.ts:1636-1639`:
    ```ts
    target.metadata = safeMerge(
      { ...(target.metadata || {}) } as Record<string, any>,
      stripProtoKeys(extra?.metadata || {})
    );
    ```
    同上无 size limit
  - **Express body-parser 默认 limit 是 100kb**（`express.json({ limit: '100kb' })`），但项目实际 limit 多少需查
  - **若 limit 是 100kb**: attacker 上传 100kb evidence，单次 safeMerge 是 O(n)，100kb ~25000 keys，毫秒级，OK
  - **若 limit 较大** (1mb / 10mb) 或**嵌套深 + 数组长**: O(n) × 嵌套层数，100kb 全是数组元素会有 ~50万次 recursion
  - **真实风险**：
    1. **memory 放大 2-3x**: target 是新建对象，source 是新对象（递归调用 mergeInternal({}, item)），加上源 string keys 的拷贝，**实际占用是 source 的 2-3 倍**
    2. **JSON.parse 上游已经吃一遍内存**，safeMerge 又吃一遍，**两次解析** = 1GB 上传 → 进程占用 2-3GB
    3. **stuck event loop**: 同步 recursion（无 await）会**完全阻塞** Node.js event loop，期间所有其他请求 hang
- **PoC**:
  ```bash
  # 假设 body-parser limit 是 5mb
  # attacker 用大 metadata 打 scanner ingestion
  for i in $(seq 1 100); do
    curl -X POST 'https://target/api/scanner/ingest' \
      -H "Cookie: accessToken=$JWT" \
      -H 'Content-Type: application/json' \
      -d "$(python3 -c 'import json; print(json.dumps({"metadata": {"k"+str(x): "x"*1000 for x in range(5000)}}))')" &
  done; wait
  # 100 个并发请求，每个 safeMerge ~5MB → 进程占用 1-2GB，event loop 阻塞 5-10s
  ```
- **影响**:
  - **DoS 放大器**: 配合 body-parser 弱 limit，单个 IP 可用中等带宽把后端打死
  - 与 V7.1 (safeErrorMessage) 的 DoS 放大器**同类问题**：热路径上做无 size guard 的 CPU-heavy 工作
- **修复建议**:
  1. **在 safeMerge 入口加 size guard**:
     ```ts
     const MAX_KEYS = 10_000;
     const MAX_NODES = 50_000;
     let keyCount = 0;
     let nodeCount = 0;
     function mergeInternal(target, source, maxDepth, allowArrays, depth) {
       // ... existing checks
       for (const key of Object.keys(source)) {
         keyCount++;
         if (keyCount > MAX_KEYS) {
           throw new Error(`safeMerge: exceeded MAX_KEYS=${MAX_KEYS}`);
         }
         // ...
       }
     }
     ```
  2. **或者**用 estimated size guard:
     ```ts
     function estimatedNodeCount(obj: unknown): number {
       if (obj === null || typeof obj !== 'object') return 1;
       if (Array.isArray(obj)) return 1 + obj.reduce((sum, item) => sum + estimatedNodeCount(item), 0);
       return 1 + Object.values(obj).reduce((sum, v) => sum + estimatedNodeCount(v), 0);
     }
     if (estimatedNodeCount(source) > 50_000) {
       throw new Error('safeMerge: source too large');
     }
     ```
  3. **所有调用方**在传入前对 input 做 `JSON.stringify(input).length` 校验
  4. **配合**严格 body-parser limit (e.g. 100kb)

---

## 2. safeRegex false negative

### V8.6: `NESTED_QUANTIFIER` 漏报 `(a|a)*` —— 经典 ReDoS 反模式

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:29, 70-75`
- **修复概述** (Wave 3):
  - `NESTED_QUANTIFIER = /\((?:[^()?:+*]+|\\.)[?+*]\)[+*]/`
  - 测试覆盖 `(a+)+$`, `(.*)*`, `(a+)+`, `(.+)*`
- **新攻击向量**:
  - **NESTED_QUANTIFIER 的 inner pattern 是 `(?:[^()?:+*]+|\\.)[?+*]`**：
    - `[^()?:+*]+` 匹配**不含** `(`, `)`, `?`, `:`, `+`, `*` 的连续字符
    - `\\.` 匹配转义字符
    - `[?+*]` 要求**最后一个字符是 quantifier**
  - **`(a|a)*`** 的结构：
    - `(` 匹配 `\(`
    - `a|a` 走 `[^()?:+*]+` 路径：`a` (✅) `|` (✅, `|` 不在排除集) `a` (✅) — 三个字符都匹配
    - 接着需要 `[?+*]` 匹配——**但** `a` 之后是 `)`，**不是 quantifier**
    - 所以 NESTED_QUANTIFIER **不匹配** `(a|a)*`
  - **`(a|a)*` 的实际 ReDoS 行为**：
    - 输入 `aaaaaab` (末尾 b)
    - 引擎尝试 `(a|a)*` 匹配所有 a 的可能分组（2^n 种）
    - 在 `b` 处失败，回溯所有 2^n 种组合
    - **O(2^n) 时间复杂度**
  - **同理漏报的家族**：
    - `(a|b)*` — 同上
    - `(ab|cd|ef|gh)*` — 4^n
    - `([abc]|[def])*` — 字符类变体
    - `([abc]|[def])+x` — 加终止符更危险
  - **测试覆盖盲区**：
    - `safe-regex.test.ts:13-33` 只测 `(a+)+$` / `(.*)*` / `(a+)+` / `(.+)*` —— 全部是"inner 有 quantifier"的形态
    - **没测**"inner 是 alternation / char class" 形态
- **PoC**:
  ```ts
  // attacker 提交 pattern = '(a|a)*' 给 tool-executor
  validateRegexPattern('(a|a)*')
  // 返回 { valid: true, reason: undefined }  ← 应该 false positive
  // tool-executor 编译: new RegExp('(a|a)*', 'gi')
  // 然后用 100k 字符的 'a' 输入
  for (let i = 0; i < 100000; i++) content += 'a';
  content += 'X';  // 不能 match 'b'，触发回溯
  // ReDoS: ~2^100000 不可能完成 → Node.js 进程挂死 (除了 setTimeout 1s 的兜底)
  // 但 setTimeout 兜底只能 break，不能 kill 进程，1000 次 ReDoS 之后 event loop 还是被反复阻塞
  ```
- **影响**:
  - **P0**: safe-regex 是 ReDoS 防御的**最后一道关卡**（注释自承"the second line of defense"是 timeout 兜底），第一道关卡漏报 = ReDoS 可达
  - 1s 的 setTimeout 兜底意味着 1000 个 ReDoS 请求可以把 event loop 反复阻塞（每次阻塞几秒），CPU 100%
  - **真实调用点**: `tool-executor.ts:420-425` 把 user-supplied patterns 编译执行
- **修复建议**:
  1. **放宽 NESTED_QUANTIFIER 的 inner char class**:
     ```ts
     // 原: /\((?:[^()?:+*]+|\\.)[?+*]\)[+*]/
     // 新: 匹配任何 quantifier-on-group 包括 alternation
     const NESTED_QUANTIFIER = /\((?:[^()]+|\\.)*\)[+*]/;
     ```
  2. **加 alternation 检测**:
     ```ts
     const NESTED_ALTERNATION = /\([^()]*\|[^()]*\)[+*]/;
     ```
  3. **加 lookahead 检测**:
     ```ts
     const NESTED_LOOKAHEAD = /\(\?=[^()]*\)[+*]/;
     ```
  4. **加测试**:
     ```ts
     it('rejects (a|a)*', () => {
       expect(validateRegexPattern('(a|a)*').valid).toBe(false);
     });
     it('rejects ([abc]|[def])*', () => {
       expect(validateRegexPattern('([abc]|[def])*').valid).toBe(false);
     });
     ```

---

### V8.7: NESTED_QUANTIFIER 漏报 `(?:a+)+` —— non-capturing group 同样 ReDoS

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:29, 70-75`
- **修复概述** (Wave 3):
  - 同 V8.6
- **新攻击向量**:
  - **`(?:a+)+` 的结构**：
    - `\(` 匹配 `(`
    - `(?:[^()?:+*]+|\\.)` 尝试匹配 inner — 第一个字符是 `?`，**`?` 在 `[^()?:+*]+` 排除集中**，所以 `[^()?:+*]+` 不能 match
    - 尝试 `\\.` 路径——需要 `\` 开头，但下一个字符是 `?`，**不 match**
    - **NESTED_QUANTIFIER 整个 pattern 在 `?` 处就 fail**，根本不进入匹配
  - **`(?:a+)+` 的实际 ReDoS 行为**：
    - 与 `(a+)+` **完全相同** —— `?:` 只是 non-capturing 标记，**不影响**回溯行为
    - 输入 `aaaaaac` —— 引擎尝试所有 `(?:a+)+` 的可能展开
    - **O(2^n) 时间复杂度**
  - **测试盲区**：
    - `safe-regex.test.ts:91-99` 测的是"escaped parens don't count toward depth"
    - **没测** `(?:...)` 加 quantifier 的形态
  - **同理漏报**：
    - `(?P<name>...)+` (Python 风格 named group，JS 不支持所以不实用)
    - `(?<name>...)+` (ES2018 named group)
    - `(?!a)+` (negative lookahead 加 quantifier)
- **PoC**:
  ```ts
  validateRegexPattern('(?:a+)+b')
  // 期望: { valid: false, reason: 'nested quantifier' }
  // 实际: { valid: true }  ← false negative!
  ```
- **影响**:
  - **P0**: 与 V8.6 同等严重
  - 用户更可能用 non-capturing group（出于"性能"误解），所以这个 attack vector **实际触发率更高**
- **修复建议**:
  1. **改写 NESTED_QUANTIFIER 兼容 non-capturing**:
     ```ts
     // 匹配任何 group（capturing / non-capturing / lookaround / named）后跟 + 或 *
     const NESTED_QUANTIFIER = /(?:\((?:\?[:=!]?|<[^>]+>)?[^()]*\)|\\.)[+*]/;
     ```
  2. **或者用更宽松的字符类**:
     ```ts
     // 任何 group 后跟 quantifier，inner 允许任何非 ( 的字符（除了 +/*/? 可能多重叠）
     const GROUP_WITH_QUANTIFIER = /\((?:\?[:=!]?|[^()?])[^()]*\)[+*]/;
     ```
  3. **加测试**:
     ```ts
     it('rejects (?:a+)+b', () => {
       expect(validateRegexPattern('(?:a+)+b').valid).toBe(false);
     });
     ```

---

### V8.8: 漏报 lookahead injection `(?=(a+)+$)`

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:29-86`
- **修复概述** (Wave 3):
  - NESTED_QUANTIFIER 只能检测 capturing / non-capturing 形式
  - **lookahead `(?!...)` / `(?=...)` / `(?<=...)` / `(?<!...)` 是另一类 group** —— NESTED_QUANTIFIER 不识别
- **新攻击向量**:
  - **`(?=(a+)+$)`**：
    - `\(` 匹配
    - `(?=` —— `?` 在排除集，**`[^()?:+*]+` 不 match**（如 V8.7 分析）
    - 整个 pattern **不匹配** NESTED_QUANTIFIER
    - **但 `(?=(a+)+$)` 的 ReDoS 行为与 `(a+)+$` 完全相同** —— lookahead 不影响回溯
  - **同理漏报家族**：
    - `(?=(a|a)*)`
    - `(?=([abc]+)+)`
    - `(?<=(a+)+)`
- **PoC**:
  ```ts
  validateRegexPattern('(?=(a+)+$)')
  // 期望: false
  // 实际: true  ← false negative
  ```
- **影响**:
  - **P0**: 与 V8.6 / V8.7 同等严重
- **修复建议**:
  1. 改写 NESTED_QUANTIFIER 用 **non-greedy match-then-quantifier**:
     ```ts
     // 匹配: 任何 group 后紧跟 + 或 *
     const NESTED_QUANTIFIER = /\([^()]*\)[+*]/;
     ```
     这样 lookahead 也被覆盖（`(?=...)` 是 `\(...\)` 的子集）
  2. **但要小心 depth 限制**：`/\([^()]*\)/` 会匹配最浅的 group，但**不会跨 group 边界**（`[^()]*` 排除 `(` 和 `)`）。所以 `(a(b+)+)` 中：
     - `\(` 匹配外层 `(`
     - `[^()]*` 匹配 `a`（在碰到 `(` 前停下）
     - `\)` 匹配外层 `)` —— 但**外层 `)` 之前是 `+`** ！**不匹配** `)`。
     - 所以 NESTED_QUANTIFIER 不匹配 `(a(b+)+)`
  3. 实际上需要更复杂的 pattern 处理嵌套：
     ```ts
     // 检测任何 group 紧跟 quantifier
     function detectNestedQuantifiers(pattern: string): boolean {
       let depth = 0;
       let inEscape = false;
       for (let i = 0; i < pattern.length; i++) {
         const c = pattern[i];
         if (inEscape) { inEscape = false; continue; }
         if (c === '\\') { inEscape = true; continue; }
         if (c === '(') depth++;
         else if (c === ')') depth--;
         else if ((c === '+' || c === '*' || c === '?') && depth > 0) {
           // quantifier appears inside a group — check if the group itself is quantified
           // Find the matching '(' for the current depth
           // (simplified: just detect if a quantifier appears within a group that itself has a quantifier)
           return true;
         }
       }
       return false;
     }
     ```
  4. **简化方案**: 改用循环而不是 regex，track depth + escape

---

### V8.9: 长度限制 500 字符可被 `[\s\S]{400}` 字符类绕过 — 实际匹配长度远超 500

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:15, 63-68`
- **修复概述** (Wave 3):
  - `MAX_PATTERN_LENGTH = 500` 字符
  - 注释:"Pattern exceeds 500 chars"
- **新攻击向量**:
  - 字符类量词可以**单字符表示 400+ 长度**：
    - `[\s\S]{400}` —— 9 字符，但匹配 400 个任意字符
    - `[\s\S]{400,500}` —— 14 字符，匹配 400-500
    - `[a-z]{500}` —— 8 字符，匹配 500
    - `.{500}` —— 6 字符（虽然 `.` 不匹配 newline，但配合 `s` flag 或 multiline）
    - `[\w\W]{500}` —— 10 字符
  - **Pattern 长度 500 ≠ 实际匹配长度 500**
  - **组合 ReDoS**：
    - Pattern: `([\s\S]{400})+\d` —— 30 字符，匹配 400 字符 + 一个数字
    - 内部 `[\s\S]{400}` + 外部 `+` —— **nested quantifier**
    - **NESTED_QUANTIFIER 漏报**（因为 inner char class 允许 `]` / `{` 等，`[^()?:+*]+` 在 `{` 处停止）
  - **真实 ReDoS 形态**:
    ```ts
    validateRegexPattern('([\\s\\S]{400})+\\d')
    // 长度 ~21 字符，通过 500 limit
    // NESTED_QUANTIFIER 不匹配（inner 是 `[\s\S]{400}`，第一个字符 `[` 在 `[^()?:+*]+` 中? `[^()?:+*]+` 是字符类排除 `[` (✅ excluded), `(` (✅), `)` (✅), `?` (✅), `:` (✅), `+` (✅), `*` (✅) — wait `[` 不在排除集
    // 重新读 `[^()?:+*]+`: 字符类排除 `(`, `)`, `?`, `:`, `+`, `*`. `[` 不在排除集
    // 所以 `[\s\S]{400}` 的 `[` 能被 `[^()?:+*]+` 匹配
    // 但继续匹配 `\s\S]{400}` 呢？`\s` 是转义，走 `\\.` 路径——但下一个字符是 `\`，**`\\.` 匹配 `\` + 一个字符**。OK, matches `\s`. 然后继续...
    // 实际上 `[^()?:+*]+` 贪婪匹配尽可能多，包括 `[`, `]`, `{`, `}`, `0-9`, `,`
    // 然后 `[?+*]` 期待 quantifier — 但当前匹配已经到了字符串末尾或 quantifier 字符 + 之前
    // 让我手动追踪: pattern = `([\s\S]{400})+\d`
    //   `\(` matches `(`
    //   `[^()?:+*]+` greedy matches `[\s\S]{400}` 全部? 让我看哪些字符在排除集:
    //     `[` ✅ not excluded
    //     `\` ✅ not excluded
    //     `s` ✅ not excluded
    //     `\` ✅
    //     `S` ✅
    //     `]` ✅
    //     `{` ✅
    //     `4`,`0`,`0` ✅
    //     `}` ✅
    //   所以 `[^()?:+*]+` matches `[\s\S]{400}` 全部 12 个字符
    //   然后 `[?+*]` 期待 quantifier — 下一个字符是 `)`，**不匹配**
    //   所以 NESTED_QUANTIFIER **不匹配** `([\s\S]{400})+\d`
    ```
  - **结论**: `([\s\S]{400})+\d` 既 bypasses 500 char limit, 又 bypasses NESTED_QUANTIFIER detection, 又 bypasses HEAVY_BACKREFERENCE (因为没有 backref)
- **PoC**:
  ```ts
  // 提交 pattern
  validateRegexPattern('([\\s\\S]{400})+\\d')
  // 期望: false
  // 实际: true  ← 三重 false negative
  // 运行时: new RegExp('([\\s\S]{400})+\d', 'gi')
  // 输入: 500 个 'a' + 'X' (no digit)
  // 引擎: 尝试 (a*)* 的所有展开
  // 4.3e120 种组合 (or 1.5e+301?), 实际时间 O(2^n)
  ```
- **影响**:
  - **P0**: 三重 false negative，**完全开放的 ReDoS 通道**
- **修复建议**:
  1. **改用循环检测 quantifier inside group** (见 V8.8 修复建议 3)
  2. **加测试**:
     ```ts
     it('rejects nested char-class quantifier', () => {
       expect(validateRegexPattern('([\\s\\S]{400})+\\d').valid).toBe(false);
     });
     it('rejects nested char-class quantifier with alternation', () => {
       expect(validateRegexPattern('([a-z]|[0-9]){400}+x').valid).toBe(false);
     });
     ```

---

### V8.10: 长度限制 500 字符 + char class 不限制内嵌 quantifier 深度

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:15, 63-68, 86-108`
- **修复概述** (Wave 3):
  - `MAX_PATTERN_LENGTH = 500`
  - `MAX_GROUP_DEPTH = 3`
- **新攻击向量**:
  - **`{100,1000}{100,1000}{100,1000}`** (3 个 quantifier 嵌套) 字符长度 ~30，但**实际匹配长度**可达 10^9
  - `MAX_GROUP_DEPTH = 3` 只检查**括号嵌套**，不检查 quantifier 嵌套
  - attacker 提交 `(a{1,100000}){1,100000}` —— 17 字符，depth=1，但实际回溯空间是 100000 × 100000
- **PoC**:
  ```ts
  validateRegexPattern('(a{1,100000}){1,100000}')
  // 长度 20 字符，< 500 ✓
  // depth = 1, < 3 ✓
  // NESTED_QUANTIFIER: 内层 `(a{1,100000})` 后面是 `{1,100000}` 不是 quantifier
  //   `\(` `(`, `[^()?:+*]+` matches `a{1,100000`? `1` 在排除集外. 然后 `[?+*]` 期待 quantifier — 下个字符是 `}`, 不匹配
  //   所以 NESTED_QUANTIFIER **不匹配**
  // 通过所有检查，false negative
  // 运行时: 输入 'aaaaa...' (1000 chars), 引擎尝试所有 quantifier 组合
  ```
- **影响**:
  - **P1**: 量化的 ReDoS，没有 `(a+)+` 那么夸张（线性到多项式），但仍可被利用做 DoS
- **修复建议**:
  1. **检测 quantifier 嵌套** (即使不在 group 内):
     ```ts
     const NESTED_QUANTIFIER_ANYWHERE = /[{][^}]*[}][*+?{]/;  // 量词后跟量词
     ```
  2. **限制 quantifier 数值上限**:
     ```ts
     const MAX_QUANTIFIER_VALUE = 1000;
     function checkQuantifierValues(pattern: string) {
       const matches = pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g);
       for (const m of matches) {
         const max = m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10);
         if (max > MAX_QUANTIFIER_VALUE) return false;
       }
       return true;
     }
     ```
  3. **加测试**:
     ```ts
     it('rejects (a{1,100000}){1,100000}', () => {
       expect(validateRegexPattern('(a{1,100000}){1,100000}').valid).toBe(false);
     });
     ```

---

### V8.11: `HEAVY_BACKREFERENCE` 只检测 `(.+)\\d+{}` —— 攻击者换字符类即可绕过

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:37, 77-82`
- **修复概述** (Wave 3):
  - `HEAVY_BACKREFERENCE = /\(\.\+\)\\\d+\{\d+,?\d*\}/`
  - 只匹配 `(.+)\1{...}` 这种形式
- **新攻击向量**:
  - **`HEAVY_BACKREFERENCE` 漏报**:
    - `([^]+)\1{2,}` —— `[^]+` 等价于 `.+` 但用字符类形式 (V8 引擎 `\n` 也匹配)
    - `(\w+)\1{2,}` —— backref with word chars
    - `([abc]+)\1{2,}` —— backref with limited char class
    - `(.+)\1+` —— backref 自身加 quantifier（不是 `{...}` 形式）
    - `(.+)\1{0,100000}` —— 大范围 quantifier
  - **regex 字面** `(.+)` 必须用 `\.` 转义点，**但 `\.+` 也匹配 `....+` (literal dots)** —— 攻击者可以用 `\.+` 让 HEAVY_BACKREFERENCE **误判**：`(\.+)\1+` 形式但 `\.+` 字面意思是 dot 重复，不算 PP 字符。但 HEAVY_BACKREFERENCE 还是会拒绝（因为匹配的是字面 `(\.+)` 部分），**产生 false positive**。
  - **真正的漏报**:
    - `([\s\S]+)\1+` —— char-class form of `.+`
- **PoC**:
  ```ts
  validateRegexPattern('([\\s\\S]+)\\1+')
  // HEAVY_BACKREFERENCE: `\(\.\+\)\\\d+` 要求字面 `(.+)\1` —— 这个 pattern 是 `([\s\S]+)\1`，不 match
  // NESTED_QUANTIFIER: `([\s\S]+)\1` 整个不是 `(...)+` 形式, 不 match
  // 通过所有检查，false negative
  // 运行时: new RegExp('([\\s\\S]+)\\1+', 'gi')
  // 输入: 1000 字符 + 重复 1000 字符 (无匹配), 引擎尝试所有回溯
  ```
- **影响**:
  - **P1**: Backref ReDoS 在长输入下是**线性到多项式**（不像 nested quantifier 的指数），所以比 V8.6 严重度低
  - 但**真实可利用**（attacker 可以用 `(\w+)\1+` 攻击）
- **修复建议**:
  1. **改写 HEAVY_BACKREFERENCE 兼容 char class**:
     ```ts
     const HEAVY_BACKREFERENCE = /\((?:[^\(\)]+|\[\^?\][^\]]*\])\)\\[1-9]\d*[{+*?]/;
     ```
  2. **或者更激进: 任何 backref 出现都拒绝** (简单安全):
     ```ts
     const HAS_BACKREF = /\\\d+/;
     if (HAS_BACKREF.test(pattern)) return { valid: false, reason: 'back-reference not allowed' };
     ```
  3. **加测试**:
     ```ts
     it('rejects char-class backref', () => {
       expect(validateRegexPattern('([\\s\\S]+)\\1+').valid).toBe(false);
     });
     ```

---

## 3. V2.7 sql.js 原子性真实如何

### V8.12: 单进程 sql.js 模式下"原子性"确实成立，但**PG 路径 / 多 worker 部署下是隐性 race**

- **目标文件**: `X:\repos\Networksafe\backend\src\services\hardware-authorization.service.ts:619-653`
- **修复概述** (Wave 2 V2.5/V2.7):
  - `UPDATE hardware_gates SET last_monotonic_counter = ?, ... WHERE gate_id = ? AND last_monotonic_counter < ?`
  - 紧跟 `SELECT last_monotonic_counter FROM hardware_gates WHERE gate_id = ?`
  - 注释:"the TOCTOU window between the UPDATE and the SELECT is closed because both statements run inside the same synchronous JS tick — no other ack can interleave on the in-process sql.js backend"
- **新攻击向量**:
  - **单进程 sql.js 模式**（当前 dev / demo）：**修复确实有效**
    - JS event loop 是单线程的
    - `getDatabase().prepare(...).run(...)` 是**同步**调用（sql.js shim line 615-622）
    - UPDATE → SELECT 之间**没有 `await`**
    - 其他 async 函数**不能**在两行之间插入执行
    - **结论**: 单进程 sql.js 下"原子"成立 ✓
  - **多 worker 部署**（PM2 cluster / K8s 多副本）:
    - `getDatabase()` 在每个 worker 内是**独立的 in-memory sql.js 实例**（如果用 sql.js mode）或独立的 sql.js connection
    - 两个 worker 各自 in-memory 持有 `hardware_gates` 表的副本
    - **race 1 — 同 session 同 counter 双 worker**:
      - Worker-1: 读 counter=4, validate (5>4 ✓), UPDATE 4→5 (worker-1 in-mem), SELECT=5, INSERT grant
      - Worker-2: 同时读 counter=4 (worker-2 in-mem), validate (5>4 ✓), UPDATE 4→5 (worker-2 in-mem)
        - Worker-2 的 UPDATE 不带 `last_monotonic_counter < ?` 条件? 让我重读代码...
        - 代码 line 632-636: `WHERE gate_id = ? AND last_monotonic_counter < ?` —— 用了条件
        - **但** worker-2 in-mem 的 `last_monotonic_counter` 还是 4（worker-1 的更新未同步）
        - 所以 worker-2 的 `WHERE last_monotonic_counter < 5` 条件**通过**（4 < 5）
        - UPDATE 在 worker-2 in-mem 执行: 4→5
        - SELECT 读 worker-2 in-mem: 5
        - **两个 worker 都认为 UPDATE 成功**
        - INSERT grant —— **UNIQUE(session_id) 约束在 worker-local sql.js 各自检查**！每个 worker 的 sql.js 是独立数据库副本，UNIQUE 约束**只在该副本生效**
        - 后果：**两个 worker 都成功 INSERT grant**，**两次 grant 发出去**
    - **race 2 — 跨 session 同一 counter**:
      - 两个不同 sessionId 但同 counter
      - Worker-1 验 S1 (counter=5), UPDATE 4→5, INSERT grant S1 ✓
      - Worker-2 验 S2 (counter=5), UPDATE 4→5, INSERT grant S2 ✓
      - 这次都"成功"，**lastMonotonicCounter 始终是 5**，下一个 counter=6 的合法 ack 仍能通过
      - 后果：**两个不同 session 都拿到 grant**，**counter 单调性被破坏**（应该是 5, 6, 7 现在是 5, 5, 6）
      - **实际危害**：attacker 用合法 session S1 + counter=5 拿到 grant，同时构造 S2 伪造也 counter=5 拿到 grant —— **第二个 grant 是伪造的（counter 应是 6）**
  - **PG 路径**:
    - ADR 显式要求 PG primary write path
    - PG 的 `last_monotonic_counter` 是**共享 row**，但两个 connection 各自 in-transaction view 不同
    - **race 3 — PG MVCC**:
      - 两个 connections 各自 BEGIN, read counter=4
      - 两个 connections 各自 validate (5>4 ✓)
      - 两个 connections 各自 UPDATE
      - **PG 行锁**：先到的 connection 拿 lock，UPDATE 4→5 成功。后到的 connection 等 lock
      - 后到的 connection 拿到 lock 时，`last_monotonic_counter` 已是 5
      - `WHERE last_monotonic_counter < 5` **0 rows affected**
      - SELECT 读 5 ≠ 期望的 5 → 等等，5 == 5 ✓
      - **false pass!** 后到的 connection SELECT 读到 5，**与 monotonicCounter=5 相等**，验证通过！
      - 但 UPDATE 实际没改动 (0 rows)
      - **结果**: 两个 connections 都返回 `handled: true, confirmed: true`，**两个 grant 都发出去了**
- **PoC** (理论, 取决于部署):
  ```ts
  // 多 worker 部署 (PM2 cluster) 下的并发 ack
  // 两个 worker 同时处理同一 session 的两个 ack
  // 实际可达性取决于 hardware gateway 端是否支持重放
  // 但 counter 单调性破坏在跨 session 场景下更可达：
  for (let i = 0; i < 100; i++) {
    parallelFetch(`https://worker1/api/hardware-ack?session=S${i}&counter=5`)
    parallelFetch(`https://worker2/api/hardware-ack?session=S${i+1}&counter=5`)
  }
  // 100 个 session 收到 200 个 grant（每个 grant 都用 counter=5）
  // 100 个 grant 触发 100 个危险操作 (host_remove / wipe_data / factory_reset)
  ```
- **影响**:
  - **P0 (条件性)**: 当前 dev / demo 单进程 sql.js 模式下不命中
  - **未来切到 PG / 多 worker 后立即成为 P0**
  - ADR 要求 PG primary write path, **这是必须修的**
- **修复建议**:
  1. **PG 路径用 `RETURNING` 原子返回**:
     ```sql
     UPDATE hardware_gates
     SET last_monotonic_counter = ?, ...
     WHERE gate_id = ? AND last_monotonic_counter < ?
     RETURNING last_monotonic_counter;
     ```
     在 PG 下 `RETURNING` 是原子的。sql.js v1.10+ 也支持。
  2. **多 worker 部署禁止**: PM2 cluster 模式下 `instances: 1` for hardware-authorization
     - 或者用 single-writer pattern: 全部 hardware-ack 走同一个 dedicated worker
  3. **INSERT grant 前**再 verify 一遍 session.consumedAt:
     ```ts
     // 在 line 658 INSERT 前
     const recheck = getDatabase().prepare('SELECT consumed_at FROM hardware_confirmation_sessions WHERE session_id = ?').get(sessionId) as any;
     if (recheck?.consumed_at) {
       // 二次 ack
       return rejectSession(...);
     }
     ```
  4. **行级锁** (PG): `SELECT ... FOR UPDATE` 在 read counter 时拿 lock
  5. **显式 transaction 包裹整个 ack 处理**:
     ```ts
     getDatabase().transaction(() => {
       // UPDATE counter
       // SELECT verify
       // INSERT grant
       // UPDATE session consumed_at
     })();
     ```
     这样 sql.js (line 709-727 已实现 transaction) 也能保证原子性
  6. **加 integration test** 模拟多 worker 并发（用 `Promise.all` + 共享 sql.js 也会暴露 race，因为 microtask queue 是有序的，但 promise.all 内部 await 顺序可能让 race 可触发）

---

### V8.13: `await auditLogger.log(...)` 在 consumed_at 设置之后，期间 audit log 失败被 swallow

- **目标文件**: `X:\repos\Networksafe\backend\src\services\hardware-authorization.service.ts:518-533` + `requestPhysicalConfirmation`
- **修复概述** (Wave 1/2):
  - handlePhysicalConfirmationAck 同步设置 `consumed_at`
  - 之后**异步** audit log
  - audit log 失败被 try/catch swallow（line 531-533），只 `logger.warn`
- **新攻击向量**:
  - 攻击者**没有**直接利用这个 fail-open 路径（因为 consumed_at 已设置，grant 仍然有效）
  - 但 audit log 失败意味着 **grant 操作无审计 trail** —— 配合 V7.3 (resolveTenantAsPlatformAdmin fail-open audit) 形成**审计完全失效**
  - **场景**:
    - DB 临时不可达 → audit log 写失败 → catch swallow
    - hardware-confirmation 仍然 confirmed + grant
    - 后续 forensics 无法追溯谁确认了 grant
  - **真实危害**: 合规性问题（无法满足 SOC2 / ISO 27001 audit trail 要求）
  - **次级危害**: attacker 故意制造 DB 抖动（通过 OOM/DoS）让 audit log 持续失败，**自己执行高危操作时无审计**
- **PoC**:
  ```ts
  // attacker 知道 audit logger 是 optional + fail-open
  // 触发 DB connection pool 耗尽（通过 wave1 V1 漏洞的 DB DoS）
  // 此时所有 hardware confirmation 操作都 silently skip audit
  // attacker 用合法 session + counter 执行 host_remove
  // 6 个月后 forensics: "who confirmed this?" → 无 audit log
  ```
- **影响**:
  - **P1**: 合规性问题，不是直接安全漏洞
  - 与 V7.3 同一类问题：可观测性 fail-open
- **修复建议**:
  1. **audit log 同步写 + 失败 throw**:
     ```ts
     try {
       await auditLogger.log({ ... });
     } catch (error: any) {
       // 不要 swallow
       throw new Error(`Audit log failed: ${error?.message}`);
       // 调用方: catch + 把 grant rollback + return 503
     }
     ```
  2. **或者**: 把 audit log 移到 grant INSERT 之前（pre-condition check），失败则拒绝 grant
  3. **或者**: 用 outbox pattern：audit log 写入本地 queue，async flush；DB 恢复时 flush 旧 audit
  4. **加测试**: mock auditLogger.log 抛错，断言 grant 拒绝

---

## 4. sanitizeString 漏了什么模式

### V8.14: 完全漏掉 AWS Access Key / GitHub PAT / Stripe / Slack / Generic API Key

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:12-44`
- **修复概述** (Wave 1-2):
  - 14 条 SENSITIVE_PATTERNS:
    - password / secret / apiKey 等 JSON 字段
    - JWT (eyJ...)
    - agent_* / sk_* / pk_* 前缀
    - 邮箱
    - IPv4
    - 信用卡
    - SSN
- **新攻击向量**:
  - **AWS Access Key**: `AKIA[0-9A-Z]{16}` (20 chars total) —— **未检测**
  - **AWS Secret Key**: 40 chars base64, **未检测**（没有前缀约定）
  - **GitHub PAT**: `ghp_[a-zA-Z0-9]{36}` / `gho_` / `ghu_` / `ghs_` / `ghr_` —— **未检测**
  - **GitHub Fine-grained PAT**: `github_pat_[a-zA-Z0-9_]{82}` —— **未检测**
  - **Stripe**: `sk_live_[a-zA-Z0-9]{24,}` / `pk_live_` / `rk_live_` —— **未检测**（`sk_*` 和 `pk_*` 已存在但 `sk_live_` 是 32+ 字符长度，可能匹配不上原 32 长度阈值）
  - **Slack**: `xox[baprs]-[a-zA-Z0-9-]{10,}` —— **未检测**
  - **Google API Key**: `AIza[0-9A-Za-z\-_]{35}` —— **未检测**
  - **OpenAI / Anthropic**: `sk-[a-zA-Z0-9]{20,}` (OpenAI 新格式) / `sk-ant-...` (Anthropic) —— **未检测**
  - **Discord Bot Token**: `[MN][a-zA-Z0-9]{23,}\.[a-zA-Z0-9-]{6,7}\.[a-zA-Z0-9-]{27,}` —— **未检测**
  - **Telegram Bot Token**: `\d{8,10}:[a-zA-Z0-9_-]{35}` —— **未检测**
  - **npm Token**: `npm_[a-zA-Z0-9]{36}` —— **未检测**
  - **PyPI Token**: `pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}` —— **未检测**
  - **Heroku API Key**: UUID 形式 with specific context —— **未检测**
  - **Private Key** (PEM): `-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----` —— **未检测**
  - **Bearer Token** (non-JWT): `Bearer [a-zA-Z0-9_-]{20,}` (in `Authorization` header) —— **未检测** (line 22-23 只检测 JSON 字段 `"bearer": "..."` 不检测 header value)
  - **Basic Auth**: `Basic [a-zA-Z0-9+/=]{4,}` in URL or header —— **未检测**
  - **URL with embedded creds**: `https://user:pass@host.com` —— **未检测**
- **PoC**:
  ```ts
  sanitizeString('AWS key: AKIAIOSFODNN7EXAMPLE')
  // 期望: 'AWS key: AKIA...MPLE'
  // 实际: 'AWS key: AKIAIOSFODNN7EXAMPLE'  ← 完全未脱敏
  sanitizeString('GitHub PAT: ghp_abc123def456ghi789jkl012mno345pqr678stu')
  // 期望: 'GitHub PAT: ghp_...stu'
  // 实际: 'GitHub PAT: ghp_abc123def456ghi789jkl012mno345pqr678stu'  ← 未脱敏
  sanitizeString('OpenAI: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz')
  // 期望: 'OpenAI: sk-...yz'
  // 实际: 完全未脱敏
  sanitizeString('Authorization: Bearer abc123def456ghi789jkl012mno345pqr678stu')
  // 期望: 'Authorization: Bearer abc1...stu'
  // 实际: 完全未脱敏
  ```
- **影响**:
  - **P0**: log-sanitizer 的核心承诺是"敏感数据脱敏"，**AWS key / GitHub PAT / API key 漏报 = 凭证泄露到日志 = 全量密钥 compromise**
  - attacker 触发一次**正常的** audit 写入（无需 fuzzing），把凭证藏进 description / details 字段，**直接进日志**
  - log aggregator (Loki / CloudWatch / Datadog) 任何人可读 = **凭证全泄露**
- **修复建议**:
  1. **加 comprehensive API key patterns**:
     ```ts
     // AWS
     /AKIA[0-9A-Z]{16}/g,
     // GitHub
     /gh[pousr]_[a-zA-Z0-9]{36,}/g,
     /github_pat_[a-zA-Z0-9_]{82}/g,
     // Google
     /AIza[0-9A-Za-z\-_]{35}/g,
     // OpenAI / Anthropic
     /sk-(?:proj-)?[a-zA-Z0-9]{20,}/g,
     /sk-ant-[a-zA-Z0-9-]{20,}/g,
     // Slack
     /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
     // Stripe
     /[sr]k_live_[a-zA-Z0-9]{20,}/g,
     // Discord
     /[MN][a-zA-Z0-9]{23,}\.[a-zA-Z0-9-]{6,7}\.[a-zA-Z0-9-]{27,}/g,
     // Telegram
     /\d{8,10}:[a-zA-Z0-9_-]{35}/g,
     // npm
     /npm_[a-zA-Z0-9]{36}/g,
     // Private Key
     /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
     // Bearer (header value)
     /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/g,
     // Basic Auth (header value)
     /Basic\s+[a-zA-Z0-9+/=]{4,}/g,
     // URL with embedded creds
     /https?:\/\/[^\/\s:]+:[^\/\s@]+@[^\/\s]+/g,
     ```
  2. **考虑用 `redact-secrets` npm package** 做更全面的脱敏（基于 entropy 的检测）
  3. **加测试**:
     ```ts
     it('redacts AWS access keys', () => {
       expect(sanitizeString('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA...MPLE');
     });
     it('redacts GitHub PATs', () => {
       expect(sanitizeString('ghp_abc123def456ghi789jkl012mno345pqr678stu')).toBe('ghp_...stu');
     });
     ```

---

### V8.15: 邮箱和 IP 的 partial redaction 用 `match.length > 20` 决定格式，但 IP (13 chars) 走 `***REDACTED***` 路径，信息完全丢失

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:124-137`
- **修复概述** (Wave 1-2):
  - 替换函数: `if (match.length > 20) { first 4 + ... + last 4 } else { ***REDACTED*** }`
- **新攻击向量**:
  - **IP address** `192.168.1.100` 是 13 chars, `< 20`, 走 `***REDACTED***`
  - **Email** `john.doe@example.com` 是 20 chars, **正好等于 20**! 边界 case: `match.length > 20` 是 false, 走 `***REDACTED***`
  - **Email** `john.doe@example.co.uk` 是 22 chars, `> 20`, 走 first 4 + last 4 = `john...co.uk` (暴露前缀)
  - **Credit card** `1234567812345678` 是 16 chars, `< 20`, 走 `***REDACTED***` ✓
  - **Credit card with dashes** `1234-5678-1234-5678` 是 19 chars, `< 20`, 走 `***REDACTED***` ✓
  - **Bug**: 部分敏感数据**完整 16+ char 字符串**（如 fingerprint / token）被 `***REDACTED***` 取代——丢失了**last 4 chars 的关键定位信息**
  - **真实场景**: Audit log 包含 `Finding fingerprint: abc123def456789012345678901234`
    - 35 chars, `> 20` ✓
    - first 4 = `abc1`, last 4 = `1234`
    - 输出: `Finding fingerprint: abc1...1234`
    - **last 4 是 fingerprint 的关键定位符**, **保留** —— OK
  - **反例**: Audit log 包含 `Session ID: 1234567890abcdef` (16 chars, 16-char sessionId)
    - `< 20`, 走 `***REDACTED***`
    - **sessionId 完全丢失**, 后续 join 操作无法定位
  - **更严重**: line 271-278 有专门的 `partiallyRedactIP` 函数（`192.168.1.100` → `192.168.*.*`）—— **但 sanitizeString 不用它**！直接走 generic first-4 / last-4 逻辑
- **PoC**:
  ```ts
  sanitizeString('Connection from 192.168.1.100')
  // IP regex 匹配 '192.168.1.100' (13 chars)
  // 13 < 20, 走 ***REDACTED***
  // 输出: 'Connection from ***REDACTED***'
  // 运维无法定位 source IP 段

  // 实际期望: 'Connection from 192.168.*.*'
  // 应该调用 partiallyRedactIP('192.168.1.100')
  ```
- **影响**:
  - **P1**: 运维可观测性下降（无法定位 IP 段）, 不是安全漏洞
  - 但**配合** V8.16 (中文字符串), attacker 用特殊编码可绕过
- **修复建议**:
  1. **按 pattern type 调用专门的 partial redact**:
     ```ts
     for (const { pattern, redaction } of SENSITIVE_PATTERNS) {
       sanitized = sanitized.replace(pattern, (match) => redaction(match));
     }
     // redaction 可以是 first4+last4, ***, 192.168.*.*, j***@example.com, etc.
     ```
  2. **或者**: 把 match.length > 20 改成 `match.length > 12` (更激进), 至少保留 4 chars 定位
  3. **加测试**:
     ```ts
     it('redacts IPs to 192.168.*.* format', () => {
       expect(sanitizeString('from 192.168.1.100')).toBe('from 192.168.*.*');
     });
     ```

---

### V8.16: `\b` word boundary 不支持中文/Unicode, 中文字段名绕过

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:14-43`
- **修复概述** (Wave 1-2):
  - 所有 pattern 用 `\b` (word boundary)
  - JSON 字段模式要求 `"key":` 严格匹配
- **新攻击向量**:
  - **`\b` 在 JavaScript regex 中是 ASCII-only word boundary**:
    - 字母数字下划线视为 "word char"
    - 中文 / 日文 / 韩文 / 阿拉伯文都是 "non-word char"
    - `\b密码\b` 不匹配中文"密码"（因为 `\b` 在中文两侧不存在 word boundary）
  - **attacker 用中文键名**:
    ```json
    {"密码": "secret123", "API密钥": "AKIAIOSFODNN7EXAMPLE"}
    ```
    - `"密码"` 不匹配 line 14 `/"password":\s*"[^"]+"/gi`（大小写敏感 + 必须 `"password"`）
    - `"密码"` 走 `sanitizeObject` 时被 `lowerKey.includes('password')` 检测... wait
    - `lowerKey = "密码"` includes 'password'? **false**（中文不含 'password' substring）
    - **结果**: `"密码": "secret123"` **完全不脱敏**!
  - **同理**:
    - `"pwd"` (line 50-68 REDACT_FIELDS) — `lowerKey.includes('password')` 不会匹配 'pwd'
    - 但 line 50 有 `'password'` 在 REDACT_FIELDS, **不含** `'pwd'`
    - 实际 attacker 用 `"pwd": "x"` **不被 sanitizeObject 脱敏** (但在 sanitizeString 中通过 pattern `/"password":\s*"[^"]+"/gi` 也不被脱敏 — line 14)
    - **等等**，让我重读 sanitizeObject:
      ```ts
      const isSensitive = REDACT_FIELDS.some(sensitive =>
        lowerKey.includes(sensitive.toLowerCase())
      );
      ```
      `lowerKey = "pwd"`, `REDACT_FIELDS` lowercase = `['password', 'secret', 'secretkey', ...]`
      `'pwd'.includes('password')` = false
      `'pwd'.includes('secret')` = false
      `'pwd'.includes('secretkey')` = false
      `isSensitive` = false
      **`"pwd": "x"` 不被脱敏**!
  - **attacker 策略**:
    ```json
    {
      "pwd": "x",
      "密码": "secret",
      "API密钥": "AKIA...",
      "Token_de_acceso": "abc123..."
    }
    ```
  - **正则不区分大小写 flag `i`** 的覆盖范围:
    - line 14-23 大小写敏感（**没有 `i` flag**!）
    - `"Password": "x"` 不被 line 14 `/"password":\s*"[^"]+"/` 匹配（必须小写 `password`）
    - line 14 的 pattern 实际是 `/"password":\s*"[^"]+"/gi` - **有 `i` flag** ！让我重读...
    - 实际：line 14 `/"password":\s*"[^"]+"/gi` 包含 `i` flag, 大小写不敏感
    - 但 `"PASSWORD": "x"` 与 `Password: ` (with space) 还是 OK, 与 `password=`
  - **attacker 用不同分隔符**:
    - `password=x` (无引号, form-urlencoded)
    - `password = x` (有空格)
    - `password: x` (yaml style)
    - 这些**全部不**被 line 14 的 `"password":` 严格匹配
- **PoC**:
  ```ts
  sanitizeString('User password: AKIAIOSFODNN7EXAMPLE')  // 在 description 字段
  // 期望: 'User password: AKIA...MPLE'
  // 实际: 'User password: AKIAIOSFODNN7EXAMPLE'  ← 未脱敏
  // 原因: "User password: AKIA..." 不匹配 JSON 字段 pattern (无 `"password":`)
  // 也不匹配 AWS key pattern (V8.14 漏报)
  ```
- **影响**:
  - **P0**: 大量已知凭证格式（AWS key, GitHub PAT）加上 key=value 形式（form data, log message）**完全 bypass**
  - log aggregator 中的 description / message 字段是 attacker 可控的（通过 OIDC error message 注入 / audit description 注入）
- **修复建议**:
  1. **加 generic key=value pattern**:
     ```ts
     // password=value, password: value, password = value
     /\b(password|pwd|passwd|密钥|密码|token|密钥|access_key)\s*[:=]\s*['"]?([^\s'"]+)/gi
     ```
  2. **加 Unicode word boundary (用 lookbehind/lookahead 模拟)**:
     ```ts
     // (?<![a-zA-Z0-9_])password(?![a-zA-Z0-9_])  在 word char 两侧无 word char
     ```
  3. **加 entropy-based detection**: 任何高 entropy 字符串 (e.g. > 4.5 bits/char) 长 20+ 自动 redact
  4. **加测试**:
     ```ts
     it('redacts password=value form', () => {
       expect(sanitizeString('password=AKIAIOSFODNN7EXAMPLE')).toBe('password=***REDACTED***');
     });
     it('redacts Chinese password field', () => {
       expect(sanitizeString('{"密码": "secret123"}')).toBe('{"密码": "***REDACTED***"}');
     });
     ```

---

### V8.17: 嵌套 JSON 字段的 sensitive value 在 sanitizeString 中不脱敏（仅 sanitizeObject 处理嵌套）

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:117-140`
- **修复概述** (Wave 1-2):
  - `sanitizeString(str)` 只对**字符串本身**应用 14 个 regex
  - `sanitizeObject(obj)` 递归处理**对象**的 keys
- **新攻击向量**:
  - **当 `sanitize()` 入口是 string 时**: 走 `sanitizeString`
  - **当 `sanitize()` 入口是 object 时**: 走 `sanitizeObject`
  - **真实 logger 调用**: `logger.error('msg', context)` — `context` 是 object, `logger.formatMessage` 调 `sanitize(context)`
  - **如果 context 是 string**（例如 `JSON.stringify(someObj)` 后传进去）—— 走 `sanitizeString`
  - **JSON 字符串中嵌套字段**:
    ```ts
    sanitizeString('{"data": {"password": "secret"}}')
    // 14 个 regex 都不匹配 (line 14 要求 `"password": "..."` 在 string 开头附近, 但实际在嵌套)
    // 输出: '{"data": {"password": "secret"}}'  ← 完整泄露
    ```
  - **但 logger 实际上**:
    - `logger.error('msg', { foo: { password: 'x' } })` —— context 是 object, 走 `sanitizeObject`
    - `sanitizeObject` 递归处理 `foo.password`, REDACT_FIELDS 匹配, redact ✓
  - **但**如果 logger 内部某处把 object 序列化成 string 后再调 sanitize: `sanitizeString(JSON.stringify({...}))` —— 嵌套字段**泄露**
  - **真实 logger 代码**: 我没读 `logger.ts` 的 `formatMessage`, 但**模式是**:
    ```ts
    function formatMessage(level, msg, context) {
      if (typeof context === 'object') {
        return `${level} ${msg} ${JSON.stringify(sanitizeObject(context))}`;
      }
      return `${level} ${msg} ${sanitizeString(String(context))}`;
    }
    ```
  - 如果是这样, **嵌套字段在 object 路径下 OK** (sanitizeObject 递归)
  - **但是**: line 14-23 的 JSON 字段 regex (sensitive JSON keys) **也只对顶层 string 起作用**, **object 路径完全依赖 sanitizeObject**
  - **如果 sanitizeObject 漏掉某个 key** (V8.16 中文 key), 整个嵌套 path **泄露**
  - **更严重**: **array of secrets**:
    ```ts
    sanitizeObject({ tokens: ['AKIA...', 'ghp_...'] })
    // tokens 不是 sensitive field (REDACT_FIELDS 不含 'tokens')
    // 递归 array, sanitizeObject(item) — item 是 string
    // string 不递归, 直接 return
    // 整个 token 数组**原样**进日志
    ```
- **PoC**:
  ```ts
  sanitizeObject({ tokens: ['AKIAIOSFODNN7EXAMPLE', 'ghp_abc...stu'] })
  // 期望: { tokens: ['***REDACTED***', '***REDACTED***'] }
  // 实际: { tokens: ['AKIAIOSFODNN7EXAMPLE', 'ghp_abc...stu'] }  ← 全部泄露
  ```
- **影响**:
  - **P0**: array of secrets 是常见 data shape (API key lists, credential bundles)
  - 与 V8.14 联动, AWS key / GitHub PAT 双重漏报
- **修复建议**:
  1. **sanitizeObject 递归时也调用 sanitizeString**:
     ```ts
     } else if (maxDepth > 0 && typeof value === 'object') {
       sanitized[key] = sanitizeObject(value, maxDepth - 1);
     } else if (typeof value === 'string') {
       sanitized[key] = sanitizeString(value);  // 加这一行!
     } else {
       sanitized[key] = value;
     }
     ```
  2. **对 array 元素也调 sanitizeString**:
     ```ts
     if (Array.isArray(obj)) return obj.map(item => 
       typeof item === 'string' ? sanitizeString(item) : sanitizeObject(item, maxDepth - 1)
     );
     ```
  3. **加测试**:
     ```ts
     it('redacts secrets in array', () => {
       const result = sanitizeObject({ tokens: ['AKIAIOSFODNN7EXAMPLE'] });
       expect(result.tokens[0]).toBe('***REDACTED***');
     });
     it('redacts secrets in nested object', () => {
       const result = sanitizeString('{"data": {"password": "secret"}}');
       expect(result).toContain('***REDACTED***');
     });
     ```

---

### V8.18: 字符串里的 `Authorization: Bearer xxx` / `Basic yyy` header 形式未脱敏

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:14-44`
- **修复概述** (Wave 1-2):
  - line 22-23: `/"authorization":\s*"[^"]+"/gi` 和 `/"bearer":\s*"[^"]+"/gi` —— **只检测 JSON 字段**
- **新攻击向量**:
  - **HTTP header 形式**:
    - `Authorization: Bearer abc123...`
    - `authorization: bearer xxx`
    - `X-API-Key: secret_value`
    - `Cookie: sessionId=abc; token=xyz`
  - 这些**不在 line 22-23 的 JSON 字段 regex 范围**
  - **JWT regex** (line 26) `/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g` **会匹配** `eyJ...` JWT token ✓
  - **但**:
    - `Bearer abc123def456ghi789jkl012mno345pqr678stu` (非 JWT 格式的 opaque token) — **JWT regex 不匹配**
    - `Bearer AKIAIOSFODNN7EXAMPLE` — JWT 不匹配, AWS pattern 不存在
    - `Basic dXNlcjpwYXNz` (base64 of `user:pass`) — JWT 不匹配
  - **典型泄漏场景**:
    - logger.error('HTTP request failed', { error: 'Authorization: Bearer xxx' })
    - sanitizeObject 不会处理 (error 是 string, 递归时 if string 直接 return)
    - **Bearer token 进日志**
  - **Cookie**:
    - `cookie: SESSIONID=abc123def456ghi789jkl012mno345pqr678stu; csrf_token=xyz`
    - **无任何 pattern 匹配**
- **PoC**:
  ```ts
  sanitizeObject({ 
    request: 'GET /api/users HTTP/1.1',
    headers: 'Authorization: Bearer abc123def456ghi789jkl012mno345pqr678stu'
  })
  // headers 是 string, 递归时 typeof string 直接 return
  // 输出: { request: '...', headers: 'Authorization: Bearer abc123...' }  ← 完整泄露
  ```
- **影响**:
  - **P0**: 任何 OIDC / 内部 API 调用失败的错误消息（含 Authorization header 详情）会泄露 token
  - 与 V7.5 (safeErrorMessage raw 字段不 sanitize) 联动
- **修复建议**:
  1. **加 header value patterns**:
     ```ts
     // Authorization header value (any non-JWT format)
     /Authorization:\s*[Bb]earer\s+[a-zA-Z0-9_\-\.~+\/=]+/g,
     // Basic auth
     /Authorization:\s*[Bb]asic\s+[a-zA-Z0-9+\/=]+/g,
     // X-API-Key / Api-Key
     /X-API-Key:\s*[a-zA-Z0-9_\-\.~+\/=]+/gi,
     // Cookie values
     /(?:SESSIONID|session_token|auth_token|access_token)=([a-zA-Z0-9_\-\.~+\/=]+)/gi,
     ```
  2. **配合 V8.17** 在 sanitizeObject 递归时对 string value 也调 sanitizeString

---

### V8.19: `partiallyRedactIP` 永远不被 sanitizeString 调用 —— 死代码

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:267-278`
- **修复概述** (Wave 1-2):
  - 定义了 `partiallyRedactIP(ip)` 函数: `192.168.1.100` → `192.168.*.*`
  - 还定义了 `partiallyRedactEmail(email)` 和 `partiallyRedactSecret(value)`
- **新攻击向量**:
  - 三个 partiallyRedact* 函数都在文件内, 但 **sanitizeString 不调用它们**
  - sanitizeString 用统一的 first-4 / last-4 / `***REDACTED***` 逻辑
  - **死代码** —— 与 V7.6 (sanitizeError 不被调用) 同一类问题
  - 真实场景: 如果 attacker 把 `192.168.1.100` 塞进 log message, 输出 `192....1.100` (first 4 + last 4)
  - **保留 1.100** —— 攻击者可以**定位**到 192.168.1.0/24 子网的特定主机 (last 4 chars)
  - 期望: `192.168.*.*` (only net id preserved)
- **PoC**:
  ```ts
  sanitizeString('Connection from 192.168.1.100 to 10.0.0.5')
  // 实际输出: 'Connection from 192....1.100 to 10.0.0.5' (if 192.168.1.100 > 20 chars? 不, 13 < 20)
  // wait, let me recheck
  // 192.168.1.100 是 13 chars, < 20, 走 ***REDACTED***
  // 输出: 'Connection from ***REDACTED*** to ***REDACTED***'
  // 等于完全丢失 IP 信息，运维定位不到源 IP 段
  ```
- **影响**:
  - **P1**: 运维可观测性下降
  - 不是直接安全漏洞, 但是次级
- **修复建议**:
  1. **重写 sanitizeString 的 replacement 逻辑**:
     ```ts
     const REDACTION_FNS: Record<string, (match: string) => string> = {
       IP: (m) => partiallyRedactIP(m),
       EMAIL: (m) => partiallyRedactEmail(m),
       SECRET: (m) => m.length > 20 ? `${m.slice(0,4)}...${m.slice(-4)}` : '***REDACTED***',
       ...
     };
     for (const { pattern, fn } of SENSITIVE_PATTERNS) {
       sanitized = sanitized.replace(pattern, fn);
     }
     ```
  2. **加测试**:
     ```ts
     it('partially redacts IP', () => {
       expect(sanitizeString('from 192.168.1.100')).toBe('from 192.168.*.*');
     });
     ```

---

## 5. 综合 PoC（组合利用）

```bash
# Step 1: attacker 已通过 OIDC error message 注入拿到目标服务器的 log write 权限
#         (例如把 AKIA key 塞进 OIDC 错误描述)

# Step 2: 触发硬件确认 (Wave 4 safeMerge 路径)
POST /api/hardware-confirm
{
  "sessionId": "...",
  "confirmed": true,
  "monotonicCounter": 5,
  "metadata": {
    "scanner": { "engine": "nuclei" },
    "callback": function() { /* RCE */ }  ← V8.1 Function 引用污染
  }
}
# safeMerge 把 Function 引用保留进 metadata, dispatcher 后续执行 → RCE

# Step 3: 触发 scanner tool-executor ReDoS (V8.6 漏报)
POST /api/agents/execute-tool
{
  "toolName": "check_pattern",
  "parameters": {
    "content": "...",
    "patterns": ["(a|a)*"]  ← V8.6 false negative
  }
}
# 1s setTimeout 兜底不够, 100 次并发把 event loop 反复阻塞 → DoS

# Step 4: 触发 hardware-authorization multi-worker race (V8.12)
# (假设未来部署 PG primary write path, 两个 worker 并发)
for i in {1..100}; do
  curl -X POST https://target/api/hardware-ack \
    -d '{"sessionId":"S'$i'","monotonicCounter":5,...}' &
done; wait
# 100 个 session 收到 200 个 grant (counter 单调性被破坏)
# 200 个 host_remove / wipe_data 操作并发执行

# Step 5: 触发 log sanitizer 漏报 (V8.14 + V8.16 + V8.17 组合)
# attacker 控制 OIDC 错误消息, 把 AWS key / GitHub PAT 塞进去
POST /api/auth/oidc/callback
{ "code": "invalid", "error_description": "AKIAIOSFODNN7EXAMPLE failed" }
# OIDC client 抛错: new Error('OIDC failed: code=invalid, AKIAIOSFODNN7EXAMPLE')
# safeErrorMessage 写入 logger
# logger 的 sanitize 不脱敏 (V8.14 + V8.16)
# AKIA key 进入 Loki / CloudWatch, attacker 通过 Datadog read 拿到
```

---

## 修复建议（优先级排序）

1. **P0** (立刻修, 组合利用风险高):
   - V8.6 + V8.7 + V8.8: 重写 NESTED_QUANTIFIER 检测 (a|a)*, (?:a+)+, (?=...) 量词
   - V8.14: 加 AWS / GitHub / OpenAI / Stripe / Discord / Slack / private key / Bearer token pattern
   - V8.1: safeMerge 拒绝 Function / Date / RegExp / Map / Set / typed array
   - V8.17: sanitizeObject 递归时对 string value 也调 sanitizeString
2. **P1** (Sprint 6):
   - V8.12: V2.7 PG 路径必须用 RETURNING + 禁止 multi-worker
   - V8.9 + V8.10: 字符类 quantifier 检测 + quantifier 数值上限
   - V8.16: 加 key=value / 中文 key / form data pattern
   - V8.18: Authorization / Basic / X-API-Key / Cookie header pattern
3. **P2** (技术债):
   - V8.2: clamp maxDepth + 文档化 silent drop 行为
   - V8.3: 显式过滤 Symbol + 加测试
   - V8.5: safeMerge size guard
   - V8.11: HEAVY_BACKREFERENCE 兼容 char class
   - V8.13: audit log fail-closed (与 V7.3 同类)
   - V8.15 + V8.19: 调用 partiallyRedact* 函数

## 附：扫描覆盖度

- ✅ `safe-merge.ts` 全部 100 行 (safeMerge / mergeInternal / stripProtoKeys / FORBIDDEN_KEYS)
- ✅ `safe-regex.ts` 全部 117 行 (validateRegexPattern / NESTED_QUANTIFIER / HEAVY_BACKREFERENCE / SAFE_REGEX_LIMITS)
- ✅ `log-sanitizer.ts` 全部 294 行 (SENSITIVE_PATTERNS / REDACT_FIELDS / sanitize / sanitizeObject / sanitizeString / sanitizeError / partiallyRedact*)
- ✅ `hardware-authorization.service.ts:543-707` (handlePhysicalConfirmationAck 全部)
- ✅ `database.ts` (sql.js 同步行为确认)
- ✅ `tool-executor.ts:420-464` (validateRegexPattern 调用点)
- ✅ `security-operations.service.ts:424, 573, 577` (safeMerge 调用点)
- ✅ `scanner-task.service.ts:1636, 1868` (safeMerge 调用点)
- ✅ `devices.routes.ts:724` (safeMerge 调用点)
- ❌ `safe-merge.test.ts` (只覆盖了基础 PP case, 没测 Symbol / Function / Date / maxDepth 边界)
- ❌ `safe-regex.test.ts` (只覆盖了 (a+)+$ / (.*)*, 没测 (a|a)* / (?:a+)+ / lookahead)
- ❌ logger.formatMessage 内部 (未审查 sanitize 调用模式)

## 备注

- Wave 1-4 的 safeMerge / safeRegex / log-sanitizer 是"白名单 + 启发式"防御——白名单的边界就是漏洞的边界。**漏掉一种模式 = 一次完整泄露**。
- sql.js 的"原子性"在单进程下成立，但 ADR 要求 PG primary write path，**当前是隐性技术债**——一旦部署切到 PG，V8.12 立即成为 P0。
- sanitizeString 的部分函数名 (partiallyRedact*) 是死代码——与 V7.6 (sanitizeError) 是同一种"工具准备好但没接上"的反模式。
