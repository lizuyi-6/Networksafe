# FINDINGS — AetherGuard 白盒安全审计（结构化清单）

> 状态机：SUSPECTED → EVIDENCE_FOUND → VERIFIED（代码全链路证实；动态验证者为 VERIFIED-dynamic）／ UNVERIFIED ／ REJECTED
> 来源标记：AG-*=主审计（backend 自查）；FE/RF/RS/FW/DP/ML-*=子代理模块审计（详证据见各报告）

## VERIFIED

### AG-B01 — 部署 bundle heredoc marker 注入 → 客户机 root RCE【VERIFIED-dynamic】
- CWE-94/CWE-78；Severity **High**（前提：admin/被劫持 admin 会话 = T7）；Confidence High
- 位置：`backend/src/api/routes/deployments.routes.ts:940`（/generate-bundle）、`:680`（/save 同样缺校验）、`renderSelfExtractingBundle`（heredoc 无转义）
- 数据流：admin POST profile.serverName（含 `\n__AETHERGUARD_BUNDLE_1__\n<payload>\n`）→ `validateProfile` 仅查非空/数字范围（**无 `inputValidator.validateRequest`，与 /generate:645 不一致**）→ renderNginx 插值 → bundle base64 返回/经 /save 持久化 → helper `resolveSerialRequest`（deployment-run.service.ts:704-755）原样下发 INSTALL 脚本 → 目标机 root 执行
- 动态 PoC：`security-audit/poc/deployments-bundle-injection.poc.test.ts`（2/2 passed，2026-07-31 运行）：
  - A) /generate-bundle 接受注入，解出的 .sh 中 payload 行紧跟提前终止的 heredoc marker 之后 = 顶级 shell 命令
  - B) 同载荷 /generate 被 InputValidator 400 拒 → 证明缺口是路由级
- 影响：部署管线 root 代码执行；checksum 基于同一注入内容，无法发现
- 修复：/generate-bundle、/save 补 `inputValidator.validateRequest`；serverName/upstream 白名单字符集（如 `[A-Za-z0-9.-]`）；bundle 渲染对内容 base64 化或校验 marker 不出现在内容行

### FW-001 — M2 STM32 固件不验 grant 签名（信任锚缺失）【VERIFIED-static】
- CWE-345/CWE-347；Severity **Critical**（产品核心声明失效）；Confidence High（子代理全量代码证据）
- 位置：`firmware/controller-stm32h5/Core/Src/controller_tasks.c:46-64`（消费明文字段）、`se_driver.c:30-56`（se_verify/se_sign = stub）、policyDigest 对硬编码占位符 `"policy-digest-baseline-v1"` strcmp（FW-010）
- 攻击链：UART 可达（M1 Linux 被攻陷——产品威胁模型内生假设——或物理接触）→ 伪造 grant（新 challenge + 已知 digest + 递增 counter + 未来 expiry）→ 继电器 release → SERVER↔LAN 桥恢复
- 动态验证：不可行（需硬件）→ UNVERIFIED-dynamic 但代码证据完备
- 关联：FW-002（M1 从不发 monotonicCounter/expiresAt → 合法 release 永久 DoS，协议失配）、FW-003（`"expiresAt":"-1"` → UINT32_MAX 永不过期）、FW-004（`g_current_time_s` 恒 0 → 过期检查形同虚设，`controller_update_time` 无调用者）、FW-006（高水位 RAM-only，断电复位）、FW-008（解析器返回 true 不代表 grant 字段齐全——缺字段时 memset 0 恰好 fail-closed，残余风险是"present-but-malformed"值，见 FW-003；duplicate-key last-wins 未文档化）、FW-011（修复 diff 未提交，clean build 回退）
- 修复方向：M2 侧真实验签（SE 或本地公钥）、去掉占位 digest、持久化高水位、修复 M1/M2 字段失配

