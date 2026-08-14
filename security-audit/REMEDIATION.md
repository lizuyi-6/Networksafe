# REMEDIATION — 2026-08 白盒审计修复跟踪

> 本文件是修复账本（FINDINGS.md 为冻结的发现清单，不回写）。
> 每项记录：修复内容、关键文件、验证证据（命令+结果）、提交。

## Batch 1 — P0（PR #22，已合并 master @58dca1f）

| ID | 修复 | 证据 |
| --- | --- | --- |
| AG-B01 (Critical) | /generate-bundle 与 /save 补 InputValidator；PROFILE_STRING_FIELDS 控制字符（`[\u0000-\u001F\u007F]`）拒绝；heredoc marker 改 `randomBytes(16)` 随机 token + 内容碰撞重试；DEPLOYMENT_ID_PATTERN 白名单；bundle 文件路径 containment | PoC 回归 5/5 PASS（jest.audit.config.js） |
| DP-003 (High) | installer generateSecret/generateHexSecret 改 crypto.randomBytes + 拒绝采样（消除模偏差） | installer tsc clean |
| DP-012 (Medium) | 全部 curl\|sh 改 review-or-pin：sha256 打印 +（pin env 校验 \| 交互式确认）；非交互无 pin 中止。因本环境代理按客户端返回不同内容（Invoke-WebRequest vs curl.exe 哈希不一致、get.docker.com RST），**不落库任何 pin 值** | bash -n 两脚本 clean；DP-012 提交信息记录证据 |
| FW-001 (Critical) | M1→M2 串口通道 HMAC-SHA256：固件 grant_auth.c（FIPS 180-4 + RFC 2104，RFC 4231 向量锚定）+ 无密钥即全拒（fail-closed）+ 常时比较；daemon 无 serialChannelKey 拒绝 arm + MAC 附带；simulator 同步强制 | 固件 27/27；后端 27/27（2 新 FW-001 用例）；sim 4/4 + 4 场景 exit 0 |

## Batch 2 — P1（本 PR）

### AG-DEP01 — socket.io-parser GHSA-2m8v-j782-fhvr（High）
- 修复：`npm audit fix` 升 socket.io-parser 4.2.6→4.2.7、fast-uri 3.1.4→3.1.5（prod），加 dev 链 brace-expansion/js-yaml
- 证据：`npm audit`（含 dev）`found 0 vulnerabilities`；lockfile diff 仅 6+31/6-31 行（无意外包变更）；websocket 套件 7 suites 139/139 PASS

### AG-B07 — GET /api/config 泄漏 SMTP 密码与 webhook headers（Medium-High）
- 修复：`platform-config.service.ts` 新增导出 `redactPlatformConfigSecrets`（深拷贝后掩码每个 channel 的 `smtp.password` 与全部 webhook header **值**，保留键名供 UI 渲染）；`config.routes.ts` GET / 仅 `platform_admin` 得原文，其余角色得脱敏副本（同时修复 FE-005 的浏览器内存物化面）
- 证据：config 三套件 115/115 PASS，新增 3 用例（admin 原文 / 非 admin 脱敏 / 缓存不可变性——脱敏绝不回写 service 缓存）

### RF-001/RF-002 — fastpath 无鉴权 + 无界内存（High）
- 修复（rust-fastpath）：
  - 全部 `/v1/*` 路由前置 HMAC-SHA256 请求鉴权（`X-Fastpath-Auth: HMAC-SHA256 <hex>`，MAC 覆盖请求体原文，常时比较；`/healthz` 保持公开供容器探针）；启动 fail-closed：无 `FASTPATH_AUTH_SECRET` 拒绝启动（≥16 字节），`FASTPATH_AUTH_DISABLED=1` 为显式本地开发逃生口
  - 非 loopback TCP bind 由"告警"升级为拒绝启动（需 secret + `FASTPATH_TCP_ALLOW_NON_LOOPBACK=1` 双确认）
  - `window_ms` clamp 至 24h（根除 u64::MAX 饱和 → cleanup 永不回收 → OOM）；tenant+key ≤512 字节；分片条目上限（`FASTPATH_MAX_ENTRIES`，默认 1M）满时驱逐最近过期项并计数（healthz 可见 evictions）
  - `DefaultBodyLimit` 2MiB + 10s 请求超时（slowloris 面）
