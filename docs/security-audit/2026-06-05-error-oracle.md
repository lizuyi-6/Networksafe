# 错误信息 Oracle 扫描 - 2026-06-05

## 摘要

- **扫描文件**: 31（`backend/src/api/routes/` 下全部 `.ts`）
- **漏洞总数**: 87（去重后 80 处独立错误回显点）
- **P0**: 73（直接向客户端回显 `error.message`，可能泄露内部状态、SQL/文件系统/AI 错误细节）
- **P1**: 6（认证/授权路径上的状态码或文案差异，可用于用户/账户状态枚举）
- **P2**: 3（OIDC 回调侧信道区分、`result.message` 透传）

> 总体判断：`/api/auth/*` 的核心登录/注册/密码重置路径**已实现 timing-safe + 统一错误文案**的 anti-enumeration 防护（CVE-2026-302 修复痕迹清晰），但全站存在**一致性的"原始 error.message 透传"反模式**。`smart-fix`、`stats`、`logs`、`seed`、`final-defense`、`hardware-authorization`、`admin`（audit/oversight/user-mgmt）是最严重的暴露面。`/api/final-defense/*` 虽不影响外部用户，但会向内部运维回显硬件授权/companion 内部错误。

---

## 关键发现（Top 5 严重度排序）

| 排名 | 漏洞 ID | 位置 | 严重度 | 泄露敏感度 |
|------|---------|------|--------|-----------|
| 1 | V3.1 | smart-fix.routes.ts × 5 | P0 | 5/5 — 完全无 fallback，向客户端（含可能的未认证抓取）原样回显 |
| 2 | V3.2 | logs.routes.ts:95 + stats.routes.ts:303,337 | P0 | 5/5 — 无 fallback，logs/stats 通常调用面广 |
| 3 | V3.3 | seed.routes.ts:101,149 | P0 | 4/5 — admin 限定，但 SQL/seed 错误含表名/列名 |
| 4 | V3.4 | final-defense.routes.ts × 6 | P0 | 4/5 — 透传硬件授权/companion 内部错误 |
| 5 | V3.5 | auth.routes.ts:470（OIDC login init） | P0 | 4/5 — 透传上游 OIDC discovery/网络错误 |

> 紧随其后：admin.routes.ts（15+ 处）、hardware-authorization.routes.ts（10 处）、deployments.routes.ts（6 处）、ai-system.routes.ts（3 处）、system.routes.ts（2 处）。这些合计 40+ 处，但模式相同：`sendError(res, 500, { code, message: error?.message || 'fallback' })`。

---

## P0 — 直接回显 `error.message`

### V3.1: `smart-fix` 模块 5 处无 fallback 错误透传
- **文件:行号**: `backend/src/api/routes/smart-fix.routes.ts:158, 199, 227, 275, 353`
- **当前代码**（line 156-159 为例）:
  ```ts
  } catch (error: any) {
    logger.error('Smart fix failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
  ```
- **攻击**: 任何能调用 `/api/scanner/fix`、`/api/scanner/batch-fix`、`/api/scanner/dry-fix`、`/api/scanner/ai-status`、`/api/scanner/ai-analyze` 的客户端可在错误响应里读到原始异常。例如 AI provider 返回 401/超时、文件系统 EACCES/ENOENT 含绝对路径、SQLite `SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email` 等。
- **修复**: 统一改用 `sendError(res, 500, { code, message: 'backend.internal_error' })`，把 `error.message` 仅写入 `logger.error` 即可（当前已写日志，HTTP 层不应透传）。

### V3.2: `logs` / `stats` 摘要端点无 fallback
- **文件:行号**:
  - `backend/src/api/routes/logs.routes.ts:95` — `sendError(res, 500, { code: 'LOGS_SUMMARY_ERROR', message: error.message });`
  - `backend/src/api/routes/stats.routes.ts:303` — `sendError(res, 500, { code: 'STATS_ERROR', message: err.message });`
  - `backend/src/api/routes/stats.routes.ts:337` — `sendError(res, 500, { code: 'BADGES_ERROR', message: err.message });`
- **攻击**: `/api/stats/summary` 与 `/api/stats/badges` 通常对前端 SPA 公开；`/api/logs/summary` 需鉴权但调用面广。SQLite 错误可能直接泄露 `no such column: agents.last_heartbeat` 之类。
- **修复**: 加 fallback `'backend.internal_error'`。

