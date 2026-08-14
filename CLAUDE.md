# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 默认中文交流；代码、路径、日志、标识符保持原文。本文档其余部分用中文说明。
> 执行门禁（声称完成带证据 / 不得甩锅手动验证 / 安全变更置顶 / 按文件给证据）由 `UserPromptSubmit` 钩子每轮注入，文本见 `.claude/gates-reminder.txt`；本文件只记项目知识，不重复行为规则。

## 项目定位

AetherGuard —— 智能服务器安全防御平台。Node.js 控制面 + 分布式 host agent + React dashboard + Rust fastpath sidecar + 硬件安全闸门。控制面负责检测/审计/下发，但**危险操作的最终授权由硬件强制**，这是产品声称"完全最后防线"的工程含义。

- **Final Defense Mode**：可检测、可审计、**fail-closed** 的模式——控制面能请求并审计危险动作，但最终 grant 由硬件强制。高风险动作（`host_remove`/`wipe_data`/`factory_reset`/`recovery_flash`/`critical_config_change` 等）必须通过本地策略 + 硬件 grant 签名 + interlock 反馈全链校验。
- **Root-Resistant 变体**：把最终网络释放决策移出受保护服务器，落到自研 **AetherGuard Root-Resistant Gateway Appliance**（双 1GbE L2 桥 + 独立 MGMT，STM32H5/U5 安全控制器 + Secure Element/TPM + 硬件 fail-closed interlock）。受管服务器 OS/root 被攻陷时，攻击者无法不经 appliance 全链授权恢复 SERVER↔LAN/WAN 连通。

ESP32 旧硬件线（串口部署 dongle、control board v1/v2、`aetherguard-gate`）已于 2026-06-13 全线退役并移至 `X:\repos\Networksafe-archive\20260513-pre-cleanup`；本仓库 `hardware/` 仅保留 Gateway Appliance 线。旧文档引用的路径若已不存在，先查 `docs/artifact-archive-index.md` 再判断是否删除。架构决策见 `docs/adr/`——改动涉及 API envelope、模块边界/bootstrap、Postgres 主写路径、启动入口统一时先读对应 ADR。

## 构建与测试命令

`npm test` 单进程跑全量 Jest 会 OOM，**验证证据一律用 `npm run test:all`**（4 shard，各 `--maxWorkers=50%` + 4GB heap），或 `npm run test:shard1..4`。

```bash
cd backend
npm run test:all                                        # 全量（首选，替代 npm test）
npx jest src/__tests__/services/final-defense.service.test.ts          # 焦点：Final Defense
npx jest src/__tests__/services/hardware-authorization.service.test.ts # 焦点：硬件授权
npx jest src/__tests__/services/device-control.service.test.ts         # 焦点：设备下发
npx jest src/__tests__/companion/serial-device-companion.test.ts       # 焦点：companion
npm run typecheck   # tsc --noEmit -p tsconfig.build.json
npm run lint
npm run test:coverage
```

Final Defense / 硬件闸门路径的测试名多含 `_fail_closed` / `_reject` / `_rollback` / `_mismatch` / `_expired`——改任一校验分支前先看这些测试名，它们就是不变量的可证伪断言。

Rust fastpath：

```bash
cd rust-fastpath
cargo test
cargo clippy -- -D warnings
cargo build --release
```

Firmware（STM32H563，需 ARM GCC toolchain；host-side 测试只需 gcc）：

```bash
cd firmware/controller-stm32h5
make -j$(nproc)                    # 产物 build/controller-stm32h5.elf/.bin/.hex（需 CubeMX 生成 HAL/Drivers，README.md 记录当前 .ioc 尚未初始化）
make -f test/Makefile test         # host-side C 单测：mock_hal + controller_tasks/serial_json/interlock_driver，18 用例（含急停锁存、counter UINT32_MAX 饱和闭锁、challenge 16 槽环形窗口、serial_json RFC8259 空格/转义/键名防伪），gcc 编译无 STM32 依赖（test/Makefile 路径为父目录相对，须在 firmware/controller-stm32h5/ 根跑；cd test 会找不到 test/mock_hal.c。Windows 无 make 时可直接 gcc：`gcc -Wall -Wextra -std=c11 -Itest -ICore/Inc -ICore/Src -o test_controller.exe test/mock_hal.c test/test_stubs.c test/test_controller.c Core/Src/controller_tasks.c Core/Src/serial_json.c Core/Src/interlock_driver.c`）
```