- 修复（backend）：`fastpath-client.service.ts` axios 请求拦截器对每个请求计算同一 HMAC（buildFastpathAuthHeader，RFC 4231 case 2 向量与 Rust 侧互锚）
- 部署接线：`FASTPATH_AUTH_SECRET` 进 compose `:?` 硬保护（fastpath + backend 两服务）、.env.example、setup.mjs、setup-env.sh、install-offline.sh（三生成器键列表保持同步）
- 证据：cargo test 24/24（新增 7 用例：RFC 向量、缺/错/篡改 MAC 401、GET 路由鉴权、window clamp 可回收、超长 key 400、分片驱逐+evictions 计数、启动姿态 fail-closed 矩阵）；clippy -D warnings 0；后端 fastpath 三套件 45/45 PASS（新增 auth 5 用例）；typecheck clean

### DP-005 — gateway applyRuleset fire-and-forget（High）
- 修复：daemon 启动即同步断言 isolated_ruleset（nft 非 0 退出拒绝启动）；运行期 isolated 应用失败 → `process.exit(1)` 交 systemd 重启（ExecStartPre/ExecStopPost 重断言）；released 应用失败 → 保持隔离（安全态）仅告警
- 证据：tsc 语法级检查（--noResolve 模块解析报错为预期，无语法错误）；行为分支代码内注释锚定

### DP-006 — systemd 引用不存在的 preflight-check 二进制（High）
- 修复：新增 `deployment/gateway/bin/aetherguard-gateway-preflight-check.sh`（应用 isolated_ruleset + `nft list ruleset` 能力验证，非 0 即拒绝启动 daemon）；install.sh 第 [4/7] 步安装至 `/usr/local/bin/aetherguard-gateway-preflight-check`（755）——ExecStartPre 引用自建包起即闭环
- 证据：bash -n clean ×2

### DP-010/DP-011 — 离线 bundle 无签名 + skip-verify 仅警告 + docker 下载无摘要（Medium）
- 修复：
  - build：`--signing-key <私钥>` 对 SHA256SUMS 产生 `SHA256SUMS.sig`（openssl dgst）；`--docker-engine-sha256`/`--compose-plugin-sha256`（或 env）pin 校验不匹配即中止，始终打印并写入 manifest 计算值
  - install：`--skip-verify` 单独使用**直接拒绝**，须 `--skip-verify --accept-unverified` 双确认；bundle 带 .sig 时强制 `--verify-key`，先验签后逐文件校验；README 同步（含构建/安装两侧新旗标说明）
- 证据：bash 实跑分支矩阵——skip-verify 单独 exit 1；带签名无 key exit 1；key 不存在 exit 1；真密钥对 正常安装 exit 0（"vendor signature verified"）；签名后篡改 SHA256SUMS → openssl 验签失败 exit 1

## 验证总账（Batch 2）
- backend `npm run test:all`：4 shards 66+65+65+65 suites / 855+861+856+855 = **3427 tests 全过**（首轮 1 个 SQLITE_BUSY 偶发，复跑 4/4 shards 全绿）
- backend `npm run typecheck` clean；`npm audit` 0 vulnerabilities（含 dev）
- rust-fastpath `cargo test` 24/24、`cargo clippy -- -D warnings` 0
- rescue `cargo test` 51/51、clippy 0
- firmware host tests 27/27
- guards：route-db / repository-hygiene / no-direct-api-fetch / frontend-api-contract 4/4 exit 0
- AG-B01 PoC 回归 5/5 PASS

## Batch 3 — P2（本 PR）

### AG-B03b — codebook 全局可写 + 设备读取无租户过滤（Medium）
- 修复（`backend/src/api/routes/devices.routes.ts` + `services/device-registry.service.ts` + `websocket/device-gateway.ts`）：
  - `POST /api/devices/codebook` 加 `requireRole('admin')`（codebook 是平台级全局映射，改写仅限管理员；`GET /codebook` 保持只读开放）
  - `DeviceInfo` 增可选 `tenantId`；WS 注册路径（device-gateway `register_device`）绑定认证租户上下文 `tenantContext.tenantId`
  - 新增 `canViewDevice`：绑租户的设备仅本租户或 `platform_admin` 可见；legacy/模拟器注册（无 tenantId）保持全员可见（向后兼容）；`GET /:id`、`GET /:id/events`、`GET /:id/config` 三个读取口统一 404-on-mismatch（与不存在不可区分）
- 证据：devices.routes 套件 25/25 PASS（新增 5 用例：POST /codebook 路由层 wiring pin + 非 admin 403 不落库（jest.doMock 重建 router）、跨租户 404 ×3 端点、本租户/platform_admin 200、legacy 设备仍可见）

