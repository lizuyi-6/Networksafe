# AI 助手调试手册（AI-Assistant Debugging Guide）

> 目标读者：接入本仓库的 AI 编码助手（Claude Code / OpenCode / Cursor 等）及新成员。
> 本文回答三个问题：**现在什么坏了？** / **在哪里下断点？** / **这个报错意味着什么？**

## 1. 一条命令看全仓健康（AI 首选入口）

```bash
node scripts/ai/diagnose.mjs           # 快速集：4 个 guard + 前后端 typecheck/lint（约 1-2 分钟）
node scripts/ai/diagnose.mjs --tests   # 加测试集：backend 全量 4 shard + cargo + 固件 host 测试 + 4 个 fail-closed 场景
node scripts/ai/diagnose.mjs --json    # 机器可读 JSON（含每项 exit code、耗时、失败输出尾部）
```

- 退出码 0 = 所有**未跳过**项通过；`skipped ≠ passed`，缺工具链（gcc/cargo）会显式列出原因。
- 失败项自动附最后 25 行输出，AI 无需翻滚动日志。

## 2. 分组件命令速查

| 组件 | 验证命令 | 说明 |
| --- | --- | --- |
| backend 全量 | `cd backend && npm run test:all` | **禁用 `npm test`**（单进程 OOM），4 shard 各 50% worker |
| backend 单文件 | `npx jest src/__tests__/<path>.test.ts` | 最快的复现回路 |
| backend 类型/风格 | `npm run typecheck` / `npm run lint` | |
| frontend | `cd frontend && npm run typecheck && npm run lint` | lint 是 `--max-warnings 0` |
| Rust | `cd rust-fastpath && cargo test && cargo clippy -- -D warnings` | |
| 固件 host 测试 | `cd firmware/controller-stm32h5 && make -f test/Makefile test` | Windows 无 make 时：直接用 Makefile 里的 gcc 命令（diagnose.mjs --tests 已内置） |
| Simulator 控制环 | `cd simulator && npm run sim` | 真 M1 daemon + mock M2/M3/M4 |
| fail-closed 场景 | `npm run test:invalid-sig / test:counter-rollback / test:heartbeat-stale / test:estop` | 每个 exit 0 = fail-closed 成立 |
| 架构 guard | `node scripts/guards/*.mjs`（从仓库根） | 从子目录跑会因相对路径 ENOENT |

## 3. 断点地图（安全路径咽喉点，按函数名找——行号会漂移）

VS Code 打开仓库即有四个调试配置（`.vscode/launch.json`，已入库）：
**Backend: dev server** / **Backend: debug current Jest file**（打开测试文件按 F5）/ **Simulator: full control loop** / **Attach 9229**。

| 你在查什么 | 下断点的函数 | 文件 |
| --- | --- | --- |
| grant 为何被拒 | `validateGrantPayload`、`handlePhysicalConfirmationAck` | `backend/src/services/hardware-authorization.service.ts` |
| 桥为何断开（fail-closed） | `failClosed`、`requestRelease`、`checkWatchdog` | `backend/src/companion/gateway-daemon.ts` |
| policyDigest 不匹配 | `computeFinalDefensePolicyDigest`、`policyDigestInput` | `backend/src/security/final-defense-policy.ts` |
| companion 本地拒绝 | `validateLocalPolicyGrant`、`loadLocalPolicy` | `backend/src/companion/serial-device-companion.ts` |
| 签名验证失败 | `verifyHardwareGrantSignature`、`buildHardwareGrantMessage` | `backend/src/security/hardware-grant.ts` |
| 检测判定异常 | `evaluateRequest`（decisionSource 是判定来源的权威字段） | `backend/src/services/detection-pipeline.service.ts` |
| AI 裁决可疑 | `AgentOrchestrator.analyze`、各角色 `analyze`/`fallbackAnalysis` | `backend/src/ai-agents/core/agent-orchestrator.ts`、`roles/*.ts` |
| 命令下发链 | `createPhysicalConfirmation`、`dispatchConfirmedDeviceCommand` | `backend/src/services/device-control.service.ts` |
| 固件校验分支 | `controller_handle_release_request`（顺序：estop锁存→challenge→digest→counter→expiry→SE→feedback） | `firmware/controller-stm32h5/Core/Src/controller_tasks.c` |

## 4. 错误签名 → 根因对照表

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| `npm test` 内存耗尽 / worker crash | 全量单进程跑 Jest | 用 `npm run test:all`（4 shard） |
| 改了 SQLite 文件又被改回去 | sql.js 模式整库在内存,每 30s 全量落盘覆盖文件 | 停 backend 再改文件,或走 API/service |
| `Could not locate the bindings file...better_sqlite3.node` | better-sqlite3 原生绑定与 Node 主版本不匹配 | `npm install`（v12+ 有 Node 24 prebuild）;引擎会自动回退 sql.js,日志有 `SQLite engine ... unavailable` |
| 测试单跑绿、全量偶红 | 并行 shard 下的计时竞态（固定 sleep / 真实宿主指标） | 不要加长 sleep;改轮询等待或 mock 指标源（先例：`websocket-connection-cap.test.ts` 的 `waitUntil`、`probe-agent.test.ts` 的 `jest.doMock('os')`） |
| `make: command not found`（Windows） | Git Bash 无 make | 直接用 test/Makefile 内的 gcc 命令,或 `node scripts/ai/diagnose.mjs --tests` |
| guard 脚本 ENOENT `frontend\backend\...` | 从子目录运行 guard | 一律从仓库根运行 |
| ws/socket 测试端口冲突 | 并行套件抢端口 | 焦点单跑该文件复现;端口在各测试文件顶部常量 |
| `heuristicDegraded: true` 出现在决策里 | AI 模型不可达,三贤者走了启发式 fallback | 检查 `OLLAMA_URL`（默认 localhost:11434）或平台云 key;这是诚实标记,不是 bug |
| 固件 grant 全被拒且状态 FAULT | e-stop 锁存未清 | 调 `controller_clear_estop()`（复位只回 ISOLATED,需新 grant 才能 release） |

## 5. 让报错更清楚

- **日志级别**：`LOG_LEVEL=debug` 环境变量（`backend/src/utils/logger.ts` 读取）。生产默认 info。
- **判定溯源**：每条检测事件的 `decisionSource` 字段写明判定来自谁（`rule:*` / `ai:*` / `security_classification:*_fail_closed`）;AI 事件的 `responseSnapshot.finalAi` 是完整 rawDecision（层激活、辩论、退化标记）。
- **硬件授权拒绝**：`rejectSession` 写 tamper-evident 审计行,reason 枚举（`invalid_signature` / `monotonic_counter_rollback` / `policy_digest_mismatch`…）与 CLAUDE.md 安全不变量一一对应。
- **fail-closed 场景注入**：想复现某个失败分支,优先用 `simulator/test-scenarios.ts` 的四个触发器,别在生产代码里手插故障。

## 6. AI 助手协作约定（与本仓门禁一致）

1. 声称修复前先跑第 2 节对应命令并贴退出码;安全路径（final-defense / interlock / gateway-daemon / controller_tasks / requires_*）改动必须置顶披露。
2. 改 ≥2 文件逐文件给验证;`git diff --stat` 是改动集的唯一权威。
3. 测试失败先分类：单跑绿+全量红 → 按第 4 节竞态先例处理,不许 skip;真回归 → 修根因。
