# 缺陷主动探查报告 — 2026-07-08

范围：登录/数据管线（用户报告触发）+ 全仓未完成标记清点。方法：双子 agent 静态图谱（前端/后端）+ 活体探针（curl 对运行中进程）+ 源码核对。

## 已确认并修复（本轮）

| # | 缺陷 | 根因 | 修复 | 证据 |
| --- | --- | --- | --- | --- |
| D1 | 生产容器 `/api/*` 全部挂起，登录"到不了后端" | `networksafe-backend-1` 镜像 2026-06-11 构建，缺失一个月的修复（含 bc034f9 auth 管线 fail-closed/bypass） | 重建镜像 + 重启容器 | 修复前：`POST /api/auth/login` 15s 超时 0 字节；HEAD 新进程同请求 401/1.2s。重启后验证见下节 |
| D2 | fastpath Docker 镜像无法构建（阻塞所有 `up --build`） | `rust-fastpath/src/main.rs` 的 `use tracing::warn` 被 `#[cfg(not(unix))]` 门控，Linux 下 `warn!`（main.rs:641,1070）无导入——Windows 本机可编译、容器必炸 | 改为无条件 `use tracing::{info, warn}` | 本地 `cargo clippy -D warnings` exit 0、`cargo test` 17 passed/0 failed；docker build 验证见下节 |
| D3 | 后端不可达时 PrivateRoute 用未签名 sessionStorage blob 静默渲染"已登录"仪表盘（降级伪装成正常，违反 PRD §14.5） | `frontend/src/App.tsx` 132-146 三个 fallback 分支无差别信任缓存 | 保留缓存兜底（抗瞬断）但新增 `sessionVerified` 状态：非 `/auth/me` 确认的会话必显示"会话未验证"横幅（`data-testid="session-unverified-banner"`） | frontend `npm run typecheck` exit 0、`npm run lint` exit 0（--max-warnings 0） |

## 已核查、无需修复

- 确定性 401 后缓存自愈：`api.ts:289` 在非可重试 401 即 `setSessionUserIdentity(null)`，"后端明确否认但缓存放行"不成立。
- login() 本身不可伪造：要求真实 2xx + user body（`api.ts:328,334`）；demo 模式只影响数据展示不影响 auth。
- 固件 `se_driver.c` 桩：签名/counter 全返回 `false`（fail-closed），presence 是真 I2C 探测；OPTIGA 集成维持既有硬件缺口登记。
- bc034f9 的 `isAuthPipelineBypass`（api-traffic-shadow.middleware.ts:74）路径匹配核对过 normalizedRouteCandidates 实现，覆盖 /api 前缀剥离。

## 登记（不在本轮修复）