### AG-A06 — /api/investigation/* 静态共享 key 伪造 tenant/ultra 身份（Medium）
- 修复（`backend/src/middleware/auth.middleware.ts` + `api/routes/investigation.routes.ts`）：
  - 新增 `authenticateRegisteredAgent` 中间件：`X-Agent-Id` + `X-Api-Key` 经 `agent-auth.service.verifyAgent`（注册表 approved 状态 + API key hash + 撤销即时生效），后端不可用时 fail-closed 401
  - 附着身份为最小权限服务身份（`role='viewer'`、无 plan、带注册租户），修复前 `VALID_API_KEYS` 持有者可伪造 `role=tenant, plan=ultra`
  - `investigation.routes.ts` 从 `authenticateAgent`（= authenticateApiKey）切到新中间件；旧导出保留并标注 DEPRECATED（防新路由再接线）
- 证据：authenticate-registered-agent 套件 4/4 PASS（缺头 401、注册表不通过 401、最小权限身份断言 role≠tenant 且 plan=null、后端异常 fail-closed）；investigation 套件 8/8、auth.middleware 套件 24/24 无回归

### AG-B02 — ai-endpoints allowPrivate SSRF（含云元数据）+ webhook URL 无校验（Medium）
- 修复（新增 `backend/src/security/outbound-url-guard.ts`）：
  - 共享出站 URL 守卫：云元数据端点（169.254.0.0/16、metadata.google.internal 系、100.100.100.200、168.63.129.16、fd00:ec2::235）**无条件阻断**——即使 `allowPrivate`（ollama）也不例外；协议白名单 http/https；私有目标（loopback/RFC1918/ULA/link-local/IPv6）按 `allowPrivate` 选项放行
  - `ai-endpoints.routes.ts` `validateAiUrl` 改走守卫（自建 ollama LAN 端点保持可用）
  - `notification-dispatcher.service.ts` `sendWebhook` 在**派发时**（安全边界，覆盖所有配置入口）强制守卫；私网 webhook 需 `ALLOW_PRIVATE_WEBHOOKS=1` 显式确认（默认关）
- 证据：outbound-url-guard 套件 13/13 PASS（7 元数据目标 allowPrivate 下仍拒、RFC1918/loopback/IPv6 语义、172.16-31 精确边界、gopher/file 协议拒）；ai-endpoints 套件 16/16（新增 ollama+metadata 400 ×3 不落库）；notification-dispatcher 套件 9/9 无回归

### AG-B04 — SERIAL_HELPER_SHARED_SECRET 单共享密钥不可单点撤销（Medium）
- 修复（`backend/src/middleware/helper-auth.middleware.ts` + `companion/serial-device-companion.ts` + `bootstrap/runtime-env.ts` + `.env.example`）：
  - 中间件支持命名多密钥：`SERIAL_HELPER_EXTRA_SECRETS`（逗号分隔 `keyId:secret`）+ 客户端 `X-Aetherguard-Helper-Key-Id` 头；**带 key id 即只比对该命名密钥**——未知 id/不匹配/撤销后一律 401，不回落共享密钥（撤销一台 appliance 不必全员轮换）；匿名请求保持任意已配置密钥可过（legacy 兼容）；命中密钥 id 挂 `req.helperKeyId` 供审计
  - companion 读 `SERIAL_HELPER_KEY_ID` 并随上报发送 key id 头
  - runtime-env 生产校验每个条目（≥32 字符、≠ DEVICE_COMMAND_SECRET、≠ 共享密钥、keyId 唯一、格式合法）
- 证据：helper-auth 套件 9/9 PASS（新增 7 用例：命名密钥通过+id 附着、撤销后 401、命名路径不回落共享密钥、跨 id 密钥 401、legacy 匿名兼容 ×3 密钥、bearer 头、未配置 503）；runtime-env + companion 套件 23/23 无回归

### DP-014 — compose 引用不存在的 backend.Dockerfile + 陈旧生产脚本（Medium）
- 修复：
  - `docker-compose.yml` backend build 改 `context: ./backend` + `dockerfile: Dockerfile`（backend/Dockerfile 全部 COPY 路径本就 backend-相对，fresh checkout `docker compose build` 恢复可用）
  - `deployment/production/deploy.sh`/`deploy.ps1` 重写：删 `cp .env.example .env` 引导（弱值必被生产校验拒），改为强制要求仓库根 `.env` 并指向 setup-env.sh；legacy `docker-compose` v1 调用全部改 `docker compose` v2（include/env_file long syntax 必需）；端口输出从陈旧 8888/3010 改为实际入口 127.0.0.1:8080；健康检查改 `docker compose ps`
- 证据：`docker compose config`（临时 FASTPATH_AUTH_SECRET 下）exit 0，backend 段解析为 `context: <repo>\backend, dockerfile: Dockerfile`；`bash -n deploy.sh` exit 0

