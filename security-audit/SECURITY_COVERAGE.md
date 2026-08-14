# SECURITY COVERAGE — AetherGuard 白盒审计

## 1. 模块覆盖矩阵

| 模块 | 状态 | 覆盖度 | 方法 | 缺口原因 |
| --- | --- | --- | --- | --- |
| backend/api/routes（28 文件） | REVIEWED | ~85% | 逐路由鉴权矩阵 + 焦点深读（auth/admin/agents/devices/deployments/final-defense/hardware-auth/enterprise-helper/agent-onboarding/investigation/attack/config/alerts/logs/seed/smart-fix） | dashboard/pipeline/rules/sites/stats/system/traffic/fix-history/ai-system/ai-endpoints 仅矩阵级+抽样 |
| backend/middleware + security/（19 文件） | REVIEWED | ~80% | 全部清单 + 焦点深读（auth/rate-limit/helper-auth/PP-guard/permissions/agent-auth/command-signing/input-validator/env-validator/runtime-env） | anti-bot/concurrency/nonce-manager/enhanced-rate-limiter 细节未逐行 |
| backend/services（39 文件） | PARTIALLY_REVIEWED | ~55% | 深读：command-dispatcher 链、hardware-authorization、deployment-run、artifact-store、fastpath-client、postgres-shadow-store（grep 级）、agent-auth | ai-agents 七层、detection-pipeline、oidc-auth 全流、notification-dispatcher（SSRF 面仅分类）、simulation/runtime-emulator 未逐行 |
| backend/websocket（2 网关） | REVIEWED | ~75% | agent-gateway 1794 行 + device-gateway 931 行通读 | socket-payload-validator 仅抽读；traffic-stats-helper 未读 |
| backend/agent + companion | REVIEWED | ~85% | agent.ts 命令验签链、firewall-controller、companion 两文件（AGENTS.md 交叉） | traffic-monitor/log-collector 抽样 |
| frontend/ | REVIEWED | 高（FE 报告全量） | 子代理全量 + 负结果 | — |
| rust-fastpath/ | REVIEWED | 高（RF 报告全量 + cargo test/clippy） | 子代理全量 | 集成环境未实测（未起容器） |
| rescue/ | REVIEWED | 高（RS 报告全量 + diff 审查） | 子代理全量 | release build 二进制为 HEAD 旧版（RS-001） |
| firmware/controller-stm32h5/ | REVIEWED | 高（FW 报告：100% 手写应用 C + 线协议交叉） | 子代理全量 | .ioc/CubeMX HAL 未生成（不可构建固件）；真机 UART 不可用 → FW-001 无动态 |
| deployment/ + CI + installer + certs | REVIEWED | 高（DP 报告 16 findings） | 子代理全量 | 未起容器实测网络面；CI 未实际触发运行 |
| ml/（允许路径） | REVIEWED | 中（ML 报告 12 findings） | 子代理（管线源码/配置/schema） | 密封内容按 DO_NOT_READ 禁读（设计如此）；未运行管线 |
| simulator/ | PARTIALLY_REVIEWED | ~40% | AGENTS.md 语义 + 场景脚本存在性 | 未逐行（它复用 companion/gateway-daemon 代码，主体已覆盖） |
| e2e/ scripts/ai/ .github/ | PARTIALLY_REVIEWED | ~50% | DP 报告覆盖 CI/workflows；guards 实跑 7/7 | Playwright 用例内容未逐条 |
| database.ts 内部 / migrations | PARTIALLY_REVIEWED | ~60% | 封装语义 + migration db.exec 静态串确认 | better-sqlite3/sql.js 双引擎边界条件未逐行 |

## 2. 漏洞类别覆盖（Phase 3 清单）