### V3.3: `seed` 端点暴露种子执行错误（含表/列名）
- **文件:行号**:
  - `backend/src/api/routes/seed.routes.ts:101` — `message: error.message`
  - `backend/src/api/routes/seed.routes.ts:149` — `message: error.message`
- **当前代码**（line 96-103）:
  ```ts
  } catch (error: any) {
    logger.error('Failed to execute seeding', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.seeding_failed',
      message: error.message
    });
  }
  ```
- **攻击**: 虽 `requireRole('admin')` 限定，但 seed 操作期间 `INSERT`/`UPDATE` 失败时 SQLite 会回显 `SQLITE_CONSTRAINT: UNIQUE constraint failed: sites.tenant_id` —— 直接泄露**表名、列名、约束关系**给低权限管理员。
- **修复**: 移除 `message: error.message` 字段或替换为 `'backend.seeding_failed'` 通用文案。

### V3.4: `final-defense` 6 处透传硬件/companion 内部错误
- **文件:行号**: `backend/src/api/routes/final-defense.routes.ts:61, 97, 142, 179, 229, 279`
- **当前代码**（line 226-231 为例）:
  ```ts
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'ROOT_GATEWAY_ACTION_FAILED',
      message: error?.message || 'backend.root_gateway_action_failed'
    });
  }
  ```
- **攻击**: `finalDefenseService`/`rootGatewayService` 抛出异常时可能包含 `ENOENT: no such file or directory, open '/var/lib/aetherguard/policy.json'`、`policy digest mismatch: expected=... actual=...`、`hardware grant signature invalid: <hex>`、`interlock feedback timeout: 5000ms` 等内部细节。
- **修复**: fallback 已存在，但生产模式应仅写日志、对外固定 `'backend.final_defense_action_failed'`。

### V3.5: OIDC 登录初始化透传上游错误
- **文件:行号**: `backend/src/api/routes/auth.routes.ts:470`
- **当前代码**:
  ```ts
  } catch (error: any) {
    return sendError(res, 500, {
      code: 'OIDC_LOGIN_INIT_FAILED',
      message: error?.message || 'backend.oidc_login_init_failed'
    });
  }
  ```
- **攻击**: 当 OIDC discovery URL 配置错误或 IdP 不可达时，错误会包含完整 URL、HTTP 状态、底层 axios 错误内容，泄露身份提供商地址与响应头。
- **修复**: 改为 `'backend.oidc_login_init_failed'` 通用文案。

### V3.6: `hardware-authorization` 10 处透传
- **文件:行号**: `backend/src/api/routes/hardware-authorization.routes.ts:79, 95, 122, 134, 168, 180, 197, 218, 230, 267, 291`
- **攻击**: 硬件授权服务抛错通常包含 grant ID、companion ID、硬件序列号、签名失败原因等。
- **修复**: 同 V3.1 模式，加 fallback。

### V3.7: `admin` 15+ 处 audit/oversight/user-mgmt 透传
- **文件:行号**:
  - `admin.routes.ts:151`（audit logs）、`164`（verify log）、`180`（segments）、`205`（archive）、`222`（verify segment）
  - `admin.routes.ts:239`（benchmark run）、`250`（list）、`263`（report）
  - `admin.routes.ts:294`（firmware upload）、`345`（OTA trigger）、`388`（confirmation session）
  - `admin.routes.ts:400`（tenants list）、`416`（tenant summary）、`440`（tenant timeline）、`464`（tenant evidence）、`482`（event detail）、`504`（user timeline）
  - `admin.routes.ts:529`（create export）、`544`（list exports）、`562`（get export）
  - `admin.routes.ts:582`（list API keys）、`639`（create API key）、`663`（delete API key）
  - `admin.routes.ts:884`（batch update）、`903`（get user）、`916`（login history）、`1022`（password reset）
- **攻击**: admin 限定，但低权限管理员可借此探测：
  - 内部表结构（`no such column`、`UNIQUE constraint failed: tenants.uuid`）
  - 文件系统路径（`ENOENT: /opt/aetherguard/...`）
  - 内部签名/密钥派生失败原因
  - 审计链验证失败的细节（`segment chain mismatch at offset 42`）
- **修复**: 统一 `'backend.audit_internal_error'` 类 fallback。