Simulator（无额外依赖，复用 backend 的 ts-node）：

```bash
cd simulator
npm install
npm run sim                                    # 独立跑全 M1–M4 控制环 + 9 种 fail-closed 注入（sim.ts；实跑 exit 0，README 列全 9 种触发）
# test-scenarios.ts 提供 4 个单触发 fail-closed 场景（真 M1 daemon + mock M2/M3/M4，断言桥隔离 + 预期 reason，exit 0=成立）：
npm run test:invalid-sig / test:counter-rollback / test:heartbeat-stale / test:estop
# estop 场景同时断言"锁存期间合法 grant 被拒 + clearEstop 显式复位后才可重新释放"（与固件 controller_clear_estop 对齐）。sim-integrated.ts 从未入库，sim:integrated 脚本已移除。
```


Rescue（异构救援控制面，std-only + 7 crate，离线可构建）：

```bash
cd rescue
cargo test                       # 49 用例：链篡改/截断、auth 重放、allowlist、mock appliance
cargo clippy --all-targets -- -D warnings
cargo build --release            # 产物 target/release/ag-rescue
node ../scripts/rescue/run-drills.mjs   # 从仓库根也可：故障演练 11 断言（需先 build --release）
```

AI 助手一键诊断（从仓库根；`--tests` 加全量测试集，`--json` 机器可读；断点地图与错误签名表见 `docs/ai-debugging.md`，VS Code 调试配置已入库 `.vscode/launch.json`）：

```bash
node scripts/ai/diagnose.mjs [--tests] [--json]
```

Release guard 脚本（从仓库根）：

```bash
node scripts/guards/check-route-db-access.mjs        # route handler 必须经 services/repositories，不得直连 DB
node scripts/guards/check-no-direct-api-fetch.mjs    # 前端每个后端调用必须经 services/api.ts
node scripts/guards/check-frontend-api-contract.mjs  # 前端每个 API 调用必须解析到已注册的后端路由
node scripts/guards/check-repository-hygiene.mjs     # 阻止提交运行时 DB / 生成物 / QA 截图 / Playwright 状态
node scripts/guards/check-rescue-no-release.mjs        # rescue 控制面源码级禁止 release 帧（ADR 2026-07-08-rescue-release-policy）
node scripts/guards/check-training-leak-challenge-capture.mjs  # ml/ 训练产物不得泄漏 sealed challenge capture（只挡 committed 产物，不挡 runtime reads → 见 DO_NOT_READ.md）
```