### DP-007 — ci.yml release-verify 硬编码测试密钥（Medium）
- 修复：四个字面量测试密钥改 `ci-${{ github.run_id }}-...` 运行期拼接（fork 不可见可复用字面量；run 内仍满足最小长度校验；不落入 weak-value 字面量集）
- 证据：grep 全 workflow 无残余硬编码 SECRET/PASSWORD 字面量（仅 run_id 模板）

## 验证总账（Batch 3）
- backend `npm run typecheck` clean
- backend `npm run test:all`：4 shards 全过 exit 0（含全部本批新套件；末 shard 65 suites / 823 tests）
- firmware host tests（gcc 直编）：**27 passed, 0 failed**
- rust-fastpath：`cargo test` **24/24**、`cargo clippy -- -D warnings` exit 0
- rescue：`cargo test` **51/51**、`cargo clippy --all-targets -- -D warnings` exit 0
- guards：route-db / repository-hygiene / no-direct-api-fetch / frontend-api-contract 4/4 exit 0（api-contract: 109 calls → 171 routes）
- AG-B01 PoC 回归 5/5 PASS（本批未触碰 generate-bundle，回归确认无破坏）
- `docker compose config` exit 0（临时 FASTPATH_AUTH_SECRET 下验证 backend build 段解析）；`bash -n deployment/production/deploy.sh` exit 0

## Batch 4 — RS/FW 批（本 PR）

### RS-002 — audit_outcome `.ok()?` 吞错（Medium，VERIFIED）
- 修复（`rescue/src/runtime.rs`）：
  - `audit_outcome` 返回 `OutcomeAudit`（event_id / append_error / anchor_error）而非 `Option<u64>`——outcome append 失败与截断锚持久化失败都不再被吞
  - 新增 `finalize_outcome` 折叠规则：**append 失败 → decision 降级 `error`**（动作已执行，操作员必须知道其唯一防篡改痕迹缺失，reason 保留原 decision/reason + `audit_outcome_lost: append failed`）；**锚持久化失败 → decision 保持但 reason 追加 `audit_anchor_persist_failed`**（事件已在链上，仅截断检测降级）
  - 三个调用点（isolate / restart-primary denied / restart-primary executed）全部切换
- 证据：`cargo test` **53/53**（新增 2 回归：executor 内破坏 events 文件 → decision=error + reason 前缀 `audit_outcome_lost` + 伪造 id 不存在；破坏 snapshot 文件 → decision 仍 allowed + reason 含 `audit_anchor_persist_failed` + 双 id 真实在链）

### RS-001 — run-drills.mjs 陈旧 feedback 语义（Medium/High）
- 修复（`scripts/rescue/run-drills.mjs`）：DRILL-001b/SEC-005/SEC-005b/SEC-007 的 mock frame 从反转语义改为与固件/daemon/rescue runtime 三方一致的语义（feedbackOk=false=继电器开=物理隔离确认）；SEC-005 现为焊死触点场景（isolated+feedbackOk=true → 不确认），SEC-005b 现为缺 feedback 场景（feedbackOk=None → 不确认）
- 证据：`cargo build --release` 后 `node scripts/rescue/run-drills.mjs` **12/12 PASS**——验证链恢复：drill 绿灯现在验证的是**新**二进制语义（此前 target/release 是 HEAD 旧版，绿灯验证陈旧语义）

### FW-003 — `"expiresAt":"-1"` strtoul 回绕 UINT32_MAX 永不过期（High）
- 修复（`firmware/.../serial_json.c`）：新增 `json_find_grant_uint` 严格解析（纯 ASCII 数字、[1, UINT32_MAX-1]、≤10 位、溢出拒绝）替代 strtoul——`-1`/`+5`/尾随垃圾/溢出/UINT32_MAX 哨兵全部按"字段缺失"处理 → 校验链 fail-closed 拒绝
- 证据：test_controller 新增 `FW-003: negative/sentinel/overflow numbers parse as absent` 断言 6 组畸形输入全 0、边界值正常解析

### FW-004 — g_current_time_s 恒 0 使过期检查形同虚设（High）
- 修复（固件 + daemon + 部署 wrapper 三层）：
  - `controller_tasks.c`：`g_time_synced` 门控——`controller_validate_expiry` 在从未收到时间同步时**恒 false**（未知时钟无法证明 grant 仍有效）；`controller_update_time` 拒绝大幅回拨（>60s，防 UART 重放 time_sync 复活过期窗口），小抖动容忍
  - `serial_json.c/.h` + `main.c`：新 `time_sync` 帧类型（`{"type":"time_sync","epochS":N}`），epochS 用同一严格解析
  - `gateway-daemon.ts`：`emitTimeSync()`（启动即发 + 随 watchdog 周期 + 每次 arm release 前）——M1→M2 时钟馈送闭环；`DaemonFrame.epochS` 字段
  - 部署 wrapper `aetherguard-gateway-daemon.ts`：time_sync 帧写串口
