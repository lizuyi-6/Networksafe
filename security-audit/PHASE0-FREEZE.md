# PHASE 0 — 项目冻结与审计范围

- **审计开始时间**: 2026-07-31 之后（工作树快照）
- **审计人**: Principal Application Security Engineer (white-box, 授权测试)
- **仓库**: X:\repos\Networksafe (AetherGuard)
- **Remote**: https://github.com/lizuyi-6/Networksafe.git

## 冻结快照

| 项 | 值 |
| --- | --- |
| git HEAD | `7d235411404e03dffe4996e29a82fd74793160d1` |
| branch | `agent/aetherargus-paper-evidence-20260731` |
| HEAD commit | `test(ml): pass hardened paper evidence validation (strict 27/27)` (2026-07-31 20:45:52 +0800) |
| 工作树状态 | **脏** — 38 个未提交改动（含安全关键文件：`backend/src/security/agent-auth.service.ts`、`backend/src/services/hardware-authorization.service.ts`、`backend/src/websocket/device-gateway.ts`、`firmware/.../controller_tasks.c`、`rescue/src/{appliance,runtime}.rs` 等） |

> **审计基线声明**：本次审计对象为**当前工作树**（含未提交修改），不是纯 HEAD commit。
> 工作树中与安全相关的 modified 文件全列表（git status）：
> `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `backend/src/__tests__/*(5)`, `backend/src/api/routes/alerts.routes.ts`, `backend/src/api/routes/seed.routes.ts`, `backend/src/database/seeds/seed-manager.ts`, `backend/src/security/agent-auth.service.ts`, `backend/src/services/hardware-authorization.service.ts`, `backend/src/websocket/device-gateway.ts`, `docs/implementation-progress/agent-work-ledger.md`, `firmware/controller-stm32h5/Core/{Inc,Src,test}/*(3)`, `ml/schemas/detection-input.schema.json`, `rescue/src/{appliance,runtime}.rs`, `scripts/deploy_frontend.ps1`, `scripts/list_ftp.ps1`

## 技术栈

| 项 | 值 |
| --- | --- |
| 语言 | TypeScript (backend/frontend/simulator), Rust (rust-fastpath 1.85, rescue), C (STM32 firmware), Python 3.12 (ml pipeline), PowerShell/Bash (scripts) |
| 后端框架 | Express 4 + Socket.IO 4 (+ws), jsonwebtoken, bcryptjs, better-sqlite3 / sql.js, pg, ioredis, ssh2, nodemailer, greenlock-express |
| 前端 | React + Vite, 唯一 API 客户端层 `frontend/src/services/api.ts` (credentials: include, httpOnly cookie) |
| Package manager | npm (root / backend / frontend / simulator / installer), cargo, py -3 |
| 构建系统 | tsc, vite, cargo, make/gcc (firmware host tests), Docker Compose v2.24+ |
| 测试 | Jest 4-shard (`npm run test:all`), cargo test, gcc host-side C tests, simulator scenarios, Playwright e2e |
| 运行方式 | dev: `npm run dev:backend` (监听 3005)；生产: `docker compose up` → 前端/API 反代仅发布 `127.0.0.1:8080`；Gateway Daemon: systemd + nftables (`deployment/gateway/`) |
| 密钥管理 | `scripts/setup.mjs` / `setup-env.sh` 生成 `.env`（12 项 compose `:?` 硬保护；`runtime-env.ts` WEAK_VALUE_PATTERNS 拒 `change_me*`） |

## 审计范围与排除

**范围内**：backend/、frontend/、rust-fastpath/、rescue/、firmware/controller-stm32h5/、simulator/、deployment/、scripts/、docker-compose*.yml、installer/、.github/、ml/（仅管线代码与配置）、根目录脚本与配置。

**必须绕开（密封，禁止读取内容）** — 摘自 `DO_NOT_READ.md` (v2)：
- `ml/data/lan_challenge_capture/**`（含 `raw-private/` 凭据）
- `ml/data/releases/*/test-closed.jsonl` + `test-independent.jsonl`
- `ml/evaluation/lan_challenge/**` 及 `ml/evaluation/` 顶层 5 个 eval 脚本
- `ml/reports/lan-challenge-evaluation/{aetherargus-lan-challenge-report.json, error-analysis.json, predictions,metrics,tables,figures,paper}/**`
- `ml/reports/repository-inspection.md`
- `ml/reports/lan-challenge-evaluation/{artifact-inventory.json, claim-to-evidence-matrix.*, evaluation-manifest.json, inference-path-ablation-v2.*, pull-request-provenance.json}`（保守默认禁读）

允许读的 ml/ 路径：`ml/data_pipeline/**`（v0.2/v0.3 管线源码）、`ml/schemas/*.schema.json`、`ml/configs/**`、`ml/data/manifests/**`、SAFE 清单中的聚合报告。

**动态验证约束**：仅限本地授权环境、最小非破坏 PoC、不攻击外部第三方、不破坏真实数据、不修改产品代码（审计产物只写入 `security-audit/`）。

## 工具可用性（Phase 4 预检）

- node v24.13.1 / npm 11.8.0 / Python 3.12.10 / cargo 1.90.0 / gcc 16.1.0 (MSYS2) / Docker 29.4.3
- semgrep：**不可用**（未安装）
- 可用替代：npm audit（需网络）、cargo clippy/test、tsc typecheck、eslint、仓库自带 guard 脚本、Jest 既有安全测试
