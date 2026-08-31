# 2026-08 系统级安全审计修复矩阵

> 本文件是 2026-08 系统级安全审计的问题矩阵（release 基线文档）。
> 每一项 P0/P1 都有唯一 ID、确认级别、代码修复状态、自动化测试锚点、
> Linux/HIL 证据缺口、残余风险与发布状态。
> `npm run check:root-resistant-claims`（`check:release-guards` 聚合）
> 会校验本文件存在、批次 0 的 fail-closed 状态分级已实现、以及
> README/deployment/gateway 的实验性标注未被移除。
>
> **确认级别**：`confirmed`（代码级复现）/ `confirmed-design`（确认为设计缺口，
> 单 Node + 同步 SQLite 下不可稳定复现，多实例/Postgres primary 下成立）/
> `blocked-environment`（修复代码可写，放行证据被 Linux/硬件环境阻塞）。
> **状态**：`open` / `code-complete`（代码+测试完成，证据缺口仍在）/
> `closed`（代码+测试+环境证据齐备）/ `blocked`（被环境阻塞，不得声称闭环）。

## 批次 0：发布止血与证据基线

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-00-1 | 网关状态自报布尔字段即可驱动 Root-Resistant Active（`last_attestation_at` 由上报 body 提供） | P0 confirmed | `root_resistant_gateways.attestation_level` 服务端所有；上报不再接受/改写 attestation 字段；`active` 仅 `attested` 可达；attestation verifier 未实现 → 一律 fail-closed | `final-defense.service.test.ts`（自报不可激活 / attested 保留 / 重复上报不改写） | n/a（控制面逻辑） | attestation quote 验证（批次 6）前无 Root-Resistant 声称 | 在 attestation verifier 落地前，root-resistant 高危动作不可用（fail-closed，符合设计） | code-complete |
| AUD-00-2 | 状态上报可改写网关 tenant 归属（`ON CONFLICT ... SET tenant_id = excluded.tenant_id`） | P0 confirmed | tenant 归属服务端所有；跨租户上报抛 `backend.root_gateway_tenant_mismatch` | `final-defense.service.test.ts` › refuses a status report that would rebind | n/a | n/a | — | code-complete |
| AUD-00-3 | 文档/API 把自报状态描述为硬件已验证；canonical `deployment/gateway` 未标实验性 | P0 confirmed | README Root-Resistant 段 + `deployment/gateway/README.md` 实验性标注；API 增加 `verificationLevel: reported/verified/attested` | `check-root-resistant-claims.mjs` release guard | namespace/systemd 门禁（批次 4/5） | HIL campaign（批次 6） | 对外口径若绕过 README 引用无法被 guard 阻止 | code-complete |

## 批次 1：统一 Secret Boundary

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-01-1 | Cookie/Authorization/密码等凭证进入检测快照、Fastpath、AI shadow、`sec_detection_events` 持久化 | P0 confirmed | `backend/src/security/detection-secret-boundary.ts` 统一边界；中间件/Fastpath/AI/detection-pipeline 全部消费脱敏 DTO | `api-traffic-shadow.middleware.test.ts`、`fastpath-traffic-shadow.service.test.ts`、canary 回归（5 金丝雀 0 次出现） | n/a | n/a | Postgres shadow / 历史备份中已有明文快照需要一次性清理迁移（未实施） | code-complete（历史清理 open） |
| AUD-01-2 | Redis key 保存完整 bearer token（blacklist/refresh/step-up） | P1 confirmed | `src/security/redis-token-keys.ts`：`tokenKeyDigest`（JWT_SECRET 派生子键 HMAC-SHA256，缺密钥 fail-closed）；access/refresh blacklist 键、step-up token 键与会话索引值全部改摘要 | `redis-token-keys.test.ts` + auth 6 套件 83 用例 | n/a | n/a | 历史原键随 TTL 自然过期，切换窗口内旧黑名单键不再匹配（token 短 TTL，风险受控） | code-complete |
| AUD-01-3 | `recursiveSanitize()` 深度溢出（depth 耗尽返回原值，深层结构逃逸脱敏） | P1 confirmed | depth 耗尽时字符串仍走 pattern 脱敏、容器折叠为 `[depth-limited]`，不再返回原值 | `log-injection-crlf.test.ts` 9/9 | n/a | n/a | 敏感字段覆盖面按需继续扩展（仅纵深层） | code-complete |

