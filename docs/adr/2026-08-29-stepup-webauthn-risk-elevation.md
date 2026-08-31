# ADR: IP/UA 风险提升与 WebAuthn/Passkey 高危操作再认证

- 状态：Accepted
- 日期：2026-08-29
- 决策者：AetherGuard security architecture

## 背景

管理员的 access/refresh JWT 通过 httpOnly cookie 保护，但如果浏览器 profile、终端或网络边界已经泄露 cookie 值，攻击者可以从另一台机器重放同一 session。现有 `auth:session:{sessionId}` 已记录登录时的 IP 和 User-Agent，却只做 user/session 归属校验，没有做设备风险比较。

## 决策

1. **风险信号**：在控制面高危路由上，将当前请求的 IP/UA 与登录 session 的 `deviceInfo` 比较。不同出口网络或 User-Agent 记为 `session_risk_elevated`，写入审计；已有 step-up token 立即吊销。Passkey 完成后签发的短期 token 绑定完成断言的当前 IP/UA，避免新设备陷入反复吊销。
2. **控制面 step-up**：高危操作在 `authenticate` 和原有角色/权限守卫之后追加 `requireStepUp`。`STEPUP_ENFORCEMENT` 默认 `off`，运营方完成 Passkey 注册后显式设为 `on`。没有凭据返回 `STEPUP_ENROLL_REQUIRED`，有凭据但没有新鲜断言返回 `STEPUP_REQUIRED`。
3. **凭据注册**：注册 options 和 verify 两步都必须 bcrypt 重验当前密码；会话被盗者不能仅凭有效 JWT 注册自己的 Passkey。凭据的公钥、counter、设备类型和 transport 存入 service-owned `webauthn_credentials` 表。
4. **断言安全**：challenge 使用严格 Redis 状态、短 TTL、单次原子 claim；step-up token 使用严格 Redis 状态、短 TTL、单 session 单 token。认证 counter 不递增或回滚时删除凭据、写 critical 审计并拒绝。
5. **最终防线不变**：step-up 只是控制面入口的第二因素，不替代 Final Defense/Hardware Gate。设备危险动作仍必须经过现有 policyDigest、硬件签名 grant、monotonic counter 和 interlock feedback 全链校验。

## v1 保护范围

- 管理员 API key 创建/删除
- 管理员用户角色/状态/批量操作/重置密码
- 管理员固件上传、OTA、required-action 确认
- Final Defense 策略写入、host companion 动作、root-resistant gateway 动作
- 系统模式切换和平台配置写入

机器 helper、只读状态、WebSocket session 本身、`seed` 的既有 clear-confirm 不在本 ADR 的 v1 清单内。

## 取舍与后续

- IP 采用同 IPv4 `/24` 或 IPv6 `/64` 视为同一出口网络，UA 仍要求逐字相同；这降低移动网络漂移误报，但不能作为唯一安全边界。
- step-up token 只在当前设备有效；不同设备需要重新完成 Passkey。生产 Redis 不可用时严格状态操作返回 503，路径 fail-closed。
- OIDC 用户未来可结合已验证的 `amr`/MFA 声明，但本 ADR 不把 IdP 声明直接等同于本地 Passkey。
- 后续 v2 可覆盖 deployment approval、hardware gate enrollment、agent block/unblock、AI endpoint/key 管理等更广清单。

## 验收证据

- `backend/src/__tests__/redteam/session-transplant.test.ts`：开关关闭时保留原始可复现重放，开关打开时高危端点返回 `STEPUP_ENROLL_REQUIRED`。
- `backend/src/__tests__/middleware/step-up.middleware.test.ts`：4 个风险/令牌/开关断言。
- `backend/src/__tests__/routes/webauthn.routes.test.ts`：7 个 ceremony/密码重验/凭据暴露断言。