### V3.8: `deployments` 6 处（含 ESP32 硬件状态）
- **文件:行号**:
  - `deployments.routes.ts:740`（save profile）、`810`（download profile）、`856`（ESP32 status）
  - `deployments.routes.ts:924`（ESP32 execute — `code: 'ESP32_EXECUTE_FAILED'`）
  - `deployments.routes.ts:989`（generate bundle）、`1002`（load history）
- **攻击**: ESP32 串口错误、`AG:REQ:DEPLOY` 协议失败、`/dev/ttyUSB0` 不可用、bundle checksum mismatch 等内部硬件/协议细节会被原样返回。
- **修复**: 加 fallback `'backend.deployment_internal_error'`。

### V3.9: `ai-system` 3 处
- **文件:行号**:
  - `ai-system.routes.ts:39`（agents health）、`207`（agent stats）、`221`（OWASP evaluation）
- **攻击**: 抛出 `Error: ECONNREFUSED 127.0.0.1:11434`（Ollama 本地端点暴露）、`Error: 401 Unauthorized from AI provider`、模型路径 `/opt/aetherguard/models/...`。
- **修复**: fallback。

### V3.10: `system` 2 处（含模式切换）
- **文件:行号**: `system.routes.ts:115, 119`（`/api/system/mode` 切换 app mode 时同时在 `error` 字段和 `message` 字段写入 `error.message`）
- **攻击**: 切换 app mode 是关键配置动作；错误信息可能泄露 SQLite 写入失败、文件权限问题、当前 mode 状态。
- **修复**: 移除双字段透传。

### V3.11: `config` 4 处
- **文件:行号**: `config.routes.ts:26, 71, 84, 109`
- **修复**: 同上。

### V3.12: `dashboard` / `agents` / `rules` / `fix-history` / `enterprise-helper`
- **文件:行号**:
  - `dashboard.routes.ts:27`
  - `agents.routes.ts:295`（`/agents/threats/recent` 500 时 `message: error?.message`）
  - `rules.routes.ts:45, 75, 93, 181, 200, 260, 303`
  - `fix-history.routes.ts:41, 87`
  - `enterprise-helper.routes.ts:37, 81`
- **修复**: 全部加 fallback。

### V3.13: `scanner.routes.ts:707` — 显式构造 `message: error.message`
- **文件:行号**: `backend/src/api/routes/scanner.routes.ts:703-709`
- **当前代码**:
  ```ts
  if (error.code === 'TENANT_TASK_RUNNING') {
    return sendError(res, 409, {
      code: 'TENANT_TASK_RUNNING',
      message: error.message
    });
  }
  ```
- **攻击**: 业务异常 `TENANT_TASK_RUNNING` 携带的自由文本 message 直接回显。攻击者可通过 fuzzing 推测后端状态机。
- **修复**: 用固定文案 `'backend.tenant_scan_in_progress'`。

---

## P1 — 用户/账户状态枚举

### V3.14: 登录路径已实现统一错误（**合规**）
- **文件:行号**: `backend/src/api/routes/auth.routes.ts:273-294, 318-339`
- **当前代码**:
  ```ts
  if (!user) {
    // ... 跑 dummy bcrypt
    return sendError(res, 401, { code: 'INVALID_CREDENTIALS', message: 'backend.invalid_credentials' });
  }
  if (!passwordValid) {
    // ...
    return sendError(res, 401, { code: 'INVALID_CREDENTIALS', message: 'backend.invalid_credentials' });
  }
  ```
- **评估**: 状态码（401）+ 错误码（`INVALID_CREDENTIALS`）+ 文案（`backend.invalid_credentials`）三者完全一致；并且**两条路径都执行 `bcrypt.compare`**（防 timing 泄露）—— 修复痕迹清晰，对应 CVE-2026-302。
- **建议**: ✅ 无需修改，作为参考实现。

### V3.15: 登录路径中 `ACCOUNT_SUSPENDED` 与 `ACCOUNT_LOCKED` 状态码/文案可区分
- **文件:行号**: `auth.routes.ts:249-260, 312-316`
- **当前代码**:
  ```ts
  // locked: 403
  return sendError(res, 403, { code: 'ACCOUNT_LOCKED', message: 'backend.account_is_temporarily_locked_due_to_too_many_failed_login_attempts', details: { remainingTime: lockInfo.remainingTime } });
  // suspended: 403
  return sendError(res, 403, { code: 'ACCOUNT_SUSPENDED', message: 'backend.account_suspended' });
  ```