| 类别 | 结论 |
| --- | --- |
| SQLi | 参数化全查（含 shadow store）→ 未发现；`db.exec` 全为静态 DDL |
| Command/Code/Template Injection | **AG-B01 VERIFIED（部署模板/heredoc）**；scanner/fastpath 否决 |
| XSS | 前端零 sink；后端 API envelope JSON → 否决 |
| Path Traversal / File R/W | artifact store 双重校验 ✓；firmware upload 落 artifact store（继承防护）；未发现 |
| SSRF | AG-B02（ollama allowPrivate + webhook）EVIDENCE_FOUND（admin-gated） |
| Unsafe Deserialization | 无 pickle/yaml.load/ unserialize；JSON.parse 后 schema/validator 校验 → 未发现 |
| AuthN bypass / Session / JWT | 登录链深读（锁定/dummy-hash/refresh 防重放/OIDC state+redirect 白名单）→ 未发现；算法钉 HS256 ✓ |
| AuthZ / IDOR | **AG-B07（config 读）**、AG-B03b（codebook/events）EVIDENCE_FOUND；alerts/helper/hardware-confirmations 否决 |
| Privilege Escalation | 角色归一化矩阵 ✓；AG-A06（静态 key → tenant/ultra 伪身份）Medium |
| CSRF | cookie SameSite=strict + CORS 白名单 + Bearer/API-key 通道 → 未发现 |
| CORS | origin 函数精确匹配 + null 拒绝 ✓ |
| Open Redirect | OIDC redirect 白名单（auth.routes.ts:1120-1138）✓；FE-003 前端 OIDC URL 未验（Medium） |
| Mass Assignment | profile 白名单字段（validatedProfile 重构）部分；ai-endpoint 字段过滤 ✓ |
| Race Condition | 未系统审查（标记盲区：命令确认/审计链并发） |
| Business Logic | attack sim 门控 ✓；seed demo-only+token ✓；release TTL clamp ✓ |
| Rate Limit / Abuse | 多维引擎 + Redis fallback；DEP-01 socket.io-parser High 可达 |
| Crypto misuse | scrypt+AES-GCM ✓、HMAC ✓、ECDSA P-256 ✓；timingSafeEqual 全覆盖敏感比较 ✓；**installer Math.random（DP-003）** |
| Randomness | CSPRNG 广泛使用（除 DP-003） |
| Secret leakage | **DP-001 FTP 明文（历史）**；DP-004 已提交私钥；AG-B07 config 回显 |
| Sensitive logging | 命令签名日志已脱敏（CVE-200 fix）；日志 API 只回聚合/50 条 ✓ |
| Debug endpoints | /health 最小化 ✓；demo/pitch 路由默认禁用 ✓ |
| Dependencies | DEP-01 socket.io-parser High（可达）+ fast-uri/brace-expansion/js-yaml（dev 链为主） |
| Supply chain | DP-008 浮动 tag、DP-010/011 离线 bundle 无签名+skip-verify、ML-001 未锁依赖 |
| Docker/Deploy | DP-005/006 fail-closed 弱化、DP-013/015 root、DP-014 构建破坏 |
| Env exposure | runtime-env 生产硬校验 fail-closed ✓；.env 生成器 CSPRNG ✓ |
| Prototype Pollution | 双段 guard ✓（测试覆盖） |
| Memory safety | Rust 零 unsafe ✓；C 侧 FW 报告（界内拷贝、无溢出）✓ |

## 3. OWASP ASVS 4.0 gap 分析（V 章节抽样）

- **V2 认证**：2.1/2.2/2.5 ✓（锁定、MFA-OIDC、服务端会话）；2.8 **设备共享静态密钥（DEVICE_API_KEYS/VALID_API_KEYS/SERIAL_HELPER）无轮换无独立身份** = 长期缺口
- **V3 会话**：✓ 全面（并发上限、撤销、重验证）
- **V4 访问控制**：4.1 基线 ✓；**4.3 租户隔离在 legacy 内存设备表上不完整（AG-B03b）**；4.5.1 config 密钥读取未按角色脱敏（AG-B07）
- **V5 输入处理**：5.x 广泛 ✓；**5.3 部署生成物输出编码缺失（AG-B01）**
- **V6 密码学**：6.2 ✓；6.3 **installer 非 CSPRNG（DP-003）**
- **V8 数据保护**：8.3 **GET /config 密钥回显（AG-B07）**
- **V10 通信**：compose 内网明文（内部 TLS 未启用）——记录为架构权衡
- **V12 文件资源**：artifact store ✓；固件上传后**无签名校验链（与 DP-010 呼应）**
- **V14 配置**：14.1 runtime-env ✓；**14.2 部署面 root/浮动镜像/bundle 无签名**
- **V13 日志监控**：tamper-evident 审计 ✓（backend+rescue）；RS-002 吞错弱化

## 4. 未测区域与所需条件

| 区域 | 需要 |
| --- | --- |
| M2 固件真机验证（FW-001 PoC） | STM32H563 板 + UART（或 QEMU STM32 支持） |
| 容器网络实测（fastpath TCP 无鉴权、端口面） | docker compose up（本审计保持只读未起） |
| 生产 Postgres 模式等价性 | SHADOW_DATABASE_URL 环境 |
| 真实 OIDC IdP 交互 | IdP 实例 |
| race conditions 系统审查 | 专项并发测试轮 |
| ai-agents 七层决策管线逐行 | 下一轮专项（当前抽样未见 sink） |
| ML 密封集内容 | 设计禁读（DO_NOT_READ）——仅治理级结论 |

## 5. "如果我要证明这次审计并不完整" 自答

1. ai-agents/detection-pipeline 260+ 文件仅抽样——LLM 决策层 prompt-injection 面未系统审（smart-fix 的 AIPromptValidator 存在说明历史上有此类风险）。
2. 未起任何容器：compose 声明的网络隔离（fastpath 仅内网、DB 不暴露）未实测验证。
3. 并发/race 未专项：硬件确认会话的 check-then-act 窗口、audit 链并发 append。
4. e2e/ 与 Playwright 脚本内容未审（其中的测试凭据/硬编码端点）。
5. 前端 bundle 产物与 source map 未验证（仅源码级）。
6. git 历史仅抽查（DP-001 靠子代理发现，可能还有其他历史泄漏）。