环境初始化与 Docker（跨平台可复现）：先 `node scripts/setup.mjs`（从 `.env.example` 生成根 `.env` 与 `backend/.env`，随机密钥、幂等不覆盖、`--install` 附带 npm install；bash 等价 `deployment/production/setup-env.sh`，两者生成键列表须保持同步），再 `docker compose up -d --build`（compose 文件用 include/env_file long syntax，需 Compose v2.24+，legacy `docker-compose` v1 二进制解析不了）。`deployment/production/docker-compose.prod.yml` 是 canonical 根 Compose 的兼容入口，不维护第二套拓扑。生产 Compose 仅发布 `127.0.0.1:8080` 的前端/API 反代入口，backend/Redis/Postgres/MinIO 仅在 Compose 网络可达；本地开发后端仍可直接监听 3005。登录凭据 = `.env` 的 `ADMIN_EMAIL`/`ADMIN_PASSWORD`（setup 生成并打印一次）。compose `:?` 硬保护 12 项：`REDIS_PASSWORD`/`JWT_SECRET`/`AUDIT_LOG_SECRET`/`ADMIN_PASSWORD`/`ENCRYPTION_KEY`/`ENCRYPTION_SALT`/`DEVICE_COMMAND_SECRET`/`SERIAL_HELPER_SHARED_SECRET`/`POSTGRES_PASSWORD`/`SHADOW_DATABASE_URL`/`S3_SECRET_KEY`/`DEVICE_API_KEYS`；`SERIAL_HELPER_SHARED_SECRET` 还必须 ≥32 字符且 ≠ `DEVICE_COMMAND_SECRET`（`runtime-env.ts:111` 硬拒）。生产 Compose 的 `ENABLE_ATTACK_SIM` 缺省为 false。占位值 `change_me*` 在生产被 `runtime-env.ts` WEAK_VALUE_PATTERNS 硬拒——直接 `cp .env.example .env` 起不来，必须走生成脚本；本地 dev 同样必需 `JWT_SECRET`+`AUDIT_LOG_SECRET`（缺任一 `npm run dev` 直接 fatal）。根 `deploy.sh` 已废弃（其产物被生产校验硬拒，脚本现直接报错退出），Linux 一键 Docker 安装用 `sudo bash scripts/install.sh`。离线客户机（air-gapped，甚至无 Docker）分发：在线构建机 `node scripts/release/build-offline-bundle.mjs [--include-docker]` 产自包含 tar.gz（docker save 全镜像 + SHA256SUMS + 可选 Docker 静态引擎），客户机解包后 `sudo bash install.sh` 零网络安装（load 镜像 + 现场生成密钥 + `docker-compose.offline.yml` 固定标签 `up -d --no-build`），三处密钥生成器（setup.mjs / setup-env.sh / 离线 install.sh）键列表须同步，详见 `deployment/offline/README.md`。

## 架构

> 请求生命周期逐层锚点与各层禁令见 `docs/architecture-layers.md`（新代码先对号入座，层级规则以 guard 脚本为准）。

| 路径 | 角色 |
| --- | --- |
| `backend/` | Express API + Socket.IO gateway + services + repositories + companion 逻辑 + Jest 测试 |
| `frontend/` | React/Vite dashboard + typed API client + pages + context providers + demo data |
| `rust-fastpath/` | 高吞吐流量处理 sidecar（Rust 1.85） |
| `e2e/` | Playwright smoke / release / visual / walkthrough |
| `firmware/controller-stm32h5/` | STM32H563 安全授权控制器固件（M2，12 core tasks）+ host-side C 测试 |
| `simulator/` | Gateway Appliance M1–M4 端到端软件模拟（真 M1 daemon + mock M2/M3/M4 I/O） |
| `rescue/` | 异构救援控制面 `ag-rescue`（Rust 单二进制，仅安全侧动作；ADR/runbook 见 `docs/adr/2026-07-08-*` 与 `docs/rescue/`） |
| `hardware/enclosure/` | Gateway Appliance 3D 打 OpenSCAD 机箱（Phase 0.5 原型，非注塑量产件） |
| `deployment/gateway/` | M1 Gateway Daemon 嵌入式部署包（systemd + nftables ruleset + install.sh） |
| `ml/` | AetherArgus 离线安全判定模型与数据集（独立于后端 `ai-agents/` 运行时检测；QLoRA + 数据管线，当前未接入 `backend/src/`；详见下节） |
| `deployment/` `docs/` | 生产脚本 / 架构·ADR·产品·就绪文档 |

> Gateway Appliance 四模块分层（PRD §4，硬实现在 firmware/hardware/deployment，逻辑在 simulator 验证）：**M1 Gateway Daemon**（`backend/src/companion/gateway-daemon.ts`，部署态 `deployment/gateway/bin/aetherguard-gateway-daemon.ts` 包它）↔ **M2 STM32 控制器**（`firmware/controller-stm32h5/`）↔ **M3 Secure Element**（OPTIGA Trust M，I2C）↔ **M4 interlock 继电器+反馈**。串口协议 newline-delimited JSON，默认 USART3/115200。`simulator/` 用**真 M1 daemon + mock M2/M3/M4** 跑通同一控制环，9 种 fail-closed 触发可注入。