### DP-001 — 已提交明文 FTP 凭证（HEAD 本身即含，非仅旧史）【EVIDENCE_FOUND-确凿】
- CWE-798/CWE-312；Severity **Critical**；`git show HEAD:scripts/list_ftp.ps1:1-3` 直接证实
- 位置：`scripts/deploy_frontend.ps1:1-3`、`scripts/list_ftp.ps1:1-3`（工作树修复 $env: 版未提交，checkout HEAD 即复燃）
- 完整影响链：FTP 写权限 → `deploy_frontend.ps1` 经 `WebClient.UploadFile` 上传前端产物 → **生产 Web 主机存储型 XSS/页面篡改/供应链支点**（远程为公开 GitHub 仓库，任何 clone 者即得凭证）
- 修复：立即改密（视为已泄露）→ 提交修复 → 历史清洗（filter-repo/BFG）→ 加 secret-scan guard → 审计 FTP 异常登录
- 关联：DP-004（certs/localhost.key + vendor 测试私钥已提交；vendor README 已文档化 test-only）、DP-002（FTP 全程明文）、ML raw-private（已 gitignore ✓）

### RF-001/RF-002 — fastpath sidecar 无鉴权 + 无限内存增长【VERIFIED-static】
- CWE-306/CWE-770；Severity **High**；Confidence High
- 位置：`rust-fastpath/src/main.rs:576-585`（路由注册，无 auth layer；`main.rs:1069` 代码注释自认 "the fastpath API has no auth"）、`:709-757`（check_with_route）+ `:476-489`（cleanup_expired）
- 攻击面：unix socket（0o660，经命名卷 `fastpath_run` 与 backend 共享——同宿主任意挂载该卷的容器可达）或 TCP 127.0.0.1:8081（`FASTPATH_TCP_HOST` 非 loopback 时告警但不拒）；counter map 以攻击者可控 `tenant_id`+`key` 无上限增长，`window_ms=u64::MAX` 使 `reset_at_ms` 饱和至 u64::MAX，cleanup `retain` 永不回收 → OOM
- 子代理实测：cargo test 17/17、clippy -D warnings 0；saturating 算术合规有回归测试锚定（main.rs:1266-1277）
- 影响：compose 网络内任一被攻陷容器/进程可 `/v1/batch/flush` 清空全平台限流状态（平台级 bypass）或耗尽内存（流量路径 DoS）；backend `fastpath-client.service.ts` 逐字信任响应（decisionSource="rust-fastpath"），伪造 verdict 直接驱动执行
- 修复：全路由前置共享密钥 HMAC 或 mTLS；条目上限 + LRU + window_ms clamp；`DefaultBodyLimit`；连接/读超时；非 loopback TCP bind 由告警改为拒绝

### AG-B07 — GET /api/config 向任意认证用户返回 SMTP 密码与 webhook headers【VERIFIED-static】
- CWE-200/CWE-862；Severity **Medium-High**（多用户部署下 High）；Confidence High
- 位置：`backend/src/api/routes/config.routes.ts:15`（仅 `authenticate`）→ `platformConfigService.getConfig()`（`platform-config.service.ts:31-36,399-406` 含 `smtp.password`、webhook `headers` 原文）→ 前端 FE-005 证实会拉取
- 修复：viewer/operator 角色返回脱敏配置，或该端点 requireRole('admin')

### DP-003 — installer 密钥生成用 Math.random()【VERIFIED-static】
- CWE-338；Severity **High**（生成的 JWT/审计/加密密钥可预测）；Confidence High
- 位置：`installer/src/utils/config.ts:23-38`（另两个生成器 setup.mjs/setup-env.sh 为 CSPRNG ✓）
- 修复：crypto.randomBytes；已部署实例全部轮换

## EVIDENCE_FOUND（高置信，未达 VERIFIED）