| 项 | 级别 | 说明 |
| --- | --- | --- |
| ~~auth 429 拒绝无日志（仅 metrics）~~ | ~~观测缺口~~ | **已修 2026-07-09**：`rate-limit.middleware.ts` 引擎路径 429 分支加 `logger.warn`（此前只有回退路径有日志）。typecheck 0 + rate-limit/auth middleware 34 tests passed |
| ~~cookie sameSite lax→strict（bc034f9）~~ | ~~待观察~~ | **已核查 2026-07-09**：非缺陷。OIDC 回跳是 SET cookie（Set-Cookie 不受 sameSite 限制），前端同源调用 `/api/auth/me` 不受 strict 影响。strict 是正确安全行为 |
| ~~compose `DB_MODE=postgres` 默认 vs database.ts SQLite 取向~~ | ~~既有文档矛盾~~ | **已核查 2026-07-09**：非矛盾。设计的双模式：DB_MODE=postgres 启用 Postgres 影子读，SQLite 仍是主写路径（`sqliteFallbackEnabled:true`），CLAUDE.md 已正确记录 |
| 首次 `/api/health` 冷调用 >5s（Redis 连接超时探测串行） | 低 | 之后 1.8s 内返回；只影响首个探针 |
| 一线 TODO：traffic-monitor.ts:215（更多日志格式） | 低 | 功能增强类 |
| ~~setup.mjs 对已存在 .env 只 skip 不补新增必填键~~ | ~~中~~ | **已修 2026-07-09**：`setup.mjs` + `deployment/offline/install-offline.sh` 增加 backfill 模式——文件存在时只追加缺失键，不动现有值；SERIAL_HELPER 碰撞规避、SHADOW_DATABASE_URL 用现有 POSTGRES_PASSWORD 派生。逻辑单测通过 |
| backend/data/*.db-shm/-wal 未被 gitignore | 低（已修） | 本轮补 .gitignore 三行 |
| CI fastpath 测试挂 continue-on-error | 中（已修） | 测试红 CI 仍绿=造假隐患；已移除并新增 rescue-check job |
| backend.Dockerfile `chown -R /app` 病态慢 | 中（已修） | WSL2 下 >20min 卡死构建；改为仅 chown 4 个可写数据目录（14.5s），代码/依赖保持 root 只读 |

## 2026-07-09 第二轮：WebSocket 管线静默降级修复

Opus 子 agent 审计 `agent-gateway.ts` / `device-gateway.ts` 发现 5 类共 ~30 处问题。按影响分级修复：

### 已修复

| # | 缺陷 | 根因 | 修复 | 证据 |
| --- | --- | --- | --- | --- |
| W1 | **auditLogger 影子写阻塞所有调用方最多 16s**（io.use 连接卡死、威胁/扫描结果广播被阻断） | `audit-logger.service.ts` 在非 fail-closed 模式下仍 `await` 两个 Postgres 影子写（各最多 8s），注释说"best-effort 不阻塞"但实现没做到 | 非 fail-closed 模式下影子写改 fire-and-forget（`void .then().catch()`），本地 SQLite 提交（合规源真相）仍同步；`AUDIT_LOG_FAIL_CLOSED=true` 保持原有同步 await | typecheck 0 + 5 suites/41 tests + 4 suites/18 tests + 2 suites/66 tests 全过 |
| W2 | **乐观审计：命令未发出就记 success**（`request:scan`/`block_ip`/`unblock_ip`） | `agent-gateway.ts` 先 `await auditLogger.logCommand({success:true})` 再 `sendSignedCommand()`，后者返回值被丢弃；agent 离线时审计说成功但命令没发 | 先调 `sendSignedCommand`（返回 boolean），按实际结果审计 `success:sent`，未送达时 `socket.emit('error')` 通知客户端 | 同上测试全过 |
| W3 | **io.use 连接路径 auditLogger 无 try/catch**（SQLite 写失败即连接失败） | `agent-gateway.ts:417,507` 裸 `await auditLogger.log()` 在已认证后、`next()` 前；审计失败=连接被拒 | 包 try/catch：审计失败只记 error 日志，`next()` 照常执行（已认证用户不受审计故障影响） | 同上 |
| W4 | **agent:threat 审计失败阻断威胁广播** | `agent-gateway.ts:726` 裸 `await auditLogger.log()` 在 `broadcastToDashboards('threat:detected')` 前 | 包 try/catch：审计失败记 error，威胁广播照常执行 | 同上 |
| W5 | **device-gateway JSON 解析静默吞错** | `device-gateway.ts:506` bare `catch {}` 丢弃解析异常，操作员永远不知道设备发的是坏 JSON | 改为 `catch (parseError)` + `logger.warn` 带设备 ID + payload 预览 | 同上 |

### 2026-07-09 代码复核发现

对本周改动做静态复核（`git diff --stat` 锚定 10 个改动文件逐文件读 diff + 源码核对）：

### 已修复

| # | 缺陷 | 根因 | 修复 | 证据 |
| --- | --- | --- | --- | --- |
| R1 | `install-offline.sh` backfill 状态消息谎报"left untouched" | `missing_any=0` 初始化为整数 0，但 `backfill_key` 内用 `[[ -z "${missing_any}" ]]`（字符串空测试）判断——`"0"` 非空，分支永不触发：注释头永不写、`missing_any` 永不变 1，最终 `[[ "${missing_any}" -eq 0 ]]` 恒真，即使刚追加了 key 也报"未改动" | 改 `[[ -z "${missing_any}" ]]` 为 `[[ "${missing_any}" -eq 0 ]]`（整数比较） | 隔离模拟：TEST1（缺 SERIAL_HELPER）现报"backfilled"+写头+追加 key；TEST2（完整）报"untouched"+行数不变 12；`bash -n` exit 0 |

### 复核发现（未修，按风险排）

| # | 发现 | 文件:行 | 风险评估 |
| --- | --- | --- | --- |
| ~~R2~~ | ~~`AUDIT_LOG_FAIL_CLOSED=true` 时命令先下发、审计后失败~~ | `agent-gateway.ts` `auditCommandDispatchAttempt` | **2026-07-14 已修**：fail-closed 模式先写 `status:'attempt'`；preflight 审计失败时不 emit。emit 后结果审计失败显式返回 `command_may_have_been_delivered`，不谎报未执行。`agent-gateway.test.ts` 分别断言未生效/可能已生效两类最终状态；全量 3257 tests / 0 failed |
| R3 | `queryWithTimeout` 超时后底层 `pool.query` 不取消 | `postgres-shadow-store.service.ts:1077` | **低-中**。pg 不支持 Promise.race 取消在途查询。pool 耗尽时每个 8s 超时的查询仍留在 pg 内部队列，连接空闲后仍会执行（SELECT 浪费、INSERT/DELETE 实际变更）。连接最终归还（非泄漏），负载降后自愈。`unref` 防止阻止退出。彻底修复需改 `pool.connect()`+手动 cancel，属更大重构 |
| ~~R4~~ | ~~`command_not_delivered` 错误分支无测试~~ | `agent-gateway.test.ts` | **2026-07-14 已修**：在线连接但 `status.isOnline=false` 的 agent 收不到 scan；dashboard 收到 `agent_offline_or_rejected`，且 `logCommand.success===false` |
| R5 | 默认模式 `recordAuditShadowWrite(true)` 双计 | `audit-logger.service.ts:317,324` | **低**。execute + upsert 各调一次成功计数，单事件计 2。**预存**（原 await 版同样双调），非本轮引入 |
| ~~R6~~ | ~~device payload 预览入日志~~ | `device-gateway.ts` JSON parse warning | **2026-07-14 已修**：错误日志只保留 deviceId 与 parser error；测试断言日志对象不存在 `payloadPreview` |

### 未覆盖范围

- 本次复核为静态读 diff + 源码核对 + 针对性 grep；未重跑 `npm run test:all`（本周改动测试证据见账本 2026-07-09 行：agent-gateway 66 tests / auth suites 41+18 tests 全过）。
- `rescue/` 新 crate（49 cargo tests）未纳入本轮复核范围——属独立大型 review scope，其 release-prohibition 已有 `check-rescue-no-release.mjs` 源码级守卫。
- 检索命令：`grep -rn 'command_not_delivered\|success: sent' backend/src/__tests__`（0 命中→确认 R4 测试缺口）；`grep -n 'sendSignedCommand' backend/src/websocket/agent-gateway.ts`（确认返回 boolean、非 async、内部 try/catch 不外抛）。

## 登记（本轮未修，按优先级排）

| 项 | 级别 | 说明 |
| --- | --- | --- |
| ~~agent API key 撤销后 WebSocket 不断开（(e)1）~~ | ~~中-高~~ | **沿用 2026-07-09 修复**：`startAgentSessionRevalidation` 定期直读 registration status；撤销断连/approved 保持/瞬时 DB 错误不断连 3 测试 |
| ~~agent 无心跳超时检测（(e)2）~~ | ~~中~~ | **2026-07-14 已修**：生产 sweep 每 30s 检查服务端 `lastHeartbeat`，默认超过 5 分钟断连并广播 `heartbeat_timeout`；焦点断言 stale agent 从 map 移除 |
| ~~hardware-auth fallback 缺 `confirmed` 字段（(c)4）~~ | ~~中-高（安全路径）~~ | **2026-07-14 已修**：legacy handler 返回 ECDSA/digest/counter/expiry 的验证结果；dashboard `confirmed` 只取该结果并带 `confirmationSource`。反例：设备自报 true + `invalid_signature` → 广播 false |
| Redis-down 时 token 黑名单跳过且静默（(c)2-3） | 中 | `ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN=true` 时跳过黑名单检查，客户端无降级信号。需向 dashboard 推送降级提示 |
| Redis 限流降级到内存无分布式信号（(c)1） | 低-中 | 多实例部署时有效限流变为 `实例数 × MAX`；需聚合降级状态 |
| 非审计 service 调用无 try/catch（(b)10,12,14,15） | 低-中 | `updateLastSeen`/`handleOtaStatus`/`dispatchHardwareConfirmedIntent` 裸 await，大部分已被 auditLogger fire-and-forget 间接缓解，但 service 自身挂起仍会阻塞 |
| token 轮换后 WS 用旧 token 重验（(e)3） | 低 | `socket.data.authToken` 在连接时捕获，HTTP 刷新后 WS 仍验旧 token；旧 token 被黑名单后会误断 |

## 2026-07-09 技术调研报告 V2 逐条核查

来源：`C:\Users\Abraham\.gemini\antigravity-ide\brain\...\technical_review_report.md`（13 条隐患）。逐条对照当前代码：

### 核查为假（报告读旧码/机制误述，9 条）

| 报告条目 | 报告声称 | 核查结论 | 证据 |
| --- | --- | --- | --- |
| 1.1 sameSite lax | `auth.middleware.ts:225` 配 lax | **假**。已 bc034f9 改 strict；line 225 是 `return {userId}`，cookie 配在 `auth.middleware.ts:244` `sameSite: 'strict' as const`。grep `'lax'` 仅命中历史注释 |
| 1.3 refresh race 散落 401 | 无全局路由捕获 | **假/夸大**。`api.ts:167-209` 有 `isRefreshing`+`refreshSubscribers` 队列串行化刷新；失败时 `notifySessionExpired()` 单事件 + 各请求 resolve 原 401（设计如此），非"页面崩溃" |
| 2.1 Redis 抖动→全站 401 踢下线 | 返回 401 拒绝 | **假**。`auth.middleware.ts:285-293` Redis 不可用时返回 **503 retryable**（AUTH_BLACKLIST_UNAVAILABLE），非 401；`ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN=true` 另走跳过黑名单（已知登记项），均非"401 踢下线" |
| 2.2 并发 session Set 只增不减 | 过期元素不移除 | **假**。`auth-security.service.ts:498-521` `pruneConcurrentSessions` 在强制限额前 `smembers`→逐个 `exists`→`srem` 过期项；`auth-security.service.test.ts:56` 断言 |
| 2.3 hardware_* 表无 Postgres 双写 | 仅 SQLite 单点 | **假**。`postgres-shadow-store.service.ts:39-41,754,798` `hardware_gates`/`hardware_confirmation_sessions` 在 TABLES 配置内；`hardware-authorization.service.ts:604` counter 推进时 `upsert('hardware_gates',...)` 影子写。CLAUDE.md 旧注"不含 hardware_*"已过时（2026-07-04 overhaul 后已覆盖） |
| 3.1 fastpath 崩溃→fail-open 旁路放行 | 流量层 fail-open | **夸大/误述**。fastpath 是 sidecar；`fastpath-client.service` 有 `fallbackEnabled` 开关，`fallbackEnabled=false` 时抛错不放过。检测管线（detection-pipeline）独立于 fastpath 运行，fastpath 挂不绕过安全校验。AI 层 heuristic fallback 有 `heuristicDegraded` 透明标记 |
| 4.2 单字符乱码→物理断网（fail-closed trap） | 解析失败即断桥 | **假**。`main.c:34` `if (!serial_json_parse(line,&msg)) return;` 解析失败**丢弃该帧**，不调 `controller_assert_isolated()`。fail-closed 只在 `controller_handle_release_request` 内校验失败（签名/counter/digest/expiry）时触发 |
| 4.4 counter 重置死锁（M2 flash） | M2 flash 高水位不变→死锁 | **假机制**。`grep 'flash\|persist' firmware/.../Core/Src` 0 命中；`g_state.high_water_counter` 是 RAM，M2 重启归零。无 M2-flash-vs-DB 不匹配。注：DB 清空而 appliance daemon RAM 高水位在跑的窄窗口仍存在，但 rescue resync 路径可恢复 |
| 5.2 规则毒化 DoS（frequency>=3） | 规则生效后自伤 | **假**。`synthesis-engine.ts:270` `addPolicyUpdate` 仅 push 进内存数组 + log，**无自动生效路径**。"一旦该规则生效"无代码支撑。配合 5.1（内存态、重启挥发），synthesis 当前是无执行力的观测系统 |

### 核查为真并修复（2 条）

| 报告条目 | 核查结论 | 修复 | 证据 |
| --- | --- | --- | --- |
| 4.1 serial_json.c strstr 模式匹配 | **真**。`json_find_string` 用 `strstr("\"key\":\"")` 紧凑匹配，RFC8259 冒号前后空格不识别；`strchr(p,'"')` 遇 `\"` 截断；strstr-anywhere 可匹配值内键名 | 重写为 `find_value()`：键必须处于对象成员位（前导非空白符为 `{`/`,`）+ 跳过冒号前后空白 + `json_find_string` 处理 `\"\\/\/\b\f\n\r\t` 转义 | gcc 直编 + `./test_controller.exe` **18 passed/0 failed**（新增 5 个 serial_json 用例：紧凑基线/空格容忍/转义反转义/键名防伪/hello+unknown） |
| 1.2 WS 会话无主动失效 | **半真**。dashboard 侧已有 `startDashboardSessionRevalidation`（`agent-gateway.ts:924` 周期验黑名单断连）；**agent 侧无**——`verifyAgent` 仅连接时调一次，`revokeAgent` 不断现有 socket | 新增 `agent-auth.service.ts:getAgentStatus()`（同步直读 DB status，绕过 Redis 缓存）+ `agent-gateway.ts:startAgentSessionRevalidation`/`revalidateAgentSession`：周期轮询，仅 `status!=='approved'` 断连；**查询抛错（瞬时 DB 故障）不断连**（防 blip 全踢）；`revokeAgent` 已清 Redis 缓存故轮询能检出 | typecheck 0；新测 `websocket-agent-session-revalidation.test.ts` **3 passed**（撤销断连/保持 approved/瞬时错误不断连）；agent-gateway 66 + agent 路由 47 测无回归 |

### 核查为真但非代码缺陷（2 条，登记不修）

| 报告条目 | 核查结论 | 处置 |
| --- | --- | --- |
| 4.3 challenge 环形 16 槽 DoS | **真但被中和**。`controller_tasks.c:91-100` 确为 16 槽环形，溢出 eviction。但重放同一 challenge 仍被 `counter > high_water` 拒（counter 是主防线，challenge 是次防线）。且发起 challenge 需有效签名 grant | 不修（设计预期；`test_challenge_ring_eviction_window` 已文档化此边界） |
| 3.2 unix socket 0o660 权限 | **真·运维**。`rust-fastpath/src/main.rs:633` 配 `0o660`——有意安全权限，要求 Node.js/Rust 同 GID 运行。属部署配对齐事项，非代码缺陷 | 不修（GID 对齐在 Dockerfile/systemd 配置中处理） |

### 报告第 6 条（后续补充）：device-control monotonic counter 防重放

| 报告条目 | 核查结论 | 修复 | 证据 |
| --- | --- | --- | --- |
| 6. device-control monotonic counter 无高水位检查 | **半真（防御纵深缺失，非可利用漏洞）**。`device_confirmation_sessions.last_monotonic_counter` 列存在但为死代码——`handlePhysicalConfirmationAck` 既未检查 `> lastCounter` 也未推进写入。**但**：①签名绑定了随机 `sessionId`（攻击者无法用旧签名通过新 session 验证）；②单次状态机（`pending→claiming→confirmed/rejected`，同 session 不可重入）；③challenge 绑定。结论：设计上已防重放，但 monotonic counter 纵深闸门缺位 | 补齐 per-device counter 高水位：`handlePhysicalConfirmationAck` 内加 `monotonicCounter > existing.last_monotonic_counter` 检查 + 确认成功后 UPDATE 推进 | typecheck exit 0；`device-control.service.test.ts` **3 passed/0 failed**（含 replay rejection 测试） |
| 3.2 unix socket 0o660 | **真**。`main.rs:633` `from_mode(0o660)`。Node/Rust GID 未对齐会 EACCES | 不修（0o660 是有意的安全权限，非 0o666；属部署 GID 对齐运维事项，docker compose 同命名空间） |
| 5.1 synthesis 内存态挥发 | **真**。`synthesis-engine.ts:33-36` 全内存，重启丢失 | 不修本轮（synthesis 当前无执行力见 5.2，加持久化是独立 feature；且 L7 非 fail-closed 安全路径） |

### 未覆盖范围

- 本次核查为静态读码 + grep + 针对性单测；未跑 `npm run test:all` 全量（新增/改动文件均跑焦点套件：agent-gateway 66、agent 路由 47、新 revalidation 3、firmware host 18）。
- 1.2 agent 侧修复未在真实多 agent 负载下验证 revalidation 定时器对事件循环的开销（60s 间隔 + 单行索引 SELECT，预期可忽略）。
- 检索命令：`grep -rn 'flash\|persist\|nvm' firmware/controller-stm32h5/Core/Src`（0 命中→证 4.4 假）；`grep -n 'sameSite.*lax' backend/src`（0 命中→证 1.1 假）；`grep -n 'pruneConcurrentSessions\|srem.*stale' backend/src/security/auth-security.service.ts`（命中→证 2.2 假）。

## 未覆盖范围

- 未跑 `npm run test:all` 全量（本轮后端零代码改动；账本 2026-07-08 已有 3151 tests/0 failed 记录）；前端无单测框架，App.tsx 改动验证为 typecheck+lint+（容器起后的）e2e smoke。
- 未验证真实 Postgres/Redis 生产实例下的登录链路；未做浏览器实操录屏。
- WebSocket / device-gateway 管线未在本轮探查（同类"静默降级"风险建议下轮扫）。
- 检索命令：`grep -rniE 'TODO|FIXME|not implemented|未实现' backend/src frontend/src rescue/src simulator/*.ts firmware/.../Core rust-fastpath/src`（排除测试与 node_modules）——一线源码命中仅上表两类。