### 后端入口与约束

- `backend/src/index.ts` 启动 server + DB + WebSocket；`backend/src/app.ts` 配 Express app + 中间件。
- **`createControlPlaneApp()`（`backend/src/bootstrap/control-plane-app.ts:91`）是规范 app 构造器**——测试和任何 embedding 上下文必须调它，不得直接 new Express（见 startup-entrypoint-unification ADR）。路由在 `apiRouter` 上挂 `/api`；健康端点 `/health`、`/health/live`、`/health/ready` 直接注册，不经 `apiEnabled` 门控。
- **route handler（`backend/src/api/routes/`）不得直连 DB**，走 services/repositories（`check-route-db-access.mjs` 强制）。
- **不要在 request handler / WebSocket processor 里调 `ensureSchema()`**；service-owned 表在 `backend/src/bootstrap/persistence.ts` 启动时 prepare。
- route handler 用 `sendSuccess()`/`sendError()`（`backend/src/core/http/api-response.ts`）。envelope：成功 `{success:true,data,error:null,meta?}`，失败 `{success:false,data:null,error,code,message,meta?}`。

### 数据库（双模式）

`backend/src/config/database.ts` 暴露统一 `prepare()/run()/all()/get()`（statement 包装见 `wrapStatement`，`step()` 每次推进游标、耗尽返回 false），两种 SQLite 引擎由 `resolveSqliteEngineOrder()` 选序：

1. **better-sqlite3**（非测试运行时优先）：直接开文件，WAL + `foreign_keys=ON`，写即持久。
2. **sql.js**（Jest 测试优先——每 worker 独立内存快照保证隔离）：DB 加载进内存，每 30s 落盘 + 关闭时落盘。**运行中直接改 SQLite 文件会被下一次内存落盘覆盖**——改库前先停 backend，或走运行中的 API/service。安全关键写入（如 `hardware-authorization` 的 monotonic counter 推进）后有显式 `save()` 同步落盘。

`DB_ENGINE=sqljs|better-sqlite3` 可显式覆盖选序。`DB_MODE=postgres` 文档标注为生产必需，但当前 `database.ts` 写路径仍 SQLite 取向；Postgres 仅覆盖 `postgres-shadow-store.service.ts` 中列出的 ShadowTable（**不含 hardware_* 表**），假设 Postgres 对等前先查 ADR 与实现。

### 前端

`frontend/src/services/api.ts` 是唯一 API 客户端层，所有后端调用必经它（`check-no-direct-api-fetch.mjs` 强制）。`fetchWithCredentials()` 发 `credentials:'include'`，auth token 存 httpOnly cookie 不存客户端 header。`unwrapApiEnvelope<T>()` 取 `.data`，`extractErrorMessage()` 集中错误解析。Context 在 `App.tsx` 组合：WebSocket/Theme/Language/Demo/LiveMode/AttackStatus。

### WebSocket 与 Agent

`backend/src/websocket/agent-gateway.ts`：双向 Socket.IO，JWT/API-key 鉴权、Redis 限流（内存 fallback）、HMAC 命令签名，事件 `agent:register`/`traffic:analyze`/`agent:command`/`threat:alert`。`device-gateway.ts`：Gateway Appliance/设备注册·管理·广播。Agent API key 模式 `AetherGuard_test_key_*`、`agent_*`；设备 key 模式 `device_key_*`、`AetherGuard-device-*`。

### AI Agent 检测管线

`backend/src/ai-agents/` 七层多 agent 决策（L1 协同→L2 角色→L3 场景遍历→L4 能力→L5 辩论→L6 异构模型→L7 综合）。`services/detection-pipeline.service.ts` + `detection-engine.ts` 实现规则检测/攻击族分类/AI 升级/候选规则。检测启发式以**正常流量 0% 误报**为硬约束调参。数据集 harness `__tests__/dataset/dataset-evaluation.test.ts` 评估 `backend/test-data/aetherguard-security-dataset/` 克隆，缺失则自跳过。