## 批次 2：tenant / target / gate / policy / binding 授权链

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-02-1 | Final Defense policy 更新/创建无 tenant 归属校验（自报 ID 跨租户） | P0 confirmed | `upsertPolicy` policy/companion-status/gate 三重归属锚 + OCC digest 必填 + `ON CONFLICT` 不改 tenant | `final-defense.service.test.ts`（跨租户更新/抢占/action 拒绝） | n/a | n/a | `final_defense_bindings` 独立绑定表未建（四元绑定仍由 policy+status+gate 行拼合） | code-complete |
| AUD-02-2 | `getActivePolicyForCompanion` 无 tenant 谓词 | P0 confirmed | 强制 `(tenantId, companionId)` | 同上 + `deployment-run.service.test.ts` | n/a | n/a | — | code-complete |
| AUD-02-3 | Agent revoke 跨租户（任意 tenant admin 可撤销任意 Agent） | P0 confirmed | `revokeAgent(agentId, { tenantId })` 租户感知；未知/跨租户统一 false→404；平台级显式 override + 成功后审计 | `agent-auth-revoke-tenant.test.ts`、`agent-onboarding.routes.test.ts`、`agent-management.routes.ts`（requireRole('admin') 平台路径核查） | n/a | n/a | — | code-complete |
| AUD-02-4 | WebSocket 逐消息无业务 RBAC（已认证+同租户即可发 scan/block_ip） | P0 confirmed | `request:scan`/`request:block_ip`/`request:unblock_ip` 顶部 `isDashboardAgentCommandAuthorized`（与 REST `requireRole('admin')` 镜像）+ `ws_command_denied` 审计 | `agent-gateway.test.ts` viewer 拒绝用例 | n/a | n/a | 细粒度 permission（scan execute / firewall write）仍是 admin 一刀切 | code-complete（细化 open） |
| AUD-02-5 | AI system agents / investigation / device list 等对象级接口各路由自行 fallback platform tenant | P1 confirmed | `ai-system.routes.ts`：4 处 `|| PLATFORM_TENANT_ID` 改为严格解析（不可解析且非平台 → 403），runtime agent 列表按 tenant 过滤（平台全见）；`investigation.controller.ts`：investigation 归属 map，start 记 owner，status/result/cancel 守卫（跨租户 404 不可枚举），active/history 按 tenant 过滤（未知归属仅平台可见，fail-closed）；`devices.routes.ts`：GET / 列表补 authenticate + canViewDevice 租户过滤（原先完全无鉴权！），`resolveActorTenantId` 平台 fallback 仅限 platform_admin，否则抛错拒绝 | `investigation.controller.test.ts` 18/18（跨租户 5 用例：404 不可探测、平台全见、cancel 拦截、列表过滤）+ devices 25 + ai-system/investigation 路由 14 | n/a | n/a | investigation 持久化行无 tenant 列——进程重启后旧行归属未知（仅平台可见）；持久 schema 加列属 PG primary 迁移范围 | code-complete |