- 证据：固件新增 4 用例（未同步恒拒、大幅回拨拒+小抖动收、未同步时结构完好 grant 仍拒、time_sync 解析）；simulator `npm run sim` exit 0（4/4 PASS）+ 4 场景 exit 0

### FW-006 — 高水位 RAM-only 断电复位（Medium）
- 修复（`controller_tasks.c/.h`）：`controller_attach_counter_store`（load/save 函数指针对，生产由 SE/backup-register 后端实现）——attach 时载入（不降低已在内存中更高的标记）；成功 release 后 save，**save 失败撤销该 release 并回隔离**（宁失释放窗口不失安全标记）；无 store 保持 RAM-only 兼容（控制面 DB 高水位 + 串口 MAC 仍独立防线）
- 证据：新增 2 用例——`FW-006: persisted high-water survives a power cycle`（双 boot 文件存储，跨"断电"重放同 counter 被拒、更大 counter 通过）；`failing save revokes the release`（save 失败 → DENIED + ISOLATED）。测试基建用文件级 static store（栈上 struct 挂全局会悬垂——本批实测崩溃后修正，测试 main 加 setvbuf 无缓冲定位崩溃点）

### FW-008 — 解析器容错未文档化（Low）
- 修复：`serial_json_parse` 头注释文档化 duplicate-key last-wins 残余（RFC 8259 未定义；MAC 绑定字段值，改 MAC 覆盖字段的重复键帧验签必败 fail-closed）

### FW-009 — ISR 内 HAL_UART_Transmit（Low）
- 修复（`main.c`）：TIM6/TIM7/EXTI 回调只置 volatile 标志（`g_heartbeat_due`/`g_estop_pending`），所有串口 I/O 移到主循环线程态；e-stop 保留主循环直采（双保险）

### FW-010 — 硬编码占位 policy digest（Medium）
- 修复（`controller_tasks.c`）：`controller_init` 不再 `strcpy` 占位串——本地 digest 与 channel key 同为制造/配对期供给的信任锚，未供给时空串永不匹配 → fail-closed（测试经 `controller_set_policy_digest` 显式供给）

### FW-011 — 修复未提交（流程项）
- 修复：本批全部固件改动随分支提交（此前 FW-001 修复 diff 长期滞留工作树）

## 验证总账（Batch 4）
- firmware host tests（gcc 直编，含 grant_auth.c）：**34 passed, 0 failed**（AGENTS.md/CLAUDE.md 同步 34 用例清单）
- rescue：`cargo test` **53/53**；`cargo build --release` exit 0；drills **12/12**（新二进制）
- simulator：`npm run sim` exit 0；`test:invalid-sig`/`counter-rollback`/`heartbeat-stale`/`estop` 全 exit 0
- backend：typecheck clean；companion + final-defense 套件 27/27；`npm run test:all` 4 shards（见合并前验证）
- 调试产物已清理（test_controller.exe / tc_a.exe / *.txt / *.out）

## Batch 5 — DP-002/FE/RS/RF/FW 混合批（本 PR）

### DP-002 — FTP 明文传输（High）
- 修复：
  - `scripts/deploy_frontend.ps1` 重写：`AETHERGUARD_FTP_SERVER` 必须 `ftps://`（`ftp://` 硬拒 + 明确报错）；`FtpWebRequest` + `EnableSsl=$true` 显式强制（不依赖 scheme 推断）替代 `WebClient.UploadFile`；`AETHERGUARD_FRONTEND_DIST_DIR` 可覆盖源目录（原脚本硬编码 `c:\Users\Abraham\Desktop\...` 机器路径）；证书按机器信任库默认校验（无回调降级）
  - `scripts/list_ftp.ps1` 同样 ftps-only + EnableSsl
  - 删除 `frontend/deploy_frontend.cjs`（硬编码生产 IP `39.102.81.78` + root 登录 + 私钥路径的 SFTP 一次性脚本，无任何流水线引用）
- 证据：PSParser tokenize 两脚本 0 解析错误；`git rm` 四文件 + 引用 grep 仅 FINDINGS/审计报告/过期 eslint 结果 JSON