## AetherArgus 离线模型与数据集（ml/）

`ml/` 是**独立于后端 `ai-agents/` 运行时检测**的离线 ML 工作流：QLoRA 微调 Qwen3-4B-Instruct，对标准化 HTTP 请求输出严格 JSON 安全判定（`verdict/confidence/attackFamily/severity/reasoning/evidence/recommendedAction`，契约见 `ml/schemas/detection-{input,output}.schema.json`）。**当前未接入 `backend/src/` 生产路由**（`ml/data_pipeline/README.md` 明示 "does not connect a model to backend/src/"）。权重/checkpoint/缓存/GGUF 全被 `.gitignore` 排除。

### 两个阶段，勿混淆

- **v0.2（已完成）**：完整数据 + QLoRA 训练 + 评估 + GGUF/Ollama。958/122/120 样本，verdict 准确率 0.2833->0.9000、正常 FPR 0.5152->0.0455（实测锚点见 `ml/README.md` §13：`ml/output/aetherargus-lora/training-summary.json`、`ml/reports/baseline-vs-lora.json`）。数据管线在 `ml/data_pipeline/`（`build_release.py`，19,052 样本，data-only），文档见 `ml/data_pipeline/README.md`。
- **v0.3（进行中）**：**仅生成训练数据**。目标 300k accepted（245k floor / 500k stretch，pass-gate 245k）。管线源码在 `ml/data_pipeline/v03/`（tracked），产物在 `ml/data/releases/v03/`（gitignored：`*.jsonl`/`*.py`/`accepted/`/`rejected/`/`sealed/`/`_sched_*/` 等全排除，见 `.gitignore` L217-231）。

### v0.3 硬约束（改 ml/ 前必读）

- **只生成训练数据**：禁止 training/QLoRA/adapters/merging/quantization/GGUF/Ollama eval/baseline eval/closed-set eval/standalone eval；禁止新建 validation/test set；禁止修改 sealed test 或模型验收阈值（`ml/configs/aetherargus-v02-acceptance-gates.json` 8 项 locked 阈值）；`syntheticRatio=100%`、`humanReviewCount=0`。
- **⚠️ sealed test 内容禁读（mission §58）**：`DO_NOT_READ.md`（repo root，v2，2026-08-07）是 canonical 密封测试注册表。任何 v0.3 generator/reviewer/adjudicator 子 agent prompt 必须内嵌其 "PASTE INTO AGENT PROMPTS" 块逐字。密封路径含 `ml/data/lan_challenge_capture/**`（含 `raw-private/` 凭据 `.id-salt`/`.test-creds.env`/`cookies.jar`）、`ml/data/releases/*/test-{closed,independent}.jsonl`、`ml/evaluation/lan_challenge/**`（33 git-tracked 文件，`few-shot-examples*.json` = 直接污染向量）、`ml/reports/lan-challenge-evaluation/{predictions,metrics,tables,figures,paper}/**`。状态不明默认不读。CI guard `check-training-leak-challenge-capture.mjs` **只挡 committed 产物泄漏，不挡 runtime file reads**--故 `DO_NOT_READ.md` 是进程控制，非可选。
- **Ground truth 程序拥有**（immutable labels，非 LLM 决定）：spec planner -> immutable generation spec -> LLM request realizer -> 2 blind reviewers -> adjudicator -> dedup -> accept。`audit.jsonl` 是 tamper-evident sha256 链（首事件 `"prev":"GENESIS"`），为 resume 的 source of truth。
- **凭据**：`ml/data_pipeline/v03/.env.local`（`ARK_API_KEY`）必须保持 gitignored，永不提交，key 只从 env 读。

### v0.3 命令

```bash
cd ml/data_pipeline/v03
py -3 run_full.py [max_inflight=32] [oversample=1.6] [target_scale=1.0]  # 全量，resumable from audit.jsonl；产物落 ml/data/releases/v03/
py -3 finalize.py                # 完成后写 manifest + report
py -3 run_smoke.py / run_smoke_diverse.py / run_smoke_targeted.py        # smoke
py -3 run_scale_test.py                                                   # scale
py -3 monitor_run.py                                                      # 监控
# 后台 supervisor（gitignored runner，在产物目录）：cd ml/data/releases/v03 && py -3 supervisor.py
```