- **攻击**: 攻击者批量尝试登录可获得三态 oracle：
  1. 401 `INVALID_CREDENTIALS` → 邮箱格式合法但账号未知 或 密码错
  2. 403 `ACCOUNT_LOCKED` + `remainingTime` → 账号存在但被锁定（含**解锁剩余秒数**）
  3. 403 `ACCOUNT_SUSPENDED` → 账号存在且被管理员停用
- **残留泄露**:
  - `details.remainingTime` 是显式枚举通道
  - 三态返回明显有助于绘制"账号存在性"画像
- **修复**:
  1. 把 `ACCOUNT_LOCKED` 与 `ACCOUNT_SUSPENDED` 统一回退为 `INVALID_CREDENTIALS` 401（可保留 audit log 区分）
  2. 若必须保留 UX 提示，攻击者穷举代价已经很高（rate limit + bcrypt cost），可考虑在 `details.remainingTime` 改为离散桶（如 `< 60s` / `< 600s` / `>= 600s`）

### V3.16: 注册路径不区分邮箱重复
- **文件:行号**: `auth.routes.ts:115-123`
- **当前代码**:
  ```ts
  const existingUser = await findAuthUserByEmail(email);
  if (existingUser) {
    logger.info(`Registration attempt for existing email: ${email}`);
    return sendError(res, 400, { code: 'REGISTRATION_FAILED', message: 'backend.registration_failed' });
  }
  ```
- **评估**: ✅ 统一返回 `REGISTRATION_FAILED`，不区分"邮箱已注册" vs "其他原因"。但**返回时间差异**未做 dummy bcrypt 等 padding —— 攻击者通过响应时间仍可推断邮箱是否存在（重复邮箱走 `findAuthUserByEmail` 后立即返回，新邮箱走 `bcrypt.hash(cost=12)` + 写库）。
- **修复**: 在 `existingUser` 分支同样跑 `bcrypt.hash(dummyPassword, 12)` 抹平时间差。

### V3.17: 密码修改 `USER_NOT_FOUND` vs `INVALID_PASSWORD` 区分
- **文件:行号**: `auth.routes.ts:747-761`
- **当前代码**:
  ```ts
  if (!user) return sendError(res, 404, { code: 'USER_NOT_FOUND', message: 'backend.user_not_found' });
  if (!passwordValid) return sendError(res, 401, { code: 'INVALID_PASSWORD', message: 'backend.current_password_is_incorrect' });
  ```
- **评估**: 已鉴权场景下 `USER_NOT_FOUND` 几乎不应出现（用户记录应存在），泄露敏感度低；但仍可保留攻击面。
- **修复**: 改 401 `INVALID_CREDENTIALS` 统一文案。

### V3.18: 刷新 token 路径统一文案
- **文件:行号**: `auth.routes.ts:593-598`
- **当前代码**:
  ```ts
  if (!user || user.status === 'suspended') {
    return sendError(res, 401, { code: 'USER_INVALID', message: 'backend.user_not_found_or_suspended' });
  }
  ```
- **评估**: ✅ "user_not_found_or_suspended" 合并两种情形，文案统一。✅ 合规。

### V3.19: Admin `users/:id` 端点 404 `USER_NOT_FOUND` 可枚举
- **文件:行号**: `admin.routes.ts:689, 726, 773, 897, 927`
- **评估**: 全部为 admin 限定（`requireRole('admin')`），攻击者必须已有 admin 权限。泄露敏感度低。
- **建议**: 可保持现状，但建议未来加 i18n 统一文案（i18n key 已统一为 `backend.user_not_found`）。

### V3.20: `final-defense` 透传 `result.message`（来自 service 层）
- **文件:行号**: `final-defense.routes.ts:212, 262`
- **当前代码**（line 208-214）:
  ```ts
  if (!result.success) {
    return sendError(res, statusCode, {
      code: String(result.reason || '...').toUpperCase(),
      message: result.message
    });
  }
  ```
- **评估**: 不是直接 `error.message`，但 `result.message` 来自 `finalDefenseService` / `rootGatewayService`，可能含硬件授权失败描述、interlock 反馈状态描述。
- **修复**: 用 i18n key 映射 `result.reason` → 固定文案，丢弃 `result.message`。