### FE-001/FE-003 — demo 开关硬编码 + 失败静默不回滚 + 客户端身份选数据源（Medium）
- 修复（`frontend/src/config/demo-mode.ts` + `context/DemoContext.tsx`）：
  - `canUseDemoMode()` 从硬编码 `true` 改为构建期 opt-in：`VITE_APP_MODE=demo` 或 `VITE_ENABLE_DEMO_MODE=true` 才可用；`getStoredDemoMode`/`setStoredDemoMode`/`setRuntimeDemoMode` 全部经门控——陈旧 localStorage 标志无法在禁用构建中复活 demo 模式（demo ON 时设备命令短路为模拟成功的操作员误导面从根关闭）。**FE-003 同根关闭**：生产构建中客户端（sessionStorage 身份 + localStorage 标志）不再能选择数据源，demo 数据源仅存在于显式 demo 构建
  - `toggleDemoMode` 门控 no-op；后端模式切换失败不再 `.catch(()=>{})` 静默——保留本地离线 toggle（设计意图）但置 `backendModeSyncFailed` 状态 + console.warn，操作员可见后端仍在旧模式
  - `.env.development` 文档化两个新 env
- 证据：frontend `npm run build`（含 tsc）exit 0；credential/navigation/i18n hygiene 3/3 exit 0

### FE-002 — OIDC redirect 无前端 origin 校验（Medium，纵深）
- 修复（新增 `frontend/src/security/redirect-guard.ts` + Login/Settings 接线）：
  - `isAllowedRedirectTarget()`：相对路径（同源）恒过；绝对 URL 必须 http(s) 且 origin 在 `VITE_TRUSTED_EXTERNAL_ORIGINS`（逗号分隔，无通配）或同源；协议白名单外/解析失败/未配置外部 IdP 一律拒
  - `Login.tsx` authorizationUrl、`Settings.tsx` endSessionUrl 经守卫后再 `window.location.assign`；拒绝时 Login 报 toast、Settings 落回本地登出路径（登出仍完成）
- 证据：build exit 0（类型层覆盖）；后端侧 allowlist（auth.routes.ts buildOidcRedirectTarget）保持第一道防线不变

### FE-006 — 孤儿开发产物含硬编码凭据（Low）
- 修复：删除 `frontend/sec落地页.html`（硬编码 admin@AetherGuard.io/password）、`frontend/append_api.js`（追加改写 api.ts）、`frontend/append_walkthrough.js`（写绝对机器路径）、`frontend/record_video.js`、`frontend/deploy_frontend.cjs`——五文件均无 import/pipeline 引用（grep 证实）
- 证据：frontend build + 3 hygiene 脚本全过；check-repository-hygiene exit 0

### RS-003 — appliance read_line 无行上限（Low）
- 修复（`rescue/src/appliance.rs`）：`read_line` 包 `take(64KiB)`——滴水式无换行端点在读取期间即被截断，超限行返回 `InvalidData` 错误（调用方按 fail-closed 处理，绝不当作状态证据）
- 证据：新增 2 用例——真实 socket 对 128KiB 无换行字节流断言 `InvalidData`；<64KiB 正常帧照常读取。cargo test 54/54

### RS-004 — HTTP 头 cap 在整行返回后才检查（Low）
- 修复（`rescue/src/http.rs`）：请求行与每个头行的 `read_line` 均包 `take(MAX_HEADER_BYTES+1)`——单行无限增长在读取期间即受界，超限 413
- 证据：cargo test 54/54（既有请求解析用例无回归）

### RS-005 — challenge nonce map 无上限（Low）
- 修复（`rescue/src/auth.rs`）：`MAX_PENDING_CHALLENGES=1024`——`issue_challenge` 超限时返回 None（fail-closed），未认证 flood 无法在一个 TTL 窗口内无界增长
- 证据：新增 `challenge_flood_is_capped`（发满 1024 后断言 None）

### RS-004b（审计时间戳墙钟）— 记录为接受残余
- hash 链不含时间戳（内容完整性不依赖时序），事件 `event_count` 序号已提供全序；墙钟仅影响取证排序展示。不改（引入单调源需改链结构，收益不成比例）

### RF-003/004/005 残余 — accept 循环连接上限 + header 读超时（Medium/SUSPECTED）
- 修复（`rust-fastpath/src/main.rs`）：
  - `serve_tcp` 弃用 `axum::serve`（不暴露 header 超时/连接上限）改手动 accept 循环：`header_read_timeout=10s`（slowloris 头部滴流，keep-alive 每请求重新计时）+ `max_buf_size=64KiB`（单连接 hyper 读缓冲上界）
  - `serve_unix` 同样补 header 超时 + buf 上界
  - 两路径 `Semaphore(256)` 连接槽：满槽时新连接**拒绝**（fail-closed）而非全体降级
  - `hyper/http1/TokioIo/Service` 导出从 `#[cfg(unix)]` 提升（serve_tcp 现也用）