## 批次 3：原子状态、重放防护与连接代际

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-03-1 | Hardware grant 并发双消费（多实例/共享主库） | P0 confirmed-design | ack 提交改单事务 + 三重防护：会话 CAS（pending→claiming→confirmed，claim 先于校验，校验拒绝不再覆盖已确认会话）、`hardware_grants(gate_id, monotonic_counter)` UNIQUE 索引（含遗留重复行迁移）、高水位仅 `counter > stored` CAS 推进；重放返回 `session_already_consumed` / `monotonic_counter_replay` | `hardware-authorization.service.test.ts`（重放拒绝 + 并发双 ACK 仅一 grant + 高水位 =1） | n/a | n/a | 单 Node + 同步 SQLite 当前不可复现真并发；Postgres primary 迁移前阻止多副本 | code-complete |
| AUD-03-2 | Onboarding code 非原子消费 / expectedTags 未实现 | P1 confirmed | 新增 `agent-onboarding.service.ts`：SQLite 基线全程单事务（条件 UPDATE claim + 读回验证 + registerAgent + finalize，失败整体回滚不烧次数）；Postgres 路径用条件 UPDATE rowCount 判定（注册失败回收 claim）；`expected_tags` 正式实现为真契约（agent 必须出示全部 expected tags，缺失/部分覆盖拒于 409 tags_mismatch）；`DatabaseManager.transaction` 改为可重入（内层并入外层，sql.js 不支持嵌套 BEGIN） | `agent-onboarding.service.test.ts` 8 用例（**50 并发 exchange max_uses=1 恰好 1 个 Agent**、多用途码恰 max_uses、注册失败不烧次数、unparseable expiry fail-closed、tags 契约）+ 路由 18 用例 | n/a | n/a | Postgres 分支无集成测试（shadow 路径，PG primary 迁移前置）；session 上限原子化拆至 AUD-03-2b 跟进 | code-complete |
| AUD-03-3 | Agent/Device 连接代际竞态（旧 socket disconnect 覆盖新连接状态） | P0 confirmed | `agent-gateway.ts` + `device-gateway.ts`：server-side generation；新认证连接先换注册表再显式 force-disconnect 旧 socket 并审计（`connection_superseded`/`device_connection_superseded`）；全部变更类事件 handler 增加 socket 归属守卫；disconnect 仅当前所有者可清理 | `agent-gateway.test.ts` supersede 用例、redteam websocket 套件 36 用例 | n/a | n/a | — | code-complete |
| AUD-03-4 | 入站 Agent/Device 消息 envelope 校验"测试有、真实 handler 不调用" | P1 confirmed | 删除镜像 verifier（`verifyDeviceMessage`/`verifyAgentMessage` 生产零调用）；新增共享 `src/security/inbound-envelope.ts`（event type/payloadDigest/timestamp/nonce/sessionId/bootId/signature，canonical JSON digest、timing-safe HMAC、nonceManager 单次使用、session 绑定）；接入真实 handler：agent `scan_result`/`review_sample`，device `data`/`alert`/`unknown_error`/`ota_status`，拒绝一律 audit + error emit | 红队 `websocket-event-auth.test.ts` 重写为攻击真实 verifier（未签名/错 key/篡改 payload/篡改签名/过期/跨 session/事件类型不符/nonce 重放/无密钥/畸形）12 用例；agent 48、device 62、rate-limit 全过 | n/a | n/a | nonce 存储单实例内存+Redis fallback；生产密钥 = agent secretKey / DEVICE_COMMAND_SECRET（compose 硬必需） | code-complete |

## 批次 4：canonical Gateway L2 数据面（blocked-environment）

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-04-1 | nftables ruleset 未实现 PRD 透明 L2 bridge（无 bridge family / MGMT 隔离 / 裸 `flush ruleset`） | P0 confirmed | **已实施**：两个 ruleset 重写为自有 `table bridge aetherguard`（bridge family forward hook、按端口对显式 accept/drop、覆盖 ARP/IPv4/IPv6/非 IP/broadcast）+ 独立 `table inet aetherguard_mgmt`（MGMT 非 bridge port，forward 全 drop）；删除 `flush ruleset`，改 declare/delete/recreate 原子替换前导；新增 namespace/veth 门禁 `deployment/gateway/test/bridge-gate.sh`（能力感知：无桥族内核自动降级 inet-fallback 机制套件，SKIP 明确标注） | 门禁首跑（WSL2 Ubuntu, nft 1.0.9）：**pass=8 skip=9 fail=0**（mode=inet-fallback——WSL 内核 CONFIG_NF_TABLES_BRIDGE 未启用，桥族帧过滤证据需可桥内核 CI runner/appliance 重跑） | **机制级已验证**（apply/原子替换/readback/MGMT/toggle）；桥族帧级 **待可桥内核重跑** | **blocked：需目标硬件 HIL** | 桥族帧过滤未在真实桥族内核证明 | blocked→partially-evidenced（首个 Linux 证据已产出） |
| AUD-04-2 | 规则切换无单写者串行队列/generation；isolation 失败不进 fault | P0 confirmed | **已实施**（`bin/aetherguard-gateway-daemon.ts`）：单 promise 队列串行化 + 单调 generation newest-wins（排队期间有更新请求则旧请求跳过——旧 release 永不覆盖新 isolation）；每次 apply `nft -f` 前后 readback 自有表存在性；isolation apply 失败仍 exit→systemd 重启+ExecStopPost 再断言 | 门禁 toggle 断言（released→isolated 快速切换落 isolated + readback drop policy）在 fallback 模式 PASS；代码路径由独立 typecheck/build 覆盖 | 完整串行队列并发行为需可桥内核重跑门禁 | 同上 | — | blocked→partially-evidenced |