Python = `py -3`（3.12）。Provider：OpenCode Zen `deepseek-v4-flash`（`https://opencode.ai/zen/go/v1`，需 `/v1`，`extra_body={"thinking":{"type":"disabled"}}`），5h rolling usage budget 是绑定约束（provider 可换，见 memory）。

## 安全控制流不变量（改 `final-defense*` / `hardware-authorization*` / `companion/` / `device-control*` 前必读）

这是本项目最易踩坑、且需跨多个服务才能看懂的核心设计——工业现场异常下"不确定就 fail-closed 主动断桥"。所有路径为 `backend/src/` 下相对。

- **policyDigest 是端到端绑定锚，跨 4 个服务且逐字 ===**。同一 digest：control-plane 在 `services/final-defense.service.ts` 算 → 同时写 `payload.policyDigest` 与 `hardwareContext.policyDigest`（两份）→ 进 `hardware_confirmation_sessions.summary` → `validateGrantPayload` 与 session summary 比对（`services/hardware-authorization.service.ts:607`）→ companion `validateLocalPolicyGrant` 与 `policy.policyDigest` 比对（`companion/serial-device-companion.ts:83`）→ `services/device-control.service.ts:527` 与 stored `hardwareContext.policyDigest` 比对。任一处 !== 即 fail-closed。digest 输入经 `policyDigestInput`（`security/final-defense-policy.ts:71`）规范化（trim/Number/Boolean coerce），"看起来一样的 JSON"算出的 digest 可能不同——**必须用 `computeFinalDefensePolicyDigest`，不能手算**。
- **monotonic counter 有三套独立高水位，互不共享，各自严格 `>`**：control-plane DB 列 `hardware_gates.last_monotonic_counter`（`hardware-authorization.service.ts:131`，持久）、appliance daemon 内存 `monotonicHighWater`（`companion/gateway-daemon.ts:81`，进程级）、companion `SerialDeviceCompanion.lastCounter`（`serial-device-companion.ts:115`，进程级）。counter 虽存 INTEGER 列，落库前 `Number.isInteger` 校验（`hardware-authorization.service.ts:503`）防 `Number(1.5)` 被列四舍五入后蒙混。回滚即 `non_increasing_monotonic_counter` / `monotonic_counter_rollback`（`gateway-daemon.ts:135`）/ `counter_replay_or_rollback`（`serial-device-companion.ts:98`），三处各自 fail-closed。
- **interlock 状态归一化**：`normalizeInterlockState`（`security/final-defense-policy.ts:43`）trim+lowercase；**legacy `asserted` → `isolated`**（`:45`，不是 armed！模型极易误读）；未知值 → `'unknown'`，而 `unknown` 在 `rootResistantGatewayDegradedReasons`（`final-defense.service.ts:725`）被当降级理由 `interlock_unknown` 使 `active=false`。bridge 状态共用同一归一化（`normalizeBridgeState`）。
- **fail-closed 不是"拒绝请求"，是"主动断桥 + 发 interlock_assert"**。`failClosed`（`gateway-daemon.ts:223`）= `assertIsolated`（`released=false`/`bridgeState='isolated'`/`applyRuleset('isolated_ruleset')`）+ 发 `{command:'interlock_assert'}` 帧驱动物理继电器。一次校验失败的副作用是**物理拓扑改变**（SERVER↔LAN/WAN 桥断开），不是仅一个 HTTP 错误。control-plane 侧 `rejectSession`（`hardware-authorization.service.ts:669`）另写 tamper-evident 审计，`invalid_signature`/`monotonic_counter_rollback`/`policy_digest_mismatch` 升 `severity:'critical'`。
- **release 是暂态，必自动回 isolated**。`releaseTtlMs` 在 final-defense 被 clamp 到 `[5_000, 15*60_000]`（`:254`），appliance 默认 30s（`gateway-daemon.ts:65`），到期 `assertIsolated('release_window_expired')`（`:152`）；companion 侧 `releaseInterlock` 同样 `setTimeout(assertInterlock, releaseTtlMs)`（`:273`）。没有显式 re-assert 的 release 必然回 isolated——"释放是异常，隔离是常态"。
- **isolated 保留 appliance 自身 MGMT 通道**。`dedicated_mgmt`/`cellular` 不计入降级（`final-defense.service.ts:764`），fail-closed 后仍可远程恢复 appliance；阻断的仅 server↔lan 业务桥。把 isolated 误解为"断所有链路"会写出无法恢复的恢复逻辑。
- **device-control 下发路径本身没有 clamp/estop/限幅**（`grep 'clamp|estop|emergency|throttle'` 0 命中）。安全全外移到硬件授权确认：`createPhysicalConfirmation` 强制 `hardwareContext.policyDigest`+`breakerTarget` 非空（`device-control.service.ts:351`，缺即抛 `backend.hardware_context_*_required`），`handlePhysicalConfirmationAck` 逐字段 === + 严格布尔 `payload.confirmed===true`（`:541`，防 `Boolean('false')` 真值陷阱）+ 签名验证，全过才 `dispatchConfirmedDeviceCommand`。**不要在 device-control 找限幅——它只 dispatch。**
- **grant 签名有 legacy fallback 但仅在无 extended fields 时触发**（`security/hardware-grant.ts:104`）。带 `policyDigest`/`challenge`/`breakerTarget`/`interlockAction` 任一字段的 grant，签名验不过直接 false，不退 legacy 11 字段消息。**升级不可逆**——一旦 grant 携带 Final Defense 上下文，就再不能用旧签名格式通过。签名算法默认 `ECDSA_P256_SHA256`（`hardware-authorization.service.ts:221`），验签 `verifyHardwareGrantSignature`（`hardware-grant.ts:88`）用各 gate 注册时存的 `public_key_pem`。
- **companion 本地 fail-closed 独立于上报通道**（`serial-device-companion.ts:362` reportStatus 注释）：上报失败不会放开 interlock。本地策略从 `FINAL_DEFENSE_POLICY_FILE`（默认 `/etc/aetherguard/final-defense-policy.json`）读，`loadLocalPolicy`（`:39`）重算 digest 比对 + 可选 HMAC 签名验（`timingSafeEqual` 防时序）。
- **M2 STM32 固件侧镜像同一套校验**（`firmware/controller-stm32h5/Core/Src/controller_tasks.c:36` `controller_handle_release_request`）：challenge 去重（`controller_validate_challenge` `:83`，16 槽环形 buffer，`strcmp` 重用即拒 `:86`）、policyDigest `strcmp` 严格相等（`controller_validate_policy_digest` `:95`，空串拒）、counter `counter > high_water_counter`（`controller_validate_counter` `:101`）、expiry `expires_at > g_current_time_s`（`:107`）、SE present + feedback OK 才 `INTERLOCK_STATE_RELEASED`，任一失败 `serial_json_send_alert()` + `DENIED`；`controller_assert_isolated`（`:157`）= 状态置 isolated + relay off。**release 成功分支推进高水位**（`:76` `g_state.high_water_counter = grant->monotonic_counter;`，工作树未提交）——与后端三套高水位"严格 `>`"语义对齐；host 测试 `test_counter_advances_on_release`（`test/test_controller.c:73`）断言释放后 `controller_get_high_water_counter()` 推进、重放同 counter 被拒（gcc 直编 test/Makefile 同源命令实跑 18 passed/0 failed）。此前"成功释放不推进 high_water、同一 counter 可重复释放"的缺口已闭合。**e-stop 现为锁存语义**：release 请求入口先查 `estop_pressed || state==FAULT` 即拒，`controller_clear_estop()` 显式复位仅回到 ISOLATED（ISO 13850——松开按钮不得自行恢复），host 测试 `test_estop_latch_blocks_release` 断言锁存期间合法 grant 被拒；simulator `mock-controller.ts` 已对齐同一门控与 feedback-mismatch 拒绝语义。改 `controller_tasks.c` 校验分支属安全路径，须按门禁置顶给证据，**不能当"参数微调"**；行号随未提交编辑会漂移，以函数名+分支条件为准。该固件当前 .ioc/CubeMX 代码未生成，`make` 在无 HAL 源时不可构建；仅 `test/` 下的 host-side gcc 测试可跑。