- 证据：cargo test 24/24、clippy -D warnings 0

### FW-007 — policyDigest strcmp 非常时（Low）
- 修复（`controller_tasks.c`）：`controller_validate_policy_digest` 双方零填充到 64 字节定长后走 `grant_auth_constant_time_equal`（FW-001 已有的常时比较）；语义与 strcmp 严格等价（含截断边界）
- 证据：固件 host tests 34/34（全部既有 digest 用例无回归）

## 验证总账（Batch 5）
- firmware host tests（gcc 直编）：**34 passed, 0 failed**
- rescue：`cargo test` **54/54**（+1 flood、+2 行上限）、`cargo clippy --all-targets -- -D warnings` 0
- rust-fastpath：`cargo test` **24/24**、`cargo clippy -- -D warnings` 0
- frontend：`npm run build`（tsc+vite）exit 0；credential-hygiene / navigation-hygiene / i18n 3/3 exit 0
- guards 5/5 exit 0（hygiene/contract/fetch/route-db/rescue-no-release）
- PS 脚本 tokenize 0 错误
- backend 本批零文件改动（git diff 证实），test:all 照跑见 PR 描述

## Batch 6 — ML 工作流批（本 PR）

### ML-004 — audit.jsonl sha256 链无 tip 锚、截断仍 verify ok、撕裂写回落 GENESIS（Medium，VERIFIED-static）
- 修复（`ml/data_pipeline/v03/audit.py` 重写）：
  - **截断检测**：每次 append 后写密封 tip 快照 `audit.tip.json`（{count, tipHash, seal}，原子替换+fsync）——验证任意前缀不再自洽：载入时 count/tip 与快照不符即拒绝（含"截断到空但快照记得非零"）
  - **整链重写检测**：快照带 `HMAC-SHA256("{count}:{tipHash}")` seal，密钥 `audit-chain.key`（CSPRNG 生成一次、0600、gitignored、永不提交）——本地进程重写整链后无法伪造 seal；密钥不可用时降级 unkeyed 快照（count+tip 仍强制）
  - **resume 安全**：`_load_last_hash` 不再任意异常回落 GENESIS——撕裂的**最终行**修复（crash mid-write），非末行不可解析=真实损坏直接 raise；载入即跑全链验证，违规 fail-closed 拒绝启动
  - `verify_with_snapshot()` 供 finalize/import 全量校验；`AuditIntegrityError` 新异常类型
  - `finalize.py` 第 0 步调用之——**拒绝在审计链失败时写 manifest**（fail-closed），报告加 `auditChain` 字段
  - `.gitignore` 增 `audit.tip.json`/`audit-chain.key`（密封密钥永不入库）
- 证据：新增 10 用例 `test_v03_audit_security.py`——正常链过；尾截断/整链重写（自洽重算 hash）/伪造 seal/截断到空 全部构造时 fail-closed；撕裂尾行修复后 3 条完好；中部篡改 hash mismatch 拒绝。`py -3 -m pytest ml/data_pipeline/tests/` **46 passed**

### ML-012 — 无全局 token 成本预算代码闸（Low/Info）
- 修复（`provider.py`）：`ARK_TOTAL_TOKEN_BUDGET`（进程生命周期 prompt+completion 总额）——每次调用前 `_budget_check()` 拒绝发网络请求（抛 `TokenBudgetExceeded`，不可重试），成功调用后 `_budget_account()` 累计（线程锁）；orchestrator producer 每轮检查 `budget_exhausted()` 停止喂新 spec 并记 `budget_exhausted` 审计事件（run 可恢复地结束，链完整）；未设置=旧行为（流程约束）
- 证据：`test_token_budget_gate`（100 预算 → 60+30 未尽 → 再 60 超限 → check 必抛；unset reload 后 unlimited）

### ML-001 — v0.3 运行时依赖不在 requirements（Medium，VERIFIED-static）
- 修复：`ml/requirements.txt` 增 `openai`、`datasketch`（注释标 ML-001）；`ml/requirements-lock.txt` 追加 pinned 集 `openai==2.21.0`、`datasketch==2.0.0` 及其未锁定依赖 `distro==1.9.0`/`jiter==0.13.0`/`pydantic==2.11.3`/`sniffio==1.3.1`（与已锁 anyio/httpx/tqdm/typing-extensions 闭包，版本=本机实测安装）
- 证据：`py -3 -c "import openai, datasketch"` 实测 2.21.0/2.0.0；闭包比对 openai requires vs lock