---

## P2 — 理论 / 侧信道

### V3.21: OIDC 回调 URL 参数区分
- **文件:行号**: `auth.routes.ts:478-525`
- **当前代码**:
  ```ts
  return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=not-configured'));
  return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=state-mismatch'));
  return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=mfa-required'));
  return res.redirect(buildOidcRedirectTarget(req, '/login?oidc=failed'));
  ```
- **评估**: 四种状态从 URL 参数可读，但都是 OIDC 自身状态机。攻击者拿到 `mfa-required` 说明 OIDC 配置正常 + 用户 MFA 缺失，本身不构成敏感泄露。
- **建议**: 无需修改。

### V3.22: `attack.routes.ts:261` — 实时事件中携带 `error.message`
- **文件:行号**: `backend/src/api/routes/attack.routes.ts:253-271`
- **当前代码**:
  ```ts
  broadcastEvent('agent:analysis', {
    attackId: attack.id,
    status: 'error',
    message: `Analysis failed: ${error.message}`
  });
  ```
- **评估**: 通过 WebSocket 广播给已订阅 `agent:analysis` 的客户端（通常为 dashboard），AI 失败原因可见。已鉴权场景，敏感度低。
- **建议**: 改通用文案 `'Analysis failed'`，具体错误入日志。

### V3.23: AI provider URL/路径暴露
- **文件:行号**: `smart-fix.routes.ts:259-262`（`error: err.message`）以及多处 AI 调用站点
- **当前代码**:
  ```ts
  } catch (err: any) {
    status = 'unavailable';
    error = err.message;
  }
  ```
- **攻击**: `ai-status` 端点会回显 Ollama 基础 URL `http://localhost:11434/api/tags` 错误，可能透露内部 AI 部署拓扑。
- **建议**: 改为布尔 `unavailable: true` + 日志记录。

---

## 修复建议（优先级排序）

1. **P0 大规模统一改造**（影响 ~70 处）：将 `message: error?.message || '<fallback>'` 改为 `message: '<fallback>'`，并把 `error.message` 写入 `logger.error`（多数位置已经在 logger 里写过一遍）。可考虑写一个 ESLint 规则禁止 `sendError(...message: error?.message...)` 与 `res.status(500).json({ error: error?.message })` 模式。
2. **P1 登录态枚举收敛**：
   - `auth.routes.ts:249-260` 改为 401 + `INVALID_CREDENTIALS`
   - `auth.routes.ts:312-316` 同上
   - `auth.routes.ts:115-123` 注册重复邮箱分支补 dummy `bcrypt.hash`
   - `auth.routes.ts:747-761` 密码修改 `USER_NOT_FOUND` 改 `INVALID_CREDENTIALS`
3. **P2 修整**：
   - `final-defense.routes.ts:212, 262` 用 i18n key 替代 `result.message`
   - `scanner.routes.ts:707` 用固定文案
   - `attack.routes.ts:267` WebSocket 事件脱敏
   - `smart-fix.routes.ts:259-262` ai-status 脱敏

## 附：扫描覆盖度

- ✅ `sendError(res, ..., { message: error?.message|err.message|e.message })` — 全局匹配
- ✅ `res.status(500).json({ ..., error: error.message })` — 全局匹配
- ✅ `res.json({ ..., error: error.message })` — 全局匹配
- ✅ `res.status(500).send(error.message)` — 未发现
- ✅ `(err|error).stack` — 未发现
- ✅ `no such column|table|constraint failed|SQLITE_` — 未发现（在 HTTP 响应中），日志层未审查
- ✅ `console.log|error|warn|info` in routes — 未发现（仅 `logger.error/warn/info`）
- ❌ 业务 service 层的 error message 内容（未审查 — 本次范围限于 routes 层）
- ❌ WebSocket gateway 的错误回传（未审查 — 本次范围限于 routes 层）

---

## 备注

- `auth.routes.ts` 的登录/注册/刷新路径**已正确实现** anti-enumeration（CVE-2026-302 fix），是本仓库的参考实现。
- 主要剩余风险集中在**运维/管理类端点**与**第三方集成（AI、ESP32、hardware）端点**。
- 建议引入 lint 规则或 PR 检查脚本，自动拦截 `message: error?.message` 类硬编码模式。
