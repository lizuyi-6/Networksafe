# REPOSITORY MAP — AetherGuard (X:\repos\Networksafe)

> 审计基线：工作树 @ 7d235411404e03dffe4996e29a82fd74793160d1（含未提交修改，见 PHASE0-FREEZE.md）

## 1. 顶层组件

| 组件 | 技术栈 | 角色 | 规模 |
| --- | --- | --- | --- |
| `backend/` | TypeScript / Express 4 / Socket.IO 4 / sql.js + better-sqlite3 + pg / ioredis / axios / ssh2 / nodemailer | 控制面：REST API + WebSocket 网关 + 检测管线 + 命令下发 + 审计 | 233 非测试 TS + 251 测试 TS |
| `frontend/` | React / Vite / TS | 仪表盘；唯一 API 层 `services/api.ts`（httpOnly cookie） | ~见 FE 报告 |
| `rust-fastpath/` | Rust 1.85 / axum | 高吞吐限流/流量评估 sidecar（unix socket 0o660 / 127.0.0.1 TCP） | 见 RF 报告 |
| `rescue/` | Rust std-only + 7 crates | 异构救援控制面 `ag-rescue`（仅安全侧动作，源码级禁 release 帧） | 见 RS 报告 |
| `firmware/controller-stm32h5/` | C (STM32H563) | M2 安全授权控制器：UART newline-JSON、grant 校验、interlock 继电器 | 见 FW 报告 |
| `simulator/` | TS (ts-node) | M1–M4 端到端模拟（真 M1 daemon + mock M2/M3/M4） | — |
| `ml/` | Python 3.12 | AetherArgus 离线训练数据管线（未接 backend/src）；含密封测试集（禁读） | 见 ML 报告 |
| `deployment/` | compose/systemd/nftables/shell | 生产/离线/Gateway Daemon 部署 | 见 DP 报告 |
| `e2e/` | Playwright | smoke/release/visual 测试 | — |
| `installer/` | npm 包 | 安装器 | 见 DP 报告 |
| `scripts/` | mjs/ps1/sh | guard 脚本、setup、release、诊断 | 见 DP 报告 |

## 2. 后端结构（安全视角）

### 入口
- `src/index.ts` → server + DB + WS；`src/app.ts` → `createControlPlaneApp()`（`bootstrap/control-plane-app.ts:91` 规范构造器）
- 中间件链：CORS(白名单)→helmet→compression→cookieParser→timing→preParsePPGuard→metrics→json(25mb+rawBody)→urlencoded→text→postParsePPGuard→requestLogger→routes→errorHandler
- `/health*` 免鉴权直挂；`/api` 挂 `apiRateLimit` → `optionalAuth` → `/stats` 强制 authenticate → trafficShadow → 各路由

### 路由（28 文件）与鉴权矩阵（摘要）
- **admin/agent-management/deployments/fix-history/rules/scanner/seed/smart-fix**: authenticate + requireRole('admin')（seed 另加 demo-mode + 单次确认 token）
- **agents/alerts/ai-endpoints/attack/dashboard/devices/fix-history/logs/pipeline/sites/stats/traffic/ai-system**: authenticate（部分端点叠加 requireRole/requirePermission/requireTenantAccess/plan 配额）
- **auth**: 公开（register/login/refresh/oidc）+ authRateLimit(120/min) + 锁定 + dummy-hash + 防重放
- **final-defense**: read/manage/execute 权限分级；status/report 系列 = helper secret
- **hardware-authorization**: authenticateHelperRequest（helpers/register|heartbeat）+ permission 分级；`hardware-confirmations/:id` 仅 authenticate 但有租户校验
- **enterprise-helper**: authenticateHelperRequest（serial-request 系列）
- **agent-onboarding**: codes 管理=admin/tenant；`/exchange` 公开（onboarding code 即凭证）
- **investigation**: `authenticateAgent`（静态 VALID_API_KEYS → role 'tenant' + plan 'ultra' 伪用户）

### WebSocket
- `websocket/agent-gateway.ts`（1794 行）：agent(API key hash 验证+Redis 缓存重验 hash+撤销轮询断连) / dashboard(JWT+会话重验证)；事件级限流；HMAC 签名命令；tenant 域广播
- `websocket/device-gateway.ts`（931 行）：`/ws/device`+`/ws/status`；register=DEVICE_API_KEYS 静态列表+公钥不可变（未提交修复）；HMAC 签名命令；nonce 防重放；fail-closed 签名门