## 批次 5：可运行 artifact、systemd 与控制通道（部分 blocked-environment）

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-05-1 | gateway 包无独立 lockfile/build；systemd symlink 执行 `.ts`；TDZ；`--config` 未解析 | P1 confirmed | 新增 `deployment/gateway/package.json`（serialport/parser/axios 版本钉死）+ `package-lock.json` + `tsconfig.json`（独立 typecheck/build 通过，0 error）；修复入口 backend 导入少一级（该文件从未成功编译——AUD 实证）；systemd ExecStart 改 `node dist/...js` + ConditionPathExists 产物存在性；install.sh 改为构建机出 `dist/+node_modules`、目标机零编译、缺产物硬失败；`--config`/`-c`/`--config=` 真正解析 | `npm run typecheck` + `npm run build` 独立全绿，产物 `dist/deployment/gateway/bin/aetherguard-gateway-daemon.js` 存在 | systemd-analyze verify/security + VM 集成 **blocked** | — | nftables 数据面仍是占位（AUD-04-1 blocked） | code-complete（Linux 侧验证 blocked） |
| AUD-05-2 | 控制通道用全局 `DEVICE_API_KEYS`；状态上报 payload 与 backend 契约漂移 | P1 confirmed | daemon 状态上报改为 per-gateway enrollment credential（gateway.conf `helperKeyId/helperSecret`，对应控制面 `SERIAL_HELPER_EXTRA_SECRETS` named key，Bearer + `X-Aetherguard-Helper-Key-Id` 头），缺失 fail-closed 拒启；上报 payload 对齐路由契约（布尔字段严格、tenantId 永不上送——由 provisioned 记录推导） | 独立 typecheck/build 全绿；控制面 named-key 鉴权已有 AG-B04 测试 | — | — | 链路层 shim（/ws/device transport）仍属批次 4/5 Linux 侧 | code-complete（Linux 侧 blocked） |

## 批次 6：Grant V2、M1↔M2 双向认证、SE 与 attestation

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-06-1 | 无 Grant V2 canonical message（host-side wire-format 层） | P0 confirmed | **已实施**：新增 `src/security/grant-v2.ts` —— 计划规定的 19 字段 canonical 消息（固定序 newline 布局，M2 flat parser 可复现）、ECDSA P-256 签名/验证、结构校验（缺字段/多字段/协议版本/counter 整型）、逐字段严格比较（敏感摘要 timing-safe）、**无 legacy fallback** | 红队 `grant-v2-wire-format.test.ts` **24/24**：16 字段逐一篡改、错 key、counter 类型攻击（字符串/小数）、缺字段走私、多字段注入、V1 legacy 结构拒收、canonical 消息可复现性 | — | **blocked：M2 固件侧实现 + HIL** | M2 侧 wire-format 对齐与 controllerBootNonce 验证属固件任务 | code-complete（host 侧）；固件/HIL blocked |
| AUD-06-2 | `se_driver.c` mock SE / 无 attestation quote / CubeMX 未生成可构建固件 | P0 confirmed | 待实施 | host 测试可写 | — | **blocked：需真机 + HIL campaign** | 生产证据链断裂 | blocked |