## 安全编码与防御性编程规范（代码变更必读）

为防止在后续开发与加固中引入安全缺陷，编写代码时必须严格遵守以下原则：

1. **防止文件路径穿透与符号链接逃逸**：
   - 任何涉及用户控制的文件路径（如 firmware upload 等）写入与读取，必须实现 "containment check"（包含性校验）。
   - 在比对基础目录（baseDir）前缀时，必须为 baseDir 追加路径分隔符（如 `path.sep`，例如 `base + path.sep`），防止 `/artifacts-evil` 前缀绕过对 `/artifacts` 的校验。
   - 在读/写路径上必须进行 symlink-aware（符号链接感知）校验。在 `fs.mkdir` 创建父目录后，必须调用 `fs.realpath` 校验解析后的真实绝对路径是否仍在 `baseDir` 范围内（如 `assertRealDirWithinBaseDir` 逻辑），防止攻击者通过植入软链接逃逸到外部目录。

2. **防御算术溢出（整数溢出回绕）**：
   - 在做时间戳加减、限流窗口等算术运算时，特别是 Rust fastpath 中，必须使用 `saturating_add` 或 `saturating_sub` 等饱和运算函数，禁止直接使用可能会在 release 模式下溢出回绕（wrap around）的加减号，防止恶意构造的大数值导致数值变为极小值从而绕过安全策略。