### 服务层（39 文件，要点）
- 命令链：`command-dispatcher.service` → device-control/agent → hardware-authorization（grant 签发/验证，monotonic counter）→ device-gateway/agent-gateway 下发
- Final Defense：`final-defense.service`（policyDigest 计算、release TTL clamp、降级判定）
- 审计：`audit-logger.service`（tamper-evident HMAC 链）+ `audit-segment.service` + `postgres-shadow-store.service`（生产强制 shadow）
- 存储：`artifact-store.service`（local: 前缀+realpath 双重防逃逸；s3: MinIO）+ `ai-endpoint-store`
- 检测：`detection-pipeline` / `detection-engine` / `ai-agents/`（7 层）+ `http-traffic-evaluator`
- 其它：`oidc-auth` / `platform-config` / `tenant-oversight` / `notification-dispatcher` / `benchmark`(execFile) / `simulation` / `runtime-emulator`

### 安全模块
`security/`: agent-auth（API key hash+AES-GCM secret）、auth-security（锁定/会话）、command-signing（HMAC+30s+nonce）、command-risk-policy、hardware-grant（ECDSA/legacy fallback）、final-defense-policy（digest/归一化）、input-validator、permissions（角色→权限矩阵）、env-validator、redis、enhanced-rate-limiter、nonce-manager、anti-bot、deployment-bundle-signing、audit-logger

### Agent 侧（受管主机上运行）
`agent/agent.ts`（命令 HMAC 验签+nonce+5min 窗口+hardware grant ECDSA 验证）、firewall-controller（execFile+IP 校验）、traffic-monitor、attack-detector、enhanced-attack-detector、log-collector

### companion（设备侧）
`companion/gateway-daemon.ts`（M1：monotonic 高水位、failClosed=断桥+interlock_assert、release TTL 回落）、`companion/serial-device-companion.ts`（本地策略 digest+HMAC、counter 回滚拒绝）

## 3. 信任边界（架构图）

```
[浏览器 Dashboard] --https/httpOnly cookie--> [Nginx 反代 127.0.0.1:8080]
                                                  | compose 网络
                                                  v
                                    [backend :3005] <--WS--> [dashboard]
                                       |  |  |
                 SQLite/Postgres ------+  |  +------ Redis (会话/限流/nonce/blacklist)
                 MinIO(S3 artifacts) ----+
                                       | WS (agent: API key + HMAC 命令)
                                       v
                          [受管主机 host agent]（可能被 root 攻陷——产品威胁模型假设）
                                       .
                                       . (信任边界：LAN/串口)
                                       v
                    [Gateway Appliance M1 daemon] <--> [M2 STM32 firmware]
                    （serial newline-JSON，无密码学认证——FW-001）      |
                                                    [M3 SE: presence-check only]
                                                    [M4 interlock 继电器] --物理--> SERVER↔LAN 桥
```

辅助边界：
- helper（部署助手）：`SERIAL_HELPER_SHARED_SECRET` 共享密钥（Bearer）
- device：`DEVICE_API_KEYS` 静态共享列表 + per-device `DEVICE_KEY_<id>` 可选 + `DEVICE_COMMAND_SECRET` HMAC
- fastpath sidecar：**无鉴权**（unix socket 权限/127.0.0.1 为唯一边界）
- rescue ↔ appliance：独立认证协议（RS 报告）

## 4. 数据存储
- SQLite（sql.js 内存+30s 落盘 / better-sqlite3 WAL）→ 生产 `DB_MODE=postgres`（但写路径仍 SQLite 取向；Postgres 仅 shadow 表）
- Redis：会话、限流、nonce、token 黑名单、agent auth 缓存
- MinIO：固件/审计 artifact
- 文件系统：`data/artifacts`（local 模式）、日志

## 5. 密钥体系（12 项 compose `:?` 硬保护）
JWT_SECRET / JWT_SECRET_PREVIOUS（轮换）/ AUDIT_LOG_SECRET / ADMIN_PASSWORD / ENCRYPTION_KEY+SALT（scrypt→AES-256-GCM agent secret）/ DEVICE_COMMAND_SECRET / SERIAL_HELPER_SHARED_SECRET（≥32 且 ≠前者）/ POSTGRES_PASSWORD / SHADOW_DATABASE_URL / S3_SECRET_KEY / DEVICE_API_KEYS / VALID_API_KEYS / REDIS_PASSWORD；生产由 `runtime-env.ts` WEAK_VALUE_PATTERNS 硬拒弱值

## 6. CI/CD 与 Guard
`.github/workflows/`（DP 报告）+ 7 个 guard 脚本（route-db-access / no-direct-api-fetch / frontend-api-contract / repository-hygiene / rescue-no-release / deployment-image-pins / training-leak）——本次实测全部通过