| ID | 标题 | Sev | 位置/要点 |
| --- | --- | --- | --- |
| AG-DEP01 | socket.io-parser@4.2.6 GHSA-2m8v-j782-fhvr（zero-attachment 内存耗尽）锁定于 lockfile，生产 WS 可达 | High | backend/package-lock.json；npm audit 确认；`npm audit fix` 可修 |
| AG-B03b | `POST /api/devices/codebook` 任意认证用户改全局 codebook；`GET /api/devices/:id/events|config` 无租户过滤（legacy 内存表） | Medium | devices.routes.ts:547/636/654/558 |
| AG-A06 | `/api/investigation/*` 用 `VALID_API_KEYS` 静态共享 key → 伪造 `role=tenant,plan=ultra` 身份，绕过 per-agent 注册/撤销体系 | Medium | auth.middleware.ts:482-557；investigation.routes.ts:16 |
| AG-B02 | ai-endpoints `type=ollama` allowPrivate（含 169.254.169.254）→ 管理员可配 SSRF/云元数据；webhook 通知 URL 同类 | Medium | ai-endpoints.routes.ts:68-108；notification-dispatcher |
| AG-B04 | `SERIAL_HELPER_SHARED_SECRET` 单共享密钥 = final-defense 状态伪造 + 串口部署结果上报全权（结果上报已被 AG-001 签名 fail-closed 缓解） | Medium | helper-auth.middleware.ts; deployment-run.service.ts:789-799 |
| RF-003/004/005 | fastpath limit/window_ms 不设 clamp（saturating 防回绕 ✓，仅退化值风险）；无 axum DefaultBodyLimit（大 base64 → 分配压力）；accept 循环无超时/连接上限（slowloris） | Medium（子代理正式状态：**SUSPECTED**） |
| RF-006 | `DefaultHasher`（SipHash-1-3 固定 0,0 种子）仅用于 64 分片选择——非安全决策，无直接利用；卫生项：勿复用于 dedup/防篡改 | Info（VERIFIED-性质） | rust-fastpath |
| DP-002 | FTP 传输明文（`WebRequest`+`ftp://` 控制+数据通道无 TLS）→ 凭证与部署产物可被 MITM 截获/篡改；修复 = FTPS/SFTP + 方案校验拒 `ftp://` | High（EVIDENCE_FOUND） | deploy_frontend.ps1:17-42; list_ftp.ps1:10-12 |
| DP-005/006 | gateway `applyRuleset` fire-and-forget（spawn error 时**旧规则集残留**——released 态触发 fail-closed 但 nft 加载失败 → 桥保持 forward-accept 而控制面认为已隔离）；systemd 引用 install.sh 从未安装的 preflight-check 二进制（grep 全库仅 service 文件一处引用）→ 每次启动的隔离保证缺失，仅 ExecStopPost+Restart 兜底 | High（DP-005 SUSPECTED / DP-006 VERIFIED） | gateway-daemon.ts:52-60; systemd unit:13; install.sh |
| DP-012 | 三处 pipe-to-shell 无完整性锚：`curl get.docker.com \| sh`（scripts/install.sh:36）、`curl sh.rustup.rs \| sh`（bare-metal:659）、`curl deb.nodesource.com \| bash`（installer:44,47）→ MITM/上游失陷 = 安装期 root RCE | Medium（EVIDENCE_FOUND） | 安装链 ×3 |
| DP-007 | ci.yml release-verify 硬编码测试密钥四值（:506-510）——非生产但全 fork 可见、易复用、恰在 weak-value guard 字面量集之外 | Medium（EVIDENCE_FOUND） | .github/workflows/ci.yml |
| DP-010/011 | 离线 bundle 仅 SHA256SUMS 无签名（README 自认只防传输损坏不防敌手替换）+ `--skip-verify` 仅 WARN 不中止（README 还宣传它）；install.sh 内 sha256sum -c 本身是 fail-closed ✓；捆绑 Docker 静态引擎下载无摘要验证（:164-175） | Medium（EVIDENCE_FOUND×2） | build-offline-bundle.mjs:197-223; install-offline.sh:36-55 |
| DP-008/013/015 | redis/postgres/fastpath/frontend 基镜像 floating tag（backend/frontend Dockerfile 已 digest-pin ✓，guard 只管 MinIO）；nginx+fastpath 容器无 USER（backend `USER node` ✓）；installer-agent systemd `User=root` 零加固（对比 gateway unit 的 ProtectSystem=strict 全套加固）+ onboarding 无 TLS pin | Medium（EVIDENCE_FOUND×3） | compose/Dockerfiles/systemd |
| DP-014 | 根 compose 引用 `backend.Dockerfile`（根目录）但只有 `backend/Dockerfile` 存在 → fresh checkout `docker compose build`/CI 必失败；production/deploy.sh|.ps1 陈旧（旧端口 8888/3010、v1 compose）误导操作员 | Medium（VERIFIED） | docker-compose.yml:84; deployment/production |
| FW-002/003/004/006/008/010/011 | 见 FW-001 关联（协议失配 DoS、过期绕过、RAM 高水位、解析容错、占位 digest、修复未提交） | High-中 | firmware |
| FW-005 | challenge 去重是 16 槽环形窗口而非重放拒绝集：16 个新 challenge 后旧值可复用；且 DENIED 的 grant 仍烧掉 challenge 槽（可被垃圾流量加速驱逐目标槽）；后端 monotonic counter 是真正防重放锚 | Low-Med | controller_tasks.c:91-100; test_controller.c:307-326（测试显式承认窗口界） |
| FW-007 | policyDigest 以 strcmp 比较（非常时）——当前 digest 非密文（FW-010）故时序泄露无增量；FW-001 修复后应改定长 memcmp | Low | controller_tasks.c:103-106 |
| FW-009 | e-stop：`controller_clear_estop` 不验物理引脚即清软件锁存（电气 NC 断链兜底，仍 fail-closed）；EXTI ISR 内调 HAL_UART_Transmit（重入/健壮性隐患） | Low | controller_tasks.c:154-164; main.c:79-84; interlock_driver.c:12-21 |
| RS-001 | 未提交 runtime.rs 语义修正（`Some(true)`→`Some(false)`）经固件交叉验证**正确**（GPIO HIGH=继电器合闸，assert 后重读反馈，`feedback_ok==false` 才是真隔离——interlock_driver.c:23-26 + controller_tasks.c:183-196 + gateway-daemon.ts:211 三方一致），但 run-drills.mjs DRILL-001b(:91)/SEC-007(:168)/SEC-005b(:153) mock 仍是旧语义 → 下次 --release 构建必红；**当前 target/release 二进制是 HEAD 旧版，drill 绿灯验证的是陈旧语义**（验证链断裂） | Medium/High（EVIDENCE_FOUND） | rescue + scripts/rescue |
| RS-002 | `audit_outcome` `.ok()?` 吞掉 outcome append 失败 + `let _ = store_snapshot` 丢弃锚更新失败 → 已执行动作在链中不可见且 `last_event_hash`/`event_count` 不持久——截断检测恰在设计声明的磁盘满场景失效（gate_action 的 pre-execution 记录是 fail-closed ✓，post-execution 不是） | Medium（**VERIFIED**；cargo test 51/51, clippy clean） | runtime.rs:226-238 |
| ML-004 | v0.3 `audit.jsonl` sha256 链**无 key 无锚**：本机进程可整链重写（GENESIS 未认证）、**截断到任意前缀仍 verify ok=True**（无 tip/count 锚）；resume 用 `_load_last_hash` 取末行作链头**不先跑 verify_chain**（撕裂写静默回落 GENESIS）；near-dedup 状态不在链完整性范围内（resume 后重复样本可再被接受） | Medium（**VERIFIED-static**） | audit.py:30-96; orchestrator.py:200-247 |
| ML-010 | `detection-input.schema.json` 未提交改动（query string→object）与 v0.2 生产者失配：`public_source_adapters.py:181`/`common.py:378-380` 仍产/验 string，`deterministic_checks.py:82-83` 已双形态——混合契约数据集 + schema 静默放宽（值类型扩到 number/boolean）| Medium（**VERIFIED-static**） | ml/schemas |
| ML-001 | v0.3 `provider.py:28`/`dedup.py:12` 依赖 openai/datasketch，均不在 requirements(-lock) → 携带 ARK_API_KEY 的 HTTP 客户端与质量闸门依赖无版本锚定 | Medium（**VERIFIED-static**） | ml/data_pipeline/v03 |
| ML-003 | `usage_logger.py:43-46` 硬编码绝对路径 + 写入**活动中的 OpenCode SQLite DB**（~/.local/share/opencode/opencode.db，env 门控默认关，仅 INSERT 隔离命名空间，fail-open）——逆向第三方 schema 的维护/供应链气味 | Low（EVIDENCE_FOUND） | v03/usage_logger.py |
| ML-008 | `fetch_public_sources.py:101-104` `cachePath` 拼接无 resolve+containment/symlink 校验（来源为受信 version-controlled registry，非攻击者可控——违反 AGENTS.md §1 自家规范，防御性缺口） | Low（SUSPECTED） | data_pipeline/fetch_public_sources.py |
| ML-002/005/007/009/011/012 | `.env.local` 朴素解析（值含 `=` 截断、数值 env 无校验可配出无界并发）；specHash 无 key 且 `generatorSeed` 语义与文档矛盾；`monitor_run.py:15`/`usage_logger.py:46` 硬编码 `X:\repos\Networksafe` 绝对路径；v0.2 脱敏 regex 与 v0.3 det-check 键形不全覆盖（仅历史产物兜底）；schema `accountPrivilege`/`assetType` 无 enum 与 planner 枚举失配；**无全局 token 成本预算代码闸**（5h 预算是流程约束非代码，max_waves×oversample≈9.6M specs 实际无界） | Low/Info（VERIFIED×3 + SUSPECTED×3） | v03/** |
| ML-GOV-1 | **密封挑战测试集约 100 文件被 git-commit 进源码库**（all-sanitized/attack-traffic/normal-traffic/hard-negatives/model-*/adjudication/** 等，`git ls-files` 证实；raw-private/ 凭据已正确 gitignore）——密封性仅靠进程纪律（DO_NOT_READ），任何 clone 者可读全量密封集；CI guard 只挡训练产物泄漏、不挡密封集本身入库 | Medium（治理级，VERIFIED-static） | ml/data/lan_challenge_capture/ |
| ML-GOV-2 | 密封目录内出现 untracked 新文件 `annotations/_validate-summary.json`——密封区域正在被工具写入（`_validate` 前缀暗示某校验脚本输出落盘于此），需查明写入者并确认未污染密封内容 | Low（旗标，待查） | ml/data/lan_challenge_capture/annotations/ |
| FE-001/002/003 | 客户端 session 身份（sessionStorage→localStorage key）选择数据源；demo 开关 `canUseDemoMode=()=>true` 硬编码+失败 `.catch(()=>{})` 不回滚（demo ON 时 sendDeviceCommand/requestFinalDefenseAction/approveDeploymentRun 全部短路为模拟成功——操作员误导面）；OIDC `authorizationUrl`/`endSessionUrl` 直接 `window.location.assign` 无 origin 白名单（利用取决于后端响应组装，后端侧 auth.routes.ts:1120-1138 已有白名单——**前端为纵深缺口**） | Medium（FE-002 子代理正式状态 SUSPECTED） |
| FE-004 | SuperAdmin 明文 apiKey/onboarding code 进剪贴板与 React state（by-design "show once"，未持久化未 console，admin 前提）| Low |
| FE-005 | `fetchPlatformConfig` 将 smtp.password/webhook headers 物化进浏览器内存（未渲染；与 AG-B07 同源——后端脱敏后此条自愈） | Low（SUSPECTED） |
| FE-006 | 孤儿开发产物：`frontend/sec落地页.html:695-705` 硬编码 `admin@AetherGuard.io`/`password`；`append_api.js`（追加改写 api.ts）、`append_walkthrough.js`（写绝对机器路径 C:\Users\...）、`record_video.js`——未被 import、不入 bundle，但在 tracked 树内，误配置静态托管即可暴露；误运行可损坏源码 | Low（EVIDENCE_FOUND） |
| FE-007 | WS `socket.onAny` 事件数据无校验分发（React 转义兜底，无 DOM XSS）→ **REJECTED-as-exploitable**，仅记录为加固项（事件名白言/载荷规范化）；完整性面：被攻陷 agent 可伪造 attackName 误导操作员 | Info |

## SUSPECTED / UNVERIFIED

### AG-X01 — 部署态 Gateway Appliance 无任何入站命令通道：release 与 rescue-isolate 双向集成均无载体【VERIFIED-static（架构事实）】
- CWE-1104（交付不完整）/ 非漏洞类——架构交付事实；Severity：**assurance 级**（非直接可利用）
- 证据（本轮闭环 RS/FW 两份报告的跨组件旗标）：
  - `deployment/gateway/bin/aetherguard-gateway-daemon.ts`（127 行全读）**无 TCP/HTTP/WS 监听**——仅：读配置、开串口、`handleControllerFrame`、`onFrame`→串口写出（:75 含 breakerTarget）、axios POST 状态上报、SIGTERM 回 isolated
  - `daemon.requestRelease()`（唯一 release 入口）**在部署 wrapper 中零调用**——backend→appliance 的合法 release 链路无载体
  - rescue `appliance_endpoint`（TCP newline-JSON）在树内**无对端监听者**——rescue 的 `interlock_assert` 安全侧动作同样无载体（resync ingest 也自declared "not_implemented"）
- 对 RS 旗标的回答：rescue 帧缺 `breakerTarget` 的问题**当前 moot**（无消费者）；未来实现监听者时必须回答该问题（daemon 出站 assert 帧 :293 含 breakerTarget，入站校验策略待定）
- 双面影响：(a) 攻击面——部署态 appliance 实际上**无法被远程触发 release**（无载体），比设计文档描述的更封闭；(b) 保证——**"最后防线"端到端链路从未在部署拓扑中运行过**，simulator 测试的是 daemon 核心逻辑而非集成；与 FW-002（M1/M2 协议失配）互相印证同一主题：固件链路未经真实对接
- 建议：实现监听通道时同步定义入站鉴权（建议复用 rescue 的 HMAC challenge 模式）与 breakerTarget 必填校验；在此之前，产品文档不应声称部署态支持远程 release

| ID | 标题 | 状态 |
| --- | --- | --- |
| AG-B05 | TRUST_PROXY=true 时 XFF 伪造影响限流 key（默认关） | UNVERIFIED（配置依赖；部署文档默认未开） |
| RS-003/004/005 | appliance 传输 `read_line` 无行上限（5s 超时按字节计，滴水可无限增长内存；HTTP 头 8KB cap 在整行返回后才检查）；审计时间戳用墙钟无单调源（hash 链对内容不含时间，仅取证排序受影响）；challenge nonce map 仅在下次签发时清扫（只 GET /rescue/challenge 可缓慢累积）；另注：错误 key 攻击者可烧掉合法 nonce（DoS 非 bypass）；getrandom().expect 线程级 panic（线程作用域，无安全绕过） | Low（**EVIDENCE_FOUND**×3） | appliance.rs:124-131; http.rs:64,73; state.rs:64-69; auth.rs:71-77 |
| FW-001 动态 | 硬件上实际释放继电器 | UNVERIFIED-dynamic（需实机；静态证据链完整） |

## REJECTED（对抗审查否决）

| 候选 | 否决理由 |
| --- | --- |
| verifyToken 同步版绕过黑名单 | 仅测试引用（grep 证实，auth.middleware.ts:139 仅 __tests__） |
| scanner 命令注入（port/web/system/nuclei） | 固定命令串 + spawn 数组参数 + target 白名单校验（validateTarget） |
| seed 路由 force 绕过 | 未提交改动已移除 force + 单次确认 token（工作树版本安全） |
| smart-fix 路由未鉴权 | router.use(authenticate, requireRole('admin'))（smart-fix.routes.ts:13-14） |
| alerts 跨租户 IDOR | transition/list 全部经 tenantOf(req) 过滤 |
| helper 租户伪造 | V2.2 修复：tenant 取自预置记录非 body（final-defense.routes.ts:86-88）+ 结果签名 fail-closed |
| hardware-confirmations/:id IDOR | session.tenantId !== tenantOf(req) → 404 |
| SQL 注入（shadow store） | 引用标识符白名单表名 + $n 参数化（postgres-shadow-store.service.ts:1046-1057） |
| agent 命令伪造 | agent.ts:318-381 HMAC 验签 + nonce + 时间窗 + hardware grant ECDSA 二次验证 |
| 原型污染 | pre/post 双段 guard 中间件全局限护 |
| XSS（前端主类） | 全前端 0 个 dangerouslySetInnerHTML/innerHTML/eval（FE 报告负结果） |
| artifacts 路径穿越 | 前缀 + realpath 双重校验（artifact-store.service.ts:94-135） |
| rescue release 禁令绕过 | 闭合枚举 + deny_unknown_fields + guard + 源级扫描全通过 |
| device 公钥替换 | 未提交修复使公钥不可变（hardware-authorization.service.ts:219+） |
| ML-006 LLM 输出注入（prompt-injection→执行/路径） | 输出仅 json.loads + JSON Schema + deterministic 检查；零 eval/exec/pickle/yaml.load/shell=True（唯一 subprocess 是固定参数 tasklist）；模型串永不入文件系统路径（路径全常量或内部整数派生）；下载 sha256+size 校验、无 TLS 弱化 |
| DP-009 离线 bundle 构建期 secrets 入镜像历史 | BUILD_ENV 全为显式非密标记值（'bundle-build-only-*'），注释明确不进镜像层——文档化的合规设计 |
| DP-016 生成器打印 ADMIN_PASSWORD | "print once" 设计且仅限 admin 单次引导密码（setup.mjs:261/setup-env.sh:144/install-offline.sh:191,308），JWT/S3/pg 等均不打印 |
| CI PR 注入面 | 无 pull_request_target（零非受信 PR 写路径 checkout）；deploy.yml workflow_run 溯源三重校验（name/conclusion/head_repository/head_sha/id）+ SFTP host-key pin + bundle checksum/SOURCE_SHA 绑定 + 符号链接拒绝 + 第三方 action SHA-pin；permissions 最低化 |
| 容器逃逸面 | 无 privileged/cap_add/network_mode:host/security_opt/宿主路径 bind；数据全命名卷；frontend 端口默认 127.0.0.1；Redis/Postgres/MinIO 不发布；dev compose postgres 绑 127.0.0.1:15432 |
| nftables isolated_ruleset实效 | `flush ruleset` 头部 + input/forward `policy drop` + 双向阻断 SERVER↔LANWAN + MGMT 保留（isolated_ruleset.nft:17,26,47,51-56 逐行核验）——released 态 forward accept 为设计内释放窗口，TTL 自动回落 |

## 子代理负结果要点（对整体结论有分量）
- 前端零 XSS sink、token 全程 httpOnly cookie；另核实：无 markdown/HTML 渲染器（无 sanitizer-bypass 面）、setTimeout/setInterval 无字符串形式、无 document.cookie 读取、无 postMessage、无 iframe、无 javascript:/data: URL sink、无 token 入 URL、无 source map 入库、i18n `escapeValue:false` 依赖 React 转义（已核 JSX 无 HTML 注入键）、`test:credential-hygiene` 禁用密码模式 4 项均不在 src/dist；跨审计对账：FE-003 的 OIDC redirect 在后端 auth.routes.ts:1120-1138 已有 origin 白名单+同源相对路径回落 → 前端缺口降为纵深防御项
- rust-fastpath 零 unsafe、saturating 合规、无可达 panic、clippy/test 全绿
- rescue 认证（HMAC+CSPRNG nonce+常时比较+consume-on-attempt）、allowlist 精确匹配、hash 链重算验证稳健
- 后端守卫脚本 7/7 通过；API 契约 109 前端调用全解析；路由零直连 DB
- 认证链：bcrypt(12)+锁定+dummy-hash+refresh 防重放+会话并发上限+OIDC state/redirect 白名单