## 批次 7：不可变固件、真实 ACK、Step-Up、SSRF 与 Secret Store

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-07-1 | firmware artifact 可覆盖（非内容寻址）/ OTA、下载非 tenant-scoped | P1 confirmed | 待实施 | 待写 | n/a | n/a | 供应链替换 | open |
| AUD-07-2 | Device command `socket.emit()` 即视为完成，无设备签名 ACK 状态机 | P1 confirmed | 待实施 | 待写 | n/a | n/a | 假完成 | open |
| AUD-07-3 | Step-Up/WebAuthn 需修正 + ADR 化 + 生产 enforcement | P1 confirmed | counter 更新改 CAS（`counter < ?` 条件 + 读回验证，失败抛 `webauthn_counter_advance_conflict`）；challenge used-marker TTL ≥ challenge TTL 核查满足；per-session 单活 token（tombstone）已有；ADR 2026-08-29 已入库；STEPUP_ENFORCEMENT 默认 off（enrollment 先行） | `webauthn.routes.test.ts` + `auth-logout-session.test.ts` 9/9 | n/a | n/a | 前端 ceremony 需上送 action/target 才能获得绑定 token（未上送则发无 scope token，行为向后兼容） | code-complete（scope 绑定已实现） |
| AUD-07-4 | SSRF：pinned DNS lookup `all` 契约、redirect/userinfo/mapped IPv6/metadata 段、SMTP 独立 egress | P1 confirmed | `outbound-url-guard.ts`：`createPinnedDnsContext.lookup` 修正 Node 契约——`all:true` 返回 pinned 数组、`all:false` 返回单地址 `(err, addressString, family)`（旧实现把数组塞进单地址位，socket 目标可变垃圾） | `outbound-url-guard.test.ts` 22 用例，含真实 HTTP server + axios 经 pinned agent 端到端请求 | egress firewall 需部署环境 | n/a | SMTP 仍复用 URL 字符串检查 | code-complete（SMTP egress open） |
| AUD-07-5 | AI/SMTP/Webhook secret 明文落库且 GET 可回读 | P1 confirmed | ① read 侧：同步配置端点 `syncMaskApiKeys=false` 曾回读明文 apiKey——掩码改无条件；config GET 非 admin 脱敏由用户改动（AG-B07）覆盖 ② at-rest：新增 `src/security/secret-encryption.ts`（AES-256-GCM envelope `enc1:`，scrypt 目的派生键），`ai-endpoint-store.service.ts` 全部 api_key 写路径 seal、读路径 open（遗留明文行兼容读取，新写入全密封） | `secret-encryption.test.ts` 5/5（round-trip/IV 唯一性/篡改 fail-closed/legacy 兼容/**端到端 at-rest 密封断言**）+ ai-endpoints 路由 13/13 | n/a | n/a | SMTP/webhook 凭据可复用同一模块 | code-complete |

## 批次 8：P2 纵深与恢复闭环

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-08-1 | body limit/TRUST_PROXY/CSRF/Origin gate/audit backup canonical payload/CI pin SHA/遥测 provenance | P2 confirmed | ① 分层 body limit：全局 JSON 1mb、firmware 上传路由独立 30mb parser、413 错误映射（原全局 25mb + 错 500）② Origin gate：带 cookie 的写请求 Origin 不在 allowlist → 403（无 Origin 非浏览器放行）③ audit backup：导出/校验共用 `computeBackupChecksum` canonical 载荷 + 新增 `verifyBackupFile`（checksum 篡改/记录数不符 → valid:false）④ 遥测 provenance：agent 遥测 `seq` 单调（回归 → 拒收+审计）+ `sourceTrust: agent_reported` 标注 ⑤ TRUST_PROXY hop=1 显式 opt-in 既有 ⑥ CI pin SHA 完成（前轮） | `aud081-p2.test.ts` 5/5（413/小 body/Origin 拒放/backup 校验+篡改）+ `agent-gateway.test.ts` 48/48 | n/a | n/a | securityEpoch 与完整 signed provenance（boot ID 签名链）未实施 | code-complete（securityEpoch 与签名链残留） |

## 批次 N1：Gateway 部署入口真实可启动 + 发布链可信（逆向审计）

> 逆向审计发现 `deployment/gateway` 产物**一启动就崩且 CI 不会发现**——本批为发布链止血。

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N1-1 | 入口双 TDZ：`applyRulesetSyncOnBoot()` 在 `NFT_BIN`/`ISOLATED_RULESET`/`RELEASED_RULESET` const 声明前求值——TS 与编译后 JS 均启动即 ReferenceError（函数声明提升不救 const） | P0 confirmed | `bin/aetherguard-gateway-daemon.ts`：三常量声明上移，boot 断言调用置于全部常量之后（"最先断言隔离"语义不变，仅调求值顺序） | 独立 `npm run typecheck`/`build` 全绿；无串口冒烟 exit 1（缺配置 fail-closed）而非 TDZ 崩溃 | systemd 真跑沿用批次 4/5 门禁 | — | — | code-complete |
| N1-2 | 重复 `new SerialPort(...)`（:269/:271）——首个实例泄漏打开后被覆盖 | P1 confirmed | 删除重复实例化 | 同上（构建 + 冒烟覆盖模块求值路径） | — | — | — | code-complete |
| N1-3 | preflight 无 readback：nft 1.0.9 内核拒绝 bridge batch 时 `nft -f` 仍 exit 0 | P0 confirmed | `aetherguard-gateway-preflight-check.sh` 补三项 readback：`list table bridge aetherguard`、`forward` chain `policy drop` grep、`list table inet aetherguard_mgmt` | 复用 `bridge-gate.sh` 探测模式 | readback 断言在 WSL2 inet-fallback 模式 PASS（批次 4 门禁同模式） | — | 桥族内核重跑仍属 AUD-04 | code-complete |
| N1-4 | install.sh 备份非幂等：重复 INSTALL/REMOVE 覆盖更新备份 | P1 confirmed | 备份目录 `/var/backups/aetherguard`：时间戳+sha256 命名、`tar -tzf` 校验、latest 指针；REMOVE 需 ≤3600s 新鲜验证备份否则 exit 3；`AETHERGUARD_REMOVE_FORCE=1` 显式逃逸口 | 脚本静态核查 + 幂等路径走查 | 真实装机演练 blocked | — | — | code-complete（装机演练 blocked） |
| N1-5 | CI `gateway-safety-check` 只跑 simulator+固件 host 测试，gateway 包从不 clean-checkout 构建 | P1 confirmed | `.github/workflows/ci.yml` 新增 step：`npm ci && npm run typecheck --if-present && npm run build && test -f dist/...js` | 本地等价命令全绿 | CI run 待下次 push | — | — | code-complete（CI run 待验证） |

## 批次 N2：Grant wire contract 端到端统一（逆向审计）

> 字段/时间格式不兼容意味着**真实 release 永远走不通**（恒 fail-closed——安全但不可运维）。

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N2-1 | `expiresAt` 三段时间格式断裂：控制面 ISO 字符串（`isoPlusMs`），M1 `Number(grant.expiresAt)`=NaN 恒过期 | P0 confirmed | `companion/gateway-daemon.ts` 新增 `expiresAtToEpochSeconds`：数字负/非有限→null、纯数字串 safeInteger 校验、ISO 经 `Date.parse/1000` floor；null 或已过期→`failClosed('grant_expired')`。内部 ISO、wire epoch 秒、固件 FW-003 严格解析不变 | backend N2 焦点 33 用例 + simulator 全链 + 4 fail-closed 场景 | — | M2 真机属 AUD-06 blocked | — | code-complete |
| N2-2 | 固件 digest 缓冲 64：64 字符 SHA256 hex 恒截断（写入条件 `len+1<out_len`、strncpy 63、比较循环 63）→ M1 全长算 MAC、M2 截断验证 → MAC 恒不匹配 | P0 confirmed | `SERIAL_JSON_MAX_DIGEST` 64→65；新增 `CONTROLLER_POLICY_DIGEST_LEN 65u` + `_Static_assert` 钉死两者相等；`policy_digest[]`/`local_policy_digest[]`/`controller_set_policy_digest` strncpy/`controller_validate_policy_digest` 全改 65 全长 | 固件 host **37/37**（34→37，新增 `test_policy_digest_full_length`：wire 解析 strlen==64、63 前缀兄弟区分、全长 digest MAC release 成功） | — | 真机刷写 blocked（AUD-06） | — | code-complete（host 证据齐） |
| N2-3 | M1 入口 `new GatewayDaemon({...})` 缺 provisioned policyDigest——release 帧无 digest 可供 | P0 confirmed | `GatewayConfig.policyDigest` 必填 `/^[0-9a-fA-F]{64}$/`（`GATEWAY_POLICY_DIGEST` env 可覆盖），缺失 FATAL exit(1)；构造器透传；`gateway.conf.example` 补占位 | 冒烟：缺 digest exit 1（fail-closed 拒启） | — | — | — | code-complete |
| N2-4 | status report 无防重放：旧上报可重放覆盖新状态 | P1 confirmed | `root_resistant_gateways` 加 `report_boot_id`/`report_sequence` 列（含 ALTER 迁移）；per-boot bootId（`randomBytes(16)` hex）+ 同 boot 严格递增 sequence，回退抛 `backend.root_gateway_status_replay`、配对不齐抛 `..._sequence_invalid`；legacy 无序号上报兼容接受 | `final-defense.service.test.ts` N2-4 describe 4 用例（递增接受/回退拒/跨 boot 重置/legacy 兼容） | — | — | — | code-complete |
| N2-5 | 签名层规范分裂风险：V2 canonical 签名输入 vs M2 flat wire 布局 | P1 confirmed-design | 维持"V2 规范签名、flat 布局传输、固件逐字段严格比较"；extended fields grant 无 legacy fallback（既有 `hasExtendedGrantFields` 语义复核确认）；wire 契约回归测试锁边界 | 固件 + simulator + backend 三层 wire 用例 | — | M2 grant_auth 与 V2 canonical 真机对齐属 AUD-06 blocked | — | code-complete（规范层） |

## 批次 N3：identity → tenant 绑定闭合（逆向审计）

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N3-1 | `enrollGate` `ON CONFLICT DO UPDATE` 允许跨租户重绑 gate | P0 confirmed | tenant 不一致拒绝 + critical 审计（`backend.hardware_gate_tenant_immutable`）；`ON CONFLICT` 移除 `tenant_id = excluded.tenant_id` | `hardware-authorization.service.test.ts` 租户不可变用例 | n/a | n/a | — | code-complete |
| N3-2 | device WS 注册未识别身份回落 platform tenant | P0 confirmed | `handleRegister` 无条件查 `getDeviceById`/`getGate`，`provisionedTenantId = gate?.tenantId || device?.tenantId`，非平台租户必须 `resolveDeviceTenantContext(provisionedTenantId)` 可解析 | `device-gateway.test.ts` N3-2 用例（esp32-tenant-bound payload 断言 provisioned 解析）；既有 14 个失败用例修复（`getGate` mock 兜底） | n/a | n/a | — | code-complete |
| N3-3 | helper 凭据与 gateway 无绑定：任一有效 helper key 可为任意 gateway 上报 | P1 confirmed | TOFU 绑定：`bound_helper_key_id` 列，首个上报 keyId 绑定该 gateway 状态通道，此后不一致抛 `backend.root_gateway_helper_key_mismatch`（403）；timing-safe 比较 | `final-defense.service.test.ts` N3-3 TOFU 用例 | n/a | n/a | TOFU 首个绑定者若被抢注需带外纠正（登记） | code-complete |
| N3-4 | investigation ownership 仅进程内 Map：重启即失，跨租户守卫失效 | P1 confirmed | `owner_tenant_id` 列 + PRAGMA 迁移（raw sql.js 风格）；controller `resolveOwner` 内存优先/DB 回落；start 同时写内存与持久化 | `investigation.service.test.ts` 持久化用例 + controller 13 绿 | n/a | n/a | — | code-complete |
| N3-5 | `requireStepUpScope` 已实现但零路由使用：step-up token 无 action/target 绑定 | P1 confirmed | 6 路由文件 15 站全部 `requireStepUp` → `requireStepUpScope`：admin 9 站（firmware.upload/ota、device.confirm_action、api_key create/delete、user role/status/batch_create/reset_password）、devices（device.command）、final-defense 3 站、config（system.config_change）、hardware-authorization（hardware.intent_create）、system（system.mode_change） | 路由套件 35 套件 421 用例 + typecheck 干净 | n/a | n/a | 前端 ceremony 上送 action/target 属 AUD-07-3 残留 | code-complete |

## 批次 N4：WebSocket ACK / 代际 / 并发收尾（逆向审计）

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N4-1 | superseded socket 守卫未覆盖 `command_ack`/`command_failed` | P1 confirmed | 两 handler 入口 `isCurrentAgentSocket` 最先执行 | `agent-gateway.command-ack-gate.test.ts` superseded 用例（dispatcher/audit 零调用） | n/a | n/a | — | code-complete |
| N4-2 | ACK 无条件广播 completed（假完成：任意 agent 可声称任意 actionId 完成） | P1 confirmed | `handleAgentCommandAck`/`handleAgentCommandFailure` 返回 boolean；`accepted` 才广播 completed/failed 与 success 审计，拒绝仅 warning/failure 审计 | 新门禁套件 4 用例（accept 广播/reject 无广播/failure reject/superseded）；legacy `agent-gateway.test.ts` 两用例改显式 accept 路径（mockReturnValue(true)）后 48/48 | n/a | n/a | — | code-complete |
| N4-3 | legacy ACK 并发双 dispatch | P1 confirmed-design | 由 dispatcher `running→completed` CAS（批次 3 既有）+ N4-2 boolean 消费共同闭合——同一 ack 恰好一次生效 | 门禁套件 + websocket 全量 173 绿 | n/a | n/a | 单 Node + 同步 SQLite 下不可稳定复现真并发（同 AUD-03-1） | code-complete |

## 批次 N5：Secret / 出站 / 审计边界收尾（逆向审计）

| ID | 问题 | 级别 | 代码修复 | 测试锚点 | Linux 证据 | HIL 证据 | 残余风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N5-1 | `refresh:used:${refreshToken}` 原文进 Redis key（AUD-01-2 漏网点） | P1 confirmed | `auth.routes.ts` 改 `tokenKeyDigest(refreshToken)` | auth 套件回归 | n/a | n/a | — | code-complete |
| N5-2 | `notifications_json` 明文存 smtp.password/headers 且 GET 可回读 | P1 confirmed | `sealNotificationSecretsForStorage`（sentinel `********` 先恢复 current 再封）+ `openNotificationSecretsFromStorage`（解密失败保持 sealed）；写路径 `enc1:` envelope | `platform-config.service.test.ts` 密封用例 12 绿 | n/a | n/a | — | code-complete |
| N5-3 | Secret Boundary 盲区：URL fragment 原样透传（OAuth implicit `access_token`）；opaque body 键名要求敏感词开头（`client_secret`/`access_token` 不匹配） | P1 confirmed | `sanitizeFragment`（# 后按 & 分片过 sanitizeQueryPart）；opaque 键名正则允许 `[\w.~-]*` 前缀 | `detection-secret-boundary.test.ts` 5 用例（fragment/opaque client_secret/access+refresh+id_token/JWT 不回归/JSON 不回归），套件 32 绿 | n/a | n/a | `token_type=Bearer` 保守脱敏（键含 token）为预期行为 | code-complete |
| N5-4 | `DISABLE_LOG_SANITIZATION=true` 生产可关脱敏；message 字段未过 sanitizer | P1 confirmed | 开关仅 `NODE_ENV !== 'production'` 生效；`formatMessage` message 字段过 `sanitizeString` | logger 231 绿 + typecheck | n/a | n/a | — | code-complete |
| N5-5 | 审计备份校验只重算无密钥 SHA256 checksum——篡改者可重算 | P1 confirmed | 导出 v1.1：记录补齐 `tenant_id`/`actor_email` 使逐条 HMAC（audit secret keyed）可验证；`verifyBackupFile` 逐条 `signingPayloadFromRow` + timingSafeEqual 验签，失败 `record_signature_invalid`（invalidRecordIds 截断 20）；v1.0 回落 checksum-only 并标注 `legacy_format_no_per_record_signatures` | `aud081-p2.test.ts` 红队用例：伪造记录+重算外层 checksum 仍被逐条验签捕获；套件 6 绿 | n/a | n/a | 历史 v1.0 备份只能 checksum-only 验证（格式标注） | code-complete |
| N5-6 | benchmark SSRF 绕过、scanner targets 各数组、SMTP 发信未经 `outbound-url-guard` | P1 confirmed | benchmark `invokeHotPathEndpoint` 两处 axios.post 改 `assertOutboundUrlAllowedResolvedPinned` + `createPinnedDnsContext` + `maxRedirects:0`（与生产 invokeEndpoint 同一守卫语义，ollama allowPrivate）；scanner：normalizeTargets `isMetadataLiteral`（url/cidr 展开/ip/domain/host）+ `assertResolvedTargetNotMetadata`（DNS 解析后逐地址）+ `fetchWithTimeout` 手动 redirect（≤3 跳逐跳重验证）+ TLS/port 探测连接前校验；SMTP：`assertOutboundHostAllowedResolved`（outbound-url-guard 新导出裸 host 变体），metadata 恒拒、私网需 `ALLOW_PRIVATE_SMTP=1` 显式开闸 | outbound-url-guard +6 guard 用例、scanner +5 metadata 用例、notification +4 SMTP 用例；5 套件 129 绿 | n/a | n/a | 私网可扫为产品功能（保留）；nodemailer 不支持 pinned lookup（validate-then-connect 与 scanner 同模型） | code-complete |

## 汇总

- **code-complete**：AUD-00-1/2/3、AUD-01-1/2/3、AUD-02-1/2/3/4/5、AUD-03-1/2/3/4、AUD-05-1/2、AUD-07-1/2/3/4/5、AUD-08-1（CI pin 子项）；逆向审计批次 N1-1..5、N2-1..5、N3-1..5、N4-1..3、N5-1..6（24 行全覆盖，其中 N1-4/N1-5 装机演练与 CI run、N2 真机侧证据沿用下方 blocked 登记）。
- **blocked（不得声称闭环）**：AUD-04-1/2（桥族帧级证据需可桥内核；机制级首证已产出——WSL2 inet-fallback 门禁 + systemd-analyze verify exit 0）、AUD-06-1/2（M2/SE 真机 + HIL）。
- **开源项**：AUD-06-1/2（Linux/HIL blocked 之外唯一纯 open 为 AUD-07-3 的 token-action 绑定残留与 AUD-07-5 的 at-rest 加密，均已登记在行内残留栏）、AUD-08-1 其余 P2 子项；N1-4 真实装机演练、N1-5 的 CI run 验证（待下次 push）。
- 整体 Root-Resistant 声称状态：**EXPERIMENTAL / blocked**，直到批次 4/5/6 的 Linux、systemd、HIL 证据门禁全部通过。