### ML-002 残余 — 数值 env 无校验可配出无界并发（Low）
- 修复（`config.py`）：`_env_bounded_int(name, default, lo, hi)`——非整数硬错 SystemExit(2)，越界 clamp+警告；四个并发 env 全部上界（GENERATOR 64 / REVIEWER 96 / ADJUDICATOR 64 / MAX_INFLIGHT 128）。（值含 `=` 截断子项经复核不成立：解析本就 `split("=",1)`）
- 证据：`test_env_bounded_int_clamps_and_rejects`（默认/合法/clamp 高低/非法串）

### ML-007 — 两处硬编码机器路径（Low）
- 修复：`monitor_run.py` `V03` 从 `Path(__file__)` 派生；`usage_logger.py` `_PROJECT_ROOT` 同样派生（原 `X:\repos\Networksafe` 字面量）
- 证据：pytest 导入隐式编译；路径派生 `parents[2]`/`parents[3]` 与目录层级核对

### ML-008 — fetch_public_sources cachePath 无 containment（Low，SUSPECTED）
- 修复（`fetch_public_sources.py`）：新增 `ensure_within(base, candidate)`——resolve+`base + sep` 前缀比对（`cache-evil` 兄弟目录不可前缀绕过，AGENTS.md §1 自家规范）；`fetch_sources` 在任何 I/O 前对每个 `cachePath` 调用
- 证据：`test_containment_accepts_inside_and_rejects_escape`（内含过；`../escape` 拒；兄弟 `cache-evil` 拒）

### ML-010 — schema query 双形态失配 + 值类型静默无界（Medium，VERIFIED-static）
- 修复：
  - `ml/schemas/detection-input.schema.json`：`query.additionalProperties` 从平铺 `type:[string,number,boolean]+maxLength`（maxLength 对非 string 静默失效）改 `anyOf`（string 带 8192 上限，number/boolean 明确无字符串约束）+$comment 说明 v0.2 string 形态由校验层感知、对新数据 fail-closed
  - `common.py validate_input`：`query` 改双形态校验——string（legacy ≤8192）或 object（≤100 键、键 str、值 string≤8192/number/boolean、bool 先于 int 判定）；原实现把 v0.3 object 记录一律 `query_invalid` 拒掉
- 证据：pytest 46/46（含 test_v03_deterministic.py 的 query object/string 用例）

### ML-011 — accountPrivilege/assetType 无 enum 与 planner 枚举失配（Low）
- 决策（记录为设计澄清而非失配修复）：schema 保持 free-form + 长度上限——backend 运行时（security-detection-engine.ts）会把 live-context 值 truncate 到 80/120（若加 enum，运行时截断即违约）；planner 的 `_ACCOUNT_PRIV`/`_ASSET_TYPES` 闭集是生成侧不变量非跨契约约束。schema 加 `$comment` 固化该决策
- 证据：backend `schema-parity.test.ts` 字段清单含此二字段（free-form），两端一致

### 附带 — pytest 收集 bug
- `test_public_sources.py` 顶层 `test_config(root: Path)` 签名被 pytest 误当测试函数（`fixture 'root' not found` ERROR）——改名 `make_config`，套件恢复 5/5

### ML-003 / ML-GOV-2 — 保持现状（记录）
- ML-003（usage_logger 写活动 SQLite DB）：env 门控默认关、仅 INSERT 隔离命名空间、fail-open——用户显式接受的成本追踪设计；风险已在文件头 SAFETY 块完整文档化
- ML-GOV-2（sealed 目录 untracked `_validate-summary.json`）：维持 untracked、永不提交

## 验证总账（Batch 6）
- `py -3 -m pytest ml/data_pipeline/tests/`：**46 passed**（test_pipeline 26 + public_sources 5 + v03_deterministic 5 + 新 v03_audit_security 10）
- 既有 v0.3 工作流零破坏：deterministic/reviewer 用例无回归
- 密封路径零接触：仅改 `ml/data_pipeline/**` 源码 + `ml/schemas/detection-input.schema.json`（DO_NOT_READ 清单外）

## 未修复项（后续批次）
- ML-005（specHash 无 key——生成侧防篡改锚，需与 audit-chain.key 统一密钥管理设计）、ML-009（v0.2 脱敏 regex 键形不全——历史产物兜底）
- ML-GOV-1（密封集入库——治理决策：移出仓库需 owner 拍板密封性 vs 可用性）
- DP-001 运维跟进：FTP 凭证轮换 + git 历史清洗（BFG/filter-repo）+ secret-scan guard
- DP-008/013/015（floating tag pin、容器 USER、installer-agent systemd 加固）
- FW-002/005（M1/M2 真实对接联调；challenge 环形窗口设计权衡）
- AG-X01（部署态无入站命令通道——架构项）