3. **内部 API 默认关闭与套接字权限收紧**：
   - 内部通信或 sidecar 服务（例如 `rust-fastpath`）在采用 TCP 时默认绑定 127.0.0.1，只在明确配置时才允许绑定其他接口。
   - Unix 域套接字（Unix socket）文件权限默认应收紧为 0o660（Owner + Group），不可使用 0o777。

4. **安全比较防护时序攻击（Timing Attack）**：
   - 任何涉及敏感凭据、安全策略摘要（如 `policyDigest` 校验等）或签名比对的布尔条件判断，必须使用时序安全的比较函数，如 Node.js 中的 `crypto.timingSafeEqual`。

### Final Defense API 路由

- `GET /api/final-defense/status`
- `POST /api/final-defense/policies`
- `POST /api/final-defense/actions`
- `POST /api/final-defense/gateways/status/report`
- `POST /api/final-defense/gateways/actions`

## 注意事项

- **`DISABLE_REDIS` 生产不得开启**（限流降级到内存 fallback 仅限非生产）。
- **Demo/pitch 路由**（如 `/aetherguard-deck`）默认禁用，仅 `VITE_ENABLE_PITCH_ROUTES=true` 本地 demo 构建启用。
- **sql.js 运行中改 SQLite 文件会被覆盖**（见数据库节）——停 backend 再改，或走 API/service。
- **不要提交生成物**：运行时 DB、KiCad scratch/router 交换文件、probe 报告、生成 PPTX、归档硬件中间产物、QA 截图、Playwright-MCP 状态（`check-repository-hygiene.mjs` 强制）。`hardware/enclosure/` 下的 `.stl`/`.png` 是已纳入版本库的渲染产物——改 `.scad` 后重渲染的产物可覆盖同名文件，但不要新增散落渲染文件；`hardware/enclosure/.gitignore` 已排除中间产物。
- 涉及"完全最后防线"对外口径时，工程限定词以本文档 `项目定位` / `安全控制流不变量` 为准，README 的产品 framing 不替代这里的工程限定。
- `AGENTS.md` 是 OpenCode 的 twin；项目知识与硬件/product framing 须与本文档保持同步。
